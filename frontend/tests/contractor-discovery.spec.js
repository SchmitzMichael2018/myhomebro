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
              label: "MyHomeBro Verified",
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
  await expect(listingCard.getByText("Local Business Listing")).toBeVisible();
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
