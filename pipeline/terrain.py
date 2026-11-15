#!/usr/bin/env python3
"""P1 - terrain numbers for lunar targets and Earth sites (issue #2).

For every lunar target and Earth site in ``config/sites.json`` this computes, on
one shared metric grid spacing, over square windows of 3, 6 and 12 km:

* ``slope_mean_deg``  mean of the Horn 3x3 slope, in degrees
* ``slope_p90_deg``   90th percentile of the same slope
* ``roughness_m``     median over the window of the per-cell RMS residual of a
                      plane fitted to the surrounding 5x5 (150 m) cells

It also records the source dataset, resolution, mean elevation and
``flat_share`` (share of cells with slope below 0.5 deg, a sign of water).

Method, window sizes and file layout come from issue #2 and must not be changed
here. Weights, ranges and scoring thresholds live in ``config/weights.yaml``;
this file only reads the window sizes from it.

* ``uv run pipeline/terrain.py``            -> results/terrain.json + 6 km table
* ``uv run pipeline/terrain.py --selftest`` -> numeric checks, no data needed
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
CONFIG_DIR = ROOT / "config"
RESULTS_DIR = ROOT / "results"
SITES_PATH = CONFIG_DIR / "sites.json"
WEIGHTS_PATH = CONFIG_DIR / "weights.yaml"
OUT_PATH = RESULTS_DIR / "terrain.json"

# Shared metric grid spacing for every target and site (issue #2, Nov 14 update).
WORK_RES_M = 30.0
# Cells read around a window so 3x3 (Horn) and 5x5 (roughness) neighbourhoods are
# complete for every cell reported inside the window.
BUFFER_CELLS = 2
ROUGHNESS_CELLS = 5  # 5 * 30 m = 150 m

# Acceptance bounds stated in issue #2, used only to flag suspicious output.
SANITY_SLOPE_MAX_DEG = 45.0
SANITY_ROUGHNESS_MAX_M = 10.0
FLAT_SLOPE_DEG = 0.5
WATER_FLAT_SHARE = 0.2

# Lunar LOLA raw grid constants (issue #2).
LOLA_NAME = "ldem_85s_20m_float.img"
LOLA_SIZE = 15168
LOLA_CELL_M = 20.0
# PDS labels the projection offset in 1-based sample/line coordinates as 7583.5.
# Convert that to the zero-based array coordinate of the pole between pixel centers.
LOLA_PROJECTION_OFFSET_PDS = 7583.5
LOLA_POLE_PX = LOLA_PROJECTION_OFFSET_PDS - 1.0
LOLA_KM_TO_M = 1000.0
MOON_RADIUS_M = 1737.4e3

# Earth DEM directories the human fills under data/raw.
SRTM_DIR = RAW_DIR / "srtm"
ASTER_DIR = RAW_DIR / "aster"
# Copernicus GLO-30 is only used for |lat| > 60 when ASTER is absent and a human
# has approved the substitute (issue #2); the source label stays "Copernicus GLO-30 (ESA)".
COPERNICUS_DIR = RAW_DIR / "copernicus"

# Malapert is located from LOLA instead of being given a coordinate (issue #2).
MALAPERT_LAT_RANGE = (-86.4, -85.6)  # south latitudes
MALAPERT_LON_HALF_WIDTH_M = 30_000.0


# --------------------------------------------------------------------------- #
# Numeric terrain functions (covered by --selftest)
# --------------------------------------------------------------------------- #
def horn_slope_deg(z: np.ndarray, cell_m: float) -> np.ndarray:
    """Horn 3x3 slope in degrees. NaN where a neighbourhood is incomplete."""
    z = np.asarray(z, dtype="float64")
    finite = np.isfinite(z)
    filled = np.where(finite, z, 0.0)
    padded = np.pad(filled, 1, mode="edge")
    valid = np.pad(finite, 1, mode="constant", constant_values=False)

    a, b, c = padded[0:-2, 0:-2], padded[0:-2, 1:-1], padded[0:-2, 2:]
    d, f = padded[1:-1, 0:-2], padded[1:-1, 2:]
    g, h, i = padded[2:, 0:-2], padded[2:, 1:-1], padded[2:, 2:]

    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8.0 * cell_m)
    dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8.0 * cell_m)

    ok = (
        valid[0:-2, 0:-2] & valid[0:-2, 1:-1] & valid[0:-2, 2:]
        & valid[1:-1, 0:-2] & valid[1:-1, 1:-1] & valid[1:-1, 2:]
        & valid[2:, 0:-2] & valid[2:, 1:-1] & valid[2:, 2:]
    )
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    return np.where(ok, slope, np.nan)


def _plane_residual_operator(cell_m: float, win: int) -> np.ndarray:
    """R = I - P for a least-squares plane fit over a win x win window."""
    half = win // 2
    offs = (np.arange(win) - half) * cell_m
    cols = np.repeat(offs, win)
    rows = np.tile(offs, win)
    design = np.column_stack([cols, rows, np.ones(win * win)])
    proj = design @ np.linalg.pinv(design)
    return np.eye(win * win) - proj


def roughness_rms_m(z: np.ndarray, win: int = ROUGHNESS_CELLS) -> np.ndarray:
    """Per-cell RMS residual (m) of a plane fit to the surrounding win x win cells."""
    z = np.asarray(z, dtype="float64")
    n, m = z.shape
    out = np.full((n, m), np.nan)
    if n < win or m < win:
        return out
    finite = np.isfinite(z)
    filled = np.where(finite, z, 0.0)

    integral = finite.astype(np.int64)
    csum = np.pad(integral.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    block = csum[win:, win:] - csum[:-win, win:] - csum[win:, :-win] + csum[:-win, :-win]

    windows = np.lib.stride_tricks.sliding_window_view(filled, (win, win))
    flat = windows.reshape(-1, win * win)
    residual = flat @ _plane_residual_operator(WORK_RES_M, win).T
    rms = np.sqrt(np.mean(residual * residual, axis=1))

    half = win // 2
    center = (slice(half, n - half), slice(half, m - half))
    complete = block == win * win
    out[center] = np.where(complete, rms.reshape(block.shape), np.nan)
    return out


def slope_and_roughness(z: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Slope (deg) and roughness (m) for every cell of the given grid."""
    return horn_slope_deg(z, WORK_RES_M), roughness_rms_m(z)


def summarize(z, valid, slope, rough) -> dict:
    """Window statistics from precomputed slope/roughness grids."""
    z = np.where(valid, z, np.nan)
    slope = np.where(valid, slope, np.nan)
    rough = np.where(valid, rough, np.nan)
    sv = slope[np.isfinite(slope)]
    rv = rough[np.isfinite(rough)]
    ev = z[np.isfinite(z)]
    return {
        "slope_mean_deg": float(np.mean(sv)) if sv.size else None,
        "slope_p90_deg": float(np.percentile(sv, 90)) if sv.size else None,
        "roughness_m": float(np.median(rv)) if rv.size else None,
        "mean_elev_m": float(np.mean(ev)) if ev.size else None,
        "flat_share": float(np.mean(sv < FLAT_SLOPE_DEG)) if sv.size else None,
        "cells": int(valid.sum()),
        "slope_cells": int(sv.size),
    }


# --------------------------------------------------------------------------- #
# Window geometry
# --------------------------------------------------------------------------- #
def window_cells(km: float, res_m: float = WORK_RES_M) -> int:
    return int(round(km * 1000.0 / res_m))


def analysis_grid(km: float, lat: float, lon: float, radius_m: float):
    """Grid covering the km window plus a BUFFER_CELLS margin on each side.

    Returns (transform, width, height, crs, analysis-window cell count).
    """
    from affine import Affine
    from rasterio.crs import CRS

    n = window_cells(km)
    total = n + 2 * BUFFER_CELLS
    half = total * WORK_RES_M / 2.0
    transform = Affine(WORK_RES_M, 0.0, -half, 0.0, -WORK_RES_M, half)
    crs = CRS.from_proj4(
        f"+proj=aeqd +lat_0={lat} +lon_0={lon} +R={radius_m} +units=m +no_defs"
    )
    return transform, total, total, crs, n


def dst_bounds(transform, width, height):
    left = transform.c
    top = transform.f
    right = transform.c + width * transform.a
    bottom = transform.f + height * transform.e
    return left, bottom, right, top


# --------------------------------------------------------------------------- #
# Lunar LOLA
# --------------------------------------------------------------------------- #
def open_lola() -> "np.memmap":
    path = RAW_DIR / LOLA_NAME
    if not path.exists():
        raise FileNotFoundError(
            f"missing lunar DEM {path} (raw float32 {LOLA_SIZE}x{LOLA_SIZE}, "
            f"{LOLA_CELL_M:.0f} m cells, km values)"
        )
    expected_size = LOLA_SIZE * LOLA_SIZE * np.dtype("<f4").itemsize
    actual_size = path.stat().st_size
    if actual_size != expected_size:
        raise ValueError(
            f"incomplete or unexpected LOLA file {path}: {actual_size} bytes; "
            f"expected {expected_size}"
        )
    return np.memmap(path, dtype="<f4", mode="r", shape=(LOLA_SIZE, LOLA_SIZE))


def lola_latlon_to_pixel(lat: float, lon: float) -> tuple[float, float]:
    """South polar stereographic lat/lon -> (col, row) in LOLA pixels.

    Uses the PDS label's spherical polar stereographic projection, central
    meridian 0, +x toward +longitude, +y toward the pole. The PDS projection
    offset is 7583.5 in 1-based sample/line coordinates, or 7582.5 in the
    zero-based pixel-center coordinate used here.
    """
    phi = math.radians(lat)
    lam = math.radians(lon)
    rho = 2.0 * MOON_RADIUS_M * math.tan(math.pi / 4.0 + phi / 2.0)
    x = rho * math.sin(lam)
    y = rho * math.cos(lam)
    return LOLA_POLE_PX + x / LOLA_CELL_M, LOLA_POLE_PX - y / LOLA_CELL_M


def lola_pixel_to_latlon(col: float, row: float) -> tuple[float, float]:
    x = (col - LOLA_POLE_PX) * LOLA_CELL_M
    y = (LOLA_POLE_PX - row) * LOLA_CELL_M
    rho = math.hypot(x, y)
    lat = math.degrees(2.0 * math.atan(rho / (2.0 * MOON_RADIUS_M)) - math.pi / 2.0)
    lon = math.degrees(math.atan2(x, y))
    return lat, lon


def _polar_radius(lat: float) -> float:
    return 2.0 * MOON_RADIUS_M * math.tan(math.pi / 4.0 + math.radians(lat) / 2.0)


def locate_malapert(lola: "np.memmap") -> tuple[float, float, float]:
    """Highest LOLA point in the Malapert search box (issue #2). Returns lat, lon, elev_m."""
    lat_lo, lat_hi = MALAPERT_LAT_RANGE  # e.g. -86.4 .. -85.6
    r_outer = _polar_radius(lat_hi)
    r_inner = _polar_radius(lat_lo)

    col_lo = int(math.floor(LOLA_POLE_PX - MALAPERT_LON_HALF_WIDTH_M / LOLA_CELL_M)) - 1
    col_hi = int(math.ceil(LOLA_POLE_PX + MALAPERT_LON_HALF_WIDTH_M / LOLA_CELL_M)) + 1
    row_lo = int(math.floor(LOLA_POLE_PX - r_outer / LOLA_CELL_M)) - 1
    row_hi = int(math.ceil(LOLA_POLE_PX - r_inner / LOLA_CELL_M)) + 1
    col_lo, row_lo = max(col_lo, 0), max(row_lo, 0)
    col_hi, row_hi = min(col_hi, LOLA_SIZE), min(row_hi, LOLA_SIZE)

    sub = np.asarray(lola[row_lo:row_hi, col_lo:col_hi], dtype="float64")
    cols = (np.arange(col_lo, col_hi) - LOLA_POLE_PX) * LOLA_CELL_M
    rows = (LOLA_POLE_PX - np.arange(row_lo, row_hi)) * LOLA_CELL_M
    xx, yy = np.meshgrid(cols, rows)
    rho = np.hypot(xx, yy)
    lat = np.degrees(2.0 * np.arctan(rho / (2.0 * MOON_RADIUS_M)) - math.pi / 2.0)

    mask = np.isfinite(sub) & (lat <= lat_hi) & (lat >= lat_lo)
    if not mask.any():
        raise RuntimeError("Malapert search box did not intersect valid LOLA data")
    masked = np.where(mask, sub, -np.inf)
    idx = np.unravel_index(int(np.argmax(masked)), masked.shape)
    col = float(col_lo + idx[1]) + 0.0
    row = float(row_lo + idx[0]) + 0.0
    elev_m = float(sub[idx]) * LOLA_KM_TO_M
    plat, plon = lola_pixel_to_latlon(col, row)
    return plat, plon, elev_m


def read_lola_window(lat: float, lon: float, km: float):
    """Resample a LOLA window onto the shared metric grid. Returns (elev_m, valid, slice)."""
    from affine import Affine
    from rasterio.crs import CRS
    from rasterio.enums import Resampling
    from rasterio.warp import reproject, transform_bounds

    lola = open_lola()
    transform, width, height, dst_crs, n = analysis_grid(km, lat, lon, MOON_RADIUS_M)
    src_crs = CRS.from_proj4(
        f"+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R={MOON_RADIUS_M} +units=m +no_defs"
    )
    src_transform = Affine(
        LOLA_CELL_M, 0.0, -(LOLA_POLE_PX + 0.5) * LOLA_CELL_M,
        0.0, -LOLA_CELL_M, (LOLA_POLE_PX + 0.5) * LOLA_CELL_M,
    )

    left, bottom, right, top = dst_bounds(transform, width, height)
    s_left, s_bottom, s_right, s_top = transform_bounds(
        dst_crs, src_crs, left, bottom, right, top, densify_pts=21
    )
    col0 = max(int(math.floor((s_left - src_transform.c) / LOLA_CELL_M)) - 2, 0)
    row0 = max(int(math.floor((src_transform.f - s_top) / LOLA_CELL_M)) - 2, 0)
    col1 = min(int(math.ceil((s_right - src_transform.c) / LOLA_CELL_M)) + 2, LOLA_SIZE)
    row1 = min(int(math.ceil((src_transform.f - s_bottom) / LOLA_CELL_M)) + 2, LOLA_SIZE)
    if col1 <= col0 or row1 <= row0:
        raise RuntimeError(f"window for {lat:.4f},{lon:.4f} falls outside the LOLA grid")

    sub = np.asarray(lola[row0:row1, col0:col1], dtype="float32")
    sub_transform = Affine(
        LOLA_CELL_M, 0.0, src_transform.c + col0 * LOLA_CELL_M,
        0.0, -LOLA_CELL_M, src_transform.f - row0 * LOLA_CELL_M,
    )
    src_m = np.where(np.isfinite(sub), sub * LOLA_KM_TO_M, np.nan).astype("float32")
    src_valid = np.isfinite(sub).astype("float32")

    dst = np.full((height, width), np.nan, dtype="float32")
    reproject(
        source=src_m, destination=dst,
        src_transform=sub_transform, src_crs=src_crs,
        dst_transform=transform, dst_crs=dst_crs,
        src_nodata=np.nan, dst_nodata=np.nan, resampling=Resampling.bilinear,
    )
    dst_valid = np.zeros((height, width), dtype="float32")
    reproject(
        source=src_valid, destination=dst_valid,
        src_transform=sub_transform, src_crs=src_crs,
        dst_transform=transform, dst_crs=dst_crs,
        resampling=Resampling.nearest,
    )
    valid = dst_valid > 0.5
    return np.where(valid, dst, np.nan), valid, slice(BUFFER_CELLS, height - BUFFER_CELLS)


# --------------------------------------------------------------------------- #
# Earth DEM (SRTM / ASTER)
# --------------------------------------------------------------------------- #
def _tile_tokens(lat: int, lon: int, style: str = "srtm") -> list[str]:
    """Filename substrings that identify the 1x1 degree tile for a dataset."""
    ns = "N" if lat >= 0 else "S"
    ew = "E" if lon >= 0 else "W"
    if style == "copernicus":
        return [f"{ns}{abs(lat):02d}_00_{ew}{abs(lon):03d}_00"]
    return [f"{ns}{abs(lat):02d}{ew}{abs(lon):03d}"]


def _has_files(directory: Path) -> bool:
    return directory.exists() and any(directory.rglob("*"))


def _find_tiles(directory: Path, tokens: list[str]) -> list[Path]:
    if not directory.exists():
        return []
    out = []
    for path in sorted(directory.rglob("*")):
        if path.is_file() and any(tok in path.name.upper() for tok in tokens):
            out.append(path)
    return out


def read_earth_window(lat: float, lon: float, km: float):
    """Resample an Earth DEM window to the shared grid.

    Returns (elev_m, valid, slice, source_label) or (None, None, None, None) when
    the required dataset is unavailable, so the caller writes null (issue #2).
    """
    import rasterio
    from rasterio.crs import CRS
    from rasterio.enums import Resampling
    from rasterio.warp import reproject, transform_bounds

    if abs(lat) <= 60.0:
        directory, label, style = SRTM_DIR, "NASA SRTM 1 arc-second", "srtm"
    elif _has_files(ASTER_DIR):
        directory, label, style = ASTER_DIR, "NASA ASTER GDEM v3", "srtm"
    elif _has_files(COPERNICUS_DIR):
        directory, label, style = COPERNICUS_DIR, "Copernicus GLO-30 (ESA)", "copernicus"
    else:
        return None, None, None, None

    transform, width, height, dst_crs, n = analysis_grid(km, lat, lon, 6378137.0)
    left, bottom, right, top = dst_bounds(transform, width, height)
    w, s, e, n_b = transform_bounds(dst_crs, CRS.from_epsg(4326), left, bottom, right, top)

    tokens = []
    for tlat in range(int(math.floor(s)), int(math.ceil(n_b))):
        for tlon in range(int(math.floor(w)), int(math.ceil(e))):
            tokens.extend(_tile_tokens(tlat, tlon, style))
    tiles = _find_tiles(directory, tokens)
    if not tiles:
        return None, None, None, None

    # Report each source's actual native angular spacing as local metric spacing.
    # This matters because one arc-second longitude is latitude-dependent, and
    # high-latitude Copernicus tiles use varying longitude increments.
    with rasterio.open(tiles[0]) as native:
        lon_step_deg = abs(native.transform.a)
        lat_step_deg = abs(native.transform.e)
    earth_radius_m = 6_378_137.0
    metres_per_degree_lat = math.pi * earth_radius_m / 180.0
    native_ns_m = lat_step_deg * metres_per_degree_lat
    native_ew_m = lon_step_deg * metres_per_degree_lat * abs(math.cos(math.radians(lat)))
    native_spacing = (
        f"{lon_step_deg * 3600:g}\u2033 lon x {lat_step_deg * 3600:g}\u2033 lat "
        f"(~{native_ew_m:.1f} m E-W x {native_ns_m:.1f} m N-S at {lat:g}\u00b0), "
        f"resampled {WORK_RES_M:g} m"
    )

    dst = np.full((height, width), np.nan, dtype="float32")
    for tile in tiles:
        with rasterio.open(tile) as src:
            source_data = src.read(1, masked=True).astype("float32")
            source_data = np.ma.filled(source_data, np.nan)
            sample = np.full((height, width), np.nan, dtype="float32")
            reproject(
                source=source_data, destination=sample,
                src_transform=src.transform, src_crs=src.crs,
                dst_transform=transform, dst_crs=dst_crs,
                resampling=Resampling.bilinear,
                src_nodata=np.nan, dst_nodata=np.nan,
            )
        filled = np.isfinite(sample)
        dst[filled] = sample[filled]
    valid = np.isfinite(dst)
    if not valid.any():
        return None, None, None, None
    return (
        np.where(valid, dst, np.nan), valid,
        slice(BUFFER_CELLS, height - BUFFER_CELLS),
        f"{label} (native {native_spacing})",
    )


# --------------------------------------------------------------------------- #
# Pipeline
# --------------------------------------------------------------------------- #
def load_window_sizes() -> list[float]:
    if not WEIGHTS_PATH.exists():
        raise FileNotFoundError(
            f"missing {WEIGHTS_PATH}; window sizes come from config/weights.yaml (issue #1)"
        )
    import yaml

    sizes = yaml.safe_load(WEIGHTS_PATH.read_text()).get("window_sizes_km")
    if not sizes:
        raise ValueError("config/weights.yaml has no window_sizes_km")
    return [float(x) for x in sizes]


def null_windows(sizes):
    return {
        str(int(km)): {"slope_mean_deg": None, "slope_p90_deg": None, "roughness_m": None}
        for km in sizes
    }


def finite_or_null(value):
    if value is None:
        return None
    return float(value) if math.isfinite(value) else None


def build_row(identity, source, res_m, sizes, loader):
    """Load the largest window once, derive every window size from it."""
    km_max = max(sizes)
    z, valid, center = loader(km_max)
    if z is None:
        return {**identity, "source": None, "res_m": None, "elev_m": None,
                "flat_share": None, "windows": null_windows(sizes)}
    slope, rough = slope_and_roughness(z)
    row = {**identity, "source": source, "res_m": res_m, "elev_m": None,
           "flat_share": None, "windows": {}}
    main_stats = None
    for km in sizes:
        s = crop_slice(center, km, km_max)
        # A slice alone crops rows only. Both axes must describe the requested
        # square, excluding the largest window's horizontal buffer as well.
        stats = summarize(z[s, s], valid[s, s], slope[s, s], rough[s, s])
        row["windows"][str(int(km))] = {
            "slope_mean_deg": finite_or_null(stats["slope_mean_deg"]),
            "slope_p90_deg": finite_or_null(stats["slope_p90_deg"]),
            "roughness_m": finite_or_null(stats["roughness_m"]),
        }
        if int(km) == 6:
            main_stats = stats
    if main_stats is None:
        main_stats = summarize(z[center, center], valid[center, center],
                               slope[center, center], rough[center, center])
    row["elev_m"] = finite_or_null(main_stats["mean_elev_m"])
    row["flat_share"] = finite_or_null(main_stats["flat_share"])
    return row


def crop_slice(center: slice, km: float, km_max: float) -> slice:
    """Crop the km_max centered window to a smaller km window."""
    n_max = window_cells(km_max)
    n = window_cells(km)
    if n == n_max:
        return center
    pad = (n_max - n) // 2
    start = center.start + pad
    return slice(start, start + n)


def process_targets(sites, sizes, located):
    rows = []
    for target in sites["lunar"]:
        lat, lon = target["lat"], target["lon"]
        if lat is None:
            lat, lon, _ = located[target["id"]]
        row = build_row(
            {"id": target["id"], "name": target["name"], "lat": lat, "lon": lon},
            f"LOLA ldem_85s_20m (native {LOLA_CELL_M:g} m, resampled {WORK_RES_M:g} m)",
            WORK_RES_M,
            sizes,
            lambda km, lat=lat, lon=lon: read_lola_window(lat, lon, km),
        )
        rows.append(row)
    return rows


def process_sites(sites, sizes):
    rows = []
    for site in sites["earth"]:
        lat, lon = site["lat"], site["lon"]
        holder = {}

        def loader(km, lat=lat, lon=lon):
            z, valid, center, label = read_earth_window(lat, lon, km)
            holder["label"] = label
            return z, valid, center

        row = build_row(
            {"id": site["id"], "name": site["name"], "lat": lat, "lon": lon},
            None, WORK_RES_M, sizes, loader,
        )
        if holder.get("label"):
            row["source"] = holder["label"]
            row["res_m"] = WORK_RES_M
        rows.append(row)
    return rows


def print_table(rows):
    print(f"{'id':<16}{'elev_m':>10}{'flat':>8}{'slope_mean':>12}{'slope_p90':>11}{'rough_m':>10}")
    for row in rows:
        s = row["windows"].get("6", {})
        fmt = lambda v: "null" if v is None else f"{v:.3f}"
        print(f"{row['id']:<16}{fmt(row['elev_m']):>10}{fmt(row['flat_share']):>8}"
              f"{fmt(s.get('slope_mean_deg')):>12}{fmt(s.get('slope_p90_deg')):>11}"
              f"{fmt(s.get('roughness_m')):>10}")


def run_checks(rows):
    problems = []
    for row in rows:
        if row["source"] is None:
            problems.append(f"{row['id']}: no source dataset, values are null")
            continue
        for km, win in row["windows"].items():
            for key, value in win.items():
                if value is None:
                    problems.append(f"{row['id']} {km} km {key} is null")
                elif key.startswith("slope") and not (0.0 <= value <= SANITY_SLOPE_MAX_DEG):
                    problems.append(f"{row['id']} {km} km {key}={value:.2f} outside range")
                elif key == "roughness_m" and not (0.0 <= value <= SANITY_ROUGHNESS_MAX_M):
                    problems.append(f"{row['id']} {km} km {key}={value:.2f} outside range")
        if row["flat_share"] is not None and row["flat_share"] > WATER_FLAT_SHARE:
            problems.append(f"{row['id']}: flat_share={row['flat_share']:.3f} > {WATER_FLAT_SHARE} (probably includes water)")
    return problems


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="P1 terrain numbers (issue #2)")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args(argv)
    if args.selftest:
        return selftest()

    sizes = load_window_sizes()
    sites = json.loads(SITES_PATH.read_text())

    located = {}
    lola_needed = any(t.get("lat") is None for t in sites["lunar"])
    if lola_needed:
        lola = open_lola()
        located["malapert"] = locate_malapert(lola)

    rows = process_targets(sites, sizes, located) + process_sites(sites, sizes)
    RESULTS_DIR.mkdir(exist_ok=True)
    OUT_PATH.write_text(json.dumps(rows, indent=2) + "\n")

    print_table(rows)
    problems = run_checks(rows)
    print()
    if problems:
        print("Checks flagged:")
        for p in problems:
            print(f"  - {p}")
    else:
        print("Checks: no flags")
    return 0


# --------------------------------------------------------------------------- #
# Self-test (synthetic terrain; no downloaded data needed)
# --------------------------------------------------------------------------- #
def selftest() -> int:
    n = 200
    xs = (np.arange(n) - (n - 1) / 2) * WORK_RES_M
    xx, yy = np.meshgrid(xs, xs)
    valid = np.ones((n, n), dtype=bool)

    flat = np.full((n, n), 100.0)
    slope, rough = slope_and_roughness(flat)
    s = summarize(flat, valid, slope, rough)
    assert abs(s["slope_mean_deg"]) < 1e-6, s
    assert abs(s["roughness_m"]) < 1e-6, s
    assert abs(s["flat_share"] - 1.0) < 1e-9, s

    angle = 10.0
    inclined = np.tan(np.radians(angle)) * xx
    slope, rough = slope_and_roughness(inclined)
    s = summarize(inclined, valid, slope, rough)
    assert abs(s["slope_mean_deg"] - angle) < 1e-3, s
    assert abs(s["slope_p90_deg"] - angle) < 1e-3, s
    assert abs(s["roughness_m"]) < 1e-6, s

    noisy = inclined + 0.5 * np.sin(xx / 40.0) * np.cos(yy / 40.0)
    slope, rough = slope_and_roughness(noisy)
    s = summarize(noisy, valid, slope, rough)
    assert s["roughness_m"] > 0.05, s

    holed = flat.copy()
    hole = valid.copy()
    hole[80:120, 80:120] = False
    slope, rough = slope_and_roughness(np.where(hole, holed, np.nan))
    s = summarize(np.where(hole, holed, np.nan), hole, slope, rough)
    assert s["cells"] == int(hole.sum()), s
    assert abs(s["slope_mean_deg"]) < 1e-6, s

    for lat, lon in [(-90.0, 0.0), (-85.988, 2.058), (-86.0, 0.0), (-85.7, -5.0)]:
        col, row = lola_latlon_to_pixel(lat, lon)
        back_lat, back_lon = lola_pixel_to_latlon(col, row)
        assert abs(back_lat - lat) < 1e-6, (lat, lon, back_lat)
        assert abs(back_lon - lon) < 1e-6, (lat, lon, back_lon)

    from test_terrain_windows import run_selftests

    run_selftests()
    print("selftest: PASS (flat, inclined plane, roughness, nodata mask, projection round-trip, square windows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
