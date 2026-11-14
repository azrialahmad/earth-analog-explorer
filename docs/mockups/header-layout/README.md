# Local header-layout trial

This preview uses the current app, its real components, and its existing state/data.
It does not edit `frontend/` or scientific inputs. It is not a production change.

The dev-only Vite plugin adds a header mount point and portals the existing terrain
controls into it. The React handlers, renderer state, and Moon-only lighting control
remain in `TerrainViews`. Local CSS aligns the brand with the left sidebar and
puts the controls before the compact target selector in a single desktop row.
Below desktop, groups wrap instead of truncating target names. Toolbar icon labels
remain accessible, with native title tooltips. No dependencies are added.

Run from `frontend/` using the already-installed app dependencies:

```sh
node ../docs/mockups/header-layout/serve.mjs
```

Open `http://localhost:4175/earth-analog-explorer/`. To run another instance,
set `PREVIEW_PORT` (for example `PREVIEW_PORT=4176`).
The normal app at port 5173 does not receive the preview changes.

Check the local transformations from the repository root:

```sh
node --test docs/mockups/header-layout/preview.test.mjs
```

Keep this branch local for visual review; no PR, commit, or push is required.
