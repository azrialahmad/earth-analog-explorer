// Placeholder created by F0 so the shell compiles. Brief F1 (#5) replaces this file
// with the real scoring and stability engine. Until then every score is null
// ("missing"); nothing here invents a number.
import type { Config, RankedSite, Site, Stability, Target, Weights } from '../types'
import { PARAM_KEYS, WINDOW_KEYS } from '../types'

export function defaultWeights(config: Config): Weights {
  return Object.fromEntries(PARAM_KEYS.map(k => [k, config.params[k].weight])) as Weights
}

export function rankSites(sites: Site[], target: Target, _config: Config, weights: Weights): RankedSite[] {
  return [...sites].sort((a, b) => a.id.localeCompare(b.id)).map((site, i) => ({
    siteId: site.id,
    terrainMatch: null,
    perParam: PARAM_KEYS.map(key => ({
      key, site: site.params[key].value, target: target.params[key].value, similarity: null, weight: weights[key],
    })),
    completeness: PARAM_KEYS.filter(k => site.params[k].value !== null).length / PARAM_KEYS.length,
    missing: PARAM_KEYS.filter(k => site.params[k].value === null),
    lowSunShare: target.body === 'moon' ? site.conditions.low_sun_share.value : null,
    warning: { fired: false, text: null },
    windowSensitivity: Object.fromEntries(WINDOW_KEYS.map(w => [w, null])) as RankedSite['windowSensitivity'],
    rank: i + 1,
    site,
  }))
}

export function stability(_sites: Site[], _target: Target, _config: Config, _weights: Weights): Stability {
  return {}
}
