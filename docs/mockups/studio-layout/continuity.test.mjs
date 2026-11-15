// Temporary local-preview checks, not evidence of a live mixed-target API.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AskSession } from '../../../frontend/src/chat/session.ts'
import { defaultWeights } from '../../../frontend/src/engine/scoring.ts'
import { CONTEXT_VERSION, MAX_HISTORY, reference, runFor, snapshot } from '../../../frontend/src/chat/context.ts'
import { transformStudioModule } from './preview-plugin.mjs'

const require = createRequire(new URL('../../../frontend/package.json', import.meta.url))
const { transformWithOxc } = await import(pathToFileURL(require.resolve('vite')))
const data = Object.fromEntries(['config', 'targets', 'sites', 'evidence'].map(name => [name,
  JSON.parse(readFileSync(new URL(`../../../frontend/public/data/${name}.json`, import.meta.url), 'utf8')),
]))
const weights = defaultWeights(data.config)
const moonTarget = data.targets.find(t => t.body === 'moon')
const secondMoonTarget = data.targets.find(t => t.body === 'moon' && t.id !== moonTarget.id)
const marsTarget = data.targets.find(t => t.body === 'mars')
const moon = snapshot(runFor(data, moonTarget.id, weights))
const secondMoon = snapshot(runFor(data, secondMoonTarget.id, weights))
const mars = snapshot(runFor(data, marsTarget.id, weights))
const source = readFileSync(new URL('../../../frontend/src/chat/AskPanel.tsx', import.meta.url), 'utf8')
const next = transformStudioModule(source, '/src/chat/AskPanel.tsx')
const effect = next.match(/useLayoutEffect\(\(\) => \{([\s\S]*?)\n  }, \[live, session\]\)/)?.[1]
assert.ok(effect)

function state() {
  const state = {
    live: moon, session: new AskSession(moon),
    lines: [{ kind: 'user', text: 'Earlier question', snapshot: moon }],
    history: { current: [{ role: 'user', text: 'Earlier question', context: { targetId: moonTarget.id } }] },
    lastUsed: { current: moon.key }, text: 'Unsent draft', busy: false,
  }
  state.setLines = update => { state.lines = typeof update === 'function' ? update(state.lines) : update }
  state.setText = value => { state.text = value }
  state.setBusy = value => { state.busy = value }
  return state
}

test('Moon → another Moon → Mars → Moon preserves transcript, history and draft without reset notices', () => {
  const s = state()
  const originalLine = s.lines[0]
  const originalHistory = s.history.current
  for (const live of [secondMoon, mars, moon]) {
    s.live = live
    runInNewContext(`{${effect}}`, s)
    assert.equal(s.lines.length, 1)
    assert.equal(s.lines[0], originalLine)
    assert.equal(s.lines[0].snapshot, moon)
    assert.equal(s.history.current, originalHistory)
    assert.equal(s.lastUsed.current, moon.key)
    assert.equal(s.text, 'Unsent draft')
  }
})

test('target changes still abort pending requests and A → B → A never revives a stale request', () => {
  const s = state()
  const pending = s.session.start()
  s.busy = true
  s.live = mars
  runInNewContext(`{${effect}}`, s)
  assert.equal(pending.controller.signal.aborted, true)
  assert.equal(s.session.current(pending), false)
  assert.equal(s.busy, false)
  assert.equal(s.lines.length, 2)
  assert.equal(s.lines[0].text, 'Earlier question')
  assert.match(s.lines[1].text, /Pending question interrupted.*Conversation kept/)
  assert.equal(s.text, 'Unsent draft')
  s.live = moon
  runInNewContext(`{${effect}}`, s)
  assert.equal(s.session.current(pending), false)
  assert.equal(s.lines.length, 2)
})

test('the next Send captures the new target and attributes earlier turns to their old target', async () => {
  const s = state()
  const earlier = await reference(moon)
  s.history.current = [{ role: 'user', text: 'Earlier question', context: earlier }]
  s.live = mars
  runInNewContext(`{${effect}}`, s)
  let request
  const ask = next.match(/  async function ask\(question: string\) \{[\s\S]*?\n  }\n/)?.[0]
  assert.ok(ask)
  const { code } = await transformWithOxc(ask, 'ask.ts')
  class AskError extends Error {}
  await runInNewContext(`${code}\nask('Continue with this target.')`, {
    ...s, CONTEXT_VERSION, MAX_HISTORY, reference, ASK_URL: '/api/ask', AskError,
    async post(_url, captured) { request = captured; throw new AskError('Layout preview only — no AI request was sent.') },
  })
  assert.equal(request.context.targetId, marsTarget.id)
  assert.equal(request.history[0].context.targetId, moonTarget.id)
  assert.equal(s.lines[0].snapshot, moon)
  const boundary = s.lines.find(line => line.kind === 'note')
  assert.ok(boundary.text.includes(marsTarget.name))
  assert.equal(boundary.snapshot, mars)
  assert.equal(s.lines.find(line => line.text === 'Continue with this target.').snapshot, mars)
  assert.equal(s.busy, false)
})

test('chat keeps one polite additions-only announcement region and the live strip stays silent', () => {
  assert.equal(next.match(/aria-live="polite"/g)?.length, 1)
  assert.ok(next.includes('aria-relevant="additions"'))
  const header = next.slice(next.indexOf('      <header>'), next.indexOf('      </header>'))
  assert.ok(!header.includes('aria-live'))
  assert.ok(!next.includes('Previous target conversation cleared'))
  assert.ok(!next.includes('history.current = []'))
})
