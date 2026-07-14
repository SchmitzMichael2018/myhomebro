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

  await expect(page.getByTestId("proposal-workspace-header")).toContainText("Bathroom Remodel");
  await expect(page.getByTestId("proposal-workspace-header")).toContainText("New Lead Customer");
  await expect(page.getByTestId("proposal-nav-overview")).toContainText("Project Overview");
  await expect(page.getByTestId("proposal-nav")).toContainText("Project");
  await expect(page.getByTestId("proposal-nav")).toContainText("Site & Scope");
  await expect(page.getByTestId("proposal-nav")).toContainText("Pricing");
  await expect(page.getByTestId("proposal-nav")).toContainText("Review");
  const navText = (await page.getByTestId("proposal-nav").innerText()).toLowerCase();
  expect(navText.indexOf("customer & contact")).toBeLessThan(navText.indexOf("site & scope"));
  expect(navText.indexOf("site & scope")).toBeLessThan(navText.indexOf("estimate pricing"));
  expect(navText.indexOf("pricing")).toBeLessThan(navText.indexOf("ready for agreement"));
  await expect(page.getByTestId("proposal-nav-estimate")).toContainText("Estimate Pricing");
  await expect(page.getByTestId("proposal-nav-incidentals")).toContainText("Incidentals & Allowances");
  await expect(page.getByTestId("proposal-nav")).not.toContainText("Line Items");
  await expect(page.getByTestId("proposal-nav-overview")).toHaveClass(/border-sky-300/);
  await expect(page.getByRole("heading", { name: "Project Overview" })).toBeVisible();
  await expect(page.getByTestId("estimate-checklist-progress")).toContainText("readiness requirements complete");
  await expect(page.getByTestId("estimate-checklist-sections")).toContainText("Site & Scope");
  await expect(page.getByTestId("estimate-checklist-sections")).toContainText("Estimate Pricing");
  await expect(page.getByTestId("estimate-overview-group-pricing")).toContainText("Incidentals & Allowances");
  await expect(page.getByTestId("estimate-overview-row-pricing")).toContainText("Required");
  await expect(page.getByTestId("estimate-overview-row-adjustments")).toContainText("Optional");

  await expect(page.getByTestId("project-assistant-human-approval")).toHaveCount(0);
  await page.getByTestId("proposal-nav-assistant").click();
  await expect(page.getByTestId("proposal-assistant-guidance")).toContainText("Project Assistant");
  await expect(page.getByTestId("proposal-assistant-approval-reminder")).toContainText("Contractor approval is required");
  await expect(page.getByTestId("proposal-readiness-missing")).toContainText("Pricing");

  const darkTextClasses = await page.getByTestId("proposal-workspace").evaluate((root) => {
    const forbidden = ["text-black", "text-slate-950", "text-slate-900", "text-slate-800"];
    return Array.from(root.querySelectorAll("[class]"))
      .map((node) => node.getAttribute("class") || "")
      .filter((className) => forbidden.some((token) => className.includes(token)));
  });
  expect(darkTextClasses).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("proposal-workspace")).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});

test("Estimate Workspace supports navigation, measurements, uploads, scope, and history", async ({ page }) => {
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
  await expect(page.getByTestId("proposal-nav-site")).toBeVisible();
  await expect(page.getByTestId("estimate-checklist-progress")).toContainText("%");
  await expect(page.getByTestId("estimate-checklist-sections")).toContainText("Customer");
  await expect(page.getByTestId("estimate-checklist-sections")).toContainText("Project Address");
  await expect(page.getByTestId("estimate-checklist-sections")).toContainText("Estimate Pricing");
  await expect(page.getByTestId("estimate-overview-row-customer")).toContainText("Done");
  await expect(page.getByTestId("estimate-ready-status")).toContainText("Required items missing");
  const initialProgress = Number((await page.getByTestId("estimate-summary-progress").innerText()).replace("%", ""));

  await page.getByTestId("proposal-nav-customer").click();
  await expect(page.getByTestId("proposal-project-address-workflow")).toContainText("Select Existing Property");
  await page.getByTestId("proposal-existing-property-select").selectOption("123 Main St, Austin, TX, 78701");
  await page.getByTestId("proposal-project-address-input").fill("456 Project Lane, Austin, TX");
  await page.getByTestId("proposal-save-address-to-customer").check();
  await page.getByTestId("proposal-save-project-address").click();
  await expect(page.getByTestId("proposal-project-address-workflow")).toContainText("Project Address");

  await page.getByTestId("proposal-nav-scheduling").click();
  await expect(page.getByTestId("proposal-scheduling-summary")).toContainText("priority Flexible");
  await page.getByTestId("proposal-schedule-start-type").selectOption("specific_date");
  await page.getByTestId("proposal-schedule-start-date").fill("2026-08-15");
  await page.getByTestId("proposal-schedule-completion-type").selectOption("specific_date");
  await page.getByTestId("proposal-schedule-completion-date").fill("2026-09-01");
  await page.getByTestId("proposal-schedule-priority").selectOption("required");
  await page.getByTestId("proposal-save-scheduling").click();
  await expect(page.getByTestId("proposal-scheduling-summary")).toContainText("priority Required");
  await expect(page.getByTestId("proposal-summary-scheduling")).toContainText("Required");

  await page.getByTestId("proposal-nav-assistant").click();
  await expect(page.getByTestId("proposal-template-recommendation")).toContainText("Recommended agreement template");
  await expect(page.getByTestId("proposal-template-recommendation")).toContainText("Bathroom Refresh Template");
  await page.getByTestId("proposal-use-template").click();

  await page.getByTestId("proposal-nav-clarifications").click();
  await expect(page.getByTestId("proposal-clarification-questions")).toContainText("Square footage");
  await expect(page.getByTestId("proposal-clarification-questions")).toContainText("Material responsibility");
  await page.getByTestId("proposal-clarification-complete-square_footage").click();
  await page.getByTestId("proposal-clarification-complete-material_responsibility").click();
  await page.getByTestId("proposal-clarification-complete-permit_responsibility").click();

  await page.getByTestId("enter-walkthrough-mode").click();
  await expect(page.getByTestId("proposal-walkthrough-mode")).toBeVisible();
  await expect(page.getByTestId("walkthrough-checklist-progress")).toContainText("%");
  await expect(page.getByTestId("walkthrough-estimate-checklist")).toContainText("Measurements");
  await expect(page.getByTestId("walkthrough-primary-actions")).toContainText("Take Photo");
  await expect(page.getByTestId("walkthrough-primary-actions")).toContainText("Add Measurement");
  await expect(page.getByTestId("walkthrough-primary-actions")).toContainText("Quick Note");
  await expect(page.getByTestId("walkthrough-primary-actions")).toContainText("Voice Note");
  await expect(page.getByTestId("walkthrough-primary-actions")).toContainText("Attach Document");

  await page.getByTestId("walkthrough-add-measurement").click();
  await page.getByTestId("walkthrough-measurement-label").fill("Fence length");
  await page.getByTestId("walkthrough-measurement-location").fill("Back yard");
  await page.getByTestId("walkthrough-measurement-quantity").fill("42");
  await page.getByTestId("walkthrough-measurement-unit").fill("ft");
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

  await page.getByTestId("proposal-nav-site").click();
  await expect(page.getByTestId("proposal-mobile-capture-actions")).toContainText("Take Photo");
  await page.getByTestId("proposal-site-notes").fill("Customer wants fixtures preserved.");
  await page.getByTestId("proposal-save-site-visit").click();

  await page.getByTestId("proposal-nav-measurements").click();
  await page.getByTestId("proposal-measurement-label").fill("Fence length");
  await page.getByTestId("proposal-measurement-location").fill("Back yard");
  await page.getByTestId("proposal-measurement-quantity").fill("42");
  await page.getByTestId("proposal-measurement-unit").fill("ft");
  await page.getByTestId("proposal-measurement-form").getByRole("button", { name: /add/i }).click();
  await expect(page.getByTestId("proposal-measurement-list")).toContainText("Fence length");

  await page.getByTestId("proposal-nav-photos").click();
  await page.getByTestId("proposal-photo-upload").setInputFiles({
    name: "before.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("photo"),
  });
  await expect(page.getByTestId("proposal-photo-gallery")).toContainText("upload.txt");

  await page.getByTestId("proposal-nav-documents").click();
  await page.getByTestId("proposal-document-upload").setInputFiles({
    name: "plan.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("document"),
  });
  await expect(page.getByTestId("proposal-document-list")).toContainText("upload.txt");

  await page.getByTestId("proposal-nav-estimate").click();
  await expect(page.getByTestId("proposal-section-estimate")).toContainText("Estimate Pricing");
  await expect(page.getByTestId("proposal-section-estimate")).not.toContainText("Estimate Line Items");
  await expect(page.getByTestId("proposal-section-estimate")).not.toContainText(/milestone/i);
  await expect(page.getByTestId("proposal-section-estimate")).toContainText("Cost Categories");
  await expect(page.getByTestId("proposal-section-estimate")).toContainText("Pricing Adjustments");
  await page.getByTestId("proposal-line-category").selectOption("labor");
  await page.getByTestId("proposal-line-description").fill("Crew labor");
  await page.getByTestId("proposal-line-quantity").fill("10");
  await page.getByTestId("proposal-line-unit").fill("hours");
  await page.getByTestId("proposal-line-unit-price").fill("75");
  await page.getByTestId("proposal-line-item-form").getByRole("button", { name: /add/i }).click();
  await expect(page.getByTestId("proposal-line-item-list")).toContainText("Crew labor");
  await expect(page.getByTestId("proposal-estimate-totals")).toContainText("$750.00");

  await page.getByTestId("proposal-line-category").selectOption("incidentals_reserve");
  await page.getByTestId("proposal-line-description").fill("Incidentals reserve");
  await page.getByTestId("proposal-line-quantity").fill("1");
  await page.getByTestId("proposal-line-unit").fill("reserve");
  await page.getByTestId("proposal-line-unit-price").fill("200");
  await page.getByTestId("proposal-line-item-form").getByRole("button", { name: /add/i }).click();
  await expect(page.getByTestId("proposal-estimate-totals")).toContainText("$950.00");
  await expect(page.getByTestId("proposal-summary-totals")).toContainText("$950.00");

  await page.getByTestId("proposal-nav-scope").click();
  await page.getByTestId("proposal-included-work").fill("Demo, prep, and install.");
  await page.getByTestId("proposal-save-scope").click();

  await page.getByTestId("proposal-nav-overview").click();
  const completedProgress = Number((await page.getByTestId("estimate-summary-progress").innerText()).replace("%", ""));
  expect(completedProgress).toBeGreaterThan(initialProgress);
  await expect(page.getByTestId("estimate-ready-status")).toContainText("Estimate Ready");

  await page.getByTestId("proposal-nav-history").click();
  await expect(page.getByTestId("proposal-history")).toContainText("Estimate created");

  await page.getByTestId("proposal-summary-create-agreement").click();
  await expect(page).toHaveURL(/\/app\/agreements\/new\/wizard\?step=1/);
  await expect(page.getByTestId("agreement-assistant-prefill-banner")).toContainText("Estimate checklist data prefilled");
  await expect(page.getByTestId("agreement-proposal-prefill-summary")).toContainText("$950.00");
  await expect(page.getByTestId("agreement-proposal-prefill-summary")).toContainText("$200.00");
  await expect(page.getByTestId("agreement-proposal-prefill-scope")).toContainText("Demo, prep, and install.");
  await expect(page.getByTestId("agreement-proposal-prefill-scope")).toContainText("Crew labor");
});
