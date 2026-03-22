import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 420;
const MILESTONE_ID = 501;
const INVOICE_ID = 910;

test('completed milestone can open invoice detail through the contractor invoice action', async ({
  page,
}) => {
  let invoice = {
    id: INVOICE_ID,
    invoice_number: 'INV-910',
    status: 'pending',
    display_status: 'pending',
    amount: 2500,
    agreement_id: AGREEMENT_ID,
    agreement: {
      id: AGREEMENT_ID,
      payment_mode: 'escrow',
    },
    project_title: 'Kitchen Remodel',
    milestone_id: MILESTONE_ID,
    milestone_order: 1,
    milestone_title: 'Demo and prep',
    milestone_description: 'Initial demolition and site prep.',
    customer_name: 'Jordan Demo',
    customer_email: 'jordan@example.com',
  };

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

  await page.route(/\/api\/projects\/milestones\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: MILESTONE_ID,
            agreement_id: AGREEMENT_ID,
            title: 'Demo and prep',
            amount: 2500,
            completion_date: '2026-03-21',
            completed: true,
            is_invoiced: false,
          },
        ],
      }),
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
            homeowner_name: 'Jordan Demo',
            payment_mode: 'escrow',
            status: 'funded',
            is_fully_signed: true,
            escrow_funded: true,
          },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/invoices\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route(
    new RegExp(`/api/projects/milestones/${MILESTONE_ID}/create-invoice/?$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: INVOICE_ID,
          invoice_number: invoice.invoice_number,
        }),
      });
    }
  );

  await page.route(
    new RegExp(`/api/projects/invoices/${INVOICE_ID}/?(\\?.*)?$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(invoice),
      });
    }
  );

  await page.goto('/app/milestones?filter=complete_not_invoiced', {
    waitUntil: 'domcontentloaded',
  });

  await expect(
    page.getByTestId(`milestone-invoice-button-${MILESTONE_ID}`)
  ).toBeVisible();

  await page.getByTestId(`milestone-invoice-button-${MILESTONE_ID}`).click();

  await expect(page).toHaveURL(`/app/invoices/${INVOICE_ID}`);
  await expect(page.getByTestId('invoice-detail-heading')).toContainText(
    'Invoice #INV-910'
  );
  await expect(page.getByTestId('invoice-detail-status')).toContainText(
    'pending'
  );
  await expect(
    page.getByTestId('invoice-detail-milestone-title')
  ).toContainText('Demo and prep');
});
