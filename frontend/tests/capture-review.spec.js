import { expect, test } from '@playwright/test';

const captureId = '33333333-3333-4333-8333-333333333333';

const leadDraft = {
  schema_version: 'quick_lead.v1',
  person: { name: 'John', phone: '281-555-0100', email: 'john@example.com' },
  opportunity: {
    title: 'John project',
    summary: 'Needs a deck',
    project_type: '',
    location_text: '',
  },
  follow_up: { suggested: false, subject: '', due_at: null, source_phrase: '' },
  proposed_destinations: ['customer', 'opportunity'],
  missing_fields: [],
  uncertainties: ['Project type needs confirmation'],
  warnings: ['Confirm the requested timeline'],
};

function makeCapture(patches = {}) {
  return {
    id: captureId,
    capture_type: 'quick_lead',
    status: 'saved',
    capture_method: 'typed',
    raw_text_payload: {
      name: 'John',
      phone: '281-555-0100',
      email: 'john@example.com',
      text: 'Needs a deck',
      notes: 'Met at the supply house',
    },
    structured_draft: {},
    review_decisions: {},
    duplicate_candidates: [],
    approved_snapshot: {},
    artifacts: [],
    events: [{ id: 'event-1', event_type: 'created', to_status: 'saved', created_at: '2026-07-25T12:00:00Z' }],
    captured_by_name: 'Pat Contractor',
    version: 1,
    original_captured_at: '2026-07-25T12:00:00Z',
    created_at: '2026-07-25T12:00:00Z',
    ...patches,
  };
}

async function installMocks(page, initial = makeCapture()) {
  let capture = structuredClone(initial);
  let staleOnce = false;
  await page.addInitScript(() => window.localStorage.setItem('access', 'capture-review-token'));
  await page.route('**/api/projects/whoami/', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: 7, type: 'contractor', role: 'contractor_owner', email: 'review@example.com' }),
  }));
  await page.route('**/api/projects/notifications/unread-count/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0}' })
  );
  await page.route('**/api/projects/captures/summary/', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{"pending":1,"needs_review":0,"applied":0,"failed":0,"archived":0,"today":1}',
  }));
  await page.route(`**/api/projects/captures/${captureId}/process/`, (route) => {
    capture = makeCapture({
      status: 'possible_duplicate',
      version: 3,
      structured_draft: structuredClone(leadDraft),
      duplicate_candidates: [{
        candidate_id: 91,
        display_name: 'John Rivera',
        masked_email: 'j***@example.com',
        masked_phone: '***-***-0100',
        reason: 'Exact email match',
        match_strength: 'exact',
      }],
      events: [...capture.events, { id: 'event-2', event_type: 'draft_prepared', to_status: 'possible_duplicate', created_at: '2026-07-25T12:01:00Z' }],
    });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ capture, review: {} }) });
  });
  await page.route(`**/api/projects/captures/${captureId}/retry/`, async (route) => {
    const body = route.request().postDataJSON();
    const isNote = capture.capture_type === 'quick_note';
    capture = {
      ...capture,
      status: 'ready_for_review',
      version: capture.version + 2,
      processing_engine: body.mode === 'manual' ? 'manual' : 'deterministic.v1',
      structured_draft: isNote ? {
        schema_version: 'quick_note.v1',
        title: 'Supplier',
        body: 'Call tomorrow',
        suggested_destination: 'unassigned_note',
        destination_candidates: [],
        follow_up: { suggested: false, subject: '', due_at: null, source_phrase: '' },
        missing_fields: [],
        uncertainties: [],
        warnings: [],
      } : structuredClone(leadDraft),
    };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ capture, review: {} }) });
  });
  await page.route(`**/api/projects/captures/${captureId}/review/`, async (route) => {
    const body = route.request().postDataJSON();
    if (staleOnce) {
      staleOnce = false;
      capture.version += 1;
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Capture version changed.', code: 'capture_version_conflict', capture, review: {} }),
      });
    }
    capture = {
      ...capture,
      version: capture.version + 1,
      status: 'ready_for_review',
      structured_draft: body.structured_draft,
      review_decisions: body.duplicate_decision ? { duplicate: body.duplicate_decision } : capture.review_decisions,
    };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ capture, review: {} }) });
  });
  await page.route(`**/api/projects/captures/${captureId}/approve/`, (route) => {
    capture = {
      ...capture,
      status: 'approved',
      version: capture.version + 1,
      approved_snapshot: { schema_version: capture.structured_draft.schema_version, structured_draft: structuredClone(capture.structured_draft) },
    };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ capture, review: {} }) });
  });
  await page.route(`**/api/projects/captures/${captureId}/`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(capture) })
  );
  await page.route(/\/api\/projects\/captures\/?(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count: 1, next: null, previous: null, results: [capture] }),
    })
  );
  return {
    makeStale: () => { staleOnce = true; },
    current: () => capture,
  };
}

test('Inbox processes Quick Lead, preserves original, resolves duplicate, edits, and approves draft', async ({ page }) => {
  const state = await installMocks(page);
  await page.goto('/app/capture');
  await page.getByRole('button', { name: 'Process', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${captureId}$`));
  await expect(page.getByText('Met at the supply house')).toBeVisible();
  await expect(page.getByTestId('capture-interpretation')).toContainText('Project type needs confirmation');
  await expect(page.getByTestId('capture-interpretation')).toContainText('Confirm the requested timeline');
  await page.getByLabel('Summary').fill('Corrected deck scope');
  await page.getByText('Link to this existing customer later').click();
  await page.getByRole('button', { name: 'Save edits' }).click();
  await expect(page.getByRole('button', { name: 'Approve draft' })).toBeEnabled();
  await page.getByRole('button', { name: 'Approve draft' }).click();
  await expect(page.getByText(/Draft approved\. No customer/)).toBeVisible();
  expect(state.current().status).toBe('approved');
  expect(state.current().structured_draft.opportunity.summary).toBe('Corrected deck scope');
  await expect(page.getByText(/Customer created|Opportunity created/i)).toHaveCount(0);
});

test('Quick Note supports manual fallback and stale-version recovery', async ({ page }) => {
  const failedNote = makeCapture({
    capture_type: 'quick_note',
    status: 'failed',
    version: 3,
    raw_text_payload: { title: 'Supplier', text: 'Call tomorrow' },
    failure_details: { capture_saved: true },
  });
  const state = await installMocks(page, failedNote);
  await page.goto(`/app/capture/${captureId}`);
  await expect(page.getByText(/Capture saved\. Processing failed/)).toBeVisible();
  await page.getByRole('button', { name: 'Review manually' }).click();
  await expect(page.getByTestId('capture-review-form')).toBeVisible();
  await expect(page.getByLabel('Note')).toHaveValue('Call tomorrow');
  await page.getByLabel('Proposed destination').selectOption('project_note');
  state.makeStale();
  await page.getByRole('button', { name: 'Save edits' }).click();
  await expect(page.getByText(/current review has been reloaded/i)).toBeVisible();
  await expect(page.getByLabel('Note')).toHaveValue('Call tomorrow');
});

test('Capture review remains keyboard-safe at 320px with sticky actions and no overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await installMocks(page, makeCapture({
    status: 'ready_for_review',
    version: 3,
    structured_draft: structuredClone(leadDraft),
  }));
  await page.goto(`/app/capture/${captureId}`);
  await expect(page.getByTestId('capture-sticky-actions')).toBeVisible();
  await page.getByLabel('Name').focus();
  await page.keyboard.press('Tab');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await expect(page.getByRole('button', { name: 'Approve draft' })).toBeVisible();
});
