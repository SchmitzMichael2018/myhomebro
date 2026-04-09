import { test as setup, expect } from '@playwright/test';

const authFile = 'playwright/.auth/contractor.json';
const email =
  process.env.PLAYWRIGHT_CONTRACTOR_EMAIL || 'playwright.contractor@myhomebro.local';
const password =
  process.env.PLAYWRIGHT_CONTRACTOR_PASSWORD || 'Playwright123!';

setup('authenticate local contractor for integrated QA', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('login-email-input').fill(email);
  await page.getByTestId('login-password-input').fill(password);
  await page.getByTestId('login-submit-button').click();

  await expect
    .poll(async () =>
      page.evaluate(() => window.localStorage.getItem('access') || '')
    )
    .not.toBe('');

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/app\/dashboard$/);

  await page.context().storageState({ path: authFile });
});
