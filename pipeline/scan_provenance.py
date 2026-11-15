#!/usr/bin/env python3
"""Schema and offline replay helpers for issue #58 candidate-scan evidence."""
from __future__ import annotations

import hashlib
import json
import platform
import subprocess
import sys
from importlib import metadata
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_VERSION = 1


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def object_sha256(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def display_path(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return path.name


def _git_identity() -> dict[str, Any]:
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, check=True, capture_output=True, text=True,
        ).stdout.strip()
        dirty = bool(subprocess.run(
            ["git", "status", "--porcelain"], cwd=ROOT, check=True, capture_output=True, text=True,
        ).stdout.strip())
        return {"commit": commit, "working_tree_dirty": dirty}
    except (OSError, subprocess.CalledProcessError):
        return {"commit": None, "working_tree_dirty": None}


def _package_versions() -> dict[str, str | None]:
    packages = ("numpy", "rasterio", "pyproj", "affine", "PyYAML", "requests")
    versions: dict[str, str | None] = {}
    for package in packages:
        try:
            versions[package] = metadata.version(package)
        except metadata.PackageNotFoundError:
            versions[package] = None
    try:
        import rasterio
        versions["GDAL"] = rasterio.__gdal_version__
    except ImportError:
        versions["GDAL"] = None
    return versions


def make_run_record(
    *,
    weights_path: Path,
    targets_path: Path,
    sites_path: Path,
    app_sites_path: Path,
    regions_path: Path,
    tile_paths: list[Path],
    weights: dict[str, Any],
    targets: list[dict[str, Any]],
    known_sites: list[dict[str, Any]],
    app_sites: list[dict[str, Any]],
    work_res_m: float,
    buffer_cells: int,
) -> dict[str, Any]:
    """Create run provenance; DEM fingerprints are explicit opt-in I/O."""
    input_tiles = []
    for path in tile_paths:
        input_tiles.append({
            "path": display_path(path),
            "size_bytes": path.stat().st_size,
            "sha256": file_sha256(path),
        })
    target_descriptors = [
        {
            "id": target["id"],
            "name": target.get("name"),
            "body": target.get("body"),
            "lat": target.get("lat"),
            "lon": target.get("lon"),
            "params": {key: {"value": target.get("params", {}).get(key, {}).get("value")}
                       for key in ("slope_mean_deg", "slope_p90_deg", "roughness_m")},
            "windows": target.get("windows"),
        }
        for target in targets
    ]
    code_paths = [ROOT / "pipeline" / name for name in ("scan.py", "terrain.py", "landcover.py", "scan_provenance.py")]
    code = {display_path(path): file_sha256(path) for path in code_paths if path.is_file()}
    region = {
        "path": display_path(regions_path),
        "exists": regions_path.is_file(),
        "sha256": file_sha256(regions_path) if regions_path.is_file() else None,
    }
    return {
        "schema_version": SCHEMA_VERSION,
        "run_status": "running",
        "producer": {
            "git": _git_identity(),
            "code_sha256": code,
            "python": sys.version,
            "platform": platform.platform(),
            "package_versions": _package_versions(),
        },
        "inputs": {
            "dem_tiles": input_tiles,
            "config": {
                "path": display_path(weights_path),
                "sha256": file_sha256(weights_path),
                "effective": weights,
            },
            "targets": {
                "path": display_path(targets_path),
                "sha256": file_sha256(targets_path),
                "order": target_descriptors,
            },
            "known_sites": {
                "path": display_path(sites_path),
                "sha256": file_sha256(sites_path),
                "earth": [{key: site[key] for key in ("id", "name", "lat", "lon")}
                          for site in known_sites],
            },
            "baseline_app_candidates": {
                "path": display_path(app_sites_path),
                "sha256": file_sha256(app_sites_path),
                "candidates": [
                    {"id": site["id"], "lat": site["lat"], "lon": site["lon"]}
                    for site in app_sites if site.get("id", "").startswith("cand_")
                ],
            },
            "scan_regions": region,
            "grid": {
                "work_resolution_m": work_res_m,
                "buffer_cells": buffer_cells,
                "main_window_km": float(weights["main_window_km"]),
                "grid_km": float(weights["scan"]["grid_km"]),
                "edge_margin_km": float(weights["scan"]["edge_margin_km"]),
            },
        },
        "window_records": [],
        "scan_counts": None,
        "selection": {
            "status": "not-started",
            "target_order": [target["id"] for target in targets],
            "events": [],
            "lookup_order": [],
            "worldcover": {},
            "selected_window_ids": [],
        },
        "final_publication": {"status": "not-run"},
    }


def window_id(tile: str, lat: float, lon: float) -> str:
    return f"{tile}@{lat:.5f},{lon:.5f}"


def reconcile_scan_counts(records: list[dict[str, Any]], counts: dict[str, int]) -> dict[str, Any]:
    reason_to_count = {
        "missing_terrain_descriptor": "gaps",
        "below_sea_share_limit": "below_sea",
        "flat_share_limit_or_missing": "water",
        "within_known_site_exclusion_distance": "near_known",
        "passed_scan_filters": "kept",
    }
    observed = {key: 0 for key in reason_to_count.values()}
    unknown_reasons = []
    for record in records:
        reason = record.get("reason")
        count_key = reason_to_count.get(reason)
        if count_key is None:
            unknown_reasons.append({"window_id": record.get("window_id"), "reason": reason})
        else:
            observed[count_key] += 1
    mismatches = {
        key: {"recorded": observed[key], "scan_count": counts.get(key)}
        for key in observed if observed[key] != counts.get(key)
    }
    if len(records) != counts.get("windows"):
        mismatches["windows"] = {"recorded": len(records), "scan_count": counts.get("windows")}
    return {
        "matches": not mismatches and not unknown_reasons,
        "observed": observed,
        "mismatches": mismatches,
        "unknown_reasons": unknown_reasons,
    }


class ReplayPrerequisiteError(RuntimeError):
    """Raised when a replay requests evidence not contained in its run record."""


def replay_selection(document: dict[str, Any]) -> dict[str, Any]:
    """Rerun scan.select against recorded descriptors and cached WorldCover rows only."""
    if document.get("schema_version") != SCHEMA_VERSION:
        raise ReplayPrerequisiteError(f"unsupported provenance schema: {document.get('schema_version')!r}")
    selection = document.get("selection") or {}
    if selection.get("status") != "complete":
        return {
            "status": "incomplete-evidence",
            "reason": "selection replay requires a completed selection trace",
            "selection_status": selection.get("status"),
            "run_status": document.get("run_status"),
            "failure": document.get("failure"),
        }
    worldcover = selection.get("worldcover") or {}
    error_keys = sorted(key for key, row in worldcover.items() if row.get("status") == "error")
    if error_keys:
        return {
            "status": "incomplete-evidence",
            "reason": "the original scan stopped on a WorldCover lookup error",
            "lookup_keys": error_keys,
        }

    from scan import select

    rows = [row["descriptor"] for row in document.get("window_records", []) if row.get("stage_outcome") == "eligible"]
    targets = document["inputs"]["targets"]["order"]
    weights = document["inputs"]["config"]["effective"]
    replay_trace: dict[str, Any] = {"events": [], "lookup_order": [], "worldcover": {}}

    def cached_lookup(lat: float, lon: float) -> dict[str, Any]:
        key = f"{lat:.5f},{lon:.5f}"
        entry = worldcover.get(key)
        if entry is None:
            raise ReplayPrerequisiteError(f"missing cached WorldCover response for {key}")
        if entry.get("status") not in ("success", "unavailable"):
            raise ReplayPrerequisiteError(f"WorldCover response for {key} is not replayable: {entry.get('status')!r}")
        if object_sha256(entry.get("response")) != entry.get("response_sha256"):
            raise ReplayPrerequisiteError(f"cached WorldCover response fingerprint does not match for {key}")
        return entry["response"]

    try:
        picked = select(rows, targets, weights["params"], weights["scan"], cached_lookup, trace=replay_trace)
    except ReplayPrerequisiteError as exc:
        return {"status": "missing-prerequisite", "reason": str(exc)}
    actual_ids = [window_id(row.get("tile", "unknown"), row["lat"], row["lon"]) for row in picked]
    expected_ids = selection.get("selected_window_ids")
    replay_matches = {
        "selected_window_ids": actual_ids == expected_ids,
        "events": replay_trace["events"] == selection.get("events"),
        "lookup_order": replay_trace["lookup_order"] == selection.get("lookup_order"),
        "worldcover_responses": replay_trace["worldcover"] == worldcover,
        "target_order": replay_trace["target_order"] == selection.get("target_order"),
    }
    matches = all(replay_matches.values())
    actual_locations = [
        {"window_id": window_id(row.get("tile", "unknown"), row["lat"], row["lon"]),
         "lat": row["lat"], "lon": row["lon"]}
        for row in picked
    ]
    catalog_rows = document.get("inputs", {}).get("baseline_app_candidates", {}).get("candidates", [])
    current_locations: dict[tuple[float, float], list[str]] = {}
    for row in catalog_rows:
        current_locations.setdefault((round(row["lat"], 5), round(row["lon"], 5)), []).append(row["id"])
    selected_locations = {(round(row["lat"], 5), round(row["lon"], 5)): row["window_id"] for row in actual_locations}
    overlap = set(selected_locations) & set(current_locations)
    return {
        "status": "matched" if matches else "mismatch",
        "run_status": document.get("run_status"),
        "expected_selected_window_ids": expected_ids,
        "replayed_selected_window_ids": actual_ids,
        "replay_checks": replay_matches,
        "replayed_selected_locations": actual_locations,
        "baseline_app_candidate_comparison": {
            "matched_location_count": len(overlap),
            "replayed_selection_count": len(selected_locations),
            "baseline_app_candidate_count": len(catalog_rows),
            "selected_not_in_baseline_app": [
                selected_locations[location] for location in sorted(set(selected_locations) - set(current_locations))
            ],
            "baseline_app_not_selected": [
                site_id for location, site_ids in sorted(current_locations.items())
                if location not in selected_locations for site_id in site_ids
            ],
            "identity_rule": "latitude/longitude rounded to the scanner's 5-decimal window-center precision",
        },
        "replay_trace": replay_trace,
    }


def selftest_replay() -> None:
    from scan import PARAM_KEYS, select

    params = {key: {"weight": 1.0, "range": 10.0} for key in PARAM_KEYS}
    def values(value: float) -> dict[str, float]:
        return {key: value for key in PARAM_KEYS}
    target_zero = {"id": "target-zero", "params": {key: {"value": 0.0} for key in PARAM_KEYS}}
    target_ten = {"id": "target-ten", "params": {key: {"value": 10.0} for key in PARAM_KEYS}}
    rows = [
        {"tile": "N00E000.hgt", "lat": 0.0, "lon": 0.0, "region": "r0", **values(0.0)},
        {"tile": "N00E000.hgt", "lat": 0.05, "lon": 0.0, "region": "r1", **values(10.0)},
    ]
    scan = {
        "per_target": 1, "shortlist_max": 10, "min_spacing_km": 20.0,
        "max_per_region": 3, "min_bare_share": 0.5, "min_land_share": 0.9,
    }
    available = {"value": 0.9, "counts": {"land": 100, "total": 100}}
    trace: dict[str, Any] = {"events": [], "lookup_order": [], "worldcover": {}}
    original = select(rows, [target_zero, target_ten], params, scan,
                      lambda _lat, _lon: available, trace=trace)
    trace["status"] = "complete"
    assert len(trace["lookup_order"]) == 1, "a selected location should be reused, not looked up twice"
    assert any(event.get("worldcover_status") == "not_attempted" for event in trace["events"])
    reversed_trace: dict[str, Any] = {"events": [], "lookup_order": [], "worldcover": {}}
    reversed_order = select(rows, [target_ten, target_zero], params, scan,
                            lambda _lat, _lon: available, trace=reversed_trace)
    assert [window_id(row["tile"], row["lat"], row["lon"]) for row in original] != [
        window_id(row["tile"], row["lat"], row["lon"]) for row in reversed_order
    ], "target order must remain observable because greedy spacing is order-dependent"

    run = {
        "schema_version": SCHEMA_VERSION,
        "run_status": "complete",
        "inputs": {
            "config": {"effective": {"main_window_km": 6, "params": params, "scan": scan}},
            "targets": {"order": [target_zero, target_ten]},
            "baseline_app_candidates": {"candidates": [
                {"id": "cand_existing_match", "lat": 0.0, "lon": 0.0},
                {"id": "cand_existing_other", "lat": 10.0, "lon": 10.0},
            ]},
        },
        "window_records": [{
            "stage_outcome": "eligible",
            "window_id": window_id(row["tile"], row["lat"], row["lon"]),
            "descriptor": row,
        } for row in rows],
        "selection": trace,
    }
    replay = replay_selection(run)
    assert replay["status"] == "matched", replay
    assert replay["replayed_selected_window_ids"] == trace["selected_window_ids"]
    assert replay["baseline_app_candidate_comparison"]["matched_location_count"] == 1
    assert replay["baseline_app_candidate_comparison"]["baseline_app_not_selected"] == ["cand_existing_other"]

    missing_cache_run = json.loads(json.dumps(run))
    missing_cache_run["selection"]["worldcover"] = {}
    missing_cache = replay_selection(missing_cache_run)
    assert missing_cache["status"] == "missing-prerequisite", missing_cache

    failed_lookup_run = json.loads(json.dumps(run))
    failed_lookup_run["selection"]["worldcover"] = {"0.00000,0.00000": {"status": "error"}}
    failed_lookup = replay_selection(failed_lookup_run)
    assert failed_lookup["status"] == "incomplete-evidence", failed_lookup

    limited_trace: dict[str, Any] = {"events": [], "lookup_order": [], "worldcover": {}}
    limited_scan = {**scan, "per_target": 5, "shortlist_max": 1}
    select(rows, [target_zero], params, limited_scan, lambda _lat, _lon: available, trace=limited_trace)
    assert any(event.get("decision") == "not_considered_shortlist_limit" and
               event.get("worldcover_status") == "not_attempted" for event in limited_trace["events"])

    unavailable_trace: dict[str, Any] = {"events": [], "lookup_order": [], "worldcover": {}}
    select([rows[0]], [target_zero], params, scan,
           lambda _lat, _lon: {"value": None, "tiles": [], "tiles_absent": ["N00E000"]},
           trace=unavailable_trace)
    assert next(iter(unavailable_trace["worldcover"].values()))["status"] == "unavailable"

    error_trace: dict[str, Any] = {"events": [], "lookup_order": [], "worldcover": {}}
    try:
        select([rows[0]], [target_zero], params, scan,
               lambda _lat, _lon: (_ for _ in ()).throw(TimeoutError()), trace=error_trace)
    except TimeoutError:
        pass
    else:
        raise AssertionError("lookup error must preserve current fail-fast behavior")
    assert next(iter(error_trace["worldcover"].values()))["status"] == "error"


def selftest() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        tile = root / "tile.hgt"
        tile.write_bytes(b"synthetic tile bytes")
        weights_path = root / "weights.yaml"
        weights_path.write_text("main_window_km: 6\n", encoding="utf-8")
        targets_path = root / "targets.json"
        targets_path.write_text("[]\n", encoding="utf-8")
        missing_regions = root / "regions.json"
        record = make_run_record(
            weights_path=weights_path, targets_path=targets_path, sites_path=targets_path,
            app_sites_path=targets_path,
            regions_path=missing_regions,
            tile_paths=[], weights={"main_window_km": 6, "scan": {"grid_km": 6, "edge_margin_km": 7}},
            targets=[], known_sites=[], app_sites=[], work_res_m=30, buffer_cells=4,
        )
        assert record["run_status"] == "running"
        assert record["inputs"]["scan_regions"] == {
            "path": missing_regions.name, "exists": False, "sha256": None,
        }
        assert len(file_sha256(tile)) == 64
        assert object_sha256({"b": 2, "a": 1}) == object_sha256({"a": 1, "b": 2})
    selftest_replay()
    reconciliation = reconcile_scan_counts([
        {"reason": "missing_terrain_descriptor"},
        {"reason": "below_sea_share_limit"},
        {"reason": "flat_share_limit_or_missing"},
        {"reason": "within_known_site_exclusion_distance"},
        {"reason": "passed_scan_filters"},
    ], {"windows": 5, "gaps": 1, "below_sea": 1, "water": 1, "near_known": 1, "kept": 1})
    assert reconciliation["matches"], reconciliation
    print("selftest: PASS (run fingerprint schema, optional region file, deterministic object digest)")


if __name__ == "__main__":
    selftest()
