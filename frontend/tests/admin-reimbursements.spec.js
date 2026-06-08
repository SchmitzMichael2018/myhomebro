import { expect, test } from '@playwright/test';

const baseRow = {
  id: 99,
  agreement_id: 12,
  project_id: 4,
  project_title: 'Kitchen Flooring',
  contractor: { id: 1, name: 'Escrow Builder' },
  customer: { id: 2, name: 'Pat Customer', email: 'pat@example.com' },
  amount: '425.00',
  category: 'materials',
  category_label: 'Materials',
  milestone: { id: 8, title: 'Materials & Prep' },
  status: 'pending_release',
  status_label: 'Pending Release',
  submitted_at: '2026-06-01T10:00:00Z',
  approved_at: '2026-06-01T11:00:00Z',
  released_at: null,
  receipt_url: '/files/receipt.pdf',
  proof: {},
  available_escrow_at_approval: '1000.00',
  current_ledger: {
    funded: '1000.00',
    invoice_released: '0.00',
    draw_released: '0.00',
    reimbursement_released: '0.00',
    reimbursement_pending: '425.00',
    released_total: '0.00',
    holds: '0.00',
    available: '575.00',
  },
  stripe_transfer_id: '',
  release_error: '',
  hold_reason: '',
  held_at: null,
  hold_cleared_at: null,
  has_dispute_hold: false,
  release_blockers: [],
  can_release: true,
};

const detailRow = {
  ...baseRow,
  description: 'Flooring materials reimbursement',
  notes_to_homeowner: 'Receipt attached for LVP materials.',
  customer_acted_at: '2026-06-01T11:00:00Z',
  denial_reason: '',
  attachments: [{ id: 7, name: 'materials-proof.pdf', url: '/files/materials-proof.pdf' }],
  ledger_breakdown: baseRow.current_ledger,
};

function listPayload(row = baseRow) {
  return {
    summary: {
      pending_review: 1,
      pending_release: row.status === 'pending_release' ? 1 : 0,
      held: row.status === 'held' ? 1 : 0,
      released: row.status === 'released' ? 1 : 0,
      denied: 0,
      failed_release: row.release_error ? 1 : 0,
    },
    results: [row],
  };
}

async function installAdminMocks(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 1,
        type: 'admin',
        role: 'admin',
        email: 'owner@myhomebro.local',
      }),
    });
  });
}

test('admin reimbursement dashboard reviews, holds, clears, and records release', async ({ page }) => {
  await installAdminMocks(page);
  let row = { ...baseRow };
  let detail = { ...detailRow };
  let statusFilter = '';

  page.on('dialog', async (dialog) => {
    if (dialog.type() === 'prompt') {
      await dialog.accept(dialog.message().includes('Hold') ? 'Need receipt review.' : 'manual-transfer-123');
      return;
    }
    await dialog.accept();
  });

  await page.route('**/api/projects/admin/reimbursements/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (method === 'GET' && /\/admin\/reimbursements\/?\?/.test(url)) {
      statusFilter = new URL(url).searchParams.get('status') || '';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(listPayload(row)) });
      return;
    }

    if (method === 'GET' && url.includes('/admin/reimbursements/99/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) });
      return;
    }

    if (method === 'POST' && url.includes('/admin/reimbursements/99/hold/')) {
      row = { ...row, status: 'held', status_label: 'Held', hold_reason: 'Need receipt review.', can_release: false, release_blockers: ['Admin hold is active.'] };
      detail = { ...detail, ...row, ledger_breakdown: row.current_ledger };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ detail: 'Hold placed.', reimbursement: detail }) });
      return;
    }

    if (method === 'POST' && url.includes('/admin/reimbursements/99/clear-hold/')) {
      row = { ...row, status: 'pending_release', status_label: 'Pending Release', hold_reason: 'Need receipt review.', can_release: true, release_blockers: [] };
      detail = { ...detail, ...row, ledger_breakdown: row.current_ledger };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ detail: 'Hold cleared.', reimbursement: detail }) });
      return;
    }

    if (method === 'POST' && url.includes('/admin/reimbursements/99/record-release/')) {
      row = { ...row, status: 'released', status_label: 'Released', released_at: '2026-06-01T12:00:00Z', stripe_transfer_id: 'manual-transfer-123', can_release: false, release_blockers: ['Already released.'] };
      detail = { ...detail, ...row, ledger_breakdown: row.current_ledger };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ detail: 'Release recorded.', reimbursement: detail }) });
      return;
    }

    await route.fallback();
  });

  await page.goto('/app/admin/reimbursements', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('admin-reimbursements-page')).toBeVisible();
  await expect(page.getByTestId('admin-reimbursements-summary')).toContainText('Pending Release');
  await expect(page.getByTestId('admin-reimbursement-row-99')).toContainText('Kitchen Flooring');
  await expect(page.getByTestId('admin-reimbursement-row-99')).toContainText('$425.00');
  await expect(page.getByTestId('admin-reimbursement-row-99')).toContainText('Current: $575.00');
  await expect.poll(() => statusFilter).toBe('pending_release');

  await page.getByTestId('admin-reimbursements-status-filter').selectOption('held');
  await expect.poll(() => statusFilter).toBe('held');

  await page.getByTestId('admin-reimbursement-open-99').click();
  await expect(page.getByTestId('admin-reimbursement-detail')).toContainText('Flooring materials reimbursement');
  await expect(page.getByTestId('admin-reimbursement-ledger')).toContainText('reimbursement pending');
  await expect(page.getByTestId('admin-reimbursement-receipt-link')).toHaveAttribute('href', /receipt\.pdf$/);

  await page.getByTestId('admin-reimbursement-place-hold').click();
  await expect(page.getByTestId('admin-reimbursement-detail')).toContainText('Held');
  await expect(page.getByTestId('admin-reimbursement-record-release')).toBeDisabled();
  await page.getByTestId('admin-reimbursement-clear-hold').click();
  await expect(page.getByTestId('admin-reimbursement-detail')).toContainText('Pending Release');
  await expect(page.getByTestId('admin-reimbursement-record-release')).toBeEnabled();

  await page.getByTestId('admin-reimbursement-record-release').click();
  await expect(page.getByTestId('admin-reimbursement-detail')).toContainText('Released');
  await expect(page.getByTestId('admin-reimbursement-detail')).toContainText('manual-transfer-123');
});
