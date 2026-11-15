# Earth Analog Explorer

NASA Space Apps 2026 entry for the challenge *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars*.

**Live app:** https://azrialahmad.is-a.dev/earth-analog-explorer/ (GitHub Pages, deployed from `main` on every merge). Ask AI is served by a Vercel function (see **Ask AI hosting** below).

**Release described here:** `main` at `e305c6a` (2026-11-15). The app data in `frontend/public/data/` is unchanged since `588e4a5`, the revision checked on the live app for #82, so the counts below still hold.

## What it does

The app ranks Earth sites by how closely their terrain matches a target. The targets are Shackleton rim and Malapert massif near the lunar south pole, and Jezero crater floor on Mars. The 30 Earth sites are 12 from an initial list of places reported as analog test areas and 18 candidates found by scanning our DEM tiles with the same terrain method (see **New candidates** below). All 30 are ranked together in one list. It is not a search of all of Earth, and a high Terrain Match is a terrain similarity, not a rating of whether a site is suitable or safe.

- **Terrain Match (0 to 1):** a weighted mean of three similarities, computed over a 6 km window: mean slope, 90th-percentile slope, and roughness at 150 m. The weights, ranges and thresholds are provisional defaults in [`config/weights.yaml`](config/weights.yaml), and the Weights panel re-ranks live.
- **Low-sun share:** the share of daylight hours with the sun under 10°. Earth sites are computed with pvlib, and Moon and Mars targets from NASA NAIF SPICE ephemerides. Both lunar targets are 1.0, because the sun never rises above 10° there.
- **Mismatch warning:** for Moon targets only, the app warns when Terrain Match is high but low-sun share is low: the ground matches but the light doesn't. The two thresholds are in `config/weights.yaml` (currently Terrain Match at least 0.80 and low sun under 0.25). For Mars, lighting is not compared; Jezero's value is shown for reference only.
- **Bare-ground share:** the share of land in the 6 km window classed as bare or sparse vegetation (under 10% plant cover) by ESA WorldCover. It is shown in the Data panel as a site condition and does not enter the score. The McMurdo Dry Valleys is "missing", because WorldCover does not cover that part of Antarctica.
- **New candidates:** `pipeline/scan.py` cuts every Earth DEM tile under `data/raw/` into 6 km windows and computes the same three terrain numbers for each. It drops windows with DEM gaps, windows that look like water, and windows close to a known site. For each target it keeps the best Terrain Match windows that are spread apart and mostly bare ground (ESA WorldCover). The app ranks them in one list with the known sites, using the same engine; each site's details say whether it came from the initial list or from the scan. These are terrain and land-cover matches only: nobody has checked them on imagery or in the field. It scans the tiles around the known sites plus 11 extra regions listed in `config/scan_regions.json` (downloaded with `uv run pipeline/fetch_tiles.py`), not all of Earth. All scan settings are in the `scan:` section of `config/weights.yaml`.
- **Top-N stability:** how often a site stays in the top N (currently 3, set in `config/weights.yaml`) when the weights and values are perturbed. It measures how sensitive the rank is; it is not a probability.
- **Ask AI:** a chat panel that answers questions about the current analysis. Each question is sent with the active target, weights and whole ranking, and each answer shows the **Context used**. The AI cannot change a score. It can ask the ranking engine to rerun with other weights, and the engine computes those results. If you change the target or weights, a pending question is cancelled, and earlier answers keep the context they were given.

**Layout:**
- Left: the ranked list.
- Centre: two linked 3D views of the real elevation relief, target and selected site.
- Right: the selected site's details.
- Narrow screens switch between these with Sites / View / Details tabs.
- The Weights, Data, Evidence and Ask AI panels and the guided demo open from the toolbar.

## Walk through the live app

1. Open the live app. It starts on **Shackleton rim** with the site list ranked for it. The first row is selected, and the centre shows the target's and the site's elevation relief side by side.
2. Pick another row. The row, the two 3D views and the details on the right all switch to that site. The details explain the rank: the per-parameter table, the formula, the neighbours above and below, and where the entry came from (the initial list or the scan).
3. Look for a **Light mismatch** chip on a row. Open that site: the Lighting section compares its low-sun share with the target's. Press **Polar sun** to light both views with a low sun under a black sky. This is display lighting only.
4. Open **Weights** and move a slider. The list re-ranks at once, and the selected site stays selected.
5. Switch to **Jezero crater floor** (Mars). Terrain ranks the same way, and lighting is shown for reference only, with no warning.
6. Open **Data** for exact values, sources, hillshades and land cover, and **Evidence** for the depth-model results. The play button runs the same tour automatically, using the live numbers.
7. Open **Ask AI** and try an example question, such as what changes if roughness counts three times as much. Expand **Context used** under the answer to see the target and weights it was given.

On a phone the list, the 3D views and the details are behind the **Sites / View / Details** tabs.

## What this release does not do

- **Terrain only.** The ranking uses the three terrain parameters. Low sun and bare ground are shown next to it and do not change it. Both owners agreed to keep it that way for this release (#53, [docs/MATCHING-SPEC-ASSESSMENT.md](docs/MATCHING-SPEC-ASSESSMENT.md)): no combined score, and no date-specific, seasonal or forecast mode.
- **Open terrain-reader work.** #57 tracks a correction to how terrain windows are read. The shipped numbers have not been regenerated for it; see [docs/terrain-reader-diagnostic.md](docs/terrain-reader-diagnostic.md).
- **Bounded catalog.** The scan covered the tiles around the known sites plus 11 chosen regions, not all of Earth. Nobody has checked the candidates on imagery or in the field.
- **Provisional settings.** Weights, ranges and thresholds are provisional defaults.

Unknown values are shown as "missing", never filled in; [docs/COMPARISON-POLICY.md](docs/COMPARISON-POLICY.md) records how missing data is handled in comparisons (#54). Every dataset is listed with its owner, link and licence in [docs/REFERENCES.md](docs/REFERENCES.md). Method notes and evidence from the data side:
- [docs/VALIDATION.md](docs/VALIDATION.md): proof-of-concept results and the candidate scan's counts and limits.
- [docs/SCORING-FIXTURES.md](docs/SCORING-FIXTURES.md): the test-only fixtures that check the browser engine scores the same as the Python scoring code.
- [docs/earth-catalog-audit.md](docs/earth-catalog-audit.md): why each Earth entry is in the catalog.
- [docs/SCANNING-PROVENANCE.md](docs/SCANNING-PROVENANCE.md): how to record and replay a scan run.
- [docs/BUILDING.md](docs/BUILDING.md): how `build.py` publishes the app data safely.

## Run the app

```bash
cd frontend
npm ci
npm run dev
```

Checks: `npx tsc -b && npm test && npm run build`. `npm test` includes end-to-end checks over the shipped data (`src/shipped.test.tsx`) and a check that the browser engine matches the Python scoring fixtures (`src/engine/parity.test.ts`). The app reads the prebuilt JSON in `frontend/public/data/`, so it needs no Python or raw data.

Ask AI works locally too: the dev server runs the API once `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL` are set in `frontend/.env.local` (see `frontend/.env.example`). Without them the panel says "Ask AI is not configured". Never commit real keys.

## Ask AI hosting

The app is on GitHub Pages, which only serves static files, so the Ask AI API (`frontend/api/ask.ts`) runs as a Vercel function (issue #109). This is set up for the live app; the steps below are how to set it up again or for a fork.

1. **Vercel project:** import this repository and set **Root Directory** to `frontend`. Vercel builds the Vite app too, but only `api/ask.ts` is used.
2. **Vercel environment variables:**
   - `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL` for the provider;
   - `ASK_ALLOWED_ORIGINS=https://azrialahmad.is-a.dev`, so only the live app can call the API from a browser.
3. **GitHub repository variable `ASK_URL`:** set it to `https://<project>.vercel.app/api/ask`. This is a URL, not a secret. The next Pages build reads it.

The API caps request size, message count and answer length, but anyone with the URL can still call it from a script. Set a spending limit at the provider.

## Rebuild the data (pipeline)

The pipeline uses Python with [uv](https://docs.astral.sh/uv/). Run `uv sync` first.

| Step | Command | Needs |
|---|---|---|
| Terrain numbers | `uv run pipeline/terrain.py` | LOLA, SRTM and Copernicus DEMs under `data/raw/` |
| Jezero terrain | `uv run pipeline/mars.py` | Mars 2020 CTX DTM under `data/raw/mars/` |
| Low-sun share | `uv run pipeline/lighting.py` | NAIF kernels under `data/raw/spice/` (about 46 MB) |
| Bare-ground share | `uv run pipeline/landcover.py` | Network access: it reads only each site's window from the ESA WorldCover cloud files |
| Extra scan tiles | `uv run pipeline/fetch_tiles.py` | Network access; about 260 MB from the AWS SRTM and Copernicus mirrors |
| New candidates | `uv run pipeline/scan.py --update-app-data` | The Earth DEM tiles under `data/raw/`, plus network access for WorldCover |
| App data and images | `uv run pipeline/build.py` | All of the above results, including a non-empty `results/candidates.json` (or pass `--reference-only` on purpose); see [docs/BUILDING.md](docs/BUILDING.md) |

- **Downloads:** `data/raw/` is git-ignored. [docs/REFERENCES.md](docs/REFERENCES.md) lists where each file comes from.
- **Partial updates:** `lighting.py` and `landcover.py` take `--update-app-data`, which writes only their own fields into `frontend/public/data/`: the targets' low-sun share, and the sites' bare-ground share. Use it when the raw DEMs are not available for a full `build.py` run.

## Contributing

Work is tracked in the issues. Contributors and agents: read [AGENTS.md](AGENTS.md) first.
