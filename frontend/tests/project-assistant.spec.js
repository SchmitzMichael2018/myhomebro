import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 2468;

function listResponse(results) {
  return JSON.stringify({ results });
}

async function installAssistantHomeMocks(page) {
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
        email: 'playwright@myhomebro.local',
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

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 77, ai: { access: 'included', enabled: true, unlimited: true } }),
    });
  });

  await page.route('**/api/projects/contractor-activation-summary/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ guide_sections: {} }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: listResponse([
        {
          id: 31,
          status: 'draft',
          project_title: 'Kitchen Flooring Agreement',
          customer_name: 'Taylor QA',
        },
      ]),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: listResponse([]),
    });
  });

  await page.route('**/api/projects/contractor/public-leads/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: listResponse([
        {
          id: 42,
          status: 'new',
          project_title: 'LVP hallway install',
          customer_name: 'Taylor QA Intake',
        },
      ]),
    });
  });

  await page.route('**/api/projects/templates/discover/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: listResponse([
        {
          id: 8,
          name: 'Flooring Remodel Template',
          project_type: 'Flooring',
          project_subtype: 'Luxury Vinyl Plank',
        },
      ]),
    });
  });

  await page.route('**/api/projects/recommendations/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ recommendations: [] }),
    });
  });
}

async function installAgreementWizardStep2Mocks(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  const agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Kitchen Flooring Installation',
    title: 'Kitchen Flooring Installation',
    project_type: 'Flooring',
    project_subtype: 'Luxury Vinyl Plank',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    pricing_strategy: 'fixed',
    description:
      'Install luxury vinyl plank flooring in the kitchen and hallway with substrate prep, trim, transitions, and cleanup.',
    homeowner: null,
    status: 'draft',
    step_status: '2',
    milestone_count: 3,
    total: '10000.00',
    display_total: '10000.00',
    compliance_warning: {
      warning_level: 'none',
      message: '',
    },
  };

  const milestones = [
    {
      id: 8101,
      agreement: AGREEMENT_ID,
      order: 1,
      title: 'Prep & Materials',
      description: 'Confirm materials, protect work areas, and prepare the substrate.',
      amount: '2500.00',
      start_date: '2026-07-01',
      completion_date: '2026-07-02',
      due_date: '2026-07-02',
    },
    {
      id: 8102,
      agreement: AGREEMENT_ID,
      order: 2,
      title: 'Flooring Installation',
      description: 'Install flooring, underlayment, and transitions according to manufacturer guidance.',
      amount: '6000.00',
      start_date: '2026-07-03',
      completion_date: '2026-07-06',
      due_date: '2026-07-06',
    },
    {
      id: 8103,
      agreement: AGREEMENT_ID,
      order: 3,
      title: 'Trim & Cleanup',
      description: 'Install trim, clean the work areas, and complete the walkthrough.',
      amount: '1500.00',
      start_date: '2026-07-07',
      completion_date: '2026-07-07',
      due_date: '2026-07-07',
    },
  ];

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

  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        onboarding_status: 'complete',
        connected: true,
      }),
    });
  });

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        ai: { access: 'included', enabled: true, unlimited: true },
      }),
    });
  });

  await page.route('**/api/projects/contractor-activation-summary/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ guide_sections: {} }),
    });
  });

  await page.route('**/api/projects/recommendations/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        recommendations: [
          {
            id: 'contractor-77-milestone-timing',
            key: 'contractor-77-milestone-timing',
            type: 'milestone_timing',
            category: 'delivery',
            title: 'Improve milestone timing',
            summary: 'Milestone snapshots show some delayed completion signals.',
            explanation: 'Use this as a planning cue before sending the agreement.',
            source: 'contractor_performance_summary',
            confidence: 'medium',
            severity: 'medium',
            audience: 'contractor',
            object_type: 'contractor',
            object_id: 77,
            action_label: 'Open Milestones',
            action_target: '/app/milestones',
            generated_at: '2026-06-09T12:00:00Z',
            metadata: {},
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: listResponse([
        { id: 1, value: 'Flooring', label: 'Flooring', owner_type: 'system' },
      ]),
    });
  });

  await page.route('**/api/projects/project-subtypes/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: listResponse([
        {
          id: 11,
          value: 'Luxury Vinyl Plank',
          label: 'Luxury Vinyl Plank',
          project_type: 'Flooring',
          owner_type: 'system',
        },
      ]),
    });
  });

  await page.route('**/api/projects/homeowners**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: listResponse([]),
    });
  });

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`), async (route) => {
    const request = route.request();
    if (request.method() === 'GET' || request.method() === 'PATCH') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(agreement),
      });
      return;
    }
    await route.fallback();
  });

  await page.route(/\/api\/projects\/milestones\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: listResponse(milestones),
    });
  });
}

test('Assistant Home renders the standardized Project Assistant experience system', async ({ page }) => {
  await installAssistantHomeMocks(page);

  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('assistant-home-hero')).toBeVisible();
  await expect(page.getByTestId('assistant-home-hero')).toContainText('Project Assistant');
  await expect(page.getByTestId('assistant-home-pending-recommendations')).toContainText(
    'Review assistant recommendations'
  );
  await expect(page.getByTestId('assistant-home-recommendation-card').first()).toContainText(
    'Medium confidence'
  );
  await expect(page.getByTestId('assistant-home-recent-context')).toContainText(
    'Kitchen Flooring Agreement'
  );
  await expect(page.getByTestId('assistant-home-role-skills')).toContainText(
    'Draft or review estimates'
  );
  await expect(page.getByTestId('assistant-home-history')).toContainText('Confirmation required');

  await page.getByTestId('assistant-home-open-assistant').click();
  await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();
  await expect(page.getByTestId('assistant-desktop-dock')).toContainText('Project Assistant');
});

test('Workspace navigation uses standardized Phase 2 terminology', async ({ page }) => {
  await installAssistantHomeMocks(page);

  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });

  const sidebar = page.locator('aside');
  await expect(sidebar).toContainText('Insights');
  await expect(sidebar).toContainText('Marketing');
  await expect(sidebar).toContainText('Resolution');
  await expect(page.getByRole('button', { name: /Project Assistant/ }).first()).toBeVisible();
  await expect(sidebar).not.toContainText('Business Dashboard');
  await expect(sidebar).not.toContainText('Public Presence');

  await page.goto('/app/insights', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/app\/insights/);
});

test('Agreement Wizard Project Assistant renders as a Step 2 guide without chat controls', async ({ page }) => {
  await installAgreementWizardStep2Mocks(page);

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step2-milestone-card-list')).toBeVisible();
  await page.getByTestId('assistant-dock-open-button').click();

  const dock = page.getByTestId('assistant-desktop-dock');
  await expect(dock).toBeVisible();
  await expect(dock).toContainText('Project Assistant');

  const panel = page.getByTestId('project-assistant-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('project-assistant-current-project')).toContainText(
    'Kitchen Flooring Installation'
  );
  await expect(page.getByTestId('project-assistant-current-project')).toContainText('3');

  await expect(page.getByTestId('project-assistant-step-guide')).toBeVisible();
  await expect(page.getByTestId('project-assistant-step-guide')).toContainText(
    "You're reviewing milestones."
  );
  await expect(page.getByTestId('project-assistant-step-guide')).toContainText('Step 2 of 4');
  await expect(page.getByTestId('project-assistant-guide-step-2')).toContainText(
    'Review milestones'
  );

  await expect(page.getByTestId('project-assistant-recommendations')).toBeVisible();
  const recommendation = page.getByTestId('project-assistant-recommendation-card').first();
  await expect(recommendation).toContainText('Improve milestone timing');
  await expect(recommendation).toContainText('Milestone snapshots show some delayed completion signals.');
  await expect(recommendation).toContainText('Use this as a planning cue before sending the agreement.');
  await expect(recommendation).toContainText('medium confidence');
  await expect(recommendation.getByTestId('recommendation-action')).toContainText('Open Milestones');
  await recommendation.getByTestId('recommendation-action').click();
  await expect(page).toHaveURL(/\/app\/milestones/);
  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('assistant-dock-open-button').click();

  await expect(page.getByTestId('project-assistant-step-actions')).toContainText('Step Actions');
  await expect(page.getByTestId('project-assistant-other-actions')).toContainText(
    'Other Helpful Actions'
  );
  await expect(page.getByTestId('project-assistant-action-step2_improve_descriptions')).toBeVisible();
  await expect(page.getByTestId('project-assistant-action-step2_regenerate_plan')).toBeVisible();
  await expect(page.getByTestId('project-assistant-action-step2_rebalance_pricing')).toBeVisible();
  await expect(page.getByTestId('project-assistant-continue-step')).toContainText(
    'Continue to Warranty'
  );

  await expect(panel.locator('textarea')).toHaveCount(0);
  await expect(panel).not.toContainText('Voice input ready');
  await expect(panel).not.toContainText('ask for one of the available actions');
  await expect(panel).not.toContainText('Copilot');
});
