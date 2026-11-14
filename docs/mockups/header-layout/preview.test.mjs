import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transformHeaderModule } from './preview-plugin.mjs'

const component = name => readFileSync(new URL(`../../../frontend/src/components/${name}.tsx`, import.meta.url), 'utf8')

test('header controls precede targets in DOM order, with existing handlers preserved', () => {
  const next = transformHeaderModule(component('TopBar'), '/src/components/TopBar.tsx')
  assert.ok(next.indexOf('className="brand glass"') < next.indexOf('id="header-view-controls"'))
  assert.ok(next.indexOf('id="header-view-controls"') < next.indexOf('<nav className="targets glass"'))
  assert.ok(next.includes('<div className="header-center">'))
  assert.ok(next.includes('</nav>\n      </div>\n\n      <div className="tools">'))
  for (const handler of ['onPickTarget(t.id)', "onTogglePanel('weights')", "onTogglePanel('data')", "onTogglePanel('evidence')", "onTogglePanel('ask')", 'onClick={onPlayDemo}']) {
    assert.ok(next.includes(handler), handler)
  }
})

test('portals actual controls without copying or replacing their state/renderer actions', () => {
  const next = transformHeaderModule(component('TerrainViews'), '/src/components/TerrainViews.tsx')
  assert.equal(next.match(/className="views-tools"/g)?.length, 1)
  assert.ok(next.includes('createPortal(<div className="views-tools">'))
  assert.ok(next.includes("document.getElementById('header-view-controls')"))
  for (const behavior of ['ctrl?.resetView(); setRotating(false)', 'setRotating(r => !r)', 'aria-pressed={rotating}', '{moon && (', 'onClick={onToggleRelit}', 'aria-pressed={relit}', 'ctrl?.setAutoRotate(rotating)']) {
    assert.ok(next.includes(behavior), behavior)
  }
  assert.ok(!next.includes("rotating ? 'Stop rotating'"))
})

test('does not transform unrelated modules or scoring code', () => {
  assert.equal(transformHeaderModule('unchanged', '/src/engine/scoring.ts'), null)
  assert.equal(transformHeaderModule('unchanged', '/src/App.tsx'), null)
})

test('fails clearly if upstream component structure changes', () => {
  assert.throws(() => transformHeaderModule('changed', '/src/components/TopBar.tsx'), /no longer matches/)
})

test('preview layout shares pane tracks and adapts controls to the center container', () => {
  const css = readFileSync(new URL('./preview.css', import.meta.url), 'utf8')
  assert.match(css, /\.app \.topbar\s*\{[^}]*grid-template-columns:\s*minmax\(230px, var\(--sites-width\)\) minmax\(0, 1fr\) minmax\(var\(--details-min\), var\(--details-width\)\)/s)
  assert.match(css, /\.app \.workspace\s*\{[^}]*grid-template-columns:\s*var\(--sites-width\) minmax\(0, 1fr\) minmax\(var\(--details-min\), var\(--details-width\)\)/s)
  assert.match(css, /@container header-center \(max-width: 680px\)/)
  assert.match(css, /grid-column:\s*1 \/ -1;\s*grid-row:\s*2/)
  assert.match(css, /justify-self:\s*end/)
})
