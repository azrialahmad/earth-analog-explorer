import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transformStudioModule } from './preview-plugin.mjs'

const source = path => readFileSync(new URL(`../../../frontend/src/${path}`, import.meta.url), 'utf8')
const previewCss = readFileSync(new URL('./preview.css', import.meta.url), 'utf8')

test('moves the existing controls into the center in visual, weights, assistant order', () => {
  const next = transformStudioModule(source('App.tsx'), '/src/App.tsx')
  const center = next.slice(next.indexOf('id="pane-view"'), next.indexOf('id="pane-details"'))
  assert.ok(center.indexOf('<TerrainViews') < center.indexOf('<WeightsPanel'))
  assert.ok(center.indexOf('<WeightsPanel') < center.indexOf('<AskPanel'))
  assert.equal(next.match(/<WeightsPanel/g)?.length, 1)
  assert.equal(next.match(/<AskPanel/g)?.length, 1)
  assert.equal(center.match(/open={true}/g)?.length, 2)
  assert.ok(center.includes('onWeights={setWeights}'))
})

test('only Demo remains in the top-right toolbar', () => {
  const next = transformStudioModule(source('components/TopBar.tsx'), '/src/components/TopBar.tsx')
  const tools = next.slice(next.indexOf('<div className="tools">'))
  assert.equal(tools.match(/<button/g)?.length, 1)
  assert.ok(tools.includes('onClick={onPlayDemo}'))
  assert.ok(tools.includes('>Demo</span>'))
})

test('the viewer exposes the existing row/column layouts and keeps responsive auto-layout', () => {
  const next = transformStudioModule(source('components/TerrainViews.tsx'), '/src/components/TerrainViews.tsx')
  assert.ok(next.includes('aria-label="Terrain view arrangement"'))
  assert.ok(!next.includes('Arrangement</span>'))
  assert.ok(next.indexOf('aria-label="Terrain view arrangement"') > next.indexOf('className={`views ${layout}`}'))
  assert.ok(next.includes("onClick={() => setLayout('row')}>Side by side</button>"))
  assert.ok(next.includes("onClick={() => setLayout('column')}>Stacked</button>"))
  assert.ok(next.includes('ctrl?.setLayout(layout)'))
  assert.ok(next.includes('new ResizeObserver'))
})

test('viewer controls overlay inside the view and range controls reserve space across browsers', () => {
  assert.match(previewCss, /\.studio-view-toolbar\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset-block-end:\s*10px/)
  assert.match(previewCss, /\.studio-center \.weight input\[type='range'\][^{]*\{[^}]*block-size:\s*32px/)
  assert.match(previewCss, /\.studio-center > \.weights\s*\{[^}]*min-block-size:\s*max-content/)
  assert.match(previewCss, /\.studio-center > \.weights\s*\{[^}]*padding-block-end:\s*22px/)
  assert.match(previewCss, /max-width:\s*899px\)\s*\{\s*\.app \.studio-center\s*\{\s*grid-template-rows:\s*minmax\(340px, auto\) max-content minmax\(300px, auto\)/)
})

test('the image mockup cannot send a chat API request or change engine source', () => {
  const next = transformStudioModule(source('chat/AskPanel.tsx'), '/src/chat/AskPanel.tsx')
  assert.ok(!next.includes('fetch(ASK_URL'))
  assert.ok(next.includes('Layout preview only'))
  assert.equal(transformStudioModule('untouched', '/src/engine/scoring.ts'), null)
})

test('the viewer has one grid row and keeps its display caveat inside the info disclosure', () => {
  const next = transformStudioModule(source('components/TerrainViews.tsx'), '/src/components/TerrainViews.tsx')
  const info = next.slice(next.indexOf('<details className="studio-view-info">'), next.indexOf('</details>'))
  assert.ok(info.includes('<p className="views-foot">'))
  assert.ok(info.includes('illustrative, not a simulation'))
  assert.equal(next.match(/className="views-foot"/g)?.length, 1)
  assert.match(previewCss, /\.studio-visual \.views-pane\s*\{\s*grid-template-rows:\s*minmax\(0, 1fr\);\s*gap:\s*0/)
  assert.match(previewCss, /grid-template-rows:\s*minmax\(0, 1\.3fr\) max-content minmax\(220px, 1fr\)/)
})

test('empty-chat guidance occupies the scrollable conversation track, not an extra grid row', () => {
  const next = transformStudioModule(source('chat/AskPanel.tsx'), '/src/chat/AskPanel.tsx')
  const list = next.slice(next.indexOf('<ol ref={listRef}'), next.indexOf('</ol>'))
  assert.ok(list.includes('<li className="studio-chat-empty">'))
  assert.ok(!next.includes('<p className="studio-chat-empty">'))
})
