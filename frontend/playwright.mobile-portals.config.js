import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'authenticated-mobile-portals.spec.js',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  timeout: 180_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://www.myhomebro.com',
    ...devices['iPhone 15 Pro'],
    viewport: { width: 402, height: 874 },
    screen: { width: 402, height: 874 },
    browserName: 'webkit',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
});
