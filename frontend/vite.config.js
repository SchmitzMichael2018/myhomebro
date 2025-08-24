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
        icons: [
          { src: 'favicon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'favicon-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      // 🧠 Key bit: don’t precache optional, lazy chunks
      workbox: {
        navigateFallbackDenylist: [/^\/api\//, /^\/admin\//],
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
        globIgnores: [
          '**/pdf-*.js',
          '**/html2canvas-*.js',
          // add more lazy-only chunks here if needed:
          // '**/Calendar-*.js',
        ],
      },
    }),
    // Optional pre-compress (WhiteNoise also compresses; safe to keep/remove)
    mode === 'production' && compression({ algorithm: 'gzip', ext: '.gz', threshold: 10240 }),
    mode === 'production' && compression({ algorithm: 'brotliCompress', ext: '.br', threshold: 10240 }),
  ].filter(Boolean),

  // Ensure single React instance
  resolve: {
    dedupe: ['react', 'react-dom'],
  },

  // Dev pre-bundling
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
  },

  server: {
    host: true,
    port: 3000,
    proxy: {
      '/api':    { target: 'http://127.0.0.1:8000', changeOrigin: true, secure: false, ws: true },
      '/static': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: mode === 'development',
    minify: 'terser',
    manifest: true,
    terserOptions: {
      compress: { drop_console: true, drop_debugger: true },
      format: { comments: false },
    },
    rollupOptions: {
      input: '/index.html',
      output: {
        // Split big libs for faster first paint
        manualChunks: {
          react: ['react', 'react-dom'],
          router: ['react-router-dom'],
          pdf: ['jspdf', 'jspdf-autotable'],
          html2canvas: ['html2canvas'],
        },
      },
    },
    chunkSizeWarningLimit: 2000,
  },

  // Served by Django/WhiteNoise
  base: mode === 'production' ? '/static/' : '/',
}));
