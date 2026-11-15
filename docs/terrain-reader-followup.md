# Terrain reader follow-up and square-window correction

**Issue:** [#57](https://github.com/azrialahmad/earth-analog-explorer/issues/57) · **Baseline:** `e305c6acb259c3ee437d95d4f7073775c6ca59aa`

**Code:** `pipeline/terrain_reader_followup.py`, `pipeline/test_terrain_windows.py` · **Evidence:** `results/terrain-reader-followup.json`

**Split delivery:** the producer correction, square-window tests and migration-hold note are in [PR #118](https://github.com/azrialahmad/earth-analog-explorer/pull/118). Draft #116 contains only the diagnostic code, report, references and generated evidence relative to that prerequisite branch. Until #118 lands, #116 is stacked on `57-square-window-crop`; afterward it must be retargeted to `main`. Neither partial PR closes #57.

## Decision: partial correction, release migration still blocked

The bounded pass found a definite **one-axis summary crop defect** in `terrain.build_row`, corrected separately by #118. This diagnostic isolates contributions from automatic warp-kernel scaling and approximate transformation in the tested Earth reader comparisons. It does **not** approve a replacement resampling method, replay candidate selection, publish new measurements, or resolve all of #57.

No resampling options, coordinates, scientific/scoring formulas, config contracts, raw DEMs or published data/assets changed. In particular, the running app still has the previous measurements; this producer correction is not an app-data migration. Do not describe the current catalog or ranking as corrected by this patch.

## 1. Definite bug: a nominal square was a rectangle

`build_row` loads the largest window with a neighborhood buffer, computes slope/roughness, then summarizes each requested window. In NumPy, `z[s]` crops **rows only**. Columns still covered the full largest raster, including its horizontal buffer. This violated the existing square-footprint contract independently of any interpolation choice.

With the unchanged configured windows, 30 m cells and two-cell buffer:

| Nominal window | Previous summary shape | Correct square shape | Previous / correct cell capacity |
|---|---:|---:|---:|
| 3 km | 100 × 404 | 100 × 100 | 40,400 / 10,000 |
| 6 km | 200 × 404 | 200 × 200 | 80,800 / 40,000 |
| 12 km | 400 × 404 | 400 × 400 | 161,600 / 160,000 |

For example, the nominal 6 km footprint spanned 6 × 12.12 km of raster cells, not 6 × 6 km. Neighborhood-valid slope/roughness counts are separate from these cell capacities.

**Correction:** crop elevation, validity, slope and roughness as `[s, s]`; crop both axes in the fallback main summary too. Derivatives remain computed on the buffered largest raster **before** cropping. No interpolation or descriptor formula changed.

### Evidence of failure before, success after

- Four synthetic tests check exact square shapes and independent two-axis summaries, largest-window fallback, nodata outside the small square, and absent-source nulls. Shapes, counts and deterministic summaries require exact equality, not a fitted tolerance.
- Loading baseline `terrain.py` from `git show e305c6a:pipeline/terrain.py` and running the same test class produced **three failures out of four tests**, including `(100, 404)` versus `(100, 100)` and `(200, 404)` versus `(200, 200)`. The absent-source test passed. The checkout was not reverted for this check.
- After correction, all four pass. `terrain.py --selftest` invokes them, so the existing CI runs the regression without editing B-owned workflow files.
- `reference_footprint_impact` recomputes old and square summaries on the **same largest raster** for all 12 manifest Earth sites and both lunar targets. All stored terrain descriptors, for all three windows, exactly match the old row-only recomputation in this environment. Square recomputations are recorded separately, not written to `results/terrain.json` or public JSON.
- Lunar targets are affected because they share `build_row`; Jezero's separate `mars.build_result` already crops both axes and is not changed. This is a footprint correction, not a proposal to change target/site coordinates.

## 2. Remaining reader inconsistency: extent-sensitive interpolation

The original #56 reproducer compared **direct 6 km reads**. Production instead reads the buffered **12 km** raster and derives smaller-window descriptors. The follow-up separates:

1. Full source versus source crop on the same main destination grid.
2. Direct main destination versus the aligned main subarray of the largest destination, retaining its neighborhood buffer.
3. Scan-style main descriptors versus square final-style descriptors, plus legacy row-only summaries for comparison.

The reconstructed default full reader is checked for exact raster/mask equality against actual `read_earth_window`; the square descriptors are checked against actual `build_row`. For the generated scan-grid control, descriptors are also checked against the actual `scan_tile` generator, not just its reconstruction.

### Controlled interventions

GDAL documents `XSCALE`/`YSCALE` as controlling the number of source pixels considered by resampling. Their automatically computed values can vary with processing-chunk geometry. See [GDALWarpOptions](https://gdal.org/en/stable/doxygen/structGDALWarpOptions.html) (GDAL/OSGeo contributors; accessed 2026-11-15).

The diagnostic holds grids, input pixels, tile order and masks fixed, then varies only exact-transformer and unit-kernel controls. `tolerance=0` requests exact transformation; `XSCALE=YSCALE=1` removes automatic kernel widening. These are named diagnostic interventions, **not new production defaults or approved scientific settings**.

Maximum absolute elevation differences, in metres, between the scan-style direct main raster and the aligned main portion of the largest final raster:

| Case | Default | Exact transform only | Unit kernel only | Exact + unit kernel |
|---|---:|---:|---:|---:|
| Mauna Kea | 0.716064 | 0 | 0.716064 | 0 |
| Etna | 6.884521 | 6.001465 | 3.268677 | 0 |
| Yungay | 0.740356 | 0.735718 | 0.584961 | 0 |
| Askja (Copernicus) | 1.609131 | 0.016785 | 1.633789 | 0 |
| `cand_mauna_kea_1` | 0.338440 | 0 | 0.338440 | 0 |
| `cand_askja_2` (Copernicus) | 2.050171 | 0.015198 | 2.050537 | 0 |
| Generated SRTM scan-grid control | 0.812744 | 0 | 0.812744 | 0 |

All these comparisons have identical finite-cell masks. Source-crop/full differences on the direct main grid reproduce #56: zero for the interior controls, about 5.988 m at Etna and 0.734 m at Yungay. Exact transformation alone does not remove the affected crop/full differences. Neither intervention alone establishes consistent behavior across this tested set; together they yield exact parity here. This identifies scale-sensitive and transformer contributions, not a universally preferred interpolation method.

### Reference and mask limitations

An independent calculation inverse-transforms every destination cell center and performs explicit four-source-pixel point bilinear interpolation wherever all four neighbors exist and are finite. It is a reference **only for the unit-kernel control**. Automatic downsampling may intentionally consider more source pixels; disagreement with point interpolation is not by itself an error.

For exact-transform/unit-kernel results, all supported reference comparisons remain within the recorded roundoff budget: one float32 epsilon plus a float64 arithmetic allowance, scaled by the largest absolute four-neighbor elevation. This budget covers value arithmetic/output rounding only, not coordinate-transform error, scientific accuracy or aliasing. No numerical bound is used to excuse footprint or mask disagreements.

At each Etna/Yungay boundary, one source tile has 204 warp-valid cells without a complete four-pixel reference neighborhood. They are counted explicitly, not treated as reference agreement. Mosaic overwrite order is preserved; seam correctness is **not** established by this point reference. The synthetic control includes an interior nodata hole, full/crop and nested-grid parity, and deliberate elevation/mask mutations to check that the comparison detects failures.

## 3. Inputs, provenance and honest impact limits

- Only existing local inputs were used: the 16 cached Earth DEM tiles and the LOLA raw IMG, already listed with owners/links in `docs/REFERENCES.md`. No network source data, dependency, tool or raw download was added. GDAL documentation was consulted, not used as terrain data.
- The artifact records all used Earth files' hashes, CRS, transforms, bounds, resolution, units metadata and nodata tags; the LOLA raw-data contract comes from the existing reader and documented PDS-label description. No local PDS label accompanies this raw IMG. SRTM metadata does not establish a vertical datum; Copernicus has no nodata tag. No new datum equivalence is claimed.
- Code/config/input identities and library versions are recorded: Python 3.12.15, NumPy 2.5.4, Rasterio 1.5.2, GDAL 3.12.2. Computed terrain is in metres and degrees on the unchanged local 30 m grids. Source angular increments are not treated as metres.
- Approximate manifest coordinates remain approximate; candidate centers are not field-checked. Malapert uses the existing LOLA search with unchanged code and inputs.
- The seven available reader cases include SRTM boundary/interior controls, a real generated scan-grid center, two shipped candidates and Copernicus. `cand_afar_1` is explicitly missing `N13E040`; no partial source mosaic is accepted as complete coverage.
- Per-target scores in the artifact call the existing `scan.terrain_match` code with **frozen published target descriptors**. They are per-case sensitivity comparisons, not a coherent Earth-plus-target migration, candidate selection replay, or catalog rank-impact result. No ranks or candidate winners are inferred.
- `results/candidates.json` and the additional scan-region DEMs are unavailable locally. There was no full rescan, WorldCover lookup, selection replay, hillshade regeneration, or publication. Tests do not establish field suitability or scientific ranking accuracy.

## 4. Reproduction and checks

From the repository root, with the declared cached inputs and the square-crop prerequisite from #118 present:

```sh
uv sync --locked
uv run python -m compileall pipeline
uv run pipeline/terrain.py --selftest
uv run python -m unittest discover -s pipeline -p 'test_terrain_windows.py'
uv run pipeline/terrain_reader_diagnostic.py --selftest
uv run pipeline/terrain_reader_followup.py --selftest
uv run pipeline/terrain_reader_followup.py
uv run pipeline/scan.py --selftest
uv run pipeline/landcover.py --selftest
uv run pipeline/build.py --selftest
```

The follow-up writes only its research artifact by default. An alternate `--output` JSON destination must be outside the checkout; protected source/public paths cannot be selected. It fingerprints all raw/config/public data and image files before and after the run and refuses the report if they change. Hash streams are explicitly closed; a synthetic selftest checks their digest and absence of unclosed-file warnings.

Completed checks:

- Pipeline compilation and all listed selftests pass; before-fix failures are described above. The original #56 real-input diagnostic was rerun to an external temporary output and reproduced its boundary/interior findings.
- Two consecutive follow-up reports are byte-identical. All 93 raw/config/public data/image files also match the hashes frozen **before** diagnosis, not just within one execution.
- Strict parsing plus recursive finite-number checks pass for all 40 JSON files under `config/` and `frontend/public/data/`, and the new research artifact. Existing publication helpers pass asset-reference, unique-ID and output-shape checks on the unchanged public catalog.
- In `frontend/`: `npm ci`, `npx tsc -b`, `npm test` and `npm run build` pass; 186 tests in 16 files include existing Python-fixture/browser-engine scoring parity. The build retains its chunk-size warning. No new browser/deployed smoke test was performed because no app behavior or public data was published.

## 5. Gates still open for #57

1. A/B must accept a resampling contract and regression criteria for scan/final consistency. Forcing a unit kernel is not automatically an acceptable anti-aliasing/downsampling policy. The production reader is unchanged.
2. Obtain the authorized candidate inputs/DEMs needed for a coherent migration, or explicitly decide a different release disposition. Preserve coordinate caveats and do not fill missing inputs with guesses.
3. Separately approve regeneration of affected Earth **and lunar** measurements and relevant derived output. Report selection/rank/exclusion impact using the existing scorer; do not combine old targets or candidates with newly corrected measurements as a release.
4. If publication is approved, use the safe staged #55 path, repeat complete checks and perform the deployed smoke check before submission freeze.

**Recommendation:** accept/review the independently proven square-crop patch, but retain #57 as blocked for the unresolved reader and release-data gates. Alternatively, A/B must explicitly record a known-limitation release decision; that decision would not mean these remaining defects were fixed.
