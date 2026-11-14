import type { Config, Target, Weights } from '../types'
import { PARAM_KEYS } from '../types'
import { defaultWeights } from '../engine'

export interface ContextParam { label: string; unit: string }

/** What the workbench is comparing right now, read from the loaded config, target and weights. Nothing here is hard-coded. */
export interface ComparisonSummary {
  targetName: string
  body: 'Moon' | 'Mars'
  /** Earth sites included in the app and ranked; not a search of all of Earth. */
  siteCount: number
  /** Parameters with a weight above 0, in config order: these drive Terrain Match. */
  params: ContextParam[]
  /** Parameters the viewer set to weight 0: listed so the summary never claims they count. */
  unweighted: ContextParam[]
  mainWindowKm: number
  otherWindowsKm: number[]
  weights: 'default' | 'adjusted'
  provisional: boolean
  /** Moon: lighting is a separate comparison. Mars: lighting comparison does not apply. */
  lighting: 'separate' | 'not applicable'
}

export function comparisonSummary(target: Target, config: Config, siteCount: number, weights: Weights): ComparisonSummary {
  const defaults = defaultWeights(config)
  const param = (k: (typeof PARAM_KEYS)[number]): ContextParam => ({ label: config.params[k].label, unit: config.params[k].unit })
  return {
    targetName: target.name,
    body: target.body === 'mars' ? 'Mars' : 'Moon',
    siteCount,
    params: PARAM_KEYS.filter(k => weights[k] > 0).map(param),
    unweighted: PARAM_KEYS.filter(k => !(weights[k] > 0)).map(param),
    mainWindowKm: config.main_window_km,
    otherWindowsKm: config.window_sizes_km.filter(w => w !== config.main_window_km),
    weights: PARAM_KEYS.every(k => weights[k] === defaults[k]) ? 'default' : 'adjusted',
    provisional: config.provisional,
    lighting: target.body === 'mars' ? 'not applicable' : 'separate',
  }
}

/** "a", "a and b", "a, b and c". */
export function listText(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
