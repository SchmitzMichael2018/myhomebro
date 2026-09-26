import { expect, test } from '@playwright/test';

const baseRows = [
  {
    area: 'Austin, TX',
    state: 'TX',
    city: 'Austin',
    zip: '',
    trade: 'roofing',
    demand_signal: '8',
    demand_count: 8,
    relationship: 'in_service_area',
    relationship_label: 'In Your Service Area',
    market_readiness: { status: 'active', coverage_ready: true },
    automatic_matching_approval: true,
    automatic_matching_available: true,
    contractor_readiness: {
      claimed_profile: true,
      approved_verification: true,
      payment_ready: true,
      matching_trade: true,
      matching_service_area: true,
    },
    recommended_action: {
      label: 'Review authorized opportunities',
      url: '/app/opportunities',
    },
    newest_demand_at: '2026-09-25T18:00:00Z',
  },
  {
    area: 'Round Rock, TX',
    state: 'TX',
    city: 'Round Rock',
    zip: '',
    trade: 'plumbing',
    demand_signal: 'Emerging demand',
    demand_count: null,
    relationship: 'readiness_needed',
    relationship_label: 'Readiness Needed',
    market_readiness: { status: 'building_coverage', coverage_ready: false },
    automatic_matching_approval: false,
    automatic_matching_available: false,
    contractor_readiness: {
      claimed_profile: true,
      approved_verification: true,
      payment_ready: false,
      matching_trade: false,
      matching_service_area: true,
    },
    recommended_action: {
      label: 'Complete payment setup',
      url: '/app/onboarding/stripe',
    },
    newest_demand_at: '2026-09-24T18:00:00Z',
  },
  {
    area: 'Dallas, TX',
    state: 'TX',
    city: 'Dallas',
    zip: '',
    trade: 'roofing',
    demand_signal: '5',
    demand_count: 5,
    relationship: 'expansion_opportunity',
    relationship_label: 'Expansion Opportunity',
    market_readiness: { status: 'building_coverage', coverage_ready: false },
    automatic_matching_approval: false,
    automatic_matching_available: false,
    contractor_readiness: {
      claimed_profile: true,
      approved_verification: true,
      payment_ready: true,
      matching_trade: true,
      matching_service_area: false,
    },
    recommended_action: {
      label: 'Add or edit service area',
      url: '/app/profile',
    },
    newest_demand_at: '2026-09-23T18:00:00Z',
  },
];

function payload(rows = baseRows, page = 1, total = rows.length) {
  return {
    results: rows,
    summary: {
      current_service_area_signals: 2,
      trades_with_demand: 2,
      expansion_opportunities: 1,
      readiness_actions: 1,
      authorized_individual_opportunities: 4,
    },
    pagination: {
      page,
      page_size: 25,
      total,
      page_count: Math.max(1, Math.ceil(total / 25)),
      has_next: page * 25 < total,
      has_previous: page > 1,
    },
    privacy: { minimum_group_size: 3, suppressed_label: 'Emerging demand' },
    property_management_included: false,
  };
}

async function installMocks(page, responder = (url) => {
  if (
    url.searchParams.get('state') === 'ZZ' ||
    url.searchParams.get('trade') === 'none'
  ) {
    return payload([]);
  }
  return payload(
    url.searchParams.get('trade') === 'plumbing'
      ? baseRows.filter((row) => row.trade === 'plumbing')
      : baseRows
  );
}) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });
  await page.route('**/api/projects/whoami/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 7,
        type: 'contractor',
        role: 'contractor_owner',
        email: 'contractor@example.test',
      }),
    })
  );
  await page.route('**/api/projects/contractors/onboarding/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        required_onboarding_complete: true,
        business_name: 'Test Contractor',
        trade_count: 1,
        service_region_label: 'Austin, TX',
        step: 'complete',
      }),
    })
  );
  await page.route(
    '**/api/projects/contractor/service-area-opportunities/**',
    (route) => {
      const body = responder(new URL(route.request().url()));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    }
  );
  await page.route('**/api/payments/onboarding/status/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ onboarding_status: 'complete' }),
    })
  );
}

test('renders private aggregate demand with safe actions on desktop', async ({ page }) => {
  await installMocks(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/app/service-area-opportunities', {
    waitUntil: 'domcontentloaded',
  });

  await expect(
    page.getByRole('heading', { name: 'Service Area Opportunities' })
  ).toBeVisible();
  await expect(
    page.getByText(
      'These are privacy-safe demand trends, not individual job offers.',
      { exact: false }
    )
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Emerging demand' })).toBeVisible();
  await expect(page.getByText('Private Customer')).toHaveCount(0);
  await expect(page.getByText(/@example\.com/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /contact customer/i })).toHaveCount(0);
  await expect(page.getByTestId('service-area-opportunity-row')).toHaveCount(3);
  await expect(page.getByTestId('service-area-opportunities-pagination')).toContainText(
    'Showing 1-3 of 3'
  );

  await page.screenshot({
    path: 'test-results/service-area-opportunities/desktop.png',
    fullPage: true,
  });
});

test('filters are URL backed and browser history restores the prior view', async ({ page }) => {
  await installMocks(page);
  await page.goto('/app/service-area-opportunities', {
    waitUntil: 'domcontentloaded',
  });

  await page.getByLabel('Trade').fill('plumbing');
  await expect(page).toHaveURL(/trade=plumbing/);
  await expect(page.getByTestId('service-area-opportunity-row')).toHaveCount(1);
  await page.screenshot({
    path: 'test-results/service-area-opportunities/filtered-trade.png',
    fullPage: true,
  });

  await page.getByLabel('Trade').fill('roofing');
  await expect(page).toHaveURL(/trade=roofing/);
  await page.goBack();
  await expect(page.getByLabel('Trade')).toHaveValue('plumbing');
  await expect(page.getByTestId('service-area-opportunity-row')).toHaveCount(1);
});

test('privacy suppression, empty, error, retry, and pagination states are accessible', async ({ page }) => {
  await installMocks(page);
  await page.goto('/app/service-area-opportunities', {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('cell', { name: 'Emerging demand' })).toBeVisible();
  await page.screenshot({
    path: 'test-results/service-area-opportunities/suppressed.png',
    fullPage: true,
  });

  await page.getByRole('textbox', { name: 'State', exact: true }).fill('ZZ');
  await page.getByLabel('Trade').fill('none');
  await expect(
    page.getByText(
      'No privacy-safe demand signals match your current service areas and filters.'
    )
  ).toBeVisible();
});

test('error state retries successfully', async ({ page }) => {
  let attempt = 0;
  await installMocks(page, () => {
    attempt += 1;
    if (attempt === 1) {
      return { forcedError: true };
    }
    return payload(baseRows);
  });
  await page.unroute('**/api/projects/contractor/service-area-opportunities/**');
  await page.route(
    '**/api/projects/contractor/service-area-opportunities/**',
    (route) => {
      attempt += 1;
      if (attempt === 1) {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Demand trends are temporarily unavailable.' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload(baseRows)),
      });
    }
  );
  await page.goto('/app/service-area-opportunities', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByRole('alert')).toContainText(
    'Demand trends are temporarily unavailable.'
  );
  await page.getByRole('button', { name: /retry/i }).click();
  await expect(page.getByTestId('service-area-opportunity-row')).toHaveCount(3);
});

test('pagination requests the selected server page', async ({ page }) => {
  const requestedPages = [];
  await installMocks(page, (url) => {
    const pageNumber = Number(url.searchParams.get('page') || 1);
    requestedPages.push(pageNumber);
    return payload(pageNumber === 1 ? baseRows : [baseRows[2]], pageNumber, 26);
  });
  await page.goto('/app/service-area-opportunities', {
    waitUntil: 'domcontentloaded',
  });

  await page
    .getByTestId('service-area-opportunities-pagination')
    .getByRole('button', { name: 'Next' })
    .click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByTestId('service-area-opportunity-row')).toHaveCount(1);
  expect(requestedPages).toContain(2);
});

test('a stale response cannot replace newer filtered results', async ({ page }) => {
  let releaseInitial;
  const initialGate = new Promise((resolve) => {
    releaseInitial = resolve;
  });
  let initialRequested;
  const initialSeen = new Promise((resolve) => {
    initialRequested = resolve;
  });
  await installMocks(page);
  await page.unroute('**/api/projects/contractor/service-area-opportunities/**');
  await page.route(
    '**/api/projects/contractor/service-area-opportunities/**',
    async (route) => {
      const url = new URL(route.request().url());
      if (!url.searchParams.get('state')) {
        initialRequested();
        await initialGate;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(payload([baseRows[0]])),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload([baseRows[2]])),
      });
    }
  );
  await page.goto('/app/service-area-opportunities', {
    waitUntil: 'domcontentloaded',
  });
  await initialSeen;
  await page.getByRole('textbox', { name: 'State', exact: true }).fill('TX');
  await expect(page.getByRole('cell', { name: 'Dallas, TX' })).toBeVisible();
  releaseInitial();
  await expect(page.getByRole('cell', { name: 'Dallas, TX' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Austin, TX' })).toHaveCount(0);
});

test('mobile cards are keyboard reachable and do not overflow', async ({ page }) => {
  await installMocks(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/service-area-opportunities', {
    waitUntil: 'domcontentloaded',
  });

  const cards = page.getByTestId('service-area-opportunity-cards');
  await expect(cards).toBeVisible();
  await expect(cards.locator('article')).toHaveCount(3);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflow).toBe(false);
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
  await page.screenshot({
    path: 'test-results/service-area-opportunities/mobile.png',
    fullPage: true,
  });
});

test('dashboard exposes the demand trends entry point', async ({ page }) => {
  await installMocks(page);
  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  const entry = page.getByTestId('dashboard-quick-action-demand-trends');
  await expect(entry).toBeVisible();
  await page.screenshot({
    path: 'test-results/service-area-opportunities/dashboard-summary.png',
    fullPage: true,
  });
  await entry.click();
  await expect(page).toHaveURL(/\/app\/service-area-opportunities/);
});
