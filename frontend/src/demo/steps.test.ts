import { describe, expect, it } from 'vitest'
import type { AppData, Evidence } from '../types'
import { config, makeSite, makeTarget } from '../engine/fixture'
import { buildDemoSteps } from './steps'

const evidence = {} as Evidence
const moonA = { ...makeTarget([10, 20, 1]), id: 'moon-a', name: 'Moon A' }
const moonB = { ...makeTarget([5, 10, 0.5]), id: 'moon-b', name: 'Moon B' }
const mars = { ...makeTarget([4, 9, 0.5], 'mars'), id: 'mars', name: 'Mars T' }
// close to moon A but with plenty of low sun: never flagged on A
const polar = makeSite('polar', [10, 20, 1], 0.5)
// close to moon B with little low sun: flagged on B
const sunny = makeSite('sunny', [5, 10, 0.5], 0.1)

const data = (targets = [moonA, moonB, mars], sites = [polar, sunny]): AppData => ({ config, targets, sites, evidence })

const sum = (steps: { ms: number }[]) => steps.reduce((s, x) => s + x.ms, 0)

describe('buildDemoSteps', () => {
  it('fits the 75-second script', () => {
    expect(sum(buildDemoSteps(data()))).toBeLessThanOrEqual(75000)
  })

  it('moves on to the first Moon target with a flagged site, using engine numbers', () => {
    const captions = buildDemoSteps(data()).map(s => s.caption)
    expect(captions[0]).toContain('Moon A')
    expect(captions[0]).toContain('Best match: polar, Terrain Match 1.00')
    expect(captions[1]).toContain('No site at Moon A trips the light warning')
    expect(captions[1]).toContain(`${Math.round(config.warning.low_sun_share_max * 100)}%`)
    expect(captions[2]).toContain('At Moon B, sunny matches the ground at 1.00')
    expect(captions[2]).toContain('only 10% of daylight')
  })

  it('applies steps through the app actions only', () => {
    const calls: string[] = []
    const a = {
      pickTarget: (id: string) => calls.push(`target:${id}`),
      selectSite: (id: string | null) => calls.push(`site:${id}`),
      setRelit: (on: boolean) => calls.push(`relit:${on}`),
      setWeights: () => calls.push('weights'),
      resetWeights: () => calls.push('reset'),
    }
    for (const s of buildDemoSteps(data())) s.apply(a)
    expect(calls).toContain('target:moon-b')
    expect(calls).toContain('site:sunny')
    expect(calls).toContain('relit:true')
    expect(calls).toContain('weights')
    expect(calls.at(-2)).toBe('target:mars')
  })

  it('says so when no site is flagged, and when Mars has no values', () => {
    const emptyMars = { ...makeTarget([null, null, null] as never, 'mars'), id: 'm', name: 'Empty Mars' }
    const captions = buildDemoSteps(data([moonA, emptyMars], [polar])).map(s => s.caption)
    expect(captions).toContain('No site trips the light warning with the current data.')
    expect(captions.some(c => c.includes('not computed yet'))).toBe(true)
  })

  it('has no steps without a Moon target', () => {
    expect(buildDemoSteps(data([mars]))).toEqual([])
  })
})
