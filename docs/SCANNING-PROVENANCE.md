# Candidate scan provenance and replay

Issue #58 adds an opt-in run record for the bounded Earth candidate scan. It records how the existing pipeline moves from DEM windows to selection decisions; it does not change the formula, filter values, target order, tie-breaks, shortlist limits, or publication IDs.

## Record a run

With the already-authorized DEM tiles present locally:

```sh
uv run pipeline/scan.py --record-provenance
```

This writes `results/scan-provenance.json` in addition to the normal scan outputs. For evidence-only work that must not write the app catalogue, candidate result file, hillshades, or relief assets, use:

```sh
uv run pipeline/scan.py --record-provenance --research-only
```

The research-only mode still reads the local DEMs and performs the same selective WorldCover lookups as the scanner. It writes only the provenance JSON; do not use it without the needed inputs/network availability. Provenance mode computes SHA-256 over every local DEM tile, so enabling it reads each tile once for its fingerprint before the scan.

The artifact includes commit/working-tree identity, relevant pipeline file hashes and package versions; hashes and effective values for config/targets/known-site manifest; the baseline app candidate IDs/coordinates; scan grid information; each window's coordinate, projected grid transform, descriptors, eligibility/exclusion reason; score ordering and target order; selection decisions including spacing/region limits and shortlist truncation; WorldCover lookup order, response status, cache reuse and response fingerprints; and final candidate descriptor/result identity when normal publication generation runs. DEM rasters themselves are never copied into the artifact.

## Replay and compare to the starting app catalog

```sh
uv run pipeline/scan_replay.py results/scan-provenance.json
```

Replay uses only the recorded eligible window descriptors and recorded WorldCover responses. It makes no DEM reads, network requests, or app-data writes. It reports whether selected window IDs **and order** match the recorded selection. It also reports the count and IDs of location matches/differences against the candidate catalogue fingerprinted at the start of the run. Location identity uses the scan's five-decimal window-center precision. Candidate catalog order is not compared with selection order: generated app IDs/catalog order are assigned later from region and selection scores.

If the run stopped on a lookup error, a response fingerprint is wrong, or replay needs a lookup that was not recorded, the command reports incomplete evidence rather than treating the window as a pass. A different selected order with complete evidence is a mismatch to investigate, not permission to publish a replacement catalogue.

## Interpretation and limits

The existing app contains a set of 12 proposed Earth reference/test areas and 18 DEM-scan candidates documented in `docs/VALIDATION.md`. The reference-area rationale and coordinate confidence are a separate evidence question; this scan record does not establish why those 12 areas were originally chosen. The current checkout may lack raw DEM tiles and `results/candidates.json`, and the original run may have no complete per-window/WorldCover record. In that case this tool cannot retroactively prove how the historical 18 were selected. A new complete run can be replayed and its selected locations compared with the app catalogue present at that run's start.

The scan's selection order is target-order-dependent and selection-internal. It is not the frontend's combined ranking of known sites and candidates, a global search result, independent evidence of analogue relevance, or field-suitability evidence. The replay test uses synthetic descriptors to exercise decisions; it does not stand in for a raw-data run.
