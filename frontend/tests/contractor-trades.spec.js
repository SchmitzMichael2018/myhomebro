import { expect, test } from "@playwright/test";

function normalizeSkills(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  const result = [];
  for (const item of list) {
    const text = String(item || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function extractMultipartField(body, fieldName) {
  if (!body) return null;
  const pattern = new RegExp(`name="${fieldName}"\\r?\\n\\r?\\n([\\s\\S]*?)(?=\\r?\\n--|$)`, "i");
  const match = String(body).match(pattern);
  return match ? match[1].trim() : null;
}

function extractMultipartSkills(body) {
  const fromJson = extractMultipartField(body, "skills_json");
  if (fromJson) {
    try {
      const parsed = JSON.parse(fromJson);
      if (Array.isArray(parsed)) return normalizeSkills(parsed);
    } catch {
      // fall through
    }
  }

  const skills = [];
  const pattern = /name="skills"\r?\n\r?\n([\s\S]*?)(?=\r?\n--|$)/gi;
  let match;
  while ((match = pattern.exec(String(body || "")))) {
    skills.push(String(match[1] || "").trim());
  }
  return normalizeSkills(skills);
}

async function installTradeRoutes(page, { meSkills = ["HVAC", "Electrical"], onboardingStep = "welcome" } = {}) {
  const state = {
    me: {
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
      skills: normalizeSkills(meSkills),
      compliance_records: [],
      compliance_trade_requirements: [],
      insurance_status: {
        has_insurance: false,
        status: "missing",
      },
      ai: {
        access: "included",
        enabled: true,
        unlimited: true,
      },
    },
    onboarding: {
      status: onboardingStep === "stripe" ? "in_progress" : "not_started",
      step: onboardingStep,
      profile_basics_complete: true,
      first_value_reached: false,
      stripe_ready: false,
      stripe_onboarding_status: onboardingStep === "stripe" ? "in_progress" : "not_started",
      show_soft_stripe_prompt: false,
      first_project_started_at: null,
      first_agreement_created_at: null,
      stripe_prompt_dismissed_at: null,
      stripe_connected_at: null,
      step_number: onboardingStep === "stripe" ? 3 : 1,
      step_total: 3,
      service_region_label: "Austin, TX",
      service_radius_miles: 25,
      trade_count: normalizeSkills(meSkills).length,
      activation: {
        last_step_reached: onboardingStep,
        time_spent_per_step: {},
      },
    },
    dismissCalls: 0,
    profilePatchPayloads: [],
    onboardingPatchPayloads: [],
  };

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
        onboarding_status: onboardingStep === "stripe" ? "in_progress" : "not_started",
        stripe_onboarding_status: onboardingStep === "stripe" ? "in_progress" : "not_started",
        connected: false,
        account_id: "acct_test_123",
        resume_url: "/app/onboarding/stripe",
      }),
    });
  });

  await page.route("**/api/projects/contractors/me/**", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postData();
      const payload = {
        business_name: extractMultipartField(body, "business_name") || state.me.business_name,
        city: extractMultipartField(body, "city") || state.me.city,
        state: extractMultipartField(body, "state") || state.me.state,
        zip: extractMultipartField(body, "zip") || state.me.zip,
        skills: extractMultipartSkills(body),
      };
      state.profilePatchPayloads.push(payload);
      state.me = {
        ...state.me,
        business_name: payload.business_name || state.me.business_name,
        city: payload.city || state.me.city,
        state: payload.state || state.me.state,
        zip: payload.zip || state.me.zip,
        skills: normalizeSkills(payload.skills || []),
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(state.me),
    });
  });

  await page.route("**/api/projects/contractors/onboarding/**", async (route) => {
    const requestUrl = route.request().url();
    if (requestUrl.includes("/dismiss-stripe-prompt/")) {
      state.dismissCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...state.onboarding,
          stripe_prompt_dismissed_at: "2026-05-09T00:00:00Z",
        }),
      });
      return;
    }

    if (route.request().method() === "PATCH") {
      const payload = route.request().postDataJSON();
      state.onboardingPatchPayloads.push(payload);
      state.me = {
        ...state.me,
        business_name: payload.business_name || state.me.business_name,
        city: payload.city || state.me.city,
        state: payload.state || state.me.state,
        zip: payload.zip || state.me.zip,
        skills: normalizeSkills(payload.skills || state.me.skills),
      };
      state.onboarding = {
        ...state.onboarding,
        status: payload.contractor_onboarding_step === "stripe" ? "in_progress" : state.onboarding.status,
        step: payload.contractor_onboarding_step || state.onboarding.step,
        trade_count: state.me.skills.length,
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(state.onboarding),
    });
  });

  await page.route("**/api/projects/compliance/profile-preview/", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state_code: body?.state || "TX",
        trade_requirements: Array.isArray(body?.skills) && body.skills.includes("Electrical")
          ? [
              {
                required: true,
                insurance_required: true,
                message: "Electrical work in Texas typically requires a state license.",
                issuing_authority_name: "Texas Department of Licensing and Regulation",
                official_lookup_url: "https://www.tdlr.texas.gov/electricians/",
                contractor_has_license_on_file: false,
                contractor_license_status: "missing",
                contractor_has_insurance_on_file: false,
                warning_level: "warning",
                source_type: "portal",
                state_code: "TX",
                trade_key: "electrical",
              },
            ]
          : [],
      }),
    });
  });

  return state;
}

test("profile uses the shared trade multiselect and saves canonical trades", async ({ page }) => {
  const state = await installTradeRoutes(page, { meSkills: ["HVAC", "Electrical"] });

  await page.goto("/app/profile", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("contractor-profile-trade-chip-hvac")).toBeVisible();
  await expect(page.getByTestId("contractor-profile-trade-chip-electrical")).toBeVisible();

  await page.getByTestId("contractor-profile-trade-search").fill("roof");
  await page.getByTestId("contractor-profile-trade-option-roofing").click();
  await expect(page.getByTestId("contractor-profile-trade-chip-roofing")).toBeVisible();

  await page.getByRole("button", { name: "Remove HVAC" }).click();
  await expect(page.getByTestId("contractor-profile-trade-chip-hvac")).toHaveCount(0);

  await page.getByRole("button", { name: "Save Profile" }).click();

  await expect.poll(() => state.profilePatchPayloads.length).toBe(1);
  expect(state.profilePatchPayloads[0].skills).toEqual(["Electrical", "Roofing"]);

  await page.goto("/onboarding", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("contractor-onboarding-trade-chip-roofing")).toBeVisible();
  await expect(page.getByTestId("contractor-onboarding-trade-chip-electrical")).toBeVisible();
});

test("stripe onboarding preloads saved trades and preserves them on save", async ({ page }) => {
  const state = await installTradeRoutes(page, { meSkills: ["HVAC", "Electrical"], onboardingStep: "welcome" });

  await page.goto("/onboarding", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("contractor-onboarding-trade-search")).toBeVisible();
  await expect(page.getByTestId("contractor-onboarding-trade-chip-hvac")).toBeVisible();
  await expect(page.getByTestId("contractor-onboarding-trade-chip-electrical")).toBeVisible();

  await page.getByTestId("contractor-onboarding-trade-search").fill("roof");
  await page.getByTestId("contractor-onboarding-trade-option-roofing").click();
  await expect(page.getByTestId("contractor-onboarding-trade-chip-roofing")).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();

  await expect.poll(() => state.onboardingPatchPayloads.length).toBe(1);
  expect(state.onboardingPatchPayloads[0].skills).toEqual(["HVAC", "Electrical", "Roofing"]);
});

test("stripe onboarding can be skipped without blocking account creation", async ({ page }) => {
  await installTradeRoutes(page, { meSkills: ["HVAC"], onboardingStep: "stripe" });

  await page.goto("/onboarding", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Skip for now" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();

  await expect(page).toHaveURL(/\/app\/dashboard$/);
});
