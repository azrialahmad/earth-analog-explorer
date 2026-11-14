// Design artifact only. The live app is not modified. Scientific values and
// ranking explanations come from the app's current engine, helpers, and data.
import { defaultWeights, rankSites, stability } from '/frontend/src/engine/index.ts'
import { explainCard } from '/frontend/src/explain/card.ts'
import { createSplitRenderer } from '/frontend/src/scene/renderer.ts'
import { reliefHeights } from '/frontend/src/scene/terrain.ts'

const $ = id => document.getElementById(id)
const app = document.querySelector('.preview-app')
const path = p => `/frontend/public/${p}`
const read = async p => {
  const response = await fetch(path(p))
  if (!response.ok) throw new Error(`Could not load ${p}: ${response.status}`)
  return response.json()
}
const number = (n, digits = 2) => n == null || !Number.isFinite(n) ? 'missing' : n.toFixed(digits)
const percent = n => n == null || !Number.isFinite(n) ? 'missing' : `${Math.round(n * 100)}%`
const unit = (n, u) => n == null ? 'missing' : `${number(n, u === '°' ? 1 : 2)}${u === '°' ? '' : ' '}${u}`
function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
function section(title, copy, className = '') {
  const node = element('section', `explanation-section ${className}`)
  node.append(element('h4', '', title))
  if (copy) node.append(element('p', '', copy))
  return node
}

const [config, targets, sites] = await Promise.all([
  read('data/config.json'), read('data/targets.json'), read('data/sites.json'),
])
const weights = defaultWeights(config)
let target = targets[0]
let ranked = []
let reruns = {}
let selected = null
let renderers = []
let loadSequence = 0
const grids = new Map()
async function gridFor(place) {
  if (!place.relief) return null
  if (!grids.has(place.relief)) grids.set(place.relief, read(place.relief).catch(() => null))
  return grids.get(place.relief)
}

for (const t of targets) {
  const option = element('option', '', `${t.body === 'moon' ? 'Moon' : 'Mars'} · ${t.name}`)
  option.value = t.id
  $('target').append(option)
}

function setMobilePane(pane) {
  app.dataset.pane = pane
  document.querySelectorAll('[data-show]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.show === pane))
  })
}
document.querySelectorAll('[data-show]').forEach(button => {
  button.addEventListener('click', () => setMobilePane(button.dataset.show))
})

function makeRenderer(canvas) {
  const renderer = createSplitRenderer(canvas, () => true)
  renderer.setSplit(1)
  renderer.setAutoRotate(false)
  renderer.setLight('left', 'earth', true)
  renderer.zoom(.8)
  return renderer
}
function initRenderers() {
  renderers.forEach(renderer => renderer.dispose())
  renderers = []
  try {
    renderers = [makeRenderer($('target-canvas')), makeRenderer($('site-canvas'))]
  } catch {
    document.querySelectorAll('.canvas-box').forEach(box => {
      box.replaceChildren(element('p', 'display-note', '3D preview unavailable. Ranking and explanation remain available.'))
    })
  }
}
initRenderers()

for (const canvas of document.querySelectorAll('canvas')) {
  let drag = null
  canvas.addEventListener('pointerdown', event => {
    drag = { x: event.clientX, y: event.clientY }
    canvas.setPointerCapture(event.pointerId)
  })
  canvas.addEventListener('pointermove', event => {
    if (!drag) return
    renderers.forEach(renderer => renderer.orbit(-(event.clientX - drag.x) * .006, (event.clientY - drag.y) * .004))
    drag = { x: event.clientX, y: event.clientY }
  })
  for (const eventName of ['pointerup', 'pointercancel']) canvas.addEventListener(eventName, () => { drag = null })
  canvas.addEventListener('wheel', event => {
    event.preventDefault()
    renderers.forEach(renderer => renderer.zoom(1 + Math.max(-.3, Math.min(.3, event.deltaY * .001))))
  }, { passive: false })
}

function renderList() {
  $('candidate-list').replaceChildren(...ranked.map(entry => {
    const li = element('li')
    const button = element('button', 'candidate')
    button.type = 'button'
    button.dataset.site = entry.site.id
    button.setAttribute('aria-pressed', String(entry.site.id === selected?.site.id))
    button.append(element('span', 'rank', String(entry.rank).padStart(2, '0')))
    const identity = element('span')
    identity.append(element('span', 'candidate-name', entry.site.name))
    identity.append(element('span', 'candidate-meta', target.body === 'moon'
      ? `${percent(entry.lowSunShare)} low sun${entry.warning.fired ? ' · Lighting warning' : ''}`
      : 'Terrain only · Lighting not applicable'))
    button.append(identity, element('span', 'candidate-score', number(entry.terrainMatch)))
    button.addEventListener('click', () => selectSite(entry))
    li.append(button)
    return li
  }))
}

function renderExplanation() {
  const entry = selected
  const e = explainCard(entry, ranked, target, config, reruns[entry.site.id] ?? null, weights)
  const content = $('why-content')
  content.replaceChildren()
  content.append(element('span', 'selected-rank', `Rank ${e.rank} of ${e.total} · ${e.targetName}`))
  content.append(element('h3', '', entry.site.name))
  const approximate = entry.site.flags.includes('coordinates approximate')
  content.append(element('p', 'coordinate-note', approximate ? 'Approximate site coordinates · See data notes below' : 'Site coordinates supplied by the app'))
  const match = element('div', 'match-card')
  const top = element('div', 'score-top')
  const score = element('span', 'big-score', number(e.terrainMatch))
  score.append(element('small', '', ' / 1'))
  top.append(element('span', 'score-title', 'Terrain Match'), score)
  match.append(top, element('p', '', `Weighted terrain similarity to ${e.targetName}. Not a probability or a suitability rating.`))
  content.append(match)

  const why = section('Why this position?', e.rank === 1
    ? `Highest Terrain Match among the ${e.total} configured candidates with the current weights.`
    : `Ranked ${e.rank} among the ${e.total} configured candidates with the current weights.`)
  const neighbour = e.above ?? e.below
  if (neighbour) {
    const sign = e.above ? 'Below' : 'Above'
    why.append(element('p', '', `${sign} #${neighbour.rank} ${neighbour.name} (${number(neighbour.terrainMatch)}).`))
    const differences = e.above ? neighbour.behind : neighbour.ahead
    if (differences.length) {
      const gap = differences[0]
      why.append(element('p', '', `${gap.label} similarity: ${number(gap.mine)} here versus ${number(gap.theirs)} for that candidate.`))
    }
  }
  content.append(why)

  const breakdown = section('What drives the match?')
  for (const p of e.params) {
    const line = element('div', 'parameter')
    const title = element('div', 'parameter-top')
    title.append(element('span', '', p.label), element('b', '', number(p.similarity)))
    const values = element('div', 'parameter-values')
    values.append(element('span', '', `Site ${unit(p.site, p.unit)} · Target ${unit(p.target, p.unit)}`), element('span', '', `Weight ${number(p.weight, 1)}`))
    line.append(title, values)
    if (p.similarity !== null) {
      const meter = element('meter')
      meter.min = 0
      meter.max = 1
      meter.value = p.similarity
      meter.setAttribute('aria-label', `${p.label} similarity`)
      line.append(meter)
    }
    breakdown.append(line)
  }
  content.append(breakdown)
  if (target.body === 'moon') {
    content.append(section('Lighting is a separate comparison', `${percent(e.lowSun.site)} of daylight has low sun at this Earth site; ${percent(e.lowSun.target)} for the target by definition. Lighting does not contribute to Terrain Match.`, 'lighting'))
    if (e.warning.fired) content.append(section('Lighting warning', e.warning.text, 'lighting'))
  } else {
    content.append(section('Lighting is not applicable', 'The Mars comparison is terrain-only. No lunar lighting warning is applied.'))
  }
  content.append(section(`Top-${e.topN} stability · ${percent(e.stability)}`, `Share of ${e.stabilityRuns.toLocaleString()} configured reruns that retain this candidate in the top ${e.topN}. This is not a probability.`))
  const flags = entry.site.flags.length ? entry.site.flags.join(' · ') : 'No site flags supplied'
  content.append(element('p', 'quality-note', `Data notes: ${flags}. ${e.provisional ? 'Current configuration is provisional. ' : ''}Completeness: ${percent(e.completeness)} of the scoring parameters.`))
  const sources = element('details', 'sources')
  sources.append(element('summary', '', 'Sources & analysis details'))
  sources.append(element('p', '', `Site: ${entry.site.params.slope_mean_deg.source ?? 'missing'}`))
  sources.append(element('p', '', `Target: ${target.params.slope_mean_deg.source ?? 'missing'}`))
  sources.append(element('p', '', `${e.mainWindowKm} km primary window. Other supplied windows: ${config.window_sizes_km.join(', ')} km. Display relief is separate from scoring.`))
  content.append(sources)
}

async function updateSurfaces() {
  const sequence = ++loadSequence
  const [targetGrid, siteGrid] = await Promise.all([gridFor(target), gridFor(selected.site)])
  if (sequence !== loadSequence) return
  for (const [i, grid] of [targetGrid, siteGrid].entries()) {
    const heights = grid ? reliefHeights(grid) : null
    if (heights && renderers[i]) renderers[i].setTerrain('left', heights, i === 0 ? 0x939ba6 : 0x8a7f72, true)
    $(i === 0 ? 'target-source' : 'site-source').textContent = grid ? 'Elevation data · Display relief' : 'Elevation data missing'
  }
  $('display-grid').textContent = targetGrid ? `${Math.round(targetGrid.cell_m)} m · Display only` : 'missing'
}

function selectSite(entry) {
  selected = entry
  document.querySelectorAll('[data-site]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.site === entry.site.id))
  })
  $('site-name').textContent = entry.site.name
  renderExplanation()
  updateSurfaces()
}

function updateTarget() {
  ranked = rankSites(sites, target, config, weights)
  reruns = stability(sites, target, config, weights)
  selected = ranked[0]
  $('candidate-count').textContent = sites.length
  $('analysis-context').textContent = `${target.body === 'moon' ? 'Moon' : 'Mars'} / ${target.name} · ${sites.length} Earth candidates · ${config.main_window_km} × ${config.main_window_km} km scoring window`
  $('target-body').textContent = `${target.body === 'moon' ? 'Moon' : 'Mars'} target`
  $('target-name').textContent = target.name
  $('scoring-window').textContent = `${config.main_window_km} × ${config.main_window_km} km`
  renderList()
  selectSite(selected)
}
$('target').addEventListener('change', event => {
  target = targets.find(t => t.id === event.target.value)
  updateTarget()
})
$('reset-view').addEventListener('click', () => { initRenderers(); updateSurfaces() })
updateTarget()
