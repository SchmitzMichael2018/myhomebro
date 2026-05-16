import { expect, test } from "@playwright/test";

test("start-project page redirects when the API returns a legacy share_token response", async ({
  page,
}) => {
  await page.route("**/api/projects/public-intake/start/", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        intake_id: 601,
        share_token: "legacy-share-token",
        status: "draft",
        public_url: "http://localhost:5173/start-project/legacy-share-token",
      }),
    });
  });

  await page.goto("/start-project", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/start-project\/legacy-share-token$/);
});

test("start-project page logs backend failures and shows a helpful error", async ({ page }) => {
  const consoleErrors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.route("**/api/projects/public-intake/start/", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "Failed to create intake draft.",
      }),
    });
  });

  await page.goto("/start-project", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Starting your project request" })).toBeVisible();
  await expect(page.getByText("Failed to create intake draft.").first()).toBeVisible({
    timeout: 15000,
  });
  expect(consoleErrors.join(" ")).toContain("Public intake start");
  expect(consoleErrors.join(" ")).toContain("Failed to create intake draft.");
});

test("landing page drives into intake and public intake shows branching choices after submit", async ({
  page,
}) => {
  const branchRequests = [];

  await page.addInitScript(() => {
    function MockPlaceAutocompleteElement() {
      const element = document.createElement("div");
      element.appendChild(document.createElement("input"));
      const nativeAddEventListener = element.addEventListener.bind(element);
      element.addEventListener = (type, callback, options) => {
        if (type === "gmp-select") {
          window.__mhbTriggerPlaceSelect = (place) =>
            callback({
              placePrediction: {
                toPlace: () => place,
              },
            });
        }
        return nativeAddEventListener(type, callback, options);
      };
      return element;
    }

    window.google = {
      maps: {
        importLibrary: async () => ({
          PlaceAutocompleteElement: MockPlaceAutocompleteElement,
        }),
        places: {
          PlaceAutocompleteElement: MockPlaceAutocompleteElement,
        },
      },
    };
  });

  await page.route("**/api/projects/public-intake/**", async (route) => {
    const requestUrl = route.request().url();
    const method = route.request().method();

  if (requestUrl.endsWith("/start/") && method === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          intake_id: 501,
          token: "landing-token",
          status: "draft",
          public_url: "http://localhost:5173/start-project/landing-token",
        }),
      });
    return;
  }

  if (requestUrl.includes("/improve-description/") && method === "POST") {
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "Description improved.",
        description: "We will replace the kitchen cabinets, confirm the layout, and review finish choices before starting.",
        source: "ai",
        current_description: body.current_description || "",
      }),
    });
    return;
  }

  if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 501,
          token: "landing-token",
          status: "draft",
          contractor_name: "Your contractor",
          customer_name: "Branch Prospect",
          customer_email: "branch@example.com",
          customer_phone: "555-444-2222",
          customer_address_line1: "500 Bid Lane",
          customer_address_line2: "",
          customer_city: "Austin",
          customer_state: "TX",
          customer_postal_code: "78701",
          same_as_customer_address: true,
          project_class: "residential",
          project_address_line1: "500 Bid Lane",
          project_address_line2: "",
          project_city: "Austin",
          project_state: "TX",
          project_postal_code: "78701",
          accomplishment_text: "",
          refined_description: "",
          ai_project_title: "",
          ai_project_type: "",
          ai_project_subtype: "",
          ai_description: "",
          ai_project_timeline_days: null,
          ai_project_budget: null,
          budget_range_text: "",
          desired_timing_text: "",
          tentative_start_date: "",
          ai_milestones: [],
          measurement_handling: "",
          ai_clarification_questions: [],
          ai_clarification_answers: {},
          clarification_photos: [],
          ai_analysis_payload: {},
          post_submit_flow: "",
          post_submit_flow_selected_at: null,
          submitted_at: null,
          sent_at: null,
          completed_at: null,
        }),
      });
      return;
    }

    const body = route.request().postDataJSON();
    branchRequests.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "Intake updated successfully.",
        id: 501,
        status: "submitted",
        lead_id: 88,
        ai_project_title: "Commercial Scope Request",
        ai_project_type: body.ai_project_type || "General Contracting",
        ai_project_subtype: body.ai_project_subtype || "Commercial Scope",
        ai_description: "Structured commercial scope summary.",
        refined_description: body.refined_description || body.ai_description || "Structured commercial scope summary.",
        ai_project_timeline_days: 10,
        ai_project_budget: "5000.00",
        budget_range_text: body.budget_range_text || "",
        desired_timing_text: body.desired_timing_text || "",
        tentative_start_date: body.tentative_start_date || "",
        measurement_handling: body.measurement_handling || "site_visit_required",
        ai_milestones: [
          { title: "Preparation", description: "Prepare site and confirm scope." },
          { title: "Core Work", description: "Complete the requested work." },
        ],
        ai_clarification_questions: [],
        ai_clarification_answers: { measurement_handling: "site_visit_required" },
        clarification_photos: [],
        ai_analysis_payload: {},
        post_submit_flow: body.branch_flow || "",
        branch_invites:
          body.branch_flow === "multi_contractor"
            ? [
                { token: "invite-1", invite_url: "/login?invite=invite-1" },
                { token: "invite-2", invite_url: "/login?invite=invite-2" },
              ]
            : [{ token: "invite-1", invite_url: "/login?invite=invite-1" }],
        completed_at: "2026-04-15T16:00:00Z",
      }),
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("landing-hero-heading")).toContainText("Start your project with MyHomeBro");
  await expect(page.getByTestId("landing-start-project-intake-button")).toHaveText("Start Your Project");
  await expect(page.getByTestId("landing-customer-portal-button")).toHaveText("View Your Project");
  await expect(page.getByText("For Contractors")).toBeVisible();
  await expect(page.getByRole("button", { name: "Join MyHomeBro" })).toBeVisible();
  await expect(page.getByTestId("landing-sign-in-button")).toHaveText("Contractor Sign In");
  await expect(page.getByText("After you submit your request, you can either invite one contractor or request multiple bids.")).toBeVisible();

  await page.getByTestId("landing-start-project-intake-button").click();
  await expect(page).toHaveURL(/\/start-project\/landing-token$/);
  await expect(page.getByText("Project Intake", { exact: true })).toBeVisible();
  await expect(page.getByText("Status: draft")).toBeVisible();

  await page.getByTestId("public-intake-accomplishment-text").fill("Need a bid-ready commercial scope.");
  await expect(page.getByTestId("public-intake-accomplishment-text")).toHaveValue("Need a bid-ready commercial scope.");
  await expect(page.getByTestId("public-intake-generate-structure")).toBeEnabled({ timeout: 15000 });
  await page.getByTestId("public-intake-generate-structure").click();
  await expect(page.getByTestId("public-intake-project-summary")).toBeVisible();
  await expect(page.getByTestId("public-intake-project-summary-title")).toContainText("Your Project So Far");
  await expect(page.getByText("Refine Your Project", { exact: true })).toBeVisible();
  await expect(page.getByTestId("public-intake-clarification-photo-section")).toBeVisible();
  await expect(page.getByTestId("public-intake-measurement-provided")).toHaveCount(0);
  await expect(page.getByText("No clarification questions are needed for this project.")).toHaveCount(0);
  await page.getByTestId("public-intake-clarification-next").click();
  await expect(page.getByTestId("public-intake-project-details-step")).toBeVisible();
  await expect(page.getByRole("button", { name: "Project Details" })).toBeVisible();
  await expect(page.getByTestId("public-intake-project-type")).not.toHaveValue("");
  await page.getByTestId("public-intake-budget-range").selectOption("$2,500-$5,000");
  await page.getByTestId("public-intake-timeline").selectOption("Specific date");
  await page.getByTestId("public-intake-tentative-start-date").fill("2026-06-15");
  await page.getByTestId("public-intake-measurements-input").fill("Approx. 20 ft x 12 ft work area");
  await expect(page.getByTestId("public-intake-customer-address-autocomplete")).toBeVisible();
  await page.getByTestId("public-intake-customer-address-line1").fill("501 Manual Bid Lane");
  await page.getByTestId("public-intake-customer-city").fill("Austin");
  await page.getByTestId("public-intake-customer-state").fill("TX");
  await page.getByTestId("public-intake-customer-postal-code").fill("78702");
  await expect(page.getByTestId("public-intake-customer-address-line1")).toHaveValue("501 Manual Bid Lane");
  await page.getByLabel("Project address is the same as my customer/home address").uncheck();
  await expect(page.getByTestId("public-intake-project-address-autocomplete")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => typeof window.__mhbTriggerPlaceSelect === "function"))
    .toBe(true);
  await page.evaluate(() => {
    window.__mhbTriggerPlaceSelect({
      formattedAddress: "123 Main St, Austin, TX 78704",
      id: "place-123-main",
      addressComponents: [
        { type: "street_number", longText: "123", shortText: "123" },
        { type: "route", longText: "Main St", shortText: "Main St" },
        { type: "locality", longText: "Austin", shortText: "Austin" },
        { type: "administrative_area_level_1", longText: "Texas", shortText: "TX" },
        { type: "postal_code", longText: "78704", shortText: "78704" },
        { type: "country", longText: "United States", shortText: "US" },
      ],
      fetchFields: async () => {},
    });
  });
  await expect(page.getByTestId("public-intake-project-address-line1")).toHaveValue("123 Main St");
  await expect(page.getByTestId("public-intake-project-city")).toHaveValue("Austin");
  await expect(page.getByTestId("public-intake-project-state")).toHaveValue("TX");
  await expect(page.getByTestId("public-intake-project-postal-code")).toHaveValue("78704");
  await page.getByTestId("public-intake-project-address-line1").fill("777 Job Site Rd");
  await page.getByTestId("public-intake-project-city").fill("Austin");
  await page.getByTestId("public-intake-project-state").fill("TX");
  await page.getByTestId("public-intake-project-postal-code").fill("78703");
  await expect(page.getByTestId("public-intake-project-address-line1")).toHaveValue("777 Job Site Rd");
  await page.getByTestId("public-intake-project-details-continue").click();
  await expect(page.getByTestId("public-intake-structured-output-step")).toBeVisible();
  await expect(page.getByTestId("public-intake-structured-output-title")).toContainText("Project Summary");
  await expect(page.getByText("Your contractor will create the final agreement and milestones later.")).toBeVisible();
  await expect(page.getByText("Original Description")).toBeVisible();
  await expect(page.getByText("Need a bid-ready commercial scope.")).toBeVisible();
  await expect(page.getByText("$2,500-$5,000")).toBeVisible();
  await expect(page.getByText("Specific date: 2026-06-15")).toBeVisible();
  await expect(page.getByText("Approx. 20 ft x 12 ft work area")).toBeVisible();
  await expect(page.getByText("777 Job Site Rd")).toBeVisible();
  await expect(page.getByText("Milestones / Project Phases")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add milestone" })).toHaveCount(0);
  await page.getByRole("button", { name: "Choose Path" }).click();
  await expect(page.getByTestId("public-intake-branching-section")).toBeVisible();
  await expect(page.getByTestId("public-intake-branching-section")).toContainText("How would you like to proceed?");
  await expect(page.getByTestId("public-intake-branch-single")).toContainText("Work with one contractor");
  await expect(page.getByTestId("public-intake-branch-multi")).toContainText("Get multiple quotes");

  await page.getByTestId("public-intake-branch-single").click();
  await page.getByTestId("public-intake-branch-skip").click();
  await expect(page.getByRole("heading", { name: "Review + Confirm" })).toBeVisible();
  await expect(page.getByText("No contractor invites saved yet")).toBeVisible();
  await expect(page.getByText("Need a bid-ready commercial scope.")).toBeVisible();

  await page.getByRole("button", { name: "Choose Path" }).click();
  await expect(page.getByTestId("public-intake-branching-section")).toBeVisible();
  await page.getByTestId("public-intake-branch-multi").click();
  const multiBranch = page.getByTestId("public-intake-branching-section");
  await multiBranch.getByPlaceholder("Name").first().fill("Alpha Build");
  await multiBranch.getByPlaceholder("Email").first().fill("alpha@example.com");
  await multiBranch.getByPlaceholder("Phone").first().fill("555-101-0001");
  await multiBranch.getByPlaceholder("Name").nth(1).fill("Beta Contracting");
  await multiBranch.getByPlaceholder("Email").nth(1).fill("beta@example.com");
  await multiBranch.getByPlaceholder("Phone").nth(1).fill("555-202-0002");
  await page.getByTestId("public-intake-branch-submit").click();

  await expect(page.getByRole("heading", { name: "Review + Confirm" })).toBeVisible();
  await expect(page.getByText("2 invites prepared")).toBeVisible();
  await expect(page.getByText("Get Multiple Quotes").first()).toBeVisible();
  expect(branchRequests.some((body) => body.branch_flow === "multi_contractor")).toBeTruthy();

  await page.getByRole("button", { name: "Choose Path" }).click();
  await expect(page.getByTestId("public-intake-branching-section")).toBeVisible();
  await page.getByTestId("public-intake-branch-single").click();
  const singleBranch = page.getByTestId("public-intake-branching-section");
  await singleBranch.getByPlaceholder("Contractor name").fill("Prime Builder");
  await singleBranch.getByPlaceholder("contractor@example.com").fill("prime@example.com");
  await singleBranch.getByPlaceholder("(555) 555-5555").fill("555-303-0003");
  await page.getByTestId("public-intake-branch-submit").click();

  await expect(page.getByRole("heading", { name: "Review + Confirm" })).toBeVisible();
  await expect(page.getByText("1 invite prepared")).toBeVisible();
  expect(branchRequests.some((body) => body.branch_flow === "single_contractor")).toBeTruthy();
});

test("public intake contractor search auto-infers a specialty from the project description", async ({
  page,
}) => {
  const requestedQueries = [];

  await page.route("**/api/projects/public-intake/**", async (route) => {
    const requestUrl = route.request().url();
    const method = route.request().method();

    if (requestUrl.endsWith("/start/") && method === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          intake_id: 503,
          token: "landing-token-search",
          status: "draft",
          public_url: "http://localhost:5173/start-project/landing-token-search",
        }),
      });
      return;
    }

    if (requestUrl.includes("/contractor-search/") && method === "GET") {
      const url = new URL(requestUrl);
      requestedQueries.push(url.searchParams.get("query") || "");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: {
            search_query: url.searchParams.get("query") || "",
            radius_miles: 25,
            project_mode: "full_service",
            payment_preference: "escrow",
            results_count: 12,
            external_results_count: 11,
          },
          results: [
            {
              id: "listing:100",
              source: "myhomebro",
              business_name: "Verified Kitchen Pros",
              claimed: true,
              label: "MyHomeBro Verified",
              source_label: "MyHomeBro Verified",
              rating: 4.9,
              review_count: 19,
              website_url: "https://example.com",
              city: "Austin",
              state: "TX",
              distance_miles: 3.2,
              phone_available: true,
              email_available: true,
              invite_available: true,
              recommendation_tier: "Strong Match",
              compatibility_score: 95,
              recommendation_reasons: ["Offers Assisted DIY support."],
              supported_project_modes: ["full_service"],
              escrow_friendly: true,
              assisted_diy_friendly: true,
              inspection_capable: true,
              rescue_project_friendly: false,
            },
            {
              id: "listing:101",
              source: "google_places",
              business_name: "Local Countertop Listing",
              claimed: false,
              label: "Local Business Listing",
              source_label: "Local Business Listing",
              rating: 4.7,
              review_count: 8,
              website_url: "https://example.org",
              city: "Austin",
              state: "TX",
              distance_miles: 4.1,
              phone_available: true,
              email_available: false,
              invite_available: true,
              recommendation_tier: "Good Match",
              compatibility_score: 78,
              recommendation_reasons: ["Supports escrow milestone payments."],
              supported_project_modes: ["assisted_diy"],
              escrow_friendly: true,
              assisted_diy_friendly: true,
              inspection_capable: false,
              rescue_project_friendly: false,
            },
            ...Array.from({ length: 10 }, (_, index) => ({
              id: `listing:${102 + index}`,
              source: "google_places",
              business_name: `Local Listing ${index + 2}`,
              claimed: false,
              label: "Local Business Listing",
              source_label: "Local Business Listing",
              rating: 4.5,
              review_count: 5 + index,
              website_url: "https://example.org",
              city: "Austin",
              state: "TX",
              distance_miles: 5 + index,
              phone_available: true,
              email_available: false,
              invite_available: true,
              recommendation_tier: "Good Match",
              compatibility_score: 70 - index,
              recommendation_reasons: ["Nearby local business listing."],
              supported_project_modes: ["full_service"],
              escrow_friendly: true,
              assisted_diy_friendly: false,
              inspection_capable: false,
              rescue_project_friendly: false,
            })),
          ],
        }),
      });
      return;
    }

    if (requestUrl.includes("/improve-description/") && method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Description improved.",
          description: "Remove kitchen cabinets and install quartz countertops with contractor review.",
          source: "ai",
          current_description: route.request().postDataJSON()?.current_description || "",
        }),
      });
      return;
    }

    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 503,
          token: "landing-token-search",
          status: "draft",
          contractor_name: "Your contractor",
          customer_name: "Search Prospect",
          customer_email: "search@example.com",
          customer_phone: "555-555-5555",
          customer_address_line1: "100 Search St",
          customer_address_line2: "",
          customer_city: "Austin",
          customer_state: "TX",
          customer_postal_code: "78701",
          same_as_customer_address: true,
          project_class: "residential",
          project_address_line1: "100 Search St",
          project_address_line2: "",
          project_city: "Austin",
          project_state: "TX",
          project_postal_code: "78701",
          accomplishment_text: "",
          ai_project_title: "",
          ai_project_type: "",
          ai_project_subtype: "",
          ai_description: "",
          ai_project_timeline_days: null,
          ai_project_budget: null,
          ai_milestones: [],
          measurement_handling: "",
          ai_clarification_questions: [],
          ai_clarification_answers: {},
          clarification_photos: [],
          ai_analysis_payload: {},
          post_submit_flow: "",
          post_submit_flow_selected_at: null,
          submitted_at: null,
          sent_at: null,
          completed_at: null,
        }),
      });
    }
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("landing-start-project-intake-button").click();
  await expect(page).toHaveURL(/\/start-project\/landing-token-search$/);
  await page.getByTestId("public-intake-accomplishment-text").fill("Remove kitchen cabinets and install quartz countertops.");
  await page.getByRole("button", { name: "Choose Local Contractors" }).click();

  await expect(page.getByTestId("public-intake-contractor-discovery-step")).toBeVisible();
  await expect(page.getByTestId("public-intake-contractor-search-input")).toHaveValue(
    /kitchen remodeling contractor|cabinet installer|countertop installer/,
    { timeout: 15000 }
  );
  await expect(page.getByText("Verified contractors are active MyHomeBro members.")).toBeVisible();
  await expect(page.getByTestId("public-intake-contractor-result-count")).toHaveText("Showing 1-10 of 12 contractors");
  await expect(page.locator('[data-testid^="public-intake-contractor-card-"]').first()).toContainText("Verified Kitchen Pros");
  await expect(page.getByTestId("public-intake-contractor-card-listing:100")).toContainText("Verified on MyHomeBro");
  await expect(page.getByTestId("public-intake-contractor-card-listing:101")).toContainText("Local Business Listing");
  await expect(page.getByTestId("public-intake-contractor-card-listing:101")).toContainText("Not yet verified on MyHomeBro");
  await expect(page.getByTestId("public-intake-contractor-distance-listing:100")).toContainText("3.2 miles away");
  await expect(page.getByTestId("public-intake-contractor-source-badge-listing:100")).toHaveClass(/bg-emerald-600/);
  await expect(page.getByTestId("public-intake-contractor-source-badge-listing:101")).toHaveClass(/bg-slate-100/);
  await expect(page.getByTestId("public-intake-contractor-card-listing:111")).toHaveCount(0);
  await page.getByTestId("public-intake-contractor-load-more").click();
  await expect(page.getByTestId("public-intake-contractor-card-listing:111")).toBeVisible();
  await expect(page.getByTestId("public-intake-contractor-result-count")).toHaveText("Showing 1-12 of 12 contractors");
  expect(requestedQueries[0]).toMatch(/kitchen remodeling contractor|cabinet installer|countertop installer/);

  const searchInput = page.getByTestId("public-intake-contractor-search-input");
  await searchInput.fill("");
  await expect(searchInput).toHaveValue("");
  await page.waitForTimeout(250);
  await expect(searchInput).toHaveValue("");
  await searchInput.fill("concrete contractor");
  await page.getByTestId("public-intake-contractor-search-submit").click();
  await expect(searchInput).toHaveValue("concrete contractor");
  await expect.poll(() => requestedQueries.at(-1)).toBe("concrete contractor");
});

test("public intake contractor search resets stale query when project context changes", async ({
  page,
}) => {
  const requestedQueries = [];

  await page.route("**/api/projects/public-intake/**", async (route) => {
    const requestUrl = route.request().url();
    const method = route.request().method();

    if (requestUrl.endsWith("/start/") && method === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          intake_id: 504,
          token: "landing-token-stale-search",
          status: "draft",
          public_url: "http://localhost:5173/start-project/landing-token-stale-search",
        }),
      });
      return;
    }

    if (requestUrl.includes("/contractor-search/") && method === "GET") {
      const url = new URL(requestUrl);
      requestedQueries.push(url.searchParams.get("query") || "");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: {
            search_query: url.searchParams.get("query") || "",
            radius_miles: 25,
            project_mode: "full_service",
            payment_preference: "escrow",
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
          id: 504,
          token: "landing-token-stale-search",
          status: "draft",
          contractor_name: "Your contractor",
          customer_name: "Search Prospect",
          customer_email: "search@example.com",
          customer_phone: "555-555-5555",
          customer_address_line1: "100 Search St",
          customer_address_line2: "",
          customer_city: "Austin",
          customer_state: "TX",
          customer_postal_code: "78701",
          same_as_customer_address: true,
          project_class: "residential",
          project_address_line1: "100 Search St",
          project_address_line2: "",
          project_city: "Austin",
          project_state: "TX",
          project_postal_code: "78701",
          accomplishment_text: "",
          original_description: "",
          refined_description: "",
          project_scope_summary: "",
          ai_project_title: "",
          ai_project_type: "",
          ai_project_subtype: "",
          ai_description: "",
          ai_milestones: [],
          measurement_handling: "",
          ai_clarification_questions: [],
          ai_clarification_answers: {},
          clarification_photos: [],
          ai_analysis_payload: {},
          post_submit_flow: "",
          post_submit_flow_selected_at: null,
          submitted_at: null,
          sent_at: null,
          completed_at: null,
        }),
      });
    }
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("landing-start-project-intake-button").click();
  await expect(page).toHaveURL(/\/start-project\/landing-token-stale-search$/);
  await page.getByTestId("public-intake-accomplishment-text").fill("Install a new plumbing pipe under the sink.");
  await page.getByRole("button", { name: "Choose Local Contractors" }).click();

  const searchInput = page.getByTestId("public-intake-contractor-search-input");
  await expect(searchInput).toHaveValue("plumber");
  await expect.poll(() => requestedQueries.at(-1)).toBe("plumber");
  await searchInput.fill("plumber");

  await page.getByRole("button", { name: /Project Idea/ }).click();
  await page.getByTestId("public-intake-accomplishment-text").fill(
    "Patio extension: construct a concrete slab and repair the existing patio surface."
  );
  await page.getByRole("button", { name: "Choose Local Contractors" }).click();

  await expect(searchInput).toHaveValue("concrete contractor patio contractor");
  await expect.poll(() => requestedQueries.at(-1)).toBe("concrete contractor patio contractor");
  expect(requestedQueries.at(-1)).not.toBe("plumber");
});

test("public intake description helper refines the project idea before generating the plan", async ({
  page,
}) => {
  await page.route("**/api/projects/public-intake/**", async (route) => {
    const requestUrl = route.request().url();
    const method = route.request().method();

    if (requestUrl.endsWith("/start/") && method === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          intake_id: 502,
          token: "landing-token-refine",
          status: "draft",
          public_url: "http://localhost:5173/start-project/landing-token-refine",
        }),
      });
      return;
    }

    if (requestUrl.includes("/improve-description/") && method === "POST") {
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Description improved.",
          description: "We will replace the kitchen cabinets, confirm the layout, and review finish choices before starting.",
          source: "ai",
          current_description: body.current_description || "",
        }),
      });
      return;
    }

    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 502,
          token: "landing-token-refine",
          status: "draft",
          contractor_name: "Your contractor",
          customer_name: "Refine Prospect",
          customer_email: "refine@example.com",
          customer_phone: "555-444-1111",
          customer_address_line1: "200 Refine St",
          customer_address_line2: "",
          customer_city: "Austin",
          customer_state: "TX",
          customer_postal_code: "78701",
          same_as_customer_address: true,
          project_class: "residential",
          project_address_line1: "200 Refine St",
          project_address_line2: "",
          project_city: "Austin",
          project_state: "TX",
          project_postal_code: "78701",
          accomplishment_text: "",
          ai_project_title: "",
          ai_project_type: "",
          ai_project_subtype: "",
          ai_description: "",
          ai_project_timeline_days: null,
          ai_project_budget: null,
          ai_milestones: [],
          measurement_handling: "",
          ai_clarification_questions: [],
          ai_clarification_answers: {},
          clarification_photos: [],
          ai_analysis_payload: {},
          post_submit_flow: "",
          post_submit_flow_selected_at: null,
          submitted_at: null,
          sent_at: null,
          completed_at: null,
        }),
      });
      return;
    }

    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "Intake updated successfully.",
        id: 502,
        status: "submitted",
        lead_id: 99,
        ai_project_title: "Kitchen Cabinet Replacement",
        ai_project_type: body.ai_project_type || "Cabinets / Carpentry",
        ai_project_subtype: body.ai_project_subtype || "Kitchen Remodeling",
        ai_description: body.ai_description || body.refined_description || "Structured commercial scope summary.",
        refined_description: body.refined_description || body.ai_description || "Structured commercial scope summary.",
        ai_project_timeline_days: 10,
        ai_project_budget: "5000.00",
        budget_range_text: body.budget_range_text || "",
        desired_timing_text: body.desired_timing_text || "",
        tentative_start_date: body.tentative_start_date || "",
        measurement_handling: body.measurement_handling || "site_visit_required",
        ai_milestones: [],
        ai_clarification_questions: [],
        ai_clarification_answers: {},
        clarification_photos: [],
        ai_analysis_payload: {},
        post_submit_flow: body.branch_flow || "",
        branch_invites: [],
        completed_at: "2026-04-15T16:00:00Z",
      }),
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("landing-start-project-intake-button").click();
  await expect(page).toHaveURL(/\/start-project\/landing-token-refine$/);
  await page.getByTestId("public-intake-accomplishment-text").fill("kitchen cabinet replacement");
  await expect(page.getByTestId("public-intake-improve-description-button")).toBeVisible();
  await expect(page.getByTestId("public-intake-improve-description-button")).toBeEnabled({ timeout: 15000 });
  await page.getByTestId("public-intake-improve-description-button").click();
  await expect(page.getByTestId("public-intake-description-refinement-card")).toBeVisible();
  await expect(page.getByTestId("public-intake-description-refinement-card")).toContainText(
    "Here’s a clearer version based on your description."
  );
  await expect(page.getByTestId("public-intake-description-refinement-card")).not.toContainText(/&aacute;|pos;s|H#re|â/);
  await expect(page.getByTestId("public-intake-description-refined-textarea")).toHaveValue(
    "We will replace the kitchen cabinets, confirm the layout, and review finish choices before starting."
  );

  await page.getByTestId("public-intake-description-keep-original").click();
  await expect(page.getByTestId("public-intake-description-refinement-card")).toHaveCount(0);
  await expect(page.getByTestId("public-intake-accomplishment-text")).toHaveValue("kitchen cabinet replacement");

  await expect(page.getByTestId("public-intake-improve-description-button")).toBeEnabled();
  await page.getByTestId("public-intake-improve-description-button").click();
  await page.getByTestId("public-intake-description-refined-textarea").fill(
    "We will replace the kitchen cabinets, confirm the layout, and review finish choices before starting."
  );
  await page.getByTestId("public-intake-description-use-version").click();
  await expect(page.getByTestId("public-intake-accomplishment-text")).toHaveValue("kitchen cabinet replacement");
  await expect(page.getByTestId("public-intake-description-accepted-card")).toBeVisible();
  await expect(page.getByTestId("public-intake-description-accepted-text")).toContainText(
    "We will replace the kitchen cabinets, confirm the layout, and review finish choices before starting."
  );
  await expect(page.getByTestId("public-intake-description-refinement-card")).toHaveCount(0);

  await page.getByTestId("public-intake-generate-structure").click();
  await expect(page.getByTestId("public-intake-project-summary")).toBeVisible();
  await expect(page.getByTestId("public-intake-project-summary-row-original-description")).toContainText(
    "kitchen cabinet replacement"
  );
  await expect(page.getByTestId("public-intake-project-summary-row-refined-description")).toContainText(
    "We will replace the kitchen cabinets, confirm the layout, and review finish choices before starting."
  );
  await page.getByTestId("public-intake-clarification-next").click();
  await expect(page.getByTestId("public-intake-project-details-step")).toBeVisible();
  await expect(page.getByTestId("public-intake-project-type")).toHaveValue("Cabinets / Carpentry");
  await expect(page.getByTestId("public-intake-project-subtype")).toHaveValue("Kitchen Remodeling");
});
