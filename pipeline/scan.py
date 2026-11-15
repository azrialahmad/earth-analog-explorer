#!/usr/bin/env python3
"""Scan local Earth DEM tiles for new analog candidates (issue #48).

The 12 sites in ``config/sites.json`` are all known analog test areas. This step
looks for *new* candidate areas with the same terrain method:

1. Every Earth DEM tile already under ``data/raw/`` (SRTM 1 arc-second for
   |lat| <= 60, Copernicus GLO-30 above, as in ``terrain.py``) is cut into a grid
   of window centres ``scan.grid_km`` apart, keeping the 12 km window inside the
   tile.
2. Each centre gets the 6 km window numbers from the ``terrain.py`` functions
   (same 30 m azimuthal-equidistant grid, Horn slope, 150 m roughness).
3. Windows with DEM gaps, below sea level (the Skadi SRTM mirror includes
   bathymetry), with a water-like flat share, or near a known site are dropped.
4. The rest are scored against every target with the app's Terrain Match formula
   (``frontend/src/engine/scoring.ts``: linear similarity within ``range``,
   weighted mean), using the default weights in ``config/weights.yaml``.
5. Per target, the best windows are checked in order: at least
   ``scan.min_spacing_km`` from every candidate already kept, and an ESA
   WorldCover bare-ground share of at least ``scan.min_bare_share`` and a land
   share of at least ``scan.min_land_share`` (read with ``landcover.py``). A window with no WorldCover value is not kept.
6. Kept candidates are recomputed with ``terrain.build_row`` (the exact path used
   for the known sites), get low-sun share from ``lighting.py``, a hillshade and a
   relief grid, and are written in the app's ``Site`` shape with
   ``known_analog: false``.

The pipeline's ranking only chooses which windows become candidates. The app
ranks candidates and known sites together with its own engine.

* ``uv run pipeline/scan.py --selftest``          -> numeric checks, no data
* ``uv run pipeline/scan.py``                     -> results/candidates.json
* ``uv run pipeline/scan.py --update-app-data``   -> also replaces the
  candidates in frontend/public/data/sites.json (known sites are kept as they
  are, marked ``known_analog: true``)
* ``uv run pipeline/scan.py --record-provenance``   -> also records every scan
  window, selection decision, and cached WorldCover response
* ``uv run pipeline/scan.py --record-provenance --research-only`` -> evidence
  only; does not write app data, candidate results, hillshades, or relief assets
* ``uv run pipeline/scan_replay.py results/scan-provenance.json`` -> offline
  selection replay and comparison with the app candidate catalog at run start
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import yaml

from terrain import (
    BUFFER_CELLS,
    COPERNICUS_DIR,
    SRTM_DIR,
    WORK_RES_M,
    analysis_grid,
    build_row,
    dst_bounds,
    load_window_sizes,
    read_earth_window,
    slope_and_roughness,
    summarize,
)
from scan_provenance import (
    file_sha256,
    make_run_record,
    object_sha256,
    reconcile_scan_counts,
    selftest as provenance_selftest,
    window_id,
)

ROOT = Path(__file__).resolve().parents[1]
SITES_PATH = ROOT / "config" / "sites.json"
REGIONS_PATH = ROOT / "config" / "scan_regions.json"
WEIGHTS_PATH = ROOT / "config" / "weights.yaml"
OUT_PATH = ROOT / "results" / "candidates.json"
APP_DIR = ROOT / "frontend" / "public" / "data"
APP_SITES_PATH = APP_DIR / "sites.json"
APP_TARGETS_PATH = APP_DIR / "targets.json"
IMG_DIR = ROOT / "frontend" / "public" / "img"
RELIEF_DIR = APP_DIR / "relief"

PARAM_KEYS = ("slope_mean_deg", "slope_p90_deg", "roughness_m")
EARTH_RADIUS_M = 6_378_137.0
KM_PER_DEG_LAT = math.pi * EARTH_RADIUS_M / 180.0 / 1000.0
CANDIDATE_PREFIX = "cand_"
SCAN_FLAG = "scan candidate, not field-checked"


# --------------------------------------------------------------------------- #
# Scoring (mirror of frontend/src/engine/scoring.ts; covered by --selftest)
# --------------------------------------------------------------------------- #
def similarity(x: float | None, t: float | None, rng: float) -> float | None:
    if x is None or t is None or not math.isfinite(x) or not math.isfinite(t) or not rng > 0:
        return None
    return max(0.0, 1.0 - abs(x - t) / rng)


def terrain_match(site: dict[str, float | None], target: dict[str, float | None],
                  params: dict[str, Any]) -> float | None:
    num = den = 0.0
    for key in PARAM_KEYS:
        s = similarity(site.get(key), target.get(key), float(params[key]["range"]))
        if s is None:
            continue
        w = float(params[key]["weight"])
        num += w * s
        den += w
    return num / den if den > 0 else None


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2.0 * EARTH_RADIUS_M / 1000.0 * math.asin(math.sqrt(min(1.0, a)))


def tile_centres(lat0: int, lon0: int, grid_km: float, margin_km: float) -> list[tuple[float, float]]:
    """Window centres inside the 1x1 degree tile with SW corner (lat0, lon0)."""
    out = []
    dlat = grid_km / KM_PER_DEG_LAT
    mlat = margin_km / KM_PER_DEG_LAT
    lat = lat0 + mlat
    while lat <= lat0 + 1 - mlat + 1e-12:
        coslat = math.cos(math.radians(lat))
        dlon = grid_km / (KM_PER_DEG_LAT * coslat)
        mlon = margin_km / (KM_PER_DEG_LAT * coslat)
        lon = lon0 + mlon
        while lon <= lon0 + 1 - mlon + 1e-12:
            out.append((round(lat, 5), round(lon, 5)))
            lon += dlon
        lat += dlat
    return out


# --------------------------------------------------------------------------- #
# Tile scan
# --------------------------------------------------------------------------- #
def parse_tile(path: Path) -> tuple[int, int, str] | None:
    """(lat floor, lon floor, source label) from an SRTM or Copernicus file name."""
    name = path.name.upper()
    if path.parent == SRTM_DIR and name.endswith(".HGT") and len(name) >= 11:
        lat = int(name[1:3]) * (1 if name[0] == "N" else -1)
        lon = int(name[4:7]) * (1 if name[3] == "E" else -1)
        return lat, lon, "srtm"
    if path.parent == COPERNICUS_DIR and name.startswith("COPERNICUS_DSM_COG_10_"):
        parts = name.split("_")  # ... N65 00 W017 00 DEM.TIF
        lat_tok, lon_tok = parts[4], parts[6]
        lat = int(lat_tok[1:]) * (1 if lat_tok[0] == "N" else -1)
        lon = int(lon_tok[1:]) * (1 if lon_tok[0] == "E" else -1)
        return lat, lon, "copernicus"
    return None


def tile_key(lat: int, lon: int) -> str:
    """SRTM-style tile name, e.g. N13E040, used in config/scan_regions.json."""
    return f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}{'E' if lon >= 0 else 'W'}{abs(lon):03d}"


def load_regions() -> tuple[dict[str, dict[str, Any]], float]:
    if not REGIONS_PATH.exists():
        return {}, 0.0
    doc = json.loads(REGIONS_PATH.read_text(encoding="utf-8"))
    by_tile = {t: r for r in doc["regions"] for t in r["tiles"]}
    return by_tile, float(doc["near_known_km"])


def region_of(lat0: int, lon0: int, nearest: dict[str, Any], dist_km: float,
              regions: dict[str, dict[str, Any]], near_known_km: float) -> tuple[str, str]:
    """(region id, display name): the known site's area when close, else the scan region."""
    region = regions.get(tile_key(lat0, lon0))
    if region is None or dist_km <= near_known_km:
        return nearest["id"], f"{nearest['name'].split(',')[0].strip()} area"
    return region["id"], region["name"].split(",")[0].strip()


def local_tiles() -> list[tuple[Path, int, int]]:
    tiles = []
    for directory in (SRTM_DIR, COPERNICUS_DIR):
        if not directory.exists():
            continue
        for path in sorted(directory.iterdir()):
            parsed = parse_tile(path)
            if parsed is None:
                continue
            lat, lon, kind = parsed
            # Same source rule as terrain.read_earth_window.
            if (kind == "srtm") == (abs(lat + 0.5) <= 60.0):
                tiles.append((path, lat, lon))
    return tiles


def scan_tile(path: Path, lat0: int, lon0: int, scan: dict[str, Any], main_km: float):
    """Yield (lat, lon, stats) for every window centre in one tile."""
    import rasterio
    from rasterio.crs import CRS
    from rasterio.enums import Resampling
    from rasterio.warp import reproject, transform_bounds
    from rasterio.windows import from_bounds

    with rasterio.open(path) as src:
        data = np.ma.filled(src.read(1, masked=True).astype("float32"), np.nan)
        src_transform, src_crs = src.transform, src.crs
        height, width = data.shape
    for lat, lon in tile_centres(lat0, lon0, float(scan["grid_km"]), float(scan["edge_margin_km"])):
        transform, w, h, dst_crs, _ = analysis_grid(main_km, lat, lon, EARTH_RADIUS_M)
        grid_metadata = {
            "crs": dst_crs.to_string(),
            "affine_transform": list(transform)[:6],
            "width": w,
            "height": h,
            "buffer_cells": BUFFER_CELLS,
            "working_resolution_m": WORK_RES_M,
        }
        left, bottom, right, top = dst_bounds(transform, w, h)
        west, south, east, north = transform_bounds(dst_crs, CRS.from_epsg(4326),
                                                    left, bottom, right, top)
        win = from_bounds(west, south, east, north, src_transform)
        r0 = max(int(math.floor(win.row_off)) - 2, 0)
        c0 = max(int(math.floor(win.col_off)) - 2, 0)
        r1 = min(int(math.ceil(win.row_off + win.height)) + 2, height)
        c1 = min(int(math.ceil(win.col_off + win.width)) + 2, width)
        sub = data[r0:r1, c0:c1]
        dst = np.full((h, w), np.nan, dtype="float32")
        reproject(
            source=sub, destination=dst,
            src_transform=src_transform * src_transform.translation(c0, r0), src_crs=src_crs,
            dst_transform=transform, dst_crs=dst_crs,
            resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=np.nan,
        )
        valid = np.isfinite(dst)
        center = slice(BUFFER_CELLS, h - BUFFER_CELLS)
        valid_share = float(valid[center, center].mean())
        if valid_share < float(scan["min_valid_share"]):
            yield lat, lon, {"valid_share": valid_share, "grid": grid_metadata}
            continue
        slope, rough = slope_and_roughness(np.where(valid, dst, np.nan))
        stats = summarize(dst[center, center], valid[center, center],
                          slope[center, center], rough[center, center])
        stats["valid_share"] = valid_share
        # The Skadi SRTM mirror fills the sea with bathymetry, so the seabed has real-looking relief.
        inner = dst[center, center]
        stats["below_sea_share"] = float(np.mean(inner[np.isfinite(inner)] < 0.0))
        stats["grid"] = grid_metadata
        yield lat, lon, stats


def scan_all(scan: dict[str, Any], main_km: float, known: list[dict[str, Any]],
             provenance: dict[str, Any] | None = None,
             tile_inputs: list[tuple[Path, int, int]] | None = None):
    regions, near_known_km = load_regions()
    rows = []
    counts = {"tiles": 0, "windows": 0, "gaps": 0, "below_sea": 0, "water": 0, "near_known": 0, "kept": 0}
    for path, lat0, lon0 in tile_inputs if tile_inputs is not None else local_tiles():
        counts["tiles"] += 1
        t0 = time.time()
        n_before = len(rows)
        for lat, lon, stats in scan_tile(path, lat0, lon0, scan, main_km):
            counts["windows"] += 1
            record = None
            if provenance is not None:
                record = {
                    "window_id": window_id(path.name, lat, lon),
                    "tile": path.name,
                    "lat": lat,
                    "lon": lon,
                    "stats": stats,
                    "stage_outcome": None,
                    "reason": None,
                    "worldcover_status": "not_attempted_before_selection",
                }
            if "slope_mean_deg" not in stats or any(stats.get(k) is None for k in PARAM_KEYS):
                counts["gaps"] += 1
                if record is not None:
                    record["stage_outcome"] = "excluded"
                    record["reason"] = "missing_terrain_descriptor"
                    provenance["window_records"].append(record)
                continue
            if stats["below_sea_share"] > float(scan["max_below_sea_share"]):
                counts["below_sea"] += 1
                if record is not None:
                    record["stage_outcome"] = "excluded"
                    record["reason"] = "below_sea_share_limit"
                    provenance["window_records"].append(record)
                continue
            if stats["flat_share"] is None or stats["flat_share"] > float(scan["max_flat_share"]):
                counts["water"] += 1
                if record is not None:
                    record["stage_outcome"] = "excluded"
                    record["reason"] = "flat_share_limit_or_missing"
                    provenance["window_records"].append(record)
                continue
            nearest = min(known, key=lambda k: haversine_km(lat, lon, k["lat"], k["lon"]))
            dist = haversine_km(lat, lon, nearest["lat"], nearest["lon"])
            if dist < float(scan["exclude_known_km"]):
                counts["near_known"] += 1
                if record is not None:
                    record["stage_outcome"] = "excluded"
                    record["reason"] = "within_known_site_exclusion_distance"
                    record["nearest_known"] = nearest["id"]
                    record["nearest_known_km"] = dist
                    provenance["window_records"].append(record)
                continue
            counts["kept"] += 1
            region, region_name = region_of(lat0, lon0, nearest, dist, regions, near_known_km)
            descriptor = {
                "lat": lat, "lon": lon, "tile": path.name,
                "region": region, "region_name": region_name,
                "nearest_known": nearest["id"], "nearest_known_name": nearest["name"],
                "nearest_known_km": dist,
                **{k: float(stats[k]) for k in PARAM_KEYS},
                "flat_share": float(stats["flat_share"]),
                "below_sea_share": float(stats["below_sea_share"]),
                "elev_m": stats["mean_elev_m"],
            }
            rows.append(descriptor)
            if record is not None:
                record["stage_outcome"] = "eligible"
                record["reason"] = "passed_scan_filters"
                record["descriptor"] = descriptor
                provenance["window_records"].append(record)
        print(f"  {path.name}: {len(rows) - n_before} usable windows ({time.time() - t0:.0f} s)", flush=True)
    return rows, counts


# --------------------------------------------------------------------------- #
# Selection
# --------------------------------------------------------------------------- #
def select(rows, targets, params, scan, bare_lookup, trace: dict[str, Any] | None = None):
    """Greedy per-target pick; optional trace records decisions without changing policy."""
    picked: list[dict[str, Any]] = []
    bare_cache: dict[tuple[float, float], dict[str, Any]] = {}
    if trace is not None:
        trace.setdefault("events", [])
        trace.setdefault("lookup_order", [])
        trace.setdefault("worldcover", {})
        trace["target_order"] = [target["id"] for target in targets]

    def wid(row: dict[str, Any]) -> str:
        return window_id(row.get("tile", "unknown"), row["lat"], row["lon"])

    for target_index, target in enumerate(targets):
        target_id = target["id"]
        tparams = {k: target["params"][k]["value"] for k in PARAM_KEYS}
        if all(v is None for v in tparams.values()):
            if trace is not None:
                trace["events"].append({"target_id": target_id, "target_index": target_index,
                                        "decision": "target_skipped_all_values_missing",
                                        "worldcover_status": "not_attempted"})
            continue
        scored = []
        unscored = []
        for row in rows:
            tm = terrain_match(row, tparams, params)
            if tm is None:
                unscored.append({"window_id": wid(row), "worldcover_status": "not_attempted"})
            else:
                scored.append((tm, row))
        scored.sort(key=lambda x: (-x[0], x[1]["lat"], x[1]["lon"]))
        if trace is not None:
            trace["events"].append({
                "target_id": target_id,
                "target_index": target_index,
                "decision": "ranked_windows",
                "worldcover_status": "not_attempted_at_ranking_stage",
                "ranked": [{"window_id": wid(row), "terrain_match": tm, "rank": rank}
                           for rank, (tm, row) in enumerate(scored, start=1)],
                "unscored_windows": unscored,
            })
        kept = tried = 0
        for index, (tm, row) in enumerate(scored):
            if kept >= int(scan["per_target"]):
                if trace is not None:
                    trace["events"].extend({
                        "target_id": target_id, "window_id": wid(rest_row), "terrain_match": rest_tm,
                        "decision": "not_considered_per_target_limit", "worldcover_status": "not_attempted",
                    } for rest_tm, rest_row in scored[index:])
                break
            if tried >= int(scan["shortlist_max"]):
                if trace is not None:
                    trace["events"].extend({
                        "target_id": target_id, "window_id": wid(rest_row), "terrain_match": rest_tm,
                        "decision": "not_considered_shortlist_limit", "worldcover_status": "not_attempted",
                    } for rest_tm, rest_row in scored[index:])
                break
            same = next((p for p in picked if p["lat"] == row["lat"] and p["lon"] == row["lon"]), None)
            if same is not None:
                same["picked_for"][target_id] = tm
                kept += 1
                if trace is not None:
                    trace["events"].append({"target_id": target_id, "window_id": wid(row),
                                            "terrain_match": tm, "decision": "already_selected_at_same_location",
                                            "worldcover_status": "reused_selected_location"})
                continue

            spacing_conflicts = [
                p for p in picked
                if haversine_km(row["lat"], row["lon"], p["lat"], p["lon"])
                < float(scan["min_spacing_km"])
            ]
            if spacing_conflicts:
                if trace is not None:
                    trace["events"].append({
                        "target_id": target_id, "window_id": wid(row), "terrain_match": tm,
                        "decision": "excluded_minimum_spacing",
                        "worldcover_status": "not_attempted",
                        "conflicts": [{"window_id": wid(p),
                                       "distance_km": haversine_km(row["lat"], row["lon"], p["lat"], p["lon"])}
                                      for p in spacing_conflicts],
                    })
                continue

            region = row.get("region")
            region_count = sum(p.get("region") == region for p in picked)
            if region is not None and region_count >= int(scan["max_per_region"]):
                if trace is not None:
                    trace["events"].append({
                        "target_id": target_id, "window_id": wid(row), "terrain_match": tm,
                        "decision": "excluded_region_limit", "region": region,
                        "worldcover_status": "not_attempted",
                        "existing_region_count": region_count, "region_limit": int(scan["max_per_region"]),
                    })
                continue

            key = (row["lat"], row["lon"])
            trace_key = f"{row['lat']:.5f},{row['lon']:.5f}"
            cache_hit = key in bare_cache
            if not cache_hit:
                tried += 1
                if trace is not None:
                    trace["lookup_order"].append(trace_key)
                try:
                    bare_cache[key] = bare_lookup(row["lat"], row["lon"])
                except Exception as exc:
                    if trace is not None:
                        trace["worldcover"][trace_key] = {
                            "status": "error", "exception_type": type(exc).__name__,
                        }
                        trace["events"].append({"target_id": target_id, "window_id": wid(row),
                                                "terrain_match": tm, "decision": "worldcover_lookup_error",
                                                "lookup_key": trace_key})
                    raise
            bare = bare_cache[key]
            share = bare.get("value")
            if trace is not None and not cache_hit:
                trace["worldcover"][trace_key] = {
                    "status": "success" if share is not None else "unavailable",
                    "response": bare,
                    "response_sha256": object_sha256(bare),
                }
            lookup_status = trace["worldcover"][trace_key]["status"] if trace is not None else None

            if share is None or share < float(scan["min_bare_share"]):
                decision = "worldcover_unavailable" if share is None else "below_bare_share_limit"
                if trace is not None:
                    trace["events"].append({"target_id": target_id, "window_id": wid(row),
                                            "terrain_match": tm, "decision": decision,
                                            "lookup_key": trace_key, "lookup_status": lookup_status,
                                            "cache_hit": cache_hit, "bare_share": share})
                continue
            cells = bare.get("counts") or {}
            if not cells.get("total") or cells.get("land", 0) / cells["total"] < float(scan["min_land_share"]):
                if trace is not None:
                    trace["events"].append({"target_id": target_id, "window_id": wid(row),
                                            "terrain_match": tm, "decision": "below_land_share_limit",
                                            "lookup_key": trace_key, "lookup_status": lookup_status,
                                            "cache_hit": cache_hit, "land_cells": cells.get("land"),
                                            "total_cells": cells.get("total")})
                continue
            picked.append({**row, "bare": bare, "picked_for": {target_id: tm}})
            kept += 1
            if trace is not None:
                trace["events"].append({"target_id": target_id, "window_id": wid(row),
                                        "terrain_match": tm, "decision": "selected",
                                        "lookup_key": trace_key, "lookup_status": lookup_status,
                                        "cache_hit": cache_hit})
        print(f"  {target_id}: kept {kept} after {tried} WorldCover lookups", flush=True)
        if trace is not None:
            trace["events"].append({
                "target_id": target_id, "target_index": target_index,
                "decision": "target_selection_complete",
                "selected_window_ids": [wid(row) for row in picked if target_id in row.get("picked_for", {})],
                "worldcover_lookup_count": tried,
            })
    if trace is not None:
        trace["selected_window_ids"] = [wid(row) for row in picked]
    return picked


# --------------------------------------------------------------------------- #
# App output
# --------------------------------------------------------------------------- #
def fmt_coord(lat: float, lon: float) -> str:
    return f"{abs(lat):.2f}°{'N' if lat >= 0 else 'S'} {abs(lon):.2f}°{'E' if lon >= 0 else 'W'}"


def candidate_sites(picked, targets, sizes, main_window, scan):
    from build import ordered_params, ordered_windows, render_hillshade, source_res_m, value, write_relief
    from landcover import bare_ground_value
    from lighting import EARTH_SOURCE, annual_low_sun_share

    names = {t["id"]: t["name"] for t in targets}
    sites = []
    picked = sorted(picked, key=lambda p: (p["region"], -max(p["picked_for"].values())))
    seq: dict[str, int] = {}
    for p in picked:
        region = p["region"]
        seq[region] = seq.get(region, 0) + 1
        ident = f"{CANDIDATE_PREFIX}{region}_{seq[region]}"
        holder: dict[str, Any] = {}

        def loader(km, lat=p["lat"], lon=p["lon"]):
            z, valid, center, label = read_earth_window(lat, lon, km)
            holder["label"] = label
            holder["assets"] = (z, valid, center)
            return z, valid, center

        row = build_row({"id": ident, "name": "", "lat": p["lat"], "lon": p["lon"]},
                        None, WORK_RES_M, sizes, loader)
        row["source"] = holder.get("label")
        row["res_m"] = WORK_RES_M if holder.get("label") else None
        z, valid, center = holder["assets"]
        hillshade = render_hillshade(ident, z[center, center], valid[center, center])
        relief = write_relief(ident, z[center, center], valid[center, center])

        best_for = ", ".join(f"{names[t]} ({tm:.2f})" for t, tm in
                             sorted(p["picked_for"].items(), key=lambda x: -x[1]))
        why = (
            f"New candidate from the DEM scan (issue #48): {fmt_coord(p['lat'], p['lon'])}, "
            f"{p['nearest_known_km']:.0f} km from {p['nearest_known_name']}. "
            f"Picked among the scanned windows for {best_for} Terrain Match with default weights, "
            f"and {p['bare']['value'] * 100:.0f}% bare ground. Not checked on imagery or in the field."
        )
        flags = [SCAN_FLAG]
        if row.get("flat_share") is not None and row["flat_share"] > float(scan["max_flat_share"]):
            flags.append("includes water")
        if "Copernicus" in (row.get("source") or ""):
            flags.append("non-NASA elevation source")
        sun = annual_low_sun_share(p["lat"], p["lon"])
        sites.append({
            "id": ident,
            "name": f"{p['region_name']} candidate {seq[region]}",
            "lat": p["lat"], "lon": p["lon"], "why": why,
            "elev_m": row.get("elev_m"),
            "params": ordered_params(row["windows"].get(main_window, {}), row.get("source"), source_res_m(row)),
            "windows": ordered_windows(row, sizes),
            "conditions": {
                "low_sun_share": value(sun, "computed", EARTH_SOURCE),
                "bare_ground_share": bare_ground_value(p["bare"]),
            },
            "depth_evidence": [],
            "known_analog": False,
            "flags": flags,
            "hillshade": hillshade,
            "relief": relief,
        })
    return sites


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def update_app_data(candidates: list[dict[str, Any]], known_ids: set[str]) -> None:
    sites = json.loads(APP_SITES_PATH.read_text(encoding="utf-8"))
    keep = []
    for site in sites:
        if site["id"] in known_ids:
            site["known_analog"] = True
            keep.append(site)
    # Remove assets of earlier candidates that this scan did not keep. The kept
    # candidates' assets were just written, so they must not be touched.
    new_ids = {c["id"] for c in candidates}
    for path in list(IMG_DIR.glob(f"{CANDIDATE_PREFIX}*.png")) + list(RELIEF_DIR.glob(f"{CANDIDATE_PREFIX}*.json")):
        if path.stem not in new_ids:
            path.unlink()
    write_json(APP_SITES_PATH, keep + candidates)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Scan local DEM tiles for new analog candidates (issue #48)")
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--update-app-data", action="store_true",
                        help="replace the candidates in frontend/public/data/sites.json")
    parser.add_argument("--record-provenance", nargs="?", const=ROOT / "results" / "scan-provenance.json",
                        type=Path, metavar="PATH",
                        help="record scan and selection evidence (default: results/scan-provenance.json)")
    parser.add_argument("--research-only", action="store_true",
                        help="write provenance only; do not generate/publish app assets or candidate data")
    args = parser.parse_args(argv)
    if args.selftest:
        return selftest()
    if args.research_only and args.record_provenance is None:
        parser.error("--research-only requires --record-provenance")
    if args.research_only and args.update_app_data:
        parser.error("--research-only cannot be combined with --update-app-data")
    if args.record_provenance is not None:
        output = args.record_provenance.resolve()
        protected = {
            WEIGHTS_PATH.resolve(), SITES_PATH.resolve(), APP_TARGETS_PATH.resolve(),
            APP_SITES_PATH.resolve(), OUT_PATH.resolve(),
        }
        if output.suffix.lower() != ".json":
            parser.error("provenance output must use a .json file path")
        if output in protected:
            parser.error("provenance output must not overwrite scan inputs or candidate results")
        public_data = APP_DIR.resolve()
        raw_data = (ROOT / "data" / "raw").resolve()
        public_images = (ROOT / "frontend" / "public" / "img").resolve()
        if any(output == parent or parent in output.parents for parent in (public_data, raw_data, public_images)):
            parser.error("provenance output must be outside raw inputs and public app data/assets")

    # Fail before writing anything: without DEM tiles the scan would find no
    # candidates and --update-app-data would erase the existing ones.
    tiles = local_tiles()
    if not tiles:
        print(f"error: no Earth DEM tiles under {SRTM_DIR} or {COPERNICUS_DIR}; nothing written. "
              "See docs/REFERENCES.md and pipeline/fetch_tiles.py.", file=sys.stderr)
        return 1

    weights = yaml.safe_load(WEIGHTS_PATH.read_text(encoding="utf-8"))
    scan, params = weights["scan"], weights["params"]
    main_window = str(int(weights["main_window_km"]))
    sizes = load_window_sizes()
    manifest = json.loads(SITES_PATH.read_text(encoding="utf-8"))
    known = manifest["earth"]
    targets = json.loads(APP_TARGETS_PATH.read_text(encoding="utf-8"))
    app_sites = json.loads(APP_SITES_PATH.read_text(encoding="utf-8")) if args.record_provenance else []

    provenance = None
    if args.record_provenance is not None:
        provenance = make_run_record(
            weights_path=WEIGHTS_PATH,
            targets_path=APP_TARGETS_PATH,
            sites_path=SITES_PATH,
            app_sites_path=APP_SITES_PATH,
            regions_path=REGIONS_PATH,
            tile_paths=[entry[0] for entry in tiles],
            weights=weights,
            targets=targets,
            known_sites=known,
            app_sites=app_sites,
            work_res_m=WORK_RES_M,
            buffer_cells=BUFFER_CELLS,
        )

    def save_failed(stage: str, exc: Exception) -> None:
        if provenance is not None:
            provenance["run_status"] = "failed"
            provenance["failure"] = {"stage": stage, "exception_type": type(exc).__name__}
            if stage == "candidate_selection":
                provenance["selection"]["status"] = "failed"
            write_json(args.record_provenance, provenance)

    print("Scanning local DEM tiles...", flush=True)
    try:
        rows, counts = scan_all(scan, float(weights["main_window_km"]), known, provenance, tiles)
    except Exception as exc:
        save_failed("terrain_scan", exc)
        raise
    print(f"Windows: {counts}", flush=True)
    if provenance is not None:
        provenance["scan_counts"] = counts
        provenance["scan_count_reconciliation"] = reconcile_scan_counts(provenance["window_records"], counts)
        if not provenance["scan_count_reconciliation"]["matches"]:
            exc = RuntimeError("recorded per-window outcomes do not reconcile with scan counts")
            save_failed("scan_count_reconciliation", exc)
            raise exc

    from landcover import site_bare_ground
    print("Selecting candidates (reads ESA WorldCover windows over the network)...", flush=True)
    try:
        picked = select(rows, targets, params, scan,
                        lambda lat, lon: site_bare_ground(lat, lon, float(weights["main_window_km"])),
                        trace=provenance["selection"] if provenance is not None else None)
    except Exception as exc:
        save_failed("candidate_selection", exc)
        raise
    if provenance is not None:
        provenance["selection"]["selected_window_ids"] = [
            window_id(row["tile"], row["lat"], row["lon"]) for row in picked
        ]
        provenance["selection"]["status"] = "complete"
    if args.research_only:
        provenance["run_status"] = "complete"
        provenance["final_publication"] = {"status": "skipped-research-only"}
        write_json(args.record_provenance, provenance)
        print(f"Recorded research-only scan evidence to {args.record_provenance}")
        return 0

    try:
        candidates = candidate_sites(picked, targets, sizes, main_window, scan)
    except Exception as exc:
        save_failed("final_candidate_descriptors", exc)
        raise
    if not candidates:
        # Zero candidates almost always means missing inputs (or no WorldCover access),
        # not a real result; keep the existing results and app data.
        print(f"error: the scan kept no candidates (windows: {counts}); nothing written.", file=sys.stderr)
        save_failed("empty_selection", RuntimeError("selection produced no publishable candidates"))
        return 1

    write_json(OUT_PATH, {"counts": counts, "scan": scan, "candidates": candidates})
    if provenance is not None:
        provenance["final_publication"] = {
            "status": "generated-not-appended",
            "candidate_result_path": OUT_PATH.relative_to(ROOT).as_posix(),
            "candidate_result_sha256": file_sha256(OUT_PATH),
            "candidate_site_ids": [candidate["id"] for candidate in candidates],
            "candidate_window_mapping": [
                {"site_id": candidate["id"], "lat": candidate["lat"], "lon": candidate["lon"]}
                for candidate in candidates
            ],
            "final_candidate_descriptors_sha256": object_sha256(candidates),
        }
    for c in candidates:
        p = {k: c["params"][k]["value"] for k in PARAM_KEYS}
        print(f"  {c['id']:<22} {c['lat']:>9.4f} {c['lon']:>10.4f}  "
              f"slope {p['slope_mean_deg']:.1f}/{p['slope_p90_deg']:.1f}  rough {p['roughness_m']:.2f}  "
              f"bare {c['conditions']['bare_ground_share']['value']:.2f}")
    if args.update_app_data:
        update_app_data(candidates, {k["id"] for k in known})
        print(f"Updated {APP_SITES_PATH.relative_to(ROOT)} with {len(candidates)} candidates")
        if provenance is not None:
            provenance["final_publication"]["status"] = "app-data-updated"
            provenance["final_publication"]["app_sites_sha256"] = file_sha256(APP_SITES_PATH)
    if provenance is not None:
        provenance["run_status"] = "complete"
        write_json(args.record_provenance, provenance)
        print(f"Recorded scan provenance to {args.record_provenance}")
    return 0


# --------------------------------------------------------------------------- #
# Self-test
# --------------------------------------------------------------------------- #
def selftest() -> int:
    params = {k: {"weight": 1.0, "range": r} for k, r in
              zip(PARAM_KEYS, (20.0, 30.0, 3.0))}
    t = {"slope_mean_deg": 10.0, "slope_p90_deg": 20.0, "roughness_m": 1.0}
    assert terrain_match(t, t, params) == 1.0
    s = {"slope_mean_deg": 20.0, "slope_p90_deg": 20.0, "roughness_m": 1.0}
    assert abs(terrain_match(s, t, params) - (0.5 + 1 + 1) / 3) < 1e-12
    s = {"slope_mean_deg": None, "slope_p90_deg": 50.0, "roughness_m": 1.0}
    assert abs(terrain_match(s, t, params) - (0 + 1) / 2) < 1e-12
    assert terrain_match({k: None for k in PARAM_KEYS}, t, params) is None
    assert similarity(1.0, 1.0, 0.0) is None

    selftest_scan_trace()

    assert abs(haversine_km(0, 0, 1, 0) - KM_PER_DEG_LAT) < 1e-9
    assert haversine_km(10, 20, 10, 20) == 0.0

    centres = tile_centres(37, 15, 6.0, 7.0)
    assert centres, "no centres"
    for lat, lon in centres:
        assert 37 < lat < 38 and 15 < lon < 16
        assert (lat - 37) * KM_PER_DEG_LAT >= 7.0 - 1e-3
        assert (38 - lat) * KM_PER_DEG_LAT >= 7.0 - 1e-3
    assert len(tile_centres(79, 12, 6.0, 7.0)) < len(centres)  # fewer columns near the pole

    assert parse_tile(SRTM_DIR / "S25W070.hgt") == (-25, -70, "srtm")
    assert parse_tile(COPERNICUS_DIR / "Copernicus_DSM_COG_10_N79_00_E012_00_DEM.tif") == (79, 12, "copernicus")

    rows = [
        {"lat": 0.0, "lon": 0.0, **t},
        {"lat": 0.05, "lon": 0.0, **t},        # too close to the first
        {"lat": 1.0, "lon": 0.0, **t},
        {"lat": 2.0, "lon": 0.0, **{**t, "roughness_m": 2.5}},
    ]
    targets = [{"id": "x", "params": {k: {"value": v} for k, v in t.items()}}]
    scan = {"per_target": 2, "shortlist_max": 10, "min_spacing_km": 20, "min_bare_share": 0.5,
            "min_land_share": 0.9, "max_per_region": 5}
    bare = {(0.0, 0.0): 0.9, (0.05, 0.0): 0.9, (1.0, 0.0): 0.1, (2.0, 0.0): 0.8}
    land = {(0.0, 0.0): 100, (0.05, 0.0): 100, (1.0, 0.0): 100, (2.0, 0.0): 100}
    lookup = lambda la, lo: {"value": bare[(la, lo)], "counts": {"land": land[(la, lo)], "total": 100}}
    picked = select(rows, targets, params, scan, lookup)
    assert [(p["lat"], p["lon"]) for p in picked] == [(0.0, 0.0), (2.0, 0.0)], picked
    trace = {"events": [], "lookup_order": [], "worldcover": {}}
    traced = select(rows, targets, params, scan, lookup, trace=trace)
    assert [(p["lat"], p["lon"]) for p in traced] == [(p["lat"], p["lon"]) for p in picked]
    assert "excluded_minimum_spacing" in {event.get("decision") for event in trace["events"]}
    assert trace["selected_window_ids"] == [window_id("unknown", p["lat"], p["lon"]) for p in picked]
    land[(0.0, 0.0)] = 40  # mostly sea in WorldCover: not kept
    picked = select(rows, targets, params, scan, lookup)
    assert [(p["lat"], p["lon"]) for p in picked] == [(0.05, 0.0), (2.0, 0.0)], picked

    land[(0.0, 0.0)] = 100
    for r in rows:
        r["region"] = "a"
    scan["max_per_region"] = 1  # one per region: only the best window is kept
    picked = select(rows, targets, params, scan, lookup)
    assert [(p["lat"], p["lon"]) for p in picked] == [(0.0, 0.0)], picked

    assert tile_key(-26, -68) == "S26W068" and tile_key(79, -91) == "N79W091"
    known = {"id": "yungay", "name": "Atacama Yungay, Chile"}
    regions = {"S26W068": {"id": "puna", "name": "Puna de Atacama, Argentina"}}
    assert region_of(-26, -68, known, 250.0, regions, 100.0) == ("puna", "Puna de Atacama")
    assert region_of(-26, -68, known, 50.0, regions, 100.0) == ("yungay", "Atacama Yungay area")
    assert region_of(-25, -70, known, 250.0, regions, 100.0) == ("yungay", "Atacama Yungay area")

    selftest_missing_dem_keeps_output()
    provenance_selftest()

    print("selftest: PASS (terrain match mirror, distance, tile grid, tile names, greedy pick, regions, "
          "missing DEM keeps output)")
    return 0


def selftest_scan_trace() -> None:
    """Synthetic stage trace: each window gets one reason and counts reconcile."""
    original_scan_tile = scan_tile
    grid = {"crs": "synthetic", "affine_transform": [30, 0, 0, 0, -30, 0],
            "width": 1, "height": 1, "buffer_cells": 0, "working_resolution_m": 30}
    good = {key: 1.0 for key in PARAM_KEYS}
    def stats(**changes: Any) -> dict[str, Any]:
        return {**good, "valid_share": 1.0, "below_sea_share": 0.0, "flat_share": 0.0,
                "mean_elev_m": 100.0, "grid": grid, **changes}
    windows = [
        (0.1, 0.1, {"valid_share": 0.5, "grid": grid}),
        (0.2, 0.2, stats(below_sea_share=0.1)),
        (0.3, 0.3, stats(flat_share=0.8)),
        (1.0, 1.0, stats()),
        (0.0, 0.0, stats()),
    ]
    def fake_scan_tile(*_args: Any, **_kwargs: Any):
        yield from windows
    trace: dict[str, Any] = {"window_records": []}
    try:
        globals()["scan_tile"] = fake_scan_tile
        known = [{"id": "near", "name": "Near", "lat": 1.0, "lon": 1.0}]
        scan_config = {"max_below_sea_share": 0.02, "max_flat_share": 0.2, "exclude_known_km": 15.0}
        _, counts = scan_all(scan_config, 6.0, known, trace, [(Path("synthetic-tile.hgt"), 0, 0)])
    finally:
        globals()["scan_tile"] = original_scan_tile
    from scan_provenance import reconcile_scan_counts
    reconciliation = reconcile_scan_counts(trace["window_records"], counts)
    assert reconciliation["matches"], reconciliation
    assert [row["reason"] for row in trace["window_records"]] == [
        "missing_terrain_descriptor", "below_sea_share_limit", "flat_share_limit_or_missing",
        "within_known_site_exclusion_distance", "passed_scan_filters",
    ]


def selftest_missing_dem_keeps_output() -> None:
    """Regression (PR #49 review): with no DEM tiles, --update-app-data must fail
    and leave the app data, results and candidate assets exactly as they were."""
    import contextlib
    import io
    import tempfile

    names = ("SRTM_DIR", "COPERNICUS_DIR", "APP_SITES_PATH", "OUT_PATH", "IMG_DIR", "RELIEF_DIR")
    saved = {n: globals()[n] for n in names}
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        try:
            globals().update({
                "SRTM_DIR": root / "raw" / "srtm", "COPERNICUS_DIR": root / "raw" / "copernicus",
                "APP_SITES_PATH": root / "sites.json", "OUT_PATH": root / "candidates.json",
                "IMG_DIR": root / "img", "RELIEF_DIR": root / "relief",
            })
            SRTM_DIR.mkdir(parents=True)
            APP_SITES_PATH.write_text(json.dumps([{"id": "known"}, {"id": f"{CANDIDATE_PREFIX}x_1"}]),
                                      encoding="utf-8")
            OUT_PATH.write_text('{"candidates": ["old"]}', encoding="utf-8")
            IMG_DIR.mkdir()
            RELIEF_DIR.mkdir()
            (IMG_DIR / f"{CANDIDATE_PREFIX}x_1.png").write_bytes(b"png")
            (RELIEF_DIR / f"{CANDIDATE_PREFIX}x_1.json").write_text("{}", encoding="utf-8")
            before = {q: q.read_bytes() for q in root.rglob("*") if q.is_file()}

            with contextlib.redirect_stderr(io.StringIO()):
                code = main(["--update-app-data"])
            assert code == 1, code
            after = {q: q.read_bytes() for q in root.rglob("*") if q.is_file()}
            assert after == before, "missing DEM inputs changed existing output"
        finally:
            globals().update(saved)


if __name__ == "__main__":
    sys.exit(main())
