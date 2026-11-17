import { test, expect } from '@playwright/test';

test('website workspace offers the existing login without exposing projects', async ({ page, request }) => {
  await page.goto('/webdesign');
  await page.getByRole('link', { name: 'Customer dashboard', exact: true }).click();
  await expect(page).toHaveURL(/\/webdesign\/dashboard/);
  await expect(page.getByText('Your website workspace', { exact: true })).toBeVisible();
  await expect(page.getByTestId('login-email-input')).toBeVisible();
  await expect(page.getByTestId('website-customer-dashboard')).toHaveCount(0);
  const response = await request.get('/api/projects/website-service-projects/');
  expect([401, 403]).toContain(response.status());
});

test.describe('approved customer session', () => {
test.use({ storageState: process.env.WEBSITE_DASHBOARD_AUTH_STATE || undefined });
test('signed-in website workspace loads without creating data', async ({ page }) => {
  test.skip(!process.env.WEBSITE_DASHBOARD_AUTH_STATE, 'Set WEBSITE_DASHBOARD_AUTH_STATE to an approved account storageState path.');
  await page.goto('/webdesign/dashboard');
  await expect(page.getByTestId('website-customer-dashboard')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your business brief' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Photos, logos & documents' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Questions & change requests' })).toBeVisible();
});
});
