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
  await expect(page.getByTestId("agreement-customer-select")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Customer", exact: true })).toBeVisible();
  await page.getByTestId("agreement-step1-open-assistant").click();
  await expect(page.getByTestId("assistant-desktop-dock")).toBeVisible();
  await expect(page.getByTestId("agreement-step1-open-assistant")).toHaveAttribute("aria-expanded", "true");
});

test("Estimate-derived Agreement presents its authoritative customer without selection or duplicate creation", async ({ page }) => {
  await installWizardMocks(page);
  await loginContractor(page);
  await page.addInitScript(() => {
    const key = "mhb_first_project_assist_handoff";
    const handoff = JSON.parse(window.sessionStorage.getItem(key) || "{}");
    handoff.assistantPrefill = {
      ...(handoff.assistantPrefill || {}),
      homeowner_id: 77,
      customer_name: "QA Homeowner",
      email: "qa-homeowner@myhomebro.com",
    };
    handoff.assistantDraftPayload = {
      ...(handoff.assistantDraftPayload || {}),
      homeowner: 77,
      homeowner_id: 77,
      customer_id: 77,
      customer_name: "QA Homeowner",
      customer_email: "qa-homeowner@myhomebro.com",
      customer_phone: "512-555-0177",
    };
    window.sessionStorage.setItem(key, JSON.stringify(handoff));
  });
  const customer = {
    id: 77,
    full_name: "QA Homeowner",
    email: "qa-homeowner@myhomebro.com",
    phone_number: "512-555-0177",
    street_address: "123 Main St",
    city: "Austin",
    state: "TX",
    zip_code: "78701",
  };
  await page.route("**/api/projects/homeowners**", async (route) => {
    const isDetail = /\/homeowners\/77\/?(?:\?|$)/.test(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(isDetail ? customer : { results: [customer] }),
    });
  });

  await page.goto("/app/agreements/new/wizard?step=1", { waitUntil: "domcontentloaded" });
  const carried = page.getByTestId("agreement-carried-customer");
  await expect(carried).toContainText("QA Homeowner");
  await expect(carried).toContainText("qa-homeowner@myhomebro.com");
  await expect(carried).toContainText("512-555-0177");
  await expect(page.getByTestId("agreement-customer-select")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add Customer", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change Customer", exact: true })).toHaveCount(0);

  const persisted = {
    id: 100,
    homeowner: 77,
    homeowner_name: customer.full_name,
    homeowner_email: customer.email,
    source_proposal_id: 42,
    accepted_estimate_basis: { proposal_id: 42, review_version: 1, pricing_rows: [] },
    project_title: "Bathroom Remodel",
    project_type: "Bathroom",
    project_subtype: "Refresh",
    description: "Accepted bathroom scope.",
    scope_of_work: "Accepted bathroom scope.",
    status: "draft",
    step_status: "step1",
  };
  await page.route(/\/api\/projects\/agreements\/100\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(persisted) });
  });
  await page.goto("/app/agreements/100/wizard?step=1", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("agreement-carried-customer")).toContainText("QA Homeowner");
  await expect(page.getByTestId("agreement-customer-select")).toHaveCount(0);
});

test("unsaved accepted-Estimate Agreement can improve scope before save validation", async ({ page }) => {
  await installWizardMocks(page);
  await loginContractor(page);
  const improvedScope = "Demolition\n- Remove existing bathroom finishes.\n\nInstallation\n- Complete accepted tile and fixture installation.";
  const aiRequests = [];
  const createRequests = [];
  const patchRequests = [];
  await page.route("**/api/projects/agreements/ai/description/", async (route) => {
    aiRequests.push(route.request().postDataJSON());
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ description: improvedScope }),
    });
  });
  await page.route(/\/api\/projects\/agreements\/?(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      createRequests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ detail: "The accepted estimate milestone allocation does not reconcile to its contractual amount." }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });
  await page.route(/\/api\/projects\/agreements\/\d+\/?(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "PATCH") patchRequests.push(route.request().postDataJSON());
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Not found" }) });
  });

  await page.goto("/app/agreements/new/wizard?step=1", { waitUntil: "domcontentloaded" });
  await page.getByTestId("agreement-step1-open-assistant").click();
  const assistant = page.getByTestId("assistant-desktop-dock");
  const action = assistant.getByTestId("project-assistant-action-step1_improve_scope");
  await action.click();
  await expect(assistant.getByTestId("project-assistant-scope-status")).toContainText("Improving scope...");
  await expect(action).toBeDisabled();
  await expect(page.getByText("AI drafting needs a saved agreement", { exact: false })).toHaveCount(0);
  await expect(page.getByTestId("scope-diff-view")).toContainText("Apply Improved Scope");

  expect(aiRequests).toHaveLength(1);
  const request = aiRequests[0];
  expect(request.agreement_id).toBeNull();
  expect(request.current_scope).toContain("Demo, prep, and install.");
  expect(request.accepted_estimate.line_items.map((row) => row.description)).toEqual(["Crew labor", "Tile and fixtures"]);
  expect(JSON.stringify(request)).not.toContain("Requested Timing");
  expect(JSON.stringify(request)).not.toContain("Estimate Pricing");
  expect(JSON.stringify(request)).not.toContain("$750.00");
  expect(JSON.stringify(request)).not.toContain("Incidentals Reserve");

  await page.getByRole("button", { name: "Apply Improved Scope" }).click();
  await expect(page.getByTestId("proposal-draft-textarea")).toHaveValue(improvedScope);
  expect(patchRequests).toEqual([]);

  await page.getByTestId("assistant-desktop-dock-close").click();
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  await expect.poll(() => createRequests.length).toBe(1);
  expect(createRequests[0].scope_of_work).toBe(improvedScope);
  await expect(page.getByText("does not reconcile", { exact: false }).first()).toBeVisible();
  expect(patchRequests).toEqual([]);
});

test("accepted Estimate Save & Next creates the draft and reaches Step 2 with reconciled commercial pricing", async ({ page }) => {
  await installWizardMocks(page);
  await loginContractor(page);
  await page.addInitScript(() => {
    const key = "mhb_first_project_assist_handoff";
    const handoff = JSON.parse(window.sessionStorage.getItem(key) || "{}");
    handoff.assistantPrefill = { ...(handoff.assistantPrefill || {}), homeowner_id: 77 };
    handoff.assistantDraftPayload = {
      ...(handoff.assistantDraftPayload || {}),
      homeowner: 77,
      homeowner_id: 77,
      customer_id: 77,
    };
    window.sessionStorage.setItem(key, JSON.stringify(handoff));
  });
  const reconciliation = {
    status: "reconciled",
    reconciles: true,
    expected_commercial_amount: "12850.00",
    mapped_snapshot_amount: "12850.00",
    actual_milestone_amount: "12850.00",
    difference: "0.00",
    incidentals_reserve: "1500.00",
    funding_total: "14350.00",
    missing_lineage_rows: [],
    excluded_rows: [{ category: "incidentals_reserve", description: "Refundable incidentals", amount: "1500.00" }],
  };
  const agreement = {
    id: 100,
    homeowner: 77,
    homeowner_name: "QA Homeowner",
    homeowner_email: "qa-homeowner@myhomebro.com",
    project_title: "Bathroom Remodel",
    title: "Bathroom Remodel",
    project_type: "Bathroom",
    project_subtype: "Refresh",
    description: "Accepted bathroom remodel scope.",
    scope_of_work: "Accepted bathroom remodel scope.",
    total_cost: "12850.00",
    incidentals_reserve_amount: "1500.00",
    source_proposal_id: 42,
    status: "draft",
    step_status: "step2",
    planning_validation_status: "needs_review",
    planning_validation_summary: {
      status: "needs_review",
      reason: "The proposed dates overlap with existing scheduled work.",
    },
    accepted_estimate_basis: {
      proposal_id: 42,
      review_version: 1,
      subtotal: "12850.00",
      tax: "0.00",
      discounts: "0.00",
      incidentals_reserve: "1500.00",
      total: "14350.00",
      pricing_rows: [],
      milestone_reconciliation: reconciliation,
    },
  };
  const milestones = [
    { id: 501, agreement: 100, order: 1, title: "Demolition", amount: "1000.00", accepted_estimate_amount: "1000.00", accepted_estimate_review_version: 1 },
    { id: 502, agreement: 100, order: 2, title: "Plumbing & Electrical Prep", amount: "1950.00", accepted_estimate_amount: "1950.00", accepted_estimate_review_version: 1 },
    { id: 503, agreement: 100, order: 3, title: "Tile & Shower Install", amount: "4950.00", accepted_estimate_amount: "4950.00", accepted_estimate_review_version: 1 },
    { id: 504, agreement: 100, order: 4, title: "Fixture Install", amount: "4950.00", accepted_estimate_amount: "4950.00", accepted_estimate_review_version: 1 },
  ];
  let createCount = 0;
  let patchCount = 0;
  let acknowledgmentCount = 0;
  const milestoneMutations = [];
  await page.route("**/api/projects/homeowners**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ results: [{ id: 77, full_name: "QA Homeowner", email: "qa-homeowner@myhomebro.com" }] }),
  }));
  await page.route(/\/api\/projects\/agreements\/?(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") createCount += 1;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(agreement) });
  });
  await page.route(/\/api\/projects\/agreements\/100\/?(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "PATCH") patchCount += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(agreement) });
  });
  await page.route("**/api/projects/agreements/100/acknowledge-planning-validation/", async (route) => {
    acknowledgmentCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "needs_review", acknowledged_at: "2026-08-15T12:00:00Z", summary: agreement.planning_validation_summary }),
    });
  });
  await page.route("**/api/projects/milestones/**", (route) => {
    if (route.request().method() !== "GET") {
      milestoneMutations.push({ method: route.request().method(), data: route.request().postDataJSON() });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: milestones }),
    });
  });

  await page.goto("/app/agreements/new/wizard?step=1", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Save & Next" }).click();
  await expect(page).toHaveURL(/\/app\/agreements\/100\/wizard\?step=2/);
  await expect(page.getByTestId("step2-accepted-estimate-pricing-summary")).toContainText("$12,850.00");
  await expect(page.getByTestId("step2-accepted-estimate-pricing-summary")).toContainText("$1,500.00");
  await expect(page.getByTestId("step2-accepted-estimate-pricing-summary")).toContainText("$14,350.00");
  await expect(page.getByText("Fixture Install").first()).toBeVisible();
  for (const amount of ["$1,000.00", "$1,950.00", "$4,950.00"]) {
    await expect(page.getByText(amount, { exact: true }).first()).toBeVisible();
  }
  const draftUrl = page.url();
  const [schedulePage] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Review schedule" }).click(),
  ]);
  await expect(schedulePage).toHaveURL(/\/app\/team\/schedule/);
  await schedulePage.close();
  await expect(page).toHaveURL(draftUrl);
  await page.getByRole("button", { name: "Continue anyway" }).click();
  await expect.poll(() => acknowledgmentCount).toBe(1);
  for (const amount of ["$1,000.00", "$1,950.00", "$4,950.00"]) {
    await expect(page.getByText(amount, { exact: true }).first()).toBeVisible();
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("$1,950.00", { exact: true }).first()).toBeVisible();
  expect(milestoneMutations).toEqual([]);
  expect(createCount).toBe(1);
  expect(patchCount).toBeGreaterThanOrEqual(1);
});

test("Step 2 names accepted rows that lack exact milestone lineage", async ({ page }) => {
  await installWizardMocks(page);
  await loginContractor(page);
  const agreement = {
    id: 100,
    project_title: "QA Bathroom Remodel",
    project_type: "Bathroom",
    project_subtype: "Refresh",
    description: "Accepted scope",
    total_cost: "12850.00",
    source_proposal_id: 42,
    status: "draft",
    accepted_estimate_basis: {
      proposal_id: 42,
      review_version: 1,
      subtotal: "12850.00",
      tax: "0.00",
      discounts: "0.00",
      incidentals_reserve: "1500.00",
      total: "14350.00",
      pricing_rows: [],
      milestone_reconciliation: {
        status: "blocked",
        reconciles: false,
        expected_commercial_amount: "12850.00",
        actual_milestone_amount: "7900.00",
        difference: "4950.00",
        missing_lineage_rows: [{ proposal_line_item_id: 44, description: "Fixture Install", amount: "4950.00" }],
      },
    },
  };
  await page.route(/\/api\/projects\/agreements\/100\/?(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(agreement) }));
  const milestoneMutations = [];
  await page.route("**/api/projects/milestones/**", (route) => {
    if (route.request().method() !== "GET") milestoneMutations.push(route.request().method());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });

  await page.goto("/app/agreements/100/wizard?step=2", { waitUntil: "domcontentloaded" });
  const blocker = page.getByTestId("step2-estimate-reconciliation-blocker");
  await expect(blocker).toContainText("Accepted commercial amount: $12,850.00");
  await expect(blocker).toContainText("Current milestone amount: $7,900.00");
  await expect(blocker).toContainText("Difference: $4,950.00");
  await expect(blocker).toContainText("Fixture Install: $4,950.00");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("step2-estimate-reconciliation-blocker")).toBeVisible();
  expect(milestoneMutations).toEqual([]);
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

test("Project Assistant keeps a bathroom remodel above supporting plumbing trades", async ({ page }) => {
  await installWizardMocks(page);
  await loginContractor(page);
  await page.addInitScript(() => {
    const key = "mhb_first_project_assist_handoff";
    const handoff = JSON.parse(window.sessionStorage.getItem(key) || "{}");
    handoff.assistantDraftPayload = {
      ...(handoff.assistantDraftPayload || {}),
      project_title: "Master Bath Renovation",
      project_type: "",
      project_subtype: "",
      description:
        "Master bath remodel with demolition, plumbing and electrical prep, tile and shower install, fixture install, and final cleanup.",
    };
    window.sessionStorage.setItem(key, JSON.stringify(handoff));
  });
  await page.route("**/api/projects/agreements/ai/classify/", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        classification: {
          project_type: "Plumbing",
          project_subtype: "Faucet Repair",
          project_title: "Faucet Repair",
          confidence: "high",
          confidence_label: "High confidence",
          reason: "The overall scope is a bathroom remodel with supporting trades.",
        },
      }),
    })
  );

  await page.goto("/app/agreements/new/wizard?step=1", { waitUntil: "domcontentloaded" });
  await page.getByTestId("agreement-step1-open-assistant").click();
  await page
    .getByTestId("assistant-desktop-dock")
    .getByTestId("project-assistant-action-step1_improve_classification")
    .click();

  const suggestion = page.getByTestId("agreement-classification-suggestion");
  await expect(suggestion).toContainText("Suggested: Remodel");
  await expect(suggestion).toContainText("Suggested: Bathroom Remodel");
  await expect(suggestion).not.toContainText("Suggested: Plumbing");
  await expect(suggestion).not.toContainText("Suggested: Faucet Repair");
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
  const descriptionRequests = [];
  const agreementPatches = [];
  const milestoneMutations = [];
  await page.route("**/api/projects/agreements/ai/description/", async (route) => {
    descriptionCalls += 1;
    descriptionRequests.push(route.request().postDataJSON());
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
  const successfulRequest = descriptionRequests[1];
  expect(successfulRequest.description).toBe(originalScope);
  expect(successfulRequest.scope_of_work).toBe(originalScope);
  expect(successfulRequest.current_description).toContain(originalScope);
  expect(JSON.stringify(successfulRequest)).not.toContain("Estimate Line Items");
  expect(JSON.stringify(successfulRequest)).not.toContain("$750.00");
  await expect(page.getByTestId("proposal-draft-textarea")).toHaveValue(originalScope);
  await expect(page.getByTestId("scope-diff-view")).toContainText("Apply Improved Scope");
  await expect(page.getByTestId("scope-diff-view")).toContainText(originalScope);
  await page.getByRole("button", { name: "Keep Current Scope" }).click();
  await expect(page.getByTestId("scope-diff-view")).toHaveCount(0);
  expect(agreementPatches).toEqual([]);

  await action.click();
  await expect(desktopAssistant.getByTestId("project-assistant-scope-status")).toContainText(
    "Improved scope ready. Review the suggested Scope of Work in Project Details."
  );
  await page.getByRole("button", { name: "Edit before accepting" }).click();
  const editedScope = "Remove existing finishes and install accepted tile and fixtures.";
  await page.getByTestId("scope-diff-view").locator("textarea").fill(editedScope);
  await page.getByRole("button", { name: "Apply Improved Scope" }).click();
  await expect(page.getByTestId("proposal-draft-textarea")).toHaveValue(editedScope);
  expect(agreementPatches).toHaveLength(1);
  expect(Object.keys(agreementPatches[0]).sort()).toEqual(["scope_of_work"]);
  expect(milestoneMutations).toEqual([]);
});

test("Agreement Wizard creates reusable contractor taxonomy from Step 1", async ({ page }) => {
  await installWizardMocks(page);
  await loginContractor(page);
  await page.addInitScript(() => {
    window.sessionStorage.removeItem("mhb_first_project_assist_handoff");
  });
  await page.unroute("**/api/projects/project-types/**");
  await page.unroute("**/api/projects/project-subtypes/**");
  const createdTypes = [];
  const createdSubtypes = [];
  await page.route("**/api/projects/project-types/**", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      createdTypes.push(body);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: 31, name: body.name, value: body.name, label: body.name, owner_type: "contractor", is_system: false }) });
      return;
    }
    const results = [{ id: 1, value: "Remodel", label: "Remodel", owner_type: "system" }];
    if (createdTypes.length) results.push({ id: 31, value: "Specialty Remodel", label: "Specialty Remodel", owner_type: "contractor" });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results }) });
  });
  await page.route("**/api/projects/project-subtypes/**", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      createdSubtypes.push(body);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: 41, project_type: body.project_type, project_type_name: "Specialty Remodel", name: body.name, value: body.name, label: body.name, owner_type: "contractor", is_system: false }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });

  await page.goto("/app/agreements/new/wizard?step=1", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Browse templates manually" }).click();
  await page.getByRole("button", { name: "Add Type", exact: true }).click();
  await page.getByTestId("step1-custom-taxonomy-input").fill("Specialty Remodel");
  await page.getByTestId("step1-custom-taxonomy-save-button").click();
  await expect(page.getByTestId("agreement-project-type-select")).toHaveValue("Specialty Remodel");
  expect(createdTypes).toEqual([{ name: "Specialty Remodel" }]);

  await page.getByRole("button", { name: "Continue with AI Draft" }).click();
  await page.getByRole("button", { name: "Add Subtype", exact: true }).click();
  await page.getByTestId("step1-custom-taxonomy-input").fill("Media Room");
  await page.getByTestId("step1-custom-taxonomy-save-button").click();
  await expect(page.getByTestId("agreement-project-subtype-select")).toHaveValue("Media Room");
  expect(createdSubtypes).toEqual([{ name: "Media Room", project_type: 31 }]);
});

test("Agreement Wizard keeps Step 2 focused on commercial milestones without assignment mutations", async ({ page }) => {
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

  await expect(page.getByTestId("step2-milestone-card-list")).toBeVisible();
  await expect(page.getByTestId("milestone-planning-panel")).toHaveCount(0);
  await expect(page.getByTestId("planning-validation-panel")).toHaveCount(0);
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
