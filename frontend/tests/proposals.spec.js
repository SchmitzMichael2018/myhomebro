import { expect, test } from "@playwright/test";

const opportunityPayload = {
  results: [
    {
      bid_id: "lead-6",
      source_kind: "lead",
      source_kind_label: "Lead",
      workspace_stage: "new_lead",
      workspace_stage_label: "New Lead",
      source_id: 6,
      source_reference: "Lead #6",
      project_title: "Bathroom Remodel",
      customer_name: "New Lead Customer",
      customer_email: "lead@example.com",
      customer_phone: "512-555-0100",
      location: "123 Main St, Austin, TX",
      project_class: "residential",
      project_class_label: "Residential",
      project_type: "Bathroom",
      project_subtype: "Refresh",
      bid_amount: null,
      bid_amount_label: "-",
      submitted_at: "2026-07-01T15:20:00Z",
      status: "draft",
      status_label: "Draft",
      status_group: "open",
      linked_agreement_id: null,
      linked_agreement_url: "",
      notes: "Refresh the guest bathroom.",
      timeline: "Next month",
      budget_text: "",
      milestone_preview: [],
      request_signals: ["Guided Intake"],
      request_snapshot: {
        project_title: "Bathroom Remodel",
        project_type: "Bathroom",
        project_subtype: "Refresh",
        refined_description: "Refresh the guest bathroom.",
        location: "123 Main St, Austin, TX",
        timeline: "Next month",
        budget: "",
        photos: [],
        milestones: [],
      },
      latest_estimate_appointment: {
        id: 7001,
        source_type: "lead",
        source_id: 6,
        status: "scheduled",
        appointment_type: "in_person",
        appointment_type_label: "In-Person Estimate",
        scheduled_start: "2026-07-08T15:00:00Z",
        duration_minutes: 60,
        notes: "Bring tape measure.",
        requested_by: "contractor",
        timezone: "America/Chicago",
      },
      estimate_scheduled: true,
      latest_proposal: null,
      proposal_id: null,
      next_action: { key: "review_bid", label: "Review Bid", target: "" },
    },
  ],
  summary: {
    total_bids: 1,
    open_bids: 1,
    follow_up_leads: 0,
    under_review_bids: 0,
    awarded_bids: 0,
    declined_expired_bids: 0,
  },
  filters: { status: "all", project_class: "all", source: "all", search: "" },
};

const proposal = {
  id: 42,
  status: "draft",
  status_label: "Draft",
  source_type: "lead",
  source_id: 6,
  contractor_opportunity_id: null,
  estimate_appointment_id: 7001,
  project_title: "Bathroom Remodel",
  project_summary: "Refresh the guest bathroom.",
  project_type: "Bathroom",
  project_subtype: "Refresh",
  customer_name: "New Lead Customer",
  customer_email: "lead@example.com",
  customer_phone: "512-555-0100",
  customer_preferred_contact: "",
  service_location: "123 Main St, Austin, TX",
  project_start_type: "flexible",
  project_start_date: "",
  project_completion_type: "no_deadline",
  project_completion_date: "",
  scheduling_priority: "flexible",
  site_visit_notes: "",
  access_notes: "",
  risk_notes: "",
  customer_requests: "",
  site_conditions: "",
  quick_checklist: [],
  included_work: "",
  excluded_work: "",
  assumptions: "",
  allowances: "",
  internal_notes: "",
  appointment: opportunityPayload.results[0].latest_estimate_appointment,
  measurements: [],
  line_items: [],
  attachments: [],
  totals: {
    subtotal: "0.00",
    tax: "0.00",
    discounts: "0.00",
    incidentals_reserve: "0.00",
    total: "0.00",
    line_item_count: 0,
  },
  activity: [{ id: 1, event_type: "created", message: "Estimate created", created_at: "2026-07-01T16:00:00Z" }],
  created_at: "2026-07-01T16:00:00Z",
  updated_at: "2026-07-01T16:00:00Z",
};

const customerPayload = {
  results: [
    {
      id: 77,
      full_name: "New Lead Customer",
      email: "lead@example.com",
      phone_number: "512-555-0100",
      street_address: "123 Main St",
      address_line_2: "",
      city: "Austin",
      state: "TX",
      zip_code: "78701",
    },
  ],
};

const estimateListPayload = {
  results: [
    {
      ...proposal,
      id: 42,
      status: "draft",
      status_label: "Draft",
      measurement_count: 0,
      line_item_count: 0,
      attachment_count: 0,
      linked_opportunity_id: 6,
      linked_opportunity_title: "Bathroom Remodel",
      linked_agreement_id: null,
      linked_agreement_title: "",
      linked_agreement_url: "",
    },
    {
      ...proposal,
      id: 43,
      status: "in_progress",
      status_label: "Proposal In Progress",
      project_title: "Flooring Estimate",
      project_type: "Flooring",
      measurement_count: 1,
      line_item_count: 1,
      attachment_count: 0,
      totals: { ...proposal.totals, line_item_count: 1, total: "2400.00" },
    },
    {
      ...proposal,
      id: 44,
      status: "ready",
      status_label: "Proposal Ready",
      project_title: "Ready Deck Repair",
      project_type: "Deck",
      measurement_count: 1,
      line_item_count: 3,
      attachment_count: 2,
      totals: { ...proposal.totals, line_item_count: 3, total: "5200.00", incidentals_reserve: "300.00" },
    },
    {
      ...proposal,
      id: 45,
      status: "converted",
      status_label: "Converted",
      project_title: "Converted Kitchen",
      linked_agreement_id: 450,
      linked_agreement_title: "Converted Kitchen Agreement",
      linked_agreement_url: "/app/agreements/450",
      totals: { ...proposal.totals, total: "8800.00", line_item_count: 4 },
      line_item_count: 4,
    },
    {
      ...proposal,
      id: 46,
      status: "expired",
      status_label: "Expired",
      project_title: "Archived Paint Estimate",
      project_type: "Painting",
    },
  ],
};

async function installBaseMocks(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => {} },
      configurable: true,
    });
  });

  await page.route("**/api/projects/whoami/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: 7, type: "contractor", role: "contractor_owner", email: "playwright@example.com" }),
    });
  });
  await page.route("**/api/projects/contractors/me/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ public_profile: {} }) });
  });
  await page.route(/\/api\/projects\/notifications\/?.*$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });
  await page.route(/\/api\/payments\/onboarding\/status\/?.*$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });
  await page.route("**/api/projects/crew-recommendations/preview/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        source_summary: {},
        required_capabilities: [],
        recommended_members: [],
        gaps: [],
        warnings: [],
        advisory_notice: "Advisory only.",
      }),
    });
  });
}

async function installAgreementWizardMocks(page) {
  await page.route("**/api/projects/contractor-activation-summary/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });
  await page.route("**/api/projects/project-types/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ id: 1, value: "Bathroom", label: "Bathroom", owner_type: "system" }] }),
    });
  });
  await page.route("**/api/projects/project-subtypes/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ id: 2, value: "Refresh", label: "Refresh", owner_type: "system" }] }),
    });
  });
  await page.route("**/api/projects/homeowners**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(customerPayload) });
  });
  await page.route("**/api/projects/templates/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });
  await page.route("**/api/projects/templates/recommend/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        recommendations: [
          {
            id: 5,
            name: "Bathroom Refresh Template",
            match_label: "Strong Match",
            match_reason: "Bathroom refresh project type matches an existing agreement template.",
            default_clarifications: [
              { key: "square_footage", label: "Square footage", question: "What square footage should the estimate use?", section: "measurements" },
              { key: "material_responsibility", label: "Material responsibility", question: "Who supplies fixtures and finish materials?", section: "site" },
              { key: "permit_responsibility", label: "Permit responsibility", question: "Are permits or HOA approvals required?", section: "scope" },
            ],
          },
        ],
      }),
    });
  });
  await page.route("**/api/projects/templates/5/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 5,
        name: "Bathroom Refresh Template",
        default_clarifications: [
          { key: "square_footage", label: "Square footage", question: "What square footage should the estimate use?", section: "measurements" },
          { key: "material_responsibility", label: "Material responsibility", question: "Who supplies fixtures and finish materials?", section: "site" },
          { key: "permit_responsibility", label: "Permit responsibility", question: "Are permits or HOA approvals required?", section: "scope" },
        ],
        milestones: [
          { id: 501, title: "Demolition", description: "Remove existing finishes.", suggested_amount_fixed: "500.00" },
          { id: 502, title: "Installation", description: "Install selected fixtures.", suggested_amount_fixed: "1250.00" },
        ],
      }),
    });
  });
}

function calculateTotals(items) {
  const totals = {
    subtotal: 0,
    tax: 0,
    discounts: 0,
    incidentals_reserve: 0,
  };
  for (const item of items) {
    const amount = Number(item.total || 0);
    if (item.category === "tax") totals.tax += amount;
    else if (item.category === "discount") totals.discounts += Math.abs(amount);
    else if (item.category === "incidentals_reserve") totals.incidentals_reserve += amount;
    else totals.subtotal += amount;
  }
  return {
    subtotal: totals.subtotal.toFixed(2),
    tax: totals.tax.toFixed(2),
    discounts: totals.discounts.toFixed(2),
    incidentals_reserve: totals.incidentals_reserve.toFixed(2),
    total: (totals.subtotal + totals.tax + totals.incidentals_reserve - totals.discounts).toFixed(2),
    line_item_count: items.length,
  };
}

test("Estimates landing page lists lifecycle stages and opens existing records", async ({ page }) => {
  await installBaseMocks(page);

  await page.route(/\/api\/projects\/proposals\/?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(estimateListPayload) });
  });
  await page.route("**/api/projects/proposals/42/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(estimateListPayload.results[0]) });
  });

  await page.goto("/app/estimates", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("link", { name: /Estimates/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Project Assistant/i }).first()).toBeVisible();
  await expect(page.getByTestId("estimates-assistant-panel")).toHaveCount(0);
  await expect(page.getByText("Estimate Assistant")).toHaveCount(0);
  await expect(page.getByText("Human approval required")).toHaveCount(0);
  await expect(page.getByTestId("estimates-queue-summary")).toContainText("Estimate Queue");
  await expect(page.getByTestId("estimates-create-header")).toBeVisible();
  await expect(page.getByTestId("estimates-queue-summary")).toContainText("Next Priority");
  await expect(page.getByPlaceholder("Search estimates")).toBeVisible();
  await expect(page.getByRole("combobox").filter({ hasText: "All customers" })).toBeVisible();
  await expect(page.getByRole("combobox").filter({ hasText: "All project types" })).toBeVisible();
  await expect(page.getByRole("combobox").filter({ hasText: "All statuses" })).toBeVisible();
  await expect(page.getByLabel("Date updated since")).toBeVisible();
  await expect(page.getByTestId("estimates-tabs")).toContainText("Needs Estimate");
  await expect(page.getByTestId("estimates-tabs")).toContainText("Ready for Agreement");
  await expect(page.getByTestId("estimates-tabs")).toContainText("Converted");
  await expect(page.getByTestId("estimates-tabs")).toContainText("Archived");
  await expect(page.getByTestId("estimate-row-42")).toContainText("New Lead Customer");
  await expect(page.getByTestId("estimate-row-42")).toContainText("Bathroom Remodel");
  await expect(page.getByTestId("estimate-row-42")).toContainText("Readiness");
  await expect(page.getByTestId("estimate-row-42")).toContainText("%");

  const darkTextClasses = await page.locator('[data-testid="estimates-queue-summary"], [data-testid="estimates-filters"], [data-testid="estimates-tabs"], [data-testid="estimates-list"]').evaluateAll((roots) => {
    const forbidden = ["text-black", "text-slate-950", "text-slate-900", "text-slate-800"];
    return roots.flatMap((root) => Array.from(root.querySelectorAll("[class]"))
      .map((node) => node.getAttribute("class") || "")
      .filter((className) => forbidden.some((token) => className.includes(token))));
  });
  expect(darkTextClasses).toEqual([]);

  await page.getByTestId("estimates-tab-in_progress").click();
  await expect(page.getByTestId("estimate-row-43")).toContainText("Flooring Estimate");

  await page.getByTestId("estimates-tab-ready").click();
  await expect(page.getByTestId("estimate-primary-action-44")).toContainText("Create Agreement");

  await page.getByTestId("estimates-tab-converted").click();
  await expect(page.getByTestId("estimate-row-45")).toContainText("Converted Kitchen Agreement");
  await page.getByTestId("estimate-primary-action-45").click();
  await expect(page).toHaveURL(/\/app\/agreements\/450/);

  await page.goto("/app/estimates", { waitUntil: "domcontentloaded" });
  await page.getByTestId("estimate-primary-action-42").click();
  await expect(page).toHaveURL(/\/app\/estimates\/42/);

  await page.goto("/app/estimates", { waitUntil: "domcontentloaded" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("estimates-queue-summary")).toBeVisible();
  await expect(page.getByTestId("estimates-tabs")).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});

test("Estimates header and empty state open the shared creation flow without duplicate creates", async ({
  page,
}) => {
  await installBaseMocks(page);
  let createCount = 0;

  await page.route(/\/api\/projects\/proposals\/?$/, async (route) => {
    if (route.request().method() === "POST") {
      createCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ proposal: { ...proposal, id: 88 }, created: true }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });
  await page.route("**/api/projects/homeowners**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(customerPayload),
    });
  });
  await page.route("**/api/projects/proposals/88/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...proposal, id: 88 }),
    });
  });

  await page.goto("/app/estimates", { waitUntil: "domcontentloaded" });
  const headerAction = page.getByTestId("estimates-create-header");
  const emptyAction = page.getByTestId("estimates-create-empty");
  await expect(headerAction).toBeVisible();
  await expect(emptyAction).toBeVisible();

  await headerAction.click();
  await expect(page).toHaveURL(/\/app\/estimates\?create=estimate$/);
  await expect(page.getByRole("heading", { name: "Create Estimate" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/estimates$/);
  await expect(page.getByRole("heading", { name: "Create Estimate" })).toHaveCount(0);

  await emptyAction.click();
  await expect(page).toHaveURL(/\/app\/estimates\?create=estimate$/);
  await page.getByTestId("dashboard-estimate-new-tab").click();
  await page.getByTestId("dashboard-estimate-new-customer").fill("Morgan Reed");
  await page.getByTestId("dashboard-estimate-new-title").fill("Exterior estimate");
  const launch = page.getByTestId("dashboard-estimate-launch");
  await launch.dblclick();

  await expect(page).toHaveURL(/\/app\/estimates\/88$/);
  expect(createCount).toBe(1);
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/estimates$/);
});

test("Estimate creation reports customer permission and create permission failures", async ({
  page,
}) => {
  await installBaseMocks(page);
  await page.route(/\/api\/projects\/proposals\/?$/, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Forbidden" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });
  await page.route("**/api/projects/homeowners**", async (route) => {
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Forbidden" }),
    });
  });

  await page.goto("/app/estimates?create=estimate", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByText(
      "You do not have permission to view customers for estimate creation."
    )
  ).toBeVisible();

  await page.getByTestId("dashboard-estimate-new-tab").click();
  await page.getByTestId("dashboard-estimate-new-customer").fill("Morgan Reed");
  await page.getByTestId("dashboard-estimate-new-title").fill("Exterior estimate");
  await page.getByTestId("dashboard-estimate-launch").click();
  await expect(
    page.getByRole("alert").filter({
      hasText: "You do not have permission to create estimates.",
    })
  ).toBeVisible();
});

for (const appearance of ["dark", "light"]) {
  test(`Estimate creation action remains responsive in ${appearance} appearance`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      window.localStorage.setItem("myhomebro.appearance.v1", value);
    }, appearance);
    await installBaseMocks(page);
    await page.route(/\/api\/projects\/proposals\/?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ results: appearance === "dark" ? [] : estimateListPayload.results }),
      });
    });

    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/app/estimates", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("estimates-create-header")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);
    }
  });
}

test("Create Estimate from Opportunity opens Estimate Workspace", async ({ page }) => {
  await installBaseMocks(page);
  let createPayload = null;

  await page.route(/\/api\/projects\/contractor\/bids\/?.*$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(opportunityPayload) });
  });
  await page.route("**/api/projects/proposals/", async (route) => {
    createPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ proposal, created: true }),
    });
  });
  await page.route("**/api/projects/proposals/42/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(proposal) });
  });

  await page.goto("/app/opportunities", { waitUntil: "domcontentloaded" });
  await page.getByTestId("lead-row-lead-6").click();
  await expect(page.getByTestId("proposal-workspace-action")).toContainText("Open Estimate Workspace");
  await page.getByTestId("proposal-workspace-action").click();

  await expect(page).toHaveURL(/\/app\/proposals\/42/);
  await expect(page.getByTestId("proposal-workspace")).toBeVisible();
  await expect(page.getByTestId("proposal-status")).toContainText("Draft");
  expect(createPayload).toEqual({ source_type: "lead", source_id: 6, estimate_appointment_id: 7001 });
});

test("Estimate Workspace renders compact dark command-center guidance", async ({ page }) => {
  await installBaseMocks(page);
  await installAgreementWizardMocks(page);

  await page.route("**/api/projects/proposals/42/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(proposal) });
  });

  await page.goto("/app/proposals/42", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(/section=customer/);
  await expect(page.getByTestId("proposal-workspace-header")).toContainText(/% ready/);
  const topTabs = page.getByTestId("estimate-workflow-tabs");
  await expect(topTabs.getByRole("tab")).toHaveCount(4);
  await expect(page.locator('[role="tabpanel"]')).toHaveCount(1);
  await expect(page.getByTestId("estimate-step-panel-project")).toContainText("Customer & Contact");
  await expect(page.getByTestId("estimate-step-panel-project")).toContainText("Estimate Appointment");
  await expect(page.getByTestId("estimate-step-panel-project")).toContainText("Project Scheduling");
  await expect(page.getByTestId("proposal-section-estimate")).toHaveCount(0);
  await expect(page.getByTestId("proposal-section-ready")).toHaveCount(0);
  await page.getByTestId("estimate-workflow-next").click();
  await expect(page.getByTestId("estimate-workflow-step-site_scope")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("estimate-workflow-previous").click();
  await expect(page.getByTestId("estimate-workflow-step-project")).toHaveAttribute("aria-selected", "true");

  await page.getByTestId("estimate-workflow-step-pricing").click();
  await expect(page).toHaveURL(/section=estimate/);
  await expect(page.getByTestId("estimate-step-panel-pricing")).toContainText("Estimate Pricing");
  await expect(page.getByTestId("estimate-step-panel-pricing")).toContainText("Adjustments");
  await expect(page.getByTestId("proposal-section-customer")).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("estimate-workflow-step-pricing")).toHaveAttribute("aria-selected", "true");

  await page.getByTestId("estimate-workflow-step-review").click();
  await expect(page).toHaveURL(/section=ready/);
  await expect(page.getByTestId("estimate-step-panel-review")).toContainText("Ready for Agreement");
  await expect(page.getByTestId("proposal-section-estimate")).toHaveCount(0);
  await page.goBack();
  await expect(page.getByTestId("estimate-workflow-step-pricing")).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(page.getByTestId("estimate-workflow-step-review")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("estimate-workflow-previous").click();
  await expect(page.getByTestId("estimate-workflow-step-pricing")).toHaveAttribute("aria-selected", "true");

  for (const width of [1440, 1024, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
  }
  if (await topTabs.isVisible()) return;

  await expect(page.getByTestId("proposal-workspace-header")).toContainText("Bathroom Remodel");
  await expect(page.getByTestId("proposal-workspace-header")).toContainText("New Lead Customer");
  await expect(page.getByTestId("proposal-nav-overview")).toContainText("Overview");
  const workflowTabs = page.getByTestId("estimate-workflow-tabs");
  await expect(workflowTabs.getByRole("tab")).toHaveCount(4);
  await expect(page.getByTestId("estimate-workflow-step-project")).toContainText("1");
  await expect(page.getByTestId("estimate-workflow-step-site_scope")).toContainText("2");
  await expect(page.getByTestId("estimate-workflow-step-pricing")).toContainText("3");
  await expect(page.getByTestId("estimate-workflow-step-review")).toContainText("4");
  await expect(page.getByTestId("estimate-workflow-step-project")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("proposal-nav-site")).toHaveCount(0);
  await page.getByTestId("estimate-workflow-next").click();
  await expect(page).toHaveURL(/section=site/);
  await expect(page.getByTestId("estimate-workflow-step-site_scope")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("proposal-nav-overview")).toHaveCount(0);
  await page.goBack();
  await expect(page.getByTestId("estimate-workflow-step-project")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("estimate-workflow-step-pricing").click();
  await expect(page.getByTestId("proposal-nav-estimate")).toBeVisible();
  await expect(page.getByTestId("proposal-nav-estimate")).toContainText("Estimate Pricing");
  await expect(page.getByTestId("proposal-nav-incidentals")).toContainText("Incidentals & Allowances");
  await page.getByTestId("estimate-workflow-step-project").click();
  await expect(page.getByTestId("proposal-nav-legend")).toContainText("Required");
  await expect(page.getByTestId("proposal-nav-legend")).toContainText("Complete");
  await expect(page.getByTestId("proposal-nav-legend")).toContainText("Needs attention");
  await expect(page.getByTestId("proposal-nav-customer")).toHaveAttribute("aria-label", /Required, Complete/);
  await expect(page.getByTestId("proposal-nav-appointment")).toHaveAttribute("aria-label", /Optional/);
  await expect(page.getByTestId("proposal-nav-overview")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Project Overview" })).toBeVisible();
  await expect(page.getByTestId("estimate-checklist-progress")).toContainText("readiness requirements complete");
  await expect(page.getByTestId("estimate-checklist-sections")).toContainText("Site & Scope");
  await expect(page.getByTestId("estimate-checklist-sections")).toContainText("Estimate Pricing");
  await expect(page.getByTestId("estimate-overview-group-pricing")).toContainText("Incidentals & Allowances");
  await expect(page.getByTestId("estimate-overview-row-adjustments")).toContainText("Optional");
  await expect(page.getByTestId("estimate-overview-row-pricing")).toHaveAttribute("aria-label", /Required, Needs attention/);
  await expect(page.getByTestId("estimate-overview-row-customer")).toHaveAttribute("aria-label", /Required, Complete/);
  await expect(page.getByTestId("estimate-overview-row-adjustments")).toHaveAttribute("aria-label", /Optional/);
  await expect(page.getByTestId("estimate-overview-action-project")).toHaveText("Review");
  await expect(page.getByTestId("estimate-overview-action-site_scope")).toHaveText("Continue");
  await expect(page.getByTestId("estimate-overview-action-pricing")).toHaveText("Continue");
  await expect(page.getByTestId("estimate-overview-action-review")).toHaveText("Check Readiness");
  const primaryGoldButtons = [
    "proposal-create-agreement-action",
    "estimate-overview-action-project",
    "estimate-overview-action-site_scope",
    "estimate-overview-action-pricing",
    "estimate-overview-action-review",
  ];
  for (const testId of primaryGoldButtons) {
    const button = page.getByTestId(testId);
    await expect(button).toHaveClass(/estimate-workflow-primary/);
    await expect(button).toHaveClass(/bg-amber-300/);
    await expect(button).toHaveClass(/text-slate-950/);
    await expect(button).not.toHaveClass(/text-white/);
    await expect(button).not.toHaveClass(/focus-visible:text-white/);
    await expect(button).not.toHaveClass(/active:text-white/);
  }
  await expect(page.getByTestId("proposal-create-agreement-action")).toHaveClass(/disabled:text-slate-600/);
  const workflowAction = page.getByTestId("estimate-overview-action-site_scope");
  const defaultGoldStyle = await workflowAction.evaluate((node) => ({
    color: getComputedStyle(node).color,
    backgroundColor: getComputedStyle(node).backgroundColor,
    descendantColors: Array.from(node.querySelectorAll("span, svg")).map((child) => getComputedStyle(child).color),
  }));
  expect(defaultGoldStyle.color).toBe("rgb(15, 23, 42)");
  expect(defaultGoldStyle.backgroundColor).toBe("rgb(252, 211, 77)");
  expect(defaultGoldStyle.descendantColors.every((color) => color !== "rgb(255, 255, 255)")).toBe(true);
  await workflowAction.hover();
  await page.waitForTimeout(220);
  const hoveredGoldStyle = await workflowAction.evaluate((node) => ({
    color: getComputedStyle(node).color,
    backgroundColor: getComputedStyle(node).backgroundColor,
  }));
  expect(hoveredGoldStyle.color).toBe("rgb(15, 23, 42)");
  expect(hoveredGoldStyle.backgroundColor).toBe("rgb(251, 191, 36)");
  await workflowAction.focus();
  const focusedGoldTextColor = await workflowAction.evaluate((node) => getComputedStyle(node).color);
  expect(focusedGoldTextColor).toBe("rgb(15, 23, 42)");
  const box = await workflowAction.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(220);
    const activeGoldStyle = await workflowAction.evaluate((node) => ({
      color: getComputedStyle(node).color,
      backgroundColor: getComputedStyle(node).backgroundColor,
    }));
    expect(activeGoldStyle.color).toBe("rgb(15, 23, 42)");
    expect(activeGoldStyle.backgroundColor).toBe("rgb(245, 158, 11)");
    await page.mouse.up();
  }
  const disabledGoldStyle = await page.getByTestId("proposal-create-agreement-action").evaluate((node) => ({
    color: getComputedStyle(node).color,
    backgroundColor: getComputedStyle(node).backgroundColor,
    descendantColors: Array.from(node.querySelectorAll("span, svg")).map((child) => getComputedStyle(child).color),
  }));
  expect(disabledGoldStyle.color).toBe("rgb(71, 85, 105)");
  expect(disabledGoldStyle.backgroundColor).toBe("rgba(253, 230, 138, 0.55)");
  expect(disabledGoldStyle.descendantColors.every((color) => color === disabledGoldStyle.color)).toBe(true);

  await expect(page.getByTestId("project-assistant-human-approval")).toHaveCount(0);
  await page.getByTestId("estimate-workflow-step-project").click();
  await page.getByTestId("proposal-nav-assistant").click();
  await expect(page.getByTestId("proposal-assistant-guidance")).toContainText("Project Assistant");
  await expect(page.getByTestId("proposal-assistant-approval-reminder")).toContainText("Contractor approval is required");
  await expect(page.getByTestId("proposal-assistant-primary-action")).toHaveClass(/text-slate-950/);
  await expect(page.getByTestId("proposal-assistant-primary-action")).not.toHaveClass(/text-white/);
  await expect(page.getByTestId("proposal-readiness-missing")).toContainText("Pricing");

  const darkTextClasses = await page.getByTestId("proposal-workspace").evaluate((root) => {
    const forbidden = ["text-black", "text-slate-950", "text-slate-900", "text-slate-800"];
    return Array.from(root.querySelectorAll("[class]"))
      .map((node) => node.getAttribute("class") || "")
      .filter((className) => !className.includes("bg-amber-300"))
      .filter((className) => forbidden.some((token) => className.includes(token)));
  });
  expect(darkTextClasses).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("proposal-workspace")).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/projects/proposals/45/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...proposal, id: 45, status: "converted", status_label: "Converted", linked_agreement_id: 450 }) });
  });
  await page.goto("/app/proposals/45", { waitUntil: "domcontentloaded" });
  await page.getByTestId("estimate-workflow-step-review").click();
  await expect(page.getByTestId("proposal-nav-ready")).toHaveAttribute("aria-label", /Required, Blocked/);
});

test("Estimate Workspace supports navigation, measurements, uploads, scope, and history", async ({ page }) => {
  test.setTimeout(60_000);
  await installBaseMocks(page);
  await installAgreementWizardMocks(page);
  let currentProposal = { ...proposal };

  await page.route("**/api/projects/proposals/42/", async (route) => {
    if (route.request().method() === "PATCH") {
      const payload = route.request().postDataJSON();
      currentProposal = {
        ...currentProposal,
        ...payload,
        activity: [{ id: 2, event_type: "scope_edited", message: "Scope details edited", created_at: "2026-07-01T16:05:00Z" }, ...currentProposal.activity],
      };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentProposal) });
  });
  await page.route("**/api/projects/proposals/42/pricing-benchmark/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        available: true,
        advisory_only: true,
        current_total: "950.00",
        classification: { project_family_key: "bathroom_remodel", scope_mode: "remodel", match_description: "Bathroom Remodel · remodel" },
        contractor: { available: true, count: 6, p25: "700.00", median: "825.00", p75: "900.00", position: "above", confidence: "medium" },
        regional: { available: false, reason: "insufficient_comparable_data", minimum_required: 5 },
        pricing_provenance: { type: "contractor_entered", template_name: "" },
      }),
    });
  });
  await page.route("**/api/projects/proposals/42/measurements/", async (route) => {
    const measurement = { id: 9, label: "Fence length", location: "Back yard", quantity: "42.00", unit: "ft", notes: "Along rear line" };
    currentProposal = { ...currentProposal, measurements: [measurement] };
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(measurement) });
  });
  await page.route("**/api/projects/proposals/42/line-items/", async (route) => {
    const payload = route.request().postDataJSON();
    const lineItem = {
      id: currentProposal.line_items.length + 20,
      category: payload.category,
      category_label: payload.category === "incidentals_reserve" ? "Incidentals Reserve" : payload.category === "labor" ? "Labor" : "Other",
      description: payload.description,
      quantity: Number(payload.quantity || 0).toFixed(2),
      unit: payload.unit || "",
      unit_price: Number(payload.unit_price || 0).toFixed(2),
      total: (Number(payload.quantity || 0) * Number(payload.unit_price || 0)).toFixed(2),
      notes: payload.notes || "",
      created_at: "2026-07-01T16:12:00Z",
      updated_at: "2026-07-01T16:12:00Z",
    };
    const lineItems = [...currentProposal.line_items, lineItem];
    const totals = calculateTotals(lineItems);
    currentProposal = { ...currentProposal, line_items: lineItems, totals };
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ line_item: lineItem, totals }),
    });
  });
  await page.route("**/api/projects/proposals/42/attachments/", async (route) => {
    const attachment = {
      id: currentProposal.attachments.length + 11,
      attachment_type: route.request().postDataBuffer().includes(Buffer.from("photo")) ? "photo" : "document",
      category: "before",
      original_name: "upload.txt",
      caption: "",
      url: "https://example.com/upload.txt",
      created_at: "2026-07-01T16:10:00Z",
    };
    currentProposal = { ...currentProposal, attachments: [attachment, ...currentProposal.attachments] };
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(attachment) });
  });

  await page.goto("/app/proposals/42", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("estimate-workflow-step-project")).toBeVisible();
  await expect(page.getByTestId("estimate-header-progress")).toContainText("% ready");
  await expect(page.getByTestId("estimate-step-panel-project")).toContainText("Customer & Contact");
  const initialProgress = Number((await page.getByTestId("estimate-header-progress").innerText()).replace(/[^0-9]/g, ""));

  await page.getByTestId("proposal-project-title").fill("Primary Bathroom Renovation");
  expect(await page.getByTestId("proposal-preferred-contact").locator("option").evaluateAll((options) => options.map((option) => option.textContent))).toEqual(["No preference", "Email", "Text", "Phone"]);
  await page.getByTestId("proposal-preferred-contact").selectOption("email");
  await expect(page.getByText("Applies to this estimate only; the customer profile is not changed.")).toBeVisible();
  await page.getByTestId("proposal-save-project-identity").click();
  await expect(page.getByTestId("proposal-project-identity")).toContainText("Project details are saved.");
  await page.screenshot({ path: "test-results/estimate-project-identity-contact.png", fullPage: true });

  await expect(page.getByTestId("proposal-project-address-workflow")).toContainText("Select Existing Property");
  await page.getByTestId("proposal-existing-property-select").selectOption("123 Main St, Austin, TX, 78701");
  await expect(page.getByTestId("proposal-existing-property-select")).toHaveValue("123 Main St, Austin, TX, 78701");
  await expect(page.getByTestId("proposal-project-address-input")).toHaveValue("123 Main St, Austin, TX, 78701");
  await page.screenshot({ path: "test-results/estimate-project-existing-property.png", fullPage: true });
  await page.getByTestId("proposal-project-address-input").fill("456 Project Lane, Austin, TX");
  await page.getByTestId("proposal-save-address-to-customer").check();
  await page.getByTestId("proposal-save-project-address").click();
  await expect(page.getByTestId("proposal-project-address-workflow")).toContainText("Project Address");

  await expect(page.getByTestId("proposal-scheduling-summary")).toContainText("priority Flexible");
  await page.getByTestId("proposal-schedule-start-type").selectOption("specific_date");
  await page.getByTestId("proposal-schedule-start-date").fill("2026-08-15");
  await page.getByTestId("proposal-schedule-completion-type").selectOption("specific_date");
  await page.getByTestId("proposal-schedule-completion-date").fill("2026-09-01");
  await page.getByTestId("proposal-schedule-priority").selectOption("required");
  await page.getByTestId("proposal-save-scheduling").click();
  await expect(page.getByTestId("proposal-scheduling-summary")).toContainText("priority Required");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("proposal-project-title")).toHaveValue("Primary Bathroom Renovation");
  await expect(page.getByTestId("proposal-preferred-contact")).toHaveValue("email");
  await expect(page.getByTestId("proposal-project-address-input")).toHaveValue("456 Project Lane, Austin, TX");
  await expect(page.getByTestId("proposal-project-address-workflow")).toContainText("This saved estimate address is used for readiness and Review.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/estimate-project-mobile-390.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.getByTestId("estimate-workflow-step-site_scope").click();
  await expect(page.getByTestId("proposal-clarification-questions")).toContainText("Square footage");
  await expect(page.getByTestId("proposal-clarification-questions")).toContainText("Material responsibility");
  await page.getByTestId("proposal-clarification-save-square_footage").click();
  await expect(page.getByText("Enter an answer before saving.")).toBeVisible();
  await page.getByTestId("proposal-clarification-answer-square_footage").fill("120 square feet");
  await page.getByTestId("proposal-clarification-save-square_footage").click();
  await expect(page.getByTestId("proposal-clarification-status-square_footage")).toContainText("Complete");
  await page.getByTestId("proposal-clarification-answer-material_responsibility").fill("Contractor supplies standard materials.");
  await page.getByTestId("proposal-clarification-save-material_responsibility").click();
  await page.getByTestId("proposal-clarification-answer-permit_responsibility").fill("Contractor will confirm permit requirements.");
  await page.getByTestId("proposal-clarification-save-permit_responsibility").click();

  await page.getByTestId("enter-walkthrough-mode").click();
  await expect(page.getByTestId("proposal-walkthrough-mode")).toBeVisible();
  await expect(page.getByTestId("walkthrough-checklist-progress")).toContainText("%");
  await expect(page.getByTestId("walkthrough-estimate-checklist")).toContainText("Measurements");
  await expect(page.getByTestId("walkthrough-primary-actions")).toContainText("Take Photo");
  await expect(page.getByTestId("walkthrough-primary-actions")).toContainText("Add Measurement");
  await expect(page.getByTestId("walkthrough-primary-actions")).toContainText("Quick Note");
  await expect(page.getByTestId("walkthrough-primary-actions")).toContainText("Voice Note");
  await expect(page.getByTestId("walkthrough-primary-actions")).toContainText("Attach Document");

  await page.getByTestId("walkthrough-estimate-checklist").getByRole("button", { name: /Measurements/ }).click();
  await expect(page).toHaveURL(/section=measurements/);
  await expect(page).toHaveURL(/from=walkthrough/);
  await expect(page.getByTestId("walkthrough-return-banner")).toContainText("Walkthrough Task");
  await expect(page.getByTestId("walkthrough-return-banner")).toContainText("Add measurement");
  await expect(page.getByTestId("proposal-measurement-form")).toBeVisible();
  await page.getByTestId("back-to-walkthrough").click();
  await expect(page).toHaveURL(/walkthrough=1/);
  await expect(page.getByTestId("proposal-walkthrough-mode")).toBeVisible();
  await expect(page.getByTestId("walkthrough-checklist-progress")).toContainText("%");

  await page.goBack();
  await expect(page.getByTestId("proposal-workspace")).toBeVisible();
  await expect(page.getByTestId("walkthrough-return-banner")).toHaveCount(0);

  await page.goto("/app/proposals/42?section=measurements", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("proposal-measurement-form")).toBeVisible();
  await expect(page.getByTestId("walkthrough-return-banner")).toHaveCount(0);

  await page.getByTestId("enter-walkthrough-mode").click();
  await expect(page.getByTestId("proposal-walkthrough-mode")).toBeVisible();
  await page.getByTestId("walkthrough-estimate-checklist").getByRole("button", { name: /Scheduling/ }).click();
  await expect(page).toHaveURL(/section=scheduling/);
  await expect(page.getByTestId("walkthrough-return-banner")).toContainText("Set scheduling");
  await expect(page.getByTestId("proposal-scheduling-summary")).toBeVisible();
  await page.getByTestId("back-to-walkthrough").click();
  await expect(page.getByTestId("proposal-walkthrough-mode")).toBeVisible();

  await page.getByTestId("walkthrough-add-measurement").click();
  await page.getByTestId("walkthrough-measurement-label").fill("Fence length");
  await page.getByTestId("walkthrough-measurement-location").fill("Back yard");
  await page.getByTestId("walkthrough-measurement-quantity").fill("42");
  await page.getByTestId("walkthrough-measurement-unit").selectOption("ft");
  await page.getByTestId("walkthrough-measurement-panel").getByRole("button", { name: /save measurement/i }).click();
  await expect(page.getByTestId("walkthrough-recent-captures")).toContainText("Fence length");

  await page.getByTestId("walkthrough-quick-note").click();
  await page.getByTestId("walkthrough-note-input").fill("Customer wants fixtures preserved.");
  await page.getByTestId("walkthrough-save-note").click();
  await expect(page.getByTestId("walkthrough-recent-captures")).toContainText("Customer wants fixtures preserved.");

  await page.getByTestId("walkthrough-check-exterior-reviewed").click();
  await expect(page.getByTestId("walkthrough-check-exterior-reviewed")).toHaveClass(/ring-emerald/);

  await page.getByTestId("walkthrough-photo-upload").setInputFiles({
    name: "walkthrough-before.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("photo"),
  });
  await expect(page.getByTestId("walkthrough-recent-captures")).toContainText("upload.txt");

  await page.getByTestId("walkthrough-document-upload").setInputFiles({
    name: "walkthrough-plan.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("document"),
  });

  await page.getByTestId("exit-walkthrough-mode").evaluate((button) => button.click());
  await expect(page.getByTestId("proposal-workspace")).toBeVisible();

  await page.getByTestId("estimate-workflow-step-site_scope").click();
  await expect(page.getByTestId("proposal-site-navigation-actions")).toContainText("Go to Photos");
  await page.getByTestId("proposal-access-notes").fill("Customer wants fixtures preserved.");
  await page.getByTestId("proposal-save-site-visit").click();

  await page.getByTestId("proposal-measurement-label").fill("Fence length");
  await page.getByTestId("proposal-measurement-location").fill("Back yard");
  await page.getByTestId("proposal-measurement-quantity").fill("42");
  await page.getByTestId("proposal-measurement-unit").selectOption("ft");
  await page.getByTestId("proposal-measurement-form").getByRole("button", { name: /add/i }).click();
  await expect(page.getByTestId("proposal-measurement-list")).toContainText("Fence length");

  await page.getByTestId("proposal-photo-upload").setInputFiles({
    name: "before.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("photo"),
  });
  await expect(page.getByTestId("proposal-photo-gallery")).toContainText("upload.txt");

  await page.getByTestId("proposal-document-upload").setInputFiles({
    name: "plan.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("document"),
  });
  await expect(page.getByTestId("proposal-document-list")).toContainText("upload.txt");

  await page.getByTestId("estimate-workflow-step-pricing").click();
  await expect(page.getByTestId("proposal-section-estimate")).toContainText("Estimate Pricing");
  await expect(page.getByTestId("proposal-section-estimate")).not.toContainText("Estimate Line Items");
  await page.screenshot({ path: "test-results/pricing-empty.png", fullPage: true });
  await page.getByTestId("pricing-empty-add").click();
  await page.screenshot({ path: "test-results/pricing-adding-item.png", fullPage: true });
  await expect(page.getByTestId("proposal-section-estimate")).toContainText("Cost Categories");
  await expect(page.getByTestId("proposal-section-estimate")).toContainText("Pricing Adjustments");
  await page.getByTestId("proposal-line-category").selectOption("labor");
  await page.getByTestId("proposal-line-description").fill("Crew labor");
  await page.getByTestId("proposal-line-quantity").fill("10");
  await page.getByTestId("proposal-line-unit").selectOption("hr");
  await page.getByTestId("proposal-line-unit-price").fill("75");
  await page.getByTestId("proposal-line-item-form").getByRole("button", { name: /save item/i }).click();
  await expect(page.getByTestId("proposal-line-item-list")).toContainText("Crew labor");
  await expect(page.getByTestId("proposal-estimate-totals")).toContainText("$750.00");
  await page.screenshot({ path: "test-results/pricing-populated.png", fullPage: true });

  await page.getByTestId("pricing-add-another").click();
  await page.getByTestId("proposal-line-category").selectOption("incidentals_reserve");
  await page.getByTestId("proposal-line-description").fill("Incidentals reserve");
  await page.getByTestId("proposal-line-quantity").fill("1");
  await page.getByTestId("proposal-line-unit").selectOption("ea");
  await page.getByTestId("proposal-line-unit-price").fill("200");
  await page.getByTestId("proposal-line-item-form").getByRole("button", { name: /save item/i }).click();
  await expect(page.getByTestId("proposal-estimate-totals")).toContainText("$950.00");
  await page.screenshot({ path: "test-results/pricing-adjustments-expanded.png", fullPage: true });
  await page.screenshot({ path: "test-results/pricing-completed.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/pricing-mobile-390.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
  await page.setViewportSize({ width: 1280, height: 900 });

  let pricingAssistantPayload;
  await page.route("**/api/projects/assistant/orchestrate/", async (route) => {
    pricingAssistantPayload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ message: "Review the saved pricing before continuing." }) });
  });
  await page.getByTestId("assistant-dock-open-button").click();
  await page.getByTestId("start-with-ai-input-dock").fill("Explain my current estimate pricing");
  await page.getByTestId("start-with-ai-submit-dock").click();
  await expect.poll(() => pricingAssistantPayload?.context?.active_workspace).toBe("pricing");
  expect(pricingAssistantPayload.context).toMatchObject({
    proposal_id: "42",
    entity_type: "proposal",
    entity_id: "42",
    proposal_summary: {
      line_item_count: 2,
      subtotal: "750.00",
      total: "950.00",
      pricing_complete: true,
    },
  });
  await page.getByTestId("assistant-desktop-dock-close").click();

  await page.getByTestId("estimate-workflow-step-site_scope").click();
  await page.getByTestId("proposal-included-work").fill("Demo, prep, and install.");
  await page.getByTestId("proposal-save-scope").click();

  await page.getByTestId("estimate-workflow-step-project").click();
  const completedProgress = Number((await page.getByTestId("estimate-header-progress").innerText()).replace(/[^0-9]/g, ""));
  expect(completedProgress).toBeGreaterThan(initialProgress);

  await page.getByTestId("estimate-workflow-step-review").click();
  await expect(page.getByTestId("estimate-ready-review-status")).toContainText("Ready for Agreement");
  await expect(page.getByTestId("estimate-review-project-summary")).toContainText("New Lead Customer");
  await expect(page.getByTestId("estimate-review-project-summary")).toContainText("456 Project Lane, Austin, TX");
  await expect(page.getByTestId("estimate-review-project-summary")).toContainText("Primary Bathroom Renovation");
  await expect(page.getByTestId("estimate-review-project-summary")).toContainText("Email");
  await page.getByTestId("estimate-review-project-summary").getByRole("button", { name: "Edit" }).click();
  await expect(page).toHaveURL(/section=customer/);
  await expect(page.getByTestId("proposal-project-title")).toHaveValue("Primary Bathroom Renovation");
  await page.goBack();
  await expect(page.getByTestId("estimate-review-project-summary")).toBeVisible();
  await expect(page.getByTestId("estimate-review-scope-summary")).toContainText("3 complete");
  await expect(page.getByTestId("estimate-review-pricing-summary")).toContainText("$950.00");
  await expect(page.getByTestId("pricing-benchmark-card")).toContainText("Pricing Benchmark");
  await expect(page.getByTestId("pricing-benchmark-business")).toContainText("Above your historical range");
  await expect(page.getByTestId("pricing-benchmark-business")).toContainText("Based on 6 completed comparable projects");
  await expect(page.getByTestId("pricing-benchmark-market")).toContainText("Insufficient comparable MyHomeBro data");
  await expect(page.getByTestId("estimate-agreement-handoff")).toContainText("Everything remains reviewable");
  await expect(page.getByTestId("estimate-ready-create-agreement")).toHaveCount(1);
  await expect(page.getByTestId("proposal-history").locator("> div")).toHaveCount(2);
  await expect(page.getByTestId("proposal-history-toggle")).toHaveAttribute("aria-expanded", "false");
  await page.getByTestId("proposal-history-toggle").click();
  await expect(page.getByTestId("proposal-history-toggle")).toHaveAttribute("aria-expanded", "true");
  expect(await page.getByTestId("proposal-history").locator("> div").count()).toBeGreaterThan(2);
  await expect(page.getByTestId("proposal-history")).toContainText("Estimate created");
  await page.screenshot({ path: "test-results/estimate-review-full-history.png", fullPage: true });
  await page.getByTestId("proposal-history-toggle").click();
  await expect(page.getByTestId("proposal-history").locator("> div")).toHaveCount(2);

  const notesSection = page.getByTestId("proposal-section-notes");
  await notesSection.locator("summary").click();
  await page.getByTestId("proposal-internal-notes").fill("Confirm crew availability before sending.");
  await expect(page.getByTestId("proposal-save-notes")).toBeVisible();
  await page.getByTestId("proposal-save-notes").click();
  await expect(page.getByTestId("proposal-save-notes")).toHaveCount(0);

  await page.getByTestId("assistant-dock-open-button").click();
  await page.getByTestId("start-with-ai-input-dock").fill("What should I review before creating the agreement?");
  await page.getByTestId("start-with-ai-submit-dock").click();
  await expect.poll(() => pricingAssistantPayload?.context?.active_workspace).toBe("review");
  expect(pricingAssistantPayload.context.proposal_summary.review).toMatchObject({
    ready: true,
    agreement_creation_available: true,
    pricing_benchmark: {
      contractor: { count: 6, position: "above" },
      regional: { available: false, minimum_required: 5 },
    },
  });
  expect(pricingAssistantPayload.context.proposal_summary.project).toMatchObject({
    customer: "New Lead Customer",
    title: "Primary Bathroom Renovation",
    service_location: "456 Project Lane, Austin, TX",
    preferred_contact: "email",
    schedule_complete: true,
  });
  await page.getByTestId("assistant-desktop-dock-close").click();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(5000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/estimate-review-ready.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/estimate-review-mobile-390.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.getByTestId("estimate-ready-create-agreement").click();
  await expect(page).toHaveURL(/\/app\/agreements\/new\/wizard\?step=1/);
  await expect(page.getByTestId("agreement-assistant-prefill-banner")).toContainText("Estimate checklist data prefilled");
  await expect(page.getByTestId("agreement-proposal-prefill-summary")).toContainText("$950.00");
  await expect(page.getByTestId("agreement-proposal-prefill-summary")).toContainText("$200.00");
  await expect(page.getByTestId("agreement-proposal-prefill-scope")).toContainText("Demo, prep, and install.");
  await expect(page.getByTestId("agreement-proposal-prefill-scope")).toContainText("Crew labor");
});

test("Clarification Questions support suggestions, editing, navigation, ignore, and reopen", async ({ page }) => {
  await installBaseMocks(page);
  await installAgreementWizardMocks(page);
  let patchCount = 0;
  let currentProposal = {
    ...proposal,
    measurements: [{ id: 91, label: "Floor area", location: "Bathroom", quantity: "120.00", unit: "sq ft", notes: "Measured onsite" }],
    quick_checklist: [
      { type: "clarification", key: "permit_responsibility", status: "ignored", answer: "", source: "contractor" },
    ],
  };
  await page.route("**/api/projects/proposals/42/", async (route) => {
    if (route.request().method() === "PATCH") {
      patchCount += 1;
      currentProposal = { ...currentProposal, ...route.request().postDataJSON() };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentProposal) });
  });

  await page.goto("/app/proposals/42?section=clarifications", { waitUntil: "domcontentloaded" });
  const squareCard = page.getByTestId("proposal-clarification-card-square_footage");
  await expect(squareCard).toContainText("Suggested");
  await expect(squareCard).toContainText("Suggested from measurements");
  await expect(squareCard).toContainText("Review this answer before accepting it.");
  await expect(page.getByTestId("proposal-clarification-answer-material_responsibility")).toBeVisible();
  await page.screenshot({ path: "test-results/clarification-needs-and-suggested.png", fullPage: true });
  await page.screenshot({ path: "test-results/clarification-auto-suggestion.png", fullPage: true });
  await page.getByTestId("proposal-clarification-answer-material_responsibility").fill("Contractor supplies finish materials.");
  await page.getByTestId("proposal-clarification-save-material_responsibility").click();
  expect(patchCount).toBe(1);
  await expect(page.getByText("Jump", { exact: true })).toHaveCount(0);
  await squareCard.getByRole("button", { name: "View source" }).click();
  await expect(page).toHaveURL(/section=measurements/);
  await page.goBack();
  await expect(page).toHaveURL(/section=clarifications/);

  await page.getByTestId("proposal-clarification-accept-square_footage").click();
  expect(patchCount).toBe(2);
  await expect(page.getByTestId("proposal-clarification-status-square_footage")).toContainText("Complete");
  await page.screenshot({ path: "test-results/clarification-completed.png", fullPage: true });
  const acceptedProgress = Number((await page.getByTestId("estimate-header-progress").innerText()).replace(/[^0-9]/g, ""));

  await squareCard.getByRole("button", { name: "Edit answer" }).click();
  await page.getByTestId("proposal-clarification-answer-square_footage").fill("122 square feet after field verification");
  await page.screenshot({ path: "test-results/clarification-editing.png", fullPage: true });
  await page.getByTestId("proposal-clarification-save-square_footage").click();
  expect(patchCount).toBe(3);
  await expect(squareCard).toContainText("122 square feet after field verification");

  await page.getByTestId("proposal-clarification-reopen-square_footage").click();
  expect(patchCount).toBe(4);
  await expect(page.getByTestId("proposal-clarification-status-square_footage")).toContainText("Reopened");
  await expect(page.getByTestId("proposal-clarification-answer-square_footage")).toBeFocused();
  await page.screenshot({ path: "test-results/clarification-reopened.png", fullPage: true });
  const reopenedProgress = Number((await page.getByTestId("estimate-header-progress").innerText()).replace(/[^0-9]/g, ""));
  expect(reopenedProgress).toBeLessThan(acceptedProgress);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("proposal-clarification-ignore-square_footage").click();
  expect(patchCount).toBe(5);
  await expect(page.getByTestId("proposal-clarification-status-square_footage")).toContainText("Ignored");
  await page.getByTestId("proposal-clarification-reopen-square_footage").click();
  expect(patchCount).toBe(6);
  await expect(page.getByTestId("proposal-clarification-status-square_footage")).toContainText("Reopened");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/clarification-mobile-390.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
});

test("Scope canonical sources and template pricing copy workflow", async ({ page }) => {
  test.setTimeout(60_000);
  await installBaseMocks(page);
  await installAgreementWizardMocks(page);
  await page.route("**/api/projects/templates/5/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      id: 5,
      name: "Bathroom Refresh Template",
      default_clarifications: [
        { key: "square_footage", label: "Square footage", question: "What square footage should the estimate use?", section: "measurements" },
        { key: "existing_photos", label: "Existing photos", question: "Are project photos available?", section: "photos" },
        { key: "material_responsibility", label: "Material responsibility", question: "Who supplies fixtures and finish materials?", section: "site" },
        { key: "permit_responsibility", label: "Permit responsibility", question: "Are permits or HOA approvals required?", section: "scope" },
      ],
      milestones: [
        { id: 501, title: "Demolition", description: "Remove existing finishes.", suggested_amount_fixed: "500.00" },
        { id: 502, title: "Installation", description: "Install selected fixtures.", suggested_amount_fixed: "1250.00" },
      ],
    }) });
  });
  await page.route(/\/api\/projects\/templates\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
      { id: 5, name: "Bathroom Refresh Template", project_type: "Bathroom", project_subtype: "Refresh", lifecycle_status: "active", is_active: true, is_system_template: false, milestone_count: 2 },
      { id: 6, name: "Built-in Bathroom", project_type: "Bathroom", lifecycle_status: "active", is_active: true, is_system_template: true, milestone_count: 3 },
    ]) });
  });
  await page.route("**/api/projects/templates/6/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: 6, name: "Built-in Bathroom", project_type: "Bathroom", lifecycle_status: "active", is_active: true, is_system_template: true, milestone_count: 2, project_materials_hint: "Tile and fixtures", milestones: [
      { id: 601, title: "Demolition", description: "Remove existing finishes.", suggested_amount_percent: "25.00", recommended_days_from_start: 0, recommended_duration_days: 2 },
      { id: 602, title: "Installation", description: "Install selected finishes.", suggested_amount_percent: "75.00", recommended_days_from_start: 2, recommended_duration_days: 5, materials_hint: "Tile and setting materials" },
    ] }) });
  });
  const scopedProposal = {
    ...proposal,
    measurements: [{ id: 91, label: "Floor area", location: "Bathroom", quantity: "120.00", unit: "sq ft", notes: "Measured onsite" }],
    attachments: [{ id: 71, attachment_type: "photo", original_name: "existing.jpg", caption: "Existing bathroom", url: "/media/existing.jpg" }],
    line_items: [],
    totals: calculateTotals([]),
  };
  await page.route("**/api/projects/proposals/42/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(scopedProposal) });
  });
  let applyCount = 0;
  const copiedItems = [
    { id: 801, category: "other", category_label: "Other", description: "Demolition", quantity: "1.00", unit: "item", unit_price: "500.00", total: "500.00", notes: "Remove existing finishes." },
    { id: 802, category: "other", category_label: "Other", description: "Installation", quantity: "1.00", unit: "item", unit_price: "1250.00", total: "1250.00", notes: "Install selected fixtures." },
  ];
  await page.route("**/api/projects/proposals/42/apply-template-pricing/", async (route) => {
    applyCount += 1;
    expect(route.request().postDataJSON()).toMatchObject({ template_id: 5, mode: "add", confirm_replace: false });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ detail: "Pricing copied from Bathroom Refresh Template", line_items: copiedItems, totals: calculateTotals(copiedItems) }) });
  });

  await page.goto("/app/proposals/42?section=clarifications", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("proposal-clarification-card-square_footage")).toContainText("Suggested from measurements");
  await expect(page.getByTestId("proposal-clarification-answer-square_footage")).toHaveCount(0);
  await expect(page.getByTestId("proposal-clarification-card-existing_photos")).toContainText("1 supporting photo attached");
  await page.screenshot({ path: "test-results/scope-source-backed-clarification.png", fullPage: true });

  await page.getByTestId("site-go-measurements").click();
  await expect(page).toHaveURL(/section=measurements/);
  await expect(page.getByTestId("proposal-measurement-form")).toBeVisible();
  await expect(page.getByTestId("proposal-measurement-list")).toContainText("120.00 SF");
  await page.goBack();
  await expect(page).toHaveURL(/section=clarifications/);
  await page.screenshot({ path: "test-results/scope-simplified.png", fullPage: true });
  await page.getByTestId("site-go-photos").click();
  await expect(page).toHaveURL(/section=photos/);
  await page.goBack();
  await page.getByTestId("site-go-documents").click();
  await expect(page).toHaveURL(/section=documents/);
  await expect(page.getByTestId("proposal-site-navigation-actions")).not.toContainText(/Quick Note|Voice Note/);
  await page.screenshot({ path: "test-results/scope-site-navigation.png", fullPage: true });

  await page.getByTestId("estimate-workflow-step-pricing").click();
  await expect(page.getByTestId("template-pricing-availability")).toContainText("Pricing guidance available");
  await page.getByRole("button", { name: "Change template" }).click();
  await expect(page.getByTestId("pricing-template-picker")).toContainText("My Templates");
  await expect(page.getByTestId("pricing-template-picker")).toContainText("Built-in Templates");
  await page.getByPlaceholder("Search name, type, or subtype").fill("Refresh");
  await expect(page.getByTestId("pricing-template-option-5")).toBeVisible();
  await expect(page.getByTestId("pricing-template-option-6")).toHaveCount(0);
  await page.screenshot({ path: "test-results/pricing-template-picker.png", fullPage: true });
  await page.getByPlaceholder("Search name, type, or subtype").fill("");
  await page.getByTestId("pricing-template-option-6").click();
  await expect(page.getByTestId("template-pricing-availability")).toContainText("Pricing basis needed");
  const estimateUrl = page.url();
  await page.getByRole("button", { name: "View template" }).click();
  await expect(page.getByTestId("estimate-template-view")).toContainText("Demolition");
  await expect(page.getByTestId("estimate-template-view")).toContainText("Day 1");
  await expect(page).toHaveURL(estimateUrl);
  await page.screenshot({ path: "test-results/pricing-template-view.png", fullPage: true });
  await page.getByRole("button", { name: "Use pricing guidance" }).click();
  await page.getByTestId("target-estimate-subtotal").fill("20000");
  await page.screenshot({ path: "test-results/pricing-basis-prompt.png", fullPage: true });
  await page.getByRole("button", { name: "Review milestone allocation" }).click();
  await expect(page.getByTestId("template-allocation-builder")).toContainText("$5,000.00");
  await expect(page.getByTestId("template-allocation-builder")).toContainText("$15,000.00");
  await page.screenshot({ path: "test-results/pricing-allocation-review.png", fullPage: true });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Change template" }).click();
  await page.getByTestId("pricing-template-option-5").click();
  await page.screenshot({ path: "test-results/pricing-template-available.png", fullPage: true });
  await page.getByTestId("apply-template-pricing-open").click();
  await expect(page.getByTestId("template-pricing-preview")).toContainText("$1,750.00");
  await page.screenshot({ path: "test-results/pricing-template-preview.png", fullPage: true });
  await page.getByTestId("apply-template-pricing-confirm").click();
  await expect(page.getByTestId("template-pricing-receipt")).toContainText("Pricing copied from Bathroom Refresh Template");
  await expect(page.getByTestId("proposal-line-item-list")).toContainText("Demolition");
  expect(applyCount).toBe(1);
  await page.screenshot({ path: "test-results/pricing-template-populated.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
  await page.screenshot({ path: "test-results/scope-mobile-390.png", fullPage: true });
});

test("Pricing validates, preserves failed edits, and guards deletion", async ({ page }) => {
  await installBaseMocks(page);
  await installAgreementWizardMocks(page);
  let failPatch = true;
  let patchRequests = 0;
  let deleteRequests = 0;
  let currentProposal = {
    ...proposal,
    line_items: [{ id: 20, category: "labor", category_label: "Labor", description: "Crew labor", quantity: "2.00", unit: "hours", unit_price: "75.00", total: "150.00", notes: "" }],
    totals: { subtotal: "150.00", tax: "0.00", discounts: "0.00", incidentals_reserve: "0.00", total: "150.00", line_item_count: 1 },
  };
  await page.route("**/api/projects/proposals/42/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentProposal) });
  });
  await page.route("**/api/projects/proposals/42/line-items/20/", async (route) => {
    if (route.request().method() === "PATCH") {
      patchRequests += 1;
      if (failPatch) return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ unit_price: ["Enter a valid unit price."] }) });
      const payload = route.request().postDataJSON();
      const lineItem = { ...currentProposal.line_items[0], ...payload, total: "180.00" };
      currentProposal = { ...currentProposal, line_items: [lineItem], totals: { ...currentProposal.totals, subtotal: "180.00", total: "180.00" } };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ line_item: lineItem, totals: currentProposal.totals }) });
    }
    deleteRequests += 1;
    currentProposal = { ...currentProposal, line_items: [], totals: { subtotal: "0.00", tax: "0.00", discounts: "0.00", incidentals_reserve: "0.00", total: "0.00", line_item_count: 0 } };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ totals: currentProposal.totals }) });
  });

  await page.goto("/app/proposals/42?section=estimate", { waitUntil: "domcontentloaded" });
  await page.getByTestId("proposal-line-item-list").getByRole("button", { name: "Edit" }).click();
  await expect(page.getByTestId("proposal-line-description")).toHaveValue("Crew labor");
  await expect(page.getByTestId("proposal-line-unit")).toHaveValue("hr");
  await page.getByTestId("proposal-line-unit-price").fill("90");
  await page.getByTestId("proposal-line-item-form").getByRole("button", { name: "Save item" }).click();
  expect(patchRequests).toBe(1);
  await expect(page.getByTestId("proposal-line-unit-price")).toHaveValue("90");
  await expect(page.getByRole("alert")).toContainText("Could not save line item");

  failPatch = false;
  await page.getByTestId("proposal-line-item-form").getByRole("button", { name: "Save item" }).click();
  expect(patchRequests).toBe(2);
  await expect(page.getByTestId("proposal-estimate-totals")).toContainText("$180.00");

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByTestId("proposal-line-item-list").getByRole("button", { name: "Remove" }).click();
  expect(deleteRequests).toBe(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("proposal-line-item-list").getByRole("button", { name: "Remove" }).click();
  expect(deleteRequests).toBe(1);
  await expect(page.getByTestId("pricing-empty-state")).toContainText("Add pricing to continue");
  await expect(page.getByTestId("estimate-workflow-step-pricing")).toHaveAttribute("aria-label", /Not started|Needs attention/);
  await page.getByTestId("pricing-empty-add").click();
  await page.getByTestId("proposal-line-description").fill("Custom unit example");
  await page.getByTestId("proposal-line-quantity").fill("1");
  await page.getByTestId("proposal-line-unit-price").fill("25");
  await page.getByTestId("proposal-line-unit").selectOption("other");
  await page.getByTestId("proposal-line-item-form").getByRole("button", { name: "Save item" }).click();
  await expect(page.getByText("Enter a custom unit.")).toBeVisible();
});
