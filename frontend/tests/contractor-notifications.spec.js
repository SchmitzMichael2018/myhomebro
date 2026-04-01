import { expect, test } from '@playwright/test';

function isoDateOffset(days) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + days);
  return value.toISOString();
}

function buildScheduleAgreements() {
  return [
    {
      id: 9001,
      title: 'Late Roof Repair',
      project_title: 'Late Roof Repair',
      status: 'draft',
      due_date: isoDateOffset(-1),
    },
    {
      id: 9002,
      title: 'Completed Old Job',
      project_title: 'Completed Old Job',
      status: 'completed',
      due_date: isoDateOffset(-2),
    },
    {
      id: 9003,
      title: 'Today Paint Prep',
      project_title: 'Today Paint Prep',
      status: 'signed',
      due_date: isoDateOffset(0),
    },
    {
      id: 9004,
      title: 'Tomorrow Tile Install',
      project_title: 'Tomorrow Tile Install',
      status: 'signed',
      due_date: isoDateOffset(1),
    },
    {
      id: 9005,
      title: 'Week Window Replacement',
      project_title: 'Week Window Replacement',
      status: 'signed',
      due_date: isoDateOffset(4),
    },
    {
      id: 9006,
      title: 'Far Future Project',
      project_title: 'Far Future Project',
      status: 'signed',
      due_date: isoDateOffset(12),
    },
  ];
}

async function mockContractorDashboard(page, options = {}) {
  const milestones = options.milestones || [];
  const agreements = options.agreements || [];
  const invoices = options.invoices || [];
  const publicLeads = options.publicLeads || [];
  const activityFeed = options.activityFeed || [];
  const nextBestAction = options.nextBestAction || null;
  const contractorMe = options.contractorMe || {};

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
        ...contractorMe,
      }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: milestones }),
    });
  });

  await page.route(/\/api\/projects\/invoices\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: invoices }),
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
      body: JSON.stringify({ results: agreements }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/\d+\/milestones\/?(?:\?.*)?$/, async (route) => {
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

  await page.route('**/api/projects/contractor/public-leads/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: publicLeads }),
    });
  });

  await page.route('**/api/projects/activity-feed/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: activityFeed,
        next_best_action: nextBestAction,
      }),
    });
  });
}

test('contractor dashboard shows money-first summary row and prioritized next actions', async ({
  page,
}) => {
  await mockContractorDashboard(page, {
    agreements: [
      { id: 321, title: 'Kitchen Remodel', project_title: 'Kitchen Remodel', status: 'draft' },
    ],
    invoices: [
      { id: 1, amount: 1200, status: 'pending_approval' },
      { id: 2, amount: 900, status: 'approved' },
      { id: 3, amount: 450, status: 'disputed' },
    ],
    nextBestAction: {
      action_type: 'send_first_agreement',
      title: 'Send your next agreement',
      message: 'You already have a draft agreement ready for review and sending.',
      cta_label: 'Open draft',
      navigation_target: '/app/agreements/321/wizard?step=1',
      rationale: 'Draft agreements create the fastest path to homeowner action and funding.',
    },
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Pending Approval', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Disputed', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Earned (YTD)', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('$1,200.00')).toBeVisible();
  await expect(page.getByText('$900.00')).toBeVisible();
  await expect(page.getByText('$450.00')).toBeVisible();

  await expect(page.getByTestId('dashboard-next-best-action')).toContainText(
    'Send your next agreement'
  );
  await expect(page.getByTestId('dashboard-next-best-action')).toContainText('Open draft');
});

test('contractor dashboard highlights overdue and waiting approval work with current guidance surfaces', async ({
  page,
}) => {
  await mockContractorDashboard(page, {
    activityFeed: [
      {
        id: 501,
        title: 'Cabinet Install is overdue',
        summary: 'Open milestone',
        severity: 'warning',
        navigation_target: '/app/milestones/41',
      },
      {
        id: 502,
        title: 'Paint Prep is waiting for approval',
        summary: 'Review milestone status',
        severity: 'warning',
        navigation_target: '/app/milestones/42',
      },
    ],
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('dashboard-needs-attention')).toContainText('No urgent items right now.');
  await expect(page.getByTestId('dashboard-activity-feed')).toContainText('Cabinet Install is overdue');
  await expect(page.getByTestId('dashboard-activity-feed')).toContainText('Paint Prep is waiting for approval');
  await expect(page.getByTestId('dashboard-activity-feed')).toContainText('Open milestone');
  await expect(page.getByTestId('dashboard-activity-feed')).toContainText('Review milestone status');
});

test('contractor dashboard renders current quick actions and workflow entry points', async ({
  page,
}) => {
  await mockContractorDashboard(page, {
    agreements: [
      {
        id: 321,
        title: 'Kitchen Remodel Agreement',
        project_title: 'Kitchen Remodel',
        status: 'draft',
        total_amount: 8400,
      },
      {
        id: 654,
        title: 'Bath Remodel Agreement',
        project_title: 'Bath Remodel',
        status: 'signed',
        total_amount: 5200,
        escrow_funded: false,
      },
    ],
    milestones: [
      {
        id: 98,
        title: 'Paint Prep',
        agreement: 654,
        agreement_title: 'Bath Remodel Agreement',
        status: 'submitted',
      },
    ],
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  const quickActions = page.getByTestId('dashboard-quick-actions-rail');
  await expect(quickActions.getByRole('button', { name: 'Start with AI', exact: true })).toBeVisible();
  await expect(quickActions.getByRole('button', { name: 'New Agreement', exact: true })).toBeVisible();
  await expect(quickActions.getByRole('button', { name: 'New Intake', exact: true })).toBeVisible();
  await expect(quickActions.getByRole('button', { name: 'New Milestone', exact: true })).toBeVisible();
  await expect(quickActions.getByRole('button', { name: 'Expenses', exact: true })).toBeVisible();
  await expect(quickActions.getByRole('button', { name: 'Invoices', exact: true })).toBeVisible();
  await expect(quickActions.getByRole('button', { name: 'Disputes', exact: true })).toBeVisible();
  await expect(quickActions.getByRole('button', { name: 'Calendar', exact: true })).toBeVisible();

  await expect(page.getByText('All Milestones')).toBeVisible();
  await expect(page.getByText('Ready to Invoice')).toBeVisible();
  await expect(page.getByText('Rework Work Orders')).toBeVisible();
});

test('contractor sidebar groups navigation into core work business and settings', async ({
  page,
}) => {
  await mockContractorDashboard(page);

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  const sidebar = page.locator('aside');
  await expect(sidebar).toContainText('Main');
  await expect(sidebar).toContainText('Account');
  await expect(sidebar).toContainText('Dashboard');
  await expect(sidebar).toContainText('Start with AI');
  await expect(sidebar).toContainText('Business Dashboard');
  await expect(sidebar).toContainText('Agreements');
  await expect(sidebar).toContainText('Milestones');
  await expect(sidebar).toContainText('Subcontractors');
  await expect(sidebar).toContainText('Invoices');
  await expect(sidebar).toContainText('Customers');
  await expect(sidebar).toContainText('Calendar');
  await expect(sidebar).toContainText('Expenses');
  await expect(sidebar).toContainText('Disputes');
  await expect(sidebar).toContainText('My Profile');
  await expect(sidebar).toContainText('Stripe Onboarding');
});

test('contractor dashboard suppresses stale onboarding hero copy after setup is complete', async ({
  page,
}) => {
  await mockContractorDashboard(page, {
    contractorMe: {
      business_name: 'Ready Contractor Co',
      city: 'Austin',
      state: 'TX',
      skills: ['Electrical'],
      payouts_enabled: true,
      onboarding: {
        status: 'complete',
        stripe_ready: true,
        first_value_reached: false,
      },
    },
    nextBestAction: {
      action_type: 'create_agreement',
      title: 'Start your next agreement',
      message: 'Use AI to quickly create your next project agreement.',
      cta_label: 'Start with AI',
      navigation_target: '/app/assistant',
      rationale: 'No blockers or active workflows were found.',
    },
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('dashboard-next-best-action')).toContainText('Start your next agreement');
  await expect(page.getByTestId('dashboard-next-best-action')).toContainText(
    'Use AI to quickly create your next project agreement.'
  );
  await expect(page.getByTestId('dashboard-next-best-action')).toContainText('Start with AI');
});

test('contractor dashboard hero CTA follows backend next best action targets', async ({ page }) => {
  await mockContractorDashboard(page, {
    nextBestAction: {
      action_type: 'review_pending_approvals',
      title: 'Review pending approvals',
      message: 'Items are waiting on your review or approval follow-through.',
      cta_label: 'View items',
      navigation_target: '/app/agreements?focus=needs_attention&filter=pending_approval',
    },
    agreements: [
      {
        id: 901,
        title: 'Pending Approval Agreement',
        project_title: 'Pending Approval Agreement',
        status: 'pending_approval',
        pending_approval_count: 1,
      },
    ],
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('dashboard-next-best-action')).toContainText('Review pending approvals');
  await page.getByTestId('dashboard-next-best-action').getByRole('button', { name: 'View items' }).click();
  await expect(page).toHaveURL(/\/app\/agreements\?focus=needs_attention&filter=pending_approval/);
  await expect(page.getByTestId('agreement-list-filter-banner')).toContainText('Filtered: Pending Approval');
});

test('clicking awaiting signature needs-attention item opens AgreementList filtered view', async ({
  page,
}) => {
  await mockContractorDashboard(page, {
    agreements: [
      {
        id: 321,
        title: 'Unsigned Kitchen Remodel',
        project_title: 'Unsigned Kitchen Remodel',
        status: 'draft',
        signature_is_satisfied: false,
        is_fully_signed: false,
        escrow_funded: false,
      },
      {
        id: 654,
        title: 'Funded Bath Remodel',
        project_title: 'Funded Bath Remodel',
        status: 'funded',
        signature_is_satisfied: true,
        is_fully_signed: true,
        escrow_funded: true,
      },
    ],
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('dashboard-needs-attention-item-awaiting_signature').click();

  await expect(page).toHaveURL(/\/app\/agreements\?focus=needs_attention&filter=awaiting_signature/);
  await expect(page.getByTestId('agreement-list-filter-banner')).toContainText(
    'Filtered: Awaiting Signature'
  );
  await expect(page.getByText('Unsigned Kitchen Remodel')).toBeVisible();
  await expect(page.getByText('Funded Bath Remodel')).not.toBeVisible();

  await page.getByTestId('agreement-list-filter-banner').getByRole('button', { name: 'Clear filter' }).click();
  await expect(page).toHaveURL(/\/app\/agreements$/);
  await expect(page.getByTestId('agreement-list-filter-banner')).toHaveCount(0);
});

test('clicking awaiting funding needs-attention item opens AgreementList filtered view', async ({
  page,
}) => {
  await mockContractorDashboard(page, {
    agreements: [
      {
        id: 777,
        title: 'Waiting Funding Project',
        project_title: 'Waiting Funding Project',
        status: 'signed',
        signature_is_satisfied: true,
        is_fully_signed: true,
        escrow_funded: false,
        payment_mode: 'escrow',
      },
      {
        id: 778,
        title: 'Direct Pay Project',
        project_title: 'Direct Pay Project',
        status: 'signed',
        signature_is_satisfied: true,
        is_fully_signed: true,
        escrow_funded: false,
        payment_mode: 'direct',
      },
    ],
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('dashboard-needs-attention-item-awaiting_funding').click();

  await expect(page).toHaveURL(/\/app\/agreements\?focus=needs_attention&filter=awaiting_funding/);
  await expect(page.getByTestId('agreement-list-filter-banner')).toContainText(
    'Filtered: Awaiting Funding'
  );
  await expect(page.getByText('Waiting Funding Project')).toBeVisible();
  await expect(page.getByText('Direct Pay Project')).not.toBeVisible();
});

test('clicking past due schedule card opens AgreementList late filter and reset clears it', async ({
  page,
}) => {
  await mockContractorDashboard(page, {
    agreements: buildScheduleAgreements(),
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await page.locator('[data-testid="dashboard-schedule-late"] [role="button"]').click();

  await expect(page).toHaveURL(/\/app\/agreements\?focus=schedule&range=late/);
  await expect(page.getByTestId('agreement-list-filter-banner')).toContainText(
    'Filtered: Past Due / Late'
  );
  await expect(page.getByText('Late Roof Repair')).toBeVisible();
  await expect(page.getByText('Completed Old Job')).not.toBeVisible();
  await expect(page.getByText('Today Paint Prep')).not.toBeVisible();

  await page.getByTestId('agreement-list-filter-banner').getByRole('button', { name: 'Clear filter' }).click();
  await expect(page).toHaveURL(/\/app\/agreements$/);
  await expect(page.getByTestId('agreement-list-filter-banner')).toHaveCount(0);
});

test('clicking due today schedule card opens AgreementList today filter', async ({ page }) => {
  await mockContractorDashboard(page, {
    agreements: buildScheduleAgreements(),
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await page.locator('[data-testid="dashboard-schedule-today"] [role="button"]').click();

  await expect(page).toHaveURL(/\/app\/agreements\?focus=schedule&range=today/);
  await expect(page.getByTestId('agreement-list-filter-banner')).toContainText('Filtered: Due Today');
  await expect(page.getByText('Today Paint Prep')).toBeVisible();
  await expect(page.getByText('Tomorrow Tile Install')).not.toBeVisible();
});

test('clicking due tomorrow schedule card opens AgreementList tomorrow filter', async ({ page }) => {
  await mockContractorDashboard(page, {
    agreements: buildScheduleAgreements(),
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await page.locator('[data-testid="dashboard-schedule-tomorrow"] [role="button"]').click();

  await expect(page).toHaveURL(/\/app\/agreements\?focus=schedule&range=tomorrow/);
  await expect(page.getByTestId('agreement-list-filter-banner')).toContainText('Filtered: Due Tomorrow');
  await expect(page.getByText('Tomorrow Tile Install')).toBeVisible();
  await expect(page.getByText('Today Paint Prep')).not.toBeVisible();
});

test('clicking this week schedule card opens AgreementList week filter', async ({ page }) => {
  await mockContractorDashboard(page, {
    agreements: buildScheduleAgreements(),
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await page.locator('[data-testid="dashboard-schedule-week"] [role="button"]').click();

  await expect(page).toHaveURL(/\/app\/agreements\?focus=schedule&range=week/);
  await expect(page.getByTestId('agreement-list-filter-banner')).toContainText('Filtered: This Week');
  await expect(page.getByText('Today Paint Prep')).toBeVisible();
  await expect(page.getByText('Tomorrow Tile Install')).toBeVisible();
  await expect(page.getByText('Week Window Replacement')).toBeVisible();
  await expect(page.getByText('Far Future Project')).not.toBeVisible();
});
