#!/usr/bin/env python3
"""Bounded, offline reader follow-up for #57; NEVER publishes app data.

Compare actual scan output, same-footprint full/crop warps, and the final
largest-window-to-main-window route. Exact/unit-scale warps are causal controls,
not an accepted replacement resampling method. See docs/terrain-reader-followup.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))

import scan  # noqa: E402
import terrain  # noqa: E402
import terrain_reader_diagnostic as previous  # noqa: E402

OUT = ROOT / "results" / "terrain-reader-followup.json"
CASE_IDS = ("mauna_kea", "etna", "yungay", "askja", "cand_mauna_kea_1", "cand_askja_2", "cand_afar_1")
# Named interventions, not tunable scientific defaults. Zero requests the exact
# transformer; one is the identity resampling scale. Neither changes production.
MODES = {
    "legacy_auto": {},
    "exact_auto": {"tolerance": 0.0},
    "default_transform_unit_kernel": {"XSCALE": 1.0, "YSCALE": 1.0},
    "exact_unit_kernel": {"tolerance": 0.0, "XSCALE": 1.0, "YSCALE": 1.0},
}


def fingerprints(paths):
    result = {}
    for path in sorted(set(paths)):
        with path.open("rb") as stream:
            result[str(path.relative_to(ROOT))] = hashlib.file_digest(stream, "sha256").hexdigest()
    return result


def protected_fingerprints():
    return fingerprints(p for directory in ("data/raw", "config", "frontend/public/data", "frontend/public/img")
                        for p in (ROOT / directory).rglob("*") if p.is_file())


def crop_source(source, transform, source_crs, dst_transform, dst_crs, width, height):
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds

    bounds = transform_bounds(dst_crs, source_crs, *terrain.dst_bounds(dst_transform, width, height))
    win = from_bounds(*bounds, transform)
    # Same existing source margin as scan_tile, not a newly tuned crop size.
    margin = terrain.BUFFER_CELLS
    r0, c0 = max(math.floor(win.row_off) - margin, 0), max(math.floor(win.col_off) - margin, 0)
    r1 = min(math.ceil(win.row_off + win.height) + margin, source.shape[0])
    c1 = min(math.ceil(win.col_off + win.width) + margin, source.shape[1])
    return source[r0:r1, c0:c1], transform * transform.translation(c0, r0)


def warp(source, transform, source_crs, grid, *, cropped, options):
    from rasterio.enums import Resampling
    from rasterio.warp import reproject

    dt, width, height, dc, _ = grid
    if cropped:
        source, transform = crop_source(source, transform, source_crs, dt, dc, width, height)
    dst = np.full((height, width), np.nan, dtype="float32")
    reproject(source=source, destination=dst, src_transform=transform, src_crs=source_crs,
              dst_transform=dt, dst_crs=dc, resampling=Resampling.bilinear,
              src_nodata=np.nan, dst_nodata=np.nan, **options)
    return dst


def direct_reference(source, transform, source_crs, grid):
    """Four-source-pixel point bilinear reference, only on complete neighborhoods.

    This is a reference for the UNIT kernel control, not GDAL's automatically
    widened downsampling kernel. Invalid/edge neighborhoods are not filled.
    """
    from rasterio.warp import transform as project

    dt, width, height, dc, _ = grid
    rows, cols = np.indices((height, width))
    xs = dt.c + (cols.ravel() + 0.5) * dt.a
    ys = dt.f + (rows.ravel() + 0.5) * dt.e
    sx, sy = project(dc, source_crs, xs.tolist(), ys.tolist())
    inv = ~transform
    px = inv.a * np.asarray(sx) + inv.b * np.asarray(sy) + inv.c - 0.5
    py = inv.d * np.asarray(sx) + inv.e * np.asarray(sy) + inv.f - 0.5
    c, r = np.floor(px).astype("int64"), np.floor(py).astype("int64")
    eligible = (c >= 0) & (r >= 0) & (c + 1 < source.shape[1]) & (r + 1 < source.shape[0])
    ix = np.flatnonzero(eligible)
    z = np.stack((source[r[ix], c[ix]], source[r[ix], c[ix] + 1],
                  source[r[ix] + 1, c[ix]], source[r[ix] + 1, c[ix] + 1])).astype("float64")
    ix, z = ix[np.isfinite(z).all(axis=0)], z[:, np.isfinite(z).all(axis=0)]
    dx, dy = px[ix] - c[ix], py[ix] - r[ix]
    out = np.full(width * height, np.nan, dtype="float64")
    out[ix] = z[0] * (1 - dx) * (1 - dy) + z[1] * dx * (1 - dy) + z[2] * (1 - dx) * dy + z[3] * dx * dy
    # Numerical comparison budget, not a scientific acceptance threshold:
    # Float64 weights/products/additions, then a float32 warp output. One full
    # float32 epsilon dominates the double-precision arithmetic allowance.
    # The 4-neighbor absolute amplitude bounds cancellation. Spatial transform
    # error is not covered by this roundoff-only comparison budget.
    budget = np.full(width * height, np.nan, dtype="float64")
    budget[ix] = (np.finfo("float32").eps + 16 * np.finfo("float64").eps) * np.max(np.abs(z), axis=0)
    return out.reshape(height, width), budget.reshape(height, width)


def reference_comparison(reference, actual, budget):
    common = np.isfinite(reference) & np.isfinite(actual)
    errors = np.abs(reference[common] - actual[common].astype("float64"))
    return {
        "reference_supported_cells": int(np.isfinite(reference).sum()),
        "common_cells": int(common.sum()),
        "reference_supported_but_warp_missing": int((np.isfinite(reference) & ~np.isfinite(actual)).sum()),
        "warp_valid_but_reference_unsupported": int((~np.isfinite(reference) & np.isfinite(actual)).sum()),
        "max_absolute_error_m": float(errors.max()) if errors.size else None,
        "mean_absolute_error_m": float(errors.mean()) if errors.size else None,
        "max_float32_roundoff_budget_m": float(budget[common].max()) if errors.size else None,
        "cells_exceeding_roundoff_budget": int((errors > budget[common]).sum()),
    }


def main_subarray(largest, main_grid):
    # Retain the main window's buffer too, so neighborhood operations agree.
    h, w = main_grid[2], main_grid[1]
    row, col = (largest.shape[0] - h) // 2, (largest.shape[1] - w) // 2
    return largest[row:row + h, col:col + w]


def summarize_main(z):
    return previous._descriptors(z)


def main_from_largest(z, sizes, main_km, *, square=True):
    # Descriptors computed BEFORE cropping. The legacy row-only operation is
    # retained here solely to measure the defect without restoring old code.
    slope, rough = terrain.slope_and_roughness(z)
    center = slice(terrain.BUFFER_CELLS, z.shape[0] - terrain.BUFFER_CELLS)
    s = terrain.crop_slice(center, main_km, max(sizes))
    box = (s, s) if square else s
    stats = terrain.summarize(z[box], np.isfinite(z[box]), slope[box], rough[box])
    return {key: stats[key] for key in scan.PARAM_KEYS} | {
        "valid_cells": stats["cells"], "slope_cells": stats["slope_cells"],
    }


def missing_tile_tokens(paths, lat, lon, km):
    """An existing half-mosaic must not count as complete source support."""
    from rasterio.crs import CRS
    from rasterio.warp import transform_bounds

    grid = terrain.analysis_grid(km, lat, lon, scan.EARTH_RADIUS_M)
    west, south, east, north = transform_bounds(
        grid[3], CRS.from_epsg(4326), *terrain.dst_bounds(grid[0], grid[1], grid[2]))
    style = "copernicus" if abs(lat) > 60 and not terrain._has_files(terrain.ASTER_DIR) else "srtm"
    tokens = [token for la in range(math.floor(south), math.ceil(north))
              for lo in range(math.floor(west), math.ceil(east))
              for token in terrain._tile_tokens(la, lo, style)]
    return [token for token in tokens if not any(token.upper() in p.name.upper() for p in paths)]


def footprint_geometry(sizes):
    largest_side = terrain.window_cells(max(sizes)) + 2 * terrain.BUFFER_CELLS
    return {str(int(km)): {
        "legacy_shape": [terrain.window_cells(km), largest_side],
        "square_shape": [terrain.window_cells(km)] * 2,
        "legacy_cells": terrain.window_cells(km) * largest_side,
        "square_cells": terrain.window_cells(km) ** 2,
    } for km in sizes}


def reference_footprint_impact(sizes):
    """Shadow summaries on local reference inputs only; no result/app writes.

    Measure the square-crop fix with the SAME largest raster, separating it from
    all warp interventions above. Also includes lunar references because they
    share build_row; Jezero has its own already-two-axis implementation.
    """
    manifest = json.loads((ROOT / "config/sites.json").read_text())
    shipped = {r["id"]: r for r in json.loads((ROOT / "results/terrain.json").read_text())}
    rows, used = [], set()
    located = {}
    for target in manifest["lunar"]:
        if target["lat"] is None:
            located[target["id"]] = terrain.locate_malapert(terrain.open_lola())
    for body, cases in (("earth", manifest["earth"]), ("moon", manifest["lunar"])):
        for case in cases:
            lat, lon = case["lat"], case["lon"]
            if lat is None:
                lat, lon, _ = located[case["id"]]
            if body == "earth":
                paths = previous._reader_tiles(lat, lon, max(sizes))
                missing = missing_tile_tokens(paths, lat, lon, max(sizes))
                if missing:
                    rows.append({"id": case["id"], "body": body, "status": "missing_local_source", "missing": missing})
                    continue
                used.update(paths)
                z, valid, center, source = terrain.read_earth_window(lat, lon, max(sizes))
            else:
                z, valid, center = terrain.read_lola_window(lat, lon, max(sizes))
                source = "LOLA ldem_85s_20m (existing local raw input)"
            corrected = terrain.build_row(
                {"id": case["id"]}, source, terrain.WORK_RES_M, sizes, lambda km: (z, valid, center))
            slope, rough = terrain.slope_and_roughness(z)
            windows = {}
            for km in sizes:
                s = terrain.crop_slice(center, km, max(sizes))
                old = terrain.summarize(z[s], valid[s], slope[s], rough[s])
                new = terrain.summarize(z[s, s], valid[s, s], slope[s, s], rough[s, s])
                assert corrected["windows"][str(int(km))] == {key: new[key] for key in scan.PARAM_KEYS}
                windows[str(int(km))] = {
                    "legacy_cells": old["cells"], "square_cells": new["cells"],
                    "legacy_recomputed": {key: old[key] for key in scan.PARAM_KEYS},
                    "square_recomputed": {key: new[key] for key in scan.PARAM_KEYS},
                    "recorded_terrain": shipped[case["id"]]["windows"][str(int(km))],
                    "recorded_matches_legacy_recomputation": shipped[case["id"]]["windows"][str(int(km))] == {
                        key: old[key] for key in scan.PARAM_KEYS
                    },
                }
            rows.append({"id": case["id"], "body": body, "status": "compared", "source": source,
                         "coordinates": {"lat": lat, "lon": lon},
                         "coordinate_status": "data-driven existing LOLA search" if case["lat"] is None else (
                             "confirmed in manifest" if case.get("confirmed") else "approximate manifest centre"),
                         "windows": windows})
    return rows, used


def case_run(case, sizes, main_km, source_paths):
    import rasterio

    lat, lon = case["lat"], case["lon"]
    grid = terrain.analysis_grid(main_km, lat, lon, scan.EARTH_RADIUS_M)
    largest_grid = terrain.analysis_grid(max(sizes), lat, lon, scan.EARTH_RADIUS_M)
    outputs = {mode: {key: np.full((g[2], g[1]), np.nan, dtype="float32")
                      for key, g in (("full_main", grid), ("crop_main", grid), ("full_largest", largest_grid))}
               for mode in MODES}
    tile_rows = []
    for path in source_paths:
        with rasterio.open(path) as src:
            source = np.ma.filled(src.read(1, masked=True).astype("float32"), np.nan)
            reference, budget = direct_reference(source, src.transform, src.crs, grid)
            modes = {}
            for mode, options in MODES.items():
                arrays = {}
                for key, g, cropped in (("full_main", grid, False), ("crop_main", grid, True),
                                         ("full_largest", largest_grid, False)):
                    arrays[key] = warp(source, src.transform, src.crs, g, cropped=cropped, options=options)
                    valid = np.isfinite(arrays[key])
                    # Same sorted-tile, last-valid overwrite order as production.
                    outputs[mode][key][valid] = arrays[key][valid]
                modes[mode] = {
                    "source_extent_difference": previous._difference(arrays["full_main"], arrays["crop_main"]),
                    "destination_extent_difference": previous._difference(arrays["full_main"], main_subarray(arrays["full_largest"], grid)),
                    "point_bilinear_reference_full": reference_comparison(reference, arrays["full_main"], budget),
                    "point_bilinear_reference_crop": reference_comparison(reference, arrays["crop_main"], budget),
                }
            tile_rows.append({"path": path.relative_to(ROOT).as_posix(), "modes": modes})

    modes = {}
    for mode, arrays in outputs.items():
        full, crop, largest = arrays["full_main"], arrays["crop_main"], arrays["full_largest"]
        modes[mode] = {
            "source_extent_difference": previous._difference(full, crop),
            "scan_main_vs_final_largest_pixels": previous._difference(crop, main_subarray(largest, grid)),
            "scan_style_descriptors": summarize_main(crop),
            "square_final_style_descriptors": main_from_largest(largest, sizes, main_km),
            "legacy_row_only_final_descriptors": main_from_largest(largest, sizes, main_km, square=False),
            "descriptor_difference": previous._descriptor_delta(main_from_largest(largest, sizes, main_km), summarize_main(crop)),
        }

    actual, _, _, _ = terrain.read_earth_window(lat, lon, main_km)
    actual_row = terrain.build_row(
        {"id": case["id"]}, None, terrain.WORK_RES_M, sizes,
        lambda km: terrain.read_earth_window(lat, lon, km)[:3],
    )
    # Do not silently label a reconstructed warp as the actual production path.
    actual_delta = previous._difference(actual, outputs["legacy_auto"]["full_main"])
    assert actual_delta["reference_only_cells"] == actual_delta["comparison_only_cells"] == 0
    assert actual_delta["absolute_elevation_difference_m"]["max"] == 0
    assert actual_row["windows"][str(int(main_km))] == {
        key: modes["legacy_auto"]["square_final_style_descriptors"][key] for key in scan.PARAM_KEYS
    }

    scan_stats = None
    if case.get("scan_tile"):
        path = next(p for p in source_paths if p.name == case["scan_tile"])
        parsed = scan.parse_tile(path)
        import yaml
        scan_config = yaml.safe_load((ROOT / "config/weights.yaml").read_text())["scan"]
        scan_stats = next(stats for la, lo, stats in scan.scan_tile(path, parsed[0], parsed[1], scan_config, main_km)
                          if la == lat and lo == lon)
        assert all(scan_stats[key] == modes["legacy_auto"]["scan_style_descriptors"][key] for key in scan.PARAM_KEYS)

    return {
        "id": case["id"], "status": "compared", "coordinates": {"lat": lat, "lon": lon},
        "coordinate_status": case.get("coordinate_status"),
        "main_grid": {"shape": [grid[2], grid[1]], "transform": list(grid[0])[:6], "crs": grid[3].to_string()},
        "largest_grid": {"shape": [largest_grid[2], largest_grid[1]], "transform": list(largest_grid[0])[:6]},
        "production_reader_reconstruction": actual_delta,
        "production_build_row_main": actual_row["windows"][str(int(main_km))],
        "actual_scan_tile_descriptors": None if scan_stats is None else {key: scan_stats[key] for key in scan.PARAM_KEYS},
        "modes": modes, "per_tile": tile_rows,
    }


def run():
    import rasterio
    import yaml

    before = protected_fingerprints()
    weights = yaml.safe_load((ROOT / "config/weights.yaml").read_text())
    sizes, main_km = weights["window_sizes_km"], weights["main_window_km"]
    sites = {s["id"]: s for s in json.loads((ROOT / "frontend/public/data/sites.json").read_text())}
    manifest = {s["id"]: s for s in json.loads((ROOT / "config/sites.json").read_text())["earth"]}
    cases = []
    for ident in CASE_IDS:
        site = sites[ident]
        cases.append({"id": ident, "lat": site["lat"], "lon": site["lon"],
                      "coordinate_status": ("approximate manifest centre" if not manifest.get(ident, {}).get("confirmed")
                                            else "confirmed in manifest") if ident in manifest else "scan centre, not field-checked"})
    mauna = manifest["mauna_kea"]
    lat, lon = min(scan.tile_centres(19, -156, weights["scan"]["grid_km"], weights["scan"]["edge_margin_km"]),
                   key=lambda point: scan.haversine_km(*point, mauna["lat"], mauna["lon"]))
    cases.append({"id": "srtm_scan_grid_control", "lat": lat, "lon": lon,
                  "coordinate_status": "generated by existing scan tile_centres", "scan_tile": "N19W156.hgt"})
    rows, used = [], set()
    for case in cases:
        paths = previous._reader_tiles(case["lat"], case["lon"], max(sizes))
        # Reject incomplete tile support instead of comparing a partial mosaic.
        missing = missing_tile_tokens(paths, case["lat"], case["lon"], max(sizes))
        if missing:
            rows.append({"id": case["id"], "status": "missing_local_source", "missing_tiles": missing,
                         "coordinates": {"lat": case["lat"], "lon": case["lon"]}})
            continue
        used.update(paths)
        row = case_run(case, sizes, main_km, paths)
        rows.append(row)
        print(f"{case['id']}: compared", flush=True)
    targets = json.loads((ROOT / "frontend/public/data/targets.json").read_text())
    params = json.loads((ROOT / "frontend/public/data/config.json").read_text())["params"]
    for row in rows:
        if row["status"] != "compared":
            continue
        row["per_target_scores"] = {}
        for target in targets:
            tp = {key: target["params"][key]["value"] for key in scan.PARAM_KEYS}
            scores = {mode: {stage: scan.terrain_match(row["modes"][mode][stage], tp, params)
                             for stage in ("scan_style_descriptors", "square_final_style_descriptors", "legacy_row_only_final_descriptors")} for mode in MODES}
            row["per_target_scores"][target["id"]] = scores
    reference_impact, reference_paths = reference_footprint_impact(sizes)
    used.update(reference_paths)
    after = protected_fingerprints()
    if before != after:
        raise RuntimeError("Protected source/config/public files changed during the diagnostic; report not accepted")
    return {
        "issue": 57, "status": "research_only_public_data_unchanged",
        "decision": "square-crop producer bug fixed; kernel-scale mechanism isolated in tested cases; replacement resampling contract and data publication are not approved",
        "inputs": {"python": platform.python_version(), "numpy": np.__version__, "rasterio": rasterio.__version__,
                   "gdal": rasterio.__gdal_version__, "main_window_km": main_km, "window_sizes_km": sizes,
                   "source_metadata": previous._metadata(sorted(used)),
                   "lola_raw_contract": {
                       "path": (terrain.RAW_DIR / terrain.LOLA_NAME).relative_to(ROOT).as_posix(),
                       "metadata_basis": "existing pipeline/terrain.py contract and PDS label description in docs/REFERENCES.md; raw IMG has no local label",
                       "shape": [terrain.LOLA_SIZE] * 2, "dtype": "<f4",
                       "native_cell_m": terrain.LOLA_CELL_M,
                       "native_value_unit": "km", "conversion_to_m": terrain.LOLA_KM_TO_M,
                       "reference_sphere_radius_m": terrain.MOON_RADIUS_M,
                       "projection": "spherical south-polar stereographic, central meridian 0, true at pole",
                       "nodata_code": None, "mask_rule": "nonfinite samples invalid, existing reader unchanged",
                   },
                   "code_config_sha256": fingerprints([ROOT / p for p in (
                       "pipeline/terrain.py", "pipeline/scan.py", "pipeline/terrain_reader_diagnostic.py",
                        "pipeline/terrain_reader_followup.py", "pipeline/test_terrain_windows.py", "uv.lock",
                        "results/terrain.json", "config/sites.json", "config/weights.yaml",
                       "frontend/public/data/targets.json", "frontend/public/data/config.json", "frontend/public/data/sites.json")])},
        "interventions": MODES, "cases": rows,
        "footprint_geometry": footprint_geometry(sizes),
        "reference_footprint_impact": reference_impact,
        "score_comparison_target_basis": "frozen published targets; per-case sensitivity only, not a coherent migrated catalog or ranking",
        "protected_files": {"count": len(before), "unchanged_during_run": before == after,
                            "sha256": before,
                            "fingerprints_sha256": hashlib.sha256(json.dumps(before, sort_keys=True).encode()).hexdigest()},
        "limitations": [
            "No full rescan, selection replay, WorldCover lookups or whole-catalog rank-impact assessment was run.",
            "A unit bilinear kernel is a causal control, not an approved substitute for GDAL's scale-aware downsampling.",
            "The point-bilinear reference only covers complete four-pixel source neighborhoods, not nodata or tile seams.",
            "Only cached cases are assessed; Afar's required input is unavailable. No source was downloaded.",
            "Source metadata does not by itself confirm approximate coordinates or field suitability.",
        ],
    }


def selftest():
    import gc
    import tempfile
    import warnings

    from affine import Affine
    from rasterio.crs import CRS

    # Explicitly closed hash streams must not produce unclosed-file warnings.
    # The scoped synthetic file never touches an input or published artifact.
    with tempfile.TemporaryDirectory(prefix="reader-fingerprint-", dir=ROOT) as directory:
        path = Path(directory) / "synthetic.bin"
        content = b"synthetic fingerprint fixture"
        path.write_bytes(content)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always", ResourceWarning)
            actual = fingerprints([path])
            gc.collect()
        assert actual == {path.relative_to(ROOT).as_posix(): hashlib.sha256(content).hexdigest()}
        assert not any(issubclass(w.category, ResourceWarning) for w in caught)

    # Analytic plane with an interior hole; complete-neighborhood reference is
    # independent of the warp. Synthetic inputs are not scientific settings.
    rows, cols = np.indices((80, 90))
    source = (100 + cols * 2 - rows * 3).astype("float32")
    source[35:45, 40:50] = np.nan
    st = Affine(0.001, 0, 14.95, 0, -0.001, 37.8)
    crs = CRS.from_epsg(4326)
    grid = terrain.analysis_grid(2.0, 37.76, 15.0, scan.EARTH_RADIUS_M)
    full = warp(source, st, crs, grid, cropped=False, options=MODES["exact_unit_kernel"])
    crop = warp(source, st, crs, grid, cropped=True, options=MODES["exact_unit_kernel"])
    delta = previous._difference(full, crop)
    assert delta["reference_only_cells"] == delta["comparison_only_cells"] == 0
    assert delta["absolute_elevation_difference_m"]["max"] == 0
    assert np.isnan(full).any(), "nodata hole was filled"
    ref, budget = direct_reference(source, st, crs, grid)
    check = reference_comparison(ref, full, budget)
    assert check["common_cells"] > 0
    assert check["cells_exceeding_roundoff_budget"] == 0
    assert check["reference_supported_but_warp_missing"] == 0
    # Prove the comparator detects an elevation mutation and a mask mutation.
    changed = full.copy()
    index = tuple(np.argwhere(np.isfinite(ref) & np.isfinite(full))[0])
    changed[index] += 1
    assert reference_comparison(ref, changed, budget)["cells_exceeding_roundoff_budget"] > 0
    changed[index] = np.nan
    assert reference_comparison(ref, changed, budget)["reference_supported_but_warp_missing"] > 0
    # Nested grids must describe identical centers before interpreting parity.
    larger = terrain.analysis_grid(4.0, 37.76, 15.0, scan.EARTH_RADIUS_M)
    large_z = warp(source, st, crs, larger, cropped=False, options=MODES["exact_unit_kernel"])
    sub = main_subarray(large_z, grid)
    assert np.array_equal(np.isfinite(full), np.isfinite(sub))
    assert np.array_equal(full[np.isfinite(full)], sub[np.isfinite(sub)])
    assert main_from_largest(large_z, [2, 4], 2) == summarize_main(full)
    # Incomplete multi-tile support must be reported even when a tile exists.
    missing = missing_tile_tokens([Path("N37E014.hgt")], 37.722, 15.005, 6)
    assert "N37E015" in missing
    print("PASS: closed fingerprint streams, reference, crop/full, nested grids, nodata, and mutation detection")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--output", type=Path, default=OUT)
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    output = args.output.resolve()
    # Evidence destinations must not overwrite any source, input, published
    # artifact, earlier research report, or other tracked project file.
    if output != OUT.resolve() and (output == ROOT or ROOT in output.parents):
        parser.error("custom --output must be outside the checkout; the default research artifact is the only in-repo output")
    if output.suffix != ".json":
        parser.error("--output must be JSON")
    report = run()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True, allow_nan=False) + "\n")
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
