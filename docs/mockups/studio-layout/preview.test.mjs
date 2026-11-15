import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { transformStudioModule } from './preview-plugin.mjs'

const require = createRequire(new URL('../../../frontend/package.json', import.meta.url))
const vite = await import(pathToFileURL(require.resolve('vite')))
const { transformWithOxc } = vite

const source = path => readFileSync(new URL(`../../../frontend/src/${path}`, import.meta.url), 'utf8')
const previewCss = readFileSync(new URL('./preview.css', import.meta.url), 'utf8')

for (const path of ['App.tsx', 'components/TopBar.tsx', 'components/TerrainViews.tsx', 'chat/AskPanel.tsx']) {
  test(`${path} produces the same studio preview for LF and CRLF checkouts`, () => {
    const lf = source(path).replace(/\r\n/g, '\n')
    const crlf = lf.replace(/\n/g, '\r\n')
    assert.equal(transformStudioModule(crlf, `/src/${path}`), transformStudioModule(lf, `/src/${path}`))
  })
}

for (const ending of ['\n', '\r\n']) {
  const label = ending === '\n' ? 'LF' : 'CRLF'
  const ask = source('chat/AskPanel.tsx').replace(/\r\n/g, '\n')
  const transform = text => transformStudioModule(text.replace(/\n/g, ending), '/src/chat/AskPanel.tsx')

  test(`${label}: the chat API stub runs without making a request`, async () => {
    const next = transform(ask)
    assert.ok(next.includes("throw new AskError('Layout preview only"))
    assert.ok(!next.includes('fetch(ASK_URL'))
    const post = next.match(/async function post\([\s\S]*?\n}\n/)[0]
    const { code } = await transformWithOxc(post, 'post.ts')
    let requests = 0
    const result = runInNewContext(`class AskError extends Error {}\n${code}\npost([])`, {
      fetch() { requests++; throw new Error('Unexpected network request') },
    })
    await assert.rejects(result, /Layout preview only/)
    assert.equal(requests, 0)
  })

  for (const [pattern, renamed, duplicate, error] of [
    ['async function post(', 'async function renamedPost(', '\nasync function post() {\n}\n', /no longer matches.*post/],
    ['const EXAMPLES = [', 'const RENAMED_EXAMPLES = [', '\nconst EXAMPLES = [\n]\n', /no longer matches.*EXAMPLES/],
  ]) {
    test(`${label}: a missing ${pattern} anchor stops the preview`, () => {
      assert.throws(() => transform(ask.replace(pattern, renamed)), error)
    })
    test(`${label}: a duplicate ${pattern} anchor stops the preview`, () => {
      assert.throws(() => transform(ask + duplicate), error)
    })
  }
}

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

test('chat copy is rank-neutral and suggested prompts are removed from the module', () => {
  const next = transformStudioModule(source('chat/AskPanel.tsx'), '/src/chat/AskPanel.tsx')
  assert.ok(next.includes('placeholder="Ask about the analysis…"'))
  assert.ok(next.includes('What would you like to explore?'))
  assert.ok(next.includes('Scores come from the ranking engine.'))
  for (const removed of ['Why is this site ranked first?', 'Ask about this terrain, its ranking', 'EXAMPLES', 'ask-examples']) {
    assert.ok(!next.includes(removed), removed)
  }
})

test('the composer contains a labeled textarea and a native icon-only submit button', () => {
  const next = transformStudioModule(source('chat/AskPanel.tsx'), '/src/chat/AskPanel.tsx')
  const composer = next.slice(next.indexOf('<div className="studio-composer">'), next.indexOf('</form>'))
  assert.ok(composer.includes('<textarea'))
  assert.ok(composer.includes('type="submit"'))
  assert.ok(composer.includes('aria-label="Send message"'))
  assert.ok(composer.includes('disabled={busy || !text.trim()}'))
  assert.ok(composer.includes('aria-hidden="true" focusable="false"'))
  assert.ok(!composer.includes('>Ask</button>'))
  assert.ok(next.includes('<label htmlFor="ask-input" className="label">Message</label>'))
  assert.ok(composer.includes('aria-describedby="studio-chat-scope"'))
  assert.match(previewCss, /\.studio-composer\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/)
  assert.match(previewCss, /@media \(pointer: coarse\)[\s\S]*?--studio-send-size:\s*48px/)
})

test('Enter uses native form submission, Shift+Enter keeps a newline, and IME confirmation is ignored', () => {
  const next = transformStudioModule(source('chat/AskPanel.tsx'), '/src/chat/AskPanel.tsx')
  const handler = next.match(/onKeyDown=\{e => \{([\s\S]*?)\n            \}\}/)?.[1]
  assert.ok(handler)
  for (const [key, shiftKey, isComposing, keyCode, submits] of [
    ['Enter', false, false, 13, true],
    ['Enter', true, false, 13, false],
    ['Enter', false, true, 13, false],
    ['Enter', false, false, 229, false],
    ['a', false, false, 65, false],
  ]) {
    let count = 0
    let prevented = 0
    runInNewContext(`(e => {${handler}})(e)`, {
      e: { key, shiftKey, keyCode, nativeEvent: { isComposing }, preventDefault() { prevented++ }, currentTarget: { form: { requestSubmit() { count++ } } } },
    })
    assert.equal(count, submits ? 1 : 0, JSON.stringify({ key, shiftKey, isComposing, keyCode }))
    assert.equal(prevented, submits || (key === 'Enter' && !shiftKey && !isComposing && keyCode !== 229) ? 1 : 0, JSON.stringify({ key, shiftKey, isComposing, keyCode, prevented }))
  }
})
