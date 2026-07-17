import { expect, test } from '@playwright/test';

function installShellMocks(page) {
  return Promise.all([
    page.addInitScript(() => {
      window.localStorage.setItem('access', 'playwright-access-token');
    }),
    page.route('**/api/projects/whoami/', async (route) => {
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
    }),
    page.route('**/api/payments/onboarding/status/', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          onboarding_status: 'complete',
          connected: true,
        }),
      });
    }),
  ]);
}

const emptyDashboard = {
  metrics: {
    active_warranties: 0,
    open_warranty_requests: 0,
    repairs_scheduled: 0,
    expiring_soon: 0,
  },
  requests: [],
  warranties: [],
};

const populatedDashboard = {
  metrics: {
    active_warranties: 2,
    open_warranty_requests: 1,
    repairs_scheduled: 1,
    expiring_soon: 1,
  },
  warranties: [
    {
      id: 901,
      agreement: 321,
      title: '12-Month Workmanship Warranty',
      customer_name: 'Jordan Demo',
      agreement_title: 'Kitchen Remodel Agreement',
      coverage_details: 'Covers workmanship defects for cabinet installation and trim finishing.',
      start_date: '2026-03-01',
      end_date: '2026-08-01',
      status: 'active',
      applies_to: 'workmanship',
      open_request_count: 1,
    },
    {
      id: 902,
      agreement: 322,
      title: 'Fixture Finish Warranty',
      customer_name: 'Taylor Demo',
      agreement_title: 'Bathroom Refresh Agreement',
      coverage_details: 'Covers fixture finish issues tied to installation.',
      start_date: '2026-02-01',
      end_date: '2027-02-01',
      status: 'active',
      applies_to: 'materials',
      open_request_count: 0,
    },
  ],
  requests: [
    {
      id: 701,
      warranty: 901,
      title: 'Cabinet trim separating',
      description: 'Customer reports trim separating near the sink base.',
      status: 'submitted',
      severity: 'medium',
      customer_name: 'Jordan Demo',
      agreement_title: 'Kitchen Remodel Agreement',
      area_affected: 'Kitchen',
      created_at: '2026-07-15T15:00:00Z',
      date_noticed: '2026-07-14',
      evidence: [{ id: 1 }],
      next_expected_action: 'Review customer photos and schedule inspection.',
    },
    {
      id: 702,
      warranty: 901,
      title: 'Return visit scheduled',
      description: 'Repair visit is scheduled for next week.',
      status: 'repair_scheduled',
      severity: 'low',
      customer_name: 'Jordan Demo',
      agreement_title: 'Kitchen Remodel Agreement',
      area_affected: 'Kitchen',
      created_at: '2026-07-12T15:00:00Z',
      date_noticed: '2026-07-11',
      evidence: [],
      next_expected_action: 'Complete repair work.',
      work_order: {
        assigned_user: 12,
        assigned_team_notes: 'Lead tech',
        scheduled_for: '2026-07-22T14:00:00Z',
      },
    },
  ],
};

test('contractor warranties renders compact zero-data operations layout', async ({ page }) => {
  await installShellMocks(page);
  await page.route('**/api/projects/warranty/dashboard/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyDashboard),
    });
  });

  await page.goto('/app/warranties', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Warranties' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  await expect(page.getByTestId('warranty-dashboard')).toBeVisible();
  await expect(page.locator('.mhb-operational-surface').getByTestId('warranty-dashboard')).toBeVisible();
  await expect(page.getByTestId('warranty-metrics')).toContainText('Active Coverage');
  await expect(page.getByTestId('warranty-metrics')).toContainText('Requests Needing Attention');
  await expect(page.getByTestId('warranty-metrics')).toContainText('Repairs Scheduled');
  await expect(page.getByTestId('warranty-metrics')).toContainText('Expiring in 30 Days');
  await expect(page.getByTestId('project-assistant-panel')).toContainText('Warranty Center is populated from completed projects');
  await expect(page.getByTestId('project-assistant-panel').getByRole('link', { name: 'View completed projects' })).toHaveAttribute('href', '/app/agreements');
  await expect(page.getByTestId('project-assistant-panel').getByRole('link', { name: 'Review warranty templates' })).toHaveAttribute('href', '/app/templates');
  await expect(page.getByPlaceholder('Search customer, project, or warranty issue')).toBeVisible();
  await expect(page.getByTestId('warranty-filter-toggle')).toBeVisible();
  await expect(page.getByTestId('warranty-advanced-filters')).toBeHidden();

  await expect(page.getByTestId('warranty-tab-requests')).toContainText('0');
  await expect(page.getByTestId('warranty-empty-state')).toContainText('No warranty requests');
  await expect(page.getByTestId('warranty-empty-state')).toContainText('Customer requests will appear here after a completed project has active warranty coverage.');

  await page.getByTestId('warranty-tab-active').click();
  await expect(page.getByTestId('warranty-empty-state')).toContainText('No active warranties');

  await page.getByTestId('warranty-tab-repair').click();
  await expect(page.getByTestId('warranty-empty-state')).toContainText('No repair work scheduled');

  await page.getByTestId('warranty-tab-expiring').click();
  await expect(page.getByTestId('warranty-empty-state')).toContainText('No warranties expiring soon');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('warranty-tabbed-workspace')).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});

test('contractor warranties preserves counts, filters, records, and request actions', async ({ page }) => {
  await installShellMocks(page);
  await page.route('**/api/projects/warranty/dashboard/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(populatedDashboard),
    });
  });
  await page.route('**/api/projects/warranty-requests/*/ai-review/', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/app/warranties', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('warranty-metrics')).toContainText('2');
  await expect(page.getByTestId('warranty-metrics')).toContainText('1');
  await expect(page.getByTestId('warranty-tab-requests')).toContainText('2');
  await expect(page.getByTestId('warranty-tab-active')).toContainText('2');
  await expect(page.getByTestId('warranty-tab-repair')).toContainText('1');
  await expect(page.getByTestId('warranty-tab-expiring')).toContainText('1');
  await expect(page.getByTestId('warranty-request-701')).toContainText('Cabinet trim separating');
  await expect(page.getByTestId('warranty-request-701')).toContainText('Generate recommendation');
  await expect(page.getByTestId('warranty-request-701')).toContainText('Create Work Order');
  await expect(page.getByTestId('warranty-request-701')).toContainText('Complete');
  await expect(page.getByTestId('warranty-dashboard-filters')).toContainText('All statuses');

  await page.getByPlaceholder('Search customer, project, or warranty issue').fill('Return visit');
  await expect(page.getByTestId('warranty-request-702')).toContainText('Return visit scheduled');
  await expect(page.getByTestId('warranty-request-701')).toHaveCount(0);

  await page.getByPlaceholder('Search customer, project, or warranty issue').fill('');
  await page.getByTestId('warranty-tab-active').click();
  await expect(page.getByTestId('warranty-record-901')).toContainText('12-Month Workmanship Warranty');
  await expect(page.getByTestId('warranty-record-901')).toContainText('Agreement');

  await page.getByTestId('warranty-tab-repair').click();
  await expect(page.getByTestId('warranty-request-702')).toContainText('Return visit scheduled');

  await page.getByTestId('warranty-tab-expiring').click();
  await expect(page.getByTestId('warranty-record-901')).toContainText('12-Month Workmanship Warranty');
});
