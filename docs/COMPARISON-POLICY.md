# Eligibility, missing data and fair comparison (issue #54)

**Status:** B-side draft for discussion, written by an agent (Claude Code, Opus 5.5) for @azrialahmad. It is **not** an agreed A/B decision until @ganendraditya approves it. It changes no score, threshold, data or code. Baseline: `main` at `172851a` (2026-11-15).

**Builds on #53 (B answers, 2026-11-15):** the first user is a field-test planner. Terrain Match stays unchanged. Conditions are shown as a **factor profile next to it, with no combined score**. The first new condition to investigate is date-specific solar geometry (#67). "Same date" means the same local calendar date, with a year, at each Earth site. If #53 settles differently, this draft must be revised.

## 1. What a value can be

Every value the app shows, whether a terrain parameter or a condition, gets exactly one status. Statuses other than *measured* are never shown as 0 and never counted as a bad result.

| Status | Meaning | Example | Shown as |
|---|---|---|---|
| measured | The source covers the place and period, and a value was computed or cited | Low-sun share at Etna | The value, its tier and its source |
| missing measurement | The source covers the place, but this value could not be computed (gap, failed read) | A DEM window with too many voids | "missing", plus the reason when known |
| no spatial coverage | The dataset does not cover this location | WorldCover at the McMurdo Dry Valleys (bare-ground share is null today) | "not covered by <dataset>" |
| insufficient temporal coverage | The dataset covers the place but not the requested date or period | A solar or weather source that does not reach the chosen year | "no data for <period>" |
| not applicable | The comparison has no meaning for this target | The lighting comparison for a Mars target (#43) | "not compared for Mars"; the value may still show as reference |
| excluded by constraint | A declared hard rule removes the site from a recommendation | None today | "excluded: <rule>"; the site is still listed in the catalog |
| supported, no daylight | The date is covered and the sun never rises there on that day | Polar night at a high-latitude site on a winter date | "no daylight on this date". This is a real result, not missing |

**Gap in the current contract:** `types.ts` has one `missing` tier for every non-measured case, so the app cannot tell *missing measurement* from *no spatial coverage*. Telling them apart needs the versioned contract in #70; it is not changed here.

## 2. Terrain Match: keep the current behaviour as is

Current engine (`frontend/src/engine/scoring.ts`, mirrored in `pipeline/scan.py`):

- Terrain Match is the weighted mean of per-parameter similarity, taken **only over parameters with a value on both sides**. The denominator is the weight of those parameters.
- Completeness is the weight with a value on both sides divided by all weight. It is shown next to the score, and a row with gaps carries an "n of 3 values" chip.
- If no parameter has a value on both sides, Terrain Match is null and the site is **unscored**. Unscored sites are listed after every scored site, in site-id order.
- With all weights at 0, every site is unscored and completeness is 0.

**Known fairness limit:** a site with one missing parameter is scored on a different subset than a complete site, but ranked in the same order. In the shipped data no site or target has a missing terrain parameter (checked on `main`, 30 sites and 3 targets), so this does not affect any shipped rank today.

**Decision proposed:** keep this behaviour unchanged, as #54 requires. Disclosure is the safeguard: the completeness value, the chip, and the "left out because a value is missing" line in Details. Changing how partial sites are ranked (for example, requiring every parameter with weight above 0) would be a separate method change under #70, with its own approval.

## 3. Conditions in the factor profile (no combined score)

- Conditions never change rank membership or order. The list stays ordered by Terrain Match.
- Each condition is shown with its status (section 1), period, source and resolution. Unknown is never 0.
- A rule that combines a condition with Terrain Match, like today's Moon light-mismatch warning, fires **only when both values are measured**. The current engine already requires a non-null low-sun share. With no measured value, the row shows no warning, and the condition shows its status.
- Values with different periods (for example, the annual 2026 low-sun share and a future date-specific value) are shown side by side with their periods. They are never averaged or merged.
- Filters: the app has none since #95. A future filter only hides rows; it does not rerank, and it keeps the overall rank numbers.

## 4. If a combined score is approved later

This section is not active, because #53 chose no combined score. It records the rules a later proposal should start from:

- **Required-factor eligibility:** every factor in the score is declared required or optional for the task. A site missing a required factor goes into a separate "insufficient data" group with the reason, and gets no combined score. It is never ranked after scored sites as if it were the worst.
- **No silent renormalization across different factor sets:** two sites are compared on a combined score only when they share the same required factors. Any optional-factor gap is disclosed per site.
- **Zero weight means inactive:** the factor is left out of the score and of the completeness denominator. It may still be shown as context, labelled "not used in this score".
- **All weights zero:** there is no score. The app says so once and does not show a column of "not scored".
- **Not applicable** is not missing: it does not count against completeness.
- **Completeness is not quality:** a complete site is not a better analogue because it is complete.

## 5. Worked cases (input for #70, #71 and #72 tests)

| # | Case | Terrain Match | Rank membership | Condition shown | User-facing explanation |
|---|---|---|---|---|---|
| 1 | Complete site, complete target | Weighted mean of all 3 | Ranked | Measured values | Formula and per-parameter table |
| 2 | Site missing 1 terrain parameter | Mean of the other 2 | Ranked, chip "2 of 3 values" | Unchanged | "<param> is left out because a value is missing"; completeness below 100% |
| 3 | Site with no terrain parameter overlapping the target | null | Unscored, listed after scored sites | Unchanged | "No parameter has a value for both this site and <target>" |
| 4 | Target with no terrain values | null for every site | All unscored | Unchanged | One note: "<target> has no terrain values yet…" |
| 5 | All weights set to 0 | null for every site | All unscored | Unchanged | Today each row says "not scored". **Gap:** the app should say once that all weights are zero (follow-up B issue) |
| 6 | Bare-ground share has no coverage (Dry Valleys) | Unaffected | Unaffected | "missing" today; "not covered by WorldCover" once #70 separates the statuses | Data drawer: "No land-cover value for this site." |
| 7 | Low-sun share missing on a Moon target | Unaffected | Unaffected | "missing" | No light-mismatch warning, since the warning needs a measured value |
| 8 | Mars target | Unaffected | Unaffected | Low sun shown for reference only | "Lighting is not compared for Mars targets" (#43) |
| 9 | Same-date solar, polar night at the site (future #67) | Unaffected | Unaffected | "no daylight on this date" | A real result, not missing |
| 10 | Same-date solar, date outside the source's support (future #67) | Unaffected | Unaffected | "no data for <date>" | Not 0 and not a bad site |
| 11 | Annual and date-specific values both available | Unaffected | Unaffected | Both, each with its period | Never averaged together |
| 12 | Selected site removed from the data | n/a | n/a | n/a | Selection falls back to the top site (#60, `selection.test.ts`) |

Cases 1 to 8 and 12 describe shipped behaviour and are covered by the current tests (`scoring.test.ts`, `SiteList.test.tsx`, `selection.test.ts`, `shipped.test.tsx`). Cases 9 to 11 are requirements for #67, #70 and #72. Case 5's message is a small app follow-up.

## 6. Limits

- This is a policy for how results are shown and compared. It is not evidence that any site is a better analogue, safer, or fit for a test.
- No numerical cutoff (for example, a minimum completeness) is proposed. Any cutoff would belong in `config/weights.yaml`, with its own approval.
- Statuses that need new fields (section 1) wait for the #70 contract. Until then the app keeps its single "missing" tier.

## Decision record

| Item | Status |
|---|---|
| B-side draft | This document |
| A review and agreement (@ganendraditya) | Pending |
| Agreed decision table for #70, #71 and #72 | Not yet. It is agreed only once both owners approve |
