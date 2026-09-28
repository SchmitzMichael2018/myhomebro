import { expect, test } from '@playwright/test';

async function mockEditor(page) {
  await page.addInitScript(() => window.localStorage.setItem('access', 'playwright-access-token'));
  await page.route('**/api/projects/whoami/', (route) => route.fulfill({
    status: 200, json: { id: 1, type: 'admin', role: 'admin', email: 'editor@example.test' },
  }));
  let guide = null;
  await page.route('**/api/projects/admin/improvements/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method === 'GET' && path.endsWith('/improvements/')) {
      return route.fulfill({ status: 200, json: { results: guide ? [guide] : [] } });
    }
    if (method === 'POST' && path.endsWith('/improvements/')) {
      guide = { ...route.request().postDataJSON(), id: 101, status: 'draft', public_url: '/improvements/bathroom/qa-bathroom-plan/' };
      return route.fulfill({ status: 201, json: guide });
    }
    if (method === 'POST' && path.endsWith('/transition/')) {
      const { action, confirmed } = route.request().postDataJSON();
      if (action === 'publish' && !confirmed) return route.fulfill({ status: 400, json: { detail: 'Confirm review.' } });
      guide = { ...guide, status: action === 'request_review' ? 'ready_for_review' : action === 'publish' ? 'published' : 'archived' };
      return route.fulfill({ status: 200, json: guide });
    }
    return route.fulfill({ status: 404, json: { detail: 'Not found' } });
  });
}

test('admin creates and reviews a guide before publishing', async ({ page }) => {
  await mockEditor(page);
  await page.goto('/app/admin/improvements', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('admin-improvement-library')).toBeVisible();
  await page.getByLabel('Working title').fill('Bathroom Plan');
  await page.getByLabel('URL slug').fill('qa-bathroom-plan');
  await page.getByLabel('Category slug').fill('bathroom');
  await page.getByLabel('Card summary').fill('Plan the work first.');
  await page.getByLabel('Introduction').fill('Measure the space and scope the work.');
  await page.getByLabel('Search description (170 characters max)').fill('Understand the work before you begin.');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  await page.getByRole('button', { name: 'Ready for review' }).click();
  await expect(page.getByText('ready for review', { exact: true }).first()).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Review and publish' }).click();
  await expect(page.getByRole('status')).toContainText('Guide published');
  await expect(page.getByRole('link', { name: 'View published guide' })).toHaveAttribute('href', '/improvements/bathroom/qa-bathroom-plan/');
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
});

test('editor is readable at a phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockEditor(page);
  await page.goto('/app/admin/improvements', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Improvement Library' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New guide' })).toBeVisible();
  await expect(page.getByLabel('Working title')).toBeVisible();
});
