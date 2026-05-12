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
  const reviewQueueCount = options.reviewQueueCount || 0;
  const payoutHistorySummary = options.payoutHistorySummary || { payout_count: 0, total_paid_out: 0, total_platform_fees_retained: 0 };
  const payoutHistoryRecent = options.payoutHistoryRecent || [];

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
        review_queue_count: reviewQueueCount,
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

  await page.route(/\/api\/projects\/milestones\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: milestones }),
    });
  });

  await page.route(/\/api\/projects\/invoices\/?(?:\?.*)?$/, async (route) => {
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

  await page.route('**/api/projects/contractor/payout-history/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        summary: payoutHistorySummary,
        results: payoutHistoryRecent,
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

  await expect(page.getByText('$1,200.00')).toBeVisible();
  await expect(page.getByText('$900.00')).toBeVisible();
  await expect(page.getByText('$450.00')).toBeVisible();

  await expect(page.getByTestId('dashboard-next-best-action')).toContainText(
    'Send your next agreement'
  );
  await expect(page.getByTestId('dashboard-next-best-action')).toContainText('Open draft');
  await expect(page.getByTestId('dashboard-next-actions')).toBeVisible();
  await expect(page.getByTestId('dashboard-next-actions')).toContainText('Open draft');
  await expect(page.getByTestId('dashboard-next-actions')).toContainText('Review payment requests');
  await page.getByTestId('dashboard-next-actions').getByRole('button', { name: 'Open draft' }).click();
  await expect(page).toHaveURL(/\/app\/agreements\/321\/wizard\?step=1/);
});

test('contractor dashboard surfaces recommended project matches with compatibility reasons', async ({
  page,
}) => {
  await mockContractorDashboard(page, {
    publicLeads: [
      {
        id: 11,
        source: 'public_profile',
        full_name: 'Casey Prospect',
        project_type: 'Kitchen Remodel',
        project_description: 'Need help finishing a kitchen project with homeowner participation.',
        ai_analysis: {
          project_mode: 'assisted_diy',
          project_scope_summary: 'Collaborative kitchen remodel with milestone payments.',
          payment_preference: 'escrow',
        },
        matching: {
          tier: 'Strong Match',
          score: 91,
          summary: 'Strong fit for this project and working style.',
          badges: ['DIY Assistance Available', 'Escrow Friendly'],
          reasons: ['Offers Assisted DIY support.', 'Accepts escrow milestone payments.'],
        },
      },
      {
        id: 12,
        source: 'public_profile',
        full_name: 'Jordan Rescue',
        project_type: 'Bathroom Rescue',
        project_description: 'Need help finishing a project already started.',
        ai_analysis: {
          project_mode: 'consultation',
          project_scope_summary: 'Partial-completion rescue project.',
          payment_preference: 'escrow',
        },
        matching: {
          tier: 'Good Match',
          score: 68,
          summary: 'Good fit with a few considerations to confirm.',
          badges: ['Rescue Project Assistance'],
          reasons: ['Supports rescue or finish-my-project work.'],
        },
      },
    ],
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('dashboard-recommended-project-matches')).toBeVisible();
  await expect(page.getByTestId('dashboard-recommended-project-matches')).toContainText('Strong Matches');
  await expect(page.getByTestId('dashboard-recommended-project-matches')).toContainText('Assisted DIY');
  await expect(page.getByTestId('dashboard-recommended-project-matches')).toContainText('Rescue Projects');
  await expect(page.getByTestId('dashboard-recommended-project-matches')).toContainText('Escrow Compatible');
  await expect(page.getByTestId('dashboard-recommended-project-matches')).toContainText('Why this project matches you');
  await expect(page.getByTestId('dashboard-recommended-project-matches')).toContainText('Offers Assisted DIY support.');
  await expect(page.getByTestId('dashboard-recommended-project-matches')).toContainText('Accepts escrow milestone payments.');
});

test('contractor dashboard keeps project modes compact while preserving guardrail chips and drilldowns', async ({
  page,
}) => {
  await mockContractorDashboard(page, {
    agreements: [
      {
        id: 201,
        title: 'Full Service Kitchen',
        project_title: 'Full Service Kitchen',
        status: 'signed',
        project_mode: 'full_service',
        payment_protection: { level: 'preferred' },
      },
      {
        id: 202,
        title: 'Assisted DIY Deck',
        project_title: 'Assisted DIY Deck',
        status: 'signed',
        project_mode: 'assisted_diy',
        homeowner_started_work: false,
        payment_protection: { level: 'recommended' },
      },
      {
        id: 203,
        title: 'Consultation Visit',
        project_title: 'Consultation Visit',
        status: 'draft',
        project_mode: 'consultation',
        payment_protection: { level: 'preferred' },
      },
      {
        id: 204,
        title: 'Inspection Only Review',
        project_title: 'Inspection Only Review',
        status: 'draft',
        project_mode: 'inspection_only',
        payment_protection: { level: 'required' },
      },
    ],
    milestones: [
      {
        id: 301,
        title: 'Licensed Panel Tie-In',
        milestone_role: 'contractor_task',
        project_mode: 'assisted_diy',
        milestone_safety_labels: ['Licensed Trade Work', 'Contractor Required'],
        subcontractor_review_requested: true,
      },
      {
        id: 302,
        title: 'Inspection Checkpoint',
        milestone_role: 'inspection_checkpoint',
        project_mode: 'inspection_only',
        milestone_safety_labels: ['Inspection Recommended'],
        inspection_status: 'inspection_requested',
      },
      {
        id: 303,
        title: 'Punch List',
        milestone_role: 'inspection_checkpoint',
        project_mode: 'inspection_only',
        milestone_safety_labels: ['Inspection Recommended'],
        inspection_status: 'inspection_revision_required',
      },
      {
        id: 304,
        title: 'Shared Cleanup',
        milestone_role: 'shared_task',
        project_mode: 'assisted_diy',
        milestone_safety_labels: [],
      },
      {
        id: 305,
        title: 'Homeowner Prep',
        milestone_role: 'homeowner_task',
        project_mode: 'assisted_diy',
        milestone_safety_labels: [],
      },
    ],
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  const context = page.getByTestId('dashboard-project-context');
  await expect(context).toBeVisible();
  await expect(context).toContainText('Full Service');
  await expect(context).toContainText('Assisted DIY');
  await expect(context).toContainText('Consultation');
  await expect(context).toContainText('Inspection Only');
  await expect(page.getByTestId('dashboard-guardrail-escrow-preferred')).toBeVisible();
  await expect(page.getByTestId('dashboard-guardrail-escrow-recommended')).toBeVisible();
  await expect(page.getByTestId('dashboard-guardrail-escrow-required')).toBeVisible();
  await expect(page.getByText('Collaborative Workflow')).toHaveCount(0);
  await expect(page.getByText('Project Modes')).toHaveCount(0);
  await expect(page.getByText('Waiting on Homeowner')).toHaveCount(0);

  await page.getByTestId('dashboard-project-mode-assisted-diy').click();
  await expect(page).toHaveURL(/\/app\/milestones\?project_mode=assisted_diy&filter=incomplete/);
});

test('contractor dashboard project context remains readable on smaller screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await mockContractorDashboard(page, {
    agreements: [
      {
        id: 777,
        title: 'Compact Project',
        project_title: 'Compact Project',
        status: 'draft',
        signature_is_satisfied: true,
        is_fully_signed: true,
        project_mode: 'assisted_diy',
        payment_preference: 'escrow_recommended',
      },
    ],
    milestones: [
      {
        id: 411,
        title: 'Homeowner Prep',
        agreement_id: 777,
        agreement: { id: 777, title: 'Compact Project', project_class: 'residential' },
        status: 'planned',
        project_mode: 'assisted_diy',
        milestone_role: 'homeowner_task',
        milestone_safety_labels: [],
      },
    ],
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  const context = page.getByTestId('dashboard-project-context');
  await expect(context).toBeVisible();
  await expect(context).toContainText('Mode Filters');
  await expect(context).toContainText('Payment Protection');
  await expect(page.getByTestId('dashboard-project-mode-assisted-diy')).toBeVisible();
  await page.getByTestId('dashboard-project-mode-assisted-diy').click();
  await expect(page).toHaveURL(/\/app\/milestones\?project_mode=assisted_diy&filter=incomplete/);
});

test('contractor dashboard keeps the review queue next action visible while submitted work remains', async ({
  page,
}) => {
  let milestones = [
    {
      id: 101,
      title: 'Cabinet Install',
      agreement_id: 654,
      agreement: { id: 654, title: 'Kitchen Remodel', project_class: 'residential' },
      status: 'submitted',
      submitted_at: '2026-03-24T10:00:00Z',
    },
    {
      id: 102,
      title: 'Trim Finish',
      agreement_id: 654,
      agreement: { id: 654, title: 'Kitchen Remodel', project_class: 'residential' },
      status: 'submitted',
      submitted_at: '2026-03-24T11:00:00Z',
    },
  ];

  await mockContractorDashboard(page, {
    agreements: [
      {
        id: 654,
        title: 'Kitchen Remodel',
        project_title: 'Kitchen Remodel',
        status: 'draft',
        signature_is_satisfied: true,
        is_fully_signed: true,
      },
    ],
    milestones,
    reviewQueueCount: 2,
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  const reviewAction = page.getByTestId('dashboard-next-action-item-milestone-submitted-review');
  await expect(reviewAction).toBeVisible();
  await expect(reviewAction).toContainText('2 milestones are waiting for review.');
  await reviewAction.click();
  await expect(page).toHaveURL(/\/app\/reviewer\/queue/);
});

test('contractor dashboard does not surface payout history in next actions', async ({ page }) => {
  await mockContractorDashboard(page, {
    agreements: [
      {
        id: 321,
        title: 'Kitchen Remodel',
        project_title: 'Kitchen Remodel',
        status: 'draft',
        signature_is_satisfied: true,
        is_fully_signed: true,
      },
    ],
    invoices: [
      {
        id: 1,
        amount: 950,
        status: 'pending_approval',
      },
    ],
    payoutHistorySummary: {
      payout_count: 4,
      total_paid_out: 4800,
      total_platform_fees_retained: 160,
    },
    payoutHistoryRecent: [
      { id: 1, label: 'Completed payout' },
    ],
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('dashboard-next-actions')).toContainText('Review payment requests');
  await expect(page.getByTestId('dashboard-next-actions')).not.toContainText('Review payout history');
  await expect(page.getByTestId('dashboard-next-actions')).not.toContainText('View payout history');
  await expect(page.getByTestId('dashboard-next-action-item-payout-history')).toHaveCount(0);
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
  await expect(page.getByTestId('dashboard-next-actions')).toContainText('Paint Prep is waiting for approval');
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
  await expect(sidebar).toContainText('ACCOUNT');
  await expect(sidebar).toContainText('Dashboard');
  await expect(sidebar).toContainText('Ask AI');
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
  await expect(sidebar).toContainText('Support');

  const profileLink = sidebar.locator('a[href="/app/profile"]').first();
  const stripeLink = sidebar.locator('a[href="/app/onboarding/stripe"]').first();
  const supportLink = sidebar.locator('a[href="/app/support"]').first();

  const profileBox = await profileLink.boundingBox();
  const stripeBox = await stripeLink.boundingBox();
  const supportBox = await supportLink.boundingBox();

  expect(profileBox?.y).toBeLessThan(stripeBox?.y);
  expect(stripeBox?.y).toBeLessThan(supportBox?.y);
});

test('desktop contractor sidebar stays full-height and scrollable on dashboard and agreements routes', async ({
  page,
}) => {
  await mockContractorDashboard(page, {
    agreements: [
      {
        id: 321,
        title: 'Kitchen Remodel Agreement',
        project_title: 'Kitchen Remodel',
        status: 'draft',
        due_date: isoDateOffset(2),
      },
    ],
  });

  await page.setViewportSize({ width: 1440, height: 900 });

  for (const path of ['/app/dashboard', '/app/agreements']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    const sidebar = page.locator('aside');
    const main = page.locator('main').first();
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toContainText('Dashboard');

    const styles = await sidebar.evaluate((el) => ({
      overflowY: getComputedStyle(el).overflowY,
      flexShrink: getComputedStyle(el).flexShrink,
      height: el.getBoundingClientRect().height,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));

    expect(styles.overflowY).toBe('auto');
    expect(styles.flexShrink).toBe('0');
    expect(styles.height).toBeGreaterThanOrEqual(899);

    const mainStyles = await main.evaluate((el) => ({
      overflowY: getComputedStyle(el).overflowY,
      height: el.getBoundingClientRect().height,
    }));

    expect(mainStyles.overflowY).toBe('auto');
    expect(mainStyles.height).toBeGreaterThanOrEqual(899);
  }
});

test('desktop contractor sidebar hover and click navigation stays stable', async ({
  page,
}) => {
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'failed'}`);
  });

  await mockContractorDashboard(page, {
    agreements: [
      {
        id: 321,
        title: 'Kitchen Remodel Agreement',
        project_title: 'Kitchen Remodel',
        status: 'draft',
        total_amount: 8400,
      },
    ],
    milestones: [
      {
        id: 98,
        title: 'Paint Prep',
        agreement: 321,
        agreement_title: 'Kitchen Remodel Agreement',
        status: 'submitted',
      },
    ],
    invoices: [
      {
        id: 1,
        amount: 1200,
        status: 'pending_approval',
      },
    ],
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  const sidebar = page.locator('aside');
  const agreementsLink = sidebar.locator('a[href="/app/agreements"]').first();
  const milestonesLink = sidebar.locator('a[href="/app/milestones"]').first();

  await expect(agreementsLink).toBeVisible();
  await expect(milestonesLink).toBeVisible();
  await expect(agreementsLink).toHaveAttribute('href', '/app/agreements');
  await expect(milestonesLink).toHaveAttribute('href', '/app/milestones');

  await agreementsLink.hover();
  await expect(
    page.locator('body > [role="tooltip"]').filter({
      hasText: 'Create and manage project agreements, signatures, and funding',
    })
  ).toBeVisible();

  await agreementsLink.click();
  await expect(page).toHaveURL(/\/app\/agreements\/?(?:\?.*)?$/);
  await expect(page.getByRole('heading', { name: 'Agreements' })).toBeVisible();

  await milestonesLink.click();
  await expect(page).toHaveURL(/\/app\/milestones\/?(?:\?.*)?$/);
  await expect(page.getByText('Agreement #')).toBeVisible();
  await expect(page.getByText('Kitchen Remodel')).toBeVisible();

  expect(pageErrors, `Unexpected page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  expect(failedRequests, `Unexpected failed requests: ${failedRequests.join(' | ')}`).toEqual([]);
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

test('agreement and milestone lists filter by project class and show project type badges', async ({ page }) => {
  await mockContractorDashboard(page, {
    reviewQueueCount: 4,
    agreements: [
      {
        id: 1101,
        title: 'Residential Kitchen',
        project_title: 'Residential Kitchen',
        status: 'draft',
        project_class: 'residential',
      },
      {
        id: 1102,
        title: 'Commercial Lobby',
        project_title: 'Commercial Lobby',
        status: 'draft',
        project_class: 'commercial',
      },
    ],
    milestones: [
      {
        id: 2101,
        title: 'Demo Phase',
        description: 'Residential demo work.',
        agreement_id: 1101,
        agreement: {
          id: 1101,
          title: 'Residential Kitchen',
          project_class: 'residential',
        },
      },
      {
        id: 2102,
        title: 'Signage Review',
        description: 'Commercial review work.',
        agreement_id: 1102,
        agreement: {
          id: 1102,
          title: 'Commercial Lobby',
          project_class: 'commercial',
        },
      },
    ],
  });

  await page.goto('/app/agreements', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('link', { name: 'Awaiting Review 4' })).toBeVisible();
  await expect(page.getByTestId('agreement-list-project-class-filter')).toBeVisible();
  await expect(page.getByTestId('agreement-project-class-1101')).toContainText('Residential');
  await expect(page.getByTestId('agreement-project-class-1102')).toContainText('Commercial');

  await page.getByTestId('agreement-list-project-class-filter').selectOption('commercial');
  await expect(page.getByTestId('agreement-project-class-1102')).toBeVisible();
  await expect(page.getByTestId('agreement-project-class-1101')).toHaveCount(0);

  await page.goto('/app/milestones?project_class=commercial', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('link', { name: 'Awaiting Review 4' })).toBeVisible();
  await expect(page.getByTestId('milestone-list-project-class-filter')).toHaveValue('commercial');
  await expect(page.getByText('Commercial Lobby', { exact: true }).first()).toBeVisible();
  await page.getByText('Commercial Lobby', { exact: true }).first().click();
  await expect(page.getByTestId('milestone-project-class-2102')).toContainText('Commercial');

  await page.goto('/app/milestones?project_class=residential', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('milestone-list-project-class-filter')).toHaveValue('residential');
  await expect(page.getByText('Residential Kitchen', { exact: true }).first()).toBeVisible();
  await page.getByText('Residential Kitchen', { exact: true }).first().click();
  await expect(page.getByTestId('milestone-project-class-2101')).toContainText('Residential');
});
