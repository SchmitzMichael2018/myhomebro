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

  await expect(page.getByTestId("agreement-proposal-prefill-summary")).toContainText("Based on accepted Estimate");
  await expect(page.getByTestId("agreement-proposal-prefill-summary")).toContainText("Agreement becomes the source of truth");
  await expect(page.getByTestId("agreement-proposal-prefill-summary")).toContainText("$950.00");
  await expect(page.getByTestId("agreement-proposal-prefill-summary")).toContainText("$200.00");
  await expect(page.getByTestId("agreement-proposal-prefill-scope")).toContainText("Demo, prep, and install.");
  await expect(page.getByTestId("agreement-proposal-prefill-scope")).toContainText("Crew labor");
  await expect(page.getByTestId("agreement-step1-assistant-banner")).toContainText("Need help with this agreement?");
  await expect(page.getByTestId("agreement-step1-open-assistant")).toContainText("Open Project Assistant");
  await expect(page.getByTestId("agreement-ai-improve-classification-button")).toHaveCount(0);
  await expect(page.getByTestId("agreement-ai-improve-scope-button")).toHaveCount(0);
  await page.getByTestId("agreement-step1-open-assistant").click();
  await expect(page.getByTestId("assistant-desktop-dock")).toBeVisible();
  await expect(page.getByTestId("agreement-step1-open-assistant")).toHaveAttribute("aria-expanded", "true");
});

test("Project Assistant classification is visibly pending and remains advisory until applied", async ({ page }) => {
  await installWizardMocks(page);
  await loginContractor(page);
  await page.addInitScript(() => {
    const key = "mhb_first_project_assist_handoff";
    const handoff = JSON.parse(window.sessionStorage.getItem(key) || "{}");
    handoff.assistantDraftPayload = {
      ...(handoff.assistantDraftPayload || {}),
      project_type: "",
      project_subtype: "",
    };
    window.sessionStorage.setItem(key, JSON.stringify(handoff));
  });
  let classificationCalls = 0;
  await page.route("**/api/projects/agreements/ai/classify/", async (route) => {
    classificationCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        classification: {
          project_type: "Bathroom",
          project_subtype: "Refresh",
          project_title: "Bathroom Remodel",
          confidence: "high",
          confidence_label: "High confidence",
          reason: "The overall project is a bathroom remodel.",
          alternatives: [
            { project_type: "Flooring", project_subtype: "Tile Flooring" },
          ],
        },
      }),
    });
  });

  await page.goto("/app/agreements/new/wizard?step=1", { waitUntil: "domcontentloaded" });
  await page.getByTestId("agreement-step1-open-assistant").click();
  const desktopAssistant = page.getByTestId("assistant-desktop-dock");
  const action = desktopAssistant.getByTestId("project-assistant-action-step1_improve_classification");
  await action.click();
  await expect(desktopAssistant.getByTestId("project-assistant-classification-status")).toContainText(
    "Analyzing project classification..."
  );
  await expect(action).toBeDisabled();
  await expect(desktopAssistant.getByTestId("project-assistant-classification-status")).toContainText(
    "Classification suggestion ready."
  );
  expect(classificationCalls).toBe(1);

  const suggestion = page.getByTestId("agreement-classification-suggestion");
  await expect(suggestion).toContainText("Current: Not selected");
  await expect(suggestion).toContainText("Suggested: Bathroom");
  await expect(suggestion).toContainText("Suggested: Refresh");
  await expect(suggestion).not.toContainText("Flooring");
  await expect(page.getByTestId("agreement-ai-accept-classification-button")).toContainText("Apply Suggestion");

  await page.getByTestId("agreement-ai-accept-classification-button").click();
  await expect(page.getByTestId("agreement-project-type-select")).toHaveValue("Bathroom");
  await expect(page.getByTestId("agreement-project-subtype-select")).toHaveValue("Refresh");
  await expect(desktopAssistant.getByTestId("project-assistant-action-step1_improve_classification")).toHaveCount(0);
});

test("Project Assistant classification failure is visible and retryable", async ({ page }) => {
  await installWizardMocks(page);
  await loginContractor(page);
  await page.addInitScript(() => {
    const key = "mhb_first_project_assist_handoff";
    const handoff = JSON.parse(window.sessionStorage.getItem(key) || "{}");
    handoff.assistantDraftPayload = { ...(handoff.assistantDraftPayload || {}), project_type: "", project_subtype: "" };
    window.sessionStorage.setItem(key, JSON.stringify(handoff));
  });
  let calls = 0;
  await page.route("**/api/projects/agreements/ai/classify/", async (route) => {
    calls += 1;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Classification is temporarily unavailable. Try again." }),
    });
  });

  await page.goto("/app/agreements/new/wizard?step=1", { waitUntil: "domcontentloaded" });
  await page.getByTestId("agreement-step1-open-assistant").click();
  const desktopAssistant = page.getByTestId("assistant-desktop-dock");
  const action = desktopAssistant.getByTestId("project-assistant-action-step1_improve_classification");
  await action.click();
  await expect(desktopAssistant.getByTestId("project-assistant-classification-status")).toContainText(
    "Classification is temporarily unavailable. Try again."
  );
  await expect(action).toBeEnabled();
  await action.click();
  await expect.poll(() => calls).toBe(2);
});

test("Project Assistant Improve Scope is advisory, visible, retryable, and scope-only", async ({ page }) => {
  await installWizardMocks(page);
  await loginContractor(page);
  const originalScope = "Accepted bathroom remodel scope.";
  const improvedScope = "Remove existing finishes, install new tile and fixtures, complete painting, and clean the site.";
  const agreement = {
    id: 100,
    project_title: "Bathroom Remodel",
    title: "Bathroom Remodel",
    project_type: "Bathroom",
    project_subtype: "Refresh",
    description: originalScope,
    scope_of_work: originalScope,
    total_cost: "950.00",
    incidentals_reserve_amount: "200.00",
    status: "draft",
    step_status: "step1",
    source_proposal_id: 42,
    selected_template_id: 11,
    selected_template_name_snapshot: "Bathroom Template",
    accepted_estimate_basis: { proposal_id: 42, review_version: 1, total: "950.00", pricing_rows: [] },
  };
  let descriptionCalls = 0;
  let shouldFail = true;
  const agreementPatches = [];
  const milestoneMutations = [];
  await page.route("**/api/projects/agreements/ai/description/", async (route) => {
    descriptionCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (shouldFail) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Unavailable" }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ description: improvedScope, scope_of_work: improvedScope }),
    });
  });
  await page.route(/\/api\/projects\/agreements\/100\/?(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "PATCH") {
      agreementPatches.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...agreement, ...route.request().postDataJSON() }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(agreement) });
  });
  await page.route("**/api/projects/milestones/**", async (route) => {
    if (route.request().method() !== "GET") milestoneMutations.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });

  await page.goto("/app/agreements/100/wizard?step=1", { waitUntil: "domcontentloaded" });
  await page.getByTestId("agreement-step1-open-assistant").click();
  const desktopAssistant = page.getByTestId("assistant-desktop-dock");
  const action = desktopAssistant.getByTestId("project-assistant-action-step1_improve_scope");
  await action.click();
  await expect(desktopAssistant.getByTestId("project-assistant-scope-status")).toContainText("Improving scope...");
  await expect(action).toBeDisabled();
  await expect(desktopAssistant.getByTestId("project-assistant-scope-status")).toContainText(
    "Scope improvement could not be completed. Try again."
  );
  await expect(action).toBeEnabled();
  await expect(page.getByTestId("proposal-draft-textarea")).toHaveValue(originalScope);
  expect(agreementPatches).toEqual([]);

  await page.getByRole("button", { name: "Step 2 Milestones" }).click();
  await page.getByRole("button", { name: "Step 1 Details" }).click();
  await expect(desktopAssistant.getByTestId("project-assistant-scope-status")).toHaveCount(0);

  shouldFail = false;
  await action.click();
  await expect(desktopAssistant.getByTestId("project-assistant-scope-status")).toContainText(
    "Improved scope ready. Review the suggested Scope of Work in Project Details."
  );
  expect(descriptionCalls).toBe(2);
  await expect(page.getByTestId("proposal-draft-textarea")).toHaveValue(originalScope);
  await expect(page.getByTestId("scope-diff-view")).toContainText("Apply Improved Scope");
  await page.getByRole("button", { name: "Apply Improved Scope" }).click();
  await expect(page.getByTestId("proposal-draft-textarea")).toContainText("Remove existing finishes");
  expect(agreementPatches).toHaveLength(1);
  expect(Object.keys(agreementPatches[0]).sort()).toEqual(["description", "scope_of_work"]);
  expect(milestoneMutations).toEqual([]);
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

test("persisted accepted Estimate Agreement keeps setup provenance and renders Step 2", async ({ page }) => {
  await installWizardMocks(page);
  await loginContractor(page);
  const recommendationCalls = [];
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.route("**/api/projects/templates/recommend/", async (route) => {
    recommendationCalls.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        confidence_level: "high",
        recommended_template: { id: 99, name: "Bathroom Repair Template" },
      }),
    });
  });
  const agreement = {
    id: 100,
    project_title: "QA Bathroom Remodel",
    title: "QA Bathroom Remodel",
    project_type: "Bathroom Remodel",
    project_subtype: "Full Remodel",
    description: "Accepted remodel scope",
    total_cost: "1000.00",
    status: "draft",
    step_status: "step1",
    source_proposal_id: 42,
    selected_template_id: 11,
    selected_template_name_snapshot: "QA Remodel Template",
    selected_template: { id: 11, name: "QA Remodel Template", project_type: "Bathroom Remodel", project_subtype: "Full Remodel" },
    accepted_estimate_basis: {
      proposal_id: 42,
      review_version: 1,
      subtotal: "1000.00",
      tax: "0.00",
      discounts: "0.00",
      incidentals_reserve: "0.00",
      total: "1000.00",
      pricing_rows: [],
    },
  };
  const milestones = [{
    id: 501,
    agreement: 100,
    order: 1,
    title: "Bathroom installation",
    description: "Accepted Estimate milestone",
    amount: "1000.00",
    accepted_estimate_amount: "1000.00",
    accepted_estimate_review_version: 1,
    accepted_estimate_source_key: "bathroom-installation",
  }];
  await page.route(/\/api\/projects\/agreements\/100\/?(?:\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(agreement) })
  );
  await page.route("**/api/projects/milestones/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: milestones }) })
  );

  await page.goto("/app/agreements/100/wizard?step=1", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("agreement-proposal-prefill-summary")).toContainText("Based on accepted Estimate v1");
  await expect(page.getByTestId("agreement-step1-assistant-banner")).toBeVisible();
  await expect(page.getByTestId("recommended-setup-card")).toHaveCount(0);
  await expect(page.getByTestId("step1-ai-template-recommendation")).toHaveCount(0);
  expect(recommendationCalls).toEqual([]);

  await page.getByRole("button", { name: "Step 2 Milestones" }).click();
  await expect(page.getByText("Bathroom installation").first()).toBeVisible();
  await expect(page.getByText("This workspace could not finish loading.")).toHaveCount(0);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("Bathroom installation").first()).toBeVisible();
  await page.getByRole("button", { name: "Step 1 Details" }).click();
  await expect(page.getByTestId("agreement-proposal-prefill-summary")).toContainText("Based on accepted Estimate v1");
  await expect(page.getByTestId("agreement-step1-assistant-banner")).toBeVisible();
  await page.getByRole("button", { name: "Step 2 Milestones" }).click();
  await expect(page.getByText("Bathroom installation").first()).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(recommendationCalls).toEqual([]);
});
