import { expect, test } from '@playwright/test';

function subcontractorOpsPayload() {
  return {
    identity_type: 'subcontractor',
    today: [],
    tomorrow: [],
    this_week: [],
    recent_activity: [],
    empty_states: {
      today: 'Nothing needs your attention today.',
      tomorrow: 'Nothing is scheduled for tomorrow yet.',
      this_week: 'No additional assigned work is queued for later this week.',
      recent_activity: 'No recent updates on your assigned work yet.',
    },
  };
}

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

  await page.route('**/api/projects/dashboard/operations/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(subcontractorOpsPayload()),
    });
  });

  await page.route('**/api/projects/subcontractor/milestones/my-assigned/**', async (route) => {
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
                      can_current_user_submit_work: true,
                      subcontractor_agreement: {
                        id: 44,
                        milestone_id: 901,
                        agreement_id: 321,
                        contractor_business_name: 'Kitchen Remodel Agreement',
                        contractor_name: 'Kitchen Remodel Agreement',
                        subcontractor_display_name: 'Taylor Sub',
                        subcontractor_email: 'subcontractor@example.com',
                        milestone_title: 'Cabinet Install',
                        milestone_description: 'Install all upper and lower cabinets.',
                      agreed_pay: '1750.00',
                      payment_release_mode: 'manual_release',
                      payment_release_mode_label: 'Manual Release',
                      agreement_acceptance_status: 'accepted',
                      agreement_acceptance_status_label: 'Accepted',
                      subcontractor_payout_orchestration: {
                        payout_state: 'not_due',
                        next_status: 'not_due',
                        safe_summary: 'Waiting for customer approval.',
                        payment_release_mode: 'manual_release',
                        payment_release_mode_label: 'Manual Release',
                        can_manual_release: false,
                        can_auto_release: false,
                        blocking_reasons_labels: ['Customer approval or payment release is still pending.'],
                      },
                      payout_orchestration: {
                        payout_state: 'not_due',
                        safe_summary: 'Waiting for customer approval.',
                        payment_release_mode: 'manual_release',
                        payment_release_mode_label: 'Manual Release',
                          can_manual_release: false,
                          can_auto_release: false,
                          blocking_reasons_labels: ['Customer approval or payment release is still pending.'],
                        },
                      },
                      assigned_subcontractor: {
                        invitation_id: 77,
                        display_name: 'Taylor Sub',
                        email: 'subcontractor@example.com',
                      },
                    },
                  ],
                },
              ],
              milestones: [{ id: 901, title: 'Cabinet Install' }],
              count: 1,
            }
      ),
    });
  });

  await page.route('**/api/projects/subcontractor/milestones/901/agreement/accept/**', async (route) => {
    const acceptedAgreement = {
      id: 44,
      milestone_id: 901,
      agreement_id: 321,
      contractor_business_name: 'Kitchen Remodel Agreement',
      contractor_name: 'Kitchen Remodel Agreement',
      subcontractor_display_name: 'Taylor Sub',
      subcontractor_email: 'subcontractor@example.com',
      milestone_title: 'Cabinet Install',
      milestone_description: 'Install all upper and lower cabinets.',
      agreed_pay: '1750.00',
      payment_release_mode: 'manual_release',
      payment_release_mode_label: 'Manual Release',
      agreement_acceptance_status: 'accepted',
      agreement_acceptance_status_label: 'Accepted',
      subcontractor_payout_orchestration: {
        payout_state: 'not_due',
        next_status: 'not_due',
        safe_summary: 'Waiting for customer approval.',
        payment_release_mode: 'manual_release',
        payment_release_mode_label: 'Manual Release',
        can_manual_release: false,
        can_auto_release: false,
        blocking_reasons_labels: ['Customer approval or payment release is still pending.'],
      },
      payout_orchestration: {
        payout_state: 'not_due',
        safe_summary: 'Waiting for customer approval.',
        payment_release_mode: 'manual_release',
        payment_release_mode_label: 'Manual Release',
        can_manual_release: false,
        can_auto_release: false,
        blocking_reasons_labels: ['Customer approval or payment release is still pending.'],
      },
    };
    emptyMode = false;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        milestone_id: 901,
        agreement: acceptedAgreement,
        can_current_user_submit_work: true,
      }),
    });
  });

  await page.route('**/api/projects/milestones/901/submit-work/**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 901,
        title: 'Cabinet Install',
        work_submission_status: 'submitted_for_review',
        can_current_user_submit_work: false,
        subcontractor_agreement: {
          id: 44,
          milestone_id: 901,
          agreement_id: 321,
          contractor_business_name: 'Kitchen Remodel Agreement',
          contractor_name: 'Kitchen Remodel Agreement',
          subcontractor_display_name: 'Taylor Sub',
          subcontractor_email: 'subcontractor@example.com',
          milestone_title: 'Cabinet Install',
          milestone_description: 'Install all upper and lower cabinets.',
          agreed_pay: '1750.00',
          payment_release_mode: 'manual_release',
          payment_release_mode_label: 'Manual Release',
          agreement_acceptance_status: 'accepted',
          agreement_acceptance_status_label: 'Accepted',
          subcontractor_payout_orchestration: {
            payout_state: 'not_due',
            next_status: 'not_due',
            safe_summary: 'Waiting for customer approval.',
            payment_release_mode: 'manual_release',
            payment_release_mode_label: 'Manual Release',
            can_manual_release: false,
            can_auto_release: false,
            blocking_reasons_labels: ['Customer approval or payment release is still pending.'],
          },
          payout_orchestration: {
            payout_state: 'not_due',
            safe_summary: 'Waiting for customer approval.',
            payment_release_mode: 'manual_release',
            payment_release_mode_label: 'Manual Release',
            can_manual_release: false,
            can_auto_release: false,
            blocking_reasons_labels: ['Customer approval or payment release is still pending.'],
          },
        },
      }),
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
  await expect(page.getByTestId('assigned-milestone-901')).toContainText('Taylor Sub');
  await expect(page.getByTestId('assigned-milestone-agreement-summary-901')).toContainText('$1,750.00');
  await expect(page.getByTestId('assigned-milestone-agreement-summary-901')).toContainText(
    'Agreement accepted'
  );
  await expect(page.getByTestId('assigned-milestone-agreement-summary-901')).toContainText(
    'Payment Status'
  );
  await expect(page.getByTestId('assigned-milestone-agreement-summary-901')).toContainText(
    'Not yet due'
  );
  await expect(page.getByTestId('assigned-milestone-submit-complete-901')).toBeEnabled();
  await expect(page.getByTestId('assigned-milestone-accept-agreement-901')).toHaveCount(0);
  await page.getByTestId('assigned-milestone-submit-complete-901').click();
  await expect(page.getByTestId('assigned-milestone-completion-state-901')).toContainText(
    'Submitted for review'
  );
  await expect(page.getByTestId('assigned-milestone-payout-state-901')).toHaveCount(0);
  await expect(page.getByTestId('subcontractor-payout-account-status')).toHaveCount(0);

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

  await page.route('**/api/projects/dashboard/operations/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(subcontractorOpsPayload()),
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
    can_current_user_submit_work: true,
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

  await page.route('**/api/projects/dashboard/operations/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(subcontractorOpsPayload()),
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
    subcontractor_agreement: {
      id: 44,
      milestone_id: 901,
      agreement_id: 321,
      contractor_business_name: 'Kitchen Remodel Agreement',
      contractor_name: 'Kitchen Remodel Agreement',
      subcontractor_display_name: 'Taylor Sub',
      subcontractor_email: 'subcontractor@example.com',
      milestone_title: 'Cabinet Install',
      milestone_description: 'Install all upper and lower cabinets.',
      agreed_pay: '1750.00',
      payment_release_mode: 'manual_release',
      payment_release_mode_label: 'Manual Release',
      agreement_acceptance_status: 'pending',
      agreement_acceptance_status_label: 'Pending',
    },
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

  await page.route('**/api/projects/dashboard/operations/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(subcontractorOpsPayload()),
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

  await page.route('**/api/projects/subcontractor/milestones/901/agreement/accept/**', async (route) => {
    milestoneState.subcontractor_agreement.agreement_acceptance_status = 'accepted';
    milestoneState.subcontractor_agreement.agreement_acceptance_status_label = 'Accepted';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        milestone_id: 901,
        agreement: milestoneState.subcontractor_agreement,
        can_current_user_submit_work: true,
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
  await expect(page.getByTestId('assigned-milestone-accept-agreement-901')).toBeVisible();
  await page.getByTestId('assigned-milestone-accept-agreement-901').click();
  await expect(page.getByTestId('assigned-milestone-submit-complete-901')).toBeEnabled();

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
