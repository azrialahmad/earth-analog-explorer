#!/usr/bin/env python3
"""Moon-vs-Earth terrain tiles and the source-shortcut check (issue #46, experiment).

This is step 1 of the classifier experiment in issue #46. It cuts small square
terrain tiles from the lunar DEM (LOLA) and from the Earth DEMs (SRTM, Copernicus
GLO-30), computes a fixed list of terrain features per tile, and reports how the
features differ by DEM source *before* any model is trained. The question is
whether a classifier could tell the Moon from Earth by the instrument (noise,
quantization, resampling) instead of by the ground.

Nothing here feeds Terrain Match, the ranking or the app. No model is trained.

Tiles
* Tile size is the smallest window in ``config/weights.yaml`` (3 km, 100 cells on
  the shared 30 m grid). Every tile is read with the same 2-cell buffer as
  ``terrain.py`` so the 3x3 and 5x5 neighbourhoods are complete.
* ``random`` tiles: Moon tiles are drawn uniformly over the LOLA 85S grid; Earth
  tiles are drawn uniformly over each site's downloaded 1-degree DEM tiles, the
  same number per site.
* ``site_window`` tiles: the largest window in ``config/weights.yaml`` (12 km)
  around each lunar target and Earth site, cut into a grid of 3 km tiles. These
  are for per-site explanations later.
* A tile is dropped if any cell is missing, or if it fails the same "probably
  water" test ``terrain.py`` uses (share of cells with slope under
  ``FLAT_SLOPE_DEG`` above ``WATER_FLAT_SHARE``). The test is applied to the Moon
  and Earth alike; it also drops genuinely flat land, and the drop counts are
  reported.

Features (fixed before any results were looked at)
* ``slope_mean_deg``, ``slope_p90_deg``, ``roughness_m``: as in ``terrain.py``.
* ``roughness_330m_m``: median RMS residual of a plane fitted to 11x11 cells.
* ``detrended_relief_m``: RMS residual of one plane fitted to the whole tile.
* ``relief_m``: 95th minus 5th percentile of elevation.
* ``hypsometric_integral``: (mean - min) / (max - min) of elevation.
* ``curvature_abs_mean``: mean absolute 5-point Laplacian, in 1/km.
* ``depression_share``: share of cells that a priority-flood fill raises by at
  least ``DEPRESSION_MIN_DEPTH_M``; tile edges drain. A crater/pit measure.
* ``depression_max_depth_m``: largest fill depth in the tile.

Diagnostics (not features): ``flat_share``, ``zero_slope_share`` (cells with a
slope of exactly 0, a sign of integer elevation steps), ``mean_elev_m``.

Outputs
* ``data/derived/analog_tiles.csv``: one row per kept tile (git-ignored; rebuilt
  deterministically from the raw DEMs and ``SEED``).
* ``results/analog_shortcut_check.json``: sampling counts, native spacing,
  feature quantiles per source, single-feature AUCs, the flattest-decile noise
  check, the Moon pole-distance trend, and a reproduction check against
  ``results/terrain.json``.

* ``uv run pipeline/analog_tiles.py``            -> the two outputs above
* ``uv run pipeline/analog_tiles.py --selftest`` -> numeric checks, no data needed
"""
from __future__ import annotations

import argparse
import csv
import heapq
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

import terrain as T

ROOT = T.ROOT
DERIVED_DIR = ROOT / "data" / "derived"
TILES_CSV = DERIVED_DIR / "analog_tiles.csv"
CHECK_JSON = ROOT / "results" / "analog_shortcut_check.json"
TERRAIN_JSON = ROOT / "results" / "terrain.json"

# Experiment settings (issue #46). These are sampling and feature-definition
# choices for this experiment only; they are not scoring weights, ranges or
# thresholds and nothing in the app reads them.
SEED = 46
MOON_RANDOM_TILES = 2000
EARTH_RANDOM_TILES_PER_SITE = 170
# Above SRTM's 1 m integer elevation step, so a single rounding step cannot
# create a depression on its own.
DEPRESSION_MIN_DEPTH_M = 2.0

EARTH_RADIUS_M = 6378137.0
MOON_SECTOR_DEG = 45.0  # Moon random tiles are grouped into 8 longitude sectors

FEATURES = [
    "slope_mean_deg",
    "slope_p90_deg",
    "roughness_m",
    "roughness_330m_m",
    "detrended_relief_m",
    "relief_m",
    "hypsometric_integral",
    "curvature_abs_mean",
    "depression_share",
    "depression_max_depth_m",
]
DIAGNOSTICS = ["flat_share", "zero_slope_share", "mean_elev_m"]
META = ["tile_id", "body", "source", "group", "role", "near", "lat", "lon"]


# --------------------------------------------------------------------------- #
# Features (covered by --selftest)
# --------------------------------------------------------------------------- #
def fill_depth(z: np.ndarray) -> np.ndarray:
    """Priority-flood depression fill depth (m); every edge cell is an outlet."""
    n, m = z.shape
    filled = z.astype("float64").copy()
    closed = np.zeros((n, m), dtype=bool)
    heap: list[tuple[float, int, int]] = []
    for i in range(n):
        for j in (0, m - 1):
            if not closed[i, j]:
                closed[i, j] = True
                heap.append((filled[i, j], i, j))
    for j in range(1, m - 1):
        for i in (0, n - 1):
            if not closed[i, j]:
                closed[i, j] = True
                heap.append((filled[i, j], i, j))
    heapq.heapify(heap)
    while heap:
        h, i, j = heapq.heappop(heap)
        for di in (-1, 0, 1):
            ni = i + di
            if ni < 0 or ni >= n:
                continue
            for dj in (-1, 0, 1):
                nj = j + dj
                if (di == 0 and dj == 0) or nj < 0 or nj >= m or closed[ni, nj]:
                    continue
                closed[ni, nj] = True
                if filled[ni, nj] < h:
                    filled[ni, nj] = h
                heapq.heappush(heap, (filled[ni, nj], ni, nj))
    return filled - z


def plane_residual_rms(z: np.ndarray, cell_m: float) -> float:
    n, m = z.shape
    yy, xx = np.mgrid[0:n, 0:m]
    design = np.column_stack([xx.ravel() * cell_m, yy.ravel() * cell_m, np.ones(n * m)])
    coef, *_ = np.linalg.lstsq(design, z.ravel(), rcond=None)
    resid = z.ravel() - design @ coef
    return float(np.sqrt(np.mean(resid * resid)))


def tile_features(z_pad: np.ndarray, buf: int = T.BUFFER_CELLS) -> dict | None:
    """Features for the inner tile of a buffered elevation grid (m, 30 m cells).

    Returns None when any cell is missing.
    """
    z_pad = np.asarray(z_pad, dtype="float64")
    if not np.isfinite(z_pad).all():
        return None
    inner = (slice(buf, z_pad.shape[0] - buf), slice(buf, z_pad.shape[1] - buf))
    z = z_pad[inner]
    cell = T.WORK_RES_M

    slope = T.horn_slope_deg(z_pad, cell)[inner]
    r5 = T.roughness_rms_m(z_pad, T.ROUGHNESS_CELLS)[inner]
    r11 = T.roughness_rms_m(z_pad, 11)[inner]
    sv = slope[np.isfinite(slope)]
    r5v = r5[np.isfinite(r5)]
    r11v = r11[np.isfinite(r11)]

    lap = (
        z_pad[buf - 1:-buf - 1, buf:-buf] + z_pad[buf + 1:z_pad.shape[0] - buf + 1, buf:-buf]
        + z_pad[buf:-buf, buf - 1:-buf - 1] + z_pad[buf:-buf, buf + 1:z_pad.shape[1] - buf + 1]
        - 4.0 * z
    ) / (cell * cell)

    zmin, zmax = float(z.min()), float(z.max())
    depth = fill_depth(z)
    p5, p95 = np.percentile(z, [5, 95])
    return {
        "slope_mean_deg": float(sv.mean()),
        "slope_p90_deg": float(np.percentile(sv, 90)),
        "roughness_m": float(np.median(r5v)),
        "roughness_330m_m": float(np.median(r11v)) if r11v.size else None,
        "detrended_relief_m": plane_residual_rms(z, cell),
        "relief_m": float(p95 - p5),
        "hypsometric_integral": (float(z.mean()) - zmin) / (zmax - zmin) if zmax > zmin else None,
        "curvature_abs_mean": float(np.mean(np.abs(lap))) * 1000.0,
        "depression_share": float(np.mean(depth >= DEPRESSION_MIN_DEPTH_M)),
        "depression_max_depth_m": float(depth.max()),
        "flat_share": float(np.mean(sv < T.FLAT_SLOPE_DEG)),
        "zero_slope_share": float(np.mean(sv == 0.0)),
        "mean_elev_m": float(z.mean()),
    }


def water_like(feat: dict) -> bool:
    """The same "probably water" rule terrain.py uses to flag a window."""
    return feat["flat_share"] > T.WATER_FLAT_SHARE


# --------------------------------------------------------------------------- #
# Readers
# --------------------------------------------------------------------------- #
def load_earth_source(path: Path):
    import rasterio

    with rasterio.open(path) as src:
        data = np.ma.filled(src.read(1, masked=True).astype("float32"), np.nan)
        return {"path": path, "data": data, "transform": src.transform, "crs": src.crs}


def read_earth_mosaic(sources, lat: float, lon: float, km: float):
    """Resample a window from in-memory DEM tiles, like terrain.read_earth_window.

    Returns (elev_m, valid, center_slice).
    """
    from affine import Affine
    from rasterio.enums import Resampling
    from rasterio.warp import reproject, transform_bounds

    transform, width, height, dst_crs, _ = T.analysis_grid(km, lat, lon, EARTH_RADIUS_M)
    left, bottom, right, top = T.dst_bounds(transform, width, height)
    dst = np.full((height, width), np.nan, dtype="float32")
    for src in sources:
        st, data = src["transform"], src["data"]
        w, s, e, n = transform_bounds(dst_crs, src["crs"], left, bottom, right, top, densify_pts=21)
        col0 = max(int(math.floor((w - st.c) / st.a)) - 2, 0)
        col1 = min(int(math.ceil((e - st.c) / st.a)) + 2, data.shape[1])
        row0 = max(int(math.floor((st.f - n) / -st.e)) - 2, 0)
        row1 = min(int(math.ceil((st.f - s) / -st.e)) + 2, data.shape[0])
        if col1 <= col0 or row1 <= row0:
            continue
        sub = np.ascontiguousarray(data[row0:row1, col0:col1])
        sample = np.full((height, width), np.nan, dtype="float32")
        reproject(
            source=sub, destination=sample,
            src_transform=st * Affine.translation(col0, row0), src_crs=src["crs"],
            dst_transform=transform, dst_crs=dst_crs,
            resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=np.nan,
        )
        filled = np.isfinite(sample)
        dst[filled] = sample[filled]
    valid = np.isfinite(dst)
    return dst, valid, slice(T.BUFFER_CELLS, height - T.BUFFER_CELLS)


def offset_latlon(lat: float, lon: float, dx_m: float, dy_m: float, radius_m: float):
    """Lat/lon of a point dx (east), dy (north) metres from (lat, lon) on the aeqd plane."""
    from rasterio.crs import CRS
    from rasterio.warp import transform

    aeqd = CRS.from_proj4(f"+proj=aeqd +lat_0={lat} +lon_0={lon} +R={radius_m} +units=m +no_defs")
    geo = CRS.from_proj4(f"+proj=longlat +R={radius_m} +no_defs")
    lons, lats = transform(aeqd, geo, [dx_m], [dy_m])
    return lats[0], lons[0]


def split_window(z: np.ndarray, km_big: float, km_tile: float):
    """Cut a buffered km_big grid into buffered km_tile grids. Yields (dx_m, dy_m, z_pad)."""
    b = T.BUFFER_CELLS
    n_big, n_tile = T.window_cells(km_big), T.window_cells(km_tile)
    k = n_big // n_tile
    for i in range(k):
        for j in range(k):
            r0, c0 = b + i * n_tile, b + j * n_tile
            z_pad = z[r0 - b:r0 + n_tile + b, c0 - b:c0 + n_tile + b]
            dx = ((j + 0.5) * n_tile - n_big / 2) * T.WORK_RES_M
            dy = (n_big / 2 - (i + 0.5) * n_tile) * T.WORK_RES_M
            yield dx, dy, z_pad


def native_spacing(src) -> dict:
    lon_deg, lat_deg = abs(src["transform"].a), abs(src["transform"].e)
    lat_c = src["transform"].f + src["transform"].e * src["data"].shape[0] / 2
    m_per_deg = math.pi * EARTH_RADIUS_M / 180.0
    return {
        "lon_arcsec": lon_deg * 3600, "lat_arcsec": lat_deg * 3600,
        "ew_m": lon_deg * m_per_deg * math.cos(math.radians(lat_c)), "ns_m": lat_deg * m_per_deg,
    }


# --------------------------------------------------------------------------- #
# Tile building
# --------------------------------------------------------------------------- #
def earth_files_for_site(site: dict, km_big: float) -> list[Path]:
    """Every downloaded DEM tile that the site's largest window touches."""
    lat, lon = site["lat"], site["lon"]
    if abs(lat) <= 60.0:
        directory, style = T.SRTM_DIR, "srtm"
    else:
        directory, style = T.COPERNICUS_DIR, "copernicus"
    half = km_big / 2 + 1.0
    dlat = half / 111.32
    dlon = half / (111.32 * math.cos(math.radians(lat)))
    tokens = []
    for a in range(math.floor(lat - dlat), math.floor(lat + dlat) + 1):
        for b in range(math.floor(lon - dlon), math.floor(lon + dlon) + 1):
            tokens.extend(T._tile_tokens(a, b, style))
    return T._find_tiles(directory, tokens)


def source_name(path: Path) -> str:
    return "copernicus" if "COPERNICUS" in path.name.upper() else "srtm"


class Collector:
    def __init__(self):
        self.rows: list[dict] = []
        self.counts: dict[str, dict[str, int]] = {}

    def add(self, meta: dict, z_pad) -> None:
        c = self.counts.setdefault(f"{meta['source']}/{meta['role']}",
                                   {"attempted": 0, "kept": 0, "rejected_missing": 0, "rejected_water_like": 0})
        c["attempted"] += 1
        feat = None if z_pad is None else tile_features(z_pad)
        if feat is None or any(feat[k] is None for k in FEATURES):
            c["rejected_missing"] += 1
            return
        if water_like(feat):
            c["rejected_water_like"] += 1
            return
        c["kept"] += 1
        self.rows.append({**meta, "tile_id": f"{meta['source']}-{len(self.rows):05d}", **feat})


def build_moon(col: Collector, rng, km_tile: float, km_big: float, sites: dict) -> dict:
    lola = T.open_lola()
    mal_lat, mal_lon, _ = T.locate_malapert(lola)
    targets = []
    for t in sites["lunar"]:
        lat, lon = (t["lat"], t["lon"]) if t["lat"] is not None else (mal_lat, mal_lon)
        targets.append((t["id"], lat, lon))

    for tid, lat, lon in targets:
        z, valid, _ = T.read_lola_window(lat, lon, km_big)
        for dx, dy, z_pad in split_window(z, km_big, km_tile):
            tlat, tlon = offset_latlon(lat, lon, dx, dy, T.MOON_RADIUS_M)
            col.add({"body": "moon", "source": "lola", "group": f"moon_target_{tid}", "role": "site_window",
                     "near": tid, "lat": tlat, "lon": tlon}, z_pad)

    margin_px = int(math.ceil(km_tile * 1000 * 1.5 / T.LOLA_CELL_M))
    for _ in range(MOON_RANDOM_TILES):
        c = rng.uniform(margin_px, T.LOLA_SIZE - margin_px)
        r = rng.uniform(margin_px, T.LOLA_SIZE - margin_px)
        lat, lon = T.lola_pixel_to_latlon(c, r)
        try:
            z, _, _ = T.read_lola_window(lat, lon, km_tile)
        except RuntimeError:
            z = None
        sector = int(((lon % 360.0) // MOON_SECTOR_DEG))
        col.add({"body": "moon", "source": "lola", "group": f"moon_sector_{sector}", "role": "random",
                 "near": "", "lat": lat, "lon": lon}, z)
    return {"malapert_located": [mal_lat, mal_lon]}


def build_earth(col: Collector, rng, km_tile: float, km_big: float, km_main: float, sites: dict,
                terrain_rows: dict) -> tuple[dict, dict]:
    spacing: dict[str, dict] = {}
    repro: dict[str, dict] = {}
    for site in sites["earth"]:
        files = earth_files_for_site(site, km_big)
        if not files:
            continue
        sources = [load_earth_source(p) for p in files]
        for s in sources:
            spacing[s["path"].name] = native_spacing(s)
        lat, lon = site["lat"], site["lon"]

        # Reproduction check: rebuild the site's row with terrain.py's own builder.
        row = T.build_row({"id": site["id"]}, None, T.WORK_RES_M, [km_main, km_big],
                          lambda km: read_earth_mosaic(sources, lat, lon, km))
        ref = terrain_rows.get(site["id"], {}).get("windows", {}).get(str(int(km_main)), {})
        mine = row["windows"][str(int(km_main))]
        repro[site["id"]] = {
            k: (abs(mine[k] - ref[k]) / max(abs(ref[k]), 1e-12)
                if mine.get(k) is not None and ref.get(k) is not None else None)
            for k in ("slope_mean_deg", "slope_p90_deg", "roughness_m")
        }

        z, _, _ = read_earth_mosaic(sources, lat, lon, km_big)
        for dx, dy, z_pad in split_window(z, km_big, km_tile):
            tlat, tlon = offset_latlon(lat, lon, dx, dy, EARTH_RADIUS_M)
            col.add({"body": "earth", "source": source_name(files[0]), "group": f"earth_{site['id']}",
                     "role": "site_window", "near": site["id"], "lat": tlat, "lon": tlon}, z_pad)

        margin = km_tile * 1.5 / 111.32
        for _ in range(EARTH_RANDOM_TILES_PER_SITE):
            src = sources[int(rng.integers(len(sources)))]
            st, shape = src["transform"], src["data"].shape
            west, north = st.c, st.f
            east, south = west + st.a * shape[1], north + st.e * shape[0]
            mid = (north + south) / 2
            mlon = margin / max(math.cos(math.radians(mid)), 1e-6)
            tlat = rng.uniform(south + margin, north - margin)
            tlon = rng.uniform(west + mlon, east - mlon)
            z, _, _ = read_earth_mosaic([src], tlat, tlon, km_tile)
            col.add({"body": "earth", "source": source_name(src["path"]), "group": f"earth_{site['id']}",
                     "role": "random", "near": "", "lat": tlat, "lon": tlon}, z)
        del sources
    return spacing, repro


# --------------------------------------------------------------------------- #
# Shortcut check
# --------------------------------------------------------------------------- #
def finite(x):
    return T.finite_or_null(None if x is None else float(x))


def quantiles(values) -> dict:
    v = np.asarray(values, dtype="float64")
    if v.size == 0:
        return {"n": 0, "p10": None, "p50": None, "p90": None}
    p10, p50, p90 = np.percentile(v, [10, 50, 90])
    return {"n": int(v.size), "p10": finite(p10), "p50": finite(p50), "p90": finite(p90)}


def auc(a, b) -> float | None:
    """P(value from a > value from b), ties counting half. 0.5 = no separation."""
    from sklearn.metrics import roc_auc_score

    a, b = np.asarray(a, dtype="float64"), np.asarray(b, dtype="float64")
    if a.size == 0 or b.size == 0:
        return None
    y = np.r_[np.ones(a.size), np.zeros(b.size)]
    return finite(roc_auc_score(y, np.r_[a, b]))


def shortcut_check(rows: list[dict]) -> dict:
    from scipy.stats import spearmanr

    rnd = [r for r in rows if r["role"] == "random"]
    by_src = {s: [r for r in rnd if r["source"] == s] for s in ("lola", "srtm", "copernicus")}
    moon = by_src["lola"]
    earth = by_src["srtm"] + by_src["copernicus"]
    cols = FEATURES + ["zero_slope_share"]

    out: dict = {"feature_quantiles": {}, "single_feature_auc": {}, "flattest_decile": {}, "moon_pole_distance_spearman": {}}
    for f in cols:
        out["feature_quantiles"][f] = {s: quantiles([r[f] for r in v]) for s, v in by_src.items()}
        val = lambda rs: [r[f] for r in rs]  # noqa: E731
        out["single_feature_auc"][f] = {
            "moon_vs_earth": auc(val(moon), val(earth)),
            "lola_vs_srtm": auc(val(moon), val(by_src["srtm"])),
            "lola_vs_copernicus": auc(val(moon), val(by_src["copernicus"])),
            "srtm_vs_copernicus": auc(val(by_src["srtm"]), val(by_src["copernicus"])),
        }

    # Noise floor: on the flattest tenth of each source, roughness is mostly instrument.
    for s, v in by_src.items():
        if not v:
            continue
        cut = np.percentile([r["slope_mean_deg"] for r in v], 10)
        flat = [r for r in v if r["slope_mean_deg"] <= cut]
        out["flattest_decile"][s] = {
            "n": len(flat),
            "slope_mean_deg_max": finite(cut),
            **{f: quantiles([r[f] for r in flat]) for f in ("roughness_m", "curvature_abs_mean", "zero_slope_share")},
        }

    # LOLA's effective resolution depends on orbit-track density, which changes with
    # distance from the pole. A strong trend in fine-scale features would be a sign of that.
    if moon:
        dist = [90.0 + r["lat"] for r in moon]
        for f in cols:
            vals = [r[f] for r in moon]
            if np.ptp(vals) == 0:  # constant on the Moon (e.g. zero_slope_share): undefined
                out["moon_pole_distance_spearman"][f] = {"rho": None, "p": None}
                continue
            rho, p = spearmanr(dist, vals)
            out["moon_pole_distance_spearman"][f] = {"rho": finite(rho), "p": finite(p)}
    return out


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def write_csv(rows: list[dict]) -> None:
    DERIVED_DIR.mkdir(parents=True, exist_ok=True)
    with TILES_CSV.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=META + FEATURES + DIAGNOSTICS)
        w.writeheader()
        for r in rows:
            w.writerow({k: r[k] for k in META + FEATURES + DIAGNOSTICS})


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args(argv)
    if args.selftest:
        return selftest()

    t0 = time.time()
    sizes = T.load_window_sizes()
    km_tile, km_big = min(sizes), max(sizes)
    import yaml
    km_main = float(yaml.safe_load(T.WEIGHTS_PATH.read_text())["main_window_km"])
    sites = json.loads(T.SITES_PATH.read_text(encoding="utf-8"))
    terrain_rows = {r["id"]: r for r in json.loads(TERRAIN_JSON.read_text(encoding="utf-8"))}

    rng = np.random.default_rng(SEED)
    col = Collector()
    moon_info = build_moon(col, rng, km_tile, km_big, sites)
    print(f"moon done: {len(col.rows)} tiles kept ({time.time() - t0:.0f} s)")
    spacing, repro = build_earth(col, rng, km_tile, km_big, km_main, sites, terrain_rows)
    print(f"earth done: {len(col.rows)} tiles kept in total ({time.time() - t0:.0f} s)")

    write_csv(col.rows)
    check = {
        "_note": ("Experiment output for issue #46. Describes DEM tiles and their features by source, "
                  "before any model is trained. Not used by Terrain Match, the ranking or the app."),
        "settings": {
            "tile_km": km_tile, "site_window_km": km_big, "work_res_m": T.WORK_RES_M, "seed": SEED,
            "moon_random_tiles": MOON_RANDOM_TILES, "earth_random_tiles_per_site": EARTH_RANDOM_TILES_PER_SITE,
            "depression_min_depth_m": DEPRESSION_MIN_DEPTH_M,
            "water_rule": {"flat_slope_deg": T.FLAT_SLOPE_DEG, "flat_share_max": T.WATER_FLAT_SHARE},
            "features": FEATURES,
        },
        "sampling": col.counts,
        "malapert_located": moon_info["malapert_located"],
        "native_spacing": {"lola": {"cell_m": T.LOLA_CELL_M}, **spacing},
        "reproduction_vs_terrain_json_rel_diff": repro,
        **shortcut_check(col.rows),
    }
    CHECK_JSON.write_text(json.dumps(check, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"wrote {TILES_CSV.relative_to(ROOT)} ({len(col.rows)} rows) and {CHECK_JSON.relative_to(ROOT)}")
    return 0


# --------------------------------------------------------------------------- #
# Self-test (synthetic terrain; no downloaded data needed)
# --------------------------------------------------------------------------- #
def selftest() -> int:
    n = 100 + 2 * T.BUFFER_CELLS
    xs = (np.arange(n) - (n - 1) / 2) * T.WORK_RES_M
    xx, yy = np.meshgrid(xs, xs)

    plane = 0.1 * xx + 0.05 * yy
    f = tile_features(plane)
    assert f["depression_share"] == 0.0 and f["depression_max_depth_m"] < 1e-9, f
    assert f["detrended_relief_m"] < 1e-6 and f["curvature_abs_mean"] < 1e-9, f
    assert abs(f["hypsometric_integral"] - 0.5) < 1e-3, f
    assert f["zero_slope_share"] == 0.0, f

    pit = np.full((n, n), 100.0) + 0.001 * xx  # tilted so the outside drains
    pit[40:60, 40:60] -= 5.0
    f = tile_features(pit)
    assert abs(f["depression_share"] - 400 / 10000) < 1e-9, f
    assert abs(f["depression_max_depth_m"] - 5.0) < 0.1, f

    a = 1e-4
    dome = -a * (xx ** 2 + yy ** 2)
    f = tile_features(dome)
    assert abs(f["curvature_abs_mean"] - 4 * a * 1000) < 1e-6, f  # |Laplacian| 4a per m -> per km
    assert f["depression_share"] == 0.0, f  # a dome drains to every edge

    bowl = -dome  # lowest in the middle, so it fills up to its lowest edge cell
    f = tile_features(bowl)
    assert f["depression_share"] > 0.5, f

    holed = plane.copy()
    holed[10, 10] = np.nan
    assert tile_features(holed) is None
    print("selftest: PASS (plane, pit fill, dome, bowl, missing cell)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
