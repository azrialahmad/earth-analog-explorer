# Scan-style crop vs final Earth terrain reader

**Issue:** [#56](https://github.com/azrialahmad/earth-analog-explorer/issues/56)

**Code:** `pipeline/terrain_reader_diagnostic.py`

**Generated artifact:** `results/terrain-reader-diagnostic.json`

**Inputs:** existing local DEMs listed in `docs/REFERENCES.md`; no new data downloaded.

## Question and scope

Does source-window clipping before reprojection change the raster, terrain descriptors, or Terrain Match when the destination footprint is held fixed?

The diagnostic compares the current final reader (each full source tile reprojected onto the analysis grid, then mosaicked) with the scan-style source crop and bilinear reprojection, using the same 6 km destination footprint, 30 m grid, CRS, buffer, masks, and tile overwrite order. It also tests Rasterio's documented transformer `tolerance` at its default 0.125 pixels and at 0.0 pixels. Terrain Match comparisons call the existing `pipeline/scan.py` scorer against the three shipped targets; no score formula or production data is changed.

The cases are current approximate manifest coordinates: Mauna Kea as a one-tile control, plus Etna and Yungay where the 6 km footprint crosses SRTM tile edges. Their coordinates are not newly confirmed. The requested Afar candidate is recorded as unavailable because its local source tile (`N13E040`) is absent. No download was performed.

## Findings

All comparisons had the same 204 × 204 destination shape and 41,616 valid output cells, with no mask-only disagreements.

| Case | Source tiles | Mean absolute elevation difference | P95 | Maximum | Cells >1 m | Largest descriptor delta | Largest Terrain Match delta |
|---|---|---:|---:|---:|---:|---:|---:|
| Mauna Kea manifest center (single-tile control) | 1 | 0 m | 0 m | 0 m | 0 | 0 | 0 |
| N19W156 scan-grid center (single-tile control) | 1 | 0 m | 0 m | 0 m | 0 | 0 | 0 |
| Etna (tile edge) | 2 | 0.177 m | 0.810 m | 5.988 m | 1,244 | P90 slope: 0.0736° | 0.00359 |
| Yungay (tile edge) | 2 | 0.00924 m | 0.0614 m | 0.734 m | 0 | Roughness: 0.00156 m | 0.000279 |

The additional scanner-grid control is at 19.76357°N, 155.475°W, the `pipeline/scan.py` 6 km-grid center closest to Mauna Kea in tile N19W156. It lies 1.62 km from the manifest coordinate and satisfies the configured 7 km scan edge margin. It has exact full/cropped parity. This checks an actual scan-grid center, though not a historical selected candidate.

The Etna difference is isolated to source tile `N37E015`; its neighbor `N37E014` matches exactly between full and cropped reprojection. At Yungay, the measurable difference is on `S25W070`; `S25W071` matches exactly. Thus this run supports a **source-crop/full-tile reprojection difference for specific tile inputs**, with the largest effect in the Etna boundary case. It does not establish a single general cause or which reader output is preferable.

Changing transformer tolerance from 0.125 to 0.0 pixels did **not** remove or materially alter the crop/full difference: Etna's maximum remained about 5.996 m on the exact-transformer comparison; Yungay's remained about 0.734 m. The tolerance setting itself changed some cells (up to 0.663 m for Etna full-tile reprojection), so transformer approximation contributes differences in these cases, but is not a sufficient explanation for the larger crop/full discrepancy.

As a local reference check, the diagnostic also inverse-transforms destination pixel centers and evaluates the four surrounding valid source pixels with an explicit bilinear weighted sum. Five deterministic samples were selected per source tile. On `N37E015`, crop was closer to this reference at 4/5 samples and full-tile reprojection at 1/5; on `S25W070`, crop was closer at all 5. The chosen samples on the other contributing tiles were equal between both reprojected arrays. These sparse samples do not establish whole-window superiority for either path.

The descriptor and score changes are small for these individual comparisons. This report does not calculate candidate ordering or claim a rank change. The scoring deltas are per-site values against each target, not independent evidence that either path is correct.

## Interpretation and limitations

- This is a controlled **reader-path diagnosis**, not a replay of the historic scan, candidate selection, or WorldCover lookup sequence.
- The known-site Etna and Yungay centers are close to tile edges. The candidate scan normally keeps its sampled centers inside a single tile; these cases diagnose clipping/reprojection behavior and do not prove historical candidate results changed.
- Afar could not be processed because the needed local DEM tile is missing. Its current app entry alone does not reconstruct the original source raster or scan run.
- The direct control establishes parity for one interior single-tile case, not for every source or location. Only the listed local SRTM cases are tested here.
- SRTM rasters report elevations in metres and identify nodata `-32768`; the local HGT metadata does not record a vertical datum. The diagnostic preserves masked/nodata cells as invalid and does not fill them.
- The transformer-tolerance comparison and sparse direct bilinear samples narrow hypotheses but do not isolate GDAL's internal crop-extent behavior or establish a preferred reader for the whole window.
- No production values, coordinates, ranking, selection rules, or source code paths used by the app were modified.

## Recommendation for #57

**Go for a focused follow-up diagnosis, not yet a production reader replacement.** The evidence confirms reproducible differences on two source-tile crops, with one Etna tile producing several metre-scale pixel differences; the mechanism and preferred reference output remain unresolved. Next, compare GDAL-level transformer/warp behavior for the affected tile and reproduce on an explicitly selected scan window that satisfies scan edge margins. Keep Afar's missing input as an explicit gap unless the authorized DEM is supplied.

## Reproduction

With the authorized local input files present under `data/raw/`:

```sh
uv sync
uv run pipeline/terrain_reader_diagnostic.py --selftest
uv run pipeline/terrain_reader_diagnostic.py
```

The command writes only `results/terrain-reader-diagnostic.json`; it does not write candidate/public app data, make network requests, or alter input DEMs. The JSON records source file hashes and metadata, code/config hashes, library versions, grids, masks, per-tile comparisons, sparse direct-bilinear samples, descriptor deltas, and per-target score deltas.
