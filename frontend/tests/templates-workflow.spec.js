import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 123;

function buildTemplate({
  id,
  name,
  owner_type = 'contractor',
  is_system = false,
  visibility = 'private',
  project_type = 'Remodel',
  project_subtype = 'Kitchen Remodel',
  description = '',
  milestones = [],
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
    description: description || `${name} description`,
    default_scope: description || `${name} description`,
    estimated_days: 14,
    milestone_count: milestones.length,
    usage_count: 1,
    completed_project_count: 0,
    benchmark_support_label: is_system ? 'seeded' : 'seeded_and_learned',
    region_match_scope: 'global',
    normalized_region_key: '',
    milestones,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildMilestone(id, title, description, sort_order = 1) {
  return {
    id,
    title,
    description,
    sort_order,
    normalized_milestone_type: '',
    suggested_amount_fixed: null,
    suggested_amount_low: null,
    suggested_amount_high: null,
    pricing_confidence: '',
    pricing_source_note: '',
    recommended_days_from_start: sort_order === 1 ? 0 : null,
    recommended_duration_days: null,
    materials_hint: '',
    is_optional: false,
  };
}

function buildTemplateStore() {
  const kitchenMilestones = [
    buildMilestone(881, 'Demo & protection', 'Protect the home and remove existing finishes.', 1),
    buildMilestone(882, 'Cabinets & surfaces', 'Install cabinets, counters, and related surfaces.', 2),
    buildMilestone(883, 'Fixtures & closeout', 'Complete fixtures, trim, and final walkthrough.', 3),
  ];

  const templates = [
    buildTemplate({
      id: 88,
      name: 'Kitchen Remodel Starter',
      project_type: 'Remodel',
      project_subtype: 'Kitchen Remodel',
      description: 'Reusable kitchen remodel template with planning, install, and closeout phases.',
      milestones: kitchenMilestones,
    }),
    buildTemplate({
      id: 99,
      name: 'Bathroom Remodel Pro',
      project_type: 'Remodel',
      project_subtype: 'Bathroom Remodel',
      description: 'Bathroom remodel template with demo, waterproofing, and finish phases.',
      milestones: [
        buildMilestone(991, 'Demo & prep', 'Protect nearby finishes and remove existing bathroom fixtures.', 1),
        buildMilestone(992, 'Waterproof & tile', 'Prep wet areas and complete tile installation.', 2),
        buildMilestone(993, 'Fixtures & walkthrough', 'Install fixtures, finish trim, and review the work.', 3),
      ],
    }),
  ];

  return {
    nextTemplateId: 150,
    nextMilestoneId: 2000,
    templates,
  };
}

function listTemplatesForSource(store, source) {
  const rows = Array.isArray(store.templates) ? store.templates : [];
  if (source === 'system') return rows.filter((item) => item.is_system || item.owner_type === 'system');
  if (source === 'regional') return rows.filter((item) => item.visibility === 'regional');
  if (source === 'public') return rows.filter((item) => item.visibility === 'public');
  return rows.filter((item) => !item.is_system && item.owner_type !== 'system');
}

async function installCommonRoutes(page) {
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

  await page.route('**/api/projects/homeowners**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 1, company_name: 'Demo Customer', full_name: 'Jordan Demo' }],
      }),
    });
  });

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 1, value: 'Remodel', label: 'Remodel', owner_type: 'system' },
          { id: 2, value: 'Cabinetry', label: 'Cabinetry', owner_type: 'system' },
        ],
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
            project_type: 'Remodel',
          },
          {
            id: 12,
            value: 'Bathroom Remodel',
            label: 'Bathroom Remodel',
            owner_type: 'system',
            project_type: 'Remodel',
          },
          {
            id: 13,
            value: 'Cabinet Installation',
            label: 'Cabinet Installation',
            owner_type: 'system',
            project_type: 'Cabinetry',
          },
        ],
      }),
    });
  });
}

async function installTemplateRoutes(page, store) {
  await page.route('**/api/projects/templates/discover/**', async (route) => {
    const url = new URL(route.request().url());
    const source = url.searchParams.get('source') || 'mine';
    const query = (url.searchParams.get('q') || '').toLowerCase();
    const rows = listTemplatesForSource(store, source)
      .filter((row) =>
        !query
          ? true
          : `${row.name} ${row.project_type} ${row.project_subtype} ${row.description}`
              .toLowerCase()
              .includes(query)
      )
      .map((row) => ({
        ...clone(row),
        milestone_count: Array.isArray(row.milestones) ? row.milestones.length : 0,
      }));

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: rows, meta: { source, count: rows.length } }),
    });
  });

  await page.route('**/api/projects/templates/recommend/', async (route) => {
    const payload = route.request().postDataJSON();
    const subtype = String(payload?.project_subtype || '').toLowerCase();
    const description = String(payload?.description || '').toLowerCase();
    const match = store.templates.find((row) => {
      const rowSubtype = String(row.project_subtype || '').toLowerCase();
      return rowSubtype && (rowSubtype === subtype || description.includes(rowSubtype));
    });

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        match
          ? {
              confidence: 'strong',
              recommended_template: clone(match),
              candidates: [clone(match)],
              reason: `${match.name} matches the resolved project subtype and scope.`,
              detail: 'Strong template recommendation found.',
            }
          : {
              confidence: 'none',
              recommended_template: null,
              candidates: [],
              reason: 'No strong template match.',
              detail: 'No strong template recommendation.',
            }
      ),
    });
  });

  await page.route(/\/api\/projects\/templates\/?(\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: store.templates.map((row) => clone(row)) }),
      });
      return;
    }

    if (request.method() === 'POST') {
      const payload = request.postDataJSON();
      const created = buildTemplate({
        id: store.nextTemplateId++,
        name: payload.name,
        project_type: payload.project_type,
        project_subtype: payload.project_subtype,
        description: payload.description,
        milestones: (Array.isArray(payload.milestones) ? payload.milestones : []).map((row, idx) => ({
          ...row,
          id: store.nextMilestoneId++,
          sort_order: Number(row.sort_order || idx + 1) || idx + 1,
        })),
      });
      created.default_scope = payload.default_scope || payload.description || '';
      created.default_clarifications = Array.isArray(payload.default_clarifications)
        ? payload.default_clarifications
        : [];
      created.project_materials_hint = payload.project_materials_hint || '';
      created.estimated_days = Number(payload.estimated_days || 1) || 1;
      created.milestone_count = created.milestones.length;
      store.templates = [created, ...store.templates];

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(clone(created)),
      });
      return;
    }

    await route.fallback();
  });

  await page.route(/\/api\/projects\/templates\/\d+\/?$/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const id = Number(url.pathname.split('/').filter(Boolean).pop());
    const index = store.templates.findIndex((row) => row.id === id);

    if (request.method() === 'GET') {
      const row = index >= 0 ? clone(store.templates[index]) : null;
      await route.fulfill({
        status: row ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(row || { detail: 'Not found.' }),
      });
      return;
    }

    if (request.method() === 'PATCH' && index >= 0) {
      const payload = request.postDataJSON();
      const existing = store.templates[index];
      const updated = {
        ...existing,
        ...payload,
        milestones: (Array.isArray(payload.milestones) ? payload.milestones : existing.milestones).map((row, idx) => ({
          ...row,
          id: row.id || store.nextMilestoneId++,
          sort_order: Number(row.sort_order || idx + 1) || idx + 1,
        })),
      };
      updated.milestone_count = updated.milestones.length;
      store.templates[index] = updated;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(clone(updated)),
      });
      return;
    }

    if (request.method() === 'DELETE' && index >= 0) {
      store.templates = store.templates.filter((row) => row.id !== id);
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    await route.fallback();
  });
}

async function installWizardRoutes(page, store, agreement, milestoneState) {
  await page.route(
    new RegExp(`/api/projects/agreements/${agreement.id}/?(\\?.*)?$`),
    async (route) => {
      const request = route.request();
      if (request.method() === 'GET' || request.method() === 'PATCH') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(clone(agreement)),
        });
        return;
      }

      await route.fallback();
    }
  );

  await page.route(
    new RegExp(`/api/projects/agreements/${agreement.id}/apply-template/$`),
    async (route) => {
      const payload = route.request().postDataJSON();
      const template = store.templates.find((row) => row.id === payload?.template_id);
      if (!template) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Template not found.' }),
        });
        return;
      }

      agreement.project_title = template.name;
      agreement.title = template.name;
      agreement.project_type = template.project_type;
      agreement.project_subtype = template.project_subtype;
      agreement.description = template.description;
      agreement.selected_template_id = template.id;
      agreement.selected_template = {
        id: template.id,
        name: template.name,
        project_type: template.project_type,
        project_subtype: template.project_subtype,
      };
      agreement.selected_template_name_snapshot = template.name;
      agreement.project_template_id = template.id;
      agreement.template_id = template.id;

      milestoneState.items = template.milestones.map((row, idx) => ({
        id: row.id,
        agreement: agreement.id,
        order: idx + 1,
        title: row.title,
        description: row.description,
        amount: row.suggested_amount_fixed || '0.00',
      }));

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: `Template applied: ${template.name}`,
          agreement: clone(agreement),
          template: clone(template),
          result: {
            milestones_created: milestoneState.items.length,
          },
        }),
      });
    }
  );

  await page.route(/\/api\/projects\/milestones\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: clone(milestoneState.items) }),
    });
  });

  await page.route('**/api/projects/agreements/ai/description/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project_title: 'Kitchen Remodel',
        project_type: 'Remodel',
        project_subtype: 'Kitchen Remodel',
        description:
          'Full kitchen remodel with demo, cabinets, countertops, appliance reconnects, plumbing, electrical, and finish work.',
        ai_access: 'included',
        ai_enabled: true,
        ai_unlimited: true,
      }),
    });
  });
}

async function installWorkflowMocks(page, { agreement } = {}) {
  const store = buildTemplateStore();
  const milestoneState = { items: [] };
  const draftAgreement = agreement || {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: '',
    title: '',
    project_type: '',
    project_subtype: '',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description: '',
    homeowner: null,
    status: 'draft',
    compliance_warning: { warning_level: 'none', message: '' },
    selected_template_id: null,
    selected_template: null,
    selected_template_name_snapshot: '',
  };

  await installCommonRoutes(page);
  await installTemplateRoutes(page, store);
  await installWizardRoutes(page, store, draftAgreement, milestoneState);

  return { store, agreement: draftAgreement, milestoneState };
}

test('templates route and sidebar access support creating and editing reusable templates with milestone persistence', async ({
  page,
}) => {
  const { store } = await installWorkflowMocks(page);

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('link', { name: 'Templates' })).toHaveAttribute('href', '/app/templates');
  await expect(page.getByRole('heading', { name: 'Templates' })).toBeVisible();

  await page.getByTestId('templates-new-draft-button').click();
  await page.getByTestId('templates-name-input').fill('Cabinet Install Standard');
  await page.getByTestId('templates-project-type-input').fill('Cabinetry');
  await page.getByTestId('templates-project-subtype-input').fill('Cabinet Installation');
  await page.getByTestId('templates-description-input').fill(
    'Reusable cabinet installation template with staging, install, and closeout phases.'
  );
  await page.getByTestId('templates-tab-milestones').click();
  await page.getByTestId('templates-milestone-title-1').fill('Measurements & staging');
  await page.getByTestId('templates-milestone-description-1').fill(
    'Confirm layout, verify deliveries, and prepare the work area.'
  );
  await page.getByTestId('templates-add-milestone-button').click();
  await page.getByTestId('templates-milestone-title-2').fill('Cabinet installation');
  await page.getByTestId('templates-milestone-description-2').fill(
    'Install and secure new cabinets, then complete final adjustments.'
  );
  await page.getByTestId('templates-save-button').click();

  await expect(page.getByText('Template created.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cabinet Install Standard' })).toBeVisible();
  await expect.poll(() => store.templates.some((row) => row.name === 'Cabinet Install Standard')).toBe(true);

  await page.getByTestId('templates-tab-milestones').click();
  await expect(page.getByText('Measurements & staging')).toBeVisible();
  await expect(page.getByText('2. Cabinet installation')).toBeVisible();

  await page.getByTestId('templates-edit-button').click();
  await page.getByTestId('templates-name-input').fill('Cabinet Install Standard v2');
  await page.getByTestId('templates-tab-milestones').click();
  await page.getByTestId('templates-milestone-title-2').fill('Install, align & close out');
  await page.getByTestId('templates-save-button').click();

  await expect(page.getByText('Template updated.')).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Cabinet Install Standard v2' })).toBeVisible();
  await page.getByTestId('templates-tab-milestones').click();
  await expect(page.getByText('2. Install, align & close out')).toBeVisible();
});

test('saved templates can be applied in the wizard without conflicting with template, AI, or scratch flows', async ({
  page,
}) => {
  await installWorkflowMocks(page);

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await page.getByRole('button', { name: 'Use Template' }).click();
  await expect(page.getByTestId('step1-template-browser')).toBeVisible();
  await page
    .getByPlaceholder('Search templates by keyword, like "bathroom", "deck", or "bedroom addition"...')
    .fill('Kitchen Remodel Starter');
  await page.getByRole('button', { name: /Kitchen Remodel Starter/ }).click();
  await page.getByRole('button', { name: 'Apply Selected Template' }).click();

  await expect(page.getByText('Applied to Agreement')).toBeVisible();
  await expect(page.locator('select[name="project_subtype"]')).toHaveValue('Kitchen Remodel');

  await page.getByText('Change start mode').click();
  await page.getByRole('button', { name: 'Start from scratch' }).click();
  await expect(page.getByTestId('step1-template-browser')).toHaveCount(0);
  await expect(page.getByTestId('step1-template-applied-summary')).toContainText(
    'Kitchen Remodel Starter'
  );

  await page.getByText('Change start mode').click();
  await page.getByRole('button', { name: 'Use AI' }).click();
  await expect(page.getByTestId('step1-template-browser')).toHaveCount(0);
  await expect(page.getByTestId('step1-template-applied-summary')).toContainText(
    'Kitchen Remodel Starter'
  );

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByText('Demo & protection')).toBeVisible();
  await expect(page.getByText('Cabinets & surfaces')).toBeVisible();
  await expect(page.getByText('Fixtures & closeout')).toBeVisible();
});

test('AI can recommend and apply a matching template in step 1 while keeping the flow coherent', async ({
  page,
}) => {
  await installWorkflowMocks(page);

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await page.getByRole('button', { name: 'Use AI' }).click();
  await page
    .getByTestId('start-with-ai-input-dock')
    .fill(
      'Full kitchen remodel with demolition, cabinet replacement, countertops, appliance reconnects, plumbing, electrical, and finish work.'
    );
  await page.getByTestId('start-with-ai-submit-dock').click();

  await expect(page.getByTestId('step1-ai-setup-result')).toContainText(
    'Kitchen Remodel Starter'
  );
  await page.getByTestId('step1-ai-setup-apply-template').click();

  await expect(page.getByTestId('step1-template-browser')).toHaveCount(0);
  await expect(page.getByTestId('step1-template-applied-summary')).toContainText(
    'Kitchen Remodel Starter'
  );
  await expect(page.locator('select[name="project_subtype"]')).toHaveValue('Kitchen Remodel');

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByText('Demo & protection')).toBeVisible();
  await expect(page.getByText('Cabinets & surfaces')).toBeVisible();
});
