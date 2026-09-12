import { expect, test } from '@playwright/test';

const DISPUTE_ID = 9704;
const TOKEN = 'mobile-safari-qa-token';

function fixture(overrides = {}) {
  return {
    id: DISPUTE_ID,
    dispute_number: `#${DISPUTE_ID}`,
    status: 'open',
    agreement_number: 37,
    agreement_title: 'Mobile Safari QA Agreement',
    reason: 'Door does not close or latch',
    scope_type: 'milestone',
    created_at: '2026-09-12T18:00:00Z',
    description: 'The installed door is visibly misaligned and does not latch.',
    qualification_status: 'qualified',
    payment_hold: { is_active: true },
    messages: [
      {
        id: 1,
        author_role: 'contractor',
        created_at: '2026-09-12T18:10:00Z',
        body: 'Please confirm the issue and attach a clear photo.',
        message_type: 'comment',
      },
    ],
    attachments: [],
    claims: [],
    work_pause_requests: [],
    resolution_documents: [],
    escrow_allocations: [
      {
        id: 44,
        status: 'awaiting_authorization',
        source_amount_cents: 20000,
        contractor_amount_cents: 12500,
        homeowner_amount_cents: 7500,
        homeowner_authorized_at: null,
        explanation: 'Authorized split of the held milestone payment.',
      },
    ],
    ...overrides,
  };
}

test('customer response and exact-allocation authorization are usable in mobile Safari', async ({ page }) => {
  let current = fixture();
  await page.route(`**/api/projects/disputes/public/${DISPUTE_ID}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) });
      return;
    }
    if (request.url().includes('/messages/')) {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 2,
          author_role: 'homeowner',
          created_at: '2026-09-12T18:20:00Z',
          body: 'The door rubs at the top and will not latch.',
          message_type: 'comment',
        }),
      });
      return;
    }
    if (request.url().includes('/escrow-allocations/44/authorize/')) {
      current = fixture({
        escrow_allocations: [
          {
            ...fixture().escrow_allocations[0],
            status: 'authorized',
            homeowner_authorized_at: '2026-09-12T18:21:00Z',
          },
        ],
      });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"Not found"}' });
  });

  await page.goto(`/disputes/${DISPUTE_ID}?token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('public-dispute-heading')).toContainText(`#${DISPUTE_ID}`);
  await expect(page.getByText('Proposed escrow allocation')).toBeVisible();
  await expect(page.getByText('Held:')).toBeVisible();
  await expect(page.getByText('$200.00')).toBeVisible();
  await expect(page.getByText('$125.00')).toBeVisible();
  await expect(page.getByText('$75.00')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  for (const label of ['Take Photo', 'Choose Photos', 'Authorize exact amounts', 'Reject']) {
    const control = page.getByText(label, { exact: true });
    await expect(control).toBeVisible();
    expect((await control.boundingBox())?.height || 0).toBeGreaterThanOrEqual(44);
  }

  await page.getByTestId('public-dispute-reply-input').fill('The door rubs at the top and will not latch.');
  await page.locator('input[type="file"][multiple]').setInputFiles({
    name: 'door-alignment.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('mobile-safari-qa-image'),
  });
  await expect(page.getByTestId('public-dispute-selected-photos')).toContainText('door-alignment.jpg');
  await page.getByTestId('public-dispute-send-button').click();
  await expect(page.getByText('The door rubs at the top and will not latch.')).toBeVisible();
  await expect(page.getByTestId('public-dispute-reply-input')).toHaveValue('');

  await page.getByRole('button', { name: 'Authorize exact amounts' }).click();
  await expect(page.getByText('Proposed escrow allocation')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});
