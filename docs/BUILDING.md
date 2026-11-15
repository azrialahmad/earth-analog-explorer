# Rebuilding the app's published data

`pipeline/build.py` writes the static JSON and terrain assets used by the frontend. Run it with `uv`; a full rebuild needs the authorized raw inputs and intermediate results already present in the data-owning checkout.

## Terrain producer migration hold (#57)

The square-window correction in `terrain.build_row` changes the summary footprint
from row-only cropping to cropping both axes. The checked-in `results/terrain.json`
and published terrain measurements under `frontend/public/data/` still come from
the **pre-fix producer** (baseline `e305c6a`); merging the code fix does not migrate
those data. Both Earth sites/candidates and lunar targets are affected. Jezero
uses a separate, already-two-axis implementation.

**Do not partly regenerate or publish terrain data with the corrected producer.**
In particular, do not replace only Earth rows, only targets, or a subset of
candidate windows while retaining the other pre-fix measurements. Running
`pipeline/terrain.py` without `--selftest` rewrites the terrain intermediate; it is
not a harmless check. An explicit reference-only build is not a workaround for
this migration hold.

Keep the current published release unchanged until the owners approve a coherent
regeneration and release disposition on [#57](https://github.com/azrialahmad/earth-analog-explorer/issues/57).
That requires authorized candidate/source inputs, code-generated measurement and
selection/rank impact evidence, and staged publication checks. The remaining
scan/final resampling decision is separate from the square-crop bug fix. Existing
publication checks protect file integrity, not mixed-producer scientific consistency.

## Candidate input is explicit

The normal command is:

```sh
uv run pipeline/scan.py
uv run pipeline/build.py
```

The build now requires a readable, non-empty `results/candidates.json` by default. A missing, malformed, empty, duplicated-ID, or invalid candidate list fails before publication. Missing candidates are not treated as proof that the intended release has no candidates.

Only when a reference-only release is deliberate, run:

```sh
uv run pipeline/build.py --reference-only
```

This explicitly omits scan candidates from the generated site catalogue. It does not edit `results/candidates.json`, alter the scoring method, or delete old unreferenced display assets. Review the generated site list before publishing that release.

## Staging and failure behavior

The build copies the current public data/image directories to a temporary staging area, generates JSON and display assets there, then checks output IDs, finite JSON values, and every non-empty referenced hillshade/relief/evidence-image path. The checked JSON/assets are then installed from staging. A generation or pre-publication check failure leaves the live public directories untouched.

The data and image directory replacements are sequential filesystem operations, **not one atomic operation**. If a replacement raises during the running build, it attempts to restore both prior directories before returning an error. If restoration itself fails, the error names the retained `.build-backup-*` directory under `frontend/`; preserve that backup and restore the previous `data/` and `img/` trees before another build. Do not publish while a build reports an error or recovery is incomplete. This rollback does not claim protection against power loss or forced process termination between directory renames.

Temporary `.build-stage-*` and `.build-backup-*` directories are created under `frontend/`, outside `frontend/public/` and on the same filesystem as the live output. If a process is forcibly terminated, inspect these directories before cleanup; do not remove the only copy of the previous `data/` or `img/` output. The numbered backup entries correspond to `data` (0) and `img` (1).

## Inputs and checks

The terrain, lighting, site manifest and weights inputs are required. Mars terrain and land-cover results retain their existing optional/missing-value behavior. A full terrain/asset rebuild also needs the relevant raw elevation inputs; this command does not fetch them. Candidate relief and hillshade references must resolve to files in the staged public assets, usually carried over from the scan step.

Run the focused synthetic publication checks and pipeline checks:

```sh
uv run pipeline/build.py --selftest
uv run python -m compileall pipeline
```

For a release, also run the frontend checks in `AGENTS.md`, inspect the generated JSON and asset paths, and verify there are no `NaN` or `Infinity` values. A failed build is not a new release; fix the missing/invalid prerequisite or explicitly choose `--reference-only` when that output is intended.
