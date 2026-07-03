import { expect, test } from '@playwright/test';

function makeOpportunity(overrides = {}) {
  const sourceLabel = overrides.source_kind_label || 'Website';
  const title = overrides.project_title || `${sourceLabel} Project Lead`;
  return {
    bid_id: overrides.bid_id || `lead-${overrides.source_id || 101}`,
    source_kind: overrides.source_kind || 'lead',
    source_kind_label: sourceLabel,
    lead_source: overrides.lead_source || 'quote_request',
    lead_source_label: overrides.lead_source_label || sourceLabel,
    lead_source_filter: overrides.lead_source_filter || 'website',
    is_website_lead: Boolean(overrides.is_website_lead),
    is_new_website_lead: Boolean(overrides.is_new_website_lead),
    workspace_stage: overrides.workspace_stage || 'new_lead',
    workspace_stage_label: overrides.workspace_stage_label || 'New Lead',
    source_id: overrides.source_id || 101,
    source_reference: overrides.source_reference || `Lead #${overrides.source_id || 101}`,
    project_title: title,
    customer_name: overrides.customer_name || `${sourceLabel} Customer`,
    customer_email: overrides.customer_email || `${String(sourceLabel).toLowerCase().replace(/\s+/g, '')}@example.com`,
    customer_phone: overrides.customer_phone || '512-555-0101',
    location: overrides.location || 'Austin, TX',
    project_class: overrides.project_class || 'residential',
    project_class_label: overrides.project_class_label || 'Residential',
    project_type: overrides.project_type || 'Remodel',
    project_subtype: overrides.project_subtype || '',
    bid_amount: overrides.bid_amount || null,
    bid_amount_label: overrides.bid_amount_label || '$4,500.00',
    submitted_at: overrides.submitted_at || '2026-06-22T15:20:00Z',
    status: overrides.status || 'submitted',
    status_label: overrides.status_label || 'Submitted',
    status_group: overrides.status_group || 'open',
    linked_agreement_id: overrides.linked_agreement_id || null,
    linked_agreement_label: overrides.linked_agreement_label || '',
    linked_agreement_reference: overrides.linked_agreement_reference || '',
    linked_agreement_url: overrides.linked_agreement_url || '',
    notes: overrides.notes || `Lead received from ${sourceLabel}.`,
    timeline: overrides.timeline || 'Within the next month',
    budget_text: overrides.budget_text || '$4,500.00',
    milestone_preview: overrides.milestone_preview || ['Review request', 'Prepare estimate'],
    request_signals: overrides.request_signals || ['Guided Intake', 'Budget Provided'],
    request_snapshot: {
      project_title: title,
      project_type: overrides.project_type || 'Remodel',
      project_subtype: overrides.project_subtype || '',
      refined_description: overrides.notes || `Lead received from ${sourceLabel}.`,
      location: overrides.location || 'Austin, TX',
      request_path_label: overrides.request_path_label || 'Request a Quote',
      measurement_handling: 'Site visit recommended',
      timeline: overrides.timeline || 'Within the next month',
      budget: overrides.budget_text || '$4,500.00',
      clarification_summary: [{ key: 'source', label: 'Source', value: sourceLabel }],
      clarification_count: 1,
      photo_count: overrides.photo_count || 0,
      photos: [],
      milestones: overrides.milestone_preview || ['Review request', 'Prepare estimate'],
      request_signals: overrides.request_signals || ['Guided Intake', 'Budget Provided'],
    },
    next_action: overrides.next_action || { key: 'review_bid', label: 'Review Lead', target: '' },
  };
}

function buildSummary(rows) {
  return {
    total_bids: rows.length,
    new_leads: rows.filter((row) => row.workspace_stage === 'new_lead').length,
    follow_up_leads: rows.filter((row) => row.workspace_stage === 'follow_up').length,
    active_bids: rows.filter((row) => row.workspace_stage === 'active_bid').length,
    closed: rows.filter((row) => row.workspace_stage === 'closed').length,
    property_work_order_count: rows.filter((row) => row.source_kind === 'property_work_order').length,
    website_leads: rows.filter((row) => row.is_website_lead).length,
    new_website_leads: rows.filter((row) => row.is_website_lead && row.workspace_stage === 'new_lead').length,
    website_leads_needing_follow_up: rows.filter(
      (row) => row.is_website_lead && ['new_lead', 'follow_up'].includes(row.workspace_stage)
    ).length,
  };
}

async function mockUnifiedOpportunityPipeline(page, rows = []) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 7, type: 'contractor', role: 'contractor_owner', email: 'contractor@example.com' }),
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
      body: JSON.stringify({ id: 77, public_profile: {} }),
    });
  });
  await page.route('**/api/projects/contractor/bids/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: rows, summary: buildSummary(rows) }),
    });
  });
  await page.route('**/api/projects/contractor/public-leads/101/create-agreement/**', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        agreement_id: 901,
        wizard_url: '/app/agreements/901/wizard?step=1',
        created: true,
      }),
    });
  });
  await page.route('**/api/projects/contractor/public-profile/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        business_name_public: 'Bright Build Co',
        tagline: 'Trusted renovations and repairs',
        bio: 'Clean project delivery.',
        city: 'Austin',
        state: 'TX',
        public_url: 'http://localhost:4173/contractors/bright-build-co',
        specialties: [],
        work_types: [],
        is_public: true,
      }),
    });
  });
  await page.route('**/api/projects/contractor/public-profile/qr/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ qr_svg: 'data:image/svg+xml;base64,PHN2Zy8+' }),
    });
  });
  await page.route('**/api/projects/contractor/gallery/', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });
  await page.route('**/api/projects/contractor/reviews/', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });
  await page.route('**/api/projects/contractor/website/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
}

test('Marketing remains setup-only and hands public leads to Opportunities', async ({ page }) => {
  await mockUnifiedOpportunityPipeline(page, []);

  await page.goto('/app/marketing?tab=leads', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('public-presence-title')).toContainText('Online Presence Setup');
  await expect(page.getByTestId('online-presence-leads-handoff')).toContainText(
    'Leads from your profile, QR code, and website appear in Opportunities.'
  );
  await expect(page.getByRole('button', { name: 'Website Leads' })).toHaveCount(0);
  await expect(page.getByTestId('public-presence-leads-tab')).toHaveCount(0);
});

test('public profile, QR, website, and landing leads land in unified Opportunities', async ({ page }) => {
  const rows = [
    makeOpportunity({
      bid_id: 'lead-101',
      source_id: 101,
      source_kind: 'quote_request',
      source_kind_label: 'Website',
      lead_source: 'quote_request',
      lead_source_filter: 'website',
      is_website_lead: true,
      is_new_website_lead: true,
      project_title: 'Website Concrete Patio',
      customer_name: 'Website Customer',
      next_action: { key: 'convert_to_agreement', label: 'Convert to Agreement', target: '' },
    }),
    makeOpportunity({
      bid_id: 'lead-102',
      source_id: 102,
      source_kind_label: 'Public Profile',
      lead_source: 'public_profile',
      lead_source_filter: 'public_profile',
      is_website_lead: true,
      is_new_website_lead: true,
      project_title: 'Profile Bathroom Request',
      customer_name: 'Profile Customer',
    }),
    makeOpportunity({
      bid_id: 'lead-103',
      source_id: 103,
      source_kind_label: 'QR Code',
      lead_source: 'qr',
      lead_source_filter: 'qr',
      is_website_lead: true,
      is_new_website_lead: true,
      project_title: 'QR Deck Repair',
      customer_name: 'QR Customer',
    }),
    makeOpportunity({
      bid_id: 'lead-104',
      source_id: 104,
      source_kind_label: 'Landing',
      lead_source: 'landing_page',
      lead_source_filter: 'landing',
      is_website_lead: true,
      is_new_website_lead: true,
      project_title: 'Landing Fence Repair',
      customer_name: 'Landing Customer',
    }),
    makeOpportunity({
      bid_id: 'lead-105',
      source_id: 105,
      source_kind_label: 'Portal',
      lead_source: 'customer_portal',
      lead_source_filter: 'portal',
      project_title: 'Portal Roof Request',
      customer_name: 'Portal Customer',
    }),
    makeOpportunity({
      bid_id: 'lead-106',
      source_id: 106,
      source_kind_label: 'Marketplace',
      lead_source: 'marketplace',
      lead_source_filter: 'marketplace',
      project_title: 'Marketplace Drywall Request',
      customer_name: 'Marketplace Customer',
    }),
    makeOpportunity({
      bid_id: 'lead-107',
      source_id: 107,
      source_kind_label: 'Manual',
      lead_source: 'manual',
      lead_source_filter: 'manual',
      project_title: 'Manual Paint Request',
      customer_name: 'Manual Customer',
    }),
  ];
  await mockUnifiedOpportunityPipeline(page, rows);

  await page.goto('/app/opportunities?source=website', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('contractor-bids-title')).toContainText('Opportunities');
  await expect(page.getByTestId('bids-summary-website-leads')).toHaveCount(0);
  await expect(page.getByTestId('workspace-source-chips')).toHaveCount(0);
  await expect(page.getByTestId('contractor-trust-score-card')).toHaveCount(0);
  await expect(page.getByText('Trust Score')).toHaveCount(0);
  await expect(page.getByText('Profile Strength')).toHaveCount(0);
  await expect(page.getByTestId('lead-row-lead-101')).toContainText('Website Customer');
  await expect(page.getByTestId('lead-source-lead-101')).toContainText('Website');
  await expect(page.getByTestId('lead-row-lead-102')).toHaveCount(0);

  await page.goto('/app/opportunities?source=public_profile', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('lead-row-lead-101')).toContainText('Website Customer');
  await expect(page.getByTestId('lead-row-lead-102')).toContainText('Profile Customer');
  await expect(page.getByTestId('lead-row-lead-103')).toContainText('QR Customer');
  await expect(page.getByTestId('lead-row-lead-104')).toContainText('Landing Customer');
  await expect(page.getByTestId('lead-row-lead-105')).toHaveCount(0);

  await page.goto('/app/opportunities?source=website', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('lead-row-lead-101')).toContainText('Website Customer');
  await expect(page.getByTestId('lead-row-lead-104')).toHaveCount(0);

  await page.goto('/app/opportunities?source=landing', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('lead-row-lead-104')).toContainText('Landing Customer');

  await page.goto('/app/opportunities?source=qr', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('lead-row-lead-103')).toContainText('QR Customer');

  await page.goto('/app/opportunities?source=portal', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('lead-row-lead-105')).toContainText('Portal Customer');

  await page.goto('/app/opportunities?source=marketplace', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('lead-row-lead-106')).toContainText('Marketplace Customer');

  await page.goto('/app/opportunities?source=manual', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('lead-row-lead-107')).toContainText('Manual Customer');
});

test('opening a public website opportunity uses the unified detail and agreement handoff', async ({ page }) => {
  await mockUnifiedOpportunityPipeline(page, [
    makeOpportunity({
      bid_id: 'lead-101',
      source_id: 101,
      source_kind: 'quote_request',
      source_kind_label: 'Website',
      lead_source: 'quote_request',
      lead_source_filter: 'website',
      is_website_lead: true,
      is_new_website_lead: true,
      project_title: 'Website Concrete Patio',
      customer_name: 'Website Customer',
      next_action: { key: 'convert_to_agreement', label: 'Convert to Agreement', target: '' },
    }),
  ]);

  await page.goto('/app/opportunities?source=website', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('lead-row-lead-101').click();

  await expect(page.getByTestId('bids-detail-drawer')).toBeVisible();
  await expect(page.getByTestId('opportunity-review-tab-overview')).toHaveClass(/bg-slate-900/);
  await expect(page.getByTestId('opportunity-overview-tab-panel')).toContainText('Overview');
  await expect(page.getByTestId('opportunity-overview-tab-panel')).toContainText('Website Concrete Patio');
  await expect(page.getByTestId('opportunity-overview-tab-panel')).toContainText('Website Customer');
  await expect(page.getByTestId('lead-action-section')).toContainText('Recommended Next Steps');
  await expect(page.getByTestId('lead-action-section')).toContainText('Convert to Agreement');
  await page.getByTestId('opportunity-review-tab-project').click();
  await expect(page.getByTestId('lead-overview')).toContainText('Project Details');
  await page.getByTestId('opportunity-review-tab-next').click();
  await expect(page.getByTestId('schedule-estimate-action')).toContainText('Schedule Estimate');
  await expect(page.getByTestId('lead-detail-container')).toContainText('Website Concrete Patio');
  await expect(page.getByTestId('lead-detail-container')).toContainText('Website Customer');
  await page.getByTestId('opportunity-review-tab-history').click();
  await expect(page.getByTestId('request-signals-section')).toBeVisible();

  await page.getByRole('button', { name: 'Close bid details' }).click();
  await page.getByTestId('lead-row-action-lead-101').click();
  await expect(page.getByTestId('convert-to-agreement-panel')).toBeVisible();
});
