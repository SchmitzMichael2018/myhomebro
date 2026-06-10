import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 321;
const MILESTONE_ID = 901;
const AMENDMENT_ID = 44;

async function mockContractorShell(page, agreement) {
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

  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ onboarding_status: 'complete', connected: true }),
    });
  });

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(agreement),
    });
  });

  await page.route('**/api/projects/agreements/321/funding_preview/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project_amount: '20000.00',
        platform_fee: '601.00',
        contractor_payout: '19399.00',
        homeowner_escrow: '20601.00',
        rate: 0.03,
        is_intro: false,
        tier_name: 'starter',
        high_risk_applied: false,
      }),
    });
  });

  await page.route('**/api/projects/warranties/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.route('**/api/projects/agreements/321/subcontractor-invitations/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ agreement_id: AGREEMENT_ID, pending_invitations: [], accepted_subcontractors: [] }),
    });
  });

  await page.route('**/api/projects/subaccounts/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.route('**/api/projects/agreements/321/attachments/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
}

test('contractor reviews and responds to a de-scope amendment request', async ({ page }) => {
  const agreement = {
    id: AGREEMENT_ID,
    title: 'Flooring Agreement',
    project_title: 'Flooring Agreement',
    homeowner_name: 'Jordan Demo',
    homeowner_email: 'jordan@example.com',
    total_cost: '20000.00',
    payment_mode: 'escrow',
    status: 'signed',
    signed_by_contractor: true,
    signed_by_homeowner: true,
    escrow_funded: true,
    escrow_funded_amount: '20000.00',
    invoices: [],
    milestones: [
      {
        id: MILESTONE_ID,
        title: 'Trim & Cleanup',
        amount: '5000.00',
        status: 'pending',
        amendment_review_status: 'pending',
        amendment_review_request_id: AMENDMENT_ID,
        assigned_worker_display: '',
        reviewer_display: 'Contractor Owner',
      },
    ],
    amendment_requests: [
      {
        id: AMENDMENT_ID,
        created_at: '2026-06-01T12:00:00Z',
        requested_by_name: 'Jordan Demo',
        initiated_by_role: 'homeowner',
        change_type: 'descope_remove_work',
        change_type_label: 'De-scope / Remove Work',
        requested_change: 'Remove the final trim phase.',
        requested_changes: { requested_change: 'Remove the final trim phase.' },
        justification: 'We decided to keep the existing trim.',
        status: 'open',
        status_label: 'Open',
        response_state: 'pending',
        response_label: 'Pending Response',
        original_project_value: '20000.00',
        revised_project_value: '15000.00',
        escrow_funded_amount: '20000.00',
        estimated_refundable_escrow_surplus: '5000.00',
        refund_eligibility_label: 'Eligible After Signed Amendment',
        affected_milestone_ids: [MILESTONE_ID],
        affected_milestones: [
          {
            id: MILESTONE_ID,
            title: 'Trim & Cleanup',
            amount: '5000.00',
            status: 'pending',
            amendment_review_status: 'pending',
          },
        ],
        activity_events: [
          {
            id: 1,
            event_type: 'amendment_created',
            event_label: 'Amendment Created',
            title: 'Amendment submitted',
            created_at: '2026-06-01T12:00:00Z',
          },
        ],
      },
    ],
    pdf_versions: [],
  };

  let viewedCalled = false;
  let responsePayload = null;

  await mockContractorShell(page, agreement);

  await page.route(`**/api/projects/amendment-requests/${AMENDMENT_ID}/viewed/`, async (route) => {
    viewedCalled = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.route(`**/api/projects/amendment-requests/${AMENDMENT_ID}/respond/`, async (route) => {
    responsePayload = route.request().postDataJSON();
    agreement.amendment_requests[0].response_state = responsePayload.response_state;
    agreement.amendment_requests[0].response_label = 'Accepted';
    agreement.amendment_requests[0].response_note = responsePayload.response_note;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        amendment_request: {
          id: AMENDMENT_ID,
          status: 'routed_to_amendment',
          status_label: 'Routed to Amendment',
          response_state: responsePayload.response_state,
          response_label: 'Accepted',
        },
      }),
    });
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}`);

  await expect(page.getByTestId('contractor-amendment-next-action')).toContainText('Amendment response needed');
  await expect(page.getByTestId('contractor-amendment-review-panel')).toContainText('De-scope / Remove Work');
  await expect(page.getByTestId(`contractor-amendment-descope-summary-${AMENDMENT_ID}`)).toContainText('$20,000.00');
  await expect(page.getByTestId(`contractor-amendment-descope-summary-${AMENDMENT_ID}`)).toContainText('$15,000.00');
  await expect(page.getByTestId(`contractor-amendment-descope-summary-${AMENDMENT_ID}`)).toContainText('$5,000.00');
  await expect(page.getByTestId(`milestone-amendment-review-pending-${MILESTONE_ID}`)).toBeVisible();
  await expect(page.getByTestId(`milestone-amendment-block-message-${MILESTONE_ID}`)).toContainText('Completion submission and invoice/payment release are blocked');
  expect(viewedCalled).toBe(true);

  await page.getByTestId(`contractor-amendment-response-note-${AMENDMENT_ID}`).fill('Accepted pending signed addendum.');
  await page.getByTestId(`contractor-amendment-submit-response-${AMENDMENT_ID}`).click();

  expect(responsePayload).toMatchObject({
    response_state: 'accepted',
    response_note: 'Accepted pending signed addendum.',
  });
  await expect(page.getByTestId(`contractor-amendment-card-${AMENDMENT_ID}`)).toContainText('Accepted');
});
