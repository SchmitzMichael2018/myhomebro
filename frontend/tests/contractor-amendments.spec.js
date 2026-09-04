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

test('contractor can request a change from the agreement workspace', async ({ page }) => {
  const agreement = {
    id: AGREEMENT_ID,
    title: 'Bathroom Agreement',
    homeowner_name: 'Jordan Demo',
    homeowner_email: 'jordan@example.com',
    total_cost: '20000.00',
    payment_mode: 'escrow',
    status: 'signed',
    signed_by_contractor: true,
    signed_by_homeowner: true,
    signature_is_satisfied: true,
    escrow_funded: true,
    invoices: [],
    milestones: [{ id: MILESTONE_ID, title: 'Rough plumbing', amount: '5000.00', status: 'pending', completion_date: '2026-09-08' }],
    amendment_requests: [],
    pdf_versions: [],
  };
  let requestPayload = null;
  await mockContractorShell(page, agreement);
  await page.route(`**/api/projects/agreements/${AGREEMENT_ID}/amendment-requests/improve/`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        suggested_change_type: 'scope_product_change',
        suggested_change_type_label: 'Product/Scope Change',
        improved_description: 'Water Damage Remediation: Repair the leak, dry the area, treat mold, and repair damaged wood.',
        improved_reason: 'Hidden water damage was found after demolition.',
        milestone_draft: {
          title: 'Water Damage Remediation',
          scope: 'Repair the leak, dry the area, treat mold, and repair damaged wood.',
          completion_criteria: 'Complete when the leak is repaired, materials are dry, treatment is complete, and photos are provided.',
          recommended_placement: 'Before Rough plumbing',
          schedule_confirmation: 'Contractor must confirm revised dates.',
          price_confirmation: 'Contractor must confirm the amendment amount.',
        },
        clarification_questions: ['What exact area is affected?'],
        evidence_note: 'Add photos of the condition or a specialist estimate.',
      }),
    });
  });
  await page.route(`**/api/projects/agreements/${AGREEMENT_ID}/amendment-requests/`, async (route) => {
    requestPayload = route.request().postData() || '';
    agreement.amendment_requests.push({
      id: 55,
      created_at: '2026-09-04T12:00:00Z',
      initiated_by_role: 'contractor',
      change_type: 'scope_product_change',
      change_type_label: 'Product/Scope Change',
      requested_change: 'Water Damage Remediation: Repair the leak, dry the area, treat mold, and repair damaged wood.',
      justification: 'Hidden water damage was found after demolition.',
      requested_changes: {
        requested_change: 'Water Damage Remediation: Repair the leak, dry the area, treat mold, and repair damaged wood.',
        proposed_value_change: '1250.00',
        notification_delivery: {
          email: { status: 'sent', sent: true },
          sms: { status: 'sent', sent: true },
        },
        milestone_draft: {
          title: 'Water Damage Remediation',
          scope: 'Repair the leak, dry the area, treat mold, and repair damaged wood.',
          completion_criteria: 'Complete when the leak is repaired, materials are dry, treatment is complete, and photos are provided.',
          recommended_placement: 'Before Rough plumbing',
          schedule_confirmation: 'Contractor must confirm revised dates.',
          price_confirmation: 'Contractor must confirm the amendment amount.',
        },
      },
      status: 'open',
      status_label: 'Open',
      response_state: 'pending',
      response_label: 'Pending Response',
      activity_events: [{ id: 1, title: 'Contractor submitted amendment request', created_at: '2026-09-04T12:00:00Z' }],
    });
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        notifications: { email: { status: 'sent', sent: true }, sms: { status: 'sent', sent: true } },
        amendment_request: { id: 55, status: 'open' },
      }),
    });
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}`);
  await page.getByTestId('contractor-request-amendment').click();
  await expect(page.getByTestId('contractor-amendment-request-modal')).toContainText('Request a Change');
  await expect(page.getByTestId('contractor-amendment-placement')).toContainText('New Milestone 1 — before 1. Rough plumbing');
  await expect(page.getByTestId('contractor-amendment-milestone-date')).toHaveValue('2026-09-08');
  await page.getByTestId('contractor-amendment-request-change').fill('Add water-damage remediation before rough plumbing.');
  await page.getByTestId('contractor-amendment-request-reason').fill('Hidden water damage was found after demolition.');
  await page.getByTestId('contractor-amendment-request-amount').fill('1250.00');
  await page.getByTestId('contractor-amendment-ai-improve').click();
  await expect(page.getByTestId('contractor-amendment-ai-suggestion')).toContainText('What exact area is affected?');
  await expect(page.getByTestId('contractor-amendment-ai-suggestion')).toContainText('Water Damage Remediation');
  await expect(page.getByTestId('contractor-amendment-ai-suggestion')).toContainText('Completed when');
  await expect(page.getByTestId('contractor-amendment-ai-suggestion')).toContainText('Before Rough plumbing');
  await page.getByTestId('contractor-amendment-ai-apply').click();
  await expect(page.getByTestId('contractor-amendment-request-change')).toHaveValue(/Water Damage Remediation/);
  await page.getByTestId('contractor-amendment-request-attachments').setInputFiles({
    name: 'water-damage.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('supporting-photo'),
  });
  await page.getByRole('button', { name: 'Submit Change Request' }).click();

  await expect(page.getByTestId('agreement-workspace-panel-amendments')).toContainText('Change request submitted');
  await expect(page.getByTestId('agreement-workspace-panel-amendments')).toContainText('Requested by contractor');
  await expect(page.getByTestId('agreement-workspace-panel-amendments')).toContainText('Hidden water damage was found after demolition.');
  await expect(page.getByTestId('agreement-workspace-panel-amendments')).toContainText('$1,250.00');
  await expect(page.getByTestId('agreement-workspace-panel-amendments')).toContainText('Email: Sent');
  await expect(page.getByTestId('agreement-workspace-panel-amendments')).toContainText('Text: Sent');
  await expect(page.getByTestId('contractor-submitted-amendment-draft-55')).toContainText('Completed when');
  await expect(page.getByTestId('contractor-submitted-amendment-draft-55')).toContainText('Before Rough plumbing');
  await page.getByTestId('agreement-workspace-tab-overview').click();
  await expect(page.getByTestId('agreement-overview-change-request')).toContainText('Change Request Pending');
  await expect(page.getByTestId('agreement-overview-change-request')).toContainText('Water Damage Remediation');
  await expect(page.getByTestId('contractor-request-amendment')).toContainText('View Change Request');
  await page.getByTestId('agreement-overview-view-change-request').click();
  await expect(page.getByTestId('contractor-submitted-amendment-draft-55')).toBeVisible();
  expect(requestPayload).toContain('scope_product_change');
  expect(requestPayload).toContain('Water Damage Remediation');
  expect(requestPayload).toContain('Hidden water damage was found after demolition.');
  expect(requestPayload).toContain('water-damage.jpg');
  expect(requestPayload).toContain('1250.00');
  expect(requestPayload).toContain('completion_criteria');
  expect(requestPayload).toContain('placement_before_milestone_id');
  expect(requestPayload).toContain('proposed_order');
});

test('accepted contractor change can be inserted into an amendment draft', async ({ page }) => {
  const agreement = {
    id: AGREEMENT_ID,
    title: 'Bathroom Agreement',
    homeowner_name: 'Jordan Demo',
    homeowner_email: 'jordan@example.com',
    total_cost: '5000.00',
    payment_mode: 'escrow',
    status: 'signed',
    signed_by_contractor: true,
    signed_by_homeowner: true,
    signature_is_satisfied: true,
    escrow_funded: true,
    invoices: [],
    milestones: [{ id: MILESTONE_ID, title: 'Rough plumbing', amount: '5000.00', status: 'pending' }],
    amendment_requests: [{
      id: AMENDMENT_ID,
      created_at: '2026-09-04T12:00:00Z',
      initiated_by_role: 'contractor',
      change_type: 'scope_product_change',
      change_type_label: 'Product/Scope Change',
      requested_change: 'Add water-damage remediation before rough plumbing.',
      justification: 'Hidden water damage was found.',
      requested_changes: {
        requested_change: 'Add water-damage remediation before rough plumbing.',
        proposed_value_change: '700.00',
        milestone_draft: {
          title: 'Water Damage Remediation',
          scope: 'Dry the affected area and treat mold.',
          completion_criteria: 'Moisture readings and photos are documented.',
        },
      },
      status: 'routed_to_amendment',
      status_label: 'Routed to Amendment',
      response_state: 'accepted',
      response_label: 'Accepted',
      activity_events: [],
    }],
    pdf_versions: [],
  };
  let applyCalled = false;
  await mockContractorShell(page, agreement);
  await page.route(`**/api/projects/amendment-requests/${AMENDMENT_ID}/apply/`, async (route) => {
    applyCalled = true;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        milestone_id: 902,
        amendment_number: 1,
        additional_escrow_required: '700.00',
        next_url: `/app/agreements/${AGREEMENT_ID}/wizard?step=2`,
      }),
    });
  });
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto(`/app/agreements/${AGREEMENT_ID}`);
  const overviewChange = page.getByTestId('agreement-overview-change-request');
  await expect(overviewChange).toContainText('Accepted Change Requires Amendment');
  await expect(overviewChange).toContainText('Water Damage Remediation');
  await expect(overviewChange).toContainText('$700.00');
  await page.getByTestId('agreement-workspace-tab-more').click();
  const actions = page.getByTestId(`contractor-amendment-accepted-actions-${AMENDMENT_ID}`);
  await expect(actions).toContainText('Customer accepted this change request');
  await expect(actions).toContainText('signed before additional escrow');
  await page.getByTestId('agreement-workspace-tab-overview').click();
  await page.getByTestId('agreement-overview-apply-change-request').click();

  await expect.poll(() => applyCalled).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/app/agreements/${AGREEMENT_ID}/wizard\\?step=2`));
});

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

test('contractor attaches supporting files to a counter amendment response', async ({ page }) => {
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
        activity_events: [],
        counter_attachments: [],
      },
    ],
    pdf_versions: [],
  };

  let multipartBody = '';

  await mockContractorShell(page, agreement);

  await page.route(`**/api/projects/amendment-requests/${AMENDMENT_ID}/viewed/`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.route(`**/api/projects/amendment-requests/${AMENDMENT_ID}/respond/`, async (route) => {
    multipartBody = route.request().postData() || '';
    agreement.amendment_requests[0].response_state = 'countered';
    agreement.amendment_requests[0].response_label = 'Countered';
    agreement.amendment_requests[0].response_note = 'Counter with a supplier quote.';
    agreement.amendment_requests[0].counter_proposal = {
      revised_scope: 'Keep trim with alternate material.',
      revised_value_change: '-1200.00',
    };
    agreement.amendment_requests[0].counter_attachments = [
      {
        id: 77,
        filename: 'supplier-quote.pdf',
        content_type: 'application/pdf',
        size: 14,
        uploaded_at: '2026-06-01T12:30:00Z',
        url: '/media/amendments/supplier-quote.pdf',
      },
    ];
    agreement.amendment_requests[0].activity_events = [
      {
        id: 2,
        event_type: 'amendment_responded',
        event_label: 'Amendment Responded',
        title: 'Amendment countered',
        created_at: '2026-06-01T12:30:00Z',
        metadata: {
          attachment_count: 1,
          attachments: agreement.amendment_requests[0].counter_attachments,
        },
      },
    ];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        amendment_request: {
          id: AMENDMENT_ID,
          status: 'open',
          status_label: 'Open',
          response_state: 'countered',
          response_label: 'Countered',
        },
      }),
    });
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}`);

  await page.getByTestId(`contractor-amendment-response-state-${AMENDMENT_ID}`).selectOption('countered');
  await page.getByTestId(`contractor-amendment-counter-scope-${AMENDMENT_ID}`).fill('Keep trim with alternate material.');
  await page.getByTestId(`contractor-amendment-counter-value-${AMENDMENT_ID}`).fill('-1200.00');
  await page.getByTestId(`contractor-amendment-response-note-${AMENDMENT_ID}`).fill('Counter with a supplier quote.');
  await page.getByTestId(`contractor-amendment-counter-attachments-${AMENDMENT_ID}`).setInputFiles({
    name: 'supplier-quote.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 quote'),
  });

  await expect(page.getByTestId(`contractor-amendment-counter-selected-files-${AMENDMENT_ID}`)).toContainText('supplier-quote.pdf');

  await page.getByTestId(`contractor-amendment-submit-response-${AMENDMENT_ID}`).click();

  expect(multipartBody).toContain('countered');
  expect(multipartBody).toContain('supplier-quote.pdf');
  await expect(page.getByTestId(`contractor-amendment-card-${AMENDMENT_ID}`)).toContainText('Countered');
  await expect(page.getByTestId(`contractor-amendment-counter-attachments-summary-${AMENDMENT_ID}`)).toContainText('supplier-quote.pdf');
  await expect(page.getByTestId(`contractor-amendment-activity-${AMENDMENT_ID}`)).toContainText('1 attachment included');
});
