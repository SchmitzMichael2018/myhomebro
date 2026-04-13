import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 654;

async function installBaseMocks(page) {
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
        email: 'step2-workflow@myhomebro.local',
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

  await page.route('**/api/projects/contractors/me/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        ai: { access: 'included', enabled: true, unlimited: true },
      }),
    });
  });

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 1, value: 'Remodel', label: 'Remodel', owner_type: 'system' }],
      }),
    });
  });

  await page.route('**/api/projects/project-subtypes/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 10, value: 'Kitchen Remodel', label: 'Kitchen Remodel', owner_type: 'system' }],
      }),
    });
  });

  await page.route('**/api/projects/homeowners**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 1, company_name: 'Demo Customer', full_name: 'Jordan Demo' }],
      }),
    });
  });

  await page.route('**/api/projects/templates/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });
}

async function installStep2Mocks(page, { agreement, estimateResponse, milestones }) {
  await installBaseMocks(page);

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(agreement),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?\?.*agreement=654.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: milestones ?? buildMilestones(),
      }),
    });
  });

  await page.route(`**/api/projects/agreements/${AGREEMENT_ID}/estimate-preview/`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(estimateResponse),
    });
  });
}

function buildMilestones(overrides) {
  const base = [
    {
      id: 901,
      agreement: AGREEMENT_ID,
      order: 1,
      title: 'Demo & Prep',
      description: 'Protect work area and demo existing finishes.',
      amount: '4000.00',
      start_date: '2026-04-01',
      completion_date: '2026-04-02',
      normalized_milestone_type: 'demolition',
    },
    {
      id: 902,
      agreement: AGREEMENT_ID,
      order: 2,
      title: 'Install & Finish',
      description: 'Install cabinets, finishes, and fixtures.',
      amount: '12000.00',
      start_date: '2026-04-03',
      completion_date: '2026-04-08',
      normalized_milestone_type: 'installation',
    },
  ];
  return overrides ?? base;
}

function buildAgreement(overrides = {}) {
  return {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Kitchen Remodel Agreement',
    title: 'Kitchen Remodel Agreement',
    description: 'Kitchen remodel with upgraded finishes.',
    total_cost: '25000.00',
    project_class: 'residential',
    project_type: 'Remodel',
    project_subtype: 'Kitchen Remodel',
    project_address_city: 'San Antonio',
    project_address_state: 'TX',
    start: '2026-04-01',
    selected_template_id: 55,
    selected_template: { id: 55, name: 'Kitchen Remodel Starter' },
    ai_scope: {
      answers: {
        finish_level: 'premium',
        demolition_required: 'yes',
      },
      questions: [],
    },
    status: 'draft',
    payment_structure: 'simple',
    ...overrides,
  };
}

function buildEstimateResponse() {
  return {
    suggested_total_price: '25300.00',
    suggested_price_low: '22770.00',
    suggested_price_high: '27830.00',
    suggested_duration_days: 12,
    suggested_duration_low: 10,
    suggested_duration_high: 13,
    confidence_level: 'medium',
    confidence_reasoning: 'Moderate confidence based on project matches.',
    template_used: 'Kitchen Remodel Starter',
    benchmark_source: 'seeded_plus_learned',
    learned_benchmark_used: true,
    source_metadata: {
      template_weight: 0.6,
      learned_weight: 0.4,
    },
    milestone_suggestions: [
      {
        milestone_id: 901,
        title: 'Demo & Prep',
        suggested_amount: '5300.00',
        suggested_duration_days: 3,
        suggested_order: 1,
      },
      {
        milestone_id: 902,
        title: 'Install & Finish',
        suggested_amount: '20000.00',
        suggested_duration_days: 9,
        suggested_order: 2,
      },
    ],
    price_adjustments: [],
    timeline_adjustments: [],
  };
}

test('residential step 2 uses lightweight homeowner-friendly planning language', async ({ page }) => {
  await installStep2Mocks(page, {
    agreement: buildAgreement({
      project_class: 'residential',
      payment_structure: 'simple',
    }),
    estimateResponse: buildEstimateResponse(),
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('step2-workflow-panel')).toContainText('Residential Milestone Planner');
  await expect(page.getByTestId('step2-workflow-panel')).toContainText('Homeowner-friendly workflow');
  await expect(page.getByTestId('step2-project-class-label')).toContainText('Residential');
  await expect(page.getByTestId('step2-estimate-mode-badge')).toContainText('Residential');
  await expect(page.getByTestId('step2-commercial-payment-overview')).toHaveCount(0);
  await expect(page.getByText('Simple milestone planning')).toHaveCount(0);
  await expect(page.getByText('Suggested share: 21%')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Amount' })).toBeVisible();
});

test('commercial step 2 uses structured schedule and payment-aware guidance', async ({ page }) => {
  await installStep2Mocks(page, {
    agreement: buildAgreement({
      project_class: 'commercial',
      payment_structure: 'progress',
      project_subtype: 'Commercial Interior',
      selected_template: { id: 55, name: 'Commercial Interior Starter' },
    }),
    estimateResponse: buildEstimateResponse(),
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('step2-workflow-panel')).toContainText('Commercial Schedule Builder');
  await expect(page.getByTestId('step2-project-class-label')).toContainText('Commercial');
  await expect(page.getByTestId('step2-estimate-mode-badge')).toContainText('Commercial');
  await expect(page.getByTestId('step2-commercial-payment-overview')).toBeVisible();
  await expect(page.getByTestId('step2-commercial-contract-value')).toContainText('$25,000.00');
  await expect(page.getByTestId('step2-commercial-allocated-value')).toContainText('$16,000.00');
  await expect(page.getByTestId('step2-commercial-unallocated-value')).toContainText('$9,000.00');
  await expect(page.getByTestId('step2-commercial-payment-structure')).toContainText('Progress Payments');
  await expect(page.getByTestId('step2-commercial-retainage-status')).toContainText('Disabled');
  await expect(page.getByTestId('step2-commercial-status-allocation')).toContainText('Under Allocated');
  await expect(page.getByTestId('step2-commercial-status-readiness')).toContainText('Progress / Draw Needs Review');
  await expect(page.getByTestId('step2-commercial-status-retainage')).toHaveCount(0);
  await expect(page.getByText('Supports draw-request planning after signing.')).toBeVisible();
  await expect(page.getByText('Schedule share: 25%')).toBeVisible();
  await expect(page.getByText('At contract value:')).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Scheduled Value' })).toBeVisible();
  await expect(page.getByText('Commercial Estimate Summary')).toBeVisible();
});

test('commercial payment overview treats near-match totals as fully allocated and ready', async ({ page }) => {
  await installStep2Mocks(page, {
    agreement: buildAgreement({
      project_class: 'commercial',
      payment_structure: 'progress',
      retainage_percent: '10.00',
      total_cost: '25000.00',
    }),
    milestones: buildMilestones([
      {
        id: 901,
        agreement: AGREEMENT_ID,
        order: 1,
        title: 'Mobilization',
        description: 'Initial setup and procurement.',
        amount: '13000.00',
        start_date: '2026-04-01',
        completion_date: '2026-04-03',
        normalized_milestone_type: 'mobilization',
      },
      {
        id: 902,
        agreement: AGREEMENT_ID,
        order: 2,
        title: 'Rough & Finish',
        description: 'Field execution and closeout items.',
        amount: '11999.995',
        start_date: '2026-04-04',
        completion_date: '2026-04-10',
        normalized_milestone_type: 'installation',
      },
    ]),
    estimateResponse: buildEstimateResponse(),
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('step2-commercial-allocated-value')).toContainText('$25,000.00');
  await expect(page.getByTestId('step2-commercial-unallocated-value')).toContainText('$0.00');
  await expect(page.getByTestId('step2-commercial-retainage-status')).toContainText('Enabled at 10.00%');
  await expect(page.getByTestId('step2-commercial-status-allocation')).toContainText('Fully Allocated');
  await expect(page.getByTestId('step2-commercial-status-retainage')).toContainText('Retainage Enabled 10.00%');
  await expect(page.getByTestId('step2-commercial-status-readiness')).toContainText('Progress / Draw Ready');
});

test('commercial payment overview flags over allocation cleanly', async ({ page }) => {
  await installStep2Mocks(page, {
    agreement: buildAgreement({
      project_class: 'commercial',
      payment_structure: 'simple',
      total_cost: '25000.00',
    }),
    milestones: buildMilestones([
      {
        id: 901,
        agreement: AGREEMENT_ID,
        order: 1,
        title: 'Phase 1',
        description: 'Work package one.',
        amount: '15000.00',
        start_date: '2026-04-01',
        completion_date: '2026-04-03',
        normalized_milestone_type: 'mobilization',
      },
      {
        id: 902,
        agreement: AGREEMENT_ID,
        order: 2,
        title: 'Phase 2',
        description: 'Work package two.',
        amount: '11000.00',
        start_date: '2026-04-04',
        completion_date: '2026-04-10',
        normalized_milestone_type: 'installation',
      },
    ]),
    estimateResponse: buildEstimateResponse(),
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('step2-commercial-payment-structure')).toContainText('Commercial Milestones');
  await expect(page.getByTestId('step2-commercial-unallocated-value')).toContainText('$0.00');
  await expect(page.getByText('Over by $1,000.00')).toBeVisible();
  await expect(page.getByTestId('step2-commercial-status-allocation')).toContainText('Over Allocated');
  await expect(page.getByTestId('step2-commercial-status-readiness')).toContainText('Schedule Needs Review');
});
