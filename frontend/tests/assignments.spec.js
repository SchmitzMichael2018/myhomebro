import { expect, test } from "@playwright/test";

function buildWhoAmI(assignedActionCount = 4) {
  return {
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
      assigned_work_count: 2,
      assigned_action_count: assignedActionCount,
      overdue_milestone_count: 1,
      pending_invites_count: 1,
      active_subcontractor_count: 2,
      total_attention_count: 4,
    },
  };
}

const agreementsPayload = {
  results: [
    {
      id: 101,
      title: "Residential Refresh",
      project_class: "residential",
      homeowner_name: "Jordan Customer",
      start: "2026-04-01",
      end: "2026-04-15",
    },
    {
      id: 202,
      title: "Commercial Buildout",
      project_class: "commercial",
      homeowner_name: "Acme LLC",
      start: "2026-04-03",
      end: "2026-04-30",
    },
  ],
};

const milestonesByAgreement = {
  101: {
    results: [
      {
        id: 1001,
        title: "Demo Prep",
        completion_date: "2026-12-10",
        subcontractor_completion_status: "not_submitted",
        completed: false,
        project_class: "residential",
        assigned_worker_display: "",
      },
      {
        id: 1002,
        title: "Site Cleanup",
        completion_date: "2026-12-11",
        subcontractor_completion_status: "not_submitted",
        completed: false,
        project_class: "residential",
        assigned_worker_display: "",
      },
    ],
  },
  202: {
    results: [
      {
        id: 2001,
        title: "Cabinet Install",
        completion_date: "2026-12-28",
        subcontractor_completion_status: "submitted_for_review",
        completed: false,
        project_class: "commercial",
        assigned_worker_display: "Taylor Crew",
        assigned_worker: { subaccount_id: 1, display_name: "Taylor Crew" },
      },
    ],
  },
};

const agreementStatusById = {
  101: { agreement_id: 101, assigned_subaccounts: [], count: 0 },
  202: {
    agreement_id: 202,
    assigned_subaccounts: [
      { id: 1, display_name: "Taylor Crew", email: "taylor@example.com", role: "employee_supervisor", is_active: true },
    ],
    count: 1,
  },
};

const milestoneStatusById = {
  1001: {
    milestone_id: 1001,
    agreement_id: 101,
    override_subaccount: null,
    agreement_assigned_subaccounts: [],
    agreement_count: 0,
  },
  1002: {
    milestone_id: 1002,
    agreement_id: 101,
    override_subaccount: null,
    agreement_assigned_subaccounts: [],
    agreement_count: 0,
  },
  2001: {
    milestone_id: 2001,
    agreement_id: 202,
    override_subaccount: {
      id: 1,
      display_name: "Taylor Crew",
      email: "taylor@example.com",
      role: "employee_supervisor",
      is_active: true,
    },
    agreement_assigned_subaccounts: [
      { id: 1, display_name: "Taylor Crew", email: "taylor@example.com", role: "employee_supervisor", is_active: true },
    ],
    agreement_count: 1,
  },
};

const subaccountsPayload = [
  {
    id: 1,
    display_name: "Taylor Crew",
    email: "taylor@example.com",
    role: "employee_supervisor",
  },
  {
    id: 2,
    display_name: "Jordan Crew",
    email: "jordan@example.com",
    role: "employee_milestones",
  },
  {
    id: 3,
    display_name: "Skyline Subs",
    email: "skyline@example.com",
    role: "subcontractor",
  },
];

const workforcePayload = {
  summary: {
    total: 5,
    today_count: 1,
    this_week_count: 4,
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
  ],
  assistant: {
    summary: "5 workforce records normalized across assignments, estimates, warranty, maintenance, and crew planning.",
    confidence: "medium",
    recommendations: ["Review unassigned work before confirming new schedules."],
    safe_actions: ["Prepare assignment review", "Open source records"],
  },
  results: [
    {
      source_type: "milestone_assignment",
      source_id: 1,
      source_label: "Milestone assignment",
      member_type: "employee",
      member_id: 1,
      member_name: "Taylor Crew",
      project_label: "Commercial Buildout",
      agreement_id: 202,
      agreement_label: "Commercial Buildout",
      milestone_id: 2001,
      milestone_label: "Cabinet Install",
      customer_label: "Acme LLC",
      property_address: "900 Market St",
      scheduled_start: "2026-12-28T00:00:00",
      status: "submitted_for_review",
      priority: "high",
      required_skills: ["Cabinetry"],
      financial_sensitivity: "paid",
      is_warranty_work: false,
      is_maintenance_work: false,
      is_estimate_work: false,
      is_subcontractor_work: false,
      open_url: "/app/agreements/202?milestone=2001",
    },
    {
      source_type: "warranty_work_order",
      source_id: 77,
      source_label: "Warranty work order",
      member_type: "employee",
      member_id: 1,
      member_name: "Taylor Crew",
      project_label: "Residential Refresh",
      milestone_label: "",
      customer_label: "Jordan Customer",
      property_address: "1200 QA Lane",
      scheduled_start: "2026-12-30T10:00:00",
      status: "scheduled",
      priority: "high",
      required_skills: ["Flooring"],
      financial_sensitivity: "warranty",
      is_warranty_work: true,
      is_maintenance_work: false,
      is_estimate_work: false,
      is_subcontractor_work: false,
      open_url: "/app/warranty/requests/77",
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
      financial_sensitivity: "estimate",
      is_warranty_work: false,
      is_maintenance_work: false,
      is_estimate_work: true,
      is_subcontractor_work: false,
      open_url: "/app/estimates/88",
    },
  ],
};

async function installAssignmentsRoutes(page, assignedActionCount = 4, subaccounts = subaccountsPayload) {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  await page.route("**/api/projects/whoami/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildWhoAmI(assignedActionCount)),
    });
  });

  await page.route("**/api/payments/onboarding/status/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ onboarding_status: "complete", connected: true }),
    });
  });

  await page.route("**/api/projects/subaccounts**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(subaccounts),
    });
  });

  await page.route("**/api/projects/workforce/assignments/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(workforcePayload),
    });
  });

  await page.route("**/api/projects/agreements**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.match(/\/api\/projects\/agreements\/\d+\/milestones\/$/)) {
      const agreementId = Number(url.pathname.split("/").filter(Boolean)[3]);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(milestonesByAgreement[agreementId] || { results: [] }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(agreementsPayload),
    });
  });

  await page.route("**/api/projects/assignments/agreements/*/status**", async (route) => {
    const url = new URL(route.request().url());
    const agreementId = Number(url.pathname.split("/").filter(Boolean)[4]);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(agreementStatusById[agreementId] || { agreement_id: agreementId, assigned_subaccounts: [], count: 0 }),
    });
  });

  await page.route("**/api/projects/assignments/milestones/*/status**", async (route) => {
    const url = new URL(route.request().url());
    const milestoneId = Number(url.pathname.split("/").filter(Boolean)[4]);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(milestoneStatusById[milestoneId] || { milestone_id: milestoneId, agreement_count: 0 }),
    });
  });
}

test("sidebar badge hides when no assigned action count is present", async ({ page }) => {
  await installAssignmentsRoutes(page, 0);

  await page.goto("/app/team/assignments", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("assignments-operations-summary")).toContainText("Workforce Operations");
});

test("assignments page shows all projects and work controls", async ({ page }) => {
  await installAssignmentsRoutes(page, 4);

  await page.goto("/app/team/assignments", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("assignments-workforce-command-center")).toContainText("Unified Workload");
  await expect(page.getByTestId("assignments-workforce-command-center")).toContainText("Warranty work order");
  await expect(page.getByTestId("assignments-workforce-command-center")).toContainText("Estimate workspace");
  await expect(page.getByTestId("assignments-capacity-strip")).toContainText("Taylor Crew");
  await expect(page.getByTestId("assignments-capacity-strip")).toContainText("Near Capacity");
  await expect(page.getByTestId("assignments-operations-summary")).toContainText("Workforce Operations");
  await expect(page.getByTestId("assignments-operations-summary")).toContainText("Total Agreements");
  await expect(page.getByTestId("assignments-operations-summary")).toContainText("Assigned Work");
  await expect(page.getByTestId("assignments-operations-summary")).toContainText("Unassigned Work");
  await expect(page.getByTestId("assignments-filter-summary")).toContainText("Showing all 2 agreements");
  await expect(page.getByTestId("assignment-row-101")).toContainText("Residential Refresh");
  await expect(page.getByTestId("assignment-row-202")).toContainText("Commercial Buildout");
  await expect(page.getByTestId("assignment-row-101")).toContainText("No project supervisor");
  await expect(page.getByTestId("assignment-row-101")).toContainText("Unassigned");
  await expect(page.getByTestId("assignment-row-202")).toContainText("Awaiting Review");
  await expect(page.getByTestId("assignment-row-202")).toContainText("Project Supervisor: Taylor Crew");
  await expect(page.getByTestId("assignment-row-101")).toContainText("Total 2");
  await expect(page.getByTestId("assignment-row-202")).toContainText("Total 1");
  await expect(page.getByTestId("assignment-remove-owner-button-202")).toBeVisible();
  await expect(page.getByTestId("assignment-owner-select-101")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Assign Work" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "View Work" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Unassign$/ })).toHaveCount(0);

  await page.getByTestId("assignment-owner-button-101").click();
  await expect(page.getByTestId("assignment-owner-editor-101")).toBeVisible();
  await expect(page.getByTestId("assignment-owner-select-101")).toBeVisible();
  await expect(page.getByTestId("assignment-owner-editor-101")).toContainText("Project Supervisor");
  await expect(page.getByRole("button", { name: "Save" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).first().click();
  await expect(page.getByTestId("assignment-owner-editor-101")).toHaveCount(0);

  await page.getByTestId("assignment-work-button-202").click();
  await expect(page.getByTestId("assign-work-assignee-select")).toBeVisible();
  await expect(page.getByText("Employees 2")).toBeVisible();
  await expect(page.getByText("Subcontractors 1")).toBeVisible();
  await expect(page.locator('[data-testid="assign-work-assignee-select"] optgroup[label="Employees"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="assign-work-assignee-select"] optgroup[label="Subcontractors"]')).toHaveCount(1);
  await expect(page.getByTestId("assign-work-assignee-select")).toContainText("Taylor Crew");
  await expect(page.getByTestId("assign-work-assignee-select")).toContainText("Skyline Subs");
  await expect(page.getByTestId("assign-work-drawer")).toContainText("Customer: Acme LLC");
  await expect(page.getByTestId("assign-work-drawer")).toContainText("Employee milestone assignment");
  await expect(page.getByTestId("assign-work-drawer")).toContainText("Assignment target");
  await expect(page.getByTestId("assign-work-drawer")).toContainText("Milestone actions");
  await expect(page.getByTestId("assign-work-drawer")).toContainText("0 milestones selected");
  await expect(page.getByTestId("assign-work-milestone-row-2001")).toContainText("Cabinet Install");
  await expect(page.getByTestId("assign-work-milestone-row-2001")).toContainText("Due");
  await expect(page.getByTestId("assign-work-milestone-row-2001")).toContainText("Assignment");
  await expect(page.getByRole("button", { name: "Assign selected" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Assignment" }).first()).toBeVisible();
});

test("assign work shows empty subcontractor state with add button", async ({ page }) => {
  const employeesOnly = subaccountsPayload.filter((sub) => String(sub.role || "").toLowerCase() !== "subcontractor");
  await installAssignmentsRoutes(page, 4, employeesOnly);

  await page.goto("/app/team/assignments", { waitUntil: "domcontentloaded" });
  await page.getByTestId("assignment-work-button-202").click();

  await expect(page.getByText("No subcontractors yet")).toBeVisible();
  await expect(page.getByTestId("add-subcontractor-link")).toHaveAttribute("href", "/app/team/subcontractors");
  await expect(page.getByText("Employees 2")).toBeVisible();
  await expect(page.getByText("Subcontractors 0")).toBeVisible();
  await expect(page.locator('[data-testid="assign-work-assignee-select"] optgroup[label="Employees"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="assign-work-assignee-select"] optgroup[label="Subcontractors"]')).toHaveCount(0);
});
