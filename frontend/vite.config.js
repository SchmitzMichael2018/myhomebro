// frontend/vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Dev uses "/", prod emits absolute URLs under "/static/"
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
    rollupOptions: {
      output: {
        // Only split out React; don't force a "pdf" chunk if libs aren't present
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("/react/") || id.includes("react-dom")) return "react";
            // If you later add jspdf/html2canvas, uncomment:
            // if (id.includes("jspdf") || id.includes("html2canvas")) return "pdf";
          }
        },
      },
    },
  },
}));
