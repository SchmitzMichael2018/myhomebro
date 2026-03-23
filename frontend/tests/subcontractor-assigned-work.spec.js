import { expect, test } from '@playwright/test';

test('subcontractor assigned work page renders grouped milestones and empty state', async ({
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
        user_id: 99,
        email: 'subcontractor@example.com',
        type: 'subcontractor',
        role: 'subcontractor',
      }),
    });
  });

  await page.route('**/api/projects/subcontractor/milestones/my-assigned/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        emptyMode
          ? {
              groups: [],
              milestones: [],
              count: 0,
            }
          : {
              groups: [
                {
                  agreement_id: 321,
                  agreement_title: 'Kitchen Remodel Agreement',
                  project_title: 'Kitchen Remodel Agreement',
                  milestones: [
                    {
                      id: 901,
                      title: 'Cabinet Install',
                      description: 'Install all upper and lower cabinets.',
                      status: 'pending',
                      start_date: '2026-03-25',
                      completion_date: '2026-03-28',
                      assigned_worker_display: 'Taylor Sub',
                      reviewer_display: 'Contractor Owner',
                      assigned_subcontractor: {
                        invitation_id: 77,
                        display_name: 'Taylor Sub',
                        email: 'subcontractor@example.com',
                      },
                    },
                  ],
                },
              ],
              milestones: [
                {
                  id: 901,
                  title: 'Cabinet Install',
                },
              ],
              count: 1,
            }
      ),
    });
  });

  await page.goto('/app/subcontractor/assigned-work', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('subcontractor-assigned-work-title')).toBeVisible();
  await expect(page.getByTestId('assigned-work-group-321')).toContainText(
    'Kitchen Remodel Agreement'
  );
  await expect(page.getByTestId('assigned-milestone-901')).toContainText(
    'Cabinet Install'
  );
  await expect(page.getByTestId('assigned-milestone-901')).toContainText(
    'Taylor Sub'
  );

  emptyMode = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('subcontractor-assigned-work-empty')).toBeVisible();
});

test('subcontractor assigned work supports comments and file upload for assigned milestone', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  const comments = [
    {
      id: 1,
      author_name: 'Contractor Owner',
      content: 'Initial contractor note',
      created_at: '2026-03-24T10:00:00Z',
    },
  ];
  const files = [
    {
      id: 2,
      file_name: 'scope.txt',
      file_url: 'http://localhost:4173/media/scope.txt',
      uploaded_by_name: 'Contractor Owner',
      uploaded_at: '2026-03-24T10:05:00Z',
    },
  ];

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user_id: 99,
        email: 'subcontractor@example.com',
        type: 'subcontractor',
        role: 'subcontractor',
      }),
    });
  });

  await page.route('**/api/projects/subcontractor/milestones/my-assigned/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        groups: [
          {
            agreement_id: 321,
            agreement_title: 'Kitchen Remodel Agreement',
            project_title: 'Kitchen Remodel Agreement',
            milestones: [
              {
                id: 901,
                title: 'Cabinet Install',
                description: 'Install all upper and lower cabinets.',
                status: 'pending',
                start_date: '2026-03-25',
                completion_date: '2026-03-28',
                assigned_worker_display: 'Taylor Sub',
                reviewer_display: 'Contractor Owner',
                assigned_subcontractor: {
                  invitation_id: 77,
                  display_name: 'Taylor Sub',
                  email: 'subcontractor@example.com',
                },
              },
            ],
          },
        ],
        milestones: [{ id: 901 }],
        count: 1,
      }),
    });
  });

  await page.route('**/api/projects/subcontractor/milestones/901/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        milestone: { id: 901, title: 'Cabinet Install' },
        comments,
        files,
      }),
    });
  });

  await page.route('**/api/projects/subcontractor/milestones/901/comments/', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(comments),
      });
      return;
    }

    const body = route.request().postDataJSON();
    const created = {
      id: 3,
      author_name: 'Taylor Sub',
      content: body.content,
      created_at: '2026-03-24T10:10:00Z',
    };
    comments.unshift(created);
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(created),
    });
  });

  await page.route('**/api/projects/subcontractor/milestones/901/files/', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(files),
      });
      return;
    }

    const created = {
      id: 4,
      file_name: 'progress.txt',
      file_url: 'http://localhost:4173/media/progress.txt',
      uploaded_by_name: 'Taylor Sub',
      uploaded_at: '2026-03-24T10:12:00Z',
    };
    files.unshift(created);
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(created),
    });
  });

  await page.goto('/app/subcontractor/assigned-work', {
    waitUntil: 'domcontentloaded',
  });

  await page.getByTestId('assigned-milestone-toggle-901').click();
  await expect(page.getByText('Initial contractor note')).toBeVisible();
  await expect(page.getByText('scope.txt')).toBeVisible();

  await page
    .getByTestId('assigned-milestone-comment-input-901')
    .fill('Need cabinet hardware details.');
  await page.getByTestId('assigned-milestone-comment-submit-901').click();
  await expect(page.getByText('Need cabinet hardware details.')).toBeVisible();

  await page.setInputFiles('[data-testid="assigned-milestone-file-input-901"]', {
    name: 'progress.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('progress update'),
  });
  await expect(page.getByText('progress.txt')).toBeVisible();
});

test('subcontractor assigned work can request contractor review for an assigned milestone', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  const milestoneState = {
    id: 901,
    title: 'Cabinet Install',
    description: 'Install all upper and lower cabinets.',
    status: 'pending',
    start_date: '2026-03-25',
    completion_date: '2026-03-28',
    assigned_subcontractor: {
      invitation_id: 77,
      display_name: 'Taylor Sub',
      email: 'subcontractor@example.com',
    },
    assigned_worker_display: 'Taylor Sub',
    reviewer_display: 'Contractor Owner',
    subcontractor_review_requested: false,
    subcontractor_review_requested_at: null,
    subcontractor_review_note: '',
  };

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user_id: 99,
        email: 'subcontractor@example.com',
        type: 'subcontractor',
        role: 'subcontractor',
      }),
    });
  });

  await page.route('**/api/projects/subcontractor/milestones/my-assigned/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        groups: [
          {
            agreement_id: 321,
            agreement_title: 'Kitchen Remodel Agreement',
            project_title: 'Kitchen Remodel Agreement',
            milestones: [milestoneState],
          },
        ],
        milestones: [milestoneState],
        count: 1,
      }),
    });
  });

  await page.route('**/api/projects/subcontractor/milestones/901/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        milestone: milestoneState,
        comments: [],
        files: [],
      }),
    });
  });

  await page.route('**/api/projects/subcontractor/milestones/901/request-review/', async (route) => {
    milestoneState.subcontractor_review_requested = true;
    milestoneState.subcontractor_review_requested_at = '2026-03-24T10:15:00Z';
    milestoneState.subcontractor_review_note = 'Ready for your walkthrough.';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        milestone: milestoneState,
      }),
    });
  });

  await page.goto('/app/subcontractor/assigned-work', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('assigned-milestone-review-state-901')).toContainText(
    'Review not requested'
  );

  await page
    .getByTestId('assigned-milestone-review-note-901')
    .fill('Ready for your walkthrough.');
  await page.getByTestId('assigned-milestone-request-review-901').click();

  await expect(page.getByTestId('assigned-milestone-review-state-901')).toContainText(
    'Review requested'
  );
  await expect(page.getByTestId('assigned-milestone-review-state-901')).toContainText(
    'Ready for your walkthrough.'
  );
});

test('subcontractor assigned work can submit completion for review and shows sent-back state', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  const milestoneState = {
    id: 901,
    title: 'Cabinet Install',
    description: 'Install all upper and lower cabinets.',
    status: 'pending',
    start_date: '2026-03-25',
    completion_date: '2026-03-28',
    assigned_subcontractor: {
      invitation_id: 77,
      display_name: 'Taylor Sub',
      email: 'subcontractor@example.com',
    },
    assigned_worker_display: 'Taylor Sub',
    reviewer_display: 'Contractor Owner',
    subcontractor_review_requested: false,
    subcontractor_review_requested_at: null,
    subcontractor_review_note: '',
    subcontractor_completion_status: 'needs_changes',
    subcontractor_marked_complete_at: '2026-03-24T09:00:00Z',
    subcontractor_completion_note: 'Initial completion pass is done.',
    subcontractor_review_response_note: 'Please adjust the pantry trim before resubmitting.',
  };

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user_id: 99,
        email: 'subcontractor@example.com',
        type: 'subcontractor',
        role: 'subcontractor',
      }),
    });
  });

  await page.route('**/api/projects/subcontractor/milestones/my-assigned/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        groups: [
          {
            agreement_id: 321,
            agreement_title: 'Kitchen Remodel Agreement',
            project_title: 'Kitchen Remodel Agreement',
            milestones: [milestoneState],
          },
        ],
        milestones: [milestoneState],
        count: 1,
      }),
    });
  });

  await page.route('**/api/projects/milestones/901/submit-work/', async (route) => {
    milestoneState.work_submission_status = 'submitted_for_review';
    milestoneState.work_submitted_at = '2026-03-24T10:20:00Z';
    milestoneState.work_submission_note = 'Cabinet install is ready for review.';
    milestoneState.work_review_response_note = '';
    milestoneState.subcontractor_completion_status = 'submitted_for_review';
    milestoneState.subcontractor_marked_complete_at = '2026-03-24T10:20:00Z';
    milestoneState.subcontractor_completion_note = 'Cabinet install is ready for review.';
    milestoneState.subcontractor_review_response_note = '';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(milestoneState),
    });
  });

  await page.goto('/app/subcontractor/assigned-work', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('assigned-milestone-completion-state-901')).toContainText(
    'Needs changes'
  );
  await expect(page.getByTestId('assigned-milestone-completion-state-901')).toContainText(
    'Please adjust the pantry trim before resubmitting.'
  );

  await page
    .getByTestId('assigned-milestone-completion-note-901')
    .fill('Cabinet install is ready for review.');
  await page.getByTestId('assigned-milestone-submit-complete-901').click();

  await expect(page.getByTestId('assigned-milestone-completion-state-901')).toContainText(
    'Submitted for review'
  );
  await expect(page.getByTestId('assigned-milestone-completion-state-901')).toContainText(
    'Cabinet install is ready for review.'
  );
});
