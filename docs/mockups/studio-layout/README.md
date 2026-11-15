# Studio-style layout image mockup

A separate concept preview, not a production change. It reuses the live app's
components, data, ranking engine, relief renderer, and slider state. The header
preview at port 4175 is unchanged.

The executable preview and tests stay on
[`studio-layout-mockup-archive`](https://github.com/azrialahmad/earth-analog-explorer/tree/studio-layout-mockup-archive),
at source snapshot `9ccfcf7`, without ongoing compatibility with future
frontend changes. Per [issue #47](https://github.com/azrialahmad/earth-analog-explorer/issues/47),
the intended `main` deliverable is selected screenshots and documentation only.
The current PR still needs narrowing before merge; this does not approve any
production layout change.

The preview's app-source baseline is [`a1c6548`](https://github.com/azrialahmad/earth-analog-explorer/commit/a1c65489d525281f53cb98e0ce19787356703e4d)
(#39/#40), before the SPICE-derived target-lighting update in #43/#44. Any
screenshot captured from this branch must be captioned with that app revision and
must not be presented as showing current `main` Moon-lighting values. Refresh the
preview against current `main` before using screenshots that need to show the
current target-lighting data.

- Ranked sites remain left; selected-site details remain right.
- The center stacks terrain views, always-visible weight sliders, and an open
  analysis-assistant panel.
- Data/Evidence/Weights/Ask toolbar buttons are absent from this concept; Demo
  remains at top right with a visible text label.
- Chat starts empty and cannot send an API request. No AI answer is invented.
- The chat uses rank-neutral copy, no suggested prompts, and an icon-only send
  button inside a shared composer. Enter submits; Shift+Enter inserts a newline.
  IME confirmation does not submit. The message label and send-button name remain
  available to assistive technologies.
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
requires no center-pane overflow. Results and screenshots go to a fresh OS
temporary directory whose path is printed when the check starts; running it does
not create output inside the checkout.

## Earlier three-pane artifact

`../three-pane-workbench.html` is a historical concept, not standalone HTML: its
root-absolute `/frontend/src/` imports and TypeScript modules require Vite rooted
at the repository root. The three-pane layout already shipped in #39/#40. Do not
add a second serving/maintenance path for it; only its screenshot is intended for
the final documentation on `main`, not its executable HTML/CSS/JS or tests.
