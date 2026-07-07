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

test.describe('Project Assistant home route', () => {
  test.beforeEach(async ({ page }) => {
    await installWorkspacePageMocks(page);
  });

  test('renders Assistant Home without the old workflow launcher', async ({ page }) => {
    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('assistant-home-hero')).toBeVisible();
    await expect(page.getByTestId('assistant-home-hero').getByRole('heading', { name: 'Project Assistant' })).toBeVisible();
    await expect(page.getByTestId('assistant-home-context')).toContainText('Role');
    await expect(page.getByTestId('assistant-home-context')).toContainText('Workspace');
    await expect(page.getByTestId('assistant-home-pending-recommendations')).toBeVisible();
    await expect(page.getByTestId('assistant-home-role-skills')).toContainText('Create agreement from estimate');
    await expect(page.getByTestId('assistant-home-recent-context')).toBeVisible();
    await expect(page.getByTestId('assistant-home-history')).toBeVisible();
    await expect(page.getByTestId('assistant-home-saved-conversations')).toBeVisible();
    await expect(page.getByTestId('assistant-home-settings')).toContainText('explicit confirmation');

    await expect(page.getByTestId('ai-workspace-quick-actions')).not.toBeVisible();
    await expect(page.getByTestId('ai-workspace-result-panel')).not.toBeVisible();
    await expect(page.getByText('Launch Work. Continue Work. Find Work.')).not.toBeVisible();
    await expect(page.getByText('AI Workspace routes you to the right workflow')).not.toBeVisible();
    await expect(page.getByText('Continue Existing Project')).not.toBeVisible();
  });

  test('global Project Assistant dock opens from Assistant Home', async ({ page }) => {
    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Describe the work')).not.toBeVisible();
    await expect(page.locator('textarea:visible')).toHaveCount(0);

    await page.getByTestId('assistant-home-open-assistant').click();
    await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();
    await expect(page.getByTestId('assistant-desktop-dock')).toContainText('Project Assistant');
  });

  test('recent context and pending recommendations route to source workspaces', async ({ page }) => {
    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('assistant-home-pending-recommendations')).toContainText('Draft agreements need review');
    await page.getByTestId('assistant-home-context-agreement-901').click();
    await page.waitForURL('**/app/agreements/901');
  });

  test('old duplicate dashboard and template browser sections stay removed', async ({ page }) => {
    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('ai-workspace-suggested')).not.toBeVisible();
    await expect(page.getByTestId('ai-workspace-recent-work')).not.toBeVisible();
    await expect(page.getByTestId('ai-workspace-popular-templates')).not.toBeVisible();
    await expect(page.getByTestId('assistant-home-context-agreement-901')).toBeVisible();
    await expect(page.getByTestId('ai-workspace-template-301')).not.toBeVisible();
  });

  test('Assistant Home recommendations do not execute irreversible AI actions', async ({ page }) => {
    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('assistant-home-history')).toContainText('never sign, fund, assign, schedule, release payment, resolve disputes, or send customer messages without confirmation');
    await expect(page.getByText('Sign now')).not.toBeVisible();
    await expect(page.getByRole('button', { name: /release payment/i })).not.toBeVisible();
  });

  test('bottom assistant bridge stays removed', async ({ page }) => {
    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Need help with current work?')).not.toBeVisible();
    await expect(page.getByTestId('ai-workspace-footer')).not.toBeVisible();
    await expect(page.getByTestId('ai-workspace-open-copilot')).not.toBeVisible();
  });
});
