import { expect, test } from "@playwright/test";

const bidRows = [
  {
    bid_id: "intake-1",
    source_kind: "intake",
    source_kind_label: "Intake",
    source_id: 1,
    source_reference: "Intake #1",
    project_title: "Draft Customer Kitchen",
    customer_name: "Draft Customer",
    customer_email: "draft@example.com",
    customer_phone: "",
    project_class: "residential",
    project_class_label: "Residential",
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
    next_action: { key: "review_bid", label: "Review Bid", target: "" },
  },
  {
    bid_id: "intake-2",
    source_kind: "intake",
    source_kind_label: "Intake",
    source_id: 2,
    source_reference: "Intake #2",
    project_title: "Retail Storefront Buildout",
    customer_name: "Commercial Customer",
    customer_email: "commercial@example.com",
    customer_phone: "",
    project_class: "commercial",
    project_class_label: "Commercial",
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
    next_action: { key: "review_bid", label: "Review Bid", target: "" },
  },
  {
    bid_id: "lead-3",
    source_kind: "lead",
    source_kind_label: "Lead",
    source_id: 3,
    source_reference: "Lead #3",
    project_title: "Kitchen Remodel",
    customer_name: "Awarded Lead",
    customer_email: "award@example.com",
    customer_phone: "",
    project_class: "residential",
    project_class_label: "Residential",
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
    next_action: { key: "convert_to_agreement", label: "Convert to Agreement", target: "" },
  },
  {
    bid_id: "lead-4",
    source_kind: "lead",
    source_kind_label: "Lead",
    source_id: 4,
    source_reference: "Lead #4",
    project_title: "Office Suite Renovation",
    customer_name: "Declined Lead",
    customer_email: "declined@example.com",
    customer_phone: "",
    project_class: "commercial",
    project_class_label: "Commercial",
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
    next_action: { key: "view_details", label: "View Details", target: "" },
    status_note: "Another contractor was selected for this project.",
  },
  {
    bid_id: "lead-5",
    source_kind: "lead",
    source_kind_label: "Lead",
    source_id: 5,
    source_reference: "Lead #5",
    project_title: "Retail Buildout",
    customer_name: "Linked Commercial Lead",
    customer_email: "linked@example.com",
    customer_phone: "",
    project_class: "commercial",
    project_class_label: "Commercial",
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
    next_action: { key: "open_agreement", label: "Open Agreement", target: "/app/agreements/480" },
  },
];

function buildPayload() {
  return {
    results: bidRows,
    summary: {
      total_bids: bidRows.length,
      open_bids: 1,
      under_review_bids: 1,
      awarded_bids: 2,
      declined_expired_bids: 1,
      residential_count: 2,
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
  await expect(page.getByTestId("bids-summary-open")).toContainText("1");
  await expect(page.getByTestId("bids-summary-under-review")).toContainText("1");
  await expect(page.getByTestId("bids-summary-awarded")).toContainText("2");
  await expect(page.getByTestId("bids-summary-declined")).toContainText("1");
  await expect(page.getByTestId("bids-row-lead-4")).toContainText("Not Selected");
  expect(authHeader).toContain("Bearer ");

  await expect(page.getByTestId("bids-row-lead-3")).toContainText("Convert to Agreement");
  await expect(page.getByTestId("bids-row-lead-5")).toContainText("Open Agreement");
  await expect(page.getByTestId("bids-row-lead-4")).toContainText("Not Selected");

  await page.getByTestId("bids-row-lead-4").click();
  await expect(page.getByTestId("bids-detail-drawer")).toBeVisible();
  await expect(page.getByTestId("bids-detail-drawer")).toContainText("Another contractor was selected for this project.");
  await page.getByRole("button", { name: "Close bid details" }).click();
  await expect(page.getByTestId("bids-detail-drawer")).toHaveCount(0);

  await page.getByTestId("bids-row-lead-5").click();
  await expect(page.getByTestId("bids-detail-drawer")).toBeVisible();
  await expect(page.getByTestId("bids-detail-drawer")).toContainText("Project Class");
  await expect(page.getByTestId("bids-detail-drawer")).toContainText("Commercial");
  await expect(page.getByTestId("bids-detail-drawer")).toContainText("Commercial / Structured Preview");
  await page.getByRole("button", { name: "Close bid details" }).click();
  await expect(page.getByTestId("bids-detail-drawer")).toHaveCount(0);

  await page.getByTestId("bids-filter-project-class").selectOption("commercial");
  await expect(page.getByTestId("bids-summary-open")).toContainText("0");
  await expect(page.getByTestId("bids-summary-under-review")).toContainText("1");
  await expect(page.getByTestId("bids-summary-awarded")).toContainText("1");
  await expect(page.getByTestId("bids-summary-declined")).toContainText("1");
  await expect(page.getByTestId("bids-row-intake-2")).toBeVisible();
  await expect(page.getByTestId("bids-row-lead-4")).toBeVisible();
  await expect(page.getByTestId("bids-row-lead-5")).toBeVisible();

  await page.getByTestId("bids-filter-status").selectOption("awarded");
  await expect(page.getByTestId("bids-summary-awarded")).toContainText("1");
  await expect(page.getByTestId("bids-row-lead-5")).toBeVisible();

  await page.getByTestId("bids-filter-project-class").selectOption("all");
  await page.getByTestId("bids-filter-status").selectOption("all");
  await page.getByTestId("bids-row-action-lead-3").click();
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
  await expect(page.getByTestId("bids-empty")).toContainText("No bids match your current filters");
});
