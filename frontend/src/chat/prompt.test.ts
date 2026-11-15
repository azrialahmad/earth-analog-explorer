import { describe, expect, it } from 'vitest'
import type { Evidence } from '../types'
import { config, makeSite, makeTarget } from '../engine/fixture'
import { defaultWeights, rankSites, stability } from '../engine'
import { buildSystemPrompt, compactRun, parseRerunArgs, PROMPT_RULES, RERUN_TOOL, rerunResult } from './prompt'

const evidence: Evidence = {
  cited: { source_id: 'c', source: 'Cited source', model: 'm', metric: 'delta1', rows: [] },
  ours: { source_id: 'o', source: 'Our source', model: 'm', metric_note: 'note', rows: [], images: [] },
  not_shown: ['x'], sky_caveat: 'sky',
}
const w = defaultWeights(config)
const moon = makeTarget([10, 20, 1])
const mars = makeTarget([10, 20, 1], 'mars')
const sites = [makeSite('a', [10.4, 20.4, 1.04], 0.1), makeSite('b', [null, null, null])]
const run = (t = moon) => ({ target: t, ranked: rankSites(sites, t, config, w), stability: stability(sites, t, config, w), config, weights: w, evidence })

describe('buildSystemPrompt', () => {
  it('carries every rule, including the Mars rule, then the run as JSON', () => {
    const p = buildSystemPrompt(run())
    for (const r of PROMPT_RULES) expect(p).toContain(r)
    expect(p).toContain('For a Mars target, the lighting axis and warning do not apply.')
    const data = JSON.parse(p.slice(p.indexOf('{')))
    expect(data.ranked[0].id).toBe('a')
  })
  it('never uses the forbidden word', () => {
    expect(buildSystemPrompt(run()).toLowerCase()).not.toContain('validat')
  })
})

describe('compactRun', () => {
  it('passes engine numbers through, rounded, with tiers and the warning text', () => {
    const c = compactRun(run())
    const a = c.ranked[0]
    expect(a.terrain_match).toBe(Math.round(run().ranked[0].terrainMatch! * 1000) / 1000)
    expect(a.warning).toBe(run().ranked[0].warning.text)
    expect(a.params.slope_mean_deg.tier).toBe('estimated')
  })
  it('keeps unknowns as null and unscored sites as not scored', () => {
    const b = compactRun(run()).ranked[1]
    expect(b.terrain_match).toBeNull()
    expect(b.top3_stability).toBe('not scored')
  })
  it('marks lighting as not applicable for Mars', () => {
    const c = compactRun(run(mars))
    expect(c.target.low_sun_share).toBe('not applicable')
    expect(c.ranked[0].low_sun_share).toBe('not applicable')
    expect(c.ranked[0].warning).toBeNull()
  })
})

describe('rerun tool', () => {
  it('asks for the three weights, 0 to 3', () => {
    const p = RERUN_TOOL.function.parameters
    expect(p.required).toEqual(['slope_mean_deg', 'slope_p90_deg', 'roughness_m'])
  })
  it('parses and clamps valid arguments', () => {
    expect(parseRerunArgs('{"slope_mean_deg":1,"slope_p90_deg":5,"roughness_m":-1}')).toEqual({ slope_mean_deg: 1, slope_p90_deg: 3, roughness_m: 0 })
  })
  it('rejects bad arguments', () => {
    expect(parseRerunArgs('not json')).toBeNull()
    expect(parseRerunArgs('{"slope_mean_deg":1,"slope_p90_deg":1}')).toBeNull()
    expect(parseRerunArgs('{"slope_mean_deg":"2","slope_p90_deg":1,"roughness_m":1}')).toBeNull()
  })
  it('returns the engine ranking', () => {
    const r = rerunResult(w, run().ranked)
    expect(r.ranked.map(x => x.id)).toEqual(['a', 'b'])
  })
})

// issue #62: a scan candidate's why text carries the score from the run that picked it. Ask AI must
// not receive it as if it explained the current ranking; the prompt carries live engine numbers only.
describe('selection history stays out of the prompt', () => {
  it('does not include any site why text', () => {
    const history = 'Picked among the scanned windows for Malapert massif (0.96) Terrain Match with default weights'
    const cands = [{ ...makeSite('cand', [10, 20, 1]), why: history }, makeSite('a', [10.4, 20.4, 1.04])]
    const p = buildSystemPrompt({ target: moon, ranked: rankSites(cands, moon, config, w), stability: stability(cands, moon, config, w), config, weights: w, evidence })
    expect(p).not.toContain('Picked among the scanned windows')
    expect(p).not.toContain('0.96')
  })
})
