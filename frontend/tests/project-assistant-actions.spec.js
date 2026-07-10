import { expect, test } from '@playwright/test';

function listResponse(results) {
  return JSON.stringify({ results });
}

function sessionWithRecords(actions = []) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    status: 'approved',
    intent: 'create_customer_and_opportunity',
    source_text: 'Taylor QA needs LVP flooring at 4400 QA Lead Street.',
    created_customer: 45,
    created_opportunity: 88,
    conversation_payload: {
      turns: [{ role: 'contractor', text: 'Taylor QA needs LVP flooring at 4400 QA Lead Street.' }],
    },
    prepared_payload: {
      conversation_id: '22222222-2222-4222-8222-222222222222',
      intent: 'create_customer_and_opportunity',
      customer_draft: {
        display_name: 'Taylor QA',
        email: 'taylor@example.com',
        phone: '555-0199',
      },
      opportunity_draft: {
        title: 'Taylor QA - Flooring',
        project_category: 'Flooring / Remodel',
        project_subtype: 'Luxury Vinyl Plank',
        property_address: '4400 QA Lead Street',
        description: 'Remove old flooring, inspect subfloor, and install LVP.',
      },
      missing_fields: [],
      assumptions: ['Project category appears to be Flooring / Remodel.'],
      possible_duplicates: [],
      follow_up_question: 'Review the prepared draft. What would you like to approve or adjust?',
      safety_summary: ['No customer message will be sent.', 'No estimate appointment will be scheduled.'],
    },
    actions,
  };
}

function preparedAction(actionType, patch = {}) {
  const base = {
    action_id: `${actionType}-1111-4111-8111-111111111111`,
    action_type: actionType,
    status: 'requires_approval',
    title: {
      schedule_estimate: 'Schedule estimate',
      send_email: 'Prepare email',
      send_sms: 'Prepare SMS',
      create_reminder: 'Create reminder',
    }[actionType],
    summary: 'Prepared by Project Assistant. Review and approve before anything happens.',
    prepared_payload: {},
    validation_errors: [],
    warnings: [],
    source_records: [{ type: 'quick_capture_session', id: '22222222-2222-4222-8222-222222222222' }],
    requires_approval: true,
    approved_by: null,
    approved_at: null,
    executed_at: null,
    execution_result: {},
    failure_reason: '',
    audit_metadata: { no_autonomous_execution: true },
  };
  const payloads = {
    schedule_estimate: {
      customer_id: 45,
      opportunity_id: 88,
      customer_name: 'Taylor QA',
      customer_email: 'taylor@example.com',
      customer_phone: '555-0199',
      project_title: 'Taylor QA - Flooring',
      project_address: '4400 QA Lead Street',
      scheduled_start: '',
      duration_minutes: 60,
      notes: 'Remove old flooring, inspect subfloor, and install LVP.',
    },
    send_email: {
      customer_id: 45,
      recipient: 'taylor@example.com',
      subject: 'Following up about Taylor QA - Flooring',
      body: 'Thanks for speaking with us. I captured the project details and can help schedule an estimate next.',
    },
    send_sms: {
      customer_id: 45,
      recipient: '555-0199',
      body: 'Thanks for speaking with us. I captured your project details and can help schedule an estimate next.',
    },
    create_reminder: {
      customer_id: 45,
      title: 'Follow up with Taylor QA',
      remind_at: '',
      note: 'Taylor QA needs LVP flooring at 4400 QA Lead Street.',
    },
  };
  return { ...base, prepared_payload: payloads[actionType], ...patch };
}

async function installAssistantMocks(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 7, type: 'contractor', role: 'contractor_owner', email: 'playwright@myhomebro.local' }),
    });
  });
  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ onboarding_status: 'complete', connected: true }) });
  });
  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 77, ai: { access: 'included', enabled: true } }) });
  });
  await page.route('**/api/projects/contractor-activation-summary/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ guide_sections: {} }) });
  });
  await page.route(/\/api\/projects\/agreements\/?(\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: listResponse([]) });
  });
  await page.route(/\/api\/projects\/milestones\/?(\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: listResponse([]) });
  });
  await page.route('**/api/projects/contractor/public-leads/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: listResponse([]) });
  });
  await page.route('**/api/projects/templates/discover/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: listResponse([]) });
  });
  await page.route('**/api/projects/recommendations/me/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recommendations: [] }) });
  });
}

test('Project Assistant prepares executable next actions and waits for approval before execution', async ({ page }) => {
  await installAssistantMocks(page);
  const preparedActions = [];
  let executedActions = 0;

  await page.route('**/api/projects/project-assistant/quick-capture/sessions/', async (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(sessionWithRecords(preparedActions)) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: listResponse([]) });
  });

  await page.route('**/api/projects/project-assistant/quick-capture/sessions/*/actions/', async (route) => {
    const body = route.request().postDataJSON();
    const action = preparedAction(body.action_type, body.action_type === 'schedule_estimate'
      ? { status: 'drafted', validation_errors: [{ field: 'scheduled_start', label: 'Estimate date/time' }] }
      : {});
    preparedActions.unshift(action);
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(action) });
  });

  await page.route('**/api/projects/project-assistant/quick-capture/sessions/*/actions/*/approve/', async (route) => {
    executedActions += 1;
    const isSchedule = route.request().url().includes('schedule_estimate');
    const posted = route.request().postDataJSON();
    const actionType = posted.prepared_payload?.subject ? 'send_email' : 'schedule_estimate';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(preparedAction(actionType, {
        status: 'completed',
        prepared_payload: posted.prepared_payload,
        validation_errors: [],
        executed_at: '2026-08-01T15:01:00Z',
        execution_result: { ok: true, isSchedule },
      })),
    });
  });

  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('quick-capture-input').fill('Taylor QA needs LVP flooring at 4400 QA Lead Street.');
  await page.getByTestId('quick-capture-send').click();

  await expect(page.getByTestId('project-assistant-action-hub')).toContainText('visible approval');
  expect(executedActions).toBe(0);

  await page.getByTestId('project-assistant-prepare-action-schedule_estimate').click();
  await expect(page.getByTestId('project-assistant-action-card-schedule_estimate')).toBeVisible();
  await expect(page.getByTestId('project-assistant-action-errors-schedule_estimate')).toContainText('Estimate date/time');
  expect(executedActions).toBe(0);

  await page.getByTestId('project-assistant-action-field-schedule_estimate-scheduled_start').fill('2026-08-01T15:00:00Z');
  await page.getByTestId('project-assistant-action-approve-schedule_estimate').click();
  await expect(page.getByTestId('project-assistant-action-card-schedule_estimate')).toContainText('Completed');
  expect(executedActions).toBe(1);

  await page.getByTestId('project-assistant-prepare-action-send_email').click();
  await expect(page.getByTestId('project-assistant-action-card-send_email')).toBeVisible();
  expect(executedActions).toBe(1);
  await page.getByTestId('project-assistant-action-field-send_email-subject').fill('Estimate follow-up');
  await page.getByTestId('project-assistant-action-approve-send_email').click();
  await expect(page.getByTestId('project-assistant-action-card-send_email')).toContainText('Completed');
  expect(executedActions).toBe(2);
});
