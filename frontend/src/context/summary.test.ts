import { describe, expect, it } from 'vitest'
import { comparisonSummary, listText } from './summary'
import { defaultWeights } from '../engine'
import type { Config, Target } from '../types'

const config: Config = {
  main_window_km: 6,
  window_sizes_km: [3, 6, 12],
  params: {
    slope_mean_deg: { label: 'Mean slope', unit: '°', weight: 1, range: 20 },
    slope_p90_deg: { label: '90th percentile slope', unit: '°', weight: 1, range: 30 },
    roughness_m: { label: 'Roughness (150 m)', unit: 'm', weight: 1, range: 3 },
  },
  warning: { terrain_match_min: 0.8, low_sun_share_max: 0.25 },
  stability: { runs: 10, top_n: 3, seed: 1, dirichlet_concentration: 30, noise_rel: 0.1 },
  provisional: true,
}

const target = (body: Target['body'], name: string): Target => ({
  id: name, name, lat: 0, lon: 0, note: '', body,
  params: {} as Target['params'], windows: {} as Target['windows'],
  low_sun_share: null, hillshade: '', relief: null,
})

describe('comparisonSummary', () => {
  it('reads the target, site count, parameters and windows from the loaded data', () => {
    const s = comparisonSummary(target('moon', 'Shackleton rim'), config, 12, defaultWeights(config))
    expect(s.targetName).toBe('Shackleton rim')
    expect(s.body).toBe('Moon')
    expect(s.siteCount).toBe(12)
    expect(s.params.map(p => p.label)).toEqual(['Mean slope', '90th percentile slope', 'Roughness (150 m)'])
    expect(s.params.map(p => p.unit)).toEqual(['°', '°', 'm'])
    expect(s.mainWindowKm).toBe(6)
    expect(s.otherWindowsKm).toEqual([3, 12])
    expect(s.weights).toBe('default')
    expect(s.provisional).toBe(true)
    expect(s.lighting).toBe('separate')
  })

  it('treats Mars lighting as not applicable', () => {
    const s = comparisonSummary(target('mars', 'Jezero crater floor'), config, 12, defaultWeights(config))
    expect(s.body).toBe('Mars')
    expect(s.lighting).toBe('not applicable')
  })

  it('notes adjusted weights and leaves zero-weight parameters out of the driving list', () => {
    const w = { ...defaultWeights(config), roughness_m: 0, slope_mean_deg: 2 }
    const s = comparisonSummary(target('moon', 'Malapert massif'), config, 12, w)
    expect(s.weights).toBe('adjusted')
    expect(s.params.map(p => p.label)).toEqual(['Mean slope', '90th percentile slope'])
    expect(s.unweighted.map(p => p.label)).toEqual(['Roughness (150 m)'])
  })

  it('keeps the provisional flag as configured', () => {
    const s = comparisonSummary(target('moon', 'x'), { ...config, provisional: false }, 1, defaultWeights(config))
    expect(s.provisional).toBe(false)
  })
})

describe('listText', () => {
  it('joins with commas and a final "and"', () => {
    expect(listText([])).toBe('')
    expect(listText(['a'])).toBe('a')
    expect(listText(['a', 'b'])).toBe('a and b')
    expect(listText(['a', 'b', 'c'])).toBe('a, b and c')
  })
})
