---
name: earth-analog-ui
description: Design, implement, or review Earth Analog Explorer product UI, including the target picker, ranked list, map, weights, comparison, site detail, and evidence panels. Use for visual hierarchy, design-system consistency, accessibility, responsive behavior, and scientific presentation. Not for terrain calculations, scoring formulas, backend-only work, or marketing pages.
---

# Earth Analog UI

Build a scientific geospatial workbench that helps field-test planners compare Earth terrain with a selected Moon or Mars target and understand the limits of that comparison.

## Start with the issue and repository

Repository paths below are relative to `git rev-parse --show-toplevel`.

1. Read `AGENTS.md`, the active GitHub issue, its dependencies, and team comments using the filtered command in `AGENTS.md`.
2. Check that the issue lists the files you will edit. Follow the owner table; ask on the issue before changing another owner's files or a shared contract.
3. Inspect the actual types, data, components, callers, and tokens that exist in this repository. Do not rely on remembered or assumed files.
4. Reuse an existing design system if present. Do not create a new visual system, add dependencies, alter contracts, or scaffold unrelated files as a side effect.
5. If a prerequisite is absent and the issue does not create it, report the blocker through the repository workflow.

## Design for the scientific task

Before implementation, identify the user decision, the screen's primary information, the existing visual patterns to reuse, and the acceptance checks. Keep target, body, ranked site, map marker, and detail relationships clear. The map supports the ranking; it must not obscure it or be required to use the list.

Keep the ranked list usable while evidence is expanded. In detail and comparison views, align like-for-like values, units, labels, sources, and caveats. Use progressive disclosure for supporting methods without hiding warnings or missingness.

## Preserve scientific meaning

| Information | UI rule |
| --- | --- |
| Terrain Match | Present as a terrain similarity for the selected target and weights—not safety, suitability, probability, or vision accuracy. |
| Lighting | Keep separate from Terrain Match; never combine the two into another score. |
| Missing values | Show `missing`; never substitute zero, a blank, a decorative dash, or a guess. |
| Mars lighting | Treat null lighting as not applicable, not missing or zero; do not compare Earth lighting with Mars lighting. |
| Warnings | Render the engine's warning state and text. Do not recompute thresholds; do not show lunar warnings for Mars targets. |
| Evidence tiers | Preserve supplied source and tier; distinguish computed, cited, and by-definition values. |
| Completeness and stability | Keep these distinct from Terrain Match and from each other. Neither is a probability. |
| Depth evidence | Keep published results, project tests, baselines, and limitations distinct. Never present a depth result as proof of ranking accuracy. |

Read precision, labels, units, and behavior from the issue and current helpers. Read defaults from config, not this skill. Never change scientific meaning for visual convenience. Use placeholder data only when the issue requests a clearly marked fixture.

## Visual and interaction quality

- Reuse existing semantic tokens, type, spacing, and components. Build hierarchy with grouping, alignment, and typography before adding decoration.
- Do not rely on color alone for score or warning meaning. Use labels, icons, or legends as needed.
- Prefer real, sourced maps and hillshades when the issue calls for them. Do not invent scientific images, charts, metrics, or badges.
- Avoid generic promotional layouts and decoration without a task purpose. Do not reinvent familiar controls just to look distinctive.
- Preserve semantic controls, keyboard use, visible focus, labels, and meaningful image alternatives. Respect reduced motion.
- Check relevant default, loading, empty, partial-data, disabled, and error states. Map failure must not make the ranked list unusable.
- Check long labels, expanded evidence, narrow layouts, and focus in scrollable regions without hiding required caveats.

## Verify

When `frontend/` exists and the issue changes UI, run the repository's frontend checks from that directory:

```sh
npm ci
npx tsc -b
npm test
npm run build
```

Inspect the rendered result in a browser where available: desktop, 1280 x 720, and narrow mobile. Exercise changed interactions and relevant missing/error states; check Moon and Mars behavior when both are available. Do not claim a visual check if no running app or data exists; report what could not be checked.

Report changed files, commands and results, visual checks, and blockers. Follow `AGENTS.md` for scope, PR, CI, and merge. This skill does not authorize extra files or changes to scores and contracts.
