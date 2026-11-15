# Purpose-specific matching: A-side assessment for discussion

**Status:** personal assessment/proposal from owner A; **not** an A/B decision, approved method, scientific result, or authorization to implement a new metric. Prepared for issue #53 against `main` at `582503136132b786f1734a79eaf64f597430f30d` (2026-11-15). Request for owner B's response is recorded on issue #53.

## Executive assessment

The project can responsibly describe its current output as a **terrain-based shortlist**. The current app does not establish which location is the best, safest, or most representative field analogue for every task. Expanding the rank before naming a concrete user task would risk combining measurements that answer different questions and have different spatial/temporal support.

My A-side proposal is to frame the product as helping a planetary field-test planner **inspect Earth locations for a declared test task**:

1. Keep **Terrain Match** as a separately visible, unchanged measure of terrain-descriptor similarity to the selected Moon or Mars target.
2. Show any task conditions separately with their own meaning, period, source, coverage, and limitations.
3. Do not ship a combined multi-factor score in the first checkpoint. Reconsider an aggregate only after the two owners resolve the guidance conflict below and accept the factor, eligibility, and denominator policies in #54 and #70.

This is a proposal, not evidence that a task-specific factor improves decisions. A suitable label for the broader product concept could be **Experiment Planning**. If the owners want a name for a future aggregate, **Task Match** is a provisional option only; it must not imply probability of success, universal analogue quality, field access, or safety. The current score remains Terrain Match.

## What exists in the current release

Sources inspected: `README.md`, `docs/VALIDATION.md`, `docs/REFERENCES.md`, `config/weights.yaml`, `frontend/src/types.ts`, `frontend/src/engine/scoring.ts`, `frontend/public/data/sites.json`, `frontend/public/data/targets.json`, `pipeline/lighting.py`, and `pipeline/landcover.py`.

- The checked-in app has 30 Earth sites: 12 reference sites and 18 DEM-scan candidates. It ranks the set by Terrain Match; the candidate scan is bounded to declared DEM regions, not a search of all Earth (`README.md`, `docs/VALIDATION.md`).
- Terrain Match is a weighted mean of per-parameter linear similarities over available values for mean slope, 90th-percentile slope, and roughness. Ranges/default weights come from `config/weights.yaml`; completeness and missing parameters are reported separately (`frontend/src/engine/scoring.ts`).
- The code/data expose low-sun share and bare-ground share separately from that score. In the current 30-site catalogue, low-sun share is present for 30/30 sites and bare-ground share for 29/30 (`frontend/public/data/sites.json`; counts inspected on the assessment baseline). These counts describe this snapshot only, not future source coverage or comparability.
- Earth low-sun share is an annual statistic from hourly 2026 UTC solar-position samples. Moon uses hourly samples through 2026; Mars uses one Mars year from 2026-01-01. The method is geometric and does not include terrain shading, weather, or dust (`pipeline/lighting.py`, `docs/REFERENCES.md`). It is not a date-specific observation or forecast.
- WorldCover class 60 is “Bare / sparse vegetation” as a share of classified land cells, in a 6 km window using the 2021 v200 product. It is not a measurement of regolith, rock mechanics, trafficability, or material equivalence (`pipeline/landcover.py`, `docs/REFERENCES.md`). The scan also used bare-ground and land-share checks to select the current candidates (`docs/VALIDATION.md`), so using this same measurement to rank those candidates would need explicit treatment of that selection history.
- Mars lighting is currently displayed for reference and is not used in a Moon-style lighting comparison. The 3D terrain-view lighting is explicitly illustrative, not a simulation (`frontend/public/data/targets.json`, `frontend/src/components/TerrainViews.tsx`).
- There is no shipped date-specific, seasonal, weather, or multi-factor ranking mode (`README.md`). The current #46 classifier work is an open research thread, not an accepted app factor or replacement for Terrain Match.

## Proposed first user decision

**User to discuss:** a researcher or field-test planner choosing where to run a specified rover/planetary-vision or terrain experiment on Earth.

**Decision to support:** “Which locations in this bounded catalogue have terrain descriptors similar to the selected target, and what separately measured conditions should I inspect when planning this particular test?”

This makes two outputs explicit rather than treating them as interchangeable:

- **Target similarity:** terrain measurements relative to the selected planetary target.
- **Earth test conditions:** separately described conditions relevant to the declared experiment, with a stated period and support.

The output is a shortlist for inspection, not a finding that a place is a good analogue in all respects, accessible, safe, or suitable for field work. If the owners prefer a different first user/task, revise this section before treating the downstream PoCs as selected.

## Candidate factor assessment

| Candidate | What it can mean from current evidence | A-side recommendation | Evidence gate / limitation |
|---|---|---|---|
| Terrain Match | Similarity of three elevation-derived descriptors at the configured footprint | Keep as an inspectable, unchanged component and current baseline | Does not measure geology, grain size, temperature, radiation, or field suitability (`README.md`, `docs/VALIDATION.md`). |
| Solar geometry / low sun | Geometric sun position or a clearly defined statistic over a specified interval | **Best first factor to investigate**, if the owners choose a lighting-sensitive experiment; initially display as a separate task condition, not part of an aggregate | Existing annual statistic is not date-specific; no terrain horizon, weather, or dust. A relevant target reference and task protocol still need definition. #67 is the corresponding PoC after temporal semantics are agreed. |
| Bare/sparse vegetation | Fraction of 2021 WorldCover class 60 among classified land cells | Keep as contextual site evidence; do not call it substrate similarity or a universal task-fit score | One current site lacks coverage; candidate selection already used land-cover filters. #69 should assess role and selection bias before any scoring use. |
| Seasonal weather/environment | A historical or forecast variable only under its source's temporal meaning | Defer until a specific task requires it; do not use an offer/provider merely because it is available | No source/variable has been selected for this task. #66 must assess coverage first; #68 is conditional on an accepted historical source and method. Forecast is a separate future question (#92), not a substitute for climatology. |
| ML classifier output | Research discrimination between the sampled Moon/Earth terrain tiles | Do not use as a recommendation factor | #46 remains an open experiment; class discrimination is not independent analogue relevance or task success. |

“Best first factor to investigate” is a prioritization proposal, not a finding that solar geometry is useful to users or predicts experiment performance. The separate-factor approach is also subject to the policy/guidance conflict below.

## Date modes: proposed semantics and questions for B

The three modes should be explicit in product behavior. This assessment proposes the following starting interpretation; it does not select implementation details that depend on the use case.

| Mode | A-side proposal | Must be resolved before an implementation PoC |
|---|---|---|
| No date | Preserve current terrain-only ranking. Any annual or seasonal statistic remains labeled with its actual period and is not silently optimized per site. | Is an annual context panel useful for the first task, or should no-date show only non-temporal data? Which reference period is meaningful for a target? |
| Same date | User supplies a date **with year** for a specified Earth-side task. Every candidate follows one declared calendar/time policy. A Gregorian Earth date does not imply the same season or condition on the Moon/Mars. | Does the task need one simultaneous UTC instant, or the same local civil date at each site (different UTC intervals)? Which local-time zone source/rules, DST behavior, time-of-day interval, target reference scenario, and temporal resolution are required? Do not silently choose between these meanings. |
| Flexible interval | Explicitly search one shared interval for all candidates; a per-site recommended date may differ only within those common bounds and only where source support is adequate. | Who defines the interval, required activity duration, support/horizon policy, and how incomparable or unsupported sites are represented? This is later-stage work, not a hidden default. |

Recurring seasonal dates should not be equated with a specific year or with a planetary season without a separate reference definition. If the selected task cannot be described with an exact date, calendar, or activity duration, the relevant date mode is not ready for a PoC.

## Checkpoint proposal

### Current checkpoint — retain the honest shipped subset

Keep the current Terrain Match ranking and the existing separately labeled evidence. Improve no scientific method as part of #53. This is the present baseline, not a claim that a broader factor has been accepted.

### Next research checkpoint — one task, one candidate condition

If A and B agree that the initial task is sensitive to illumination, make **date-specific solar geometry** the first candidate PoC (#67), while keeping it separate from Terrain Match. State what the test is trying to reproduce (for example, a declared rover-vision illumination condition), and test whether available solar outputs describe that condition at the temporal support the task needs. Do not add weather, bare-ground, or classifier outputs just to make the demo look multi-factor.

If the agreed task is not illumination-sensitive, select a different factor only after documenting its task relationship and source/method gate. In either case, a PoC can establish computability and support; it does not alone prove user usefulness. User understanding/usefulness requires a separate approved study such as #91, and independent analogue relevance is a different question (#89–#90).

## Policy conflict that must be resolved before aggregation

The project direction in #52/#53 calls for a purpose-specific broader recommendation. The current `earth-analog-ui` skill says: **“Lighting — Keep separate from Terrain Match; never combine the two into another score.”** A broader aggregate that combines terrain with lighting would conflict with that instruction as written. The skill and roadmap are both project guidance; #53 cannot silently overrule either.

**Request to both owners:** decide whether the intended product is (a) separate factors/constraints with no aggregate, (b) a future aggregate whose factors may include lighting after an explicit revision of the conflicting guidance, or (c) another clearly defined design. Until that decision is recorded, this assessment recommends **no combined score**. Preserving Terrain Match as a separate component is necessary but does not by itself settle the conflict.

## Questions for owner B (@azrialahmad)

Please respond on #53 with agree / revise / disagree, and rationale, for each:

1. Is the initial user a field-test planner/researcher, and is the decision “terrain similarity plus separately inspected conditions” a useful first task? If not, what concrete user/task should replace it?
2. Should the first research checkpoint investigate date-specific solar geometry for a lighting-sensitive task, or a different factor? What does the user need to do with that output?
3. Should the product remain a factor profile without a combined score for now, or is a future task-specific aggregate desired? How should the aggregate direction be reconciled with the current UI-skill prohibition on combining lighting with Terrain Match?
4. Are “Experiment Planning” for the product concept and “Task Match” as a strictly provisional future-aggregate label understandable, or do you prefer other terms?
5. For same-date comparison, does the proposed task require one UTC instant, the same local calendar date at every Earth site, or a different interpretation? What is the correct reference scenario for the planetary target?
6. Is the proposed checkpoint—current terrain-only behavior, then one evidence-gated task condition—small and useful enough, or should the first checkpoint differ?

No response is presumed to be approval. Record partial agreement and unresolved decisions explicitly.

## Dependency and handoff map

- **#54:** turn the agreed task into eligibility, missingness, support, and fair-comparison decisions before any broader ranking contract.
- **#66:** audit factor/source coverage only for the factors the owners accept as relevant to the task.
- **#67:** date-specific solar PoC if solar is selected and date semantics are agreed; current annual results and existing pvlib/SPICE methods do not settle the date policy.
- **#68:** historical seasonal conditions only if the task needs them and #66 accepts a source/method.
- **#69:** decide whether WorldCover supports a defined task role; do not treat class 60 as material properties.
- **#70:** a shared versioned contract only after #53/#54 and the evidence for included factors are accepted; shared files require cross-owner approval.
- **#91 / #89–#90:** user usefulness and independent analogue relevance are separate evaluations, not outcomes of #53 or a data PoC.
- **#56/#57:** terrain-reader diagnosis/correction is separate work; this document makes no claim about its outcome.

## Decision record

| Item | Status |
|---|---|
| A-side assessment prepared | Yes; this document |
| A-owner endorsement of this exact recommendation | Pending confirmation by @ganendraditya |
| B response | Requested; pending |
| Joint scenario / terminology / factor / date agreement | Not yet reached |
| New method, score, threshold, dataset, UI, or app data authorized | No |

Issue #53 should remain open until both owners record agreement on the scenario, terminology, factor meanings, date modes, first checkpoint, and gates for every unresolved method/data question. The final decision should be revised to match the discussion, not treated as approved because this assessment exists.
