import { expect, test } from '@playwright/test';

test('contractor can toggle auto subcontractor payouts in business dashboard', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  const meState = {
    id: 77,
    created_at: '2026-03-01T10:00:00Z',
    auto_subcontractor_payouts_enabled: false,
    ai: {
      access: 'included',
      enabled: true,
      unlimited: true,
    },
  };

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

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      meState.auto_subcontractor_payouts_enabled = !!body.auto_subcontractor_payouts_enabled;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Profile updated.' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(meState),
    });
  });

  await page.route('**/api/projects/business/contractor/summary/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        snapshot: {},
        by_category: [],
        insights: [],
      }),
    });
  });

  await page.route('**/api/projects/payouts/history/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [],
        summary: {
          total_paid_amount: '0.00',
          total_ready_amount: '0.00',
          total_failed_amount: '0.00',
          total_pending_amount: '0.00',
          record_count: 0,
        },
      }),
    });
  });

  await page.goto('/app/business', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Subcontractor Payout Automation')).toBeVisible();
  await expect(page.getByTestId('dashboard-payouts-section')).toBeVisible();
  await expect(page.getByTestId('dashboard-ai-insights-empty')).toBeVisible();
  await expect(page.getByTestId('auto-payout-setting-label')).toContainText('Off');

  await page.getByTestId('auto-payout-setting-toggle').click();
  await expect(page.getByTestId('auto-payout-setting-label')).toContainText('On');

  await page.getByTestId('auto-payout-setting-toggle').click();
  await expect(page.getByTestId('auto-payout-setting-label')).toContainText('Off');
});
