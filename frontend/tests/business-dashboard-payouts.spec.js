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
        bucket: 'week',
        revenue_series: [
          { bucket_start: '2026-03-03', bucket_label: 'Mar 3-9', revenue: '4200.00' },
          { bucket_start: '2026-03-10', bucket_label: 'Mar 10-16', revenue: '8600.00' },
        ],
        fee_series: [
          {
            bucket_start: '2026-03-03',
            bucket_label: 'Mar 3-9',
            platform_fee: '210.00',
            estimated_processing_fee: '55.00',
            total_fee: '265.00',
          },
          {
            bucket_start: '2026-03-10',
            bucket_label: 'Mar 10-16',
            platform_fee: '430.00',
            estimated_processing_fee: '95.00',
            total_fee: '525.00',
          },
        ],
        fee_summary: {
          platform_fee_total: '640.00',
          estimated_processing_fee_total: '150.00',
          total_fee: '790.00',
        },
        payout_series: [
          {
            bucket_start: '2026-03-03',
            bucket_label: 'Mar 3-9',
            paid_amount: '900.00',
            ready_amount: '300.00',
            failed_amount: '0.00',
            paid_count: 1,
            ready_count: 1,
            failed_count: 0,
          },
          {
            bucket_start: '2026-03-10',
            bucket_label: 'Mar 10-16',
            paid_amount: '600.00',
            ready_amount: '400.00',
            failed_amount: '400.00',
            paid_count: 1,
            ready_count: 1,
            failed_count: 1,
          },
        ],
        workflow_series: [
          { bucket_start: '2026-03-03', bucket_label: 'Mar 3-9', overdue_milestones: 1 },
          { bucket_start: '2026-03-10', bucket_label: 'Mar 10-16', overdue_milestones: 3 },
        ],
        workflow_summary: {
          metric: 'overdue_milestones',
          label: 'Overdue Milestones',
        },
        by_category: [],
        insights: [
          {
            category: 'review_bottleneck',
            title: 'Awaiting review',
            explanation: '3 milestones are waiting for contractor review, which may delay invoicing.',
            severity: 'high',
            action_label: 'View Review Queue',
            action_href: '/app/reviewer/queue',
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/business/contractor/drilldown/**', async (route) => {
    const url = new URL(route.request().url());
    const chartType = url.searchParams.get('chart_type');
    const bucketStart = url.searchParams.get('bucket_start');

    if (chartType === 'revenue' && bucketStart === '2026-03-10') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          chart_type: 'revenue',
          bucket: 'week',
          bucket_start: '2026-03-10',
          bucket_label: 'Mar 10-16',
          record_count: 1,
          records: [
            {
              id: 71,
              invoice_id: 71,
              agreement_id: 321,
              agreement_title: 'Kitchen Remodel Agreement',
              invoice_number: 'INV-20260310-0001',
              milestone_title: 'Cabinet Install',
              paid_at: '2026-03-12T12:00:00Z',
              gross_amount: '8600.00',
            },
          ],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        chart_type: chartType,
        bucket: 'week',
        bucket_start: bucketStart,
        bucket_label: 'Unknown',
        record_count: 0,
        records: [],
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

  await expect(page.getByTestId('dashboard-charts-section')).toBeVisible();
  await expect(page.getByTestId('dashboard-chart-revenue')).toContainText('Revenue Over Time');
  await expect(page.getByTestId('dashboard-chart-fees')).toContainText('Fees Over Time');
  await expect(page.getByTestId('dashboard-chart-fees')).toContainText('Platform fees: $640.00');
  await expect(page.getByTestId('dashboard-chart-fees')).toContainText('Estimated processing: $150.00');
  await expect(page.getByTestId('dashboard-chart-payouts')).toContainText('Subcontractor Payouts');
  await expect(page.getByTestId('dashboard-chart-workflow')).toContainText('Overdue Milestones Trend');
  await page.getByTestId('chart-point-revenue-2026-03-10').click();
  await expect(page.getByTestId('dashboard-drilldown-modal')).toBeVisible();
  await expect(page.getByTestId('dashboard-drilldown-modal')).toContainText('Revenue Over Time');
  await expect(page.getByTestId('drilldown-row-71')).toContainText('Kitchen Remodel Agreement');
  await expect(page.getByTestId('drilldown-row-71')).toContainText('INV-20260310-0001');
  await expect(page.getByTestId('drilldown-open-71')).toHaveAttribute('href', '/app/invoices/71');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('dashboard-drilldown-modal')).toBeHidden();
  await expect(page.getByTestId('dashboard-payouts-section')).toBeVisible();
  await expect(page.getByTestId('dashboard-payouts-section')).toContainText('Subcontractor Payouts');
  await expect(page.getByTestId('dashboard-payouts-section')).toContainText('$1,500.00');
  await expect(page.getByTestId('dashboard-payouts-section')).toContainText('$700.00');
  await expect(page.getByTestId('dashboard-payouts-section')).toContainText('$400.00');
  await expect(page.getByTestId('dashboard-payouts-section')).toContainText('$250.00');
  await expect(page.getByTestId('dashboard-ai-insights-section')).toBeVisible();
  await expect(page.getByTestId('dashboard-ai-insight-0')).toContainText('Awaiting review');
  await expect(page.getByTestId('dashboard-ai-insight-0')).toContainText('may delay invoicing');
  await expect(page.getByRole('link', { name: 'View Review Queue' })).toBeVisible();
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

test('business dashboard charts show empty states cleanly for low-data ranges', async ({ page }) => {
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

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        created_at: '2026-03-01T10:00:00Z',
        auto_subcontractor_payouts_enabled: false,
      }),
    });
  });

  await page.route('**/api/projects/business/contractor/summary/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        snapshot: {
          jobs_completed: 1,
          active_jobs: 1,
          total_revenue: '400.00',
          avg_revenue_per_job: '400.00',
          avg_completion_days: '7.00',
          escrow_pending: '0.00',
          platform_fees_paid: '0.00',
          disputes_open: 0,
        },
        bucket: 'day',
        revenue_series: [
          { bucket_start: '2026-03-20', bucket_label: 'Mar 20', revenue: '400.00' },
        ],
        fee_series: [
          {
            bucket_start: '2026-03-20',
            bucket_label: 'Mar 20',
            platform_fee: '0.00',
            estimated_processing_fee: '0.00',
            total_fee: '0.00',
          },
        ],
        fee_summary: {
          platform_fee_total: '0.00',
          estimated_processing_fee_total: '0.00',
          total_fee: '0.00',
        },
        payout_series: [
          {
            bucket_start: '2026-03-20',
            bucket_label: 'Mar 20',
            paid_amount: '0.00',
            ready_amount: '0.00',
            failed_amount: '0.00',
            paid_count: 0,
            ready_count: 0,
            failed_count: 0,
          },
        ],
        workflow_series: [
          { bucket_start: '2026-03-20', bucket_label: 'Mar 20', overdue_milestones: 0 },
        ],
        workflow_summary: {
          metric: 'overdue_milestones',
          label: 'Overdue Milestones',
        },
        by_category: [],
        insights: [],
      }),
    });
  });

  await page.route('**/api/projects/business/contractor/drilldown/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        chart_type: 'revenue',
        bucket: 'day',
        bucket_start: '2026-03-20',
        bucket_label: 'Mar 20',
        record_count: 0,
        records: [],
      }),
    });
  });

  await page.route('**/api/projects/payouts/history/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [],
        summary: {
          total_paid_amount: '0.00',
          total_ready_amount: '0.00',
          total_failed_amount: '0.00',
          total_pending_amount: '0.00',
          record_count: 0,
        },
      }),
    });
  });

  await page.goto('/app/business', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('dashboard-charts-section')).toBeVisible();
  await expect(page.getByTestId('dashboard-chart-fees')).toContainText(
    'No fee activity in this range yet.'
  );
  await expect(page.getByTestId('dashboard-chart-payouts')).toContainText(
    'No subcontractor payout activity in this range yet.'
  );
  await expect(page.getByTestId('dashboard-chart-workflow')).toContainText(
    'No overdue milestones in this range.'
  );
  await page.getByTestId('chart-point-revenue-2026-03-20').click();
  await expect(page.getByTestId('dashboard-drilldown-modal')).toBeVisible();
  await expect(page.getByTestId('drilldown-empty')).toContainText('No records for this period');
});

test('business dashboard drilldown invoice action navigates to invoice detail', async ({ page }) => {
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

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        created_at: '2026-03-01T10:00:00Z',
        auto_subcontractor_payouts_enabled: true,
      }),
    });
  });

  await page.route('**/api/projects/business/contractor/summary/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        snapshot: {
          jobs_completed: 2,
          active_jobs: 1,
          total_revenue: '2400.00',
          avg_revenue_per_job: '1200.00',
          avg_completion_days: '10.00',
          escrow_pending: '0.00',
          platform_fees_paid: '120.00',
          disputes_open: 0,
        },
        bucket: 'day',
        revenue_series: [
          { bucket_start: '2026-03-20', bucket_label: 'Mar 20', revenue: '2400.00' },
        ],
        fee_series: [],
        fee_summary: {
          platform_fee_total: '0.00',
          estimated_processing_fee_total: '0.00',
          total_fee: '0.00',
        },
        payout_series: [],
        workflow_series: [],
        workflow_summary: {
          metric: 'overdue_milestones',
          label: 'Overdue Milestones',
        },
        by_category: [],
        insights: [],
      }),
    });
  });

  await page.route('**/api/projects/business/contractor/drilldown/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        chart_type: 'revenue',
        bucket: 'day',
        bucket_start: '2026-03-20',
        bucket_label: 'Mar 20',
        record_count: 1,
        records: [
          {
            id: 91,
            invoice_id: 91,
            agreement_id: 321,
            agreement_title: 'Invoice Route Agreement',
            invoice_number: 'INV-20260320-0091',
            milestone_title: 'Punch List',
            paid_at: '2026-03-20T16:00:00Z',
            gross_amount: '2400.00',
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/payouts/history/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [],
        summary: {
          total_paid_amount: '0.00',
          total_ready_amount: '0.00',
          total_failed_amount: '0.00',
          total_pending_amount: '0.00',
          record_count: 0,
        },
      }),
    });
  });

  await page.goto('/app/business', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('chart-point-revenue-2026-03-20').click();
  await expect(page.getByTestId('drilldown-open-91')).toBeVisible();
  await page.getByTestId('drilldown-open-91').click();
  await expect(page).toHaveURL(/\/app\/invoices\/91$/);
});

test('business dashboard drilldown workflow action navigates to milestone detail', async ({ page }) => {
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

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        created_at: '2026-03-01T10:00:00Z',
        auto_subcontractor_payouts_enabled: false,
      }),
    });
  });

  await page.route('**/api/projects/business/contractor/summary/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        snapshot: {
          jobs_completed: 1,
          active_jobs: 1,
          total_revenue: '0.00',
          avg_revenue_per_job: '0.00',
          avg_completion_days: '0.00',
          escrow_pending: '0.00',
          platform_fees_paid: '0.00',
          disputes_open: 0,
        },
        bucket: 'day',
        revenue_series: [],
        fee_series: [],
        fee_summary: {
          platform_fee_total: '0.00',
          estimated_processing_fee_total: '0.00',
          total_fee: '0.00',
        },
        payout_series: [],
        workflow_series: [
          { bucket_start: '2026-03-18', bucket_label: 'Mar 18', overdue_milestones: 1 },
        ],
        workflow_summary: {
          metric: 'overdue_milestones',
          label: 'Overdue Milestones',
        },
        by_category: [],
        insights: [],
      }),
    });
  });

  await page.route('**/api/projects/business/contractor/drilldown/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        chart_type: 'workflow',
        bucket: 'day',
        bucket_start: '2026-03-18',
        bucket_label: 'Mar 18',
        record_count: 1,
        records: [
          {
            id: 46,
            milestone_id: 46,
            agreement_id: 321,
            agreement_title: 'Workflow Route Agreement',
            milestone_title: 'Cabinet Review',
            completion_date: '2026-03-18',
            subcontractor_completion_status: 'submitted_for_review',
            amount: '500.00',
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/payouts/history/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [],
        summary: {
          total_paid_amount: '0.00',
          total_ready_amount: '0.00',
          total_failed_amount: '0.00',
          total_pending_amount: '0.00',
          record_count: 0,
        },
      }),
    });
  });

  await page.goto('/app/business', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('chart-point-workflow-2026-03-18').click();
  await expect(page.getByTestId('drilldown-open-46')).toHaveAttribute('href', '/app/milestones/46');
  await page.getByTestId('drilldown-open-46').click();
  await expect(page).toHaveURL(/\/app\/milestones\/46$/);
});

test('business dashboard payout drilldown action navigates to payout detail', async ({ page }) => {
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

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        created_at: '2026-03-01T10:00:00Z',
        auto_subcontractor_payouts_enabled: true,
      }),
    });
  });

  await page.route('**/api/projects/business/contractor/summary/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        snapshot: {
          jobs_completed: 1,
          active_jobs: 1,
          total_revenue: '0.00',
          avg_revenue_per_job: '0.00',
          avg_completion_days: '0.00',
          escrow_pending: '0.00',
          platform_fees_paid: '0.00',
          disputes_open: 0,
        },
        bucket: 'day',
        revenue_series: [],
        fee_series: [],
        fee_summary: {
          platform_fee_total: '0.00',
          estimated_processing_fee_total: '0.00',
          total_fee: '0.00',
        },
        payout_series: [
          {
            bucket_start: '2026-03-22',
            bucket_label: 'Mar 22',
            paid_amount: '500.00',
            ready_amount: '0.00',
            failed_amount: '0.00',
            paid_count: 1,
            ready_count: 0,
            failed_count: 0,
          },
        ],
        workflow_series: [],
        workflow_summary: {
          metric: 'overdue_milestones',
          label: 'Overdue Milestones',
        },
        by_category: [],
        insights: [],
      }),
    });
  });

  await page.route('**/api/projects/business/contractor/drilldown/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        chart_type: 'payouts',
        bucket: 'day',
        bucket_start: '2026-03-22',
        bucket_label: 'Mar 22',
        record_count: 1,
        records: [
          {
            id: 12,
            payout_id: 12,
            agreement_id: 321,
            agreement_title: 'Payout Route Agreement',
            milestone_id: 901,
            milestone_title: 'Cabinet Install',
            subcontractor_display_name: 'Taylor Sub',
            subcontractor_email: 'taylor@example.com',
            payout_amount: '500.00',
            payout_status: 'paid',
            execution_mode: 'manual',
            paid_at: '2026-03-22T10:00:00Z',
            ready_for_payout_at: '2026-03-21T09:00:00Z',
            failed_at: null,
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/payouts/history/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [],
        summary: {
          total_paid_amount: '0.00',
          total_ready_amount: '0.00',
          total_failed_amount: '0.00',
          total_pending_amount: '0.00',
          record_count: 0,
        },
      }),
    });
  });

  await page.goto('/app/business', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('chart-bar-payouts-paid_amount-2026-03-22').click();
  await expect(page.getByTestId('drilldown-open-12')).toHaveAttribute('href', '/app/payouts/history/12');
  await page.getByTestId('drilldown-open-12').click();
  await expect(page).toHaveURL(/\/app\/payouts\/history\/12$/);
});
