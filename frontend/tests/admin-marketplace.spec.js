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

async function installMarketplaceMocks(page, {
  includeLegacyMissingLocation = false,
  mapMode = 'ready',
} = {}) {
  await page.addInitScript(({ mode }) => {
    window.__MHB_ADMIN_MAP_CONFIG__ = mode === 'missing'
      ? { apiKey: '', mapId: '' }
      : { apiKey: 'fake-browser-key', mapId: 'fake-admin-map-id' };
    window.__MHB_ADMIN_MAP_METRICS__ = {
      initializations: 0,
      updates: 0,
      markers: [],
      mapIds: [],
    };
    window.__MHB_ADMIN_MAP_ADAPTER__ = {
      async createCoverageMap({ config, points, onSelect, onViewportChange }) {
        if (mode === 'failure') throw new Error('Mock provider failure');
        window.__MHB_ADMIN_MAP_METRICS__.initializations += 1;
        window.__MHB_ADMIN_MAP_METRICS__.mapIds.push(config.mapId);
        window.__MHB_ADMIN_MAP_METRICS__.markers = points.map((point) => point.id);
        const host = document.querySelector('[data-testid="admin-marketplace-google-map"] > div');
        if (host) {
          host.innerHTML = '';
          points.forEach((point) => {
            const marker = document.createElement('button');
            marker.type = 'button';
            marker.textContent = String(point.total);
            marker.setAttribute('aria-label', `${point.state} aggregate marker`);
            marker.addEventListener('click', () => onSelect(point));
            host.appendChild(marker);
          });
        }
        return {
          update(nextPoints) {
            window.__MHB_ADMIN_MAP_METRICS__.updates += 1;
            window.__MHB_ADMIN_MAP_METRICS__.markers = nextPoints.map((point) => point.id);
          },
          reset() {},
          focus(point) {
            onViewportChange({
              zoom: point.aggregation_level === 'state' ? 6 : 10,
              south: 20,
              west: -130,
              north: 50,
              east: -60,
            });
          },
          destroy() {},
        };
      },
    };
  }, { mode: mapMode });
  let austinEnabled = false;
  let requestRouted = false;
  let routeCalls = 0;
  let lifecycleStatus = 'open';
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
        performance_score: 91,
        confidence_label: 'High Confidence',
        completed_projects: 8,
        dispute_count: 0,
        review_rating: 4.9,
        review_count: 12,
        marketplace_bid_win_percent: 67,
        on_time_milestone_percent: 96,
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
        performance_score: 71,
        confidence_label: 'Low Confidence',
        completed_projects: 1,
        dispute_count: 1,
        review_rating: null,
        review_count: 0,
        marketplace_bid_win_percent: null,
        on_time_milestone_percent: null,
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
      source: 'landing_page',
      source_label: 'Landing',
      customer_linked: true,
      contractor_linked: requestRouted,
      request_title: 'Luxury Vinyl Plank Flooring',
      project_type: 'Flooring',
      project_subtype: 'Luxury Vinyl Plank',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      location_complete: true,
      customer_name: 'Home Owner',
      customer_email: 'homeowner@example.com',
      submitted_at: '2026-05-18T14:00:00Z',
      lifecycle_status: lifecycleStatus,
      request_age_days: 7,
      last_meaningful_activity_at: '2026-05-18T14:00:00Z',
      archived_at: lifecycleStatus === 'archived' ? '2026-05-25T14:00:00Z' : null,
      archive_reason: lifecycleStatus === 'archived' ? 'admin_archived' : '',
      purge_eligible_at: lifecycleStatus === 'archived' ? '2026-08-23T14:00:00Z' : null,
      protection_reason: lifecycleStatus === 'retention_protected' ? 'Customer request history' : '',
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
        : 'Building local coverage. Automatic matching is not yet available, and the request is saved for future matching.',
      can_participate: true,
      can_search: true,
      can_direct_invite: true,
      can_auto_route: austinEnabled,
      saved_for_future_matching: !austinEnabled && !requestRouted,
    };
    const legacyRequest = {
      id: 502, source: 'landing_page', source_label: 'Landing Page',
      customer_linked: false, contractor_linked: false,
      request_title: 'Legacy saved request', project_type: '', project_subtype: '',
      city: '', state: '', zip: '', location_complete: false,
      customer_name: '', customer_email: '', submitted_at: '2026-05-18T14:00:00Z',
      marketplace_status: 'location_needed',
      marketplace_status_label: 'Location needed',
      marketplace_status_reason: 'A complete project city and state are required before coverage or routing can be evaluated.',
      marketplace_enabled: false,
      routed_status: 'not_routed', routable_now: false, already_routed: false,
      at_cap: false, eligible_contractors: 0,
      counts: { invites: 0, opportunities: 0, leads: 0 }, cap: 5,
      reason: 'Location unavailable. View the request and obtain the project city and state before routing.',
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
              automatic_routing_unavailable: austinEnabled ? 0 : 1,
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
          saved_not_routed: (requestRouted ? 0 : 1) + Number(includeLegacyMissingLocation),
          routable_now: austinEnabled && !requestRouted ? 1 : 0,
          already_routed: requestRouted ? 1 : 0,
          blocked_location_missing: Number(includeLegacyMissingLocation),
          blocked_disabled: austinEnabled ? 0 : 1,
          blocked_no_eligible_contractors: 0,
          at_cap: requestRouted ? 1 : 0,
        },
        results: includeLegacyMissingLocation ? [legacyRequest, savedRequest] : [savedRequest],
      },
    };
  }

  function analyticsPayload(url = new URL('https://example.test/')) {
    const city = url.searchParams.get('city') || '';
    const filteredToDallas = city.toLowerCase() === 'dallas';
    return {
      generated_at: '2026-06-08T12:00:00Z',
      filters: { city },
      funnel: filteredToDallas
        ? {
            requests_submitted: 1,
            requests_routed: 0,
            contractor_invites_created: 0,
            contractor_opportunities_created: 0,
            bids_submitted: 0,
            requests_with_zero_bids: 1,
            requests_with_at_least_one_bid: 0,
            awarded_requests: 0,
            agreement_drafts_created: 0,
            signed_agreements: 0,
            escrow_funded: 0,
          }
        : {
            requests_submitted: 3,
            requests_routed: 2,
            contractor_invites_created: 10,
            contractor_opportunities_created: 10,
            bids_submitted: 7,
            requests_with_zero_bids: 1,
            requests_with_at_least_one_bid: 2,
            awarded_requests: 1,
            agreement_drafts_created: 1,
            signed_agreements: 0,
            escrow_funded: 0,
          },
      conversion_rates: filteredToDallas
        ? {
            request_to_routed: 0,
            routed_to_bid_received: 0,
            bid_received_to_awarded: 0,
            awarded_to_agreement_draft: 0,
            agreement_draft_to_signed: 0,
            signed_to_escrow_funded: 0,
          }
        : {
            request_to_routed: 67,
            routed_to_bid_received: 100,
            bid_received_to_awarded: 50,
            awarded_to_agreement_draft: 100,
            agreement_draft_to_signed: 0,
            signed_to_escrow_funded: 0,
          },
      city_analytics: filteredToDallas
        ? [{ city: 'Dallas', state: 'TX', requests: 1, routed: 0, bids: 0, zero_bid_requests: 1, awarded_requests: 0, agreement_drafts: 0, average_bids_per_request: 0, agreement_conversion_rate: 0 }]
        : [
            { city: 'Austin', state: 'TX', requests: 2, routed: 2, bids: 7, zero_bid_requests: 0, awarded_requests: 1, agreement_drafts: 1, average_bids_per_request: 3.5, agreement_conversion_rate: 50 },
            { city: 'Dallas', state: 'TX', requests: 1, routed: 0, bids: 0, zero_bid_requests: 1, awarded_requests: 0, agreement_drafts: 0, average_bids_per_request: 0, agreement_conversion_rate: 0 },
          ],
      contractor_analytics: filteredToDallas
        ? []
        : [
            {
              contractor_id: 11,
              business_name: 'Claimed Roofing Pro',
              verification_status: 'verified',
              preferred: true,
              opportunities_received: 4,
              bids_submitted: 4,
              bids_won: 1,
              win_rate: 25,
              average_bid_amount: '8500.00',
              average_rating: 4.9,
              review_count: 12,
              performance_score: 91,
              confidence_label: 'High Confidence',
            },
          ],
      attention_queues: {
        zero_bid_requests: [{ id: 501, title: 'Luxury Vinyl Plank Flooring', city: 'Dallas', state: 'TX', submitted_at: '2026-05-18T14:00:00Z', routed: false }],
        requests_awaiting_award: [{ id: 601, title: 'Roof Repair', city: 'Austin', state: 'TX', bid_count: 3, oldest_bid_at: '2026-05-19T14:00:00Z' }],
        awarded_not_signed_or_funded: [{ lead_id: 701, agreement_id: 901, title: 'Window Replacement', contractor: 'Claimed Roofing Pro', created_at: '2026-05-20T14:00:00Z', escrow_funded: false }],
      },
      time_metrics: {
        avg_request_to_first_bid_days: 1.25,
        avg_request_to_award_days: 3,
        avg_award_to_agreement_draft_days: 0.1,
      },
      location_summary: { enabled_cities: 1, ready_cities: 2 },
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

  if (includeLegacyMissingLocation) {
    await page.route('**/api/projects/admin/requests/**', async (route) => {
      const detail = route.request().url().endsWith('/502/');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail ? {
          id: 502, reference: 'REQ-502', title: 'Legacy saved request',
          customer: { name: '', email: '', phone: '' },
          location: { city: '', state: '', zip: '' },
          workflow_status: 'submitted', routing_status: 'not_routed',
          verification: 'unknown', trust: 'unknown', classification: 'real',
          description: 'Legacy request', analysis: '', classification_events: [],
        } : { results: [], summary: {}, pagination: {}, permissions: {} }),
      });
    });
  }

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
    if (method === 'GET' && requestUrl.pathname.endsWith('/api/projects/admin/marketplace/analytics/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(analyticsPayload(requestUrl)),
      });
      return;
    }
    if (method === 'GET' && requestUrl.pathname.endsWith('/api/projects/admin/marketplace/coverage/')) {
      const zoom = Number(requestUrl.searchParams.get('zoom') || 4);
      const state = requestUrl.searchParams.get('state') || '';
      const city = requestUrl.searchParams.get('city') || '';
      const aggregationLevel = zoom >= 9 ? 'zip' : zoom >= 5 ? 'city' : 'state';
      const point = {
        id: aggregationLevel === 'state' ? 'TX||' : aggregationLevel === 'city' ? 'TX|Austin|' : 'TX|Austin|78701',
        aggregation_level: aggregationLevel,
        city: aggregationLevel === 'state' ? '' : 'Austin',
        state: 'TX',
        zip: aggregationLevel === 'zip' ? '78701' : '',
        latitude: aggregationLevel === 'state' ? 31.0545 : 30.2672,
        longitude: aggregationLevel === 'state' ? -97.5635 : -97.7431,
        coordinate_source: aggregationLevel === 'state' ? 'public_state_center' : 'directory_business_centroid',
        counts: {
          active_demand: 3,
          unanswered_demand: 2,
          responded_demand: 1,
          eligible_claimed_supply: 1,
          directory_prospects: 2,
          contact_ready_prospects: 1,
        },
        coverage_classification: 'limited_supply',
        trade_mix: [{ trade: 'roofing', demand: 2, claimed_supply: 1, directory_prospects: 1 }],
        oldest_active_demand_age_days: 21,
        newest_active_demand_age_days: 2,
        total: 6,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          applied_filters: { aggregation_level: aggregationLevel, state, city },
          aggregation_level: aggregationLevel,
          points: [point],
          clusters: [point],
          summary: {
            active_demand: 3,
            eligible_claimed_supply: 1,
            directory_prospects: 2,
            area_count: 1,
            returned_area_count: 1,
            coverage_classifications: { limited_supply: 1 },
          },
          facets: {
            trades: ['roofing', 'plumbing'],
            states: ['TX'],
            cities: [{ state: 'TX', city: 'Austin' }, { state: 'TX', city: 'Dallas' }],
            zips: [{ state: 'TX', city: 'Austin', zip: '78701' }],
            coverage_classifications: ['critical_gap', 'limited_supply', 'covered', 'supply_only'],
          },
          location_needed: {
            active_demand: Number(includeLegacyMissingLocation),
            directory_prospects: 0,
            eligible_claimed_supply: 0,
            total: Number(includeLegacyMissingLocation),
          },
          limited: false,
          instruction: '',
          privacy: 'Request and homeowner coordinates are never read or serialized.',
        }),
      });
      return;
    }
    if (method === 'GET' && requestUrl.pathname.endsWith('/api/projects/admin/marketplace/requests/')) {
      if (requestUrl.searchParams.get('lifecycle_status') === 'retention_protected') {
        lifecycleStatus = 'retention_protected';
      }
      const payload = overviewPayload().saved_marketplace_requests;
      const selectedLifecycle = requestUrl.searchParams.get('lifecycle_status') || 'operational';
      const results = payload.results.filter((row) => {
        const rowLifecycle = row.lifecycle_status || 'open';
        if (selectedLifecycle === 'all') return true;
        if (selectedLifecycle === 'operational') return !['archived', 'purge_due', 'retention_protected'].includes(rowLifecycle);
        return rowLifecycle === selectedLifecycle;
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...payload,
          results,
          pagination: { page: 1, page_size: 25, total: results.length, total_pages: 1, has_previous: false, has_next: false },
        }),
      });
      return;
    }
    if (method === 'POST' && /\/api\/projects\/admin\/marketplace\/requests\/\d+\/lifecycle\/$/.test(requestUrl.pathname)) {
      const body = route.request().postDataJSON();
      lifecycleStatus = body.action === 'restore' ? 'open' : 'archived';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ changed: true, lifecycle_status: lifecycleStatus }),
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

    if (method === 'POST' && requestUrl.pathname.endsWith('/api/projects/admin/contractor-directory/2/join-invite/')) {
      const entry = {
        ...directoryRows.find((item) => item.id === 2),
        marketplace_join_invite: {
          id: 900,
          directory_entry_id: 2,
          status: 'suppressed',
          delivery_channel: 'sms',
          sms_status: 'suppressed',
          sms_error: 'Marketplace join invite SMS is disabled.',
          claim_url: '/contractors/directory-claim/join-token',
          sent_at: '2026-06-09T20:00:00Z',
        },
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: 'Marketplace join invite processed.',
          invite: entry.marketplace_join_invite,
          entry,
        }),
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
  await expect(page.getByText('Monitor demand, routing, coverage, and contractor eligibility')).toBeVisible();
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

  await page.getByTestId('admin-marketplace-tabs').getByRole('button', { name: 'Contractor Coverage' }).click();
  await expect(page.getByTestId('admin-marketplace-contractors-view')).toBeVisible();
  await expect(page.getByText('Read-only marketplace eligibility and service-area view')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-coverage-row-1')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-coverage-row-1')).toContainText('Claimed');
  await expect(page.getByTestId('admin-marketplace-open-directory-1')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-open-listing-1')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-claim-link-2')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-join-invite-2')).toBeVisible();

  await page.getByTestId('admin-marketplace-join-invite-2').click();
  await expect(page.getByTestId('admin-marketplace-status')).toContainText('Join marketplace invite suppressed');
  await expect(page.getByTestId('admin-marketplace-coverage-row-2')).toContainText('Invite: Suppressed');

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
  await expect(page.getByTestId('admin-marketplace-verification-performance-11')).toContainText('Score 91');
  await expect(page.getByTestId('admin-marketplace-verification-performance-11')).toContainText('High Confidence');
  await expect(page.getByTestId('admin-marketplace-verification-performance-11')).toContainText('Win 67%');
  await expect(page.getByTestId('admin-marketplace-verification-performance-11')).toContainText('On-time 96%');
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

test('admin marketplace analytics renders funnel, tables, queues, and filters', async ({ page }) => {
  await installMarketplaceMocks(page);

  await page.goto('/app/admin/marketplace/analytics', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('admin-marketplace-analytics-page')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-analytics-requests')).toContainText('3');
  await expect(page.getByTestId('admin-marketplace-analytics-routed')).toContainText('2');
  await expect(page.getByTestId('admin-marketplace-analytics-bids')).toContainText('7');
  await expect(page.getByTestId('admin-marketplace-analytics-awarded')).toContainText('1');
  await expect(page.getByTestId('admin-marketplace-analytics-funnel')).toContainText('Routed -> Bid');
  await expect(page.getByTestId('admin-marketplace-analytics-city-Austin-TX')).toContainText('Austin, TX');
  await expect(page.getByTestId('admin-marketplace-analytics-city-Austin-TX')).toContainText('3.5 avg/request');
  await expect(page.getByTestId('admin-marketplace-analytics-contractor-11')).toContainText('Claimed Roofing Pro');
  await expect(page.getByTestId('admin-marketplace-analytics-contractor-11')).toContainText('Score 91');
  await expect(page.getByTestId('admin-marketplace-analytics-attention')).toContainText('Zero-bid requests');
  await expect(page.getByTestId('admin-marketplace-analytics-attention')).toContainText('Luxury Vinyl Plank Flooring');
  await expect(page.getByTestId('admin-marketplace-analytics-attention')).toContainText('Awarded not signed/funded');

  await page.getByTestId('admin-marketplace-analytics-city').fill('Dallas');
  await page.getByTestId('admin-marketplace-analytics-apply').click();
  await expect(page).toHaveURL(/\/app\/admin\/marketplace\/analytics\?city=Dallas/);
  await expect(page.getByTestId('admin-marketplace-analytics-requests')).toContainText('1');
  await expect(page.getByTestId('admin-marketplace-analytics-bids')).toContainText('0');
  await expect(page.getByTestId('admin-marketplace-analytics-city-Dallas-TX')).toContainText('Dallas, TX');
});

test('admin marketplace routes saved requests after location enablement without duplicate UI state', async ({ page }) => {
  test.slow();
  await installMarketplaceMocks(page);

  const routeRequests = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/projects/admin/marketplace/route-intake/')) {
      routeRequests.push(request.postDataJSON());
    }
  });

  await page.goto('/app/admin/marketplace', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('admin-marketplace-saved-requests')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('admin-marketplace-saved-request-501')).toContainText('Luxury Vinyl Plank Flooring');
  await expect(page.getByTestId('admin-marketplace-saved-request-501')).toContainText('Austin, TX, 78701');
  await expect(page.getByTestId('admin-marketplace-request-badges-501')).toContainText('Landing');
  await expect(page.getByTestId('admin-marketplace-request-badges-501')).toContainText('Customer Linked');
  await expect(page.getByTestId('admin-marketplace-request-badges-501')).toContainText('Contractor Pending');
  await expect(page.getByTestId('admin-marketplace-saved-request-501')).toContainText('Building local coverage.');
  await expect(page.getByTestId('admin-marketplace-saved-request-501')).toContainText('saved for future matching');
  await expect(page.getByTestId('admin-marketplace-saved-request-501')).not.toContainText(/marketplace disabled|marketplace is not enabled/i);
  await expect(page.getByTestId('admin-marketplace-route-request-501')).toBeDisabled();
  await expect(page.getByTestId('admin-marketplace-backlog-disabled')).toContainText('1');
  await expect(page.getByTestId('admin-marketplace-backlog-disabled')).toContainText('Building Coverage');
  await page.getByTestId('admin-marketplace-saved-requests').screenshot({
    path: 'test-results/marketplace-location-admin-saved-not-routed.png',
  });

  await page.getByTestId('admin-marketplace-location-enable-Austin-TX').click();
  await expect(page.getByTestId('admin-marketplace-status')).toContainText('Austin, TX activated for automatic routing');
  await expect(page.getByTestId('admin-marketplace-route-request-501')).toBeEnabled();
  await expect(page.getByTestId('admin-marketplace-saved-request-501')).toContainText('Ready to route to eligible contractors.');
  await expect(page.getByTestId('admin-marketplace-backlog-routable')).toContainText('1');

  await page.getByTestId('admin-marketplace-route-request-501').click();
  await expect(page.getByTestId('admin-marketplace-status')).toContainText('Routed 5 contractor opportunities');
  await expect(page.getByTestId('admin-marketplace-saved-request-501')).toContainText('5 invites');
  await expect(page.getByTestId('admin-marketplace-saved-request-501')).toContainText('5 opportunities');
  await expect(page.getByTestId('admin-marketplace-saved-request-501')).toContainText('5 leads');
  await expect(page.getByTestId('admin-marketplace-request-badges-501')).toContainText('Contractor Linked');
  await expect(page.getByTestId('admin-marketplace-route-request-501')).toBeDisabled();
  await expect(page.getByTestId('admin-marketplace-route-request-501')).toContainText('At cap');
  expect(routeRequests).toEqual([{ intake_id: 501 }]);
});

test('admin request lifecycle uses URL filters and confirmed archive and restore dialogs', async ({ page }) => {
  test.slow();
  await installMarketplaceMocks(page);
  const lifecycleRequests = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/lifecycle/')) {
      lifecycleRequests.push(request.postDataJSON());
    }
  });

  await page.goto('/app/admin/marketplace/requests?lifecycle_status=operational', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('admin-marketplace-request-row-501')).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel('Filter lifecycle status')).toHaveValue('operational');
  await expect(page).toHaveURL(/lifecycle_status=operational/);
  await page.getByTestId('admin-marketplace-request-queue').screenshot({
    path: 'test-results/marketplace-lifecycle-operational-queue.png',
  });

  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByTestId('admin-marketplace-request-lifecycle-dialog')).toBeVisible();
  await page.getByTestId('admin-marketplace-request-lifecycle-dialog').screenshot({
    path: 'test-results/marketplace-lifecycle-archive-dialog.png',
  });
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(lifecycleRequests).toHaveLength(0);

  await page.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('button', { name: 'Archive request' }).click();
  await expect(page.getByTestId('admin-marketplace-request-row-501')).toHaveCount(0);
  await page.getByLabel('Filter lifecycle status').selectOption('archived');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
  await page.getByTestId('admin-marketplace-request-queue').screenshot({
    path: 'test-results/marketplace-lifecycle-archived-filter.png',
  });
  expect(lifecycleRequests).toEqual([{ action: 'archive', confirmed: true }]);

  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByTestId('admin-marketplace-request-lifecycle-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Restore request' }).click();
  await expect(page.getByTestId('admin-marketplace-request-row-501')).toHaveCount(0);
  expect(lifecycleRequests).toEqual([
    { action: 'archive', confirmed: true },
    { action: 'restore', confirmed: true },
  ]);

  await page.getByLabel('Filter lifecycle status').selectOption('retention_protected');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByTestId('admin-marketplace-request-row-501')).toContainText('Customer request history');
  await page.getByTestId('admin-marketplace-request-queue').screenshot({
    path: 'test-results/marketplace-lifecycle-retention-protected.png',
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('admin-marketplace-request-mobile-501')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-request-mobile-501')).toContainText('Retention protection');
  await page.getByTestId('admin-marketplace-request-queue').screenshot({
    path: 'test-results/marketplace-lifecycle-mobile-archived.png',
  });
});

test('legacy saved request shows missing location, stays unroutable, and opens request review on mobile', async ({ page }) => {
  test.slow();
  await installMarketplaceMocks(page, { includeLegacyMissingLocation: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const routeRequests = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/projects/admin/marketplace/route-intake/')) {
      routeRequests.push(request.postDataJSON());
    }
  });

  await page.goto('/app/admin/marketplace', { waitUntil: 'domcontentloaded' });
  const legacy = page.getByTestId('admin-marketplace-saved-request-502');
  await expect(legacy).toContainText('Location unavailable', { timeout: 30000 });
  await expect(legacy).toContainText(/location needed/i);
  await expect(legacy).not.toContainText('nearing ready');
  await expect(legacy).not.toContainText('Marketplace disabled');
  await expect(page.getByTestId('admin-marketplace-backlog-location-missing')).toContainText('1');
  await expect(page.getByTestId('admin-marketplace-route-request-502')).toBeDisabled();
  await expect(page.getByTestId('admin-marketplace-route-request-501')).toBeDisabled();
  expect(await page.getByTestId('admin-marketplace-saved-requests').evaluate((element) => element.scrollWidth <= element.clientWidth + 2)).toBe(true);
  expect(routeRequests).toEqual([]);

  await page.getByTestId('admin-marketplace-view-request-502').click();
  await expect(page).toHaveURL(/\/app\/admin\/requests\?request=502/);
  await expect(page.getByRole('dialog', { name: 'Request REQ-502' })).toBeVisible();
});

test('admin marketplace has one compact navigation and mocked national coverage map', async ({ page }) => {
  await installMarketplaceMocks(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/admin/marketplace', { waitUntil: 'domcontentloaded' });
  const navigation = page.getByTestId('admin-marketplace-tabs');
  await expect(navigation).toHaveCount(1);
  await expect(navigation.getByRole('button')).toHaveCount(6);
  await expect(navigation.getByRole('button', { name: 'Coverage Overview' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Map & Coverage')).toHaveCount(0);
  await expect(page.getByText('Directory Console')).toHaveCount(0);
  await expect(page.getByTestId('admin-marketplace-coverage-workspace')).toBeVisible();
  await expect(page.getByRole('region', { name: 'National marketplace coverage map' })).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-coverage-area-TX||')).toContainText('TX');
  await expect(page.getByTestId('admin-marketplace-coverage-area-TX||')).toHaveCount(1);
  await page.getByTestId('admin-marketplace-coverage-area-TX||').click();
  await expect(page.getByTestId('admin-marketplace-coverage-detail')).toContainText('TX');
  await expect(page.getByTestId('admin-marketplace-coverage-detail')).toContainText('Limited supply');
  await expect.poll(() => page.evaluate(() => window.__MHB_ADMIN_MAP_METRICS__)).toMatchObject({
    initializations: 1,
    mapIds: ['fake-admin-map-id'],
    markers: ['TX||'],
  });
  await expect(page.getByTestId('admin-marketplace-route-all-eligible')).toHaveCount(0);
  const coverageTop = await page.getByTestId('admin-marketplace-coverage-overview-section').evaluate((element) => element.getBoundingClientRect().top);
  expect(coverageTop).toBeLessThan(230);
  await page.screenshot({ path: 'test-results/coverage-map-national-desktop.png', fullPage: true });

  await page.getByRole('button', { name: 'Zoom to area' }).click();
  await expect(page.getByTestId('admin-marketplace-coverage-area-TX|Austin|')).toBeVisible();
  await page.screenshot({ path: 'test-results/coverage-map-state-drilldown.png', fullPage: true });
  await page.getByTestId('admin-marketplace-coverage-area-TX|Austin|').click();
  await page.getByRole('button', { name: 'Zoom to area' }).click();
  await expect(page.getByTestId('admin-marketplace-coverage-area-TX|Austin|78701')).toBeVisible();
  await page.getByTestId('admin-marketplace-coverage-area-TX|Austin|78701').click();
  await expect(page.getByTestId('admin-marketplace-coverage-detail')).toContainText('Austin, TX, 78701');
  await page.screenshot({ path: 'test-results/coverage-map-selected-zip-details.png', fullPage: true });

  await page.getByLabel('Filter coverage classification').selectOption('limited_supply');
  await page.screenshot({ path: 'test-results/coverage-map-gap-layer.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('admin-marketplace-coverage-fallback')).toBeVisible();
  await page.screenshot({ path: 'test-results/coverage-map-mobile-fallback.png', fullPage: true });

  await navigation.getByRole('button', { name: 'Requests', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/admin\/marketplace\/requests/);
  await expect(page.getByTestId('admin-marketplace-request-queue')).toContainText('Luxury Vinyl Plank Flooring');
  await expect(page.getByLabel('Select request 501')).toBeDisabled();
  const mobileNavigation = page.getByTestId('admin-marketplace-tabs');
  await expect(mobileNavigation).toHaveCount(1);
  expect(await mobileNavigation.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(mobileNavigation.getByRole('button', { name: 'Requests', exact: true })).toHaveAttribute('aria-current', 'page');
  const filtersTop = await page.getByTestId('admin-marketplace-request-filters').evaluate((element) => element.getBoundingClientRect().top);
  expect(filtersTop).toBeLessThan(250);
});

test('coverage map initializes only on Coverage Overview and only once across filter rerenders', async ({ page }) => {
  await installMarketplaceMocks(page);
  await page.goto('/app/admin/marketplace/requests', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('admin-marketplace-request-queue')).toBeVisible();
  expect(await page.evaluate(() => window.__MHB_ADMIN_MAP_METRICS__.initializations)).toBe(0);

  await page.getByRole('button', { name: 'Coverage Overview' }).click();
  await expect(page.getByTestId('admin-marketplace-coverage-workspace')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__MHB_ADMIN_MAP_METRICS__.initializations)).toBe(1);
  await page.getByLabel('Filter demand date range').selectOption('30d');
  await page.getByLabel('Filter map trade').selectOption('roofing');
  await expect.poll(() => page.evaluate(() => window.__MHB_ADMIN_MAP_METRICS__.updates)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__MHB_ADMIN_MAP_METRICS__.initializations)).toBe(1);
});

test('coverage filters restore from URL, cascade, and respond to browser history', async ({ page }) => {
  await installMarketplaceMocks(page);
  await page.goto('/app/admin/marketplace?state=TX&city=Austin&zip=78701&date_range=30d&classification=limited_supply', { waitUntil: 'domcontentloaded' });

  await expect(page.getByLabel('Filter map state')).toHaveValue('TX');
  await expect(page.getByLabel('Filter map city')).toHaveValue('Austin');
  await expect(page.getByLabel('Filter map ZIP')).toHaveValue('78701');
  await expect(page.getByLabel('Filter demand date range')).toHaveValue('30d');
  await expect(page.getByLabel('Filter coverage classification')).toHaveValue('limited_supply');

  await page.getByLabel('Filter map state').selectOption('');
  await expect(page).not.toHaveURL(/city=Austin/);
  await expect(page).not.toHaveURL(/zip=78701/);
  await page.goBack();
  await expect(page.getByLabel('Filter map state')).toHaveValue('TX');
  await expect(page.getByLabel('Filter map city')).toHaveValue('Austin');
  await expect(page.getByLabel('Filter map ZIP')).toHaveValue('78701');
});

test('coverage remains usable when Google configuration is missing or loading fails', async ({ page }) => {
  await installMarketplaceMocks(page, { mapMode: 'missing' });
  await page.goto('/app/admin/marketplace', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Google Maps is not configured for this environment.')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-coverage-fallback')).toContainText('TX');
  expect(await page.evaluate(() => window.__MHB_ADMIN_MAP_METRICS__.initializations)).toBe(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('admin-marketplace-coverage-fallback')).toBeVisible();
});

test('coverage provider failure shows retry and keeps the aggregate fallback', async ({ page }) => {
  await installMarketplaceMocks(page, { mapMode: 'failure' });
  await page.goto('/app/admin/marketplace', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('The map could not be loaded. Coverage data remains available below.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry map' })).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-coverage-fallback')).toContainText('Limited supply');
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
  await expect(page.getByTestId('admin-marketplace-directory-redirect').getByRole('heading', { name: 'Contractor Directory', exact: true })).toBeVisible();
  await expect(page.getByText('Manage contractor records, enrichment, claim links, and profile data.')).toBeVisible();
  await expect(page.getByText('Search and import new businesses')).toHaveCount(0);
});
