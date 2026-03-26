import { expect, test } from '@playwright/test';

async function mockAdminDashboard(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 1,
        type: 'admin',
        role: 'admin',
        email: 'owner@myhomebro.local',
      }),
    });
  });

  await page.route('**/api/projects/admin/overview/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        generated_at: '2026-03-26T12:00:00Z',
        counts: {
          contractors: 12,
          homeowners: 28,
          agreements: 17,
          invoices: 11,
          disputes: 2,
          receipts: 9,
          refunds: 1,
          subcontractors: 7,
        },
        money: {
          gross_paid_revenue: '18500.00',
          platform_fee_total: '1430.00',
          escrow_funded_total: '9200.00',
          escrow_released_total: '4100.00',
          escrow_refunded_total: '250.00',
          escrow_in_flight_total: '4850.00',
          platform_fee_this_month: '620.00',
        },
        summary: {
          new_contractors_this_week: 2,
          new_contractors_this_month: 4,
          active_agreements: 9,
          open_disputes: 2,
          leads_this_month: 14,
          agreements_this_month: 6,
        },
        fee_trend: [
          { label: 'Oct 2025', platform_fee: '120.00', gross_paid: '1400.00' },
          { label: 'Nov 2025', platform_fee: '180.00', gross_paid: '2300.00' },
          { label: 'Dec 2025', platform_fee: '240.00', gross_paid: '3200.00' },
          { label: 'Jan 2026', platform_fee: '260.00', gross_paid: '3600.00' },
          { label: 'Feb 2026', platform_fee: '310.00', gross_paid: '4100.00' },
          { label: 'Mar 2026', platform_fee: '620.00', gross_paid: '5900.00' },
        ],
        fee_by_contractor: [
          {
            contractor_id: 101,
            contractor_name: 'Summit Renovations',
            platform_fee: '720.00',
            lead_count: 5,
            agreement_count: 4,
          },
          {
            contractor_id: 102,
            contractor_name: 'Lakefront Builders',
            platform_fee: '430.00',
            lead_count: 3,
            agreement_count: 2,
          },
        ],
        fee_by_payment_mode: [
          { payment_mode: 'escrow', platform_fee: '980.00' },
          { payment_mode: 'direct', platform_fee: '450.00' },
        ],
        top_categories: [
          { category: 'Kitchen Remodel', platform_fee: '510.00' },
          { category: 'Roofing', platform_fee: '360.00' },
        ],
        top_regions: [
          { region: 'TX', platform_fee: '800.00' },
          { region: 'IL', platform_fee: '430.00' },
        ],
        insights: [
          {
            tone: 'warn',
            title: '3 contractors have leads but no agreements',
            detail: 'These accounts are attracting leads but not converting them into project drafts.',
            view: 'contractors',
          },
          {
            tone: 'good',
            title: 'Kitchen Remodel is the top fee category',
            detail: 'Platform fees are strongest in Kitchen Remodel this month.',
            view: 'agreements',
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/admin/goals/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        goal: { target: '120000.00' },
        salary_tracker: {
          platform_fees_l12m: '42000.00',
          projection_annual: '118000.00',
          pace_ratio: 0.98,
          status: 'at_risk',
        },
        drivers: {
          escrow_funded_l12m: '860000.00',
        },
        derived: {
          effective_take_rate_l12m: 0.049,
          implied_escrow_needed_for_goal: '2448979.59',
        },
      }),
    });
  });

  await page.route('**/api/projects/admin/contractors/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        count: 2,
        results: [
          {
            id: 101,
            created_at: '2026-03-02T10:00:00Z',
            name: 'Summit Renovations',
            business_name: 'Summit Renovations',
            email: 'summit@example.com',
            city: 'Austin',
            state: 'TX',
            stripe_account_id: 'acct_summit123456',
            account_status: 'active',
            public_profile_status: 'public',
            gallery_count: 4,
            review_count: 6,
            lead_count: 5,
            agreement_count: 4,
            fee_revenue: '720.00',
            recent_activity_at: '2026-03-25T15:30:00Z',
          },
          {
            id: 102,
            created_at: '2026-03-18T09:00:00Z',
            name: 'Lakefront Builders',
            business_name: 'Lakefront Builders',
            email: 'lakefront@example.com',
            city: 'Chicago',
            state: 'IL',
            stripe_account_id: '',
            account_status: 'pending_stripe',
            public_profile_status: 'private',
            gallery_count: 0,
            review_count: 1,
            lead_count: 3,
            agreement_count: 1,
            fee_revenue: '430.00',
            recent_activity_at: '2026-03-24T11:00:00Z',
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/admin/subcontractors/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        count: 1,
        results: [
          {
            id: 501,
            name: 'Riley Painter',
            email: 'riley@example.com',
            contractor_id: 101,
            contractor_name: 'Summit Renovations',
            agreement_id: 321,
            agreement_title: 'Kitchen Remodel',
            status: 'accepted',
            assigned_work_count: 3,
            invited_at: '2026-03-20T10:00:00Z',
            accepted_at: '2026-03-21T08:30:00Z',
            recent_activity_at: '2026-03-25T09:15:00Z',
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/admin/homeowners/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        count: 1,
        results: [
          {
            id: 701,
            created_at: '2026-03-10T14:00:00Z',
            name: 'Casey Prospect',
            email: 'casey@example.com',
            phone: '555-0100',
            contractor_name: 'Summit Renovations',
            created_by_contractor_id: 101,
            lead_count: 1,
            agreement_count: 1,
            project_count: 1,
            status: 'active',
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/admin/agreements/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        count: 1,
        results: [
          {
            id: 321,
            project_title: 'Kitchen Remodel',
            project_city: 'Austin',
            project_state: 'TX',
            escrow_funded_amount: '4000.00',
            escrow_released_amount: '1000.00',
            escrow_in_flight_amount: '3000.00',
            is_archived: false,
            pdf_version: 2,
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/admin/disputes/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        count: 1,
        results: [
          {
            id: 801,
            agreement_id: 321,
            invoice_id: 901,
            initiator: 'homeowner',
            contractor_name: 'Summit Renovations',
            homeowner_name: 'Casey Prospect',
            project_title: 'Kitchen Remodel',
            milestone_title: 'Cabinet Install',
            status: 'open',
            amount: '150.00',
            created_at: '2026-03-23T13:00:00Z',
            updated_at: '2026-03-25T16:45:00Z',
          },
        ],
      }),
    });
  });
}

test('owner admin dashboard smoke renders overview and core admin views', async ({ page }) => {
  await mockAdminDashboard(page);

  await page.goto('/app/admin?view=overview', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('admin-overview-cards')).toBeVisible();
  await expect(page.getByTestId('admin-stat-contractors')).toContainText('12');
  await expect(page.getByTestId('admin-stat-subcontractors')).toContainText('7');
  await expect(page.getByTestId('admin-thin-total-fees')).toContainText('$1,430.00');
  await expect(page.getByTestId('admin-growth-insights')).toBeVisible();
  await expect(page.getByTestId('admin-revenue-summary')).toBeVisible();

  await page.goto('/app/admin?view=contractors', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('admin-contractors-view')).toBeVisible();
  await expect(page.getByTestId('admin-contractor-row-101')).toContainText('Summit Renovations');

  await page.goto('/app/admin?view=subcontractors', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('admin-subcontractors-view')).toBeVisible();
  await expect(page.getByTestId('admin-subcontractor-row-501')).toContainText('Riley Painter');

  await page.goto('/app/admin?view=homeowners', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('admin-homeowners-view')).toBeVisible();
  await expect(page.getByTestId('admin-homeowner-row-701')).toContainText('Casey Prospect');

  await page.goto('/app/admin?view=disputes', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('admin-disputes-view')).toBeVisible();
  await expect(page.getByTestId('admin-dispute-row-801')).toContainText('Kitchen Remodel');
});
