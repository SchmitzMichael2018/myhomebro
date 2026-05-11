import { expect, test } from "@playwright/test";

const SHARED_AGREEMENT = {
  id: 123,
  title: "Central Air Installation",
  project_title: "Central Air Installation",
  homeowner_name: "Jordan Demo",
  homeowner_email: "jordan@example.com",
  project_class: "residential",
  project_mode: "assisted_diy",
  homeowner_participation_notes: "Homeowner will help with prep and cleanup.",
  homeowner_responsibilities: "Prep materials and assist with cleanup.",
  contractor_responsibilities: "Install equipment and supervise the work.",
  excluded_work: "No unsafe electrical work by homeowner.",
  payment_mode: "escrow",
  status: "draft",
  total_cost: 8400,
  milestones: [
    { id: 1, title: "Homeowner Prep", amount: 500, due_date: "2026-05-12", normalized_milestone_type: "prep" },
    { id: 2, title: "Electrical Panel Tie-In", amount: 2500, due_date: "2026-05-14", normalized_milestone_type: "install" },
  ],
  invoices: [],
};

async function installProjectModeRoutes(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  await page.route("**/api/projects/whoami/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 7,
        type: "contractor",
        role: "contractor_owner",
        email: "playwright@myhomebro.local",
      }),
    });
  });

  await page.route("**/api/payments/onboarding/status/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        onboarding_status: "not_started",
        connected: false,
      }),
    });
  });

  await page.route("**/api/projects/contractors/me/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 77,
        email: "playwright@myhomebro.local",
        full_name: "Playwright Builder",
        business_name: "Playwright Builder Co",
        phone: "555-111-2222",
        address: "123 Main St",
        city: "Austin",
        state: "TX",
        zip: "78701",
        license_number: "",
        license_expiration_date: "",
        accepts_diy_assistance: true,
        accepts_consultation_only: true,
        accepts_hourly_help: false,
        accepts_inspection_only: true,
        accepts_homeowner_participation: true,
        skills: ["HVAC", "Electrical"],
        compliance_records: [],
        compliance_trade_requirements: [],
        insurance_status: {
          has_insurance: false,
          status: "missing",
        },
        logo: null,
        logo_url: null,
        license_file: null,
        license_document: null,
        insurance_file: null,
        insurance_document: null,
        ai: { access: "included", enabled: true, unlimited: true },
      }),
    });
  });

  await page.route("**/api/projects/contractors/onboarding/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "not_started",
        step: "welcome",
        profile_basics_complete: false,
        first_value_reached: false,
        stripe_ready: false,
        stripe_onboarding_status: "not_started",
        show_soft_stripe_prompt: false,
        first_project_started_at: null,
        first_agreement_created_at: null,
        stripe_prompt_dismissed_at: null,
        stripe_connected_at: null,
        step_number: 1,
        step_total: 3,
        service_region_label: "Austin, TX",
        service_radius_miles: 25,
        trade_count: 2,
        activation: {
          last_step_reached: "welcome",
          time_spent_per_step: {},
        },
      }),
    });
  });

  await page.route("**/api/projects/compliance/profile-preview/", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state_code: body?.state || "TX",
        trade_requirements: Array.isArray(body?.skills)
          ? body.skills.map((skill) => ({
              required: skill === "Electrical",
              insurance_required: skill === "Electrical",
              message: `${skill} guidance`,
              issuing_authority_name: "State Board",
              official_lookup_url: "https://example.com",
              contractor_has_license_on_file: false,
              contractor_license_status: "missing",
              contractor_has_insurance_on_file: false,
              warning_level: skill === "Electrical" ? "warning" : "info",
              source_type: "portal",
              state_code: "TX",
              trade_key: skill.toLowerCase(),
            }))
          : [],
      }),
    });
  });

  await page.route("**/api/projects/homeowners/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{ id: 1, full_name: "Jordan Demo", email: "jordan@example.com" }],
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/public_sign\/?\?token=.*$/i, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(SHARED_AGREEMENT),
    });
  });

  await page.route(/\/api\/projects\/agreements\/123\/milestones\/?(\?.*)?$/i, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: SHARED_AGREEMENT.milestones }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/123\/?(\?.*)?$/i, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(SHARED_AGREEMENT),
    });
  });

  await page.route(/\/api\/projects\/agreements\/?(\?.*)?$/i, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [SHARED_AGREEMENT] }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?(\?.*)?$/i, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: SHARED_AGREEMENT.milestones.map((row) => ({ ...row, project_mode: SHARED_AGREEMENT.project_mode })) }),
    });
  });

  await page.route(/\/api\/projects\/invoices\/?(\?.*)?$/i, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/contractor\/public-leads\/?(\?.*)?$/i, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/contractor\/bids\/?(\?.*)?$/i, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/activity-feed\/?(\?.*)?$/i, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/contractor\/payout-history\/?(\?.*)?$/i, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/expense-requests\/?(\?.*)?$/i, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/expenses\/?(\?.*)?$/i, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

}

test("project mode badges and assisted DIY surfaces render across the app", async ({ page }) => {
  await installProjectModeRoutes(page);

  await page.goto("/app/agreements", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("agreement-project-mode-123")).toHaveText("Assisted DIY", { timeout: 15000 });
  await expect(page.getByTestId("agreement-list-project-mode-filter")).toBeVisible();

  await page.goto("/app/agreements/123", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("agreement-detail-project-mode-badge")).toHaveText("Assisted DIY");
  await expect(page.getByText("Homeowner participation", { exact: true })).toBeVisible();
  await expect(page.getByTestId("agreement-milestone-role-1")).toHaveText("Homeowner Task");
  await expect(page.getByTestId("agreement-milestone-role-2")).toHaveText("Contractor Task");
  await expect(page.getByTestId("agreement-milestone-safety-2")).toHaveText(/Licensed Trade Work|Contractor Required/);
  await expect(page.getByTestId("agreement-project-mode-safety-notice")).toBeVisible();

  await page.goto("/public-sign/test-token", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("public-agreement-project-mode-badge")).toHaveText("Assisted DIY");

  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("dashboard-project-mode-assisted-diy")).toBeVisible();
  await expect(page.getByTestId("dashboard-collab-waiting-homeowner")).toBeVisible();
  await expect(page.getByTestId("dashboard-collab-shared-task")).toBeVisible();
});

test("assisted diy intake reveals the homeowner participation guidance fields", async ({ page }) => {
  await installProjectModeRoutes(page);

  await page.goto("/app/intake/new", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("project-mode-option-assisted_diy")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("project-mode-option-assisted_diy").click();
  await page.getByPlaceholder("e.g., Replace leaking roof over garage and inspect flashing.").fill("Replace electrical panel with permit coordination.");
  await expect(page.getByTestId("assisted-diy-safety-banner")).toBeVisible();
  await expect(page.getByText("Many homeowners choose Assisted DIY")).toBeVisible();
  await expect(page.getByText("Which parts will the homeowner handle?")).toBeVisible();
  await expect(page.getByText("Need help finishing?")).toBeVisible();
});
