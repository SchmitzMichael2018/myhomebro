import { expect, test } from '@playwright/test';

test('contractor profile shows state and trade compliance guidance', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 7,
        type: 'contractor',
        role: 'contractor_owner',
        email: 'playwright@myhomebro.local',
      }),
    });
  });

  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        onboarding_status: 'complete',
        connected: true,
      }),
    });
  });

  await page.route('**/api/projects/agreements/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/contractors/me/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        email: 'playwright@myhomebro.local',
        full_name: 'Playwright Builder',
        business_name: 'Playwright Builder Co',
        phone: '555-111-2222',
        address: '123 Main St',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        license_number: '',
        license_expiration_date: '',
        skills: ['Electrical'],
        compliance_records: [],
        compliance_trade_requirements: [],
        insurance_status: {
          has_insurance: false,
          status: 'missing',
        },
        ai: {
          access: 'included',
          enabled: true,
          unlimited: true,
        },
      }),
    });
  });

  await page.route('**/api/projects/compliance/profile-preview/', async (route) => {
    const body = route.request().postDataJSON();
    const hasElectrical = Array.isArray(body?.skills) && body.skills.includes('Electrical');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        state_code: body?.state || 'TX',
        trade_requirements: hasElectrical
          ? [
              {
                required: true,
                insurance_required: true,
                message: 'Electrical work in Texas typically requires a state license. Upload a license document.',
                issuing_authority_name: 'Texas Department of Licensing and Regulation',
                official_lookup_url: 'https://www.tdlr.texas.gov/electricians/',
                contractor_has_license_on_file: false,
                contractor_license_status: 'missing',
                contractor_has_insurance_on_file: false,
                warning_level: 'warning',
                source_type: 'portal',
                state_code: 'TX',
                trade_key: 'electrical',
              },
            ]
          : [],
      }),
    });
  });

  await page.goto('/app/profile', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('contractor-profile-trade-chip-electrical')).toBeVisible();
  await page.getByTestId('contractor-profile-trade-search').fill('roof');
  await page.getByTestId('contractor-profile-trade-option-roofing').click();

  const compliance = page.getByTestId('contractor-compliance-preview');
  await expect(compliance).toContainText('1 service reviewed for TX');
  await expect(compliance).toContainText('License status');
  await expect(compliance).toContainText('Attention needed');
  const details = page.getByTestId('compliance-trade-details');
  await expect(details).not.toHaveAttribute('open', '');
  await compliance.screenshot({ path: 'test-results/compliance-summary-collapsed.png' });
  await details.locator('summary').first().click();
  await expect(page.getByTestId('compliance-trade-electrical')).toContainText('Electrical');
  await expect(page.getByTestId('compliance-trade-electrical')).toContainText('Typically required');
  await page.getByTestId('compliance-trade-electrical').getByText('Full guidance').click();
  await expect(page.getByTestId('compliance-trade-electrical')).toContainText('typically requires a state license');
  await compliance.screenshot({ path: 'test-results/compliance-guidance-expanded.png' });
  await page.getByTestId('license-details').screenshot({ path: 'test-results/compliance-license-details.png' });
  await page.getByTestId('insurance-details').screenshot({ path: 'test-results/compliance-insurance-details.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/compliance-390.png', fullPage: true });
  await expect(page.getByTestId('contractor-insurance-status')).toContainText(
    'Insurance certificate missing'
  );
});

test('contractor profile shows cautious HVAC licensing guidance', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 7,
        type: 'contractor',
        role: 'contractor_owner',
        email: 'playwright@myhomebro.local',
      }),
    });
  });

  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        onboarding_status: 'complete',
        connected: true,
      }),
    });
  });

  await page.route('**/api/projects/contractors/me/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        email: 'playwright@myhomebro.local',
        full_name: 'Playwright Builder',
        business_name: 'Playwright Builder Co',
        phone: '555-111-2222',
        address: '123 Main St',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        license_number: '',
        license_expiration_date: '',
        skills: ['HVAC'],
        compliance_records: [],
        compliance_trade_requirements: [],
        insurance_status: {
          has_insurance: false,
          status: 'missing',
        },
        ai: {
          access: 'included',
          enabled: true,
          unlimited: true,
        },
      }),
    });
  });

  await page.route('**/api/projects/compliance/profile-preview/', async (route) => {
    const body = route.request().postDataJSON();
    const hasHvac = Array.isArray(body?.skills) && body.skills.includes('HVAC');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        state_code: body?.state || 'TX',
        trade_requirements: hasHvac
          ? [
              {
                required: false,
                insurance_required: true,
                message: 'HVAC work commonly requires state or local licensing. Add your license information if applicable.',
                issuing_authority_name: 'Texas Department of Licensing and Regulation',
                official_lookup_url: '',
                contractor_has_license_on_file: false,
                contractor_license_status: 'missing',
                contractor_has_insurance_on_file: false,
                warning_level: 'info',
                source_type: 'portal',
                state_code: 'TX',
                trade_key: 'hvac',
              },
            ]
          : [],
      }),
    });
  });

  await page.goto('/app/profile', { waitUntil: 'domcontentloaded' });

  const details = page.getByTestId('compliance-trade-details');
  await details.locator('summary').first().click();
  await expect(page.getByTestId('compliance-trade-hvac')).toContainText('Not typically identified statewide');
  await page.getByTestId('compliance-trade-hvac').getByText('Full guidance').click();
  await expect(page.getByTestId('compliance-trade-hvac')).toContainText('HVAC work commonly requires state or local licensing');
});

test('public profile trust indicators stay conservative', async ({ page }) => {
  await page.route('**/api/projects/public/contractors/bright-build-co/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        business_name_public: 'Bright Build Co',
        tagline: 'Trusted renovations and repairs',
        bio: 'We help homeowners with clean, reliable project delivery.',
        city: 'Austin',
        state: 'TX',
        service_area_text: 'Austin metro',
        years_in_business: 12,
        phone_public: '555-111-2222',
        email_public: 'hello@bright.example.com',
        show_phone_public: true,
        show_email_public: true,
        show_license_public: true,
        allow_public_intake: true,
        allow_public_reviews: false,
        specialties: ['Roofing'],
        work_types: ['Repairs'],
        review_count: 0,
        average_rating: null,
        gallery: [],
        reviews: [],
        public_trust_indicators: ['Insurance on file'],
      }),
    });
  });

  await page.goto('/contractors/bright-build-co', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Insurance on file')).toBeVisible();
  await expect(page.getByText('Licensed business')).toHaveCount(0);
  await expect(page.getByText('License on file')).toHaveCount(0);
});
