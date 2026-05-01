import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 321;

function subcontractorOpsPayload() {
  return {
    identity_type: 'subcontractor',
    today: [],
    tomorrow: [],
    this_week: [],
    recent_activity: [],
    empty_states: {
      today: 'Nothing needs your attention today.',
      tomorrow: 'Nothing is scheduled for tomorrow yet.',
      this_week: 'No additional assigned work is queued for later this week.',
      recent_activity: 'No recent updates on your assigned work yet.',
    },
  };
}

async function installBaseRoutes(page, roleState, quoteState, milestoneState) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  await page.route('**/api/projects/whoami/', async (route) => {
    const role = roleState.current;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        role === 'subcontractor'
          ? {
              user_id: 99,
              email: 'subcontractor@example.com',
              type: 'subcontractor',
              role: 'subcontractor',
            }
          : {
              id: 7,
              type: 'contractor',
              role: 'contractor_owner',
              email: 'playwright@myhomebro.local',
            }
      ),
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

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`), async (route) => {
    const request = route.request();
    if (request.method() === 'PATCH') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: AGREEMENT_ID,
          agreement_id: AGREEMENT_ID,
          project_title: 'Kitchen Remodel Agreement',
          title: 'Kitchen Remodel Agreement',
          description: 'Pricing waits on subcontractor quote.',
          total_cost: '25000.00',
          pricing_strategy: 'requires_sub_quote',
          status: 'draft',
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: AGREEMENT_ID,
        agreement_id: AGREEMENT_ID,
        project_title: 'Kitchen Remodel Agreement',
        title: 'Kitchen Remodel Agreement',
        description: 'Pricing waits on subcontractor quote.',
        total_cost: '25000.00',
        pricing_strategy: 'requires_sub_quote',
        status: 'draft',
      }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?\?.*agreement=321.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [milestoneState()],
      }),
    });
  });

  await page.route('**/api/projects/agreements/321/subcontractor-invitations/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accepted_subcontractors: [
          {
            id: 41,
            accepted_name: 'Skyline Cabinets',
            invite_email: 'cabinets@example.com',
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/subcontractor-quotes/', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const body = route.request().postDataJSON();
    quoteState.status = 'sent';
    quoteState.status_label = 'Sent';
    quoteState.contractor_message = body.contractor_message || quoteState.contractor_message;
    quoteState.subcontractor_invitation_id = Number(body.subcontractor_invitation_id || 41);
    quoteState.scope_snapshot = body.scope_snapshot || quoteState.scope_snapshot;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(quoteState),
    });
  });

  await page.route(`**/api/projects/subcontractor-quotes/${quoteState.id}/respond/`, async (route) => {
    const body = route.request().postDataJSON();
    quoteState.status = 'responded';
    quoteState.status_label = 'Responded';
    quoteState.quoted_amount = String(body.quoted_amount || '0.00');
    quoteState.subcontractor_message = body.subcontractor_message || '';
    quoteState.estimated_start_date = body.estimated_start_date || null;
    quoteState.estimated_completion_date = body.estimated_completion_date || null;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(quoteState),
    });
  });

  await page.route(`**/api/projects/subcontractor-quotes/${quoteState.id}/accept/`, async (route) => {
    const body = route.request().postDataJSON();
    quoteState.status = 'accepted';
    quoteState.status_label = 'Accepted';
    quoteState.linked_subcontractor_milestone_agreement = {
      id: 77,
      milestone_id: 801,
      agreement_id: AGREEMENT_ID,
      contractor_id: 7,
      subcontractor_invitation_id: 41,
      subcontractor_user_id: 99,
      subcontractor_display_name: 'Skyline Cabinets',
      subcontractor_email: 'cabinets@example.com',
      agreement_title: 'Kitchen Remodel Agreement',
      milestone_title: 'Demo & Prep',
      milestone_description: 'Protect work area and demo existing finishes.',
      agreed_pay: quoteState.quoted_amount || '1850.00',
      payment_release_mode: body.payment_release_mode || 'manual_release',
      payment_release_mode_label:
        body.payment_release_mode === 'auto_after_customer_approval'
          ? 'Auto-Release After Customer Approval'
          : 'Manual Release',
      agreement_acceptance_status: 'pending',
      agreement_acceptance_status_label: 'Pending',
      agreement_version: 1,
      terms_snapshot: {},
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(quoteState),
    });
  });

  await page.route('**/api/projects/dashboard/operations/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(subcontractorOpsPayload()),
    });
  });
}

test('contractor requests a quote, subcontractor responds, and contractor accepts it', async ({
  page,
}) => {
  const roleState = { current: 'contractor' };
  const quoteState = {
    id: 9901,
    contractor_id: 7,
    subcontractor_invitation_id: 41,
    agreement_id: AGREEMENT_ID,
    milestone_id: 801,
    agreement_title: 'Kitchen Remodel Agreement',
    milestone_title: 'Demo & Prep',
    milestone_description: 'Protect work area and demo existing finishes.',
    contractor_message: 'Please quote this milestone.',
    subcontractor_message: '',
    quoted_amount: '',
    status: 'sent',
    status_label: 'Sent',
    scope_snapshot: {
      milestone_title: 'Demo & Prep',
      milestone_description: 'Protect work area and demo existing finishes.',
      project_title: 'Kitchen Remodel Agreement',
    },
    linked_subcontractor_milestone_agreement: null,
  };
  const milestoneState = () => ({
    id: 801,
    agreement: AGREEMENT_ID,
    order: 1,
    title: 'Demo & Prep',
    description: 'Protect work area and demo existing finishes.',
    amount: '4000.00',
    start_date: '2026-04-01',
    completion_date: '2026-04-02',
    normalized_milestone_type: 'demolition',
    subcontractor_quote_request: quoteState,
  });

  await installBaseRoutes(page, roleState, quoteState, milestoneState);

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  const requestQuoteButton = page.getByRole('button', { name: 'Request quote' }).first();
  await expect(requestQuoteButton).toBeVisible();
  await requestQuoteButton.click();
  await page.getByTestId('step2-quote-subcontractor-select').selectOption('41');
  await page.getByTestId('step2-request-quote-button').click();
  await expect(page.getByTestId('step2-milestone-subcontractor-summary-801')).toContainText('Waiting on subcontractor');
  await expect(page.getByTestId('step2-milestone-next-step-801')).toContainText('View quote');
  await expect(page.getByTestId('step2-pricing-readiness-panel')).toContainText('Next Step');
  await expect(page.getByTestId('step2-pricing-readiness-panel')).toContainText('Pending quotes: 1');
  await expect(page.getByTestId('step2-pricing-readiness-panel')).toContainText('Needs attention');

  roleState.current = 'subcontractor';
  await page.goto('/app/subcontractor/assigned-work', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('assigned-work-group-321')).toBeVisible();
  await expect(page.getByTestId('assigned-milestone-801')).toContainText('Quote Request');
  await page.getByLabel('Quoted Amount').fill('1850.00');
  await page.getByLabel('Optional message').fill('I can start next week.');
  await page.getByTestId('assigned-milestone-submit-quote-801').click();
  await expect(page.getByText('Your quote has been submitted.')).toBeVisible();

  roleState.current = 'contractor';
  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step2-milestone-subcontractor-summary-801')).toContainText('Quote received');
  await expect(page.getByTestId('step2-milestone-subcontractor-summary-801')).toContainText('$1,850.00');
  await expect(page.getByTestId('step2-milestone-next-step-801')).toContainText('Review quote');
  await expect(page.getByTestId('step2-milestone-primary-action-801')).toHaveText('Review Quote');
  await page.getByRole('button', { name: 'Request quote' }).first().click();
  await expect(page.getByText('Quote received')).toBeVisible();
  await page.getByRole('button', { name: 'Accept Quote' }).click();
  await expect(page.getByText('Accepted quote for Demo & Prep.')).toBeVisible();
  await expect(page.getByTestId('step2-milestone-subcontractor-summary-801')).toContainText('Skyline Cabinets');
  await expect(page.getByTestId('step2-milestone-next-step-801')).toContainText('Send Subcontractor Agreement');
  await expect(page.getByTestId('step2-milestone-primary-action-801')).toHaveText('Send Subcontractor Agreement');
  await expect(page.getByTestId('step2-pricing-readiness-panel')).toContainText('Good to send');
});

