import { expect, test } from '@playwright/test';

const baseReview = {
  id: 77,
  contractor_id: 12,
  contractor_name: 'Review Builders',
  agreement_id: 44,
  project_title: 'Kitchen Remodel',
  customer_name: 'Pat Customer',
  customer_email: 'pat@example.com',
  rating: 5,
  title: 'Clean and clear work',
  review_text: 'The contractor kept the site clean, explained every milestone, and finished the project well.',
  project_type: 'Remodel',
  project_subtype: 'Kitchen Remodel',
  moderation_status: 'pending',
  moderation_status_label: 'Pending Review',
  moderation_notes: '',
  is_public: false,
  is_verified: true,
  submitted_at: '2026-06-01T10:00:00Z',
  published_at: null,
  performance_summary: {
    average_rating: 0,
    review_count: 0,
    completed_projects: 3,
    dispute_rate: 0,
  },
};

function statusLabel(status) {
  if (status === 'approved') return 'Approved / Published';
  if (status === 'hidden') return 'Hidden';
  if (status === 'rejected') return 'Rejected';
  return 'Pending Review';
}

function listPayload(rows) {
  return {
    count: rows.length,
    summary: {
      pending: rows.filter((row) => row.moderation_status === 'pending').length,
      approved: rows.filter((row) => row.moderation_status === 'approved').length,
      hidden: rows.filter((row) => row.moderation_status === 'hidden').length,
      rejected: rows.filter((row) => row.moderation_status === 'rejected').length,
      recently_approved: rows.filter((row) => row.moderation_status === 'approved').length,
    },
    results: rows,
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
        email: 'admin@myhomebro.local',
      }),
    });
  });
}

test('admin review moderation queue filters and updates review status', async ({ page }) => {
  await installAdminMocks(page);
  let review = { ...baseReview };
  const seenQueries = [];

  await page.route('**/api/projects/admin/contractor-reviews/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const method = route.request().method();

    if (method === 'GET' && requestUrl.pathname.endsWith('/api/projects/admin/contractor-reviews/')) {
      const status = requestUrl.searchParams.get('status') || '';
      const contractor = requestUrl.searchParams.get('contractor') || '';
      const rating = requestUrl.searchParams.get('rating') || '';
      seenQueries.push({ status, contractor, rating });
      const rows = [review].filter((row) => {
        if (status && row.moderation_status !== status) return false;
        if (contractor && !`${row.contractor_name} ${row.customer_name} ${row.customer_email}`.toLowerCase().includes(contractor.toLowerCase())) return false;
        if (rating && String(row.rating) !== rating) return false;
        return true;
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(listPayload(rows)),
      });
      return;
    }

    const moderateMatch = requestUrl.pathname.match(/\/api\/projects\/admin\/contractor-reviews\/(\d+)\/moderate\/$/);
    if (method === 'POST' && moderateMatch) {
      const body = route.request().postDataJSON();
      const nextStatus = body.action === 'approve' ? 'approved' : body.action === 'hide' ? 'hidden' : 'rejected';
      review = {
        ...review,
        moderation_status: nextStatus,
        moderation_status_label: statusLabel(nextStatus),
        moderation_notes: body.moderation_notes || '',
        is_public: nextStatus === 'approved',
        published_at: nextStatus === 'approved' ? '2026-06-02T10:00:00Z' : null,
        performance_summary: nextStatus === 'approved'
          ? { ...review.performance_summary, average_rating: 5, review_count: 1 }
          : review.performance_summary,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Review updated.', review }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto('/app/admin/reviews', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('admin-reviews-page')).toBeVisible();
  await expect(page.getByTestId('admin-reviews-summary')).toContainText('Pending Reviews');
  await expect(page.getByTestId('admin-review-row-77')).toContainText('Review Builders');
  await expect(page.getByTestId('admin-review-row-77')).toContainText('Pat Customer');
  await expect(page.getByTestId('admin-review-row-77')).toContainText('Kitchen Remodel');
  await expect(page.getByTestId('admin-review-row-77')).toContainText('Pending Review');

  await page.getByTestId('admin-review-open-77').click();
  await expect(page.getByTestId('admin-review-detail')).toContainText('The contractor kept the site clean');
  await expect(page.getByTestId('admin-review-context')).toContainText('Agreement #44');
  await expect(page.getByTestId('admin-review-performance')).toContainText('Completed Projects');

  await page.getByTestId('admin-review-note').fill('Verified completion and customer match.');
  await page.getByTestId('admin-review-approve').click();
  await expect(page.getByTestId('admin-review-detail')).toContainText('Approved / Published');
  await expect(page.getByTestId('admin-review-detail')).toContainText('Public');
  await expect(page.getByTestId('admin-review-performance')).toContainText('1');

  await page.getByTestId('admin-reviews-status-filter').selectOption('approved');
  await expect(page.getByTestId('admin-review-row-77')).toContainText('Approved / Published');

  await page.getByTestId('admin-review-hide').click();
  await expect(page.getByTestId('admin-review-detail')).toContainText('Hidden');
  await expect(page.getByTestId('admin-review-detail')).toContainText('Not public');

  await page.getByTestId('admin-reviews-status-filter').selectOption('hidden');
  await expect(page.getByTestId('admin-review-row-77')).toContainText('Hidden');

  await page.getByTestId('admin-review-reject').click();
  await expect(page.getByTestId('admin-review-detail')).toContainText('Rejected');

  await page.getByTestId('admin-reviews-status-filter').selectOption('');
  await page.getByTestId('admin-reviews-contractor-filter').fill('Review Builders');
  await page.getByTestId('admin-reviews-rating-filter').selectOption('5');
  await expect(page.getByTestId('admin-review-row-77')).toContainText('Rejected');
  await expect.poll(() => seenQueries.some((query) => query.contractor === 'Review Builders' && query.rating === '5')).toBe(true);
});
