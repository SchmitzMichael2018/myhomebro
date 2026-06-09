import { expect, test } from "@playwright/test";

test("public intake surfaces contractor discovery and creates pending review opportunities", async ({ page }) => {
  const selectedOpportunities = [];

  await page.route("**/api/projects/public-intake/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes("/contractor-search/") && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: {
            search_query: "bathroom remodel",
            radius_miles: 25,
            project_mode: "assisted_diy",
            payment_preference: "escrow",
            results_count: 2,
          },
          results: [
            {
              id: "contractor:12",
              source: "myhomebro_verified",
              business_name: "Bright Build Co",
              claimed: true,
              label: "Profile Reviewed",
              rating: 4.9,
              review_count: 45,
              website_url: "https://bright.example.com",
              city: "Austin",
              state: "TX",
              distance_miles: 1.4,
              phone_available: true,
              email_available: true,
              invite_available: true,
              recommendation_tier: "Strong Match",
              compatibility_score: 94,
              recommendation_reasons: [
                "Offers Assisted DIY support",
                "Escrow-friendly",
                "Inspection checkpoints supported",
              ],
              supported_project_modes: ["full_service", "assisted_diy"],
              escrow_friendly: true,
              assisted_diy_friendly: true,
              inspection_capable: true,
              rescue_project_friendly: true,
            },
            {
              id: "listing:33",
              source: "cached_directory",
              business_name: "Local Handy Team",
              claimed: false,
              label: "Local Business Listing",
              rating: 4.6,
              review_count: 18,
              website_url: "https://local.example.com",
              city: "Austin",
              state: "TX",
              distance_miles: 3.2,
              phone_available: true,
              email_available: false,
              invite_available: true,
              recommendation_tier: "Good Match",
              compatibility_score: 72,
              recommendation_reasons: ["Good fit for collaborative projects", "Supports homeowner participation"],
              supported_project_modes: ["full_service", "assisted_diy"],
              escrow_friendly: true,
              assisted_diy_friendly: true,
              inspection_capable: false,
              rescue_project_friendly: false,
            },
          ],
        }),
      });
      return;
    }

    if (url.includes("/select-contractor/") && method === "POST") {
      const body = route.request().postDataJSON();
      selectedOpportunities.push(body);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          status: "pending",
          opportunity_count: body.selected_contractors?.length || 0,
          created: (body.selected_contractors || []).map((item, index) => ({
            id: index + 1,
            opportunity_id: index + 1,
            directory_entry_id: 100 + index,
            status: "pending",
            contractor_business_name: item.business_name,
          })),
        }),
      });
      return;
    }

    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 701,
          token: "discovery-token",
          status: "draft",
          contractor_name: "Your contractor",
          customer_name: "",
          customer_email: "",
          customer_phone: "",
          project_class: "residential",
          project_mode: "assisted_diy",
          payment_preference: "escrow",
          homeowner_participation_notes: "",
          homeowner_started_work: false,
          homeowner_task_summary: "",
          homeowner_assistance_summary: "",
          customer_address_line1: "",
          customer_address_line2: "",
          customer_city: "Austin",
          customer_state: "TX",
          customer_postal_code: "78701",
          same_as_customer_address: true,
          project_address_line1: "",
          project_address_line2: "",
          project_city: "Austin",
          project_state: "TX",
          project_postal_code: "78701",
          accomplishment_text: "Need help with a bathroom remodel and inspection.",
          ai_project_title: "",
          ai_project_type: "",
          ai_project_subtype: "",
          ai_description: "",
          ai_project_timeline_days: null,
          ai_project_budget: null,
          ai_milestones: [],
          ai_clarification_questions: [],
          ai_clarification_answers: {},
          ai_analysis_payload: {},
          clarification_photos: [],
          post_submit_flow: "",
          post_submit_flow_selected_at: null,
          submitted_at: null,
          sent_at: null,
          completed_at: null,
        }),
      });
    }
  });

  await page.goto("/start-project/discovery-token", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Project Intake", { exact: true })).toBeVisible();

  await page.getByTestId("public-intake-accomplishment-text").fill("Need help with a bathroom remodel and inspection.");
  await page.locator('button:has-text("Choose Local Contractors")').first().click();
  await expect(page.getByTestId("public-intake-contractor-discovery-step")).toBeVisible({ timeout: 15000 });
  const verifiedCard = page.getByTestId("public-intake-contractor-card-contractor:12");
  const listingCard = page.getByTestId("public-intake-contractor-card-listing:33");
  await expect(verifiedCard.getByText("Verified on MyHomeBro")).toBeVisible();
  await expect(listingCard.getByText("Local supply lead")).toBeVisible();
  await expect(listingCard.getByText("must claim and be approved")).toBeVisible();
  await expect(verifiedCard.getByTitle("Homeowner participates with contractor guidance and support.")).toBeVisible();
  await expect(verifiedCard.getByText("Inspection Capable")).toBeVisible();

  await page.getByTestId("public-intake-contractor-select-listing:33").click();
  await expect(page.getByTestId("public-intake-contractor-select-listing:33")).toContainText("Selected");
  await page.getByTestId("public-intake-send-contractor-invites").click();

  await expect(page.getByTestId("public-intake-branching-section")).toBeVisible();
  await expect(page.getByTestId("public-intake-branch-single")).toBeVisible();
  expect(selectedOpportunities).toHaveLength(1);
  expect(selectedOpportunities[0].selected_contractors[0].id).toBe("listing:33");
  expect(selectedOpportunities[0].selected_contractors[0].business_name).toBe("Local Handy Team");
});

test("public intake contractor search does not blame complete saved address when geocoding is unavailable", async ({ page }) => {
  await page.route("**/api/projects/public-intake/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes("/contractor-search/") && method === "GET") {
      const requestUrl = new URL(url);
      expect(requestUrl.searchParams.get("project_address_line1")).toBe("1515 South Ellison Drive");
      expect(requestUrl.searchParams.get("project_city")).toBe("San Antonio");
      expect(requestUrl.searchParams.get("project_state")).toBe("TX");
      expect(requestUrl.searchParams.get("project_postal_code")).toBe("78245-1519");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: {
            search_query: "flooring contractor",
            radius_miles: 25,
            location_resolution_status: "geocode_failed",
            location_source: "zip_only",
            search_center_city: "San Antonio",
            search_center_state: "TX",
            search_center_zip: "78245",
            search_center_zip_original: "78245-1519",
            reason: "google_geocode_api_key_missing",
            external_search: {
              source: "google_places",
              configured: false,
              requested: false,
              results_count: 0,
              error: "google_geocode_api_key_missing",
            },
            results_count: 0,
          },
          results: [],
        }),
      });
      return;
    }

    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 702,
          token: "location-token",
          status: "draft",
          contractor_name: "Your contractor",
          customer_name: "San Antonio Customer",
          customer_email: "customer@example.com",
          customer_phone: "555-555-0101",
          project_class: "residential",
          project_mode: "full_service",
          payment_preference: "escrow",
          customer_address_line1: "1515 South Ellison Drive",
          customer_address_line2: "",
          customer_city: "San Antonio",
          customer_state: "TX",
          customer_postal_code: "78245-1519",
          same_as_customer_address: true,
          project_address_line1: "1515 South Ellison Drive",
          project_address_line2: "",
          project_city: "San Antonio",
          project_state: "TX",
          project_postal_code: "78245-1519",
          accomplishment_text: "Install new flooring in the kitchen.",
          ai_project_title: "Flooring Installation",
          ai_project_type: "Flooring",
          ai_project_subtype: "Flooring Installation",
          ai_description: "",
          ai_project_timeline_days: null,
          ai_project_budget: null,
          ai_milestones: [],
          ai_clarification_questions: [],
          ai_clarification_answers: {},
          ai_analysis_payload: {},
          clarification_photos: [],
          post_submit_flow: "",
          post_submit_flow_selected_at: null,
          submitted_at: null,
          sent_at: null,
          completed_at: null,
        }),
      });
    }
  });

  await page.goto("/start-project/location-token", { waitUntil: "domcontentloaded" });
  await page.locator('button:has-text("Choose Local Contractors")').first().click();

  const discoveryStep = page.getByTestId("public-intake-contractor-discovery-step");
  await expect(discoveryStep).toBeVisible({ timeout: 15000 });
  await expect(discoveryStep).toContainText(
    "We have the project address, but location services could not map it right now. Please try again shortly."
  );
  await expect(discoveryStep).not.toContainText("Please check the address or ZIP code");
});

test("public intake AI patio details search concrete and patio contractors instead of roofing", async ({ page }) => {
  await page.route("**/api/projects/public-intake/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes("/contractor-search/") && method === "GET") {
      const requestUrl = new URL(url);
      const query = requestUrl.searchParams.get("query") || "";
      expect(query).toContain("concrete contractor");
      expect(query).toContain("patio contractor");
      expect(query).toContain("hardscape contractor");
      expect(query).not.toContain("roofing contractor");
      expect(["Outdoor Living", "Concrete"]).toContain(requestUrl.searchParams.get("project_type"));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: {
            search_query: query,
            radius_miles: 25,
            location_resolution_status: "resolved",
            location_source: "city_state_zip",
            project_mode: "full_service",
            payment_preference: "escrow",
            results_count: 2,
          },
          results: [
            {
              id: "listing:501",
              source: "cached_directory",
              business_name: "Alamo Concrete Patio Pros",
              claimed: false,
              label: "Local Business Listing",
              rating: 4.8,
              review_count: 27,
              website_url: "https://concrete.example.com",
              city: "San Antonio",
              state: "TX",
              distance_miles: 4.1,
              phone_available: true,
              email_available: false,
              invite_available: true,
              recommendation_tier: "Strong Match",
              compatibility_score: 91,
              recommendation_reasons: ["Patio, concrete, hardscape, or outdoor-living trade aligns with the request."],
              supported_project_modes: ["full_service"],
              escrow_friendly: true,
              assisted_diy_friendly: false,
              inspection_capable: false,
              rescue_project_friendly: false,
            },
            {
              id: "listing:502",
              source: "cached_directory",
              business_name: "Mission Hardscape Builders",
              claimed: false,
              label: "Local Business Listing",
              rating: 4.6,
              review_count: 12,
              website_url: "https://hardscape.example.com",
              city: "San Antonio",
              state: "TX",
              distance_miles: 7.2,
              phone_available: true,
              email_available: true,
              invite_available: true,
              recommendation_tier: "Good Match",
              compatibility_score: 78,
              recommendation_reasons: ["Patio, concrete, hardscape, or outdoor-living trade aligns with the request."],
              supported_project_modes: ["full_service"],
              escrow_friendly: true,
              assisted_diy_friendly: false,
              inspection_capable: false,
              rescue_project_friendly: false,
            },
          ],
        }),
      });
      return;
    }

    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 703,
          token: "patio-discovery-token",
          status: "draft",
          contractor_name: "Your contractor",
          customer_name: "Patio Customer",
          customer_email: "patio@example.com",
          customer_phone: "555-555-0102",
          project_class: "residential",
          project_mode: "full_service",
          payment_preference: "escrow",
          customer_address_line1: "1515 South Ellison Drive",
          customer_address_line2: "",
          customer_city: "San Antonio",
          customer_state: "TX",
          customer_postal_code: "78245-1519",
          same_as_customer_address: true,
          project_address_line1: "1515 South Ellison Drive",
          project_address_line2: "",
          project_city: "San Antonio",
          project_state: "TX",
          project_postal_code: "78245-1519",
          accomplishment_text: "Extend the existing patio by constructing a 10-foot by 12-foot concrete slab.",
          ai_project_title: "Patio Extension",
          ai_project_type: "Outdoor Living",
          ai_project_subtype: "Patio Extension",
          ai_description: "Extend the existing patio by constructing a 10-foot by 12-foot concrete slab.",
          ai_project_timeline_days: null,
          ai_project_budget: null,
          ai_milestones: [],
          ai_clarification_questions: [],
          ai_clarification_answers: {},
          ai_analysis_payload: {},
          clarification_photos: [],
          post_submit_flow: "",
          post_submit_flow_selected_at: null,
          submitted_at: null,
          sent_at: null,
          completed_at: null,
        }),
      });
    }
  });

  await page.goto("/start-project/patio-discovery-token", { waitUntil: "domcontentloaded" });
  await page.locator('button:has-text("Choose Local Contractors")').first().click();

  const discoveryStep = page.getByTestId("public-intake-contractor-discovery-step");
  await expect(discoveryStep).toBeVisible({ timeout: 15000 });
  await expect(discoveryStep).toContainText("Alamo Concrete Patio Pros");
  await expect(discoveryStep).toContainText("Mission Hardscape Builders");
  await expect(discoveryStep).not.toContainText("Roofing");
});

test("contractor claim page lets a contractor claim a listing", async ({ page }) => {
  await page.route("**/api/projects/contractors/claim/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    const token = url.split("/").filter(Boolean).pop();

    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 44,
          invite_token: token,
          status: "sent",
          claimed: false,
          contractor_name: "Claimable Plumbing LLC",
          business_name: "Claimable Plumbing LLC",
          city: "Austin",
          state: "TX",
          project_summary: "Need an inspection for a plumbing repair.",
          project_mode: "inspection_only",
          payment_preference: "escrow",
          public_intake_id: 701,
          directory_listing_id: 33,
          claim_url: `/contractors/claim/${token}`,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "Listing claimed successfully.",
        claimed: true,
        contractor_id: 77,
        listing_id: 33,
        lead_id: 9,
        onboarding_url: "/app/onboarding",
        public_profile_url: "/contractors/claimable-plumbing",
      }),
    });
  });

  await page.goto("/contractors/claim/invite-claim-token", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("contractor-claim-page")).toBeVisible();
  await expect(page.getByText("Claimable Plumbing LLC")).toBeVisible();
  await page.getByTestId("contractor-claim-listing").click();
  await expect(page.getByTestId("contractor-claim-listing")).toContainText("Listing Claimed");
});
