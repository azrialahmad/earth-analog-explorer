import { describe, expect, it } from 'vitest'
import { explainCard, listText, ordinal, paramGaps } from './card'
import { config, makeSite, makeTarget } from '../engine/fixture'
import { defaultWeights, rankSites } from '../engine'
import { PARAM_KEYS } from '../types'

const w = defaultWeights(config)
const target = makeTarget([10, 20, 1])
// a: exact on both slopes, 0.6 m off on roughness. b: 6° off on mean slope, exact on the rest.
const a = makeSite('a', [10, 20, 1.6], 0.1)
const b = makeSite('b', [16, 20, 1], 0.4)
const c = makeSite('c', [null, null, null])
const ranked = rankSites([b, c, a], target, config, w)
const byId = (id: string) => ranked.find(r => r.site.id === id)!

describe('explainCard', () => {
  it('reads rank, values and labels from the engine output and config', () => {
    const e = explainCard(byId('a'), ranked, target, config, 0.97, w)
    expect(e.rank).toBe(1)
    expect(e.total).toBe(3)
    expect(e.terrainMatch).toBe(byId('a').terrainMatch)
    expect(e.params.map(p => p.label)).toEqual(PARAM_KEYS.map(k => config.params[k].label))
    expect(e.params.map(p => p.similarity)).toEqual(byId('a').perParam.map(p => p.similarity))
    expect(e.params.map(p => p.range)).toEqual(e.params.map(p => config.params[p.key].range))
    expect(e.stability).toBe(0.97)
    expect(e.stabilityRuns).toBe(config.stability.runs)
    expect(e.mainWindowKm).toBe(config.main_window_km)
    expect(e.weights).toBe('default')
    expect(e.provisional).toBe(config.provisional)
  })

  it('has no neighbour above rank 1, and names the one below with the parameters that differ', () => {
    const e = explainCard(byId('a'), ranked, target, config, null, w)
    expect(e.above).toBeNull()
    expect(e.below?.name).toBe(b.name)
    expect(e.below?.ahead.map(g => g.label)).toEqual([config.params.slope_mean_deg.label])
    expect(e.below?.behind.map(g => g.label)).toEqual([config.params.roughness_m.label])
    expect(e.below?.tie).toBe(false)
  })

  it('leaves parameter gaps out when either site has no score', () => {
    const e = explainCard(byId('c'), ranked, target, config, null, w)
    expect(e.terrainMatch).toBeNull()
    expect(e.below).toBeNull()
    expect(e.above?.ahead).toEqual([])
    expect(e.above?.behind).toEqual([])
    expect(e.missing).toHaveLength(3)
  })

  it('keeps lighting for the Moon and marks it not applicable (null) for Mars', () => {
    expect(explainCard(byId('a'), ranked, target, config, null, w).lowSun).toEqual({ site: 0.1, target: 1 })
    const mars = makeTarget([10, 20, 1], 'mars')
    const r = rankSites([a, b], mars, config, w)
    const e = explainCard(r[0], r, mars, config, null, w)
    expect(e.lowSun).toBeNull()
    expect(e.warning.fired).toBe(false)
  })

  it('notes adjusted weights', () => {
    const adj = { ...w, roughness_m: w.roughness_m + 1 }
    const r = rankSites([a, b], target, config, adj)
    expect(explainCard(r[0], r, target, config, null, adj).weights).toBe('adjusted')
  })
})

describe('paramGaps', () => {
  it('skips parameters with weight 0', () => {
    const noSlope = { ...w, slope_mean_deg: 0 }
    const r = rankSites([a, b], target, config, noSlope)
    const ra = r.find(x => x.site.id === 'a')!
    const rb = r.find(x => x.site.id === 'b')!
    expect(paramGaps(ra, rb, config).ahead).toEqual([])
  })
})

describe('text helpers', () => {
  it('ordinal', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd'])
  })
  it('listText', () => {
    expect(listText([])).toBe('')
    expect(listText(['a', 'b'])).toBe('a and b')
    expect(listText(['a', 'b', 'c'])).toBe('a, b and c')
  })
})
