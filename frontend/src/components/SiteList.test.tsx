import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SiteList from './SiteList'
import SiteDetails from './SiteDetails'
import { config, makeSite, makeTarget } from '../engine/fixture'
import { defaultWeights, rankSites } from '../engine'
import { explainCard } from '../explain/card'

// Issue #95: one ranked list, no intro block, no Known/New filter or category chips.
const w = defaultWeights(config)
const moon = makeTarget([10, 20, 1])
const mars = makeTarget([10, 20, 1], 'mars')
const known = { ...makeSite('known', [10, 20, 1.2]), name: 'Known place', known_analog: true }
const cand = { ...makeSite('cand', [11, 21, 1]), name: 'Scan place' }
const partial = { ...makeSite('partial', [10, null, 1]), name: 'Partial place' }
const dark = { ...makeSite('dark', [10, 20, 1], 0), name: 'Dark place' }
const sites = [known, cand, partial, dark]

const list = (ranked = rankSites(sites, moon, config, w), target = moon, selectedId: string | null = null) =>
  renderToStaticMarkup(<SiteList ranked={ranked} target={target} selectedId={selectedId} onSelect={() => {}} />)

describe('SiteList', () => {
  it('starts with the ranked list: no heading, intro, filter or category chips', () => {
    const html = list()
    expect(html.startsWith('<div class="sites"><ol')).toBe(true)
    for (const gone of ['<h2', 'Earth candidates', 'sites-filter', 'Known analog', 'New candidate', 'aria-pressed="false">All']) {
      expect(html).not.toContain(gone)
    }
  })

  it('lists every loaded site once, with the overall engine rank, in engine order', () => {
    const ranked = rankSites(sites, moon, config, w)
    const html = list(ranked)
    expect((html.match(/class="site-row"/g) ?? []).length).toBe(sites.length)
    const names = [...html.matchAll(/class="nm">([^<]+)</g)].map(m => m[1])
    expect(names).toEqual(ranked.map(r => r.site.name))
    const ranks = [...html.matchAll(/class="rk num">(\d+)</g)].map(m => Number(m[1]))
    expect(ranks).toEqual(ranked.map(r => r.rank))
  })

  it('names the list with the target, for screen readers', () => {
    expect(list()).toContain(`aria-label="Earth sites ranked by Terrain Match for ${moon.name}"`)
  })

  it('keeps the light warning, missing-value chip and low sun on Moon rows', () => {
    const html = list()
    expect(html).toContain('Light mismatch')
    expect(html).toContain('2 of 3 values')
    expect(html).toContain('low sun')
  })

  it('hides low sun and the light warning on Mars rows', () => {
    const html = list(rankSites(sites, mars, config, w), mars)
    expect(html).not.toContain('low sun')
    expect(html).not.toContain('Light mismatch')
  })

  it('marks exactly the selected row', () => {
    const html = list(undefined, moon, 'cand')
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1)
    expect(html).toMatch(/aria-pressed="true"><span class="rk num">\d+<\/span><span class="row-main"><span class="nm">Scan place/)
  })

  it('shows an empty state and an unscorable-target note instead of rows', () => {
    expect(list([])).toContain('No Earth sites are loaded.')
    const none = makeTarget([null, null, null])
    const html = list(rankSites(sites, none, config, w), none)
    expect(html).toContain('has no terrain values yet')
    expect(html).toContain('not scored')
  })
})

describe('SiteDetails entry source (moved out of the list)', () => {
  const ranked = rankSites(sites, moon, config, w)
  const details = (id: string) => {
    const e = ranked.find(r => r.site.id === id)!
    return renderToStaticMarkup(<SiteDetails ex={explainCard(e, ranked, moon, config, null, w)} />)
  }
  it('says where a known entry and a scan entry came from, without ranking one above the other', () => {
    expect(details('known')).toContain('initial list of places reported as analog test areas')
    expect(details('cand')).toContain('terrain scan of a limited set of DEM tiles')
    expect(details('known')).not.toContain('Known analog')
  })
  it('keeps the bounded-catalog and not-a-suitability-rating context', () => {
    const html = details('cand')
    expect(html).toContain('not a search of all of Earth')
    expect(html).toContain('not a probability or a')
    expect(html).toContain(`${config.main_window_km} km window`)
  })
})
