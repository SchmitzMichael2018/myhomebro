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
  activity: [{ id: 1, event_type: "created", message: "Proposal created", created_at: "2026-07-01T16:00:00Z" }],
  created_at: "2026-07-01T16:00:00Z",
  updated_at: "2026-07-01T16:00:00Z",
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

test("Create Proposal from Opportunity opens Proposal Workspace", async ({ page }) => {
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
  await expect(page.getByTestId("proposal-workspace-action")).toContainText("Create Proposal");
  await page.getByTestId("proposal-workspace-action").click();

  await expect(page).toHaveURL(/\/app\/proposals\/42/);
  await expect(page.getByTestId("proposal-workspace")).toBeVisible();
  await expect(page.getByTestId("proposal-status")).toContainText("Draft");
  expect(createPayload).toEqual({ source_type: "lead", source_id: 6, estimate_appointment_id: 7001 });
});

test("Proposal Workspace supports navigation, measurements, uploads, scope, and history", async ({ page }) => {
  await installBaseMocks(page);
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

  await page.getByTestId("enter-walkthrough-mode").click();
  await expect(page.getByTestId("proposal-walkthrough-mode")).toBeVisible();
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

  await page.getByTestId("exit-walkthrough-mode").click();
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
  await expect(page.getByTestId("proposal-section-estimate")).toContainText("Estimate Builder");
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

  await page.getByTestId("proposal-nav-history").click();
  await expect(page.getByTestId("proposal-history")).toContainText("Proposal created");
});
