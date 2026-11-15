#!/usr/bin/env python3
"""Build the app's static data and display assets with safe publication (issue #55)."""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from matplotlib.colors import LightSource
from scipy.ndimage import map_coordinates
import yaml

from landcover import bare_ground_value
from lighting import MARS_TARGET_NOTE
from terrain import (
    WORK_RES_M,
    load_window_sizes,
    locate_malapert,
    open_lola,
    read_earth_window,
    read_lola_window,
)
from publication import (
    PublicationError,
    load_candidates,
    publish_staged_dirs,
    staged_public_dirs,
    validate_asset_references,
    validate_finite_json_tree,
    validate_output_shapes,
    validate_unique_ids,
    selftest as publication_selftest,
)

ROOT = Path(__file__).resolve().parents[1]
SITES_PATH = ROOT / "config" / "sites.json"
WEIGHTS_PATH = ROOT / "config" / "weights.yaml"
TERRAIN_PATH = ROOT / "results" / "terrain.json"
LIGHTING_PATH = ROOT / "results" / "lighting.json"
MARS_PATH = ROOT / "results" / "mars.json"
LANDCOVER_PATH = ROOT / "results" / "landcover.json"
DATA_DIR = ROOT / "frontend" / "public" / "data"
IMG_DIR = ROOT / "frontend" / "public" / "img"
RELIEF_DIR = DATA_DIR / "relief"
RELIEF_SIZE = 129
HILLSHADE_AZIMUTH_DEG = 315
HILLSHADE_ALTITUDE_DEG = 45
LUMON_SOURCE = "LuMon, arXiv 2604.09352, Table 2"
LUMON_MODEL = "Depth Anything V2"
LUMON_SOURCE_ID = "lumon_table2"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def value(number: float | None, tier: str, source: str | None, res_m: float | None = None) -> dict[str, Any]:
    if number is None or not math.isfinite(float(number)):
        return {"value": None, "tier": "missing", "source": None}
    item = {"value": float(number), "tier": tier, "source": source}
    if res_m is not None:
        item["res_m"] = float(res_m)
    return item


def ordered_params(values: dict[str, float | None], source: str | None, res_m: float | None) -> dict[str, Any]:
    return {
        key: value(values.get(key), "computed", source, res_m)
        for key in ("slope_mean_deg", "slope_p90_deg", "roughness_m")
    }


def ordered_windows(row: dict[str, Any], sizes: list[float]) -> dict[str, Any]:
    return {
        str(int(km)): {
            key: row["windows"].get(str(int(km)), {}).get(key)
            for key in ("slope_mean_deg", "slope_p90_deg", "roughness_m")
        }
        for km in sizes
    }


def source_res_m(row: dict[str, Any]) -> float | None:
    res = row.get("res_m")
    return float(res) if res is not None else None


def render_hillshade(
    identifier: str, elevation: np.ndarray, valid: np.ndarray, *, img_dir: Path | None = None
) -> str:
    """Render a display-only, north-up grayscale hillshade from the 12 km DEM."""
    source = np.where(valid, elevation, np.nan).astype(np.float32)
    shade = LightSource(azdeg=HILLSHADE_AZIMUTH_DEG, altdeg=HILLSHADE_ALTITUDE_DEG).hillshade(
        source, vert_exag=1.0, dx=WORK_RES_M, dy=WORK_RES_M, fraction=1.0
    )
    shade = np.where(valid & np.isfinite(shade), shade, 0.0)
    rgba = np.empty((*shade.shape, 4), dtype=np.float32)
    rgba[..., :3] = shade[..., None]
    rgba[..., 3] = valid.astype(np.float32)
    output_dir = img_dir if img_dir is not None else IMG_DIR
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{identifier}.png"
    from matplotlib.image import imsave

    imsave(path, rgba, origin="upper")
    return f"img/{identifier}.png"


def write_relief(
    identifier: str, elevation: np.ndarray, valid: np.ndarray, *, relief_dir: Path | None = None
) -> str:
    """Sample the 12 km 30 m DEM to the contract's 129 × 129 north-up grid."""
    rows = np.linspace(0, elevation.shape[0] - 1, RELIEF_SIZE)
    cols = np.linspace(0, elevation.shape[1] - 1, RELIEF_SIZE)
    rr, cc = np.meshgrid(rows, cols, indexing="ij")
    weight = map_coordinates(valid.astype(np.float32), [rr, cc], order=1, mode="nearest")
    numerator = map_coordinates(np.where(valid, elevation, 0.0).astype(np.float32), [rr, cc], order=1, mode="nearest")
    sampled = np.divide(numerator, weight, out=np.full_like(numerator, np.nan), where=weight > 0)
    # Never bridge a source nodata boundary: only export samples fully covered by valid source cells.
    sampled[weight < 0.9999] = np.nan
    flat = [float(x) if math.isfinite(float(x)) else None for x in sampled.ravel(order="C")]
    cell_m = (elevation.shape[0] - 1) * WORK_RES_M / (RELIEF_SIZE - 1)
    output_dir = relief_dir if relief_dir is not None else RELIEF_DIR
    write_json(output_dir / f"{identifier}.json", {
        "id": identifier,
        "size": RELIEF_SIZE,
        "cell_m": cell_m,
        "elev_m": flat,
    })
    return f"data/relief/{identifier}.json"


def output_for_identity(
    row: dict[str, Any], identity: dict[str, Any], lighting: dict[str, Any], main_window: str,
    sizes: list[float], elevation_assets: tuple[np.ndarray, np.ndarray] | None,
    *, img_dir: Path | None = None, relief_dir: Path | None = None,
) -> dict[str, Any]:
    params = ordered_params(row["windows"].get(main_window, {}), row.get("source"), source_res_m(row))
    windows = ordered_windows(row, sizes)
    hillshade = ""
    relief = None
    if elevation_assets is not None:
        z, valid = elevation_assets
        hillshade = render_hillshade(row["id"], z, valid, img_dir=img_dir)
        relief = write_relief(row["id"], z, valid, relief_dir=relief_dir)
    return {
        **identity,
        "params": params,
        "windows": windows,
        "low_sun_share": lighting,
        "hillshade": hillshade,
        "relief": relief,
    }


def load_display_window(
    identity: dict[str, Any], body: str, km: float, located: dict[str, tuple[float, float, float]]
) -> tuple[np.ndarray, np.ndarray] | None:
    lat, lon = identity.get("lat"), identity.get("lon")
    if body == "moon" and lat is None:
        lat, lon, _ = located[identity["id"]]
    if lat is None or lon is None:
        return None
    if body == "moon":
        z, valid, center = read_lola_window(float(lat), float(lon), km)
    else:
        z, valid, center, _ = read_earth_window(float(lat), float(lon), km)
        if z is None:
            return None
    return z[center, center], valid[center, center]


def build_config(weights: dict[str, Any], sites: dict[str, Any]) -> dict[str, Any]:
    entries = sites["lunar"] + sites["earth"] + sites.get("mars", [])
    return {
        "main_window_km": weights["main_window_km"],
        "window_sizes_km": weights["window_sizes_km"],
        "params": weights["params"],
        "warning": weights["warning"],
        "stability": weights["stability"],
        "provisional": any(not item.get("confirmed", False) for item in entries),
    }


def build_evidence() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    rows = [
        {"dataset": "Etna-LRNT", "kind": "Analog", "delta1": 1.00, "site_id": "etna"},
        {"dataset": "Etna-S3LI", "kind": "Analog", "delta1": 0.88, "site_id": "etna"},
        {"dataset": "Chang'e-3", "kind": "In-situ", "delta1": 0.95, "site_id": None},
        {"dataset": "CHERI", "kind": "Analog", "delta1": 0.32, "site_id": None},
    ]
    evidence = {
        "cited": {
            "source_id": LUMON_SOURCE_ID,
            "source": LUMON_SOURCE,
            "model": LUMON_MODEL,
            "metric": "delta1",
            "rows": rows,
        },
        "ours": {
            "source_id": "not_computed",
            "source": "No project benchmark results supplied for Issue #4",
            "model": "not available",
            "metric_note": "No project benchmark results supplied for Issue #4",
            "rows": [],
            "images": [],
        },
        "not_shown": ["Project benchmark results are not included in this issue's inputs."],
        "sky_caveat": "Earth's sky scatters light into shadows. The Moon has no air, so its shadows are black.",
    }
    etna_rows = [
        {"dataset": "Etna-LRNT", "model": LUMON_MODEL, "delta1": 1.00, "tier": "cited", "source": LUMON_SOURCE},
        {"dataset": "Etna-S3LI", "model": LUMON_MODEL, "delta1": 0.88, "tier": "cited", "source": LUMON_SOURCE},
    ]
    return evidence, etna_rows


def build_app_data(
    candidates: list[dict[str, Any]], *, data_dir: Path, img_dir: Path, relief_dir: Path
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    sites_manifest = read_json(SITES_PATH)
    weights = yaml.safe_load(WEIGHTS_PATH.read_text(encoding="utf-8"))
    terrain_rows = read_json(TERRAIN_PATH)
    lighting_rows = read_json(LIGHTING_PATH)
    # Optional: without results/landcover.json every site keeps bare_ground_share missing.
    landcover_rows = read_json(LANDCOVER_PATH) if LANDCOVER_PATH.exists() else {}
    mars_document = read_json(MARS_PATH) if MARS_PATH.exists() else []
    mars_rows = mars_document if isinstance(mars_document, list) else [mars_document]
    terrain_by_id = {row["id"]: row for row in terrain_rows}
    mars_by_id = {row["id"]: row for row in mars_rows}
    sizes = load_window_sizes()
    main_window = str(int(weights["main_window_km"]))

    lunar_targets = sites_manifest["lunar"]
    earth_sites = sites_manifest["earth"]
    mars_targets = sites_manifest.get("mars", [])
    located: dict[str, tuple[float, float, float]] = {}
    if any(item.get("lat") is None for item in lunar_targets):
        located["malapert"] = locate_malapert(open_lola())

    targets: list[dict[str, Any]] = []
    for item in lunar_targets:
        row = terrain_by_id[item["id"]]
        lat = row.get("lat")
        lon = row.get("lon")
        source_light = lighting_rows.get(item["id"], {})
        asset_identity = {"id": item["id"], "lat": lat, "lon": lon}
        assets = load_display_window({**item, **asset_identity}, "moon", max(sizes), located)
        target = output_for_identity(
            row,
            {
                "id": item["id"], "name": item["name"], "lat": lat, "lon": lon,
                "note": item["why"], "body": "moon",
            },
            value(source_light.get("value"), source_light.get("tier", "missing"), source_light.get("source")),
            main_window, sizes, assets, img_dir=img_dir, relief_dir=relief_dir,
        )
        targets.append(target)

    for item in mars_targets:
        row = mars_by_id.get(item["id"])
        # Reference only: the lighting comparison and warning stay Moon-only (issue #43).
        mars_light_row = lighting_rows.get(item["id"])
        mars_light = (
            value(mars_light_row.get("value"), mars_light_row.get("tier", "missing"), mars_light_row.get("source"))
            if mars_light_row else None
        )
        if row is None:
            windows = {
                str(int(km)): {"slope_mean_deg": None, "slope_p90_deg": None, "roughness_m": None}
                for km in sizes
            }
            targets.append({
                "id": item["id"], "name": item["name"], "lat": item["lat"], "lon": item["lon"],
                "note": item["why"], "body": "mars",
                "params": ordered_params({}, None, None), "windows": windows,
                "low_sun_share": mars_light, "hillshade": "", "relief": None,
            })
            continue
        targets.append({
            "id": item["id"], "name": item["name"], "lat": row["lat"], "lon": row["lon"],
            "note": MARS_TARGET_NOTE,
            "body": "mars",
            "params": ordered_params(row["windows"].get(main_window, {}), row.get("source"), source_res_m(row)),
            "windows": ordered_windows(row, sizes),
            "low_sun_share": mars_light,
            "hillshade": "img/target_jezero.png" if (img_dir / "target_jezero.png").exists() else "",
            "relief": "data/relief/jezero.json" if (relief_dir / "jezero.json").exists() else None,
        })

    evidence, etna_evidence = build_evidence()
    sites: list[dict[str, Any]] = []
    for item in earth_sites:
        row = terrain_by_id[item["id"]]
        light = lighting_rows.get(item["id"], {})
        flags = []
        if row.get("flat_share") is not None and row["flat_share"] > 0.2:
            flags.append("includes water")
        if not item.get("confirmed", False):
            flags.append("coordinates approximate")
        if "Copernicus" in (row.get("source") or ""):
            flags.append("non-NASA elevation source")
        source = row.get("source")
        asset_identity = {"id": item["id"], "lat": item["lat"], "lon": item["lon"]}
        assets = load_display_window({**item, **asset_identity}, "earth", max(sizes), located)
        params = ordered_params(row["windows"].get(main_window, {}), source, source_res_m(row))
        conditions = {
            "low_sun_share": value(light.get("value"), light.get("tier", "missing"), light.get("source")),
            "bare_ground_share": bare_ground_value(landcover_rows.get(item["id"])),
        }
        hillshade = ""
        relief = None
        if assets is not None:
            hillshade = render_hillshade(item["id"], *assets, img_dir=img_dir)
            relief = write_relief(item["id"], *assets, relief_dir=relief_dir)
        sites.append({
            "id": item["id"], "name": item["name"], "lat": item["lat"], "lon": item["lon"],
            "why": item["why"], "elev_m": row.get("elev_m"), "params": params,
            "windows": ordered_windows(row, sizes), "conditions": conditions,
            "depth_evidence": etna_evidence if item["id"] == "etna" else [],
            "known_analog": True, "flags": flags, "hillshade": hillshade, "relief": relief,
        })

    # Candidate input is selected by main(): absent candidates never silently mean none.
    sites.extend(candidates)

    # All writes target the staged release directories, never the live public output.
    write_json(data_dir / "config.json", build_config(weights, sites_manifest))
    write_json(data_dir / "targets.json", targets)
    write_json(data_dir / "sites.json", sites)
    write_json(data_dir / "evidence.json", evidence)
    validate_outputs(targets, sites, evidence, {row["id"] for row in candidates})
    return targets, sites, evidence


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Build the app's static data and terrain assets safely.")
    parser.add_argument("--selftest", action="store_true", help="run small synthetic publication checks")
    parser.add_argument(
        "--reference-only", action="store_true",
        help="intentionally build without scan candidates (otherwise results/candidates.json is required)",
    )
    args = parser.parse_args(argv)
    if args.selftest:
        return selftest()

    try:
        candidates_path = ROOT / "results" / "candidates.json"
        candidates = load_candidates(candidates_path, reference_only=args.reference_only)
        # Required inputs are checked before staging or doing expensive raster work.
        for required in (SITES_PATH, WEIGHTS_PATH, TERRAIN_PATH, LIGHTING_PATH):
            if not required.is_file():
                raise PublicationError(f"required build input is missing: {required}")

        with staged_public_dirs(DATA_DIR, IMG_DIR, root=DATA_DIR.parent.parent) as (staged_data, staged_img):
            staged_relief = staged_data / "relief"
            staged_relief.mkdir(parents=True, exist_ok=True)
            targets, sites, evidence = build_app_data(
                candidates, data_dir=staged_data, img_dir=staged_img, relief_dir=staged_relief,
            )
            validate_asset_references(
                targets, sites, evidence, staged_data=staged_data, staged_img=staged_img,
            )
            validate_outputs(targets, sites, evidence, {row["id"] for row in candidates})
            validate_finite_json_tree(staged_data)
            publish_staged_dirs(staged_data, staged_img, DATA_DIR, IMG_DIR)
        print(f"Built {len(targets)} targets, {len(sites)} sites, and {len(evidence['cited']['rows'])} cited evidence rows.")
        print(f"Hillshades: {len(list(IMG_DIR.glob('*.png')))}; relief grids: {len(list(RELIEF_DIR.glob('*.json')))}")
        return 0
    except (PublicationError, OSError, ValueError, KeyError) as exc:
        import sys

        print(f"error: {exc}; existing public output was not accepted as a new release", file=sys.stderr)
    return 1


def selftest() -> int:
    """Exercise publication helpers and the explicit reference-only build path."""
    import contextlib
    import io
    import tempfile

    publication_selftest()
    names = (
        "ROOT", "SITES_PATH", "WEIGHTS_PATH", "TERRAIN_PATH", "LIGHTING_PATH", "MARS_PATH",
        "LANDCOVER_PATH", "DATA_DIR", "IMG_DIR", "RELIEF_DIR", "build_app_data",
    )
    saved = {name: globals()[name] for name in names}
    with tempfile.TemporaryDirectory(prefix="earth-analog-build-test-") as temporary:
        root = Path(temporary)
        sites_path = root / "config" / "sites.json"
        sites_path.parent.mkdir(parents=True)
        sites_path.write_text(
            json.dumps({"lunar": [], "mars": [], "earth": [{"id": "reference"}]}), encoding="utf-8",
        )
        weights_path = root / "config" / "weights.yaml"
        terrain_path, lighting_path = root / "results" / "terrain.json", root / "results" / "lighting.json"
        weights_path.write_text("fixture", encoding="utf-8")
        terrain_path.parent.mkdir(parents=True)
        terrain_path.write_text("[]", encoding="utf-8")
        lighting_path.write_text("{}", encoding="utf-8")
        data_dir, img_dir = root / "frontend" / "public" / "data", root / "frontend" / "public" / "img"
        data_dir.mkdir(parents=True)
        img_dir.mkdir(parents=True)
        (data_dir / "previous-release.json").write_text('{"keep": "preserve"}', encoding="utf-8")
        candidates_path = root / "results" / "candidates.json"
        assert not candidates_path.exists()

        def fixture_build(candidates, *, data_dir, img_dir, relief_dir):
            assert candidates == [], "reference-only mode must not consume candidate records"
            targets = []
            sites = [{
                "id": "reference", "name": "Reference site", "lat": 0.0, "lon": 0.0, "why": "fixture",
                "elev_m": None, "params": {}, "windows": {}, "conditions": {}, "depth_evidence": [],
                "known_analog": True, "flags": [], "hillshade": "", "relief": None,
            }]
            evidence = {"cited": {"rows": [{"id": str(i)} for i in range(4)]}, "ours": {"images": []}}
            write_json(data_dir / "config.json", {})
            write_json(data_dir / "targets.json", targets)
            write_json(data_dir / "sites.json", sites)
            write_json(data_dir / "evidence.json", evidence)
            return targets, sites, evidence

        try:
            globals().update({
                "ROOT": root, "SITES_PATH": sites_path, "WEIGHTS_PATH": weights_path,
                "TERRAIN_PATH": terrain_path, "LIGHTING_PATH": lighting_path,
                "MARS_PATH": root / "results" / "mars.json", "LANDCOVER_PATH": root / "results" / "landcover.json",
                "DATA_DIR": data_dir, "IMG_DIR": img_dir, "RELIEF_DIR": data_dir / "relief",
                "build_app_data": fixture_build,
            })
            before = {p.relative_to(root / "frontend" / "public").as_posix(): p.read_bytes()
                      for p in (root / "frontend" / "public").rglob("*") if p.is_file()}
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = main([])
            after = {p.relative_to(root / "frontend" / "public").as_posix(): p.read_bytes()
                     for p in (root / "frontend" / "public").rglob("*") if p.is_file()}
            assert code == 1, "default build without candidate input should fail closed"
            assert after == before, "missing candidate input changed public output"

            with contextlib.redirect_stdout(io.StringIO()):
                code = main(["--reference-only"])
            assert code == 0, "explicit reference-only build did not complete"
            published_sites = json.loads((data_dir / "sites.json").read_text(encoding="utf-8"))
            assert [site["id"] for site in published_sites] == ["reference"]
            assert json.loads((data_dir / "previous-release.json").read_text(encoding="utf-8")) == {"keep": "preserve"}
        finally:
            globals().update(saved)

    print("selftest: PASS (safe staging plus explicit reference-only build path)")
    return 0


def validate_outputs(targets: list[dict[str, Any]], sites: list[dict[str, Any]], evidence: dict[str, Any],
                     candidate_ids: set[str] = frozenset()) -> None:
    validate_unique_ids(targets, sites)
    validate_output_shapes(targets, sites)
    expected_ids = {row["id"] for row in read_json(SITES_PATH)["lunar"] + read_json(SITES_PATH)["mars"]}
    expected_ids |= {row["id"] for row in read_json(SITES_PATH)["earth"]}
    expected_ids |= set(candidate_ids)
    actual_ids = {row["id"] for row in targets + sites}
    if actual_ids != expected_ids:
        raise ValueError(f"app output ID mismatch: expected {sorted(expected_ids)}, got {sorted(actual_ids)}")
    def check(value: Any, path: str = "$") -> None:
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError(f"non-finite number at {path}")
        if isinstance(value, dict):
            for key, child in value.items():
                check(child, f"{path}.{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                check(child, f"{path}[{index}]")
    check(targets, "targets")
    check(sites, "sites")
    check(evidence, "evidence")
    if len(evidence["cited"]["rows"]) != 4:
        raise ValueError("expected the four cited LuMon rows")


if __name__ == "__main__":
    raise SystemExit(main())
