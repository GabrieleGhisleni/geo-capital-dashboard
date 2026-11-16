import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// The production site is served from the root of its custom domain.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  // Two pages: the atlas (index.html) and the daylight comparison (luce/), which loads no map.
  build: { rolldownOptions: { input: { main: page('index.html'), luce: page('luce/index.html') } } },
  // MapLibre v6 ships its worker as an ES module next to the main bundle.
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['maplibre-gl'] },
})
