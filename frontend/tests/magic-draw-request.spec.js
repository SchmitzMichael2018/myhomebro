import { expect, test } from '@playwright/test';

const DRAW_TOKEN = '11111111-1111-4111-8111-111111111111';

function buildDraw(overrides = {}) {
  return {
    id: 41,
    draw_number: 2,
    title: 'Interior Buildout',
    status: 'submitted',
    workflow_status: 'submitted',
    workflow_status_label: 'Submitted',
    workflow_message: 'Submitted for owner review.',
    gross_amount: '5000.00',
    retainage_amount: '500.00',
    net_amount: '4500.00',
    payment_mode: 'direct',
    notes: 'Please review the completed framing and rough-in progress.',
    line_items: [
      {
        id: 1,
        milestone_title: 'Framing',
        description: 'Framing',
        scheduled_value: '8000.00',
        percent_complete: '50.00',
        this_draw_amount: '4000.00',
        remaining_balance: '4000.00',
      },
      {
        id: 2,
        milestone_title: 'Rough-In',
        description: 'Rough-In',
        scheduled_value: '2000.00',
        percent_complete: '50.00',
        this_draw_amount: '1000.00',
        remaining_balance: '1000.00',
      },
    ],
    ...overrides,
  };
}

async function installPublicDrawMocks(page, { getDraw, approveDraw, changesDraw }) {
  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Not authenticated.' }),
    });
  });

  await page.route(`**/api/projects/draws/magic/${DRAW_TOKEN}/`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(getDraw ?? buildDraw()),
    });
  });

  await page.route(`**/api/projects/draws/magic/${DRAW_TOKEN}/approve/`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        approveDraw ??
          buildDraw({
            status: 'approved',
            workflow_status: 'payment_pending',
            workflow_status_label: 'Payment Pending',
            workflow_message: 'Approved by the owner. Payment is still pending through MyHomeBro.',
            stripe_checkout_url: 'https://checkout.stripe.test/draw-123',
          })
      ),
    });
  });

  await page.route(`**/api/projects/draws/magic/${DRAW_TOKEN}/request_changes/`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        changesDraw ??
          buildDraw({
            status: 'changes_requested',
            workflow_status: 'changes_requested',
            workflow_status_label: 'Changes Requested',
            workflow_message: 'The owner requested changes before payment moves forward.',
            homeowner_review_notes: 'Please confirm the rough-in inspection is complete.',
          })
      ),
    });
  });
}

test('magic draw review page supports approve to payment handoff for direct-pay draws', async ({ page }) => {
  await installPublicDrawMocks(page, {
    approveDraw: buildDraw({
      status: 'approved',
      workflow_status: 'payment_pending',
      workflow_status_label: 'Payment Pending',
      stripe_checkout_url: 'https://checkout.stripe.test/draw-123',
    }),
  });

  await page.goto(`/draws/magic/${DRAW_TOKEN}`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Commercial draw review')).toBeVisible();
  await expect(page.getByText('Draw 2: Interior Buildout')).toBeVisible();
  await expect(page.getByText('$4,500.00')).toBeVisible();
  await expect(page.getByText('Retainage is included in this draw.')).toBeVisible();

  await page.getByRole('button', { name: 'Approve & Continue' }).click();

  await expect(page.getByText('Payment Pending')).toBeVisible();
  await expect(page.getByText('Payment ready')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue to Secure Payment' })).toHaveAttribute(
    'href',
    'https://checkout.stripe.test/draw-123'
  );
  await expect(page.getByText('Stripe supports card and ACH for this direct-payment draw.')).toBeVisible();
});

test('magic draw review page supports change requests', async ({ page }) => {
  await installPublicDrawMocks(page, {
    getDraw: buildDraw({ payment_mode: 'escrow' }),
    changesDraw: buildDraw({
      payment_mode: 'escrow',
      status: 'changes_requested',
      workflow_status: 'changes_requested',
      workflow_status_label: 'Changes Requested',
      homeowner_review_notes: 'Please confirm the rough-in inspection is complete.',
    }),
  });

  await page.goto(`/draws/magic/${DRAW_TOKEN}`, { waitUntil: 'domcontentloaded' });

  await page.getByPlaceholder('Optional note for your contractor').fill(
    'Please confirm the rough-in inspection is complete.'
  );
  await page.getByRole('button', { name: 'Request Changes' }).click();

  await expect(page.getByText('This draw is currently changes requested.')).toBeVisible();
  await expect(page.getByText('Please confirm the rough-in inspection is complete.')).toBeVisible();
});
