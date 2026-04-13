import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 456;

async function installAgreementWizardRoutes(page, agreementState) {
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
        email: 'project-class@myhomebro.local',
      }),
    });
  });

  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ onboarding_status: 'not_started', connected: false }),
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
        results: [
          { id: 10, value: 'Bathroom Remodel', label: 'Bathroom Remodel', project_type: 'Remodel' },
          { id: 11, value: 'Commercial Interior', label: 'Commercial Interior', project_type: 'Remodel' },
        ],
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

  await page.route('**/api/projects/template-recommend**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`), async (route) => {
    const request = route.request();
    if (request.method() === 'PATCH') {
      const patch = request.postDataJSON();
      Object.assign(agreementState, patch);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(agreementState),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(`**/api/projects/agreements/${AGREEMENT_ID}/estimate-preview/`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        suggested_total_price: '25300.00',
        suggested_price_low: '22770.00',
        suggested_price_high: '27830.00',
        suggested_duration_days: 12,
        suggested_duration_low: 10,
        suggested_duration_high: 13,
        confidence_level: 'medium',
        confidence_reasoning: 'Moderate confidence based on project matches.',
        template_used: 'Workflow Split Template',
        benchmark_source: 'seeded_plus_learned',
        learned_benchmark_used: true,
        source_metadata: {
          template_weight: 0.6,
          learned_weight: 0.4,
        },
        milestone_suggestions: [],
        price_adjustments: [],
        timeline_adjustments: [],
      }),
    });
  });

  await page.route(/\/api\/projects\/attachments\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });
}

test('step 1 project class drives commercial payment controls', async ({ page }) => {
  const agreementState = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Workflow Split Test',
    title: 'Workflow Split Test',
    project_class: 'residential',
    project_type: 'Remodel',
    project_subtype: 'Bathroom Remodel',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    retainage_percent: '0.00',
    total_cost: '25000.00',
    description: 'Residential workflow by default.',
    homeowner: 1,
    status: 'draft',
    compliance_warning: { warning_level: 'none', message: '' },
  };

  await installAgreementWizardRoutes(page, agreementState);

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('agreement-project-class-residential')).toBeVisible();
  await expect(page.getByTestId('agreement-project-class-summary')).toContainText('Residential agreements');
  await expect(page.getByTestId('agreement-payment-structure-progress')).toHaveCount(0);
  await expect(page.getByTestId('agreement-project-class-residential-note')).toBeVisible();

  await page.getByTestId('agreement-project-class-commercial').click();

  await expect(page.getByTestId('agreement-project-class-summary')).toContainText('Commercial agreements');
  await expect(page.getByTestId('agreement-payment-structure-progress')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('agreement-payment-structure-progress').click();

  await expect(page.getByTestId('agreement-retainage-percent-input')).toBeVisible();

  await page.getByTestId('agreement-project-class-residential').click();

  await expect(page.getByTestId('agreement-payment-structure-progress')).toHaveCount(0);
  await expect(page.getByTestId('agreement-retainage-percent-input')).toHaveCount(0);
  await expect(page.getByTestId('agreement-project-class-residential-note')).toBeVisible();
});

test('project class switching mid-session updates Step 2 without stale commercial UI', async ({ page }) => {
  const agreementState = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Mid-session Project Class Test',
    title: 'Mid-session Project Class Test',
    project_class: 'residential',
    project_type: 'Remodel',
    project_subtype: 'Bathroom Remodel',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    retainage_percent: '0.00',
    total_cost: '25000.00',
    description: 'Switch project path and confirm Step 2 updates.',
    homeowner: 1,
    status: 'draft',
    compliance_warning: { warning_level: 'none', message: '' },
  };

  await installAgreementWizardRoutes(page, agreementState);

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await page.getByTestId('agreement-project-class-commercial').click();
  await expect(page.getByTestId('agreement-project-class-summary')).toContainText('Commercial agreements');

  await page.getByRole('button', { name: 'Save & Next' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/agreements/${AGREEMENT_ID}/wizard\\?step=2`));

  await expect(page.getByTestId('step2-workflow-panel')).toContainText('Commercial Schedule Builder');
  await expect(page.getByTestId('step2-project-class-label')).toContainText('Commercial');
  await expect(page.getByTestId('step2-commercial-payment-overview')).toBeVisible();
  await expect(page.getByText('Commercial Payment Planning')).toBeVisible();

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/agreements/${AGREEMENT_ID}/wizard\\?step=1`));

  await page.getByTestId('agreement-project-class-residential').click();
  await expect(page.getByTestId('agreement-project-class-summary')).toContainText('Residential agreements');
  await expect(page.getByTestId('agreement-payment-structure-progress')).toHaveCount(0);

  await page.getByRole('button', { name: 'Save & Next' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/agreements/${AGREEMENT_ID}/wizard\\?step=2`));

  await expect(page.getByTestId('step2-workflow-panel')).toContainText('Residential Milestone Planner');
  await expect(page.getByTestId('step2-project-class-label')).toContainText('Residential');
  await expect(page.getByTestId('step2-commercial-payment-overview')).toHaveCount(0);
  await expect(page.getByText('Commercial Schedule Builder')).toHaveCount(0);
  await expect(page.getByText('Commercial Payment Planning')).toHaveCount(0);
});
