import { expect, test } from '@playwright/test';

function normalizeListBody(results) {
  return JSON.stringify({ results });
}

async function installBaseAuthMocks(page) {
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
        created_at: '2026-03-01T10:00:00Z',
        ai: {
          access: 'included',
          enabled: true,
          unlimited: true,
        },
      }),
    });
  });
}

async function installWorkspaceDataMocks(page) {
  const agreements = [
    {
      id: 901,
      title: 'Kitchen Remodel Agreement',
      customer_name: 'Casey Prospect',
      status: 'draft',
      updated_at: '2026-04-01T12:00:00Z',
    },
    {
      id: 902,
      title: 'Roof Replacement Draft',
      customer_name: 'Jordan Homeowner',
      status: 'draft',
      updated_at: '2026-03-28T09:00:00Z',
    },
    {
      id: 903,
      title: 'Bathroom Refresh Draft',
      customer_name: 'Morgan Owner',
      status: 'draft',
      updated_at: '2026-03-26T09:00:00Z',
    },
  ];

  const templates = [
    {
      id: 301,
      name: 'Kitchen Remodel Starter',
      project_type: 'Remodel',
      project_subtype: 'Kitchen Remodel',
      description: 'Reusable kitchen remodel template with milestone structure and planning guidance.',
      owner_type: 'system',
      is_system: true,
      milestone_count: 4,
    },
    {
      id: 302,
      name: 'Roof Replacement Standard',
      project_type: 'Exterior',
      project_subtype: 'Roof Replacement',
      description: 'Roof replacement template with tear-off, install, and closeout phases.',
      owner_type: 'system',
      is_system: true,
      milestone_count: 3,
    },
    {
      id: 303,
      name: 'Bath Remodel Pro',
      project_type: 'Remodel',
      project_subtype: 'Bathroom Remodel',
      description: 'Bathroom remodel template with waterproofing and finish planning.',
      owner_type: 'system',
      is_system: true,
      milestone_count: 5,
    },
  ];

  const leads = [
    {
      id: 1001,
      source: 'manual',
      status: 'ready_for_review',
    },
  ];

  const milestones = [
    {
      id: 1101,
      status: 'submitted',
    },
  ];

  await page.route(/\/api\/projects\/agreements\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: normalizeListBody(agreements),
    });
  });

  await page.route(/\/api\/projects\/templates\/discover\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: normalizeListBody(templates),
    });
  });

  await page.route('**/api/projects/contractor/public-leads/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: normalizeListBody(leads),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: normalizeListBody(milestones),
    });
  });
}

async function installNavigationTargetMocks(page) {
  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: normalizeListBody([
        { id: 1, value: 'Remodel', label: 'Remodel', owner_type: 'system' },
      ]),
    });
  });

  await page.route('**/api/projects/project-subtypes/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: normalizeListBody([
        {
          id: 11,
          value: 'Kitchen Remodel',
          label: 'Kitchen Remodel',
          owner_type: 'system',
          project_type: 'Remodel',
        },
      ]),
    });
  });

  await page.route('**/api/projects/homeowners**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: normalizeListBody([]),
    });
  });

  await page.route('**/api/projects/templates/**', async (route) => {
    if (route.request().url().includes('/api/projects/templates/discover/')) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: normalizeListBody([]),
    });
  });

  await page.route('**/api/projects/dashboard/operations/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        today: [],
        tomorrow: [],
        this_week: [],
        recent_activity: [],
      }),
    });
  });

  await page.route(/\/api\/projects\/invoices\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: normalizeListBody([]),
    });
  });

  await page.route(/\/api\/projects\/expense-requests\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: normalizeListBody([]),
    });
  });

  await page.route(/\/api\/projects\/agreements\/901\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 901,
        agreement_id: 901,
        title: 'Kitchen Remodel Agreement',
        project_title: 'Kitchen Remodel Agreement',
        description: 'Kitchen remodel with cabinets and finishes.',
        homeowner_name: 'Casey Prospect',
        status: 'draft',
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/901\/attachments\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: normalizeListBody([]),
    });
  });

  await page.route(/\/api\/projects\/attachments\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: normalizeListBody([]),
    });
  });
}

async function installWorkspacePageMocks(page) {
  await installBaseAuthMocks(page);
  await installWorkspaceDataMocks(page);
  await installNavigationTargetMocks(page);
}

test.describe('AI Workspace page', () => {
  test.beforeEach(async ({ page }) => {
    await installWorkspacePageMocks(page);
  });

  test('renders the structured workspace layout sections', async ({ page }) => {
    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('ai-workspace-hero')).toBeVisible();
    await expect(page.getByTestId('ai-workspace-quick-actions')).toBeVisible();
    await expect(page.getByTestId('ai-workspace-capabilities')).not.toBeVisible();
    await expect(page.getByTestId('ai-workspace-suggested')).not.toBeVisible();
    await expect(page.getByTestId('ai-workspace-recent-work')).not.toBeVisible();
    await expect(page.getByTestId('ai-workspace-popular-templates')).not.toBeVisible();
    await expect(page.getByTestId('ai-workspace-footer')).not.toBeVisible();
    await expect(page.getByTestId('ai-workspace-open-copilot')).not.toBeVisible();
    await expect(page.getByTestId('ai-workspace-result-panel')).not.toBeVisible();

    await expect(page.getByRole('heading', { name: 'Start or continue work' })).toBeVisible();
    const hero = page.getByTestId('ai-workspace-hero');
    await expect(hero.getByRole('button', { name: 'Create an agreement' })).toBeVisible();
    await expect(hero.getByRole('button', { name: 'Create a template' })).toBeVisible();
    await expect(hero.getByRole('button', { name: 'Continue a project' })).toBeVisible();
    await expect(hero.getByRole('button', { name: 'Plan milestones' })).toBeVisible();
    await expect(hero.getByRole('button', { name: 'Find my next task' })).toBeVisible();
    await expect(hero.getByRole('button', { name: 'Show work needing attention' })).toBeVisible();
    await expect(hero.getByRole('button', { name: 'Kitchen remodel' })).not.toBeVisible();
    await expect(hero.getByRole('button', { name: 'Roof replacement' })).not.toBeVisible();
    await expect(page.getByTestId('ai-workspace-hero-input')).toHaveAttribute(
      'placeholder',
      /Create agreements, use templates, continue projects, plan milestones/
    );
    await expect(page.getByText('Launch the right workflow without hunting for it.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What AI can help with' })).not.toBeVisible();
    await expect(page.getByTestId('ai-workspace-summary')).toBeVisible();
  });

  test('hero actions submit into workflow logic and open the copilot dock', async ({ page }) => {
    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });

    await page.getByTestId('ai-workspace-hero-input').fill(
      'Start agreement for Casey Prospect kitchen remodel'
    );
    await page.getByTestId('ai-workspace-hero-submit').click();

    await page.waitForURL('**/app/agreements/new/wizard?step=1');
    await expect(page.getByTestId('step1-job-description-input')).toHaveValue(
      /Casey Prospect kitchen remodel/
    );

    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
    await page
      .getByTestId('ai-workspace-hero')
      .getByRole('button', { name: 'Open AI Copilot' })
      .click();
    await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();
  });

  test('quick action cards navigate to the expected flows', async ({ page }) => {
    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });

    await page.getByTestId('ai-workspace-quick-action-start_agreement').click();
    await page.waitForURL('**/app/agreements/new/wizard?step=1');

    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('ai-workspace-quick-action-apply_template').click();
    await page.waitForURL('**/app/templates');

    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('ai-workspace-quick-action-suggest_milestones').click();
    await page.waitForURL('**/app/agreements/new/wizard?step=2');

    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('ai-workspace-quick-action-navigate_app').click();
    await expect(page.getByTestId('ai-workspace-result-panel')).toBeVisible();
    await expect(page.getByTestId('ai-workspace-result-title')).toBeVisible();
    await expect(page.getByTestId('ai-workspace-result-primary-cta')).toBeVisible();
  });

  test('duplicate dashboard, recent work, and template browser sections stay removed', async ({ page }) => {
    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('ai-workspace-suggested')).not.toBeVisible();
    await expect(page.getByTestId('ai-workspace-recent-work')).not.toBeVisible();
    await expect(page.getByTestId('ai-workspace-popular-templates')).not.toBeVisible();
    await expect(page.getByTestId('ai-workspace-recent-work-901')).not.toBeVisible();
    await expect(page.getByTestId('ai-workspace-template-301')).not.toBeVisible();
    await expect(page.getByText('Kitchen Remodel Starter')).not.toBeVisible();
  });

  test('Find my next task chip shows analysis result with no immediate routing', async ({ page }) => {
    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('ai-workspace-result-panel')).not.toBeVisible();

    const hero = page.getByTestId('ai-workspace-hero');
    await hero.getByRole('button', { name: 'Find my next task' }).click();

    await expect(page.getByTestId('ai-workspace-result-panel')).toBeVisible();
    await expect(page.getByTestId('ai-workspace-result-title')).toContainText('Review and send draft agreements');
    await expect(page.getByTestId('ai-workspace-result-reason')).toContainText(
      'You have 3 draft agreements waiting. Completing them can unlock signatures, funding, and active work.'
    );
    await expect(page.getByTestId('ai-workspace-result-primary-cta')).toContainText('Open Agreements');
    await expect(page.getByTestId('ai-workspace-result-secondary-cta')).toContainText('Open Copilot');

    await page.getByTestId('ai-workspace-result-secondary-cta').click();
    await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();
    await page.getByTestId('assistant-desktop-dock-close').click();
    await expect(page.getByTestId('assistant-desktop-dock')).not.toBeVisible();

    await page.getByTestId('ai-workspace-result-primary-cta').click();
    await page.waitForURL('**/app/agreements');
  });

  test('bottom Copilot bridge stays removed', async ({ page }) => {
    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Need help with current work?')).not.toBeVisible();
    await expect(page.getByTestId('ai-workspace-footer')).not.toBeVisible();
    await expect(page.getByTestId('ai-workspace-open-copilot')).not.toBeVisible();
  });
});
