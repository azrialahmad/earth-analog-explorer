# Missing data and comparison: current-release policy (issue #54)

**Scope:** how the shipped terrain-only app handles missing values and comparison today, and what users are told. Both owners agreed on this narrow scope on #54. A's approval of this exact text is still pending. It changes no score, formula, threshold, data, contract or UI. Future ideas at the end are deferred and undecided.

**Release context (#52, #53):** bug fixes and submission only. Terrain Match keeps its name, formula and ranking role. Low-sun share and bare-ground share stay separate context and never change the rank. No combined score, date mode or new factor ships in this release.

## Safeguards both owners agree on

- Unknown is never 0 and never a failure. The app shows "missing".
- No coverage, or a comparison that does not apply (Mars lighting), is not evidence of a bad site.
- Completeness is not quality, confidence or safety. A complete site is not a better analogue because it is complete.

## Current behaviour

Source: `frontend/src/engine/scoring.ts`; `pipeline/scan.py` computes the same formula, and #65 checks the two against each other.

- **Terrain Match** is the weighted mean of per-parameter similarity, taken over the parameters with a value on **both** the site and the target side. The denominator is the weight of those parameters.
- **Completeness** is that included weight divided by all weight. A missing parameter whose weight is 0 does not lower it, so completeness can be 100% while a value is missing.
- **Unscored:** when no parameter with weight above 0 has a value on both sides, Terrain Match is null. The site is listed after every scored site, in site-id order. With all weights at 0, every site is unscored and completeness is 0.
- **Row chip** "n of 3 values" counts the **site's** missing values only. A gap on the target side is not shown on the rows. When the target has no values at all, one note is shown above the list instead. Details and Data list every parameter, with "missing" on whichever side lacks it.
- **Conditions:** low-sun share and bare-ground share never affect the score or the order. The Moon light-mismatch warning fires only when both Terrain Match and the site's low-sun share are measured. For Mars, lighting is shown for reference only and is never compared (#43).

## Known limitation

A site with a missing parameter is scored on fewer parameters than a complete site, but ranked in the same list. Today no shipped site or target has a missing terrain parameter (30 sites and 3 targets on `main`), so no shipped rank is affected. That does not make partial-data ranking fair in general. The app discloses it through completeness, the row chip, and the "left out because a value is missing" line in Details. Changing the method is out of scope for this release.

## Examples (shipped behaviour)

| Case | Terrain Match | Order | What the user sees |
|---|---|---|---|
| Complete site and target | Mean of all 3 | Ranked | Formula and per-parameter table |
| Site missing one weighted parameter | Mean of the other 2 | Ranked | Chip "2 of 3 values"; completeness below 100%; "… left out because a value is missing" |
| Missing parameter with weight 0 | Mean of the weighted ones | Ranked | Completeness can stay 100%; the table still shows "missing" |
| Target has no terrain values | null for every site | All unscored | One note above the list |
| All weights 0 | null for every site | All unscored | Every row says "not scored", with no reason given (a known gap; see below) |
| Bare-ground share has no coverage (McMurdo Dry Valleys) | Unaffected | Unaffected | Data drawer: "missing" and "No land-cover value for this site." |
| Mars target | Unaffected | Unaffected | Low sun shown for reference only; no warning |

Most of these are covered by `scoring.test.ts`, `parity.test.ts` (#65), `SiteList.test.tsx` and `shipped.test.tsx`.

**Known gap, not fixed in this release:** with all weights at 0, the app does not say why every row is unscored. It is honest but unexplained, and it is listed here instead of being added as new work during the freeze.

## Deferred ideas (undecided, not release requirements)

These are for a later decision, with #70–#72. Nothing below is agreed.

- **Describing values on separate axes.** *Data availability* (measured, missing, no spatial coverage, no temporal coverage), *comparison applicability* (compared, not applicable) and *site eligibility* (eligible, excluded by a rule) are independent. A Mars low-sun value can be measured but not compared, and an excluded site can still have complete measurements.
- **A combined score**, if one were ever wanted. Required and optional factors, eligibility groups and the denominator for missing optional factors are open questions. Sharing the same required factors alone would not make two sites comparable when optional scored factors are missing on one of them.
