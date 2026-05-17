import { expect, test } from '@playwright/test';

async function mockPublicPresenceWithOpportunities(page, initialRows) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  const state = { opportunities: [...initialRows] };

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 7, type: 'contractor', role: 'contractor_owner', email: 'contractor@example.com' }),
    });
  });
  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ onboarding_status: 'complete', connected: true }) });
  });
  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 77 }) });
  });
  await page.route('**/api/projects/contractor/public-profile/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        business_name_public: 'Bright Build Co',
        tagline: 'Trusted renovations and repairs',
        bio: 'Clean project delivery.',
        city: 'Austin',
        state: 'TX',
        public_url: 'http://localhost:4173/contractors/bright-build-co',
        specialties: [],
        work_types: [],
        is_public: true,
      }),
    });
  });
  await page.route('**/api/projects/contractor/public-profile/qr/', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ qr_svg: 'data:image/svg+xml;base64,PHN2Zy8+' }) });
  });
  await page.route('**/api/projects/contractor/gallery/', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });
  await page.route('**/api/projects/contractor/reviews/', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });
  await page.route('**/api/projects/contractor-opportunities/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: state.opportunities }),
    });
  });
  await page.route(/.*\/api\/projects\/contractor-opportunities\/101\/accept\/$/, async (route) => {
    state.opportunities = state.opportunities.map((row) =>
      row.id === 101
        ? {
            ...row,
            status: 'converted',
            accepted_at: '2026-05-17T14:00:00Z',
            agreement_id: 901,
            converted_agreement: 901,
            next_url: '/app/agreements/901/wizard?step=1',
          }
        : row
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.opportunities[0]),
    });
  });

  return state;
}

test('Public Leads tab loads ContractorOpportunity rows and accepts into draft agreement handoff', async ({ page }) => {
  await mockPublicPresenceWithOpportunities(page, [
    {
      id: 101,
      opportunity_id: 101,
      source: 'contractor_opportunity',
      status: 'pending',
      full_name: 'Casey Homeowner',
      email: 'casey@example.com',
      phone: '512-555-2222',
      project_title: 'Concrete Patio Extension',
      project_type: 'Concrete',
      project_subtype: 'Patio',
      project_description: 'Extend the existing patio with concrete.',
      refined_description: 'Extend the concrete patio and prepare the area for contractor review.',
      city: 'Austin',
      state: 'TX',
      zip_code: '78701',
      timeline: 'Within the next month',
      budget_min: '2500.00',
      budget_max: '5000.00',
      selected_by_homeowner: true,
      selected_at: '2026-05-17T13:00:00Z',
      directory_business_name: 'Bright Build Co',
      measurements: ['12 ft x 10 ft patio', '6 ft extension'],
      photos_count: 2,
    },
  ]);

  await page.goto('/app/public-presence?tab=leads', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Public Leads' }).click();

  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('Casey Homeowner');
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('Homeowner selected you');
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('Concrete Patio Extension');
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('This request came from a homeowner project intake');
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('12 ft x 10 ft patio');
  await expect(page.getByRole('button', { name: 'Accept Opportunity' })).toBeVisible();

  await page.getByRole('button', { name: 'Accept Opportunity' }).click();

  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('Draft Ready');
  await expect(page.getByRole('button', { name: 'Open Draft Agreement' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Open Draft Agreement' }).first().click();
  await expect(page).toHaveURL(/\/app\/agreements\/901\/wizard\?step=1$/);
});

test('Public Leads tab shows opportunity empty state', async ({ page }) => {
  await mockPublicPresenceWithOpportunities(page, []);

  await page.goto('/app/public-presence?tab=leads', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Public Leads' }).click();

  await expect(page.getByTestId('public-presence-leads-tab')).toContainText(
    'No homeowner requests yet. Share your public profile or wait for matching project requests.'
  );
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText(
    'Choose a homeowner request to review its details and next steps.'
  );
});
