import type { Config, ParamKey, ParamScore, RankedSite, Site, SiteScore, Target, Value, Weights, WindowKey } from '../types'
import { PARAM_KEYS, WINDOW_KEYS } from '../types'

/** The default weight of each parameter, read from config (never hard-coded). */
export function defaultWeights(config: Config): Weights {
  return Object.fromEntries(PARAM_KEYS.map(k => [k, config.params[k].weight])) as Weights
}

/** 1 for identical values, falling linearly to 0 at `range` apart. Null if either side is unknown. */
export function similarity(x: number | null, t: number | null, range: number): number | null {
  if (x === null || t === null || !Number.isFinite(x) || !Number.isFinite(t) || !(range > 0)) return null
  return Math.max(0, 1 - Math.abs(x - t) / range)
}

export interface TerrainMatchResult {
  terrainMatch: number | null
  completeness: number
  missing: ParamKey[]
  perParam: ParamScore[]
}

type ParamValues = Record<ParamKey, number | null>

const valuesOf = (p: Record<ParamKey, Value>): ParamValues =>
  Object.fromEntries(PARAM_KEYS.map(k => [k, p[k].value])) as ParamValues

function matchValues(site: ParamValues, target: ParamValues, config: Config, weights: Weights): TerrainMatchResult {
  let num = 0
  let den = 0
  let totalWeight = 0
  const missing: ParamKey[] = []
  const perParam = PARAM_KEYS.map(key => {
    const w = weights[key]
    totalWeight += w
    const s = similarity(site[key], target[key], config.params[key].range)
    if (s === null) missing.push(key)
    else { num += w * s; den += w }
    return { key, site: site[key], target: target[key], similarity: s, weight: w }
  })
  return {
    terrainMatch: den > 0 ? num / den : null,
    completeness: totalWeight > 0 ? den / totalWeight : 0,
    missing,
    perParam,
  }
}

/**
 * Weighted mean of similarity over the parameters that have a value on both sides.
 * Null when no parameter has a value. Completeness = weight with a value / all weight.
 */
export function terrainMatch(
  siteParams: Record<ParamKey, Value>,
  targetParams: Record<ParamKey, Value>,
  config: Config,
  weights: Weights,
): TerrainMatchResult {
  return matchValues(valuesOf(siteParams), valuesOf(targetParams), config, weights)
}

export function warningText(tm: number, lowSun: number): string {
  return `Terrain matches (${tm.toFixed(2)}), but the sun is under 10° for only ${Math.round(lowSun * 100)}% of daylight hours here. ` +
    'Rover-vision results from this site say little about polar lighting.'
}

export function scoreSite(site: Site, target: Target, config: Config, weights: Weights): SiteScore {
  const m = terrainMatch(site.params, target.params, config, weights)
  const lowSunShare = site.conditions.low_sun_share.value
  const fired = target.body === 'moon'
    && m.terrainMatch !== null
    && m.terrainMatch >= config.warning.terrain_match_min
    && lowSunShare !== null
    && lowSunShare < config.warning.low_sun_share_max
  const windowSensitivity = Object.fromEntries(WINDOW_KEYS.map(w => [
    w,
    site.windows?.[w] && target.windows?.[w]
      ? matchValues(site.windows[w], target.windows[w], config, weights).terrainMatch
      : null,
  ])) as Record<WindowKey, number | null>
  return {
    siteId: site.id,
    terrainMatch: m.terrainMatch,
    perParam: m.perParam,
    completeness: m.completeness,
    missing: m.missing,
    lowSunShare,
    warning: { fired, text: fired ? warningText(m.terrainMatch!, lowSunShare!) : null },
    windowSensitivity,
  }
}

/** Sorted by Terrain Match, highest first; unknown scores last; ties broken by site id. Rank starts at 1. */
export function rankSites(sites: Site[], target: Target, config: Config, weights: Weights): RankedSite[] {
  return sites
    .map(site => ({ ...scoreSite(site, target, config, weights), site }))
    .sort(compareScores)
    .map((s, i) => ({ ...s, rank: i + 1 }))
}

export function compareScores(a: { terrainMatch: number | null; siteId: string }, b: { terrainMatch: number | null; siteId: string }): number {
  if (a.terrainMatch === null && b.terrainMatch === null) return a.siteId.localeCompare(b.siteId)
  if (a.terrainMatch === null) return 1
  if (b.terrainMatch === null) return -1
  if (b.terrainMatch !== a.terrainMatch) return b.terrainMatch - a.terrainMatch
  return a.siteId.localeCompare(b.siteId)
}
