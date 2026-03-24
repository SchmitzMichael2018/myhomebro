import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 321;
const MILESTONE_ID = 901;

test('agreement detail renders subcontractor assignment state and lets contractor update it', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  const milestoneState = {
    id: MILESTONE_ID,
    title: 'Cabinet Install',
    amount: '2500.00',
    status: 'pending',
    assigned_subcontractor_invitation: null,
    assigned_subcontractor: null,
    assigned_subcontractor_display: '',
    assigned_worker_display: '',
    reviewer_display: 'Contractor Owner',
    reviewer: {
      kind: 'contractor_owner',
      display_name: 'Contractor Owner',
      email: 'playwright@myhomebro.local',
      is_delegated: false,
    },
    payout_amount: null,
    payout_status: null,
  };

  const acceptedSubcontractors = [
    {
      id: 77,
      invite_email: 'accepted-sub@example.com',
      invite_name: 'Accepted Sub',
      accepted_name: 'Accepted Sub',
      accepted_at: '2026-03-23T12:00:00Z',
      invite_url: 'http://localhost:4173/subcontractor-invitations/accept/accepted-token',
    },
  ];
  const reviewers = [
    {
      id: 55,
      display_name: 'Internal Reviewer',
      email: 'reviewer@example.com',
      role: 'employee_supervisor',
    },
  ];

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

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: AGREEMENT_ID,
        title: 'Kitchen Remodel Agreement',
        project_title: 'Kitchen Remodel Agreement',
        homeowner_name: 'Jordan Demo',
        homeowner_email: 'jordan@example.com',
        total_cost: '12000.00',
        payment_mode: 'escrow',
        status: 'signed',
        signed_by_contractor: true,
        signed_by_homeowner: true,
        escrow_funded: false,
        invoices: [],
        milestones: [milestoneState],
        pdf_versions: [],
      }),
    });
  });

  await page.route('**/api/projects/agreements/321/funding_preview/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project_amount: '12000.00',
        platform_fee: '361.00',
        contractor_payout: '11639.00',
        homeowner_escrow: '12361.00',
        rate: 0.03,
        is_intro: false,
        tier_name: 'starter',
        high_risk_applied: false,
      }),
    });
  });

  await page.route('**/api/projects/warranties/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/api/projects/agreements/321/subcontractor-invitations/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        agreement_id: AGREEMENT_ID,
        pending_invitations: [],
        accepted_subcontractors: acceptedSubcontractors,
      }),
    });
  });

  await page.route('**/api/projects/subaccounts/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(reviewers),
    });
  });

  await page.route(`**/api/projects/milestones/${MILESTONE_ID}/**`, async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.fallback();
      return;
    }

    const body = route.request().postDataJSON();
    if (body.assigned_subcontractor_invitation === null) {
      milestoneState.assigned_subcontractor_invitation = null;
      milestoneState.assigned_subcontractor = null;
      milestoneState.assigned_subcontractor_display = '';
      milestoneState.assigned_worker_display = '';
      milestoneState.assigned_worker = null;
      milestoneState.payout_amount = null;
      milestoneState.payout_status = null;
    } else if (body.delegated_reviewer_subaccount === null) {
      milestoneState.reviewer = {
        kind: 'contractor_owner',
        display_name: 'Contractor Owner',
        email: 'playwright@myhomebro.local',
        is_delegated: false,
      };
      milestoneState.reviewer_display = 'Contractor Owner';
    } else if (body.delegated_reviewer_subaccount === 55) {
      milestoneState.reviewer = {
        kind: 'internal_team_member',
        display_name: 'Internal Reviewer',
        email: 'reviewer@example.com',
        subaccount_id: 55,
        is_delegated: true,
      };
      milestoneState.reviewer_display = 'Internal Reviewer';
    } else {
      milestoneState.assigned_subcontractor_invitation = 77;
      milestoneState.assigned_subcontractor = {
        invitation_id: 77,
        user_id: 88,
        display_name: 'Accepted Sub',
        email: 'accepted-sub@example.com',
        accepted_at: '2026-03-23T12:00:00Z',
      };
      milestoneState.assigned_subcontractor_display = 'Accepted Sub';
      milestoneState.assigned_worker_display = 'Accepted Sub';
      milestoneState.assigned_worker = {
        kind: 'subcontractor',
        user_id: 88,
        display_name: 'Accepted Sub',
        email: 'accepted-sub@example.com',
        invitation_id: 77,
      };
      milestoneState.payout_amount = '2500.00';
      milestoneState.payout_status = 'not_eligible';
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(milestoneState),
    });
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}`, {
    waitUntil: 'domcontentloaded',
  });

  const milestoneCard = page.getByTestId(`milestone-card-${MILESTONE_ID}`);
  await expect(milestoneCard).toContainText('Assigned Worker: Unassigned');
  await expect(milestoneCard).toContainText('Reviewer: Contractor Owner');

  await milestoneCard.getByTestId('subcontractor-assignment-select').selectOption('77');
  await milestoneCard.getByTestId('subcontractor-assign-button').click();
  await expect(milestoneCard).toContainText('Assigned Worker: Accepted Sub');
  await expect(milestoneCard).toContainText('Payout: $2,500.00 (Not eligible)');

  await milestoneCard.getByTestId('delegated-reviewer-select').selectOption('55');
  await milestoneCard.getByTestId('delegated-reviewer-assign-button').click();
  await expect(milestoneCard).toContainText('Reviewer: Internal Reviewer');

  await milestoneCard.getByTestId('delegated-reviewer-clear-button').click();
  await expect(milestoneCard).toContainText('Reviewer: Contractor Owner');

  await milestoneCard.getByTestId('subcontractor-unassign-button').click();
  await expect(milestoneCard).toContainText('Assigned Worker: Unassigned');
});

test('agreement detail shows subcontractor review state and lets contractor clear it', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  const milestoneState = {
    id: MILESTONE_ID,
    title: 'Cabinet Install',
    amount: '2500.00',
    status: 'pending',
    assigned_subcontractor_invitation: 77,
    assigned_subcontractor: {
      invitation_id: 77,
      user_id: 88,
      display_name: 'Accepted Sub',
      email: 'accepted-sub@example.com',
      accepted_at: '2026-03-23T12:00:00Z',
    },
    assigned_subcontractor_display: 'Accepted Sub',
    assigned_worker_display: 'Accepted Sub',
    reviewer_display: 'Contractor Owner',
    reviewer: {
      kind: 'contractor_owner',
      display_name: 'Contractor Owner',
      email: 'playwright@myhomebro.local',
      is_delegated: false,
    },
    subcontractor_review_requested: true,
    subcontractor_review_requested_at: '2026-03-24T14:00:00Z',
    subcontractor_review_note: 'Ready for contractor review.',
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

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: AGREEMENT_ID,
        title: 'Kitchen Remodel Agreement',
        project_title: 'Kitchen Remodel Agreement',
        homeowner_name: 'Jordan Demo',
        homeowner_email: 'jordan@example.com',
        total_cost: '12000.00',
        payment_mode: 'escrow',
        status: 'signed',
        signed_by_contractor: true,
        signed_by_homeowner: true,
        escrow_funded: false,
        invoices: [],
        milestones: [milestoneState],
        pdf_versions: [],
      }),
    });
  });

  await page.route('**/api/projects/agreements/321/funding_preview/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project_amount: '12000.00',
        platform_fee: '361.00',
        contractor_payout: '11639.00',
        homeowner_escrow: '12361.00',
        rate: 0.03,
        is_intro: false,
        tier_name: 'starter',
        high_risk_applied: false,
      }),
    });
  });

  await page.route('**/api/projects/warranties/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/api/projects/agreements/321/subcontractor-invitations/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        agreement_id: AGREEMENT_ID,
        pending_invitations: [],
        accepted_subcontractors: [
          {
            id: 77,
            invite_email: 'accepted-sub@example.com',
            invite_name: 'Accepted Sub',
            accepted_name: 'Accepted Sub',
            accepted_at: '2026-03-23T12:00:00Z',
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/subaccounts/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route(`**/api/projects/milestones/${MILESTONE_ID}/clear-subcontractor-review/`, async (route) => {
    milestoneState.subcontractor_review_requested = false;
    milestoneState.subcontractor_review_requested_at = null;
    milestoneState.subcontractor_review_note = '';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(milestoneState),
    });
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}`, {
    waitUntil: 'domcontentloaded',
  });

  const milestoneCard = page.getByTestId(`milestone-card-${MILESTONE_ID}`);
  await expect(page.getByTestId(`milestone-review-state-${MILESTONE_ID}`)).toContainText(
    'Review: Requested'
  );
  await expect(milestoneCard).toContainText('Ready for contractor review.');

  await page.getByTestId(`milestone-review-clear-${MILESTONE_ID}`).click();
  await expect(page.getByTestId(`milestone-review-state-${MILESTONE_ID}`)).toContainText(
    'Review: Not requested'
  );
});

test('agreement detail lets contractor approve and reject subcontractor completion submissions', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  const milestoneState = {
    id: MILESTONE_ID,
    title: 'Cabinet Install',
    amount: '2500.00',
    status: 'pending',
    assigned_subcontractor_invitation: 77,
    assigned_subcontractor: {
      invitation_id: 77,
      user_id: 88,
      display_name: 'Accepted Sub',
      email: 'accepted-sub@example.com',
      accepted_at: '2026-03-23T12:00:00Z',
    },
    assigned_subcontractor_display: 'Accepted Sub',
    assigned_worker_display: 'Accepted Sub',
    reviewer_display: 'Contractor Owner',
    reviewer: {
      kind: 'contractor_owner',
      display_name: 'Contractor Owner',
      email: 'playwright@myhomebro.local',
      is_delegated: false,
    },
    subcontractor_completion_status: 'submitted_for_review',
    work_submission_status: 'submitted_for_review',
    subcontractor_marked_complete_at: '2026-03-24T14:00:00Z',
    work_submitted_at: '2026-03-24T14:00:00Z',
    subcontractor_completion_note: 'Cabinet install is complete.',
    work_submission_note: 'Cabinet install is complete.',
    subcontractor_review_response_note: '',
    work_review_response_note: '',
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

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: AGREEMENT_ID,
        title: 'Kitchen Remodel Agreement',
        project_title: 'Kitchen Remodel Agreement',
        homeowner_name: 'Jordan Demo',
        homeowner_email: 'jordan@example.com',
        total_cost: '12000.00',
        payment_mode: 'escrow',
        status: 'signed',
        signed_by_contractor: true,
        signed_by_homeowner: true,
        escrow_funded: false,
        invoices: [],
        milestones: [milestoneState],
        pdf_versions: [],
      }),
    });
  });

  await page.route('**/api/projects/agreements/321/funding_preview/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project_amount: '12000.00',
        platform_fee: '361.00',
        contractor_payout: '11639.00',
        homeowner_escrow: '12361.00',
        rate: 0.03,
        is_intro: false,
        tier_name: 'starter',
        high_risk_applied: false,
      }),
    });
  });

  await page.route('**/api/projects/warranties/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/api/projects/agreements/321/subcontractor-invitations/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        agreement_id: AGREEMENT_ID,
        pending_invitations: [],
        accepted_subcontractors: [
          {
            id: 77,
            invite_email: 'accepted-sub@example.com',
            invite_name: 'Accepted Sub',
            accepted_name: 'Accepted Sub',
            accepted_at: '2026-03-23T12:00:00Z',
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/subaccounts/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route(`**/api/projects/milestones/${MILESTONE_ID}/approve-work/`, async (route) => {
    milestoneState.subcontractor_completion_status = 'approved';
    milestoneState.work_submission_status = 'approved';
    milestoneState.subcontractor_review_response_note = 'Approved for contractor closeout.';
    milestoneState.work_review_response_note = 'Approved for contractor closeout.';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(milestoneState),
    });
  });

  await page.route(`**/api/projects/milestones/${MILESTONE_ID}/send-back-work/`, async (route) => {
    milestoneState.subcontractor_completion_status = 'needs_changes';
    milestoneState.work_submission_status = 'needs_changes';
    milestoneState.subcontractor_review_response_note = 'Please rework the filler panel before resubmitting.';
    milestoneState.work_review_response_note = 'Please rework the filler panel before resubmitting.';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(milestoneState),
    });
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId(`milestone-completion-state-${MILESTONE_ID}`)).toContainText(
    'Submitted for review'
  );

  await page
    .getByTestId(`milestone-completion-response-note-${MILESTONE_ID}`)
    .fill('Approved for contractor closeout.');
  await page.getByTestId(`milestone-completion-approve-${MILESTONE_ID}`).click();
  await expect(page.getByTestId(`milestone-completion-state-${MILESTONE_ID}`)).toContainText(
    'Approved'
  );
  await expect(page.getByTestId(`milestone-card-${MILESTONE_ID}`)).toContainText(
    'Approved for contractor closeout.'
  );

  milestoneState.subcontractor_completion_status = 'submitted_for_review';
  milestoneState.work_submission_status = 'submitted_for_review';
  milestoneState.subcontractor_review_response_note = '';
  milestoneState.work_review_response_note = '';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page
    .getByTestId(`milestone-completion-response-note-${MILESTONE_ID}`)
    .fill('Please rework the filler panel before resubmitting.');
  await page.getByTestId(`milestone-completion-reject-${MILESTONE_ID}`).click();
  await expect(page.getByTestId(`milestone-completion-state-${MILESTONE_ID}`)).toContainText(
    'Needs changes'
  );
  await expect(page.getByTestId(`milestone-card-${MILESTONE_ID}`)).toContainText(
    'Please rework the filler panel before resubmitting.'
  );
});

test('agreement detail shows ready, paid, and failed subcontractor payout states', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  const milestoneState = {
    id: MILESTONE_ID,
    title: 'Cabinet Install',
    amount: '2500.00',
    status: 'pending',
    assigned_subcontractor_invitation: 77,
    assigned_subcontractor: {
      invitation_id: 77,
      user_id: 88,
      display_name: 'Accepted Sub',
      email: 'accepted-sub@example.com',
      accepted_at: '2026-03-23T12:00:00Z',
    },
    assigned_subcontractor_display: 'Accepted Sub',
    assigned_worker: {
      kind: 'subcontractor',
      user_id: 88,
      display_name: 'Accepted Sub',
      email: 'accepted-sub@example.com',
      invitation_id: 77,
    },
    assigned_worker_display: 'Accepted Sub',
    reviewer_display: 'Contractor Owner',
    reviewer: {
      kind: 'contractor_owner',
      display_name: 'Contractor Owner',
      email: 'playwright@myhomebro.local',
      is_delegated: false,
    },
    payout_amount: '1500.00',
    payout_status: 'ready_for_payout',
    payout_failure_reason: '',
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

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: AGREEMENT_ID,
        title: 'Kitchen Remodel Agreement',
        project_title: 'Kitchen Remodel Agreement',
        homeowner_name: 'Jordan Demo',
        homeowner_email: 'jordan@example.com',
        total_cost: '12000.00',
        payment_mode: 'escrow',
        status: 'signed',
        signed_by_contractor: true,
        signed_by_homeowner: true,
        escrow_funded: true,
        invoices: [],
        milestones: [milestoneState],
        pdf_versions: [],
      }),
    });
  });

  await page.route('**/api/projects/agreements/321/funding_preview/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project_amount: '12000.00',
        platform_fee: '361.00',
        contractor_payout: '11639.00',
        homeowner_escrow: '12361.00',
        rate: 0.03,
        is_intro: false,
        tier_name: 'starter',
        high_risk_applied: false,
      }),
    });
  });

  await page.route('**/api/projects/warranties/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/api/projects/agreements/321/subcontractor-invitations/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        agreement_id: AGREEMENT_ID,
        pending_invitations: [],
        accepted_subcontractors: [],
      }),
    });
  });

  await page.route('**/api/projects/subaccounts/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route(`**/api/projects/milestones/${MILESTONE_ID}/execute-subcontractor-payout/`, async (route) => {
    milestoneState.payout_status = 'paid';
    milestoneState.payout_paid_at = '2026-03-24T16:00:00Z';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(milestoneState),
    });
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}`, {
    waitUntil: 'domcontentloaded',
  });

  const milestoneCard = page.getByTestId(`milestone-card-${MILESTONE_ID}`);
  await expect(milestoneCard).toContainText('Payout: $1,500.00 (Ready for payout)');
  await expect(page.getByTestId(`milestone-payout-execute-${MILESTONE_ID}`)).toBeVisible();

  await page.getByTestId(`milestone-payout-execute-${MILESTONE_ID}`).click();
  await expect(milestoneCard).toContainText('Payout: $1,500.00 (Paid)');

  milestoneState.payout_status = 'failed';
  milestoneState.payout_failure_reason = 'Transfer failed at Stripe.';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(milestoneCard).toContainText('Payout: $1,500.00 (Failed)');
  await expect(milestoneCard).toContainText('Transfer failed at Stripe.');
});
