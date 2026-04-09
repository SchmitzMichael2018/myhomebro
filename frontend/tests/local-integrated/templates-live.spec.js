import { expect, test } from '@playwright/test';

const SEEDED_TEMPLATE_CASES = [
  {
    name: 'Bathroom Remodel',
    expectedType: 'Remodel',
    expectedSubtype: 'Bathroom Remodel',
    descriptionSnippet: 'Reusable bathroom remodel template',
    recommendationDescription:
      'Complete bathroom remodel with demo, tile shower, vanity, lighting, plumbing trim, and final paint.',
    milestoneTitles: [
      'Protection & Demo',
      'Plumbing & Waterproofing',
      'Tile & Surfaces',
      'Fixtures & Vanity',
      'Final Walkthrough',
    ],
  },
  {
    name: 'Kitchen Remodel',
    expectedType: 'Remodel',
    expectedSubtype: 'Kitchen Remodel',
    descriptionSnippet: 'Reusable kitchen remodel template',
    recommendationDescription:
      'Kitchen renovation with demo, cabinet replacement, countertops, backsplash, plumbing and electrical updates.',
    milestoneTitles: [
      'Planning & Protection',
      'Demo & Rough-In',
      'Cabinets & Counters',
      'Fixtures & Finish Work',
      'Final Walkthrough',
    ],
  },
  {
    name: 'Cabinet Installation',
    expectedType: 'Cabinetry',
    expectedSubtype: 'Cabinet Installation',
    descriptionSnippet: 'Reusable cabinet installation template',
    recommendationDescription:
      'Install new kitchen cabinets on one wall, align doors, add hardware, no plumbing or electrical changes.',
    milestoneTitles: [
      'Measurements & Staging',
      'Layout & Prep',
      'Cabinet Installation',
      'Alignment & Closeout',
    ],
  },
  {
    name: 'Appliance Installation',
    expectedType: 'Installation',
    expectedSubtype: 'Appliance Installation',
    descriptionSnippet: 'Reusable appliance installation template',
    recommendationDescription:
      'Install a new dishwasher and over-the-range microwave, connect utilities, test operation, haul away old units.',
    milestoneTitles: [
      'Delivery & Staging',
      'Removal & Prep',
      'Appliance Install',
      'Testing & Handoff',
    ],
  },
  {
    name: 'Flooring Installation',
    expectedType: 'Flooring',
    expectedSubtype: 'Flooring Installation',
    descriptionSnippet: 'Reusable flooring installation template',
    recommendationDescription:
      'Remove old laminate and install new LVP flooring with underlayment and transitions throughout main living areas.',
    milestoneTitles: [
      'Site Prep',
      'Underlayment & Layout',
      'Main Installation',
      'Trim & Cleanup',
    ],
  },
  {
    name: 'Roof Replacement',
    expectedType: 'Roofing',
    expectedSubtype: 'Roof Replacement',
    descriptionSnippet: 'Reusable roof replacement template',
    recommendationDescription:
      'Tear off existing asphalt shingles, inspect decking, install underlayment, flashing, and new architectural shingles.',
    milestoneTitles: [
      'Tear-Off & Deck Review',
      'Weatherproofing & Flashing',
      'Roof Installation',
      'Cleanup & Final Review',
    ],
  },
];

const HIGH_VALUE_WIZARD_CASES = SEEDED_TEMPLATE_CASES.filter((row) =>
  ['Bathroom Remodel', 'Cabinet Installation', 'Roof Replacement'].includes(row.name)
);

async function createDraftAgreement(page, caseName) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const customerName = `Playwright Customer ${suffix}`;
  const customerEmail = `playwright.customer.${suffix}@myhomebro.local`;

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  return page.evaluate(
    async ({ name, email, caseName: templateCaseName }) => {
      const token = window.localStorage.getItem('access');

      const homeownerResponse = await fetch('http://127.0.0.1:8000/api/projects/homeowners/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          full_name: name,
          email,
        }),
      });

      if (!homeownerResponse.ok) {
        throw new Error(
          `homeowner create failed: ${homeownerResponse.status} ${await homeownerResponse.text()}`
        );
      }

      const homeowner = await homeownerResponse.json();

      const agreementResponse = await fetch('http://127.0.0.1:8000/api/projects/agreements/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          homeowner: homeowner.id,
          title: `Playwright ${templateCaseName} Draft`,
          project_title: `Playwright ${templateCaseName} Draft`,
          description:
            'Draft agreement. Details will be completed after template selection or manual entry.',
          agreement_mode: 'standard',
          payment_mode: 'escrow',
          payment_structure: 'simple',
          retainage_percent: '0.00',
          is_draft: true,
          wizard_step: 1,
        }),
      });

      if (!agreementResponse.ok) {
        throw new Error(
          `agreement create failed: ${agreementResponse.status} ${await agreementResponse.text()}`
        );
      }

      const agreement = await agreementResponse.json();

      return {
        agreementId: String(agreement.id || agreement.agreement_id),
      };
    },
    { name: customerName, email: customerEmail, caseName }
  );
}

async function applyTemplateInWizard(page, templateCase) {
  const { agreementId } = await createDraftAgreement(page, templateCase.name);

  await page.goto(`/app/agreements/${agreementId}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await page.getByRole('button', { name: 'Use Template' }).click();
  await expect(page.getByTestId('step1-template-browser')).toBeVisible();

  await page
    .getByPlaceholder('Search templates by keyword, like "bathroom", "deck", or "bedroom addition"...')
    .fill(templateCase.name);
  await page.getByRole('button', { name: new RegExp(templateCase.name) }).first().click();
  await page.getByRole('button', { name: 'Apply Selected Template' }).click();

  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue(
    templateCase.expectedType
  );
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue(
    templateCase.expectedSubtype
  );
  await expect(page.locator('textarea[name="description"]')).toContainText(
    templateCase.descriptionSnippet.replace('Reusable ', '').replace(' template', '')
  );

  await page.goto(`/app/agreements/${agreementId}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  const milestoneRows = page.locator('tbody tr[data-testid^="step2-milestone-row-"]');
  await expect(milestoneRows).toHaveCount(templateCase.milestoneTitles.length);

  for (const [idx, title] of templateCase.milestoneTitles.entries()) {
    await expect(milestoneRows.nth(idx)).toContainText(title);
  }
}

async function fetchRecommendation(page, description) {
  return page.evaluate(async ({ description: rawDescription }) => {
    const token = window.localStorage.getItem('access');
    const response = await fetch('http://127.0.0.1:8000/api/projects/templates/recommend/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        description: rawDescription,
      }),
    });

    if (!response.ok) {
      throw new Error(`recommendation failed: ${response.status} ${await response.text()}`);
    }

    return response.json();
  }, { description });
}

test('seeded starter templates appear in the real Templates page with aligned detail content', async ({
  page,
}) => {
  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Templates' })).toBeVisible();
  await page.getByTestId('templates-market-tab-system').click();

  for (const templateCase of SEEDED_TEMPLATE_CASES) {
    await page.getByTestId('templates-search-input').fill(templateCase.name);
    await page.getByText(templateCase.name, { exact: true }).first().click();

    await expect(page.getByTestId('templates-detail-name')).toHaveText(templateCase.name);
    await expect(page.getByTestId('templates-detail-type')).toHaveText(templateCase.expectedType);
    await expect(page.getByTestId('templates-detail-subtype')).toHaveText(
      templateCase.expectedSubtype
    );
    await expect(page.getByTestId('templates-description-input')).toContainText(
      templateCase.descriptionSnippet
    );

    await page.getByTestId('templates-tab-milestones').click();
    await expect(page.getByTestId('templates-preview-milestone-1')).toContainText(
      templateCase.milestoneTitles[0]
    );
    await expect(
      page.getByTestId(`templates-preview-milestone-${templateCase.milestoneTitles.length}`)
    ).toContainText(templateCase.milestoneTitles[templateCase.milestoneTitles.length - 1]);

    await page.getByTestId('templates-tab-setup').click();
  }
});

for (const templateCase of HIGH_VALUE_WIZARD_CASES) {
  test(`high-value seeded template applies cleanly in the real Agreement Wizard: ${templateCase.name}`, async ({
    page,
  }) => {
    await applyTemplateInWizard(page, templateCase);
  });
}

test('real backend recommendation returns the correct seeded templates for natural descriptions', async ({
  page,
}) => {
  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  for (const templateCase of SEEDED_TEMPLATE_CASES) {
    const recommendation = await fetchRecommendation(page, templateCase.recommendationDescription);

    expect(recommendation.confidence).toBe('recommended');
    expect(recommendation.score).toBeGreaterThanOrEqual(70);
    expect(recommendation.recommended_template?.name).toBe(templateCase.name);
  }
});
