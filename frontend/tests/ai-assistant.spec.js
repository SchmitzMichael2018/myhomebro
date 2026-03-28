import { expect, test } from '@playwright/test';

function installBaseAuthMocks(page) {
  return Promise.all([
    page.addInitScript(() => {
      window.localStorage.setItem('access', 'playwright-access-token');
    }),
    page.route('**/api/projects/whoami/', async (route) => {
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
    }),
    page.route('**/api/payments/onboarding/status/', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          onboarding_status: 'complete',
          connected: true,
        }),
      });
    }),
    page.route('**/api/projects/contractors/me/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 77,
          created_at: '2026-03-01T10:00:00Z',
        }),
      });
    }),
  ]);
}

function installRouteState(page, matcher, userState) {
  return page.addInitScript(
    ({ pathname, search, state }) => {
      const currentPath = window.location.pathname;
      const currentSearch = window.location.search;
      if (currentPath !== pathname) return;
      if (typeof search === 'string' && search !== currentSearch) return;
      const currentHistoryState = window.history.state || {};
      window.history.replaceState(
        {
          ...currentHistoryState,
          usr: state,
          key: currentHistoryState.key || 'default',
        },
        '',
        window.location.href
      );
    },
    {
      pathname: matcher.pathname,
      search: matcher.search ?? null,
      state: userState,
    }
  );
}

function installSpeechRecognitionMock(page, transcript) {
  return page.addInitScript(({ voiceTranscript }) => {
    class MockSpeechRecognition {
      constructor() {
        this.lang = 'en-US';
        this.interimResults = false;
        this.maxAlternatives = 1;
      }

      start() {
        this.onstart?.();
        window.setTimeout(() => {
          this.onresult?.({
            results: [[{ transcript: voiceTranscript }]],
          });
          this.onend?.();
        }, 50);
      }

      stop() {
        this.onend?.();
      }
    }

    window.webkitSpeechRecognition = MockSpeechRecognition;
  }, { voiceTranscript: transcript });
}

function disableSpeechRecognition(page) {
  return page.addInitScript(() => {
    try {
      delete window.SpeechRecognition;
    } catch {}
    try {
      delete window.webkitSpeechRecognition;
    } catch {}
    window.SpeechRecognition = undefined;
    window.webkitSpeechRecognition = undefined;
  });
}

function installAssistantOrchestratorMock(page, responseBody) {
  return page.route('**/api/projects/assistant/orchestrate/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        detail: 'OK',
        ai_access: 'included',
        ai_enabled: true,
        ai_unlimited: true,
        ...responseBody,
      }),
    });
  });
}

test('start with ai assistant page renders structured guidance and plans a workflow', async ({
  page,
}) => {
  await installBaseAuthMocks(page);

  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('start-with-ai-assistant')).toBeVisible();
  await expect(page.getByTestId('start-with-ai-title')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create lead' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use template' })).toBeVisible();

  await page
    .getByTestId('start-with-ai-input')
    .fill('Start agreement for Casey Prospect kitchen remodel');
  await page.getByRole('button', { name: 'Plan Next Step' }).click();

  await expect(page.getByTestId('start-with-ai-detected-intent')).toContainText('Start agreement');
  await expect(page.getByTestId('start-with-ai-collected-data')).toContainText(
    'customer_name: Casey Prospect'
  );
  await expect(page.getByTestId('start-with-ai-next-action-label')).toContainText(
    'Open Agreement Wizard'
  );
  await expect(page.getByTestId('start-with-ai-navigate')).toContainText(
    'Open Agreement Wizard'
  );
  await expect(page.getByTestId('assistant-reasoning-badges')).toContainText('Confidence:');
  await page.getByTestId('start-with-ai-structured-toggle').click();
  await expect(page.getByTestId('start-with-ai-structured-json')).toContainText(
    '"reasoning_source"'
  );
  await expect(page.getByTestId('start-with-ai-structured-json')).toContainText(
    '"planning_confidence"'
  );
});

test('assistant renders orchestrator sections for recommendations, estimate preview, and confirmation gating', async ({
  page,
}) => {
  await installBaseAuthMocks(page);
  await installAssistantOrchestratorMock(page, {
    orchestration_version: '2026-03-27-orchestrator-v1',
    request_type: 'apply_template',
    primary_intent: 'apply_template',
    selected_routines: ['template_recommender', 'estimation'],
    recommended_action: {
      type: 'navigate',
      label: 'Open Template Marketplace',
      action_key: 'open_templates',
      navigation_target: '/app/templates',
      confirmation_required: true,
    },
    recommended_action_label: 'Open Template Marketplace',
    available_actions: [
      {
        key: 'preview_top_template',
        label: 'Preview Top Template',
        confirmation_required: false,
        navigation_target: '/app/templates',
      },
    ],
    alternative_actions: [
      {
        key: 'apply_estimate_in_workflow',
        label: 'Apply Suggestions In Workflow',
        confirmation_required: true,
        navigation_target: '/app/agreements/123/wizard?step=2',
      },
    ],
    missing_fields: [],
    blocking_issues: [],
    warnings: ['Review before applying any pricing suggestions.'],
    suggestions: ['Recommended because it matches Kitchen Remodel and US TX SAN ANTONIO.'],
    handoff_payload: {
      prefill_fields: { template_query: 'Kitchen Remodel' },
      draft_payload: { selected_template_id: 99 },
      wizard_step_target: 2,
      suggested_milestones: [],
      clarification_questions: [],
    },
    preview_payload: {
      templates: [
        {
          id: 99,
          name: 'Regional Kitchen Winner',
          project_type: 'Remodel',
          project_subtype: 'Kitchen Remodel',
          visibility: 'regional',
          source_label: 'regional',
          normalized_region_key: 'US-TX-SAN_ANTONIO',
          region_label: 'US TX SAN_ANTONIO',
          benchmark_match_key: 'remodel:kitchen_remodel',
          rank_score: 417,
          rank_reasons: ['project_subtype_match', 'exact_city_region'],
          region_match_scope: 'city',
          usage_count: 8,
          completed_project_count: 4,
          has_seeded_benchmark: true,
          has_learned_benchmark: true,
          milestone_count: 5,
          has_clarifications: true,
        },
      ],
      estimate_preview: {
        suggested_total_price: '26500.00',
        suggested_price_low: '24200.00',
        suggested_price_high: '28800.00',
        suggested_duration_days: 24,
        confidence_level: 'medium',
      },
    },
    navigation_target: '/app/templates',
    confirmation_required: true,
    confidence: 'high',
    confidence_reasoning: 'Template ranking and estimate preview both used deterministic marketplace and benchmark metadata.',
    reasoning_source: 'orchestrator',
    source_metadata: { normalized_region_key: 'US-TX-SAN_ANTONIO' },
    ui_sections: [
      { key: 'recommended_next_step', visible: true },
      { key: 'template_recommendations', visible: true },
      { key: 'estimate_preview', visible: true },
    ],
    fallback_to_planner: false,
    intent: 'apply_template',
    intent_label: 'Apply Template',
    collected_data: { request_text: 'Recommend a template for this project' },
    next_action: {
      type: 'navigate',
      label: 'Open Template Marketplace',
      action_key: 'open_templates',
    },
    prefill_fields: { template_query: 'Kitchen Remodel' },
    draft_payload: { selected_template_id: 99 },
    wizard_step_target: 2,
    suggested_milestones: [],
    clarification_questions: [],
    blocked_workflow_states: [],
    context_summary: 'Agreement #123',
    summary: 'Open Template Marketplace',
    follow_up_prompt: 'Continue in the existing workflow to review details.',
    planning_confidence: 'high',
    structured_result_version: '2026-03-27-orchestrator-v1',
  });

  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('start-with-ai-input').fill('Recommend a template for this project');
  await page.getByRole('button', { name: 'Plan Next Step' }).click();

  await expect(page.getByTestId('start-with-ai-template-recommendations')).toContainText(
    'Regional Kitchen Winner'
  );
  await expect(page.getByTestId('start-with-ai-estimate-preview')).toContainText(
    '$26500.00 suggested total'
  );
  await expect(page.getByTestId('start-with-ai-confirmation')).toContainText(
    'explicit confirmation'
  );
  await expect(page.getByTestId('start-with-ai-available-actions')).toContainText(
    'Apply Suggestions In Workflow'
  );
});

test('assistant renders maintenance preview for recurring service orchestration', async ({
  page,
}) => {
  await installBaseAuthMocks(page);
  await installAssistantOrchestratorMock(page, {
    orchestration_version: '2026-03-27-orchestrator-v1',
    request_type: 'maintenance_contract',
    primary_intent: 'maintenance_contract',
    selected_routines: ['maintenance_contract'],
    recommended_action: {
      type: 'navigate',
      label: 'Prepare Agreement Draft',
      action_key: 'open_wizard_step',
      navigation_target: '/app/agreements/new/wizard?step=1',
      confirmation_required: true,
    },
    recommended_action_label: 'Prepare Agreement Draft',
    available_actions: [
      {
        key: 'open_wizard_step',
        label: 'Prepare Agreement Draft',
        confirmation_required: true,
        navigation_target: '/app/agreements/new/wizard?step=1',
      },
    ],
    alternative_actions: [],
    missing_fields: [],
    blocking_issues: [],
    warnings: ['Recurring-service orchestration is still a preparation preview in this phase.'],
    suggestions: ['Suggested cadence: every 1 quarterly.'],
    preview_payload: {
      maintenance_preview: {
        recurring_summary_label: 'Quarterly HVAC Maintenance',
        recommended_frequency: 'quarterly',
        recurrence_interval: 1,
        recurrence_start_date: '2026-04-15',
        suggested_milestones: [
          { title: 'HVAC Tune-Up', sequence_number: 1, scheduled_service_date: '2026-04-15' },
        ],
      },
    },
    handoff_payload: {
      prefill_fields: {
        agreement_mode: 'maintenance',
        recurrence_pattern: 'quarterly',
        recurrence_interval: 1,
      },
      wizard_step_target: 1,
    },
    confirmation_required: true,
    confidence: 'high',
    confidence_reasoning:
      'Recurring previews use structured cadence fields and deterministic next-occurrence rules.',
    reasoning_source: 'orchestrator',
    source_metadata: { preview_only: true },
    ui_sections: [{ key: 'maintenance_preview', visible: true }],
    fallback_to_planner: false,
    intent: 'maintenance_contract',
    intent_label: 'Maintenance Contract',
    collected_data: { request_text: 'Create a quarterly HVAC maintenance agreement' },
    next_action: {
      type: 'navigate',
      label: 'Prepare Agreement Draft',
      action_key: 'open_wizard_step',
    },
    navigation_target: '/app/agreements/new/wizard?step=1',
    prefill_fields: {
      agreement_mode: 'maintenance',
      recurrence_pattern: 'quarterly',
      recurrence_interval: 1,
    },
    wizard_step_target: 1,
    suggested_milestones: [],
    clarification_questions: [],
    blocked_workflow_states: [],
    context_summary: 'New agreement draft',
    summary: 'Prepare Agreement Draft',
    follow_up_prompt: 'Continue in the workflow to review recurring settings.',
    planning_confidence: 'high',
    structured_result_version: '2026-03-27-orchestrator-v1',
  });

  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('start-with-ai-input').fill('Create a quarterly HVAC maintenance agreement');
  await page.getByRole('button', { name: 'Plan Next Step' }).click();

  await expect(page.getByTestId('start-with-ai-maintenance-preview')).toContainText(
    'Quarterly HVAC Maintenance'
  );
  await expect(page.getByTestId('start-with-ai-maintenance-preview')).toContainText(
    'Starts 2026-04-15'
  );
});

test('assistant renders automation preview, guided flow, and predictive insight sections', async ({
  page,
}) => {
  await installBaseAuthMocks(page);
  await installAssistantOrchestratorMock(page, {
    orchestration_version: '2026-03-27-orchestrator-v1',
    request_type: 'start_agreement',
    primary_intent: 'start_agreement',
    selected_routines: ['agreement_builder', 'template_recommender', 'estimation'],
    recommended_action: {
      type: 'navigate',
      label: 'Open Guided Agreement Builder',
      action_key: 'open_wizard_step',
      navigation_target: '/app/agreements/new/wizard?step=1',
      confirmation_required: true,
    },
    recommended_action_label: 'Open Guided Agreement Builder',
    available_actions: [],
    alternative_actions: [],
    missing_fields: [{ key: 'address_state', prompt: 'Add the project state.', blocking: true }],
    blocking_issues: ['Add the project state.'],
    warnings: [],
    suggestions: ['Review the prepared draft before saving.'],
    handoff_payload: {
      prefill_fields: { description: 'Kitchen remodel in San Antonio' },
      draft_payload: { project_type: 'Remodel' },
      wizard_step_target: 1,
      suggested_milestones: [{ title: 'Demo' }, { title: 'Install' }],
      clarification_questions: ['What finish tier is included?'],
    },
    preview_payload: {
      templates: [{ id: 5, name: 'Regional Kitchen Winner', usage_count: 8, rank_score: 96 }],
      estimate_preview: {
        suggested_total_price: '26500.00',
        suggested_price_low: '24200.00',
        suggested_price_high: '28800.00',
        suggested_duration_days: 24,
        confidence_level: 'medium',
      },
    },
    applyable_preview: {
      template_recommendations: [{ id: 5, name: 'Regional Kitchen Winner' }],
      estimate_preview: { suggested_total_price: '26500.00' },
      suggested_milestones: [{ title: 'Demo' }, { title: 'Install' }],
      clarification_questions: ['What finish tier is included?'],
    },
    automation_plan: {
      mode: 'preview_only',
      preview_only: true,
      guided_flow: {
        guided_step: 'project_location',
        guided_question: 'What state is this project in?',
        field_key: 'address_state',
        why_this_matters: 'Location improves template, benchmark, and compliance relevance.',
      },
    },
    proactive_recommendations: [
      {
        recommendation_type: 'missing_project_location',
        title: 'Add project location',
        message: 'Project city and state will improve benchmark relevance.',
        severity: 'medium',
        source: 'agreement_builder',
        recommended_action: 'Complete Step 1 address fields',
      },
    ],
    predictive_insights: [
      {
        insight_type: 'likely_low_estimate_confidence',
        title: 'Estimate may still be broad',
        summary: 'This estimate is leaning on broader benchmark support.',
        confidence: 'medium',
        recommended_follow_up: 'Add clarifications or review a stronger template match.',
      },
    ],
    proposed_actions: [
      {
        action_type: 'create_agreement_draft',
        action_label: 'Prepare agreement draft',
        action_description: 'Stage the draft workflow for review before save.',
        risk_level: 'medium',
        confirmation_required: true,
      },
    ],
    confirmation_required_actions: [
      { action_type: 'create_agreement_draft', action_label: 'Prepare agreement draft' },
    ],
    navigation_target: '/app/agreements/new/wizard?step=1',
    confirmation_required: true,
    confidence: 'high',
    confidence_reasoning: 'The assistant combined template, estimate, and workflow metadata.',
    reasoning_source: 'orchestrator',
    source_metadata: { normalized_region_key: 'US-TX-SAN_ANTONIO' },
    ui_sections: [{ key: 'recommended_next_step', visible: true }],
    fallback_to_planner: false,
    intent: 'start_agreement',
    intent_label: 'Start Agreement',
    collected_data: { request_text: 'Prepare the agreement, I will review it' },
    next_action: {
      type: 'navigate',
      label: 'Open Guided Agreement Builder',
      action_key: 'open_wizard_step',
    },
    prefill_fields: { description: 'Kitchen remodel in San Antonio' },
    draft_payload: { project_type: 'Remodel' },
    wizard_step_target: 1,
    suggested_milestones: [{ title: 'Demo' }, { title: 'Install' }],
    clarification_questions: ['What finish tier is included?'],
    guided_step: 'project_location',
    guided_question: 'What state is this project in?',
    field_key: 'address_state',
    why_this_matters: 'Location improves template, benchmark, and compliance relevance.',
    blocked_workflow_states: ['Add the project state.'],
    context_summary: 'Agreement draft preview',
    summary: 'Open Guided Agreement Builder',
    follow_up_prompt: 'Answer the next guided question before continuing.',
    planning_confidence: 'high',
    structured_result_version: '2026-03-27-orchestrator-v1',
  });

  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('start-with-ai-input').fill('Prepare the agreement, I will review it');
  await page.getByRole('button', { name: 'Plan Next Step' }).click();

  await expect(page.getByTestId('start-with-ai-guided-flow')).toContainText(
    'What state is this project in?'
  );
  await expect(page.getByTestId('start-with-ai-auto-build-preview')).toContainText(
    'Regional Kitchen Winner'
  );
  await expect(page.getByTestId('start-with-ai-proactive-recommendations')).toContainText(
    'Add project location'
  );
  await expect(page.getByTestId('start-with-ai-predictive-insights')).toContainText(
    'Estimate may still be broad'
  );
  await expect(page.getByTestId('start-with-ai-proposed-actions')).toContainText(
    'Prepare agreement draft'
  );
});

test('assistant falls back to the local planner when orchestrator confidence is intentionally low', async ({
  page,
}) => {
  await installBaseAuthMocks(page);
  await installAssistantOrchestratorMock(page, {
    orchestration_version: '2026-03-27-orchestrator-v1',
    primary_intent: 'navigate_app',
    selected_routines: ['navigation_resume'],
    recommended_action: {
      type: 'navigate',
      label: 'Open Dashboard',
      action_key: 'open_navigation_target',
      navigation_target: '/app/dashboard',
    },
    available_actions: [],
    alternative_actions: [],
    missing_fields: [],
    blocking_issues: [],
    warnings: [],
    suggestions: [],
    handoff_payload: {},
    preview_payload: {},
    navigation_target: '/app/dashboard',
    confirmation_required: false,
    confidence: 'low',
    confidence_reasoning: 'The request is too broad, so the assistant should fall back to the existing local planner.',
    reasoning_source: 'orchestrator_low_confidence',
    source_metadata: { normalized_region_key: 'US' },
    ui_sections: [{ key: 'recommended_next_step', visible: true }],
    fallback_to_planner: true,
    intent: 'navigate_app',
    intent_label: 'Navigate App',
    collected_data: {},
    next_action: {
      type: 'navigate',
      label: 'Open Dashboard',
      action_key: 'open_navigation_target',
    },
    prefill_fields: {},
    draft_payload: {},
    wizard_step_target: null,
    suggested_milestones: [],
    clarification_questions: [],
    blocked_workflow_states: [],
    context_summary: '',
    summary: 'Open Dashboard',
    follow_up_prompt: 'Continue in the existing workflow to review details.',
    planning_confidence: 'low',
    structured_result_version: '2026-03-27-orchestrator-v1',
  });

  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
  await page
    .getByTestId('start-with-ai-input')
    .fill('Start agreement for Casey Prospect kitchen remodel');
  await page.getByRole('button', { name: 'Plan Next Step' }).click();

  await expect(page.getByTestId('start-with-ai-detected-intent')).toContainText('Start agreement');
  await expect(page.getByTestId('assistant-reasoning-badges')).toContainText(
    'rules_fallback'
  );
});

test('assistant voice input fails gracefully when speech recognition is unavailable', async ({
  page,
}) => {
  await installBaseAuthMocks(page);
  await disableSpeechRecognition(page);

  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('assistant-voice-button').click();

  await expect(page.getByTestId('assistant-voice-status')).toContainText(
    'Voice input is not supported'
  );
  await expect(page.getByTestId('start-with-ai-input')).toBeVisible();
});

test('assistant voice input uses the same structured planning pipeline', async ({ page }) => {
  await installBaseAuthMocks(page);
  await installSpeechRecognitionMock(page, 'Create lead for Casey Prospect at 5554443333');

  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('assistant-voice-button').click();

  await expect(page.getByTestId('start-with-ai-input')).toHaveValue(
    'Create lead for Casey Prospect at 5554443333'
  );
  await expect(page.getByTestId('start-with-ai-detected-intent')).toContainText('Create lead');
});

test('desktop docked assistant panel opens and closes from app chrome', async ({ page }) => {
  await installBaseAuthMocks(page);

  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('assistant-dock-open-button').click();

  await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();
  await expect(page.getByTestId('assistant-desktop-dock')).toContainText('AI Copilot');

  await page.getByTestId('assistant-desktop-dock-close').click();
  await expect(page.getByTestId('assistant-desktop-dock')).not.toBeVisible();
});

test('agreement wizard assistant uses agreement context to resume at the blocked step', async ({
  page,
}) => {
  const agreementId = 123;
  let agreement = {
    id: agreementId,
    agreement_id: agreementId,
    project_title: 'Kitchen Remodel Agreement',
    title: 'Kitchen Remodel Agreement',
    project_type: 'Remodel',
    project_subtype: 'Kitchen Remodel',
    payment_mode: 'escrow',
    description: 'Remodel the kitchen and update finishes.',
    homeowner: 1,
    status: 'draft',
  };

  await installBaseAuthMocks(page);

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
          {
            id: 11,
            value: 'Kitchen Remodel',
            label: 'Kitchen Remodel',
            owner_type: 'system',
          },
        ],
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

  await page.route(/\/api\/projects\/agreements\/123\/?(\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(agreement),
      });
      return;
    }

    if (request.method() === 'PATCH') {
      agreement = { ...agreement, ...request.postDataJSON() };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(agreement),
      });
      return;
    }

    await route.fallback();
  });

  await page.route(/\/api\/projects\/milestones\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/123\/attachments\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/attachments\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.goto('/app/agreements/123/wizard?step=1', {
    waitUntil: 'domcontentloaded',
  });

  await page.getByTestId('agreement-wizard-ai-entry-toggle').click();
  await expect(page.getByTestId('start-with-ai-context-summary')).toContainText('Agreement #123');

  await page.getByTestId('start-with-ai-input').fill('Help me finish this agreement');
  await page.getByRole('button', { name: 'Plan Next Step' }).click();

  await expect(page.getByTestId('start-with-ai-detected-intent')).toContainText('Resume agreement');
  await expect(page.getByTestId('start-with-ai-next-action-label')).toContainText(
    'Open Milestone Builder'
  );
  await page.getByTestId('start-with-ai-structured-toggle').click();
  await expect(page.getByTestId('start-with-ai-structured-json')).toContainText(
    '"wizard_step_target": 2'
  );
  await expect(page.getByTestId('start-with-ai-structured-json')).toContainText(
    '"action_key": "open_wizard_step"'
  );
});

test('lead inbox assistant uses lead context to trigger send intake', async ({ page }) => {
  const state = {
    leads: [
      {
        id: 11,
        source: 'manual',
        full_name: 'Casey Prospect',
        email: 'casey@example.com',
        phone: '555-444-3333',
        project_address: '',
        city: 'Austin',
        state: 'TX',
        zip_code: '78701',
        project_type: '',
        project_description: '',
        preferred_timeline: '',
        budget_text: '',
        status: 'contacted',
        internal_notes: 'Met on site and promised to send intake.',
        accepted_at: null,
        ai_analysis: {},
        created_at: '2026-03-25T11:00:00Z',
        converted_homeowner_id: null,
        converted_homeowner_name: '',
        converted_agreement: null,
        converted_at: null,
        source_intake_id: null,
      },
    ],
  };

  await installBaseAuthMocks(page);

  await page.route('**/api/projects/contractor/public-profile/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        business_name_public: 'Bright Build Co',
        tagline: 'Trusted renovations and repairs',
        bio: 'We help homeowners with clean, reliable project delivery.',
        city: 'Austin',
        state: 'TX',
        service_area_text: 'Austin metro',
        years_in_business: 12,
        website_url: 'https://bright.example.com',
        phone_public: '555-111-2222',
        email_public: 'hello@bright.example.com',
        specialties: ['Roofing'],
        work_types: ['Repairs'],
        show_license_public: true,
        show_phone_public: true,
        show_email_public: false,
        allow_public_intake: true,
        allow_public_reviews: true,
        is_public: true,
        seo_title: '',
        seo_description: '',
        public_url: 'http://localhost:4173/contractors/bright-build-co',
        logo_url: '',
        cover_image_url: '',
      }),
    });
  });

  await page.route('**/api/projects/contractor/public-profile/qr/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        public_url: 'http://localhost:4173/contractors/bright-build-co',
        qr_target_url: 'http://localhost:4173/contractors/bright-build-co?source=qr',
        qr_svg: 'data:image/svg+xml;base64,PHN2Zy8+',
        download_filename: 'bright-build-co-public-profile-qr.svg',
      }),
    });
  });

  await page.route('**/api/projects/contractor/gallery/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/contractor/reviews/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/contractor/public-leads/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: state.leads }),
    });
  });

  await page.route(/.*\/api\/projects\/contractor\/public-leads\/11\/send-intake\/$/, async (route) => {
    state.leads = state.leads.map((lead) =>
      lead.id === 11
        ? {
            ...lead,
            status: 'pending_customer_response',
            source_intake_id: 501,
          }
        : lead
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        intake_id: 501,
        email: 'casey@example.com',
        lead_id: 11,
        lead_status: 'pending_customer_response',
      }),
    });
  });

  await page.route(/.*\/api\/projects\/contractor\/public-leads\/11\/$/, async (route) => {
    const body = route.request().postDataJSON();
    state.leads = state.leads.map((lead) =>
      lead.id === 11 ? { ...lead, ...body } : lead
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.leads[0]),
    });
  });

  await page.goto('/app/public-presence', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Public Leads' }).click();

  await page.getByTestId('public-lead-ai-entry-toggle').click();
  await expect(page.getByTestId('start-with-ai-context-summary')).toContainText('Lead #11');

  await page.getByTestId('start-with-ai-input').fill('Help me finish this lead');
  await page.getByRole('button', { name: 'Plan Next Step' }).click();

  await expect(page.getByTestId('start-with-ai-detected-intent')).toContainText('Create lead');
  await expect(page.getByTestId('start-with-ai-next-action-label')).toContainText(
    'Send Intake Form'
  );
  await page.getByTestId('start-with-ai-structured-toggle').click();
  await expect(page.getByTestId('start-with-ai-structured-json')).toContainText(
    '"action_key": "send_intake_form"'
  );
  await expect(page.getByTestId('start-with-ai-structured-json')).toContainText('"lead_id": 11');
});

test('assistant navigation prefills the agreement wizard step 1 flow', async ({ page }) => {
  await installBaseAuthMocks(page);

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
          { id: 11, value: 'Kitchen Remodel', label: 'Kitchen Remodel', owner_type: 'system' },
        ],
      }),
    });
  });

  await page.route('**/api/projects/homeowners**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/templates/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
  await page
    .getByTestId('start-with-ai-input')
    .fill('Start agreement for Casey Prospect kitchen remodel');
  await page.getByRole('button', { name: 'Plan Next Step' }).click();
  await page.getByTestId('start-with-ai-navigate').click();

  await page.waitForURL('**/app/agreements/new/wizard?step=1');
  await expect(page.locator('textarea[name="description"]')).toContainText(
    'Casey Prospect kitchen remodel'
  );
  await expect(page.locator('input[placeholder="e.g., Jane Smith"]')).toHaveValue(
    'Casey Prospect'
  );
});

test('agreement wizard consumes assistant step target from route handoff state', async ({
  page,
}) => {
  const agreementId = 123;

  await installBaseAuthMocks(page);
  await installRouteState(
    page,
    { pathname: `/app/agreements/${agreementId}/wizard`, search: '?step=1' },
    {
      assistantWizardStepTarget: 2,
      assistantIntent: 'resume_agreement',
    }
  );

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/project-subtypes/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
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

  await page.route(/\/api\/projects\/agreements\/123\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: agreementId,
        agreement_id: agreementId,
        project_title: 'Kitchen Remodel Agreement',
        title: 'Kitchen Remodel Agreement',
        description: 'Remodel the kitchen and update finishes.',
        homeowner: 1,
        status: 'draft',
      }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/123\/attachments\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/attachments\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.goto(`/app/agreements/${agreementId}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await page.waitForURL(`**/app/agreements/${agreementId}/wizard?step=2`);
  await expect(page.getByRole('heading', { name: 'Milestones' })).toBeVisible();
});

test('step 2 shows assistant milestone and clarification handoff payloads', async ({ page }) => {
  const agreementId = 222;

  await installBaseAuthMocks(page);
  await installRouteState(
    page,
    { pathname: `/app/agreements/${agreementId}/wizard`, search: '?step=2' },
    {
      assistantSuggestedMilestones: [
        { title: 'Site protection', description: 'Protect adjacent finishes.', amount: '250' },
        { title: 'Cabinet install', description: 'Set and level cabinetry.', amount: '1800' },
      ],
      assistantClarificationQuestions: [
        'Who is supplying cabinets?',
        'Is debris hauling included in the contract?',
      ],
      assistantIntent: 'suggest_milestones',
    }
  );

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/project-subtypes/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
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

  await page.route(/\/api\/projects\/agreements\/222\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: agreementId,
        agreement_id: agreementId,
        project_title: 'Kitchen Remodel Agreement',
        title: 'Kitchen Remodel Agreement',
        description: 'Remodel the kitchen and update finishes.',
        homeowner: 1,
        homeowner_name: 'Jordan Demo',
        status: 'draft',
      }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.goto(`/app/agreements/${agreementId}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('assistant-suggested-milestones')).toBeVisible();
  await expect(page.getByTestId('assistant-suggested-milestone-0')).toContainText(
    'Site protection'
  );
  await expect(page.getByTestId('assistant-clarification-banner')).toBeVisible();
  await expect(
    page.getByTestId('assistant-clarification-assistant_question_1')
  ).toContainText('Who is supplying cabinets?');
});

test('agreement wizard consumes automation handoff previews in step 1 and step 2', async ({
  page,
}) => {
  const agreementId = 333;

  await installBaseAuthMocks(page);
  await installRouteState(
    page,
    { pathname: `/app/agreements/${agreementId}/wizard`, search: '?step=1' },
    {
      assistantGuidedFlow: {
        guided_question: 'What state is this project in?',
        why_this_matters: 'Location improves benchmark and compliance relevance.',
      },
      assistantTemplateRecommendations: [
        { id: 5, name: 'Regional Kitchen Winner', rank_reasons: ['Exact region match'] },
      ],
      assistantTopTemplatePreview: { milestone_count: 4 },
      assistantProactiveRecommendations: [
        {
          recommendation_type: 'missing_project_location',
          title: 'Add project location',
          message: 'Project city and state will improve benchmark relevance.',
        },
      ],
      assistantPredictiveInsights: [
        {
          insight_type: 'better_regional_template_fit',
          title: 'A stronger regional template fit is available',
          summary: 'A regional template may reduce manual setup work.',
        },
      ],
      assistantConfirmationRequiredActions: [{ action_label: 'Prepare agreement draft' }],
      assistantIntent: 'start_agreement',
    }
  );

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });
  await page.route('**/api/projects/project-subtypes/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });
  await page.route('**/api/projects/homeowners**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [{ id: 1, company_name: 'Demo Customer', full_name: 'Jordan Demo' }] }),
    });
  });
  await page.route('**/api/projects/templates/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });
  await page.route(/\/api\/projects\/agreements\/333\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: agreementId,
        agreement_id: agreementId,
        project_title: 'Kitchen Remodel Agreement',
        title: 'Kitchen Remodel Agreement',
        description: 'Remodel the kitchen and update finishes.',
        homeowner: 1,
        homeowner_name: 'Jordan Demo',
        status: 'draft',
      }),
    });
  });
  await page.route(/\/api\/projects\/milestones\/?.*$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });

  await page.goto(`/app/agreements/${agreementId}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('assistant-guided-step1')).toContainText(
    'What state is this project in?'
  );
  await expect(page.getByTestId('assistant-template-preview-step1')).toContainText(
    'Regional Kitchen Winner'
  );
  await expect(page.getByTestId('assistant-proactive-step1')).toContainText(
    'Add project location'
  );
  await expect(page.getByTestId('assistant-confirmation-step1')).toContainText(
    'Prepare agreement draft'
  );

  await installRouteState(
    page,
    { pathname: `/app/agreements/${agreementId}/wizard`, search: '?step=2' },
    {
      assistantEstimatePreview: {
        suggested_total_price: '26500.00',
        suggested_price_low: '24200.00',
        suggested_price_high: '28800.00',
        suggested_duration_days: 24,
        confidence_level: 'medium',
        confidence_reasoning: 'Seeded regional benchmark plus template context.',
        milestone_suggestions: [],
      },
      assistantProactiveRecommendations: [
        {
          recommendation_type: 'low_estimate_confidence',
          title: 'Estimate confidence is low',
          message: 'Clarifications would improve pricing confidence.',
        },
      ],
      assistantPredictiveInsights: [
        {
          insight_type: 'likely_low_estimate_confidence',
          title: 'Estimate may still be broad',
          summary: 'The estimate is leaning on broader benchmark support.',
        },
      ],
      assistantGuidedFlow: {
        guided_question: 'Review the estimate preview before applying pricing.',
        why_this_matters: 'Estimate review helps catch underpricing before save.',
      },
      assistantIntent: 'estimate_project',
    }
  );

  await page.goto(`/app/agreements/${agreementId}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('assistant-guided-step2')).toContainText(
    'Review the estimate preview before applying pricing.'
  );
  await expect(page.getByTestId('assistant-proactive-step2')).toContainText(
    'Estimate confidence is low'
  );
  await expect(page.getByTestId('assistant-predictive-step2')).toContainText(
    'Estimate may still be broad'
  );
  await expect(page.getByText('Estimate updated based on your project details.')).toBeVisible();
});

test('customer form consumes assistant prefill from route state', async ({ page }) => {
  await installBaseAuthMocks(page);
  await installRouteState(
    page,
    { pathname: '/app/customers/new', search: '' },
    {
      assistantPrefill: {
        full_name: 'Casey Prospect',
        email: 'casey@example.com',
        phone: '5554443333',
        address_line1: '101 Main St',
        city: 'Austin',
        state: 'TX',
        postal_code: '78701',
      },
      assistantIntent: 'create_customer',
    }
  );

  await page.goto('/app/customers/new', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('customer-assistant-prefill-banner')).toBeVisible();
  await expect(page.locator('input[name="full_name"]')).toHaveValue('Casey Prospect');
  await expect(page.locator('input[name="email"]')).toHaveValue('casey@example.com');
  await expect(page.locator('input[name="phone_number"]')).toHaveValue('(555) 444-3333');
  await expect(page.locator('input[name="city"]')).toHaveValue('Austin');
});

test('lead inbox consumes assistant create-lead prefill into quick add', async ({ page }) => {
  await installBaseAuthMocks(page);
  await installRouteState(
    page,
    { pathname: '/app/public-presence', search: '' },
    {
      assistantPrefill: {
        full_name: 'Casey Prospect',
        phone: '5554443333',
        email: 'casey@example.com',
        project_summary: 'Met at the job site and wants a kitchen refresh.',
      },
      assistantIntent: 'create_lead',
    }
  );

  await page.route('**/api/projects/contractor/public-profile/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        business_name_public: 'Bright Build Co',
        public_url: 'http://localhost:4173/contractors/bright-build-co',
      }),
    });
  });

  await page.route('**/api/projects/contractor/public-profile/qr/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        public_url: 'http://localhost:4173/contractors/bright-build-co',
        qr_target_url: 'http://localhost:4173/contractors/bright-build-co?source=qr',
        qr_svg: 'data:image/svg+xml;base64,PHN2Zy8+',
        download_filename: 'bright-build-co-public-profile-qr.svg',
      }),
    });
  });

  await page.route('**/api/projects/contractor/gallery/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/contractor/reviews/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/contractor/public-leads/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.goto('/app/public-presence', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('quick-add-lead-sheet')).toBeVisible();
  await expect(page.getByTestId('quick-add-lead-name')).toHaveValue('Casey Prospect');
  await expect(page.getByTestId('quick-add-lead-phone')).toHaveValue('(555) 444-3333');
});
