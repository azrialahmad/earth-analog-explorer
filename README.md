# Earth Analog Explorer

NASA Space Apps 2026 entry for the challenge *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars*.

**Live app:** http://azrialahmad.is-a.dev/earth-analog-explorer/ (GitHub Pages, deployed from `main`)

## What it does

The app ranks 12 Earth test sites by how closely their terrain matches a target. The targets are Shackleton rim and Malapert massif near the lunar south pole, and Jezero crater floor on Mars. It is a ranking within these 12 sites, not a search of all of Earth.

- **Terrain Match (0 to 1):** a weighted mean of three similarities, computed over a 6 km window: mean slope, 90th-percentile slope, and roughness at 150 m. The weights, ranges and thresholds are provisional defaults in [`config/weights.yaml`](config/weights.yaml), and the Weights panel re-ranks live.
- **Low-sun share:** the share of daylight hours with the sun under 10°. Earth sites are computed with pvlib, and Moon and Mars targets from NASA NAIF SPICE ephemerides. Both lunar targets are 1.0, because the sun never rises above 10° there.
- **Mismatch warning:** for Moon targets only, the app warns when Terrain Match is at least 0.80 but low-sun share is under 0.25: the ground matches but the light doesn't. For Mars, lighting is not compared; Jezero's value is shown for reference only.
- **Bare-ground share:** the share of land in the 6 km window classed as bare or sparse vegetation (under 10% plant cover) by ESA WorldCover. It is shown in the Data panel as a site condition and does not enter the score. The McMurdo Dry Valleys is "missing", because WorldCover does not cover that part of Antarctica.
- **Top-3 stability:** how often a site stays in the top 3 when the weights and values are perturbed. It measures how sensitive the rank is; it is not a probability.

**Layout:**
- Left: the ranked list.
- Centre: two linked 3D views of the real elevation relief, target and selected site.
- Right: the selected site's details.
- Narrow screens switch between these with Sites / View / Details tabs.
- The Data, Evidence and Ask AI panels open from the toolbar.

Unknown values are shown as "missing", never filled in. Every dataset is listed with its owner, link and licence in [docs/REFERENCES.md](docs/REFERENCES.md). The proof-of-concept results are summarised in [docs/VALIDATION.md](docs/VALIDATION.md).

## Run the app

```bash
cd frontend
npm ci
npm run dev
```

Checks: `npx tsc -b && npm test && npm run build`. The app reads the prebuilt JSON in `frontend/public/data/`, so it needs no Python or raw data.

## Rebuild the data (pipeline)

The pipeline uses Python with [uv](https://docs.astral.sh/uv/). Run `uv sync` first.

| Step | Command | Needs |
|---|---|---|
| Terrain numbers | `uv run pipeline/terrain.py` | LOLA, SRTM and Copernicus DEMs under `data/raw/` |
| Jezero terrain | `uv run pipeline/mars.py` | Mars 2020 CTX DTM under `data/raw/mars/` |
| Low-sun share | `uv run pipeline/lighting.py` | NAIF kernels under `data/raw/spice/` (about 46 MB) |
| Bare-ground share | `uv run pipeline/landcover.py` | Network access: it reads only each site's window from the ESA WorldCover cloud files |
| App data and images | `uv run pipeline/build.py` | All of the above results |

- **Downloads:** `data/raw/` is git-ignored. [docs/REFERENCES.md](docs/REFERENCES.md) lists where each file comes from.
- **Partial updates:** `lighting.py` and `landcover.py` take `--update-app-data`, which writes only their own fields into `frontend/public/data/`: the targets' low-sun share, and the sites' bare-ground share. Use it when the raw DEMs are not available for a full `build.py` run.

## Contributing

Work is tracked in the issues. Contributors and agents: read [AGENTS.md](AGENTS.md) first.
