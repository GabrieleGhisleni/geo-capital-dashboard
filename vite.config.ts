import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages serves the site under /<repo>/; override with BASE_PATH if needed.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/geo-capital-dashboard/',
  plugins: [react()],
  // MapLibre v6 ships its worker as an ES module next to the main bundle.
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['maplibre-gl'] },
})
