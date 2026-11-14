#!/usr/bin/env python3
"""P2 - annual low-sun share for Earth sites (issue #3).

For each Earth site, count hourly 2026 UTC samples with geometric solar
elevation above 0 degrees and at most 10 degrees, divided by the samples above
0 degrees. Solar position comes from pvlib; no terrain shading or weather is
applied. Lunar targets are recorded as by-definition values, not calculated.

Run ``uv run pipeline/lighting.py`` to write ``results/lighting.json`` and
print the Earth-site summary.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pandas as pd
import pvlib

ROOT = Path(__file__).resolve().parents[1]
SITES_PATH = ROOT / "config" / "sites.json"
OUT_PATH = ROOT / "results" / "lighting.json"
YEAR = 2026
LOW_SUN_MAX_ELEVATION_DEG = 10.0
EARTH_SOURCE = (
    "pvlib solar position; hourly UTC samples in 2026; geometric elevation; "
    "no terrain shading or weather"
)
LUNAR_SOURCE = "lunar obliquity about 1.5 degrees"


def annual_low_sun_share(latitude: float, longitude: float) -> float | None:
    """Calculate the annual fraction of daylight hours with sun elevation <= 10°.

    ``None`` is returned only when no hourly sample is above the horizon.
    """
    if not math.isfinite(latitude) or not -90.0 <= latitude <= 90.0:
        raise ValueError(f"latitude must be finite and between -90 and 90: {latitude}")
    if not math.isfinite(longitude) or not -180.0 <= longitude <= 180.0:
        raise ValueError(f"longitude must be finite and between -180 and 180: {longitude}")

    timestamps = pd.date_range(
        start=f"{YEAR}-01-01 00:00:00",
        periods=365 * 24,
        freq="h",
        tz="UTC",
    )
    position = pvlib.solarposition.get_solarposition(
        timestamps,
        latitude=latitude,
        longitude=longitude,
    )
    elevation = position["elevation"]
    daylight = elevation > 0.0
    daylight_hours = int(daylight.sum())
    if daylight_hours == 0:
        return None

    low_sun_hours = int((daylight & (elevation <= LOW_SUN_MAX_ELEVATION_DEG)).sum())
    return low_sun_hours / daylight_hours


def build_lighting(sites: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], list[tuple[str, float | None]]]:
    """Build a stable result mapping for lunar targets and Earth sites."""
    result: dict[str, dict[str, Any]] = {}
    earth_summary: list[tuple[str, float | None]] = []

    for target in sites["lunar"]:
        result[target["id"]] = {
            "value": 1.0,
            "tier": "by definition",
            "source": LUNAR_SOURCE,
        }

    for site in sites["earth"]:
        value = annual_low_sun_share(float(site["lat"]), float(site["lon"]))
        result[site["id"]] = {
            "value": value,
            "tier": "computed" if value is not None else "missing",
            "source": EARTH_SOURCE if value is not None else None,
        }
        earth_summary.append((site["id"], value))

    return result, earth_summary


def main() -> None:
    with SITES_PATH.open(encoding="utf-8") as stream:
        sites = json.load(stream)

    result, summary = build_lighting(sites)
    for site_id, entry in result.items():
        value = entry["value"]
        if value is not None and (not math.isfinite(value) or not 0.0 <= value <= 1.0):
            raise ValueError(f"low_sun_share for {site_id} is outside [0, 1]: {value}")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")

    print(f"Low-sun share by Earth site ({YEAR}; hourly UTC; no terrain shading/weather)")
    print(f"{'site_id':<16} {'low_sun_share':>14}")
    for site_id, value in summary:
        shown = "missing" if value is None else f"{value:.4f}"
        print(f"{site_id:<16} {shown:>14}")
        if value is not None and not 0.05 <= value <= 0.6:
            print(f"  REPORT: {site_id} is outside the expected 0.05–0.6 range ({value:.4f}).")
        elif value is None:
            print(f"  REPORT: {site_id} has no daylight samples; output is missing.")

    print(f"Wrote {OUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
