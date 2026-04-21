import { expect, test } from '@playwright/test';

function installBaseAuth(page) {
  let setupState = {
    work_description: '',
    project_family: { key: '', label: '' },
    project_families: [],
    project_style: {
      workflow_style: '',
      materials_behavior: '',
      project_family_cue: '',
    },
    milestone_tendencies: [],
    pricing_baseline: {
      low: '',
      high: '',
      center: '',
      duration_low_days: 0,
      duration_high_days: 0,
      duration_days: 0,
      milestone_count: 0,
      confidence_level: '',
      confidence_reasoning: '',
    },
    agreement_defaults: {},
    clarification_questions: [],
    clarification_answers: {},
    recommended_setup: {},
    suggested_plan: {},
    source: 'server',
    summary: 'Tell us what kind of work you do and we will build your setup for you.',
    completed_at: null,
  };

  const inferFamily = (text) => {
    const value = String(text || '').toLowerCase();
    if (value.includes('roof')) {
      return {
        project_family: { key: 'roofing', label: 'Roofing' },
        project_families: [{ key: 'roofing', label: 'Roofing' }],
        project_style: {
          workflow_style: 'Repair-first workflow',
          materials_behavior: 'Materials are usually contractor-supplied with prompt install scheduling.',
          project_family_cue: 'Roofing work usually needs a clear inspection and repair sequence.',
        },
        milestone_tendencies: [{ title: 'Inspection & prep', note: 'Inspect, document, and prep the roof.' }],
        pricing_baseline: {
          low: '16000',
          high: '20000',
          center: '18000',
          duration_low_days: 5,
          duration_high_days: 7,
          duration_days: 6,
          milestone_count: 4,
          confidence_level: 'medium',
          confidence_reasoning: 'Based on similar roofing projects.',
        },
        agreement_defaults: {
          project_type: 'Roofing',
          project_subtype: 'Roof Repair',
          suggested_workflow: 'Inspection to completion',
          suggested_template_label: 'Roofing Starter',
          payment_mode: 'escrow',
          payment_structure: 'progress',
        },
      };
    }

    if (value.includes('kitchen')) {
      return {
        project_family: { key: 'kitchen_remodel', label: 'Kitchen Remodel' },
        project_families: [{ key: 'kitchen_remodel', label: 'Kitchen Remodel' }],
        project_style: {
          workflow_style: 'Remodel workflow',
          materials_behavior: 'Materials are often coordinated in phases.',
          project_family_cue: 'Kitchen work usually mixes install, finish, and material coordination.',
        },
        milestone_tendencies: [{ title: 'Demo & layout', note: 'Confirm layout before materials install.' }],
        pricing_baseline: {
          low: '24000',
          high: '32000',
          center: '28000',
          duration_low_days: 10,
          duration_high_days: 14,
          duration_days: 12,
          milestone_count: 5,
          confidence_level: 'medium',
          confidence_reasoning: 'Based on similar kitchen remodel projects.',
        },
        agreement_defaults: {
          project_type: 'Kitchen Remodel',
          project_subtype: 'Cabinet Install',
          suggested_workflow: 'Plan, install, finish',
          suggested_template_label: 'Kitchen Remodel Starter',
          payment_mode: 'escrow',
          payment_structure: 'progress',
        },
      };
    }

    return {
      project_family: { key: 'general_handyman', label: 'General Handyman' },
      project_families: [{ key: 'general_handyman', label: 'General Handyman' }],
      project_style: {
        workflow_style: 'Flexible install-and-repair workflow',
        materials_behavior: 'Materials behavior depends on the job and stays flexible.',
        project_family_cue: 'This work looks like a mixed handyman scope.',
      },
      milestone_tendencies: [{ title: 'Assess scope', note: 'Confirm scope before work begins.' }],
      pricing_baseline: {
        low: '800',
        high: '2400',
        center: '1600',
        duration_low_days: 1,
        duration_high_days: 3,
        duration_days: 2,
        milestone_count: 3,
        confidence_level: 'medium',
        confidence_reasoning: 'Based on similar handyman projects.',
      },
      agreement_defaults: {
        project_type: 'General Handyman',
        project_subtype: 'Repair',
        suggested_workflow: 'Inspect, repair, finish',
        suggested_template_label: 'General Starter',
        payment_mode: 'escrow',
        payment_structure: 'progress',
      },
    };
  };

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
    page.route('**/api/projects/contractors/onboarding/setup/', async (route) => {
      if (route.request().method() === 'PATCH') {
        const payload = route.request().postDataJSON();
        const workDescription = String(payload.work_description || setupState.work_description || '');
        const inferred = inferFamily(workDescription);
        setupState = {
          ...setupState,
          ...inferred,
          work_description: workDescription,
          clarification_answers: payload.clarification_answers || setupState.clarification_answers,
          completed_at: payload.completed ? '2026-04-20T00:00:00Z' : setupState.completed_at,
        };
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(setupState),
      });
    }),
    page.route('**/api/projects/workspace-context/', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          project_family: { key: '', label: '' },
          source: 'server',
          updated_at: '2026-04-20T00:00:00Z',
        }),
      });
    }),
  ]);
}

async function installEmbeddedStripeMocks(page, { connected = false } = {}) {
  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        onboarding_status: connected ? 'completed' : 'in_progress',
        stripe_onboarding_status: connected ? 'complete' : 'in_progress',
        connected,
        account_id: 'acct_test_123',
        resume_url: '/app/onboarding/stripe',
      }),
    });
  });

  await page.route('**/api/payments/onboarding/account-session/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        account_id: 'acct_test_123',
        client_secret: 'seti_client_secret_123',
        resume_url: '/app/onboarding/stripe',
      }),
    });
  });

  await page.route('https://connect-js.stripe.com/v1.0/connect.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.StripeConnect = {
          init: function () {
            return {
              create: function (type) {
                if (type !== 'account-onboarding') {
                  return document.createElement('div');
                }
                const el = document.createElement('div');
                el.setAttribute('data-testid', 'mock-stripe-account-onboarding');
                el.textContent = 'Mock Stripe onboarding';
                return el;
              }
            };
          }
        };
      `,
    });
  });
}

test('contractor onboarding supports activation-first progression and embedded Stripe handoff', async ({
  page,
}) => {
  await installBaseAuth(page);
  await installEmbeddedStripeMocks(page);

  const mePayload = {
    id: 77,
    business_name: '',
    city: '',
    state: '',
    zip: '',
    skills: [],
    onboarding: {
      status: 'not_started',
      step: 'welcome',
      first_value_reached: false,
      stripe_ready: false,
      stripe_onboarding_status: 'not_started',
      show_soft_stripe_prompt: false,
      trade_count: 0,
      service_region_label: '',
      step_number: 1,
      step_total: 3,
      activation: {
        last_step_reached: 'welcome',
        time_spent_per_step: {},
      },
    },
    stripe_onboarding_status: 'not_started',
  };

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mePayload),
    });
  });

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [{ id: 1, value: 'HVAC', label: 'HVAC' }] }),
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
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.goto('/app/onboarding', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('contractor-onboarding-welcome')).toBeVisible();
  await expect(page.getByTestId('contractor-onboarding-welcome')).toContainText(
    /Let.?s set up how you run your projects/
  );
  await page.getByRole('button', { name: 'Get started' }).click();

  await expect(page.getByTestId('contractor-onboarding-description')).toBeVisible();
  await page.getByPlaceholder('What kind of work do you usually do?').fill('Roofing and repairs');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByTestId('contractor-onboarding-generated-setup')).toBeVisible();
  await expect(page.getByTestId('contractor-onboarding-generated-setup')).toContainText('Roofing');
  await expect(page.getByTestId('contractor-onboarding-generated-setup')).toContainText(
    'Pricing + Duration Baseline'
  );
  await expect(page.getByRole('button', { name: 'Looks good' })).toBeVisible();

  await page.getByRole('button', { name: 'Looks good' }).click();
  await expect(page.getByTestId('contractor-onboarding-first-project')).toBeVisible();
  await expect(page.getByTestId('contractor-onboarding-first-project')).toContainText(
    /Let.?s create your first project/
  );

  await page.getByRole('button', { name: 'Set up payments' }).click();
  await expect(page).toHaveURL(/\/app\/onboarding\/stripe/);
  await expect(page.getByTestId('embedded-stripe-onboarding-page')).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId('contractor-onboarding-first-project')).toBeVisible();
  await page.getByRole('button', { name: 'Start project' }).click();
  await expect(page).toHaveURL(/\/app\/agreements\/new\/wizard\?step=1/);

  const handoffAfter = await page.evaluate(() => {
    try {
      return JSON.parse(window.sessionStorage.getItem('mhb_first_project_assist_handoff') || 'null');
    } catch {
      return null;
    }
  });
  expect(handoffAfter).toBeTruthy();
  expect(handoffAfter?.assistantIntent).toBe('first_project_assist');
  expect(handoffAfter?.assistantPrefill?.project_type || '').toContain('Roofing');
});

test('stripe status-aware UI shows start, resume, and connected states clearly', async ({ page }) => {
  await installBaseAuth(page);

  let meState = {
    id: 77,
    created_at: '2026-03-01T10:00:00Z',
    business_name: 'Reminder Contractor',
    city: 'San Antonio',
    state: 'TX',
    ai: {
      access: 'included',
      enabled: true,
      unlimited: true,
    },
    onboarding: {
      status: 'in_progress',
      step: 'stripe',
      first_value_reached: true,
      stripe_ready: false,
      stripe_onboarding_status: 'in_progress',
      show_soft_stripe_prompt: true,
      trade_count: 1,
      service_region_label: 'San Antonio, TX',
    },
    stripe_onboarding_status: 'in_progress',
  };

  let stripeStatusState = {
    onboarding_status: 'in_progress',
    stripe_onboarding_status: 'in_progress',
    connected: false,
    account_id: 'acct_test_123',
    resume_url: '/app/onboarding/stripe',
  };

  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stripeStatusState),
    });
  });

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(meState),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });
  await page.route(/\/api\/projects\/invoices\/?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });
  await page.route(/\/api\/projects\/agreements\/?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });
  await page.route('**/api/projects/contractor/public-leads/', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });
  await page.route(/\/api\/projects\/expense-requests\/?.*$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });
  await page.route(/\/api\/projects\/expenses\/?.*$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: /Stripe Onboarding Resume/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Stripe Onboarding Resume/i })).toHaveAttribute(
    'href',
    '/app/onboarding/stripe'
  );

  await page.goto('/app/profile', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('profile-stripe-reminder')).toContainText(
    'Stripe onboarding incomplete'
  );
  await expect(page.getByTestId('profile-stripe-reminder')).toContainText(
    'Resume payment setup'
  );
  await expect(page.getByTestId('profile-stripe-reminder').getByRole('link')).toHaveAttribute(
    'href',
    '/app/onboarding/stripe'
  );

  meState = {
    ...meState,
    onboarding: {
      ...meState.onboarding,
      status: 'complete',
      step: 'complete',
      stripe_ready: true,
      stripe_onboarding_status: 'complete',
      show_soft_stripe_prompt: false,
    },
    stripe_onboarding_status: 'complete',
    stripe_account_id: 'acct_test_123',
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    requirements_due_count: 0,
  };
  stripeStatusState = {
    onboarding_status: 'completed',
    stripe_onboarding_status: 'complete',
    connected: true,
    account_id: 'acct_test_123',
    resume_url: '/app/onboarding/stripe',
  };
  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Connected', { exact: true }).first()).toBeVisible();
  await page.goto('/app/profile', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('profile-stripe-reminder')).toHaveCount(0);
});

test('stripe setup prompt appears for brand new contractors and a complete account clears it', async ({
  page,
}) => {
  await installBaseAuth(page);

  let stripeStatusState = {
    onboarding_status: 'not_started',
    stripe_onboarding_status: 'not_started',
    connected: false,
    resume_url: '/app/onboarding/stripe',
  };

  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stripeStatusState),
    });
  });

  let meState = {
    id: 77,
    created_at: '2026-03-01T10:00:00Z',
    business_name: 'New Contractor',
    onboarding: {
      status: 'not_started',
      step: 'welcome',
      first_value_reached: false,
      stripe_ready: false,
      stripe_onboarding_status: 'not_started',
      show_soft_stripe_prompt: false,
      trade_count: 0,
      service_region_label: '',
    },
    stripe_onboarding_status: 'not_started',
  };

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(meState),
    });
  });

  await page.goto('/app/profile', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('profile-stripe-reminder')).toContainText('Set up payments');
  await expect(page.getByTestId('profile-stripe-reminder')).toContainText('Start Stripe setup');

  meState = {
    id: 77,
    created_at: '2026-03-01T10:00:00Z',
    business_name: 'New Contractor',
    stripe_account_id: 'acct_test_123',
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    requirements_due_count: 0,
    onboarding: {
      status: 'complete',
      step: 'complete',
      first_value_reached: true,
      stripe_ready: true,
      stripe_onboarding_status: 'complete',
      show_soft_stripe_prompt: false,
      trade_count: 0,
      service_region_label: '',
    },
    stripe_onboarding_status: 'complete',
  };
  stripeStatusState = {
    onboarding_status: 'completed',
    stripe_onboarding_status: 'complete',
    connected: true,
    account_id: 'acct_test_123',
    resume_url: '/app/onboarding/stripe',
  };

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Connected', { exact: true }).first()).toBeVisible();
  await page.goto('/app/profile', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('profile-stripe-reminder')).toHaveCount(0);
});

test('payment-critical direct pay action shows Stripe requirement modal instead of generic failure', async ({
  page,
}) => {
  await installBaseAuth(page);

  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        onboarding_status: 'not_started',
        connected: false,
      }),
    });
  });

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        created_at: '2026-03-01T10:00:00Z',
        onboarding: {
          status: 'in_progress',
          step: 'stripe',
          first_value_reached: true,
          stripe_ready: false,
          stripe_onboarding_status: 'in_progress',
          show_soft_stripe_prompt: true,
        },
        stripe_onboarding_status: 'in_progress',
      }),
    });
  });

  await page.route(/\/api\/projects\/invoices\/123\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 123,
        invoice_number: 'INV-123',
        status: 'pending',
        amount: '450.00',
        project_title: 'Direct Pay Project',
        milestone_id: 45,
        milestone_title: 'Maintenance Visit',
        milestone_description: 'Seasonal service',
        agreement: {
          id: 9,
          payment_mode: 'direct',
        },
        agreement_id: 9,
        customer_name: 'Casey Customer',
        customer_email: 'casey@example.com',
      }),
    });
  });

  await page.route('**/api/projects/invoices/123/direct_pay_link/', async (route) => {
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'STRIPE_ONBOARDING_REQUIRED',
        requirement_type: 'stripe_connect',
        action_label: 'Create Direct Pay Link',
        detail: 'Connect Stripe to receive payments.',
        message: 'You can keep exploring, but this payment action requires Stripe setup.',
        resume_url: '/app/onboarding/stripe',
        stripe_status: {
          connected: false,
          charges_enabled: false,
          payouts_enabled: false,
          requirements_due_count: 2,
        },
      }),
    });
  });

  await page.goto('/app/invoices/123', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Create Pay Link' }).click();

  await expect(page.getByTestId('stripe-requirement-modal')).toBeVisible();
  await expect(page.getByTestId('stripe-requirement-modal')).toContainText('Create Direct Pay Link');
  await expect(page.getByTestId('stripe-requirement-connect')).toContainText('Connect Stripe');
});
