import { fileURLToPath } from 'node:url'
import { createServer } from '../../../frontend/node_modules/vite/dist/node/index.js'
import { headerPreviewPlugin } from './preview-plugin.mjs'

const frontend = fileURLToPath(new URL('../../../frontend/', import.meta.url))
const port = Number(process.env.PREVIEW_PORT ?? 4175)
const server = await createServer({
  root: frontend,
  configFile: fileURLToPath(new URL('../../../frontend/vite.config.ts', import.meta.url)),
  cacheDir: `${frontend}node_modules/.vite-header-preview`,
  plugins: [headerPreviewPlugin()],
  server: { host: '127.0.0.1', port, strictPort: true },
})
await server.listen()
server.printUrls()

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await server.close(); process.exit(0) })
}
