import { expect, test } from "@playwright/test";

test("landing page drives into intake and public intake shows branching choices after submit", async ({
  page,
}) => {
  const branchRequests = [];

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
        ai_project_type: "Commercial",
        ai_project_subtype: "General Commercial",
        ai_description: "Structured commercial scope summary.",
        ai_project_timeline_days: 10,
        ai_project_budget: "5000.00",
        measurement_handling: "site_visit_required",
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

  await page.getByTestId("public-intake-accomplishment-text").fill("Need a bid-ready commercial scope.");
  await expect(page.getByTestId("public-intake-generate-structure")).toBeEnabled();
  await page.getByTestId("public-intake-generate-structure").click();
  await expect(page.getByTestId("public-intake-project-summary")).toBeVisible();
  await expect(page.getByTestId("public-intake-project-summary-title")).toContainText("Your Project So Far");
  await expect(page.getByText("Refine Your Project", { exact: true })).toBeVisible();
  await expect(page.getByTestId("public-intake-clarification-photo-section")).toBeVisible();
  await expect(page.getByTestId("public-intake-measurement-provided")).toHaveCount(0);
  await expect(page.getByText("No clarification questions are needed for this project.")).toHaveCount(0);
  await page.getByTestId("public-intake-clarification-next").click();
  await expect(page.getByTestId("public-intake-project-snapshot")).toBeVisible();
  await expect(page.getByTestId("public-intake-project-snapshot-title")).toContainText("Project Snapshot");
  await page.getByTestId("public-intake-project-snapshot-continue").click();
  await expect(page.getByTestId("public-intake-structured-output-step")).toBeVisible();
  await expect(page.getByTestId("public-intake-structured-output-title")).toContainText("Your Project Plan");
  await page.getByTestId("public-intake-structured-continue").click();
  await page.getByRole("button", { name: "Choose Path" }).click();
  await expect(page.getByTestId("public-intake-branching-section")).toBeVisible();
  await expect(page.getByTestId("public-intake-branching-section")).toContainText("How would you like to proceed?");
  await expect(page.getByTestId("public-intake-branch-single")).toContainText("Work with one contractor");
  await expect(page.getByTestId("public-intake-branch-multi")).toContainText("Get multiple quotes");

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
        ai_project_title: "Commercial Scope Request",
        ai_project_type: "Commercial",
        ai_project_subtype: "General Commercial",
        ai_description: "Structured commercial scope summary.",
        ai_project_timeline_days: 10,
        ai_project_budget: "5000.00",
        measurement_handling: "site_visit_required",
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
  await page.getByTestId("public-intake-accomplishment-text").fill("Need to replace kitchen cabinets");
  await expect(page.getByTestId("public-intake-improve-description-button")).toBeVisible();
  await page.getByTestId("public-intake-improve-description-button").click();
  await expect(page.getByTestId("public-intake-description-refinement-card")).toBeVisible();
  await expect(page.getByTestId("public-intake-description-refined-textarea")).toHaveValue(
    "We will replace the kitchen cabinets, confirm the layout, and review finish choices before starting."
  );

  await page.getByTestId("public-intake-description-keep-original").click();
  await expect(page.getByTestId("public-intake-description-refinement-card")).toHaveCount(0);
  await expect(page.getByTestId("public-intake-accomplishment-text")).toHaveValue("Need to replace kitchen cabinets");

  await page.getByTestId("public-intake-improve-description-button").click();
  await page.getByTestId("public-intake-description-refined-textarea").fill(
    "We will replace the kitchen cabinets, confirm the layout, and review finish choices before starting."
  );
  await page.getByTestId("public-intake-description-use-version").click();
  await expect(page.getByTestId("public-intake-accomplishment-text")).toHaveValue(
    "We will replace the kitchen cabinets, confirm the layout, and review finish choices before starting."
  );

  await page.getByTestId("public-intake-generate-structure").click();
  await expect(page.getByTestId("public-intake-project-summary")).toBeVisible();
});
