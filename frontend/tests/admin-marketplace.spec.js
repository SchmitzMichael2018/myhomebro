import { expect, test } from '@playwright/test';

const ADMIN_BASE = '/api/projects/admin/marketplace';

function buildListing(overrides = {}) {
  return {
    id: 1,
    source: 'google_places',
    google_place_id: 'place-1',
    business_name: 'Claimed Pro LLC',
    normalized_business_name: 'claimed pro llc',
    phone_number: '(555) 123-4567',
    email: 'hello@claimedpro.com',
    website_url: 'https://claimedpro.example',
    google_maps_url: 'https://maps.google.com/?q=claimed',
    formatted_address: '123 Main St, Austin, TX',
    city: 'Austin',
    state: 'TX',
    zip_code: '78701',
    latitude: 30.27,
    longitude: -97.74,
    primary_trade: 'roofing',
    trade_categories: ['roofing'],
    google_rating: 4.8,
    google_review_count: 44,
    business_status: 'OPERATIONAL',
    claimed_profile: true,
    claimed_contractor_id: 11,
    claimed_contractor_name: 'Claimed Pro LLC',
    sms_opt_out: false,
    email_opt_out: false,
    manually_reviewed: true,
    manually_enriched: true,
    admin_notes: 'Trusted local contractor.',
    assisted_diy_friendly: true,
    escrow_friendly: true,
    inspection_capable: true,
    rescue_project_friendly: false,
    collaboration_score: 92,
    compatibility_tags: ['verified', 'collaborative'],
    compatibility_reasons: ['Assisted DIY friendly', 'Escrow friendly', 'MyHomeBro verified'],
    recommendation_tier: 'Strong Match',
    recommended_score: 92,
    supported_project_modes: ['full_service', 'assisted_diy', 'inspection_only'],
    invite_count: 1,
    latest_invite_at: '2026-05-12T15:00:00Z',
    last_synced_at: '2026-05-12T15:00:00Z',
    created_at: '2026-05-11T10:00:00Z',
    updated_at: '2026-05-12T15:00:00Z',
    label: 'MyHomeBro Verified',
    claimed: true,
    invite_available: true,
    phone_available: true,
    email_available: true,
    recent_invites: [
      {
        id: 55,
        status: 'sent',
        channel: 'sms',
        sent_at: '2026-05-12T15:00:00Z',
        clicked_at: null,
        claimed_at: null,
        response_at: null,
        destination_phone: '(555) 123-4567',
        destination_email: '',
        error_message: '',
        claim_url: '/contractors/claim/test-token',
      },
    ],
    compatibility_profile: {
      tier: 'Strong Match',
      summary: 'Admin-managed marketplace listing.',
      badges: ['DIY Assistance Available', 'Escrow Friendly', 'Inspection Services'],
      ways_i_work: [
        {
          key: 'assisted_diy',
          label: 'DIY Assistance Available',
          description: 'Comfortable supporting homeowner participation.',
        },
      ],
      reasons: ['Assisted DIY friendly', 'Escrow friendly', 'MyHomeBro verified'],
    },
  };
}

async function installMarketplaceMocks(page) {
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
    const { pathname } = requestUrl;
    const method = route.request().method();

    if (method === 'GET' && pathname === '/api/projects/admin/marketplace/') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          generated_at: '2026-05-12T12:00:00Z',
          summary: {
            total_listings: 2,
            claimed_listings: 1,
            unclaimed_listings: 1,
            opted_out_listings: 0,
            manual_reviewed_listings: 1,
            manual_enriched_listings: 1,
            total_invites: 2,
            sent_invites: 2,
            claimed_invites: 1,
            claim_rate: 50,
            response_rate: 50,
            agreement_conversion: 25,
            escrow_conversion: 25,
          },
          coverage: {
            trades: [
              { trade: 'roofing', total: 1, claimed: 1, claim_rate: 100, assisted_diy: 1, escrow_friendly: 1, inspection_capable: 1 },
              { trade: 'plumbing', total: 1, claimed: 0, claim_rate: 0, assisted_diy: 0, escrow_friendly: 1, inspection_capable: 0 },
            ],
            cities: [
              { city: 'Austin', total: 1, claimed: 1 },
              { city: 'Dallas', total: 1, claimed: 0 },
            ],
            states: [
              { state: 'TX', total: 2, claimed: 1 },
            ],
            gaps: [
              {
                title: 'plumbing has no claimed contractors',
                detail: '1 directory listing(s) are still unclaimed for this trade.',
                trade: 'plumbing',
                claimed: 0,
                total: 1,
                tone: 'warn',
              },
            ],
          },
          invite_analytics: {
            total: 2,
            sent: 2,
            clicked: 1,
            claimed: 1,
            responded: 1,
            agreements: 1,
            escrow_agreements: 1,
            open_rate: 50,
            claim_rate: 50,
            response_rate: 50,
            agreement_conversion: 50,
            escrow_conversion: 50,
          },
        }),
      });
    }

    if (method === 'GET' && pathname === '/api/projects/admin/marketplace/contractors/') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 2,
          results: [
            buildListing(),
            {
              ...buildListing({
                id: 2,
                business_name: 'Local Plumbing Co',
                normalized_business_name: 'local plumbing co',
                claimed_profile: false,
                claimed_contractor_id: null,
                claimed: false,
                label: 'Local Business Listing',
                primary_trade: 'plumbing',
                trade_categories: ['plumbing'],
                google_rating: 4.2,
                google_review_count: 18,
                assisted_diy_friendly: false,
                inspection_capable: false,
                rescue_project_friendly: true,
                recommendation_tier: 'Good Match',
                compatibility_reasons: ['Rescue-project friendly', 'Escrow friendly'],
                compatibility_profile: {
                  tier: 'Good Match',
                  summary: 'Admin-managed marketplace listing.',
                  badges: ['Rescue Project Assistance'],
                  ways_i_work: [],
                  reasons: ['Rescue-project friendly', 'Escrow friendly'],
                },
              }),
            },
          ],
        }),
      });
    }

    if (method === 'GET' && pathname === '/api/projects/admin/marketplace/import/') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            {
              id: 'listing:77',
              source: 'google_places',
              business_name: 'Seeded Roofing Co',
              claimed: false,
              label: 'Local Business Listing',
              rating: 4.6,
              review_count: 33,
              website_url: '',
              city: 'Austin',
              state: 'TX',
              distance_miles: 2.4,
              phone_available: true,
              email_available: false,
              invite_available: true,
              recommendation_tier: 'Strong Match',
              compatibility_score: 87,
              recommendation_reasons: ['Supports Assisted DIY'],
              supported_project_modes: ['full_service', 'assisted_diy'],
              escrow_friendly: true,
              assisted_diy_friendly: true,
              inspection_capable: true,
              rescue_project_friendly: false,
            },
          ],
        }),
      });
    }

    if (method === 'POST' && pathname === '/api/projects/admin/marketplace/import/') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: 'Listings imported.',
          updated_count: 1,
          results: [
            {
              ...buildListing({ id: 3, business_name: 'Imported Listing', claimed_profile: false, claimed_contractor_id: null }),
              label: 'Local Business Listing',
            },
          ],
        }),
      });
    }

    if (method === 'GET' && pathname === '/api/projects/admin/marketplace/listings/1/') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildListing()),
      });
    }

    if (method === 'PATCH' && pathname === '/api/projects/admin/marketplace/listings/1/') {
      const payload = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...buildListing(),
          ...payload,
          compatibility_tags: ['local', 'responsive'],
        }),
      });
    }

    if (method === 'POST' && pathname === '/api/projects/admin/marketplace/listings/1/invite/') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: 'Invite created.',
          claim_link: '/contractors/claim/test-token',
          invite: {
            id: 99,
            invite_token: 'test-token',
            status: 'sent',
            channel: 'sms',
            destination_phone: '(555) 123-4567',
            destination_email: '',
            sent_at: '2026-05-12T16:00:00Z',
            clicked_at: null,
            claimed_at: null,
            response_at: null,
            error_message: '',
            claim_url: '/contractors/claim/test-token',
          },
          message: 'MyHomeBro: Your business was selected for local contractor discovery on MyHomeBro. Claim your profile to review project opportunities in your area: https://myhomebro.local/contractors/claim/test-token Reply STOP to opt out.',
          email_subject: 'Claim your contractor profile on MyHomeBro',
          email_body: 'Your business has been added as a local contractor listing on MyHomeBro using publicly available business information.',
        }),
      });
    }

    return route.fallback();
  });
}

test('admin marketplace surfaces listings, import, and invite workflows', async ({ page }) => {
  await installMarketplaceMocks(page);

  await page.goto('/app/admin/marketplace', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Admin Marketplace')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-page')).toBeVisible();
  await expect(page.getByText('plumbing has no claimed contractors')).toBeVisible();

  await expect(page.getByRole('link', { name: 'Marketplace' })).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-summary')).toBeVisible();

  await page.getByTestId('admin-marketplace-tabs').getByRole('button', { name: 'Contractors' }).click();
  await expect(page.getByTestId('admin-marketplace-contractors-view')).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-open-listing-1').first()).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-contractors-view').getByText('Assisted DIY').first()).toBeVisible();
  await expect(page.getByTestId('admin-marketplace-contractors-view').getByText('MyHomeBro Verified').first()).toBeVisible();

  await page.getByTestId('admin-marketplace-tabs').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByTestId('admin-marketplace-import-view')).toBeVisible();
  await page.getByTestId('admin-marketplace-import-search').click();
  await expect(page.getByTestId('admin-marketplace-import-result-listing:77')).toBeVisible();
  await page.getByTestId('admin-marketplace-import-result-listing:77').click();
  await page.getByTestId('admin-marketplace-import-selected').click();
  await expect(page.getByTestId('admin-marketplace-status')).toContainText('Listings imported.');

  await page.goto('/app/admin/marketplace/listings/1', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('admin-marketplace-listing-detail')).toBeVisible();
  await expect(page.getByText('Rescue Project Assistance')).toBeVisible();
  await page.getByTestId('admin-marketplace-send-invite').click();
  await expect(page.getByTestId('admin-marketplace-status')).toContainText('Invite created.');
});
