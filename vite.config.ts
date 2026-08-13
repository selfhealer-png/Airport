import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  /*
   * Relative asset paths, so the build runs from wherever it is served.
   *
   * The default emits absolute `/assets/...`, which only works at the root of a domain — put
   * it on GitHub Pages under `/airfield/`, in a subfolder, or open it from disk and every
   * script and stylesheet 404s into a blank screen. The manifest's `start_url` and `scope`
   * are already relative for the same reason.
   */
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { host: true },
  // `preview` serves the production build, which is the only build that has a service worker
  // at all — so it is the only way to exercise the PWA. Binding it to the LAN too means that
  // testing can happen on the phone rather than only on this machine.
  preview: { host: true },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png'],
      manifest: {
        name: 'Airfield',
        short_name: 'Airfield',
        description: 'Build an airport so the planes can land.',
        theme_color: '#1b2a33',
        background_color: '#1b2a33',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
