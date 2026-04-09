import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const FRONTEND_PORT = 5173;
const BACKEND_PORT = 8000;
const HOST = '127.0.0.1';
const baseURL = `http://${HOST}:${FRONTEND_PORT}`;
const authDir = path.join(process.cwd(), 'playwright', '.auth');
const authFile = path.join(authDir, 'contractor.json');

fs.mkdirSync(authDir, { recursive: true });

export default defineConfig({
  testDir: './tests/local-integrated',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['html', { open: 'never', outputFolder: 'playwright-report/local-integrated' }],
    ['list'],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.js/,
    },
    {
      name: 'chromium-live',
      dependencies: ['setup'],
      testIgnore: /.*\.setup\.js/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
      },
    },
  ],
  webServer: [
    {
      command: `..\\backend\\venv\\Scripts\\python.exe ..\\backend\\manage.py runserver ${HOST}:${BACKEND_PORT} --noreload`,
      url: `http://${HOST}:${BACKEND_PORT}/admin/login/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
    {
      command: `npm.cmd run dev -- --host ${HOST} --port ${FRONTEND_PORT}`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
  ],
});
