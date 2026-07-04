import { expect, test } from "@playwright/test";

function isoDaysFromNow(days) {
  const date = new Date();
  date.setHours(9, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

const subaccountsPayload = [
  {
    id: 1,
    display_name: "Taylor Crew",
    email: "taylor@example.com",
    role: "employee_supervisor",
    active_assignment_count: 2,
    pending_review_count: 1,
    capabilities: [
      { skill_id: 10, skill_name: "Painting", skill_level: "skilled", skill_level_label: "Skilled" },
    ],
  },
  {
    id: 2,
    display_name: "Jordan Crew",
    email: "jordan@example.com",
    role: "employee_milestones",
    active_assignment_count: 0,
    pending_review_count: 0,
    capabilities: [
      { skill_id: 20, skill_name: "Plumbing", skill_level: "working", skill_level_label: "Working" },
    ],
  },
];

const schedulePayload = {
  schedule: {
    timezone: "America/Chicago",
    work_sun: true,
    work_mon: true,
    work_tue: true,
    work_wed: true,
    work_thu: true,
    work_fri: true,
    work_sat: true,
    start_time: "08:00",
    end_time: "16:00",
  },
  exceptions: [],
};

const calendarPayload = {
  events: [
    {
      id: "AA-202",
      title: "Commercial Buildout",
      start: isoDaysFromNow(1),
      end: isoDaysFromNow(2),
      allDay: true,
      extendedProps: {
        type: "agreement_assignment",
        project_title: "Commercial Buildout",
        employee_name: "Taylor Crew",
        milestone_count: 3,
      },
    },
    {
      id: "MA-2001",
      title: "Cabinet Install",
      start: isoDaysFromNow(3),
      end: isoDaysFromNow(4),
      allDay: true,
      extendedProps: {
        type: "milestone_override",
        project_title: "Commercial Buildout",
        milestone_id: 2001,
        employee_name: "Taylor Crew",
      },
    },
  ],
};

async function installScheduleRoutes(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  await page.route("**/api/projects/whoami/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user_id: 7,
        email: "owner@example.com",
        type: "contractor",
        role: "contractor_owner",
        identity_type: "contractor_owner",
        attention_counts: {},
      }),
    });
  });

  await page.route("**/api/payments/onboarding/status/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ onboarding_status: "complete", connected: true }),
    });
  });

  await page.route("**/api/projects/subaccounts/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(subaccountsPayload),
    });
  });

  await page.route("**/api/projects/subaccounts/*/schedule/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(schedulePayload),
    });
  });

  await page.route("**/api/projects/assignments/calendar/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(calendarPayload),
    });
  });
}

test("team schedule shows daily operations board and filters employees", async ({ page }) => {
  await installScheduleRoutes(page);

  await page.goto("/app/team/schedule?subaccount=1", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("team-schedule-board-summary")).toContainText("Daily Operations Board");
  await expect(page.getByTestId("team-schedule-board-summary")).toContainText("Employees Working Today");
  await expect(page.getByTestId("team-schedule-board-summary")).toContainText("Available Employees");
  await expect(page.getByTestId("team-schedule-filters")).toContainText("Capability");
  await expect(page.getByTestId("team-schedule-employee-card-1")).toContainText("Painting - Skilled");
  await expect(page.getByTestId("team-schedule-employee-card-1")).toContainText("Employee Supervisor");
  await expect(page.getByTestId("team-schedule-employee-card-2")).toContainText("Available");

  await page.getByTestId("team-schedule-capability-filter").selectOption("20");
  await expect(page.getByTestId("team-schedule-filter-summary")).toContainText("Plumbing");
  await expect(page.getByTestId("team-schedule-employee-card-2")).toBeVisible();
  await expect(page.getByTestId("team-schedule-employee-card-1")).toHaveCount(0);

  await page.getByTestId("team-schedule-capability-filter").selectOption("");
  await page.getByTestId("team-schedule-work-filter").selectOption("available");
  await expect(page.getByTestId("team-schedule-filter-summary")).toContainText("available");
  await expect(page.getByTestId("team-schedule-employee-card-2")).toBeVisible();
});

test("team schedule assignment rows show project context", async ({ page }) => {
  await installScheduleRoutes(page);

  await page.goto("/app/team/schedule?subaccount=1", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("team-schedule-operational-view")).toContainText("Commercial Buildout");
  await expect(page.getByTestId("team-schedule-assignment-AA-202")).toContainText("Status");
  await expect(page.getByTestId("team-schedule-assignment-AA-202")).toContainText("Duration");
  await expect(page.getByTestId("team-schedule-assignment-AA-202")).toContainText("Owner");
  await expect(page.getByTestId("team-schedule-assignment-AA-202")).toContainText("Milestones");
});
