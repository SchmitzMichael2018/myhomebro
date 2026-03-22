import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;
const HOST = '127.0.0.1';
const baseURL = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 1,
  reporter: [
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: {
    command: `npm.cmd run dev -- --host ${HOST} --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
