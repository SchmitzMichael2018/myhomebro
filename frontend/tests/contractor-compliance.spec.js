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
        skills: [],
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

  await page.getByLabel('Electrical').check();

  await expect(page.getByTestId('contractor-compliance-preview')).toContainText(
    'Electrical in TX'
  );
  await expect(page.getByTestId('contractor-compliance-preview')).toContainText(
    'typically requires a state license'
  );
  await expect(page.getByTestId('contractor-insurance-status')).toContainText(
    'Insurance certificate missing'
  );
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
