import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const commandCenter = {
  business_health: {
    overall: "Needs Attention",
    summary: "Needs Attention overall",
    dimensions: [
      { key: "financial", label: "Financial Health", status: "Needs Attention", detail: "Cash movement, held funds, and customer approvals." },
      { key: "operational", label: "Operational Health", status: "At Risk", detail: "Milestones, approvals, and active work." },
      { key: "customer", label: "Customer Health", status: "Needs Attention", detail: "Warranty and resolution pressure." },
      { key: "workforce", label: "Workforce Health", status: "Healthy", detail: "Team workload and capacity indicators." },
      { key: "growth", label: "Growth Health", status: "Healthy", detail: "Opportunities and estimate pipeline follow-up." },
    ],
    biggest_win: "Revenue is moving.",
    biggest_concern: "Overdue milestones",
    recommended_focus: "Late milestones can delay invoices, customer approvals, and schedules.",
  },
  needs_attention: [
    {
      key: "overdue_milestones",
      title: "Overdue milestones",
      count: 2,
      amount: "",
      severity: "high",
      why: "Late milestones can delay invoices, customer approvals, and schedules.",
      source_workspace: "Milestones",
      open_url: "/app/milestones",
      action_label: "Open",
    },
    {
      key: "pending_customer_approvals",
      title: "Pending customer approvals",
      count: 1,
      amount: "900.00",
      severity: "medium",
      why: "Customer approvals are the next step before money can be released.",
      source_workspace: "Payments",
      open_url: "/app/payments?money_status=payment_pending",
      action_label: "Open",
    },
  ],
  morning_brief: {
    yesterday: ["Completed 3 milestones."],
    today: ["2 milestones scheduled or due today.", "1 active estimate item."],
    upcoming: ["5 workforce items this week."],
    risks: ["Overdue milestones", "Pending customer approvals"],
    recommended_action: "Overdue milestones",
  },
  metrics: {
    revenue: { key: "revenue", label: "Revenue", value: "12800.00", kind: "money", detail: "Collected in selected range", href: "/app/business?view=reports-trends" },
    net_paid: { key: "net_paid", label: "Net Paid To You", value: "12160.00", kind: "money", detail: "Collected after platform fees", href: "/app/business?view=reports-trends" },
    pending_release: { key: "pending_release", label: "Money Waiting On Customer Approval", value: "900.00", kind: "money", detail: "Approved or ready but not released", href: "/app/payments?money_status=payment_pending" },
    held_funds: { key: "held_funds", label: "Money On Hold", value: "400.00", kind: "money", detail: "Disputed or paused for review", href: "/app/resolution" },
    outstanding_receivables: { key: "outstanding_receivables", label: "Money Customers Still Owe", value: "1700.00", kind: "money", detail: "Sent invoices and submitted draws", href: "/app/payments" },
    open_projects: { key: "open_projects", label: "Open Projects", value: 2, kind: "count", detail: "Active agreements not completed or cancelled", href: "/app/agreements" },
    open_opportunities: { key: "open_opportunities", label: "Open Opportunities", value: 4, kind: "count", detail: "Leads still in the opportunity pipeline", href: "/app/opportunities" },
    estimate_pipeline: { key: "estimate_pipeline", label: "Estimate Pipeline", value: 1, kind: "count", detail: "Active estimate workspaces", href: "/app/estimates" },
    warranty_requests: { key: "warranty_requests", label: "Warranty Requests", value: 1, kind: "count", detail: "Warranty items needing review", href: "/app/warranty" },
    resolution_cases: { key: "resolution_cases", label: "Resolution Cases", value: 1, kind: "count", detail: "Open resolution cases", href: "/app/resolution" },
    team_capacity: { key: "team_capacity", label: "Team Capacity", value: 0, kind: "count", detail: "Team members near capacity or overbooked", href: "/app/team" },
    customer_requests: { key: "customer_requests", label: "Customer Requests", value: 0, kind: "count", detail: "Stale opportunities that may need follow-up", href: "/app/opportunities" },
  },
  opportunity_forecast: {
    source_note: "Deterministic workflow state from opportunities, estimates, agreements, and collected payments.",
    sections: [
      { label: "Potential Revenue", value: "36000.00", href: "/app/opportunities" },
      { label: "Likely Revenue", value: "21600.00", href: "/app/estimates" },
      { label: "Committed Revenue", value: "18000.00", href: "/app/agreements" },
      { label: "Collected Revenue", value: "12800.00", href: "/app/business?view=reports-trends" },
    ],
  },
  operations_analyst: {
    role: "Operations Analyst",
    summary: "Needs Attention overall. Revenue is moving. Biggest concern: Overdue milestones.",
    why_this_matters: "These records show where cash, customers, and schedules may need attention before daily work starts.",
    confidence: "medium",
    recommendations: ["Late milestones can delay invoices, customer approvals, and schedules."],
    evidence: [
      { label: "Canonical metrics", type: "Insights", status: "Needs Attention", href: "/app/business" },
      { label: "Needs Attention queue", type: "Operational records", status: "2 items", href: "/app/business" },
    ],
  },
};

const summaryPayload = {
  command_center: commandCenter,
  snapshot: {
    jobs_completed: 4,
    active_jobs: 2,
    total_revenue: "12800.00",
    avg_revenue_per_job: "3200.00",
    avg_completion_days: "18.5",
    escrow_pending: "900.00",
    platform_fees_paid: "640.00",
    disputes_open: 1,
  },
  financial_summary: {
    gross_revenue_total: "12800.00",
    platform_fees_total: "640.00",
    net_paid_total: "12160.00",
    pending_release_total: "900.00",
    on_hold_total: "400.00",
    paid_events_count: 2,
    pending_release_count: 1,
    on_hold_count: 1,
  },
  business_performance: {
    funnel: {
      requests_received: 8,
      bids_submitted: 6,
      bids_awarded: 4,
      agreements_created: 3,
      paid_projects: 2,
    },
    conversion_rates: {
      request_to_bid_rate: "75.00",
      bid_to_award_rate: "66.67",
      award_to_paid_rate: "50.00",
    },
    revenue: {
      total_paid: "10000.00",
      total_pipeline_value: "18000.00",
      average_project_value: "6000.00",
    },
  },
  by_category: [],
  insights: [],
  payout_series: [],
  workflow_series: [{ bucket_start: "2026-03-10", bucket_label: "Mar 10-16", overdue_milestones: 2 }],
  fee_series: [],
  fee_projects: [],
  revenue_series: [{ bucket_start: "2026-03-10", bucket_label: "Mar 10-16", revenue: "12800.00" }],
  progress_summary: {},
  financial_series: [{ bucket_start: "2026-03-10", bucket_label: "Mar 10-16", gross_revenue: "12800.00", platform_fees: "640.00", net_paid: "12160.00" }],
  financial_insights: [],
  project_financials: [],
  recent_financial_events: [],
  contractor_insights: {
    available: true,
    available_families: [],
    summary_cards: [],
    comparison_rows: [],
    recommendations: [],
  },
};

async function installInsightsRoutes(page, summaryResponse = summaryPayload) {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  await page.route("**/api/projects/whoami/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: 7, type: "contractor", role: "contractor_owner", email: "playwright@myhomebro.local" }),
    });
  });

  await page.route("**/api/projects/contractors/me/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: 77, auto_subcontractor_payouts_enabled: true, ai: { access: "included", enabled: true } }),
    });
  });

  await page.route("**/api/projects/business/contractor/summary/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(summaryResponse) });
  });

  let goals = [];
  let preferences = {
    visible_widget_ids: ["business_snapshot", "goal_progress", "primary_trend", "needs_attention", "reports_handoff"],
    default_reporting_period: "30",
    available_widget_ids: ["business_snapshot", "goal_progress", "primary_trend", "needs_attention", "reports_handoff", "estimate_conversion"],
    default_widget_ids: ["business_snapshot", "goal_progress", "primary_trend", "needs_attention", "reports_handoff"],
    view_preferences: {
      scorecard: {
        visible_widget_ids: ["business_snapshot", "goal_progress", "primary_trend", "needs_attention", "reports_handoff"],
        default_reporting_period: "30",
      },
      executive: {
        visible_widget_ids: ["business_health", "executive_scorecard", "morning_brief", "business_alerts"],
        default_reporting_period: "30",
      },
      benchmarks: {
        visible_widget_ids: ["contractor_insights", "peer_comparisons", "category_performance", "recommendation_summary"],
        default_reporting_period: "90",
      },
      financial: {
        visible_widget_ids: ["financial_snapshot", "financial_trend", "payment_performance", "platform_fee_tracker"],
        default_reporting_period: "30",
      },
      operations: {
        visible_widget_ids: ["operations_health", "milestone_completion", "warranty_activity", "resolution_cases"],
        default_reporting_period: "30",
      },
      "reports-trends": {
        visible_widget_ids: ["report_controls", "charts", "metric_definitions", "category_reports"],
        default_reporting_period: "90",
      },
      payouts: {
        visible_widget_ids: ["payout_snapshot", "payout_activity", "export_center"],
        default_reporting_period: "30",
      },
    },
  };

  await page.route("**/api/projects/business/contractor/insights-goals/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const detailMatch = url.pathname.match(/\/api\/projects\/business\/contractor\/insights-goals\/(\d+)\/$/);
    if (method === "POST") {
      const payload = route.request().postDataJSON();
      const goal = {
        id: goals.length + 1,
        metric_type: payload.metric_type,
        metric_label: "Monthly Revenue",
        name: payload.name || "Monthly Revenue",
        target_value: Number(payload.target_value || 0).toFixed(2),
        deadline: payload.deadline || null,
        is_active: true,
      };
      goals = [goal, ...goals];
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(goal) });
      return;
    }
    if (method === "PATCH" && detailMatch) {
      const id = Number(detailMatch[1]);
      const payload = route.request().postDataJSON();
      goals = goals.map((goal) => goal.id === id ? { ...goal, ...payload } : goal);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(goals.find((goal) => goal.id === id)) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: goals }) });
  });

  await page.route("**/api/projects/business/contractor/insights-preferences/**", async (route) => {
    if (route.request().method() === "PATCH") {
      const payload = route.request().postDataJSON();
      const viewId = payload.view_id || "scorecard";
      preferences = {
        ...preferences,
        ...(viewId === "scorecard" ? {
          visible_widget_ids: payload.visible_widget_ids,
          default_reporting_period: payload.default_reporting_period,
        } : {}),
        view_preferences: {
          ...preferences.view_preferences,
          [viewId]: {
            ...(preferences.view_preferences[viewId] || {}),
            visible_widget_ids: payload.visible_widget_ids,
            default_reporting_period: payload.default_reporting_period,
          },
        },
      };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(preferences) });
  });

  await page.route("**/api/projects/payouts/history/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            id: 11,
            payout_id: 11,
            agreement_title: "Kitchen Remodel",
            milestone_title: "Cabinet Install",
            subcontractor_display_name: "Taylor Flooring",
            payout_status: "paid",
            payout_amount: "800.00",
          },
          {
            id: 12,
            payout_id: 12,
            agreement_title: "Hallway Flooring",
            milestone_title: "LVP Installation",
            subcontractor_display_name: "Austin Finish Crew",
            payout_status: "ready_for_payout",
            payout_amount: "450.00",
          },
        ],
        summary: {
          total_paid_amount: "800.00",
          total_ready_amount: "450.00",
          total_failed_amount: "0.00",
          total_pending_amount: "125.00",
          record_count: 2,
        },
      }),
    });
  });
}

test("Insights scorecard renders defaults, goals, customization, and reports handoff", async ({ page }) => {
  await installInsightsRoutes(page);

  await page.goto("/app/insights", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Insights", exact: true })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Insights dashboard views" })).toBeVisible();
  await expect(page.getByTestId("dashboard-view-selector-row")).not.toContainText("visible insights");
  await expect(page.getByTestId("dashboard-view-selector-row")).not.toContainText("How is my business doing right now?");
  await expect(page.getByTestId("dashboard-view-selector-scorecard")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("dashboard-view-selector-executive")).toHaveAttribute("aria-selected", "false");
  await expect(page.getByTestId("insights-active-view-heading")).toHaveText("Scorecard");
  await expect(page.getByTestId("insights-active-view-purpose")).toContainText("How is my business doing right now?");
  await expect(page.getByTestId("insights-customize-open")).toHaveAccessibleName("Customize Scorecard");
  await expect(page.getByTestId("insights-scorecard")).toBeVisible();
  await expect(page.getByTestId("insights-business-snapshot")).toContainText("Revenue");
  await expect(page.getByTestId("insights-business-snapshot")).toContainText("$12,800.00");
  await expect(page.getByTestId("insights-business-snapshot")).not.toContainText("Goal: Not set");
  await expect(page.getByTestId("insights-business-snapshot")).not.toContainText("--");
  await expect(page.getByTestId("insights-goal-progress")).toContainText("Goal tracking starts with your first goal");
  await expect(page.getByTestId("insights-goal-empty")).toBeVisible();
  await expect(page.getByTestId("insights-primary-trend")).toContainText("Performance Trend");
  await expect(page.getByTestId("insights-primary-trend")).toContainText("Your revenue trend is taking shape");
  await expect(page.getByTestId("insights-trend-education")).toBeVisible();
  await expect(page.getByTestId("insights-trend-full-chart")).toHaveCount(0);
  await expect(page.getByTestId("insights-needs-attention")).toContainText("Overdue milestones");
  await expect(page.getByTestId("insights-needs-attention")).toContainText("Pending customer approvals");
  await expect(page.getByTestId("insights-attention-row-overdue_milestones")).toBeVisible();
  await expect(page.getByTestId("insights-reports-handoff")).toContainText("Go to Reports & Trends");
  await expect(page.getByTestId("insights-operations-analyst")).toHaveCount(0);

  await page.getByTestId("insights-set-goal").click();
  await expect(page.getByTestId("insights-goal-editor")).toBeVisible();
  await page.getByPlaceholder("50000").fill("50000");
  await page.getByRole("button", { name: "Save Goal" }).click();
  await expect(page.getByTestId("insights-goal-progress")).toContainText("Monthly Revenue");
  await expect(page.getByTestId("insights-goal-progress")).toContainText("$12,800.00 of $50,000.00");

  await page.getByTestId("insights-customize-open").click();
  await expect(page.getByTestId("insights-customize-panel")).toContainText("Customize Scorecard");
  await expect(page.getByTestId("insights-customize-panel")).toContainText("Visible Insights");
  await expect(page.getByRole("button", { name: "Move Business Snapshot down" })).toBeVisible();
  await page.getByRole("button", { name: "Hide" }).first().click();
  await expect(page.getByTestId("insights-business-snapshot")).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("insights-business-snapshot")).toHaveCount(0);
  await page.getByTestId("insights-customize-open").click();
  await page.getByTestId("insights-restore-default").click();
  await expect(page.getByTestId("insights-business-snapshot")).toBeVisible();
  await page.getByTestId("insights-customize-panel").getByRole("button", { name: "Close" }).click();

  await page.getByTestId("insights-open-reports").click();
  await expect(page.getByTestId("dashboard-view-reports-trends")).toBeVisible();
  await expect(page.getByTestId("reports-categories")).toContainText("Report Categories");
  await expect(page.getByTestId("insights-scorecard")).toHaveCount(0);
});

test("Insights top-level views render independent dashboards", async ({ page }) => {
  await installInsightsRoutes(page);

  await page.goto("/app/insights", { waitUntil: "domcontentloaded" });
  await page.getByTestId("dashboard-view-selector-executive").click();
  await expect(page.getByTestId("dashboard-view-selector-executive")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("insights-active-view-heading")).toHaveText("Executive Overview");
  await expect(page.getByTestId("insights-business-health")).toContainText("Business Health");
  await expect(page.getByTestId("insights-business-health")).toContainText("Needs Attention");
  await expect(page.getByTestId("insights-business-health")).toContainText("Late milestones can delay invoices");
  await expect(page.getByTestId("insights-business-alerts")).toHaveCount(0);
  await expect(page.getByTestId("insights-needs-attention")).toHaveCount(0);
  await expect(page.getByTestId("insights-morning-brief")).toContainText("Morning Brief");
  await expect(page.getByTestId("insights-morning-brief")).toContainText("Overdue milestones");
  await expect(page.getByTestId("insights-morning-brief").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("insights-whats-working")).toContainText("Revenue is moving");
  await expect(page.getByTestId("insights-whats-working")).toContainText("Payments are settling");
  await expect(page.getByTestId("insights-top-priority")).toContainText("Overdue milestones");
  await expect(page.getByTestId("insights-top-priority").getByRole("link")).toHaveAttribute("href", "/app/milestones");
  await expect(page.getByTestId("insights-executive-synthesis")).toHaveCount(0);
  await expect(page.getByTestId("insights-canonical-metrics").locator('[data-testid^="insights-executive-metric-"]')).toHaveCount(4);
  await expect(page.getByTestId("insights-canonical-metrics")).toContainText("Contractor Earnings");
  await expect(page.getByTestId("insights-canonical-metrics")).not.toContainText("vs last month");
  await expect(page.getByTestId("insights-executive-workspace")).not.toContainText("Industry Benchmark");
  await expect(page.getByTestId("insights-opportunity-forecast")).toHaveCount(0);
  await expect(page.getByTestId("insights-operations-analyst")).toHaveCount(0);

  await page.getByTestId("dashboard-view-selector-benchmarks").click();
  await expect(page.getByTestId("dashboard-view-contractor-insights")).toBeVisible();
  await expect(page.getByTestId("dashboard-contractor-insights-section")).toContainText("Benchmark Overview");
  await expect(page.getByTestId("dashboard-contractor-insights-section")).toContainText("Performance vs. Peers");
  await expect(page.getByTestId("insights-benchmarks-low-data")).toContainText("More completed projects");
  await expect(page.getByTestId("insights-benchmarks-status-explanation")).toContainText("Preliminary");
  await expect(page.getByTestId("insights-business-health")).toHaveCount(0);
  await expect(page.getByTestId("insights-morning-brief")).toHaveCount(0);

  await page.getByTestId("dashboard-view-selector-financial").click();
  await expect(page.getByTestId("dashboard-view-financial")).toContainText("Financial Snapshot");
  await expect(page.getByTestId("dashboard-financial-section")).toContainText("Revenue Collected");
  await expect(page.getByTestId("dashboard-financial-section")).toContainText("Outstanding Invoices");
  await expect(page.getByTestId("dashboard-payment-pipeline")).toBeVisible();
  await expect(page.getByTestId("dashboard-recent-financial-activity")).toBeVisible();
  await expect(page.getByTestId("dashboard-financial-insights-section")).toBeVisible();
  await expect(page.getByTestId("insights-business-health")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-view-contractor-insights")).toHaveCount(0);

  await page.getByTestId("dashboard-view-selector-operations").click();
  await expect(page.getByTestId("insights-operations-waiting-queue")).toContainText("Waiting Queue");
  await expect(page.getByTestId("insights-operations-active-work")).toContainText("Active Work");
  await expect(page.getByTestId("insights-operations-active-unavailable")).toContainText("Project-level active work details are not available yet");
  await expect(page.getByTestId("insights-operations-active-work")).not.toContainText("caught up");
  await expect(page.getByTestId("insights-operations-schedule-health")).toContainText("Schedule Health");
  await expect(page.getByTestId("insights-operations-schedule-health")).toContainText("Behind");
  await expect(page.getByTestId("insights-operations-schedule-unavailable")).toContainText("Additional schedule detail unavailable");
  await expect(page.getByTestId("insights-operations-daily-focus")).toContainText("Daily Focus");
  await expect(page.getByTestId("insights-operations-daily-focus")).toContainText("Review Milestones");
  await expect(page.getByTestId("insights-operations-queue-reviews")).toContainText("Awaiting Review");
  await expect(page.getByTestId("insights-operations-queue-reviews")).toHaveAttribute("href", "/app/reviewer/queue");
  await expect(page.getByTestId("insights-operations-daily-focus")).toHaveCount(1);
  await expect(page.getByTestId("dashboard-operational-health-section")).toHaveCount(0);
  await expect(page.getByText("Approvals, disputes, active jobs")).toHaveCount(0);

  await page.getByTestId("dashboard-view-selector-reports-trends").click();
  await expect(page.getByTestId("reports-popular")).toContainText("Popular Reports");
  await expect(page.getByTestId("reports-shortcuts")).toBeVisible();
  await expect(page.getByTestId("reports-recent")).toContainText("No reports have been run yet");
  await expect(page.getByTestId("reports-trend-previews")).toBeVisible();
  await expect(page.getByTestId("run-report-revenue")).toBeVisible();
  await expect(page.getByTestId("dashboard-view-financial")).toHaveCount(0);

  await page.getByTestId("dashboard-view-selector-payouts").click();
  await expect(page.getByTestId("dashboard-view-payouts")).toContainText("Payouts");
  await expect(page.getByTestId("dashboard-report-controls")).toHaveCount(0);
});

test("Payouts and Exports view renders clean labels and available export actions", async ({ page }) => {
  await installInsightsRoutes(page);

  await page.goto("/app/insights", { waitUntil: "domcontentloaded" });
  await page.getByTestId("dashboard-view-selector-payouts").click();

  const payoutsView = page.getByTestId("dashboard-view-payouts");
  await expect(payoutsView).toContainText("Paid to Subcontractors");
  await expect(payoutsView).toContainText("Pending Payouts");
  await expect(payoutsView).toContainText("Payout Activity");
  await expect(payoutsView).toContainText("Kitchen Remodel");
  await expect(payoutsView).toContainText("Export Center");
  await expect(page.getByTestId("dashboard-payouts-export")).toContainText("Download CSV");
  await expect(page.getByTestId("dashboard-payouts-full-history")).toContainText("View Payout History");

  const visibleText = await payoutsView.innerText();
  expect(visibleText).not.toMatch(/Ã|Â|ï¿½|�|â|&[a-z]+;/i);
  await expect(page.getByTestId("dashboard-report-controls")).toHaveCount(0);
});

test("Insights customization persists per active view", async ({ page }) => {
  await installInsightsRoutes(page);

  await page.goto("/app/insights", { waitUntil: "domcontentloaded" });
  await page.getByTestId("dashboard-view-selector-financial").click();
  await expect(page.getByTestId("dashboard-financial-section")).toBeVisible();
  await page.getByTestId("insights-customize-open").click();
  await expect(page.getByTestId("insights-customize-panel")).toContainText("Customize Financial Performance");
  await expect(page.getByTestId("insights-customize-panel")).toContainText("Financial Snapshot");
  await page.getByRole("button", { name: "Hide" }).first().click();
  await page.getByTestId("insights-customize-panel").getByRole("button", { name: "Close" }).click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("dashboard-view-selector-financial").click();
  await expect(page.getByTestId("dashboard-financial-section")).toBeVisible();

  await page.getByTestId("dashboard-view-selector-scorecard").click();
  await expect(page.getByTestId("insights-business-snapshot")).toBeVisible();
});

test("Insights mobile layout avoids horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installInsightsRoutes(page);

  await page.goto("/app/insights", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("tablist", { name: "Insights dashboard views" })).toBeVisible();
  await expect(page.getByTestId("insights-business-snapshot")).toBeVisible();
  await page.getByTestId("insights-customize-open").click();
  await expect(page.getByTestId("insights-customize-panel")).toContainText("Customize Scorecard");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test("capture redesigned Insights workspaces", async ({ page }) => {
  test.setTimeout(180000);
  await installInsightsRoutes(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  const screenshotDir = path.resolve("../docs/audit-screenshots/insights-redesign");
  fs.mkdirSync(screenshotDir, { recursive: true });

  await page.goto("/app/insights", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Insights", exact: true })).toBeVisible();
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; }" });
  await page.evaluate(() => document.fonts.ready);

  const views = [
    ["scorecard", "insights-scorecard.png"],
    ["executive", "insights-executive.png"],
    ["benchmarks", "insights-benchmarks.png"],
    ["financial", "insights-financial.png"],
    ["operations", "insights-operations.png"],
    ["reports-trends", "insights-reports.png"],
    ["payouts", "insights-payouts.png"],
  ];

  for (const [view, filename] of views) {
    const tab = page.getByTestId(`dashboard-view-selector-${view}`);
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Insights", exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(screenshotDir, filename), fullPage: false });
  }

  await page.getByTestId("dashboard-view-selector-reports-trends").click();
  await expect(page.getByTestId("dashboard-view-selector-reports-trends")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("reports-trend-previews").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(screenshotDir, "insights-reports-bottom.png"), fullPage: false });
});

test("capture redesigned Scorecard workspace", async ({ page }) => {
  await installInsightsRoutes(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const screenshotDir = path.resolve("../docs/audit-screenshots/insights-redesign");
  fs.mkdirSync(screenshotDir, { recursive: true });

  await page.goto("/app/insights", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("dashboard-view-selector-scorecard")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("insights-scorecard")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; }" });
  await page.evaluate(() => {
    const main = document.querySelector("main");
    for (const element of [main, main?.parentElement, document.getElementById("root"), document.body, document.documentElement]) {
      if (!element) continue;
      element.style.setProperty("height", "auto", "important");
      element.style.setProperty("max-height", "none", "important");
      element.style.setProperty("overflow", "visible", "important");
    }
    for (const element of document.querySelectorAll("body *")) {
      const style = window.getComputedStyle(element);
      if (["auto", "scroll"].includes(style.overflowY) && element.scrollHeight > element.clientHeight) {
        element.style.setProperty("height", "auto", "important");
        element.style.setProperty("max-height", "none", "important");
        element.style.setProperty("overflow-y", "visible", "important");
      }
    }
  });
  await page.screenshot({ path: path.join(screenshotDir, "insights-scorecard-reference-implementation.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("insights-scorecard")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(screenshotDir, "insights-scorecard-reference-mobile.png"), fullPage: false });
});

test("capture Executive reference implementation", async ({ page }) => {
  await installInsightsRoutes(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const screenshotDir = path.resolve("../docs/audit-screenshots/insights-redesign");
  fs.mkdirSync(screenshotDir, { recursive: true });

  await page.goto("/app/insights", { waitUntil: "domcontentloaded" });
  await page.getByTestId("dashboard-view-selector-executive").click();
  await expect(page.getByTestId("dashboard-view-selector-executive")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("insights-executive-workspace")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; }" });
  await page.evaluate(() => {
    const main = document.querySelector("main");
    for (const element of [main, main?.parentElement, document.getElementById("root"), document.body, document.documentElement]) {
      if (!element) continue;
      element.style.setProperty("height", "auto", "important");
      element.style.setProperty("max-height", "none", "important");
      element.style.setProperty("overflow", "visible", "important");
    }
  });
  await page.screenshot({ path: path.join(screenshotDir, "insights-executive-reference-implementation.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("dashboard-view-selector-executive").click();
  await expect(page.getByTestId("insights-executive-workspace")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(screenshotDir, "insights-executive-reference-mobile.png"), fullPage: false });
});

test("capture Financial reference implementation", async ({ page }) => {
  await installInsightsRoutes(page);
  const screenshotDir = path.resolve("../docs/audit-screenshots/insights-redesign");
  fs.mkdirSync(screenshotDir, { recursive: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app/insights", { waitUntil: "domcontentloaded" });
  await page.getByTestId("dashboard-view-selector-financial").click();
  await expect(page.getByTestId("dashboard-view-selector-financial")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("dashboard-financial-section")).toContainText("Financial Snapshot");
  await expect(page.getByTestId("dashboard-financial-hero")).toBeVisible();
  await expect(page.getByTestId("dashboard-payment-pipeline")).toBeVisible();
  await expect(page.getByTestId("dashboard-financial-current-summary")).toContainText("One reporting period available");
  await expect(page.getByTestId("dashboard-recent-financial-activity")).toContainText("No completed payments yet");
  await expect(page.getByTestId("dashboard-financial-insights-section")).toBeVisible();
  await expect(page.getByTestId("dashboard-financial-reports-handoff")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(screenshotDir, "insights-financial-refined-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("dashboard-view-selector-financial").evaluate((element) => element.scrollIntoView({ block: "nearest", inline: "center" }));
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(screenshotDir, "insights-financial-refined-mobile.png"), fullPage: true });
});

test("capture Operations reference implementation", async ({ page }) => {
  await installInsightsRoutes(page);
  const screenshotDir = path.resolve("../docs/audit-screenshots/insights-redesign");
  fs.mkdirSync(screenshotDir, { recursive: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app/insights", { waitUntil: "domcontentloaded" });
  await page.getByTestId("dashboard-view-selector-operations").click();
  await expect(page.getByTestId("dashboard-view-selector-operations")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("insights-operations-waiting-queue")).toBeVisible();
  await expect(page.getByTestId("insights-operations-active-work")).toBeVisible();
  await expect(page.getByTestId("insights-operations-schedule-health")).toBeVisible();
  await expect(page.getByTestId("insights-operations-daily-focus")).toBeVisible();
  await expect(page.getByTestId("dashboard-operational-health-section")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-view-operations")).not.toContainText("Revenue Collected");
  await expect(page.getByTestId("dashboard-view-operations")).not.toContainText("Performance vs. Peers");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(screenshotDir, "insights-operations-refined-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("dashboard-view-selector-operations").evaluate((element) => element.scrollIntoView({ block: "nearest", inline: "center" }));
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(screenshotDir, "insights-operations-refined-mobile.png"), fullPage: true });
});

test("Operations distinguishes unavailable active-work data from an empty date range", async ({ page }) => {
  await installInsightsRoutes(page, { ...summaryPayload, active_work: [] });
  await page.goto("/app/insights", { waitUntil: "domcontentloaded" });
  await page.getByTestId("dashboard-view-selector-operations").click();
  await expect(page.getByTestId("insights-operations-active-no-match")).toContainText("No active project work matches this date range");
  await expect(page.getByTestId("insights-operations-active-unavailable")).toHaveCount(0);
});

test("capture Reports reference implementation", async ({ page }) => {
  await installInsightsRoutes(page);
  const screenshotDir = path.resolve("../docs/audit-screenshots/insights-redesign");
  fs.mkdirSync(screenshotDir, { recursive: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app/insights", { waitUntil: "domcontentloaded" });
  await page.getByTestId("dashboard-view-selector-reports-trends").click();
  await expect(page.getByTestId("dashboard-view-selector-reports-trends")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("reports-categories")).toBeVisible();
  await expect(page.getByTestId("reports-popular")).toBeVisible();
  await expect(page.getByTestId("reports-shortcuts")).toBeVisible();
  await expect(page.getByTestId("reports-recent")).toBeVisible();
  await expect(page.getByTestId("reports-trend-previews")).toBeVisible();
  await expect(page.getByTestId("dashboard-report-controls")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-charts-section")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(screenshotDir, "insights-reports-reference-implementation.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("dashboard-view-selector-reports-trends").evaluate((element) => element.scrollIntoView({ block: "nearest", inline: "center" }));
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(screenshotDir, "insights-reports-reference-mobile.png"), fullPage: true });
});
