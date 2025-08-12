// frontend/vite.config.js
console.log('🛠️  Loaded Vite config:', __filename, 'NODE_ENV=', process.env.NODE_ENV);

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import compression from 'vite-plugin-compression';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.ico',
        'apple-touch-icon.png',
        'masked-icon.svg',
        'favicon-192x192.png',
        'favicon-512x512.png',
      ],
      manifest: {
        name: 'MyHomeBro',
        short_name: 'MyHomeBro',
        description: 'Secure Escrow Payments for Contractors and Homeowners',
        theme_color: '#1E3A8A',
        background_color: '#FFFFFF',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        // Use relative paths so they work with base '/static/'
        icons: [
          { src: 'favicon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'favicon-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//, /^\/admin\//],
      },
    }),
    mode === 'production' && compression({ algorithm: 'gzip', ext: '.gz', threshold: 10240 }),
    mode === 'production' && compression({ algorithm: 'brotliCompress', ext: '.br', threshold: 10240 }),
  ].filter(Boolean),

  server: {
    host: true,
    port: 3000,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true, secure: false, ws: true },
      '/static': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: mode === 'development',
    minify: 'terser',
    terserOptions: { compress: { drop_console: true, drop_debugger: true } },
  },

  // ⬇️ Key line: use /static/ so Django/WhiteNoise serves your assets
  base: mode === 'production' ? '/static/' : '/',
}));
