import { expect, test } from '@playwright/test';

async function mockAdminDirectory(page) {
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
        email: 'owner@myhomebro.local',
      }),
    });
  });

  const directoryRequests = [];
  let searchRequested = false;

  await page.route('**/api/projects/admin/contractor-directory/**', async (route) => {
    directoryRequests.push(new URL(route.request().url()));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        count: 1,
        results: [
          {
            id: 42,
            business_name: 'Austin Concrete Co',
            website: 'https://www.austinconcrete.example/contact',
            phone: '512-555-0101',
            public_email: null,
            city: 'Austin',
            state: 'TX',
            rating: 4.8,
            review_count: 22,
            services: ['concrete_contractor'],
            source: 'google_places',
            claimed: false,
            profile_status: 'basic',
            enrichment_status: 'not_started',
            first_seen_at: '2026-05-01T12:00:00Z',
            last_seen_at: '2026-05-02T12:00:00Z',
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/admin/contractor-search/**', async (route) => {
    searchRequested = true;
    const requestUrl = new URL(route.request().url());
    expect(requestUrl.searchParams.get('query')).toBe('concrete contractor');
    expect(requestUrl.searchParams.get('city')).toBe('Austin');
    expect(requestUrl.searchParams.get('state')).toBe('TX');
    expect(requestUrl.searchParams.get('zip')).toBe('78701');
    expect(requestUrl.searchParams.get('radius_miles')).toBe('25');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        summary: { directory_entries_count: 1 },
        results: [
          {
            id: 'places/admin-concrete',
            business_name: 'Admin Concrete Search Result',
            website_url: 'https://searchresult.example',
            phone_number: '512-555-0202',
            city: 'Austin',
            state: 'TX',
            rating: 4.7,
            review_count: 12,
            source: 'google_places',
            directory_entry_id: 77,
          },
        ],
      }),
    });
  });

  return {
    directoryRequests,
    wasSearchRequested: () => searchRequested,
  };
}

test('admin contractor directory supports search, filters, table, and export affordance', async ({ page }) => {
  const mocks = await mockAdminDirectory(page);

  await page.goto('/app/admin/contractor-directory', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('admin-contractor-directory-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Contractor Directory', exact: true })).toBeVisible();
  await expect(page.getByText('Search results are automatically saved to the contractor directory.')).toBeVisible();
  await expect(page.getByTestId('admin-contractor-search-term')).toBeVisible();
  await expect(page.getByTestId('admin-contractor-search-city')).toBeVisible();
  await expect(page.getByTestId('admin-contractor-search-state')).toBeVisible();
  await expect(page.getByTestId('admin-contractor-search-zip')).toBeVisible();
  await expect(page.getByTestId('admin-contractor-search-radius')).toHaveValue('25');

  await expect(page.getByTestId('admin-contractor-directory-table')).toContainText('Austin Concrete Co');
  await expect(page.getByText('Email not listed')).toBeVisible();
  await expect(page.getByRole('link', { name: 'austinconcrete.example' })).toHaveAttribute(
    'href',
    'https://www.austinconcrete.example/contact'
  );
  await expect(page.getByTestId('admin-contractor-directory-export')).toBeVisible();
  await expect(page.getByTestId('admin-contractor-filter-missing-email')).toBeVisible();
  await expect(page.getByTestId('admin-contractor-filter-has-website')).toBeVisible();
  await expect(page.getByTestId('admin-contractor-filter-city')).toBeVisible();
  await expect(page.getByTestId('admin-contractor-filter-state')).toBeVisible();

  await page.getByTestId('admin-contractor-filter-missing-email').check();
  await expect.poll(() =>
    mocks.directoryRequests.some((url) => url.searchParams.get('missing_email') === 'true')
  ).toBe(true);

  await page.getByTestId('admin-contractor-filter-has-website').check();
  await page.getByTestId('admin-contractor-filter-city').fill('Austin');
  await page.getByTestId('admin-contractor-filter-state').fill('TX');
  await expect.poll(() =>
    mocks.directoryRequests.some((url) => (
      url.searchParams.get('has_website') === 'true'
      && url.searchParams.get('city') === 'Austin'
      && url.searchParams.get('state') === 'TX'
    ))
  ).toBe(true);

  await page.getByTestId('admin-contractor-search-term').fill('concrete contractor');
  await page.getByTestId('admin-contractor-search-city').fill('Austin');
  await page.getByTestId('admin-contractor-search-state').fill('TX');
  await page.getByTestId('admin-contractor-search-zip').fill('78701');
  await page.getByTestId('admin-contractor-search-submit').click();

  await expect.poll(() => mocks.wasSearchRequested()).toBe(true);
  await expect(page.getByTestId('admin-contractor-search-results')).toContainText('Admin Concrete Search Result');
  await expect(page.getByTestId('admin-contractor-search-results')).toContainText('Entry #77');
});
