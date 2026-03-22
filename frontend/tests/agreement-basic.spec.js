import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 123;

test('agreement wizard step 1 renders and draft creation route is reachable', async ({
  page,
}) => {
  let agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Draft Agreement',
    title: 'Draft Agreement',
    project_type: '',
    project_subtype: '',
    payment_mode: 'escrow',
    description:
      'Draft agreement. Details will be completed after template selection or manual entry.',
    homeowner: null,
    status: 'draft',
  };

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
        onboarding_status: 'not_started',
        connected: false,
      }),
    });
  });

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 1, value: 'Remodel', label: 'Remodel', owner_type: 'system' }],
      }),
    });
  });

  await page.route('**/api/projects/project-subtypes/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/homeowners**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 1, company_name: 'Demo Customer', full_name: 'Jordan Demo' }],
      }),
    });
  });

  await page.route('**/api/projects/contractors/me/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        ai_credits_remaining: 3,
        ai_credits_total: 3,
        ai_credits_used: 0,
        ai_credits_enabled: true,
      }),
    });
  });

  await page.route('**/api/projects/templates/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/?(\?.*)?$/, async (route) => {
    const request = route.request();

    if (request.method() !== 'POST') {
      await route.fallback();
      return;
    }

    const payload = request.postDataJSON();
    agreement = {
      ...agreement,
      ...payload,
      id: AGREEMENT_ID,
      agreement_id: AGREEMENT_ID,
      status: 'draft',
    };

    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(agreement),
    });
  });

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`),
    async (route) => {
      const request = route.request();

      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(agreement),
        });
        return;
      }

      if (request.method() === 'PATCH') {
        const payload = request.postDataJSON();
        agreement = { ...agreement, ...payload };

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(agreement),
        });
        return;
      }

      await route.fallback();
    }
  );

  await page.goto('/app/agreements/new/wizard?step=1', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('agreement-wizard-heading')).toBeVisible();
  await expect(page.getByTestId('agreement-customer-select')).toBeVisible();
  await expect(page.getByTestId('agreement-project-title-input')).toBeVisible();
  await expect(page.getByTestId('agreement-save-draft-button')).toBeVisible();

  await page.getByTestId('agreement-project-title-input').fill(
    'Playwright Agreement Smoke'
  );
  await page.getByTestId('agreement-save-draft-button').click();

  await expect(page).toHaveURL(
    new RegExp(`/app/agreements/${AGREEMENT_ID}/wizard\\?step=1$`)
  );
  await expect(page.getByTestId('agreement-wizard-subtitle')).toContainText(
    `Agreement #${AGREEMENT_ID}`
  );
});
