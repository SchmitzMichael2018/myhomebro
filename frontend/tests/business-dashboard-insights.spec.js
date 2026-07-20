import { expect, test } from "@playwright/test";

test("business dashboard shows contractor insights panel with family filter and guidance", async ({ page }) => {
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
        created_at: "2026-03-01T10:00:00Z",
        auto_subcontractor_payouts_enabled: true,
        ai: {
          access: "included",
          enabled: true,
          unlimited: true,
        },
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
      sample_sizes: {
        platform: 82,
        regional: 14,
        contractor: 11,
      },
      summary_cards: [
        {
          key: "pricing",
          label: "Pricing Position",
          headline: "You typically price above market",
          support: "Your completed projects in this category trend slightly above similar jobs in your area.",
          badge: "Benchmark",
          confidence: "Moderate confidence",
        },
        {
          key: "pace",
          label: "Project Pace",
          headline: "Your timelines are competitive",
          support: "Projects like this usually finish a bit faster than the local benchmark.",
          badge: "Timing",
          confidence: "Moderate confidence",
        },
        {
          key: "milestones",
          label: "Milestone Style",
          headline: "You use detailed milestone plans",
          support: "Your agreements tend to break work into more milestones than similar projects.",
          badge: "Structure",
          confidence: "Moderate confidence",
        },
        {
          key: "reliability",
          label: "Reliability Signals",
          headline: "Your project changes stay low",
          support: "Completed jobs in this category show fewer amendments than typical benchmarks.",
          badge: "Quality",
          confidence: "Moderate confidence",
        },
      ],
      comparison_rows: [
        {
          key: "pricing",
          label: "Pricing vs benchmark",
          comparison: "8.5% above similar projects.",
          meter: 68,
          confidence: "Moderate confidence",
        },
        {
          key: "pace",
          label: "Project pace vs benchmark",
          comparison: "Timelines are a little longer than similar jobs.",
          meter: 58,
          confidence: "Moderate confidence",
        },
        {
          key: "structure",
          label: "Milestone count vs peers",
          comparison: "Your agreements use more milestones than similar projects.",
          meter: 70,
          confidence: "Moderate confidence",
        },
        {
          key: "reliability",
          label: "Reliability signals",
          comparison: "Your change patterns are slightly better than the benchmark.",
          meter: 42,
          confidence: "Moderate confidence",
        },
      ],
      recommendations: [
        "You may want to review pricing for this type of project to stay competitive.",
        "Projects like this typically complete faster. Consider tightening your timeline if the scope is straightforward.",
        "Adding more milestones may improve clarity and payment flow.",
      ],
      explanations: [],
    },
    by_category: [],
    insights: [
      {
        category: "review_bottleneck",
        title: "Awaiting review",
        explanation: "3 milestones are waiting for contractor review, which may delay invoicing.",
        severity: "high",
        action_label: "View Review Queue",
        action_href: "/app/reviewer/queue",
      },
    ],
    payout_series: [],
    workflow_series: [],
    fee_series: [],
    fee_projects: [],
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
      summary_cards: [
        {
          key: "pricing",
          label: "Pricing Position",
          headline: "Roofing work in your market is priced competitively",
          support: "Roofing projects in this view sit close to the local benchmark.",
          badge: "Benchmark",
          confidence: "Moderate confidence",
        },
        {
          key: "pace",
          label: "Project Pace",
          headline: "Your roofing timelines are steady",
          support: "Roofing jobs in this scope finish in a predictable window.",
          badge: "Timing",
          confidence: "Moderate confidence",
        },
        {
          key: "milestones",
          label: "Milestone Style",
          headline: "Roofing milestones stay practical",
          support: "This family uses a focused milestone structure for fewer handoffs.",
          badge: "Structure",
          confidence: "Moderate confidence",
        },
        {
          key: "reliability",
          label: "Reliability Signals",
          headline: "Roofing changes stay manageable",
          support: "Completed roofing jobs show stable change patterns.",
          badge: "Quality",
          confidence: "Moderate confidence",
        },
      ],
      recommendations: [
        "Roofing projects often benefit from keeping the inspection step clear in the plan.",
      ],
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

  await page.goto("/app/business", { waitUntil: "domcontentloaded" });
  await page.getByTestId("dashboard-view-selector-benchmarks").click();

  await expect(page.getByTestId("dashboard-contractor-insights-section")).toBeVisible();
  await expect(page.getByTestId("dashboard-contractor-insights-section")).toContainText("Contractor Insights");
  await expect(page.getByTestId("dashboard-contractor-insights-section")).toContainText("Helpful benchmarks based on similar projects, your market, and your past work.");
  await expect(page.getByTestId("dashboard-contractor-insights-summary-pricing")).toContainText("Pricing Position");
  await expect(page.getByTestId("dashboard-contractor-insights-summary-pace")).toContainText("Project Pace");
  await expect(page.getByTestId("dashboard-contractor-insights-summary-milestones")).toContainText("Milestone Style");
  await expect(page.getByTestId("dashboard-contractor-insights-summary-reliability")).toContainText("Reliability Signals");
  await expect(page.getByTestId("dashboard-contractor-insights-standings")).toContainText("Where you stand");
  await expect(page.getByTestId("dashboard-contractor-insights-row-pricing")).toContainText("Pricing vs benchmark");
  await expect(page.getByTestId("dashboard-contractor-insights-row-pace")).toContainText("Project pace vs benchmark");
  await expect(page.getByTestId("dashboard-contractor-insights-row-structure")).toContainText("Milestone count vs peers");
  await expect(page.getByTestId("dashboard-contractor-insights-row-reliability")).toContainText("Reliability signals");
  await expect(page.getByTestId("dashboard-contractor-insights-recommendations")).toContainText("Recommended adjustments");
  await expect(page.getByTestId("dashboard-contractor-insights-recommendations")).toContainText("You may want to review pricing for this type of project to stay competitive.");
  await expect(page.getByTestId("dashboard-contractor-insights-family-filter")).toBeVisible();

  await page.getByTestId("dashboard-contractor-insights-family-filter").selectOption("roofing");
  await expect(page.getByTestId("dashboard-contractor-insights-scope-notice")).toContainText("roofing-specific insights");
  await expect(page.getByTestId("dashboard-contractor-insights-summary-pricing")).toContainText("Roofing work in your market is priced competitively");
  await expect(page.getByTestId("dashboard-contractor-insights-section")).toContainText("Roofing");
});
