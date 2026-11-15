import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('./three-pane-workbench.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const targets = JSON.parse(readFileSync(new URL('../../frontend/public/data/targets.json', import.meta.url), 'utf8'))
// Exercise the actual lighting branch without starting the renderer or computing scores.
const start = source.indexOf("  if (target.body === 'moon') {", source.indexOf('function renderExplanation()'))
const end = source.indexOf('  content.append(section(`Top-', start)
assert.ok(start !== -1 && end > start)
const percent = source.match(/^const percent = .*$/m)[0]
const renderLighting = (target, targetSource) => {
  const sections = []
  runInNewContext(`${percent}\n${source.slice(start, end)}`, {
    target,
    e: { lowSun: { site: null, target: null, targetSource }, warning: { fired: false } },
    section: (title, copy) => ({ title, copy }),
    content: { append: section => sections.push(section) },
  })
  return sections
}

test('Moon lighting shows the supplied source instead of a fixed origin claim', () => {
  const target = targets.find(t => t.body === 'moon')
  const [{ copy }] = renderLighting(target, target.low_sun_share.source)
  assert.ok(copy.includes(`Target lighting source: ${target.low_sun_share.source}`))
  assert.ok(!copy.includes('for the target by definition'))
  assert.ok(copy.includes('Lighting does not contribute to Terrain Match.'))
})

test('an unknown Moon lighting source is shown as missing', () => {
  const [{ copy }] = renderLighting(targets.find(t => t.body === 'moon'), null)
  assert.ok(copy.includes('Target lighting source: missing'))
  assert.ok(!copy.includes('null'))
})

test('Mars retains terrain-only presentation without a lunar lighting comparison', () => {
  const [section] = renderLighting(targets.find(t => t.body === 'mars'), null)
  assert.equal(section.title, 'Lighting is not applicable')
  assert.equal(section.copy, 'The Mars comparison is terrain-only. No lunar lighting warning is applied.')
})
