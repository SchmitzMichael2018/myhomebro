import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 123;

async function setAuthenticatedSession(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });
}

function trackFundingPreview(page, agreementId, payload, calls) {
  return page.route(
    new RegExp(`/api/projects/agreements/${agreementId}/funding_preview/?(\\?.*)?$`),
    async (route) => {
      const headers = route.request().headers();
      const auth = headers.authorization || headers.Authorization || '';
      const status = auth ? 200 : 401;

      calls.push({
        url: route.request().url(),
        auth,
        status,
      });

      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(
          auth
            ? payload
            : {
                detail: 'Unauthorized',
              }
        ),
      });
    }
  );
}

function trackConsoleErrors(page, bucket) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') bucket.push(msg.text());
  });
}

async function mockAgreementDetailSurface(page, fundingPreview, calls) {
  await setAuthenticatedSession(page);
  trackFundingPreview(page, AGREEMENT_ID, fundingPreview, calls);

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 7,
        type: 'contractor',
        role: 'contractor_owner',
        email: 'schmitzmichael1985@gmail.com',
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

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: AGREEMENT_ID,
        title: 'Funding Preview Smoke Agreement',
        project_title: 'Funding Preview Smoke Agreement',
        homeowner_name: 'Jordan Demo',
        homeowner_email: 'jordan@example.com',
        homeowner_snapshot: {
          id: 1,
          full_name: 'Jordan Demo',
          email: 'jordan@example.com',
        },
        payment_mode: 'escrow',
        payment_structure: 'simple',
        status: 'signed',
        signature_is_satisfied: true,
        is_fully_signed: true,
        signed_by_contractor: true,
        signed_by_homeowner: true,
        total_cost: '5000.00',
      }),
    });
  });

  await page.route('**/api/projects/subaccounts/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/warranties/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/api/projects/agreements/123/attachments/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/agreements/123/subcontractor-invitations/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ pending_invitations: [], accepted_subcontractors: [] }),
    });
  });

  await page.route('**/api/projects/activity-feed/', async (route) => {
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

  await page.route('**/api/projects/expense-requests/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/milestones/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/agreements/*/external-payments/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });
}

async function mockStep4Surface(page, fundingPreview, calls) {
  await setAuthenticatedSession(page);
  trackFundingPreview(page, AGREEMENT_ID, fundingPreview, calls);

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 7,
        type: 'contractor',
        role: 'contractor_owner',
        email: 'schmitzmichael1985@gmail.com',
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

  await page.route('**/api/projects/homeowners/1/', async (route) => {
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
        created_at: '2026-03-01T10:00:00Z',
      }),
    });
  });

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: AGREEMENT_ID,
        agreement_id: AGREEMENT_ID,
        project_title: 'Kitchen Remodel',
        title: 'Kitchen Remodel',
        homeowner: 1,
        homeowner_snapshot: {
          id: 1,
          full_name: 'Jordan Demo',
          company_name: 'Demo Customer',
          email: 'jordan@example.com',
        },
        payment_mode: 'escrow',
        payment_structure: 'progress',
        status: 'draft',
        total_cost: '5000.00',
      }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/\?agreement(=|_id=)123.*/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 10, agreement: AGREEMENT_ID, title: 'Demo', amount: 2000, completed: true },
        { id: 11, agreement: AGREEMENT_ID, title: 'Install', amount: 3000, completed: false },
      ]),
    });
  });

  await page.route('**/api/projects/attachments/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
}

async function mockDashboardSurface(page, fundingPreview, calls) {
  await setAuthenticatedSession(page);
  trackFundingPreview(page, AGREEMENT_ID, fundingPreview, calls);

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 7,
        type: 'contractor',
        role: 'contractor_owner',
        email: 'schmitzmichael1985@gmail.com',
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

  await page.route('**/api/projects/contractors/me/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        created_at: '2026-03-01T10:00:00Z',
        business_name: 'MHB Commercial',
        city: 'Dallas',
        payouts_enabled: true,
        charges_enabled: true,
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: AGREEMENT_ID,
            title: 'Funding Preview Smoke Agreement',
            payment_structure: 'simple',
            payment_mode: 'escrow',
            total_cost: '5000.00',
          },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/invoices\/?(?:\?.*)?$/, async (route) => {
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

  await page.route('**/api/projects/expense-requests/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/activity-feed/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/dashboard/operations/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        identity_type: 'contractor_owner',
        today: [],
        tomorrow: [],
        this_week: [],
        recent_activity: [],
      }),
    });
  });
}

test.describe('funding preview smoke', () => {
  test('agreement page loads funding preview without auth errors or stuck loading', async ({ page }) => {
    const fundingCalls = [];
    const consoleErrors = [];
    trackConsoleErrors(page, consoleErrors);

    await mockAgreementDetailSurface(
      page,
      {
        project_amount: '5000.00',
        platform_fee: '251.00',
        contractor_payout: '4749.00',
        homeowner_escrow: '5000.00',
        rate: 0.03,
        flat_fee: 1,
        is_intro: true,
        tier_name: 'INTRO',
        high_risk_applied: false,
      },
      fundingCalls
    );

    await page.goto(`/app/agreements/${AGREEMENT_ID}`, { waitUntil: 'domcontentloaded' });

    await expect.poll(() => fundingCalls.length).toBeGreaterThan(0);
    await expect(page.getByRole('heading', { name: 'Project Totals & Fee Summary (Contractor View)' })).toBeVisible();
    await expect(page.getByText('Loading fee & escrow summary')).toHaveCount(0);
    await expect(page.getByText('Fee summary not available yet.')).toHaveCount(0);
    await expect(page.getByText(/Current platform rate:\s*3(?:\.0+)?% \+ \$1/i)).toBeVisible();
    await expect(page.getByText('Intro rate (first 60 days)')).toBeVisible();

    expect(fundingCalls.length).toBeLessThanOrEqual(2);
    expect(fundingCalls.every((call) => call.status === 200)).toBe(true);
    expect(fundingCalls.every((call) => call.auth.includes('Bearer'))).toBe(true);
    expect(consoleErrors.filter((text) => /funding_preview/i.test(text))).toEqual([]);
    expect(consoleErrors.filter((text) => /Failed to load pricing/i.test(text))).toEqual([]);

    await page.screenshot({
      path: 'test-results/screenshots/funding-preview-agreement.png',
      fullPage: true,
    });
  });

  test('step 4 fee summary loads cleanly and only fetches preview once', async ({ page }) => {
    const fundingCalls = [];
    const consoleErrors = [];
    trackConsoleErrors(page, consoleErrors);

    await mockStep4Surface(
      page,
      {
        project_amount: 5000,
        platform_fee: 251,
        contractor_payout: 4749,
        homeowner_escrow: 5000,
        rate: 0.03,
        flat_fee: 1,
        is_intro: true,
        tier_name: 'INTRO',
      },
      fundingCalls
    );

    await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=4`, {
      waitUntil: 'domcontentloaded',
    });

    await expect.poll(() => fundingCalls.length).toBeGreaterThan(0);
    await expect(page.getByTestId('step4-financial-summary')).toBeVisible();
    await expect(page.getByTestId('financial-row-platform-fee')).toContainText(
      /Current rate:\s*3(?:\.0+)?% \+ \$1 \(capped at \$750\)/i
    );
    await expect(page.getByText('Loading fee & escrow summary')).toHaveCount(0);
    await expect(page.getByText(/Unable to load fee & escrow summary/i)).toHaveCount(0);

    expect(fundingCalls.length).toBeLessThanOrEqual(2);
    expect(fundingCalls.every((call) => call.status === 200)).toBe(true);
    expect(fundingCalls.every((call) => call.auth.includes('Bearer'))).toBe(true);
    expect(consoleErrors.filter((text) => /funding_preview/i.test(text))).toEqual([]);

    await page.screenshot({
      path: 'test-results/screenshots/funding-preview-step4.png',
      fullPage: true,
    });
  });

  test('dashboard pricing card loads with auth and no preview console noise', async ({ page }) => {
    const fundingCalls = [];
    const consoleErrors = [];
    trackConsoleErrors(page, consoleErrors);

    await mockDashboardSurface(
      page,
      {
        project_amount: '5000.00',
        platform_fee: '251.00',
        contractor_payout: '4749.00',
        homeowner_escrow: '5000.00',
        rate: 0.03,
        flat_fee: 1,
        is_intro: true,
        tier_name: 'INTRO',
      },
      fundingCalls
    );

    await page.goto('/app', { waitUntil: 'domcontentloaded' });

    await expect.poll(() => fundingCalls.length).toBeGreaterThan(0);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText(/Failed to load pricing \(funding_preview\)/i)).toHaveCount(0);

    expect(fundingCalls.length).toBeLessThanOrEqual(1);
    expect(fundingCalls.every((call) => call.status === 200)).toBe(true);
    expect(fundingCalls.every((call) => call.auth.includes('Bearer'))).toBe(true);
    expect(consoleErrors.filter((text) => /funding_preview/i.test(text))).toEqual([]);
    expect(consoleErrors.filter((text) => /Failed to load pricing/i.test(text))).toEqual([]);

    await page.screenshot({
      path: 'test-results/screenshots/funding-preview-dashboard.png',
      fullPage: true,
    });
  });
});
