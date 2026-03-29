import { expect, test } from "@playwright/test";

test("contractor can open subcontractors hub, invite, assign work, and review submissions", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  const state = {
    invitations: [
      {
        id: 77,
        agreement: 321,
        agreement_title: "Kitchen Remodel Agreement",
        invite_email: "accepted-sub@example.com",
        invite_name: "Accepted Sub",
        accepted_name: "Accepted Sub",
        status: "accepted",
        invited_at: "2026-03-24T10:00:00Z",
        accepted_at: "2026-03-24T12:00:00Z",
      },
      {
        id: 88,
        agreement: 654,
        agreement_title: "Bath Refresh Agreement",
        invite_email: "pending-sub@example.com",
        invite_name: "Pending Sub",
        status: "pending",
        invited_at: "2026-03-24T14:00:00Z",
      },
    ],
    directory: [
      {
        key: "accepted-sub@example.com",
        display_name: "Accepted Sub",
        email: "accepted-sub@example.com",
        status: "active",
        agreements_count: 1,
        assigned_work_count: 0,
        submitted_for_review_count: 0,
        agreements: [{ agreement_id: 321, agreement_title: "Kitchen Remodel Agreement" }],
      },
    ],
    assignments: [],
    submissions: [
      {
        id: 901,
        agreement_id: 321,
        agreement_title: "Kitchen Remodel Agreement",
        milestone_title: "Cabinet Install",
        subcontractor_display_name: "Accepted Sub",
        subcontractor_email: "accepted-sub@example.com",
        review_status: "submitted_for_review",
        submitted_at: "2026-03-25T08:00:00Z",
        notes: "Ready for walkthrough.",
        review_response_note: "",
      },
    ],
    agreements: [
      { id: 321, title: "Kitchen Remodel Agreement" },
      { id: 654, title: "Bath Refresh Agreement" },
    ],
    milestonesByAgreement: {
      321: [
        {
          id: 901,
          title: "Cabinet Install",
          completion_date: "2026-03-27",
          assigned_subcontractor_invitation: null,
        },
      ],
      654: [],
    },
  };

  function rebuildDirectory() {
    state.directory = [
      {
        key: "accepted-sub@example.com",
        display_name: "Accepted Sub",
        email: "accepted-sub@example.com",
        status: "active",
        agreements_count: 1,
        assigned_work_count: state.assignments.reduce(
          (total, row) => total + Number(row.assigned_milestones_count || 0),
          0
        ),
        submitted_for_review_count: state.submissions.filter(
          (row) => row.review_status === "submitted_for_review"
        ).length,
        agreements: [{ agreement_id: 321, agreement_title: "Kitchen Remodel Agreement" }],
      },
    ];
  }

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

  await page.route("**/api/projects/subcontractors/", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      state.invitations.unshift({
        id: 99,
        agreement: Number(body.agreement_id),
        agreement_title:
          state.agreements.find((row) => String(row.id) === String(body.agreement_id))?.title ||
          `Agreement #${body.agreement_id}`,
        invite_email: body.invite_email,
        invite_name: body.invite_name,
        status: "pending",
        invited_at: "2026-03-25T09:00:00Z",
      });
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(state.invitations[0]),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: state.directory }),
    });
  });

  await page.route("**/api/projects/subcontractors/invite/", async (route) => {
    const body = route.request().postDataJSON();
    state.invitations.unshift({
      id: 100,
      agreement: Number(body.agreement_id),
      agreement_title:
        state.agreements.find((row) => String(row.id) === String(body.agreement_id))?.title ||
        `Agreement #${body.agreement_id}`,
      invite_email: body.invite_email,
      invite_name: body.invite_name,
      status: "pending",
      invited_at: "2026-03-25T09:10:00Z",
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(state.invitations[0]),
    });
  });

  await page.route("**/api/projects/subcontractor-invitations/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: state.invitations }),
    });
  });

  await page.route("**/api/projects/subcontractor-invitations/*/revoke/", async (route) => {
    const id = Number(route.request().url().split("/").filter(Boolean).slice(-2)[0]);
    state.invitations = state.invitations.map((row) =>
      row.id === id ? { ...row, status: "revoked" } : row
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(state.invitations.find((row) => row.id === id)),
    });
  });

  await page.route("**/api/projects/subcontractor-assignments/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: state.assignments }),
    });
  });

  await page.route("**/api/projects/subcontractor-work-submissions/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: state.submissions }),
    });
  });

  await page.route("**/api/projects/subcontractor-work-submissions/901/review/", async (route) => {
    const body = route.request().postDataJSON();
    state.submissions = state.submissions.map((row) =>
      row.id === 901
        ? {
            ...row,
            review_status: body.action === "approve" ? "approved" : "needs_changes",
            review_response_note: body.response_note,
          }
        : row
    );
    rebuildDirectory();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ milestone: { id: 901 } }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: state.agreements }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?\?.*agreement=.*/, async (route) => {
    const url = new URL(route.request().url());
    const agreementId = url.searchParams.get("agreement");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: state.milestonesByAgreement[agreementId] || [],
      }),
    });
  });

  await page.route("**/api/projects/agreements/321/subcontractor-assignments/", async (route) => {
    const body = route.request().postDataJSON();
    state.assignments = [
      {
        id: Number(body.invitation_id),
        invitation_id: Number(body.invitation_id),
        agreement_id: 321,
        agreement_title: "Kitchen Remodel Agreement",
        subcontractor_display_name: "Accepted Sub",
        subcontractor_email: "accepted-sub@example.com",
        status: "submitted",
        assigned_milestones_count: body.milestone_ids.length,
        submitted_for_review_count: 1,
        total_assigned_amount: "1200.00",
        earliest_due_date: "2026-03-27",
      },
    ];
    state.milestonesByAgreement["321"] = state.milestonesByAgreement["321"].map((milestone) =>
      body.milestone_ids.includes(milestone.id)
        ? { ...milestone, assigned_subcontractor_invitation: Number(body.invitation_id) }
        : milestone
    );
    rebuildDirectory();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agreement_id: 321,
        assignment: state.assignments[0],
        updated_milestone_ids: body.milestone_ids,
      }),
    });
  });

  await page.goto("/app/subcontractors", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("subcontractors-page-title")).toBeVisible();
  await expect(page.getByText("Pending Invites")).toBeVisible();
  await expect(page.getByText("Active Subs")).toBeVisible();
  await expect(page.getByTestId("subcontractors-workflow-hint")).toContainText(
    "Wait for the subcontractor to accept the invitation before assigning work."
  );

  await page.getByTestId("subcontractors-invite-button").click();
  await page.selectOption("select", "321");
  await page.getByPlaceholder("Name").fill("New Sub");
  await page.getByPlaceholder("Email").fill("new-sub@example.com");
  await page.getByTestId("subcontractors-invite-submit").click();

  await page.getByRole("button", { name: "Invitations" }).click();
  await expect(page.getByTestId("subcontractors-invitations")).toContainText(
    "new-sub@example.com"
  );

  await page.getByTestId("subcontractors-new-assignment-button").click();
  const selects = page.locator("select");
  await selects.nth(0).selectOption("321");
  await selects.nth(1).selectOption("77");
  await page.getByText("Cabinet Install").click();
  await page.getByTestId("subcontractors-assignment-submit").click();

  await page.getByRole("button", { name: "Assignments" }).click();
  await expect(page.getByTestId("subcontractors-assignments")).toContainText("Accepted Sub");
  await expect(page.getByTestId("subcontractors-assignments")).toContainText("1 milestones");
  await expect(page.getByTestId("subcontractors-assignments")).toContainText("Work value $1200.00");

  await page.getByRole("button", { name: "Submitted Work" }).click();
  await page
    .getByPlaceholder("Optional review response")
    .fill("Looks good to me.");
  await page.getByRole("button", { name: "Mark Reviewed" }).click();
  await expect(page.getByTestId("subcontractors-submissions")).toContainText("Reviewed");
  await expect(page.getByTestId("subcontractors-submissions")).toContainText(
    "Looks good to me."
  );
});

test("contractor can request license from subcontractor before creating assignment", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  const state = {
    invitations: [
      {
        id: 77,
        agreement: 321,
        agreement_title: "Electrical Upgrade Agreement",
        invite_email: "accepted-sub@example.com",
        invite_name: "Accepted Sub",
        accepted_name: "Accepted Sub",
        status: "accepted",
        invited_at: "2026-03-24T10:00:00Z",
        accepted_at: "2026-03-24T12:00:00Z",
      },
    ],
    assignments: [],
    agreements: [{ id: 321, title: "Electrical Upgrade Agreement" }],
    milestonesByAgreement: {
      321: [
        {
          id: 901,
          title: "Electrical Rough-In",
          completion_date: "2026-03-27",
          assigned_subcontractor_invitation: null,
        },
      ],
    },
  };

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

  await page.route("**/api/projects/subcontractors/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route("**/api/projects/subcontractor-invitations/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: state.invitations }),
    });
  });

  await page.route("**/api/projects/subcontractor-assignments/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: state.assignments }),
    });
  });

  await page.route("**/api/projects/subcontractor-work-submissions/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: state.agreements }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?\?.*agreement=.*/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: state.milestonesByAgreement["321"],
      }),
    });
  });

  let assignmentAttempts = 0;
  await page.route("**/api/projects/agreements/321/subcontractor-assignments/", async (route) => {
    assignmentAttempts += 1;
    const body = route.request().postDataJSON();
    if (!body.compliance_action) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Compliance decision required before assigning this subcontractor.",
          compliance_decision_required: true,
          compliance_evaluation: {
            compliance_status: "missing_license",
            warning_message:
              "Electrical work in Texas typically requires a license. This subcontractor does not have a matching license on file.",
            trade_label: "Electrical",
            state_code: "TX",
          },
        }),
      });
      return;
    }

    state.assignments = [
      {
        id: 77,
        invitation_id: 77,
        agreement_id: 321,
        agreement_title: "Electrical Upgrade Agreement",
        subcontractor_display_name: "Accepted Sub",
        subcontractor_email: "accepted-sub@example.com",
        status: "in_progress",
        assigned_milestones_count: 1,
        submitted_for_review_count: 0,
        total_assigned_amount: "1200.00",
        earliest_due_date: "2026-03-27",
        compliance_status: "pending_license",
        compliance_warning_snapshot: {
          warning_message:
            "Electrical work in Texas typically requires a license. Documentation has been requested before acceptance.",
        },
      },
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agreement_id: 321,
        assignment: state.assignments[0],
        updated_milestone_ids: [901],
      }),
    });
  });

  await page.goto("/app/subcontractors", { waitUntil: "domcontentloaded" });

  await page.getByTestId("subcontractors-new-assignment-button").click();
  const selects = page.locator("select");
  await selects.nth(0).selectOption("321");
  await selects.nth(1).selectOption("77");
  await page.getByText("Electrical Rough-In").click();
  await page.getByTestId("subcontractors-assignment-submit").click();
  await expect(
    page.getByTestId("subcontractors-assignment-compliance-decision")
  ).toContainText("Electrical work in Texas typically requires a license");
  await page.getByTestId("subcontractors-assignment-request-license").click();

  await page.getByRole("button", { name: "Assignments" }).click();
  await expect(page.getByTestId("subcontractors-assignments")).toContainText(
    "Documentation has been requested before acceptance"
  );
  await expect(
    page.getByTestId("subcontractor-assignment-compliance-77")
  ).toContainText("Pending License");
  expect(assignmentAttempts).toBe(2);
});
