#!/usr/bin/env python3
"""Research-only comparison of cropped and full-source Earth DEM reprojection.

This diagnostic uses the current scan crop bounds and terrain final reader on
the same 6 km destination grid. It never writes app data or changes scoring.

Run with existing local inputs:
    uv run pipeline/terrain_reader_diagnostic.py
    uv run pipeline/terrain_reader_diagnostic.py --selftest
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))

import terrain  # noqa: E402
import scan  # noqa: E402

OUTPUT = ROOT / "results" / "terrain-reader-diagnostic.json"
WINDOW_KM = 6.0
CASES = (
    ("mauna_kea", "single-tile control"),
    ("etna", "tile-boundary case"),
    ("yungay", "tile-boundary case"),
)


def _reader_tiles(lat: float, lon: float, km: float) -> list[Path]:
    """Return the same source tiles selected by terrain.read_earth_window."""
    import rasterio
    from rasterio.crs import CRS
    from rasterio.warp import transform_bounds

    if abs(lat) <= 60.0:
        directory, style = terrain.SRTM_DIR, "srtm"
    elif terrain._has_files(terrain.ASTER_DIR):
        directory, style = terrain.ASTER_DIR, "srtm"
    elif terrain._has_files(terrain.COPERNICUS_DIR):
        directory, style = terrain.COPERNICUS_DIR, "copernicus"
    else:
        return []
    transform, width, height, dst_crs, _ = terrain.analysis_grid(
        km, lat, lon, 6_378_137.0
    )
    west, south, east, north = transform_bounds(
        dst_crs, CRS.from_epsg(4326), *terrain.dst_bounds(transform, width, height)
    )
    tokens: list[str] = []
    for tile_lat in range(math.floor(south), math.ceil(north)):
        for tile_lon in range(math.floor(west), math.ceil(east)):
            tokens.extend(terrain._tile_tokens(tile_lat, tile_lon, style))
    return terrain._find_tiles(directory, tokens)


def _cropped_tile_reproject(path: Path, lat: float, lon: float, km: float,
                            transformer_tolerance: float = 0.125) -> tuple[np.ndarray, dict[str, Any]]:
    """Use scan.py's source-window clipping/reprojection for one source tile."""
    import rasterio
    from rasterio.enums import Resampling

    transform, width, height, dst_crs, _ = terrain.analysis_grid(
        km, lat, lon, scan.EARTH_RADIUS_M
    )
    with rasterio.open(path) as src:
        source = np.ma.filled(src.read(1, masked=True).astype("float32"), np.nan)
        result, crop_metadata = _crop_and_warp(
            source, src.transform, src.crs, transform, dst_crs, width, height,
            transformer_tolerance=transformer_tolerance,
        )
        metadata = {
            "path": str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else path.name,
            "source_crs": src.crs.to_string(),
            "source_shape": [src.height, src.width],
            "source_dtype": src.dtypes[0],
            "source_nodata": src.nodata,
            "source_transform": list(src.transform)[:6],
            **crop_metadata,
        }
    return result, metadata


def _crop_and_warp(source, src_transform, src_crs, dst_transform, dst_crs, width, height,
                   transformer_tolerance: float = 0.125):
    """Apply scan.py's bounds transform, two-pixel source crop, and bilinear warp."""
    from rasterio.crs import CRS
    from rasterio.enums import Resampling
    from rasterio.warp import reproject, transform_bounds
    from rasterio.windows import from_bounds

    left, bottom, right, top = terrain.dst_bounds(dst_transform, width, height)
    west, south, east, north = transform_bounds(
        dst_crs, CRS.from_epsg(4326), left, bottom, right, top
    )
    window = from_bounds(west, south, east, north, src_transform)
    r0 = max(int(math.floor(window.row_off)) - 2, 0)
    c0 = max(int(math.floor(window.col_off)) - 2, 0)
    source_height, source_width = source.shape
    r1 = min(int(math.ceil(window.row_off + window.height)) + 2, source_height)
    c1 = min(int(math.ceil(window.col_off + window.width)) + 2, source_width)
    cropped = source[r0:r1, c0:c1]
    cropped_transform = src_transform * src_transform.translation(c0, r0)
    result = np.full((height, width), np.nan, dtype="float32")
    reproject(
        source=cropped,
        destination=result,
        src_transform=cropped_transform,
        src_crs=src_crs,
        dst_transform=dst_transform,
        dst_crs=dst_crs,
        resampling=Resampling.bilinear,
        src_nodata=np.nan,
        dst_nodata=np.nan,
        tolerance=transformer_tolerance,
    )
    return result, {
        "crop_shape": list(cropped.shape),
        "crop_transform": list(cropped_transform)[:6],
        "crop_bounds_in_source_pixels": [r0, c0, r1, c1],
    }


def _full_tile_reproject(path: Path, lat: float, lon: float, km: float,
                         transformer_tolerance: float = 0.125) -> np.ndarray:
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import reproject

    transform, width, height, dst_crs, _ = terrain.analysis_grid(
        km, lat, lon, scan.EARTH_RADIUS_M
    )
    with rasterio.open(path) as src:
        source = np.ma.filled(src.read(1, masked=True).astype("float32"), np.nan)
        result = np.full((height, width), np.nan, dtype="float32")
        reproject(
            source=source,
            destination=result,
            src_transform=src.transform,
            src_crs=src.crs,
            dst_transform=transform,
            dst_crs=dst_crs,
            resampling=Resampling.bilinear,
            src_nodata=np.nan,
            dst_nodata=np.nan,
            tolerance=transformer_tolerance,
        )
    return result


def _direct_bilinear_samples(path: Path, lat: float, lon: float, km: float,
                             full: np.ndarray, cropped: np.ndarray,
                             sample_count: int = 5) -> list[dict[str, Any]]:
    """Transparent bilinear interpolation at selected destination pixel centers."""
    import rasterio
    from rasterio.warp import transform

    dst_transform, width, height, dst_crs, _ = terrain.analysis_grid(
        km, lat, lon, scan.EARTH_RADIUS_M
    )
    rows, cols = np.indices((height, width))
    dst_x = dst_transform.c + (cols.ravel() + 0.5) * dst_transform.a
    dst_y = dst_transform.f + (rows.ravel() + 0.5) * dst_transform.e
    with rasterio.open(path) as src:
        src_x, src_y = transform(dst_crs, src.crs, dst_x.tolist(), dst_y.tolist())
        inverse = ~src.transform
        pixel_cols = inverse.a * np.asarray(src_x) + inverse.b * np.asarray(src_y) + inverse.c - 0.5
        pixel_rows = inverse.d * np.asarray(src_x) + inverse.e * np.asarray(src_y) + inverse.f - 0.5
        c0 = np.floor(pixel_cols).astype("int64")
        r0 = np.floor(pixel_rows).astype("int64")
        eligible = (
            (c0 >= 0) & (r0 >= 0) & (c0 + 1 < src.width) & (r0 + 1 < src.height)
            & np.isfinite(full.ravel()) & np.isfinite(cropped.ravel())
        )
        source = np.ma.filled(src.read(1, masked=True).astype("float64"), np.nan)
        eligible_indices = np.flatnonzero(eligible)
        eligible_indices = eligible_indices[
            np.isfinite(source[r0[eligible_indices], c0[eligible_indices]])
            & np.isfinite(source[r0[eligible_indices], c0[eligible_indices] + 1])
            & np.isfinite(source[r0[eligible_indices] + 1, c0[eligible_indices]])
            & np.isfinite(source[r0[eligible_indices] + 1, c0[eligible_indices] + 1])
        ]
        if not eligible_indices.size:
            return []
        chosen = eligible_indices[np.unique(np.linspace(
            0, len(eligible_indices) - 1, min(sample_count, len(eligible_indices)), dtype="int64"
        ))]
        samples = []
        for flat_index in chosen:
            rr, cc = divmod(int(flat_index), width)
            xcol, yrow = float(pixel_cols[flat_index]), float(pixel_rows[flat_index])
            x0, y0 = math.floor(xcol), math.floor(yrow)
            dx, dy = xcol - x0, yrow - y0
            z00 = source[y0, x0]
            z10 = source[y0, x0 + 1]
            z01 = source[y0 + 1, x0]
            z11 = source[y0 + 1, x0 + 1]
            direct = float(
                z00 * (1 - dx) * (1 - dy) + z10 * dx * (1 - dy)
                + z01 * (1 - dx) * dy + z11 * dx * dy
            )
            full_value = float(full[rr, cc])
            crop_value = float(cropped[rr, cc])
            samples.append({
                "destination_row_col": [rr, cc],
                "source_pixel_center_coordinates": [xcol, yrow],
                "direct_bilinear_m": direct,
                "full_tile_reproject_m": full_value,
                "cropped_tile_reproject_m": crop_value,
                "full_absolute_error_m": abs(full_value - direct),
                "crop_absolute_error_m": abs(crop_value - direct),
            })
    return samples


def _cropped_mosaic(paths: list[Path], lat: float, lon: float, km: float) -> tuple[np.ndarray, list[dict[str, Any]]]:
    transform, width, height, _, _ = terrain.analysis_grid(
        km, lat, lon, scan.EARTH_RADIUS_M
    )
    del transform
    mosaic = np.full((height, width), np.nan, dtype="float32")
    metadata = []
    for path in paths:
        sample, tile_metadata = _cropped_tile_reproject(path, lat, lon, km)
        filled = np.isfinite(sample)
        mosaic[filled] = sample[filled]
        tile_metadata["contributed_cells"] = int(filled.sum())
        metadata.append(tile_metadata)
    return mosaic, metadata


def _full_tile_mosaic(paths: list[Path], lat: float, lon: float, km: float) -> tuple[np.ndarray, list[dict[str, Any]]]:
    transform, width, height, _, _ = terrain.analysis_grid(
        km, lat, lon, scan.EARTH_RADIUS_M
    )
    del transform
    mosaic = np.full((height, width), np.nan, dtype="float32")
    metadata = []
    for path in paths:
        sample = _full_tile_reproject(path, lat, lon, km)
        filled = np.isfinite(sample)
        mosaic[filled] = sample[filled]
        cropped_default, _ = _cropped_tile_reproject(path, lat, lon, km)
        full_exact = _full_tile_reproject(path, lat, lon, km, transformer_tolerance=0.0)
        cropped_exact, _ = _cropped_tile_reproject(path, lat, lon, km, transformer_tolerance=0.0)
        metadata.append({
            "path": str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else path.name,
            "contributed_cells": int(filled.sum()),
            "direct_bilinear_reference_samples": _direct_bilinear_samples(
                path, lat, lon, km, sample, cropped_default
            ),
            "difference_full_vs_crop_default_transformer": _difference(sample, cropped_default),
            "difference_full_vs_crop_exact_transformer": _difference(full_exact, cropped_exact),
            "full_default_vs_exact_transformer": _difference(sample, full_exact),
            "crop_default_vs_exact_transformer": _difference(cropped_default, cropped_exact),
        })
    return mosaic, metadata


def _difference(reference: np.ndarray, comparison: np.ndarray) -> dict[str, Any]:
    ref_valid = np.isfinite(reference)
    cmp_valid = np.isfinite(comparison)
    common = ref_valid & cmp_valid
    delta = np.abs(reference[common].astype("float64") - comparison[common].astype("float64"))
    if not delta.size:
        return {
            "reference_valid_cells": int(ref_valid.sum()),
            "comparison_valid_cells": int(cmp_valid.sum()),
            "common_valid_cells": 0,
            "reference_only_cells": int((ref_valid & ~cmp_valid).sum()),
            "comparison_only_cells": int((cmp_valid & ~ref_valid).sum()),
            "absolute_elevation_difference_m": None,
        }
    return {
        "reference_valid_cells": int(ref_valid.sum()),
        "comparison_valid_cells": int(cmp_valid.sum()),
        "common_valid_cells": int(common.sum()),
        "reference_only_cells": int((ref_valid & ~cmp_valid).sum()),
        "comparison_only_cells": int((cmp_valid & ~ref_valid).sum()),
        "absolute_elevation_difference_m": {
            "mean": float(delta.mean()),
            "p95": float(np.percentile(delta, 95)),
            "max": float(delta.max()),
            "rmse": float(np.sqrt(np.mean(delta * delta))),
            "count_gt_0_01m": int(np.count_nonzero(delta > 0.01)),
            "count_gt_0_1m": int(np.count_nonzero(delta > 0.1)),
            "count_gt_1m": int(np.count_nonzero(delta > 1.0)),
        },
    }


def _descriptors(elevation: np.ndarray) -> dict[str, float | None]:
    center = slice(terrain.BUFFER_CELLS, elevation.shape[0] - terrain.BUFFER_CELLS)
    valid = np.isfinite(elevation)
    slope, roughness = terrain.slope_and_roughness(elevation)
    stats = terrain.summarize(
        elevation[center, center],
        valid[center, center],
        slope[center, center],
        roughness[center, center],
    )
    return {key: stats[key] for key in scan.PARAM_KEYS} | {
        "valid_cells": stats["cells"],
        "slope_cells": stats["slope_cells"],
    }


def _descriptor_delta(reference: dict[str, Any], comparison: dict[str, Any]) -> dict[str, Any]:
    result = {}
    for key in scan.PARAM_KEYS:
        left, right = reference[key], comparison[key]
        result[key] = None if left is None or right is None else {
            "reference": left,
            "comparison": right,
            "signed_difference": right - left,
            "absolute_difference": abs(right - left),
        }
    return result


def _metadata(paths: list[Path]) -> list[dict[str, Any]]:
    import rasterio

    result = []
    for path in paths:
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        with rasterio.open(path) as src:
            result.append({
                "path": str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else path.name,
                "size_bytes": path.stat().st_size,
                "sha256": digest.hexdigest(),
                "crs": src.crs.to_string(),
                "shape": [src.height, src.width],
                "dtype": src.dtypes[0],
                "nodata": src.nodata,
                "units": list(src.units),
                "mask_flags": [[flag.name for flag in band_flags] for band_flags in src.mask_flag_enums],
                "native_resolution": list(src.res),
                "transform": list(src.transform)[:6],
                "bounds": [src.bounds.left, src.bounds.bottom, src.bounds.right, src.bounds.top],
            })
    return result


def run() -> dict[str, Any]:
    import rasterio
    import yaml

    config = yaml.safe_load((ROOT / "config" / "weights.yaml").read_text())
    sites_doc = json.loads((ROOT / "frontend/public/data/sites.json").read_text())
    site_manifest = {site["id"]: site for site in json.loads((ROOT / "config/sites.json").read_text())["earth"]}
    targets = json.loads((ROOT / "frontend/public/data/targets.json").read_text())
    app_config = json.loads((ROOT / "frontend/public/data/config.json").read_text())
    target_values = {
        target["id"]: {key: target["params"][key]["value"] for key in scan.PARAM_KEYS}
        for target in targets
    }
    app_params = app_config["params"]
    results = []
    used_paths: set[Path] = set()
    case_inputs = []
    for site_id, case_kind in CASES:
        site = site_manifest[site_id]
        case_inputs.append((site_id, float(site["lat"]), float(site["lon"]), case_kind, {
            "source": "config/sites.json",
            "confirmed": site.get("confirmed", False),
        }))
    scan_config = config["scan"]
    scan_centres = scan.tile_centres(
        19, -156, float(scan_config["grid_km"]), float(scan_config["edge_margin_km"])
    )
    scan_near_mauna = min(scan_centres, key=lambda point: scan.haversine_km(
        point[0], point[1], float(site_manifest["mauna_kea"]["lat"]), float(site_manifest["mauna_kea"]["lon"])
    ))
    case_inputs.append(("srtm_single_tile_scan_window", scan_near_mauna[0], scan_near_mauna[1],
                        "single-tile scan-grid control", {
                            "source": "pipeline/scan.py tile_centres",
                            "scan_tile": "N19W156.hgt",
                            "grid_spacing_km": float(scan_config["grid_km"]),
                            "edge_margin_km": float(scan_config["edge_margin_km"]),
                            "distance_to_mauna_kea_km": scan.haversine_km(
                                scan_near_mauna[0], scan_near_mauna[1],
                                float(site_manifest["mauna_kea"]["lat"]),
                                float(site_manifest["mauna_kea"]["lon"]),
                            ),
                        }))

    for site_id, lat, lon, case_kind, coordinate_provenance in case_inputs:
        paths = _reader_tiles(lat, lon, WINDOW_KM)
        used_paths.update(paths)
        if not paths:
            results.append({"site_id": site_id, "case_kind": case_kind, "status": "missing_source_tiles"})
            continue
        final_elevation, final_valid, _, source_label = terrain.read_earth_window(lat, lon, WINDOW_KM)
        if final_elevation is None or final_valid is None:
            results.append({"site_id": site_id, "case_kind": case_kind, "status": "final_reader_unavailable"})
            continue
        cropped_elevation, crop_metadata = _cropped_mosaic(paths, lat, lon, WINDOW_KM)
        full_tile_mosaic, full_tile_metadata = _full_tile_mosaic(paths, lat, lon, WINDOW_KM)
        full_descriptor = _descriptors(final_elevation)
        cropped_descriptor = _descriptors(cropped_elevation)
        score_deltas = {}
        for target_id, target in target_values.items():
            full_score = scan.terrain_match(full_descriptor, target, app_params)
            cropped_score = scan.terrain_match(cropped_descriptor, target, app_params)
            score_deltas[target_id] = {
                "full_source_score": full_score,
                "cropped_source_score": cropped_score,
                "difference": None if full_score is None or cropped_score is None else cropped_score - full_score,
            }
        results.append({
            "site_id": site_id,
            "coordinates": {"lat": lat, "lon": lon, **coordinate_provenance},
            "case_kind": case_kind,
            "status": "compared",
            "window_km": WINDOW_KM,
            "grid": {
                "working_resolution_m": terrain.WORK_RES_M,
                "buffer_cells": terrain.BUFFER_CELLS,
                "crs": terrain.analysis_grid(WINDOW_KM, lat, lon, 6_378_137.0)[3].to_string(),
                "shape": list(final_elevation.shape),
                "affine_transform": list(terrain.analysis_grid(WINDOW_KM, lat, lon, 6_378_137.0)[0])[:6],
            },
            "source_label": source_label,
            "source_tiles": [str(path.relative_to(ROOT)) for path in paths],
            "final_full_source_read": {
                "valid_cells": int(np.isfinite(final_elevation).sum()),
                "descriptors": full_descriptor,
                "per_tile_full_source": full_tile_metadata,
                "full_tile_mosaic_matches_final_reader": _difference(final_elevation, full_tile_mosaic),
            },
            "scan_style_cropped_source_read": {
                "valid_cells": int(np.isfinite(cropped_elevation).sum()),
                "descriptors": cropped_descriptor,
                "per_tile_crop": crop_metadata,
            },
            "pixel_difference": _difference(final_elevation, cropped_elevation),
            "descriptor_difference": _descriptor_delta(full_descriptor, cropped_descriptor),
            "terrain_match_by_target": score_deltas,
        })

    # Afar was explicitly requested, but its required SRTM tile is not in the
    # local input checkout. Do not reconstruct or download it for this diagnosis.
    afar_site = next(site for site in sites_doc if site["id"] == "cand_afar_1")
    afar_lat, afar_lon = float(afar_site["lat"]), float(afar_site["lon"])
    afar_paths = _reader_tiles(afar_lat, afar_lon, WINDOW_KM)
    results.append({
        "site_id": "cand_afar_1",
        "coordinates": {"lat": afar_lat, "lon": afar_lon, "source": "frontend/public/data/sites.json"},
        "case_kind": "requested scan candidate",
        "status": "compared" if afar_paths else "missing_source_tiles",
        "expected_local_tile_tokens": terrain._tile_tokens(math.floor(afar_lat), math.floor(afar_lon), "srtm"),
        "available_source_tiles": [str(path.relative_to(ROOT)) for path in afar_paths],
        "limitation": None if afar_paths else "The required local SRTM tile is absent; no download was performed.",
    })
    used_paths.update(afar_paths)
    code_inputs = {}
    for relative in (
        "pipeline/terrain.py",
        "pipeline/scan.py",
        "pipeline/terrain_reader_diagnostic.py",
        "config/weights.yaml",
        "config/sites.json",
        "frontend/public/data/targets.json",
        "frontend/public/data/config.json",
    ):
        code_inputs[relative] = hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()
    return {
        "issue": 56,
        "method": "same 6 km destination footprint/grid; compare full-source final reader with per-tile scan-style cropped-source reprojection and same mosaic overwrite order",
        "inputs": {
            "main_window_km": float(config["main_window_km"]),
            "code_and_config_sha256": code_inputs,
            "rasterio": rasterio.__version__,
            "gdal": rasterio.__gdal_version__,
            "earth_radius_m": 6_378_137.0,
            "resampling": "bilinear",
            "rasterio_transformer_tolerance_default_pixels": 0.125,
            "comparison_transformer_tolerance_pixels": [0.125, 0.0],
            "nodata": "masked source values propagated as NaN; no filling",
            "vertical_datum": "not recorded in the local SRTM GeoTIFF/HGT metadata read by this diagnostic",
            "provenance": _metadata(sorted(used_paths)),
        },
        "cases": results,
        "limitations": [
            "Coordinates are the current approximate manifest/app coordinates, not newly confirmed footprints.",
            "Afar could not be processed because its local source tile is absent; no raw data was downloaded.",
            "The diagnostic isolates source crop/full-tile reprojection on a shared grid; it does not replay the historical scan or WorldCover selection.",
            "Etna and Yungay are known-site footprints close to tile boundaries; scan candidate centres are constrained to stay inside a single tile, so these cases diagnose reader behavior rather than prove selected-candidate history.",
            "The explicit transformer-tolerance comparison is a diagnostic setting test; it does not identify the underlying GDAL cause or establish which output is scientifically preferable.",
        ],
    }


def selftest() -> None:
    source = np.arange(64, dtype="float32").reshape(8, 8)
    comparison = source.copy()
    assert _difference(source, comparison)["absolute_elevation_difference_m"]["max"] == 0.0
    comparison[3, 4] += 0.25
    stats = _difference(source, comparison)
    assert stats["common_valid_cells"] == 64
    assert stats["absolute_elevation_difference_m"]["max"] == 0.25
    comparison[0, 0] = np.nan
    stats = _difference(source, comparison)
    assert stats["reference_only_cells"] == 1
    assert stats["common_valid_cells"] == 63
    descriptors = {key: 1.0 for key in scan.PARAM_KEYS}
    updated = dict(descriptors, roughness_m=1.5)
    delta = _descriptor_delta(descriptors, updated)
    assert delta["roughness_m"]["signed_difference"] == 0.5

    # Synthetic georeferenced plane: source clipping and full-source warping
    # must agree in the interior, while a nodata cell remains explicitly masked.
    from affine import Affine
    from rasterio.crs import CRS
    from rasterio.warp import reproject
    source = np.add.outer(np.arange(80, dtype="float32"), np.arange(90, dtype="float32"))
    source[40, 45] = np.nan
    src_transform = Affine(0.001, 0, 14.95, 0, -0.001, 37.8)
    dst_transform, width, height, dst_crs, _ = terrain.analysis_grid(2.0, 37.76, 15.0, 6_378_137.0)
    full = np.full((height, width), np.nan, dtype="float32")
    reproject(
        source=source, destination=full, src_transform=src_transform,
        src_crs=CRS.from_epsg(4326), dst_transform=dst_transform, dst_crs=dst_crs,
        resampling=__import__("rasterio.enums", fromlist=["Resampling"]).Resampling.bilinear,
        src_nodata=np.nan, dst_nodata=np.nan,
    )
    cropped, _ = _crop_and_warp(source, src_transform, CRS.from_epsg(4326), dst_transform, dst_crs, width, height)
    result = _difference(full, cropped)
    assert result["common_valid_cells"] > 0
    assert result["reference_only_cells"] == result["comparison_only_cells"] == 0
    assert result["absolute_elevation_difference_m"]["max"] < 0.01
    print("PASS: pixel differences, masks, and descriptor deltas")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selftest", action="store_true", help="run synthetic diagnostic checks only")
    parser.add_argument("--output", type=Path, default=OUTPUT, help="research JSON output path")
    args = parser.parse_args(argv)
    if args.selftest:
        selftest()
        return 0
    report = run()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True, allow_nan=False) + "\n")
    print(f"Wrote research-only report: {args.output}")
    for case in report["cases"]:
        print(f"{case['site_id']}: {case['status']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
