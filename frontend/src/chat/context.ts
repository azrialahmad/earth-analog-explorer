import type { AppData, Weights } from '../types.ts'
import { PARAM_KEYS } from '../types.ts'
import { rankSites } from '../engine/scoring.ts'
import { stability } from '../engine/stability.ts'
import type { AskRun } from './prompt.ts'

export const CONTEXT_VERSION = 1
// Transport limits, not scientific thresholds. Leave space for system + current question.
export const MAX_HISTORY = 38
export const MAX_TOOL_ROUNDS = 3
export interface ContextRef {
  version: typeof CONTEXT_VERSION
  id: string
  targetId: string
  weights: Weights
}
export interface Snapshot { run: AskRun; key: string }
export interface Turn { role: 'user' | 'assistant'; text: string; context: ContextRef }
export interface AskRequest {
  version: typeof CONTEXT_VERSION
  conversationId: string
  requestId: string
  context: ContextRef
  question: string
  history: Turn[]
}
export interface Rerun { base: ContextRef; result: ContextRef }
export interface AskReply {
  version: typeof CONTEXT_VERSION
  conversationId: string
  requestId: string
  base: ContextRef
  context: ContextRef
  reruns: Rerun[]
  answer: string
}

/** Stable key order, full numeric precision. Never hash the rounded display/prompt data. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const o = value as Record<string, unknown>
  return `{${Object.keys(o).sort().filter(k => o[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

export function snapshot(run: AskRun): Snapshot {
  // Own all nested objects so later React state changes cannot relabel a past turn.
  const copy = freeze(structuredClone(run))
  return { run: copy, key: canonical({ version: CONTEXT_VERSION, run: copy }) }
}

export async function reference(s: Snapshot): Promise<ContextRef> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s.key))
  return {
    version: CONTEXT_VERSION,
    id: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join(''),
    targetId: s.run.target.id,
    weights: { ...s.run.weights },
  }
}

export function sameContext(a: ContextRef, b: ContextRef): boolean {
  return canonical(a) === canonical(b)
}

export function validWeights(value: unknown): value is Weights {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  // There is no config-backed upper slider bound. Do not invent one in the API.
  return Object.keys(o).length === PARAM_KEYS.length && PARAM_KEYS.every(k =>
    typeof o[k] === 'number' && Number.isFinite(o[k]) && o[k] >= 0,
  ) && Number.isFinite(PARAM_KEYS.reduce((sum, k) => sum + (o[k] as number), 0))
}

export function validReference(value: unknown): value is ContextRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const c = value as ContextRef
  return Object.keys(c).length === 4 && c.version === CONTEXT_VERSION &&
    typeof c.id === 'string' && /^[a-f0-9]{64}$/.test(c.id) &&
    typeof c.targetId === 'string' && validWeights(c.weights)
}

export function runFor(data: AppData, targetId: string, weights: Weights): AskRun {
  const target = data.targets.find(t => t.id === targetId)
  if (!target || !validWeights(weights)) throw new Error('Unknown target or invalid weights')
  return {
    siteOrder: data.sites.map(s => s.id),
    target, weights: { ...weights }, config: data.config, evidence: data.evidence,
    ranked: rankSites(data.sites, target, data.config, weights),
    stability: stability(data.sites, target, data.config, weights),
  }
}

export function rerunSnapshot(base: Snapshot, weights: Weights): Snapshot {
  const byId = new Map(base.run.ranked.map(r => [r.site.id, r.site]))
  return snapshot(runFor({
    targets: [base.run.target], sites: (base.run.siteOrder ?? [...byId.keys()]).map(id => byId.get(id)!),
    config: base.run.config, evidence: base.run.evidence,
  }, base.run.target.id, weights))
}
