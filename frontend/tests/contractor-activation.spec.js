import { expect, test } from '@playwright/test';

async function mockAuth(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  await page.route('**/api/projects/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });
  await page.route('**/api/payments/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 7, type: 'contractor', role: 'contractor_owner', email: 'contractor@example.com' }),
    });
  });

  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ onboarding_status: 'not_started', connected: false }),
    });
  });
}

function activationSummary(overrides = {}) {
  return {
    activation_type: 'homeowner_selected',
    has_prefilled_profile: true,
    has_pending_opportunities: true,
    pending_opportunity_count: 1,
    has_converted_opportunity: false,
    latest_agreement_id: null,
    latest_agreement_url: '',
    should_show_activation_guide: true,
    guide_sections: {
      prefilled_profile: {
        visible: true,
        completed: false,
        dismissed: false,
        title: 'We prepared your business profile',
        description: 'MyHomeBro used public business information to prefill a starting profile. You can edit or remove any prefilled business information.',
        action_url: '/app/public-presence',
        action_label: 'Open My Profile',
        checklist: ['Confirm business profile'],
      },
      public_leads: {
        visible: true,
        completed: false,
        dismissed: false,
        title: 'A homeowner request may be waiting',
        description: 'Nothing has been sent to a homeowner without your confirmation.',
        action_url: '/app/public-presence?tab=leads',
        action_label: 'Open Public Leads',
        checklist: ['Review public leads', 'Accept or decline homeowner request'],
      },
      draft_agreement: {
        visible: false,
        completed: false,
        dismissed: false,
        title: 'Draft agreements are starting points',
        description: 'Draft agreements are starting points, not final contracts.',
        action_url: '',
        action_label: 'Open Draft Agreement',
      },
      traditional_onboarding: {
        visible: false,
        completed: false,
        dismissed: false,
        title: 'Finish your MyHomeBro setup',
        description: 'Complete the essentials.',
        action_url: '/app/profile',
        action_label: 'Open My Profile',
      },
    },
    ...overrides,
  };
}

test('dashboard shows contextual activation guide and dismiss hides a section', async ({ page }) => {
  await mockAuth(page);

  let summary = activationSummary();
  await page.route('**/api/projects/contractor-activation-summary/', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(summary) });
  });
  await page.route('**/api/projects/contractor-activation-summary/dismiss/', async (route) => {
    const body = route.request().postDataJSON();
    summary = {
      ...summary,
      guide_sections: {
        ...summary.guide_sections,
        [body.section]: {
          ...summary.guide_sections[body.section],
          dismissed: true,
        },
      },
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(summary) });
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('contractor-activation-guide')).toContainText('We prepared your business profile');
  await expect(page.getByTestId('contractor-activation-guide')).toContainText('A homeowner request may be waiting');
  await expect(page.getByTestId('contractor-activation-guide')).toContainText('Nothing has been sent to a homeowner without your confirmation.');

  await page.getByTestId('contractor-activation-dismiss-public_leads').click();
  await expect(page.getByTestId('contractor-activation-section-public_leads')).toHaveCount(0);
});

test('traditional contractors do not see homeowner-selection guidance by default', async ({ page }) => {
  await mockAuth(page);
  await page.route('**/api/projects/contractor-activation-summary/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(activationSummary({
        activation_type: 'traditional_signup',
        has_prefilled_profile: false,
        has_pending_opportunities: false,
        pending_opportunity_count: 0,
        should_show_activation_guide: true,
        guide_sections: {
          prefilled_profile: { visible: false, completed: false, dismissed: false },
          public_leads: { visible: false, completed: false, dismissed: false },
          draft_agreement: { visible: false, completed: false, dismissed: false },
          traditional_onboarding: {
            visible: true,
            completed: false,
            dismissed: false,
            title: 'Finish your MyHomeBro setup',
            description: 'Complete the essentials so you can create your first agreement and receive protected payments.',
            action_url: '/app/profile',
            action_label: 'Open My Profile',
            checklist: ['Complete profile', 'Finish Stripe onboarding', 'Create first agreement'],
          },
        },
      })),
    });
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('contractor-activation-guide')).toContainText('Finish your MyHomeBro setup');
  await expect(page.getByTestId('contractor-activation-guide')).not.toContainText('homeowner request may be waiting');
  await expect(page.getByTestId('contractor-activation-guide')).not.toContainText('We prepared your business profile');
});

test('opportunity draft agreement banner renders and dismisses', async ({ page }) => {
  await mockAuth(page);

  let draftDismissed = false;
  await page.route('**/api/projects/contractor-activation-summary/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(activationSummary({
        has_pending_opportunities: false,
        has_converted_opportunity: true,
        latest_agreement_id: 901,
        latest_agreement_url: '/app/agreements/901/wizard?step=1',
        guide_sections: {
          draft_agreement: {
            visible: true,
            completed: false,
            dismissed: draftDismissed,
            title: 'Draft agreements are starting points',
            description: 'Draft agreements are starting points, not final contracts.',
            action_url: '/app/agreements/901/wizard?step=1',
            action_label: 'Open Draft Agreement',
          },
        },
      })),
    });
  });
  await page.route('**/api/projects/contractor-activation-summary/dismiss/', async (route) => {
    draftDismissed = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(activationSummary({
        has_converted_opportunity: true,
        guide_sections: { draft_agreement: { visible: true, completed: false, dismissed: true } },
      })),
    });
  });
  await page.route(/.*\/api\/projects\/agreements\/901\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 901,
        status: 'draft',
        project_title: 'Concrete Patio Extension',
        description: 'Draft from homeowner request',
        collaboration_summary_snapshot: { source: 'contractor_opportunity', opportunity_id: 101 },
      }),
    });
  });
  await page.route(/.*\/api\/projects\/homeowners\/?.*$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });

  await page.goto('/app/agreements/901/wizard?step=1', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('contractor-activation-draft-banner')).toContainText(
    'This draft agreement was prepared from a homeowner request.'
  );
  await page.getByTestId('contractor-activation-draft-dismiss').click();
  await expect(page.getByTestId('contractor-activation-draft-banner')).toHaveCount(0);
});
