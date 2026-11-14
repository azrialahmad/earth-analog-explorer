#!/usr/bin/env python3
"""S2 - bare-ground share per Earth site from ESA WorldCover (issue #41).

For each Earth site, read ESA WorldCover 10 m 2021 v200 in place from the public
AWS bucket (HTTP range requests on the Cloud Optimized GeoTIFF tiles, no full
download). Use the same square as the terrain numbers: the main window from
config/weights.yaml, centred on the site, on an azimuthal-equidistant grid.
Resample the classes nearest-neighbour onto 10 m cells, then compute

    bare_ground_share = cells of class 60 "Bare / sparse vegetation" / land cells

where land cells are all classified cells except class 80 (permanent water)
and 0 (no data). Snow and ice, moss and lichen, built-up and vegetation all count
as land that is not bare. WorldCover class 60 allows up to 10% plant cover, so the
value means "bare or sparsely vegetated". Sites with no WorldCover tile (the
Antarctic Dry Valleys) get null.

This value is a site condition only. It never enters Terrain Match, the rank,
stability or the warning.

* ``uv run pipeline/landcover.py``                     -> results/landcover.json
* ``uv run pipeline/landcover.py --update-app-data``   -> also writes only
  conditions.bare_ground_share into frontend/public/data/sites.json (a full
  ``build.py`` rerun needs the raw DEMs under data/raw/)
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import requests
import yaml

ROOT = Path(__file__).resolve().parents[1]
SITES_PATH = ROOT / "config" / "sites.json"
WEIGHTS_PATH = ROOT / "config" / "weights.yaml"
OUT_PATH = ROOT / "results" / "landcover.json"
APP_SITES_PATH = ROOT / "frontend" / "public" / "data" / "sites.json"

WORLDCOVER_URL = (
    "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
    "ESA_WorldCover_10m_2021_v200_{tile}_Map.tif"
)
WORLDCOVER_TILE_DEG = 3
WORLDCOVER_RES_M = 10.0
# Same spherical radius as the terrain grid in terrain.py, so the windows coincide.
EARTH_RADIUS_M = 6_378_137.0

CLASS_NODATA = 0
CLASS_BARE = 60  # "Bare / sparse vegetation"
CLASS_WATER = 80  # "Permanent water bodies"


def tile_name(lat_floor: int, lon_floor: int) -> str:
    """WorldCover tiles are named by their lower-left corner, e.g. N36E015, S78E159."""
    ns = "N" if lat_floor >= 0 else "S"
    ew = "E" if lon_floor >= 0 else "W"
    return f"{ns}{abs(lat_floor):02d}{ew}{abs(lon_floor):03d}"


def tiles_for_bounds(west: float, south: float, east: float, north: float) -> list[str]:
    step = WORLDCOVER_TILE_DEG
    lat0 = int(math.floor(south / step) * step)
    lon0 = int(math.floor(west / step) * step)
    names = []
    for lat in range(lat0, int(math.ceil(north / step) * step), step):
        for lon in range(lon0, int(math.ceil(east / step) * step), step):
            names.append(tile_name(lat, lon))
    return names


def tile_exists(url: str) -> bool:
    """True if the tile exists, False on 404. Any other failure stops the run."""
    response = requests.head(url, timeout=30)
    if response.status_code == 404:
        return False
    response.raise_for_status()
    return True


def window_grid(lat: float, lon: float, km: float):
    from affine import Affine
    from rasterio.crs import CRS

    n = int(round(km * 1000.0 / WORLDCOVER_RES_M))
    half = n * WORLDCOVER_RES_M / 2.0
    transform = Affine(WORLDCOVER_RES_M, 0.0, -half, 0.0, -WORLDCOVER_RES_M, half)
    crs = CRS.from_proj4(
        f"+proj=aeqd +lat_0={lat} +lon_0={lon} +R={EARTH_RADIUS_M} +units=m +no_defs"
    )
    return transform, n, crs


def read_classes(lat: float, lon: float, km: float) -> tuple[np.ndarray | None, list[str], list[str]]:
    """Return (classes on the window grid or None, tiles used, tiles not available)."""
    import rasterio
    from rasterio.crs import CRS
    from rasterio.enums import Resampling
    from rasterio.warp import reproject, transform_bounds
    from rasterio.windows import from_bounds

    transform, n, dst_crs = window_grid(lat, lon, km)
    half = n * WORLDCOVER_RES_M / 2.0
    west, south, east, north = transform_bounds(
        dst_crs, CRS.from_epsg(4326), -half, -half, half, half, densify_pts=21
    )
    classes = np.zeros((n, n), dtype="uint8")
    used: list[str] = []
    absent: list[str] = []
    env = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif"}
    with rasterio.Env(**env):
        for name in tiles_for_bounds(west, south, east, north):
            url = WORLDCOVER_URL.format(tile=name)
            if not tile_exists(url):
                absent.append(name)
                continue
            with rasterio.open(f"/vsicurl/{url}") as src:
                win = from_bounds(west, south, east, north, src.transform)
                win = win.round_offsets().round_lengths()
                win = win.intersection(rasterio.windows.Window(0, 0, src.width, src.height))
                data = src.read(1, window=win)
                sample = np.zeros((n, n), dtype="uint8")
                reproject(
                    source=data, destination=sample,
                    src_transform=src.window_transform(win), src_crs=src.crs,
                    dst_transform=transform, dst_crs=dst_crs,
                    resampling=Resampling.nearest,
                    src_nodata=CLASS_NODATA, dst_nodata=CLASS_NODATA,
                )
            filled = sample != CLASS_NODATA
            classes[filled] = sample[filled]
            used.append(name)
    return (classes if used else None), used, absent


def source_text(km: float) -> str:
    return (
        f"ESA WorldCover 10 m 2021 v200 (CC BY 4.0); class 60 'Bare / sparse vegetation' "
        f"as a share of land cells (permanent water excluded) in the {km:g} km window; "
        f"nearest-neighbour {WORLDCOVER_RES_M:g} m"
    )


def site_bare_ground(lat: float, lon: float, km: float) -> dict[str, Any]:
    classes, used, absent = read_classes(lat, lon, km)
    if classes is None:
        return {
            "value": None, "tier": "missing", "source": None,
            "tiles": used, "tiles_absent": absent,
            "note": "no ESA WorldCover tile covers this window",
        }
    total = int(classes.size)
    nodata = int((classes == CLASS_NODATA).sum())
    water = int((classes == CLASS_WATER).sum())
    bare = int((classes == CLASS_BARE).sum())
    land = total - nodata - water
    value = bare / land if land > 0 else None
    return {
        "value": value,
        "tier": "computed" if value is not None else "missing",
        "source": source_text(km) if value is not None else None,
        "counts": {"bare": bare, "land": land, "water": water, "nodata": nodata, "total": total},
        "tiles": used, "tiles_absent": absent,
    }


def bare_ground_value(row: dict[str, Any] | None) -> dict[str, Any]:
    """The contract's Value object for conditions.bare_ground_share (used by build.py too)."""
    if not row or row.get("value") is None or not math.isfinite(float(row["value"])):
        return {"value": None, "tier": "missing", "source": None}
    return {"value": float(row["value"]), "tier": row["tier"], "source": row["source"]}


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def update_app_data(results: dict[str, dict[str, Any]]) -> None:
    sites = json.loads(APP_SITES_PATH.read_text(encoding="utf-8"))
    for site in sites:
        site["conditions"]["bare_ground_share"] = bare_ground_value(results.get(site["id"]))
    write_json(APP_SITES_PATH, sites)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--update-app-data", action="store_true",
                        help="also write conditions.bare_ground_share into frontend/public/data/sites.json")
    args = parser.parse_args()

    km = float(yaml.safe_load(WEIGHTS_PATH.read_text(encoding="utf-8"))["main_window_km"])
    sites = json.loads(SITES_PATH.read_text(encoding="utf-8"))["earth"]
    results: dict[str, dict[str, Any]] = {}
    for site in sites:
        row = site_bare_ground(float(site["lat"]), float(site["lon"]), km)
        if row["value"] is not None and not 0.0 <= row["value"] <= 1.0:
            raise ValueError(f"bare_ground_share for {site['id']} is outside [0, 1]: {row['value']}")
        results[site["id"]] = {"window_km": km, **row}

    write_json(OUT_PATH, results)
    print(f"{'site_id':<16} {'bare share':>10} {'land cells':>11} {'water':>7} {'nodata':>7}  tiles")
    for site_id, row in results.items():
        counts = row.get("counts", {})
        share = "missing" if row["value"] is None else f"{row['value']:.3f}"
        tiles = ",".join(row["tiles"]) + (f" (absent: {','.join(row['tiles_absent'])})" if row["tiles_absent"] else "")
        print(f"{site_id:<16} {share:>10} {counts.get('land', '-'):>11} {counts.get('water', '-'):>7} "
              f"{counts.get('nodata', '-'):>7}  {tiles}")
    print(f"wrote {OUT_PATH.relative_to(ROOT)}")
    if args.update_app_data:
        update_app_data(results)
        print(f"updated conditions.bare_ground_share in {APP_SITES_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
