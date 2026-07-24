// frontend/vite.config.js
// Manifest-driven Vite config for Django + WhiteNoise
// - Keeps your dev base ("/") and prod base ("/static/")
// - Generates manifest.json for hashed asset injection
// - Preserves your alias and manualChunks rules

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => ({
  plugins: [react()],

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
            if (id.includes("jspdf") || id.includes("pdfjs-dist")) return "documents";
          }
        },
      },
    },
  },
}));
