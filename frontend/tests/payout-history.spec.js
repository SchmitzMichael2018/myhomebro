import { expect, test } from '@playwright/test';

test('contractor payout history page renders totals, filters, and empty state', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  let filteredMode = false;

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

  await page.route('**/api/projects/payouts/history/export/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/csv',
      body: 'agreement,milestone,subcontractor,amount,status,execution_mode,paid_at,failed_at,transfer_id,failure_reason\n',
    });
  });

  await page.route('**/api/projects/payouts/history/**', async (route) => {
    const url = new URL(route.request().url());
    const status = url.searchParams.get('status') || '';
    const subcontractor = url.searchParams.get('subcontractor_user') || '';

    if (filteredMode || status === 'failed' || subcontractor === 'nobody@example.com') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [],
          summary: {
            total_paid_amount: '0.00',
            total_ready_amount: '0.00',
            total_failed_amount: '0.00',
            total_pending_amount: '0.00',
            record_count: 0,
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 1,
            agreement_id: 321,
            agreement_title: 'Kitchen Remodel Agreement',
            milestone_id: 901,
            milestone_title: 'Cabinet Install',
            subcontractor_user_id: 88,
            subcontractor_display_name: 'Taylor Sub',
            subcontractor_email: 'taylor@example.com',
            payout_amount: '1500.00',
            payout_status: 'paid',
            execution_mode: 'manual',
            ready_for_payout_at: '2026-03-20T10:00:00Z',
            paid_at: '2026-03-21T11:00:00Z',
            failed_at: null,
            stripe_transfer_id: 'tr_paid_hist',
            failure_reason: '',
            updated_at: '2026-03-21T11:00:00Z',
          },
          {
            id: 2,
            agreement_id: 321,
            agreement_title: 'Kitchen Remodel Agreement',
            milestone_id: 902,
            milestone_title: 'Final Punch',
            subcontractor_user_id: 89,
            subcontractor_display_name: 'Casey Ready',
            subcontractor_email: 'casey@example.com',
            payout_amount: '700.00',
            payout_status: 'ready_for_payout',
            execution_mode: 'automatic',
            ready_for_payout_at: '2026-03-24T09:00:00Z',
            paid_at: null,
            failed_at: null,
            stripe_transfer_id: '',
            failure_reason: '',
            updated_at: '2026-03-24T09:00:00Z',
          },
          {
            id: 3,
            agreement_id: 654,
            agreement_title: 'Bathroom Remodel Agreement',
            milestone_id: 903,
            milestone_title: 'Tile Work',
            subcontractor_user_id: 90,
            subcontractor_display_name: 'Morgan Failed',
            subcontractor_email: 'morgan@example.com',
            payout_amount: '400.00',
            payout_status: 'failed',
            execution_mode: 'automatic',
            ready_for_payout_at: '2026-03-23T09:00:00Z',
            paid_at: null,
            failed_at: '2026-03-23T11:30:00Z',
            stripe_transfer_id: '',
            failure_reason: 'Bank rejected transfer',
            updated_at: '2026-03-23T11:30:00Z',
          },
        ],
        summary: {
          total_paid_amount: '1500.00',
          total_ready_amount: '700.00',
          total_failed_amount: '400.00',
          total_pending_amount: '0.00',
          record_count: 3,
        },
      }),
    });
  });

  await page.goto('/app/payouts/history', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('payout-history-title')).toBeVisible();
  await expect(page.getByTestId('payout-summary-paid')).toContainText('$1,500.00');
  await expect(page.getByTestId('payout-summary-ready')).toContainText('$700.00');
  await expect(page.getByTestId('payout-summary-failed')).toContainText('$400.00');
  await expect(page.getByTestId('payout-history-row-1')).toContainText('Taylor Sub');
  await expect(page.getByTestId('payout-history-row-1')).toContainText('manual');
  await expect(page.getByTestId('payout-history-row-2')).toContainText('automatic');
  await expect(page.getByTestId('payout-history-row-3')).toContainText('Bank rejected transfer');

  await page.getByTestId('payout-filter-status').selectOption('failed');
  await expect(page.getByTestId('payout-history-empty')).toBeVisible();

  filteredMode = false;
  await page.getByTestId('payout-filter-status').selectOption('');
  await page.getByTestId('payout-filter-subcontractor').fill('nobody@example.com');
  await expect(page.getByTestId('payout-history-empty')).toBeVisible();
});

test('payout detail page renders paid ready and failed payout examples', async ({ page }) => {
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

  await page.route('**/api/projects/payouts/history/*/', async (route) => {
    const match = route.request().url().match(/\/api\/projects\/payouts\/history\/(\d+)\/?$/);
    const payoutId = match?.[1];

    if (payoutId === '1') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          payout_id: 1,
          agreement_id: 321,
          agreement_title: 'Kitchen Remodel Agreement',
          milestone_id: 901,
          milestone_title: 'Cabinet Install',
          subcontractor_display_name: 'Taylor Sub',
          subcontractor_email: 'taylor@example.com',
          payout_amount: '1500.00',
          payout_status: 'paid',
          execution_mode: 'manual',
          ready_for_payout_at: '2026-03-20T10:00:00Z',
          paid_at: '2026-03-21T11:00:00Z',
          failed_at: null,
          stripe_transfer_id: 'tr_paid_hist',
          failure_reason: '',
          effective_at: '2026-03-21T11:00:00Z',
        }),
      });
      return;
    }

    if (payoutId === '2') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          payout_id: 2,
          agreement_id: 321,
          agreement_title: 'Kitchen Remodel Agreement',
          milestone_id: 902,
          milestone_title: 'Final Punch',
          subcontractor_display_name: 'Casey Ready',
          subcontractor_email: 'casey@example.com',
          payout_amount: '700.00',
          payout_status: 'ready_for_payout',
          execution_mode: 'automatic',
          ready_for_payout_at: '2026-03-24T09:00:00Z',
          paid_at: null,
          failed_at: null,
          stripe_transfer_id: '',
          failure_reason: '',
          effective_at: '2026-03-24T09:00:00Z',
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        payout_id: 3,
        agreement_id: 654,
        agreement_title: 'Bathroom Remodel Agreement',
        milestone_id: 903,
        milestone_title: 'Tile Work',
        subcontractor_display_name: 'Morgan Failed',
        subcontractor_email: 'morgan@example.com',
        payout_amount: '400.00',
        payout_status: 'failed',
        execution_mode: 'automatic',
        ready_for_payout_at: '2026-03-23T09:00:00Z',
        paid_at: null,
        failed_at: '2026-03-23T11:30:00Z',
        stripe_transfer_id: '',
        failure_reason: 'Bank rejected transfer',
        effective_at: '2026-03-23T11:30:00Z',
      }),
    });
  });

  await page.goto('/app/payouts/history/1', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('payout-detail-title')).toBeVisible();
  await expect(page.getByTestId('payout-detail-surface')).toContainText('paid');
  await expect(page.getByTestId('payout-detail-surface')).toContainText('Taylor Sub');
  await expect(page.getByTestId('payout-detail-surface')).toContainText('tr_paid_hist');

  await page.goto('/app/payouts/history/2', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('payout-detail-surface')).toContainText('Ready For Payout');
  await expect(page.getByTestId('payout-detail-surface')).toContainText('Casey Ready');

  await page.goto('/app/payouts/history/3', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('payout-detail-surface')).toContainText('Morgan Failed');
  await expect(page.getByTestId('payout-detail-failure-reason')).toContainText('Bank rejected transfer');
});

test('payout detail page shows graceful missing fallback', async ({ page }) => {
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

  await page.route('**/api/projects/payouts/history/*/', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        detail: 'Payout record not found.',
      }),
    });
  });

  await page.goto('/app/payouts/history/999', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('payout-detail-missing')).toContainText('Payout record not found.');
});
