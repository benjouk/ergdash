import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Offline support: precache the app shell, serve cached API reads when
    // the server is unreachable. Browsers only run service workers on secure
    // origins (HTTPS or localhost), so plain LAN-IP HTTP installs simply skip
    // it - no harm, no offline. The hosted demo disables it entirely: its
    // fixtures live in the bundle already and a stale-SW demo is worse than
    // no SW.
    VitePWA({
      disable: process.env.VITE_DEMO === '1',
      registerType: 'autoUpdate',
      // The hand-written public/manifest.webmanifest stays the source of truth.
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,webmanifest}'],
        // SPA routes fall back to the cached shell; server routes never do.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//, /^\/health/],
        runtimeCaching: [
          {
            // Cache API reads for offline viewing. Admin (backup/export
            // downloads) and import are excluded: large, one-shot payloads
            // that must never be served stale.
            urlPattern: ({ url, request }) =>
              request.method === 'GET'
              && (url.pathname === '/auth/status'
                || (url.pathname.startsWith('/api/')
                  && !url.pathname.startsWith('/api/admin/')
                  && !url.pathname.startsWith('/api/import/'))),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'ergdash-api',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 300, maxAgeSeconds: 14 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
