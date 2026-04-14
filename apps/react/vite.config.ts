import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Production-friendly config:
//  - SESSION_TOKEN / VITE_SESSION_TOKEN: bundled into the build so the React
//    app can call the API. No hardcoded fallback (the previous one leaked
//    into the public repo). Set this in your Vercel/Vite environment.
//  - VITE_API_BASE_URL: full URL of the deployed API (e.g.
//    https://prepship-api.onrender.com/api). When unset, the dev server's
//    /api proxy handles it.
//  - VITE_API_PROXY_TARGET: only used by `vite dev`'s proxy for local API.
const sessionToken =
  process.env.VITE_SESSION_TOKEN ??
  process.env.SESSION_TOKEN ??
  ''
const apiBaseUrl = process.env.VITE_API_BASE_URL ?? ''
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:4010'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@prepshipv2/contracts': path.resolve(__dirname, '../../packages/contracts/src'),
    },
  },
  server: {
    port: 4014,
    host: '0.0.0.0',
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '192.168.1.203',
      '100.103.254.11',
      'prepshipv3.drprepperusa.com',
    ],
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        headers: {
          'X-App-Token': sessionToken,
        },
      },
    },
  },
  build: {
    outDir: 'dist',
  },
  define: {
    'import.meta.env.VITE_SESSION_TOKEN': JSON.stringify(sessionToken),
    'import.meta.env.VITE_API_PROXY_TARGET': JSON.stringify(apiProxyTarget),
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBaseUrl),
  },
})
