import { expect, test } from '@playwright/test';

const directoryRows = [
  {
    id: 1,
    business_name: 'Claimed Roofing Pro',
    website: 'https://claimedroofing.example',
    phone: '(555) 123-4567',
    public_email: 'hello@claimedroofing.example',
    address_line1: '123 Main St',
    city: 'Austin',
    state: 'TX',
    zip_code: '78701',
    rating: 4.8,
    review_count: 44,
    primary_service: 'Roofing',
    normalized_services: ['Roofing'],
    source: 'google_places',
    claimed: true,
    service_radius_miles: null,
    profile_status: 'basic',
    enrichment_status: 'reviewed',
    last_seen_at: '2026-05-12T15:00:00Z',
  },
  {
    id: 2,
    business_name: 'Local Plumbing Co',
    website: 'https://localplumbing.example',
    phone: '(555) 222-0100',
    public_email: null,
    city: 'Dallas',
    state: 'TX',
    zip_code: '75201',
    rating: 4.7,
    review_count: 18,
    primary_service: 'Plumbing',
    normalized_services: ['Plumbing'],
    source: 'google_places',
    claimed: false,
    service_radius_miles: 25,
    profile_status: 'basic',
    enrichment_status: 'reviewed',
    last_seen_at: '2026-05-12T15:00:00Z',
  },
  {
    id: 3,
    business_name: 'San Antonio Concrete',
    website: '',
    phone: '(555) 333-0100',
    public_email: null,
    city: 'San Antonio',
    state: 'TX',
    zip_code: '78249',
    rating: 4.2,
    review_count: 8,
    primary_service: 'Concrete',
    normalized_services: ['Concrete'],
    source: 'google_places',
    claimed: false,
    service_radius_miles: 25,
    profile_status: 'basic',
    enrichment_status: 'not_started',
    last_seen_at: '2026-05-12T15:00:00Z',
  },
];

async function installMarketplaceMocks(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 1,
        type: 'admin',
        role: 'admin',
        email: 'admin@myhomebro.local',
      }),
    });
  });

  await page.route('**/api/projects/admin/contractor-directory/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const method = route.request().method();

    if (method === 'POST' && requestUrl.pathname.endsWith('/api/projects/admin/contractor-directory/2/claim-link/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ claim_url: '/contractors/claim/test-token' }),
      });
      return;
    }

    const detailMatch = requestUrl.pathname.match(/\/api\/projects\/admin\/contractor-directory\/(\d+)\/$/);
    if (method === 'GET' && detailMatch) {
      const row = directoryRows.find((item) => String(item.id) === detailMatch[1]) || directoryRows[0];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(row),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        count: directoryRows.length,
        results: directoryRows,
      }),
    });
  });
}

test('admin marketplace is an operations console, not a duplicate directory editor', async ({ page }) => {
  await installMarketplaceMocks(page);

  await page.goto('/app/admin/marketplace', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Marketplace Operations')).toBeVisible();
  await expect(page.getByText('Monitor contractor coverage, claim readiness, service gaps, and routing health')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-summary')).toBeVisible();
  await expect(page.getByText('Total Directory Listings')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-summary').getByText('Claimed Contractors')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-summary').getByText('Unclaimed Listings')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-summary').getByText('Listings With Email')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-summary').getByText('Listings With Website')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-summary').getByText('Listings Missing Email')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-service-gaps').getByText('Plumbing')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-geo-gaps').getByText('Dallas, TX')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-metric-missing-email')).toHaveClass(/cursor-pointer/);

  await expect(page.getByText('Import Enriched CSV')).toHaveCount(0);
  await expect(page.getByText('Export Missing Emails CSV')).toHaveCount(0);
  await expect(page.getByText('Edit Contractor Entry')).toHaveCount(0);

  await page.getByTestId('admin-marketplace-tabs').getByRole('button', { name: 'Marketplace Coverage' }).click();
  await expect(page.getByTestId('admin-marketplace-contractors-view')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-coverage-row-1')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-open-directory-1')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-open-listing-1')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-claim-link-2')).toBeVisible();

  await page.getByTestId('admin-marketplace-claim-link-2').click();
  await expect(page.getByTestId('admin-marketplace-copy-claim-link-2')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-status')).toContainText('Claim link generated');

  await page.getByTestId('admin-marketplace-open-directory-1').click();
  await expect(page).toHaveURL(/\/app\/admin\/contractor-directory\?entry=1/);
});

test('admin marketplace health cards drill into directory and coverage filters', async ({ page }) => {
  await installMarketplaceMocks(page);

  await page.goto('/app/admin/marketplace', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('admin-marketplace-metric-missing-email').click();
  await expect(page).toHaveURL(/\/app\/admin\/contractor-directory\?missing_email=true/);

  await page.goto('/app/admin/marketplace', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('admin-marketplace-metric-unclaimed').click();
  await expect(page).toHaveURL(/\/app\/admin\/contractor-directory\?claimed=false/);

  await page.goto('/app/admin/marketplace', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('admin-marketplace-service-gap-Plumbing').click();
  await expect(page).toHaveURL(/\/app\/admin\/marketplace\/contractors/);
  await expect(page.getByTestId('admin-marketplace-service-filter')).toHaveValue('Plumbing');
  await expect(page.getByTestId('admin-marketplace-claimed-filter')).toHaveValue('false');

  await page.goto('/app/admin/marketplace', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('admin-marketplace-high-rated-item-2').click();
  await expect(page).toHaveURL(/\/app\/admin\/marketplace\/listings\/2/);
});

test('admin marketplace listing detail is a readiness view with Directory handoff', async ({ page }) => {
  await installMarketplaceMocks(page);

  await page.goto('/app/admin/marketplace/listings/1', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('admin-marketplace-listing-detail')).toBeVisible();
  await expect(page.getByText('Marketplace readiness view')).toBeVisible();
  await expect(page.getByText('Matching and Routing Readiness')).toBeVisible();
  await expect(page.getByText('Open full Directory record')).toBeVisible();
  await expect(page.getByText('Save Listing')).toHaveCount(0);
  await expect(page.getByText('Compatibility Tags')).toHaveCount(0);

  await page.getByTestId('admin-marketplace-open-directory-detail').click();
  await expect(page).toHaveURL(/\/app\/admin\/contractor-directory\?entry=1/);
});

test('admin marketplace import route points admins back to Contractor Directory', async ({ page }) => {
  await installMarketplaceMocks(page);

  await page.goto('/app/admin/marketplace/import', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('admin-marketplace-directory-redirect')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-directory-redirect').getByRole('heading', { name: 'Contractor Directory' })).toBeVisible();
  await expect(page.getByText('Manage contractor records, enrichment, claim links, and profile data.')).toBeVisible();
  await expect(page.getByText('Search and import new businesses')).toHaveCount(0);
});
