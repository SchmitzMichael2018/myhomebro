import { expect, test } from '@playwright/test';

test('contractor reviewer queue renders review items and supports approve flow', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  let emptyMode = false;

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user_id: 7,
        email: 'owner@example.com',
        type: 'contractor',
        role: 'contractor_owner',
        identity_type: 'contractor_owner',
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

  await page.route('**/api/projects/milestones/reviewer-queue/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        emptyMode
          ? { groups: [], milestones: [], count: 0 }
          : {
              groups: [
                {
                  agreement_id: 321,
                  agreement_title: 'Kitchen Remodel Agreement',
                  project_title: 'Kitchen Remodel',
                  milestones: [
                    {
                      id: 901,
                      title: 'Cabinet Install',
                      description: 'Install upper and lower cabinets.',
                      status: 'pending',
                      completion_date: '2026-03-28T10:00:00Z',
                      assigned_worker_display: 'Taylor Sub',
                      reviewer_display: 'Queue Owner',
                      work_submission_status: 'submitted_for_review',
                      work_submitted_at: '2026-03-27T16:30:00Z',
                      work_submission_note: 'Cabinets are shimmed and leveled.',
                      agreement_id: 321,
                    },
                  ],
                },
              ],
              milestones: [
                {
                  id: 901,
                },
              ],
              count: 1,
            }
      ),
    });
  });

  await page.route('**/api/projects/milestones/901/approve-work/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 901,
        work_submission_status: 'approved',
      }),
    });
  });

  await page.goto('/app/reviewer/queue', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('link', { name: 'Awaiting Review' })).toBeVisible();
  await expect(page.getByTestId('reviewer-queue-title')).toBeVisible();
  await expect(page.getByTestId('reviewer-queue-item-901')).toContainText('Cabinet Install');
  await expect(page.getByTestId('reviewer-queue-item-901')).toContainText('Taylor Sub');
  await expect(page.getByTestId('reviewer-queue-item-901')).toContainText(
    'Cabinets are shimmed and leveled.'
  );

  await page
    .getByTestId('reviewer-queue-response-note-901')
    .fill('Looks good from the queue.');
  await page.getByTestId('reviewer-queue-approve-901').click();
  await expect(page.getByTestId('reviewer-queue-empty')).toBeVisible();

  emptyMode = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('reviewer-queue-empty')).toBeVisible();
});

test('delegated reviewer queue renders only delegated review items', async ({
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
        email: 'reviewer@example.com',
        type: 'subaccount',
        role: 'employee_supervisor',
        identity_type: 'internal_team_member',
        team_role: 'employee_supervisor',
      }),
    });
  });

  await page.route('**/api/projects/milestones/reviewer-queue/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        groups: [
          {
            agreement_id: 777,
            agreement_title: 'Bathroom Remodel',
            project_title: 'Bathroom Remodel',
            milestones: [
              {
                id: 902,
                title: 'Tile Layout Review',
                description: 'Review tile layout before grout.',
                status: 'pending',
                completion_date: '2026-03-29T10:00:00Z',
                assigned_worker_display: 'Internal Worker',
                reviewer_display: 'Delegated Reviewer',
                work_submission_status: 'submitted_for_review',
                work_submitted_at: '2026-03-28T14:00:00Z',
                work_submission_note: 'Layout is ready for inspection.',
                agreement_id: 777,
              },
            ],
          },
        ],
        milestones: [{ id: 902 }],
        count: 1,
      }),
    });
  });

  await page.route('**/api/projects/milestones/902/send-back-work/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 902,
        work_submission_status: 'needs_changes',
      }),
    });
  });

  await page.goto('/app/reviewer/queue', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('link', { name: 'Awaiting Review' })).toBeVisible();
  await expect(page.getByTestId('reviewer-queue-item-902')).toContainText('Tile Layout Review');
  await expect(page.getByTestId('reviewer-queue-item-902')).toContainText('Delegated Reviewer');

  await page
    .getByTestId('reviewer-queue-response-note-902')
    .fill('Please adjust the corner alignment.');
  await page.getByTestId('reviewer-queue-send-back-902').click();
  await expect(page.getByTestId('reviewer-queue-empty')).toBeVisible();
});
