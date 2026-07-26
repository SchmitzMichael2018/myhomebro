import { expect, test } from '@playwright/test';

const captureId = '44444444-4444-4444-8444-444444444444';

const leadDraft = {
  schema_version: 'quick_lead.v1',
  person: { name: 'John Smith', phone: '281-555-0100', email: 'john@example.com' },
  opportunity: {
    title: 'Deck project',
    summary: 'Build a replacement deck',
    project_type: 'Deck',
    location_text: '123 Main St',
  },
  follow_up: {
    suggested: true,
    subject: 'Call John',
    due_at: '2026-07-29T15:00:00Z',
    source_phrase: 'Call in two days',
  },
  proposed_destinations: ['customer', 'opportunity'],
  missing_fields: [],
  uncertainties: [],
  warnings: [],
};

function approvedCapture(patches = {}) {
  const snapshot = {
    schema_version: 'quick_lead.v1',
    capture_version: 4,
    structured_draft: structuredClone(leadDraft),
    review_decisions: {
      duplicate: { decision: 'link_existing', candidate_id: 91 },
    },
  };
  return {
    id: captureId,
    capture_type: 'quick_lead',
    status: 'approved',
    version: 5,
    capture_method: 'typed',
    raw_text_payload: { name: 'John Smith', text: 'Needs a deck' },
    structured_draft: structuredClone(leadDraft),
    review_decisions: snapshot.review_decisions,
    approved_snapshot: snapshot,
    duplicate_candidates: [{
      candidate_id: 91,
      display_name: 'Existing John',
      masked_email: 'j***@example.com',
      reason: 'Exact email match',
      match_strength: 'exact',
    }],
    artifacts: [],
    events: [{ id: 'event-1', event_type: 'draft_approved', to_status: 'approved', created_at: '2026-07-26T12:00:00Z' }],
    captured_by_name: 'Pat Contractor',
    created_at: '2026-07-26T12:00:00Z',
    original_captured_at: '2026-07-26T12:00:00Z',
    ...patches,
  };
}

function receipt() {
  return {
    application_id: 'application-1',
    capture_id: captureId,
    approved_capture_version: 4,
    approved_schema_version: 'quick_lead.v1',
    adapter_versions: { customer: '1', opportunity: '1' },
    selected_destinations: ['customer', 'opportunity'],
    applied_at: '2026-07-26T13:00:00Z',
    applied_by: { id: 7, email: 'capture@example.com' },
    created_records: [{
      type: 'opportunity',
      id: 42,
      label: 'Deck project',
      url: '/app/opportunities/42',
    }],
    linked_records: [{
      type: 'customer',
      id: 91,
      label: 'Existing John',
      url: '/app/customers/91',
    }],
    warnings: [],
    final_status: 'applied',
  };
}

async function installMocks(page, initial = approvedCapture(), { failFirst = false } = {}) {
  let capture = structuredClone(initial);
  let applyCalls = 0;
  const requests = [];
  await page.addInitScript(() => window.localStorage.setItem('access', 'capture-application-token'));
  await page.route('**/api/projects/whoami/', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: 7, type: 'contractor', role: 'contractor_owner', email: 'capture@example.com' }),
  }));
  await page.route('**/api/projects/notifications/unread-count/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0}' })
  );
  await page.route('**/api/projects/homeowners/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ results: [{ id: 91, full_name: 'Existing John', email: 'john@example.com' }] }),
  }));
  await page.route(`**/api/projects/captures/${captureId}/application-preview/`, async (route) => {
    const body = route.request().postDataJSON();
    requests.push({ type: 'preview', body });
    const isNote = capture.capture_type === 'quick_note';
    const customerNote = body.destinations.includes('customer_note');
    const records = isNote
      ? [{
          action: customerNote ? 'create' : 'retain',
          record_type: customerNote ? 'customer_note' : 'unassigned_note',
          label: customerNote ? 'Supplier note' : 'Unassigned Capture note',
          fields: { body: 'Call supplier tomorrow' },
        }]
      : [
          { action: 'link', record_type: 'customer', label: 'Existing John', fields: {} },
          { action: 'create', record_type: 'opportunity', label: 'Deck project', fields: { summary: 'Build a replacement deck' } },
          ...(body.destinations.includes('follow_up') ? [{ action: 'create', record_type: 'follow_up', label: 'Call John', fields: { due_at: '2026-07-29T15:00:00Z' } }] : []),
        ];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ capture_id: captureId, capture_version: capture.version, records, warnings: [], valid: true, adapter_versions: body.adapter_versions }),
    });
  });
  await page.route(`**/api/projects/captures/${captureId}/apply/`, async (route) => {
    applyCalls += 1;
    const body = route.request().postDataJSON();
    requests.push({ type: 'apply', body });
    if (failFirst && applyCalls === 1) {
      capture = { ...capture, status: 'apply_failed', version: capture.version + 2 };
      return route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'The application failed safely. No partial records were kept.', code: 'adapter_failure', capture }),
      });
    }
    capture = { ...capture, status: 'applied', version: capture.version + 2 };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ capture, application: { id: 'application-1', status: 'applied', created_records: receipt().created_records, linked_records: receipt().linked_records }, receipt: receipt() }),
    });
  });
  await page.route(`**/api/projects/captures/${captureId}/receipt/`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ capture_id: captureId, receipts: [{ receipt_payload: receipt() }] }),
  }));
  await page.route(`**/api/projects/captures/${captureId}/`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(capture) })
  );
  return { requests, applyCalls: () => applyCalls };
}

test('approved Quick Lead previews exact link/create records, confirms, applies once, and shows receipt links', async ({ page }) => {
  const state = await installMocks(page);
  await page.goto(`/app/capture/${captureId}`);
  await expect(page.getByRole('button', { name: 'Preview application' })).toBeVisible();
  await page.getByLabel('Include approved follow-up').check();
  await page.getByRole('button', { name: 'Preview application' }).click();
  const preview = page.getByTestId('capture-application-preview');
  await expect(preview).toContainText('Link customer');
  await expect(preview).toContainText('Create opportunity');
  await expect(preview).toContainText('Create follow up');
  await expect(preview).toContainText('Build a replacement deck');
  const apply = page.getByRole('button', { name: 'Apply approved draft' });
  await expect(apply).toBeDisabled();
  await page.getByText('I understand these records will be created or linked.').click();
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByTestId('capture-application-receipt')).toContainText('Deck project');
  await expect(page.getByRole('link', { name: /Existing John/ })).toHaveAttribute('href', '/app/customers/91');
  expect(state.applyCalls()).toBe(1);
  expect(state.requests.find((row) => row.type === 'apply').body.confirmed).toBe(true);
  await expect(page.getByText(/Estimate created|Agreement created|Project created/i)).toHaveCount(0);
});

test('Quick Note offers only unassigned or Customer note and requires Customer selection', async ({ page }) => {
  const noteDraft = {
    schema_version: 'quick_note.v1',
    title: 'Supplier note',
    body: 'Call supplier tomorrow',
    suggested_destination: 'unassigned_note',
    destination_candidates: [],
    follow_up: { suggested: false, subject: '', due_at: null, source_phrase: '' },
    missing_fields: [],
    uncertainties: [],
    warnings: [],
  };
  await installMocks(page, approvedCapture({
    capture_type: 'quick_note',
    structured_draft: noteDraft,
    approved_snapshot: {
      schema_version: 'quick_note.v1',
      capture_version: 4,
      structured_draft: noteDraft,
      review_decisions: {},
    },
    duplicate_candidates: [],
  }));
  await page.goto(`/app/capture/${captureId}`);
  await expect(page.getByText('Keep as an unassigned Capture note')).toBeVisible();
  await expect(page.getByText('Add as a Customer note')).toBeVisible();
  await expect(page.getByText(/Project note|Opportunity note/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview application' }).click();
  await expect(page.getByTestId('capture-application-preview')).toContainText('Keep unassigned note');
  await page.getByText('Add as a Customer note').click();
  await expect(page.getByRole('button', { name: 'Preview application' })).toBeDisabled();
  await page.getByLabel('Customer* (required)', { exact: true }).selectOption('91');
  await page.getByRole('button', { name: 'Preview application' }).click();
  await expect(page.getByTestId('capture-application-preview')).toContainText('Create customer note');
});

test('safe application failure stays on page and supports explicit retry', async ({ page }) => {
  const state = await installMocks(page, approvedCapture(), { failFirst: true });
  await page.goto(`/app/capture/${captureId}`);
  await page.getByRole('button', { name: 'Preview application' }).click();
  await page.getByText('I understand these records will be created or linked.').click();
  await page.getByRole('button', { name: 'Apply approved draft' }).click();
  await expect(page.getByText(/Application failed safely/)).toBeVisible();
  await page.getByRole('button', { name: 'Preview retry' }).click();
  await page.getByText('I understand these records will be created or linked.').click();
  await page.getByRole('button', { name: 'Retry application' }).click();
  await expect(page.getByTestId('capture-application-receipt')).toBeVisible();
  expect(state.applyCalls()).toBe(2);
});

test('application workflow is keyboard-safe at 320px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await installMocks(page);
  await page.goto(`/app/capture/${captureId}`);
  await page.getByRole('button', { name: 'Preview application' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('capture-application-preview')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await expect(page.getByTestId('capture-sticky-actions')).toBeVisible();
});
