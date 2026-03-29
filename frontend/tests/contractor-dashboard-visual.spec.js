import { test } from '@playwright/test';

async function mockContractorDashboard(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'visual-qa-access-token');
  });

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 7,
        type: 'contractor',
        role: 'contractor_owner',
        email: 'visualqa@myhomebro.local',
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
        onboarding: {
          status: 'active',
          first_value_reached: true,
          show_soft_stripe_prompt: false,
        },
      }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 41,
            title: 'Cabinet Install',
            agreement: 321,
            agreement_title: 'Kitchen Remodel Agreement',
            project_title: 'Kitchen Remodel',
            status: 'pending',
            completion_date: '2026-03-20T09:00:00Z',
            amount: 1200,
          },
          {
            id: 43,
            title: 'Paint Prep',
            agreement: 321,
            agreement_title: 'Kitchen Remodel Agreement',
            project_title: 'Kitchen Remodel',
            status: 'submitted',
            completion_date: '2026-03-24T11:00:00Z',
            amount: 900,
          },
          {
            id: 46,
            title: 'Final Paint',
            agreement: 654,
            agreement_title: 'Bath Remodel Agreement',
            project_title: 'Bath Remodel',
            status: 'submitted',
            completion_date: '2026-03-25T10:00:00Z',
            amount: 450,
          },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/invoices\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 1001, agreement: 321, amount: 1200, status: 'pending_approval' },
          { id: 1002, agreement: 654, amount: 900, status: 'approved' },
          { id: 1003, agreement: 777, amount: 450, status: 'disputed' },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 321,
            title: 'Kitchen Remodel Agreement',
            project_title: 'Kitchen Remodel',
            status: 'draft',
            contract_amount: 8400,
            escrow_funded: false,
          },
          {
            id: 654,
            title: 'Bath Remodel Agreement',
            project_title: 'Bath Remodel',
            status: 'signed',
            contract_amount: 6200,
            escrow_funded: false,
          },
        ],
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

  await page.route('**/api/projects/activity-feed/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [],
        next_best_action: {
          action_type: 'resume_draft',
          title: 'Finish your kitchen remodel agreement',
          message: 'Step 1 still needs customer details and final pricing before you send it.',
          cta_label: 'Open draft',
          navigation_target: '/app/agreements/321/wizard?step=1',
        },
      }),
    });
  });

  await page.route('**/api/projects/expense-requests/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });
}

test('capture contractor dashboard visual qa screenshots', async ({ page }) => {
  await mockContractorDashboard(page);
  await page.setViewportSize({ width: 1440, height: 1700 });
  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('dashboard-summary-bar').waitFor();

  await page.screenshot({
    path: 'test-results/visual-qa/contractor-dashboard-full.png',
    fullPage: true,
  });
  await page.getByTestId('dashboard-summary-bar').screenshot({
    path: 'test-results/visual-qa/contractor-dashboard-summary.png',
  });
  await page
    .locator('div')
    .filter({ has: page.getByTestId('dashboard-needs-attention') })
    .first()
    .screenshot({
      path: 'test-results/visual-qa/contractor-dashboard-focus.png',
    });
  await page.getByTestId('dashboard-active-work').screenshot({
    path: 'test-results/visual-qa/contractor-dashboard-active-work.png',
  });
  await page.locator('aside').screenshot({
    path: 'test-results/visual-qa/contractor-dashboard-sidebar.png',
  });
});
