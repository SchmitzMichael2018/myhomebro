import { test, expect } from '@playwright/test';

// Set WEB_DESIGN_BASE_URL to the deployed origin for production smoke checks.
const origin = process.env.WEB_DESIGN_BASE_URL || 'https://www.myhomebro.com';

test('web design templates and contact-last inquiry work without submitting data', async ({ page }) => {
  await page.goto(`${origin}/webdesign`);
  await expect(page.getByTestId('webdesign-page')).toBeVisible();
  await expect(page).toHaveTitle(/MyHomeBro Web Design/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://www.myhomebro.com/webdesign');
  await page.getByRole('button', { name: 'Restaurant websites', exact: true }).click();
  await expect(page.locator('.wd-gallery-card')).toHaveCount(3);
  await page.getByRole('link', { name: 'Choose Food First', exact: true }).click();
  await expect(page.getByLabel('Website design', { exact: true })).toHaveValue('restaurant-food');
  await expect(page.getByRole('radio', { name: 'Restaurant', exact: true })).toBeChecked();
  await expect(page.getByLabel('Email address')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Email address')).toHaveCount(0);
  await page.getByLabel('Business name', { exact: true }).fill('Example Kitchen');
  await page.getByLabel('What should your website help customers do?').fill('Browse our menu and find our hours.');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Your name').fill('Example Owner');
  await page.getByLabel('Email address').fill('owner@example.com');
  await page.getByRole('button', { name: 'Review inquiry' }).click();
  const email = page.getByRole('link', { name: 'Open email to send' });
  const href = await email.getAttribute('href');
  expect(href).toContain('mailto:schmitzmichael1985@gmail.com');
  expect(decodeURIComponent(href)).toContain('Business type: Restaurant');
  expect(decodeURIComponent(href)).toContain('Selected design: Food First');
  expect(decodeURIComponent(href)).toContain('Example Kitchen');
  // Inspect the email link; never open or send it during tests.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Business name', { exact: true })).toHaveValue('Example Kitchen');
  await expect(page.getByText('Website credits are not yet available.', { exact: false })).toBeVisible();
});

test('web design fits a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${origin}/webdesign`);
  await expect(page.getByTestId('webdesign-page')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Let’s build your website' }).click();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
});
