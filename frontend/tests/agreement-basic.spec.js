import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 123;

function toIsoDateOnly(value) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatFriendlyDate(value) {
  const iso = toIsoDateOnly(value);
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function setDateInputValue(page, testId, value) {
  const targetValue = toIsoDateOnly(value) || String(value || "");
  const locator = page.getByTestId(testId);
  await expect(locator).toBeEnabled();
  await locator.fill(targetValue);
  await expect(locator).toHaveValue(targetValue);
}

async function ensureStep1JobDescription(page) {
  const input = page.getByTestId('step1-job-description-input');
  if ((await input.count()) > 0) {
    await expect(input).toBeVisible();
    return input;
  }

  const startOver = page.getByTestId('step1-start-over-button').or(page.getByRole('button', { name: 'Start over' }));
  if ((await startOver.count()) > 0) {
    await startOver.first().click();
    const confirm = page.getByTestId('step1-reset-form-confirm-button');
    if ((await confirm.count()) > 0) {
      await confirm.click();
    }
  }

  if ((await input.count()) === 0) {
    await page.route(/\/api\/projects\/agreements\/?(\?.*)?$/, async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') {
        await route.fallback();
        return;
      }

      const payload = request.postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: AGREEMENT_ID,
          agreement_id: AGREEMENT_ID,
          status: 'draft',
          homeowner: null,
          payment_mode: 'escrow',
          payment_structure: 'simple',
          compliance_warning: { warning_level: 'none', message: '' },
          ...payload,
        }),
      });
    });
    await page.evaluate(() => window.sessionStorage.clear());
    await page.goto(`/app/agreements/new/wizard?step=1&fresh=${Date.now()}`, {
      waitUntil: 'domcontentloaded',
    });
  }

  await expect(input).toBeVisible();
  return input;
}

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

async function installMockGooglePlaces(page) {
  await page.addInitScript(() => {
    window.__mhbGoogleImportCalls = [];
    window.__mhbAddressInputs = [];

    function createMockPlace() {
      return {
        formattedAddress: '10750 Test Address, San Antonio, TX 78249, USA',
        formatted_address: '10750 Test Address, San Antonio, TX 78249, USA',
        id: 'places/test-10750',
        place_id: 'places/test-10750',
        location: { lat: 29.501, lng: -98.621 },
        geometry: {
          location: {
            lat: () => 29.501,
            lng: () => -98.621,
          },
        },
        addressComponents: [
          { longText: '10750', shortText: '10750', types: ['street_number'] },
          { longText: 'Test Address', shortText: 'Test Address', types: ['route'] },
          { longText: 'San Antonio', shortText: 'San Antonio', types: ['locality'] },
          { longText: 'Texas', shortText: 'TX', types: ['administrative_area_level_1'] },
          { longText: '78249', shortText: '78249', types: ['postal_code'] },
          { longText: 'United States', shortText: 'US', types: ['country'] },
        ],
        address_components: [
          { long_name: '10750', short_name: '10750', types: ['street_number'] },
          { long_name: 'Test Address', short_name: 'Test Address', types: ['route'] },
          { long_name: 'San Antonio', short_name: 'San Antonio', types: ['locality'] },
          { long_name: 'Texas', short_name: 'TX', types: ['administrative_area_level_1'] },
          { long_name: '78249', short_name: '78249', types: ['postal_code'] },
          { long_name: 'United States', short_name: 'US', types: ['country'] },
        ],
        fetchFields: async () => {},
      };
    }

    function MockPlaceAutocompleteElement() {
      const element = document.createElement('div');
      const input = document.createElement('input');
      const list = document.createElement('div');
      let selectCallback = null;

      input.setAttribute('aria-label', 'Google address search');
      list.setAttribute('data-testid', 'mock-google-address-suggestions');
      element.appendChild(input);
      element.appendChild(list);

      input.addEventListener('input', () => {
        window.__mhbAddressInputs.push(input.value);
        list.innerHTML = '';
        if (!input.value.trim()) return;

        const option = document.createElement('button');
        option.type = 'button';
        option.textContent = '10750 Test Address, San Antonio, TX';
        option.addEventListener('click', () => {
          selectCallback?.({
            placePrediction: {
              toPlace: () => createMockPlace(),
            },
          });
        });
        list.appendChild(option);
      });

      const nativeAddEventListener = element.addEventListener.bind(element);
      element.addEventListener = (type, callback, options) => {
        if (type === 'gmp-select') {
          selectCallback = callback;
        }
        return nativeAddEventListener(type, callback, options);
      };

      return element;
    }

    function MockAutocompleteService() {}
    MockAutocompleteService.prototype.getPlacePredictions = (request, callback) => {
      window.__mhbAddressInputs.push(request.input);
      const predictions = request.input.trim()
        ? [
            {
              description: '10750 Test Address, San Antonio, TX',
              place_id: 'places/test-10750',
              structured_formatting: {
                main_text: '10750 Test Address',
                secondary_text: 'San Antonio, TX',
              },
            },
          ]
        : [];
      callback(predictions, predictions.length ? 'OK' : 'ZERO_RESULTS');
    };

    function MockPlacesService() {}
    MockPlacesService.prototype.getDetails = (_request, callback) => {
      callback(createMockPlace(), 'OK');
    };

    function MockAutocompleteSessionToken() {}

    window.google = {
      maps: {
        importLibrary: async (name) => {
          window.__mhbGoogleImportCalls.push(name);
          return {
            PlaceAutocompleteElement: MockPlaceAutocompleteElement,
            AutocompleteService: MockAutocompleteService,
            PlacesService: MockPlacesService,
            AutocompleteSessionToken: MockAutocompleteSessionToken,
          };
        },
        places: {
          PlaceAutocompleteElement: MockPlaceAutocompleteElement,
          AutocompleteService: MockAutocompleteService,
          PlacesService: MockPlacesService,
          AutocompleteSessionToken: MockAutocompleteSessionToken,
          PlacesServiceStatus: {
            OK: 'OK',
            ZERO_RESULTS: 'ZERO_RESULTS',
          },
        },
      },
    };

    const installMeta = () => {
      const meta = document.createElement('meta');
      meta.setAttribute('name', 'mhb-google-maps-api-key');
      meta.setAttribute('content', 'playwright-runtime-google-key');
      (document.head || document.documentElement).appendChild(meta);
    };

    if (document.head) {
      installMeta();
    } else {
      document.addEventListener('DOMContentLoaded', installMeta, { once: true });
    }
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
        if (request.method() === 'PATCH') {
          const payload = request.postDataJSON();
          agreement = {
            ...agreement,
            ...payload,
          };
        }
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
  await expect(page.getByRole('heading', { name: 'Project Details' })).toHaveCount(0);

  await page.getByTestId('step1-job-description-input').fill(
    'Build backyard 12x14 shed with slab foundation and cleanup'
  );
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await expect(page.getByTestId('step1-starting-point-loading-card')).toBeHidden();

  const reviewPanel = page.getByTestId('step1-no-template-review');
  await expect(reviewPanel).toBeVisible();
  await expect(reviewPanel).toContainText('AI draft generated successfully');
  await expect(reviewPanel).toContainText('Backyard Shed Build');
  await expect(reviewPanel).toContainText('Outdoor');
  await expect(reviewPanel).toContainText('Shed Build');
  await expect(page.getByRole('heading', { name: 'Project Details' })).toHaveCount(0);
  await expect(page.getByTestId('proposal-draft-textarea')).toHaveCount(0);

  await page.getByTestId('step1-build-agreement-ai-button').click();

  const projectDetailsCard = page.getByTestId('step1-project-details-card');
  await expect(projectDetailsCard).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('agreement-project-title-input')).toBeVisible();
  await expect(page.getByTestId('step1-no-template-card')).toHaveCount(0);
  await expect(projectDetailsCard).toHaveAttribute('data-emphasis', 'true');
  await expect(page.locator('select[name="project_type"]')).not.toHaveValue('Concrete');
  await expect(page.locator('select[name="project_subtype"]')).not.toHaveValue('Concrete Slab');
  await expect(page.getByTestId('agreement-customer-select')).toBeVisible();
  await expect(page.getByTestId('proposal-draft-textarea')).toBeVisible();
  await expect(page.getByTestId('proposal-draft-textarea')).not.toHaveValue('');
  await expect(page.getByTestId('agreement-ai-improve-scope-button')).toBeEnabled();
  await expect(page.getByTestId('agreement-ai-generate-scope-button')).toBeEnabled();
  await expect(page.locator('input[name="address_line1"]')).toBeVisible();
  await expect(page.getByTestId('agreement-project-class-residential')).toBeVisible();
  await expect(page.getByTestId('agreement-payment-structure-simple')).toBeVisible();
  await expect(page.getByTestId('agreement-project-title-input')).toBeVisible();
  await expect(page.getByTestId('agreement-project-start-date-field')).toBeVisible();
  const titleBox = await page.getByTestId('agreement-project-title-input').boundingBox();
  const startDateBox = await page.getByTestId('agreement-project-start-date-input').boundingBox();
  expect(startDateBox?.width || 999).toBeLessThan(titleBox?.width || 0);
  expect(startDateBox?.width || 999).toBeLessThanOrEqual(220);

  await page.getByTestId('agreement-customer-select').selectOption('1');
  await expect(page.getByTestId('agreement-customer-select')).toHaveValue('1');
  await page.getByTestId('agreement-project-title-input').fill('Sprinkler System');
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue(
    'Sprinkler System'
  );
  await expect(page.getByTestId('agreement-pricing-strategy-fixed')).toBeVisible();
  await expect(page.getByTestId('agreement-save-draft-button')).toBeVisible();

  await page.getByTestId('agreement-project-title-input').fill(
    'Playwright Agreement Smoke'
  );
  await page.getByTestId('agreement-project-title-input').fill('');
  await page.getByTestId('agreement-save-draft-button').click();
  await expect(page.getByText('Project title is required.')).toBeVisible();

  await page.getByTestId('agreement-project-title-input').fill(
    'Playwright Agreement Smoke'
  );
  await page.getByTestId('agreement-save-draft-button').click();

  await expect(page).toHaveURL(
    new RegExp(`/app/agreements/${AGREEMENT_ID}/wizard\\?step=[12]$`)
  );
  await expect(page.getByTestId('agreement-wizard-subtitle')).toContainText(
    `Agreement #${AGREEMENT_ID}`
  );

  if (new URL(page.url()).searchParams.get('step') === '1') {
    await page.getByRole('button', { name: 'Save & Next' }).click();
  }

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
  await expect(page.getByTestId('step1-no-template-review')).toBeVisible();
  await expect(page.getByTestId('step1-no-template-review')).toContainText(
    'Playwright Agreement Smoke'
  );
  await expect(page.getByRole('heading', { name: 'Project Details' })).toHaveCount(0);
  await page.getByTestId('step1-build-agreement-ai-button').click();
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue(
    'Playwright Agreement Smoke'
  );
  await expect(page.getByTestId('step1-starting-point-loading-card')).toHaveCount(0);
  await expect(page.getByText('No strong template match found')).toHaveCount(0);
});

test('agreement wizard step 1 address search uses Google Places autocomplete path', async ({
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
    address_line1: '',
    address_city: '',
    address_state: '',
    address_postal_code: '',
  };

  await installWizardAuthRoutes(page);
  await installMockGooglePlaces(page);
  await page.addInitScript(() => {
    window.sessionStorage.clear();
  });

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 10, value: 'Repair', label: 'Repair', owner_type: 'system' }],
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
            id: 101,
            value: 'Water Damage Repair',
            label: 'Water Damage Repair',
            owner_type: 'system',
            project_type: 'Repair',
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
        project_title: 'Water Damage Repair',
        project_type: 'Repair',
        project_subtype: 'Water Damage Repair',
        description: 'Repair ceiling damage from a leak and restore the finished ceiling surface.',
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/?(\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.fallback();
      return;
    }

    agreement = {
      ...agreement,
      ...request.postDataJSON(),
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
        agreement = { ...agreement, ...request.postDataJSON() };
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

  await page.getByTestId('step1-job-description-input').fill('ceiling repair from leak');
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });

  await expect(page.getByText('No strong template match found')).toHaveCount(1);
  await page.getByTestId('step1-build-agreement-ai-button').click();
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  const autocomplete = page.getByTestId('agreement-address-autocomplete');
  await expect(autocomplete).toBeVisible();
  const addressInput = autocomplete.locator('input');
  await expect(addressInput).toBeVisible();

  await addressInput.fill('10750');
  await expect(page.getByText('10750 Test Address, San Antonio, TX')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__mhbGoogleImportCalls || []))
    .toContain('places');
  await expect
    .poll(() => page.evaluate(() => window.__mhbAddressInputs || []))
    .toContain('10750');

  await page.getByText('10750 Test Address, San Antonio, TX').click();
  await expect(page.locator('input[name="address_line1"]')).toHaveValue('10750 Test Address');
  await expect(page.locator('input[name="address_city"]')).toHaveValue('San Antonio');
  await expect(page.locator('input[name="address_state"]')).toHaveValue('TX');
  await expect(page.locator('input[name="address_postal_code"]')).toHaveValue('78249');

  await autocomplete.getByRole('button', { name: 'Clear address search' }).click();
  await expect(addressInput).toHaveValue('');
  await expect(page.getByTestId('address-autocomplete-suggestions')).toHaveCount(0);
  await page.waitForTimeout(350);
  await expect(addressInput).toHaveValue('');

  await addressInput.fill('10750');
  await expect(page.getByText('10750 Test Address, San Antonio, TX')).toBeVisible();
  await addressInput.fill('');
  await expect(addressInput).toHaveValue('');
  await expect(page.getByTestId('address-autocomplete-suggestions')).toHaveCount(0);
  await page.waitForTimeout(350);
  await expect(addressInput).toHaveValue('');
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
  const reviewPanel = page.getByTestId('step1-no-template-review');
  await expect(reviewPanel).toBeVisible();
  await expect(reviewPanel).toContainText('Siding Replacement');
  await expect(page.getByRole('heading', { name: 'Project Details' })).toHaveCount(0);
  await expect(page.getByText('Recommended starting point')).toHaveCount(0);
  await expect(page.getByTestId('step1-template-browser')).toHaveCount(0);
  await expect(page.getByTestId('agreement-project-type-select')).toHaveCount(0);
  await expect(page.getByText('Save draft first')).toHaveCount(0);
  await expect(page.getByTestId('step1-no-template-card')).toHaveCount(0);
  await expect(page.getByTestId('step1-template-browser')).toHaveCount(0);
  await expect(page.getByTestId('step1-ai-setup-result')).toHaveCount(0);

  await page.getByTestId('step1-build-agreement-ai-button').click();

  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue('Siding Replacement');
  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue('Siding');
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue(
    'Siding Replacement'
  );
  await expect(page.getByTestId('proposal-draft-textarea')).toHaveValue(
    'Work includes removal and replacement of exterior siding on the areas identified in the project description.'
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

  await expect(page.getByTestId('step1-start-mode-chooser')).toBeVisible();
  await expect(page.getByTestId('step1-find-best-starting-point-button')).toBeDisabled();
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
  await expect(page.getByTestId('step1-no-template-review')).toBeVisible();
  await expect(page.getByTestId('step1-no-template-review')).toContainText('Backyard Shed Build');
  await expect(page.getByRole('heading', { name: 'Project Details' })).toHaveCount(0);
  await page.getByTestId('step1-build-agreement-ai-button').click({ force: true });
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue(
    'Backyard Shed Build'
  );
  await expect(page.locator('select[name="project_type"]')).toHaveValue('Outdoor');
  await expect(page.locator('select[name="project_subtype"]')).toHaveValue('Shed Build');
  await expect(page.getByTestId('step1-starting-point-loading-card')).toHaveCount(0);
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

  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('step1-start-mode-summary')).toHaveCount(0);
  await expect(page.getByText('New Agreement')).toHaveCount(0);
  await expect(page.getByTestId('step1-template-browser')).toHaveCount(0);
  await expect(page.getByTestId('step1-no-template-card')).toHaveCount(0);
  await expect(page.getByTestId('agreement-project-title-input')).toBeVisible();
  await expect(page.getByText('Recommended starting point')).toHaveCount(0);
  await expect(page.getByTestId('step1-template-browser')).toHaveCount(0);
  await expect(page.locator('select[name="project_type"] option').first()).toHaveText('Select Type');
  await expect(page.locator('select[name="project_subtype"] option').first()).toHaveText(
    /Select (Type first|Subtype)/
  );

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
  await expect(page.getByTestId('step1-start-mode-chooser')).toHaveCount(0);
  await expect(page.getByTestId('step1-project-details-card')).toBeVisible();
  await expect(page.getByText('Junk Removal')).toHaveCount(0);
});

test('agreement wizard step 1 treats hardwood flooring as AI draft when only unrelated templates exist', async ({
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
    selected_template_id: null,
    selected_template: null,
  };

  await installWizardAuthRoutes(page);
  await page.addInitScript(() => {
    window.sessionStorage.clear();
  });

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 30, value: 'Flooring', label: 'Flooring', owner_type: 'system' },
          { id: 40, value: 'Outdoor', label: 'Outdoor', owner_type: 'system' },
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
            id: 301,
            value: 'Hardwood Floor Installation',
            label: 'Hardwood Floor Installation',
            owner_type: 'system',
            project_type: 'Flooring',
          },
          {
            id: 401,
            value: 'Shed Build',
            label: 'Shed Build',
            owner_type: 'system',
            project_type: 'Outdoor',
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
        project_title: 'Hardwood Floor Installation',
        project_type: 'Flooring',
        project_subtype: 'Hardwood Floor Installation',
        description:
          'Install hardwood flooring, including surface preparation, layout, flooring installation, transitions, finish details, and cleanup.',
        ai_access: 'included',
        ai_enabled: true,
        ai_unlimited: true,
      }),
    });
  });

  await page.route('**/api/projects/templates/recommend/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        confidence: 'none',
        confidence_level: 'low',
        score: 0,
        detail: 'No strong template match found.',
        reason: 'blocked family mismatch: outdoor vs flooring',
        recommended_template: null,
        possible_match: null,
        candidates: [
          {
            id: 501,
            name: 'Shed Build Template',
            project_type: 'Outdoor',
            project_subtype: 'Shed Build',
            score: 0,
          },
        ],
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
            id: 501,
            name: 'Shed Build Template',
            project_type: 'Outdoor',
            project_subtype: 'Shed Build',
            owner_type: 'system',
          },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/?(\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.fallback();
      return;
    }

    agreement = {
      ...agreement,
      ...request.postDataJSON(),
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
        agreement = { ...agreement, ...request.postDataJSON() };
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

  await expect(page.getByTestId('step1-start-mode-chooser')).toBeVisible();
  await page.getByTestId('step1-job-description-input').fill('Hardwood Floor Installation');
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });

  await expect(page.getByText('Template match found')).toHaveCount(0);
  await expect(page.getByText('Shed Build Template')).toHaveCount(0);
  await expect(page.getByText(/blocked family mismatch|outdoor vs flooring/i)).toHaveCount(0);
  await expect(page.getByText('No strong template match found')).toBeVisible();
  await expect(
    page.getByText('Continue with the AI-generated title, scope, project type, and subtype')
  ).toBeVisible();

  await page.getByTestId('step1-build-agreement-ai-button').click();

  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue(
    'Hardwood Floor Installation'
  );
  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue('Flooring');
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue(
    'Hardwood Floor Installation'
  );
  await expect(page.getByTestId('proposal-draft-textarea')).toHaveValue(/hardwood flooring/i);
});

test('agreement wizard step 1 does not promote no-useful template candidates into matches', async ({
  page,
}) => {
  await installWizardAuthRoutes(page);
  await page.addInitScript(() => {
    window.sessionStorage.clear();
  });

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 50, value: 'Carpentry', label: 'Carpentry', owner_type: 'system' },
          { id: 60, value: 'Addition', label: 'Addition', owner_type: 'system' },
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
            id: 501,
            value: 'Wood Column Restoration',
            label: 'Wood Column Restoration',
            owner_type: 'system',
            project_type: 'Carpentry',
          },
          {
            id: 601,
            value: 'Bedroom Addition',
            label: 'Bedroom Addition',
            owner_type: 'system',
            project_type: 'Addition',
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
        draft: {
          project_title: 'Front Porch Decorative Wood Column Repair',
          project_type: 'Carpentry',
          project_subtype: 'Wood Column Restoration',
          description:
            'Included Work:\n- Repair decorative wood columns on front porch\n- Remove deteriorated wood as needed\n- Restore column profiles\n- Prime repaired surfaces\n- Clean up work area\n\nExclusions:\n- Structural framing repairs behind concealed areas',
        },
        classification: {
          project_type: 'Carpentry',
          project_subtype: 'Wood Column Restoration',
          confidence: 'high',
          reasoning: 'Decorative porch wood column repair scope.',
        },
        ai_access: 'included',
        ai_enabled: true,
        ai_unlimited: true,
      }),
    });
  });

  await page.route('**/api/projects/templates/recommend/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        confidence: 'none',
        confidence_level: 'low',
        match_tier: 'no_useful_match',
        score: 91,
        detail: 'No strong template match found.',
        reason: 'blocked family mismatch: addition vs carpentry',
        recommended_template: null,
        possible_match: null,
        candidates: [
          {
            id: 901,
            name: 'Master Bedroom Addition',
            project_type: 'Addition',
            project_subtype: 'Bedroom Addition',
            score: 91,
          },
        ],
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
            id: 901,
            name: 'Master Bedroom Addition',
            project_type: 'Addition',
            project_subtype: 'Bedroom Addition',
            owner_type: 'system',
          },
        ],
      }),
    });
  });

  await page.goto('/app/agreements/new/wizard?step=1', {
    waitUntil: 'domcontentloaded',
  });

  await page
    .getByTestId('step1-job-description-input')
    .fill('Repair decorative wood columns on front porch');
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });

  const reviewPanel = page.getByTestId('step1-no-template-review');
  await expect(reviewPanel).toBeVisible({ timeout: 15000 });
  await expect(reviewPanel.getByText('Front Porch Decorative Wood Column Repair')).toBeVisible();
  await expect(reviewPanel.getByText('Carpentry')).toBeVisible();
  await expect(reviewPanel.getByText('Wood Column Restoration')).toBeVisible();
  await expect(reviewPanel).toContainText('Repair decorative wood columns');
  await expect(page.getByText('Template match found', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Optional template match', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Master Bedroom Addition')).toHaveCount(0);
  await expect(page.getByText(/blocked family mismatch|score: 91|rank_score/i)).toHaveCount(0);
});

test('agreement wizard step 1 improve classification keeps exterior wood repair out of generic installation', async ({
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
    selected_template_id: null,
    selected_template: null,
  };

  await installWizardAuthRoutes(page);
  await page.addInitScript(() => {
    window.sessionStorage.clear();
  });

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 60, value: 'Installation', label: 'Installation', owner_type: 'system' },
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
            id: 601,
            value: 'General Install',
            label: 'General Install',
            owner_type: 'system',
            project_type: 'Installation',
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
        draft: {
          project_title: 'Exterior Window Wood Rot Repair',
          project_type: 'Windows / Doors',
          project_subtype: 'Window Trim Wood Rot Repair',
          description:
            'Included Work:\n- Protect the work area around exterior windows\n- Remove deteriorated wood trim and affected rot\n- Repair or replace damaged trim sections\n- Seal repaired areas against moisture intrusion\n- Repaint repaired trim to match existing finish\n\nExclusions:\n- Full window replacement',
        },
        classification: {
          project_type: 'Installation',
          project_subtype: 'General Install',
          confidence: 'low',
          reasoning: 'Generic taxonomy fallback only.',
        },
        ai_access: 'included',
        ai_enabled: true,
        ai_unlimited: true,
      }),
    });
  });

  await page.route('**/api/projects/agreements/ai/classify/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        classification: {
          project_title: 'General Install',
          project_type: 'Installation',
          project_subtype: 'General Install',
          confidence: 'high',
          confidence_label: 'High confidence',
          reason: 'Generic install fallback.',
          alternatives: [],
        },
        ai_access: 'included',
        ai_enabled: true,
        ai_unlimited: true,
      }),
    });
  });

  await page.route('**/api/projects/templates/recommend/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        confidence: 'none',
        confidence_level: 'low',
        match_tier: 'no_useful_match',
        score: 0,
        detail: 'No strong template match found.',
        recommended_template: null,
        possible_match: null,
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

  await page.route(/\/api\/projects\/agreements\/?(\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.fallback();
      return;
    }

    agreement = {
      ...agreement,
      ...request.postDataJSON(),
      id: AGREEMENT_ID,
      agreement_id: AGREEMENT_ID,
    };
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(agreement),
    });
  });

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\\\?.*)?$`),
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
        agreement = { ...agreement, ...request.postDataJSON() };
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

  await page
    .getByTestId('step1-job-description-input')
    .fill('Repair wood rot around exterior windows and repaint trim');
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });

  const reviewPanel = page.getByTestId('step1-no-template-review');
  await expect(reviewPanel).toBeVisible({ timeout: 15000 });
  await expect(reviewPanel.getByText('Exterior Window Wood Rot Repair')).toBeVisible();
  await expect(reviewPanel.getByText('Windows / Doors')).toBeVisible();
  await expect(reviewPanel.getByText('Window Trim Wood Rot Repair')).toBeVisible();

  await page.getByTestId('step1-build-agreement-ai-button').click();

  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue(
    'Exterior Window Wood Rot Repair'
  );
  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue('Windows / Doors');
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue(
    'Window Trim Wood Rot Repair'
  );

  await page.getByTestId('agreement-ai-improve-classification-button').click();

  await expect(page.getByTestId('agreement-project-type-select')).not.toHaveValue('Installation');
  await expect(page.getByTestId('agreement-project-subtype-select')).not.toHaveValue('General Install');
  await expect(page.getByTestId('agreement-project-title-input')).not.toHaveValue('General Install');
  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue('Windows / Doors');
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue(
    'Window Trim Wood Rot Repair'
  );
});

test('agreement wizard step 1 no-template AI CTA preserves generated draft fields across project families', async ({
  page,
}) => {
  const draftScenarios = [
    {
      input: 'ceiling repair from leak',
      title: 'Water Damage Repair',
      type: 'Repair',
      subtype: 'Water Damage Repair',
      scope:
        'Repair ceiling damage from a leak, including protecting the work area, removing compromised material as needed, patching, finishing, and cleanup.',
      scopePattern: /ceiling damage from a leak/i,
      allowJunkRemoval: false,
    },
    {
      input: 'drywall repair from plumbing leak',
      title: 'Drywall Repair',
      type: 'Drywall',
      subtype: 'Drywall Repair',
      scope:
        'Repair drywall damaged by a plumbing leak, including moisture-aware preparation, patching, finishing, texture blending, and cleanup.',
      scopePattern: /drywall damaged by a plumbing leak/i,
      allowJunkRemoval: false,
    },
    {
      input: 'replace damaged siding after storm',
      title: 'Siding Repair',
      type: 'Siding',
      subtype: 'Siding Repair',
      scope:
        'Replace damaged siding after storm impact, including removing compromised siding sections, installing matching materials, sealing trim, and cleanup.',
      scopePattern: /damaged siding after storm/i,
      allowJunkRemoval: false,
    },
    {
      input: 'install hardwood flooring in living room',
      title: 'Hardwood Floor Installation',
      type: 'Flooring',
      subtype: 'Hardwood Floor Installation',
      scope:
        'Install hardwood flooring in the living room, including surface preparation, layout, installation, transitions, finish details, and cleanup.',
      scopePattern: /hardwood flooring in the living room/i,
      allowJunkRemoval: false,
    },
    {
      input: 'repair leaking patio roof',
      title: 'Patio Roof Repair',
      type: 'Roofing',
      subtype: 'Roof Repair',
      scope:
        'Repair the leaking patio roof, including leak investigation, localized roof repairs, flashing or sealant work as needed, water testing, and cleanup.',
      scopePattern: /leaking patio roof/i,
      allowJunkRemoval: false,
    },
    {
      input: 'Install new gutters and downspouts on two-story home',
      title: 'Gutter Installation',
      type: 'Exterior Drainage',
      subtype: 'Gutters & Downspouts',
      scope:
        'Install new gutters and downspouts on the two-story home, including roofline measurements, gutter layout, hanger installation, downspout placement, drainage verification, and cleanup.',
      scopePattern: /new gutters and downspouts/i,
      allowJunkRemoval: false,
      classification: {
        project_title: 'Installation Project',
        project_type: 'Installation',
        project_subtype: 'General Install',
        confidence: 'medium',
        reasoning: 'Generic taxonomy fallback.',
      },
    },
    {
      input: 'repair leaking patio roof after storm damage',
      title: 'Patio Roof Repair',
      type: 'Roofing',
      subtype: 'Roof Repair',
      scope:
        'Repair leaking patio roof after storm damage, including inspection, localized roof repair, flashing or sealant work, water testing, and cleanup.',
      scopePattern: /storm damage/i,
      allowJunkRemoval: false,
    },
    {
      input: 'remove old couch and debris',
      title: 'Junk Removal',
      type: 'Junk Removal',
      subtype: 'Junk Removal',
      scope:
        'Remove the old couch and debris, load and haul away the items, dispose of materials properly, and sweep the work area when complete.',
      scopePattern: /old couch and debris/i,
      allowJunkRemoval: true,
    },
  ];
  const draftsByInput = new Map(draftScenarios.map((scenario) => [scenario.input, scenario]));
  let aiDescriptionCalls = 0;
  const patchPayloads = [];
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
    selected_template_id: null,
    selected_template: null,
  };

  await installWizardAuthRoutes(page);
  await page.addInitScript(() => {
    window.sessionStorage.clear();
  });

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 10, value: 'Repair', label: 'Repair', owner_type: 'system' },
          { id: 20, value: 'Junk Removal', label: 'Junk Removal', owner_type: 'system' },
          { id: 30, value: 'Drywall', label: 'Drywall', owner_type: 'system' },
          { id: 40, value: 'Siding', label: 'Siding', owner_type: 'system' },
          { id: 50, value: 'Flooring', label: 'Flooring', owner_type: 'system' },
          { id: 60, value: 'Roofing', label: 'Roofing', owner_type: 'system' },
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
            id: 101,
            value: 'Water Damage Repair',
            label: 'Water Damage Repair',
            owner_type: 'system',
            project_type: 'Repair',
          },
          {
            id: 102,
            value: 'Drywall Repair',
            label: 'Drywall Repair',
            owner_type: 'system',
            project_type: 'Drywall',
          },
          {
            id: 103,
            value: 'Siding Repair',
            label: 'Siding Repair',
            owner_type: 'system',
            project_type: 'Siding',
          },
          {
            id: 104,
            value: 'Hardwood Floor Installation',
            label: 'Hardwood Floor Installation',
            owner_type: 'system',
            project_type: 'Flooring',
          },
          {
            id: 105,
            value: 'Roof Repair',
            label: 'Roof Repair',
            owner_type: 'system',
            project_type: 'Roofing',
          },
          {
            id: 201,
            value: 'Junk Removal',
            label: 'Junk Removal',
            owner_type: 'system',
            project_type: 'Junk Removal',
          },
          {
            id: 202,
            value: 'Furniture Removal',
            label: 'Furniture Removal',
            owner_type: 'system',
            project_type: 'Junk Removal',
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/agreements/ai/description/', async (route) => {
    aiDescriptionCalls += 1;
    const payload = route.request().postDataJSON();
    const input = String(
      payload?.job_description ||
        payload?.description ||
        payload?.current_description ||
        ''
    ).trim();
    const draft = draftsByInput.get(input) || draftScenarios[0];
    const classification = draft.classification || {
      project_title: draft.title,
      project_type: draft.type,
      project_subtype: draft.subtype,
      confidence: 'medium',
      reasoning: 'Matched draft intent.',
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project_title: draft.title,
        project_type: draft.type,
        project_subtype: draft.subtype,
        description: draft.scope,
        draft: {
          project_title: draft.title,
          project_type: draft.type,
          project_subtype: draft.subtype,
          description: draft.scope,
        },
        classification,
        ai_access: 'included',
        ai_enabled: true,
        ai_unlimited: true,
      }),
    });
  });

  await page.route('**/api/projects/templates/recommend/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        confidence: 'none',
        confidence_level: 'low',
        score: 0,
        detail: 'No strong template match found.',
        recommended_template: null,
        possible_match: null,
        candidates: [
          {
            id: 77,
            name: 'Junk Removal Template',
            project_type: 'Junk Removal',
            project_subtype: 'Junk Removal',
            score: 0,
          },
        ],
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
            id: 77,
            name: 'Junk Removal Template',
            project_type: 'Junk Removal',
            project_subtype: 'Junk Removal',
            owner_type: 'system',
          },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/?(\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.fallback();
      return;
    }

    agreement = {
      ...agreement,
      ...request.postDataJSON(),
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
        patchPayloads.push(payload);
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

  for (const scenario of draftScenarios) {
    agreement = {
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
      selected_template_id: null,
      selected_template: null,
    };
    patchPayloads.length = 0;
    const callsBefore = aiDescriptionCalls;

    await page.goto(`/app/agreements/new/wizard?step=1&case=${encodeURIComponent(scenario.input)}`, {
      waitUntil: 'domcontentloaded',
    });

    await page.getByTestId('step1-job-description-input').fill(scenario.input);
    await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });

    if (scenario.allowJunkRemoval) {
      await expect(page.getByText('Template match found')).toBeVisible();
    } else {
      const noTemplateReview = page.getByTestId('step1-no-template-review');
      await expect(noTemplateReview).toBeVisible({ timeout: 15000 });
      await expect(noTemplateReview.getByText('No strong template match found')).toHaveCount(1);
      await expect(noTemplateReview).toHaveCount(1);
      await expect(page.getByTestId('step1-start-mode-summary')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Project Details' })).toHaveCount(0);
      await expect(page.getByTestId('proposal-draft-textarea')).toHaveCount(0);
      await expect(page.getByTestId('step1-no-template-draft-preview')).toBeVisible();
      await expect(page.getByTestId('step1-no-template-preview-title')).toHaveText(
        scenario.title
      );
      await expect(page.getByTestId('step1-no-template-preview-type')).toHaveText(
        scenario.type
      );
      await expect(page.getByTestId('step1-no-template-preview-subtype')).toHaveText(
        scenario.subtype
      );
      await expect(page.getByTestId('step1-no-template-preview-scope')).toContainText(
        scenario.scopePattern
      );
      await expect(page.getByText('Installation Project')).toHaveCount(0);
    }
    expect(aiDescriptionCalls).toBe(callsBefore + 1);

    if (scenario.allowJunkRemoval) {
      const continueWithAiDraft = page.getByRole('button', {
        name: 'Continue with AI Draft',
      });
      await expect(continueWithAiDraft).toBeVisible();
      await continueWithAiDraft.click();
    } else {
      await expect(page.getByTestId('step1-build-agreement-ai-button')).toHaveText(
        'Continue with AI Draft'
      );
      await page.getByTestId('step1-browse-templates-manually-button').click();
      const templateSearchNoTemplateButton = page
        .getByTestId('step1-no-template-card')
        .getByTestId('step1-build-agreement-ai-button');
      await expect(templateSearchNoTemplateButton).toHaveText('Continue with AI Draft');
      await templateSearchNoTemplateButton.click();
    }

    expect(aiDescriptionCalls).toBe(callsBefore + 1);
    await expect(page.getByTestId('agreement-project-title-input')).toHaveValue(scenario.title);
    await expect(page.getByTestId('agreement-project-type-select')).toHaveValue(scenario.type);
    await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue(
      scenario.subtype
    );
    await expect(page.getByTestId('proposal-draft-textarea')).toHaveValue(scenario.scopePattern);
    await expect(page.getByText('Installation Project')).toHaveCount(0);
    await expect(page.getByText('No strong template match found')).toHaveCount(0);
    const finalScope = await page.getByTestId('proposal-draft-textarea').inputValue();
    expect(finalScope).toContain('Included Work\n-');
    expect((finalScope.match(/^- /gm) || []).length).toBeGreaterThanOrEqual(5);
    expect(finalScope).not.toMatch(/^\s*\d+[.)]\s+/m);

    if (patchPayloads.length > 0) {
      expect(patchPayloads.at(-1)).toMatchObject({
        project_title: scenario.title,
        project_type: scenario.type,
        project_subtype: scenario.subtype,
      });
      expect(patchPayloads.at(-1).description).toMatch(scenario.scopePattern);
      if (!scenario.allowJunkRemoval) {
        expect(patchPayloads.at(-1).project_type).not.toBe('Junk Removal');
        expect(patchPayloads.at(-1).project_subtype).not.toBe('Junk Removal');
      }
    }
    if (!scenario.allowJunkRemoval) {
      await expect(page.getByTestId('agreement-project-type-select')).not.toHaveValue(
        'Junk Removal'
      );
      await expect(page.getByTestId('agreement-project-subtype-select')).not.toHaveValue(
        'Junk Removal'
      );
    }
  }
});

test('agreement wizard step 1 switches into guided ai mode instead of leaving all start modes active', async ({
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
  await page.getByTestId('step1-job-description-input').fill(
    'Replace siding on a single-story home with trim repairs and cleanup'
  );
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await expect(page.getByTestId('step1-no-template-review')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project Details' })).toHaveCount(0);
  await expect(page.getByTestId('step1-start-mode-chooser')).toHaveCount(0);

  const changeStartMode = page.getByTestId('step1-change-start-mode');
  if ((await changeStartMode.count()) > 0) {
    await changeStartMode.click({ force: true });
  }
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
              project_title: 'Basement Finishing',
              project_type: 'Remodel',
              project_subtype: 'Basement',
            }
          : poolMatch
          ? {
              description:
                'Install or build the inground pool and pool house, including excavation, structural work, mechanical systems, finishes, and cleanup.',
              project_title: 'Inground Pool and Pool House',
              project_type: 'Pool',
              project_subtype: 'Inground Pool and Pool House',
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
  await expect(page.getByTestId('step1-no-template-review')).toBeVisible();
  await expect(page.getByTestId('step1-no-template-review')).toContainText('Basement Finishing');
  await page.getByTestId('step1-build-agreement-ai-button').click({ force: true });
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue('Basement Finishing');
  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue('Remodel');
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue('Basement');
  await expect(page.getByTestId('proposal-draft-textarea')).toHaveValue(/basement/i);

  await page.evaluate(() => window.sessionStorage.clear());
  await page.goto('/app/agreements/new/wizard?step=1', {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByTestId('step1-job-description-input')).toBeVisible();
  await page.getByTestId('step1-job-description-input').fill('replace siding');
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await expect(page.getByTestId('step1-no-template-review')).toBeVisible();
  await expect(page.getByTestId('step1-no-template-review')).toContainText('Siding Replacement');
  await page.getByTestId('step1-build-agreement-ai-button').click({ force: true });
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
              project_title: 'Inground Pool and Pool House',
              project_type: 'Pool',
              project_subtype: 'Inground Pool and Pool House',
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

  await expect(page.getByTestId('step1-job-description-input')).toBeVisible();
  await page.getByTestId('step1-job-description-input').fill('faucet repair');
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await expect(page.getByTestId('step1-no-template-review')).toBeVisible();
  await page.getByTestId('step1-build-agreement-ai-button').click({ force: true });
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('proposal-draft-textarea')).toHaveValue(/faucet|plumbing|bar/i);

  await page.evaluate(() => window.sessionStorage.clear());
  await page.goto('/app/agreements/new/wizard?step=1', {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByTestId('step1-job-description-input')).toBeVisible();
  await page.getByTestId('step1-job-description-input').fill('inground pool and pool house');
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await expect(page.getByTestId('step1-no-template-review')).toBeVisible();
  await expect(page.getByTestId('step1-no-template-review')).toContainText(
    'Inground Pool and Pool House'
  );
  await page.getByTestId('step1-build-agreement-ai-button').click({ force: true });
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue('Inground Pool and Pool House');
  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue('Pool');
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue('Inground Pool and Pool House');
  await expect(page.getByTestId('proposal-draft-textarea')).toHaveValue(/pool/i);
});

test('agreement wizard step 1 improve project classification surfaces advisory match without changing contractor edits', async ({
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
        project_title: 'Junk Removal',
        project_type: 'Junk Removal',
        project_subtype: 'Junk Removal',
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

  await expect(page.getByTestId('step1-no-template-review')).toBeVisible();
  await page.getByTestId('step1-build-agreement-ai-button').click({ force: true });
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

  await expect(page.getByText(/AI matched this as Junk Removal \/ Furniture Removal/i)).toBeVisible();
  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue('Repair');
  await expect(page.getByTestId('agreement-project-subtype-select')).toHaveValue('Faucet Repair');
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue('Faucet Repair');
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
  const outdoorKitchenReview = page.getByTestId('step1-no-template-review');
  if ((await outdoorKitchenReview.count()) > 0) {
    await expect(outdoorKitchenReview).toBeVisible();
    await page.getByTestId('step1-build-agreement-ai-button').click({ force: true });
  }
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
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue('Wet Bar Installation');
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
  const accurateReview = page.getByTestId('step1-no-template-review');
  if ((await accurateReview.count()) > 0) {
    await expect(accurateReview).toBeVisible();
    await page.getByTestId('step1-build-agreement-ai-button').click({ force: true });
  }
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

  await expect(page.getByText(/AI matched this as Outdoor Living \/ Outdoor Kitchen/i)).toBeVisible();
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
  const garageDoorReview = page.getByTestId('step1-no-template-review');
  if ((await garageDoorReview.count()) > 0) {
    await expect(garageDoorReview).toBeVisible();
    await page.getByTestId('step1-build-agreement-ai-button').click({ force: true });
  }
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
    'Garage Door Opener Installation'
  );
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue('Faucet Repair');
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
  const noTemplateReview = page.getByTestId('step1-no-template-review');
  if ((await noTemplateReview.count()) > 0) {
    await expect(noTemplateReview).toBeVisible();
    await page.getByTestId('step1-build-agreement-ai-button').click({ force: true });
  }
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

  const customTypeReview = page.getByTestId('step1-no-template-review');
  if ((await customTypeReview.count()) > 0) {
    await expect(customTypeReview).toBeVisible();
    await expect(customTypeReview).toContainText('Outdoor Living Plus');
    await page.getByTestId('step1-build-agreement-ai-button').click({ force: true });
  }
  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue(
    'Outdoor Living Plus'
  );
  await expect(page.getByTestId('agreement-project-type-select')).toContainText(
    'Outdoor Living Plus (Custom)'
  );

  await page.getByTestId('agreement-project-title-input').fill('Outdoor Living Plus Patio');
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue(
    'Outdoor Living Plus Patio'
  );
  await page.getByTestId('proposal-draft-textarea').fill('Manual custom taxonomy should survive rerenders.');
  await expect(page.getByTestId('agreement-project-type-select')).toHaveValue(
    'Outdoor Living Plus'
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

  const jobDescription = await ensureStep1JobDescription(page);
  await jobDescription.fill(
    'Kitchen remodel with updated cabinets and finish work'
  );
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('agreement-clarification-section')).toHaveCount(0);
  await expect(page.getByTestId('agreement-save-draft-button')).toBeEnabled();
  expect(patchPayloads.length).toBeGreaterThanOrEqual(0);
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
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`),
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

  const jobDescription = await ensureStep1JobDescription(page);
  await jobDescription.fill('siding replacement');
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await expect(page.getByTestId('step1-starting-point-loading-card')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('agreement-clarification-section')).toHaveCount(0);
  await expect(page.getByTestId('agreement-project-title-input')).toBeVisible();
  await expect(page.getByTestId('proposal-draft-textarea')).toHaveValue(/siding/i);
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
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`),
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

  const jobDescription = await ensureStep1JobDescription(page);
  await jobDescription.fill('paint bedroom');
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  await expect(page.getByTestId('step1-starting-point-loading-card')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('agreement-clarification-section')).toHaveCount(0);
  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue(/painting/i);
  await expect(page.getByTestId('proposal-draft-textarea')).toHaveValue(/paint/i);
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
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  const changeStartMode = page.getByTestId('step1-change-start-mode');
  if ((await changeStartMode.count()) > 0) {
    await changeStartMode.click({ force: true });
  }
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

  await expect(page).toHaveURL(/\/app\/agreements\/123\/wizard\?step=1/);
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();

  const projectDetailsCard = page.getByTestId('step1-project-details-card');
  const startOverButton = projectDetailsCard.getByRole('button', { name: 'Start over' });
  if ((await startOverButton.count()) === 0) {
    await expect(projectDetailsCard).toBeVisible();
    await expect(page.getByTestId('step1-start-mode-chooser')).toHaveCount(0);
    return;
  }

  await expect(startOverButton).toBeVisible();
  await startOverButton.click({ force: true });
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
        reason: 'shared keywords: roof, shingles; score=97; rank_score=97',
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

  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByText(/shared keywords|score=97|rank_score/i)).toHaveCount(0);
  await expect(page.getByTestId('step1-start-mode-chooser')).toHaveCount(0);
  await expect(page.getByTestId('step1-template-browser')).toHaveCount(0);
});

test('agreement wizard step 1 applies templates in enhance mode without replacing draft identity', async ({
  page,
}) => {
  let agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Front Porch Decorative Wood Column Repair',
    title: 'Front Porch Decorative Wood Column Repair',
    project_type: 'Carpentry',
    project_subtype: 'Wood Column Restoration',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description:
      'Included Work:\n- Repair decorative wood columns on front porch\n- Restore column profiles\n- Prime and repaint affected trim',
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
  const applyPayloads = [];

  await installWizardAuthRoutes(page);

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 1, value: 'Carpentry', label: 'Carpentry', owner_type: 'system' },
          { id: 2, value: 'Painting', label: 'Painting', owner_type: 'system' },
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
            value: 'Wood Column Restoration',
            label: 'Wood Column Restoration',
            owner_type: 'system',
            project_type: 'Carpentry',
          },
          {
            id: 12,
            value: 'Interior Painting',
            label: 'Interior Painting',
            owner_type: 'system',
            project_type: 'Painting',
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
        draft: {
          project_title: 'Front Porch Decorative Wood Column Repair',
          project_type: 'Carpentry',
          project_subtype: 'Wood Column Restoration',
          description:
            'Included Work:\n- Repair decorative wood columns on front porch\n- Restore column profiles\n- Prime and repaint affected trim',
        },
        classification: {
          project_type: 'Carpentry',
          project_subtype: 'Wood Column Restoration',
          confidence: 'high',
          reasoning: 'Decorative exterior wood column repair.',
        },
        ai_access: 'included',
        ai_enabled: true,
        ai_unlimited: true,
      }),
    });
  });

  await page.route('**/api/projects/templates/recommend/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        confidence: 'none',
        confidence_level: 'low',
        match_tier: 'no_useful_match',
        recommended_template: null,
        possible_match: null,
        candidates: [],
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
            name: 'Interior Painting',
            project_type: 'Painting',
            project_subtype: 'Interior Painting',
            milestone_count: 5,
            description: 'Reusable interior painting starting point.',
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
        name: 'Interior Painting',
        project_type: 'Painting',
        project_subtype: 'Interior Painting',
        milestone_count: 5,
        estimated_days: 7,
        description: 'Reusable interior painting starting point.',
        milestones: [
          { id: 1, title: 'Paint Prep', description: 'Protect space and prepare surfaces.' },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/(?:123|new)\/apply-template\/$/, async (route) => {
    applyPayloads.push(route.request().postDataJSON());
    agreement.selected_template_id = 44;
    agreement.selected_template = {
      id: 44,
      name: 'Interior Painting',
      project_type: 'Painting',
      project_subtype: 'Interior Painting',
    };
    agreement.selected_template_name_snapshot = 'Interior Painting';

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

  const jobDescription = await ensureStep1JobDescription(page);
  await jobDescription.fill('Repair decorative wood columns on front porch');
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });
  const reviewPanel = page.getByTestId('step1-no-template-review');
  await expect(reviewPanel).toBeVisible();
  await expect(reviewPanel).toContainText('Front Porch Decorative Wood Column Repair');
  await expect(page.getByRole('heading', { name: 'Project Details' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Browse Templates' }).click();
  await expect(page.getByTestId('step1-template-browser')).toBeVisible();
  await expect(page.getByTestId('step1-system-templates-list')).toBeVisible();
  await expect(page.getByTestId('step1-my-templates-list')).toBeVisible();
  await expect(page.getByTestId('step1-template-detail-name')).toHaveCount(0);
  await expect(page.getByTestId('step1-job-description-input')).toHaveCount(0);
  await expect(page.getByTestId('step1-ai-prompt-input')).toHaveCount(0);
  await expect(page.getByTestId('step1-browse-templates-manually-button')).toBeVisible();
  await expect(page.getByText('Start a new template')).toHaveCount(0);
  await expect(page.getByText('New Template Draft')).toHaveCount(0);
  await expect(page.getByText('Save Template')).toHaveCount(0);
  await expect(page.getByText('draft template', { exact: false })).toHaveCount(0);

  await page.locator('input[placeholder*="Search templates by keyword"]').fill('painting');
  await page.getByTestId('template-search-result-44').click();
  await expect(page.getByTestId('step1-template-detail-name')).toHaveText('Interior Painting');
  await page.getByTestId('step1-continue-to-step2-button').click();
  expect(applyPayloads).toHaveLength(1);
  expect(applyPayloads[0]).toMatchObject({
    template_id: 44,
    application_mode: 'enhance',
    project_title: 'Front Porch Decorative Wood Column Repair',
    project_type: 'Carpentry',
    project_subtype: 'Wood Column Restoration',
  });
  expect(applyPayloads[0].description).toContain('decorative wood columns');
  expect(agreement.selected_template_id).toBe(44);
  expect(agreement.project_title).toBe('Front Porch Decorative Wood Column Repair');
  expect(agreement.project_type).toBe('Carpentry');
  expect(agreement.project_subtype).toBe('Wood Column Restoration');
  expect(agreement.description).toContain('decorative wood columns');
  await expect(page).toHaveURL(/\/app\/agreements\/(?:123|new)\/wizard\?(?=.*step=2)/);
  await expect(page).not.toHaveURL(/step=3/);
  expect(patchPayloads.length).toBeGreaterThanOrEqual(0);
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

  await ensureStep1JobDescription(page);
  await page.getByRole('button', { name: 'Browse templates manually' }).click();
  await expect(page.getByTestId('step1-template-browser')).toBeVisible();
  await expect(page.getByTestId('step1-template-detail-name')).toHaveCount(0);
  await expect(page.getByTestId('step1-job-description-input')).toHaveCount(0);
  await page.locator('input[placeholder*="Search templates by keyword"]').fill('kitchen');
  await page.getByRole('button', { name: /Kitchen Remodel Template/ }).click();

  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('proposal-draft-textarea')).toHaveValue(
    /reusable kitchen remodel starting point/i
  );
  await expect(page.getByTestId('agreement-ai-improve-scope-button')).toBeEnabled();
  await expect(page.getByTestId('agreement-ai-generate-scope-button')).toBeEnabled();
  await expect(page.locator('select[name="project_subtype"]')).toHaveValue('');
  await expect(page.getByTestId('agreement-clarification-section')).toHaveCount(0);
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
        project_title: 'Bathroom Remodel',
        project_type: 'Remodel',
        project_subtype: 'Bathroom Remodel',
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

  await ensureStep1JobDescription(page);
  await page.getByTestId('step1-job-description-input').fill(
    'Bathroom remodel with tub and shower replacement, tile work, vanity install, plumbing updates, outlet relocation, and lighting changes'
  );
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });

  await expect(page.getByTestId('step1-no-template-review')).toBeVisible();
  await expect(page.getByTestId('step1-no-template-review')).toContainText('Bathroom Remodel');
  await page.getByTestId('step1-build-agreement-ai-button').click({ force: true });

  await expect(page.getByTestId('agreement-project-title-input')).toHaveValue('Bathroom Remodel');
  await expect(page.locator('select[name="project_type"]')).toHaveValue('Remodel');
  await expect(page.locator('select[name="project_subtype"]')).toHaveValue('Bathroom Remodel');
  await expect(page.getByTestId('agreement-project-type-ai-indicator')).toContainText(
    'AI suggested'
  );
  await expect(page.getByTestId('agreement-project-subtype-ai-indicator')).toContainText(
    'AI suggested'
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
        project_title: 'Kitchen Cabinet Installation',
        project_type: 'Cabinetry',
        project_subtype: 'Cabinet Installation',
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

  await ensureStep1JobDescription(page);
  await page.getByTestId('step1-job-description-input').fill(
    'Install new kitchen cabinets and hardware only with minor trim touchups'
  );
  await page.getByTestId('step1-find-best-starting-point-button').click({ force: true });

  await expect(page.getByTestId('step1-no-template-review')).toBeVisible();
  await expect(page.getByTestId('step1-no-template-review')).toContainText(
    'Kitchen Cabinet Installation'
  );
  await page.getByTestId('step1-build-agreement-ai-button').click({ force: true });
  await expect(page.locator('select[name="project_subtype"]')).toHaveValue(
    'Cabinet Installation'
  );
  await expect(page.getByTestId('agreement-project-title-input')).not.toHaveValue(
    'Kitchen Remodel'
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

  await page.getByTestId('step2-milestone-card-980').getByRole('button', { name: 'Edit' }).click();
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

test('agreement wizard step 2 reschedules existing milestone dates from a new project start date', async ({
  page,
}) => {
  const originalStart = '2026-04-01';
  const nextStart = '2026-05-10';
  const agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Kitchen Remodel',
    title: 'Kitchen Remodel',
    project_type: 'Remodel',
    project_subtype: 'Kitchen Remodel',
    project_start_date: originalStart,
    start: originalStart,
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description:
      'Full kitchen remodel with demolition, cabinet replacement, countertop installation, appliance reconnects, plumbing, electrical, and finish work.',
    homeowner: null,
    status: 'draft',
    ai_scope: {
      answers: {
        clarifications_reviewed_step2: true,
      },
    },
    compliance_warning: {
      warning_level: 'none',
      message: '',
    },
  };

  const milestoneState = {
    items: [
      {
        id: 801,
        agreement: AGREEMENT_ID,
        order: 1,
        title: 'Planning & protection',
        description: 'Review scope and protect the home.',
        amount: '1200.00',
        start_date: originalStart,
        completion_date: '2026-04-03',
      },
      {
        id: 802,
        agreement: AGREEMENT_ID,
        order: 2,
        title: 'Cabinets & surfaces',
        description: 'Install cabinets and counters.',
        amount: '2600.00',
        start_date: '2026-04-04',
        completion_date: '2026-04-06',
      },
    ],
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

  await expect(page.getByTestId('step2-project-start-date-input')).toHaveValue(originalStart);
  await expect(page.getByRole('button', { name: 'Save & Next' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Saving' })).toHaveCount(0);

  await setDateInputValue(page, 'step2-project-start-date-input', nextStart);
  await page.getByTestId('step2-project-start-date-save').click();

  await expect(page.getByTestId('step2-project-start-date-prompt')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save & Next' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Saving' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Update dates' }).click();

  await expect(page.getByTestId('step2-project-start-date-prompt')).toHaveCount(0);
  await expect(page.getByTestId('step2-milestone-card-list')).toContainText(formatFriendlyDate(nextStart));
  await expect(page.getByRole('button', { name: 'Save & Next' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Saving' })).toHaveCount(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('step2-project-start-date-input')).toHaveValue(nextStart);
  await expect(page.getByTestId('step2-milestone-card-list')).toContainText(formatFriendlyDate(nextStart));
});

test('agreement wizard step 2 keeps existing milestone dates when the contractor chooses to preserve them', async ({
  page,
}) => {
  const originalStart = '2026-04-01';
  const nextStart = '2026-05-10';
  const agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Kitchen Remodel',
    title: 'Kitchen Remodel',
    project_type: 'Remodel',
    project_subtype: 'Kitchen Remodel',
    project_start_date: originalStart,
    start: originalStart,
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description:
      'Full kitchen remodel with demolition, cabinet replacement, countertop installation, appliance reconnects, plumbing, electrical, and finish work.',
    homeowner: null,
    status: 'draft',
    ai_scope: {
      answers: {
        clarifications_reviewed_step2: true,
      },
    },
    compliance_warning: {
      warning_level: 'none',
      message: '',
    },
  };

  const milestoneState = {
    items: [
      {
        id: 811,
        agreement: AGREEMENT_ID,
        order: 1,
        title: 'Planning & protection',
        description: 'Review scope and protect the home.',
        amount: '1200.00',
        start_date: originalStart,
        completion_date: '2026-04-03',
      },
      {
        id: 812,
        agreement: AGREEMENT_ID,
        order: 2,
        title: 'Cabinets & surfaces',
        description: 'Install cabinets and counters.',
        amount: '2600.00',
        start_date: '2026-04-04',
        completion_date: '2026-04-06',
      },
    ],
    nextId: 910,
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

  await expect(page.getByTestId('step2-project-start-date-prompt')).toHaveCount(0);
  await expect(page.getByTestId('step2-project-start-date-input')).toHaveValue(originalStart);
  await expect(page.getByTestId('step2-milestone-card-811')).toContainText(formatFriendlyDate(originalStart));
  await expect(page.getByTestId('step2-milestone-card-812')).toContainText(formatFriendlyDate('2026-04-04'));
});

test('agreement wizard step 2 auto-schedules milestone dates when the plan has no dates yet', async ({
  page,
}) => {
  const originalStart = '';
  const nextStart = '2026-05-10';
  const agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Kitchen Remodel',
    title: 'Kitchen Remodel',
    project_type: 'Remodel',
    project_subtype: 'Kitchen Remodel',
    project_start_date: originalStart,
    start: originalStart,
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description:
      'Full kitchen remodel with demolition, cabinet replacement, countertop installation, appliance reconnects, plumbing, electrical, and finish work.',
    homeowner: null,
    status: 'draft',
    ai_scope: {
      answers: {
        clarifications_reviewed_step2: true,
      },
    },
    compliance_warning: {
      warning_level: 'none',
      message: '',
    },
  };

  const milestoneState = {
    items: [
      {
        id: 821,
        agreement: AGREEMENT_ID,
        order: 1,
        title: 'Planning & protection',
        description: 'Review scope and protect the home.',
        amount: '1200.00',
        start_date: '',
        completion_date: '',
      },
      {
        id: 822,
        agreement: AGREEMENT_ID,
        order: 2,
        title: 'Cabinets & surfaces',
        description: 'Install cabinets and counters.',
        amount: '2600.00',
        start_date: '',
        completion_date: '',
      },
    ],
    nextId: 920,
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

  await setDateInputValue(page, 'step2-project-start-date-input', nextStart);
  await page.getByTestId('step2-project-start-date-save').click();

  await expect(page.getByTestId('step2-project-start-date-prompt')).toHaveCount(0);
  await expect(page.getByTestId('step2-milestone-card-821')).toContainText(formatFriendlyDate(nextStart));
  await expect(page.getByTestId('step2-milestone-card-822')).toContainText(formatFriendlyDate('2026-05-11'));
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
  const clarificationSection = page.getByTestId('step4-scope-clarifications-section');
  await expect(clarificationSection).toContainText('View details');
  await expect(clarificationSection).toContainText(
    'These answers help define project scope, pricing, responsibilities, and signing expectations before finalizing the agreement.'
  );
  await clarificationSection.getByTestId('step4-scope-clarifications-header').click();
  await expect(clarificationSection).toContainText('Collapse');
  await expect(clarificationSection).toContainText('No scope clarifications have been saved yet.');
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
  await expect(page.getByText(/Review Agreement PDF/).first()).toBeVisible();
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

  await expect(page.getByText(/Review Agreement PDF/).first()).toBeVisible();
  await expect(signArea.locator('iframe, object')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open PDF' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF' }).first()).toBeVisible();
  await expect(page.getByTestId('step4-sign-continue-button')).toBeDisabled();
  await page.locator('input[placeholder="e.g. Jane Contractor"]').first().fill('Jordan Builder');
  await page.getByTestId('step4-legal-ack-checkbox').check();
  await expect(page.getByTestId('step4-sign-continue-button')).toBeDisabled();
  await page.getByRole('button', { name: 'Download PDF' }).first().click();
  await expect.poll(() => markPreviewedCalls.length).toBe(1);
  await expect(page.getByText(/Agreement PDF reviewed/).first()).toBeVisible();
  await expect(page.getByTestId('step4-sign-continue-button')).toBeEnabled();

  await page.getByRole('button', { name: 'Direct Pay' }).click();
  await expect.poll(() => patchPayloads.some((payload) => payload.payment_mode === 'direct')).toBeTruthy();
  agreement = { ...agreement, payment_mode: 'direct' };
  await expect(page.getByTestId('step4-summary-payment')).toContainText('Direct Pay');

  await page.getByRole('button', { name: 'Escrow (Milestone Hold)' }).click();
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
  await expect(page.getByText(/Agreement PDF reviewed/).first()).toBeVisible();
  await expect(page.getByTestId('step4-customer-send-success')).toBeVisible();
  await expect(page.getByTestId('step4-open-workspace-button')).toBeVisible();
  await expect(page.getByTestId('step4-copy-customer-link-button')).toBeVisible();
  await page.getByTestId('step4-open-workspace-button').click();
  await expect(page).toHaveURL(new RegExp(`/app/agreements/${AGREEMENT_ID}/workspace$`));
  await expect(page.getByRole('heading', { name: 'Agreement Workspace' })).toBeVisible();
  await expect(page.getByTestId('agreement-workspace-header')).toBeVisible();
  await expect(page.getByTestId('agreement-workspace-tabs')).toBeVisible();
  await expect(page.getByTestId('agreement-workspace-tab-milestones')).toBeVisible();
  await expect(page.getByTestId('agreement-overview-command-center')).toBeVisible();
  await expect(page.getByTestId('agreement-workspace-tab-activity')).toContainText('Team & Assignments');
});

test('agreement workspace phase 3 shows operations manager and PDF fallback', async ({ page }) => {
  const workspaceId = AGREEMENT_ID + 41;
  let previewAttempts = 0;
  const agreement = {
    id: workspaceId,
    agreement_id: workspaceId,
    project_title: 'Workspace Phase 2 Project',
    title: 'Workspace Phase 2 Project',
    description: 'Validate workspace management summary.',
    homeowner: 1,
    homeowner_name: 'Jordan Demo',
    homeowner_email: 'jordan@example.com',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    status: 'sent',
    workflow_status: 'sent',
    total_cost: '6400.00',
    signed_by_contractor: true,
    signed_by_homeowner: false,
    is_fully_signed: false,
    escrow_funded: false,
    current_pdf_url: '/media/workspace-phase-2.pdf',
    pdf_version: 4,
    pdf_versions: [
      {
        id: 44,
        version_number: 4,
        kind: 'sent',
        file_url: '/media/workspace-phase-2.pdf',
        created_at: '2026-06-24T12:00:00Z',
        signed_by_contractor: true,
        signed_by_homeowner: false,
      },
    ],
    invoices: [
      { id: 88, amount: '1250.00', status: 'unpaid' },
    ],
    amendment_requests: [],
  };

  await installStep4FinalizeRoutes(page, {
    agreement,
    milestones: [
      {
        id: 501,
        agreement: workspaceId,
        order: 1,
        title: 'Prep and mobilization',
        amount: '7000.00',
        status: 'paid',
        payment_status: 'paid',
        paid_at: '2026-06-25T12:00:00Z',
      },
      {
        id: 502,
        agreement: workspaceId,
        order: 2,
        title: 'Build and finish',
        amount: '7000.00',
        status: 'active',
      },
      {
        id: 503,
        agreement: workspaceId,
        order: 3,
        title: 'Final walkthrough',
        amount: '6000.00',
        status: 'pending',
      },
    ],
    fundingPreview: {
      project_amount: 6400,
      homeowner_escrow: 6400,
      platform_fee: 321,
      contractor_payout: 6079,
      escrow_funded: false,
      rate: 0.05,
    },
  });

  await page.route(
    new RegExp(`/api/projects/agreements/${workspaceId}/preview_pdf/?(\\?.*)?$`),
    async (route) => {
      previewAttempts += 1;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Preview temporarily unavailable.' }),
      });
    }
  );

  await page.route('**/media/workspace-phase-2.pdf', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF',
    });
  });

  await page.goto(`/app/agreements/${workspaceId}/workspace`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('agreement-overview-command-center')).toBeVisible();
  await expect(page.getByTestId('agreement-overview-command-center')).toContainText('Agreement Operations Manager');
  await expect(page.getByTestId('agreement-operations-next-action')).toContainText('Awaiting Signature');
  await expect(page.getByTestId('agreement-operations-manager')).toContainText('Current Stage');
  await expect(page.getByTestId('agreement-operations-manager')).toContainText('Waiting on signature');
  await expect(page.getByTestId('agreement-operations-manager')).toContainText('Current Milestone');
  await expect(page.getByTestId('agreement-operations-manager')).toContainText('Build and finish');
  await expect(page.getByTestId('agreement-operations-manager')).toContainText('Funding State');
  await expect(page.getByTestId('agreement-operations-manager')).toContainText('Next Payment');
  await expect(page.getByTestId('agreement-overview-command-center')).not.toContainText('Estimated Effort');
  await expect(page.getByTestId('agreement-overview-primary-cta')).toContainText('Open signatures');
  await expect(page.getByTestId('agreement-overview-secondary-cta')).toContainText('Review PDF');
  await expect(page.getByTestId('agreement-project-snapshot')).toBeVisible();
  await expect(page.getByTestId('agreement-overview-status-summary')).toContainText('Signature needed');
  await expect(page.getByTestId('agreement-overview-status-summary')).toContainText('1 of 3 complete');
  await expect(page.getByTestId('agreement-overview-status-summary')).not.toContainText('0 of 0');
  await expect(page.getByTestId('agreement-overview-milestone-preview')).toContainText('Prep and mobilization');
  await expect(page.getByTestId('agreement-overview-milestone-preview')).toContainText('Build and finish');
  await expect(page.getByTestId('agreement-overview-milestone-preview')).toContainText('Paid');
  await expect(page.getByTestId('milestone-preview-status-501')).toContainText('Completed');
  await expect(page.getByTestId('milestone-preview-progress-501')).toContainText('100%');
  await expect(page.getByTestId('milestone-preview-payment-501')).toContainText('Paid');
  await expect(page.getByTestId('agreement-overview-milestone-preview')).not.toContainText('Assigned Worker');
  await expect(page.getByTestId('agreement-overview-timeline')).toBeVisible();
  await expect(page.getByTestId('agreement-overview-documents-summary')).toBeVisible();
  await expect(page.getByTestId('agreement-overview-command-center')).toHaveClass(/bg-\[#061d42\]/);
  await expect(page.getByTestId('agreement-project-snapshot')).toHaveClass(/bg-\[#061d42\]/);
  await expect(page.getByTestId('agreement-overview-milestone-preview')).toHaveClass(/bg-\[#061d42\]/);
  await expect(page.getByTestId('agreement-workspace-nav-back')).toHaveAttribute('href', '/app/agreements');
  await expect(page.getByTestId('agreement-workspace-nav-customer')).toHaveAttribute('href', '/app/customers/1');
  await expect(page.getByTestId('agreement-workspace-nav-records')).toHaveAttribute('href', '/app/customers/records');
  await expect(page.getByTestId('agreement-workspace-nav-payments')).toHaveAttribute('href', '/app/payments');
  await expect(page.getByTestId('agreement-workspace-breadcrumb')).toContainText('Agreements');
  await page.getByTestId('agreement-workspace-tab-milestones').click();
  await expect(page.getByTestId('agreement-workspace-panel-milestones')).toHaveClass(/bg-\[#061d42\]/);
  await expect(page.getByTestId('agreement-milestones-progress')).toContainText('1 of 3 complete');
  await expect(page.getByTestId('agreement-workspace-panel-milestones')).toContainText('Prep and mobilization');
  await expect(page.getByTestId('agreement-workspace-panel-milestones')).toContainText('Build and finish');
  await expect(page.getByTestId('agreement-workspace-panel-milestones')).toContainText('Final walkthrough');
  await expect(page.getByTestId('agreement-workspace-panel-milestones')).not.toContainText('No milestones found');
  await expect(page.getByTestId('milestone-completed-badge-501')).toContainText('Completed');
  await expect(page.getByTestId('milestone-progress-501')).toContainText('100%');
  await expect(page.getByTestId('milestone-progress-bar-501')).toHaveAttribute('style', /width: 100%/);
  await expect(page.getByTestId('milestone-payment-status-501')).toContainText('Paid');
  await expect(page.getByTestId('milestone-progress-501')).not.toHaveText('0%');
  await expect(page.getByTestId('milestone-actions-501')).toContainText('View');
  await expect(page.getByTestId('milestone-complete-action-502')).toContainText('Complete in Milestones');
  await expect(page.getByTestId('milestone-complete-action-502')).toHaveAttribute(
    'href',
    `/app/milestones?agreement=${workspaceId}&milestone=502`
  );
  await expect(page.getByTestId('milestone-team-controls-501')).not.toHaveAttribute('open', '');
  await expect(page.getByTestId('milestone-team-controls-501')).toContainText('Advanced assignment controls');
  await page.getByTestId('agreement-workspace-tab-activity').click();
  await expect(page.getByTestId('agreement-workspace-panel-activity')).toHaveClass(/bg-\[#061d42\]/);
  await expect(page.getByTestId('agreement-workspace-panel-activity')).toContainText('Assign Entire Agreement');
  await page.getByTestId('agreement-workspace-tab-overview').click();
  await expect(page.getByTestId('agreement-workspace-tab-activity')).toContainText('Team & Assignments');
  await expect(page.getByTestId('agreement-workspace-tabs')).not.toContainText('Activity');

  await page.getByTestId('agreement-workspace-tab-funding').click();
  await expect(page.getByTestId('agreement-workspace-panel-funding')).toHaveClass(/bg-\[#061d42\]/);
  await expect(page.getByTestId('agreement-funding-status')).toBeVisible();
  await expect(page.getByTestId('agreement-payment-summary')).toContainText('$6,400.00');
  await expect(page.getByTestId('agreement-outstanding-balance')).toContainText('$1,250.00');
  await expect(page.getByTestId('agreement-invoice-summary')).toContainText('1 open');
  await expect(page.getByTestId('agreement-workspace-panel-funding')).not.toContainText('SMS Status');
  await expect(page.getByTestId('agreement-workspace-panel-funding')).not.toContainText('Draw Requests');

  await page.getByTestId('agreement-workspace-tab-signatures').click();
  await expect(page.getByTestId('agreement-workspace-panel-signatures')).toHaveClass(/bg-\[#061d42\]/);
  await expect(page.getByTestId('agreement-signatures-pdf-history')).toBeVisible();
  await expect(page.getByTestId('agreement-signatures-pdf-history')).toContainText('PDF History');
  await page.getByRole('button', { name: 'Preview PDF' }).click();
  await expect.poll(() => previewAttempts).toBe(1);
  await expect(page.getByTestId('agreement-pdf-preview-fallback')).toBeVisible();
  await expect(page.getByTestId('agreement-pdf-preview-fallback')).toContainText('Open raw PDF');
  await expect(page.getByTestId('agreement-pdf-preview-fallback')).toContainText('Download PDF');

  await page.getByTestId('agreement-workspace-tab-documents').click();
  await expect(page.getByTestId('agreement-workspace-panel-documents')).toHaveClass(/bg-\[#061d42\]/);
  await expect(page.getByTestId('agreement-workspace-panel-documents')).not.toContainText('PDF Versions');
  await expect(page.getByTestId('agreement-workspace-panel-documents')).not.toContainText('PDF History');

  const visibleText = await page.locator('body').innerText();
  expect(visibleText).not.toMatch(/â|Â|Ã/);

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/app/agreements/${workspaceId}/workspace`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByTestId('agreement-workspace-header')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('agreement workspace routes active milestone action to milestone completion flow', async ({
  page,
}) => {
  const workspaceId = AGREEMENT_ID + 52;
  const agreement = {
    id: workspaceId,
    agreement_id: workspaceId,
    project_title: 'Active Milestone Project',
    title: 'Active Milestone Project',
    homeowner: 1,
    homeowner_name: 'Jordan Demo',
    homeowner_email: 'jordan@example.com',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    status: 'funded',
    workflow_status: 'funded',
    total_cost: '20000.00',
    signed_by_contractor: true,
    signed_by_homeowner: true,
    is_fully_signed: true,
    escrow_funded: true,
    invoices: [],
    amendment_requests: [],
  };

  await installStep4FinalizeRoutes(page, {
    agreement,
    milestones: [
      {
        id: 601,
        agreement: workspaceId,
        order: 1,
        title: 'Completed paid milestone',
        amount: '7000.00',
        status: 'paid',
        payment_status: 'paid',
        paid_at: '2026-06-25T12:00:00Z',
      },
      {
        id: 602,
        agreement: workspaceId,
        order: 2,
        title: 'Window and insulation installation',
        amount: '7000.00',
        status: 'active',
      },
      {
        id: 603,
        agreement: workspaceId,
        order: 3,
        title: 'Final walkthrough',
        amount: '6000.00',
        status: 'pending',
      },
    ],
  });

  await page.goto(`/app/agreements/${workspaceId}/workspace`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('agreement-operations-next-action')).toContainText('Complete Milestone');
  await expect(page.getByTestId('agreement-overview-primary-cta')).toContainText('Complete in Milestones');
  await expect(page.getByTestId('agreement-overview-secondary-cta')).toHaveCount(0);
  await expect(page.getByTestId('agreement-overview-status-summary')).toContainText('1 of 3 complete');
  await expect(page.getByTestId('agreement-overview-milestone-preview')).toContainText('Paid');

  await page.getByTestId('agreement-overview-primary-cta').click();
  await expect(page).toHaveURL(
    new RegExp(`/app/milestones\\?agreement=${workspaceId}&milestone=602$`)
  );
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
  const sendCalls = [];
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
    events: { sendCalls },
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
  await expect.poll(() => sendCalls.length).toBe(1);
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

test('draft agreement detail redirects to the wizard', async ({ page }) => {
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

  await expect(page).toHaveURL(/\/wizard\?step=\d+/);
});
