import { expect, test } from '@playwright/test';

async function mockAuthenticatedShell(page, notifications = []) {
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

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        created_at: '2026-03-01T10:00:00Z',
      }),
    });
  });

  await page.route('**/api/projects/dashboard/operations/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        identity_type: 'contractor_owner',
        today: [],
        tomorrow: [],
        this_week: [],
        recent_activity: [],
        empty_states: {
          recent_activity: 'No recent worker activity yet.',
        },
      }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/invoices\/?(?:\?.*)?$/, async (route) => {
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

  await page.route(/\/api\/projects\/agreements\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/homeowners/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/activity-feed/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [],
        next_best_action: null,
      }),
    });
  });

  await page.route('**/api/projects/contractor/public-leads/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/notifications/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(notifications),
    });
  });
}

test('authenticated shell renders notifications bell and dropdown panel', async ({ page }) => {
  await mockAuthenticatedShell(page, [
    {
      id: 1,
      title: 'Bid Awarded',
      message: 'Your bid was selected for this project.',
      action_label: 'Open Agreement',
      action_url: '/app/agreements/321',
      created_at: '2026-04-15T15:30:00Z',
      is_read: false,
    },
    {
      id: 2,
      title: 'Bid Not Selected',
      message: 'Another contractor was selected for this project.',
      action_label: 'View Bids',
      action_url: '/app/bids',
      created_at: '2026-04-15T15:20:00Z',
      is_read: false,
    },
    {
      id: 3,
      title: 'Invoice Approved',
      message: 'A payment milestone was approved.',
      action_label: 'View Details',
      action_url: '/app/invoices/77',
      created_at: '2026-04-15T15:10:00Z',
      is_read: true,
    },
  ]);

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  const bell = page.getByTestId('notifications-bell-button');
  await expect(bell).toBeVisible();
  await expect(page.getByTestId('notifications-unread-badge')).toHaveText('2');

  await bell.click();
  const panel = page.getByTestId('notifications-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Bid Awarded');
  await expect(panel).toContainText('Bid Not Selected');
  await expect(panel).toContainText('Invoice Approved');
  await expect(panel.getByRole('link', { name: 'Open Agreement' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'View Bids' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'View Details' })).toBeVisible();
  await expect(panel).not.toContainText('No notifications yet.');

  await panel.getByRole('link', { name: 'Open Agreement' }).click();
  await expect(panel).toBeHidden();
});

test('authenticated shell shows a clean empty notifications state', async ({ page }) => {
  await mockAuthenticatedShell(page, []);

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  const bell = page.getByTestId('notifications-bell-button');
  await expect(bell).toBeVisible();
  await expect(page.getByTestId('notifications-unread-badge')).toHaveCount(0);

  await bell.click();
  const panel = page.getByTestId('notifications-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('No notifications yet.');
  await expect(panel.getByTestId('notifications-empty-state')).toBeVisible();
});
