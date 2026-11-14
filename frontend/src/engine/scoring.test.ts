import { describe, expect, it } from 'vitest'
import { config, makeSite, makeTarget } from './fixture'
import { defaultWeights, rankSites, scoreSite, similarity, terrainMatch, weakestParam } from './scoring'

const w = defaultWeights(config)
const range = config.params.slope_mean_deg.range
const tMin = config.warning.terrain_match_min
const sunMax = config.warning.low_sun_share_max

describe('defaultWeights', () => {
  it('reads every weight from config', () => {
    for (const k of Object.keys(w) as (keyof typeof w)[]) expect(w[k]).toBe(config.params[k].weight)
  })
})

describe('similarity', () => {
  it('is 1 at zero distance', () => expect(similarity(5, 5, range)).toBe(1))
  it('is 0 at exactly one range apart', () => expect(similarity(5 + range, 5, range)).toBe(0))
  it('is linear inside the range', () => expect(similarity(5 + range / 4, 5, range)).toBeCloseTo(0.75))
  it('stays 0 beyond the range', () => expect(similarity(5 + 3 * range, 5, range)).toBe(0))
  it('is null when either side is unknown', () => {
    expect(similarity(null, 5, range)).toBeNull()
    expect(similarity(5, null, range)).toBeNull()
  })
})

describe('terrainMatch', () => {
  const target = makeTarget([10, 20, 1])

  it('ignores a missing parameter and reports completeness 2/3', () => {
    const site = makeSite('a', [10, 20, null])
    const m = terrainMatch(site.params, target.params, config, w)
    expect(m.terrainMatch).toBe(1)
    expect(m.completeness).toBeCloseTo(2 / 3)
    expect(m.missing).toEqual(['roughness_m'])
  })

  it('is null when every parameter is missing, and that site ranks last', () => {
    const empty = makeSite('a-empty', [null, null, null])
    const m = terrainMatch(empty.params, target.params, config, w)
    expect(m.terrainMatch).toBeNull()
    expect(m.completeness).toBe(0)
    const ranked = rankSites([empty, makeSite('z-far', [50, 90, 9])], target, config, w)
    expect(ranked.map(r => r.siteId)).toEqual(['z-far', 'a-empty'])
    expect(ranked[1].rank).toBe(2)
  })
})

describe('mismatch warning', () => {
  // Mean-slope offset that gives a chosen terrain match when only mean slope differs:
  // tm = 1 - (w_mean / W) * d / range  =>  d = (1 - tm) * W * range / w_mean
  const W = Object.values(w).reduce((a, b) => a + b, 0)
  const offsetFor = (tm: number) => ((1 - tm) * W * range) / w.slope_mean_deg
  const target = makeTarget([10, 20, 1])
  const above = offsetFor(tMin + 0.02)
  const below = offsetFor(tMin - 0.02)

  it('fires on the Moon when terrain matches and the sun is rarely low', () => {
    const s = scoreSite(makeSite('a', [10 + above, 20, 1], sunMax - 0.01), target, config, w)
    expect(s.terrainMatch).toBeCloseTo(tMin + 0.02)
    expect(s.warning.fired).toBe(true)
    expect(s.warning.text).toBe(
      `Terrain matches (${s.terrainMatch!.toFixed(2)}), but the sun is under 10° for only ${Math.round((sunMax - 0.01) * 100)}% of daylight hours here. ` +
      'Rover-vision results from this site say little about polar lighting.')
  })
  it('does not fire when terrain match is below the threshold', () => {
    const s = scoreSite(makeSite('a', [10 + below, 20, 1], sunMax - 0.01), target, config, w)
    expect(s.warning.fired).toBe(false)
    expect(s.warning.text).toBeNull()
  })
  it('does not fire when the low-sun share is at or above the threshold', () => {
    expect(scoreSite(makeSite('a', [10 + above, 20, 1], sunMax), target, config, w).warning.fired).toBe(false)
    expect(scoreSite(makeSite('a', [10 + above, 20, 1], sunMax + 0.01), target, config, w).warning.fired).toBe(false)
  })
  it('does not fire when the low-sun share is unknown', () => {
    expect(scoreSite(makeSite('a', [10, 20, 1], null), target, config, w).warning.fired).toBe(false)
  })
  it('never fires for a Mars target', () => {
    expect(scoreSite(makeSite('a', [10, 20, 1], 0.01), makeTarget([10, 20, 1], 'mars'), config, w).warning.fired).toBe(false)
  })
})

describe('rankSites', () => {
  const target = makeTarget([10, 20, 1])
  // "slopes" matches slopes, misses roughness; "rough" the other way round.
  const slopes = makeSite('slopes', [10, 20, 3])
  const rough = makeSite('rough', [16, 29, 1])

  it('changes order when weights change', () => {
    const bySlope = rankSites([slopes, rough], target, config, { slope_mean_deg: 3, slope_p90_deg: 3, roughness_m: 0.1 })
    const byRough = rankSites([slopes, rough], target, config, { slope_mean_deg: 0.1, slope_p90_deg: 0.1, roughness_m: 3 })
    expect(bySlope.map(r => r.siteId)).toEqual(['slopes', 'rough'])
    expect(byRough.map(r => r.siteId)).toEqual(['rough', 'slopes'])
  })
  it('breaks ties by site id and numbers ranks from 1', () => {
    const ranked = rankSites([makeSite('b', [10, 20, 1]), makeSite('a', [10, 20, 1])], target, config, w)
    expect(ranked.map(r => [r.siteId, r.rank])).toEqual([['a', 1], ['b', 2]])
  })
  it('scores each window size, null where a window is unknown', () => {
    const s = scoreSite(makeSite('a', [10, 20, 1], 0.5, { '12': [null, null, null] }), target, config, w)
    expect(s.windowSensitivity['3']).toBe(1)
    expect(s.windowSensitivity['6']).toBe(1)
    expect(s.windowSensitivity['12']).toBeNull()
  })
})

describe('weakestParam', () => {
  const target = makeTarget([10, 20, 1])
  it('names the lowest similarity and skips missing values', () => {
    const s = scoreSite(makeSite('a', [12, 20, null]), target, config, w)
    expect(weakestParam(s.perParam)?.key).toBe('slope_mean_deg')
  })
  it('is null when every value is missing', () => {
    expect(weakestParam(scoreSite(makeSite('a', [null, null, null]), target, config, w).perParam)).toBeNull()
  })
})

describe('Mars targets', () => {
  const p: [number, number, number] = [10, 20, 1]
  const moon = makeTarget(p, 'moon')
  const mars = makeTarget(p, 'mars')
  // matches the terrain closely and has a low share of low sun: fires against the Moon
  const site = makeSite('a', [10.5, 20.5, 1.05], sunMax / 2)

  it('the fixture Mars target has no lighting value', () => expect(mars.low_sun_share).toBeNull())
  it('a site that fires the warning for the Moon does not fire it for Mars', () => {
    expect(scoreSite(site, moon, config, w).warning.fired).toBe(true)
    expect(scoreSite(site, mars, config, w).warning).toEqual({ fired: false, text: null })
  })
  it('computes Terrain Match the same way as for the Moon', () => {
    const a = scoreSite(site, moon, config, w), b = scoreSite(site, mars, config, w)
    expect(b.terrainMatch).toBe(a.terrainMatch)
    expect(b.perParam).toEqual(a.perParam)
    expect(b.windowSensitivity).toEqual(a.windowSensitivity)
  })
})
