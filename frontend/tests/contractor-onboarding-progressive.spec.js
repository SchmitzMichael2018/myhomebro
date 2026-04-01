import { expect, test } from '@playwright/test';

function installBaseAuth(page) {
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
  ]);
}

test('contractor onboarding supports activation-first progression and soft Stripe prompt', async ({
  page,
}) => {
  const activationEvents = [];
  let mePayload = {
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
      show_soft_stripe_prompt: false,
      trade_count: 0,
      service_region_label: '',
      step_number: 1,
      step_total: 4,
      activation: {
        last_step_reached: 'welcome',
        time_spent_per_step: {},
      },
    },
  };
  let onboardingPayload = {
    status: 'not_started',
    step: 'welcome',
    first_value_reached: false,
    stripe_ready: false,
    show_soft_stripe_prompt: false,
    trade_count: 0,
    service_region_label: '',
    step_number: 1,
    step_total: 4,
    activation: {
      last_step_reached: 'welcome',
      time_spent_per_step: {},
    },
  };
  let stripeStatus = {
    onboarding_status: 'not_started',
    connected: false,
    requirements_pending: [],
    resume_url: '/app/onboarding',
  };

  await installBaseAuth(page);

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mePayload),
    });
  });

  await page.route('**/api/projects/contractors/onboarding/', async (route) => {
    if (route.request().method() === 'PATCH') {
      const payload = route.request().postDataJSON();
      mePayload = {
        ...mePayload,
        business_name: payload.business_name ?? mePayload.business_name,
        city: payload.city ?? mePayload.city,
        state: payload.state ?? mePayload.state,
        zip: payload.zip ?? mePayload.zip,
        skills: payload.skills ?? mePayload.skills,
      };
      onboardingPayload = {
        ...onboardingPayload,
        status: payload.mark_first_project_started ? 'in_progress' : 'not_started',
        step:
          payload.contractor_onboarding_step ||
          (payload.mark_first_project_started ? 'stripe' : onboardingPayload.step),
        first_value_reached: Boolean(payload.mark_first_project_started),
        show_soft_stripe_prompt: Boolean(payload.mark_first_project_started),
        trade_count: Array.isArray(mePayload.skills) ? mePayload.skills.length : 0,
        service_region_label: [mePayload.city, mePayload.state].filter(Boolean).join(', '),
        step_number:
          payload.contractor_onboarding_step === 'region'
            ? 2
            : payload.contractor_onboarding_step === 'first_job'
            ? 3
            : payload.mark_first_project_started
            ? 4
            : onboardingPayload.step_number,
        step_total: 4,
        activation: {
          last_step_reached:
            payload.contractor_onboarding_step ||
            (payload.mark_first_project_started ? 'stripe' : onboardingPayload.activation?.last_step_reached || ''),
          time_spent_per_step: {},
        },
      };
      mePayload = { ...mePayload, onboarding: onboardingPayload };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(onboardingPayload),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(onboardingPayload),
    });
  });

  await page.route('**/api/projects/contractors/onboarding/events/', async (route) => {
    const payload = route.request().postDataJSON();
    activationEvents.push(payload);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(onboardingPayload),
    });
  });

  await page.route('**/api/projects/contractors/onboarding/dismiss-stripe-prompt/', async (route) => {
    onboardingPayload = {
      ...onboardingPayload,
      show_soft_stripe_prompt: false,
    };
    mePayload = { ...mePayload, onboarding: onboardingPayload };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(onboardingPayload),
    });
  });

  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stripeStatus),
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
  await page.route(/\/api\/projects\/agreements\/\d+\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 999,
        agreement_id: 999,
        title: 'AI Starter Agreement',
        project_title: 'AI Starter Agreement',
        status: 'draft',
        payment_mode: 'escrow',
      }),
    });
  });

  await page.goto('/app/onboarding', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('contractor-onboarding-page')).toBeVisible();
  await expect(page.getByTestId('contractor-onboarding-trades')).toContainText('Pick your trades');
  await expect(page.getByTestId('contractor-onboarding-trades')).toContainText('Step 1 of 4');

  await page.getByRole('button', { name: 'HVAC' }).click();
  await page.getByTestId('contractor-onboarding-save-basics').click();
  await expect(page.getByTestId('contractor-onboarding-region')).toContainText('Set your service area');

  await page.getByTestId('contractor-onboarding-state').selectOption('TX');
  await page.getByTestId('contractor-onboarding-city').fill('San Antonio');
  await page.getByTestId('contractor-onboarding-zip').fill('78205');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByTestId('contractor-onboarding-first-job')).toContainText(
    'Start your first project'
  );
  await expect(page.getByTestId('contractor-onboarding-first-job')).toContainText(
    'AI will guide you through your first agreement'
  );
  await page.getByTestId('contractor-onboarding-job-input').fill('Bathroom remodel for Mike');
  await page.getByRole('button', { name: 'Start my first project with AI' }).click();
  await page.waitForURL('**/app/assistant');
  expect(activationEvents.some((item) => item.event_type === 'ai_used_for_project')).toBeTruthy();

  onboardingPayload = {
    ...onboardingPayload,
    status: 'in_progress',
    step: 'stripe',
    first_value_reached: true,
    show_soft_stripe_prompt: true,
    trade_count: 1,
    service_region_label: 'San Antonio, TX',
    step_number: 4,
    step_total: 4,
    activation: {
      last_step_reached: 'stripe',
      time_spent_per_step: {},
    },
  };
  mePayload = {
    ...mePayload,
    skills: ['HVAC'],
    city: 'San Antonio',
    state: 'TX',
    onboarding: onboardingPayload,
  };

  await page.goto('/app/onboarding', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('contractor-onboarding-soft-stripe-prompt')).toContainText(
    'Connect Stripe before you send payment workflows'
  );
});

test('dashboard and profile render resumable setup reminders without blocking exploration', async ({
  page,
}) => {
  const mePayload = {
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
      show_soft_stripe_prompt: true,
      trade_count: 1,
      service_region_label: 'San Antonio, TX',
    },
  };

  await installBaseAuth(page);

  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        onboarding_status: 'incomplete',
        connected: false,
      }),
    });
  });

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mePayload),
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
  await expect(page.getByTestId('dashboard-onboarding-reminder')).toContainText(
    'Connect Stripe to get paid'
  );

  await page.goto('/app/profile', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('profile-stripe-reminder')).toContainText(
    'Stripe onboarding incomplete'
  );
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
          show_soft_stripe_prompt: true,
        },
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
        resume_url: '/app/onboarding',
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
  await expect(page.getByTestId('stripe-requirement-modal')).toContainText(
    'Create Direct Pay Link'
  );
  await expect(page.getByTestId('stripe-requirement-connect')).toContainText('Connect Stripe');
});
