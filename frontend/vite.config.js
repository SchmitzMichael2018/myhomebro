// frontend/vite.config.js
// Manifest-driven Vite config for Django + WhiteNoise
// - Keeps your dev base ("/") and prod base ("/static/")
// - Generates manifest.json for hashed asset injection
// - Preserves your alias and manualChunks rules

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const pwaEnabled = String(env.VITE_PWA_ENABLED || "").toLowerCase() === "true";
  return {
  plugins: [
    react(),
    VitePWA({
      disable: !pwaEnabled,
      strategies: "generateSW",
      filename: "sw.js",
      injectRegister: null,
      registerType: "prompt",
      manifest: false,
      workbox: {
        cacheId: `myhomebro-${env.VITE_APP_VERSION || "dev"}`,
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        globPatterns: [
          "assets/index-*.{js,css}",
          "assets/react-*.js",
          "assets/icons-*.js",
          "favicon*.{png,ico}",
          "apple-touch-icon.png",
          "pwa-maskable-512x512.png",
          "manifest.webmanifest",
        ],
        additionalManifestEntries: [
          { url: "/offline.html", revision: env.VITE_APP_VERSION || "dev" },
        ],
        navigateFallback: "/offline.html",
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/media\//,
          /^\/static\//,
          /^\/admin\//,
        ],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => (
              url.origin === self.location.origin
              && (url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/"))
            ),
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],

  test: {
    environment: "node",
    include: ["src/**/*.test.{js,jsx}"],
  },

  // Dev serves from "/", prod emits absolute URLs under "/static/"
  base: mode === "production" ? "/static/" : "/",

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,

    // IMPORTANT: enable manifest so deploy can pick correct hashed files
    manifest: true,

    // (optional) You can set a modern target if needed:
    // target: "es2018",

    rollupOptions: {
      output: {
        // Keep a small number of stable, domain-shaped vendor chunks. Route
        // modules remain the primary split boundary.
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/")) return "react";
            if (id.includes("lucide-react") || id.includes("react-icons")) return "icons";
            if (id.includes("@stripe")) return "stripe";
            if (id.includes("pdfjs-dist")) return "documents";
          }
        },
      },
    },
  },
  };
});
