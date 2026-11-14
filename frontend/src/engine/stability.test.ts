import { describe, expect, it } from 'vitest'
import { config, makeSite, makeTarget } from './fixture'
import { defaultWeights } from './scoring'
import { rng, sampleWeights, stability } from './stability'

const w = defaultWeights(config)
const target = makeTarget([10, 20, 1])
const sites = [
  makeSite('a', [10, 20, 1]),
  makeSite('b', [12, 22, 1.2]),
  makeSite('c', [14, 25, 1.5]),
  makeSite('d', [15, 26, 1.6]),
  makeSite('e', [25, 40, 3]),
]

describe('rng', () => {
  it('gives the same sequence for the same seed, inside [0, 1)', () => {
    const a = rng(42), b = rng(42)
    for (let i = 0; i < 100; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
})

describe('sampleWeights', () => {
  it('keeps the sum of the weights and keeps zero weights at zero', () => {
    const random = rng(1)
    for (let i = 0; i < 50; i++) {
      const s = sampleWeights({ slope_mean_deg: 2, slope_p90_deg: 1, roughness_m: 0 }, config.stability.dirichlet_concentration, random)
      expect(s.slope_mean_deg + s.slope_p90_deg + s.roughness_m).toBeCloseTo(3)
      expect(s.roughness_m).toBe(0)
      expect(s.slope_mean_deg).toBeGreaterThan(0)
    }
  })
})

describe('stability', () => {
  it('is deterministic', () => {
    expect(stability(sites, target, config, w)).toEqual(stability(sites, target, config, w))
  })
  it('gives shares in [0, 1] that sum to top_n when every site has a score', () => {
    const s = stability(sites, target, config, w)
    const values = Object.values(s)
    for (const v of values) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
    expect(values.reduce((x, y) => x + y, 0)).toBeCloseTo(config.stability.top_n)
    expect(s.a).toBe(1)
    expect(s.e).toBe(0)
  })
  it('never counts a site without a score', () => {
    const s = stability([...sites, makeSite('none', [null, null, null])], target, config, w)
    expect(s.none).toBe(0)
  })
})
