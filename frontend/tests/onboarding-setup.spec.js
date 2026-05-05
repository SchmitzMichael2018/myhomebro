import { expect, test } from "@playwright/test";

async function installOnboardingRoutes(page) {
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

  await page.route("**/api/projects/contractors/me/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 77,
        business_name: "Playwright Roofing",
        ai: { access: "included", enabled: true, unlimited: true },
      }),
    });
  });

  const workspaceContext = {
    project_family: { key: "", label: "" },
    source: "server",
    updated_at: "2026-04-20T00:00:00Z",
  };

  await page.route("**/api/projects/workspace-context/**", async (route) => {
    const request = route.request();
    if (request.method() === "PATCH") {
      const payload =
        typeof request.postDataJSON === "function"
          ? request.postDataJSON()
          : (() => {
              try {
                return JSON.parse(request.postData() || "{}");
              } catch {
                return {};
              }
            })();
      const family = payload.project_family || {};
      workspaceContext.project_family = {
        key: String(family.key || family.project_family_key || "").trim().toLowerCase(),
        label: String(family.label || family.project_family_label || "").trim() || "Roofing",
      };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(workspaceContext),
    });
  });

  const setupState = {
    work_description: "",
    project_family: { key: "", label: "" },
    project_families: [],
    project_style: {
      workflow_style: "",
      materials_behavior: "",
      project_family_cue: "",
    },
    milestone_tendencies: [],
    pricing_baseline: {
      low: "",
      high: "",
      center: "",
      duration_low_days: 0,
      duration_high_days: 0,
      duration_days: 0,
      milestone_count: 0,
      confidence_level: "",
      confidence_reasoning: "",
    },
    agreement_defaults: {},
    clarification_questions: [],
    clarification_answers: {},
    source: "server",
    summary: "Tell us what kind of work you do and we will build your default setup.",
    completed_at: null,
  };

  await page.route("**/api/projects/contractors/onboarding/setup/**", async (route) => {
    const request = route.request();
    if (request.method() === "PATCH") {
      const payload =
        typeof request.postDataJSON === "function"
          ? request.postDataJSON()
          : (() => {
              try {
                return JSON.parse(request.postData() || "{}");
              } catch {
                return {};
              }
            })();
      const workDescription = String(payload.work_description || setupState.work_description || "").trim();
      const familyKey = workDescription.toLowerCase().includes("roof") ? "roofing" : "";
      setupState.work_description = workDescription;
      setupState.project_family = {
        key: familyKey,
        label: familyKey === "roofing" ? "Roofing" : "",
      };
      setupState.project_families = familyKey ? [setupState.project_family] : [];
      setupState.project_style = {
        workflow_style: familyKey === "roofing" ? "Repair + inspection" : "General project review",
        materials_behavior: familyKey === "roofing" ? "Inspection and materials confirmation first." : "Materials should be confirmed during clarification.",
        project_family_cue: familyKey === "roofing" ? "Roofing-focused review" : "",
      };
      setupState.milestone_tendencies = familyKey
        ? [
            {
              title: "Inspection and protection",
              note: "Confirm the leak location and protect the work area.",
              allocation_percent: 0.2,
              suggested_duration_days: 1,
            },
            {
              title: "Repair work",
              note: "Complete the main roof repair scope.",
              allocation_percent: 0.45,
              suggested_duration_days: 1,
            },
          ]
        : [];
      setupState.pricing_baseline = familyKey
        ? {
            low: "2500.00",
            high: "8000.00",
            center: "5000.00",
            duration_low_days: 1,
            duration_high_days: 4,
            duration_days: 3,
            milestone_count: 4,
            confidence_level: "medium",
            confidence_reasoning: "Roofing work often depends on leak location and roof age.",
          }
        : {
            low: "",
            high: "",
            center: "",
            duration_low_days: 0,
            duration_high_days: 0,
            duration_days: 0,
            milestone_count: 0,
            confidence_level: "",
            confidence_reasoning: "",
          };
      setupState.agreement_defaults = familyKey
        ? {
            project_family_key: "roofing",
            project_family_label: "Roofing",
            project_type: "Roof Repair",
            project_subtype: "Roof Repair",
            suggested_workflow: "Repair + inspection",
            suggested_template_label: "Roof Repair Template",
            recommended_template_name: "Roof Repair Template",
            template_id: 101,
            template_name: "Roof Repair Template",
            payment_mode: "escrow",
            payment_structure: "progress",
          }
        : {};
      setupState.clarification_questions = familyKey
        ? [
            {
              key: "inspection_before_pricing",
              label: "Would you like the contractor to inspect before final pricing?",
              options: ["Yes", "No", "Not sure"],
              type: "select",
              input_type: "radio",
              help_text: "A roof inspection can help confirm the scope before final pricing.",
            },
          ]
        : [];
      setupState.summary = familyKey
        ? "Roofing repairs are clearer when the leak location and inspection needs are confirmed."
        : "Tell us what kind of work you do and we will build your default setup.";
      setupState.completed_at = payload.completed ? "2026-04-20T00:00:00Z" : null;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(setupState),
    });
  });
}

test("intelligent onboarding builds and saves a contractor setup", async ({ page }) => {
  await installOnboardingRoutes(page);

  await page.goto("/app/onboarding", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("contractor-onboarding-welcome")).toBeVisible({
    timeout: 15000,
  });

  await page.getByRole("button", { name: "Get started" }).click();
  await expect(page.getByTestId("contractor-onboarding-description")).toBeVisible();

  await page.getByPlaceholder("What kind of work do you usually do?").fill("Roofing and repairs");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByTestId("contractor-onboarding-clarifications")).toBeVisible();
  await page.getByRole("button", { name: "Yes" }).click();
  await page.getByRole("button", { name: "Build my setup" }).click();

  await expect(page.getByTestId("contractor-onboarding-generated-setup")).toBeVisible();
  await expect(page.getByTestId("contractor-onboarding-generated-setup")).toContainText("Roofing");

  const storedFamily = await page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem("mhb_project_family_context");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  expect(storedFamily).toEqual({
    project_family_key: "roofing",
    project_family_label: "Roofing",
  });

  await page.getByRole("button", { name: "Looks good" }).click();
  await expect(page.getByTestId("contractor-onboarding-first-project")).toBeVisible();

  await page.getByRole("button", { name: "Start project" }).click();
  await expect(page).toHaveURL(/\/app\/agreements\/new\/wizard\?step=1$/);

  const handoffState = await page.evaluate(() => {
    try {
      const raw = window.sessionStorage.getItem("mhb_first_project_assist_handoff");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  expect(handoffState?.assistantIntent).toBe("first_project_assist");
  expect(handoffState?.assistantDraftPayload?.project_family_key).toBe("roofing");
  expect(handoffState?.assistantDraftPayload?.project_family_label).toBe("Roofing");
  expect(handoffState?.assistantSuggestedMilestones?.length).toBeGreaterThan(0);
});

test("contractor onboarding trade picker supports search, chips, and removals", async ({ page }) => {
  await installOnboardingRoutes(page);

  await page.goto("/app/onboarding", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("contractor-onboarding-trades")).toBeVisible();
  await expect(page.getByTestId("contractor-onboarding-save-basics")).toBeDisabled();

  await page.getByRole("button", { name: "Electrical" }).first().click();
  await expect(page.getByTestId("contractor-onboarding-trade-chip-electrical")).toBeVisible();
  await expect(page.getByTestId("contractor-onboarding-save-basics")).toBeEnabled();

  await page.getByLabel("Search your trade").fill("tile");
  await expect(page.getByRole("button", { name: "Tile" })).toBeVisible();
  await page.getByRole("button", { name: "Tile" }).first().click();
  await expect(page.getByTestId("contractor-onboarding-trade-chip-tile")).toBeVisible();

  await page.getByRole("button", { name: "Tile" }).first().click();
  await expect(page.getByTestId("contractor-onboarding-trade-chip-tile")).toHaveCount(1);

  await page.getByRole("button", { name: "Remove Tile" }).click();
  await expect(page.getByTestId("contractor-onboarding-trade-chip-tile")).toHaveCount(0);

  await page.getByLabel("Search your trade").fill("zzzz-not-a-trade");
  await expect(page.getByText("No matching trade found. Try a broader term.")).toBeVisible();
});
