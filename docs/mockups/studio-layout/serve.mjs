import { fileURLToPath } from 'node:url'
import { createServer } from '../../../frontend/node_modules/vite/dist/node/index.js'
import { studioPreviewPlugin } from './preview-plugin.mjs'

const frontend = fileURLToPath(new URL('../../../frontend/', import.meta.url))
const server = await createServer({
  root: frontend,
  configFile: `${frontend}vite.config.ts`,
  cacheDir: `${frontend}node_modules/.vite-studio-mockup`,
  plugins: [studioPreviewPlugin()],
  server: { host: '127.0.0.1', port: 4178, strictPort: true },
})
await server.listen()
server.printUrls()
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await server.close(); process.exit(0) })
}
