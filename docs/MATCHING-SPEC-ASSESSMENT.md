# Matching direction: release decision for the submission (issue #53)

**Status:** this records both owners' responses on #53 (B: @azrialahmad, A: @ganendraditya, 2026-11-15) and the scope freeze on #52. It is a release decision, not an approved method, dataset, score or implementation. The earlier A-side assessment in this file was narrowed at A's request (see #106 and #53).

## Decision for this release

- **User and task:** a field-test planner or researcher comparing how closely the terrain in this bounded Earth catalog resembles a selected Moon or Mars target. Conditions are read separately.
- **Ranking:** Terrain Match keeps its current name, formula and ranking role. There is no combined score, and no claim about general site suitability or safety.
- **Context:** the existing low-sun share and bare-ground share stay as they shipped, separate from Terrain Match. They never change the rank. Mars lighting stays reference only (#43).
- **Terminology:** no new product name, score name or control is introduced for the submission. "Task Match" is not used.
- **Scope:** bug fixes and the submission only (#52). Missing-data handling is recorded in `docs/COMPARISON-POLICY.md` (#54).

## Owner responses

| Question | B (@azrialahmad) | A (@ganendraditya) |
|---|---|---|
| First user and task | Agree: field-test planner | Agree |
| Combined score | Not now; factor profile only | Agree: none |
| First new factor | Date-specific solar geometry (#67) | Possible future work, not active for this release |
| Terminology | "Experiment Planning" for the concept, "Task Match" reserved | Not needed for the submission |
| Same-date meaning | Same local calendar date with a year at each site | A reasonable future direction; no date mode ships |
| Next checkpoint | Terrain-only release, then one condition | Release first; everything else deferred |

Where the answers differ, A's narrower position applies to this release, and B agreed to the scope freeze on #52.

## Deferred ideas, not release requirements

These stay open as ideas (#52 `idea` label). Nothing here is accepted or scheduled:

- **Date-specific solar geometry (#67).** Still undecided: time-zone source, DST, sampling or test-window rules, and the target reference period.
- **Date modes:** same date and flexible interval (#77, #79–#81).
- Weather and seasonal factors (#66, #68, #73–#74), and a WorldCover task role (#69).
- A versioned multi-factor contract, scorer and app (#70–#72, #75–#76, #78).
- A combined score. If ever wanted, it would also need to resolve the UI-skill rule against combining lighting with Terrain Match.
- Classifier and morphology research (#46, #108); layout redesign (#47).

## Evidence boundary

The release ranks a bounded catalog of 30 Earth sites (12 from the initial list and 18 from the DEM scan). It is not a search of all of Earth, and nobody has checked the candidates on imagery or in the field (`README.md`, `docs/VALIDATION.md`).
