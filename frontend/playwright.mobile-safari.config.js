import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'public-dispute-mobile-safari.spec.js',
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://www.myhomebro.com',
    ...devices['iPhone 13'],
    browserName: 'webkit',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
