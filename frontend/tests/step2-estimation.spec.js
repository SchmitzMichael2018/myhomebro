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

async function installStep2AutoDraftRoutes(
  page,
  { agreement, projectTypes, projectSubtypes, milestoneState, estimateResponse }
) {
  await installBaseAuthMocks(page);

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: projectTypes }),
    });
  });

  await page.route('**/api/projects/project-subtypes/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: projectSubtypes }),
    });
  });

  await page.route(
    new RegExp(`/api/projects/agreements/${agreement.id}/?(\\?.*)?$`),
    async (route) => {
      const request = route.request();
      if (request.method() === 'GET' || request.method() === 'PATCH') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(agreement),
        });
        return;
      }

      await route.fallback();
    }
  );

  await page.route(/\/api\/projects\/milestones\/?(\?.*)?$/, async (route) => {
    const request = route.request();

    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: milestoneState.items }),
      });
      return;
    }

    if (request.method() === 'POST') {
      const payload = request.postDataJSON();
      milestoneState.createCount += 1;
      const created = {
        id: milestoneState.nextId++,
        agreement: agreement.id,
        order: milestoneState.items.length + 1,
        title: payload.title,
        description: payload.description || '',
        amount: payload.amount,
        start_date: payload.start_date || null,
        completion_date: payload.completion_date || null,
      };
      milestoneState.items = [...milestoneState.items, created];

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created),
      });
      return;
    }

    await route.fallback();
  });

  await page.route(/\/api\/projects\/milestones\/\d+\/?(\?.*)?$/, async (route) => {
    const request = route.request();
    const match = request.url().match(/\/api\/projects\/milestones\/(\d+)\/?(\?.*)?$/);
    const milestoneId = Number(match?.[1]);
    const index = milestoneState.items.findIndex((item) => item.id === milestoneId);

    if (request.method() === 'PATCH' && index >= 0) {
      const payload = request.postDataJSON();
      milestoneState.items[index] = {
        ...milestoneState.items[index],
        ...payload,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(milestoneState.items[index]),
      });
      return;
    }

    if (request.method() === 'DELETE') {
      milestoneState.items = milestoneState.items.filter((item) => item.id !== milestoneId);
      await route.fulfill({
        status: 204,
        body: '',
      });
      return;
    }

    await route.fallback();
  });

  await page.route(/\/api\/projects\/agreements\/321\/estimate-preview\/?(\?.*)?$/, async (route) => {
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
          allocation_percent: 0.21,
          source: 'existing_milestone',
          source_note: 'Demolition increased the first milestone.',
        },
        {
          milestone_id: 802,
          title: 'Install & Finish',
          suggested_amount: '20000.00',
          suggested_duration_days: 9,
          suggested_order: 2,
          allocation_percent: 0.79,
          source: 'existing_milestone',
          source_note: 'Premium finish selections increased install cost.',
        },
      ],
      suggested_plan: {
        project_family_key: 'kitchen_remodel',
        project_family_label: 'Kitchen Remodel',
        project_scope_summary: 'Kitchen remodel with upgraded finishes and fixtures.',
        recommended_project_type: 'Kitchen Remodel',
        recommended_project_subtype: 'Kitchen Remodel',
        suggested_workflow: 'Install + removal',
        suggested_template_label: 'Kitchen Remodel Template',
        recommended_template_name: 'Kitchen Remodel Starter',
        suggested_budget_low: '22770.00',
        suggested_budget_high: '27830.00',
        suggested_duration_low_days: 10,
        suggested_duration_high_days: 13,
        suggested_budget_center: '25300.00',
        suggested_duration_days: 12,
        confidence_level: 'medium',
        confidence_reasoning: 'Project type and clarifications provide a practical starting plan.',
        explanation_points: [
          'Cabinet installation was detected with removal or replacement work.',
          'Materials or cabinets appear to be on site already.',
          'Related finish work was included in the scope.',
        ],
        milestones: [
          {
            order: 1,
            title: 'Demo and Prep',
            allocation_percent: 0.21,
            suggested_duration_days: 3,
            suggested_amount_low: '4772.70',
            suggested_amount_high: '5844.30',
            note: 'Protect work area and demo existing finishes.',
          },
          {
            order: 2,
            title: 'Install and Finish',
            allocation_percent: 0.79,
            suggested_duration_days: 9,
            suggested_amount_low: '17997.30',
            suggested_amount_high: '21985.70',
            note: 'Install cabinets, finishes, and fixtures.',
          },
        ],
        flags: {
          materials_ready: true,
          inspection_requested: false,
          urgent_or_damage: false,
          multi_area: false,
          one_area: true,
        },
        learning_ready: {
          learning_key: 'kitchen_remodel:install_removal:Remodel:Kitchen Remodel:2:no_photos:seeded',
          benchmark_source: 'seeded_plus_learned',
          benchmark_match_scope: 'template_linked_profile',
          seeded_benchmark_used: true,
          learned_benchmark_used: true,
          clarification_count: 2,
          photo_count: 0,
        },
        source_metadata: {
          family_key: 'kitchen_remodel',
          scope_mode: 'install_removal',
          recommendation_basis: 'deterministic_first',
          blended_benchmark: {
            source_type: 'blended_all',
            confidence: 'medium',
            platform: {
              sample_size: 82,
            },
            regional: {
              sample_size: 14,
            },
            contractor: {
              sample_size: 11,
            },
          },
        },
      },
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
      contractor_insights: {
        project_family_key: 'kitchen_remodel',
        project_family_label: 'Kitchen Remodel',
        source_type: 'blended_all',
        confidence: 'medium',
        sample_sizes: {
          platform: 82,
          regional: 14,
          contractor: 11,
        },
        pricing_delta_vs_platform: {
          value: '8.5',
          direction: 'above',
          explanation: 'Your pricing is 8.5% above the platform average.',
        },
        duration_delta_vs_platform: {
          value: '12.5',
          direction: 'above',
          explanation: 'Your duration is 12.5% longer than the platform average.',
        },
        milestone_count_delta: {
          value: 1,
          direction: 'above',
          explanation: 'Your milestone structure uses 1 more step than the platform baseline.',
        },
        dispute_rate_comparison: {
          value: '2.4%',
          market_value: '3.1%',
          direction: 'below',
          explanation: 'Your dispute rate is below similar projects in your market.',
        },
        explanation_strings: [
          'Your pricing runs 8.5% above the platform average for this project family.',
          'Your duration is 12.5% longer than the platform average.',
          'Your market history includes 14 completed projects, which helps sharpen the comparison.',
        ],
        suggested_adjustments: [
          {
            suggestion_type: 'pricing',
            suggestion_text: 'You may want to review pricing for this type of project to stay competitive.',
            suggestion_confidence: 'medium',
          },
          {
            suggestion_type: 'duration',
            suggestion_text: 'Projects like this typically complete faster. Consider tightening your timeline if the scope is straightforward.',
            suggestion_confidence: 'medium',
          },
          {
            suggestion_type: 'scope_clarity',
            suggestion_text: 'Clearer scope notes and exclusions may help reduce disputes and amendments.',
            suggestion_confidence: 'medium',
          },
        ],
      },
    },
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  await expect(page.getByTestId('step2-work-plan-summary')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('step2-work-plan-summary')).not.toContainText('Review the work plan');
  await expect(page.getByTestId('step2-work-plan-summary')).toContainText('milestone');
  await expect(page.getByTestId('step2-work-plan-summary')).toContainText('Path:');
  await expect(page.getByTestId('step2-plan-guidance-card')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('step2-plan-guidance-card')).toContainText('Plan Guidance');
  await expect(page.getByTestId('step2-plan-guidance-card')).toContainText('Most contractors use');
  await expect(page.getByTestId('step2-plan-guidance-card')).toContainText('Typical duration:');
  await expect(page.getByTestId('step2-plan-guidance-card')).toContainText('Typical total range:');
  await expect(page.getByTestId('step2-pricing-summary-card')).toBeVisible();
  await expect(page.getByTestId('step2-pricing-summary-card')).toContainText('Pricing summary');
  await expect(page.getByTestId('step2-pricing-summary-card')).toContainText('Suggested range:');
  await expect(page.getByTestId('step2-pricing-summary-card')).toContainText('Current total:');
  await expect(page.getByTestId('step2-pricing-summary-card')).toContainText('Below range');
  await expect(page.getByTestId('step2-pricing-summary-card')).toContainText(
    'Based on similar projects and milestone structure.'
  );
  await expect(page.getByTestId('step2-plan-guidance-card')).toContainText('Generate Suggested Milestones');
  await expect(page.getByTestId('step2-generate-suggested-milestones')).toBeVisible();
  await expect(page.getByTestId('step2-plan-guidance-card')).toContainText('Pricing is based on similar projects and milestone structure.');
  await expect(page.getByTestId('step2-rebalance-milestones')).toBeVisible();
  await expect(page.getByTestId('step2-apply-suggested-timeline')).toBeVisible();
  await expect(page.getByTestId('step2-apply-pricing-guidance')).toHaveCount(0);
  await expect(page.getByTestId('step2-improve-with-ai')).toHaveCount(0);
  await expect(page.getByTestId('step2-save-as-template')).toBeVisible();
  await expect(page.getByTestId('step2-milestone-card-801')).toBeVisible();
  await expect(page.getByTestId('step2-milestone-card-802')).toBeVisible();
  await expect(page.getByTestId('step2-milestone-number-801')).toHaveText('1');
  await expect(page.getByTestId('step2-milestone-number-802')).toHaveText('2');
  await expect(page.getByTestId('step2-milestone-row-801')).toHaveCount(0);
  await expect(page.getByTestId('step2-target-project-total')).toBeVisible();
  await expect(page.getByTestId('step2-target-project-total')).toHaveValue('25300');
  await expect(page.getByTestId('step2-pricing-explanation-details')).toBeVisible();
  const pricingExplanation = page.getByTestId('step2-pricing-explanation-details');
  await pricingExplanation.locator('summary').click();
  await expect(pricingExplanation).toHaveAttribute('open', '');
  await expect(pricingExplanation).toContainText('Why these amounts?');
  await expect(pricingExplanation).toContainText(
    'Pricing uses the project estimate, milestone phase, and similar project guidance.'
  );
  await page.getByTestId('step2-milestone-summary-801').click();
  await expect(page.getByTestId('step2-milestone-editor-801')).toBeVisible();
  const milestone801CardBefore = page.getByTestId('step2-milestone-card-801');
  await page.getByTestId('step2-milestone-summary-802').click();
  await expect(page.getByTestId('step2-milestone-editor-802')).toBeVisible();
  const milestone802CardBefore = page.getByTestId('step2-milestone-card-802');
  const milestone801Before = Number(
    ((await milestone801CardBefore.textContent()) || "").match(/\$([0-9,]+(?:\.\d{2})?)/)?.[1].replace(/,/g, "") || 0
  );
  const milestone802Before = Number(
    ((await milestone802CardBefore.textContent()) || "").match(/\$([0-9,]+(?:\.\d{2})?)/)?.[1].replace(/,/g, "") || 0
  );
  expect(milestone801Before).toBeGreaterThan(0);
  expect(milestone802Before).toBeGreaterThan(0);

  await page.getByTestId('step2-apply-suggested-timeline').click();
  await expect(page.getByTestId('step2-pricing-feedback-banner')).toBeVisible();
  const milestone801Card = page.getByTestId('step2-milestone-card-801');
  const milestone802Card = page.getByTestId('step2-milestone-card-802');
  await expect(milestone801Card).toBeVisible();
  await expect(milestone802Card).toBeVisible();
  await expect(milestone801Card).toContainText('$4,000.00');
  await expect(milestone802Card).toContainText('$12,000.00');
  const milestoneAmountsAfter = await Promise.all([milestone801Card, milestone802Card].map(async (card) => {
    const text = (await card.textContent()) || '';
    const match = text.match(/\$([0-9,]+(?:\.\d{2})?)/);
    return match ? Number(match[1].replace(/,/g, '')) : 0;
  }));
  const [milestone801After, milestone802After] = milestoneAmountsAfter;
  expect(milestone801After).toBeGreaterThan(0);
  expect(milestone802After).toBeGreaterThan(0);
  expect(milestone801After).toBe(milestone801Before);
  expect(milestone802After).toBe(milestone802Before);

  await expect(page.getByTestId('step2-milestone-share-801')).toBeVisible();
  await expect(page.getByTestId('step2-milestone-share-802')).toBeVisible();
  await expect(page.getByTestId('step2-milestone-share-801')).toContainText(/% of total|Weighted/);
  await expect(page.getByTestId('step2-milestone-share-802')).toContainText(/% of total|Weighted/);

  await page.getByTestId('step2-target-project-total').fill('30000');
  await expect(page.getByTestId('step2-target-project-total')).toHaveValue('30000');
  await page.getByTestId('step2-rebalance-milestones').click();
  const rebalancePrompt = page.getByTestId('step2-pricing-rebalance-confirmation');
  await expect(rebalancePrompt).toBeVisible();
  await expect(rebalancePrompt).toContainText('This will overwrite your current milestone plan.');
  await rebalancePrompt.getByRole('button', { name: 'Rebalance Milestones' }).click();
  await expect(page.getByTestId('step2-pricing-feedback-banner')).toContainText('Milestone pricing updated');
  await expect(page.getByTestId('step2-milestone-share-801')).toContainText(/% of total|Weighted/);
  await expect(page.getByTestId('step2-milestone-share-802')).toContainText(/% of total|Weighted/);
  await expect(page.getByTestId('step2-milestone-share-801')).not.toContainText('Manual');

  const num801BeforeDrag = await page.getByTestId('step2-milestone-number-801').textContent();
  const num802BeforeDrag = await page.getByTestId('step2-milestone-number-802').textContent();
  await page.getByTestId('step2-milestone-drag-handle-802').dragTo(page.getByTestId('step2-milestone-card-801'));
  await expect(page.getByTestId('step2-milestone-number-802')).toHaveText('1');
  await expect(page.getByTestId('step2-milestone-number-801')).toHaveText('2');
  expect(num801BeforeDrag).not.toBe(await page.getByTestId('step2-milestone-number-801').textContent());
  expect(num802BeforeDrag).not.toBe(await page.getByTestId('step2-milestone-number-802').textContent());

  await page.getByTestId('step2-milestone-summary-801').click();
  await page.getByTestId('step2-milestone-amount-801').fill('7777');
  await expect(page.getByTestId('step2-milestone-manual-indicator-801')).toBeVisible();
  await page.getByTestId('step2-rebalance-milestones').click();
  await expect(rebalancePrompt).toBeVisible();
  await expect(rebalancePrompt).toContainText('Keep manually edited amounts?');
  await expect(rebalancePrompt).toContainText('manual milestone');
  await rebalancePrompt
    .getByRole('button', { name: 'Keep manual amounts and rebalance the rest' })
    .click();
  await expect(page.getByTestId('step2-milestone-manual-indicator-801')).toBeVisible();
  await expect(page.getByTestId('step2-milestone-amount-801')).toHaveValue('7777');

  await expect(page.getByTestId('step2-save-as-template')).toBeVisible();
  await expect(page.getByTestId('step2-apply-pricing-guidance')).toHaveCount(0);
  await expect(page.getByTestId('step2-refresh-estimate')).toHaveCount(0);
  await expect(page.getByTestId('step2-apply-estimate-amounts')).toHaveCount(0);
  await expect(page.getByTestId('step2-apply-estimate-timeline')).toHaveCount(0);
  await expect(page.getByTestId('step2-estimate-guidance-details')).toHaveCount(0);
});

test('step 2 generates shed-specific milestone previews and applies or cancels safely', async ({
  page,
}) => {
  const agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Backyard Shed Build',
    title: 'Backyard Shed Build',
    project_type: 'Outdoor',
    project_subtype: 'Shed Build',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description:
      'Build a 12x14 backyard shed with slab foundation, roof, siding, entry door, windows, and cleanup.',
    homeowner: null,
    status: 'draft',
    ai_scope: {
      answers: {},
    },
    compliance_warning: {
      warning_level: 'none',
      message: '',
    },
  };

  const milestoneState = {
    items: [
      {
        id: 801,
        agreement: AGREEMENT_ID,
        order: 1,
        title: 'Existing Prep',
        description: 'Existing prep milestone.',
        amount: '1000.00',
        start_date: '2026-04-01',
        completion_date: '2026-04-02',
        normalized_milestone_type: 'prep',
      },
      {
        id: 802,
        agreement: AGREEMENT_ID,
        order: 2,
        title: 'Existing Finish',
        description: 'Existing finish milestone.',
        amount: '2000.00',
        start_date: '2026-04-03',
        completion_date: '2026-04-04',
        normalized_milestone_type: 'finish',
      },
    ],
    nextId: 900,
    createCount: 0,
  };

  await installStep2AutoDraftRoutes(page, {
    agreement,
    projectTypes: [{ id: 11, value: 'Outdoor', label: 'Outdoor', owner_type: 'system' }],
    projectSubtypes: [
      {
        id: 111,
        value: 'Shed Build',
        label: 'Shed Build',
        owner_type: 'system',
        project_type: 'Outdoor',
      },
    ],
    milestoneState,
    estimateResponse: {
      suggested_total_price: '14500.00',
      suggested_price_low: '13000.00',
      suggested_price_high: '16000.00',
      suggested_duration_days: 9,
      suggested_duration_low: 8,
      suggested_duration_high: 10,
      milestone_suggestions: [],
      suggested_plan: {
        project_family_key: 'shed_build',
        project_family_label: 'Shed Build',
      },
      price_adjustments: [],
      timeline_adjustments: [],
      explanation_lines: [],
      benchmark_source: 'seeded_only',
      learned_benchmark_used: false,
      seeded_benchmark_used: true,
      confidence_level: 'medium',
      confidence_reasoning: 'Advisory shed build estimate.',
      source_metadata: {},
    },
  });

  await page.route(/\/api\/projects\/agreements\/321\/ai\/suggest-milestones\/?(\?.*)?$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        detail: 'OK',
        clarification_shaped: true,
        scope_text: 'Build a 12x14 backyard shed with slab foundation, roof, siding, doors, and cleanup.',
        milestones: [
          {
            title: 'Site Prep and Foundation',
            description: 'Prepare the site and pour or set the foundation.',
            suggested_amount: '2500.00',
            recommended_duration_days: 2,
          },
          {
            title: 'Floor and Framing',
            description: 'Frame the floor, walls, and primary structure.',
            suggested_amount: '3500.00',
            recommended_duration_days: 2,
          },
          {
            title: 'Roof, Siding, and Weatherproofing',
            description: 'Install roof, siding, and exterior weatherproofing.',
            suggested_amount: '4000.00',
            recommended_duration_days: 3,
          },
          {
            title: 'Doors, Windows, and Finish Details',
            description: 'Install doors, windows, trim, and finish details.',
            suggested_amount: '2000.00',
            recommended_duration_days: 1,
          },
          {
            title: 'Final Inspection and Cleanup',
            description: 'Complete inspection, punch list, and cleanup.',
            suggested_amount: '1500.00',
            recommended_duration_days: 1,
          },
        ],
        questions: [],
      }),
    });
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  const generateButton = page.getByTestId('step2-generate-suggested-milestones');
  await expect(generateButton).toBeVisible({ timeout: 15000 });
  await generateButton.click();
  await expect(generateButton).toBeDisabled();
  await expect(page.getByTestId('step2-ai-generation-progress-card')).toBeVisible();
  await expect(generateButton).toContainText('Generating milestones...');

  const previewCard = page.getByTestId('step2-ai-milestone-preview-card');
  await expect(previewCard).toBeVisible({ timeout: 15000 });
  await expect(previewCard).toContainText('Suggested milestones');
  await expect(previewCard).toContainText('This will replace your current milestone plan.');
  await expect(previewCard).toContainText('Site Prep and Foundation');
  await expect(previewCard).toContainText('Floor and Framing');

  await previewCard.getByRole('button', { name: 'Cancel' }).click();
  await expect(previewCard).toHaveCount(0);
  await expect(page.getByText('Existing Prep')).toBeVisible();
  await expect(page.getByText('Existing Finish')).toBeVisible();

  await generateButton.click();
  await expect(previewCard).toBeVisible({ timeout: 15000 });
  await previewCard.getByRole('button', { name: 'Replace Existing Milestones' }).click();

  await expect(page.getByText('Site Prep and Foundation')).toBeVisible();
  await expect(page.getByText('Floor and Framing')).toBeVisible();
  await expect(page.getByText('Existing Prep')).toHaveCount(0);
  await expect(page.getByTestId('step2-ai-milestone-preview-card')).toHaveCount(0);

  const timelineGuidanceButton = page.getByTestId('step2-apply-suggested-timeline');
  await expect(timelineGuidanceButton).toBeVisible();
  await timelineGuidanceButton.click();
  await expect(page.getByTestId('step2-pricing-feedback-banner')).toBeVisible();

  const shedCards = [
    page.getByTestId('step2-milestone-card-ai-1'),
    page.getByTestId('step2-milestone-card-ai-2'),
    page.getByTestId('step2-milestone-card-ai-3'),
    page.getByTestId('step2-milestone-card-ai-4'),
    page.getByTestId('step2-milestone-card-ai-5'),
  ];
  for (const card of shedCards) {
    await expect(card).toBeVisible();
  }
  await expect(page.getByTestId('step2-milestone-number-ai-1')).toHaveText('1');
  await expect(page.getByTestId('step2-milestone-number-ai-5')).toHaveText('5');
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
          allocation_percent: 0.28,
          source: 'existing_milestone',
        },
        {
          milestone_id: 802,
          title: 'Install & Finish',
          suggested_amount: '13000.00',
          suggested_duration_days: 7,
          suggested_order: 2,
          allocation_percent: 0.72,
          source: 'existing_milestone',
        },
      ],
      suggested_plan: {
        project_family_key: 'kitchen_remodel',
        project_family_label: 'Kitchen Remodel',
        project_scope_summary: 'Kitchen remodel with upgraded finishes.',
        recommended_project_type: 'Kitchen Remodel',
        recommended_project_subtype: 'Kitchen Remodel',
        suggested_workflow: 'Remodel workflow',
        suggested_template_label: 'Kitchen Remodel Template',
        recommended_template_name: 'Kitchen Remodel Starter',
        suggested_budget_low: '15300.00',
        suggested_budget_high: '20700.00',
        suggested_duration_low_days: 7,
        suggested_duration_high_days: 11,
        suggested_budget_center: '18000.00',
        suggested_duration_days: 9,
        confidence_level: 'low',
        confidence_reasoning: 'The plan stays broad because the project details are still somewhat general.',
        explanation_points: [
          'The request was clear enough to recommend a practical starting plan.',
          'Materials already on site may reduce setup work.',
        ],
        milestones: [
          {
            order: 1,
            title: 'Demo and Prep',
            allocation_percent: 0.28,
            suggested_duration_days: 2,
            suggested_amount_low: '4284.00',
            suggested_amount_high: '5796.00',
            note: 'Protect the space and remove existing finishes.',
          },
          {
            order: 2,
            title: 'Install and Finish',
            allocation_percent: 0.72,
            suggested_duration_days: 7,
            suggested_amount_low: '11016.00',
            suggested_amount_high: '14904.00',
            note: 'Complete the core installation and finish work.',
          },
        ],
        flags: {
          materials_ready: false,
          inspection_requested: false,
          urgent_or_damage: false,
          multi_area: false,
          one_area: true,
        },
        learning_ready: {
          learning_key: 'kitchen_remodel:remodel:Remodel:Kitchen Remodel:1:no_photos:seeded',
          benchmark_source: 'seeded_only',
          benchmark_match_scope: 'template_linked_profile',
          seeded_benchmark_used: true,
          learned_benchmark_used: false,
          clarification_count: 1,
          photo_count: 0,
        },
        source_metadata: {
          family_key: 'kitchen_remodel',
          scope_mode: 'remodel',
          recommendation_basis: 'deterministic_first',
        },
      },
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

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  await expect(page.getByTestId('step2-work-plan-summary')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('step2-plan-guidance-card')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('step2-plan-guidance-card')).toContainText('Plan Guidance');
  await expect(page.getByTestId('step2-plan-guidance-card')).toContainText('Most contractors use');
  await expect(page.getByTestId('step2-estimate-guidance-details')).toHaveCount(0);
  await expect(page.getByTestId('step2-estimate-confidence')).toHaveCount(0);
});
