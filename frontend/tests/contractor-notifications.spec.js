import { expect, test } from '@playwright/test';

function isoDateOffset(days) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + days);
  return value.toISOString();
}

const agreements = [
  {
    id: 321,
    title: 'Kitchen Remodel Agreement',
    project_title: 'Kitchen Remodel Agreement',
    status: 'draft',
    total_amount: 8400,
    signature_is_satisfied: false,
    is_fully_signed: false,
  },
  {
    id: 777,
    title: 'Waiting Funding Project',
    project_title: 'Waiting Funding Project',
    status: 'signed',
    signature_is_satisfied: true,
    is_fully_signed: true,
    escrow_funded: false,
    payment_mode: 'escrow',
    due_date: isoDateOffset(2),
  },
];

const milestones = [
  {
    id: 98,
    title: 'Paint Prep',
    agreement: 321,
    agreement_id: 321,
    agreement_title: 'Kitchen Remodel Agreement',
    status: 'submitted',
    submitted_at: '2026-03-24T10:00:00Z',
    amount: 1200,
    due_date: isoDateOffset(0),
  },
];

const invoices = [
  { id: 1, amount: 1200, status: 'pending_approval' },
  { id: 2, amount: 900, status: 'approved' },
  { id: 3, amount: 450, status: 'disputed' },
];

async function installDashboardMocks(page, overrides = {}) {
  const data = {
    agreements,
    milestones,
    invoices,
    nextBestAction: {
      action_type: 'send_first_agreement',
      title: 'Send your next agreement',
      message: 'You already have a draft agreement ready for review and sending.',
      cta_label: 'Open draft',
      navigation_target: '/app/agreements/321/wizard?step=1',
      rationale: 'Draft agreements create the fastest path to homeowner action and funding.',
    },
    ...overrides,
  };

  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
    window.sessionStorage.clear();
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
        review_queue_count: 1,
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

  await page.route('**/api/projects/contractors/onboarding/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        required_onboarding_complete: true,
        step: 'complete',
        business_name: 'Playwright Contracting Co',
        trade_count: 1,
        service_region_label: 'Austin, TX',
      }),
    });
  });

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        contractor_onboarding_status: 'complete',
        business_name: 'Playwright Contracting Co',
        city: 'Austin',
        state: 'TX',
        skills: ['Remodeling'],
        stripe_ready: true,
        payouts_enabled: true,
        onboarding: {
          status: 'complete',
          stripe_ready: true,
          first_value_reached: true,
        },
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: data.agreements }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: data.milestones }),
    });
  });

  await page.route(/\/api\/projects\/invoices\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: data.invoices }),
    });
  });

  await page.route(/\/api\/projects\/expense-requests\/?.*$/, async (route) => {
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
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/contractor-opportunities/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/contractor-activation-summary/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ guide_sections: {} }),
    });
  });

  await page.route('**/api/projects/activity-feed/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 'activity-1',
            title: 'Paint Prep is waiting for approval',
            message: 'Submitted work needs review.',
            cta_label: 'Open milestone',
          },
        ],
        next_best_action: data.nextBestAction,
      }),
    });
  });

  await page.route('**/api/projects/contractor/payout-history/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        summary: { payout_count: 0, total_paid_out: 0, total_platform_fees_retained: 0 },
        results: [],
      }),
    });
  });

  await page.route('**/api/projects/draw-requests/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });
}

test('contractor dashboard loads current notification, priority, and pipeline surfaces', async ({ page }) => {
  test.setTimeout(60_000);
  await installDashboardMocks(page);

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByTestId('dashboard-workspace-header')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toHaveCount(1);
  const header = page.getByTestId('global-header-actions');
  const launcher = page.getByRole('button', { name: 'Open Project Assistant' });
  await expect(header).toBeVisible();
  await expect(launcher).toBeVisible();
  await expect(launcher).toHaveCount(1);
  await expect(launcher).toHaveAttribute('title', 'Project Assistant');
  await expect(launcher).toHaveAttribute('aria-expanded', 'false');
  await expect(launcher).not.toHaveCSS('position', 'fixed');
  await expect
    .poll(() => header.locator('button').evaluateAll((buttons) => buttons.map((button) => button.dataset.testid).filter((testId) => [
      'assistant-dock-open-button',
      'appearance-menu-trigger',
      'notifications-bell-button',
    ].includes(testId))))
    .toEqual(['assistant-dock-open-button', 'appearance-menu-trigger', 'notifications-bell-button']);
  expect(await page.locator('button').evaluateAll((buttons) => buttons.filter((button) => {
    const style = window.getComputedStyle(button);
    return button.textContent?.trim() === 'Project Assistant' && style.position === 'fixed' && button.getBoundingClientRect().bottom > window.innerHeight / 2;
  }).length)).toBe(0);
  await page.screenshot({ path: 'test-results/dashboard-assistant-header-desktop.png', fullPage: true });
  await launcher.click();
  await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();
  await page.getByTestId('assistant-desktop-dock-close').click();
  await expect(launcher).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(launcher).toHaveCSS('width', '44px');
  await expect(launcher).toHaveCSS('height', '44px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await launcher.click();
  await expect(page.getByTestId('assistant-mobile-sheet')).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard-assistant-header-mobile-390.png', fullPage: true });
  await expect(page.getByTestId('dashboard-quick-actions-row')).toContainText('Quick Actions');
  await expect(page.getByTestId('dashboard-next-actions')).toContainText("Today's Priorities");
  await expect(page.getByTestId('dashboard-priority-count')).toBeVisible();
  await expect(page.getByText('Work Pipeline').first()).toBeVisible();
  await expect(page.getByTestId('dashboard-money-pipeline')).toBeVisible();
  await expect(page.getByTestId('dashboard-opportunity-metric-open')).toBeVisible();
});

test('dashboard contextual Assistant priority remains distinct from the global header launcher', async ({ page }) => {
  await installDashboardMocks(page, {
    nextBestAction: {
      action_type: 'start_with_assistant',
      title: 'Start your next agreement',
      message: 'Use Project Assistant to prepare the next draft.',
      cta_label: 'Project Assistant',
      navigation_target: '/app/assistant',
    },
  });
  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('global-header-actions').getByRole('button', { name: 'Open Project Assistant' })).toHaveCount(1);
  await expect(page.getByTestId('dashboard-next-actions').getByText('Project Assistant', { exact: true })).toHaveCount(1);
});

test('contractor dashboard renders current quick actions and workflow entry points', async ({ page }) => {
  await installDashboardMocks(page);

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  const quickActions = page.getByTestId('dashboard-quick-actions-row');
  await expect(quickActions.getByRole('button', { name: /Create Estimate/ })).toBeVisible();
  await expect(quickActions.getByRole('button', { name: 'New Agreement', exact: true })).toBeVisible();
  await expect(quickActions.getByRole('button', { name: "Today's Schedule", exact: true })).toBeVisible();
  await expect(quickActions.getByRole('button', { name: 'Expense', exact: true })).toBeVisible();
  await expect(quickActions.getByRole('button', { name: 'Payment', exact: true })).toBeVisible();
});

test('contractor dashboard surfaces backend priority action in the current priorities panel', async ({ page }) => {
  await installDashboardMocks(page);

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  const priorities = page.getByTestId('dashboard-next-actions');
  await expect(priorities).toContainText('Send your next agreement');
  await expect(priorities).toContainText('Open draft');
  await expect(priorities).toContainText('Resolve payment issues');
  await page.getByTestId('dashboard-next-action-button-next-best:send_first_agreement').click();
  await expect(page).toHaveURL(/\/app\/agreements\/321\/wizard\?step=1/);
});

test('contractor sidebar uses current IA and Phase 2 terminology', async ({ page }) => {
  await installDashboardMocks(page);

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  const sidebar = page.locator('aside');
  await expect(sidebar).toContainText('Main');
  await expect(sidebar).toContainText('Operations');
  await expect(sidebar).toContainText('Customers & Team');
  await expect(sidebar).toContainText('Finance');
  await expect(sidebar).toContainText('Tools');
  await expect(sidebar).toContainText('Estimates');
  await expect(sidebar).toContainText('Insights');
  await expect(sidebar).toContainText('Marketing');
  await expect(sidebar).toContainText('Resolution');
  await expect(sidebar).not.toContainText('Business Dashboard');
  await expect(sidebar).not.toContainText('Public Presence');
  await expect(sidebar).not.toContainText('AI Workspace');
});

test('desktop contractor sidebar navigation stays stable for core work routes', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await installDashboardMocks(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  const sidebar = page.locator('aside');
  await expect(sidebar.locator('a[href="/app/agreements"]').first()).toBeVisible();
  await expect(sidebar.locator('a[href="/app/milestones"]').first()).toBeVisible();
  await expect(sidebar.locator('a[href="/app/business"]').first()).toContainText('Insights');

  await sidebar.locator('a[href="/app/agreements"]').first().click();
  await expect(page).toHaveURL(/\/app\/agreements\/?(?:\?.*)?$/);
  await expect(page.getByRole('heading', { name: 'Agreements' })).toBeVisible();

  await sidebar.locator('a[href="/app/milestones"]').first().click();
  await expect(page).toHaveURL(/\/app\/milestones\/?(?:\?.*)?$/);
  await expect(page.getByText('Kitchen Remodel Agreement').first()).toBeVisible();

  expect(pageErrors, `Unexpected page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});
