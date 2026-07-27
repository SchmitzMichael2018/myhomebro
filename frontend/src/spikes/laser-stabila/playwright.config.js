import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "laserSpike.spec.js",
  timeout: 20_000,
  use: {
    baseURL: "http://127.0.0.1:4179",
    browserName: "chromium",
    headless: true,
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4179 --strictPort",
    cwd: "../../..",
    url: "http://127.0.0.1:4179/src/spikes/laser-stabila/index.html",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
