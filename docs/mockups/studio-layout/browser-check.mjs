// No browser dependencies or downloads. Connect to an isolated Firefox instance
// started with --headless --remote-debugging-port 9223 and a temporary profile.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const output = mkdtempSync(join(tmpdir(), 'earth-analog-studio-check-'))
console.log(`Browser-check output: ${output}`)

const ws = new WebSocket(process.env.BIDI_URL ?? 'ws://127.0.0.1:9223/session')
let id = 0
const pending = new Map()
const rejectPending = error => {
  for (const entry of pending.values()) {
    clearTimeout(entry.timeout)
    entry.reject(error)
  }
  pending.clear()
}
ws.onmessage = event => {
  const message = JSON.parse(event.data)
  const entry = pending.get(message.id)
  if (!entry) return
  pending.delete(message.id)
  clearTimeout(entry.timeout)
  if (message.type === 'error') entry.reject(new Error(JSON.stringify(message)))
  else entry.resolve(message.result)
}
ws.onclose = () => rejectPending(new Error('Firefox WebDriver BiDi connection closed'))
ws.onerror = () => rejectPending(new Error('Firefox WebDriver BiDi connection failed'))
const send = (method, params) => new Promise((resolve, reject) => {
  const requestId = ++id
  const timeout = setTimeout(() => {
    pending.delete(requestId)
    reject(new Error(`Timed out after 15 seconds waiting for ${method}`))
  }, 15_000)
  pending.set(requestId, { resolve, reject, timeout })
  try {
    ws.send(JSON.stringify({ id: requestId, method, params }))
  } catch (error) {
    pending.delete(requestId)
    clearTimeout(timeout)
    reject(error)
  }
})

const results = []
let sessionStarted = false
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out connecting to Firefox WebDriver BiDi')), 10_000)
    ws.addEventListener('open', () => { clearTimeout(timeout); resolve() }, { once: true })
    ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Could not connect to Firefox WebDriver BiDi')) }, { once: true })
  })
  const session = await send('session.new', { capabilities: {} })
  sessionStarted = true
  console.log(session.capabilities.browserName, session.capabilities.browserVersion)
  const { context } = await send('browsingContext.create', { type: 'tab' })
  const evaluate = async expression => {
    const answer = await send('script.evaluate', { expression, target: { context }, awaitPromise: true })
    if (answer.type === 'exception') throw new Error(JSON.stringify(answer.exceptionDetails))
    return answer.result.value
  }
  const settle = () => evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')
  for (const [width, height] of [[1920, 1080], [1512, 780], [1440, 900], [1280, 720], [1024, 600], [900, 600], [899, 700], [768, 1024], [390, 844]]) {
    await send('browsingContext.setViewport', { context, viewport: { width, height }, devicePixelRatio: 1 })
    await send('browsingContext.navigate', { context, url: 'http://localhost:4178/earth-analog-explorer/', wait: 'complete' })
    await evaluate(`(async () => {
      if (!document.querySelector('#ask-input')) await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Timed out waiting for #ask-input')) }, 10000);
        const observer = new MutationObserver(() => {
          if (document.querySelector('#ask-input')) { clearTimeout(timeout); observer.disconnect(); resolve() }
        }); observer.observe(document.body, { childList: true, subtree: true });
      });
      await document.fonts.ready;
      document.querySelector('#tab-view')?.click();
      return true;
    })()`)
    await settle()
    for (const target of ['Shackleton rim', 'Jezero crater floor']) {
      await evaluate(`(() => { [...document.querySelectorAll('.targets button')].find(b => b.textContent.includes(${JSON.stringify(target)}))?.click(); return true })()`)
      await settle()
      for (const layout of ['row', 'column']) {
        await evaluate(`(() => { document.querySelectorAll('.studio-view-toolbar > button')[${layout === 'row' ? 0 : 1}].click(); return true })()`)
        await settle()
        const measure = JSON.parse(await evaluate(`JSON.stringify((() => {
          const rect = s => { const e = typeof s === 'string' ? document.querySelector(s) : s; const r = e.getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height } };
          const pane = document.querySelector('#pane-view');
          const inputs = [...document.querySelectorAll('.weight input')].map(rect);
          return { viewport: [innerWidth, innerHeight], pane: rect(pane), overflow: pane.scrollHeight - pane.clientHeight, horizontalOverflow: pane.scrollWidth - pane.clientWidth, viewer:rect('.views'), visual:rect('.studio-visual'), weights:rect('#weights-panel'), chat:rect('#ask-panel'), form:rect('.ask-form'), composer:rect('.studio-composer'), prompt:rect('#ask-input'), send:rect('.studio-send'), sendLabel:document.querySelector('.studio-send').getAttribute('aria-label'), suggestions:!!document.querySelector('.ask-examples'), placeholder:document.querySelector('#ask-input').placeholder, toolbar:rect('.studio-view-toolbar'), inputs, layout:document.querySelector('.views').className, standaloneCaveat:!!document.querySelector('.views-pane > .views-foot'), info:document.querySelector('.studio-view-info').textContent };
        })())`))
        const label = `${width}x${height} ${target} ${layout}`
        results.push({ width, height, target, layout, ...measure })
        assert.equal(measure.standaloneCaveat, false, label)
        assert.equal(measure.horizontalOverflow, 0, label)
        assert.ok(measure.viewer.height > 0, label)
        assert.ok(Math.abs(measure.weights.y - measure.viewer.bottom - 8) < 2, `${label}: visual/weights gap`)
        assert.ok(Math.abs(measure.chat.y - measure.weights.bottom - 8) < 2, `${label}: weights/chat gap`)
        for (const input of measure.inputs) {
          assert.ok(input.y >= measure.weights.y && input.bottom <= measure.weights.bottom - 8, `${label}: slider containment`)
          assert.ok(input.x >= measure.weights.x && input.right <= measure.weights.right, `${label}: slider horizontal containment`)
        }
        assert.ok(measure.toolbar.x >= measure.viewer.x && measure.toolbar.right <= measure.viewer.right, `${label}: toolbar horizontal containment`)
        assert.ok(measure.toolbar.y >= measure.viewer.y && measure.toolbar.bottom <= measure.viewer.bottom, `${label}: toolbar vertical containment`)
        assert.equal(measure.suggestions, false, `${label}: suggested prompts removed`)
        assert.equal(measure.placeholder, 'Ask about the analysis…', `${label}: rank-neutral prompt`)
        assert.equal(measure.sendLabel, 'Send message', `${label}: accessible send button`)
        for (const control of [measure.prompt, measure.send]) {
          assert.ok(control.x >= measure.composer.x && control.right <= measure.composer.right, `${label}: composer horizontal containment`)
          assert.ok(control.y >= measure.composer.y && control.bottom <= measure.composer.bottom, `${label}: composer vertical containment`)
        }
        assert.ok(measure.prompt.right <= measure.send.x, `${label}: text does not overlap send button`)
        assert.ok(measure.form.bottom <= measure.chat.bottom + 1, `${label}: composer overflows chat`)
        const compact = JSON.parse(await evaluate(`JSON.stringify((() => {
          const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height } };
          return { header:rect('#ask-panel > header'), context:rect('.ask-context-next'), transcript:rect('.ask-lines'), scope:rect('.ask-scope'), form:rect('.ask-form'), insideHeader:!!document.querySelector('#ask-panel > header > .ask-context-next'), font:getComputedStyle(document.querySelector('.ask-context-next')).fontSize, count:document.querySelectorAll('.site-row').length };
        })())`))
        assert.equal(compact.count, 30, `${label}: current-main site count`)
        assert.equal(compact.insideHeader, true, `${label}: context belongs to heading`)
        assert.equal(compact.font, '10px', `${label}: compact context text`)
        assert.ok(compact.context.y >= compact.header.y && compact.context.bottom <= compact.header.bottom + 1, `${label}: context contained by heading`)
        assert.ok(compact.scope.y >= compact.header.bottom - 1, `${label}: heading does not overlap scope`)
        assert.ok(compact.transcript.y >= compact.scope.bottom - 1, `${label}: scope does not overlap transcript`)
        assert.ok(compact.transcript.height >= 25, `${label}: transcript remains usable`)
        assert.ok(compact.form.y >= compact.transcript.bottom - 1, `${label}: transcript does not overlap composer`)
        if (width >= 1000) {
          assert.ok(measure.overflow <= 1, `${label}: center overflows by ${measure.overflow}px`)
          assert.ok(measure.form.bottom <= measure.pane.bottom + 1, `${label}: composer bottom ${measure.form.bottom}, pane bottom ${measure.pane.bottom}`)
        }
        if (width === 1512 && target === 'Shackleton rim' && layout === 'row') {
          const { data } = await send('browsingContext.captureScreenshot', { context })
          writeFileSync(join(output, 'firefox-studio-1512x780-moon.png'), Buffer.from(data, 'base64'))
        }
      }
    }
    if (width === 1440 || width === 1280 || width === 390) {
      if (width === 390) {
        await evaluate("document.querySelector('.ask-form').scrollIntoView({ block: 'end' }); true")
        await settle()
      }
      const { data } = await send('browsingContext.captureScreenshot', { context })
      writeFileSync(join(output, `firefox-studio-${width}x${height}.png`), Buffer.from(data, 'base64'))
    }
    console.log(`PASS ${width}x${height}: Moon/Mars, side by side/stacked`)
  }
  // Exercise the disclosure and a real native range-key event without an API call.
  await evaluate("document.querySelector('.studio-view-info summary').click(); true")
  await settle()
  assert.equal(await evaluate("document.querySelector('.studio-view-info').open"), true)
  assert.ok(await evaluate("document.querySelector('.studio-view-info .views-foot').getBoundingClientRect().height > 0"))
  await evaluate("document.querySelector('.studio-view-info summary').click(); document.querySelector('.weight input').focus(); true")
  const weightBefore = Number(await evaluate("document.querySelector('.weight input').value"))
  await send('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE014' }, { type: 'keyUp', value: '\uE014' }] }] })
  await settle()
  assert.ok(Number(await evaluate("document.querySelector('.weight input').value")) > weightBefore)
  assert.equal(await evaluate("document.querySelector('.ask-context-next .ask-weights strong').textContent"), await evaluate("document.querySelector('.weight input').value"))
  await evaluate(`(() => {
    const input = document.querySelector('#ask-input');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Explain the current comparison.');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await settle()
  assert.equal(await evaluate("document.querySelector('.studio-send').disabled"), false)
  await evaluate("document.querySelector('.studio-send').click(); true")
  await settle()
  assert.ok(await evaluate("document.querySelector('.ask-line.error')?.textContent.includes('Layout preview only')"))
  assert.ok(await evaluate("document.querySelector('.ask-form').getBoundingClientRect().bottom <= document.querySelector('#ask-panel').getBoundingClientRect().bottom"))
  console.log('PASS info disclosure, native slider keyboard input, and chat error layout')
  const oldContext = await evaluate("document.querySelector('.ask-line.user .ask-context-used').textContent")
  const oldCount = await evaluate("document.querySelectorAll('.ask-lines > li').length")
  await evaluate(`(() => {
    const input = document.querySelector('#ask-input');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Keep this unsent draft.');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await settle()
  for (const name of ['Shackleton rim', 'Malapert massif', 'Jezero crater floor', 'Shackleton rim']) {
    await evaluate(`(() => { [...document.querySelectorAll('.targets button')].find(b => b.textContent.includes(${JSON.stringify(name)})).click(); return true })()`)
    await settle()
    assert.equal(await evaluate("document.querySelectorAll('.ask-lines > li').length"), oldCount, `${name}: no reset or switch-note spam`)
    assert.equal(await evaluate("document.querySelector('#ask-input').value"), 'Keep this unsent draft.', `${name}: draft retained`)
    assert.equal(await evaluate("document.querySelector('.ask-line.user .ask-context-used').textContent"), oldContext, `${name}: original context retained`)
    assert.ok(await evaluate(`document.querySelector('.ask-context-next').textContent.includes(${JSON.stringify(name)})`), `${name}: live context follows target`)
  }
  await evaluate("document.querySelector('.studio-send').click(); true")
  await settle()
  assert.equal(await evaluate("document.querySelectorAll('.ask-line.user').length"), 2)
  assert.equal(await evaluate("document.querySelectorAll('.ask-line.error').length"), 2)
  assert.equal(await evaluate("document.querySelectorAll('.ask-line.note').length"), 1)
  assert.ok(await evaluate("document.querySelector('.ask-line.note').textContent.includes('This question uses Shackleton rim')"))
  assert.equal(await evaluate("document.querySelector('.ask-line.user .ask-context-used').textContent"), oldContext)
  assert.ok(await evaluate("[...document.querySelectorAll('.ask-line.user .ask-context-used')].at(-1).textContent.includes('Shackleton rim')"))
  assert.equal(await evaluate("document.querySelector('.ask-lines').getAttribute('aria-live')"), 'polite')
  assert.equal(await evaluate("document.querySelector('.ask-lines').getAttribute('aria-relevant')"), 'additions')
  console.log('PASS cross-target transcript/draft continuity, per-turn attribution and one next-Send context note')
  console.log(`${results.length} browser layout checks passed`)
} finally {
  writeFileSync(join(output, 'studio-browser-check.json'), JSON.stringify(results, null, 2))
  if (sessionStarted && ws.readyState === WebSocket.OPEN) await send('session.end', {}).catch(() => {})
  rejectPending(new Error('Browser check finished'))
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close()
}
