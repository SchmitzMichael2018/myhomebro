import { expect, test } from '@playwright/test';

test('contractor dashboard renders recent subcontractor activity notifications', async ({
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

  await page.route('**/api/projects/notifications/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 901,
          event_type: 'subcontractor_comment',
          agreement_id: 321,
          milestone_id: 45,
          actor_display_name: 'Taylor Sub',
          actor_email: 'taylor@example.com',
          title: 'Subcontractor added a comment',
          message: 'Taylor Sub added a comment on Paint Prep in Kitchen Remodel.',
          project_title: 'Kitchen Remodel',
          is_read: false,
          created_at: '2026-03-24T10:00:00Z',
        },
        {
          id: 902,
          event_type: 'subcontractor_review',
          agreement_id: 321,
          milestone_id: 46,
          actor_display_name: 'Taylor Sub',
          actor_email: 'taylor@example.com',
          title: 'Subcontractor requested review',
          message: 'Taylor Sub flagged Cabinet Install as ready for review in Kitchen Remodel.',
          project_title: 'Kitchen Remodel',
          is_read: false,
          created_at: '2026-03-24T11:00:00Z',
        },
      ]),
    });
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('contractor-notifications-panel')).toBeVisible();
  await expect(page.getByTestId('contractor-notification-901')).toContainText(
    'Subcontractor added a comment'
  );
  await expect(page.getByTestId('contractor-notification-902')).toContainText(
    'Subcontractor requested review'
  );
  await expect(page.getByTestId('contractor-notification-902')).toContainText(
    'Kitchen Remodel'
  );
});
