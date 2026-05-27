import { expect, test } from '@playwright/test';

function buildTemplate({
  id,
  name,
  owner_type = 'contractor',
  is_system = false,
  visibility = 'private',
  normalized_region_key = '',
  project_type = 'Remodel',
  project_subtype = 'Kitchen Remodel',
}) {
  return {
    id,
    name,
    owner_type,
    is_system,
    is_active: true,
    visibility,
    source_label: is_system ? 'system' : visibility,
    project_type,
    project_subtype,
    description: `${name} description`,
    estimated_days: 14,
    milestone_count: 3,
    usage_count: visibility === 'regional' ? 4 : 1,
    completed_project_count: visibility === 'regional' ? 2 : 0,
    benchmark_support_label: is_system ? 'seeded' : 'seeded_and_learned',
    region_match_scope: visibility === 'regional' ? 'city' : 'global',
    normalized_region_key,
    milestones: [
      { id: id * 10 + 1, title: 'Demo', sort_order: 1, description: 'Demo scope' },
      { id: id * 10 + 2, title: 'Install', sort_order: 2, description: 'Install scope' },
    ],
  };
}

async function installMarketplaceMocks(page) {
  const store = {
    mine: [
      buildTemplate({ id: 1, name: 'My Private Kitchen Template', visibility: 'private' }),
    ],
    system: [
      buildTemplate({
        id: 2,
        name: 'System Kitchen Remodel',
        owner_type: 'system',
        is_system: true,
        visibility: 'system',
        normalized_region_key: 'US',
      }),
    ],
    regional: [
      buildTemplate({
        id: 3,
        name: 'San Antonio Kitchen Pro',
        visibility: 'regional',
        normalized_region_key: 'US-TX-SAN_ANTONIO',
      }),
    ],
    public: [
      buildTemplate({
        id: 4,
        name: 'National Kitchen Starter',
        visibility: 'public',
        normalized_region_key: 'US',
      }),
    ],
  };

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

  await page.route('**/api/projects/contractors/me/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        city: 'San Antonio',
        state: 'TX',
        ai: { access: 'included', enabled: true, unlimited: true },
      }),
    });
  });

  await page.route('**/api/projects/templates/discover/**', async (route) => {
    const url = new URL(route.request().url());
    const source = url.searchParams.get('source') || 'mine';
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const rows = [...(store[source] || [])].filter((row) =>
      !q ? true : `${row.name} ${row.project_type} ${row.project_subtype}`.toLowerCase().includes(q)
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: rows.map(({ milestones, ...rest }) => rest),
        meta: { source, count: rows.length },
      }),
    });
  });

  await page.route(/\/api\/projects\/templates\/\d+\/?$/, async (route) => {
    const url = new URL(route.request().url());
    const id = Number(url.pathname.split('/').filter(Boolean).pop());
    const row = Object.values(store)
      .flat()
      .find((item) => item.id === id);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(row || buildTemplate({ id, name: `Template ${id}` })),
    });
  });

  await page.route(/\/api\/projects\/templates\/\d+\/visibility\/$/, async (route) => {
    const url = new URL(route.request().url());
    const id = Number(url.pathname.split('/').filter(Boolean).slice(-2)[0]);
    const payload = route.request().postDataJSON();
    const row = Object.values(store)
      .flat()
      .find((item) => item.id === id);
    row.visibility = payload.visibility;
    row.source_label = payload.visibility;
    row.normalized_region_key =
      payload.visibility === 'regional' ? 'US-TX-SAN_ANTONIO' : payload.visibility === 'public' ? 'US' : '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(row),
    });
  });
}

test('templates marketplace tabs switch discovery sources and render results', async ({ page }) => {
  await installMarketplaceMocks(page);

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('templates-market-tab-mine')).toBeVisible();
  await expect(page.getByTestId('template-discovery-card-1')).toBeVisible();

  await page.getByTestId('templates-market-tab-system').click();
  await expect(page.getByTestId('template-discovery-card-2')).toBeVisible();

  await page.getByTestId('templates-market-tab-regional').click();
  await expect(page.getByTestId('template-discovery-card-3')).toBeVisible();

  await page.getByTestId('templates-market-tab-public').click();
  await expect(page.getByTestId('template-discovery-card-4')).toBeVisible();
});

test('templates marketplace allows explicit visibility changes for owned templates', async ({ page }) => {
  await installMarketplaceMocks(page);

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('template-discovery-card-1').click();
  await expect(page.getByRole('heading', { name: 'My Private Kitchen Template' })).toBeVisible();
  await page.getByTestId('template-visibility-public').click();
  await expect(page.getByText('Visibility: public')).toBeVisible();
});

test('templates page opens tab-aware AI Copilot guidance without apply actions', async ({ page }) => {
  await installMarketplaceMocks(page);

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('template-discovery-card-1').click();
  await expect(page.getByRole('heading', { name: 'My Private Kitchen Template' })).toBeVisible();
  await page.getByTestId('templates-tab-pricing').click();
  await page.getByTestId('assistant-dock-open-button').click();

  const dock = page.getByTestId('assistant-desktop-dock');
  await expect(dock).toBeVisible();
  await expect(dock).toContainText('AI Copilot for Templates');
  await expect(dock).toContainText('Review this template workflow');
  await expect(dock).toContainText('Advisory pricing guidance');
  await expect(page.getByTestId('start-with-ai-input-dock')).toHaveAttribute(
    'placeholder',
    /pricing guidance/i
  );
  await page.getByTestId('start-with-ai-input-dock').fill('create me a template for a pool installation');
  await page.getByTestId('start-with-ai-submit-dock').click();
  await expect(page.getByTestId('start-with-ai-template-draft-dock')).toBeVisible();
  await expect(page.getByTestId('start-with-ai-template-draft-dock')).toContainText(
    'Pool Installation Workflow Template'
  );
  await expect(page.getByTestId('start-with-ai-template-draft-dock')).toContainText(
    'Template Name'
  );
  await expect(page.getByTestId('start-with-ai-template-draft-dock')).toContainText(
    'Project Type / Project Subtype'
  );
  await expect(page.getByTestId('start-with-ai-template-draft-dock')).toContainText(
    'Description / Scope'
  );
  await expect(page.getByTestId('start-with-ai-template-draft-dock')).toContainText(
    'Suggested milestones'
  );
  await expect(page.getByTestId('start-with-ai-template-draft-dock')).toContainText(
    'Questions to decide next'
  );
  await expect(page.getByRole('button', { name: /Use this draft · Coming next/i })).toBeDisabled();
  await expect(page.getByTestId('templates-detail-name')).toContainText('My Private Kitchen Template');
  await expect(page.getByTestId('templates-detail-subtype')).toContainText('Kitchen Remodel');
  await expect(dock).not.toContainText('The agreement is nearly ready');
  await expect(dock).not.toContainText('signatures and funding');
  await expect(dock.getByRole('button', { name: /Apply/i })).toHaveCount(0);
});
