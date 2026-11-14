#!/usr/bin/env python3
"""P4 - compute Jezero terrain metrics from the USGS/NASA CTX DTM (issue #9)."""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.warp import reproject

from terrain import (
    BUFFER_CELLS,
    WORK_RES_M,
    analysis_grid,
    crop_slice,
    load_window_sizes,
    slope_and_roughness,
    summarize,
    window_cells,
)

ROOT = Path(__file__).resolve().parents[1]
SITES_PATH = ROOT / "config" / "sites.json"
DEM_PATH = ROOT / "data" / "raw" / "mars" / "JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif"
OUT_PATH = ROOT / "results" / "mars.json"
SOURCE = "Mars 2020 TRN CTX DTM Mosaic (USGS / NASA MRO CTX), 20 m"


def load_jezero() -> dict[str, Any]:
    sites = json.loads(SITES_PATH.read_text(encoding="utf-8"))
    rows = [row for row in sites.get("mars", []) if row.get("id") == "jezero"]
    if len(rows) != 1:
        raise ValueError("config/sites.json must contain exactly one Jezero target")
    target = rows[0]
    if target.get("confirmed") is not True:
        raise ValueError("Jezero centre must be human-confirmed before the final terrain run")
    return target


def mars_radius(crs: CRS) -> float:
    """Read the sphere radius from the DEM's own equirectangular CRS."""
    projection = crs.to_dict()
    radius = projection.get("R")
    if radius is None or not math.isfinite(float(radius)) or float(radius) <= 0:
        raise ValueError(f"source CRS does not define a usable spherical radius: {crs}")
    if projection.get("proj") != "eqc":
        raise ValueError(f"expected source equirectangular projection, got {crs}")
    return float(radius)


def read_mars_window(km: float, lat: float, lon: float, radius_m: float):
    """Reproject one Mars window to the shared local 30 m metric grid."""
    if not DEM_PATH.exists():
        raise FileNotFoundError(f"missing Jezero DTM: {DEM_PATH}")
    transform, width, height, dst_crs, _ = analysis_grid(km, lat, lon, radius_m)
    with rasterio.open(DEM_PATH) as src:
        masked = src.read(1, masked=True).astype("float32")
        data = np.ma.filled(masked, np.nan).astype("float32")
        src_valid = (~np.ma.getmaskarray(masked) & np.isfinite(data)).astype("float32")

        destination = np.full((height, width), np.nan, dtype="float32")
        reproject(
            source=data,
            destination=destination,
            src_transform=src.transform,
            src_crs=src.crs,
            src_nodata=np.nan,
            dst_transform=transform,
            dst_crs=dst_crs,
            dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )
        destination_valid = np.zeros((height, width), dtype="float32")
        reproject(
            source=src_valid,
            destination=destination_valid,
            src_transform=src.transform,
            src_crs=src.crs,
            dst_transform=transform,
            dst_crs=dst_crs,
            resampling=Resampling.nearest,
        )
    valid = (destination_valid > 0.5) & np.isfinite(destination)
    return np.where(valid, destination, np.nan), valid, slice(BUFFER_CELLS, height - BUFFER_CELLS)


def raw_window_mean_slope(lat: float, lon: float, radius_m: float) -> float | None:
    """Compute the 6 km comparison on raw pixels using local ground spacing."""
    with rasterio.open(DEM_PATH) as src:
        # Equirectangular x spacing contracts by cos(latitude); y spacing is unchanged.
        dx_m = abs(src.transform.a) * math.cos(math.radians(lat))
        dy_m = abs(src.transform.e)
        center_x = radius_m * math.radians(lon)
        center_y = radius_m * math.radians(lat)
        center_row, center_col = src.index(center_x, center_y)
        cols_n = window_cells(6.0, dx_m)
        rows_n = window_cells(6.0, dy_m)
        row0, col0 = center_row - rows_n // 2, center_col - cols_n // 2
        row1, col1 = row0 + rows_n, col0 + cols_n
        if row0 < 0 or col0 < 0 or row1 > src.height or col1 > src.width:
            return None
        window = rasterio.windows.Window(col0, row0, cols_n, rows_n)
        raw = np.ma.filled(src.read(1, window=window, masked=True).astype("float32"), np.nan)

    # Diagnostic only: same Horn stencil as terrain.horn_slope_deg, but with the
    # distinct native-grid ground spacings. The official output uses the shared
    # terrain functions after reprojection to a square 30 m metric grid.
    finite = np.isfinite(raw)
    padded = np.pad(np.where(finite, raw, 0.0), 1, mode="edge")
    valid = np.pad(finite, 1, mode="constant", constant_values=False)
    a, b, c = padded[:-2, :-2], padded[:-2, 1:-1], padded[:-2, 2:]
    d, f = padded[1:-1, :-2], padded[1:-1, 2:]
    g, h, i = padded[2:, :-2], padded[2:, 1:-1], padded[2:, 2:]
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8.0 * dx_m)
    dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8.0 * dy_m)
    complete = (
        valid[:-2, :-2] & valid[:-2, 1:-1] & valid[:-2, 2:]
        & valid[1:-1, :-2] & valid[1:-1, 1:-1] & valid[1:-1, 2:]
        & valid[2:, :-2] & valid[2:, 1:-1] & valid[2:, 2:]
    )
    slopes = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    slopes = slopes[complete & np.isfinite(slopes)]
    return float(np.mean(slopes)) if slopes.size else None


def finite_or_none(number: float | None) -> float | None:
    return float(number) if number is not None and math.isfinite(float(number)) else None


def build_result() -> tuple[dict[str, Any], np.ndarray, np.ndarray]:
    target = load_jezero()
    lat, lon = float(target["lat"]), float(target["lon"])
    sizes = load_window_sizes()
    km_max = max(sizes)

    with rasterio.open(DEM_PATH) as src:
        radius_m = mars_radius(src.crs)
        print(f"CRS: {src.crs}")
        print(f"CRS PROJ: {src.crs.to_proj4()}")
        print(f"Bounds: {src.bounds}")
        print(f"Resolution: {src.res} m/pixel")
        print(f"Nodata: {src.nodata}")
        print(f"Raster shape: {src.height} x {src.width}; dtype: {src.dtypes[0]}")
        print(f"Sphere radius from source CRS: {radius_m:g} m")

    z, valid, center = read_mars_window(km_max, lat, lon, radius_m)
    slope, rough = slope_and_roughness(z)
    windows: dict[str, dict[str, float | None]] = {}
    nodata_counts: dict[str, int] = {}
    stats_by_km: dict[str, dict[str, float | int | None]] = {}
    for km in sizes:
        crop = crop_slice(center, km, km_max)
        window_z, window_valid = z[crop, crop], valid[crop, crop]
        expected_cells = window_cells(km) ** 2
        nodata_count = expected_cells - int(window_valid.sum())
        key = str(int(km))
        nodata_counts[key] = nodata_count
        if nodata_count == 0:
            stats = summarize(window_z, window_valid, slope[crop, crop], rough[crop, crop])
            windows[key] = {
                "slope_mean_deg": finite_or_none(stats["slope_mean_deg"]),
                "slope_p90_deg": finite_or_none(stats["slope_p90_deg"]),
                "roughness_m": finite_or_none(stats["roughness_m"]),
            }
            stats_by_km[key] = stats
        else:
            # Do not silently shrink a requested square window around nodata/out-of-bounds cells.
            windows[key] = {"slope_mean_deg": None, "slope_p90_deg": None, "roughness_m": None}
            stats_by_km[key] = {"mean_elev_m": None, "flat_share": None}
        print(f"{key} km nodata/out-of-bounds cells: {nodata_count} / {expected_cells}")

    main = stats_by_km.get("6", {})
    projected_slope = windows.get("6", {}).get("slope_mean_deg")
    raw_slope = raw_window_mean_slope(lat, lon, radius_m)
    difference = None
    if raw_slope is not None and projected_slope is not None and raw_slope != 0:
        difference = abs(projected_slope - raw_slope) / abs(raw_slope) * 100.0
    row = {
        "id": target["id"],
        "name": target["name"],
        "lat": lat,
        "lon": lon,
        "source": SOURCE,
        "res_m": WORK_RES_M,
        "elev_m": finite_or_none(main.get("mean_elev_m")),
        "flat_share": finite_or_none(main.get("flat_share")),
        "windows": windows,
        "nodata_cells": nodata_counts,
        "raw_6km_slope_mean_deg": finite_or_none(raw_slope),
        "projected_6km_slope_mean_deg": finite_or_none(projected_slope),
        "slope_difference_percent": finite_or_none(difference),
    }
    main_windows = windows.get("6", {})
    for metric, unit in (
        ("slope_mean_deg", "deg"),
        ("slope_p90_deg", "deg"),
        ("roughness_m", "m"),
    ):
        value = main_windows.get(metric)
        label = metric.replace("_", " ")
        print(f"6 km {label}: {value:.6f} {unit}" if value is not None else f"6 km {label}: missing")
    if raw_slope is not None:
        print(f"6 km native-pixel mean slope: {raw_slope:.6f} deg")
    else:
        print("6 km native-pixel mean slope: missing")
    if difference is not None:
        print(f"Mean-slope difference: {difference:.3f}%")
    return row, z[center, center], valid[center, center]


def main() -> None:
    row, z12, valid12 = build_result()
    for km, metrics in row["windows"].items():
        for key, value in metrics.items():
            if value is None:
                continue
            if key.startswith("slope") and not 0.0 <= value <= 45.0:
                raise ValueError(f"{km} km {key}={value:g} outside the issue sanity range")
            if key == "roughness_m" and not 0.0 <= value <= 10.0:
                raise ValueError(f"{km} km {key}={value:g} outside the issue sanity range")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(row, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    if valid12.any():
        # Shared renderer writes the issue-required frontend/public/img/target_jezero.png.
        from build import render_hillshade, write_relief

        hillshade = render_hillshade("target_jezero", z12, valid12)
        relief = write_relief("jezero", z12, valid12)
        print(f"Hillshade: {hillshade}; relief grid: {relief}")
    else:
        print("12 km elevation window is unavailable; no hillshade or relief image written")
    print(f"Wrote {OUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
