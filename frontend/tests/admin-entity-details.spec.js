import { expect, test } from '@playwright/test';

const contractor = {
  id: 101, user_id: 201, company_id: null, business_name: 'Summit Renovations', name: 'Avery Builder',
  email: 'summit@example.com', phone: '555-0101', city: 'Austin', state: 'TX', zip: '78701',
  service_radius_miles: 25, account_status: 'active', onboarding_status: 'complete',
  public_profile_status: 'public', public_profile_is_public: true, marketplace_verification_status: 'verified',
  created_at: '2026-01-01T12:00:00Z', updated_at: '2026-03-25T12:00:00Z', recent_activity_at: '2026-03-25T12:00:00Z',
  user: { is_active: true, is_verified: true, is_staff: false, is_superuser: false, date_joined: '2026-01-01T12:00:00Z', last_login: '2026-03-25T12:00:00Z' },
  financial: { stripe_account_id: 'acct_safe_123', connected: true, charges_enabled: true, payouts_enabled: true, details_submitted: true, fee_revenue: '720.00' },
  counts: { gallery: 4, reviews: 6, leads: 5, agreements: 1, projects: 1, customers: 1 },
  agreements: [{ id: 321, project_title: 'Kitchen Remodel', customer_name: 'Casey Prospect', status: 'funded', updated_at: '2026-03-25T12:00:00Z' }],
  projects: [{ id: 401, title: 'Kitchen Remodel', status: 'active', customer_id: 701, customer_name: 'Casey Prospect', created_at: '2026-02-01T12:00:00Z' }],
};

const customer = {
  id: 701, homeowner_profile_id: 701, relationship_id: 701, user_id: null, contractor_id: 101,
  contractor_name: 'Summit Renovations', name: 'Casey Prospect', email: 'casey@example.com', phone: '555-0100',
  status: 'active', account_type: 'individual', created_at: '2026-02-01T12:00:00Z',
  updated_at: '2026-03-25T12:00:00Z', recent_activity_at: '2026-03-25T12:00:00Z',
  address: { street: '100 Main St', line_2: '', city: 'Austin', state: 'TX', zip: '78701' },
  counts: { properties: 1, projects: 1, agreements: 1, leads: 1 },
  projects: [{ id: 401, title: 'Kitchen Remodel', status: 'active', contractor_id: 101, contractor_name: 'Summit Renovations', address: '100 Main St, Austin, TX 78701', created_at: '2026-02-01T12:00:00Z' }],
  agreements: [{ id: 321, project_title: 'Kitchen Remodel', status: 'funded', funded: '5000.00', created_at: '2026-02-02T12:00:00Z' }],
};

async function mockIdentity(page) {
  await page.addInitScript(() => window.localStorage.setItem('access', 'playwright-access-token'));
  await page.route('**/api/projects/whoami/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, type: 'admin', role: 'admin' }) }));
}

test('admin contractor and customer detail routes render linked read-only records', async ({ page }) => {
  await mockIdentity(page);
  await page.route('**/api/projects/admin/contractors/101/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contractor) }));
  await page.route('**/api/projects/admin/homeowners/701/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(customer) }));

  await page.goto('/app/admin/contractors/101');
  await expect(page.getByTestId('admin-contractor-detail')).toContainText('Summit Renovations');
  await expect(page.getByText('acct_safe_123')).toBeVisible();
  await expect(page.getByText(/password|secret/i)).toHaveCount(0);
  await expect(page.getByTestId('admin-contractor-pipeline')).toContainText('5');
  await expect(page.getByRole('link', { name: 'Kitchen Remodel' }).first()).toHaveAttribute('href', '/app/admin/agreements/321');
  await expect(page.getByTestId('admin-contractor-detail').getByRole('link', { name: 'Contractors', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: 'test-results/admin-contractor-detail-light.png', fullPage: true });

  await page.goto('/app/admin/customers/701');
  await expect(page.getByTestId('admin-customer-detail')).toContainText('Casey Prospect');
  await expect(page.getByRole('link', { name: 'Summit Renovations' })).toHaveAttribute('href', '/app/admin/contractors/101');
  await expect(page.getByTestId('admin-customer-projects')).toContainText('Kitchen Remodel');
  await expect(page.getByTestId('admin-customer-detail').getByRole('link', { name: 'Customers', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: 'test-results/admin-customer-detail-light.png', fullPage: true });
});

test('admin entity details show not found and access denied states', async ({ page }) => {
  await mockIdentity(page);
  await page.route('**/api/projects/admin/contractors/999/', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"Contractor not found."}' }));
  await page.route('**/api/projects/admin/homeowners/999/', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: '{"detail":"Forbidden"}' }));
  await page.goto('/app/admin/contractors/999');
  await expect(page.getByRole('heading', { name: 'Contractor not found' })).toBeVisible();
  await page.goto('/app/admin/customers/999');
  await expect(page.getByRole('heading', { name: 'You do not have permission to view this record.' })).toBeVisible();
});

test('admin entity details preserve theme and responsive containment', async ({ page }) => {
  await mockIdentity(page);
  await page.route('**/api/projects/admin/contractors/101/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contractor) }));
  await page.route('**/api/projects/admin/homeowners/701/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(customer) }));
  for (const appearance of ['light', 'dark']) {
    await page.addInitScript((value) => window.localStorage.setItem('myhomebro.appearance.v1', value), appearance);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 900, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/app/admin/contractors/101');
      await expect(page.locator('html')).toHaveAttribute('data-mhb-theme', appearance);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      if (viewport.width === 1440) await page.screenshot({ path: `test-results/admin-contractor-detail-${appearance}.png`, fullPage: true });
      if (viewport.width === 390 && appearance === 'dark') await page.screenshot({ path: 'test-results/admin-contractor-detail-390-dark.png', fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/admin/customers/701');
  await expect(page.locator('html')).toHaveAttribute('data-mhb-theme', 'dark');
  await page.screenshot({ path: 'test-results/admin-customer-detail-dark.png', fullPage: true });
});
