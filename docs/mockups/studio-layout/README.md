# Main-based studio layout review preview

This is a review-only concept, not a production change. The app-source/data
baseline is [`e305c6a`](https://github.com/azrialahmad/earth-analog-explorer/commit/e305c6acb259c3ee437d95d4f7073775c6ca59aa),
the `origin/main` revision used for this snapshot. It has 30 Earth sites and the
target-lighting data shipped at that revision. Values and rankings come from
the checked-in data and existing engine, never from this layout plugin.

The executable preview lives on
[`47-main-studio-preview`](https://github.com/azrialahmad/earth-analog-explorer/tree/47-main-studio-preview).
The older 12-site concept remains unchanged on
[`studio-layout-mockup-archive`](https://github.com/azrialahmad/earth-analog-explorer/tree/studio-layout-mockup-archive).
Neither snapshot is maintained against future frontend changes. Per
[#47](https://github.com/azrialahmad/earth-analog-explorer/issues/47),
[PR #45](https://github.com/azrialahmad/earth-analog-explorer/pull/45) targets
`main` with documentation and selected screenshots only, not executable previews.
Product-layout decisions and production implementation remain separate.

## Changes demonstrated

- The ranked list stays left and selected-site details stay right. The center
  stacks terrain views, always-visible weights, and the analysis assistant.
- **Next message uses** is compact, unboxed, and next to the assistant heading.
  Its target, body, whole-ranking scope, and full-precision weight values wrap
  when needed without covering the transcript or composer.
- Changing target no longer clears the visible chat, historical turns, or draft.
  A context-boundary note is added at the next Send under a changed analysis,
  rather than on every target click or slider movement. Past messages keep their
  own immutable context; the live indicator follows the current run.
- An analysis change still aborts an in-flight request and invalidates its tool
  chain. Returning A → B → A does not revive the original request.
- Chat remains offline: Send produces an explicit preview-only error, not a
  model answer. No AI API call is made. These interaction checks are not a live
  mixed-target AI integration test. The production API still requires same-target
  history; the requested follow-up is recorded in
  [#50](https://github.com/azrialahmad/earth-analog-explorer/issues/50#issuecomment-6895287232).
- Enter submits, Shift+Enter inserts a newline, and IME confirmation does not
  submit. Input and icon-only send-button names remain accessible.
- Terrain controls are in the header; viewer caveats remain in **View info**.
  Narrow layouts can scroll rather than collapsing the controls.
- Data/Evidence toolbar entry points are still hidden without a complete
  migration. This gap must be resolved before any production adoption.

Conversation continuity is in-memory only; reloading the page is not persistence.
No production frontend, API, scientific data, scoring, or shared contracts are
changed by this branch's added preview files.

## Run

Use the repository's existing frontend dependencies. From the repository root:

```sh
node docs/mockups/studio-layout/serve.mjs
```

Open `http://localhost:4178/earth-analog-explorer/`. The optional earlier header-only
preview still uses port 4175. This branch does not create the local convenience
redirect from 4177; that is not needed to run the preview.

## Checks

For Node 22.14, the continuity test imports the actual TypeScript context/session
helpers and requires the built-in type-stripping flag:

```sh
node --experimental-strip-types --test docs/mockups/header-layout/preview.test.mjs docs/mockups/studio-layout/preview.test.mjs docs/mockups/studio-layout/continuity.test.mjs
```

The suite covers transforms on LF/CRLF input, compilation, offline transport,
compact context placement, native keyboard submission, retained chat/drafts,
new-Send attribution, and stale-request protection. LF/CRLF normalization on
macOS is not a native Windows retest.

`browser-check.mjs` uses an already-installed Firefox and its built-in WebDriver
BiDi endpoint, without adding browser dependencies. Start Firefox with
`--headless --no-remote --profile <existing-empty-temporary-directory>
--remote-debugging-port 9223 about:blank`, using an isolated temporary profile,
then run:

```sh
node docs/mockups/studio-layout/browser-check.mjs
```

The browser check covers nine viewports, Moon/Mars, both terrain arrangements,
30 rendered site rows, compact context/transcript/composer containment, keyboard
slider input, target/draft continuity, preserved old-turn attribution, and the
offline error. Results and screenshots go to a fresh OS temporary directory,
printed at startup; nothing is written inside the checkout.
