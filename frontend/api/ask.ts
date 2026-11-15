// POST /api/ask: forwards a chat request to an OpenAI-compatible provider, keeping the key on the server.
// Works as a Web-standard handler (Request in, Response out): the Vite dev server mounts it locally, and
// Vercel runs it as a function for the GitHub Pages build (issue #109).
// Cross-origin use: ASK_ALLOWED_ORIGINS lists the browser origins allowed to call it (comma-separated,
// for example https://azrialahmad.is-a.dev). A browser request from any other origin gets 403. Unset means
// same-origin only. CORS does not stop scripts, so the provider key should also have a spending limit.
// The key is never returned or logged. Limits below keep the endpoint from being an open proxy for the key;
// the host should still rate-limit it.
import { RERUN_TOOL } from '../src/chat/prompt'

const MAX_MESSAGES = 40
const MAX_BODY_CHARS = 150_000
const MAX_TOKENS = 800
const ROLES = new Set(['system', 'user', 'assistant', 'tool'])

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

function validMessages(m: unknown): m is { role: string }[] {
  return Array.isArray(m) && m.length > 0 && m.length <= MAX_MESSAGES &&
    m.every(x => x && typeof x === 'object' && ROLES.has((x as { role?: unknown }).role as string))
}

async function handle(request: Request): Promise<Response> {
  const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = process.env
  if (!LLM_BASE_URL || !LLM_API_KEY || !LLM_MODEL) return json(503, { error: 'Ask AI is not configured' })

  let text: string
  try { text = await request.text() } catch { return json(400, { error: 'Bad request' }) }
  if (text.length > MAX_BODY_CHARS) return json(400, { error: 'Bad request' })
  let body: { messages?: unknown; tools?: unknown }
  try { body = JSON.parse(text) } catch { return json(400, { error: 'Bad request' }) }
  if (!body || typeof body !== 'object' || !validMessages(body.messages)) return json(400, { error: 'Bad request' })
  // Only our own tool is ever offered to the model, whatever the client sends.
  const tools = Array.isArray(body.tools) && body.tools.length > 0 ? [RERUN_TOOL] : undefined

  let res: Response
  try {
    res = await fetch(`${LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${LLM_API_KEY}` },
      body: JSON.stringify({ model: LLM_MODEL, messages: body.messages, tools, max_tokens: MAX_TOKENS }),
    })
  } catch {
    return json(502, { error: 'Could not reach the AI provider' })
  }
  if (!res.ok) return json(502, { error: 'The AI provider returned an error', status: res.status })
  try { return json(200, await res.json()) } catch { return json(502, { error: 'The AI provider sent an unreadable reply' }) }
}
