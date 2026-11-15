import type { Config, Site, Stability, Target, Value, Weights } from '../types'
import { PARAM_KEYS } from '../types.ts'
import { compareScores, terrainMatch } from './scoring.ts'

/** Seeded generator (mulberry32). Never use Math.random in the engine. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function normal(random: () => number): number {
  const u = 1 - random() // (0, 1], avoids log(0)
  const v = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Gamma(shape, 1) by Marsaglia and Tsang; shapes below 1 use the boost u^(1/shape). */
function gamma(shape: number, random: () => number): number {
  if (!(shape > 0)) return 0
  if (shape < 1) return gamma(shape + 1, random) * Math.pow(1 - random(), 1 / shape)
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number
    let v: number
    do { x = normal(random); v = 1 + c * x } while (v <= 0)
    v = v * v * v
    const u = 1 - random()
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

/**
 * Dirichlet sample with alpha_k = concentration * weight_k / sum(weights),
 * scaled so the sampled weights sum to the original sum. A zero weight stays zero.
 */
export function sampleWeights(weights: Weights, concentration: number, random: () => number): Weights {
  const sum = PARAM_KEYS.reduce((s, k) => s + weights[k], 0)
  if (!(sum > 0)) return { ...weights }
  const draws = PARAM_KEYS.map(k => gamma((concentration * weights[k]) / sum, random))
  const total = draws.reduce((s, x) => s + x, 0)
  if (!(total > 0)) return { ...weights }
  return Object.fromEntries(PARAM_KEYS.map((k, i) => [k, (draws[i] / total) * sum])) as Weights
}

function jitter(params: Record<(typeof PARAM_KEYS)[number], Value>, noiseRel: number, random: () => number) {
  return Object.fromEntries(PARAM_KEYS.map(k => {
    const v = params[k]
    const u = (random() * 2 - 1) * noiseRel
    return [k, v.value === null ? v : { ...v, value: v.value * (1 + u) }]
  })) as typeof params
}

/**
 * Share of runs in which each site is in the top N, with perturbed weights and inputs.
 * Sites without a score are never counted. Same seed and inputs give the same output.
 */
export function stability(sites: Site[], target: Target, config: Config, weights: Weights): Stability {
  const { runs, top_n, seed, dirichlet_concentration, noise_rel } = config.stability
  const random = rng(seed)
  const counts: Record<string, number> = Object.fromEntries(sites.map(s => [s.id, 0]))
  if (!(runs > 0)) return counts
  for (let r = 0; r < runs; r++) {
    const w = sampleWeights(weights, dirichlet_concentration, random)
    const scored = sites
      .map(s => ({ siteId: s.id, terrainMatch: terrainMatch(jitter(s.params, noise_rel, random), target.params, config, w).terrainMatch }))
      .filter(s => s.terrainMatch !== null)
      .sort(compareScores)
    for (const s of scored.slice(0, top_n)) counts[s.siteId]++
  }
  return Object.fromEntries(Object.entries(counts).map(([id, c]) => [id, c / runs]))
}
