import { expect, test } from "@playwright/test";

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

async function installInsightsRoutes(page) {
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
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(summaryPayload) });
  });

  await page.route("**/api/projects/payouts/history/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [], summary: {} }) });
  });
}

test("Insights command center renders business health, attention, brief, metrics, forecast, and analyst", async ({ page }) => {
  await installInsightsRoutes(page);

  await page.goto("/app/insights", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
  await expect(page.getByTestId("insights-business-health")).toContainText("Business Health");
  await expect(page.getByTestId("insights-business-health")).toContainText("Needs Attention overall");
  await expect(page.getByTestId("insights-needs-attention")).toContainText("Overdue milestones");
  await expect(page.getByTestId("insights-needs-attention")).toContainText("Pending customer approvals");
  await expect(page.getByTestId("insights-morning-brief")).toContainText("Morning Brief");
  await expect(page.getByTestId("insights-morning-brief")).toContainText("Completed 3 milestones.");
  await expect(page.getByTestId("insights-canonical-metrics")).toContainText("Money Waiting On Customer Approval");
  await expect(page.getByTestId("insights-canonical-metrics")).toContainText("Money Customers Still Owe");
  await expect(page.getByTestId("insights-opportunity-forecast")).toContainText("Potential Revenue");
  await expect(page.getByTestId("insights-opportunity-forecast")).toContainText("$36,000.00");
  await expect(page.getByTestId("insights-operations-analyst")).toContainText("Operations Analyst");
  await expect(page.getByTestId("project-assistant-human-approval")).toContainText("cannot release money");
  await expect(page.getByTestId("dashboard-kpi-strip")).toBeVisible();
});
