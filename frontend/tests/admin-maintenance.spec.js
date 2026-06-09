import { expect, test } from "@playwright/test";

const maintenancePayload = {
  generated_at: "2026-06-09T12:00:00Z",
  kpis: {
    active_contracts: 4,
    inactive_contracts: 1,
    contracts_expiring_soon: 2,
    upcoming_work_orders: 3,
    due_this_week: 2,
    overdue_work_orders: 1,
    completed_this_month: 5,
    properties_with_active_plans: 3,
    properties_needing_attention: 2,
    high_priority_property_items: 1,
  },
  queues: {
    upcoming: [
      {
        id: 101,
        title: "Quarterly HVAC service",
        service_type: "HVAC service",
        description: "Inspect filters and airflow.",
        status: "scheduled",
        status_label: "Scheduled",
        scheduled_date: "2026-06-12",
        property: "Primary Home",
        property_id: 1,
        customer: "Pat Customer",
        customer_email: "customer@example.com",
        contractor: "Builder Co",
        contractor_id: 7,
        agreement: "HVAC Maintenance",
        agreement_id: 44,
        work_order_url: "/app/admin/maintenance?work_order=101",
        property_url: "/app/admin/maintenance?property=1",
        agreement_url: "/app/admin/agreements/44",
        contractor_url: "/app/admin/contractors?contractor=7",
      },
    ],
    overdue: [
      {
        id: 102,
        title: "Past due filter service",
        service_type: "Filter service",
        status: "scheduled",
        status_label: "Scheduled",
        scheduled_date: "2026-06-01",
        days_overdue: 8,
        property: "Lake House",
        property_id: 2,
        customer: "Pat Customer",
        customer_email: "customer@example.com",
        contractor: "Builder Co",
        contractor_id: 7,
        agreement: "Filter Maintenance",
        agreement_id: 45,
        work_order_url: "/app/admin/maintenance?work_order=102",
        property_url: "/app/admin/maintenance?property=2",
        agreement_url: "/app/admin/agreements/45",
        contractor_url: "/app/admin/contractors?contractor=7",
      },
    ],
    recently_completed: [
      {
        id: 103,
        title: "Completed maintenance visit",
        status: "completed",
        status_label: "Completed",
        scheduled_date: "2026-06-04",
        completed_at: "2026-06-04T15:00:00Z",
        property: "Primary Home",
        customer: "Pat Customer",
        contractor: "Builder Co",
        agreement_url: "/app/admin/agreements/44",
      },
    ],
    renewals: [
      {
        id: 44,
        title: "HVAC Maintenance",
        status: "active",
        contractor: "Builder Co",
        customer: "Pat Customer",
        recurrence_pattern: "quarterly",
        recurrence_end_date: "2026-07-01",
        next_occurrence_date: "2026-06-12",
        expires_in_days: 22,
        agreement_url: "/app/admin/agreements/44",
      },
    ],
    property_attention: [
      {
        property_id: 1,
        property: "Primary Home",
        customer_email: "customer@example.com",
        health_status: "needs_attention",
        health_label: "Needs Attention",
        health_score: 64,
        confidence: "medium",
        insight_count: 3,
        property_url: "/app/admin/maintenance?property=1",
        priority_insights: [
          { id: "maintenance-hvac-service-due", title: "HVAC service may be due." },
        ],
      },
    ],
    contractor_performance: [
      {
        contractor_id: 7,
        contractor: "Builder Co",
        completed: 5,
        on_time: 4,
        overdue: 1,
        on_time_rate: 80,
        contractor_url: "/app/admin/contractors?contractor=7",
      },
    ],
  },
  audit: {
    available_metrics: ["contract counts", "work order status counts", "property intelligence health"],
    available_statuses: ["scheduled", "in_progress", "completed", "cancelled"],
    available_dates: ["recurrence_end_date", "scheduled_date", "completed_at"],
    ownership_fields: ["maintenance_agreement", "contractor", "homeowner", "property_profile"],
  },
};

async function mockAdmin(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });
  await page.route("**/api/projects/whoami/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: 1, type: "admin", role: "admin", email: "admin@example.com" }),
    });
  });
  await page.route("**/api/projects/admin/maintenance/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(maintenancePayload),
    });
  });
}

test("admin maintenance operations dashboard renders metrics, queues, and actions", async ({ page }) => {
  await mockAdmin(page);

  await page.goto("/app/admin/maintenance", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("admin-maintenance-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Maintenance Operations" })).toBeVisible();
  await expect(page.getByTestId("admin-maintenance-kpis")).toContainText("Active Contracts");
  await expect(page.getByTestId("admin-maintenance-kpi-active-contracts")).toContainText("4");
  await expect(page.getByTestId("admin-maintenance-kpi-expiring")).toContainText("2");
  await expect(page.getByTestId("admin-maintenance-kpi-overdue")).toContainText("1");

  await expect(page.getByTestId("admin-maintenance-upcoming-queue")).toContainText("Quarterly HVAC service");
  await expect(page.getByTestId("admin-maintenance-overdue-queue")).toContainText("Past due filter service");
  await expect(page.getByTestId("admin-maintenance-overdue-queue")).toContainText("8 day(s) overdue");
  await expect(page.getByTestId("admin-maintenance-completed-queue")).toContainText("Completed maintenance visit");
  await expect(page.getByTestId("admin-maintenance-renewal-queue")).toContainText("HVAC Maintenance");
  await expect(page.getByTestId("admin-maintenance-property-intelligence")).toContainText("HVAC service may be due.");
  await expect(page.getByTestId("admin-maintenance-contractor-performance")).toContainText("80%");
  await expect(page.getByTestId("admin-maintenance-audit")).toContainText("property_profile");
  await expect(page.getByTestId("admin-maintenance-work-order-101").getByRole("link", { name: /Open agreement/ })).toHaveAttribute("href", /\/app\/admin\/agreements\/44$/);
});

