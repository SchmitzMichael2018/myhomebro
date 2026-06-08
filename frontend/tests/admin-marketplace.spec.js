import { expect, test } from '@playwright/test';

const directoryRows = [
  {
    id: 1,
    business_name: 'Claimed Roofing Pro',
    website: 'https://claimedroofing.example',
    phone: '(555) 123-4567',
    public_email: 'hello@claimedroofing.example',
    contact_status: 'claimed',
    preferred_outreach_method: 'claim_link_manual',
    contact_confidence: 'high',
    claim_readiness_status: 'ready',
    address_line1: '123 Main St',
    city: 'Austin',
    state: 'TX',
    zip_code: '78701',
    rating: 4.8,
    review_count: 44,
    primary_service: 'Roofing',
    normalized_services: ['Roofing'],
    source: 'google_places',
    claimed: true,
    service_radius_miles: null,
    profile_status: 'basic',
    enrichment_status: 'reviewed',
    last_seen_at: '2026-05-12T15:00:00Z',
  },
  {
    id: 2,
    business_name: 'Local Plumbing Co',
    website: 'https://localplumbing.example',
    phone: '(555) 222-0100',
    public_email: null,
    contact_status: 'phone_ready',
    preferred_outreach_method: 'sms',
    contact_confidence: 'high',
    claim_readiness_status: 'ready',
    city: 'Dallas',
    state: 'TX',
    zip_code: '75201',
    rating: 4.7,
    review_count: 18,
    primary_service: 'Plumbing',
    normalized_services: ['Plumbing'],
    source: 'google_places',
    claimed: false,
    service_radius_miles: 25,
    profile_status: 'basic',
    enrichment_status: 'reviewed',
    last_seen_at: '2026-05-12T15:00:00Z',
  },
  {
    id: 3,
    business_name: 'San Antonio Concrete',
    website: '',
    phone: '(555) 333-0100',
    public_email: null,
    contact_status: 'phone_ready',
    preferred_outreach_method: 'sms',
    contact_confidence: 'high',
    claim_readiness_status: 'ready',
    city: 'San Antonio',
    state: 'TX',
    zip_code: '78249',
    rating: 4.2,
    review_count: 8,
    primary_service: 'Concrete',
    normalized_services: ['Concrete'],
    source: 'google_places',
    claimed: false,
    service_radius_miles: 25,
    profile_status: 'basic',
    enrichment_status: 'not_started',
    last_seen_at: '2026-05-12T15:00:00Z',
  },
];

async function installMarketplaceMocks(page) {
  let austinEnabled = false;
  let requestRouted = false;
  let routeCalls = 0;
  let verificationRows = [
    {
      id: 11,
      business_name: 'Claimed Roofing Pro',
      email: 'hello@claimedroofing.example',
      phone: '(555) 123-4567',
      active: true,
      claimed: true,
      service_area: 'Austin, TX',
      city: 'Austin',
      state: 'TX',
      trades: ['Roofing'],
      stripe_ready: true,
      charges_enabled: true,
      payouts_enabled: true,
      license_on_file: true,
      insurance_on_file: true,
      verification_status: 'pending_review',
      preferred: false,
      missing_requirements: [],
      eligible_for_marketplace: false,
      performance_summary: {
        completed_projects: 8,
        dispute_count: 0,
        review_rating: 4.9,
        review_count: 12,
      },
    },
    {
      id: 12,
      business_name: 'Partner Flooring Co',
      email: 'partner@example.com',
      phone: '(555) 222-3333',
      active: true,
      claimed: true,
      service_area: 'Austin, TX',
      city: 'Austin',
      state: 'TX',
      trades: ['Flooring'],
      stripe_ready: false,
      charges_enabled: false,
      payouts_enabled: false,
      license_on_file: false,
      insurance_on_file: false,
      verification_status: 'verified',
      preferred: false,
      missing_requirements: ['insurance'],
      eligible_for_marketplace: false,
      performance_summary: {
        completed_projects: 1,
        dispute_count: 1,
        review_rating: null,
        review_count: 0,
      },
    },
  ];

  function verificationPayload(url = new URL('https://example.test/')) {
    let rows = verificationRows;
    const status = url.searchParams.get('status') || '';
    if (status) rows = rows.filter((row) => row.verification_status === status);
    return {
      summary: {
        total: rows.length,
        pending_review: rows.filter((row) => row.verification_status === 'pending_review').length,
        verified: rows.filter((row) => row.verification_status === 'verified').length,
        preferred: rows.filter((row) => row.preferred).length,
        rejected: rows.filter((row) => row.verification_status === 'rejected').length,
        suspended: rows.filter((row) => row.verification_status === 'suspended').length,
        stripe_ready: rows.filter((row) => row.stripe_ready).length,
      },
      results: rows,
    };
  }

  function overviewPayload() {
    const counts = requestRouted
      ? { invites: 5, opportunities: 5, leads: 5 }
      : { invites: 0, opportunities: 0, leads: 0 };
    const savedRequest = {
      id: 501,
      request_title: 'Luxury Vinyl Plank Flooring',
      project_type: 'Flooring',
      project_subtype: 'Luxury Vinyl Plank',
      city: 'Austin',
      state: 'TX',
      customer_name: 'Home Owner',
      customer_email: 'homeowner@example.com',
      submitted_at: '2026-05-18T14:00:00Z',
      marketplace_status: austinEnabled ? 'enabled' : 'ready',
      marketplace_enabled: austinEnabled,
      routed_status: requestRouted ? 'at_cap' : 'not_routed',
      routable_now: austinEnabled && !requestRouted,
      already_routed: requestRouted,
      at_cap: requestRouted,
      eligible_contractors: 6,
      counts,
      cap: 5,
      reason: austinEnabled
        ? requestRouted
          ? 'Bid cap already reached.'
          : 'Ready to route to eligible contractors.'
        : 'Marketplace is not enabled for this location yet.',
    };
    return {
      coverage: {
        location_readiness: [
          {
            city: 'Austin',
            state: 'TX',
            status: austinEnabled ? 'enabled' : 'ready',
            enabled: austinEnabled,
            manual_enabled: austinEnabled,
            max_bids_per_request: 5,
            counts: {
              total_discovered: 22,
              claimed_contractors: 20,
              verified_contractors: 10,
              stripe_ready_contractors: 5,
              trade_categories: 6,
              request_volume: 3,
              avg_bids_per_request: 2.33,
            },
            missing_trade_coverage: ['hvac', 'windows'],
            marketplace_backlog: {
              saved_not_routed: requestRouted ? 0 : 1,
              routable_now: austinEnabled && !requestRouted ? 1 : 0,
              already_routed: requestRouted ? 1 : 0,
              blocked_disabled: austinEnabled ? 0 : 1,
              blocked_no_eligible_contractors: 0,
              at_cap: requestRouted ? 1 : 0,
            },
          },
          {
            city: 'Dallas',
            state: 'TX',
            status: 'not_ready',
            enabled: false,
            manual_enabled: false,
            counts: {
              total_discovered: 1,
              claimed_contractors: 0,
              verified_contractors: 0,
              stripe_ready_contractors: 0,
              trade_categories: 1,
              request_volume: 1,
              avg_bids_per_request: 0,
            },
            missing_trade_coverage: ['roofing', 'flooring'],
            marketplace_backlog: {
              saved_not_routed: 0,
              routable_now: 0,
              already_routed: 0,
              blocked_disabled: 0,
              blocked_no_eligible_contractors: 0,
              at_cap: 0,
            },
          },
        ],
      },
      saved_marketplace_requests: {
        summary: {
          saved_not_routed: requestRouted ? 0 : 1,
          routable_now: austinEnabled && !requestRouted ? 1 : 0,
          already_routed: requestRouted ? 1 : 0,
          blocked_disabled: austinEnabled ? 0 : 1,
          blocked_no_eligible_contractors: 0,
          at_cap: requestRouted ? 1 : 0,
        },
        results: [savedRequest],
      },
    };
  }

  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 1,
        type: 'admin',
        role: 'admin',
        email: 'admin@myhomebro.local',
      }),
    });
  });

  await page.route('**/api/projects/admin/marketplace/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const method = route.request().method();
    if (requestUrl.pathname.endsWith('/api/projects/admin/marketplace/verification/')) {
      if (method === 'POST') {
        const body = route.request().postDataJSON();
        verificationRows = verificationRows.map((row) => {
          if (row.id !== body.contractor_id) return row;
          if (body.action === 'verify') {
            return { ...row, verification_status: 'verified', eligible_for_marketplace: row.stripe_ready && !row.missing_requirements.length };
          }
          if (body.action === 'mark_preferred') {
            return { ...row, preferred: true };
          }
          if (body.action === 'suspend') {
            return { ...row, verification_status: 'suspended', preferred: false, eligible_for_marketplace: false };
          }
          if (body.action === 'unsuspend') {
            return { ...row, verification_status: 'unverified', preferred: false, eligible_for_marketplace: false };
          }
          if (body.action === 'remove_preferred') {
            return { ...row, preferred: false };
          }
          if (body.action === 'reject') {
            return { ...row, verification_status: 'rejected', preferred: false, eligible_for_marketplace: false };
          }
          return row;
        });
        const updated = verificationRows.find((row) => row.id === body.contractor_id);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(updated),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(verificationPayload(requestUrl)),
      });
      return;
    }
    if (method === 'POST' && requestUrl.pathname.endsWith('/api/projects/admin/marketplace/route-intake/')) {
      routeCalls += 1;
      const createdCount = requestRouted ? 0 : 5;
      requestRouted = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          created_count: createdCount,
          cap: 5,
          cap_reached: true,
          route_calls: routeCalls,
          created: createdCount
            ? Array.from({ length: 5 }, (_, index) => ({
                id: index + 1,
                contractor_id: index + 10,
                contractor_opportunity_id: index + 100,
                public_lead_id: index + 200,
              }))
            : [],
          marketplace: { enabled: true, status: 'enabled' },
        }),
      });
      return;
    }
    if (method === 'POST' && requestUrl.pathname.endsWith('/api/projects/admin/marketplace/locations/')) {
      const body = route.request().postDataJSON();
      if (body.city === 'Austin' && body.state === 'TX') {
        austinEnabled = Boolean(body.enabled);
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          city: body.city,
          state: body.state,
          status: body.enabled ? 'enabled' : 'ready',
          enabled: Boolean(body.enabled),
          manual_enabled: Boolean(body.enabled),
          counts: {
            total_discovered: 22,
            claimed_contractors: 20,
            verified_contractors: 10,
            stripe_ready_contractors: 5,
            trade_categories: 6,
            request_volume: 3,
            avg_bids_per_request: 2.33,
          },
          missing_trade_coverage: [],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(overviewPayload()),
    });
  });

  await page.route('**/api/projects/admin/contractor-directory/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const method = route.request().method();

    if (method === 'POST' && requestUrl.pathname.endsWith('/api/projects/admin/contractor-directory/2/claim-link/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ claim_url: '/contractors/claim/test-token' }),
      });
      return;
    }

    const detailMatch = requestUrl.pathname.match(/\/api\/projects\/admin\/contractor-directory\/(\d+)\/$/);
    if (method === 'GET' && detailMatch) {
      const row = directoryRows.find((item) => String(item.id) === detailMatch[1]) || directoryRows[0];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(row),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        count: directoryRows.length,
        results: directoryRows,
      }),
    });
  });
}

test('admin marketplace is an operations console, not a duplicate directory editor', async ({ page }) => {
  await installMarketplaceMocks(page);

  await page.goto('/app/admin/marketplace', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Marketplace Operations' })).toBeVisible();
  await expect(page.getByText('Monitor contractor coverage, claim readiness, service gaps, and routing health')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-summary')).toBeVisible();
  await expect(page.getByText('Total Directory Listings')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-summary').getByText('Claimed Contractors')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-summary').getByText('Unclaimed Listings')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-summary').getByText('Contact Ready')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-summary').getByText('Email Ready')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-summary').getByText('Phone Ready')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-summary').getByText('Website Form Ready')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-summary').getByText('Manual Review Needed')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-service-gaps').getByText('Plumbing')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-geo-gaps').getByText('Dallas, TX')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-location-readiness')).toContainText('City Readiness');
  await expect(page.getByTestId('admin-marketplace-location-readiness')).toContainText('Austin, TX');
  await expect(page.getByTestId('admin-marketplace-location-readiness')).toContainText('20 claimed');
  await expect(page.getByTestId('admin-marketplace-metric-phone-ready')).toHaveClass(/cursor-pointer/);

  await expect(page.getByText('Import Enriched CSV')).toHaveCount(0);
  await expect(page.getByText('Export Missing Emails CSV')).toHaveCount(0);
  await expect(page.getByText('Edit Contractor Entry')).toHaveCount(0);

  await page.getByTestId('admin-marketplace-tabs').getByRole('button', { name: 'Marketplace Coverage' }).click();
  await expect(page.getByTestId('admin-marketplace-contractors-view')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-coverage-row-1')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-coverage-row-1')).toContainText('Claimed');
  await expect(page.getByTestId('admin-marketplace-open-directory-1')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-open-listing-1')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-claim-link-2')).toBeVisible();

  await page.getByTestId('admin-marketplace-claim-link-2').click();
  await expect(page.getByTestId('admin-marketplace-copy-claim-link-2')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-status')).toContainText('Claim link generated');

  await page.getByTestId('admin-marketplace-open-directory-1').click();
  await expect(page).toHaveURL(/\/app\/admin\/contractor-directory\?entry=1/);
});

test('admin marketplace health cards drill into directory and coverage filters', async ({ page }) => {
  await installMarketplaceMocks(page);

  await page.goto('/app/admin/marketplace', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('admin-marketplace-metric-phone-ready').click();
  await expect(page).toHaveURL(/\/app\/admin\/contractor-directory\?contact_status=phone_ready/);

  await page.goto('/app/admin/marketplace', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('admin-marketplace-metric-unclaimed').click();
  await expect(page).toHaveURL(/\/app\/admin\/contractor-directory\?claimed=false/);

  await page.goto('/app/admin/marketplace', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('admin-marketplace-service-gap-Plumbing').click();
  await expect(page).toHaveURL(/\/app\/admin\/marketplace\/contractors/);
  await expect(page.getByTestId('admin-marketplace-service-filter')).toHaveValue('Plumbing');
  await expect(page.getByTestId('admin-marketplace-claimed-filter')).toHaveValue('false');

  await page.goto('/app/admin/marketplace', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('admin-marketplace-high-rated-item-2').click();
  await expect(page).toHaveURL(/\/app\/admin\/marketplace\/listings\/2/);
});

test('admin marketplace verification queue filters and updates trust controls', async ({ page }) => {
  await installMarketplaceMocks(page);

  await page.goto('/app/admin/marketplace/verification', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('admin-marketplace-verification-view')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-verification-row-11')).toContainText('Claimed Roofing Pro');
  await expect(page.getByTestId('admin-marketplace-verification-row-11')).toContainText('pending review');
  await expect(page.getByTestId('admin-marketplace-verification-row-12')).toContainText('Partner Flooring Co');

  await page.getByTestId('admin-marketplace-verification-status-filter').selectOption('pending_review');
  await page.getByTestId('admin-marketplace-verification-apply-filters').click();
  await expect(page.getByTestId('admin-marketplace-verification-row-11')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-verification-row-12')).toHaveCount(0);

  await page.getByTestId('admin-marketplace-verification-notes-11').fill('Admin reviewed profile.');
  await page.getByTestId('admin-marketplace-verify-11').click();
  await expect(page.getByTestId('admin-marketplace-status')).toContainText('verify complete');
  await expect(page.getByTestId('admin-marketplace-verification-row-11')).toContainText('verified');

  await page.getByTestId('admin-marketplace-mark-preferred-11').click();
  await expect(page.getByTestId('admin-marketplace-verification-row-11')).toContainText('Preferred');

  await page.getByTestId('admin-marketplace-suspend-11').click();
  await expect(page.getByTestId('admin-marketplace-verification-row-11')).toContainText('suspended');
  await expect(page.getByTestId('admin-marketplace-mark-preferred-11')).toBeDisabled();
});

test('admin marketplace routes saved requests after location enablement without duplicate UI state', async ({ page }) => {
  await installMarketplaceMocks(page);

  const routeRequests = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/projects/admin/marketplace/route-intake/')) {
      routeRequests.push(request.postDataJSON());
    }
  });

  await page.goto('/app/admin/marketplace', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('admin-marketplace-saved-requests')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-saved-request-501')).toContainText('Luxury Vinyl Plank Flooring');
  await expect(page.getByTestId('admin-marketplace-saved-request-501')).toContainText('Marketplace is not enabled for this location yet.');
  await expect(page.getByTestId('admin-marketplace-route-request-501')).toBeDisabled();
  await expect(page.getByTestId('admin-marketplace-route-all-eligible')).toBeDisabled();
  await expect(page.getByTestId('admin-marketplace-backlog-disabled')).toContainText('1');

  await page.getByTestId('admin-marketplace-location-enable-Austin-TX').click();
  await expect(page.getByTestId('admin-marketplace-status')).toContainText('Austin, TX enabled');
  await expect(page.getByTestId('admin-marketplace-route-request-501')).toBeEnabled();
  await expect(page.getByTestId('admin-marketplace-saved-request-501')).toContainText('Ready to route to eligible contractors.');
  await expect(page.getByTestId('admin-marketplace-backlog-routable')).toContainText('1');

  await page.getByTestId('admin-marketplace-route-request-501').click();
  await expect(page.getByTestId('admin-marketplace-status')).toContainText('Routed 5 contractor opportunities');
  await expect(page.getByTestId('admin-marketplace-saved-request-501')).toContainText('5 invites');
  await expect(page.getByTestId('admin-marketplace-saved-request-501')).toContainText('5 opportunities');
  await expect(page.getByTestId('admin-marketplace-saved-request-501')).toContainText('5 leads');
  await expect(page.getByTestId('admin-marketplace-route-request-501')).toBeDisabled();
  await expect(page.getByTestId('admin-marketplace-route-request-501')).toContainText('At cap');
  await expect(page.getByTestId('admin-marketplace-route-all-eligible')).toBeDisabled();
  expect(routeRequests).toEqual([{ intake_id: 501 }]);
});

test('admin marketplace bulk routes only eligible saved requests', async ({ page }) => {
  await installMarketplaceMocks(page);

  const routeRequests = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/projects/admin/marketplace/route-intake/')) {
      routeRequests.push(request.postDataJSON());
    }
  });

  await page.goto('/app/admin/marketplace', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('admin-marketplace-route-all-eligible')).toBeDisabled();

  await page.getByTestId('admin-marketplace-location-enable-Austin-TX').click();
  await expect(page.getByTestId('admin-marketplace-route-all-eligible')).toBeEnabled();

  await page.getByTestId('admin-marketplace-route-all-eligible').click();
  await expect(page.getByTestId('admin-marketplace-status')).toContainText('Routed 5 contractor opportunities across 1 request');
  await expect(page.getByTestId('admin-marketplace-saved-request-501')).toContainText('5 leads');
  await expect(page.getByTestId('admin-marketplace-route-all-eligible')).toBeDisabled();
  expect(routeRequests).toEqual([{ intake_id: 501 }]);
});

test('admin marketplace listing detail is a readiness view with Directory handoff', async ({ page }) => {
  await installMarketplaceMocks(page);

  await page.goto('/app/admin/marketplace/listings/1', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('admin-marketplace-listing-detail')).toBeVisible();
  await expect(page.getByText('Marketplace readiness view')).toBeVisible();
  await expect(page.getByText('Matching and Routing Readiness')).toBeVisible();
  await expect(page.getByText('Open full Directory record')).toBeVisible();
  await expect(page.getByText('Save Listing')).toHaveCount(0);
  await expect(page.getByText('Compatibility Tags')).toHaveCount(0);

  await page.getByTestId('admin-marketplace-open-directory-detail').click();
  await expect(page).toHaveURL(/\/app\/admin\/contractor-directory\?entry=1/);
});

test('admin marketplace import route points admins back to Contractor Directory', async ({ page }) => {
  await installMarketplaceMocks(page);

  await page.goto('/app/admin/marketplace/import', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('admin-marketplace-directory-redirect')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-directory-redirect').getByRole('heading', { name: 'Contractor Directory' })).toBeVisible();
  await expect(page.getByText('Manage contractor records, enrichment, claim links, and profile data.')).toBeVisible();
  await expect(page.getByText('Search and import new businesses')).toHaveCount(0);
});
