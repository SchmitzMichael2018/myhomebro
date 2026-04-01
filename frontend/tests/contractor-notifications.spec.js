import { expect, test } from '@playwright/test';

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

  await page.route(/\/api\/projects\/agreements\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: agreements }),
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

  await expect(page.getByRole('button', { name: 'Start with AI', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Agreement', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Intake', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Milestone', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expenses', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invoices', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Disputes', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toBeVisible();

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
      action_type: 'resume_onboarding',
      title: 'Finish onboarding',
      message: 'Complete your setup so MyHomeBro can tailor templates, pricing, and payment guidance.',
      cta_label: 'Resume onboarding',
      navigation_target: '/app/onboarding',
      rationale: 'Setup completion unlocks better guidance.',
    },
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('dashboard-next-best-action')).toContainText('Onboarding Complete');
  await expect(page.getByTestId('dashboard-next-best-action')).toContainText(
    "Stripe and profile setup are ready. Start your first project and I'll walk you through it."
  );
  await expect(page.getByTestId('dashboard-next-best-action')).toContainText('Start your first project');
  await expect(page.getByTestId('dashboard-next-best-action')).not.toContainText('Finish onboarding');
  await expect(page.getByTestId('dashboard-next-best-action')).not.toContainText('Resume onboarding');
});
