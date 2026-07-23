import { expect, test } from '@playwright/test';

const DISPUTE_ID = 9901;

test('dispute AI surface renders without legacy AI gating text or routes', async ({
  page,
}) => {
  const requestedUrls = [];

  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  page.on('request', (request) => {
    requestedUrls.push(request.url());
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

  await page.route(/\/api\/projects\/disputes\/\?mine=true(?:&.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: DISPUTE_ID,
            agreement: 321,
            agreement_number: '321',
            initiator: 'contractor',
            reason: 'Scope disagreement',
            description: 'Need an advisory summary.',
            status: 'open',
            fee_amount: 250,
            fee_paid: true,
            escrow_frozen: true,
            homeowner_response: '',
            contractor_response: '',
            attachments: [],
            created_at: '2026-03-23T10:00:00Z',
            updated_at: '2026-03-23T10:00:00Z',
          },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/disputes\/\?initiator=homeowner(?:&.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(`**/api/projects/disputes/${DISPUTE_ID}/evidence-context/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        agreement: {
          id: 321,
          agreement_number: '321',
          title: 'Kitchen Remodel',
          homeowner_name: 'Jordan Demo',
          contractor_name: 'MyHomeBro Contractor',
          created_at: '2026-03-20T12:00:00Z',
          total_amount: 5400,
        },
        dispute: {
          id: DISPUTE_ID,
          status: 'open',
          escrow_frozen: true,
          fee_paid: true,
          category: 'scope',
          initiator: 'contractor',
          created_at: '2026-03-23T10:00:00Z',
          last_activity_at: '2026-03-23T10:10:00Z',
          complaint: 'Need a neutral summary.',
        },
        milestones: [],
        invoices: [],
        evidence: [],
        meta: {
          generated_at: '2026-03-23T10:10:00Z',
        },
      }),
    });
  });

  await page.route(`**/api/projects/disputes/${DISPUTE_ID}/ai/artifacts/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'No artifacts found.', items: [], count: 0 }),
    });
  });

  await page.route(`**/api/projects/disputes/${DISPUTE_ID}/ai/recommendation/`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        artifact_type: 'recommendation',
        cached: false,
        stored: true,
        model: 'playwright-neutral-resolution',
        version: 1,
        created_at: '2026-03-23T10:15:00Z',
        payload: {
          overview: {
            neutral_summary: 'Based on the available evidence, the case centers on whether the documented scope covered the disputed finish work.',
            timeline: [
              { date: '2026-03-20', event: 'Agreement appears to have been created.', source: 'Agreement record' },
              { date: '2026-03-23', event: 'Dispute opened with escrow hold active.', source: 'Dispute record' },
            ],
            disputed_facts: ['Whether the finish work was included in the original scope.'],
            undisputed_facts: ['A dispute is open and the fee is paid.'],
            relevant_agreement_sections: ['The agreement appears to state the project is Kitchen Remodel.'],
            evidence_used: [
              { type: 'agreement', label: 'Agreement #321', supports: 'The agreement appears to state the project title and total.' },
              { type: 'statement', label: 'Customer complaint', supports: 'The evidence supports that a neutral review is needed.' },
            ],
            main_issues: ['Scope alignment', 'Evidence completeness'],
            missing_info: ['Contractor statement', 'Completion photos'],
            missing_evidence: ['Contractor statement', 'Photos of disputed finish work'],
            risk_flags: ['Insufficient evidence to determine final financial impact.'],
          },
          courses_of_action: [
            {
              option_id: 'coa_1',
              label: 'COA 1 - request missing evidence',
              description: 'Pause final review until both parties add statements and photos.',
              pros: ['Improves fairness', 'Reduces assumptions'],
              cons: ['Adds time'],
              evidence_supporting: ['Missing contractor statement'],
              risks: ['Timeline remains open'],
              estimated_impact: 'Payment impact cannot be estimated yet.',
            },
            {
              option_id: 'coa_2',
              label: 'COA 2 - propose limited rework review',
              description: 'Review whether a limited punch-list visit would address the disputed item.',
              pros: ['May preserve relationship'],
              cons: ['Requires coordination'],
              evidence_supporting: ['Open dispute status'],
              risks: ['Scope may remain unclear'],
              estimated_impact: 'Work impact depends on human-approved scope.',
            },
            {
              option_id: 'coa_3',
              label: 'COA 3 - escalate to admin review',
              description: 'Move the record to human admin review with the current evidence gaps noted.',
              pros: ['Keeps the process moving'],
              cons: ['Decision-maker may still request more evidence'],
              evidence_supporting: ['Fee paid and escrow hold active'],
              risks: ['Insufficient evidence may limit review quality'],
              estimated_impact: 'No automatic payment action.',
            },
          ],
          options: [],
          recommendation: {
            recommended_option_id: 'coa_1',
            why_this_option: 'The evidence supports collecting both party statements before selecting a final path.',
            confidence: 0.64,
            supporting_evidence: ['Agreement #321', 'Customer complaint'],
            missing_evidence: ['Contractor statement', 'Completion photos'],
            notes_for_parties: 'Based on the available evidence, this is a review recommendation only.',
            advisory_boundary: 'Recommendation only. A human must accept, reject, counter, or escalate.',
          },
          draft_resolution_agreement: {
            title: 'Human review notes',
            terms: ['Collect missing evidence before any final resolution is recorded.'],
            signature_block: '',
            human_approval_required: 'No resolution, payment movement, or refund is executed by this recommendation.',
          },
        },
      }),
    });
  });

  await page.goto('/app/disputes', { waitUntil: 'domcontentloaded' });

  const disputeRow = page.locator('tr', { hasText: `#${DISPUTE_ID}` });
  await expect(disputeRow).toBeVisible();
  await disputeRow.getByRole('button', { name: 'View' }).click();

  await expect(page.getByTestId('resolution-workspace-title')).toContainText(`Resolution Case #${DISPUTE_ID}`);
  await expect(page.getByTestId('resolution-workspace-overview')).toContainText('Case origin');
  await expect(page.getByTestId('resolution-workspace-timeline')).toContainText('Resolution case opened');
  await expect(page.getByTestId('resolution-workspace-evidence')).toContainText('Photos, Documents, Receipts, Messages');
  await expect(page.getByTestId('resolution-workspace-statements')).toContainText('Customer');
  await expect(page.getByTestId('resolution-workspace-agreement-review')).toContainText('Agreement Review');
  await expect(page.getByTestId('resolution-workspace-payment-impact')).toContainText('No payment changes occur automatically');
  await expect(page.getByTestId('resolution-workspace-human-decision')).toContainText('Human Decision');
  await expect(page.getByTestId('dispute-ai-advisor')).toBeVisible();
  await expect(page.getByTestId('resolution-workspace-ai-analysis')).toContainText('Project Assistant');
  await expect(page.getByTestId('dispute-ai-advisor')).toContainText('Project Assistant');
  await expect(page.getByTestId('dispute-ai-recommendation-panel')).toContainText('Project Assistant Recommendation');
  await page.getByRole('button', { name: 'Generate recommendation' }).click();
  await expect(page.getByTestId('dispute-ai-coas')).toContainText('COA 1');
  await expect(page.getByTestId('dispute-ai-coas')).toContainText('COA 2');
  await expect(page.getByTestId('dispute-ai-coas')).toContainText('COA 3');
  await expect(page.getByTestId('dispute-ai-recommended-coa')).toContainText('coa_1');
  await expect(page.getByTestId('dispute-ai-recommendation-panel')).toContainText('Recommendation only');
  await expect(page.getByTestId('dispute-ai-missing-evidence')).toContainText('Contractor statement');
  await expect(page.getByTestId('dispute-ai-recommendation-panel')).not.toContainText('liable');
  await expect(page.getByTestId('dispute-ai-recommendation-panel')).not.toContainText('negligent');
  await expect(page.getByTestId('dispute-ai-recommendation-panel')).not.toContainText('breached');
  await expect(page.getByTestId('dispute-ai-recommendation-panel')).not.toContainText('you should');
  await expect(page.locator('text=/Upgrade to AI Pro|Payment required|Pay \\$/i')).toHaveCount(0);
  expect(requestedUrls.some((url) => url.includes('/api/projects/feature-flags/'))).toBeFalsy();
  expect(requestedUrls.some((url) => url.includes('/ai/checkout/'))).toBeFalsy();
  expect(requestedUrls.some((url) => url.includes('/ai/void-credit/'))).toBeFalsy();
  expect(requestedUrls.some((url) => url.includes(`/api/projects/disputes/${DISPUTE_ID}/resolve/`))).toBeFalsy();
  expect(requestedUrls.some((url) => /\/release\/|\/refund\/|\/refunds\/|release-payment|refund-payment/i.test(url))).toBeFalsy();
});
