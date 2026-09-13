import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'public-dispute-mobile-safari.spec.js',
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://www.myhomebro.com',
    // Playwright does not yet ship a named iPhone 17 profile. Its 1206x2622
    // display maps to a 402x874 CSS viewport at 3x scale, so retain the modern
    // iPhone/Safari inputs and override the viewport to that exact size.
    ...devices['iPhone 15 Pro'],
    viewport: { width: 402, height: 874 },
    screen: { width: 402, height: 874 },
    deviceScaleFactor: 3,
    browserName: 'webkit',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
