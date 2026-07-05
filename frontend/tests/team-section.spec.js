import { expect, test } from "@playwright/test";

const whoamiPayload = {
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
    assigned_action_count: 4,
    overdue_milestone_count: 1,
    pending_invites_count: 1,
    active_subcontractor_count: 2,
    total_attention_count: 4,
  },
};

const subaccountsPayload = {
  results: [
    {
      id: 1,
      display_name: "Taylor Crew",
      email: "taylor@example.com",
      role: "employee_supervisor",
      role_label: "Supervisor (manage assigned agreements/teams)",
      is_active: true,
      assignment_count: 5,
      active_assignment_count: 2,
      pending_review_count: 1,
      overdue_milestone_count: 1,
      last_activity_at: "2026-04-19T10:00:00Z",
      last_login: "2026-04-18T18:30:00Z",
      capabilities: [
        { skill_id: 10, skill_name: "Painting", skill_level: "skilled", skill_level_label: "Skilled" },
        { skill_id: 11, skill_name: "Drywall", skill_level: "expert", skill_level_label: "Expert" },
        { skill_id: 12, skill_name: "General Labor", skill_level: "lead", skill_level_label: "Lead" },
        { skill_id: 13, skill_name: "Cleanup", skill_level: "working", skill_level_label: "Working" },
      ],
    },
    {
      id: 2,
      display_name: "Jordan Crew",
      email: "jordan@example.com",
      role: "employee_milestones",
      role_label: "Milestones (can mark complete)",
      is_active: true,
      assignment_count: 2,
      active_assignment_count: 1,
      pending_review_count: 0,
      overdue_milestone_count: 0,
      last_activity_at: "2026-04-20T14:00:00Z",
      last_login: "2026-04-20T13:00:00Z",
      capabilities: [
        { skill_id: 20, skill_name: "Plumbing", skill_level: "working", skill_level_label: "Working" },
      ],
    },
    {
      id: 3,
      display_name: "No Skill Crew",
      email: "noskill@example.com",
      role: "employee_readonly",
      role_label: "Read-only",
      is_active: true,
      assignment_count: 0,
      active_assignment_count: 0,
      pending_review_count: 0,
      overdue_milestone_count: 0,
      last_activity_at: "",
      last_login: "",
      capabilities: [],
    },
  ],
};

const workforceCatalogPayload = {
  skills: [
    { id: 10, name: "Painting", slug: "painting" },
    { id: 11, name: "Drywall", slug: "drywall" },
    { id: 12, name: "General Labor", slug: "general-labor" },
    { id: 13, name: "Cleanup", slug: "cleanup" },
    { id: 20, name: "Plumbing", slug: "plumbing" },
    { id: 30, name: "Tile", slug: "tile" },
  ],
  skill_levels: [
    { value: "beginner", label: "Beginner" },
    { value: "working", label: "Working" },
    { value: "skilled", label: "Skilled" },
    { value: "lead", label: "Lead" },
    { value: "expert", label: "Expert" },
  ],
};

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

const milestoneRowsByAgreement = {
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
    assigned_subaccounts: [{ id: 1, display_name: "Taylor Crew", email: "taylor@example.com", role: "employee_supervisor", is_active: true }],
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

const directoryPayload = {
  results: [
    {
      key: "1",
      subcontractor_user_id: 1,
      display_name: "Taylor Crew",
      email: "taylor@example.com",
      status: "active",
      agreements_count: 1,
      assigned_work_count: 3,
      submitted_for_review_count: 1,
      pending_review_count: 1,
      active_jobs_count: 3,
      last_activity_at: "2026-04-19T10:00:00Z",
      agreements: [{ agreement_id: 202, agreement_title: "Commercial Buildout" }],
    },
  ],
};

const invitationPayload = {
  results: [
    {
      id: 9001,
      status: "pending",
      invite_name: "New Hire",
      invite_email: "newhire@example.com",
      agreement: 202,
      agreement_title: "Commercial Buildout",
      invited_at: "2026-04-19T09:00:00Z",
    },
  ],
};

const assignmentPayload = {
  results: [
    {
      id: 1,
      invitation_id: 1,
      agreement_id: 202,
      agreement_title: "Commercial Buildout",
      subcontractor_display_name: "Taylor Crew",
      subcontractor_email: "taylor@example.com",
      status: "in_progress",
      assigned_milestones_count: 3,
      submitted_for_review_count: 1,
      needs_changes_count: 0,
      approved_count: 1,
      completed_count: 1,
      total_assigned_amount: "3500.00",
      earliest_due_date: "2026-04-28",
      compliance_status: "compliant",
      milestones: [],
    },
  ],
};

const submissionPayload = {
  results: [
    {
      id: 2001,
      agreement_id: 202,
      agreement_title: "Commercial Buildout",
      milestone_title: "Cabinet Install",
      subcontractor_display_name: "Taylor Crew",
      subcontractor_email: "taylor@example.com",
      review_status: "submitted_for_review",
      submitted_at: "2026-04-20T15:30:00Z",
      reviewed_at: null,
      notes: "Ready for inspection.",
      review_response_note: "",
    },
  ],
};

const schedulePayload = {
  subaccount_id: 1,
  display_name: "Taylor Crew",
  email: "taylor@example.com",
  role: "employee_supervisor",
  schedule: {
    timezone: "America/Chicago",
    work_sun: false,
    work_mon: true,
    work_tue: true,
    work_wed: true,
    work_thu: true,
    work_fri: true,
    work_sat: false,
    start_time: "08:00:00",
    end_time: "17:00:00",
  },
  exceptions: [
    { id: 1, date: "2026-04-22", is_working: false, note: "Vacation" },
  ],
};

function dateDaysFromNow(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const calendarPayload = {
  events: [
    {
      id: "AA-202-1",
      title: "Taylor Crew — Commercial Buildout",
      start: dateDaysFromNow(2),
      end: dateDaysFromNow(5),
      allDay: true,
      extendedProps: {
        type: "agreement_assignment",
        agreement_id: 202,
        agreement_number: 202,
        project_title: "Commercial Buildout",
        subaccount_id: 1,
        employee_name: "Taylor Crew",
        employee_email: "taylor@example.com",
        employee_role: "employee_supervisor",
      },
    },
    {
      id: "MA-2001-1",
      title: "A#202 • M1 — Cabinet Install",
      start: dateDaysFromNow(3),
      end: dateDaysFromNow(4),
      allDay: true,
      extendedProps: {
        type: "milestone_override",
        agreement_id: 202,
        agreement_number: 202,
        project_title: "Commercial Buildout",
        milestone_id: 2001,
        milestone_order: 1,
        milestone_title: "Cabinet Install",
        subaccount_id: 1,
        employee_name: "Taylor Crew",
        employee_email: "taylor@example.com",
        employee_role: "employee_supervisor",
      },
    },
  ],
};

async function installTeamRoutes(page) {
  const subaccountRows = JSON.parse(JSON.stringify(subaccountsPayload.results));
  const skillLabel = (value) => workforceCatalogPayload.skill_levels.find((level) => level.value === value)?.label || value;
  const skillById = (id) => workforceCatalogPayload.skills.find((skill) => String(skill.id) === String(id));

  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  await page.route("**/api/projects/whoami/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(whoamiPayload),
    });
  });

  await page.route("**/api/payments/onboarding/status/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ onboarding_status: "complete", connected: true }),
    });
  });

  await page.route("**/api/projects/dashboard/operations/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        identity_type: "contractor_owner",
        today: [
          {
            id: "review-202",
            item_type: "review_submission",
            title: "Cabinet Install is awaiting your review",
            subtitle: "Taylor Crew submitted work for review in Commercial Buildout.",
            agreement_id: 202,
            agreement_title: "Commercial Buildout",
            project_title: "Commercial Buildout",
            milestone_id: 2001,
            milestone_title: "Cabinet Install",
            status: "pending",
            actions: [{ label: "Review", type: "route", target: "/app/reviewer/queue" }],
            occurred_at: "2026-04-20T15:30:00Z",
          },
        ],
        tomorrow: [],
        this_week: [
          {
            id: "due-202",
            item_type: "due_this_week",
            title: "Commercial Buildout is due later this week",
            subtitle: "Taylor Crew has the next scheduled handoff.",
            agreement_id: 202,
            agreement_title: "Commercial Buildout",
            project_title: "Commercial Buildout",
            milestone_id: 2001,
            milestone_title: "Cabinet Install",
            assigned_subaccount_id: 1,
            status: "pending",
            actions: [{ label: "View Work", type: "route", target: "/app/team/assignments" }],
            occurred_at: "2026-04-23T10:00:00Z",
          },
        ],
        recent_activity: [],
        empty_states: {},
      }),
    });
  });

  await page.route("**/api/projects/subaccounts**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.match(/\/api\/projects\/subaccounts\/\d+\/schedule\/$/)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(schedulePayload),
      });
      return;
    }
    const capabilityMatch = url.pathname.match(/\/api\/projects\/subaccounts\/(\d+)\/capabilities\/$/);
    if (capabilityMatch) {
      const id = Number(capabilityMatch[1]);
      const row = subaccountRows.find((item) => Number(item.id) === id);
      if (!row) {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Not found." }) });
        return;
      }
      const payload = route.request().postDataJSON();
      row.capabilities = (payload.capabilities || []).map((capability, index) => {
        const skill = skillById(capability.skill_id);
        return {
          id: index + 100,
          skill_id: Number(capability.skill_id),
          skill_name: skill?.name || `Skill ${capability.skill_id}`,
          skill_slug: skill?.slug || "",
          skill_level: capability.skill_level,
          skill_level_label: skillLabel(capability.skill_level),
        };
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(row),
      });
      return;
    }
    const detailMatch = url.pathname.match(/\/api\/projects\/subaccounts\/(\d+)\/$/);
    if (detailMatch) {
      const id = Number(detailMatch[1]);
      const row = subaccountRows.find((item) => Number(item.id) === id);
      await route.fulfill({
        status: row ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(row || { detail: "Not found." }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: subaccountRows }),
    });
  });

  await page.route("**/api/projects/workforce/catalog/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(workforceCatalogPayload),
    });
  });

  await page.route("**/api/projects/estimate-availability/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [], warning: "No estimate availability has been configured." }),
    });
  });

  await page.route("**/api/projects/agreements**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.match(/\/api\/projects\/agreements\/\d+\/milestones\/$/)) {
      const agreementId = Number(url.pathname.split("/").filter(Boolean)[3]);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(milestoneRowsByAgreement[agreementId] || { results: [] }),
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

  await page.route("**/api/projects/subcontractors**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(directoryPayload),
    });
  });

  await page.route("**/api/projects/subcontractor-invitations**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(invitationPayload),
    });
  });

  await page.route("**/api/projects/subcontractor-assignments**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(assignmentPayload),
    });
  });

  await page.route("**/api/projects/subcontractor-work-submissions**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(submissionPayload),
    });
  });

  await page.route("**/api/projects/milestones/reviewer-queue**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        groups: [
          {
            agreement_id: 202,
            agreement_title: "Commercial Buildout",
            project_title: "Commercial Buildout",
            project_class: "commercial",
            project_class_label: "Commercial",
            milestones: [
              {
                id: 2001,
                title: "Cabinet Install",
                description: "Install cabinets.",
                work_submission_status: "submitted_for_review",
                work_submitted_at: "2026-04-20T15:30:00Z",
                work_submission_note: "Ready for inspection.",
                assigned_worker_display: "Taylor Crew",
                reviewer_display: "Queue Owner",
                completion_date: "2026-04-28",
                agreement_id: 202,
                project_class: "commercial",
                project_class_label: "Commercial",
              },
            ],
          },
        ],
        milestones: [{ id: 2001 }],
        count: 1,
      }),
    });
  });

  await page.route("**/api/projects/assignments/calendar**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(calendarPayload),
    });
  });
}

test("team overview and sidebar show attention counts", async ({ page }) => {
  await installTeamRoutes(page);

  await page.goto("/app/team", { waitUntil: "domcontentloaded" });

  await expect(page.locator("aside a[href='/app/reviewer/queue']").locator("span").last()).toHaveText("1");
  await expect(page.locator("aside a[href='/app/team']").locator(".ml-auto")).toContainText("5");

  await expect(page.getByTestId("team-overview-actions")).toContainText("Assign Work");
  await expect(page.getByTestId("team-overview-summary")).toContainText("Team Members");
  await expect(page.getByTestId("team-overview-summary")).toContainText("Assigned Work");
  await expect(page.getByTestId("team-overview-summary")).toContainText("Awaiting Review");
  await expect(page.getByTestId("team-overview-attention")).toContainText("Cabinet Install is awaiting your review");
  await expect(page.getByTestId("team-overview-attention")).not.toContainText("Demo Prep");
  await expect(page.getByTestId("team-overview-upcoming")).toContainText("Commercial Buildout is due later this week");
  await expect(page.getByTestId("team-overview-members")).toContainText("Taylor Crew");
  await expect(page.getByTestId("team-overview-assign-work")).toBeVisible();
  await expect(page.getByTestId("team-overview-review-work")).toBeVisible();

  await page.getByTestId("team-overview-summary").getByText("Team Members").click();
  await expect(page).toHaveURL(/\/app\/team\/members/);
});

test("team members page separates permissions from capabilities and filters by trade skill", async ({ page }) => {
  await installTeamRoutes(page);

  await page.goto("/app/team/members", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Employees and capabilities")).toBeVisible();
  await expect(page.getByText("Permission roles control what employees can do in MyHomeBro.")).toBeVisible();
  await expect(page.getByText("With capabilities")).toBeVisible();
  await expect(page.getByTestId("team-member-row-1")).toContainText("Permission role");
  await expect(page.getByTestId("team-member-row-1")).toContainText("Trade capabilities");
  await expect(page.getByTestId("team-member-row-1")).toContainText("Painting - Skilled");
  await expect(page.getByTestId("team-member-row-1")).toContainText("+1 more");
  await expect(page.getByTestId("team-member-manage-1")).toBeVisible();
  await expect(page.getByTestId("team-member-row-3")).toContainText("No trade capabilities assigned");

  await page.getByTestId("team-member-manage-1").click();
  await expect(page).toHaveURL(/\/app\/team\/employees\/1/);
  await expect(page.getByTestId("team-employee-detail-page")).toContainText("Taylor Crew");
  await expect(page.getByTestId("team-employee-permission-role")).toContainText("Supervisor");
  await expect(page.getByTestId("team-employee-capabilities-section")).toContainText("Trade Capabilities");
  await expect(page.getByTestId("team-employee-capability-list")).toContainText("Painting");
  await page.getByTestId("team-employee-add-skill").selectOption("30");
  await page.getByTestId("team-employee-add-level").selectOption("lead");
  await page.getByTestId("team-employee-add-capability").click();
  await expect(page.getByTestId("team-employee-capability-list")).toContainText("Tile");
  await page.getByTestId("team-employee-capability-level-10").selectOption("expert");
  await expect(page.getByTestId("team-employee-capability-10")).toContainText("Painting");
  await page.getByTestId("team-employee-capability-remove-30").click();
  await expect(page.getByTestId("team-employee-capability-list")).not.toContainText("Tile");
  await expect(page.getByTestId("team-employee-schedule-summary")).toContainText("working day");
  await expect(page.getByTestId("team-employee-assigned-work-summary")).toContainText("Active");

  await page.goto("/app/team/employees/3", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("team-employee-no-capabilities")).toContainText("No capabilities assigned");

  await page.goto("/app/team/members", { waitUntil: "domcontentloaded" });

  await page.getByTestId("team-capability-filter").selectOption("10");
  await expect(page.getByTestId("team-active-filter-summary")).toContainText("with Painting");
  await expect(page.getByTestId("team-member-row-1")).toBeVisible();
  await expect(page.getByTestId("team-member-row-2")).toHaveCount(0);

  await page.getByTestId("team-skill-level-filter").selectOption("working");
  await expect(page.getByText("No employees match these filters")).toBeVisible();

  await page.getByTestId("team-clear-filters").click();
  await expect(page.getByTestId("team-member-row-2")).toBeVisible();
});

test("estimate availability settings support CRUD and weekly preview", async ({ page }) => {
  await installTeamRoutes(page);

  let nextId = 1;
  let windows = [];
  const labels = {
    0: "Monday",
    1: "Tuesday",
    2: "Wednesday",
    3: "Thursday",
    4: "Friday",
    5: "Saturday",
    6: "Sunday",
  };
  const typeLabels = {
    phone_call: "Phone Call",
    video_call: "Video Call",
    in_person: "In-Person Estimate",
  };
  const serialize = (window) => ({
    ...window,
    weekday_label: labels[window.weekday],
    appointment_type_label: typeLabels[window.appointment_type],
    created_at: "2026-07-05T12:00:00Z",
    updated_at: "2026-07-05T12:00:00Z",
  });

  await page.route("**/api/projects/estimate-availability/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const detailMatch = url.pathname.match(/\/api\/projects\/estimate-availability\/(\d+)\/$/);

    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: windows.map(serialize),
          warning: windows.length ? "" : "No estimate availability has been configured.",
        }),
      });
      return;
    }

    if (method === "POST") {
      const payload = route.request().postDataJSON();
      const row = {
        id: nextId++,
        weekday: Number(payload.weekday),
        start_time: payload.start_time,
        end_time: payload.end_time,
        timezone: payload.timezone,
        appointment_type: payload.appointment_type,
        duration_minutes: Number(payload.duration_minutes),
        notes: payload.notes || "",
        is_active: Boolean(payload.is_active),
      };
      windows = [...windows, row];
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(serialize(row)),
      });
      return;
    }

    if ((method === "PATCH" || method === "PUT") && detailMatch) {
      const id = Number(detailMatch[1]);
      const payload = route.request().postDataJSON();
      windows = windows.map((window) =>
        window.id === id
          ? {
              ...window,
              ...payload,
              weekday: payload.weekday === undefined ? window.weekday : Number(payload.weekday),
              duration_minutes:
                payload.duration_minutes === undefined ? window.duration_minutes : Number(payload.duration_minutes),
              is_active: payload.is_active === undefined ? window.is_active : Boolean(payload.is_active),
            }
          : window
      );
      const row = windows.find((window) => window.id === id);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(serialize(row)),
      });
      return;
    }

    if (method === "DELETE" && detailMatch) {
      const id = Number(detailMatch[1]);
      windows = windows.filter((window) => window.id !== id);
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Not found." }) });
  });

  await page.goto("/app/team/estimate-availability", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("estimate-availability-page")).toContainText("Customers will only see these published estimate windows.");
  await expect(page.getByTestId("estimate-availability-empty")).toContainText("No availability configured");

  await page.getByTestId("estimate-availability-weekday").selectOption("0");
  await page.getByTestId("estimate-availability-start").fill("09:00");
  await page.getByTestId("estimate-availability-end").fill("11:00");
  await page.getByTestId("estimate-availability-duration").selectOption("30");
  await page.getByTestId("estimate-availability-type").selectOption("in_person");
  await page.getByTestId("estimate-availability-notes").fill("Porch estimates only.");
  await page.getByTestId("estimate-availability-save").click();

  await expect(page.getByTestId("estimate-availability-row-1")).toContainText("Monday");
  await expect(page.getByTestId("estimate-availability-row-1")).toContainText("9:00 AM to 11:00 AM");
  await expect(page.getByTestId("estimate-availability-preview-day-0")).toContainText("9:00 AM");
  await expect(page.getByTestId("estimate-availability-preview-day-0")).toContainText("10:30 AM");

  await page.getByTestId("estimate-availability-edit-1").click();
  await page.getByTestId("estimate-availability-end").fill("10:00");
  await page.getByTestId("estimate-availability-save").click();
  await expect(page.getByTestId("estimate-availability-row-1")).toContainText("9:00 AM to 10:00 AM");
  await expect(page.getByTestId("estimate-availability-preview-day-0")).not.toContainText("10:30 AM");

  await page.getByTestId("estimate-availability-toggle-1").click();
  await expect(page.getByTestId("estimate-availability-row-1")).toContainText("Disabled");
  await expect(page.getByTestId("estimate-availability-preview-day-0")).toContainText("No published slots");

  await page.getByTestId("estimate-availability-delete-1").click();
  await expect(page.getByTestId("estimate-availability-empty")).toContainText("No availability configured");
});

test("assignments page filters by project class and status", async ({ page }) => {
  await installTeamRoutes(page);

  await page.goto("/app/team/assignments", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("assignments-project-class-filter")).toBeVisible();
  await expect(page.getByText("Residential Refresh")).toBeVisible();
  await expect(page.getByText("Commercial Buildout")).toBeVisible();
  await expect(page.getByTestId("assignment-row-101")).toContainText("Residential");
  await expect(page.getByTestId("assignment-row-202")).toContainText("Commercial");
  await expect(page.getByTestId("assignment-row-101")).toContainText("Unassigned");
  await expect(page.getByTestId("assignment-row-202")).toContainText("Awaiting Review");

  await page.getByTestId("assignments-project-class-filter").selectOption("commercial");
  await expect(page.getByTestId("assignment-row-202")).toContainText("Commercial");
  await expect(page.getByText("Residential Refresh")).toHaveCount(0);

  await page.getByTestId("assignments-status-filter-awaiting_review").click();
  await expect(page.getByTestId("assignment-row-202")).toContainText("Awaiting Review");
  await page.getByTestId("assignments-status-filter-unassigned").click();
  await expect(page.getByText("Residential Refresh")).toHaveCount(0);
});

test("team page, subcontractors page, and schedule show operational work", async ({ page }) => {
  await installTeamRoutes(page);

  await page.goto("/app/team", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("team-overview-members")).toBeVisible();
  await expect(page.getByRole("button", { name: "View Work" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Schedule" }).first()).toBeVisible();

  await page.goto("/app/team/subcontractors", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("subcontractors-directory-table")).toContainText("Taylor Crew");
  await expect(page.getByTestId("subcontractors-directory-table")).toContainText("Awaiting review");
  await expect(page.getByTestId("subcontractors-directory-table")).toContainText("View Work");
  await page.getByTestId("subcontractors-invite-button").click({ force: true });
  await expect(page.getByTestId("subcontractors-invite-modal")).toBeVisible();
  await expect(page.getByTestId("subcontractors-invite-modal")).toContainText("Step 1");
  await expect(page.getByTestId("subcontractors-invite-modal")).toContainText("Search existing subcontractors");
  await page.getByTestId("subcontractors-invite-search").fill("Taylor");
  await expect(page.getByTestId("subcontractors-invite-existing-1")).toContainText("Previously used");

  await page.goto("/app/team/schedule?subaccount=1", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("team-schedule-summary")).toContainText("Assignments");
  await expect(page.getByTestId("team-schedule-operational-view")).toContainText("Commercial Buildout");
  await expect(page.getByTestId("team-schedule-editor")).toContainText("Weekly work days");
});
