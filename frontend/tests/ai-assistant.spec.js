import { expect, test } from '@playwright/test';

function installBaseAuthMocks(page) {
  return Promise.all([
    page.addInitScript(() => {
      window.localStorage.setItem('access', 'playwright-access-token');
    }),
    page.route('**/api/projects/whoami/', async (route) => {
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
    }),
    page.route('**/api/payments/onboarding/status/', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          onboarding_status: 'complete',
          connected: true,
        }),
      });
    }),
    page.route('**/api/projects/contractors/me/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 77,
          created_at: '2026-03-01T10:00:00Z',
        }),
      });
    }),
  ]);
}

function installRouteState(page, matcher, userState) {
  return page.addInitScript(
    ({ pathname, search, state }) => {
      const currentPath = window.location.pathname;
      const currentSearch = window.location.search;
      if (currentPath !== pathname) return;
      if (typeof search === 'string' && search !== currentSearch) return;
      const currentHistoryState = window.history.state || {};
      window.history.replaceState(
        {
          ...currentHistoryState,
          usr: state,
          key: currentHistoryState.key || 'default',
        },
        '',
        window.location.href
      );
    },
    {
      pathname: matcher.pathname,
      search: matcher.search ?? null,
      state: userState,
    }
  );
}

test('desktop docked assistant panel opens and closes from app chrome', async ({ page }) => {
  await installBaseAuthMocks(page);

  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('aside')).not.toContainText('Project Assistant');
  await expect(page.getByTestId('assistant-dock-open-button')).toBeVisible();
  await page.getByTestId('assistant-dock-open-button').click();

  await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();
  await expect(page.getByTestId('assistant-desktop-dock')).toContainText('Project Assistant');

  await page.getByTestId('assistant-desktop-dock-close').click();
  await expect(page.getByTestId('assistant-desktop-dock')).not.toBeVisible();
});

test('agreement wizard assistant uses agreement context from the current workflow step', async ({
  page,
}) => {
  const agreementId = 123;
  let agreement = {
    id: agreementId,
    agreement_id: agreementId,
    project_title: 'Kitchen Remodel Agreement',
    title: 'Kitchen Remodel Agreement',
    project_type: 'Remodel',
    project_subtype: 'Kitchen Remodel',
    payment_mode: 'escrow',
    description: 'Remodel the kitchen and update finishes.',
    homeowner: 1,
    status: 'draft',
  };

  await installBaseAuthMocks(page);

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 1, value: 'Remodel', label: 'Remodel', owner_type: 'system' }],
      }),
    });
  });

  await page.route('**/api/projects/project-subtypes/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 11,
            value: 'Kitchen Remodel',
            label: 'Kitchen Remodel',
            owner_type: 'system',
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/homeowners**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 1, company_name: 'Demo Customer', full_name: 'Jordan Demo' }],
      }),
    });
  });

  await page.route('**/api/projects/templates/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/123\/?(\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(agreement),
      });
      return;
    }

    if (request.method() === 'PATCH') {
      agreement = { ...agreement, ...request.postDataJSON() };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(agreement),
      });
      return;
    }

    await route.fallback();
  });

  await page.route(/\/api\/projects\/milestones\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/123\/attachments\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/attachments\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.goto('/app/agreements/123/wizard?step=1', {
    waitUntil: 'domcontentloaded',
  });

  await page.getByTestId('assistant-dock-open-button').click();
  await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();
  await expect(page.getByTestId('assistant-desktop-dock')).toContainText(
    'Project Assistant for Agreement Creation'
  );

  await expect(page.getByTestId('project-assistant-panel')).toBeVisible();
  await expect(page.getByTestId('project-assistant-panel')).toContainText('Step Guide');
  await expect(page.getByTestId('project-assistant-panel')).toContainText('Kitchen Remodel Agreement');
  await expect(page.getByTestId('project-assistant-action-step2_generate_milestone_plan')).toBeVisible();
  await expect(page.getByTestId('project-assistant-action-step2_enter_project_total')).toBeVisible();
  await page.getByTestId('project-assistant-action-step2_enter_project_total').click();
  await expect(page.getByTestId('step2-target-project-total')).toBeFocused();
  await expect(page.getByTestId('assistant-desktop-dock')).not.toBeVisible();

  await page.getByTestId('assistant-dock-open-button').click();
  await expect(page.getByTestId('project-assistant-action-step2_generate_milestone_plan')).toBeVisible();
  await page.getByTestId('project-assistant-action-step2_generate_milestone_plan').click();
  await expect(page.getByTestId('step2-ai-milestone-preview-card')).toBeVisible();
  await expect(page.getByTestId('step2-ai-milestone-preview-card')).toContainText(
    'Review regenerated milestone plan'
  );
  await expect(page.getByTestId('step2-ai-milestone-preview-card')).toContainText(
    'Apply Suggested Milestones'
  );
});

test('customer form consumes assistant prefill from route state', async ({ page }) => {
  await installBaseAuthMocks(page);
  await installRouteState(
    page,
    { pathname: '/app/customers/new', search: '' },
    {
      assistantPrefill: {
        full_name: 'Casey Prospect',
        email: 'casey@example.com',
        phone: '5554443333',
        address_line1: '101 Main St',
        city: 'Austin',
        state: 'TX',
        postal_code: '78701',
      },
      assistantIntent: 'create_customer',
    }
  );

  await page.goto('/app/customers/new', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('customer-assistant-prefill-banner')).toBeVisible();
  await expect(page.locator('input[name="full_name"]')).toHaveValue('Casey Prospect');
  await expect(page.locator('input[name="email"]')).toHaveValue('casey@example.com');
  await expect(page.locator('input[name="phone_number"]')).toHaveValue('(555) 444-3333');
  await expect(page.locator('input[name="city"]')).toHaveValue('Austin');
});

test('customer creation uses one contractor-scoped Project Assistant dock', async ({ page }) => {
  await installBaseAuthMocks(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/customers/new', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('customer-form-ai-entry')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Assistant' })).toHaveCount(0);

  await page.getByTestId('assistant-dock-open-button').click();
  const dock = page.getByTestId('assistant-desktop-dock');
  await expect(dock).toBeVisible();
  await expect(dock).toContainText('Project Assistant');
  await expect(dock).toContainText('Customer setup');
  await expect(dock).not.toContainText('Customer Portal');
  await expect(dock).not.toContainText('Explain customer next steps');
  await expect(dock).not.toContainText('agreement is nearly ready');
  await expect(dock.getByRole('button', { name: 'Close', exact: true })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dock).not.toBeVisible();
  await expect(page.getByTestId('assistant-dock-open-button')).toBeFocused();
});

test('customer creation opens the same scoped assistant on narrow screens', async ({ page }) => {
  await installBaseAuthMocks(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/customers/new', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('assistant-dock-open-button').click();
  const sheet = page.getByTestId('assistant-mobile-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Customer setup');
  await expect(sheet).not.toContainText('Quick Capture');
  await expect(sheet.getByRole('button', { name: 'Close', exact: true })).toHaveCount(1);
  await page.getByTestId('assistant-mobile-sheet-close').click();
  await expect(sheet).not.toBeVisible();
});

test('customer create assistant tracks safe live field state and focuses the next field', async ({ page }) => {
  await installBaseAuthMocks(page);
  let customerCreateRequests = 0;
  await page.route('**/api/projects/homeowners/', async (route) => {
    if (route.request().method() === 'POST') customerCreateRequests += 1;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 912, full_name: 'QA Homeowner' }) });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/customers/new', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('assistant-dock-open-button').click();

  const dock = page.getByTestId('assistant-desktop-dock');
  await expect(dock).toContainText('Create a complete customer record');
  await expect(dock.getByTestId('customer-record-status')).toBeVisible();
  await expect(dock.getByTestId('customer-status-full_name')).toContainText('Missing');
  await expect(dock.getByTestId('customer-status-company_name')).toContainText('Optional');
  await expect(dock).not.toContainText('Open the next step');
  await expect(dock).not.toContainText(/funding|payment/i);
  await page.screenshot({ path: 'test-results/customer-assistant-empty.png', fullPage: true });

  await dock.getByTestId('customer-assistant-next-action').click();
  await expect(page.locator('input[name="full_name"]')).toBeFocused();
  await page.locator('input[name="full_name"]').fill('QA Homeowner');
  await expect(dock.getByTestId('customer-status-full_name')).toContainText('Complete');

  await dock.getByTestId('customer-assistant-next-action').click();
  await expect(page.locator('input[name="email"]')).toBeFocused();
  await page.locator('input[name="email"]').fill('invalid-email');
  await expect(dock.getByTestId('customer-status-email')).toContainText('Invalid');
  await page.locator('input[name="email"]').fill('qa@example.com');
  await expect(dock.getByTestId('customer-status-email')).toContainText('Complete');

  await page.locator('input[name="phone_number"]').fill('5555551212');
  await page.locator('#mhb-customerform-290').fill('101 Main St');
  await expect(dock.getByTestId('customer-status-address')).toContainText('Incomplete');
  await page.screenshot({ path: 'test-results/customer-assistant-partial.png', fullPage: true });
  await page.locator('input[name="city"]').fill('Austin');
  await page.locator('select[name="state"]').selectOption('TX');
  await expect(dock.getByTestId('customer-status-address')).toContainText('Complete');
  await expect(dock.getByTestId('customer-assistant-next-action')).toContainText('Review and create customer');
  await expect(dock).not.toContainText('Create estimate');
  await page.screenshot({ path: 'test-results/customer-assistant-ready.png', fullPage: true });

  await dock.getByLabel('Ask Project Assistant').fill('Review this customer record before I save it.');
  await dock.getByTestId('start-with-ai-submit-dock').click();
  await expect(dock.getByTestId('customer-record-review-dock')).toContainText('not saved yet');
  expect(customerCreateRequests).toBe(0);

  await dock.getByTestId('customer-assistant-next-action').click();
  await expect(page.getByRole('button', { name: 'Create Customer', exact: true })).toBeFocused();
});

for (const width of [900, 390]) {
  test(`customer create assistant has no document overflow at ${width}px`, async ({ page }) => {
    await installBaseAuthMocks(page);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('/app/customers/new', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('assistant-dock-open-button').click();
    await expect(page.getByTestId('assistant-mobile-sheet')).toBeVisible();
    if (width === 390) await page.screenshot({ path: 'test-results/customer-assistant-390.png', fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
}

test('customer creation still issues exactly one request and follows the existing redirect', async ({ page }) => {
  await installBaseAuthMocks(page);
  let customerCreateRequests = 0;
  await page.route('**/api/projects/homeowners/', async (route) => {
    if (route.request().method() === 'POST') customerCreateRequests += 1;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 912, full_name: 'QA Homeowner' }) });
  });
  await page.goto('/app/customers/new', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="full_name"]').fill('QA Homeowner');
  await page.locator('input[name="email"]').fill('qa@example.com');
  await page.locator('input[name="phone_number"]').fill('5555551212');
  await page.locator('#mhb-customerform-290').fill('101 Main St');
  await page.locator('input[name="city"]').fill('Austin');
  await page.locator('select[name="state"]').selectOption('TX');
  await page.locator('form[novalidate]').evaluate((form) => form.requestSubmit());
  await expect(page).toHaveURL(/\/app\/customers$/);
  expect(customerCreateRequests).toBe(1);
});

test('failed customer creation keeps unsaved assistant context and form values', async ({ page }) => {
  await installBaseAuthMocks(page);
  await page.route('**/api/projects/homeowners/', async (route) => {
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ email: ['Already exists.'] }) });
  });
  await page.goto('/app/customers/new', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('assistant-dock-open-button').click();
  await page.locator('input[name="full_name"]').fill('QA Homeowner');
  await page.locator('input[name="email"]').fill('qa@example.com');
  await page.locator('input[name="phone_number"]').fill('5555551212');
  await page.locator('#mhb-customerform-290').fill('101 Main St');
  await page.locator('input[name="city"]').fill('Austin');
  await page.locator('select[name="state"]').selectOption('TX');
  await page.locator('form[novalidate]').evaluate((form) => form.requestSubmit());
  await expect(page).toHaveURL(/\/app\/customers\/new$/);
  await expect(page.locator('input[name="full_name"]')).toHaveValue('QA Homeowner');
  await expect(page.getByTestId('assistant-desktop-dock')).toContainText('The customer was not created');
  await expect(page.getByTestId('assistant-desktop-dock')).not.toContainText('Create estimate');
});

// ─── Templates Assistant: creation intent must never reach the orchestrator ───

function installTemplatesPageRoutes(page) {
  return Promise.all([
    page.route('**/api/projects/contractors/me/', async (route) => {
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
    }),
    page.route('**/api/projects/templates/discover/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [], count: 0 }),
      });
    }),
    page.route(/\/api\/projects\/templates\/?(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [], count: 0 }),
      });
    }),
    page.route('**/api/projects/project-types/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [] }),
      });
    }),
    page.route('**/api/projects/project-subtypes/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [] }),
      });
    }),
  ]);
}

function installAgreementListRoutes(page) {
  return Promise.all([
    page.route('**/api/projects/agreements/**/milestones/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [], count: 0 }),
      });
    }),
    page.route(/\/api\/projects\/agreements\/?(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            {
              id: 123,
              project_title: 'Kitchen agreement',
              title: 'Kitchen agreement',
              description: 'Cabinet installation agreement',
              status: 'draft',
              total_price: '4500.00',
              payment_mode: 'escrow',
              homeowner: { first_name: 'Casey', last_name: 'Prospect' },
              created_at: '2026-05-01T10:00:00Z',
              updated_at: '2026-05-02T10:00:00Z',
              milestone_count: 2,
              pdf_version: 1,
              pdf_versions_count: 1,
            },
          ],
          count: 1,
          page: 1,
          page_size: 10,
        }),
      });
    }),
    page.route('**/api/projects/homeowners/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [] }),
      });
    }),
  ]);
}

test('templates copilot: "create template" prompt renders a review-only draft without calling the orchestrator', async ({
  page,
}) => {
  await installBaseAuthMocks(page);
  await installTemplatesPageRoutes(page);

  // Any call to the orchestrator is a test failure — creation prompts on the
  // templates page must be handled entirely by the local planner.
  let orchestratorCalled = false;
  await page.route('**/api/projects/assistant/orchestrate/', async (route) => {
    orchestratorCalled = true;
    await route.abort();
  });

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  // Open the Project Assistant dock via the sidebar button.
  await page.getByTestId('assistant-dock-open-button').first().click();
  await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();

  // Type a template creation prompt — the exact phrase from the bug report.
  await page.getByTestId('start-with-ai-input-dock').fill('create template for kitchen cabinet installation');
  await page.getByTestId('start-with-ai-submit-dock').click();

  // The "Workflow Draft" block must appear in the copilot panel.
  await expect(page.getByTestId('start-with-ai-template-draft-dock')).toBeVisible();

  // Draft should contain kitchen / cabinet relevant labels.
  const draftText = await page.getByTestId('start-with-ai-template-draft-dock').textContent();
  expect((draftText ?? '').toLowerCase()).toMatch(/kitchen|cabinet/);

  // "Open Template Marketplace" must NOT appear — that is the apply_template response.
  await expect(page.getByText('Open Template Marketplace')).not.toBeVisible();

  // No existing template should have been selected.
  await expect(page.getByTestId('start-with-ai-template-draft-dock')).not.toContainText('selected_template_id');

  // The orchestrator must not have been called.
  expect(orchestratorCalled).toBe(false);
});

test('templates copilot: "build a kitchen remodel template" also bypasses the orchestrator', async ({
  page,
}) => {
  await installBaseAuthMocks(page);
  await installTemplatesPageRoutes(page);

  let orchestratorCalled = false;
  await page.route('**/api/projects/assistant/orchestrate/', async (route) => {
    orchestratorCalled = true;
    await route.abort();
  });

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('assistant-dock-open-button').first().click();
  await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();

  await page.getByTestId('start-with-ai-input-dock').fill('build a kitchen remodel template');
  await page.getByTestId('start-with-ai-submit-dock').click();

  await expect(page.getByTestId('start-with-ai-template-draft-dock')).toBeVisible();
  expect(orchestratorCalled).toBe(false);
});

test('templates copilot: "use existing template" resolves to apply_template intent without showing a workflow draft', async ({
  page,
}) => {
  await installBaseAuthMocks(page);
  await installTemplatesPageRoutes(page);

  // On the templates page the local planner handles this — the orchestrator must still NOT be called.
  let orchestratorCalled = false;
  await page.route('**/api/projects/assistant/orchestrate/', async (route) => {
    orchestratorCalled = true;
    await route.abort();
  });

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('assistant-dock-open-button').first().click();
  await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();

  await page.getByTestId('start-with-ai-input-dock').fill('use my existing kitchen remodel template');
  await page.getByTestId('start-with-ai-submit-dock').click();

  // The apply path (apply_template intent) should NOT produce a review-only workflow draft block.
  await expect(page.getByTestId('start-with-ai-template-draft-dock')).not.toBeVisible();

  // The orchestrator must still not have been called — the local planner handles apply prompts too.
  expect(orchestratorCalled).toBe(false);
});

test('templates copilot: "Use this draft" applies the AI draft into the template editor', async ({
  page,
}) => {
  await installBaseAuthMocks(page);
  await installTemplatesPageRoutes(page);

  await page.route('**/api/projects/assistant/orchestrate/', async (route) => {
    await route.abort();
  });

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  // Open the dock and produce a template draft.
  await page.getByTestId('assistant-dock-open-button').first().click();
  await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();

  await page.getByTestId('start-with-ai-input-dock').fill('create template for kitchen cabinet installation');
  await page.getByTestId('start-with-ai-submit-dock').click();

  const draftBlock = page.getByTestId('start-with-ai-template-draft-dock');
  await expect(draftBlock).toBeVisible();

  // The "Use this draft" button must be enabled (not disabled).
  const useDraftBtn = page.getByTestId('start-with-ai-template-draft-dock-use-draft');
  await expect(useDraftBtn).toBeEnabled();

  // Click it — the template editor should open with the AI draft populated.
  await useDraftBtn.click();

  // The draft editor panel should appear.
  await expect(page.getByTestId('templates-draft-editor')).toBeVisible();

  // The AI draft applied banner must be shown.
  await expect(page.getByTestId('templates-assistant-prefill-banner')).toBeVisible();
  await expect(page.getByTestId('templates-assistant-prefill-banner')).toContainText('AI draft applied');

  // The template name must be pre-filled and NOT contain the legacy "Workflow Template" suffix.
  const nameInput = page.getByTestId('templates-name-input');
  await expect(nameInput).toBeVisible();
  const nameValue = await nameInput.inputValue();
  expect(nameValue.trim().length).toBeGreaterThan(0);
  expect(nameValue).not.toMatch(/workflow\s+template/i);

  // Milestone tab: descriptions must be populated.
  await page.getByTestId('templates-tab-milestones').click();
  const milestoneDesc = page.getByTestId('templates-milestone-description-1');
  await expect(milestoneDesc).toBeVisible();
  const descValue = await milestoneDesc.inputValue();
  expect(descValue.trim().length).toBeGreaterThan(0);
});

test('templates copilot: applied AI draft populates pricing guidance and timing tabs', async ({
  page,
}) => {
  await installBaseAuthMocks(page);
  await installTemplatesPageRoutes(page);

  await page.route('**/api/projects/assistant/orchestrate/', async (route) => {
    await route.abort();
  });

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('assistant-dock-open-button').first().click();
  await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();

  await page.getByTestId('start-with-ai-input-dock').fill('create template for bathroom remodel');
  await page.getByTestId('start-with-ai-submit-dock').click();

  await expect(page.getByTestId('start-with-ai-template-draft-dock')).toBeVisible();
  await page.getByTestId('start-with-ai-template-draft-dock-use-draft').click();
  await expect(page.getByTestId('templates-draft-editor')).toBeVisible();

  // Close the dock so it doesn't overlap the tab buttons.
  await page.getByTestId('assistant-desktop-dock-close').click();

  // Pricing tab: "AI Pricing Guidance" section must appear because generatedAiDraft.pricing is set.
  await page.getByTestId('templates-tab-pricing').click();
  await expect(page.getByTestId('templates-generated-pricing-guidance')).toBeVisible();

  // Schedule tab: first milestone must have a numeric start offset (0) and duration >= 1.
  await page.getByTestId('templates-tab-schedule').click();
  const startOffset1 = page.getByTestId('templates-milestone-start-offset-1');
  await expect(startOffset1).toBeVisible();
  const offsetVal = await startOffset1.inputValue();
  expect(Number(offsetVal)).toBeGreaterThanOrEqual(0);

  const duration1 = page.getByTestId('templates-milestone-duration-1');
  await expect(duration1).toBeVisible();
  const durVal = await duration1.inputValue();
  expect(Number(durVal)).toBeGreaterThanOrEqual(1);
});

test('templates copilot: applied AI draft populates project-level materials immediately', async ({
  page,
}) => {
  await installBaseAuthMocks(page);
  await installTemplatesPageRoutes(page);

  await page.route('**/api/projects/assistant/orchestrate/', async (route) => {
    await route.abort();
  });

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('assistant-dock-open-button').first().click();
  await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();

  await page.getByTestId('start-with-ai-input-dock').fill('create template for deck construction');
  await page.getByTestId('start-with-ai-submit-dock').click();

  await expect(page.getByTestId('start-with-ai-template-draft-dock')).toBeVisible();
  await page.getByTestId('start-with-ai-template-draft-dock-use-draft').click();
  await expect(page.getByTestId('templates-draft-editor')).toBeVisible();

  // Close the dock so it doesn't overlap the tab buttons.
  await page.getByTestId('assistant-desktop-dock-close').click();

  // Materials tab: AI materials guidance section must appear (from draft.materials).
  await page.getByTestId('templates-tab-materials').click();
  await expect(page.getByTestId('templates-generated-materials-guidance')).toBeVisible();

  // Project-level materials textarea must be pre-filled without needing "Refresh Materials from AI".
  const projectMaterialsHint = page.getByTestId('templates-project-materials-hint');
  await expect(projectMaterialsHint).toBeVisible();
  const materialsValue = await projectMaterialsHint.inputValue();
  expect(materialsValue.trim().length).toBeGreaterThan(0);
});

test('templates copilot state resets when navigating to agreements and restores on return', async ({
  page,
}) => {
  await installBaseAuthMocks(page);
  await installTemplatesPageRoutes(page);
  await installAgreementListRoutes(page);

  await page.route('**/api/projects/assistant/orchestrate/', async (route) => {
    await route.abort();
  });

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('assistant-dock-open-button').first().click();
  await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();
  await expect(page.getByTestId('start-with-ai-title-dock')).toContainText(
    'Review this template workflow'
  );

  await page.getByTestId('start-with-ai-input-dock').fill('create template for kitchen cabinet installation');
  await page.getByTestId('start-with-ai-submit-dock').click();
  await expect(page.getByTestId('start-with-ai-template-draft-dock')).toBeVisible();
  await page.getByTestId('start-with-ai-template-draft-dock-use-draft').click();
  await expect(page.getByTestId('templates-assistant-prefill-banner')).toContainText('AI draft applied');

  await page.getByRole('link', { name: /^Agreements$/ }).first().click();
  await page.waitForURL('**/app/agreements');
  await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();
  await expect(page.getByTestId('assistant-desktop-dock')).toContainText(
    'Project Assistant for Agreements'
  );
  await expect(page.getByTestId('start-with-ai-title-dock')).toContainText('Review this agreement');
  await expect(page.getByTestId('assistant-desktop-dock')).toContainText(
    'Agreement workspace context loaded'
  );
  await expect(page.getByTestId('assistant-desktop-dock')).not.toContainText(
    'Review this template workflow'
  );
  await expect(page.getByTestId('assistant-desktop-dock')).not.toContainText(
    'Template workspace context loaded'
  );
  await expect(page.getByTestId('start-with-ai-template-draft-dock')).not.toBeVisible();
  await expect(page.getByText('Workflow Draft')).not.toBeVisible();
  await expect(page.getByText('Use this draft')).not.toBeVisible();

  await page.getByRole('link', { name: /^Templates$/ }).first().click();
  await page.waitForURL('**/app/templates');
  await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();
  await expect(page.getByTestId('assistant-desktop-dock')).toContainText(
    'Project Assistant for Templates'
  );
  await expect(page.getByTestId('start-with-ai-title-dock')).toContainText(
    'Review this template workflow'
  );
});
