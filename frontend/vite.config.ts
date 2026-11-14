import { defineConfig } from 'vitest/config'
import { loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const ASK_KEYS = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'] as const

/**
 * Local development only: serve POST /api/ask by loading api/ask.ts.
 * Reads the LLM_* values from .env.local on the server side; they never reach the browser bundle
 * (only VITE_* variables do).
 */
function askApi(env: Record<string, string>): Plugin {
  return {
    name: 'ask-api',
    configureServer(server) {
      server.middlewares.use('/api/ask', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        for (const k of ASK_KEYS) if (env[k]) process.env[k] = env[k]
        const mod = (await server.ssrLoadModule('/api/ask.ts')) as { POST: (r: Request) => Promise<Response> }
        const out = await mod.POST(new Request('http://localhost/api/ask', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.concat(chunks),
        }))
        res.statusCode = out.status
        res.setHeader('content-type', out.headers.get('content-type') ?? 'application/json')
        res.end(await out.text())
      })
    },
  }
}

// GitHub Pages serves the app under /<repo>/, so assets and data use this base.
export default defineConfig(({ mode }) => ({
  base: '/earth-analog-explorer/',
  plugins: [react(), askApi(loadEnv(mode, process.cwd(), 'LLM_'))],
  test: { environment: 'node' },
}))
