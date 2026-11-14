// What Ask AI is told, and the one tool it may call. The model explains numbers the engine
// produced; it never writes a score. To change weights it calls rerun_analysis and the engine reranks.
import type { Config, Evidence, ParamKey, RankedSite, Stability, Target, Weights } from '../types'
import { PARAM_KEYS } from '../types'

export interface AskRun {
  target: Target
  ranked: RankedSite[]
  stability: Stability
  config: Config
  weights: Weights
  evidence: Evidence
}

export const PROMPT_RULES = [
  'Answer only from the data below. Name the site id or source id in square brackets, like [etna].',
  'Say "missing" for null. Never estimate a value. State the tier when you quote a value.',
  'You cannot change scores. To change weights, call rerun_analysis; the app reranks and returns the new ranking.',
  'Never say or imply that the depth evidence proves or confirms the ranking. It measures how well a depth model reads this kind of ground, nothing more.',
  'Weights, ranges and thresholds are provisional defaults.',
  'For a Mars target, the lighting axis and warning do not apply. Say so if asked; do not compare Mars lighting with Earth lighting.',
  'Keep answers under about 150 words.',
]

/** OpenAI-style tool definition. Arguments are the three weights, each 0 to 3. */
export const RERUN_TOOL = {
  type: 'function',
  function: {
    name: 'rerun_analysis',
    description: 'Rerank the Earth sites for the current target with new parameter weights. Returns the new ranking from the engine.',
    parameters: {
      type: 'object',
      properties: Object.fromEntries(PARAM_KEYS.map(k => [k, { type: 'number', minimum: 0, maximum: 3, description: `Weight for ${k}, 0 to 3` }])),
      required: [...PARAM_KEYS],
      additionalProperties: false,
    },
  },
} as const

const r3 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000)

/** The run as compact JSON-ready data: rounded numbers, tiers and sources, nothing the engine did not produce. */
export function compactRun(run: AskRun) {
  const { target, ranked, stability, config, weights, evidence } = run
  const moon = target.body === 'moon'
  return {
    target: {
      id: target.id, name: target.name, body: target.body, note: target.note,
      params: Object.fromEntries(PARAM_KEYS.map(k => [k, { value: r3(target.params[k].value), tier: target.params[k].tier, source: target.params[k].source }])),
      low_sun_share: moon ? { value: r3(target.low_sun_share?.value), tier: target.low_sun_share?.tier ?? 'missing' } : 'not applicable',
    },
    config: {
      params: Object.fromEntries(PARAM_KEYS.map(k => [k, { label: config.params[k].label, unit: config.params[k].unit, range: config.params[k].range }])),
      warning: config.warning,
      stability: { runs: config.stability.runs, top_n: config.stability.top_n },
      provisional: config.provisional,
    },
    weights,
    ranked: ranked.map(r => ({
      rank: r.rank,
      id: r.site.id,
      name: r.site.name,
      terrain_match: r3(r.terrainMatch),
      completeness: r3(r.completeness),
      missing: r.missing,
      top3_stability: r.terrainMatch === null ? 'not scored' : r3(stability[r.site.id]),
      low_sun_share: moon ? { value: r3(r.lowSunShare), tier: r.site.conditions.low_sun_share.tier } : 'not applicable',
      warning: r.warning.fired ? r.warning.text : null,
      known_analog: r.site.known_analog,
      flags: r.site.flags,
      params: Object.fromEntries(r.perParam.map(p => [p.key, {
        site: r3(p.site), similarity: r3(p.similarity),
        tier: r.site.params[p.key].tier, source: r.site.params[p.key].source,
      }])),
    })),
    evidence: {
      cited: { source_id: evidence.cited.source_id, source: evidence.cited.source, model: evidence.cited.model, metric: evidence.cited.metric, rows: evidence.cited.rows },
      ours: { source_id: evidence.ours.source_id, source: evidence.ours.source, model: evidence.ours.model, metric_note: evidence.ours.metric_note, rows: evidence.ours.rows },
      not_shown: evidence.not_shown,
      sky_caveat: evidence.sky_caveat,
    },
  }
}

export function buildSystemPrompt(run: AskRun): string {
  return [
    'You explain an Earth analog ranking for rover navigation testing. The ranking comes from code, not from you.',
    'Rules:',
    ...PROMPT_RULES.map(r => `- ${r}`),
    '',
    'Data (JSON):',
    JSON.stringify(compactRun(run)),
  ].join('\n')
}

/** Parse rerun_analysis arguments. Null unless all three weights are finite numbers; values are clamped to 0..3. */
export function parseRerunArgs(args: string): Weights | null {
  let v: unknown
  try { v = JSON.parse(args) } catch { return null }
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const out = {} as Weights
  for (const k of PARAM_KEYS) {
    const x = o[k]
    if (typeof x !== 'number' || !Number.isFinite(x)) return null
    out[k as ParamKey] = Math.min(3, Math.max(0, x))
  }
  return out
}

/** The tool result sent back to the model: the engine's new ranking, compact. */
export function rerunResult(weights: Weights, ranked: RankedSite[]) {
  return {
    weights,
    ranked: ranked.map(r => ({ rank: r.rank, id: r.site.id, terrain_match: r3(r.terrainMatch), warning: r.warning.fired })),
  }
}
