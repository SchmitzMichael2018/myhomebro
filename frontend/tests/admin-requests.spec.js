import { expect, test } from '@playwright/test';

async function installMocks(page, results = []) {
  await page.addInitScript(() => localStorage.setItem('access', 'admin-requests-test-token'));
  await page.route('**/api/projects/whoami/', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: 1, type: 'admin', role: 'admin', email: 'admin@example.com' }),
  }));
  await page.route('**/api/projects/admin/requests/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      results,
      summary: { active: results.length, needs_review: 0, ready_to_route: results.length, routed: 0, test_spam: 0, archived: 0 },
      pagination: { page: 1, page_size: 25, total: results.length, total_pages: 1, has_previous: false, has_next: false },
      permissions: { can_classify: true, can_archive: true, can_mark_spam: true, can_delete: false },
    }),
  }));
}

const row = {
  id: 42,
  reference: 'REQ-42',
  title: 'Bathroom Tile Repair',
  customer: { name: 'Jamie Homeowner', email: 'jamie@example.com', phone: '' },
  location: { city: 'Austin', state: 'TX', zip: '78701' },
  service: 'Bathroom',
  source: { key: 'google', label: 'Google Organic' },
  trust: 'normal',
  verification: 'verified',
  workflow_status: 'submitted',
  classification: 'real',
  routing_status: 'ready',
  submitted_at: '2026-09-22T12:00:00Z',
};

test('admin requests preserves query filters and uses compact desktop table', async ({ page }) => {
  await installMocks(page, [row]);
  await page.goto('/app/admin/requests?view=active&state=TX&page=1');
  await expect(page.getByTestId('admin-requests-page')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Request' })).toBeVisible();
  await expect(page.locator('table').getByText('Bathroom Tile Repair')).toBeVisible();
  await expect(page).toHaveURL(/state=TX/);
  await expect(page.getByText('Page 1 of 1 · 1 matching requests')).toBeVisible();
});

test('admin requests has a usable mobile card and empty state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMocks(page, [row]);
  await page.goto('/app/admin/requests');
  await expect(page.locator('.lg\\:hidden').getByText('Bathroom Tile Repair')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Request' })).toBeHidden();

  await page.unroute('**/api/projects/admin/requests/**');
  await installMocks(page, []);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No requests match this view' })).toBeVisible();
});
