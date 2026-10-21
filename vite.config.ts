import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// GitHub Pages serves the site under /<repo>/; override with BASE_PATH if needed.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/geo-capital-dashboard/',
  plugins: [react()],
  // Two pages: the atlas (index.html) and the daylight comparison (luce/), which loads no map.
  build: { rolldownOptions: { input: { main: page('index.html'), luce: page('luce/index.html') } } },
  // MapLibre v6 ships its worker as an ES module next to the main bundle.
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['maplibre-gl'] },
})
