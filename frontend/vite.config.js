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
          { src: '/favicon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/favicon-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
    mode === 'production' &&
      compression({
        algorithm: 'gzip',
        ext: '.gz',
        threshold: 10240,
      }),
    mode === 'production' &&
      compression({
        algorithm: 'brotliCompress',
        ext: '.br',
        threshold: 10240,
      }),
  ],

  server: {
    host: true,
    port: 3000,
    strictPort: true,
    open: true,
    https: false,
    cors: true,

    // ─── Proxy /api → Django on 8000 ───────────────────────────────────────────
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },

    hmr: {
      overlay: true,
    },
  },

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: mode === 'development',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    emptyOutDir: true,
  },

  base: mode === 'production' ? '/myhomebro/' : '/',
  define: {
    'process.env.VITE_BASE_URL': JSON.stringify(
      mode === 'production' ? '/myhomebro/' : '/'
    ),
  },
}));








