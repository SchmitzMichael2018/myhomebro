import { expect, test } from '@playwright/test';

test('Marketing Website Builder tab loads readiness data and keeps editor actions gated', async ({ page }) => {
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
      body: JSON.stringify({ onboarding_status: 'complete', connected: true }),
    });
  });

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        created_at: '2026-03-01T10:00:00Z',
        business_name: 'Bright Build Co',
        contractor_onboarding_status: 'complete',
      }),
    });
  });

  await page.route(/public-profile\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        business_name_public: 'Bright Build Co',
        tagline: '',
        bio: 'We help homeowners with clean, reliable project delivery.',
        city: 'Austin',
        state: 'TX',
        service_area_text: 'Austin metro',
        phone_public: '555-111-2222',
        email_public: 'hello@bright.example.com',
        show_phone_public: true,
        show_email_public: false,
        allow_public_intake: true,
        is_public: true,
        public_url: 'http://localhost:4173/contractors/bright-build-co',
      }),
    });
  });

  await page.route(/public-profile\/qr\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        public_url: 'http://localhost:4173/contractors/bright-build-co',
        qr_svg: 'data:image/svg+xml;base64,PHN2Zy8+',
      }),
    });
  });

  await page.route('**/api/projects/contractor/gallery/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/contractor/reviews/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/(?:contractor\/public-leads|contractor-opportunities)\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/contractor-activation-summary/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ guide_sections: {} }),
    });
  });

  await page.route(/\/api\/projects\/contractor\/website\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entitlements: {
          plan: 'free',
          features: {
            public_profile: { key: 'public_profile', enabled: true, tier: 'free', label: 'Free public profile' },
            website_builder: {
              key: 'website_builder',
              enabled: false,
              tier: 'pro',
              label: 'Website Builder',
              reason: 'Upgrade to Pro to customize a multi-section website.',
            },
            website_publish: {
              key: 'website_publish',
              enabled: false,
              tier: 'pro',
              label: 'Publish website',
              reason: 'Publishing is part of the Pro Website Builder.',
            },
          },
        },
        profile: {
          identity: { business_name: 'Bright Build Co' },
          gallery: { count: 1, items: [] },
          reviews: { count: 0, selected: [] },
        },
        readiness: {
          score: 78,
          complete_count: 7,
          total_count: 9,
          missing_required_fields: ['tagline'],
          checklist: [
            { key: 'business_name', label: 'Add public business name', complete: true, required: true },
            {
              key: 'tagline',
              label: 'Add a tagline',
              complete: false,
              required: true,
              action: 'Summarize what you do in one short line.',
            },
          ],
        },
        draft: { status: 'placeholder', has_draft: false },
        recommended_next_steps: [
          { key: 'tagline', label: 'Add a tagline', action: 'Summarize what you do in one short line.' },
          {
            key: 'upgrade_pro',
            label: 'Upgrade to unlock the Website Builder',
            action: 'Upgrade to Pro to customize a multi-section website.',
          },
        ],
      }),
    });
  });

  await page.goto('/app/marketing?tab=website', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('marketing-website-builder-tab')).toBeVisible();
  await expect(page.getByTestId('website-builder-plan-gate')).toContainText('Pro Website Builder gated');
  await expect(page.getByTestId('website-builder-plan-gate')).toContainText('Upgrade to Pro');
  await expect(page.getByTestId('website-builder-readiness-score')).toContainText('78%');
  await expect(page.getByTestId('website-builder-missing-fields')).toContainText('tagline');
  await expect(page.getByTestId('website-builder-readiness-checklist')).toContainText('Add a tagline');
  await expect(page.getByTestId('website-builder-preview-summary')).toContainText('Bright Build Co');
  await expect(page.getByTestId('website-builder-customize-button')).toBeDisabled();
  await expect(page.getByTestId('website-builder-publish-button')).toBeDisabled();
});
