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
    capabilities: [
      { skill_id: 10, skill_name: "Flooring", skill_level: "lead", skill_level_label: "Lead" },
    ],
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
    capabilities: [],
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

const subcontractors = {
  results: [
    {
      key: "sub-1",
      subcontractor_user_id: 101,
      display_name: "Morgan Subcontracting",
      email: "morgan@example.com",
      status: "active",
      last_activity_at: "2026-12-25T12:00:00Z",
    },
  ],
};

const invitations = {
  results: [
    {
      id: 501,
      status: "pending",
      invite_name: "Casey Trade",
      invite_email: "casey@example.com",
      invited_at: "2026-12-24T12:00:00Z",
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

  await page.route("**/api/projects/subcontractors/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(subcontractors) });
  });

  await page.route("**/api/projects/subcontractor-invitations/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(invitations) });
  });

  await page.route("**/api/payments/onboarding/status/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ connected: true }) });
  });
}

test("team overview shows organization health with assistant guidance", async ({ page }) => {
  await installRoutes(page);

  await page.goto("/app/team", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
  await expect(page.locator(".mhb-operational-surface").getByTestId("team-organization-overview")).toBeVisible();
  await expect(page.getByTestId("team-health-summary")).toContainText("Employees");
  await expect(page.getByTestId("team-health-summary")).toContainText("Subcontractors");
  await expect(page.getByTestId("team-health-summary")).toContainText("Pending Invitations");
  await expect(page.getByTestId("team-health-summary")).toContainText("Incomplete Profiles");
  await expect(page.getByTestId("team-health-summary")).toContainText("Active Accounts");
  await expect(page.getByTestId("team-health-summary")).toContainText("Inactive Members");
  await expect(page.getByTestId("team-assistant-panel")).toHaveCount(0);
  await expect(page.getByTestId("team-directory")).toContainText("Team Directory");
  await expect(page.getByTestId("team-directory")).toContainText("Taylor Crew");
  await expect(page.getByTestId("team-directory")).toContainText("Jordan Crew");
  await expect(page.getByTestId("team-capability-coverage")).toContainText("Capability Coverage");
  await expect(page.getByTestId("team-capability-coverage")).toContainText("Flooring");
  await expect(page.getByTestId("team-capability-coverage")).toContainText("1");
  await expect(page.getByTestId("team-roles-overview")).toContainText("Built-in Roles");
  await expect(page.getByTestId("team-roles-overview")).toContainText("Supervisor");
  await expect(page.getByTestId("team-invitations-overview")).toContainText("Invitations");
  await expect(page.getByTestId("team-invitations-overview")).toContainText("Employees are created directly");
  await expect(page.getByTestId("team-organization-growth")).toContainText("Organization Growth");
  await expect(page.getByTestId("team-organization-growth")).toContainText("Recommended improvements");
  await expect(page.getByTestId("team-organization-growth")).toContainText("Next Steps");
  await expect(page.getByTestId("team-organization-growth")).toContainText("1 member needs a capability profile");
  await expect(page.getByTestId("team-organization-growth")).toContainText("1 subcontractor invitation still pending");
  await expect(page.getByTestId("team-overview-manage-members")).toBeVisible();
  await expect(page.getByTestId("team-overview-manage-members")).toContainText("Manage Access & Profiles");
  await expect(page.getByTestId("team-overview-add-member")).toBeVisible();
  await expect(page.getByTestId("team-overview-invite-subcontractor")).toBeVisible();

  for (const testId of [
    "team-directory",
    "team-capability-coverage",
    "team-roles-overview",
    "team-invitations-overview",
    "team-organization-growth",
  ]) {
    const section = page.getByTestId(testId);
    await expect(section).toHaveClass(/mhb-operational-panel/);
    await expect(section).not.toHaveClass(/bg-white|bg-slate-50|border-slate-200/);
  }

  await expect(page.getByTestId("team-organization-overview")).not.toContainText("Today's Staffing Decisions");
  await expect(page.getByTestId("team-organization-overview")).not.toContainText("Workforce Command Center");
  await expect(page.getByTestId("team-organization-overview")).not.toContainText("Actionable Workload");
  await expect(page.getByTestId("team-organization-overview")).not.toContainText("Assigned Work");
  await expect(page.getByTestId("team-organization-overview")).not.toContainText("Unassigned Work");
  await expect(page.getByTestId("team-organization-overview")).not.toContainText("Needs Assignment");
  await expect(page.getByTestId("team-organization-overview")).not.toContainText("Capacity Risks");
  await expect(page.getByTestId("team-organization-overview")).not.toContainText("Available Today");
  await expect(page.getByTestId("team-organization-overview")).not.toContainText("Upcoming Schedule");
  await expect(page.getByTestId("team-organization-overview")).not.toContainText("Upcoming This Week");
  await expect(page.getByTestId("team-organization-overview")).not.toContainText("Assign Work");
  await expect(page.getByTestId("team-organization-overview")).not.toContainText("Open Schedule");
  await expect(page.getByTestId("team-organization-overview")).not.toContainText("Review Submitted Work");
  await expect(page.getByTestId("team-organization-overview")).not.toContainText("Project Assistant");
  await expect(page.getByTestId("team-organization-overview")).not.toContainText("Team Assistant");
  await expect(page.getByTestId("team-organization-overview")).not.toContainText("Organization focus");
  await expect(page.getByTestId("team-organization-overview")).not.toContainText("Safe prepared actions");
  await expect(page.getByTestId("team-organization-overview")).not.toContainText("Human Approval Required");
  await expect(page.getByTestId("team-organization-overview")).not.toContainText("Estimate Availability");
  await expect(page.getByRole("button", { name: "Add Employee" })).toHaveCount(0);
  await expect(page.getByTestId("project-assistant-human-approval")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});
