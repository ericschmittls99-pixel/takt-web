import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // MapLibre lädt seinen Web-Worker via new URL('./maplibre-gl-worker.mjs', import.meta.url).
  // Vites Dep-Prebundle würde import.meta.url auf .vite/deps zeigen → Worker 404. Nicht prebundeln,
  // dann wird der Worker aus dem echten dist/ aufgelöst. (Der Prod-Build via Rollup ist unbetroffen.)
  optimizeDeps: { exclude: ['maplibre-gl'] },
})
