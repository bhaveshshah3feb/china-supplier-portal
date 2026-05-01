import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const BUILD_TIME = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
const BUILD_HASH = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'local'

export default defineConfig({
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
    __BUILD_HASH__: JSON.stringify(BUILD_HASH),
  },
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    port: 5173,
  },
  // Ensure workers are bundled correctly
  worker: {
    format: 'es',
  },
})
