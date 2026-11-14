import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './ask'

const KEY = 'test-key-not-real'
const req = (body: unknown) => new Request('http://localhost/api/ask', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
const good = { messages: [{ role: 'user', content: 'hi' }], tools: [{}] }

describe('POST /api/ask', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    delete process.env.LLM_BASE_URL; delete process.env.LLM_API_KEY; delete process.env.LLM_MODEL
  })
  afterEach(() => { process.env = { ...saved }; vi.unstubAllGlobals() })
  const configure = () => Object.assign(process.env, { LLM_BASE_URL: 'https://llm.test/v1/', LLM_API_KEY: KEY, LLM_MODEL: 'm' })

  it('answers 503 when not configured', async () => {
    const r = await POST(req(good))
    expect(r.status).toBe(503)
    expect(await r.json()).toEqual({ error: 'Ask AI is not configured' })
  })

  it('answers 400 for a bad body', async () => {
    configure()
    expect((await POST(req('nope'))).status).toBe(400)
    expect((await POST(req({ messages: [] }))).status).toBe(400)
    expect((await POST(req({ messages: [{ role: 'hacker', content: 'x' }] }))).status).toBe(400)
  })

  it('forwards to the provider with the key, our tool only, and returns its JSON', async () => {
    configure()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await POST(req({ ...good, tools: [{ type: 'function', function: { name: 'other' } }] }))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ choices: [{ message: { content: 'ok' } }] })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://llm.test/v1/chat/completions')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
    const sent = JSON.parse(init.body as string)
    expect(sent.model).toBe('m')
    expect(sent.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual(['rerun_analysis'])
  })

  it('answers 502 on a provider error and never echoes the key', async () => {
    configure()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`bad key ${KEY}`, { status: 401 })))
    const r = await POST(req(good))
    expect(r.status).toBe(502)
    expect(await r.text()).not.toContain(KEY)
  })
})
