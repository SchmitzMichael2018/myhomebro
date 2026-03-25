import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 123;

async function mockAgreementDetailApi(page, { agreement, draws = [], externalPayments = [] }) {
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
        email: 'progress@myhomebro.local',
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

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/draws/?(\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        agreement_id: AGREEMENT_ID,
        payment_structure: 'progress',
        retainage_percent: '10.00',
        results: draws,
      }),
    });
  });

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/external-payments/?(\\?.*)?$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          agreement_id: AGREEMENT_ID,
          results: externalPayments,
        }),
      });
    }
  );

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/funding_preview/?(\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/subcontractor-invitations/?(\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ pending_invitations: [], accepted_subcontractors: [] }),
    });
  });

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(agreement),
    });
  });

  await page.route('**/api/projects/milestones/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/api/projects/subaccounts/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/warranties/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
}

function progressAgreement(overrides = {}) {
  return {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Progress Agreement',
    title: 'Progress Agreement',
    project_type: 'Remodel',
    project_subtype: 'Commercial Interior',
    payment_mode: 'escrow',
    payment_structure: 'progress',
    retainage_percent: '10.00',
    status: 'draft',
    signature_is_satisfied: false,
    is_fully_signed: false,
    signed_by_contractor: false,
    signed_by_homeowner: false,
    milestones: [],
    invoices: [],
    pdf_versions: [],
    ...overrides,
  };
}

test('unsigned progress agreement hides invoices and locks draw tools', async ({ page }) => {
  await mockAgreementDetailApi(page, {
    agreement: progressAgreement(),
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Draw Requests' })).toBeVisible();
  await expect(page.getByText('Draw tools unlock after the agreement is fully signed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Draw' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Invoices' })).toHaveCount(0);
});

test('signed progress agreement only offers external payment recording for approved draws', async ({ page }) => {
  await mockAgreementDetailApi(page, {
    agreement: progressAgreement({
      signature_is_satisfied: true,
      is_fully_signed: true,
      signed_by_contractor: true,
      signed_by_homeowner: true,
    }),
    draws: [
      {
        id: 1,
        draw_number: 1,
        title: 'Approved Draw',
        status: 'approved',
        gross_amount: '2500.00',
        retainage_amount: '250.00',
        net_amount: '2250.00',
        line_items: [],
      },
      {
        id: 2,
        draw_number: 2,
        title: 'Paid Draw',
        status: 'paid',
        gross_amount: '1500.00',
        retainage_amount: '150.00',
        net_amount: '1350.00',
        line_items: [],
      },
    ],
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('button', { name: 'Create Draw' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record External Payment' })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Invoices' })).toHaveCount(0);
});
