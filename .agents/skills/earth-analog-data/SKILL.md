---
name: earth-analog-data
description: Implement or review Earth Analog Explorer terrain and lighting pipelines, Moon or Jezero elevation processing, sourced JSON and hillshade generation, reproducibility checks, and evidence documentation. Use for CRS, units, nodata, provenance, missing values, and pipeline-to-frontend contracts. Not for visual styling, frontend ranking formulas, new scientific experiments, or manual score editing.
---

# Earth Analog Data

Produce reproducible, sourced inputs to the app. Every number must be computed from authorized inputs, explicitly cited, or missing; plausibility is not evidence.

## Start from the active issue

Repository paths below are relative to `git rev-parse --show-toplevel`.

1. Read `AGENTS.md`, the active issue, its dependencies, and team comments using the filtered command in `AGENTS.md`.
2. Identify authorized inputs, outputs, methods, datasets, and checks. The issue is the task brief; do not expand it into new research or experiments.
3. Inspect the files that currently exist, especially relevant pipeline code, config, and `frontend/src/types.ts`. Respect owner boundaries and approval for shared contracts.
4. Check actual raw inputs and their metadata before running work. Do not assume a dataset, script, or output exists. If a prerequisite is missing and the issue does not create it, report the blocker instead of scaffolding unrelated work.

## Record inputs before computing

For each dataset, note its owner, source link, coverage, native CRS, units or datum, resolution, and nodata convention. Record target/site IDs, coordinates, and confirmation status from the active issue and current manifest. Preserve approximate-coordinate flags; do not claim human confirmation or move coordinates without authorization.

Do not commit raw data or put credentials in commands, logs, artifacts, or GitHub. Follow `AGENTS.md` for downloads and tools. Research notes provide context; a published value remains cited evidence, not a result computed by this pipeline.

## Terrain, lighting, and Mars

- Inspect raster CRS, bounds, resolution, data type, nodata, and elevation units before interpreting pixels. Degrees are not metres; check ground spacing and use the issue's local metric grid and planetary reference.
- Apply the issue's reprojection, resampling, windows, algorithms, solar schedule, year, and denominator. Read weights, ranges, and thresholds from the approved config; do not make duplicate defaults.
- Propagate validity masks through reprojection and neighborhood operations. Count invalid cells; never turn nodata into zero, silently fill holes, shrink windows, clamp outputs, or change methods to pass a check.
- Keep lunar by-definition lighting distinct from computed Earth lighting. Mars target lighting is null because lighting comparison is not applicable; never use it as zero or an ordinary failed measurement.
- For Jezero, inspect the Mars DTM metadata and projection, check ground spacing, count nodata per requested window, and preserve unavailable values as null. Follow the issue's coordinate-confirmation requirement.
- Use only datasets and fallbacks authorized by the issue. Do not change a source label to make substitute data appear equivalent.

## JSON, imagery, and evidence

- Match the current `frontend/src/types.ts`; if it is absent, report the dependency instead of inventing a schema.
- Keep IDs stable, output ordering deterministic, and generated JSON finite. Reject NaN and Infinity; use null for unavailable measurements and preserve the contract's distinct not-applicable meaning.
- Do not manually write or tune ranking scores. Scores come from the authorized Python pipeline and scoring code; do not put weights or thresholds in code.
- Preserve source, owner, tier, unit, and method for each value. List every used dataset in `docs/REFERENCES.md` with owner and link when authorized; state an unknown license as `not stated`.
- Generate hillshades only from authorized processed elevation inputs. Do not make imagery to disguise missing data.
- Keep cited model results, project tests, and flat-ground baselines separate. Report limitations and do not infer ranking accuracy from depth results.

## Verify

Run Python through `uv` only. Use the commands specified by the issue. The repo's pipeline check is:

```sh
uv sync
uv run python -m compileall pipeline
```

For data/pipeline changes, run the frontend checks too when the app exists, as required by `AGENTS.md`. Inspect generated output as well as exit status: IDs, units, finite numbers/nulls, sources, tiers, flags, nodata counts, and image paths. Compare repeated outputs when feasible and report if reproducibility was not checked.

Report changed files, input provenance, commands and results, limitations, and checks not completed. Follow `AGENTS.md` for issue scope, ownership, PR, and CI. Do not make frontend or scoring changes as a side effect of a data task.
