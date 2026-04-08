import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 123;

function installRouteState(page, matcher, userState) {
  return page.addInitScript(
    ({ pathname, search, state }) => {
      if (window.location.pathname !== pathname) return;
      if (typeof search === 'string' && search !== window.location.search) return;
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

test('agreement wizard step 1 renders and draft creation route is reachable', async ({
  page,
}) => {
  let agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Draft Agreement',
    title: 'Draft Agreement',
    project_type: '',
    project_subtype: '',
    payment_mode: 'escrow',
    description:
      'Draft agreement. Details will be completed after template selection or manual entry.',
    homeowner: null,
    status: 'draft',
    compliance_warning: {
      warning_level: 'warning',
      message: 'Electrical work in Texas typically requires a license. Upload a license document if it is missing.',
      official_lookup_url: 'https://www.tdlr.texas.gov/electricians/',
    },
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
        onboarding_status: 'not_started',
        connected: false,
      }),
    });
  });

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
      body: JSON.stringify({ results: [] }),
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

  await page.route('**/api/projects/contractors/me/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        ai: {
          access: 'included',
          enabled: true,
          unlimited: true,
        },
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

  await page.route(/\/api\/projects\/agreements\/?(\?.*)?$/, async (route) => {
    const request = route.request();

    if (request.method() !== 'POST') {
      await route.fallback();
      return;
    }

    const payload = request.postDataJSON();
    agreement = {
      ...agreement,
      ...payload,
      id: AGREEMENT_ID,
      agreement_id: AGREEMENT_ID,
      status: 'draft',
    };

    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(agreement),
    });
  });

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`),
    async (route) => {
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
        const payload = request.postDataJSON();
        agreement = { ...agreement, ...payload };

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(agreement),
        });
        return;
      }

      await route.fallback();
    }
  );

  await page.goto('/app/agreements/new/wizard?step=1', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('agreement-wizard-heading')).toBeVisible();
  await expect(page.getByTestId('agreement-wizard-hint')).toContainText(
    'Confirm the customer, address, and project details'
  );
  await expect(page.getByTestId('agreement-customer-select')).toBeVisible();
  await expect(page.getByTestId('agreement-project-title-input')).toBeVisible();
  await expect(page.getByTestId('agreement-save-draft-button')).toBeVisible();

  await page.getByTestId('agreement-project-title-input').fill(
    'Playwright Agreement Smoke'
  );
  await page.getByTestId('agreement-save-draft-button').click();

  await expect(page).toHaveURL(
    new RegExp(`/app/agreements/${AGREEMENT_ID}/wizard\\?step=1$`)
  );
  await expect(page.getByTestId('agreement-compliance-warning')).toContainText(
    'typically requires a license'
  );
  await expect(page.getByTestId('agreement-wizard-subtitle')).toContainText(
    `Agreement #${AGREEMENT_ID}`
  );
});

test('agreement wizard step 1 switches into guided ai mode instead of leaving all start modes active', async ({
  page,
}) => {
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
        onboarding_status: 'not_started',
        connected: false,
      }),
    });
  });

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
      body: JSON.stringify({ results: [] }),
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

  await page.route('**/api/projects/contractors/me/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        ai: {
          access: 'included',
          enabled: true,
          unlimited: true,
        },
      }),
    });
  });

  await page.route('**/api/projects/templates/**', async (route) => {
    if (route.request().url().includes('/templates/recommend/')) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.goto('/app/agreements/new/wizard?step=1', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step1-start-mode-chooser')).toBeVisible();
  await expect(page.getByTestId('agreement-wizard-ask-ai-button')).toBeVisible();
  await page.getByRole('button', { name: 'Use AI' }).click();

  await expect(page.getByTestId('step1-start-mode-summary')).toContainText('AI-assisted');
  await expect(page.getByTestId('step1-start-mode-chooser')).toBeHidden();
  await expect(page.getByTestId('step1-template-browser')).toHaveCount(0);
  await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();
  await expect(page.getByTestId('start-with-ai-submit-dock')).toBeVisible();
  await expect(page.getByTestId('start-with-ai-coaching-dock')).toBeVisible();
  await expect(page.getByTestId('start-with-ai-coaching-next-step-dock')).toContainText(
    'Complete the project details first'
  );
  await expect(page.getByTestId('start-with-ai-input-dock')).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('agreement-project-title-input')).toBeVisible();

  await page.getByTestId('assistant-desktop-dock-close').click();
  await page.getByTestId('step1-change-start-mode').click();
  await expect(page.getByTestId('step1-start-mode-chooser')).toBeVisible();
});

test('agreement wizard step 1 respects explicit mode switching when a template is already applied', async ({
  page,
}) => {
  const agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Template Draft',
    title: 'Template Draft',
    project_type: 'Roofing',
    project_subtype: 'Roof Replacement',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description: 'Template-backed draft agreement.',
    homeowner: null,
    status: 'draft',
    selected_template_id: 88,
    selected_template: {
      id: 88,
      name: 'Roof Replacement Template',
      project_type: 'Roofing',
      project_subtype: 'Roof Replacement',
    },
    selected_template_name_snapshot: 'Roof Replacement Template',
    compliance_warning: {
      warning_level: 'none',
      message: '',
    },
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
        onboarding_status: 'not_started',
        connected: false,
      }),
    });
  });

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 1, value: 'Roofing', label: 'Roofing', owner_type: 'system' }],
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
            value: 'Roof Replacement',
            label: 'Roof Replacement',
            owner_type: 'system',
            project_type: 'Roofing',
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

  await page.route('**/api/projects/contractors/me/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        ai: {
          access: 'included',
          enabled: true,
          unlimited: true,
        },
      }),
    });
  });

  await page.route('**/api/projects/templates/**', async (route) => {
    if (route.request().url().includes('/templates/recommend/')) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 88,
            name: 'Roof Replacement Template',
            project_type: 'Roofing',
            project_subtype: 'Roof Replacement',
            owner_type: 'system',
            milestone_count: 4,
          },
        ],
      }),
    });
  });

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`),
    async (route) => {
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
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(agreement),
        });
        return;
      }

      await route.fallback();
    }
  );

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step1-start-mode-summary')).toContainText('Template-based');
  await expect(page.getByTestId('step1-template-browser')).toBeVisible();

  await page.getByTestId('step1-change-start-mode').click();
  await expect(page.getByTestId('step1-start-mode-chooser')).toBeVisible();
  await page.getByRole('button', { name: 'Start from scratch' }).click();
  await expect(page.getByTestId('step1-start-mode-summary')).toContainText('Start from scratch');
  await expect(page.getByTestId('step1-template-browser')).toHaveCount(0);
  await expect(page.getByTestId('step1-template-applied-summary')).toBeVisible();
  await page.waitForTimeout(150);
  await expect(page.getByTestId('step1-start-mode-summary')).toContainText('Start from scratch');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('step1-start-mode-summary')).toContainText('Start from scratch');

  await page.getByTestId('agreement-wizard-ask-ai-button').click();
  await expect(page.getByTestId('assistant-desktop-dock')).toBeVisible();
  await expect(page.getByTestId('step1-start-mode-summary')).toContainText('Start from scratch');
  await page.getByTestId('assistant-desktop-dock-close').click();

  await page.getByTestId('step1-change-start-mode').click();
  await expect(page.getByTestId('step1-start-mode-chooser')).toBeVisible();
  await page.getByRole('button', { name: 'Use AI' }).click();
  await expect(page.getByTestId('step1-start-mode-summary')).toContainText('AI-assisted');
  await expect(page.getByTestId('step1-template-browser')).toHaveCount(0);
  await expect(page.getByTestId('step1-template-applied-summary')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await page.waitForTimeout(150);
  await expect(page.getByTestId('step1-start-mode-summary')).toContainText('AI-assisted');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('step1-start-mode-summary')).toContainText('AI-assisted');
});

test('agreement wizard step 1 reset form clears draft setup and reopens the chooser', async ({
  page,
}) => {
  let agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Template Draft',
    title: 'Template Draft',
    project_type: 'Roofing',
    project_subtype: 'Roof Replacement',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description: 'Template-backed draft agreement.',
    homeowner: null,
    status: 'draft',
    selected_template_id: 88,
    selected_template: {
      id: 88,
      name: 'Roof Replacement Template',
      project_type: 'Roofing',
      project_subtype: 'Roof Replacement',
    },
    selected_template_name_snapshot: 'Roof Replacement Template',
    compliance_warning: {
      warning_level: 'none',
      message: '',
    },
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
        onboarding_status: 'not_started',
        connected: false,
      }),
    });
  });

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 1, value: 'Roofing', label: 'Roofing', owner_type: 'system' }],
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
            value: 'Roof Replacement',
            label: 'Roof Replacement',
            owner_type: 'system',
            project_type: 'Roofing',
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

  await page.route('**/api/projects/contractors/me/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        ai: {
          access: 'included',
          enabled: true,
          unlimited: true,
        },
      }),
    });
  });

  await page.route('**/api/projects/templates/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 88,
            name: 'Roof Replacement Template',
            project_type: 'Roofing',
            project_subtype: 'Roof Replacement',
            owner_type: 'system',
            milestone_count: 4,
          },
        ],
      }),
    });
  });

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/reset-step1/?$`),
    async (route) => {
      agreement = {
        ...agreement,
        project_title: '',
        title: '',
        project_type: '',
        project_subtype: '',
        description: '',
        homeowner: null,
        selected_template_id: null,
        selected_template: null,
        selected_template_name_snapshot: '',
        payment_structure: 'simple',
        retainage_percent: '0.00',
        agreement_mode: 'standard',
        address_line1: '',
        address_line2: '',
        address_city: '',
        address_state: '',
        address_postal_code: '',
      };

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: 'Agreement setup reset.',
          agreement,
        }),
      });
    }
  );

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`),
    async (route) => {
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
    }
  );

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step1-start-mode-summary')).toContainText('Template-based');
  await expect(page.getByTestId('step1-reset-form-button')).toBeVisible();

  await page.getByTestId('step1-reset-form-button').click();
  await expect(page.getByTestId('step1-reset-form-confirm')).toBeVisible();
  await page.getByTestId('step1-reset-form-confirm-button').click();

  await expect(page.getByTestId('step1-start-mode-chooser')).toBeVisible();
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue('');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('step1-start-mode-chooser')).toBeVisible();
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue('');
});

test('agreement wizard step 1 refines a rough description and recommends a template without leaving ai mode', async ({
  page,
}) => {
  let agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: '',
    title: '',
    project_type: '',
    project_subtype: '',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description: 'Replace shingles and repair flashing around roof penetrations.',
    homeowner: null,
    status: 'draft',
    selected_template_id: null,
    selected_template: null,
    selected_template_name_snapshot: '',
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
        onboarding_status: 'not_started',
        connected: false,
      }),
    });
  });

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 1, value: 'Roofing', label: 'Roofing', owner_type: 'system' }],
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
            value: 'Roof Replacement',
            label: 'Roof Replacement',
            owner_type: 'system',
            project_type: 'Roofing',
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

  await page.route('**/api/projects/contractors/me/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        ai: { access: 'included', enabled: true, unlimited: true },
      }),
    });
  });

  await page.route('**/api/projects/templates/recommend/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        confidence: 'recommended',
        recommended_template: {
          id: 88,
          name: 'Roof Replacement Template',
          project_type: 'Roofing',
          project_subtype: 'Roof Replacement',
          milestone_count: 4,
        },
        score: 97,
        reason: 'Exact type and subtype match.',
        candidates: [
          {
            id: 88,
            name: 'Roof Replacement Template',
            project_type: 'Roofing',
            project_subtype: 'Roof Replacement',
            milestone_count: 4,
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/agreements/ai/description/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project_title: 'Roof Replacement',
        project_type: 'Roofing',
        project_subtype: 'Roof Replacement',
        description:
          'Remove existing shingles, repair flashing around penetrations, install the new roofing system, and complete site cleanup.',
        ai_access: 'included',
        ai_enabled: true,
        ai_unlimited: true,
      }),
    });
  });

  await page.route('**/api/projects/templates/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 88,
            name: 'Roof Replacement Template',
            project_type: 'Roofing',
            project_subtype: 'Roof Replacement',
            milestone_count: 4,
            description: 'Standard roofing replacement workflow.',
            owner_type: 'system',
          },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/templates\/88\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 88,
        name: 'Roof Replacement Template',
        project_type: 'Roofing',
        project_subtype: 'Roof Replacement',
        milestone_count: 4,
        estimated_days: 5,
        description: 'Standard roofing replacement workflow.',
        milestones: [
          { id: 1, title: 'Materials', description: 'Order and deliver materials.' },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/123\/apply-template\/$/, async (route) => {
    agreement = {
      ...agreement,
      selected_template_id: 88,
      selected_template: {
        id: 88,
        name: 'Roof Replacement Template',
        project_type: 'Roofing',
        project_subtype: 'Roof Replacement',
      },
      selected_template_name_snapshot: 'Roof Replacement Template',
    };

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        agreement,
      }),
    });
  });

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`),
    async (route) => {
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
    }
  );

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await page.getByRole('button', { name: 'Use AI' }).click();
  await expect(page.getByTestId('step1-start-mode-summary')).toContainText('AI-assisted');
  await expect(page.getByTestId('step1-template-browser')).toHaveCount(0);
  await expect(page.getByTestId('start-with-ai-input-dock')).toBeFocused();
  await page
    .getByTestId('start-with-ai-input-dock')
    .fill('Roof replacement with flashing repair and cleanup');
  await page.getByTestId('start-with-ai-submit-dock').click();
  await expect(page.getByTestId('step1-ai-setup-result')).toBeVisible();
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue(
    'Roof Replacement'
  );
  await expect(page.locator('select[name="project_type"]')).toHaveValue('Roofing');
  await expect(page.locator('select[name="project_subtype"]')).toHaveValue(
    'Roof Replacement'
  );
  await expect(page.getByTestId('agreement-project-title-ai-indicator')).toContainText(
    'AI suggested'
  );
  await expect(page.getByTestId('agreement-project-type-ai-indicator')).toContainText(
    'AI suggested'
  );
  await expect(page.getByTestId('agreement-project-subtype-ai-indicator')).toContainText(
    'AI suggested'
  );
  await expect(page.getByTestId('start-with-ai-title-dock')).toContainText(
    'Description refined. AI completed initial setup.'
  );
  await expect(page.getByTestId('start-with-ai-coaching-next-step-dock')).toContainText(
    'Review Project Title, Project Type, Project Subtype'
  );
  await expect(page.getByTestId('step1-ai-setup-result')).toContainText(
    'Remove existing shingles, repair flashing around penetrations'
  );
  await expect(page.getByTestId('step1-ai-setup-result')).toContainText(
    'Roof Replacement Template'
  );
  await expect(page.getByTestId('step1-ai-setup-result')).toContainText(
    'Matches the project type and subtype you selected.'
  );
  await page.getByTestId('step1-ai-setup-apply-template').click();
  await expect(page.getByTestId('step1-start-mode-summary')).toContainText('AI-assisted');
  await expect(page.getByTestId('step1-template-browser')).toHaveCount(0);
  await expect(page.getByTestId('step1-template-applied-summary')).toContainText(
    'Roof Replacement Template'
  );
});

test('agreement wizard step 1 reuses canonical taxonomy before creating new AI type or subtype', async ({
  page,
}) => {
  const agreement = {
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
    compliance_warning: {
      warning_level: 'none',
      message: '',
    },
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
        onboarding_status: 'not_started',
        connected: false,
      }),
    });
  });

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 7, value: 'Remodel', label: 'Remodel', owner_type: 'system' },
          { id: 8, value: 'Roofing', label: 'Roofing', owner_type: 'system' },
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
            id: 17,
            value: 'Bathroom Remodel',
            label: 'Bathroom Remodel',
            owner_type: 'system',
            project_type: 'Remodel',
          },
          {
            id: 18,
            value: 'Kitchen Remodel',
            label: 'Kitchen Remodel',
            owner_type: 'system',
            project_type: 'Remodel',
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

  await page.route('**/api/projects/contractors/me/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        ai: { access: 'included', enabled: true, unlimited: true },
      }),
    });
  });

  await page.route('**/api/projects/templates/recommend/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        confidence: 'none',
        candidates: [],
      }),
    });
  });

  await page.route('**/api/projects/agreements/ai/description/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project_title: 'Guest Bathroom Refresh',
        project_type: 'Type 7',
        project_subtype: 'Bathroom Remodel',
        description:
          'Update the guest bathroom with new tile, vanity, fixtures, and finish work.',
        ai_access: 'included',
        ai_enabled: true,
        ai_unlimited: true,
      }),
    });
  });

  await page.route('**/api/projects/templates/**', async (route) => {
    if (route.request().url().includes('/templates/recommend/')) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`),
    async (route) => {
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
    }
  );

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await page.getByRole('button', { name: 'Use AI' }).click();
  await page.getByTestId('start-with-ai-input-dock').fill('Bathroom remodel with tile and vanity replacement');
  await page.getByTestId('start-with-ai-submit-dock').click();

  await expect(page.locator('select[name="project_type"]')).toHaveValue('Remodel');
  await expect(page.locator('select[name="project_subtype"]')).toHaveValue(
    'Bathroom Remodel'
  );
  await expect(page.getByTestId('agreement-project-type-ai-indicator')).toContainText(
    'AI suggested'
  );
  await expect(page.getByTestId('agreement-project-type-ai-indicator')).not.toContainText(
    '(New)'
  );
  await expect(page.getByTestId('agreement-project-subtype-ai-indicator')).not.toContainText(
    '(New)'
  );
});

test('agreement wizard step 2 AI can recommend saving a reusable template and open the save flow', async ({
  page,
}) => {
  const agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Roof Replacement Standard',
    title: 'Roof Replacement Standard',
    project_type: 'Roofing',
    project_subtype: 'Roof Replacement',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description: 'Remove old shingles, inspect decking, install underlayment, install shingles, and complete cleanup.',
    homeowner: null,
    status: 'draft',
    compliance_warning: {
      warning_level: 'none',
      message: '',
    },
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
        onboarding_status: 'not_started',
        connected: false,
      }),
    });
  });

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 1, value: 'Roofing', label: 'Roofing', owner_type: 'system' }],
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
            value: 'Roof Replacement',
            label: 'Roof Replacement',
            owner_type: 'system',
            project_type: 'Roofing',
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

  await page.route('**/api/projects/contractors/me/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        ai: { access: 'included', enabled: true, unlimited: true },
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

  await page.route(/\/api\/projects\/milestones\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 501,
            agreement: AGREEMENT_ID,
            title: 'Deposit and materials',
            description: 'Collect deposit and order materials.',
            amount: '2500.00',
          },
          {
            id: 502,
            agreement: AGREEMENT_ID,
            title: 'Tear-off and prep',
            description: 'Remove roofing and prepare decking.',
            amount: '4000.00',
          },
          {
            id: 503,
            agreement: AGREEMENT_ID,
            title: 'Install and cleanup',
            description: 'Install new system and clean the site.',
            amount: '3500.00',
          },
        ],
      }),
    });
  });

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`),
    async (route) => {
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
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(agreement),
        });
        return;
      }

      await route.fallback();
    }
  );

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByText('Deposit and materials')).toBeVisible();
  await page.getByTestId('milestones-ai-entry-toggle').click();
  await expect(page.getByTestId('start-with-ai-coaching')).toBeVisible();
  await expect(page.getByTestId('start-with-ai-coaching-message')).toContainText(
    'milestone'
  );
  await expect(page.getByTestId('start-with-ai-coaching-next-step')).toContainText(
    'save'
  );
  await expect(
    page.getByTestId('start-with-ai-template-recommendation')
  ).toContainText('This agreement looks reusable');
  await page.getByTestId('start-with-ai-template-action').click();
  await expect(
    page.getByPlaceholder('e.g., My Standard Roofing Template')
  ).toBeVisible();
});

test('maintenance agreement fields render in step 1 and recurring summary appears in step 2', async ({
  page,
}) => {
  let agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Quarterly HVAC Plan',
    title: 'Quarterly HVAC Plan',
    project_type: 'HVAC',
    project_subtype: 'Maintenance',
    agreement_mode: 'maintenance',
    recurring_service_enabled: true,
    recurrence_pattern: 'quarterly',
    recurrence_interval: 1,
    recurrence_start_date: '2026-04-15',
    recurrence_end_date: '',
    next_occurrence_date: '2026-04-15',
    auto_generate_next_occurrence: true,
    maintenance_status: 'active',
    recurring_summary_label: 'Quarterly HVAC Maintenance',
    service_window_notes: 'Second Wednesday mornings.',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description: 'Recurring HVAC maintenance agreement.',
    homeowner: null,
    status: 'draft',
    recurring_preview: {
      recurrence_pattern: 'quarterly',
      recurrence_interval: 1,
      next_occurrence_date: '2026-04-15',
      recurring_summary_label: 'Quarterly HVAC Maintenance',
      preview_occurrences: [
        {
          rule_milestone_id: 1,
          title: 'HVAC Tune-Up',
          sequence_number: 1,
          scheduled_service_date: '2026-04-15',
          amount: '300.00',
        },
      ],
    },
    compliance_warning: {
      warning_level: 'none',
      message: '',
    },
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
        onboarding_status: 'not_started',
        connected: false,
      }),
    });
  });

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 1, value: 'HVAC', label: 'HVAC', owner_type: 'system' }],
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
            value: 'Maintenance',
            label: 'Maintenance',
            owner_type: 'system',
            project_type: 'HVAC',
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/homeowners**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/contractors/me/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        ai: { access: 'included', enabled: true, unlimited: true },
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

  await page.route(/\/api\/projects\/milestones\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 501,
            agreement: AGREEMENT_ID,
            title: 'HVAC Tune-Up - Visit 1',
            description: 'Recurring generated visit.',
            amount: '300.00',
            generated_from_recurring_rule: true,
            occurrence_sequence_number: 1,
            scheduled_service_date: '2026-04-15',
            start_date: '2026-04-15',
            completion_date: '2026-04-15',
          },
        ],
      }),
    });
  });

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`),
    async (route) => {
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
        const payload = request.postDataJSON();
        agreement = {
          ...agreement,
          ...payload,
          recurring_preview: {
            ...(agreement.recurring_preview || {}),
            recurrence_pattern: payload.recurrence_pattern || agreement.recurrence_pattern,
            recurrence_interval:
              payload.recurrence_interval || agreement.recurrence_interval || 1,
            next_occurrence_date:
              agreement.next_occurrence_date || payload.recurrence_start_date || '2026-04-15',
            recurring_summary_label:
              payload.recurring_summary_label || agreement.recurring_summary_label,
            preview_occurrences: agreement.recurring_preview?.preview_occurrences || [],
          },
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(agreement),
        });
        return;
      }

      await route.fallback();
    }
  );

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('maintenance-settings-card')).toBeVisible();
  await page.getByText('Maintenance / Recurring Service').click();
  await page.getByTestId('maintenance-frequency-select').selectOption('quarterly');
  await page.getByTestId('maintenance-interval-input').fill('1');
  await page.getByTestId('maintenance-start-date-input').fill('2026-04-15');
  await expect(page.getByTestId('maintenance-summary')).toContainText(
    'Quarterly HVAC Maintenance'
  );

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step2-recurring-summary')).toContainText(
    'Quarterly HVAC Maintenance'
  );
  await expect(page.getByTestId('step2-recurring-summary')).toContainText(
    'Next occurrence: 2026-04-15'
  );
  await expect(page.getByTestId('step2-recurring-upcoming')).toContainText(
    'HVAC Tune-Up'
  );
});
