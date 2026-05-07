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

async function installWizardAuthRoutes(page) {
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

  await page.route('**/api/projects/templates/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });
}

async function installStep2AutoDraftRoutes(
  page,
  { agreement, projectTypes, projectSubtypes, milestoneState }
) {
  await installWizardAuthRoutes(page);

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: projectTypes }),
    });
  });

  await page.route('**/api/projects/project-subtypes/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: projectSubtypes }),
    });
  });

  await page.route(
    new RegExp(`/api/projects/agreements/${agreement.id}/?(\\?.*)?$`),
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

  await page.route(/\/api\/projects\/milestones\/?(\?.*)?$/, async (route) => {
    const request = route.request();

    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: milestoneState.items }),
      });
      return;
    }

    if (request.method() === 'POST') {
      const payload = request.postDataJSON();
      milestoneState.createCount += 1;
      const created = {
        id: milestoneState.nextId++,
        agreement: agreement.id,
        order: milestoneState.items.length + 1,
        title: payload.title,
        description: payload.description || '',
        amount: payload.amount,
        start_date: payload.start_date || null,
        completion_date: payload.completion_date || null,
      };
      milestoneState.items = [...milestoneState.items, created];

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created),
      });
      return;
    }

    await route.fallback();
  });

  await page.route(/\/api\/projects\/milestones\/\d+\/?(\?.*)?$/, async (route) => {
    const request = route.request();
    const match = request.url().match(/\/api\/projects\/milestones\/(\d+)\/?(\?.*)?$/);
    const milestoneId = Number(match?.[1]);
    const index = milestoneState.items.findIndex((item) => item.id === milestoneId);

    if (request.method() === 'PATCH' && index >= 0) {
      const payload = request.postDataJSON();
      milestoneState.items[index] = {
        ...milestoneState.items[index],
        ...payload,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(milestoneState.items[index]),
      });
      return;
    }

    if (request.method() === 'DELETE') {
      milestoneState.items = milestoneState.items.filter((item) => item.id !== milestoneId);
      await route.fulfill({
        status: 204,
        body: '',
      });
      return;
    }

    await route.fallback();
  });
}

async function installStep4FinalizeRoutes(
  page,
  { agreement, milestones = [], fundingPreview = null, events = {} }
) {
  await installWizardAuthRoutes(page);

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

  await page.route('**/api/projects/homeowners/1/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 1,
        full_name: 'Jordan Demo',
        company_name: 'Demo Customer',
        email: 'jordan@example.com',
        phone_number: '555-555-5555',
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

  await page.route(
    new RegExp(`/api/projects/agreements/${agreement.id}/?(\\?.*)?$`),
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
        if (Array.isArray(events.patchPayloads)) events.patchPayloads.push(payload);
        agreement = {
          ...agreement,
          ...payload,
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

  await page.route(
    new RegExp(`/api/projects/agreements/${agreement.id}/funding_preview/?(\\?.*)?$`),
    async (route) => {
      if (fundingPreview) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(fundingPreview),
        });
        return;
      }

      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'No funding preview available' }),
      });
    }
  );

  await page.route(
    new RegExp(`/api/projects/agreements/${agreement.id}/preview_link/?(\\?.*)?$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: `/api/projects/agreements/${agreement.id}/preview_pdf/?stream=1`,
        }),
      });
    }
  );

  await page.route(
    new RegExp(`/api/projects/agreements/${agreement.id}/preview_pdf/?(\\?.*)?$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        body: '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF',
      });
    }
  );

  await page.route(
    new RegExp(`/api/projects/agreements/${agreement.id}/mark_previewed/?(\\?.*)?$`),
    async (route) => {
      if (route.request().method() === 'POST') {
        if (Array.isArray(events.markPreviewedCalls)) events.markPreviewedCalls.push(route.request().url());
        agreement = {
          ...agreement,
          pdf_viewed: true,
          has_previewed: true,
          previewed: true,
          pdf_previewed: true,
          contractor_previewed: true,
        };
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, agreement }),
      });
    }
  );

  await page.route(/\/api\/projects\/milestones\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: milestones }),
    });
  });

  await page.route(
    new RegExp(`/api/projects/agreements/${agreement.id}/contractor_sign/?(\\?.*)?$`),
    async (route) => {
      if (route.request().method() === 'POST') {
        if (Array.isArray(events.signCalls)) events.signCalls.push(route.request().url());
        agreement = {
          ...agreement,
          signed_by_contractor: true,
          contractor_signed: true,
          contractor_signature_name: 'Jordan Builder',
          contractor_signed_at: '2026-04-29T15:00:00Z',
          status: agreement.signed_by_homeowner ? 'signed' : agreement.status,
        };
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, agreement }),
      });
    }
  );

  await page.route(
    new RegExp(`/api/projects/agreements/${agreement.id}/send_signature_request/?(\\?.*)?$`),
    async (route) => {
      if (route.request().method() === 'POST') {
        if (Array.isArray(events.sendCalls)) events.sendCalls.push(route.request().url());
        agreement = {
          ...agreement,
          signature_request_sent: true,
          signature_request_sent_at: '2026-04-29T15:05:00Z',
          status: 'sent',
          workflow_status: 'sent',
        };
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          agreement,
          sign_url: `https://www.myhomebro.com/public-sign/agreement-${agreement.id}?mode=customer`,
        }),
      });
    }
  );

  await page.route(
    new RegExp(`/api/projects/agreements/${agreement.id}/send_final_agreement_link/?(\\?.*)?$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, agreement }),
      });
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

  await page.route(/\/api\/projects\/agreements\/ai\/description\/?(\?.*)?$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        description:
          'Backyard 12x14 shed build with slab foundation, roof, siding, entry door, and cleanup.',
        project_title: 'Backyard Shed Build',
        project_type: 'Outdoor',
        project_subtype: 'Shed Build',
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
    expect(payload.recurrence_pattern).toBe('');
    expect(payload.service_window_notes).toBe('');
    expect(payload.recurring_summary_label).toBe('');
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
        const mergedText = `${payload.project_title || ""} ${payload.description || ""} ${payload.project_subtype || ""}`.toLowerCase();
        const shedScope = /shed|outbuilding|backyard/.test(mergedText);
        agreement = {
          ...agreement,
          ...payload,
          project_title:
            String(payload.project_title || "").trim() ||
            (shedScope ? 'Backyard Shed Build' : agreement.project_title),
          project_type:
            payload.project_type || (shedScope ? 'Outdoor' : agreement.project_type),
          project_subtype:
            payload.project_subtype || (shedScope ? 'Shed Build' : agreement.project_subtype),
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

  await page.goto('/app/agreements/new/wizard?step=1', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('agreement-wizard-heading')).toBeVisible();
  await expect(page.getByTestId('agreement-wizard-hint')).toContainText(
    'Confirm the customer, address, and project details'
  );
  await expect(page.getByTestId('step1-start-mode-chooser')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Describe the job' })).toBeVisible();
  await expect(page.getByTestId('step1-job-description-input')).toBeVisible();
  await expect(page.getByTestId('step1-start-mode-summary')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('proposal-draft-textarea')).toBeVisible();
  await expect(page.getByTestId('agreement-project-title-input')).toBeVisible();
  await expect(page.locator('input[name="address_line1"]')).toBeVisible();
  await expect(page.getByTestId('agreement-customer-select')).toBeVisible();
  await expect(page.getByTestId('agreement-project-class-residential')).toBeVisible();
  await expect(page.getByTestId('agreement-payment-structure-simple')).toBeVisible();
  await expect(page.getByTestId('agreement-pricing-strategy-fixed')).toBeVisible();

  await page.getByTestId('agreement-customer-select').selectOption('1');
  await expect(page.getByTestId('agreement-customer-select')).toHaveValue('1');

  await page.getByTestId('step1-job-description-input').fill(
    'Build backyard 12x14 shed with slab foundation and cleanup'
  );
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await expect(page.getByTestId('step1-starting-point-loading-card')).toBeHidden();

  const projectDetailsCard = page.getByTestId('step1-project-details-card');
  await expect(projectDetailsCard).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('agreement-project-title-input')).toBeVisible();
  await expect(page.getByTestId('step1-no-template-card')).toHaveCount(0);
  await expect(projectDetailsCard).toHaveAttribute('data-emphasis', 'true');
  await expect(page.locator('select[name="project_type"]')).not.toHaveValue('Concrete');
  await expect(page.locator('select[name="project_subtype"]')).not.toHaveValue('Concrete Slab');
  await expect(page.getByTestId('agreement-customer-select')).toBeVisible();
  await expect(page.getByTestId('agreement-customer-select')).toHaveValue('1');
  await expect(page.getByTestId('agreement-project-title-input')).toBeVisible();
  await page.getByTestId('agreement-project-title-input').fill('Sprinkler System');
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue(
    'Sprinkler System'
  );
  await expect(page.getByTestId('agreement-pricing-strategy-fixed')).toBeVisible();
  await expect(page.getByTestId('agreement-save-draft-button')).toBeVisible();

  await page.getByTestId('agreement-project-title-input').fill(
    'Playwright Agreement Smoke'
  );
  await page.getByTestId('agreement-save-draft-button').click();

  await expect(page).toHaveURL(
    new RegExp(`/app/agreements/${AGREEMENT_ID}/wizard\\?step=2$`)
  );
  await expect(page.getByTestId('agreement-wizard-subtitle')).toContainText(
    `Agreement #${AGREEMENT_ID}`
  );

  await page.getByRole('button', { name: 'Step 1 Details' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/app/agreements/${AGREEMENT_ID}/wizard\\?step=1$`)
  );
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue(
    'Playwright Agreement Smoke'
  );
  await expect(page.getByTestId('step1-starting-point-loading-card')).toHaveCount(0);
  await expect(page.getByText('No strong template match found')).toHaveCount(0);
});

test('agreement wizard step 1 shows a recommended fallback when AI/template matching is unavailable', async ({
  page,
}) => {
  const agreement = {
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
      message:
        'Electrical work in Texas typically requires a license. Upload a license document if it is missing.',
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

  await page.route(/\/api\/projects\/agreements\/ai\/description\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project_title: 'Siding Replacement',
        project_type: 'Siding',
        project_subtype: 'Siding Replacement',
        description:
          'Work includes removal and replacement of exterior siding on the areas identified in the project description.',
        recommendation_source: 'fallback',
        confidence: 'fallback',
        confidence_label: 'Recommended from your description',
        next_step_guidance: 'Review the recommended starting point before continuing.',
        reason: 'Recommended from your description.',
        ai_access: 'included',
        ai_enabled: true,
        ai_unlimited: true,
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

  await page.route('**/api/projects/templates/recommend/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        confidence: 'none',
        candidates: [],
        detail: 'No confident matching template exists yet for this type/subtype.',
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

  await page.goto('/app/agreements/new/wizard?step=1', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step1-start-mode-chooser')).toBeVisible();
  await expect(page.getByTestId('agreement-clarification-section')).toHaveCount(0);
  await page.getByTestId('step1-job-description-input').fill(
    'Replace siding on a single-story home with trim repairs and cleanup'
  );
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });

  await expect(page.getByTestId('step1-starting-point-loading-card')).toHaveCount(0);
  await expect(page.getByTestId('step1-starting-point-error-card')).toHaveCount(0);
  await expect(page.getByTestId('step1-no-template-card')).toBeVisible();
  await expect(page.getByText('No template found')).toBeVisible();
  await expect(page.getByText('Recommended starting point')).toHaveCount(0);
  await expect(page.getByTestId('step1-template-browser')).toHaveCount(0);
  await expect(page.getByTestId('step1-review-project-details-jump')).toBeVisible();
  await page.getByTestId('step1-review-project-details-jump').click();
  await expect(page.getByTestId('agreement-project-type-select')).toBeVisible();
  await expect(page.getByTestId('step1-build-agreement-ai-button')).toHaveCount(1);
  await expect(page.getByTestId('step1-browse-templates-manually-button')).toBeVisible();
  await expect(page.getByTestId('step1-job-description-input')).toHaveValue(
    'Replace siding on a single-story home with trim repairs and cleanup'
  );
  await page.getByTestId('step1-build-agreement-ai-button').click();
  await expect(page.getByText('Save draft first')).toHaveCount(0);
  await expect(page.getByTestId('step1-no-template-card')).toHaveCount(0);
  await expect(page.getByTestId('step1-template-browser')).toHaveCount(0);
  await expect(page.getByTestId('step1-ai-setup-result')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue('Siding Replacement');
  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue('Siding');
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue(
    'Siding Replacement'
  );
  await expect(page.getByTestId('proposal-draft-textarea')).toHaveValue(
    'Remove or prepare existing siding as needed, install replacement siding and related trim, complete finish details, and clean the work area. Contractor will verify measurements, material requirements, and site conditions before final pricing or work begins.'
  );
  await expect(page.getByText('Custom Project')).toHaveCount(0);
  await expect(page.getByText('Not available')).toHaveCount(0);
  await expect(page.getByTestId('agreement-clarification-section')).toHaveCount(0);
});

test('agreement wizard step 1 keeps empty descriptions blocked', async ({ page }) => {
  await installWizardAuthRoutes(page);

  await page.route('**/api/projects/agreements/123/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
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
        }),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto('/app/agreements/new/wizard?step=1', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step1-find-best-starting-point-button')).toBeDisabled();
});

test('agreement wizard step 1 save and next shows inline validation instead of raw server errors', async ({
  page,
}) => {
  await installWizardAuthRoutes(page);

  let draftCreates = 0;
  await page.route(/\/api\/projects\/agreements\/?(\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      draftCreates += 1;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
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
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto('/app/agreements/new/wizard?step=1', {
    waitUntil: 'domcontentloaded',
  });

  await page.getByRole('button', { name: 'Save & Next' }).click();

  await expect(page.getByTestId('step1-validation-banner')).toBeVisible();
  await expect(page.getByText('Project type is required.')).toBeVisible();
  await expect(page.getByTestId('agreement-project-type-select')).toBeFocused();
  await expect(page.getByText('Server response (400)')).toHaveCount(0);
  expect(draftCreates).toBe(0);
});

test('agreement wizard step 1 loads saved values without rerunning ai and resumes from persisted progress', async ({
  page,
}) => {
  await installWizardAuthRoutes(page);

  let aiDescriptionRequests = 0;
  const agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Backyard Shed Build',
    title: 'Backyard Shed Build',
    project_type: 'Outdoor',
    project_subtype: 'Shed Build',
    description: 'Build a 12x14 backyard shed with slab, roof, door, and cleanup.',
    scope_of_work: 'Build a 12x14 backyard shed with slab, roof, door, and cleanup.',
    step_status: 'step1',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    status: 'draft',
    homeowner: null,
  };

  await page.route('**/api/projects/agreements/ai/description/', async (route) => {
    aiDescriptionRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project_title: 'Backyard Shed Build',
        project_type: 'Outdoor',
        project_subtype: 'Shed Build',
        description: agreement.description,
      }),
    });
  });

  await page.route('**/api/projects/templates/recommend/', async (route) => {
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

  await expect(page).toHaveURL(/step=2/);
  await expect(page.getByTestId('step1-starting-point-loading-card')).toHaveCount(0);
  expect(aiDescriptionRequests).toBe(0);

  await page.getByRole('button', { name: 'Step 1 Details' }).click();
  await expect(page).toHaveURL(/step=1/);
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue(
    'Backyard Shed Build'
  );
  await expect(page.locator('select[name="project_type"]')).toHaveValue('Outdoor');
  await expect(page.locator('select[name="project_subtype"]')).toHaveValue('Shed Build');
  await expect(page.getByTestId('step1-starting-point-loading-card')).toHaveCount(0);
  await expect(page.getByTestId('step1-build-agreement-ai-button')).toHaveCount(0);
  await expect(page.getByText('No strong template match found')).toHaveCount(0);
  await expect(page.getByTestId('step1-start-mode-chooser')).toHaveCount(0);
});

test('agreement wizard step 1 no-template build with ai does not leave a ghost container', async ({
  page,
}) => {
  await installWizardAuthRoutes(page);
  await page.addInitScript(() => {
    window.sessionStorage.clear();
  });

  await page.route('**/api/projects/agreements/ai/description/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project_title: 'Backyard Shed Build',
        project_type: 'Outdoor',
        project_subtype: 'Shed Build',
        description: 'Build a 12x14 backyard shed with slab, roof, door, and cleanup.',
      }),
    });
  });

  await page.route('**/api/projects/templates/recommend/', async (route) => {
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
          body: JSON.stringify({
            id: AGREEMENT_ID,
            agreement_id: AGREEMENT_ID,
            project_title: '',
            title: '',
            project_type: '',
            project_subtype: '',
            description: '',
            payment_mode: 'escrow',
            payment_structure: 'simple',
            status: 'draft',
          }),
        });
        return;
      }

      await route.fallback();
    }
  );

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByText('Describe the job')).toBeVisible();
  await expect(page.getByTestId('step1-job-description-input')).toBeVisible();
  await page.getByTestId('step1-job-description-input').fill('Patio extension');
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await expect(page.getByTestId('step1-find-best-starting-point-button')).toBeDisabled();
  await expect(page.getByTestId('step1-find-best-starting-point-button')).toHaveText('Finding...');
  await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible();

  await expect(page.getByTestId('step1-starting-point-loading-card')).toBeVisible();
  await page.waitForTimeout(1100);
  await expect(page.getByTestId('step1-starting-point-loading-card')).toBeVisible();
  await expect(page.getByTestId('step1-start-mode-summary')).toHaveCount(0);
  await expect(page.getByText('New Agreement')).toHaveCount(0);
  await expect(page.getByTestId('step1-template-browser')).toHaveCount(0);
  await expect(page.getByTestId('step1-no-template-card')).toBeVisible();
  await expect(page.getByText('No template found')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('agreement-project-title-input')).toBeVisible();
  await expect(page.getByText('Recommended starting point')).toHaveCount(0);
  await expect(page.getByTestId('step1-template-browser')).toHaveCount(0);
  await expect(page.getByTestId('step1-build-agreement-ai-button')).toBeVisible();
  await expect(page.getByTestId('step1-start-mode-summary')).toBeVisible();
  await expect(page.locator('select[name="project_type"] option').first()).toHaveText('Select Type');
  await expect(page.locator('select[name="project_subtype"] option').first()).toHaveText(
    'Select Subtype'
  );

  await page.getByTestId('step1-build-agreement-ai-button').click();

  await expect(page.getByTestId('step1-no-template-card')).toHaveCount(0);
  await expect(page.getByTestId('step1-start-mode-summary')).toHaveCount(0);
  await expect(page.getByTestId('step1-template-browser')).toHaveCount(0);
  await expect(page.getByTestId('step1-ai-template-recommendation')).toHaveCount(0);
  await expect(page.getByText('New Agreement')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('agreement-project-title-input')).toBeVisible();
  await expect(page.getByTestId('agreement-project-type-select')).toBeVisible();
  await expect(page.getByTestId('agreement-project-subtype-select')).toBeVisible();
  await expect(page.getByTestId('proposal-draft-textarea')).toBeVisible();
  await expect(page.getByText('Custom Project')).toHaveCount(0);
  await expect(page.getByText('Not available')).toHaveCount(0);
  await expect(page.getByTestId('step1-start-over-button')).toBeVisible();
  await page.getByTestId('step1-start-over-button').click();
  await expect(page.getByTestId('step1-start-mode-chooser')).toBeVisible();
  await expect(page.getByTestId('step1-job-description-input')).toBeVisible();
  await expect(page.getByTestId('step1-job-description-input')).toHaveValue('');
  await expect(page.getByTestId('step1-project-details-card')).toHaveCount(0);
  await expect(page.getByText('Junk Removal')).toHaveCount(0);
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
        results: [
          { id: 1, value: 'Remodel', label: 'Remodel', owner_type: 'system' },
          { id: 2, value: 'Outdoor', label: 'Outdoor', owner_type: 'system' },
          { id: 3, value: 'Concrete', label: 'Concrete', owner_type: 'system' },
        ],
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

  await page.route(/\/api\/projects\/agreements\/ai\/description\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        description:
          'Backyard 12x14 shed build with slab foundation, roof, siding, entry door, and cleanup.',
        project_title: 'Backyard Shed Build',
        project_type: 'Outdoor',
        project_subtype: 'Shed Build',
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
  await page.getByTestId('step1-job-description-input').fill(
    'Replace siding on a single-story home with trim repairs and cleanup'
  );
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await expect(page.getByTestId('step1-start-mode-summary')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();

  await page.getByTestId('step1-change-start-mode').click({ force: true });
});

test('agreement wizard step 1 keeps basement and siding ai results consistent across reruns', async ({
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
        results: [
          { id: 1, value: 'Remodel', label: 'Remodel', owner_type: 'system' },
          { id: 2, value: 'Siding', label: 'Siding', owner_type: 'system' },
          { id: 3, value: 'Pool', label: 'Pool', owner_type: 'system' },
          { id: 4, value: 'Bathroom', label: 'Bathroom', owner_type: 'system' },
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
          { id: 11, value: 'Basement', label: 'Basement', owner_type: 'system', project_type: 'Remodel' },
          { id: 12, value: 'Siding Replacement', label: 'Siding Replacement', owner_type: 'system', project_type: 'Siding' },
          { id: 13, value: 'Inground Pool and Pool House', label: 'Inground Pool and Pool House', owner_type: 'system', project_type: 'Pool' },
          { id: 14, value: 'Bathroom Remodel', label: 'Bathroom Remodel', owner_type: 'system', project_type: 'Bathroom' },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/ai\/description\/?(\?.*)?$/, async (route) => {
    let body = {};
    try {
      body = route.request().postDataJSON?.() || {};
    } catch {
      body = {};
    }
    const prompt = String(body.current_description || body.description || "").toLowerCase();
    const basementMatch = prompt.includes("finish basement") || prompt.includes("basement");
    const poolMatch = prompt.includes("pool") || prompt.includes("pool house");

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        basementMatch
          ? {
              description:
                'Finish the basement space with framing, drywall, flooring, trim, and cleanup as applicable.',
              project_title: 'Bathroom Remodel',
              project_type: 'Bathroom',
              project_subtype: 'Bathroom Remodel',
            }
          : poolMatch
          ? {
              description:
                'Install or build the inground pool and pool house, including excavation, structural work, mechanical systems, finishes, and cleanup.',
              project_title: 'Faucet Repair',
              project_type: 'Plumbing',
              project_subtype: 'Faucet Repair',
            }
          : {
              description:
                'Replace exterior siding, trim, and finish details as needed for the project.',
              project_title: 'Siding Replacement',
              project_type: 'Siding',
              project_subtype: 'Siding Replacement',
            }
      ),
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

  await page.route('**/api/projects/homeowners**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 1, company_name: 'Demo Customer', full_name: 'Jordan Demo' }],
      }),
    });
  });

  await page.route('**/api/projects/agreements/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' || request.method() === 'PATCH') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: AGREEMENT_ID,
          agreement_id: AGREEMENT_ID,
          project_title: '',
          title: '',
          project_type: '',
          project_subtype: '',
          description: '',
          payment_mode: 'escrow',
          payment_structure: 'simple',
          step_status: 'step1',
          homeowner: null,
          status: 'draft',
          ai_scope: { answers: {} },
          compliance_warning: {
            warning_level: 'none',
            message: '',
          },
        }),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto('/app/agreements/new/wizard?step=1', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step1-job-description-input')).toBeVisible();

  await page.getByTestId('step1-job-description-input').fill('finish basement');
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await expect(page.getByTestId('step1-find-best-starting-point-button')).toBeDisabled();
  await expect(page.getByTestId('step1-find-best-starting-point-button')).toHaveText('Finding...');
  await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible();
  await expect(page.getByTestId('step1-starting-point-loading-card')).toBeVisible();
  await page.waitForTimeout(1100);
  await expect(page.getByTestId('step1-starting-point-loading-card')).toBeVisible();
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue('Basement Finishing');
  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue('Remodel');
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue('Basement');
  await expect(page.getByTestId('proposal-draft-textarea')).toHaveValue(/basement/i);

  await page.getByTestId('step1-job-description-input').fill('replace siding');
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await expect(page.getByTestId('step1-starting-point-loading-card')).toBeVisible();
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue('Siding Replacement');
  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue('Siding');
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue('Siding Replacement');
  await expect(page.getByTestId('proposal-draft-textarea')).toHaveValue(/siding/i);
});

test('agreement wizard step 1 replaces plumbing labels with pool classification on rerun', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.sessionStorage.clear();
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
          { id: 1, value: 'Plumbing', label: 'Plumbing', owner_type: 'system' },
          { id: 2, value: 'Pool', label: 'Pool', owner_type: 'system' },
          { id: 3, value: 'Remodel', label: 'Remodel', owner_type: 'system' },
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
          { id: 21, value: 'Faucet Repair', label: 'Faucet Repair', owner_type: 'system', project_type: 'Plumbing' },
          { id: 22, value: 'Inground Pool and Pool House', label: 'Inground Pool and Pool House', owner_type: 'system', project_type: 'Pool' },
          { id: 23, value: 'Pool House Construction', label: 'Pool House Construction', owner_type: 'system', project_type: 'Pool' },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/ai\/description\/?(\?.*)?$/, async (route) => {
    let body = {};
    try {
      body = route.request().postDataJSON?.() || {};
    } catch {
      body = {};
    }
    const prompt = String(body.current_description || body.description || "").toLowerCase();
    const poolMatch = prompt.includes("pool") || prompt.includes("pool house");

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        poolMatch
          ? {
              description:
                'Install or build the inground pool and pool house, including excavation, structural work, mechanical systems, finishes, and cleanup.',
              project_title: 'Faucet Repair',
              project_type: 'Plumbing',
              project_subtype: 'Faucet Repair',
            }
          : {
              description:
                'Repair the leaking faucet and confirm the plumbing connections before closeout.',
              project_title: 'Faucet Repair',
              project_type: 'Plumbing',
              project_subtype: 'Faucet Repair',
            }
      ),
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

  await page.route('**/api/projects/homeowners**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 1, company_name: 'Demo Customer', full_name: 'Jordan Demo' }],
      }),
    });
  });

  await page.route('**/api/projects/agreements/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' || request.method() === 'PATCH') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: AGREEMENT_ID,
          agreement_id: AGREEMENT_ID,
          project_title: '',
          title: '',
          project_type: '',
          project_subtype: '',
          description: '',
          payment_mode: 'escrow',
          payment_structure: 'simple',
          status: 'draft',
        }),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto('/app/agreements/new/wizard?step=1', {
    waitUntil: 'domcontentloaded',
  });

  await page.getByTestId('step1-job-description-input').fill('faucet repair');
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue('Faucet Repair');
  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue('Plumbing');
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue('Faucet Repair');

  await page.getByTestId('step1-job-description-input').fill('inground pool and pool house');
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await expect(page.getByTestId('step1-find-best-starting-point-button')).toHaveText('Finding...');
  await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible();
  await expect(page.getByTestId('step1-starting-point-loading-card')).toBeVisible();
  await page.waitForTimeout(1100);
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue('Inground Pool and Pool House');
  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue('Pool');
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue('Inground Pool and Pool House');
  await expect(page.getByTestId('proposal-draft-textarea')).toHaveValue(/pool/i);
});

test('agreement wizard step 1 improve project classification updates type subtype and title without changing scope', async ({
  page,
}) => {
  await installWizardAuthRoutes(page);

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 1, value: 'Repair', label: 'Repair', owner_type: 'system' },
          { id: 2, value: 'Junk Removal', label: 'Junk Removal', owner_type: 'system' },
          { id: 3, value: 'Remodel', label: 'Remodel', owner_type: 'system' },
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
            value: 'Faucet Repair',
            label: 'Faucet Repair',
            owner_type: 'system',
            project_type: 'Repair',
          },
          {
            id: 12,
            value: 'Junk Removal',
            label: 'Junk Removal',
            owner_type: 'system',
            project_type: 'Junk Removal',
          },
          {
            id: 13,
            value: 'Debris Removal',
            label: 'Debris Removal',
            owner_type: 'system',
            project_type: 'Junk Removal',
          },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/ai\/description\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project_title: 'Faucet Repair',
        project_type: 'Repair',
        project_subtype: 'Faucet Repair',
        description: 'Remove old furniture and debris from the garage.',
        recommendation_source: 'fallback',
        confidence: 'fallback',
        confidence_label: 'Recommended from your description',
        next_step_guidance: 'Review the recommended starting point before continuing.',
        reason: 'Recommended from your description.',
        ai_access: 'included',
        ai_enabled: true,
        ai_unlimited: true,
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/ai\/classify\/?(\?.*)?$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        detail: 'OK',
        project_type: 'Junk Removal',
        project_subtype: 'Debris Removal',
        project_title: 'Junk Removal',
        classification_reason: 'Detected junk-removal scope.',
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

  await page.route('**/api/projects/agreements/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' || request.method() === 'PATCH') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: AGREEMENT_ID,
          agreement_id: AGREEMENT_ID,
          project_title: '',
          title: '',
          project_type: '',
          project_subtype: '',
          description: '',
          payment_mode: 'escrow',
          payment_structure: 'simple',
          status: 'draft',
        }),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto('/app/agreements/new/wizard?step=1', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step1-job-description-input')).toBeVisible();
  await page.getByTestId('step1-job-description-input').fill('Junk Removal');
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await page.waitForTimeout(1100);

  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();

  await page.getByTestId('proposal-draft-textarea').fill(
    'Remove old furniture, appliances, and debris from the garage.'
  );
  await page.getByTestId('agreement-project-type-select').selectOption('Repair');
  await page.getByTestId('agreement-project-subtype-select').selectOption('Faucet Repair');
  await page.getByTestId('agreement-project-title-input').fill('Faucet Repair');
  const scopeBefore = await page.getByTestId('proposal-draft-textarea').inputValue();

  await page.getByTestId('agreement-ai-improve-classification-button').click({ force: true });
  await expect(page.getByTestId('agreement-ai-improve-classification-button')).toHaveText(
    'Improving...'
  );
  await expect(page.getByTestId('agreement-ai-improve-classification-button')).toBeDisabled();
  await page.waitForTimeout(1100);

  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue('Junk Removal');
  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue('Junk Removal');
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue('Debris Removal');
  await expect(page.getByTestId('proposal-draft-textarea')).toHaveValue(scopeBefore);
});

test('agreement wizard step 1 improves outdoor kitchen classification instead of wet bar', async ({
  page,
}) => {
  await installWizardAuthRoutes(page);

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 1, value: 'Remodel', label: 'Remodel', owner_type: 'system' },
          { id: 2, value: 'Outdoor Living', label: 'Outdoor Living', owner_type: 'system' },
          { id: 3, value: 'Junk Removal', label: 'Junk Removal', owner_type: 'system' },
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
            id: 31,
            value: 'Wet Bar Installation',
            label: 'Wet Bar Installation',
            owner_type: 'system',
            project_type: 'Remodel',
          },
          {
            id: 32,
            value: 'Outdoor Kitchen',
            label: 'Outdoor Kitchen',
            owner_type: 'system',
            project_type: 'Outdoor Living',
          },
          {
            id: 33,
            value: 'Patio Extension',
            label: 'Patio Extension',
            owner_type: 'system',
            project_type: 'Outdoor Living',
          },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/ai\/classify\/?(\?.*)?$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1100));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: 'OK',
          project_type: 'Remodel',
          project_subtype: 'Wet Bar Installation',
          project_title: 'Wet Bar Installation',
          confidence: 'high',
          confidence_label: 'High confidence',
          reason: 'Detected wet-bar/remodel scope.',
          alternatives: [],
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

  await page.route('**/api/projects/agreements/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' || request.method() === 'PATCH') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: AGREEMENT_ID,
          agreement_id: AGREEMENT_ID,
          project_title: 'Wet Bar Installation',
          title: 'Wet Bar Installation',
          project_type: 'Remodel',
          project_subtype: 'Wet Bar Installation',
          description:
            'Build an outdoor kitchen with weather-resistant cabinets, countertop, sink, grill station, lighting, and patio electrical work.',
          classification: {
            project_type: 'Outdoor Living',
            project_subtype: 'Outdoor Kitchen',
            project_title: 'Outdoor Kitchen',
            confidence: 'high',
            confidence_label: 'High confidence',
            reason: 'The scope centers on outdoor cabinetry, countertop, sink, and grill work.',
            alternatives: [],
          },
          step_status: 'step1',
          payment_mode: 'escrow',
          payment_structure: 'simple',
          status: 'draft',
        }),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await page.getByRole('button', { name: 'Step 1 Details' }).click();
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await page.waitForTimeout(250);
  await page.getByTestId('proposal-draft-textarea').evaluate(
    (el, value) => {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    'Build an outdoor kitchen with weather-resistant cabinets, countertop, sink, grill station, lighting, and patio electrical work.'
  );
  await expect(page.getByTestId('proposal-draft-textarea')).toHaveValue(/outdoor kitchen/i);

  await page.getByTestId('agreement-ai-improve-classification-button').dispatchEvent('click');
  await expect(page.getByTestId('agreement-ai-improve-classification-button')).toHaveText(
    'Improving...'
  );
  await expect(page.getByTestId('agreement-ai-improve-classification-button')).toBeDisabled();
  await page.waitForTimeout(1100);

  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue('Outdoor Living');
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue('Outdoor Kitchen');
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue('Outdoor Kitchen');
  await expect(page.getByTestId('proposal-draft-textarea')).toHaveValue(
    /outdoor kitchen with weather-resistant cabinets/i
  );
  await expect(page.getByText(/AI matched this as Outdoor Living \/ Outdoor Kitchen/i)).toBeVisible();
  await expect(
    page.getByTestId('step1-project-details-card').getByText('Project classification updated.')
  ).toBeVisible();
});

test('agreement wizard step 1 improve classification reports already accurate when no change is needed', async ({
  page,
}) => {
  await installWizardAuthRoutes(page);

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 2, value: 'Outdoor Living', label: 'Outdoor Living', owner_type: 'system' },
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
            id: 32,
            value: 'Outdoor Kitchen',
            label: 'Outdoor Kitchen',
            owner_type: 'system',
            project_type: 'Outdoor Living',
          },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/ai\/classify\/?(\?.*)?$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        detail: 'OK',
        project_type: 'Outdoor Living',
        project_subtype: 'Outdoor Kitchen',
        project_title: 'Outdoor Kitchen',
        classification_reason: 'Detected outdoor-kitchen scope.',
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

  await page.route('**/api/projects/agreements/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' || request.method() === 'PATCH') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: AGREEMENT_ID,
          agreement_id: AGREEMENT_ID,
          project_title: 'Outdoor Kitchen',
          title: 'Outdoor Kitchen',
          project_type: 'Outdoor Living',
          project_subtype: 'Outdoor Kitchen',
          description:
            'Build an outdoor kitchen with weather-resistant cabinets, countertop, sink, grill station, lighting, and patio electrical work.',
          step_status: 'step1',
          payment_mode: 'escrow',
          payment_structure: 'simple',
          status: 'draft',
        }),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await page.getByRole('button', { name: 'Step 1 Details' }).click();
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await page.waitForTimeout(250);
  await page.getByTestId('proposal-draft-textarea').evaluate(
    (el, value) => {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    'Build an outdoor kitchen with weather-resistant cabinets, countertop, sink, grill station, lighting, and patio electrical work.'
  );
  await page.waitForTimeout(250);
  await page.getByTestId('agreement-ai-improve-classification-button').dispatchEvent('click');
  await expect(page.getByTestId('agreement-ai-improve-classification-button')).toHaveText(
    'Improving...'
  );
  await page.waitForTimeout(1100);

  await expect(
    page.getByTestId('step1-project-details-card').getByText('Classification already looks accurate.')
  ).toBeVisible();
  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue('Outdoor Living');
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue('Outdoor Kitchen');
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue('Outdoor Kitchen');
});

test('agreement wizard step 1 normalizes raw classification text into garage door values', async ({
  page,
}) => {
  await installWizardAuthRoutes(page);

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 2, value: 'Repair', label: 'Repair', owner_type: 'system' },
          { id: 42, value: 'Garage Doors', label: 'Garage Doors', owner_type: 'system' },
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
            id: 12,
            value: 'Faucet Repair',
            label: 'Faucet Repair',
            owner_type: 'system',
            project_type: 'Repair',
          },
          {
            id: 60,
            value: 'Garage Door Replacement',
            label: 'Garage Door Replacement',
            owner_type: 'system',
            project_type: 'Garage Doors',
          },
          {
            id: 61,
            value: 'Garage Door Repair',
            label: 'Garage Door Repair',
            owner_type: 'system',
            project_type: 'Garage Doors',
          },
          {
            id: 62,
            value: 'Garage Door Opener Installation',
            label: 'Garage Door Opener Installation',
            owner_type: 'system',
            project_type: 'Garage Doors',
          },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/ai\/classify\/?(\?.*)?$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        detail: 'OK',
        project_type: 'Work Includes',
        project_subtype: 'Work Includes Garage Door Replacement',
        project_title: 'Work Includes Garage Door Replacement',
        confidence: 'high',
        confidence_label: 'High confidence',
        reason: 'Raw scope text leaked into the classification response.',
        alternatives: [],
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

  await page.route('**/api/projects/agreements/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' || request.method() === 'PATCH') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: AGREEMENT_ID,
          agreement_id: AGREEMENT_ID,
          project_title: 'Faucet Repair',
          title: 'Faucet Repair',
          project_type: 'Repair',
          project_subtype: 'Faucet Repair',
          description: 'Garage door replacement with opener service.',
          step_status: 'step1',
          payment_mode: 'escrow',
          payment_structure: 'simple',
          status: 'draft',
        }),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await page.getByRole('button', { name: 'Step 1 Details' }).click();
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await page.waitForTimeout(250);
  await page.getByTestId('proposal-draft-textarea').evaluate(
    (el, value) => {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    'Garage door replacement with new panels and tracks.'
  );
  await page.waitForTimeout(250);
  await page.getByTestId('agreement-ai-improve-classification-button').dispatchEvent('click');
  await expect(page.getByTestId('agreement-ai-improve-classification-button')).toHaveText(
    'Improving...'
  );
  await page.waitForTimeout(1100);

  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue('Garage Doors');
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue(
    'Garage Door Replacement'
  );
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue(
    'Garage Door Replacement'
  );
  await expect(page.getByText(/Work Includes/i)).toHaveCount(0);
});

test('agreement wizard step 1 allows manual custom types and subtypes to be added inline', async ({
  page,
}) => {
  await installWizardAuthRoutes(page);

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 2, value: 'Repair', label: 'Repair', owner_type: 'system' },
          { id: 3, value: 'Painting', label: 'Painting', owner_type: 'system' },
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
            id: 12,
            value: 'Faucet Repair',
            label: 'Faucet Repair',
            owner_type: 'system',
            project_type: 'Repair',
          },
          {
            id: 13,
            value: 'Interior',
            label: 'Interior',
            owner_type: 'system',
            project_type: 'Painting',
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/agreements/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' || request.method() === 'PATCH') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: AGREEMENT_ID,
          agreement_id: AGREEMENT_ID,
          project_title: '',
          title: '',
          project_type: '',
          project_subtype: '',
          description: '',
          step_status: 'step1',
          payment_mode: 'escrow',
          payment_structure: 'simple',
          status: 'draft',
        }),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await page.getByRole('button', { name: 'Step 1 Details' }).click();
  const projectDetailsCard = page.getByTestId('step1-project-details-card');
  await expect(projectDetailsCard).toBeVisible();

  await projectDetailsCard.getByRole('button', { name: 'Add Type' }).click();
  await expect(page.getByTestId('step1-custom-taxonomy-editor')).toBeVisible();
  await expect(page.getByTestId('step1-custom-taxonomy-input')).toHaveAttribute(
    'placeholder',
    'New Project Type'
  );
  await page.getByTestId('step1-custom-taxonomy-input').fill('Outdoor Living Plus');
  await page.getByTestId('step1-custom-taxonomy-save-button').click();

  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue(
    'Outdoor Living Plus'
  );
  await expect(page.getByTestId('agreement-project-type-select')).toContainText(
    'Outdoor Living Plus (Custom)'
  );
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue('');

  await projectDetailsCard.getByRole('button', { name: 'Add Subtype' }).click();
  await expect(page.getByTestId('step1-custom-taxonomy-editor')).toBeVisible();
  await page.getByTestId('step1-custom-taxonomy-input').fill('Patio Feature Build');
  await page.getByTestId('step1-custom-taxonomy-save-button').click();

  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue(
    'Patio Feature Build'
  );
  await expect(page.getByTestId('agreement-project-subtype-select')).toContainText(
    'Patio Feature Build (Custom)'
  );

  await projectDetailsCard.getByRole('button', { name: 'Add Subtype' }).click();
  await page.getByTestId('step1-custom-taxonomy-input').fill('Patio Feature Build');
  await page.getByTestId('step1-custom-taxonomy-save-button').click();
  await expect(page.getByTestId('step1-custom-taxonomy-editor').getByText(/already exists/i)).toBeVisible();
  await page.getByTestId('step1-custom-taxonomy-cancel-button').click();

  await page.getByTestId('agreement-project-title-input').fill('Outdoor Living Plus Patio');
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue(
    'Outdoor Living Plus Patio'
  );
  await page.getByTestId('proposal-draft-textarea').fill('Manual custom taxonomy should survive rerenders.');
  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue(
    'Outdoor Living Plus'
  );
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue(
    'Patio Feature Build'
  );
});

test('agreement wizard step 1 shows subtype clarifications, saves answers, and allows skipping', async ({
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
    description: '',
    step_status: 'step1',
    homeowner: null,
    status: 'draft',
    ai_scope: {
      answers: {},
    },
    compliance_warning: {
      warning_level: 'none',
      message: '',
    },
  };
  const patchPayloads = [];

  await installWizardAuthRoutes(page);

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
            project_type: 'Remodel',
          },
          {
            id: 12,
            value: 'Bathroom Remodel',
            label: 'Bathroom Remodel',
            owner_type: 'system',
            project_type: 'Remodel',
          },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/ai\/description\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        description:
          'Kitchen remodel with updated cabinets, finish work, and clarified layout questions.',
        project_title: 'Kitchen Remodel',
        project_type: 'Remodel',
        project_subtype: 'Kitchen Remodel',
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
        patchPayloads.push(payload);
        agreement = {
          ...agreement,
          ...payload,
          ai_scope: {
            ...(agreement.ai_scope || {}),
            answers: {
              ...((agreement.ai_scope && agreement.ai_scope.answers) || {}),
              ...(payload.scope_clarifications || {}),
            },
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

  await expect(page.getByTestId('step1-start-mode-chooser')).toBeVisible();
  await page.getByTestId('step1-job-description-input').fill(
    'Kitchen remodel with updated cabinets and finish work'
  );
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('agreement-clarification-section')).toBeVisible();
  await expect(page.getByTestId('agreement-clarification-question-layout_changes')).toContainText(
    'Does the kitchen layout or appliance placement change?'
  );
  await expect(page.getByTestId('agreement-clarification-question-cabinet_scope')).toContainText(
    'Are cabinets included in the project scope?'
  );

  await page.getByTestId('agreement-clarification-layout_changes-yes').click();
  await page
    .getByTestId('agreement-clarification-input-finish_scope_notes')
    .fill('Cabinets, quartz countertops, backsplash, and pendant lighting');

  await expect(page.getByTestId('agreement-clarification-summary')).toContainText(
    'Does the kitchen layout or appliance placement change? Yes.'
  );
  await expect(page.getByTestId('agreement-clarification-summary')).toContainText(
    'Cabinets, quartz countertops, backsplash, and pendant lighting'
  );

  await expect.poll(() =>
    patchPayloads.some(
      (payload) =>
        payload.scope_clarifications?.layout_changes === 'yes' &&
        payload.scope_clarifications?.finish_scope_notes ===
          'Cabinets, quartz countertops, backsplash, and pendant lighting'
    )
  ).toBeTruthy();

  await page.getByTestId('agreement-clarification-skip').dispatchEvent('click');
  await expect(page.getByTestId('agreement-clarification-skipped')).toBeVisible();
  await expect(page.getByTestId('agreement-save-draft-button')).toBeEnabled();

  await page.getByTestId('agreement-clarification-skip').dispatchEvent('click');
  await expect(page.getByTestId('agreement-clarification-question-layout_changes')).toBeVisible();
});

test('agreement wizard step 1 shows siding measurement inputs when measurements are provided', async ({
  page,
}) => {
  await installWizardAuthRoutes(page);

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 1, value: 'Siding', label: 'Siding', owner_type: 'system' }],
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
            id: 21,
            value: 'Siding Replacement',
            label: 'Siding Replacement',
            owner_type: 'system',
            project_type: 'Siding',
          },
        ],
      }),
    });
  });

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\?.*)?$`),
    async (route) => {
      const request = route.request();

      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: AGREEMENT_ID,
            agreement_id: AGREEMENT_ID,
            step_status: 'step1',
            project_title: '',
            title: '',
            project_type: '',
            project_subtype: '',
            payment_mode: 'escrow',
            payment_structure: 'simple',
            description: '',
            homeowner: null,
            status: 'draft',
            ai_scope: { answers: {} },
          }),
        });
        return;
      }

      if (request.method() === 'PATCH') {
        const nextAnswers = request.postDataJSON()?.ai_scope?.answers || {};
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: AGREEMENT_ID,
            agreement_id: AGREEMENT_ID,
            step_status: 'step1',
            project_title: request.postDataJSON()?.project_title || '',
            title: request.postDataJSON()?.title || '',
            project_type: request.postDataJSON()?.project_type || '',
            project_subtype: request.postDataJSON()?.project_subtype || '',
            payment_mode: 'escrow',
            payment_structure: 'simple',
            description: request.postDataJSON()?.description || '',
            homeowner: null,
            status: 'draft',
            ai_scope: { answers: nextAnswers },
          }),
        });
        return;
      }

      await route.fallback();
    }
  );

  await page.route(/\/api\/projects\/agreements\/ai\/description\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        description:
          'Remove or prepare existing siding as needed, install replacement siding and related trim, complete finish details, and clean the work area.',
        project_title: 'Siding Replacement',
        project_type: 'Siding',
        project_subtype: 'Siding Replacement',
      }),
    });
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step1-start-mode-chooser')).toBeVisible();
  await page.getByTestId('step1-job-description-input').fill('siding replacement');
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await expect(page.getByTestId('step1-starting-point-loading-card')).toBeHidden();
  await expect(page.getByTestId('agreement-clarification-section')).toBeVisible();
  await expect(page.getByTestId('agreement-clarification-question-measurements_provided')).toContainText(
    'Do you have measurements for this project?'
  );
  await page.getByLabel('Yes').click();
  await expect(page.getByTestId('agreement-clarification-input-measurement_exterior_square_footage')).toBeVisible();
  await expect(page.getByTestId('agreement-clarification-input-measurement_linear_feet')).toBeVisible();
  await expect(page.getByLabel('Number of stories')).toBeVisible();
  await expect(page.getByTestId('agreement-clarification-input-measurement_notes')).toBeVisible();
  await page.getByTestId('agreement-clarification-input-measurement_exterior_square_footage').fill('1200');
  await page.getByTestId('agreement-clarification-input-measurement_linear_feet').fill('180');
  await page.getByTestId('agreement-clarification-input-measurement_notes').fill('Approximate measurements only.');
  await page.getByLabel('No').click();
  await expect(page.getByText('Measurement details')).toBeHidden();
  await page.getByLabel('Yes').click();
  await expect(page.getByTestId('agreement-clarification-input-measurement_exterior_square_footage')).toHaveValue('1200');
  await expect(page.getByTestId('agreement-clarification-input-measurement_linear_feet')).toHaveValue('180');
  await expect(page.getByTestId('agreement-clarification-input-measurement_notes')).toHaveValue('Approximate measurements only.');

  await page.getByTestId('agreement-clarification-input-measurement_notes').fill(
    'Approximate measurements only. Contractor should verify measurements.'
  );
  await expect(page.getByTestId('agreement-clarification-summary')).toContainText(
    'Approximate measurements only. Contractor should verify measurements.'
  );
});

test('agreement wizard step 1 shows painting measurement inputs and preserves answers after toggling', async ({
  page,
}) => {
  await installWizardAuthRoutes(page);

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 1, value: 'Painting', label: 'Painting', owner_type: 'system' }],
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
            id: 21,
            value: 'Interior Painting',
            label: 'Interior Painting',
            owner_type: 'system',
            project_type: 'Painting',
          },
        ],
      }),
    });
  });

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\?.*)?$`),
    async (route) => {
      const request = route.request();

      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: AGREEMENT_ID,
            agreement_id: AGREEMENT_ID,
            step_status: 'step1',
            project_title: '',
            title: '',
            project_type: '',
            project_subtype: '',
            payment_mode: 'escrow',
            payment_structure: 'simple',
            description: '',
            homeowner: null,
            status: 'draft',
            ai_scope: { answers: {} },
          }),
        });
        return;
      }

      if (request.method() === 'PATCH') {
        const nextAnswers = request.postDataJSON()?.ai_scope?.answers || {};
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: AGREEMENT_ID,
            agreement_id: AGREEMENT_ID,
            step_status: 'step1',
            project_title: request.postDataJSON()?.project_title || '',
            title: request.postDataJSON()?.title || '',
            project_type: request.postDataJSON()?.project_type || '',
            project_subtype: request.postDataJSON()?.project_subtype || '',
            payment_mode: 'escrow',
            payment_structure: 'simple',
            description: request.postDataJSON()?.description || '',
            homeowner: null,
            status: 'draft',
            ai_scope: { answers: nextAnswers },
          }),
        });
        return;
      }

      await route.fallback();
    }
  );

  await page.route(/\/api\/projects\/agreements\/ai\/description\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        description: 'Paint the bedroom walls and trim with prep, primer, finish coats, and cleanup.',
        project_title: 'Bedroom Painting',
        project_type: 'Painting',
        project_subtype: 'Interior Painting',
      }),
    });
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=1`, {
    waitUntil: 'domcontentloaded',
  });

  await page.getByTestId('step1-job-description-input').fill('paint bedroom');
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await expect(page.getByTestId('step1-starting-point-loading-card')).toBeHidden();
  await expect(page.getByTestId('agreement-clarification-section')).toBeVisible();
  await page.getByLabel('Yes').click();
  await expect(page.getByTestId('agreement-clarification-input-measurement_room_count')).toBeVisible();
  await expect(page.getByTestId('agreement-clarification-input-measurement_square_footage')).toBeVisible();
  await expect(page.getByLabel('Ceiling included?')).toBeVisible();
  await expect(page.getByLabel('Trim included?')).toBeVisible();
  await page.getByTestId('agreement-clarification-input-measurement_room_count').fill('3');
  await page.getByTestId('agreement-clarification-input-measurement_square_footage').fill('850');
  await page.getByLabel('No').click();
  await expect(page.getByTestId('agreement-clarification-input-measurement_room_count')).toBeHidden();
  await page.getByLabel('Yes').click();
  await expect(page.getByTestId('agreement-clarification-input-measurement_room_count')).toHaveValue('3');
  await expect(page.getByTestId('agreement-clarification-input-measurement_square_footage')).toHaveValue('850');
  await expect(page.getByLabel('Ceiling included?')).toContainText('Yes');
  await expect(page.getByLabel('Trim included?')).toContainText('No');
});

test('agreement wizard step 1 respects explicit mode switching when a template is already applied', async ({
  page,
}) => {
  let agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Template Draft',
    title: 'Template Draft',
    project_type: 'Roofing',
    project_subtype: 'Roof Replacement',
    step_status: 'step1',
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

  await page.route(/\/api\/projects\/agreements\/ai\/description\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        description: 'Roof replacement with flashing repair and cleanup for the existing home.',
        project_title: 'Roof Replacement',
        project_type: 'Roofing',
        project_subtype: 'Roof Replacement',
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

  await expect(page.getByRole('button', { name: 'Step 1 Details' })).toBeVisible();
  await page.getByRole('button', { name: 'Step 1 Details' }).click();
  await expect(page).toHaveURL(/step=1/);
  await expect(page.getByTestId('step1-start-mode-summary')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await page.getByTestId('step1-change-start-mode').click({ force: true });
});

test('agreement wizard step 1 reset form clears draft setup and reopens the chooser', async ({
  page,
}) => {
  let agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Junk Removal',
    title: 'Junk Removal',
    project_type: 'Junk Removal',
    project_subtype: 'Debris Removal',
    step_status: 'step1',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description: 'Remove household junk and construction debris from the property.',
    homeowner: null,
    status: 'draft',
    selected_template_id: null,
    selected_template: null,
    selected_template_name_snapshot: '',
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
          { id: 1, value: 'Junk Removal', label: 'Junk Removal', owner_type: 'system' },
          { id: 2, value: 'Siding', label: 'Siding', owner_type: 'system' },
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
            value: 'Junk Removal',
            label: 'Junk Removal',
            owner_type: 'system',
            project_type: 'Junk Removal',
          },
          {
            id: 12,
            value: 'Siding Replacement',
            label: 'Siding Replacement',
            owner_type: 'system',
            project_type: 'Siding',
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
        results: [],
      }),
    });
  });

  await page.route('**/api/projects/agreements/ai/description/', async (route) => {
    const body = route.request().postDataJSON?.() || {};
    const description = String(body?.current_description || body?.description || '').toLowerCase();
    if (description.includes('replace siding')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          project_title: 'Siding Replacement',
          project_type: 'Siding',
          project_subtype: 'Siding Replacement',
          description: 'Replace existing siding and related trim, complete preparation and installation, and finish with cleanup.',
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project_title: 'Junk Removal',
        project_type: 'Junk Removal',
        project_subtype: 'Debris Removal',
        description: 'Remove household junk and construction debris from the property.',
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
        step_status: '',
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

  await page.getByRole('button', { name: 'Step 1 Details' }).click();
  await expect(page).toHaveURL(/\/app\/agreements\/123\/wizard\?step=1/);
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('agreement-ai-improve-classification-button')).toBeVisible();

  const projectDetailsCard = page.getByTestId('step1-project-details-card');
  await expect(projectDetailsCard.getByRole('button', { name: 'Start over' })).toBeVisible();
  await projectDetailsCard.getByRole('button', { name: 'Start over' }).click({ force: true });
  await expect(page).toHaveURL(/\/app\/agreements\/123\/wizard\?step=1/);
  await expect(page.getByTestId('step1-start-mode-chooser')).toBeVisible();
  await expect(page.getByTestId('step1-job-description-input')).toHaveValue('');
  await expect(page.getByTestId('step1-start-mode-summary')).toHaveCount(0);
  await expect(page.getByTestId('step1-project-details-card')).toHaveCount(0);
  await expect(page.getByTestId('agreement-ai-improve-classification-button')).toHaveCount(0);
  await expect(page.getByText('Junk Removal')).toHaveCount(0);

  await page.getByTestId('step1-job-description-input').fill('replace siding');
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue('Siding');
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue(
    'Siding Replacement'
  );
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

  await expect(page.getByTestId('step1-start-mode-chooser')).toBeVisible();
  await page.getByText('Browse templates manually').click();
  await expect(page.getByTestId('step1-template-browser')).toBeVisible();
  await page.getByTestId('template-search-result-88').click();
  await expect(page.getByTestId('step1-template-detail-name')).toContainText(
    'Roof Replacement Template'
  );
  await expect(page.getByTestId('step1-template-insights-card')).toBeVisible();
  await expect(page.getByTestId('step1-start-mode-summary')).toContainText(
    'Recommended starting point'
  );
});

test('agreement wizard step 1 shows clarifications after template application and keeps them skippable', async ({
  page,
}) => {
  let agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Template-driven draft',
    title: 'Template-driven draft',
    project_type: '',
    project_subtype: '',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description: '',
    homeowner: null,
    status: 'draft',
    ai_scope: {
      answers: {},
    },
    compliance_warning: {
      warning_level: 'none',
      message: '',
    },
  };
  const patchPayloads = [];

  await installWizardAuthRoutes(page);

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
            project_type: 'Remodel',
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/templates/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/templates/recommend/')) {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 44,
            name: 'Kitchen Remodel Template',
            project_type: 'Remodel',
            project_subtype: 'Kitchen Remodel',
            milestone_count: 5,
            description: 'Reusable kitchen remodel starting point.',
            owner_type: 'system',
          },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/templates\/44\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 44,
        name: 'Kitchen Remodel Template',
        project_type: 'Remodel',
        project_subtype: 'Kitchen Remodel',
        milestone_count: 5,
        estimated_days: 7,
        description: 'Reusable kitchen remodel starting point.',
        milestones: [
          { id: 1, title: 'Demo', description: 'Protect space and remove old finishes.' },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/123\/apply-template\/$/, async (route) => {
    agreement.selected_template_id = 44;
    agreement.selected_template = {
      id: 44,
      name: 'Kitchen Remodel Template',
      project_type: 'Remodel',
      project_subtype: 'Kitchen Remodel',
    };
    agreement.selected_template_name_snapshot = 'Kitchen Remodel Template';
    agreement.project_type = '';
    agreement.project_subtype = '';

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
        patchPayloads.push(payload);
        agreement = {
          ...agreement,
          ...payload,
          ai_scope: {
            ...(agreement.ai_scope || {}),
            answers: {
              ...((agreement.ai_scope && agreement.ai_scope.answers) || {}),
              ...(payload.scope_clarifications || {}),
            },
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

  await page.getByText('Browse templates manually').click();
  await expect(page.getByTestId('step1-template-browser')).toBeVisible();
  await expect(page.getByTestId('step1-system-templates-list')).toBeVisible();
  await expect(page.getByTestId('step1-my-templates-list')).toBeVisible();
  await expect(page.getByTestId('step1-template-detail-name')).toHaveCount(0);
  await expect(page.getByTestId('step1-job-description-input')).toHaveCount(0);
  await expect(page.getByTestId('step1-ai-prompt-input')).toHaveCount(0);
  await expect(page.getByText('Browse templates manually')).toBeVisible();
  await expect(page.getByText('Start a new template')).toHaveCount(0);
  await expect(page.getByText('New Template Draft')).toHaveCount(0);
  await expect(page.getByText('Save Template')).toHaveCount(0);
  await expect(page.getByTestId('step1-build-agreement-ai-button')).toBeVisible();
  await expect(page.getByText('draft template', { exact: false })).toHaveCount(0);

  await page.locator('input[placeholder*="Search templates by keyword"]').fill('kitchen');
  await page.getByRole('button', { name: /Kitchen Remodel Template/ }).click();
  await expect(page.getByTestId('step1-template-detail-name')).toContainText(
    'Kitchen Remodel Template'
  );
  await expect(page.getByTestId('step1-template-insights-card')).toBeVisible();
  await page.getByTestId('step1-continue-to-step2-button').click();

  await expect(page.getByTestId('step1-template-insights-card')).toContainText(
    '5 milestones is within the expected range for this template.'
  );
  await expect(page.getByTestId('step1-template-insights-card')).toContainText(
    'Pricing guidance could benefit from review.'
  );
  await expect(page.locator('select[name="project_subtype"]')).toHaveValue('');
  await expect(page.getByTestId('agreement-clarification-section')).toBeVisible();
  await expect(page.getByTestId('agreement-clarification-question-layout_changes')).toContainText(
    'Does the kitchen layout or appliance placement change?'
  );

  await page.getByTestId('agreement-clarification-cabinet_scope-yes').click();
  await expect(page.getByTestId('agreement-clarification-summary')).toContainText(
    'Are cabinets included in the project scope? Yes.'
  );

  await expect.poll(() =>
    patchPayloads.some(
      (payload) => payload.scope_clarifications?.cabinet_scope === 'yes'
    )
  ).toBeTruthy();

  await page.getByTestId('agreement-clarification-skip').click();
  await expect(page.getByTestId('agreement-clarification-skipped')).toContainText(
    'You can skip these for now and still keep moving'
  );
});

test('agreement wizard step 1 can find the best starting point and open the detail view', async ({
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
        confidence: 'high',
        recommended_template: {
          id: 44,
          name: 'Kitchen Remodel Template',
          project_type: 'Remodel',
          project_subtype: 'Kitchen Remodel',
          milestone_count: 5,
          description: 'Reusable kitchen remodel starting point.',
          owner_type: 'system',
        },
        candidates: [
          {
            id: 44,
            name: 'Kitchen Remodel Template',
            project_type: 'Remodel',
            project_subtype: 'Kitchen Remodel',
            milestone_count: 5,
            description: 'Reusable kitchen remodel starting point.',
            owner_type: 'system',
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
        project_title: 'Kitchen Remodel',
        project_type: 'Remodel',
        project_subtype: 'Kitchen Remodel',
        description: 'Kitchen remodel with cabinet updates and finish work.',
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
      body: JSON.stringify({
        results: [
          {
            id: 44,
            name: 'Kitchen Remodel Template',
            project_type: 'Remodel',
            project_subtype: 'Kitchen Remodel',
            milestone_count: 5,
            description: 'Reusable kitchen remodel starting point.',
            owner_type: 'system',
          },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/templates\/44\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 44,
        name: 'Kitchen Remodel Template',
        project_type: 'Remodel',
        project_subtype: 'Kitchen Remodel',
        milestone_count: 5,
        estimated_days: 7,
        description: 'Reusable kitchen remodel starting point.',
        milestones: [
          { id: 1, title: 'Demo', description: 'Protect space and remove old finishes.' },
          { id: 2, title: 'Cabinets', description: 'Install cabinets and hardware.' },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/123\/apply-template\/$/, async (route) => {
    agreement = {
      ...agreement,
      selected_template_id: 44,
      selected_template: {
        id: 44,
        name: 'Kitchen Remodel Template',
        project_type: 'Remodel',
        project_subtype: 'Kitchen Remodel',
      },
      selected_template_name_snapshot: 'Kitchen Remodel Template',
      project_type: '',
      project_subtype: '',
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

  await page.getByText('Browse templates manually').click();
  await expect(page.getByTestId('step1-template-browser')).toBeVisible();
  await expect(page.getByTestId('step1-template-detail-name')).toHaveCount(0);
  await expect(page.getByTestId('step1-job-description-input')).toHaveCount(0);
  await page.locator('input[placeholder*="Search templates by keyword"]').fill('kitchen');
  await page.getByRole('button', { name: /Kitchen Remodel Template/ }).click();

  await expect(page.getByTestId('step1-template-detail-name')).toContainText(
    'Kitchen Remodel Template'
  );
  await expect(page.getByTestId('step1-template-insights-card')).toBeVisible();
  await page.getByTestId('step1-continue-to-step2-button').click();

  await expect(page.locator('select[name="project_subtype"]')).toHaveValue('');
  await expect(page.getByTestId('agreement-clarification-section')).toBeVisible();
  await expect(page.getByTestId('agreement-clarification-question-layout_changes')).toContainText(
    'Does the kitchen layout or appliance placement change?'
  );
});

test('agreement wizard step 1 prefers remodel taxonomy over supporting electrical or plumbing scope', async ({
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
        project_type: 'Electrical',
        project_subtype: 'Removal Of Existing Bathroom Fixtures',
        description:
          'Bathroom remodel with tub and shower replacement, tile work, vanity install, updated lighting, electrical outlet relocation, minor plumbing adjustments, waterproofing, and finish work.',
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

  await expect(page.getByText('Describe the job')).toBeVisible();
  await page.getByTestId('step1-job-description-input').fill(
    'Bathroom remodel with tub and shower replacement, tile work, vanity install, plumbing updates, outlet relocation, and lighting changes'
  );
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });

  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue(
    'Bathroom Remodel'
  );
  await expect(page.getByTestId('agreement-project-title-input')).not.toHaveValue(
    /Scope Of Work Includes/i
  );
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

test('agreement wizard step 1 keeps cabinet installation as a limited-scope job instead of a kitchen remodel', async ({
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
          { id: 9, value: 'Cabinetry', label: 'Cabinetry', owner_type: 'system' },
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
            id: 18,
            value: 'Kitchen Remodel',
            label: 'Kitchen Remodel',
            owner_type: 'system',
            project_type: 'Remodel',
          },
          {
            id: 19,
            value: 'Cabinet Installation',
            label: 'Cabinet Installation',
            owner_type: 'system',
            project_type: 'Cabinetry',
          },
          {
            id: 20,
            value: 'Countertop Installation',
            label: 'Countertop Installation',
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
        project_title: 'Kitchen Cabinet Update',
        project_type: 'Remodel',
        project_subtype: 'Kitchen Remodel',
        description:
          'Install new kitchen cabinets and hardware with minor trim adjustments. No layout changes, demolition, plumbing, or electrical work.',
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

  await page.getByTestId('step1-job-description-input').fill(
    'Install new kitchen cabinets and hardware only with minor trim touchups'
  );
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });

  await expect(page.locator('select[name="project_subtype"]')).toHaveValue(
    'Cabinet Installation'
  );
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue(
    'Cabinet Installation'
  );
  await expect(page.locator('select[name="project_subtype"]')).not.toHaveValue(
    'Kitchen Remodel'
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

  const workflowPanel = page.getByTestId('step2-workflow-panel');
  await expect(workflowPanel).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Residential Milestone Planner' })).toHaveCount(1);
  await expect(page.getByText('Project window', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Project window:', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Keep the plan easy to review with homeowner-friendly milestones, pricing, and timing.')).toHaveCount(0);
  await expect(page.getByText('Deposit and materials')).toBeVisible();
  await page.getByTestId('step2-save-as-template').click();
  await expect(page.getByText('Save Agreement as Template')).toBeVisible();
  await expect(page.getByTestId('save-template-name-input')).toBeVisible();
  await expect(page.getByPlaceholder('e.g., Bedroom Addition - Standard 6 Milestone')).toBeVisible();
});

test('agreement wizard step 2 auto-drafts default subtype milestones when clarifications are skipped', async ({
  page,
}) => {
  const agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Kitchen Remodel',
    title: 'Kitchen Remodel',
    project_type: 'Remodel',
    project_subtype: 'Kitchen Remodel',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description:
      'Full kitchen remodel with demolition, cabinet replacement, countertop installation, appliance reconnects, plumbing, electrical, and finish work.',
    homeowner: null,
    status: 'draft',
    ai_scope: {
      answers: {},
    },
    compliance_warning: {
      warning_level: 'none',
      message: '',
    },
  };

  const milestoneState = {
    items: [],
    nextId: 900,
    createCount: 0,
  };

  await installStep2AutoDraftRoutes(page, {
    agreement,
    projectTypes: [{ id: 7, value: 'Remodel', label: 'Remodel', owner_type: 'system' }],
    projectSubtypes: [
      {
        id: 18,
        value: 'Kitchen Remodel',
        label: 'Kitchen Remodel',
        owner_type: 'system',
        project_type: 'Remodel',
      },
    ],
    milestoneState,
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  await expect.poll(() => milestoneState.createCount).toBe(5);
  await expect(page.getByText('Planning & protection')).toBeVisible();
  await expect(page.getByText('Demolition & rough-in')).toBeVisible();
  await expect(page.getByText('Cabinets & surfaces')).toBeVisible();
  await expect(page.getByText('Punch list & walkthrough')).toBeVisible();
  await expect(page.getByTestId('step2-ai-autodraft-banner')).toBeVisible();
});

test('agreement wizard step 2 uses clarification answers to shape kitchen milestone drafts', async ({
  page,
}) => {
  const agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Kitchen Remodel',
    title: 'Kitchen Remodel',
    project_type: 'Remodel',
    project_subtype: 'Kitchen Remodel',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description:
      'Full kitchen remodel with demolition, cabinet replacement, countertop installation, appliance reconnects, plumbing, electrical, and finish work.',
    homeowner: null,
    status: 'draft',
    ai_scope: {
      answers: {
        layout_changes: 'yes',
        cabinet_scope: 'no',
        finish_scope_notes: 'backsplash, pendant lighting, and quartz countertops',
      },
    },
    compliance_warning: {
      warning_level: 'none',
      message: '',
    },
  };

  const milestoneState = {
    items: [],
    nextId: 930,
    createCount: 0,
  };

  await installStep2AutoDraftRoutes(page, {
    agreement,
    projectTypes: [{ id: 7, value: 'Remodel', label: 'Remodel', owner_type: 'system' }],
    projectSubtypes: [
      {
        id: 18,
        value: 'Kitchen Remodel',
        label: 'Kitchen Remodel',
        owner_type: 'system',
        project_type: 'Remodel',
      },
    ],
    milestoneState,
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step2-ai-autodraft-banner')).toBeVisible();
  await expect(page.getByText('Layout review & utility changes')).toBeVisible();
  await expect(page.getByText('Selective demolition & rough-in')).toBeVisible();
  await expect(page.getByText('Countertops, surfaces & finishes')).toBeVisible();
  await page.getByText('Fixtures & appliances').click();
  await expect(page.getByText('Included finish scope: backsplash, pendant lighting, and quartz countertops.')).toBeVisible();
  await expect(page.getByText('Cabinets & surfaces')).toHaveCount(0);
  await expect.poll(() => milestoneState.createCount).toBe(6);
});

test('agreement wizard step 2 auto-drafts focused install milestones for cabinet installation projects', async ({
  page,
}) => {
  const agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Cabinet Installation',
    title: 'Cabinet Installation',
    project_type: 'Cabinetry',
    project_subtype: 'Cabinet Installation',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description:
      'Install new kitchen cabinets and hardware with minor trim adjustments and final fit checks.',
    homeowner: null,
    status: 'draft',
    compliance_warning: {
      warning_level: 'none',
      message: '',
    },
  };

  const milestoneState = {
    items: [],
    nextId: 950,
    createCount: 0,
  };

  await installStep2AutoDraftRoutes(page, {
    agreement,
    projectTypes: [{ id: 9, value: 'Cabinetry', label: 'Cabinetry', owner_type: 'system' }],
    projectSubtypes: [
      {
        id: 19,
        value: 'Cabinet Installation',
        label: 'Cabinet Installation',
        owner_type: 'system',
        project_type: 'Cabinetry',
      },
    ],
    milestoneState,
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step2-ai-autodraft-banner')).toBeVisible();
  await expect(page.getByText('Measurements & prep')).toBeVisible();
  await expect(page.getByText('Cabinet installation', { exact: true })).toBeVisible();
  await expect(page.getByText('Hardware & adjustments')).toBeVisible();
  await expect(page.getByText('Final walkthrough')).toBeVisible();
  await page.getByText('Cabinet installation', { exact: true }).click();
  await expect(page.getByText('Install and secure new cabinets in the planned configuration.')).toBeVisible();
  await expect(page.getByText('Demolition & rough-in')).toHaveCount(0);
  await expect.poll(() => milestoneState.createCount).toBe(4);
});

test('agreement wizard step 2 adds optional cabinet milestones when clarified scope includes demo and hardware', async ({
  page,
}) => {
  const agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Cabinet Installation',
    title: 'Cabinet Installation',
    project_type: 'Cabinetry',
    project_subtype: 'Cabinet Installation',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description:
      'Install new kitchen cabinets and hardware with minor trim adjustments and final fit checks.',
    homeowner: null,
    status: 'draft',
    ai_scope: {
      answers: {
        demo_required: 'yes',
        hardware_included: 'yes',
        cabinet_style_notes: 'full-height pantry wall and island base cabinets',
      },
    },
    compliance_warning: {
      warning_level: 'none',
      message: '',
    },
  };

  const milestoneState = {
    items: [],
    nextId: 965,
    createCount: 0,
  };

  await installStep2AutoDraftRoutes(page, {
    agreement,
    projectTypes: [{ id: 9, value: 'Cabinetry', label: 'Cabinetry', owner_type: 'system' }],
    projectSubtypes: [
      {
        id: 19,
        value: 'Cabinet Installation',
        label: 'Cabinet Installation',
        owner_type: 'system',
        project_type: 'Cabinetry',
      },
    ],
    milestoneState,
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step2-ai-autodraft-banner')).toBeVisible();
  await expect(page.getByText('Demo & site prep')).toBeVisible();
  await expect(page.getByText('Hardware, fillers & trim')).toBeVisible();
  await expect(page.getByText('Alignment & final adjustments')).toBeVisible();
  await page.getByText('Cabinet installation', { exact: true }).click();
  await expect(page.getByText('Layout details: full-height pantry wall and island base cabinets.')).toBeVisible();
  await expect.poll(() => milestoneState.createCount).toBe(6);
});

test('agreement wizard step 2 removes optional bathroom tile milestone rows when tile scope is excluded', async ({
  page,
}) => {
  const agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Bathroom Remodel',
    title: 'Bathroom Remodel',
    project_type: 'Remodel',
    project_subtype: 'Bathroom Remodel',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description:
      'Bathroom remodel with fixture updates, wall prep, and finish work but no tile replacement in wet areas.',
    homeowner: null,
    status: 'draft',
    ai_scope: {
      answers: {
        wet_area_tile: 'no',
      },
    },
    compliance_warning: {
      warning_level: 'none',
      message: '',
    },
  };

  const milestoneState = {
    items: [],
    nextId: 972,
    createCount: 0,
  };

  await installStep2AutoDraftRoutes(page, {
    agreement,
    projectTypes: [{ id: 7, value: 'Remodel', label: 'Remodel', owner_type: 'system' }],
    projectSubtypes: [
      {
        id: 17,
        value: 'Bathroom Remodel',
        label: 'Bathroom Remodel',
        owner_type: 'system',
        project_type: 'Remodel',
      },
    ],
    milestoneState,
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step2-ai-autodraft-banner')).toBeVisible();
  await page.getByText('Vanity, fixtures & trim').click();
  await expect(page.getByText('Include wall touch-up and non-tile surface prep needed before the fixture phase.')).toBeVisible();
  await expect(page.getByText('Tile & waterproofing finish')).toHaveCount(0);
  await expect(page.getByText('Walls, waterproofing & tile')).toHaveCount(0);
  await expect.poll(() => milestoneState.createCount).toBe(4);
});

test('agreement wizard step 2 does not overwrite milestones after the user edits them', async ({
  page,
}) => {
  const agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Kitchen Remodel',
    title: 'Kitchen Remodel',
    project_type: 'Remodel',
    project_subtype: 'Kitchen Remodel',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description:
      'Full kitchen remodel with demolition, cabinet replacement, countertop installation, appliance reconnects, plumbing, electrical, and finish work.',
    homeowner: null,
    status: 'draft',
    compliance_warning: {
      warning_level: 'none',
      message: '',
    },
  };

  const milestoneState = {
    items: [],
    nextId: 980,
    createCount: 0,
  };

  await installStep2AutoDraftRoutes(page, {
    agreement,
    projectTypes: [{ id: 7, value: 'Remodel', label: 'Remodel', owner_type: 'system' }],
    projectSubtypes: [
      {
        id: 18,
        value: 'Kitchen Remodel',
        label: 'Kitchen Remodel',
        owner_type: 'system',
        project_type: 'Remodel',
      },
    ],
    milestoneState,
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByText('Planning & protection')).toBeVisible();
  await expect.poll(() => milestoneState.createCount).toBe(5);

  await page.getByTestId('step2-milestone-card-801').getByRole('button', { name: 'Edit' }).click();
  const editModal = page.getByTestId('step2-edit-milestone-modal');
  await expect(editModal).toBeVisible();
  await editModal.getByTestId('step2-edit-milestone-title').fill('Custom planning milestone');
  await editModal.getByRole('button', { name: 'Save Changes' }).click();

  await expect(page.getByText('Custom planning milestone')).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Custom planning milestone')).toBeVisible();
  await expect(page.getByTestId('step2-ai-autodraft-banner')).toHaveCount(0);
  await expect.poll(() => milestoneState.createCount).toBe(5);
});

test('maintenance agreement fields render in step 1 and recurring summary appears in step 2', async ({
  page,
}) => {
  let agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: '',
    title: '',
    project_type: '',
    project_subtype: '',
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
    description: '',
    step_status: 'step1',
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
  const patchPayloads = [];

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
        patchPayloads.push(payload);
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

  await expect(page.getByTestId('step1-start-mode-chooser')).toBeVisible();
  await page.getByTestId('step1-job-description-input').fill(
    'Quarterly HVAC maintenance agreement'
  );
  await page.getByTestId('step1-find-best-starting-point-button').click();
  await page.getByTestId('step1-build-agreement-ai-button').click();
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('maintenance-settings-card')).toBeVisible();
  await page.getByText('Maintenance / Recurring Service').click();
  await page.getByTestId('maintenance-frequency-select').selectOption('quarterly');
  await page.getByTestId('maintenance-interval-input').fill('1');
  await page.getByTestId('maintenance-start-date-input').fill('2026-04-15');
  await expect(page.getByTestId('maintenance-summary')).toContainText(
    'Quarterly HVAC Maintenance'
  );

  await page.getByTestId('agreement-save-draft-button').dispatchEvent('click');
  await expect.poll(() =>
    patchPayloads.some(
      (payload) =>
        payload.recurrence_pattern === 'quarterly' &&
        payload.service_window_notes === 'Second Wednesday mornings.' &&
        payload.recurring_summary_label === 'Quarterly HVAC Maintenance'
    )
  ).toBeTruthy();

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveURL(/step=2/);
});

test('agreement wizard step 4 renders grouped summary and preserves send/sign flows', async ({
  page,
}) => {
  const patchPayloads = [];
  const signCalls = [];
  const sendCalls = [];
  const markPreviewedCalls = [];
  const events = { patchPayloads, signCalls, sendCalls, markPreviewedCalls };
  let agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Backyard Shed Build',
    title: 'Backyard Shed Build',
    description: 'Build a backyard shed with slab, framing, and cleanup.',
    project_class: 'residential',
    project_type: 'Residential',
    project_subtype: 'Shed Build',
    homeowner: 1,
    homeowner_name: 'Jordan Demo',
    homeowner_email: 'jordan@example.com',
    homeowner_phone: '555-555-5555',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    status: 'draft',
    pdf_version: 2,
    pdf_viewed: false,
    warranty_type: 'default',
    warranty_text_snapshot: '',
    require_contractor_signature: true,
    require_customer_signature: true,
    step_status: '4',
  };

  await installStep4FinalizeRoutes(page, {
    agreement,
    milestones: [
      {
        id: 1,
        agreement: AGREEMENT_ID,
        order: 1,
        title: 'Foundation',
        description: 'Set slab and base.',
        amount: '1200.00',
        start_date: '2026-04-29',
        due_date: '2026-04-30',
      },
      {
        id: 2,
        agreement: AGREEMENT_ID,
        order: 2,
        title: 'Framing',
        description: 'Build the shed frame.',
        amount: '2400.00',
        start_date: '2026-05-01',
        due_date: '2026-05-02',
      },
    ],
    fundingPreview: {
      project_amount: 3600,
      homeowner_escrow: 3600,
      escrow_funded: false,
      rate: 0.05,
      flat_fee: 1,
      fee_cap: 750,
    },
    events,
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=4`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step4-summary-agreement')).toBeVisible();
  await expect(page.getByTestId('step4-summary-customer')).toBeVisible();
  await expect(page.getByTestId('step4-summary-payment')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project Context' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review Scope Clarifications' })).toBeVisible();
  await expect(page.getByTestId('step4-header-actions')).toContainText('Review Scope Clarifications');
  await expect(page.getByTestId('agreement-wizard-view-pdf-button')).toBeVisible();
  await expect(page.getByTestId('agreement-wizard-view-pdf-button')).toContainText('View Agreement PDF');
  await expect(page.getByTestId('agreement-wizard-open-workspace-button')).toHaveCount(0);
  const signArea = page.getByRole('main');
  await expect(signArea.getByRole('button', { name: 'Open PDF' }).first()).toBeVisible();
  await expect(signArea.getByRole('button', { name: 'Download PDF' }).first()).toBeVisible();
  await expect(signArea.getByRole('link', { name: 'Terms of Service' })).toBeVisible();
  await expect(signArea.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();
  await expect(signArea.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
    'href',
    '/legal/terms-of-service/'
  );
  await expect(signArea.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
    'href',
    '/legal/privacy-policy/'
  );
  await expect(page.getByTestId('step4-legal-ack-checkbox')).toBeVisible();
  await expect(page.getByTestId('step4-sign-continue-button')).toBeDisabled();
  await expect(page.getByText('? Review Agreement PDF')).toBeVisible();
  await expect(page.getByTestId('step4-summary-agreement')).toContainText('Agreement Version');
  await expect(page.getByTestId('step4-summary-agreement')).toContainText('PDF Version');
  await expect(page.getByTestId('step4-summary-customer')).toContainText('Customer Email');
  await expect(page.getByTestId('step4-summary-payment')).toContainText('Payment Mode');
  await expect(page.getByTestId('step4-summary-payment')).toContainText('Escrow');
  await expect(page.getByTestId('step4-warranty-summary')).toBeVisible();
  await expect(page.getByTestId('step4-warranty-summary')).toContainText('Warranty');
  await expect(page.getByTestId('step4-warranty-summary')).toContainText(
    '12-Month Workmanship Warranty (Standard)'
  );
  await expect(page.getByText('Once both signatures are complete, the customer will be prompted to fund escrow.')).toBeVisible();

  await page.getByTestId('agreement-wizard-view-pdf-button').click();
  await expect(page).toHaveURL(/step=4/);
  await expect.poll(() => markPreviewedCalls.length).toBe(1);

  await expect(page.getByText('? Review Agreement PDF')).toBeVisible();
  await expect(signArea.locator('iframe, object')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open PDF' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF' }).first()).toBeVisible();
  await expect(page.getByTestId('step4-sign-continue-button')).toBeDisabled();
  await page.locator('input[placeholder="e.g. Jane Contractor"]').first().fill('Jordan Builder');
  await page.getByTestId('step4-legal-ack-checkbox').check();
  await expect(page.getByTestId('step4-sign-continue-button')).toBeDisabled();
  await page.getByRole('button', { name: 'Download PDF' }).first().click();
  await expect.poll(() => markPreviewedCalls.length).toBe(1);
  await expect(page.getByText('? Agreement PDF reviewed').first()).toBeVisible();
  await expect(page.getByTestId('step4-sign-continue-button')).toBeEnabled();

  await page.getByRole('button', { name: 'Direct Pay' }).click();
  await expect.poll(() => patchPayloads.some((payload) => payload.payment_mode === 'direct')).toBeTruthy();
  agreement = { ...agreement, payment_mode: 'direct' };
  await expect(page.getByTestId('step4-summary-payment')).toContainText('Direct Pay');

  await page.getByRole('button', { name: 'Escrow (Protected)' }).click();
  await expect.poll(() => patchPayloads.some((payload) => payload.payment_mode === 'escrow')).toBeTruthy();
  agreement = { ...agreement, payment_mode: 'escrow' };
  await expect(page.getByTestId('step4-summary-payment')).toContainText('Escrow');

  await expect(page.getByTestId('step4-sign-continue-button')).toBeEnabled();
  await page.getByRole('button', { name: 'Sign & Continue' }).click();
  const signerForm = page.locator('form').filter({ hasText: 'Draw Signature' });
  await expect(signerForm.getByText('Review Agreement (Required)')).toBeVisible();
  await expect(signerForm.getByText('Agreement Preview')).toHaveCount(0);
  await expect(signerForm.getByRole('button', { name: 'Open PDF' })).toBeVisible();
  await expect(signerForm.getByRole('button', { name: 'Download PDF' })).toBeVisible();
  await expect(signerForm.getByRole('link', { name: 'Terms of Service' })).toBeVisible();
  await expect(signerForm.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();
  await expect(signerForm.locator('input[type="checkbox"]')).toHaveCount(1);
  await expect(signerForm.locator('input[type="text"]')).toHaveValue('Jordan Builder');
  await expect(signerForm.getByRole('button', { name: 'Sign as Contractor' })).toBeDisabled();
  const signerCheckboxes = signerForm.locator('input[type="checkbox"]');
  await signerCheckboxes.check();

  const pad = signerForm.locator('canvas').first();
  const box = await pad.boundingBox();
  if (box) {
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
  }

  await page.getByRole('button', { name: 'Sign as Contractor' }).click();
  await expect.poll(() => signCalls.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Sign & Continue' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send to Customer' })).toBeVisible();

  await page.getByRole('button', { name: 'Send to Customer' }).click();
  await expect.poll(() => sendCalls.length).toBe(1);

  await page.getByRole('button', { name: 'Step 3 Warranty' }).click();
  await expect(page).toHaveURL(/step=3/);
  await page.getByRole('button', { name: 'Step 4 Finalize' }).click();
  await expect(page).toHaveURL(/step=4/);
  await expect(page.getByText('? Agreement PDF reviewed').first()).toBeVisible();
  await expect(page.getByTestId('step4-customer-send-success')).toBeVisible();
  await expect(page.getByTestId('step4-open-workspace-button')).toBeVisible();
  await expect(page.getByTestId('step4-copy-customer-link-button')).toBeVisible();
  await page.getByTestId('step4-open-workspace-button').click();
  await expect(page).toHaveURL(new RegExp(`/app/agreements/${AGREEMENT_ID}$`));
  await expect(page.getByRole('heading', { name: 'Contract Workspace' })).toBeVisible();
});

test('agreement wizard step 4 shows a custom warranty summary preview', async ({ page }) => {
  let agreement = {
    id: AGREEMENT_ID + 1,
    agreement_id: AGREEMENT_ID + 1,
    project_title: 'Backyard Shed Build',
    title: 'Backyard Shed Build',
    description: 'Build a backyard shed with slab, framing, and cleanup.',
    project_class: 'residential',
    project_type: 'Residential',
    project_subtype: 'Shed Build',
    homeowner: 1,
    homeowner_name: 'Jordan Demo',
    homeowner_email: 'jordan@example.com',
    homeowner_phone: '555-555-5555',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    status: 'draft',
    pdf_version: 2,
    pdf_viewed: false,
    warranty_type: 'custom',
    warranty_text_snapshot:
      'Custom warranty line one.\nCustom warranty line two.\nCustom warranty line three.\nCustom warranty line four.',
    require_contractor_signature: true,
    require_customer_signature: true,
    step_status: '4',
  };

  await installStep4FinalizeRoutes(page, {
    agreement,
    milestones: [
      {
        id: 1,
        agreement: AGREEMENT_ID + 1,
        order: 1,
        title: 'Foundation',
        description: 'Set slab and base.',
        amount: '1200.00',
        start_date: '2026-04-29',
        due_date: '2026-04-30',
      },
    ],
    fundingPreview: {
      project_amount: 1200,
      homeowner_escrow: 1200,
      escrow_funded: false,
      rate: 0.05,
      flat_fee: 1,
      fee_cap: 750,
    },
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID + 1}/wizard?step=4`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step4-warranty-summary')).toBeVisible();
  await expect(page.getByTestId('step4-warranty-summary')).toContainText('Custom Warranty');
  await expect(page.getByTestId('step4-warranty-summary')).toContainText('Custom warranty line one.');
  await expect(page.getByTestId('step4-warranty-summary')).toContainText('Custom warranty line two.');
  await expect(page.getByRole('button', { name: 'Sign & Continue' })).toBeDisabled();
});

test('agreement wizard step 4 shows pricing readiness guidance and send warnings', async ({
  page,
}) => {
  const agreement = {
    id: AGREEMENT_ID + 2,
    agreement_id: AGREEMENT_ID + 2,
    project_title: 'Pricing Readiness Project',
    title: 'Pricing Readiness Project',
    description: 'Finalize pricing for review.',
    project_class: 'residential',
    project_type: 'Residential',
    project_subtype: 'Kitchen Remodel',
    homeowner: 1,
    homeowner_name: 'Jordan Demo',
    homeowner_email: 'jordan@example.com',
    homeowner_phone: '555-555-5555',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    pricing_strategy: 'estimate',
    status: 'draft',
    pdf_version: 1,
    pdf_viewed: true,
    warranty_type: 'default',
    require_contractor_signature: true,
    require_customer_signature: true,
    step_status: '4',
  };

  await installStep4FinalizeRoutes(page, {
    agreement,
    milestones: [
      {
        id: 11,
        agreement: AGREEMENT_ID + 2,
        order: 1,
        title: 'Demo',
        description: 'Demo and prep work.',
        amount: '4000.00',
      },
      {
        id: 12,
        agreement: AGREEMENT_ID + 2,
        order: 2,
        title: 'Finish',
        description: 'Install and finish work.',
        amount: '6000.00',
      },
    ],
    fundingPreview: {
      project_amount: 10000,
      homeowner_escrow: 10000,
      escrow_funded: false,
      rate: 0.05,
      flat_fee: 1,
      fee_cap: 750,
    },
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID + 2}/wizard?step=4`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step4-pricing-readiness-panel')).toBeVisible();
  await expect(page.getByTestId('step4-pricing-readiness-panel')).toContainText('Next Step');
  await expect(page.getByTestId('step4-pricing-readiness-panel')).toContainText(
    'Good to send'
  );
  await expect(page.getByTestId('step4-pricing-readiness-panel')).toContainText('Estimated: 2');
  await expect(page.getByTestId('step4-pricing-readiness-panel')).toContainText('Pending quotes: 0');
  await expect(page.getByRole('button', { name: 'Send to Customer' })).toBeVisible();

  await page.getByRole('button', { name: 'Send to Customer' }).click();
  await expect(page.getByRole('button', { name: 'Send Anyway' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go Back' })).toBeVisible();

  await page.getByRole('button', { name: 'Go Back' }).click();
  await expect(
    page.getByText('Some pricing is estimated and may require adjustment later.')
  ).toHaveCount(0);
});

test('agreement wizard step 4 blocks sending when subcontractor quotes are pending', async ({
  page,
}) => {
  const agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Pending Quote Project',
    title: 'Pending Quote Project',
    description: 'Pricing still waiting on quotes.',
    project_class: 'residential',
    project_type: 'Residential',
    project_subtype: 'Kitchen Remodel',
    homeowner: 1,
    homeowner_name: 'Jordan Demo',
    homeowner_email: 'jordan@example.com',
    homeowner_phone: '555-555-5555',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    pricing_strategy: 'requires_sub_quote',
    status: 'draft',
    pdf_version: 1,
    pdf_viewed: true,
    warranty_type: 'default',
    require_contractor_signature: true,
    require_customer_signature: true,
    step_status: '4',
  };

  const milestoneWithPendingQuote = {
    id: 11,
    agreement: AGREEMENT_ID,
    order: 1,
    title: 'Demo',
    description: 'Demo and prep work.',
    amount: '4000.00',
    subcontractor_quote_request: {
      id: 9011,
      agreement_id: AGREEMENT_ID,
      milestone_id: 11,
      status: 'sent',
      status_label: 'Sent',
      contractor_message: 'Please quote this milestone.',
      quoted_amount: '',
      subcontractor_message: '',
      scope_snapshot: {
        milestone_title: 'Demo',
        milestone_description: 'Demo and prep work.',
      },
      linked_subcontractor_milestone_agreement: null,
      can_respond: true,
      can_accept: true,
      can_decline: true,
      can_request_revision: true,
      can_cancel: true,
      is_active: true,
    },
  };

  await installStep4FinalizeRoutes(page, {
    agreement,
    milestones: [
      milestoneWithPendingQuote,
    ],
    fundingPreview: {
      project_amount: 4000,
      homeowner_escrow: 4000,
      escrow_funded: false,
      rate: 0.05,
      flat_fee: 1,
      fee_cap: 750,
    },
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=4`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step4-pricing-readiness-panel')).toContainText(
    'Needs attention'
  );
  await expect(page.getByTestId('step4-pricing-readiness-panel')).toContainText('Next Step');
  await expect(page.getByTestId('step4-pricing-readiness-panel')).toContainText('Pending quotes: 1');
  await expect(page.getByTestId('step4-pricing-readiness-panel')).toContainText(
    '1 milestone is still waiting on subcontractor pricing.'
  );
  await expect(page.getByTestId('step4-resolve-quotes-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send to Customer' })).toBeDisabled();
});

test('agreement wizard step 4 blocks sending when requires_sub_quote has no accepted quote yet', async ({
  page,
}) => {
  const agreement = {
    id: AGREEMENT_ID + 20,
    agreement_id: AGREEMENT_ID + 20,
    project_title: 'Unresolved Quote Project',
    title: 'Unresolved Quote Project',
    description: 'Pricing still needs an accepted subcontractor quote.',
    project_class: 'residential',
    project_type: 'Residential',
    project_subtype: 'Kitchen Remodel',
    homeowner: 1,
    homeowner_name: 'Jordan Demo',
    homeowner_email: 'jordan@example.com',
    homeowner_phone: '555-555-5555',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    pricing_strategy: 'requires_sub_quote',
    status: 'draft',
    pdf_version: 1,
    pdf_viewed: true,
    warranty_type: 'default',
    require_contractor_signature: true,
    require_customer_signature: true,
    step_status: '4',
  };

  await installStep4FinalizeRoutes(page, {
    agreement,
    milestones: [
      {
        id: 21,
        agreement: agreement.id,
        order: 1,
        title: 'Cabinet Install',
        description: 'Install cabinets and finish trim.',
        amount: '4000.00',
      },
    ],
    fundingPreview: {
      project_amount: 4000,
      homeowner_escrow: 4000,
      escrow_funded: false,
      rate: 0.05,
      flat_fee: 1,
      fee_cap: 750,
    },
  });

  await page.goto(`/app/agreements/${agreement.id}/wizard?step=4`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step4-pricing-readiness-panel')).toContainText(
    'This agreement requires subcontractor pricing before it can be sent.'
  );
  await expect(page.getByTestId('step4-resolve-quotes-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send to Customer' })).toBeDisabled();
});

test('agreement wizard step 4 allows sending after subcontractor quote is accepted', async ({
  page,
}) => {
  const agreement = {
    id: AGREEMENT_ID + 1,
    agreement_id: AGREEMENT_ID + 1,
    project_title: 'Quote Accepted Project',
    title: 'Quote Accepted Project',
    description: 'Pricing is locked after quote acceptance.',
    project_class: 'residential',
    project_type: 'Residential',
    project_subtype: 'Kitchen Remodel',
    homeowner: 1,
    homeowner_name: 'Jordan Demo',
    homeowner_email: 'jordan@example.com',
    homeowner_phone: '555-555-5555',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    pricing_strategy: 'requires_sub_quote',
    status: 'draft',
    pdf_version: 1,
    pdf_viewed: true,
    warranty_type: 'default',
    require_contractor_signature: true,
    require_customer_signature: true,
    step_status: '4',
  };

  await installStep4FinalizeRoutes(page, {
    agreement,
    milestones: [
      {
        id: 21,
        agreement: agreement.id,
        order: 1,
        title: 'Demo',
        description: 'Demo and prep work.',
        amount: '4000.00',
        subcontractor_quote_request: {
          id: 9021,
          agreement_id: agreement.id,
          milestone_id: 21,
          status: 'accepted',
          status_label: 'Accepted',
          quoted_amount: '3800.00',
          contractor_message: 'Please quote this milestone.',
          subcontractor_message: 'Happy to do it.',
          linked_subcontractor_milestone_agreement: {
            id: 77,
            payment_release_mode: 'manual_release',
            payment_release_mode_label: 'Manual Release',
            agreed_pay: '3800.00',
          },
          is_active: false,
        },
      },
    ],
    fundingPreview: {
      project_amount: 4000,
      homeowner_escrow: 4000,
      escrow_funded: false,
      rate: 0.05,
      flat_fee: 1,
      fee_cap: 750,
    },
  });

  await page.goto(`/app/agreements/${agreement.id}/wizard?step=4`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step4-pricing-readiness-panel')).toContainText('Next Step');
  await expect(page.getByTestId('step4-pricing-readiness-panel')).toContainText('Good to send');
  await expect(page.getByRole('button', { name: 'Send to Customer' })).toBeEnabled();
});

test('agreement wizard step 4 shows missing warranty as a warning state', async ({ page }) => {
  let agreement = {
    id: AGREEMENT_ID + 2,
    agreement_id: AGREEMENT_ID + 2,
    project_title: 'Backyard Shed Build',
    title: 'Backyard Shed Build',
    description: 'Build a backyard shed with slab, framing, and cleanup.',
    project_class: 'residential',
    project_type: 'Residential',
    project_subtype: 'Shed Build',
    homeowner: 1,
    homeowner_name: 'Jordan Demo',
    homeowner_email: 'jordan@example.com',
    homeowner_phone: '555-555-5555',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    status: 'draft',
    pdf_version: 2,
    pdf_viewed: false,
    warranty_type: 'none',
    warranty_text_snapshot: '',
    require_contractor_signature: true,
    require_customer_signature: true,
    step_status: '4',
  };

  await installStep4FinalizeRoutes(page, {
    agreement,
    milestones: [
      {
        id: 1,
        agreement: AGREEMENT_ID + 2,
        order: 1,
        title: 'Foundation',
        description: 'Set slab and base.',
        amount: '1200.00',
        start_date: '2026-04-29',
        due_date: '2026-04-30',
      },
    ],
    fundingPreview: {
      project_amount: 1200,
      homeowner_escrow: 1200,
      escrow_funded: false,
      rate: 0.05,
      flat_fee: 1,
      fee_cap: 750,
    },
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID + 2}/wizard?step=4`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step4-warranty-summary')).toBeVisible();
  await expect(page.getByTestId('step4-warranty-summary')).toContainText('No warranty provided');
});

test('agreement detail shows a draft notice and can return to the wizard', async ({ page }) => {
  const agreement = {
    id: AGREEMENT_ID + 3,
    agreement_id: AGREEMENT_ID + 3,
    project_title: 'Backyard Shed Build',
    title: 'Backyard Shed Build',
    description: 'Build a backyard shed with slab, framing, and cleanup.',
    project_class: 'residential',
    project_type: 'Residential',
    project_subtype: 'Shed Build',
    homeowner: 1,
    homeowner_name: 'Jordan Demo',
    homeowner_email: 'jordan@example.com',
    homeowner_phone: '555-555-5555',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    status: 'draft',
    pdf_version: 2,
    pdf_viewed: false,
    warranty_type: 'default',
    warranty_text_snapshot: '',
    require_contractor_signature: true,
    require_customer_signature: true,
    step_status: '4',
  };

  await installStep4FinalizeRoutes(page, {
    agreement,
    milestones: [],
    fundingPreview: {
      project_amount: 0,
      homeowner_escrow: 0,
      escrow_funded: false,
      rate: 0.05,
      flat_fee: 1,
      fee_cap: 750,
    },
  });

  await page.route(
    new RegExp(`/api/projects/agreements/${agreement.id}/attachments/?(\\?.*)?$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    }
  );

  await page.route(
    new RegExp(`/api/projects/agreements/${agreement.id}/subcontractor-invitations/?(\\?.*)?$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pending_invitations: [],
          accepted_subcontractors: [],
        }),
      });
    }
  );

  await page.route('**/api/projects/subaccounts/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/warranties/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.goto(`/app/agreements/${agreement.id}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByRole('heading', { name: 'Contract Workspace' })).toBeVisible();
  await expect(page.getByTestId('agreement-detail-draft-notice')).toBeVisible();
  await expect(page.getByTestId('agreement-detail-back-to-wizard-button')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Assignment / Team' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Milestones' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Secondary Details' })).toBeVisible();

  await page.getByTestId('agreement-detail-back-to-wizard-button').click();
  await expect(page).toHaveURL(/\/wizard\?step=\d+/);
});
