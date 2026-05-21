import { expect, test } from '@playwright/test';

const makeAgreement = (id, overrides = {}) => ({
  id,
  title: `Agreement ${id}`,
  project_title: `Agreement ${id}`,
  status: id % 3 === 0 ? 'signed' : 'draft',
  project_class: id % 2 === 0 ? 'commercial' : 'residential',
  project_mode: id % 2 === 0 ? 'consultation' : 'full_service',
  payment_mode: id % 3 === 0 ? 'escrow' : 'direct',
  homeowner_name: `Customer ${id}`,
  homeowner_email: `customer${id}@example.com`,
  total_cost: `${id * 100}.00`,
  display_total: `${id * 100}.00`,
  invoices_count: id % 2,
  require_contractor_signature: true,
  require_customer_signature: true,
  signature_is_satisfied: id % 3 === 0,
  is_fully_signed: id % 3 === 0,
  escrow_funded: false,
  is_archived: false,
  pdf_version: 1,
  pdf_versions_count: 1,
  ...overrides,
});

const agreements = Array.from({ length: 12 }, (_, index) =>
  makeAgreement(index + 1, index === 0 ? { project_title: 'Kitchen Draft Agreement' } : {})
).concat(makeAgreement(13, { project_title: 'Archived Patio Agreement', is_archived: true }));

async function installAgreementListMocks(page) {
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
        email: 'contractor@example.com',
      }),
    });
  });

  await page.route(/\/api\/projects\/homeowners\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count: 0, next: null, previous: null, results: [] }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/\d+\/milestones\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/?(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const pageNumber = Number(url.searchParams.get('page') || 1);
    const pageSize = Number(url.searchParams.get('page_size') || 10);
    const search = (url.searchParams.get('search') || '').toLowerCase();
    const status = (url.searchParams.get('status') || '').toLowerCase();
    const projectClass = (url.searchParams.get('project_class') || '').toLowerCase();
    const includeArchived = url.searchParams.get('include_archived') === '1';

    let filtered = agreements.slice();
    if (!includeArchived) filtered = filtered.filter((row) => !row.is_archived);
    if (search) {
      filtered = filtered.filter((row) =>
        [row.project_title, row.homeowner_name, row.homeowner_email, row.status, row.id]
          .join(' ')
          .toLowerCase()
          .includes(search)
      );
    }
    if (status && status !== 'all') filtered = filtered.filter((row) => row.status === status);
    if (projectClass && projectClass !== 'all') {
      filtered = filtered.filter((row) => row.project_class === projectClass);
    }

    const start = (pageNumber - 1) * pageSize;
    const results = filtered.slice(start, start + pageSize);
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        count: filtered.length,
        next: pageNumber < totalPages ? `/api/projects/agreements/?page=${pageNumber + 1}` : null,
        previous: pageNumber > 1 ? `/api/projects/agreements/?page=${pageNumber - 1}` : null,
        results,
      }),
    });
  });
}

test('agreements list uses dark operational styling and paginates results', async ({ page }) => {
  await installAgreementListMocks(page);

  await page.goto('/app/agreements', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Agreements' })).toBeVisible();
  await expect(page.getByTestId('agreement-list-controls')).toHaveClass(/bg-\[#061d42\]/);
  await expect(page.getByTestId('agreement-list-table-shell')).toHaveClass(/bg-\[#061d42\]/);
  await expect(page.getByRole('button', { name: /New Agreement/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Finish & Send/ }).first()).toBeVisible();
  await expect(page.getByLabel('Show archived')).toBeVisible();
  await expect(page.getByTestId('agreement-pagination-top')).toContainText('Showing 1-10 of 12');

  await page.getByTestId('agreement-pagination-top').getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('agreement-pagination-top')).toContainText('Page 2 of 2');
  await expect(page.getByText('Agreement 11')).toBeVisible();
  await expect(page.getByText('Kitchen Draft Agreement')).toHaveCount(0);

  await page.getByTestId('agreement-pagination-top').getByRole('button', { name: 'Previous' }).click();
  await expect(page.getByTestId('agreement-pagination-top')).toContainText('Page 1 of 2');
  await expect(page.getByText('Kitchen Draft Agreement')).toBeVisible();

  await page.getByTestId('agreement-page-size-select').selectOption('20');
  await expect(page.getByTestId('agreement-pagination-top')).toContainText('Showing 1-12 of 12');
  await expect(page.getByTestId('agreement-pagination-top')).toContainText('Page 1 of 1');

  await page.getByLabel('Show archived').check();
  await expect(page.getByTestId('agreement-pagination-top')).toContainText('Showing 1-13 of 13');
  await expect(page.getByText('Archived Patio Agreement')).toBeVisible();
});
