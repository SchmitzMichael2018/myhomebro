import { expect, test } from '@playwright/test';

const captureId = '55555555-5555-4555-8555-555555555555';

const capture = {
  id: captureId,
  capture_type: 'quick_lead',
  status: 'approved',
  capture_method: 'voice_transcript',
  raw_text_payload: {
    name: 'Jordan Homeowner',
    email: 'jordan@example.com',
    text: 'Kitchen estimate',
    transcript: 'Call about cabinets',
  },
  structured_draft: {},
  approved_snapshot: {},
  review_decisions: {},
  duplicate_candidates: [{ candidate_id: 9, display_name: 'Jordan H', match_strength: 'strong' }],
  artifacts: [],
  events: [],
  captured_by_id: 7,
  captured_by_name: 'Pat Builder',
  version: 4,
  retry_count: 1,
  source_category: 'capture',
  processing_engine: 'deterministic.v1',
  original_captured_at: '2026-07-26T12:00:00Z',
  created_at: '2026-07-26T12:00:00Z',
  updated_at: '2026-07-26T12:05:00Z',
};

async function installMocks(page) {
  const listRequests = [];
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'capture-readiness-token');
    Object.assign(navigator.clipboard, { writeText: async () => {} });
  });
  await page.route('**/api/projects/whoami/', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: 7, type: 'contractor', role: 'contractor_owner', email: 'pat@example.com' }),
  }));
  await page.route('**/api/projects/notifications/unread-count/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0}' })
  );
  await page.route('**/api/projects/captures/summary/', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ pending: 2, needs_review: 1, approved: 1, applied_today: 3, failed: 1, archived: 4 }),
  }));
  await page.route(`**/api/projects/captures/${captureId}/timeline/`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ results: [
      { id: 'event-1', event_type: 'created', actor_name: 'Pat Builder', to_status: 'saved', created_at: '2026-07-26T12:00:00Z' },
      { id: 'event-2', event_type: 'draft_approved', actor_name: 'Pat Builder', to_status: 'approved', created_at: '2026-07-26T12:05:00Z' },
    ] }),
  }));
  await page.route(`**/api/projects/captures/${captureId}/artifacts/`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ results: [{
      id: 'artifact-1',
      artifact_type: 'photo',
      original_filename: 'permit.png',
      mime_type: 'image/png',
      file_size: 20,
      download_url: 'data:image/png;base64,iVBORw0KGgo=',
      sanitization_metadata: { ocr_text: 'Permit 123' },
    }] }),
  }));
  await page.route(`**/api/projects/captures/${captureId}/`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(capture),
  }));
  await page.route(/\/api\/projects\/captures\/?(?:\?.*)?$/, (route) => {
    listRequests.push(new URL(route.request().url()).searchParams);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        count: 1,
        next: 'http://test/api/projects/captures/?cursor=next-token',
        previous: null,
        results: [capture],
      }),
    });
  });
  return listRequests;
}

test('Inbox persists server search, filters, sorting, summary deep links, and cursor navigation', async ({ page }) => {
  const requests = await installMocks(page);
  await page.goto('/app/capture?status=approved&sort=attention');
  await expect(page.getByLabel('Filter by status')).toHaveValue('approved');
  await expect(page.getByLabel('Sort Captures')).toHaveValue('attention');
  await page.getByPlaceholder('Search Captures').fill('Jordan');
  await page.getByLabel('Has duplicates').check();
  await page.getByLabel('Filter by type').selectOption('quick_lead');
  await expect(page).toHaveURL(/search=Jordan/);
  await expect(page).toHaveURL(/has_duplicates=true/);
  await expect.poll(() => requests.at(-1)?.get('search')).toBe('Jordan');
  await expect.poll(() => requests.at(-1)?.get('sort')).toBe('attention');
  await page.getByRole('button', { name: 'Show Failed Captures' }).click();
  await expect(page).toHaveURL(/status=failed/);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/cursor=next-token/);
});

test('detail lazily loads accessible timeline and artifact actions at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await installMocks(page);
  await page.goto(`/app/capture/${captureId}`);
  await page.getByText('Artifacts', { exact: true }).click();
  await expect(page.getByRole('img', { name: 'permit.png' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy OCR' })).toBeVisible();
  await page.getByText('History and Timeline', { exact: true }).click();
  await expect(page.getByLabel('Capture timeline')).toContainText('Created');
  await expect(page.getByLabel('Capture timeline')).toContainText('Approved');
  await expect(page.getByLabel('Capture timeline')).toContainText('Pat Builder');
  await page.getByText('Metadata', { exact: true }).click();
  await expect(page.getByTestId('capture-detail').getByText(captureId, { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
