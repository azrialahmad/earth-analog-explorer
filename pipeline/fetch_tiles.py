#!/usr/bin/env python3
"""Download the extra DEM tiles listed in config/scan_regions.json (issue #48).

* |lat| <= 60: NASA SRTM 1 arc-second from the AWS Skadi mirror -> data/raw/srtm/
* otherwise:   Copernicus GLO-30 COG from AWS                 -> data/raw/copernicus/

Tiles already present are skipped. A tile the mirror does not have (all sea) is
reported and skipped.

* ``uv run pipeline/fetch_tiles.py``
"""
from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
REGIONS_PATH = ROOT / "config" / "scan_regions.json"
SRTM_DIR = ROOT / "data" / "raw" / "srtm"
COPERNICUS_DIR = ROOT / "data" / "raw" / "copernicus"
SKADI_URL = "https://s3.amazonaws.com/elevation-tiles-prod/skadi/{lat}/{name}.hgt.gz"
COPERNICUS_URL = "https://copernicus-dem-30m.s3.amazonaws.com/{stem}/{stem}.tif"


def tile_lat(name: str) -> int:
    return int(name[1:3]) * (1 if name[0] == "N" else -1)


def copernicus_stem(name: str) -> str:
    return f"Copernicus_DSM_COG_10_{name[0:3]}_00_{name[3:7]}_00_DEM"


def fetch(name: str) -> str:
    if abs(tile_lat(name) + 0.5) <= 60.0:
        out = SRTM_DIR / f"{name}.hgt"
        url = SKADI_URL.format(lat=name[0:3], name=name)
    else:
        stem = copernicus_stem(name)
        out = COPERNICUS_DIR / f"{stem}.tif"
        url = COPERNICUS_URL.format(stem=stem)
    if out.exists():
        return f"{name}: present"
    response = requests.get(url, timeout=120)
    if response.status_code in (403, 404):
        return f"{name}: not on the mirror (HTTP {response.status_code}), skipped"
    response.raise_for_status()
    data = gzip.decompress(response.content) if url.endswith(".gz") else response.content
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(out.suffix + ".part")
    tmp.write_bytes(data)
    tmp.replace(out)
    return f"{name}: {len(response.content) / 1e6:.1f} MB downloaded -> {out.relative_to(ROOT)}"


def main() -> int:
    regions = json.loads(REGIONS_PATH.read_text(encoding="utf-8"))["regions"]
    for region in regions:
        for name in region["tiles"]:
            print(f"{region['id']:<14}{fetch(name)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
