import { expect, test } from '@playwright/test';

test('contractor dashboard renders included AI messaging without legacy gating text', async ({
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
  await page.route('**/api/projects/contractors/onboarding/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        required_onboarding_complete: true,
        profile_basics_complete: true,
        status: 'complete',
        step: 'complete',
      }),
    });
  });

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        created_at: '2026-03-01T10:00:00Z',
        ai: {
          access: 'included',
          enabled: true,
          unlimited: true,
        },
      }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/invoices\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/expense-requests\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/dashboard/operations/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        today: [],
        tomorrow: [],
        this_week: [],
        recent_activity: [],
      }),
    });
  });

  await page.goto('/app', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Project Assistant' })).toBeVisible();
  await expect(page.getByPlaceholder('Your business name')).toHaveCount(0);
  await expect(page.locator('text=/Upgrade to AI Pro|Payment required|credits remaining|subscription required/i')).toHaveCount(0);
});
