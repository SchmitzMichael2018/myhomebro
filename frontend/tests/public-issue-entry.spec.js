import { expect, test } from '@playwright/test';

const MAGIC_TOKEN = 'public-issue-token';
const DISPUTE_ID = 7701;
const PUBLIC_TOKEN = 'public-thread-token';

test('public customer issue entry can open from magic invoice and redirect into the public dispute thread', async ({
  page,
}) => {
  await page.route(
    new RegExp(`/api/projects/invoices/magic/${MAGIC_TOKEN}/?$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 91,
          invoice_number: 'INV-MAGIC-91',
          status: 'pending',
          amount: 1800,
          project_title: 'Bathroom Remodel',
          homeowner_name: 'Jordan Demo',
          payment_mode: 'escrow',
          agreement_status: 'pending',
          milestone_id: 14,
          milestone_title: 'Final punch list',
          milestone_description: 'Wrap-up items before final approval.',
          milestone_completion_notes: 'Customer requested one final walkthrough.',
          milestone_attachments: [],
        }),
      });
    }
  );

  await page.route(
    new RegExp(`/api/projects/invoices/magic/${MAGIC_TOKEN}/dispute/?$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          dispute_id: DISPUTE_ID,
          public_token: PUBLIC_TOKEN,
        }),
      });
    }
  );

  await page.route(
    new RegExp(`/api/projects/disputes/public/${DISPUTE_ID}/\\?token=${PUBLIC_TOKEN}$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: DISPUTE_ID,
          dispute_number: `#${DISPUTE_ID}`,
          status: 'open',
          agreement_number: 456,
          agreement_title: 'Bathroom Remodel',
          reason: 'quality_issue',
          scope_type: 'milestone',
          created_at: '2026-03-20T10:00:00Z',
          description: 'The finish work does not match the agreed scope.',
          messages: [
            {
              id: 1,
              author_role: 'homeowner',
              created_at: '2026-03-20T10:05:00Z',
              body: 'Initial issue submitted.',
              message_type: 'comment',
            },
          ],
          attachments: [],
        }),
      });
    }
  );

  await page.goto(`/invoices/magic/${MAGIC_TOKEN}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('public-issue-entry-button')).toBeVisible();
  await page.getByTestId('public-issue-entry-button').click();

  await expect(page.getByTestId('public-issue-entry-title')).toBeVisible();
  await page
    .getByTestId('public-issue-reason-select')
    .selectOption('quality_issue');
  await page
    .getByTestId('public-issue-description-input')
    .fill('The finish work does not match the agreed scope.');
  await page.getByTestId('public-issue-submit-button').click();

  await expect(page).toHaveURL(
    `/disputes/${DISPUTE_ID}?token=${PUBLIC_TOKEN}`
  );
  await expect(page.getByTestId('public-dispute-heading')).toContainText(
    `#${DISPUTE_ID}`
  );
  await expect(page.getByTestId('public-dispute-reply-input')).toBeVisible();
  await expect(page.getByTestId('public-dispute-send-button')).toBeVisible();
});
