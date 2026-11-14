import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the app under /<repo>/, so assets and data use this base.
export default defineConfig({
  base: '/earth-analog-explorer/',
  plugins: [react()],
  test: { environment: 'node' },
})
