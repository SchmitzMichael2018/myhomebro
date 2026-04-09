import { expect, test } from '@playwright/test';

const SEEDED_TEMPLATE_TITLES = [
  'Bathroom Remodel',
  'Kitchen Remodel',
  'Cabinet Installation',
  'Appliance Installation',
  'Flooring Installation',
  'Roof Replacement',
];

test('local authenticated templates and wizard smoke use the real backend seed data', async ({
  page,
}) => {
  const customerSuffix = Date.now();
  const customerName = `Playwright Customer ${customerSuffix}`;
  const customerEmail = `playwright.customer.${customerSuffix}@myhomebro.local`;

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Templates' })).toBeVisible();
  await page.getByTestId('templates-market-tab-system').click();

  for (const title of SEEDED_TEMPLATE_TITLES) {
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  }

  await page.getByTestId('templates-search-input').fill('Bathroom Remodel');
  await page.getByText('Bathroom Remodel', { exact: true }).first().click();
  await expect(page.getByText('Reusable bathroom remodel template', { exact: false })).toBeVisible();

  const { homeownerId, agreementId } = await page.evaluate(
    async ({ name, email }) => {
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
          title: 'Playwright Local Template Draft',
          project_title: 'Playwright Local Template Draft',
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
        homeownerId: String(homeowner.id),
        agreementId: String(agreement.id || agreement.agreement_id),
      };
    },
    { name: customerName, email: customerEmail }
  );

  await page.goto(`/app/agreements/${agreementId}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await page.getByRole('button', { name: 'Use Template' }).click();
  await expect(page.getByTestId('step1-template-browser')).toBeVisible();

  await page
    .getByPlaceholder('Search templates by keyword, like "bathroom", "deck", or "bedroom addition"...')
    .fill('Bathroom Remodel');
  await page.getByRole('button', { name: /Bathroom Remodel/ }).first().click();
  await page.getByRole('button', { name: 'Apply Selected Template' }).click();

  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue('Remodel');
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue(
    'Bathroom Remodel'
  );
  await expect(page.locator('textarea[name="description"]')).toContainText(
    'bathroom remodel'
  );

  await page.goto(`/app/agreements/${agreementId}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  const milestoneRows = page.locator('tbody tr[data-testid^="step2-milestone-row-"]');
  await expect(milestoneRows).toHaveCount(5);
  await expect(milestoneRows.nth(0)).toContainText('Protection & Demo');
  await expect(milestoneRows.nth(1)).toContainText('Plumbing & Waterproofing');
  await expect(milestoneRows.nth(2)).toContainText('Tile & Surfaces');
  await expect(milestoneRows.nth(3)).toContainText('Fixtures & Vanity');
  await expect(milestoneRows.nth(4)).toContainText('Final Walkthrough');
});
