import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 321;

function agreementPayload(overrides = {}) {
  return {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Kitchen Activation Project',
    title: 'Kitchen Activation Project',
    homeowner_name: 'Casey Customer',
    homeowner_email: 'casey@example.com',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    status: 'funded',
    signature_is_satisfied: true,
    is_fully_signed: true,
    signed_by_contractor: true,
    signed_by_homeowner: true,
    escrow_funded: true,
    escrow_funded_amount: '6500.00',
    total_cost: '6000.00',
    incidentals_reserve_amount: '500.00',
    planning_assumptions: {
      planned_start_date: '2026-08-03',
      planned_finish_date: '2026-08-14',
      planned_duration_days: 10,
      planned_crew_size: 3,
      planned_labor_hours: 240,
      planning_confidence: 82,
      planning_priority: 'balanced',
      include_weekends: false,
      planning_notes: 'Saved planning assumptions are available.',
      planning_capability_mix: [{ capability: 'Carpentry', count: 2, available: 3 }],
    },
    planning_validation_status: 'needs_review',
    planning_validation_checked_at: '2026-07-06T12:00:00Z',
    planning_validation_summary: {
      status: 'needs_review',
      label: 'Needs Review',
      reason: 'Timeline overlaps committed work or lacks complete planning context.',
      recommended_timeline: {
        start_date: '2026-08-17',
        finish_date: '2026-08-28',
        duration_days: 10,
      },
      warnings: [{ type: 'timeline_overlap', message: '1 signed/funded agreement overlaps this planned timeline.' }],
      blockers: [],
    },
    milestones: [
      {
        id: 1,
        order: 1,
        title: 'Demo and prep',
        amount: '2500.00',
        start_date: '2026-08-03',
        completion_date: '2026-08-07',
        completed: false,
      },
    ],
    ...overrides,
  };
}

function activationPreviewPayload(overrides = {}) {
  return {
    agreement_id: AGREEMENT_ID,
    preview_only: true,
    advisory_notice: 'Preview only. No assignments or schedules are created.',
    source_summary: {
      title: 'Kitchen Activation Project',
      status: 'funded',
      payment_mode: 'escrow',
      signature_ready: true,
      funding_ready: true,
      escrow_funded: true,
      incidentals_reserve_amount: '500.00',
    },
    readiness_checklist: [
      { label: 'Agreement signed', ready: true, status: 'ready', detail: 'Signature requirements are satisfied.' },
      { label: 'Funding ready', ready: true, status: 'ready', detail: 'Escrow funding is complete.' },
      { label: 'Milestones available', ready: true, status: 'ready', detail: '1 milestone available.' },
      { label: 'Planning assumptions saved', ready: true, status: 'ready', detail: 'Agreement Wizard planning assumptions are available.' },
    ],
    blockers: [],
    warnings: [{ type: 'incidentals_reserve', message: 'Incidentals Reserve configured at $500.00.' }],
    suggested_schedule: {
      start_date: '2026-08-03',
      finish_date: '2026-08-14',
      duration_days: 10,
      include_weekends: false,
      priority: 'balanced',
      confidence: 82,
    },
    milestone_timeline_summary: [
      {
        id: 1,
        order: 1,
        title: 'Demo and prep',
        start_date: '2026-08-03',
        completion_date: '2026-08-07',
        amount: '2500.00',
      },
    ],
    crew_capability_needs: [
      { capability: 'Carpentry', needed: 2, available: 3, gap: 0, status: 'ready' },
    ],
    material_readiness_notes: [
      { milestone_id: 1, milestone_title: 'Demo and prep', note: 'Confirm cabinet delivery.' },
    ],
    document_summary: { attachment_count: 2, customer_visible_attachment_count: 1 },
    planning_assumptions: agreementPayload().planning_assumptions,
    customer_visible_launch_summary_preview: {
      headline: 'Kitchen Activation Project is being prepared for project kickoff.',
      start_date: '2026-08-03',
      finish_date: '2026-08-14',
      message: 'Your contractor is preparing the project schedule and kickoff details.',
      milestone_count: 1,
    },
    ...overrides,
  };
}

async function installAgreementDetailMocks(page, { agreement = agreementPayload(), activation = activationPreviewPayload() } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 7, type: 'contractor', role: 'contractor_owner', email: 'owner@example.com' }),
    });
  });

  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/activation-preview/?(\\?.*)?$`), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(activation) });
  });

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/funding_preview/?(\\?.*)?$`), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/draws/?(\\?.*)?$`), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/external-payments/?(\\?.*)?$`), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/subcontractor-invitations/?(\\?.*)?$`), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pending_invitations: [], accepted_subcontractors: [] }) });
  });

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(agreement) });
  });

  await page.route('**/api/projects/milestones/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(agreement.milestones || []) });
  });

  await page.route('**/api/projects/subaccounts/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });

  await page.route('**/api/projects/warranties/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.route('**/api/projects/notifications/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });
}

test('Agreement Workspace renders read-only activation preview', async ({ page }) => {
  await installAgreementDetailMocks(page);

  await page.goto(`/app/agreements/${AGREEMENT_ID}/workspace?tab=activation`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('agreement-workspace-panel-activation')).toContainText('Activation Preview');
  await expect(page.getByTestId('agreement-workspace-panel-activation')).toContainText('Preview only. No assignments or schedules are created.');
  await expect(page.getByTestId('agreement-planning-validation-banner')).toContainText('Planning Needs Review');
  await expect(page.getByTestId('agreement-planning-validation-banner')).toContainText('Review Timeline');
  await expect(page.getByTestId('activation-readiness-checklist')).toContainText('Agreement signed');
  await expect(page.getByTestId('activation-readiness-checklist')).toContainText('Funding ready');
  await expect(page.getByTestId('activation-crew-needs')).toContainText('Carpentry');
  await expect(page.getByTestId('activation-milestone-timeline')).toContainText('Demo and prep');
  await expect(page.getByTestId('activation-customer-launch-preview')).toContainText('project kickoff');
});
