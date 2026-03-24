import { expect, test } from '@playwright/test';

test('business dashboard shows payout reporting and links to full history', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  let revenueExportCalled = false;
  let feeExportCalled = false;
  let payoutExportCalled = false;
  let jobsExportCalled = false;

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

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        created_at: '2026-03-01T10:00:00Z',
        auto_subcontractor_payouts_enabled: true,
        ai: {
          access: 'included',
          enabled: true,
          unlimited: true,
        },
      }),
    });
  });

  await page.route('**/api/projects/business/contractor/summary/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        snapshot: {
          jobs_completed: 4,
          active_jobs: 2,
          total_revenue: '12800.00',
          avg_revenue_per_job: '3200.00',
          avg_completion_days: '18.5',
          escrow_pending: '900.00',
          platform_fees_paid: '640.00',
          disputes_open: 0,
        },
        by_category: [],
      }),
    });
  });

  await page.route('**/api/projects/payouts/history/export/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/csv',
      body: 'agreement,milestone,subcontractor,amount,status,execution_mode,paid_at,failed_at,transfer_id,failure_reason\n',
    });
  });

  await page.route('**/api/projects/business-dashboard/export/revenue/**', async (route) => {
    revenueExportCalled = true;
    await route.fulfill({
      status: 200,
      contentType: 'text/csv',
      body: 'agreement,invoice,milestone,project_type,payment_mode,paid_at,gross_amount\n',
    });
  });

  await page.route('**/api/projects/business-dashboard/export/fees/**', async (route) => {
    feeExportCalled = true;
    await route.fulfill({
      status: 200,
      contentType: 'text/csv',
      body: 'agreement,invoice,project_type,paid_at,gross_amount,platform_fee_amount\n',
    });
  });

  await page.route('**/api/projects/business-dashboard/export/payouts/**', async (route) => {
    payoutExportCalled = true;
    await route.fulfill({
      status: 200,
      contentType: 'text/csv',
      body: 'agreement,milestone,subcontractor,amount,status,execution_mode,paid_at,failed_at,transfer_id,failure_reason\n',
    });
  });

  await page.route('**/api/projects/business-dashboard/export/jobs/**', async (route) => {
    jobsExportCalled = true;
    await route.fulfill({
      status: 200,
      contentType: 'text/csv',
      body: 'agreement,customer,project_type,project_subtype,status,start_date,end_date,completion_days,total_cost\n',
    });
  });

  await page.route('**/api/projects/payouts/history/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 1,
            agreement_id: 321,
            agreement_title: 'Kitchen Remodel Agreement',
            milestone_id: 901,
            milestone_title: 'Cabinet Install',
            subcontractor_display_name: 'Taylor Sub',
            subcontractor_email: 'taylor@example.com',
            payout_amount: '1500.00',
            payout_status: 'paid',
            execution_mode: 'manual',
            paid_at: '2026-03-21T11:00:00Z',
            ready_for_payout_at: '2026-03-20T10:00:00Z',
            failed_at: null,
          },
          {
            id: 2,
            agreement_id: 654,
            agreement_title: 'Bathroom Remodel Agreement',
            milestone_id: 902,
            milestone_title: 'Tile Work',
            subcontractor_display_name: 'Morgan Failed',
            subcontractor_email: 'morgan@example.com',
            payout_amount: '400.00',
            payout_status: 'failed',
            execution_mode: 'automatic',
            paid_at: null,
            ready_for_payout_at: '2026-03-23T09:00:00Z',
            failed_at: '2026-03-23T11:30:00Z',
          },
        ],
        summary: {
          total_paid_amount: '1500.00',
          total_ready_amount: '700.00',
          total_failed_amount: '400.00',
          total_pending_amount: '250.00',
          record_count: 4,
        },
      }),
    });
  });

  await page.goto('/app/business', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('dashboard-payouts-section')).toBeVisible();
  await expect(page.getByTestId('dashboard-payouts-section')).toContainText('Subcontractor Payouts');
  await expect(page.getByTestId('dashboard-payouts-section')).toContainText('$1,500.00');
  await expect(page.getByTestId('dashboard-payouts-section')).toContainText('$700.00');
  await expect(page.getByTestId('dashboard-payouts-section')).toContainText('$400.00');
  await expect(page.getByTestId('dashboard-payouts-section')).toContainText('$250.00');
  await expect(page.getByTestId('dashboard-payout-row-1')).toContainText('Taylor Sub');
  await expect(page.getByTestId('dashboard-payout-row-2')).toContainText('Morgan Failed');
  await expect(page.getByTestId('dashboard-payouts-export')).toBeVisible();
  await expect(page.getByTestId('dashboard-reports-exports-section')).toBeVisible();
  await expect(page.getByTestId('export-revenue-report')).toBeVisible();
  await expect(page.getByTestId('export-fee-report')).toBeVisible();
  await expect(page.getByTestId('export-payout-report')).toBeVisible();
  await expect(page.getByTestId('export-jobs-report')).toBeVisible();

  await page.getByTestId('export-revenue-report').click();
  await expect.poll(() => revenueExportCalled).toBe(true);
  await page.getByTestId('export-fee-report').click();
  await expect.poll(() => feeExportCalled).toBe(true);
  await page.getByTestId('export-payout-report').click();
  await expect.poll(() => payoutExportCalled).toBe(true);
  await page.getByTestId('export-jobs-report').click();
  await expect.poll(() => jobsExportCalled).toBe(true);

  await page.getByTestId('dashboard-payouts-full-history').click();
  await expect(page).toHaveURL(/\/app\/payouts\/history$/);
  await expect(page.getByTestId('payout-history-title')).toBeVisible();
});
