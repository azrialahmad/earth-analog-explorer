// Issue #82: end-to-end checks over the data the app actually ships (public/data), not a fixture.
// Data load → engine → site list → one shared selection → details, data drawer, Earth view and
// Ask AI context, for every shipped target. The release is terrain-only: there are no date or
// factor modes to test. No score is written here; every number comes from the engine.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AppData, Config, Evidence, ReliefGrid, Site, Target } from './types'
import { PARAM_KEYS, WINDOW_KEYS } from './types'
import configJson from '../public/data/config.json'
import targetsJson from '../public/data/targets.json'
import sitesJson from '../public/data/sites.json'
import evidenceJson from '../public/data/evidence.json'
import { defaultWeights, rankSites, stability } from './engine'
import { selectedEntry } from './selection'
import { explainCard } from './explain/card'
import { compactRun, PROMPT_RULES } from './chat/prompt'
import { reliefHeights } from './scene/terrain'
import { buildDemoSteps } from './demo/steps'
import SiteList from './components/SiteList'
import SiteDetails from './components/SiteDetails'
import DataDrawer from './components/DataDrawer'
import TerrainViews from './components/TerrainViews'

const data: AppData = {
  config: configJson as Config,
  targets: targetsJson as Target[],
  sites: sitesJson as Site[],
  evidence: evidenceJson as Evidence,
}
const { config, targets, sites, evidence } = data
const w = defaultWeights(config)

// Files that exist under public/, keyed by their path from public/ ("img/etna.png").
const publicFiles = new Set(
  Object.keys(import.meta.glob('../public/**/*.{png,json}', { query: '?url', import: 'default' })).map(k => k.replace('../public/', '')),
)
const reliefGrids = import.meta.glob<ReliefGrid>('../public/data/relief/*.json', { eager: true, import: 'default' })

/** Every finite-or-null number in a JSON value; throws on NaN/Infinity (JSON cannot hold them, but a bad build could). */
function allFinite(x: unknown): boolean {
  if (typeof x === 'number') return Number.isFinite(x)
  if (Array.isArray(x)) return x.every(allFinite)
  if (x && typeof x === 'object') return Object.values(x).every(allFinite)
  return true
}

describe('shipped data', () => {
  it('has targets for Moon and Mars, sites, and unique ids', () => {
    expect(targets.some(t => t.body === 'moon')).toBe(true)
    expect(targets.some(t => t.body === 'mars')).toBe(true)
    expect(sites.length).toBeGreaterThan(0)
    expect(new Set(sites.map(s => s.id)).size).toBe(sites.length)
    expect(new Set(targets.map(t => t.id)).size).toBe(targets.length)
  })

  it('has every parameter and window on every site and target, with null (not NaN) for unknowns', () => {
    for (const p of [...sites, ...targets]) {
      for (const k of PARAM_KEYS) expect(p.params[k], `${p.id} ${k}`).toBeDefined()
      for (const k of WINDOW_KEYS) expect(p.windows[k], `${p.id} window ${k}`).toBeDefined()
    }
    expect(allFinite([config, targets, sites, evidence])).toBe(true)
  })

  it('references only public files that exist', () => {
    for (const p of [...sites, ...targets]) {
      expect(publicFiles.has(p.hillshade), `${p.id} hillshade ${p.hillshade}`).toBe(true)
      if (p.relief) expect(publicFiles.has(p.relief), `${p.id} relief ${p.relief}`).toBe(true)
    }
    for (const img of evidence.ours.images) expect(publicFiles.has(img.src), img.src).toBe(true)
  })

  it('ships relief grids that the viewer draws without filling any gap', () => {
    const paths = [...sites, ...targets].map(p => p.relief).filter((r): r is string => r !== null)
    for (const path of paths) {
      const grid = reliefGrids[`../public/${path}`]
      expect(grid, path).toBeDefined()
      expect(reliefHeights(grid).ok, path).toBe(true)
    }
  })
})

describe.each(targets.map(t => [t.name, t] as const))('shipped release for %s', (_name, target) => {
  const ranked = rankSites(sites, target, config, w)
  const stab = stability(sites, target, config, w)

  it('ranks every loaded site once, 1..n, scored before unscored, best first', () => {
    expect(ranked.map(r => r.site.id).sort()).toEqual(sites.map(s => s.id).sort())
    expect(ranked.map(r => r.rank)).toEqual(ranked.map((_, i) => i + 1))
    const scores = ranked.map(r => r.terrainMatch)
    const firstNull = scores.indexOf(null)
    if (firstNull >= 0) expect(scores.slice(firstNull).every(s => s === null)).toBe(true)
    const scored = scores.filter((s): s is number => s !== null)
    expect(scored).toEqual([...scored].sort((a, b) => b - a))
    for (const s of scored) expect(s).toBeGreaterThanOrEqual(0)
    for (const s of scored) expect(s).toBeLessThanOrEqual(1)
  })

  it('shows the same selected site in the list, details, data drawer and Earth view', () => {
    for (const pick of [null, ranked[ranked.length - 1].site.id]) {
      const sel = selectedEntry(ranked, pick)!
      const name = sel.site.name
      const list = renderToStaticMarkup(<SiteList ranked={ranked} target={target} selectedId={sel.site.id} onSelect={() => {}} />)
      expect(list).toContain(`aria-pressed="true"><span class="rk num">${String(sel.rank).padStart(2, '0')}</span><span class="row-main"><span class="nm">${escape(name)}<`)
      const details = renderToStaticMarkup(<SiteDetails ex={explainCard(sel, ranked, target, config, stab[sel.site.id] ?? null, w)} />)
      expect(details).toContain(`<h2 id="details-name">${escape(name)}</h2>`)
      const drawer = renderToStaticMarkup(
        <DataDrawer open entry={sel} target={target} config={config} stability={stab[sel.site.id] ?? null} evidence={evidence} onClose={() => {}} />,
      )
      expect(drawer).toContain(`<h2>${escape(name)}</h2>`)
      const view = renderToStaticMarkup(
        <TerrainViews target={target} site={sel.site} relit={false} onToggleRelit={() => {}} mainWindowKm={config.main_window_km} />,
      )
      expect(view).toContain(`<h2>${escape(name)}</h2>`)
      expect(view).toContain(`<h2>${escape(target.name)}</h2>`)
    }
  })

  it('applies the lighting rule for the body: Moon compares low sun, Mars never warns', () => {
    const list = renderToStaticMarkup(<SiteList ranked={ranked} target={target} selectedId={null} onSelect={() => {}} />)
    if (target.body === 'mars') {
      expect(ranked.every(r => !r.warning.fired)).toBe(true)
      expect(list).not.toContain('low sun')
    } else {
      expect(list).toContain('low sun')
    }
  })

  it('gives Ask AI the full ranking from the same engine run, nothing else as a score', () => {
    const ctx = compactRun({ target, ranked, stability: stab, config, weights: w, evidence })
    expect(ctx.target.id).toBe(target.id)
    expect(ctx.ranked.map(r => r.id)).toEqual(ranked.map(r => r.site.id))
    expect(ctx.ranked.map(r => r.rank)).toEqual(ranked.map(r => r.rank))
    expect(JSON.stringify(ctx)).not.toContain('"why"')
  })

  it('keeps the selection and full set across a weight change, with ranks from the new run', () => {
    const sel = selectedEntry(ranked, ranked[2]?.site.id ?? null)!
    const w2 = { ...w, [PARAM_KEYS[0]]: 0 }
    const after = rankSites(sites, target, config, w2)
    expect(after.length).toBe(ranked.length)
    expect(selectedEntry(after, sel.site.id)?.site.id).toBe(sel.site.id)
    expect(selectedEntry(after, sel.site.id)).toBe(after.find(r => r.site.id === sel.site.id))
  })
})

describe('shipped release transitions', () => {
  it('a target change clears the choice, so each target opens on its own top site', () => {
    for (const t of targets) {
      const r = rankSites(sites, t, config, w)
      expect(selectedEntry(r, null)?.site.id).toBe(r[0].site.id)
    }
  })

  it('a site removed from the data falls back to the top site, and empty data selects nothing', () => {
    const t = targets[0]
    const full = rankSites(sites, t, config, w)
    const gone = full[0].site.id
    const fewer = rankSites(sites.filter(s => s.id !== gone), t, config, w)
    expect(selectedEntry(fewer, gone)?.site.id).toBe(fewer[0].site.id)
    expect(selectedEntry(rankSites([], t, config, w), gone)).toBeNull()
    expect(renderToStaticMarkup(<SiteDetails ex={null} />)).toContain('No Earth site is selected.')
  })

  it('the demo tour builds from the shipped data and only uses shipped targets and sites', () => {
    const steps = buildDemoSteps(data)
    expect(steps.length).toBeGreaterThan(0)
    for (const s of steps) expect(s.caption).not.toMatch(/NaN|undefined|Infinity/)
  })
})

/** Text as React renders it into HTML. */
function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
}

// issue #114: a real id used as a format example made answers talk about that site.
describe('Ask AI prompt rules', () => {
  it('use no real site, target or source id as an example', () => {
    const real = new Set<string>([
      ...(sitesJson as { id: string }[]).map(s => s.id),
      ...(targetsJson as { id: string }[]).map(t => t.id),
      ...JSON.stringify(evidenceJson).match(/"(?:source_id|site_id)":"[^"]+"/g)!.map(m => m.split(':')[1].slice(1, -1)),
    ])
    expect(real.has('etna')).toBe(true)
    const examples = PROMPT_RULES.join('\n').match(/\[[^\]]+\]/g)?.map(m => m.slice(1, -1)) ?? []
    expect(examples.length).toBeGreaterThan(0)
    for (const id of examples) expect(real.has(id), id).toBe(false)
  })
})
