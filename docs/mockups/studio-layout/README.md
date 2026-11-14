# Studio-style layout image mockup

A separate concept preview, not a production change. It reuses the live app's
components, data, ranking engine, relief renderer, and slider state. The header
preview at port 4175 is unchanged.

- Ranked sites remain left; selected-site details remain right.
- The center stacks terrain views, always-visible weight sliders, and an open
  analysis-assistant panel.
- Data/Evidence/Weights/Ask toolbar buttons are absent from this concept; Demo
  remains at top right with a visible text label.
- Chat starts empty and cannot send an API request. No AI answer is invented.
- Viewer notes remain in the **View info** disclosure instead of a separate footer.
- The viewer has exactly one grid track. Desktop rows share the available height,
  with an 8 px gap; compact desktop/mobile layouts intentionally allow scrolling
  rather than collapsing or overlapping the controls.
- This is not an implementation of draggable/resizable docking or a completed
  migration of all Data/Evidence content.

From `frontend/`, run `node ../docs/mockups/studio-layout/serve.mjs`, then open
`http://localhost:4177/earth-analog-explorer/`.

From the repository root, run `node --test docs/mockups/studio-layout/preview.test.mjs`.

## Native Firefox layout checks

`browser-check.mjs` uses Node's WebSocket client and Firefox's built-in WebDriver
BiDi endpoint; no extra tools or browser downloads are required. Start Firefox
with `--headless --no-remote --profile <existing-empty-temporary-directory>
--remote-debugging-port 9223 about:blank`, using a separate temporary profile (not
your browsing profile), then run:

```sh
node docs/mockups/studio-layout/browser-check.mjs
```

The check covers nine viewport sizes, Moon/Mars, both viewer arrangements,
slider containment, gaps, composer visibility, disclosure, native keyboard
input, and the chat error state. At desktop widths of 1000 px and above it also
requires no center-pane overflow. Results and screenshots go to `.openchamber/`.
