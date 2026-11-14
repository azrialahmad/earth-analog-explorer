import type { Config, ParamKey, RankedSite, Target, Weights } from '../types'
import { PARAM_KEYS } from '../types'
import { defaultWeights } from '../engine'

/**
 * Plain-language reasoning behind the numbers on one site card.
 * Everything is read from what the engine already produced (RankedSite, stability) and from config.
 * Nothing here computes or changes a score; it only compares values the engine returned.
 */

export interface ParamLine {
  key: ParamKey
  label: string
  unit: string
  site: number | null
  target: number | null
  similarity: number | null
  weight: number
  range: number
}

/** A parameter where this site's similarity differs from a neighbour's (shown to 2 decimals, so smaller gaps are left out). */
export interface ParamGap { label: string; mine: number; theirs: number; weight: number }

export interface Neighbour {
  rank: number
  name: string
  terrainMatch: number | null
  /** This site's similarity is higher (ahead) or lower (behind) than the neighbour's, biggest weighted gap first. */
  ahead: ParamGap[]
  behind: ParamGap[]
  /** Same Terrain Match to the stored precision: the order then falls back to the site id. */
  tie: boolean
}

export interface CardExplanation {
  rank: number
  total: number
  siteName: string
  targetName: string
  body: Target['body']
  terrainMatch: number | null
  completeness: number
  params: ParamLine[]
  /** Labels of parameters left out because a value is missing on either side. */
  missing: string[]
  above: Neighbour | null
  below: Neighbour | null
  stability: number | null
  stabilityRuns: number
  topN: number
  noiseRel: number
  /** Moon only; null for Mars, where lighting comparison does not apply. */
  lowSun: { site: number | null; target: number | null } | null
  warning: { fired: boolean; text: string | null; terrainMatchMin: number; lowSunMax: number }
  mainWindowKm: number
  weights: 'default' | 'adjusted'
  provisional: boolean
}

/** Similarity differences between two scored sites, per parameter with weight above 0 and a value on both sides. */
export function paramGaps(a: RankedSite, b: RankedSite, config: Config): { ahead: ParamGap[]; behind: ParamGap[] } {
  const ahead: ParamGap[] = []
  const behind: ParamGap[] = []
  for (const p of a.perParam) {
    const q = b.perParam.find(x => x.key === p.key)
    if (!q || p.similarity === null || q.similarity === null || !(p.weight > 0)) continue
    if (Math.round(p.similarity * 100) === Math.round(q.similarity * 100)) continue
    const gap = { label: config.params[p.key].label, mine: p.similarity, theirs: q.similarity, weight: p.weight }
    ;(p.similarity > q.similarity ? ahead : behind).push(gap)
  }
  const size = (g: ParamGap) => g.weight * Math.abs(g.mine - g.theirs)
  ahead.sort((x, y) => size(y) - size(x))
  behind.sort((x, y) => size(y) - size(x))
  return { ahead, behind }
}

function neighbour(me: RankedSite, other: RankedSite | undefined, config: Config): Neighbour | null {
  if (!other) return null
  const scored = me.terrainMatch !== null && other.terrainMatch !== null
  return {
    rank: other.rank,
    name: other.site.name,
    terrainMatch: other.terrainMatch,
    ...(scored ? paramGaps(me, other, config) : { ahead: [], behind: [] }),
    tie: scored && me.terrainMatch === other.terrainMatch,
  }
}

export function explainCard(
  entry: RankedSite,
  ranked: RankedSite[],
  target: Target,
  config: Config,
  stability: number | null,
  weights: Weights,
): CardExplanation {
  const i = ranked.findIndex(r => r.site.id === entry.site.id)
  const defaults = defaultWeights(config)
  const moon = target.body === 'moon'
  return {
    rank: entry.rank,
    total: ranked.length,
    siteName: entry.site.name,
    targetName: target.name,
    body: target.body,
    terrainMatch: entry.terrainMatch,
    completeness: entry.completeness,
    params: entry.perParam.map(p => ({
      key: p.key,
      label: config.params[p.key].label,
      unit: config.params[p.key].unit,
      site: p.site,
      target: p.target,
      similarity: p.similarity,
      weight: p.weight,
      range: config.params[p.key].range,
    })),
    missing: entry.missing.map(k => config.params[k].label),
    above: i > 0 ? neighbour(entry, ranked[i - 1], config) : null,
    below: i >= 0 ? neighbour(entry, ranked[i + 1], config) : null,
    stability,
    stabilityRuns: config.stability.runs,
    topN: config.stability.top_n,
    noiseRel: config.stability.noise_rel,
    lowSun: moon ? { site: entry.lowSunShare, target: target.low_sun_share?.value ?? null } : null,
    warning: {
      fired: entry.warning.fired,
      text: entry.warning.text,
      terrainMatchMin: config.warning.terrain_match_min,
      lowSunMax: config.warning.low_sun_share_max,
    },
    mainWindowKm: config.main_window_km,
    weights: PARAM_KEYS.every(k => weights[k] === defaults[k]) ? 'default' : 'adjusted',
    provisional: config.provisional,
  }
}

/** "a", "a and b", "a, b and c". */
export function listText(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** 1 → "1st", 2 → "2nd", 11 → "11th". */
export function ordinal(n: number): string {
  const t = n % 100
  if (t >= 11 && t <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}
