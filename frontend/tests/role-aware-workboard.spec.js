import { expect, test } from '@playwright/test';

test('employee dashboard renders shared workboard sections and reviewer actions', async ({
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
        user_id: 55,
        email: 'employee@example.com',
        type: 'subaccount',
        role: 'employee_supervisor',
        identity_type: 'internal_team_member',
        team_role: 'employee_supervisor',
      }),
    });
  });

  await page.route('**/api/projects/employee/milestones/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        can_work: true,
        milestones: [],
      }),
    });
  });

  await page.route('**/api/projects/dashboard/operations/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        identity_type: 'internal_team_member',
        today: [
          {
            id: 'review_submission-901',
            item_type: 'review_submission',
            title: 'Cabinet Install is awaiting your review',
            subtitle: 'Taylor Sub submitted work for review in Kitchen Remodel.',
            agreement_id: 321,
            agreement_title: 'Kitchen Remodel Agreement',
            project_title: 'Kitchen Remodel',
            milestone_id: 901,
            milestone_title: 'Cabinet Install',
            assigned_worker_display: 'Taylor Sub',
            reviewer_display: 'Ops Reviewer',
            work_submitted_at: '2026-03-24T09:00:00Z',
            actions: [
              { label: 'Review', type: 'route', target: '/app/reviewer/queue' },
              { label: 'View Work', type: 'route', target: '/app/employee/milestones' },
            ],
          },
        ],
        tomorrow: [],
        this_week: [],
        recent_activity: [
          {
            id: 'comment-77',
            item_type: 'comment_added',
            title: 'Comment added on Cabinet Install',
            subtitle: 'Taylor Sub commented on Kitchen Remodel.',
            occurred_at: '2026-03-24T11:00:00Z',
            milestone_id: 901,
            milestone_title: 'Cabinet Install',
            actions: [
              { label: 'View Work', type: 'route', target: '/app/employee/milestones' },
            ],
          },
        ],
        empty_states: {
          today: 'Nothing needs your attention today.',
          tomorrow: 'Nothing is scheduled for tomorrow yet.',
          this_week: 'No additional work is stacked up later this week.',
          recent_activity: 'No recent updates on your work yet.',
        },
      }),
    });
  });

  await page.goto('/app/employee/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('role-workboard-today')).toBeVisible();
  await expect(page.getByTestId('workboard-item-review_submission-901')).toContainText(
    'Cabinet Install is awaiting your review'
  );
  await expect(page.getByTestId('workboard-action-review_submission-901-0')).toContainText(
    'Review'
  );
  await expect(page.getByTestId('role-workboard-recent-activity')).toContainText(
    'Comment added on Cabinet Install'
  );
});

test('subcontractor assigned work page renders shared workboard sections and empty states', async ({
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
        user_id: 99,
        email: 'subcontractor@example.com',
        type: 'subcontractor',
        role: 'subcontractor',
        identity_type: 'subcontractor',
      }),
    });
  });

  await page.route('**/api/projects/dashboard/operations/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        identity_type: 'subcontractor',
        today: [
          {
            id: 'review_submission-901',
            item_type: 'review_submission',
            title: 'Cabinet Install is awaiting review',
            subtitle: 'Your submission is waiting for review on Kitchen Remodel.',
            agreement_id: 321,
            milestone_id: 901,
            milestone_title: 'Cabinet Install',
            assigned_worker_display: 'Taylor Sub',
            reviewer_display: 'Contractor Owner',
            work_submitted_at: '2026-03-24T09:00:00Z',
            actions: [
              { label: 'Open Assigned Work', type: 'route', target: '/app/subcontractor/assigned-work' },
            ],
          },
        ],
        tomorrow: [],
        this_week: [],
        recent_activity: [],
        empty_states: {
          today: 'Nothing needs your attention today.',
          tomorrow: 'Nothing is scheduled for tomorrow yet.',
          this_week: 'No additional assigned work is queued for later this week.',
          recent_activity: 'No recent updates on your assigned work yet.',
        },
      }),
    });
  });

  await page.route('**/api/projects/subcontractor/milestones/my-assigned/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        groups: [],
        milestones: [],
        count: 0,
      }),
    });
  });

  await page.goto('/app/subcontractor/assigned-work', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('role-workboard-today')).toBeVisible();
  await expect(page.getByTestId('workboard-item-review_submission-901')).toContainText(
    'Cabinet Install is awaiting review'
  );
  await expect(page.getByTestId('workboard-action-review_submission-901-0')).toContainText(
    'Open Assigned Work'
  );
  await expect(page.getByTestId('subcontractor-assigned-work-empty')).toBeVisible();
  await expect(page.getByTestId('role-workboard-recent-activity-empty')).toBeVisible();
});
