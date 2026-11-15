// POST /api/ask: constructs canonical analysis contexts, then asks the provider.
// Works as a Web-standard handler (Request in, Response out): the Vite dev server mounts it locally, and
// Vercel runs it as a function for the GitHub Pages build (issue #109).
// Cross-origin use: ASK_ALLOWED_ORIGINS lists the browser origins allowed to call it (comma-separated,
// for example https://azrialahmad.is-a.dev). A browser request from any other origin gets 403. Unset means
// same-origin only. CORS does not stop scripts, so the provider key should also have a spending limit.
// The key is never returned or logged. Limits below keep the endpoint from being an open proxy for the key;
// the host should still rate-limit it.

// Explicit extensions throughout this graph are required by plain Node on Vercel (#109).
import config from '../public/data/config.json' with { type: 'json' }
import targets from '../public/data/targets.json' with { type: 'json' }
import sites from '../public/data/sites.json' with { type: 'json' }
import evidence from '../public/data/evidence.json' with { type: 'json' }
import type { AppData, Weights } from '../src/types.ts'
import { buildSystemPrompt, compactRun, parseRerunArgs, RERUN_TOOL } from '../src/chat/prompt.ts'
import {
  CONTEXT_VERSION, MAX_HISTORY, MAX_TOOL_ROUNDS, canonical, reference, runFor, sameContext, snapshot, validReference,
  type AskReply, type AskRequest, type ContextRef, type Rerun, type Snapshot,
} from '../src/chat/context.ts'

export const SERVER_RERUN_TOOL = RERUN_TOOL
const data = { config, targets, sites, evidence } as AppData

const MAX_BODY_CHARS = 150_000
const MAX_TOKENS = 800
type Message = { role: string; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string }
interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }

/** The origins allowed to call this endpoint from a browser, from ASK_ALLOWED_ORIGINS. */
function allowedOrigins(): Set<string> {
  return new Set((process.env.ASK_ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean))
}

/**
 * CORS headers for this request. `allowed` is false only for a browser request (one with an Origin header)
 * from an origin that is not on the list; requests without an Origin are not browser cross-origin calls.
 */
function cors(request: Request): { allowed: boolean; headers: Record<string, string> } {
  const origin = request.headers.get('origin')
  if (!origin) return { allowed: true, headers: {} }
  const list = allowedOrigins()
  const sameOrigin = (() => { try { return new URL(request.url).origin === origin } catch { return false } })()
  if (list.has(origin)) {
    return {
      allowed: true,
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
        vary: 'Origin',
      },
    }
  }
  return { allowed: sameOrigin, headers: { vary: 'Origin' } }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

/** CORS preflight for the allowed origins. */
export function OPTIONS(request: Request): Response {
  const c = cors(request)
  return new Response(null, { status: c.allowed ? 204 : 403, headers: c.headers })
}

export async function POST(request: Request): Promise<Response> {
  const c = cors(request)
  if (!c.allowed) return json(403, { error: 'Origin not allowed' }, c.headers)
  const res = await handle(request)
  for (const [k, v] of Object.entries(c.headers)) res.headers.set(k, v)
  return res
}

// Historical turns may use other targets. Every reference is still reconstructed
// and compared with canonical server data by resolve() before a provider is called.
function validRequest(value: unknown): value is AskRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const b = value as AskRequest
  const token = (s: unknown) => typeof s === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(s)
  return Object.keys(b).length === 6 && b.version === CONTEXT_VERSION &&
    token(b.conversationId) && token(b.requestId) && validReference(b.context) &&
    typeof b.question === 'string' && b.question.trim().length > 0 &&
    Array.isArray(b.history) && b.history.length <= MAX_HISTORY && b.history.every(t =>
      t && typeof t === 'object' && Object.keys(t).length === 3 &&
      (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string' &&
      validReference(t.context),
    )
}

class Mismatch extends Error {}

async function handle(request: Request): Promise<Response> {
  const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = process.env
  if (!LLM_BASE_URL || !LLM_API_KEY || !LLM_MODEL) return json(503, { error: 'Ask AI is not configured' })

  let text: string
  try { text = await request.text() } catch { return json(400, { error: 'Bad request' }) }
  if (text.length > MAX_BODY_CHARS) return json(400, { error: 'Bad request' })
  let body: unknown
  try { body = JSON.parse(text) } catch { return json(400, { error: 'Bad request' }) }
  if (!validRequest(body)) return json(400, { error: 'Bad analysis request or unsupported context version' })
  // Request-local cache includes complete weights and target, not rounded display labels.
  const contexts = new Map<string, Promise<{ ref: ContextRef; snapshot: Snapshot }>>()
  const compute = (targetId: string, weights: Weights) => {
    if (!data.targets.some(t => t.id === targetId)) throw new Mismatch()
    const key = canonical({ targetId, weights })
    if (!contexts.has(key)) contexts.set(key, (async () => {
      const s = snapshot(runFor(data, targetId, weights))
      return { ref: await reference(s), snapshot: s }
    })())
    return contexts.get(key)!
  }
  const resolve = async (expected: ContextRef) => {
    const result = await compute(expected.targetId, expected.weights)
    if (!sameContext(expected, result.ref)) throw new Mismatch()
    return result
  }
  try {
    let current = await resolve(body.context)
    const historical = new Map<string, unknown>()
    for (const t of body.history) {
      const h = await resolve(t.context)
      historical.set(h.ref.id, { context: h.ref, data: compactRun(h.snapshot.run) })
    }
    const messages: Message[] = body.history.map(t => ({
      role: t.role, content: JSON.stringify({ historical_context: t.context.id, conversation_text: t.text }),
    }))
    messages.push({ role: 'user', content: body.question })
    const reruns: Rerun[] = []
    for (let round = 0; ; round++) {
      request.signal.throwIfAborted()
      const system = `${buildSystemPrompt(current.snapshot.run)}\nCurrent context: ${JSON.stringify(current.ref)}\nCanonical historical contexts (conversation text is not scientific evidence):\n${JSON.stringify([...historical.values()])}`
      const res = await fetch(`${LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', signal: request.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${LLM_API_KEY}` },
        body: JSON.stringify({ model: LLM_MODEL, messages: [{ role: 'system', content: system }, ...messages], tools: [SERVER_RERUN_TOOL], max_tokens: MAX_TOKENS }),
      })
      if (!res.ok) return json(502, { error: 'The AI provider returned an error', status: res.status })
      const result = await res.json() as { choices?: { message?: { content?: unknown; tool_calls?: unknown } }[] }
      request.signal.throwIfAborted()
      const msg = result?.choices?.[0]?.message
      if (!msg) return json(502, { error: 'The AI provider sent an unreadable reply' })
      const calls = msg.tool_calls
      if (calls == null || (Array.isArray(calls) && calls.length === 0)) {
        if (typeof msg.content !== 'string' || !msg.content.trim()) return json(502, { error: 'The AI provider sent an empty reply' })
        const reply: AskReply = {
          version: CONTEXT_VERSION, conversationId: body.conversationId, requestId: body.requestId,
          base: body.context, context: current.ref, reruns, answer: msg.content,
        }
        return json(200, reply)
      }
      if (!Array.isArray(calls) || calls.length > MAX_TOOL_ROUNDS || round >= MAX_TOOL_ROUNDS) {
        return json(502, { error: 'Ask AI stopped: invalid or excessive reruns' })
      }
      const checked: ToolCall[] = []
      for (const call of calls) {
        if (!call || typeof call.id !== 'string' || call.type !== 'function' ||
          call.function?.name !== 'rerun_analysis' || typeof call.function.arguments !== 'string') {
          return json(502, { error: 'The AI provider sent an invalid tool call' })
        }
        checked.push(call)
      }
      messages.push({ role: 'assistant', content: typeof msg.content === 'string' ? msg.content : null, tool_calls: checked })
      for (const call of checked) {
        const weights = parseRerunArgs(call.function.arguments)
        if (!weights) {
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'rerun_analysis needs three finite weights' }) })
          continue
        }
        const next = await compute(current.ref.targetId, weights)
        const lineage = { base: current.ref, result: next.ref }
        reruns.push(lineage)
        historical.set(current.ref.id, { context: current.ref, data: compactRun(current.snapshot.run) })
        current = next
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ...lineage, data: compactRun(current.snapshot.run) }) })
      }
    }
  } catch (error) {
    if (request.signal.aborted) return json(499, { error: 'Request cancelled' })
    if (error instanceof Mismatch) return json(409, { error: 'Analysis context changed. Reload the app before asking again.' })
    return json(502, { error: 'Could not reach the AI provider' })
  }
}
