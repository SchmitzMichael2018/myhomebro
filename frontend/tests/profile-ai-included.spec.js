import { expect, test } from '@playwright/test';

test('profile billing view renders with included AI wording', async ({
  page,
}) => {
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

  await page.route('**/api/projects/contractors/me/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        full_name: 'Profile Demo',
        email: 'playwright@myhomebro.local',
        business_name: 'Demo Contracting',
        phone: '555-0100',
        address: '123 Main St',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        skills: [],
        ai: {
          access: 'included',
          enabled: true,
          unlimited: true,
        },
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.goto('/app/profile', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible();
  await page.getByRole('button', { name: 'Plan & Billing' }).click();

  await expect(page.getByText('AI Availability')).toBeVisible();
  await expect(page.getByText('AI is included for every contractor account.')).toBeVisible();
  await expect(page.getByText('Not applicable')).toBeVisible();
});
