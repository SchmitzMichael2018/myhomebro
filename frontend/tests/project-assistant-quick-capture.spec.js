import { expect, test } from '@playwright/test';

function listResponse(results) {
  return JSON.stringify({ results });
}

function pendingSession() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'draft',
    intent: 'create_customer_and_opportunity',
    source_text:
      'I just spoke with Sarah Johnson. Her email is sarah@example.com and her number is 214-555-0182. She wants a full bathroom remodel at 123 Oak Street.',
    conversation_payload: {
      turns: [
        {
          role: 'contractor',
          text:
            'I just spoke with Sarah Johnson. Her email is sarah@example.com and her number is 214-555-0182. She wants a full bathroom remodel at 123 Oak Street.',
        },
      ],
    },
    prepared_payload: {
      conversation_id: '11111111-1111-4111-8111-111111111111',
      intent: 'create_customer_and_opportunity',
      customer_draft: {
        display_name: 'Sarah Johnson',
        email: 'sarah@example.com',
        phone: '214-555-0182',
      },
      opportunity_draft: {
        title: 'Sarah Johnson - Shower',
        project_category: 'Bathroom Remodel',
        project_subtype: 'Shower',
        property_address: '123 Oak Street',
        description:
          'Sarah wants a full bathroom remodel and wants to replace the tub with a walk-in shower.',
      },
      missing_fields: [],
      assumptions: ['Project category appears to be Bathroom Remodel.'],
      possible_duplicates: [],
      follow_up_question: 'Review the prepared draft. What would you like to approve or adjust?',
      safety_summary: [
        'No customer message will be sent.',
        'No estimate appointment will be scheduled.',
        'No agreement, project, assignment, invoice, or payment will be created.',
        'Records are created only after explicit approval.',
      ],
    },
  };
}

async function installAssistantMocks(page) {
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
      body: JSON.stringify({ onboarding_status: 'complete', connected: true }),
    });
  });

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 77, ai: { access: 'included', enabled: true } }),
    });
  });

  await page.route('**/api/projects/contractor-activation-summary/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ guide_sections: {} }),
    });
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
}

test('desktop Project Assistant quick capture prepares and approves customer opportunity only after review', async ({ page }) => {
  await installAssistantMocks(page);
  let approveRequests = 0;

  await page.route('**/api/projects/project-assistant/quick-capture/sessions/', async (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(pendingSession()),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: listResponse([]) });
  });

  await page.route('**/api/projects/project-assistant/quick-capture/sessions/*/approve/', async (route) => {
    approveRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...pendingSession(),
        status: 'approved',
        created_customer: 45,
        created_opportunity: 88,
      }),
    });
  });

  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('project-assistant-quick-capture')).toBeVisible();
  await page
    .getByTestId('quick-capture-input')
    .fill('I just spoke with Sarah Johnson. Her email is sarah@example.com and her number is 214-555-0182. She wants a full bathroom remodel at 123 Oak Street.');
  await page.getByTestId('quick-capture-send').click();

  await expect(page.getByTestId('quick-capture-prepared-record')).toContainText('Sarah Johnson');
  await expect(page.getByTestId('quick-capture-prepared-record')).toContainText('Bathroom Remodel');
  await expect(page.getByTestId('project-assistant-human-approval')).toBeVisible();
  await expect(page.getByTestId('quick-capture-safety')).toContainText('No customer message will be sent.');
  expect(approveRequests).toBe(0);

  await page.getByTestId('quick-capture-approve').click();
  await expect(page.getByTestId('quick-capture-approved')).toBeVisible();
  expect(approveRequests).toBe(1);
});

test('mobile Project Assistant opens a full-screen quick capture sheet without horizontal overflow', async ({ page }) => {
  await installAssistantMocks(page);
  await page.route('**/api/projects/project-assistant/quick-capture/sessions/', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(pendingSession()),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('assistant-home-open-assistant').click();

  await expect(page.getByTestId('assistant-mobile-sheet')).toBeVisible();
  await expect(page.getByTestId('assistant-mobile-sheet').getByTestId('quick-capture-mic-button')).toContainText('Voice Mode');
  await page.getByTestId('assistant-mobile-sheet').getByTestId('quick-capture-input').fill('Sarah Johnson needs a bathroom remodel at 123 Oak Street. Her email is sarah@example.com.');
  await page.getByTestId('assistant-mobile-sheet').getByTestId('quick-capture-send').click();
  await page.getByTestId('assistant-mobile-sheet').getByTestId('quick-capture-draft-customer-draft').getByRole('button').click();
  await expect(page.getByTestId('assistant-mobile-sheet').getByTestId('quick-capture-prepared-record')).toContainText('Sarah Johnson');

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(hasHorizontalOverflow).toBe(false);
});
