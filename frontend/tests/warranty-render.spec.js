import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 321;
const WARRANTY_ID = 901;

test('agreement detail renders warranty records for the linked agreement', async ({
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
        onboarding_status: 'complete',
        connected: true,
      }),
    });
  });

  await page.route('**/api/projects/agreements/321/attachments/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/api/projects/agreements/321/funding_preview/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project_amount: '12000.00',
        platform_fee: '361.00',
        contractor_payout: '11639.00',
        homeowner_escrow: '12361.00',
        rate: 0.03,
        is_intro: false,
        tier_name: 'starter',
        high_risk_applied: false,
      }),
    });
  });

  await page.route('**/api/projects/warranties/**', async (route) => {
    const url = new URL(route.request().url());

    if (
      route.request().method() === 'GET' &&
      url.searchParams.get('agreement') === String(AGREEMENT_ID)
    ) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: WARRANTY_ID,
            agreement: AGREEMENT_ID,
            agreement_title: 'Kitchen Remodel Agreement',
            contractor: 77,
            title: '12-Month Workmanship Warranty',
            coverage_details:
              'Covers workmanship defects for cabinet installation and trim finishing.',
            exclusions: 'Normal wear, misuse, and owner modifications are excluded.',
            start_date: '2026-03-01',
            end_date: '2027-03-01',
            status: 'active',
            applies_to: 'workmanship',
          },
        ]),
      });
      return;
    }

    await route.fallback();
  });

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: AGREEMENT_ID,
          title: 'Kitchen Remodel Agreement',
          project_title: 'Kitchen Remodel Agreement',
          homeowner_name: 'Jordan Demo',
          homeowner_email: 'jordan@example.com',
          total_cost: '12000.00',
          payment_mode: 'escrow',
          status: 'signed',
          signed_by_contractor: true,
          signed_by_homeowner: true,
          escrow_funded: false,
          invoices: [],
          milestones: [],
          pdf_versions: [],
        }),
      });
    }
  );

  await page.goto(`/app/agreements/${AGREEMENT_ID}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('agreement-warranties-heading')).toBeVisible();
  await expect(page.getByTestId(`warranty-card-${WARRANTY_ID}`)).toContainText(
    '12-Month Workmanship Warranty'
  );
  await expect(page.getByTestId(`warranty-card-${WARRANTY_ID}`)).toContainText(
    'Active'
  );
  await expect(page.getByTestId(`warranty-card-${WARRANTY_ID}`)).toContainText(
    'Applies to: Workmanship'
  );
});
