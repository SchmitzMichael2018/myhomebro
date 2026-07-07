import { expect, test } from "@playwright/test";

const CONTRACTOR_EMAIL = "info+contractor@myhomebro.com";

async function loginContractor(page) {
  await page.addInitScript(
    ({ email }) => {
      window.localStorage.setItem("access", "playwright-access-token");
      window.localStorage.setItem("refresh", "playwright-refresh-token");
      window.localStorage.setItem("mhb_last_login_ts", String(Date.now()));
      window.localStorage.setItem("mhb_last_login_email", email);
    },
    { email: CONTRACTOR_EMAIL }
  );
}

async function installWizardMocks(page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem(
      "mhb_first_project_assist_handoff",
      JSON.stringify({
        assistantPrefill: {
          project_title: "Bathroom Remodel",
          project_summary: "Refresh the guest bathroom.",
          customer_name: "New Lead Customer",
          email: "lead@example.com",
          address_line1: "123 Main St, Austin, TX",
          incidentals_reserve_amount: "200.00",
        },
        assistantDraftPayload: {
          source: "proposal",
          proposal_id: 42,
          project_title: "Bathroom Remodel",
          project_type: "Bathroom",
          project_subtype: "Refresh",
          project_start_type: "specific_date",
          project_start_date: "2026-08-15",
          project_completion_type: "specific_date",
          project_completion_date: "2026-09-01",
          scheduling_priority: "preferred",
          description:
            "Project Summary\nRefresh the guest bathroom.\n\nIncluded Work\nDemo, prep, and install.\n\nEstimate Line Items\n- Labor - Crew labor - 10 hours @ $75.00 = $750.00",
          payment_mode: "escrow",
          incidentals_reserve_amount: "200.00",
          proposal_total: "950.00",
          proposal_line_items: [
            { category: "labor", description: "Crew labor", quantity: "10", unit: "hours", unit_price: "75.00", total: "750.00" },
            { category: "materials", description: "Tile and fixtures", quantity: "1", unit: "allowance", unit_price: "200.00", total: "200.00" },
          ],
        },
        assistantContext: {
          source: "proposal",
          proposal_id: 42,
          proposal_total: "950.00",
          incidentals_reserve_amount: "200.00",
        },
        assistantEstimatePreview: {
          source: "proposal",
          suggested_total_price: "950.00",
          incidentals_reserve_amount: "200.00",
        },
        assistantWizardStepTarget: 1,
        assistantIntent: "proposal_to_agreement",
      })
    );
    window.sessionStorage.setItem("mhb_step1_cache_new_start_mode", "manual");
    window.sessionStorage.setItem("mhb_step1_cache_new_start_mode_committed", "1");
    window.sessionStorage.setItem("mhb_step1_cache_new_start_mode_source", "session");
  });

  await page.route("**/api/projects/whoami/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: 7, type: "contractor", role: "contractor_owner", email: "playwright@example.com" }),
    });
  });
  await page.route("**/api/projects/contractors/me/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ public_profile: {} }) });
  });
  await page.route("**/api/projects/contractor-activation-summary/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });
  await page.route("**/api/projects/project-types/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ id: 1, value: "Bathroom", label: "Bathroom", owner_type: "system" }] }),
    });
  });
  await page.route("**/api/projects/project-subtypes/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ id: 2, value: "Refresh", label: "Refresh", owner_type: "system" }] }),
    });
  });
  await page.route("**/api/projects/homeowners**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });
  await page.route("**/api/projects/templates/recommend/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ recommendations: [] }) });
  });
  await page.route("**/api/projects/templates/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });
  await page.route("**/api/projects/subaccounts/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            id: 1,
            display_name: "Taylor Crew",
            is_active: true,
            active_assignment_count: 1,
            calculated_effective_hourly_cost: "50.00",
            capabilities: [
              { skill_id: 12, skill_name: "General Labor", skill_level: "lead", skill_level_label: "Lead" },
              { skill_id: 30, skill_name: "Tile", skill_level: "skilled", skill_level_label: "Skilled" },
            ],
          },
          {
            id: 2,
            display_name: "Jordan Crew",
            is_active: true,
            active_assignment_count: 0,
            calculated_effective_hourly_cost: "40.00",
            capabilities: [
              { skill_id: 20, skill_name: "Plumbing", skill_level: "working", skill_level_label: "Working" },
            ],
          },
        ],
      }),
    });
  });
  await page.route(/\/api\/projects\/agreements\/\d+\/planning-validation\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agreement_id: 100,
        status: "validated",
        summary: {
          status: "validated",
          label: "Validated",
          reason: "No blocking timeline or workforce conflicts were detected.",
          warnings: [],
          blockers: [],
          recommended_timeline: {},
        },
      }),
    });
  });
  await page.route(/\/api\/projects\/agreements\/\d+\/acknowledge-planning-validation\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agreement_id: 100,
        status: "needs_review",
        acknowledged_at: "2026-07-06T12:00:00Z",
        summary: { status: "needs_review", label: "Needs Review", reason: "Acknowledged in test." },
      }),
    });
  });
  await page.route(/\/api\/payments\/onboarding\/status\/?.*$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });
  await page.route(/\/api\/projects\/notifications\/?.*$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });
}

test("Agreement Wizard prefills editable fields from Estimate Workspace handoff", async ({ page }) => {
  await installWizardMocks(page);
  await loginContractor(page);

  await page.goto("/app/agreements/new/wizard?step=1", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("estimate-prefill-applied")).toContainText("Estimate Prefill Applied");
  await expect(page.getByTestId("step1-rerun-ai-setup-button")).toContainText("Re-run AI Setup");
  await expect(page.getByTestId("agreement-proposal-prefill-summary")).toContainText("Estimate Prefill");
  await expect(page.getByTestId("agreement-proposal-prefill-summary")).toContainText("Agreement becomes the source of truth");
  await expect(page.getByTestId("agreement-proposal-prefill-summary")).toContainText("$950.00");
  await expect(page.getByTestId("agreement-proposal-prefill-summary")).toContainText("$200.00");
  await expect(page.getByTestId("agreement-proposal-prefill-scope")).toContainText("Demo, prep, and install.");
  await expect(page.getByTestId("agreement-proposal-prefill-scope")).toContainText("Crew labor");
});

test("Agreement Wizard milestone planning simulation updates and appears in final review", async ({ page }) => {
  await installWizardMocks(page);
  await loginContractor(page);
  const assignmentMutations = [];
  await page.route(/\/api\/projects\/.*assign.*/i, async (route) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(route.request().method())) {
      assignmentMutations.push(route.request().url());
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Not mocked." }) });
  });

  await page.goto("/app/agreements/new/wizard?step=2", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Step 2 Milestones" }).click();

  await expect(page.getByTestId("milestone-planning-panel")).toContainText("Milestone Planning Simulation");
  await expect(page.getByTestId("milestone-planning-panel")).toContainText("Planning only. Employees are not assigned until project activation.");
  await expect(page.getByTestId("planning-validation-panel")).toContainText("Planning validation");
  const initialDays = await page.getByTestId("planning-working-days").innerText();

  await page.getByTestId("planning-crew-size").fill("4");
  await page.getByTestId("planning-priority").selectOption("fastest");
  await page.getByTestId("planning-include-weekends").check();
  await expect(page.getByTestId("planning-crew-summary")).toContainText("4 people");
  await expect(page.getByTestId("planning-capability-mix")).toContainText("General Labor");
  await expect(page.getByTestId("planning-confidence")).toContainText("%");
  await expect(page.getByTestId("planning-working-days")).not.toHaveText(initialDays);

  await page.evaluate(() => {
    window.history.pushState({}, "", "/app/agreements/new/wizard?step=4");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  await expect(page.getByTestId("step4-planning-assumptions")).toContainText("Milestone planning assumptions");
  await expect(page.getByTestId("step4-planning-assumptions")).toContainText("4 people");
  await expect(page.getByTestId("step4-planning-assumptions")).toContainText("Planning only");
  expect(assignmentMutations).toEqual([]);
});
