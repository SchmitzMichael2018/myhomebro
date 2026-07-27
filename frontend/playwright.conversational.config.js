import { defineConfig } from "@playwright/test";

import baseConfig from "./playwright.config.js";

const port = 5174;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  ...baseConfig,
  retries: 0,
  use: {
    ...baseConfig.use,
    baseURL,
  },
  webServer: {
    command: `npm.cmd run dev -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
});
