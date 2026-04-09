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
      title: 'Roof Replacement Project',
      customer_name: 'Jordan Homeowner',
      status: 'signed',
      updated_at: '2026-03-28T09:00:00Z',
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
    await expect(page.getByTestId('ai-workspace-suggested')).toBeVisible();
    await expect(page.getByTestId('ai-workspace-recent-work')).toBeVisible();
    await expect(page.getByTestId('ai-workspace-popular-templates')).toBeVisible();
    await expect(page.getByTestId('ai-workspace-footer')).toBeVisible();

    await expect(page.getByText('Start something new with AI')).toBeVisible();
    await expect(page.getByText('Launch the right workflow without hunting for it.')).toBeVisible();
    await expect(page.getByText('Recommended next moves based on your current work.')).toBeVisible();
    await expect(page.getByText('Continue where your recent projects left off.')).toBeVisible();
    await expect(page.getByText('Explore reusable project structures before you draft.')).toBeVisible();
  });

  test('hero actions submit into workflow logic and open the copilot dock', async ({ page }) => {
    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });

    await page.getByTestId('ai-workspace-hero-input').fill(
      'Start agreement for Casey Prospect kitchen remodel'
    );
    await page.getByTestId('ai-workspace-hero-submit').click();

    await page.waitForURL('**/app/agreements/new/wizard?step=1');
    await expect(page.locator('textarea[name="description"]')).toContainText(
      'Casey Prospect kitchen remodel'
    );
    await expect(page.locator('input[placeholder="e.g., Jane Smith"]')).toHaveValue(
      'Casey Prospect'
    );

    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Open AI Copilot' }).click();
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
    await page.waitForURL('**/app/dashboard');
  });

  test('recent work rows are clickable and navigate correctly', async ({ page }) => {
    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('ai-workspace-recent-work-901')).toBeVisible();
    await expect(page.getByTestId('ai-workspace-recent-work-901')).toContainText(
      'Current step: Agreement setup'
    );

    await page.getByTestId('ai-workspace-recent-work-901').click();
    await page.waitForURL('**/app/agreements/901');
  });

  test('popular template cards render and their actions navigate to templates', async ({ page }) => {
    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('ai-workspace-popular-templates')).toBeVisible();
    await expect(page.getByText('Kitchen Remodel Starter')).toBeVisible();
    await expect(page.getByTestId('ai-workspace-template-301')).toBeVisible();
    await expect(page.getByTestId('ai-workspace-template-301')).toContainText(
      'Kitchen Remodel Starter'
    );
    await expect(page.getByTestId('ai-workspace-template-301')).toContainText('4 milestones');

    const firstCard = page.getByTestId('ai-workspace-template-301');
    await firstCard.getByRole('button', { name: 'View template' }).click();
    await page.waitForURL('**/app/templates');

    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
    await page
      .getByTestId('ai-workspace-template-301')
      .getByRole('button', { name: 'See all templates' })
      .click();
    await page.waitForURL('**/app/templates');
  });

  test('footer Ask AI opens the dock', async ({ page }) => {
    await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });

    await page.getByTestId('ai-workspace-open-copilot').click();
    await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();
  });
});
