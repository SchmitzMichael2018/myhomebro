import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 912;

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
        email: 'commercial-overview@myhomebro.local',
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
        results: [{ id: 10, value: 'Commercial Interior', label: 'Commercial Interior', owner_type: 'system' }],
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

function buildAgreement(overrides = {}) {
  return {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Commercial Remodel Agreement',
    title: 'Commercial Remodel Agreement',
    description: 'Tenant improvement with phased billing.',
    total_cost: '25000.00',
    project_class: 'commercial',
    project_type: 'Remodel',
    project_subtype: 'Commercial Interior',
    project_address_city: 'Dallas',
    project_address_state: 'TX',
    start: '2026-04-01',
    selected_template_id: 55,
    selected_template: { id: 55, name: 'Commercial Interior Starter' },
    ai_scope: {
      answers: {
        finish_level: 'premium',
      },
      questions: [],
    },
    status: 'draft',
    payment_structure: 'progress',
    ...overrides,
  };
}

function buildMilestones(overrides) {
  return (
    overrides ?? [
      {
        id: 1001,
        agreement: AGREEMENT_ID,
        order: 1,
        title: 'Mobilization',
        description: 'Startup, procurement, and site prep.',
        amount: '4000.00',
        start_date: '2026-04-01',
        completion_date: '2026-04-03',
        normalized_milestone_type: 'mobilization',
      },
      {
        id: 1002,
        agreement: AGREEMENT_ID,
        order: 2,
        title: 'Buildout',
        description: 'Core field execution and finishes.',
        amount: '12000.00',
        start_date: '2026-04-04',
        completion_date: '2026-04-10',
        normalized_milestone_type: 'installation',
      },
    ]
  );
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
    template_used: 'Commercial Interior Starter',
    benchmark_source: 'seeded_plus_learned',
    learned_benchmark_used: true,
    source_metadata: {
      template_weight: 0.6,
      learned_weight: 0.4,
    },
    milestone_suggestions: [
      {
        milestone_id: 1001,
        title: 'Mobilization',
        suggested_amount: '5300.00',
        suggested_duration_days: 3,
        suggested_order: 1,
      },
      {
        milestone_id: 1002,
        title: 'Buildout',
        suggested_amount: '20000.00',
        suggested_duration_days: 9,
        suggested_order: 2,
      },
    ],
    price_adjustments: [],
    timeline_adjustments: [],
  };
}

async function installStep2Mocks(page, { agreement, milestones, estimateResponse }) {
  await installBaseMocks(page);

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(agreement),
    });
  });

  await page.route(new RegExp(`/api/projects/milestones/\\?.*agreement=${AGREEMENT_ID}.*$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: buildMilestones(milestones),
      }),
    });
  });

  await page.route(`**/api/projects/agreements/${AGREEMENT_ID}/estimate-preview/`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(estimateResponse ?? buildEstimateResponse()),
    });
  });
}

test('commercial payment overview renders for commercial agreements and not for residential ones', async ({ page }) => {
  await installStep2Mocks(page, {
    agreement: buildAgreement({ project_class: 'commercial' }),
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('step2-commercial-payment-overview')).toBeVisible();

  await installStep2Mocks(page, {
    agreement: buildAgreement({
      project_class: 'residential',
      payment_structure: 'simple',
      selected_template: { id: 55, name: 'Kitchen Remodel Starter' },
      project_subtype: 'Kitchen Remodel',
      title: 'Kitchen Remodel Agreement',
      project_title: 'Kitchen Remodel Agreement',
    }),
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('step2-commercial-payment-overview')).toHaveCount(0);
});

test('commercial payment overview displays key values and retainage messaging', async ({ page }) => {
  await installStep2Mocks(page, {
    agreement: buildAgreement({
      retainage_percent: '10.00',
      payment_structure: 'progress',
    }),
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('step2-commercial-contract-value')).toContainText('$25,000.00');
  await expect(page.getByTestId('step2-commercial-allocated-value')).toContainText('$16,000.00');
  await expect(page.getByTestId('step2-commercial-unallocated-value')).toContainText('$9,000.00');
  await expect(page.getByTestId('step2-commercial-payment-structure')).toContainText('Progress Payments');
  await expect(page.getByTestId('step2-commercial-retainage-status')).toContainText('Enabled at 10.00%');
  await expect(
    page.getByText(
      'Retainage is enabled at 10.00%. Final released amounts may differ from scheduled values until retainage is released.'
    )
  ).toBeVisible();
});

test('commercial payment overview updates status for under, fully, and over allocated schedules', async ({ page }) => {
  await installStep2Mocks(page, {
    agreement: buildAgreement({
      payment_structure: 'progress',
      total_cost: '25000.00',
    }),
    milestones: buildMilestones(),
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('step2-commercial-status-allocation')).toContainText('Under Allocated');
  await expect(page.getByTestId('step2-commercial-status-readiness')).toContainText(
    'Needs more allocation before draw planning'
  );

  await installStep2Mocks(page, {
    agreement: buildAgreement({
      payment_structure: 'progress',
      total_cost: '25000.00',
    }),
    milestones: buildMilestones([
      {
        id: 1001,
        agreement: AGREEMENT_ID,
        order: 1,
        title: 'Mobilization',
        description: 'Startup, procurement, and site prep.',
        amount: '13000.00',
        start_date: '2026-04-01',
        completion_date: '2026-04-03',
        normalized_milestone_type: 'mobilization',
      },
      {
        id: 1002,
        agreement: AGREEMENT_ID,
        order: 2,
        title: 'Buildout',
        description: 'Core field execution and finishes.',
        amount: '11999.995',
        start_date: '2026-04-04',
        completion_date: '2026-04-10',
        normalized_milestone_type: 'installation',
      },
    ]),
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('step2-commercial-status-allocation')).toContainText('Fully Allocated');
  await expect(page.getByTestId('step2-commercial-status-readiness')).toContainText('Ready for structured billing');

  await installStep2Mocks(page, {
    agreement: buildAgreement({
      payment_structure: 'simple',
      total_cost: '25000.00',
    }),
    milestones: buildMilestones([
      {
        id: 1001,
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
        id: 1002,
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
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('step2-commercial-status-allocation')).toContainText('Over Allocated');
  await expect(page.getByTestId('step2-commercial-status-readiness')).toContainText('Commercial schedule taking shape');
  await expect(page.getByText('Currently over by $1,000.00.')).toBeVisible();
});
