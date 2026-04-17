import { expect, test } from "@playwright/test";

const bidRows = [
  {
    bid_id: "intake-1",
    source_kind: "intake",
    source_kind_label: "Intake",
    workspace_stage: "active_bid",
    workspace_stage_label: "Active Bid",
    source_id: 1,
    source_reference: "Intake #1",
    project_title: "Draft Customer Kitchen",
    customer_name: "Draft Customer",
    customer_email: "draft@example.com",
    customer_phone: "",
    location: "Austin, TX",
    project_class: "residential",
    project_class_label: "Residential",
    project_type: "Kitchen Remodel",
    project_subtype: "Cabinet Replacement",
    bid_amount: null,
    bid_amount_label: "-",
    submitted_at: "2026-04-10T15:20:00Z",
    status: "draft",
    status_label: "Draft",
    status_group: "open",
    linked_agreement_id: null,
    linked_agreement_label: "",
    linked_agreement_reference: "",
    linked_agreement_url: "",
    notes: "Replace attic insulation",
    timeline: "",
    budget_text: "",
    milestone_preview: [],
    request_signals: ["Guided Intake"],
    request_snapshot: {
      project_title: "Draft Customer Kitchen",
      project_type: "Kitchen Remodel",
      project_subtype: "Cabinet Replacement",
      refined_description: "Replace attic insulation",
      location: "Austin, TX",
      request_path_label: "Project request",
      measurement_handling: "",
      timeline: "",
      budget: "",
      clarification_summary: [],
      clarification_count: 0,
      photo_count: 0,
      photos: [],
      milestones: [],
      request_signals: ["Guided Intake"],
    },
    next_action: { key: "review_bid", label: "Review Bid", target: "" },
  },
  {
    bid_id: "intake-2",
    source_kind: "intake",
    source_kind_label: "Intake",
    workspace_stage: "active_bid",
    workspace_stage_label: "Active Bid",
    source_id: 2,
    source_reference: "Intake #2",
    project_title: "Retail Storefront Buildout",
    customer_name: "Commercial Customer",
    customer_email: "commercial@example.com",
    customer_phone: "",
    location: "Dallas, TX",
    project_class: "commercial",
    project_class_label: "Commercial",
    project_type: "Commercial",
    project_subtype: "Tenant Improvement",
    bid_amount: "27500.00",
    bid_amount_label: "$27,500.00",
    submitted_at: "2026-04-11T15:20:00Z",
    status: "under_review",
    status_label: "Under Review",
    status_group: "under_review",
    linked_agreement_id: null,
    linked_agreement_label: "",
    linked_agreement_reference: "",
    linked_agreement_url: "",
    notes: "Tenant buildout for a retail storefront",
    timeline: "",
    budget_text: "",
    milestone_preview: ["Demo Phase", "Buildout Phase"],
    request_signals: ["Guided Intake", "Budget Provided", "Photos", "Timeline Provided", "Clarifications Answered"],
    request_snapshot: {
      project_title: "Retail Storefront Buildout",
      project_type: "Commercial",
      project_subtype: "Tenant Improvement",
      refined_description: "Commercial tenant improvement with multiple phases.",
      location: "Dallas, TX",
      request_path_label: "Project request",
      measurement_handling: "Site visit required",
      timeline: "30 days",
      budget: "$27,500.00",
      clarification_summary: [
        { key: "materials", label: "Materials", value: "Customer" },
        { key: "start_timing", label: "Timing", value: "Next month" },
      ],
      clarification_count: 2,
      photo_count: 1,
      photos: [
        { id: 10, image_url: "https://example.com/photo.jpg", original_name: "front-room.jpg", caption: "Front room view", uploaded_at: "2026-04-11T15:00:00Z" },
      ],
      milestones: ["Demo Phase", "Buildout Phase"],
      request_signals: ["Guided Intake", "Budget Provided", "Photos", "Timeline Provided", "Clarifications Answered"],
    },
    next_action: { key: "review_bid", label: "Review Bid", target: "" },
  },
  {
    bid_id: "lead-3",
    source_kind: "lead",
    source_kind_label: "Lead",
    workspace_stage: "active_bid",
    workspace_stage_label: "Active Bid",
    source_id: 3,
    source_reference: "Lead #3",
    project_title: "Kitchen Remodel",
    customer_name: "Awarded Lead",
    customer_email: "award@example.com",
    customer_phone: "",
    location: "Austin, TX",
    project_class: "residential",
    project_class_label: "Residential",
    project_type: "Kitchen Remodel",
    bid_amount: "12000.00",
    bid_amount_label: "$12,000.00",
    submitted_at: "2026-04-12T15:20:00Z",
    status: "awarded",
    status_label: "Awarded",
    status_group: "awarded",
    linked_agreement_id: null,
    linked_agreement_label: "",
    linked_agreement_reference: "",
    linked_agreement_url: "",
    notes: "Need a kitchen remodel.",
    timeline: "",
    budget_text: "$12,000.00",
    milestone_preview: [],
    request_signals: ["Budget Provided"],
    request_snapshot: {
      project_title: "Kitchen Remodel",
      project_type: "Kitchen Remodel",
      project_subtype: "",
      refined_description: "Need a kitchen remodel.",
      location: "Austin, TX",
      request_path_label: "Project request",
      measurement_handling: "",
      timeline: "",
      budget: "$12,000.00",
      clarification_summary: [],
      clarification_count: 0,
      photo_count: 0,
      photos: [],
      milestones: [],
      request_signals: ["Budget Provided"],
    },
    next_action: { key: "convert_to_agreement", label: "Convert to Agreement", target: "" },
  },
  {
    bid_id: "lead-4",
    source_kind: "lead",
    source_kind_label: "Lead",
    workspace_stage: "closed",
    workspace_stage_label: "Closed / Archived",
    source_id: 4,
    source_reference: "Lead #4",
    project_title: "Office Suite Renovation",
    customer_name: "Declined Lead",
    customer_email: "declined@example.com",
    customer_phone: "",
    location: "Houston, TX",
    project_class: "commercial",
    project_class_label: "Commercial",
    project_type: "Commercial",
    bid_amount: null,
    bid_amount_label: "-",
    submitted_at: "2026-04-13T15:20:00Z",
    status: "expired",
    status_label: "Not Selected",
    status_group: "declined_expired",
    linked_agreement_id: null,
    linked_agreement_label: "",
    linked_agreement_reference: "",
    linked_agreement_url: "",
    notes: "Office suite renovation.",
    timeline: "",
    budget_text: "",
    milestone_preview: [],
    request_signals: [],
    request_snapshot: {
      project_title: "Office Suite Renovation",
      project_type: "Commercial",
      project_subtype: "",
      refined_description: "Office suite renovation.",
      location: "Houston, TX",
      request_path_label: "Project request",
      measurement_handling: "",
      timeline: "",
      budget: "",
      clarification_summary: [],
      clarification_count: 0,
      photo_count: 0,
      photos: [],
      milestones: [],
      request_signals: [],
    },
    next_action: { key: "view_details", label: "View Details", target: "" },
    status_note: "Another contractor was selected for this project.",
  },
  {
    bid_id: "lead-5",
    source_kind: "lead",
    source_kind_label: "Lead",
    workspace_stage: "active_bid",
    workspace_stage_label: "Active Bid",
    source_id: 5,
    source_reference: "Lead #5",
    project_title: "Retail Buildout",
    customer_name: "Linked Commercial Lead",
    customer_email: "linked@example.com",
    customer_phone: "",
    location: "Dallas, TX",
    project_class: "commercial",
    project_class_label: "Commercial",
    project_type: "Tenant Buildout",
    bid_amount: "48000.00",
    bid_amount_label: "$48,000.00",
    submitted_at: "2026-04-09T15:20:00Z",
    status: "awarded",
    status_label: "Awarded",
    status_group: "awarded",
    linked_agreement_id: 480,
    linked_agreement_label: "Retail Buildout",
    linked_agreement_reference: "Agreement #480",
    linked_agreement_url: "/app/agreements/480",
    notes: "Commercial retail buildout.",
    timeline: "",
    budget_text: "",
    milestone_preview: ["Demo Phase", "Buildout Phase"],
    request_signals: ["Photos", "Timeline Provided"],
    request_snapshot: {
      project_title: "Retail Buildout",
      project_type: "Tenant Buildout",
      project_subtype: "Retail Buildout",
      refined_description: "Commercial retail buildout.",
      location: "Dallas, TX",
      request_path_label: "Project request",
      measurement_handling: "Provided",
      timeline: "45 days",
      budget: "$48,000.00",
      clarification_summary: [],
      clarification_count: 0,
      photo_count: 2,
      photos: [
        { id: 20, image_url: "https://example.com/lead-photo-1.jpg", original_name: "layout.png", caption: "Layout", uploaded_at: "2026-04-09T15:00:00Z" },
        { id: 21, image_url: "", original_name: "sketch.pdf", caption: "Sketch", uploaded_at: "2026-04-09T15:05:00Z" },
      ],
      milestones: ["Demo Phase", "Buildout Phase"],
      request_signals: ["Photos", "Timeline Provided"],
    },
    next_action: { key: "open_agreement", label: "Open Agreement", target: "/app/agreements/480" },
  },
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
    customer_email: "newlead@example.com",
    customer_phone: "",
    location: "Austin, TX",
    project_class: "residential",
    project_class_label: "Residential",
    project_type: "Bathroom Remodel",
    project_subtype: "Primary Bath",
    bid_amount: "18500.00",
    bid_amount_label: "$18,500.00",
    submitted_at: "2026-04-14T15:20:00Z",
    status: "submitted",
    status_label: "Submitted",
    status_group: "open",
    linked_agreement_id: null,
    linked_agreement_label: "",
    linked_agreement_reference: "",
    linked_agreement_url: "",
    notes: "Replace shower tile and vanity.",
    timeline: "21 days",
    budget_text: "$18,500.00",
    milestone_preview: ["Demolition", "Tile and Fixtures"],
    request_signals: ["Guided Intake", "Photos", "Budget Provided", "Timeline Provided", "Clarifications Answered", "Multi-Quote Request"],
    request_snapshot: {
      project_title: "Bathroom Remodel",
      project_type: "Bathroom Remodel",
      project_subtype: "Primary Bath",
      refined_description: "Replace shower tile and vanity.",
      location: "Austin, TX",
      request_path_label: "Multi-quote request",
      measurement_handling: "Provided",
      timeline: "21 days",
      budget: "$18,500.00",
      clarification_summary: [
        { key: "materials", label: "Materials", value: "Contractor" },
        { key: "layout", label: "Layout", value: "No layout changes" },
      ],
      clarification_count: 2,
      photo_count: 1,
      photos: [
        { id: 30, image_url: "https://example.com/bathroom.jpg", original_name: "bathroom.jpg", caption: "Shower area", uploaded_at: "2026-04-14T15:00:00Z" },
      ],
      milestones: ["Demolition", "Tile and Fixtures"],
      request_signals: ["Guided Intake", "Photos", "Budget Provided", "Timeline Provided", "Clarifications Answered", "Multi-Quote Request"],
    },
    next_action: { key: "review_bid", label: "Review Request", target: "" },
  },
  {
    bid_id: "lead-7",
    source_kind: "lead",
    source_kind_label: "Lead",
    workspace_stage: "new_lead",
    workspace_stage_label: "New Lead",
    source_id: 7,
    source_reference: "Lead #7",
    project_title: "Guest Bath Refresh",
    customer_name: "Need More Info",
    customer_email: "guestbath@example.com",
    customer_phone: "",
    location: "Round Rock, TX",
    project_class: "residential",
    project_class_label: "Residential",
    project_type: "Bathroom Remodel",
    project_subtype: "Guest Bath",
    bid_amount: null,
    bid_amount_label: "-",
    submitted_at: "2026-04-08T15:20:00Z",
    status: "submitted",
    status_label: "Submitted",
    status_group: "open",
    linked_agreement_id: null,
    linked_agreement_label: "",
    linked_agreement_reference: "",
    linked_agreement_url: "",
    notes: "Need a quote for a guest bath refresh.",
    timeline: "",
    budget_text: "",
    milestone_preview: [],
    request_signals: ["Guided Intake"],
    request_snapshot: {
      project_title: "Guest Bath Refresh",
      project_type: "Bathroom Remodel",
      project_subtype: "Guest Bath",
      refined_description: "Need a quote for a guest bath refresh.",
      location: "Round Rock, TX",
      request_path_label: "Project request",
      measurement_handling: "",
      timeline: "",
      budget: "",
      clarification_summary: [],
      clarification_count: 0,
      photo_count: 0,
      photos: [],
      milestones: [],
      request_signals: ["Guided Intake"],
    },
    next_action: { key: "review_bid", label: "Review Request", target: "" },
  },
];

function buildPayload() {
  return {
    results: bidRows,
    summary: {
      total_bids: bidRows.length,
      new_leads: 2,
      active_bids: 4,
      closed: 1,
      open_bids: 2,
      under_review_bids: 1,
      awarded_bids: 2,
      declined_expired_bids: 1,
      residential_count: 3,
      commercial_count: 3,
    },
    filters: {
      status: "all",
      project_class: "all",
      search: "",
    },
  };
}

test("contractor bids workspace renders, filters, opens details, and converts awarded rows", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  let authHeader = "";
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

  await page.route("**/api/projects/contractor/bids/**", async (route) => {
    authHeader = route.request().headers().authorization || route.request().headers().Authorization || "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildPayload()),
    });
  });

  await page.route("**/api/projects/contractor/public-leads/3/create-agreement/**", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        agreement_id: 900,
        detail_url: "/app/agreements/900",
        wizard_url: "/app/agreements/900/wizard?step=1",
        created: true,
      }),
    });
  });

  await page.goto("/app/bids", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("contractor-bids-title")).toBeVisible();
  await expect(page.getByTestId("leads-tab-new")).toContainText("2");
  await expect(page.getByTestId("leads-tab-active")).toContainText("4");
  await expect(page.getByTestId("leads-tab-closed")).toContainText("Closed / Archived");
  await expect(page.getByTestId("bids-summary-new-leads")).toContainText("2");
  await expect(page.getByTestId("bids-summary-active-bids")).toContainText("4");
  await expect(page.getByTestId("bids-summary-closed")).toContainText("1");
  await expect(page.getByTestId("bids-summary-total")).toContainText("7");
  await expect(page.getByTestId("lead-row-lead-6")).toContainText("New Lead");
  await expect(page.getByTestId("lead-row-lead-6")).toContainText("Guided Intake");
  await expect(page.getByTestId("lead-row-lead-6")).toContainText("Photos");
  await expect(page.getByTestId("lead-row-action-lead-6")).toContainText("Review Request");
  await expect(page.locator('tr[data-testid^="lead-row-"]')).toHaveCount(2);
  await expect(page.locator('tr[data-testid^="lead-row-"]').nth(0)).toContainText("Bathroom Remodel");
  await expect(page.locator('tr[data-testid^="lead-row-"]').nth(1)).toContainText("Guest Bath Refresh");
  expect(authHeader).toContain("Bearer ");

  await page.getByTestId("workspace-sort-control").selectOption("needs_attention");
  await expect(page.locator('tr[data-testid^="lead-row-"]').nth(0)).toContainText("Guest Bath Refresh");
  await expect(page.locator('tr[data-testid^="lead-row-"]').nth(1)).toContainText("Bathroom Remodel");

  await page.getByTestId("workspace-sort-control").selectOption("recommended");
  await page.getByTestId("workspace-filter-has_photos").click();
  await expect(page.locator('tr[data-testid^="lead-row-"]')).toHaveCount(1);
  await expect(page.getByTestId("lead-row-lead-6")).toBeVisible();

  await page.getByTestId("lead-row-action-lead-6").click();
  await expect(page.getByTestId("lead-detail-container")).toBeVisible();
  await expect(page.getByTestId("lead-overview")).toContainText("Project Title");
  await expect(page.getByTestId("project-snapshot")).toContainText("Refined Description");
  await expect(page.getByTestId("photos-section")).toContainText("Shower area");
  await expect(page.getByTestId("project-phases-section")).toContainText("Demolition");
  await expect(page.getByTestId("request-signals-section")).toContainText("Multi-Quote Request");
  await expect(page.getByTestId("suggested-next-step-section")).toContainText("Review the request");
  await expect(page.getByTestId("lead-detail-primary-action")).toContainText("Review and Respond");
  await page.getByRole("button", { name: "Close bid details" }).click();
  await expect(page.getByTestId("bids-detail-drawer")).toHaveCount(0);

  await page.getByTestId("workspace-filter-all").click();

  await page.getByTestId("leads-tab-active").click();
  await expect(page.getByTestId("lead-row-intake-2")).toContainText("Active Bid");
  await expect(page.getByTestId("lead-row-lead-3")).toContainText("Active Bid");
  await expect(page.getByTestId("lead-row-lead-5")).toContainText("Open Agreement");
  await expect(page.getByTestId("lead-row-intake-2")).toContainText("Guided Intake");

  await page.getByTestId("leads-tab-closed").click();
  await expect(page.getByTestId("lead-row-lead-4")).toContainText("Closed / Archived");
  await page.getByTestId("lead-row-lead-4").click();
  await expect(page.getByTestId("lead-detail-container")).toBeVisible();
  await expect(page.getByTestId("suggested-next-step-section")).toContainText("closed for now");
  await page.getByRole("button", { name: "Close bid details" }).click();
  await expect(page.getByTestId("bids-detail-drawer")).toHaveCount(0);

  await page.getByTestId("leads-tab-active").click();
  await page.getByTestId("lead-row-lead-5").click();
  await expect(page.getByTestId("lead-detail-container")).toBeVisible();
  await expect(page.getByTestId("lead-overview")).toContainText("Project Title");
  await expect(page.getByTestId("project-snapshot")).toContainText("Refined Description");
  await expect(page.getByTestId("project-snapshot")).toContainText("Budget");
  await expect(page.getByTestId("photos-section")).toContainText("layout.png");
  await expect(page.getByTestId("project-phases-section")).toContainText("Demo Phase");
  await expect(page.getByTestId("request-signals-section")).toContainText("Photos");
  await expect(page.getByTestId("lead-detail-primary-action")).toContainText("Open Agreement");
  await page.getByRole("button", { name: "Close bid details" }).click();
  await expect(page.getByTestId("bids-detail-drawer")).toHaveCount(0);

  await page.getByTestId("bids-filter-project-class").selectOption("commercial");
  await expect(page.getByTestId("lead-row-intake-2")).toBeVisible();
  await expect(page.getByTestId("lead-row-lead-5")).toBeVisible();

  await page.getByTestId("bids-filter-status").selectOption("awarded");
  await expect(page.getByTestId("lead-row-lead-5")).toBeVisible();

  await page.getByTestId("bids-filter-project-class").selectOption("all");
  await page.getByTestId("bids-filter-status").selectOption("all");
  await page.getByTestId("leads-tab-active").click();
  await page.getByTestId("lead-row-action-lead-3").click();
  await expect(page).toHaveURL("/app/agreements/900/wizard?step=1");

  await page.screenshot({ path: "test-results/contractor-bids.png", fullPage: true });

  expect(consoleErrors.filter((msg) => msg.includes("Failed to load bids"))).toHaveLength(0);
});

test("contractor bids workspace shows a friendly empty state", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

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

  await page.route("**/api/projects/contractor/bids/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [],
        summary: {
          total_bids: 0,
          open_bids: 0,
          under_review_bids: 0,
          awarded_bids: 0,
          declined_expired_bids: 0,
          residential_count: 0,
          commercial_count: 0,
        },
        filters: {
          status: "all",
          project_class: "all",
          search: "",
        },
      }),
    });
  });

  await page.goto("/app/bids", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("bids-empty")).toContainText("No opportunities match your current filters");
});
