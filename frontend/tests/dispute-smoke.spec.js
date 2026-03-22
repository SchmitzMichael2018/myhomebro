import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 321;
const DISPUTE_ID = 8801;

test('contractor can open dispute flow and reach dispute fee state in a safe mocked flow', async ({
  page,
}) => {
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
        onboarding_status: 'not_started',
        connected: false,
      }),
    });
  });

  await page.route('**/api/projects/feature-flags/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ai_enabled: false,
        ai_disputes_enabled: false,
      }),
    });
  });

  await page.route('**/api/projects/disputes/?mine=true', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/disputes/?initiator=homeowner', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: AGREEMENT_ID,
            project_title: 'Kitchen Remodel',
            title: 'Kitchen Remodel',
          },
        ],
      }),
    });
  });

  await page.route(`**/api/projects/milestones/?agreement=${AGREEMENT_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 77,
            order: 1,
            title: 'Cabinet install',
            amount: 3200,
          },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/disputes\/?$/, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: DISPUTE_ID,
        fee_amount: 250,
        status: 'initiated',
        fee_paid: false,
      }),
    });
  });

  await page.goto('/app/disputes', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('start-dispute-button')).toBeVisible();
  await page.getByTestId('start-dispute-button').click();

  await expect(page.getByTestId('dispute-create-title')).toContainText(
    'Start a Dispute'
  );

  await page.getByTestId('dispute-agreement-select').selectOption(
    String(AGREEMENT_ID)
  );
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByTestId('dispute-create-title')).toContainText(
    'Describe the Dispute'
  );

  await page
    .getByTestId('dispute-reason-input')
    .fill('Work not approved');
  await page.getByTestId('dispute-submit-button').click();

  await expect(page.getByTestId('dispute-create-title')).toContainText(
    'Dispute Fee'
  );
  await expect(page.getByTestId('dispute-fee-step')).toContainText(
    `Dispute #${DISPUTE_ID} created`
  );
  await expect(page.getByTestId('dispute-fee-step')).toContainText('$250.00');
});
