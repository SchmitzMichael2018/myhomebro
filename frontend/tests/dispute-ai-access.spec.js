import { expect, test } from '@playwright/test';

const DISPUTE_ID = 9901;

test('dispute AI surface renders without legacy AI gating text or routes', async ({
  page,
}) => {
  const requestedUrls = [];

  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  page.on('request', (request) => {
    requestedUrls.push(request.url());
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

  await page.route(/\/api\/projects\/disputes\/\?mine=true(?:&.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: DISPUTE_ID,
            agreement: 321,
            agreement_number: '321',
            initiator: 'contractor',
            reason: 'Scope disagreement',
            description: 'Need an advisory summary.',
            status: 'open',
            fee_amount: 250,
            fee_paid: true,
            escrow_frozen: true,
            homeowner_response: '',
            contractor_response: '',
            attachments: [],
            created_at: '2026-03-23T10:00:00Z',
            updated_at: '2026-03-23T10:00:00Z',
          },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/disputes\/\?initiator=homeowner(?:&.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(`**/api/projects/disputes/${DISPUTE_ID}/evidence-context/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        agreement: {
          id: 321,
          agreement_number: '321',
          title: 'Kitchen Remodel',
          homeowner_name: 'Jordan Demo',
          contractor_name: 'MyHomeBro Contractor',
          created_at: '2026-03-20T12:00:00Z',
          total_amount: 5400,
        },
        dispute: {
          id: DISPUTE_ID,
          status: 'open',
          escrow_frozen: true,
          fee_paid: true,
          category: 'scope',
          initiator: 'contractor',
          created_at: '2026-03-23T10:00:00Z',
          last_activity_at: '2026-03-23T10:10:00Z',
          complaint: 'Need a neutral summary.',
        },
        milestones: [],
        invoices: [],
        evidence: [],
        meta: {
          generated_at: '2026-03-23T10:10:00Z',
        },
      }),
    });
  });

  await page.goto('/app/disputes', { waitUntil: 'domcontentloaded' });

  const disputeRow = page.locator('tr', { hasText: `#${DISPUTE_ID}` });
  await expect(disputeRow).toBeVisible();
  await disputeRow.getByRole('button', { name: 'View' }).click();

  await expect(page.getByText(`Dispute #${DISPUTE_ID}`)).toBeVisible();
  await expect(page.getByTestId('dispute-ai-advisor')).toBeVisible();
  await expect(page.getByText('AI Advisor')).toBeVisible();
  await expect(page.locator('text=/Upgrade to AI Pro|Payment required|Pay \\$/i')).toHaveCount(0);
  expect(requestedUrls.some((url) => url.includes('/api/projects/feature-flags/'))).toBeFalsy();
  expect(requestedUrls.some((url) => url.includes('/ai/checkout/'))).toBeFalsy();
  expect(requestedUrls.some((url) => url.includes('/ai/void-credit/'))).toBeFalsy();
});
