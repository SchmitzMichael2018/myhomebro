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

  await page.route('**/api/projects/admin/overview**', async (route) => {
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
          open_disputes: 1,
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

  await page.route('**/api/projects/admin/goals**', async (route) => {
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

  await page.route('**/api/projects/admin/contractors**', async (route) => {
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

  await page.route('**/api/projects/admin/subcontractors**', async (route) => {
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

  await page.route('**/api/projects/admin/homeowners**', async (route) => {
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

  await page.route('**/api/projects/admin/agreements**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const escrowStatus = (requestUrl.searchParams.get('escrow_status') || '').toLowerCase();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        count: 1,
        results:
          escrowStatus === 'released'
            ? [
                {
                  id: 322,
                  project_title: 'Patio Cover',
                  project_city: 'Dallas',
                  project_state: 'TX',
                  escrow_funded_amount: '4000.00',
                  escrow_released_amount: '4000.00',
                  escrow_in_flight_amount: '0.00',
                  is_archived: false,
                  pdf_version: 3,
                  escrow_status: 'released',
                },
              ]
            : [
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
                  escrow_status: 'in_flight',
                },
              ],
      }),
    });
  });

  await page.route('**/api/projects/agreements/321/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const pathname = requestUrl.pathname.replace(/^\/api/, '');

    if (route.request().method() === 'GET' && pathname === '/projects/agreements/321/') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 321,
          title: 'Kitchen Remodel',
          homeowner_name: 'Casey Prospect',
          homeowner_email: 'casey@example.com',
          payment_mode: 'escrow',
          payment_structure: 'simple',
          status: 'sent',
          workflow_status: 'sent',
          project_class: 'residential',
          total_cost: '12000.00',
          is_fully_signed: true,
          escrow_funded: true,
          milestones: [],
          pdf_versions: [],
          current_pdf_url: '/media/agreement-321.pdf',
          sms_enabled: false,
          sms_opted_out: false,
          last_sms_automation_decision: null,
        }),
      });
    }

    if (route.request().method() === 'GET' && pathname === '/projects/agreements/321/funding_preview/') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          project_amount: '12000.00',
          platform_fee: '600.00',
          contractor_payout: '11400.00',
          homeowner_escrow: '12000.00',
          rate: 0.05,
          fixed_fee: 1,
          high_risk_applied: false,
          is_intro: false,
          tier_name: 'standard',
        }),
      });
    }

    if (route.request().method() === 'GET' && pathname === '/projects/warranties/') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    }

    return route.continue();
  });

  await page.route('**/api/projects/admin/agreements/321/ai-context/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        agreement_id: 321,
        source_lead_id: 55,
        has_ai_analysis: true,
        suggested_title: 'Kitchen Remodel',
        template_name: 'Kitchen Remodel Template',
        confidence: 'high',
        reason: 'Strong match to the requested scope.',
        pricing_sources: ['Template baseline', 'Historical project'],
        pricing_confidence_levels: ['high', 'medium'],
        ai_analysis: {},
      }),
    });
  });

  await page.route('**/api/projects/admin/agreements/321/refresh-pricing/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        detail: 'Pricing guidance refreshed.',
        persisted_count: 4,
      }),
    });
  });

  await page.route('**/api/projects/admin/disputes**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const status = (requestUrl.searchParams.get('status') || 'active').toLowerCase();
    const includeArchived = (requestUrl.searchParams.get('include_archived') || '').toLowerCase() === '1';
    const allResults = [
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
        is_archived: false,
      },
      {
        id: 802,
        agreement_id: 321,
        invoice_id: 902,
        initiator: 'contractor',
        contractor_name: 'Summit Renovations',
        homeowner_name: 'Casey Prospect',
        project_title: 'Kitchen Remodel',
        milestone_title: 'Final Walkthrough',
        status: 'resolved_contractor',
        amount: '75.00',
        created_at: '2026-03-20T10:00:00Z',
        updated_at: '2026-03-24T11:30:00Z',
        is_archived: false,
      },
      {
        id: 803,
        agreement_id: 321,
        invoice_id: 903,
        initiator: 'homeowner',
        contractor_name: 'Summit Renovations',
        homeowner_name: 'Casey Prospect',
        project_title: 'Roof Repair',
        milestone_title: 'Final Inspection',
        status: 'resolved',
        amount: '50.00',
        created_at: '2026-03-18T10:00:00Z',
        updated_at: '2026-03-22T11:30:00Z',
        is_archived: true,
      },
    ];
    const visible = includeArchived ? allResults : allResults.filter((row) => !row.is_archived);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        count: status === 'all' ? visible.length : visible.filter((row) => row.status === 'open').length,
        results: status === 'all' ? visible : visible.filter((row) => row.status === 'open'),
        filters: { status, include_archived: includeArchived },
        filter_label: `${status === 'all' ? 'All disputes' : 'Active disputes'}${includeArchived ? ' (archived shown)' : ''}`,
      }),
    });
  });

  await page.route('**/api/projects/admin/geo**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        generated_at: '2026-03-26T12:00:00Z',
        states: [],
        cities_by_state: {},
        zips_by_state: {},
        total_agreements_l12m: 5,
        agreements_with_geo: 0,
        agreements_missing_geo: 5,
        receipts_l12m: 2,
        receipts_with_geo: 0,
        receipts_missing_geo: 2,
        missing_geo_samples: [
          { agreement_id: 401, project_title: 'Garden Shed' },
          { agreement_id: 402, project_title: 'Patio Cover' },
        ],
      }),
    });
  });
}

test('owner admin dashboard smoke renders overview and core admin views', async ({ page }) => {
  await mockAdminDashboard(page);

  await page.goto('/app/admin?view=overview', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('admin-overview-cards')).toBeVisible();
  const attentionClass = await page.getByTestId('admin-needs-attention').getAttribute('class');
  expect(attentionClass).toContain('bg-[#061d42]/95');
  await expect(page.getByText('â€¢')).toHaveCount(0);
  await expect(page.getByTestId('admin-stat-contractors')).toContainText('12');
  await expect(page.getByTestId('admin-stat-month-fees')).toContainText('$620.00');
  await expect(page.getByTestId('admin-stat-open-disputes')).toContainText('1');
  await expect(page.getByTestId('admin-growth-insights')).toBeVisible();
  await expect(page.getByTestId('admin-revenue-summary')).toBeVisible();

  await page.goto('/app/admin?view=agreements&escrow_status=in_flight', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Filter:')).toContainText('Escrow in flight');
  await expect(page.getByText('No agreements match')).toHaveCount(0);
  await expect(page.getByText('Kitchen Remodel')).toBeVisible();
  await page.getByRole('button', { name: 'View Agreement' }).first().click();
  await expect(page).toHaveURL(/\/app\/admin\/agreements\/321$/);
  await expect(page.getByRole('heading', { name: 'Admin Agreement Detail' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to Admin Agreements' })).toBeVisible();
  await expect(page.getByTestId('admin-agreement-tabs')).toBeVisible();
  await page.goto('/app/admin?view=agreements&escrow_status=in_flight', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Financials' }).first().click();
  await expect(page).toHaveURL(/\/app\/admin\/agreements\/321\?tab=pricing$/);
  await expect(page.getByText('Escrow Summary')).toBeVisible();
  await page.goto('/app/admin?view=agreements&escrow_status=in_flight', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'AI Context' }).first().click();
  await expect(page).toHaveURL(/\/app\/admin\/agreements\/321\?tab=ai$/);
  await expect(page.getByText('Saved AI title, template, confidence, and reasons.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run AI Review' })).toBeVisible();
  await expect(page.getByText('Suggested title')).toBeVisible();
  await page.goto('/app/admin?view=agreements&escrow_status=in_flight', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Recalculate Pricing' }).first().click();
  await expect(page).toHaveURL(/\/app\/admin\/agreements\/321\?tab=pricing$/);

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
  await expect(page.getByText('Filter:')).toContainText('Active disputes');
  await expect(page.getByTestId('admin-dispute-row-801')).toContainText('Kitchen Remodel');
  await expect(page.getByText('resolved_contractor')).toHaveCount(0);

  await page.goto('/app/admin?view=disputes&status=all', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Filter:')).toContainText('All disputes');
  await expect(page.getByTestId('admin-dispute-row-801').getByRole('button', { name: 'Archive' })).toHaveCount(0);
  const resolvedRow = page.getByTestId('admin-dispute-row-802');
  await expect(resolvedRow).toContainText('Resolved');
  await expect(resolvedRow).toContainText('Read only');
  await expect(resolvedRow.getByText(/^Resolved$/)).toHaveCount(1);
  await expect(resolvedRow.getByText(/^Read only$/)).toHaveCount(1);
  await expect(resolvedRow.getByRole('button', { name: 'View' })).toBeVisible();
  await expect(resolvedRow.getByRole('button', { name: 'Archive' })).toBeVisible();
  await expect(page.getByTestId('admin-dispute-row-803')).toHaveCount(0);

  await page.getByRole('button', { name: 'Show archived' }).click();
  await expect(page.getByText('Filter:')).toContainText('Archived shown');
  await expect(page.getByTestId('admin-dispute-row-803')).toContainText('Archived');
  await expect(page.getByTestId('admin-dispute-row-803').getByRole('button', { name: 'Archive' })).toHaveCount(0);
});

test('admin templates page renders system template management controls', async ({ page }) => {
  await mockAdminDashboard(page);

  await page.route('**/api/projects/templates/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const pathname = requestUrl.pathname.replace(/^\/api/, '');

    if (route.request().method() === 'GET' && pathname === '/projects/templates/') {
      const source = (requestUrl.searchParams.get('source') || 'all').toLowerCase();
      const results = [
        {
          id: 901,
          name: 'Admin Shed System',
          project_type: 'Outdoor',
          project_subtype: 'Shed Build',
          description: 'System managed shed template.',
          default_scope: 'System managed shed template.',
          exclusions_text: '',
          assumptions_text: '',
          visibility: 'system',
          is_system: true,
          is_system_template: true,
          is_published: true,
          allow_discovery: true,
          owner_type: 'system',
          source_label: 'system',
          milestone_count: 3,
          milestones: [],
        },
        {
          id: 902,
          name: 'Contractor Shed Template',
          project_type: 'Outdoor',
          project_subtype: 'Shed Build',
          description: 'Contractor owned shed template.',
          default_scope: 'Contractor owned shed template.',
          exclusions_text: '',
          assumptions_text: '',
          visibility: 'private',
          is_system: false,
          is_system_template: false,
          is_published: false,
          allow_discovery: false,
          owner_type: 'contractor',
          source_label: 'private',
          milestone_count: 2,
          milestones: [],
        },
      ];

      const filtered =
        source === 'system'
          ? results.filter((row) => row.is_system)
          : source === 'public'
          ? []
          : source === 'regional'
          ? []
          : results;

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(filtered),
      });
    }

    if (route.request().method() === 'GET' && /\/projects\/templates\/\d+\/$/.test(pathname)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 901,
          name: 'Admin Shed System',
          project_type: 'Outdoor',
          project_subtype: 'Shed Build',
          description: 'System managed shed template.',
          default_scope: 'System managed shed template.',
          exclusions_text: '',
          assumptions_text: '',
          visibility: 'system',
          is_system: true,
          is_system_template: true,
          is_published: true,
          allow_discovery: true,
          milestones: [],
        }),
      });
    }

    if (route.request().method() === 'PATCH') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 901,
          name: 'Admin Shed System',
          project_type: 'Outdoor',
          project_subtype: 'Shed Build',
          description: 'System managed shed template.',
          default_scope: 'System managed shed template.',
          exclusions_text: '',
          assumptions_text: '',
          visibility: 'system',
          is_system: true,
          is_system_template: true,
          is_published: false,
          allow_discovery: false,
          milestones: [],
        }),
      });
    }

    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 903,
          name: 'Admin Created System Template',
          project_type: 'Outdoor',
          project_subtype: 'Shed Build',
          description: 'Admin created system template.',
          default_scope: 'Admin created system template.',
          exclusions_text: '',
          assumptions_text: '',
          visibility: 'system',
          is_system: true,
          is_system_template: true,
          is_published: false,
          allow_discovery: false,
          milestones: [],
        }),
      });
    }

    return route.continue();
  });

  await page.goto('/app/admin/templates', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Admin Templates' })).toBeVisible();
  if (await page.getByTestId('templates-new-draft-button').count()) {
    await expect(page.getByTestId('templates-new-draft-button')).toContainText('Create System Template');
  } else {
    await expect(page.getByRole('button', { name: /^Create Template$/ })).toBeVisible();
  }
  await expect(page.getByTestId('template-discovery-card-901')).toBeVisible();
  await expect(page.getByTestId('template-discovery-card-902')).toBeVisible();

  await page.getByTestId('templates-market-tab-system').click();
  await expect(page.getByTestId('template-discovery-card-901')).toBeVisible();
  await expect(page.getByTestId('template-discovery-card-902')).toHaveCount(0);
});

test('admin geo page shows diagnostics when no geo rows exist', async ({ page }) => {
  await mockAdminDashboard(page);

  await page.goto('/app/admin?view=geo', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('No geo data yet.')).toBeVisible();
  await expect(page.getByText(/agreements checked/i)).toBeVisible();
  await expect(page.getByText(/missing project location/i)).toBeVisible();
  await expect(page.getByText('No city data.')).toBeVisible();
  await expect(page.getByText('No ZIP data.')).toBeVisible();
});
