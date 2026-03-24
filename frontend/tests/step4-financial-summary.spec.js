import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 123;

async function registerWizardStep4Routes(page, { agreement, milestones, fundingPreview }) {
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
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/homeowners', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 1, company_name: 'Demo Customer', full_name: 'Jordan Demo' }],
      }),
    });
  });

  await page.route(`**/api/projects/homeowners/1/`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 1,
        full_name: 'Jordan Demo',
        company_name: 'Demo Customer',
        email: 'jordan@example.com',
      }),
    });
  });

  await page.route('**/api/projects/contractors/me/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        ai: {
          access: 'included',
          enabled: true,
          unlimited: true,
        },
      }),
    });
  });

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/attachments/?(\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/funding_preview/?(\\?.*)?$`), async (route) => {
    if (fundingPreview) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fundingPreview),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Not used for direct pay' }),
    });
  });

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(agreement),
    });
  });

  await page.route(/\/api\/projects\/milestones\/\?agreement(=|_id=)123.*/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(milestones),
    });
  });
}

test('step 4 escrow summary shows estimated net breakdown and subcontractor payouts', async ({
  page,
}) => {
  await registerWizardStep4Routes(page, {
    agreement: {
      id: AGREEMENT_ID,
      agreement_id: AGREEMENT_ID,
      project_title: 'Kitchen Remodel',
      title: 'Kitchen Remodel',
      homeowner: 1,
      payment_mode: 'escrow',
      description: 'Escrow milestone summary test.',
      status: 'draft',
    },
    milestones: [
      {
        id: 10,
        agreement: AGREEMENT_ID,
        title: 'Demo',
        amount: 2000,
        assigned_worker: { kind: 'subcontractor', id: 55 },
        payout_amount: '600.00',
      },
      {
        id: 11,
        agreement: AGREEMENT_ID,
        title: 'Install',
        amount: 3000,
      },
    ],
    fundingPreview: {
      project_amount: 5000,
      platform_fee: 251,
      contractor_payout: 4749,
      homeowner_escrow: 5000,
      rate: 0.05,
      flat_fee: 1,
    },
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=4`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('agreement-wizard-heading')).toBeVisible();
  await expect(page.getByTestId('step4-financial-summary')).toBeVisible();
  await expect(page.getByText('Contractor Take-Home (Before Stripe Fees)')).toHaveCount(0);
  await expect(page.getByTestId('financial-row-stripe-fee')).toContainText(
    'Estimated Stripe Processing Fee'
  );
  await expect(page.getByTestId('financial-row-subcontractor-payouts')).toContainText(
    'Subcontractor Payouts'
  );
  await expect(page.getByTestId('financial-summary-net')).toContainText('$4,003.70');
  await expect(page.getByTestId('financial-row-escrow-deposit')).toContainText(
    'Total Escrow Deposit'
  );
});

test('step 4 direct pay summary hides subcontractor payouts when not applicable', async ({
  page,
}) => {
  await registerWizardStep4Routes(page, {
    agreement: {
      id: AGREEMENT_ID,
      agreement_id: AGREEMENT_ID,
      project_title: 'Direct Pay Paint',
      title: 'Direct Pay Paint',
      homeowner: 1,
      payment_mode: 'direct',
      description: 'Direct pay summary test.',
      status: 'draft',
    },
    milestones: [
      {
        id: 20,
        agreement: AGREEMENT_ID,
        title: 'Prep',
        amount: 1200,
      },
      {
        id: 21,
        agreement: AGREEMENT_ID,
        title: 'Paint',
        amount: 800,
      },
    ],
    fundingPreview: null,
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=4`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step4-financial-summary')).toBeVisible();
  await expect(page.getByTestId('financial-row-project-total')).toContainText('$2,000.00');
  await expect(page.getByTestId('financial-row-platform-fee')).toContainText('-$41.00');
  await expect(page.getByTestId('financial-row-stripe-fee')).toContainText(
    'Estimated Stripe Processing Fee'
  );
  await expect(page.getByTestId('financial-summary-net')).toContainText('$1,900.70');
  await expect(page.getByTestId('financial-row-subcontractor-payouts')).toHaveCount(0);
  await expect(
    page.getByText('Customer pays invoices via Stripe links. No escrow deposit is required.')
  ).toBeVisible();
});
