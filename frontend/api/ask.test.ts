import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OPTIONS, POST, SERVER_RERUN_TOOL } from './ask'
import { RERUN_TOOL } from '../src/chat/prompt'
import { readFileSync } from 'node:fs'

const KEY = 'test-key-not-real'
const req = (body: unknown) => new Request('http://localhost/api/ask', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
const good = { messages: [{ role: 'user', content: 'hi' }], tools: [{}] }

describe('POST /api/ask', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    delete process.env.LLM_BASE_URL; delete process.env.LLM_API_KEY; delete process.env.LLM_MODEL; delete process.env.ASK_ALLOWED_ORIGINS
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

  it('has no imports, so Vercel can load it as a plain Node ES module (issue #109)', () => {
    const src = readFileSync(new URL('./ask.ts', import.meta.url), 'utf-8')
    expect(src).not.toMatch(/^\s*import\s/m)
    expect(src).not.toMatch(/import\(/)
  })

  it('offers the model exactly the same rerun tool as the app (the server keeps its own copy)', () => {
    expect(JSON.parse(JSON.stringify(SERVER_RERUN_TOOL))).toEqual(JSON.parse(JSON.stringify(RERUN_TOOL)))
  })

  // issue #109: the Pages app calls this endpoint on Vercel, so it is cross-origin.
  describe('CORS', () => {
    const PAGES = 'https://azrialahmad.is-a.dev'
    const from = (origin: string, method = 'POST') =>
      new Request('https://ask.example.vercel.app/api/ask', { method, headers: { origin }, body: method === 'POST' ? JSON.stringify(good) : undefined })

    it('allows a listed origin, on the preflight and the POST', async () => {
      configure()
      process.env.ASK_ALLOWED_ORIGINS = `${PAGES}/, https://other.test`
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })))
      const pre = OPTIONS(from(PAGES, 'OPTIONS'))
      expect(pre.status).toBe(204)
      expect(pre.headers.get('access-control-allow-origin')).toBe(PAGES)
      expect(pre.headers.get('access-control-allow-methods')).toContain('POST')
      const r = await POST(from(PAGES))
      expect(r.status).toBe(200)
      expect(r.headers.get('access-control-allow-origin')).toBe(PAGES)
    })

    it('refuses a browser origin that is not listed, without calling the provider', async () => {
      configure()
      process.env.ASK_ALLOWED_ORIGINS = PAGES
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      expect(OPTIONS(from('https://evil.test', 'OPTIONS')).status).toBe(403)
      const r = await POST(from('https://evil.test'))
      expect(r.status).toBe(403)
      expect(r.headers.get('access-control-allow-origin')).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('with no list, allows same-origin and no-origin requests only', async () => {
      configure()
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })))
      expect((await POST(from('https://ask.example.vercel.app'))).status).toBe(200)
      expect((await POST(req(good))).status).toBe(200)
      expect((await POST(from(PAGES))).status).toBe(403)
    })

    it('adds CORS headers to error answers too, so the app can read them', async () => {
      process.env.ASK_ALLOWED_ORIGINS = PAGES
      const r = await POST(from(PAGES))
      expect(r.status).toBe(503)
      expect(r.headers.get('access-control-allow-origin')).toBe(PAGES)
    })
  })
})
