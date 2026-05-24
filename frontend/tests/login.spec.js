import { expect, test } from '@playwright/test';

test('landing page smoke renders core entry points', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('landing-hero-heading')).toBeVisible();
  await expect(page.getByTestId('landing-sign-in-button')).toBeVisible();
  await expect(
    page.getByTestId('landing-start-project-intake-button')
  ).toBeVisible();
  await expect(page.getByTestId('landing-hero-heading')).toContainText(
    'Everything you need to plan, hire, and manage your project.'
  );
  await page.getByTestId('landing-sign-in-button').click();
  const loginMenu = page.getByRole('menu', { name: 'Log in options' });
  await expect(loginMenu).toBeVisible();
  await expect(loginMenu.getByRole('button', { name: 'Homeowner Log In' })).toBeVisible();
  await expect(loginMenu.getByRole('button', { name: 'Contractor Log In' })).toBeVisible();
  await expect(loginMenu.getByRole('button', { name: 'Contractors: Sign Up' })).toBeVisible();
  await expect(page.getByTestId('landing-homeowner-card')).toBeVisible();
  await expect(page.getByTestId('landing-contractor-card')).toBeVisible();
});

test('landing page mobile layout does not horizontally overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('landing-hero-heading')).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(hasHorizontalOverflow).toBe(false);
});
