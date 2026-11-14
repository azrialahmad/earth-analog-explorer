#!/usr/bin/env python3
"""P2 - annual low-sun share for Earth sites (issue #3) and targets (issue #43).

low_sun_share = hourly samples with geometric solar elevation above 0 degrees and
at most 10 degrees, divided by the samples above 0 degrees. No terrain shading or
weather is applied.

* Earth sites: pvlib solar position, hourly 2026 UTC samples.
* Moon and Mars targets: NASA NAIF SPICE kernels read with spiceypy. The site is
  the point on the body's reference surface at the target coordinates; the sun's
  apparent direction (light time and aberration) is rotated into the body-fixed
  frame (MOON_ME, the LOLA frame, or IAU_MARS) and measured against the surface
  normal. Moon: hourly 2026 UTC samples (the Moon's year around the Sun is the
  Earth year). Mars: hourly samples over one Mars year from 2026-01-01 UTC, so
  each season counts once. The maximum sun elevation is recorded so the polar
  "sun always under 10 degrees" result can be checked.

The kernels live in data/raw/spice/ (git-ignored); see docs/REFERENCES.md.

Run ``uv run pipeline/lighting.py`` to write ``results/lighting.json`` and
print the summary.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import pandas as pd
import pvlib

ROOT = Path(__file__).resolve().parents[1]
SITES_PATH = ROOT / "config" / "sites.json"
OUT_PATH = ROOT / "results" / "lighting.json"
TERRAIN_PATH = ROOT / "results" / "terrain.json"
APP_TARGETS_PATH = ROOT / "frontend" / "public" / "data" / "targets.json"
MARS_TARGET_NOTE = (
    "Terrain only. Lighting is not compared for Mars targets; low-sun share is shown for reference."
)
YEAR = 2026
LOW_SUN_MAX_ELEVATION_DEG = 10.0
EARTH_SOURCE = (
    "pvlib solar position; hourly UTC samples in 2026; geometric elevation; "
    "no terrain shading or weather"
)
SPICE_DIR = ROOT / "data" / "raw" / "spice"
SPICE_KERNELS = (
    "naif0012.tls",               # leap seconds
    "pck00011.tpc",               # body radii; IAU 2015 Mars orientation
    "de440s.bsp",                 # Sun, Earth-Moon and Mars positions (DE440)
    "moon_pa_de440_200625.bpc",   # lunar orientation (DE440)
    "moon_de440_250416.tf",       # MOON_ME frame definition
)
SPICE_START_UTC = f"{YEAR}-01-01T00:00:00"
MARS_YEAR_DAYS = 686.98
# observer: an ephemeris object at the body's centre (Mars uses its system barycenter,
# which is within metres of the planet's centre); frame: the body-fixed frame.
SPICE_BODIES = {
    "moon": {"name": "MOON", "id": 301, "observer": "MOON", "frame": "MOON_ME", "hours": 365 * 24},
    "mars": {"name": "MARS", "id": 499, "observer": "MARS BARYCENTER", "frame": "IAU_MARS",
             "hours": int(round(MARS_YEAR_DAYS * 24))},
}
SPICE_SOURCES = {
    "moon": (
        "NASA NAIF SPICE: DE440 ephemeris and DE440 lunar orientation (MOON_ME); "
        "hourly UTC samples in 2026; geometric elevation; no terrain shading"
    ),
    "mars": (
        "NASA NAIF SPICE: DE440 ephemeris and IAU 2015 Mars orientation (pck00011); "
        "hourly samples over one Mars year from 2026-01-01 UTC; geometric elevation; "
        "no terrain shading or dust"
    ),
}


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


def load_spice() -> Any:
    import spiceypy as spice

    missing = [name for name in SPICE_KERNELS if not (SPICE_DIR / name).exists()]
    if missing:
        raise FileNotFoundError(
            f"missing SPICE kernels in {SPICE_DIR}: {', '.join(missing)} (see docs/REFERENCES.md)"
        )
    spice.kclear()
    for name in SPICE_KERNELS:
        spice.furnsh(str(SPICE_DIR / name))
    return spice


def target_low_sun(spice: Any, body: str, latitude: float, longitude: float) -> dict[str, Any]:
    """Low-sun share for a Moon or Mars target, plus the numbers needed to check it."""
    spec = SPICE_BODIES[body]
    radii = spice.bodvrd(spec["name"], "RADII", 3)[1]
    point = spice.srfrec(spec["id"], math.radians(longitude), math.radians(latitude))
    normal = spice.surfnm(radii[0], radii[1], radii[2], point)
    start = spice.str2et(SPICE_START_UTC)

    elevations = []
    for hour in range(spec["hours"]):
        et = start + hour * 3600.0
        sun_inertial, _ = spice.spkpos("SUN", et, "J2000", "LT+S", spec["observer"])
        sun_fixed = spice.mxv(spice.pxform("J2000", spec["frame"], et), sun_inertial)
        to_sun = spice.vsub(sun_fixed, point)
        elevations.append(90.0 - math.degrees(spice.vsep(normal, to_sun)))

    daylight = [e for e in elevations if e > 0.0]
    low = [e for e in daylight if e <= LOW_SUN_MAX_ELEVATION_DEG]
    value = len(low) / len(daylight) if daylight else None
    return {
        "value": value,
        "tier": "computed" if value is not None else "missing",
        "source": SPICE_SOURCES[body] if value is not None else None,
        "max_elevation_deg": max(elevations),
        "daylight_hours": len(daylight),
        "samples": len(elevations),
    }


def target_coordinates(target: dict[str, Any]) -> tuple[float, float]:
    """Config coordinates, or the ones terrain.py located (Malapert is found from LOLA)."""
    if target.get("lat") is not None and target.get("lon") is not None:
        return float(target["lat"]), float(target["lon"])
    rows = json.loads(TERRAIN_PATH.read_text(encoding="utf-8"))
    row = next((r for r in rows if r["id"] == target["id"]), None)
    if row is None or row.get("lat") is None or row.get("lon") is None:
        raise ValueError(f"{target['id']} has no coordinates; run pipeline/terrain.py first")
    return float(row["lat"]), float(row["lon"])


def build_lighting(sites: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], list[tuple[str, float | None]]]:
    """Build a stable result mapping for Moon and Mars targets and Earth sites."""
    result: dict[str, dict[str, Any]] = {}
    earth_summary: list[tuple[str, float | None]] = []

    spice = load_spice()
    for body, key in (("moon", "lunar"), ("mars", "mars")):
        for target in sites.get(key, []):
            lat, lon = target_coordinates(target)
            result[target["id"]] = {"lat": lat, "lon": lon, **target_low_sun(spice, body, lat, lon)}
    spice.kclear()

    for site in sites["earth"]:
        value = annual_low_sun_share(float(site["lat"]), float(site["lon"]))
        result[site["id"]] = {
            "value": value,
            "tier": "computed" if value is not None else "missing",
            "source": EARTH_SOURCE if value is not None else None,
        }
        earth_summary.append((site["id"], value))

    return result, earth_summary


def update_app_targets(result: dict[str, dict[str, Any]]) -> None:
    """Write only the targets' low_sun_share (and the Mars note) into the app's targets.json.

    A full build.py rerun needs the raw DEMs under data/raw/; this keeps the two in step.
    """
    targets = json.loads(APP_TARGETS_PATH.read_text(encoding="utf-8"))
    for target in targets:
        entry = result.get(target["id"])
        if entry is None or "max_elevation_deg" not in entry:
            continue
        target["low_sun_share"] = (
            {"value": float(entry["value"]), "tier": entry["tier"], "source": entry["source"]}
            if entry["value"] is not None else {"value": None, "tier": "missing", "source": None}
        )
        if target.get("body") == "mars":
            target["note"] = MARS_TARGET_NOTE
    APP_TARGETS_PATH.write_text(json.dumps(targets, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Annual low-sun share for Earth sites and Moon/Mars targets.")
    parser.add_argument("--update-app-data", action="store_true",
                        help="also write the targets' low_sun_share into frontend/public/data/targets.json")
    args = parser.parse_args()

    with SITES_PATH.open(encoding="utf-8") as stream:
        sites = json.load(stream)

    result, summary = build_lighting(sites)
    for site_id, entry in result.items():
        value = entry["value"]
        if value is not None and (not math.isfinite(value) or not 0.0 <= value <= 1.0):
            raise ValueError(f"low_sun_share for {site_id} is outside [0, 1]: {value}")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")

    print("Low-sun share by target (SPICE; geometric; no terrain shading)")
    print(f"{'target_id':<16} {'low_sun_share':>14} {'max sun elev':>13} {'daylight h':>11}")
    for target_id, entry in result.items():
        if "max_elevation_deg" not in entry:
            continue
        shown = "missing" if entry["value"] is None else f"{entry['value']:.4f}"
        print(f"{target_id:<16} {shown:>14} {entry['max_elevation_deg']:>9.2f} deg {entry['daylight_hours']:>11}")

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
    if args.update_app_data:
        update_app_targets(result)
        print(f"Updated target low_sun_share in {APP_TARGETS_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
