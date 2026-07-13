import { expect, test } from "@playwright/test";

const whoami = {
  user_id: 7,
  email: "owner@example.com",
  type: "contractor",
  role: "contractor_owner",
  identity_type: "contractor_owner",
  review_queue_count: 1,
  attention_counts: {
    awaiting_review_count: 1,
    submitted_for_review_count: 1,
    unassigned_assignment_count: 1,
    assigned_work_count: 3,
    active_subcontractor_count: 2,
  },
};

const subaccounts = [
  {
    id: 1,
    display_name: "Taylor Crew",
    email: "taylor@example.com",
    role: "employee_supervisor",
    role_label: "Supervisor / Foreman",
    is_active: true,
    active_assignment_count: 4,
    pending_review_count: 1,
    last_activity_at: "2026-12-28T12:00:00Z",
  },
  {
    id: 2,
    display_name: "Jordan Crew",
    email: "jordan@example.com",
    role: "employee_milestones",
    role_label: "Milestones employee",
    is_active: true,
    active_assignment_count: 1,
    pending_review_count: 0,
    last_activity_at: "2026-12-27T12:00:00Z",
  },
];

const workforce = {
  summary: {
    total: 6,
    today_count: 1,
    this_week_count: 5,
    unassigned_count: 1,
    at_risk_count: 1,
    warranty_count: 1,
    maintenance_count: 1,
    estimate_count: 1,
    subcontractor_count: 0,
  },
  capacity: [
    {
      member_id: 1,
      member_name: "Taylor Crew",
      role: "employee_supervisor",
      state: "near_capacity",
      assignment_count_today: 1,
      assignment_count_week: 3,
      assignment_count_total: 4,
      reasons: ["Workload is close to the launch capacity threshold."],
    },
    {
      member_id: 2,
      member_name: "Jordan Crew",
      role: "employee_milestones",
      state: "available",
      assignment_count_today: 0,
      assignment_count_week: 1,
      assignment_count_total: 1,
      reasons: ["Light workload based on scheduled and assigned records."],
    },
  ],
  skills_matrix: [
    { skill: "Flooring", member_count: 1, coverage: "thin", members: [{ member_id: 1, member_name: "Taylor Crew", skill_level: "lead" }] },
    { skill: "Warranty Repair", member_count: 0, coverage: "missing", members: [] },
  ],
  assistant: {
    summary: "6 workforce records normalized across assignments, estimates, warranty, maintenance, and crew planning.",
    confidence: "medium",
    recommendations: [
      "Review unassigned work before confirming new schedules.",
      "Check high-priority warranty, property, or review items first.",
    ],
    safe_actions: ["Prepare assignment review", "Prepare capacity review", "Open source records"],
  },
  results: [
    {
      source_type: "warranty_work_order",
      source_id: 77,
      source_label: "Warranty work order",
      member_type: "employee",
      member_id: 1,
      member_name: "Taylor Crew",
      project_label: "Residential Refresh",
      customer_label: "Jordan Customer",
      property_address: "1200 QA Lane",
      scheduled_start: "2026-12-30T10:00:00",
      status: "scheduled",
      priority: "high",
      required_skills: ["Warranty Repair"],
      is_warranty_work: true,
      is_maintenance_work: false,
      is_estimate_work: false,
      is_subcontractor_work: false,
      open_url: "/app/warranty/requests/77",
    },
    {
      source_type: "maintenance_work_order",
      source_id: 81,
      source_label: "Maintenance work order",
      member_type: "unassigned",
      member_id: null,
      member_name: "Unassigned",
      project_label: "Quarterly HVAC service",
      customer_label: "Property Manager QA",
      property_address: "Unit 2B",
      scheduled_start: "2026-12-31T00:00:00",
      status: "scheduled",
      priority: "normal",
      required_skills: ["HVAC"],
      is_warranty_work: false,
      is_maintenance_work: true,
      is_estimate_work: false,
      is_subcontractor_work: false,
      open_url: "/app/maintenance/work-orders/81",
    },
    {
      source_type: "estimate_appointment",
      source_id: 88,
      source_label: "Estimate workspace",
      member_type: "unassigned",
      member_id: null,
      member_name: "Unassigned",
      project_label: "LVP estimate",
      customer_label: "Taylor Intake",
      property_address: "4400 QA Lead Street",
      scheduled_start: "2026-12-31T09:00:00",
      status: "in_progress",
      priority: "normal",
      required_skills: ["Flooring"],
      is_warranty_work: false,
      is_maintenance_work: false,
      is_estimate_work: true,
      is_subcontractor_work: false,
      open_url: "/app/estimates/88",
    },
  ],
};

async function installRoutes(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  await page.route("**/api/projects/whoami/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(whoami) });
  });

  await page.route("**/api/projects/dashboard/operations/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        today: [],
        tomorrow: [],
        this_week: [],
      }),
    });
  });

  await page.route("**/api/projects/subaccounts/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(subaccounts) });
  });

  await page.route("**/api/projects/workforce/assignments/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(workforce) });
  });

  await page.route("**/api/payments/onboarding/status/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ connected: true }) });
  });
}

test("team overview shows workforce command center with assistant guidance", async ({ page }) => {
  await installRoutes(page);

  await page.goto("/app/team", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Team Overview" })).toBeVisible();
  await expect(page.getByTestId("team-decision-brief")).toContainText("Today's Staffing Decisions");
  await expect(page.getByTestId("team-decision-brief")).toContainText("Needs Assignment");
  await expect(page.getByTestId("team-decision-brief")).toContainText("Available Today");
  await expect(page.getByTestId("team-workforce-command-center")).toContainText("Workforce Command Center");
  await expect(page.getByTestId("team-workforce-command-center")).toContainText("Warranty");
  await expect(page.getByTestId("team-workload-mixed-types")).toContainText("Needs Assignment");
  await expect(page.getByTestId("team-workload-mixed-types")).toContainText("Estimate Workspace");
  await expect(page.getByTestId("team-workload-mixed-types")).not.toContainText("Assigned to Unassigned");
  await page.getByTestId("team-workload-mixed-types").getByRole("button", { name: /Assigned Work/ }).click();
  await expect(page.getByTestId("team-workload-mixed-types")).toContainText("Warranty Work Order");
  await expect(page.getByTestId("team-capacity-indicators")).toContainText("Taylor Crew");
  await expect(page.getByTestId("team-capacity-indicators")).toContainText("Near Capacity");
  await expect(page.getByTestId("team-skills-matrix")).toContainText("Warranty Repair");
  await expect(page.getByTestId("team-skills-matrix")).toContainText("Flooring");
  await expect(page.getByTestId("team-assistant-panel")).toContainText("Team Assistant");
  await expect(page.getByTestId("project-assistant-human-approval")).toContainText("authorized users must assign people");
});
