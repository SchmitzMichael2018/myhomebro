import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';

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
  let patchRequested = false;
  let importApplyRequested = false;
  let directoryRows = [
    {
      id: 42,
      business_name: 'Austin Concrete Co',
      website: 'https://www.austinconcrete.example/contact',
      phone: '512-555-0101',
      address_line1: '12703 Spectrum Dr #103',
      public_email: null,
      city: 'San Antonio',
      state: 'TX',
      zip_code: '78249',
      rating: 4.8,
      review_count: 22,
      services: ['concrete_contractor'],
      source: 'google_places',
      claimed: false,
      profile_status: 'basic',
      enrichment_status: 'not_started',
      email_source_url: '',
      services_source_url: '',
      enrichment_notes: '',
      first_seen_at: '2026-05-01T12:00:00Z',
      last_seen_at: '2026-05-02T12:00:00Z',
    },
  ];

  await page.route('**/api/projects/admin/contractor-directory/**', async (route) => {
    directoryRequests.push(new URL(route.request().url()));
    const requestUrl = new URL(route.request().url());

    if (requestUrl.pathname.endsWith('/api/projects/admin/contractor-directory/import-preview/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          results: [
            {
              matched_entry_id: 42,
              business_name: 'Austin Concrete Co',
              existing_public_email: null,
              proposed_public_email: 'hello@austinconcrete.example',
              existing_services: ['concrete_contractor'],
              proposed_services: ['concrete contractor', 'patio contractor'],
              status: 'ready',
              warnings: [],
              email_source_url: 'https://www.austinconcrete.example/contact',
              services_source_url: 'https://www.austinconcrete.example/services',
              enrichment_notes: 'Reviewed website.',
            },
          ],
        }),
      });
      return;
    }

    if (requestUrl.pathname.endsWith('/api/projects/admin/contractor-directory/import-apply/')) {
      importApplyRequested = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updated_count: 1, skipped_count: 0, warnings: [] }),
      });
      return;
    }

    if (route.request().method() === 'PATCH' && requestUrl.pathname.endsWith('/api/projects/admin/contractor-directory/42/')) {
      patchRequested = true;
      const payload = JSON.parse(route.request().postData() || '{}');
      directoryRows = [
        {
          ...directoryRows[0],
          ...payload,
          services: ['concrete contractor', 'patio contractor'],
          enrichment_status: 'reviewed',
        },
      ];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(directoryRows[0]),
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
    wasPatchRequested: () => patchRequested,
    wasImportApplyRequested: () => importApplyRequested,
  };
}

test('admin contractor directory supports search, filters, table, and export affordance', async ({ page }) => {
  const mocks = await mockAdminDirectory(page);

  await page.goto('/app/admin/contractor-directory', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('admin-contractor-directory-page')).toBeVisible();
  const pageClass = await page.getByTestId('admin-contractor-directory-page').getAttribute('class');
  expect(pageClass).toContain('min-h-screen');
  const importClass = await page.getByTestId('admin-contractor-import-section').getAttribute('class');
  expect(importClass).toContain('bg-[#061d42]/95');
  await expect(page.getByRole('heading', { name: 'Contractor Directory', exact: true })).toBeVisible();
  await expect(page.getByText('Search results are automatically saved to the contractor directory.')).toBeVisible();
  await expect(page.getByTestId('admin-contractor-search-term')).toBeVisible();
  await expect(page.getByTestId('admin-contractor-search-city')).toBeVisible();
  await expect(page.getByTestId('admin-contractor-search-state')).toBeVisible();
  await expect(page.getByTestId('admin-contractor-search-zip')).toBeVisible();
  await expect(page.getByTestId('admin-contractor-search-radius')).toHaveValue('25');

  await expect(page.getByTestId('admin-contractor-directory-table')).toContainText('Austin Concrete Co');
  await expect(page.getByTestId('admin-contractor-directory-table')).toContainText('12703 Spectrum Dr #103');
  await expect(page.getByTestId('admin-contractor-directory-table')).toContainText('San Antonio, TX 78249');
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

test('admin contractor directory supports manual edit, import preview/apply, and enriched CSV export', async ({ page }) => {
  const mocks = await mockAdminDirectory(page);

  await page.goto('/app/admin/contractor-directory', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('admin-contractor-edit-42').click();
  await expect(page.getByTestId('admin-contractor-edit-modal')).toBeVisible();
  await expect(page.getByTestId('admin-contractor-edit-address_line1')).toHaveValue('12703 Spectrum Dr #103');
  await expect(page.getByTestId('admin-contractor-edit-city')).toHaveValue('San Antonio');
  await expect(page.getByTestId('admin-contractor-edit-state')).toHaveValue('TX');
  await expect(page.getByTestId('admin-contractor-edit-zip_code')).toHaveValue('78249');
  await page.getByTestId('admin-contractor-edit-public_email').fill('hello@austinconcrete.example');
  await page.getByTestId('admin-contractor-edit-address_line1').fill('900 Builder Way');
  await page.getByTestId('admin-contractor-edit-city').fill('Austin');
  await page.getByTestId('admin-contractor-edit-state').fill('TX');
  await page.getByTestId('admin-contractor-edit-zip_code').fill('78701');
  await page.getByTestId('admin-contractor-edit-services').fill('concrete contractor, patio contractor');
  await page.getByTestId('admin-contractor-edit-email_source_url').fill('https://www.austinconcrete.example/contact');
  await page.getByTestId('admin-contractor-edit-save').click();

  await expect.poll(() => mocks.wasPatchRequested()).toBe(true);
  await expect(page.getByTestId('admin-contractor-directory-table')).toContainText('hello@austinconcrete.example');
  await expect(page.getByTestId('admin-contractor-directory-table')).toContainText('900 Builder Way');
  await expect(page.getByTestId('admin-contractor-directory-table')).toContainText('Austin, TX 78701');
  await expect(page.getByTestId('admin-contractor-directory-table')).toContainText('reviewed');

  await page.getByTestId('admin-contractor-import-csv').fill(
    'id,business_name,website,phone,address_line1,city,state,zip_code,public_email,services,email_source_url,services_source_url,enrichment_notes\n' +
      '42,Austin Concrete Co,https://www.austinconcrete.example,512-555-0101,900 Builder Way,Austin,TX,78701,hello@austinconcrete.example,"concrete contractor, patio contractor",https://www.austinconcrete.example/contact,https://www.austinconcrete.example/services,Reviewed website.'
  );
  await page.getByTestId('admin-contractor-import-preview').click();
  await expect(page.getByTestId('admin-contractor-import-preview-table')).toContainText('ready');
  await expect(page.getByTestId('admin-contractor-import-preview-table')).toContainText('hello@austinconcrete.example');
  await page.getByTestId('admin-contractor-import-apply').click();
  await expect.poll(() => mocks.wasImportApplyRequested()).toBe(true);
  await expect(page.getByText('Updated 1 entries. Skipped 0.')).toBeVisible();
});

test('admin contractor directory export includes enrichment columns and blank missing emails', async ({ page }) => {
  await mockAdminDirectory(page);

  await page.goto('/app/admin/contractor-directory', { waitUntil: 'domcontentloaded' });
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('admin-contractor-directory-export').click();
  const download = await downloadPromise;
  const path = await download.path();
  const text = await fs.readFile(path, 'utf8');

  expect(download.suggestedFilename()).toBe('contractor-directory-missing-emails.csv');
  expect(text).toContain('email_source_url');
  expect(text).toContain('services_source_url');
  expect(text).toContain('enrichment_notes');
  expect(text).toContain('address_line1');
  expect(text).toContain('zip_code');
  expect(text).toContain('"12703 Spectrum Dr #103"');
  expect(text).toContain('"78249"');
  expect(text).toContain('"Austin Concrete Co"');
  expect(text).not.toContain('Email not listed');
});
