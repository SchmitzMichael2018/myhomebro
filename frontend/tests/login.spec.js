import { expect, test } from '@playwright/test';

test('landing page smoke renders core entry points', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('landing-hero-heading')).toBeVisible();
  await expect(page.getByTestId('landing-sign-in-button')).toBeVisible();
  await expect(
    page.getByTestId('landing-start-project-intake-button')
  ).toBeVisible();
});
