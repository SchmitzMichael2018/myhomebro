import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 321;

async function installBaseAuthMocks(page) {
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

async function installAgreementWizardMocks(page, { estimateResponse }) {
  await installBaseAuthMocks(page);
  const agreementResponse = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Kitchen Remodel Agreement',
    title: 'Kitchen Remodel Agreement',
    description: 'Kitchen remodel with upgraded finishes.',
    total_cost: '25000.00',
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
  };
  expect(agreementResponse.total_cost, 'Step 2 estimate test agreements must include total_cost').toBeTruthy();

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`), async (route) => {
    const request = route.request();
    if (request.method() === 'PATCH') {
      const payload = request.postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...agreementResponse,
          ai_scope: {
            answers:
              payload?.ai_scope?.answers || {
                finish_level: 'premium',
                demolition_required: 'yes',
              },
            questions: [],
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(agreementResponse),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?\?.*agreement=321.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 801,
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
            id: 802,
            agreement: AGREEMENT_ID,
            order: 2,
            title: 'Install & Finish',
            description: 'Install cabinets, finishes, and fixtures.',
            amount: '12000.00',
            start_date: '2026-04-03',
            completion_date: '2026-04-08',
            normalized_milestone_type: 'installation',
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/agreements/321/estimate-preview/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(estimateResponse),
    });
  });
}

test('step 2 estimate summary, details, budget guidance, and milestone advisory UI render without overwriting milestone amounts', async ({
  page,
}) => {
  await installAgreementWizardMocks(page, {
    estimateResponse: {
      suggested_total_price: '25300.00',
      suggested_price_low: '22770.00',
      suggested_price_high: '27830.00',
      suggested_duration_days: 12,
      suggested_duration_low: 10,
      suggested_duration_high: 13,
      milestone_suggestions: [
        {
          milestone_id: 801,
          title: 'Demo & Prep',
          suggested_amount: '5300.00',
          suggested_duration_days: 3,
          suggested_order: 1,
          source: 'existing_milestone',
          source_note: 'Demolition increased the first milestone.',
        },
        {
          milestone_id: 802,
          title: 'Install & Finish',
          suggested_amount: '20000.00',
          suggested_duration_days: 9,
          suggested_order: 2,
          source: 'existing_milestone',
          source_note: 'Premium finish selections increased install cost.',
        },
      ],
      price_adjustments: [
        { label: 'Finish level', amount: '2800.00', reason: 'Premium finish selections were provided.' },
        { label: 'Demolition', amount: '1500.00', reason: 'Demolition was included.' },
      ],
      timeline_adjustments: [{ label: 'Demolition', days: 2, reason: 'Demo added prep time.' }],
      explanation_lines: [
        'Started from seeded benchmark `template_linked_profile` for `Remodel`.',
        'Finish level: Premium finish selections were provided.',
      ],
      benchmark_source: 'seeded_plus_learned',
      benchmark_match_scope: 'template_linked_profile',
      learned_benchmark_used: true,
      seeded_benchmark_used: true,
      template_used: 'Kitchen Remodel Starter',
      confidence_level: 'medium',
      confidence_reasoning:
        'Confidence is moderate because a seeded benchmark matched the project family and region.',
      structured_result_version: '2026-03-26-estimator-v1',
      source_metadata: {
        template_weight: '0.60',
        learned_weight: '0.40',
        seeded_region_scope: 'city',
        seeded_normalized_region_key: 'US-TX-SAN_ANTONIO',
        learned_clarification_signature: 'abc123',
      },
    },
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step2-estimate-panel')).toBeVisible();
  await expect(page.getByTestId('step2-estimate-total')).toContainText('$22,770.00');
  await expect(page.getByTestId('step2-estimate-total')).toContainText('$27,830.00');
  await expect(page.getByTestId('step2-estimate-duration')).toContainText('10 days');
  await expect(page.getByTestId('step2-estimate-duration')).toContainText('13 days');
  await expect(page.getByTestId('step2-estimate-confidence')).toContainText('Moderate');
  await expect(page.getByTestId('step2-estimate-source')).toContainText('Kitchen Remodel Starter');
  await expect(
    page
      .getByTestId('step2-estimate-panel')
      .getByText('Based on Kitchen Remodel Starter defaults and similar completed city-level jobs.')
      .first()
  ).toBeVisible();

  const estimateDetails = page.locator('details').filter({ has: page.getByText('Estimate details') }).first();
  await expect(estimateDetails).not.toHaveAttribute('open', /open/);
  await estimateDetails.locator('summary').click();
  await expect(estimateDetails).toHaveAttribute('open', '');
  await expect(page.getByText('Template defaults:')).toBeVisible();
  await expect(page.getByText('60%')).toBeVisible();
  await expect(page.getByText('Learned job data:')).toBeVisible();
  await expect(page.getByText('40%')).toBeVisible();
  await expect(estimateDetails.getByText('Finish level').first()).toBeVisible();
  await expect(estimateDetails.getByText('Demolition').first()).toBeVisible();
  await estimateDetails.locator('summary').click();
  await expect(estimateDetails).not.toHaveAttribute('open', /open/);

  await expect(page.getByTestId('step2-milestone-amount-801')).toContainText('$4,000.00');
  await expect(page.getByTestId('step2-milestone-amount-802')).toContainText('$12,000.00');

  await expect(page.getByText('Suggested share: 21%')).toBeVisible();
  await expect(page.getByText('Suggested share: 79%')).toBeVisible();

  await page.getByTestId('step2-project-budget-input').fill('30000');
  await expect(page.getByText('At entered budget: $6,285.00')).toBeVisible();
  await expect(page.getByText('At entered budget: $23,715.00')).toBeVisible();

  await expect(page.getByTestId('step2-milestone-amount-801')).toContainText('$4,000.00');
  await expect(page.getByTestId('step2-milestone-amount-802')).toContainText('$12,000.00');
});

test('step 2 estimate fallback messaging renders for template-only low-confidence estimates', async ({
  page,
}) => {
  await installAgreementWizardMocks(page, {
    estimateResponse: {
      suggested_total_price: '18000.00',
      suggested_price_low: '15300.00',
      suggested_price_high: '20700.00',
      suggested_duration_days: 9,
      suggested_duration_low: 7,
      suggested_duration_high: 11,
      milestone_suggestions: [
        {
          milestone_id: 801,
          title: 'Demo & Prep',
          suggested_amount: '5000.00',
          suggested_duration_days: 2,
          suggested_order: 1,
          source: 'existing_milestone',
        },
        {
          milestone_id: 802,
          title: 'Install & Finish',
          suggested_amount: '13000.00',
          suggested_duration_days: 7,
          suggested_order: 2,
          source: 'existing_milestone',
        },
      ],
      price_adjustments: [],
      timeline_adjustments: [],
      explanation_lines: ['Started from seeded benchmark `template_linked_profile` for `Remodel`.'],
      benchmark_source: 'seeded_only',
      benchmark_match_scope: 'template_linked_profile',
      learned_benchmark_used: false,
      seeded_benchmark_used: true,
      template_used: 'Kitchen Remodel Starter',
      confidence_level: 'low',
      confidence_reasoning: 'Confidence is lower because the estimate is leaning on broader seeded defaults.',
      structured_result_version: '2026-03-26-estimator-v1',
      source_metadata: {
        template_weight: '1.00',
        learned_weight: '0.00',
        seeded_region_scope: 'city',
        seeded_normalized_region_key: 'US-TX-SAN_ANTONIO',
        learned_clarification_signature: '',
      },
    },
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step2-estimate-panel')).toBeVisible();
  await expect(
    page.getByText(
      'No strong learned benchmark is available yet, so this estimate is leaning on template baseline guidance.'
    )
  ).toBeVisible();
  await expect(
    page.getByText(
      'Limited completed-job data means these numbers should be treated as advisory planning guidance.'
    )
  ).toBeVisible();
  await expect(page.getByTestId('step2-estimate-confidence')).toContainText('Preliminary estimate');
  await expect(
    page
      .getByTestId('step2-estimate-panel')
      .getByText('Based on Kitchen Remodel Starter defaults and current project details.')
      .first()
  ).toBeVisible();
});
