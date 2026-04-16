import { expect, test } from '@playwright/test';

const draws = [
  {
    id: 901,
    agreement_id: 301,
    agreement_project_class: 'commercial',
    agreement_title: 'Office Renovation',
    draw_number: 1,
    title: 'Mobilization',
    status: 'submitted',
    workflow_status: 'submitted',
    workflow_status_label: 'Submitted',
    workflow_message: 'Submitted for owner review.',
    net_amount: '1250.00',
    gross_amount: '1400.00',
    current_requested_amount: '1400.00',
    public_review_url: 'https://app.myhomebro.test/draws/magic/submitted',
    line_items: [{ id: 1, milestone_title: 'Mobilization', description: 'Mobilization' }],
  },
  {
    id: 902,
    agreement_id: 301,
    agreement_project_class: 'commercial',
    agreement_title: 'Office Renovation',
    draw_number: 2,
    title: 'Framing',
    status: 'approved',
    workflow_status: 'payment_pending',
    workflow_status_label: 'Payment Pending',
    workflow_message: 'Approved by the owner. Payment is still pending through MyHomeBro.',
    payment_mode: 'direct',
    net_amount: '2400.00',
    gross_amount: '2600.00',
    current_requested_amount: '2600.00',
    public_review_url: 'https://app.myhomebro.test/draws/magic/pending',
    line_items: [{ id: 2, milestone_title: 'Framing', description: 'Framing' }],
  },
  {
    id: 903,
    agreement_id: 301,
    agreement_project_class: 'commercial',
    agreement_title: 'Office Renovation',
    draw_number: 3,
    title: 'Inspection Holdback',
    status: 'awaiting_release',
    workflow_status: 'payment_pending',
    workflow_status_label: 'Payment Pending',
    workflow_message: 'Approved by the owner. Escrow release is the next step.',
    is_awaiting_release: true,
    payment_mode: 'escrow',
    net_amount: '1500.00',
    gross_amount: '1700.00',
    current_requested_amount: '1700.00',
    public_review_url: 'https://app.myhomebro.test/draws/magic/release',
    line_items: [{ id: 3, milestone_title: 'Inspection Holdback', description: 'Inspection Holdback' }],
  },
  {
    id: 904,
    agreement_id: 301,
    agreement_project_class: 'commercial',
    agreement_title: 'Office Renovation',
    draw_number: 4,
    title: 'Finish',
    status: 'paid',
    workflow_status: 'paid',
    workflow_status_label: 'Paid',
    workflow_message: 'Payment has been recorded for this draw.',
    payment_mode: 'direct',
    net_amount: '3100.00',
    gross_amount: '3400.00',
    current_requested_amount: '3400.00',
    public_review_url: 'https://app.myhomebro.test/draws/magic/paid',
    line_items: [{ id: 3, milestone_title: 'Finish', description: 'Finish' }],
  },
  {
    id: 905,
    agreement_id: 301,
    agreement_project_class: 'commercial',
    agreement_title: 'Office Renovation',
    draw_number: 5,
    title: 'Punch List',
    status: 'changes_requested',
    workflow_status: 'changes_requested',
    workflow_status_label: 'Changes Requested',
    workflow_message: 'The owner requested changes before payment moves forward.',
    payment_mode: 'direct',
    net_amount: '700.00',
    gross_amount: '800.00',
    current_requested_amount: '800.00',
    public_review_url: 'https://app.myhomebro.test/draws/magic/changes',
    line_items: [{ id: 4, milestone_title: 'Punch List', description: 'Punch List' }],
  },
];

const bidRows = [
  {
    bid_id: "lead-201",
    project_title: "Kitchen Remodel",
    customer_name: "Taylor Contractor",
    project_class: "residential",
    project_class_label: "Residential",
    status: "submitted",
    status_label: "Submitted",
    status_group: "open",
    next_action: { key: "review_bid", label: "Review Bid", target: "" },
  },
  {
    bid_id: "intake-202",
    project_title: "Office Suite Renovation",
    customer_name: "Morgan Commercial",
    project_class: "commercial",
    project_class_label: "Commercial",
    status: "under_review",
    status_label: "Under Review",
    status_group: "under_review",
    next_action: { key: "review_bid", label: "Review Bid", target: "" },
  },
  {
    bid_id: "lead-203",
    project_title: "Retail Buildout",
    customer_name: "Avery Awarded",
    project_class: "commercial",
    project_class_label: "Commercial",
    status: "awarded",
    status_label: "Awarded",
    status_group: "awarded",
    next_action: { key: "convert_to_agreement", label: "Convert to Agreement", target: "" },
  },
];

async function mockDashboard(page, options = {}) {
  const bids = options.bidRows ?? bidRows;
  const bidSummary =
    options.bidSummary ?? {
      total_bids: bids.length,
      open_bids: 1,
      under_review_bids: 1,
      awarded_bids: 1,
      declined_expired_bids: 0,
      residential_count: 1,
      commercial_count: 2,
    };

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
      body: JSON.stringify({ onboarding_status: 'complete', connected: true }),
    });
  });

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        created_at: '2026-03-01T10:00:00Z',
        business_name: 'MHB Commercial',
        city: 'Dallas',
        payouts_enabled: true,
        charges_enabled: true,
      }),
    });
  });

  await page.route('**/api/projects/contractor/payout-history/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 'invoice-1',
            record_id: 71,
            record_type: 'invoice',
            record_type_label: 'Invoice',
            payout_date: '2026-04-12T12:00:00Z',
            agreement_label: 'Kitchen Remodel Agreement',
            source_label: 'INV-71',
            project_class_label: 'Residential',
            net_payout: '1140.00',
            gross_amount: '1200.00',
            platform_fee: '60.00',
            transfer_ref: 'tr_invoice_71',
            status_label: 'Paid',
            notes: 'Escrow released',
          },
          {
            id: 'draw-2',
            record_id: 72,
            record_type: 'draw_request',
            record_type_label: 'Draw',
            payout_date: '2026-04-13T12:00:00Z',
            agreement_label: 'Office Renovation',
            source_label: 'Draw #2',
            project_class_label: 'Commercial',
            net_payout: '1710.00',
            gross_amount: '1800.00',
            platform_fee: '90.00',
            transfer_ref: 'tr_draw_72',
            status_label: 'Paid',
            notes: 'Released to contractor',
          },
        ],
        summary: {
          total_paid_out: '2850.00',
          total_platform_fees_retained: '150.00',
          total_gross_released: '3000.00',
          payout_count: 2,
          invoice_count: 1,
          draw_count: 1,
        },
        filters: {
          project_class: 'all',
          record_type: 'all',
        },
      }),
    });
  });

  await page.route('**/api/projects/contractor/bids/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: bids,
        summary: bidSummary,
        filters: {
          status: 'all',
          project_class: 'all',
          search: '',
        },
      }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 11, title: 'Not Started Stage', amount: '1800.00', status: 'not_started', completed: false, is_invoiced: false, progress_percent: 0 },
          { id: 12, title: 'In Progress Stage', amount: '5000.00', completed: false, is_invoiced: false, progress_percent: 40 },
          { id: 13, title: 'Completed Stage', amount: '2200.00', completed: true, is_invoiced: false, status: 'completed' },
          { id: 14, title: 'Reviewed Stage', amount: '1400.00', completed: true, is_invoiced: false, status: 'pending_review', completion_submitted_at: '2026-04-10T12:00:00Z' },
          { id: 15, title: 'Invoiced Stage', amount: '2600.00', completed: true, is_invoiced: true, invoice_id: 71, status: 'completed' },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/invoices\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 71,
            amount: '2600.00',
            status: 'approved',
            display_status: 'approved',
            agreement: { id: 401, title: 'Kitchen Remodel', project_class: 'residential', payment_mode: 'direct' },
            milestone_title: 'Cabinet Install',
            invoice_number: 'INV-71',
          },
          {
            id: 72,
            amount: '1100.00',
            status: 'paid',
            display_status: 'paid',
            agreement: { id: 301, title: 'Office Renovation', project_class: 'commercial', payment_mode: 'escrow' },
            milestone_title: 'Deposit',
            invoice_number: 'INV-72',
          },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 301, title: 'Office Renovation', payment_structure: 'progress', total_cost: '25000.00' },
        ],
      }),
    });
  });

  await page.route('**/api/projects/agreements/301/funding_preview/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rate: 0.03, fixed_fee: 1, is_intro: true, tier_name: 'INTRO' }),
    });
  });

  await page.route('**/api/projects/contractor/public-leads/', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });

  await page.route('**/api/projects/expense-requests/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });

  await page.route('**/api/projects/activity-feed/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 88,
            event_type: 'payment_failed',
            title: 'Failed payment follow-up',
            summary: 'A payment failed and needs attention.',
            severity: 'warning',
            created_at: '2026-04-10T15:00:00Z',
            navigation_target: '/app/dashboard',
          },
        ],
      }),
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
        empty_states: { recent_activity: 'No recent worker activity yet.' },
      }),
    });
  });

  await page.route('**/api/projects/draws/', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: draws }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...draws[0],
        review_email_sent_at: '2026-04-13T12:00:00Z',
        email_delivery: { ok: true, message: 'Review email sent to owner@example.com.' },
      }),
    });
  });

  await page.route(/\/api\/projects\/draws\/\d+\/resend_review\/$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...draws[0],
        review_email_sent_at: '2026-04-13T12:00:00Z',
        email_delivery: { ok: true, message: 'Review email sent to owner@example.com.' },
      }),
    });
  });

  await page.route(/\/api\/projects\/draws\/\d+\/release\/$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...draws[2],
        status: 'released',
        workflow_status: 'paid',
        workflow_status_label: 'Paid',
        workflow_message: 'Escrow funds have been released for this draw.',
        released_at: '2026-04-13T16:30:00Z',
      }),
    });
  });
}

test('contractor dashboard reflects draw-request payment pipeline and actions', async ({ page }) => {
  await mockDashboard(page);

  await page.goto('/app', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Payment Pipeline')).toBeVisible();
  await expect(page.getByTestId('dashboard-work-not-started')).toBeVisible();
  await expect(page.getByTestId('dashboard-work-in-progress')).toBeVisible();
  await expect(page.getByTestId('dashboard-work-completed')).toBeVisible();
  await expect(page.getByTestId('dashboard-work-reviewed')).toBeVisible();
  await expect(page.getByTestId('dashboard-work-invoiced')).toBeVisible();
  await expect(page.locator('text=Total Earned').first()).toBeVisible();
  await expect(page.locator('text=Payment Pending').first()).toBeVisible();
  await expect(page.locator('text=Issues / Disputes').first()).toBeVisible();
  await expect(page.getByTestId('dashboard-money-awaiting-customer')).toBeVisible();
  await expect(page.getByTestId('dashboard-money-approved')).toBeVisible();
  await expect(page.getByTestId('dashboard-money-issues')).toBeVisible();
  await expect(page.getByText('Send Payment Request')).toBeVisible();
  await expect(page.getByText('Paid Work')).toHaveCount(0);

  await expect(page.getByTestId('dashboard-payment-records-table')).toBeVisible();
  await expect(page.getByText('Mobilization')).toBeVisible();
  await expect(page.getByTestId('dashboard-payment-records-table')).toContainText('Draw Request');
  await expect(page.getByTestId('dashboard-payment-records-table')).toContainText('Invoice');
  await expect(page.getByTestId('dashboard-payment-records-table')).toContainText('Residential');
  await expect(page.getByTestId('dashboard-payment-records-table')).toContainText('Commercial');
  await expect(page.getByTestId('dashboard-payout-summary')).toBeVisible();
  await expect(page.getByTestId('dashboard-payout-summary')).toContainText('$2,850.00');
  await expect(page.getByTestId('dashboard-payout-summary')).toContainText('$150.00');
  await expect(page.getByTestId('dashboard-payout-row-71')).toContainText('Kitchen Remodel Agreement');
  await expect(page.getByTestId('dashboard-payout-row-72')).toContainText('Office Renovation');
  await expect(page.getByTestId('dashboard-bids-summary')).toBeVisible();
  await expect(page.getByTestId('dashboard-bids-summary')).toContainText('Open Bids');
  await expect(page.getByTestId('dashboard-bids-summary')).toContainText('Under Review');
  await expect(page.getByTestId('dashboard-bids-summary')).toContainText('Awarded');
  await expect(page.getByTestId('dashboard-bids-recent-table')).toBeVisible();
  await expect(page.getByTestId('dashboard-bids-row-lead-201')).toContainText('Kitchen Remodel');
  await expect(page.getByTestId('dashboard-bids-row-intake-202')).toContainText('Office Suite Renovation');
  await expect(page.getByTestId('dashboard-bids-row-lead-203')).toContainText('Convert to Agreement');
  await expect(page.getByTestId('dashboard-money-awaiting-customer')).toContainText('Awaiting Customer Approval');
  await expect(page.getByTestId('dashboard-money-approved')).toContainText('Payment Pending');
  await expect(page.getByTestId('dashboard-payment-records-table').getByText('Issues / Disputes')).toBeVisible();
  await expect(page.locator('text=/awaiting payment/i').first()).toBeVisible();
  await expect(page.getByTestId('dashboard-payment-records-table').getByText('Payment Pending')).toHaveCount(3);
  await expect(page.locator('text=/requested changes/i').first()).toBeVisible();
  await expect(page.locator('text=/failed.*follow-up/i').first()).toBeVisible();

  await page.getByRole('button', { name: 'Resend Link' }).first().click();
  await expect(page.getByText('Review email sent to owner@example.com.')).toBeVisible();

  await page.getByRole('button', { name: 'Release Funds' }).click();
  await expect(page.getByText('Escrow funds marked as released.')).toBeVisible();
  await expect(page.getByTestId('dashboard-payment-records-table').getByText('Paid')).toHaveCount(3);
});

test('contractor dashboard view-all bids shortcut routes to the unified bids workspace', async ({ page }) => {
  await mockDashboard(page);

  await page.goto('/app', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('dashboard-bids-view-all')).toBeVisible();
  await page.getByTestId('dashboard-bids-view-all').click();
  await expect(page).toHaveURL(/\/app\/bids$/);
});

test('contractor dashboard shows a clean empty bids snapshot when there are no bids', async ({ page }) => {
  await mockDashboard(page, {
    bidRows: [],
    bidSummary: {
      total_bids: 0,
      open_bids: 0,
      under_review_bids: 0,
      awarded_bids: 0,
      declined_expired_bids: 0,
      residential_count: 0,
      commercial_count: 0,
    },
  });

  await page.goto('/app', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('dashboard-bids-summary')).toBeVisible();
  await expect(page.getByTestId('dashboard-bids-summary')).toContainText('0');
  await expect(page.getByTestId('dashboard-bids-summary')).toContainText('No bids yet');
  await expect(page.getByTestId('dashboard-bids-recent-table')).toHaveCount(0);
});
