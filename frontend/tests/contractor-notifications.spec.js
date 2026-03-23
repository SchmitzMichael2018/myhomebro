import { expect, test } from '@playwright/test';

test('contractor dashboard renders operations sections and recent activity actions', async ({
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

  await page.route('**/api/projects/dashboard/operations/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        identity_type: 'contractor_owner',
        today: [
          {
            id: 'review_submission-45',
            item_type: 'review_submission',
            title: 'Cabinet Install is awaiting your review',
            subtitle: 'Taylor Sub submitted work for review in Kitchen Remodel.',
            agreement_id: 321,
            agreement_title: 'Kitchen Remodel Agreement',
            project_title: 'Kitchen Remodel',
            milestone_id: 45,
            milestone_title: 'Cabinet Install',
            status: 'pending',
            assigned_worker_display: 'Taylor Sub',
            reviewer_display: 'Contractor Owner',
            work_submitted_at: '2026-03-24T09:00:00Z',
            work_submission_note: 'Ready for walkthrough.',
            actions: [
              { label: 'Review Now', type: 'route', target: '/app/reviewer/queue' },
              { label: 'Open Agreement', type: 'route', target: '/app/agreements/321' },
            ],
          },
        ],
        tomorrow: [
          {
            id: 'start_tomorrow-46',
            item_type: 'start_tomorrow',
            title: 'Paint Prep starts tomorrow',
            subtitle: 'Kitchen Remodel',
            agreement_id: 321,
            agreement_title: 'Kitchen Remodel Agreement',
            project_title: 'Kitchen Remodel',
            milestone_id: 46,
            milestone_title: 'Paint Prep',
            status: 'pending',
            assigned_worker_display: 'Taylor Sub',
            reviewer_display: 'Contractor Owner',
            completion_date: '2026-03-25T09:00:00Z',
            actions: [
              { label: 'View Milestone', type: 'route', target: '/app/milestones/46' },
            ],
          },
        ],
        this_week: [
          {
            id: 'due_this_week-47',
            item_type: 'due_this_week',
            title: 'Trim Install is due later this week',
            subtitle: 'Kitchen Remodel',
            agreement_id: 321,
            agreement_title: 'Kitchen Remodel Agreement',
            project_title: 'Kitchen Remodel',
            milestone_id: 47,
            milestone_title: 'Trim Install',
            status: 'pending',
            assigned_worker_display: 'Taylor Sub',
            reviewer_display: 'Contractor Owner',
            completion_date: '2026-03-28T09:00:00Z',
            actions: [
              { label: 'View Milestone', type: 'route', target: '/app/milestones/47' },
            ],
          },
        ],
        recent_activity: [
          {
            id: 'notification-901',
            item_type: 'subcontractor_comment',
            title: 'Subcontractor added a comment',
            subtitle: 'Taylor Sub added a comment on Paint Prep in Kitchen Remodel.',
            agreement_id: 321,
            project_title: 'Kitchen Remodel',
            milestone_id: 46,
            milestone_title: 'Paint Prep',
            occurred_at: '2026-03-24T10:00:00Z',
            actions: [
              { label: 'Open Agreement', type: 'route', target: '/app/agreements/321' },
            ],
          },
          {
            id: 'work_sent_back-48',
            item_type: 'work_sent_back',
            title: 'Countertop Scribing was sent back',
            subtitle: 'Taylor Sub needs changes in Kitchen Remodel.',
            agreement_id: 321,
            project_title: 'Kitchen Remodel',
            milestone_id: 48,
            milestone_title: 'Countertop Scribing',
            occurred_at: '2026-03-24T11:00:00Z',
            review_response_note: 'Please tighten the seam.',
            actions: [
              { label: 'View Milestone', type: 'route', target: '/app/milestones/48' },
            ],
          },
        ],
        empty_states: {
          today: 'No contractor actions need attention today.',
          tomorrow: 'Nothing is scheduled for tomorrow yet.',
          this_week: 'Nothing else is stacked up for later this week.',
          recent_activity: 'No recent worker activity yet.',
        },
      }),
    });
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('role-workboard-today')).toBeVisible();
  await expect(page.getByTestId('role-workboard-tomorrow')).toBeVisible();
  await expect(page.getByTestId('role-workboard-this-week')).toBeVisible();
  await expect(page.getByTestId('role-workboard-recent-activity')).toBeVisible();

  await expect(page.getByTestId('workboard-item-review_submission-45')).toContainText(
    'Cabinet Install is awaiting your review'
  );
  await expect(page.getByTestId('workboard-item-start_tomorrow-46')).toContainText(
    'Paint Prep starts tomorrow'
  );
  await expect(page.getByTestId('workboard-item-due_this_week-47')).toContainText(
    'Trim Install is due later this week'
  );
  await expect(page.getByTestId('workboard-item-notification-901')).toContainText(
    'Subcontractor added a comment'
  );
  await expect(page.getByTestId('workboard-item-work_sent_back-48')).toContainText(
    'Please tighten the seam.'
  );

  await expect(page.getByTestId('workboard-action-review_submission-45-0')).toContainText(
    'Review'
  );
  await expect(page.getByTestId('workboard-action-notification-901-0')).toContainText(
    'Open Agreement'
  );
});

test('contractor dashboard operations shows empty states when nothing needs attention', async ({
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
          today: 'No contractor actions need attention today.',
          tomorrow: 'Nothing is scheduled for tomorrow yet.',
          this_week: 'Nothing else is stacked up for later this week.',
          recent_activity: 'No recent worker activity yet.',
        },
      }),
    });
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('role-workboard-today-empty')).toBeVisible();
  await expect(page.getByTestId('role-workboard-tomorrow-empty')).toBeVisible();
  await expect(page.getByTestId('role-workboard-this-week-empty')).toBeVisible();
  await expect(page.getByTestId('role-workboard-recent-activity-empty')).toBeVisible();
});
