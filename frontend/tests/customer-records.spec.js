import { expect, test } from "@playwright/test";

function authAndWhoAmI(page) {
  return Promise.all([
    page.addInitScript(() => {
      window.localStorage.setItem("access", "playwright-access-token");
    }),
    page.route("**/api/projects/whoami/", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 77,
          type: "contractor",
          role: "contractor_owner",
          identity_type: "contractor",
          email: "owner@example.com",
        }),
      });
    }),
  ]);
}

const customerListPayload = {
  count: 1,
  results: [
    {
      id: 42,
      full_name: "Jordan Customer",
      company_name: "Jordan Renovations LLC",
      email: "jordan@example.com",
      phone: "5551234567",
      status: "active",
      street_address: "18 Oak Street",
      city: "Madison",
      state: "WI",
      zip_code: "53703",
      active_projects_count: 2,
      open_requests_count: 1,
      open_balance: "2500.00",
      created_at: "2026-04-01T12:00:00Z",
      updated_at: "2026-04-14T12:00:00Z",
    },
  ],
};

const workspacePayload = {
  customer: customerListPayload.results[0],
  contact: {
    name: "Jordan Customer",
    company_name: "Jordan Renovations LLC",
    email: "jordan@example.com",
    phone: "5551234567",
    status: "active",
    address: {
      street_address: "18 Oak Street",
      city: "Madison",
      state: "WI",
      zip_code: "53703",
    },
  },
  stats: {
    active_requests: 2,
    active_agreements_projects: 3,
    open_balance: "2500.00",
    lifetime_value: "12500.00",
    last_activity: "2026-04-14T12:00:00Z",
    customer_since: "2026-04-01T12:00:00Z",
  },
  related: {
    leads: [
      {
        id: 71,
        title: "Kitchen Refresh",
        description: "Website lead",
        status: "new",
        type: "public lead",
        url: "/app/opportunities?lead=71",
      },
    ],
    project_intakes: [],
    customer_requests: [
      {
        id: 81,
        title: "Bathroom remodel",
        description: "Customer portal request",
        status: "submitted",
        type: "customer request",
        url: "/app/customers/requests?request=81",
      },
    ],
    opportunities: [
      {
        id: 91,
        title: "Deck repair",
        description: "Manual lead",
        status: "open",
        type: "opportunity",
        url: "/app/opportunities?opportunity=91",
      },
    ],
    agreements: [
      {
        id: 301,
        title: "Kitchen Agreement",
        description: "Agreement",
        status: "signed",
        total: "12500.00",
        type: "agreement",
        url: "/app/agreements/301",
      },
    ],
    projects: [],
    payments: [
      {
        id: 401,
        title: "Invoice #401",
        invoice_number: "401",
        status: "sent",
        amount: "2500.00",
        url: "/app/invoices/401",
      },
    ],
    properties: [],
    documents: [],
    communication: [],
  },
  timeline: [
    {
      type: "lead",
      title: "Kitchen Refresh",
      description: "Website lead received from Jordan Customer.",
      timestamp: "2026-04-14T12:00:00Z",
      source: "PublicContractorLead",
      source_id: 71,
      url: "/app/opportunities?lead=71",
      status: "new",
    },
    {
      type: "agreement",
      title: "Kitchen Agreement",
      description: "Agreement is signed.",
      timestamp: "2026-04-13T12:00:00Z",
      source: "Agreement",
      source_id: 301,
      url: "/app/agreements/301",
      amount: "12500.00",
      status: "signed",
    },
  ],
  gaps: {
    communication: "No contractor-side customer communication timeline is available yet.",
  },
};

async function mockCustomersWorkspaceApi(page, payload = workspacePayload) {
  await page.route("**/api/projects/homeowners/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/api/projects/homeowners/42/workspace/")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
      return;
    }
    if (pathname.endsWith("/api/projects/homeowners/42/")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(customerListPayload.results[0]) });
      return;
    }
    if (pathname.endsWith("/api/projects/homeowners/")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(customerListPayload) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Not found" }) });
  });
}

test("customer records dashboard renders requests, bids, agreements, and payments", async ({ page }) => {
  await authAndWhoAmI(page);

  await page.route("**/api/projects/intakes/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            id: 11,
            customer_name: "Jordan Customer",
            customer_email: "jordan@example.com",
            project_class: "residential",
            status: "submitted",
            ai_project_title: "Kitchen Refresh",
            accomplishment_text: "Need a kitchen refresh.",
            submitted_at: "2026-04-10T12:00:00Z",
            agreement: null,
          },
          {
            id: 12,
            customer_name: "Riley Business",
            customer_email: "riley@example.com",
            project_class: "commercial",
            status: "converted",
            ai_project_title: "Commercial Renovation",
            accomplishment_text: "Office renovation scope.",
            converted_at: "2026-04-09T12:00:00Z",
            agreement: 301,
          },
        ],
      }),
    });
  });

  await page.route("**/api/projects/contractor/bids/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: {
          total_bids: 2,
          open_bids: 1,
          under_review_bids: 0,
          awarded_bids: 1,
          declined_expired_bids: 0,
        },
        results: [
          {
            bid_id: "lead-41",
            project_title: "Kitchen Refresh",
            customer_name: "Jordan Customer",
            project_class: "residential",
            project_class_label: "Residential",
            status: "submitted",
            status_label: "Submitted",
            submitted_at: "2026-04-11T10:00:00Z",
            next_action: { key: "review", label: "Review Bid" },
            linked_agreement_id: null,
            linked_agreement_url: "",
          },
          {
            bid_id: "intake-12",
            project_title: "Commercial Renovation",
            customer_name: "Riley Business",
            project_class: "commercial",
            project_class_label: "Commercial",
            status: "expired",
            status_label: "Not Selected",
            submitted_at: "2026-04-09T11:00:00Z",
            status_note: "Another contractor was selected for this project.",
            next_action: { key: "view", label: "View Details" },
            linked_agreement_id: null,
            linked_agreement_url: "",
          },
        ],
      }),
    });
  });

  await page.route("**/api/projects/agreements/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            id: 301,
            project_title: "Commercial Renovation",
            customer_name: "Riley Business",
            project_class: "commercial",
            status: "signed",
            total_cost: "42000.00",
            updated_at: "2026-04-09T15:00:00Z",
          },
          {
            id: 302,
            project_title: "Kitchen Refresh",
            customer_name: "Jordan Customer",
            project_class: "residential",
            status: "draft",
            total_cost: "18500.00",
            updated_at: "2026-04-08T15:00:00Z",
          },
        ],
      }),
    });
  });

  await page.route("**/api/projects/invoices/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            id: 401,
            recordType: "invoice",
            agreement_id: 301,
            agreement_title: "Commercial Renovation",
            customer_name: "Riley Business",
            project_class: "commercial",
            amount: 8400,
            status: "paid",
            display_status: "Paid",
            paid_at: "2026-04-12T15:00:00Z",
          },
        ],
      }),
    });
  });

  await page.route("**/api/projects/draws/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            id: 501,
            recordType: "draw_request",
            agreement_id: 301,
            agreement_title: "Commercial Renovation",
            amount: 3600,
            payment_mode: "escrow",
            status: "paid",
            workflow_status_label: "Paid",
            project_class: "commercial",
            paid_at: "2026-04-13T15:00:00Z",
          },
        ],
      }),
    });
  });

  await page.goto("/app/customers/activity", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("customer-records-summary-requests")).toContainText("1");
  await expect(page.getByTestId("customer-records-summary-bids")).toContainText("2");
  await expect(page.getByTestId("customer-records-summary-agreements")).toContainText("2");
  await expect(page.getByTestId("customer-records-summary-payments")).toContainText("2");

  await expect(page.getByTestId("customer-records-requests-table")).toContainText("Kitchen Refresh");
  await expect(page.getByTestId("customer-records-bids-table")).toContainText("Commercial Renovation");
  await expect(page.getByTestId("customer-records-bids-table")).toContainText("Not Selected");
  await expect(page.getByTestId("customer-records-agreements-table")).toContainText("Commercial Renovation");
  await expect(page.getByTestId("customer-records-payments-table")).toContainText("Commercial Renovation");

  await expect(page.getByRole("link", { name: "View all opportunities" })).toHaveAttribute("href", "/app/opportunities");
  await expect(page.getByRole("link", { name: "View all agreements" })).toHaveAttribute("href", "/app/agreements");
  await expect(page.getByRole("link", { name: "View all payments" })).toHaveAttribute("href", "/app/payments");

  await expect(page.getByRole("link", { name: "Open Agreement" }).first()).toHaveAttribute(
    "href",
    "/app/agreements/301"
  );
  await expect(page.getByRole("link", { name: "Open Invoice" })).toHaveAttribute("href", "/app/invoices/401");
});

test("customer records dashboard shows clean empty states", async ({ page }) => {
  await authAndWhoAmI(page);

  await page.route("**/api/projects/intakes/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });
  await page.route("**/api/projects/contractor/bids/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [], summary: {} }),
    });
  });
  await page.route("**/api/projects/agreements/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });
  await page.route("**/api/projects/invoices/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });
  await page.route("**/api/projects/draws/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });

  await page.goto("/app/customers/activity", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("customer-records-summary-requests")).toContainText("0");
  await expect(page.getByTestId("customer-records-summary-bids")).toContainText("0");
  await expect(page.getByTestId("customer-records-summary-agreements")).toContainText("0");
  await expect(page.getByTestId("customer-records-summary-payments")).toContainText("0");

  await expect(page.getByTestId("customer-records-requests-table-empty")).toBeVisible();
  await expect(page.getByTestId("customer-records-bids-table-empty")).toBeVisible();
  await expect(page.getByTestId("customer-records-agreements-table-empty")).toBeVisible();
  await expect(page.getByTestId("customer-records-payments-table-empty")).toBeVisible();
});

test("customer list row opens the customer workspace and edit stays secondary", async ({ page }) => {
  await authAndWhoAmI(page);
  await mockCustomersWorkspaceApi(page);

  await page.goto("/app/customers", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("customer-row-42")).toBeVisible();
  await page.getByTestId("customer-row-42").click();
  await expect(page).toHaveURL(/\/app\/customers\/42$/);

  await page.goto("/app/customers", { waitUntil: "domcontentloaded" });
  const editLink = page.getByRole("link", { name: "Edit Customer" });
  await expect(editLink).toHaveAttribute("href", "/app/customers/42/edit");
  await editLink.click();
  await expect(page).toHaveURL(/\/app\/customers\/42\/edit$/);
});

test("customer workspace renders overview, timeline, tabs, and dark operational shell", async ({ page }) => {
  await authAndWhoAmI(page);
  await mockCustomersWorkspaceApi(page);

  await page.goto("/app/customers/42", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Jordan Renovations LLC" })).toBeVisible();
  await expect(page.locator(".mhb-operational-surface")).toBeVisible();
  await expect(page.getByTestId("customer-workspace-back-link")).toHaveAttribute("href", "/app/customers");
  await expect(page.getByTestId("customer-next-action-card")).toContainText("Respond to this request");
  await expect(page.getByTestId("customer-next-action-card")).toContainText("Bathroom remodel");
  await expect(page.getByTestId("customer-workspace-overview-cards")).toContainText("Active Requests");
  await expect(page.getByTestId("customer-workspace-overview-cards")).toContainText("$2,500.00");
  await expect(page.getByTestId("customer-workspace-timeline")).toContainText("Kitchen Refresh");
  await expect(page.getByRole("link", { name: /Open opportunity/ }).first()).toBeVisible();
  await expect(page.getByTestId("customer-workspace-tabs")).toContainText("Requests & Opportunities");
  await expect(page.getByTestId("customer-workspace-tabs")).toContainText("Communication");

  await page.getByTestId("customer-workspace-back-link").click();
  await expect(page).toHaveURL(/\/app\/customers$/);
  await page.goto("/app/customers/42", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Requests & Opportunities" }).click();
  await expect(page.getByTestId("customer-workspace-requests")).toContainText("Bathroom remodel");
  await expect(page.getByTestId("customer-workspace-requests")).toContainText("Deck repair");

  await page.getByRole("button", { name: "Projects & Agreements" }).click();
  await expect(page.getByTestId("customer-workspace-projects")).toContainText("Kitchen Agreement");

  await page.getByRole("button", { name: "Payments" }).click();
  await expect(page.getByTestId("customer-workspace-payments")).toContainText("Invoice #401");

  await page.getByRole("button", { name: "Communication" }).click();
  await expect(page.getByTestId("customer-workspace-communication")).toContainText("Add note");
  await expect(page.getByTestId("customer-workspace-communication")).toContainText("Coming soon");
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(/\u00e2/);
});

test("customer workspace shows caught up next action when no item needs work", async ({ page }) => {
  await authAndWhoAmI(page);
  await mockCustomersWorkspaceApi(page, {
    ...workspacePayload,
    stats: {
      ...workspacePayload.stats,
      last_activity: new Date().toISOString(),
      active_requests: 0,
      active_agreements_projects: 0,
      open_balance: "0.00",
    },
    related: {
      leads: [],
      project_intakes: [],
      customer_requests: [],
      opportunities: [],
      agreements: [],
      projects: [],
      payments: [],
      properties: [],
      documents: [],
      communication: [],
    },
    timeline: [],
  });

  await page.goto("/app/customers/42", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("customer-next-action-card")).toContainText("Customer is caught up");
  await expect(page.getByRole("link", { name: /New agreement/ })).toHaveAttribute("href", "/app/agreements/new/wizard?customerId=42");
});

test("customer edit uses dark operational theme and still saves", async ({ page }) => {
  await authAndWhoAmI(page);
  await mockCustomersWorkspaceApi(page);

  await page.goto("/app/customers/42/edit", { waitUntil: "domcontentloaded" });

  await expect(page.locator(".mhb-operational-surface")).toBeVisible();
  await expect(page.getByTestId("customer-edit-form")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit Customer" })).toBeVisible();
  await page.getByLabel("Full Name").fill("Jordan Updated");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page).toHaveURL(/\/app\/customers$/);
});

test("customer workspace empty states and mobile layout stay clean", async ({ page }) => {
  await authAndWhoAmI(page);
  await mockCustomersWorkspaceApi(page, {
    ...workspacePayload,
    related: {
      leads: [],
      project_intakes: [],
      customer_requests: [],
      opportunities: [],
      agreements: [],
      projects: [],
      payments: [],
      properties: [],
      documents: [],
      communication: [],
    },
    timeline: [],
  });

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/app/customers/42", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("No timeline yet")).toBeVisible();
  await page.getByRole("button", { name: "Requests & Opportunities" }).click();
  await expect(page.getByText("No requests or opportunities yet")).toBeVisible();
  await page.getByRole("button", { name: "Properties" }).click();
  await expect(page.getByTestId("customer-workspace-properties")).toContainText("Add property");
  await expect(page.getByTestId("customer-workspace-properties")).toContainText("Coming soon");
  await page.getByRole("button", { name: "Documents" }).click();
  await expect(page.getByTestId("customer-workspace-documents")).toContainText("Upload document");
  await page.getByRole("button", { name: "Communication" }).click();
  await expect(page.getByTestId("customer-workspace-communication")).toContainText("Add note");

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  );
  expect(hasHorizontalOverflow).toBeFalsy();
});
