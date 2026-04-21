import { expect, test } from "@playwright/test";

const AGREEMENT_ID = 912;

async function installAuthAndDashboardRoutes(page) {
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
        ai: { access: "included", enabled: true, unlimited: true },
      }),
    });
  });

  const allProjectsPayload = {
    snapshot: {
      jobs_completed: 6,
      active_jobs: 3,
      total_revenue: "24500.00",
      avg_revenue_per_job: "4083.33",
      avg_completion_days: "17.8",
      escrow_pending: "1200.00",
      platform_fees_paid: "980.00",
      disputes_open: 1,
    },
    business_performance: {
      funnel: {
        requests_received: 12,
        bids_submitted: 9,
        bids_awarded: 6,
        agreements_created: 4,
        paid_projects: 3,
      },
      conversion_rates: {
        request_to_bid_rate: "75.00",
        bid_to_award_rate: "66.67",
        award_to_paid_rate: "50.00",
      },
      revenue: {
        total_paid: "21000.00",
        total_pipeline_value: "36000.00",
        average_project_value: "6000.00",
      },
    },
    contractor_insights: {
      available: true,
      project_family_key: "kitchen_remodel",
      project_family_label: "Kitchen Remodel",
      selected_family_key: "all",
      selected_family_label: "All Projects",
      effective_family_key: "kitchen_remodel",
      effective_family_label: "Kitchen Remodel",
      scope_mode: "all_projects",
      scope_label: "All Projects",
      scope_notice: "",
      available_families: [
        { key: "all", label: "All Projects", count: 12 },
        { key: "kitchen_remodel", label: "Kitchen Remodel", count: 8 },
        { key: "roofing", label: "Roofing", count: 4 },
      ],
      source_type: "blended_all",
      source_label: "Based on similar projects on MyHomeBro, your market, and your past work.",
      confidence: "medium",
      sample_sizes: { platform: 82, regional: 14, contractor: 11 },
      summary_cards: [],
      comparison_rows: [],
      recommendations: ["You may want to review pricing for this type of project to stay competitive."],
      explanations: [],
    },
    by_category: [],
    insights: [],
    payout_series: [],
    workflow_series: [],
    fee_series: [],
    revenue_series: [],
    progress_summary: {},
  };

  const roofingPayload = {
    ...allProjectsPayload,
    contractor_insights: {
      ...allProjectsPayload.contractor_insights,
      selected_family_key: "roofing",
      selected_family_label: "Roofing",
      effective_family_key: "roofing",
      effective_family_label: "Roofing",
      scope_mode: "family",
      scope_label: "Roofing",
      scope_notice: "Showing roofing-specific insights based on the selected project family.",
      recommendations: ["Roofing projects often benefit from keeping the inspection step clear in the plan."],
    },
  };

  await page.route("**/api/projects/business/contractor/summary/**", async (route) => {
    const url = new URL(route.request().url());
    const familyKey = url.searchParams.get("project_family_key") || "all";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(familyKey === "roofing" ? roofingPayload : allProjectsPayload),
    });
  });

  await page.route("**/api/projects/payouts/history/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [], summary: {} }),
    });
  });
}

async function installWizardRoutes(page) {
  await page.route("**/api/payments/onboarding/status/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        onboarding_status: "complete",
        connected: true,
      }),
    });
  });

  await page.route("**/api/projects/project-types/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          { id: 1, value: "Roofing", label: "Roofing", owner_type: "system" },
          { id: 2, value: "Remodel", label: "Remodel", owner_type: "system" },
        ],
      }),
    });
  });

  await page.route("**/api/projects/project-subtypes/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          { id: 11, value: "Roof Replacement", label: "Roof Replacement", owner_type: "system" },
          { id: 12, value: "Shingle Repair", label: "Shingle Repair", owner_type: "system" },
        ],
      }),
    });
  });

  await page.route("**/api/projects/homeowners**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{ id: 1, company_name: "Demo Customer", full_name: "Jordan Demo" }],
      }),
    });
  });

  await page.route("**/api/projects/templates/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/recommend/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          confidence_level: "high",
          score: 92,
          reason: "Roofing family match for the selected project context.",
          recommended_template: {
            id: 101,
            name: "Roofing Starter",
            project_type: "Roofing",
            project_subtype: "Roof Repair",
          },
          candidates: [
            {
              id: 101,
              name: "Roofing Starter",
              project_type: "Roofing",
              project_subtype: "Roof Repair",
              description: "A family-aligned roofing template.",
            },
            {
              id: 202,
              name: "General Starter",
              project_type: "General",
              project_subtype: "General",
              description: "A generic fallback template.",
            },
          ],
        }),
      });
      return;
    }
    const detailMatch = url.pathname.match(/\/api\/projects\/templates\/(\d+)\/?$/);
    if (detailMatch) {
      const id = Number(detailMatch[1]);
      const detail =
        id === 101
          ? {
              id: 101,
              name: "Roofing Starter",
              project_type: "Roofing",
              project_subtype: "Roof Repair",
              description: "A family-aligned roofing template.",
              milestone_count: 4,
              milestones: [],
              estimated_days: 5,
            }
          : {
              id: 202,
              name: "General Starter",
              project_type: "General",
              project_subtype: "General",
              description: "A generic fallback template.",
              milestone_count: 3,
              milestones: [],
              estimated_days: 3,
            };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(detail),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            id: 101,
            name: "Roofing Starter",
            project_type: "Roofing",
            project_subtype: "Roof Repair",
            description: "A family-aligned roofing template.",
            milestone_count: 4,
          },
          {
            id: 202,
            name: "General Starter",
            project_type: "General",
            project_subtype: "General",
            description: "A generic fallback template.",
            milestone_count: 3,
          },
        ],
      }),
    });
  });

  const agreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: "Roofing Agreement",
    title: "Roofing Agreement",
    description: "Replace damaged roof sections and complete cleanup.",
    total_cost: "18000.00",
    project_type: "",
    project_subtype: "",
    project_family_key: "",
    project_family_label: "",
    project_class: "residential",
    homeowner: 1,
    selected_template_id: null,
    status: "draft",
    ai_scope: {
      answers: {},
      questions: [],
    },
  };

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`), async (route) => {
    const request = route.request();
    if (request.method() === "PATCH") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(agreement),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(agreement),
    });
  });

  await page.route(/\/api\/projects\/milestones\/\?agreement=912.*/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            id: 3001,
            agreement: AGREEMENT_ID,
            order: 1,
            title: "Inspection & prep",
            description: "Inspect the roof and prep the work area.",
            amount: "6000.00",
            start_date: "2026-04-01",
            completion_date: "2026-04-03",
          },
        ],
      }),
    });
  });

  await page.route("**/api/projects/agreements/912/estimate-preview/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        suggested_total_price: "18000.00",
        suggested_price_low: "16000.00",
        suggested_price_high: "20000.00",
        suggested_duration_days: 6,
        milestone_suggestions: [
          {
            milestone_id: 3001,
            title: "Inspection & prep",
            suggested_amount: "6000.00",
            suggested_order: 1,
            source: "existing_milestone",
          },
        ],
        suggested_plan: {
          project_family_key: "roofing",
          project_family_label: "Roofing",
          project_scope_summary: "Replace damaged roof sections and complete cleanup.",
          recommended_project_type: "Roofing",
          recommended_project_subtype: "Roof Replacement",
        },
      }),
    });
  });
}

test("dashboard family selection persists into the agreement wizard and AI context", async ({ page }) => {
  await installAuthAndDashboardRoutes(page);
  await installWizardRoutes(page);

  await page.goto("/app/business", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("dashboard-contractor-insights-section")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByTestId("dashboard-contractor-insights-family-filter")).toBeVisible({
    timeout: 15000,
  });
  await page.getByTestId("dashboard-contractor-insights-family-filter").selectOption("roofing");
  await expect(page.getByTestId("dashboard-contractor-insights-scope-notice")).toContainText(
    "roofing-specific insights"
  );

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

  await page.evaluate((agreementId) => {
    try {
      window.sessionStorage.setItem(`mhb_step1_cache_${agreementId}_start_mode`, "template");
      window.sessionStorage.setItem(`mhb_step1_cache_${agreementId}_start_mode_committed`, "1");
      window.sessionStorage.setItem(`mhb_step1_cache_${agreementId}_start_mode_source`, "session");
    } catch {
      // ignore
    }
  }, AGREEMENT_ID);

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=1`, { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("proposal-project-family-cue")).toContainText("Roofing");
  await expect(page.getByTestId("step1-template-browser")).toBeVisible();
  const templateSearchInput = page.getByPlaceholder(
    'Search templates by keyword, like "bathroom", "deck", or "bedroom addition"...'
  );
  await templateSearchInput.click();
  await templateSearchInput.fill("roof");
  await expect(page.getByTestId("template-search-result-101")).toBeVisible();
  await expect(page.getByTestId("template-search-result-202")).toHaveCount(0);
  await expect(page.getByTestId("template-search-result-101")).toContainText("Roofing Starter");

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("step2-suggested-plan-card")).toBeVisible();
  await expect(page.getByTestId("step2-suggested-plan-card")).toContainText("Roofing");

  await page.getByTestId("milestones-ai-entry-toggle").click();
  await expect(page.getByTestId("start-with-ai-status-summary")).toContainText("Roofing");
});
