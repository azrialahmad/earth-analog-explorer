import { describe, expect, it } from 'vitest'
import { selectedEntry } from './selection'
import { config, makeSite, makeTarget } from './engine/fixture'
import { defaultWeights, rankSites } from './engine'

// One shared selection for list, details, data drawer and Earth view (issues #60, #95).
const w = defaultWeights(config)
const moon = makeTarget([10, 20, 1])
const mars = makeTarget([2, 5, 0.3], 'mars')
const a = makeSite('a', [10, 20, 1])
const b = makeSite('b', [3, 6, 0.4])
const c = makeSite('c', [25, 40, 3])
const sites = [a, b, c]

describe('selectedEntry', () => {
  it('keeps a chosen site that is still listed, and repeated picks are stable', () => {
    const ranked = rankSites(sites, moon, config, w)
    expect(selectedEntry(ranked, 'c')?.site.id).toBe('c')
    expect(selectedEntry(ranked, 'c')).toBe(selectedEntry(ranked, 'c'))
  })

  it('falls back to the top-ranked site with no choice, or when the chosen site is gone from the data', () => {
    const ranked = rankSites(sites, moon, config, w)
    expect(selectedEntry(ranked, null)?.site.id).toBe(ranked[0].site.id)
    const without = rankSites([a, b], moon, config, w)
    expect(selectedEntry(without, 'c')?.site.id).toBe(without[0].site.id)
  })

  it('is empty for an empty ranking, so no pane shows a stale site', () => {
    expect(selectedEntry([], 'a')).toBeNull()
    expect(selectedEntry([], null)).toBeNull()
  })

  it('a target change (App clears the choice) selects the new top site', () => {
    const forMars = rankSites(sites, mars, config, w)
    expect(forMars[0].site.id).toBe('b')
    expect(selectedEntry(forMars, null)?.site.id).toBe('b')
  })

  it('a weight change keeps the selection and its rank comes from the new engine run', () => {
    const before = rankSites(sites, moon, config, w)
    const after = rankSites(sites, moon, config, { ...w, roughness_m: 0 })
    const s = selectedEntry(after, 'b')!
    expect(s.site.id).toBe('b')
    expect(s).toBe(after.find(r => r.site.id === 'b'))
    expect(before.length).toBe(after.length)
  })

  it('still selects when no site can be scored', () => {
    const empty = makeTarget([null, null, null])
    const ranked = rankSites(sites, empty, config, w)
    expect(ranked.every(r => r.terrainMatch === null)).toBe(true)
    expect(selectedEntry(ranked, null)).toBe(ranked[0])
  })
})
