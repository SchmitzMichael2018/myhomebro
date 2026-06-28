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
      active_requests_count: 1,
      active_agreements_projects_count: 3,
      active_agreements_count: 1,
      closed_work_count: 4,
      open_balance: "2500.00",
      lifetime_value: "12500.00",
      last_activity: "Invoice activity",
      last_activity_at: "2026-04-14T12:00:00Z",
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
        project_type: "Kitchen",
        record_kind: "agreement",
        type: "agreement",
        url: "/app/agreements/301",
        action_url: "/app/agreements/301",
        action_label: "Open Agreement",
        is_archived: false,
        management: {
          can_archive: false,
          can_delete: false,
          archive_blockers: ["Only draft, completed, cancelled, or closed agreements can be archived from this workspace."],
          delete_blockers: ["Agreement has signature history."],
        },
      },
      {
        id: 302,
        title: "Basement Draft",
        description: "Early estimate draft",
        status: "draft",
        total: "900.00",
        project_type: "Basement",
        record_kind: "agreement",
        type: "agreement",
        url: "/app/agreements/302/wizard",
        action_url: "/app/agreements/302/wizard",
        action_label: "Continue Draft",
        is_archived: false,
        management: {
          can_archive: true,
          can_delete: true,
          archive_blockers: [],
          delete_blockers: [],
        },
      },
      {
        id: 303,
        title: "Cancelled Patio",
        description: "Customer cancelled before signing",
        status: "cancelled",
        total: "1200.00",
        project_type: "Patio",
        record_kind: "agreement",
        type: "agreement",
        url: "/app/agreements/303",
        action_url: "/app/agreements/303",
        action_label: "Open Agreement",
        is_archived: false,
        management: {
          can_archive: true,
          can_delete: false,
          archive_blockers: [],
          delete_blockers: ["Only draft agreements can be deleted."],
        },
      },
      {
        id: 304,
        title: "Archived Closet",
        description: "Old archived draft",
        status: "draft",
        total: "300.00",
        project_type: "Closet",
        record_kind: "agreement",
        type: "agreement",
        url: "/app/agreements/304/wizard",
        action_url: "/app/agreements/304/wizard",
        action_label: "Continue Draft",
        is_archived: true,
        management: {
          can_archive: false,
          can_delete: true,
          archive_blockers: ["Agreement is already archived."],
          delete_blockers: [],
        },
      },
    ],
    projects: [
      {
        id: 501,
        title: "Loose project",
        description: "Project without a detail destination",
        status: "in_progress",
        project_type: "Repair",
        record_kind: "project",
        type: "project",
        url: "",
        action_url: "",
        action_label: "No linked record",
        action_disabled_reason: "This project is not linked to an agreement or project detail route yet.",
        is_archived: false,
        management: {
          can_archive: false,
          can_delete: false,
          archive_blockers: ["Project records do not support archive yet."],
          delete_blockers: ["Only draft projects can be deleted."],
        },
      },
    ],
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
  let workspaceState = JSON.parse(JSON.stringify(payload));
  const communications = [...(workspaceState.related?.communication || [])];
  await page.route("**/api/projects/homeowners/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (pathname.endsWith("/api/projects/homeowners/42/project-record-actions/")) {
      const data = route.request().postDataJSON();
      const recordsToUpdate = data.records || [];
      const results = recordsToUpdate.map((record) => {
        const collection = record.type === "project" ? "projects" : "agreements";
        const current = (workspaceState.related?.[collection] || []).find((row) => String(row.id) === String(record.id));
        if (!current) {
          return { type: record.type, id: record.id, action: data.action, ok: false, status: "blocked", message: "Record not found.", blockers: ["Record not found."] };
        }
        if (data.action === "archive" && current.management?.can_archive) {
          current.is_archived = true;
          current.management.can_archive = false;
          current.management.archive_blockers = ["Record is already archived."];
          return { type: record.type, id: record.id, action: data.action, ok: true, status: "archived", message: "Agreement archived.", blockers: [] };
        }
        if (data.action === "delete" && current.management?.can_delete) {
          workspaceState.related[collection] = workspaceState.related[collection].filter((row) => String(row.id) !== String(record.id));
          return { type: record.type, id: record.id, action: data.action, ok: true, status: "deleted", message: "Draft agreement deleted.", blockers: [] };
        }
        return {
          type: record.type,
          id: record.id,
          action: data.action,
          ok: false,
          status: "blocked",
          message: data.action === "delete" ? "Agreement cannot be deleted. Archive instead." : "Record cannot be archived.",
          blockers: current.management?.delete_blockers || current.management?.archive_blockers || ["Blocked by safety rules."],
        };
      });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results }) });
      return;
    }
    if (pathname.endsWith("/api/projects/homeowners/42/communications/")) {
      if (method === "POST") {
        const data = route.request().postDataJSON();
        const created = {
          id: 900 + communications.length,
          type: "communication",
          communication_type: data.communication_type || "internal_note",
          communication_type_label:
            data.communication_type === "phone_call"
              ? "Phone call"
              : data.communication_type === "email"
              ? "Email"
              : data.communication_type === "sms"
              ? "SMS"
              : data.communication_type === "in_person"
              ? "In-person meeting"
              : "Internal note",
          direction: data.direction || "internal",
          direction_label: data.direction === "inbound" ? "Inbound" : data.direction === "outbound" ? "Outbound" : "Internal",
          subject: data.subject || "",
          title: data.subject || "Internal note",
          body: data.body || "",
          description: data.body || "",
          occurred_at: data.occurred_at || new Date().toISOString(),
          follow_up_at: data.follow_up_at || null,
          visibility: "internal_only",
          visibility_label: "Internal only",
          status: data.direction || "internal",
          url: "",
        };
        communications.unshift(created);
        await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(created) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: communications }) });
      return;
    }
    if (pathname.endsWith("/api/projects/homeowners/42/workspace/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...payload,
          ...workspaceState,
          related: {
            ...(workspaceState.related || {}),
            communication: communications,
          },
        }),
      });
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

const records = [
  {
    id: "request-11",
    type: "request",
    source: "project_intake",
    customer_id: 42,
    customer_name: "Jordan Customer",
    customer_email: "jordan@example.com",
    title: "Kitchen Refresh",
    description: "Need a kitchen refresh.",
    status: "submitted",
    amount: null,
    timestamp: "2026-04-14T12:00:00Z",
    url: "/app/intake/new?intakeId=11",
    primary_action_label: "Open request",
    needs_attention: true,
  },
  {
    id: "opportunity-41",
    type: "opportunity",
    source: "public_lead",
    customer_id: 42,
    customer_name: "Jordan Customer",
    customer_email: "jordan@example.com",
    title: "Website lead",
    description: "Public profile quote request.",
    status: "new",
    amount: null,
    timestamp: "2026-04-13T12:00:00Z",
    url: "/app/opportunities",
    primary_action_label: "Open opportunity",
    needs_attention: true,
  },
  {
    id: "agreement-301",
    type: "agreement",
    source: "agreement",
    customer_id: 43,
    customer_name: "Riley Business",
    customer_email: "riley@example.com",
    title: "Commercial Renovation",
    description: "Office renovation scope.",
    status: "signed",
    amount: "42000.00",
    timestamp: "2026-04-12T12:00:00Z",
    url: "/app/agreements/301",
    primary_action_label: "Open agreement",
    needs_attention: false,
  },
  {
    id: "invoice-401",
    type: "payment",
    source: "invoice",
    customer_id: 43,
    customer_name: "Riley Business",
    customer_email: "riley@example.com",
    title: "Invoice 401",
    description: "Commercial Renovation",
    status: "sent",
    amount: "8400.00",
    timestamp: "2026-04-11T12:00:00Z",
    url: "/app/invoices/401",
    primary_action_label: "Open invoice",
    needs_attention: true,
  },
  {
    id: "communication-1",
    type: "communication",
    source: "communication_log",
    customer_id: 42,
    customer_name: "Jordan Customer",
    customer_email: "jordan@example.com",
    title: "Phone follow-up",
    description: "Discussed cabinet pricing.",
    status: "outbound",
    amount: null,
    timestamp: "2026-04-10T12:00:00Z",
    url: "/app/customers/42#communication",
    primary_action_label: "Open communication",
    needs_attention: false,
  },
];

function summaryFor(rows) {
  return {
    all: rows.length,
    requests: rows.filter((row) => row.type === "request").length,
    opportunities: rows.filter((row) => row.type === "opportunity").length,
    agreements: rows.filter((row) => row.type === "agreement").length,
    payments: rows.filter((row) => row.type === "payment").length,
    communications: rows.filter((row) => row.type === "communication").length,
    needs_attention: rows.filter((row) => row.needs_attention).length,
  };
}

async function mockRecordsApi(page, sourceRows = records) {
  await page.route("**/api/projects/customers/records/**", async (route) => {
    const url = new URL(route.request().url());
    const type = url.searchParams.get("type");
    const needsAttention = url.searchParams.get("needs_attention");
    const search = (url.searchParams.get("search") || "").toLowerCase();
    const pageNumber = Number(url.searchParams.get("page") || 1);
    const pageSize = Number(url.searchParams.get("page_size") || 20);
    let filtered = [...sourceRows];
    if (type) filtered = filtered.filter((row) => row.type === type);
    if (needsAttention) filtered = filtered.filter((row) => row.needs_attention);
    if (search) {
      filtered = filtered.filter((row) =>
        [row.customer_name, row.customer_email, row.title, row.description].join(" ").toLowerCase().includes(search)
      );
    }
    const start = (pageNumber - 1) * pageSize;
    const pageRows = filtered.slice(start, start + pageSize);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: pageRows,
        count: filtered.length,
        summary: summaryFor(sourceRows),
        facets: { types: ["request", "opportunity", "agreement", "payment", "communication"] },
        next: start + pageSize < filtered.length ? pageNumber + 1 : null,
        previous: pageNumber > 1 ? pageNumber - 1 : null,
      }),
    });
  });
}

test("customer records hub renders unified feed, filters, and pagination", async ({ page }) => {
  await authAndWhoAmI(page);
  await mockRecordsApi(page);

  await page.goto("/app/customers/records", { waitUntil: "domcontentloaded" });

  await expect(page.locator(".mhb-operational-surface")).toBeVisible();
  await expect(page.getByTestId("hub-tabs").getByRole("link", { name: "Customers" })).toBeVisible();
  await expect(page.getByTestId("hub-tabs").getByRole("link", { name: "Records" })).toBeVisible();
  await expect(page.getByTestId("hub-tabs").getByRole("link", { name: "Activity" })).toHaveCount(0);
  await expect(page.getByTestId("hub-tabs").getByRole("link", { name: "Requests" })).toHaveCount(0);
  await expect(page.getByTestId("hub-tabs").getByRole("link", { name: "Agreements" })).toHaveCount(0);

  await expect(page.getByTestId("customer-records-summary-all")).toContainText("5");
  await expect(page.getByTestId("customer-records-summary-requests")).toContainText("1");
  await expect(page.getByTestId("customer-records-summary-opportunities")).toContainText("1");
  await expect(page.getByTestId("customer-records-summary-agreements")).toContainText("1");
  await expect(page.getByTestId("customer-records-summary-payments")).toContainText("1");
  await expect(page.getByTestId("customer-records-summary-needs_attention")).toContainText("3");
  await expect(page.getByTestId("customer-records-feed")).toContainText("Kitchen Refresh");
  await expect(page.getByTestId("customer-records-feed")).toContainText("Invoice 401");
  await expect(page.getByRole("link", { name: /Open invoice/ })).toHaveAttribute("href", "/app/invoices/401");
  await expect(page.getByRole("link", { name: "Customer workspace" }).first()).toHaveAttribute("href", "/app/customers/42");
  await expect(page.getByTestId("customer-records-pagination")).toContainText("Page 1");

  await page.getByTestId("customer-records-filter-chips").getByRole("button", { name: "Requests" }).click();
  await expect(page).toHaveURL(/\/app\/customers\/records\?type=request/);
  await expect(page.getByTestId("customer-records-feed")).toContainText("Kitchen Refresh");
  await expect(page.getByTestId("customer-records-feed")).not.toContainText("Invoice 401");

  await page.getByTestId("customer-records-filter-chips").getByRole("button", { name: "Needs Attention" }).click();
  await expect(page).toHaveURL(/needs_attention=true/);
  await expect(page.getByTestId("customer-records-feed")).toContainText("Website lead");

  await page.getByPlaceholder("Search customer, email, project, request...").fill("invoice");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/search=invoice/);
});

test("customer records legacy routes redirect into the records hub", async ({ page }) => {
  await authAndWhoAmI(page);
  await mockRecordsApi(page);

  await page.goto("/app/customers/activity", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/app\/customers\/records$/);

  await page.goto("/app/customers/requests", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/app\/customers\/records\?type=request$/);
  await expect(page.getByTestId("customer-records-feed")).toContainText("Kitchen Refresh");

  await page.goto("/app/customers/agreements", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/app\/customers\/records\?type=agreement$/);
  await expect(page.getByTestId("customer-records-feed")).toContainText("Commercial Renovation");
});

test("customer records hub shows clean empty state and mobile has no horizontal overflow", async ({ page }) => {
  await authAndWhoAmI(page);
  await mockRecordsApi(page, []);
  await page.setViewportSize({ width: 390, height: 900 });

  await page.goto("/app/customers/records", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("customer-records-summary-all")).toContainText("0");
  await expect(page.getByTestId("customer-records-empty")).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  );
  expect(hasHorizontalOverflow).toBeFalsy();
});

test("customer list row opens the customer workspace and edit stays secondary", async ({ page }) => {
  await authAndWhoAmI(page);
  await mockCustomersWorkspaceApi(page);

  await page.goto("/app/customers", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("customer-row-42")).toBeVisible();
  await expect(page.getByTestId("customer-row-42")).toContainText("1");
  await expect(page.getByTestId("customer-row-42")).toContainText("3");
  await expect(page.getByTestId("customer-row-42")).toContainText("4");
  await expect(page.getByTestId("customer-row-42")).toContainText("$2,500.00");
  await expect(page.getByTestId("customer-row-42")).toContainText("Invoice activity");
  const listBodyText = await page.locator("body").innerText();
  expect(listBodyText).not.toMatch(/\u00e2/);
  await page.getByTestId("customer-row-42").click();
  await expect(page).toHaveURL(/\/app\/customers\/42$/);

  await page.goto("/app/customers", { waitUntil: "domcontentloaded" });
  const editLink = page.getByRole("link", { name: "Edit Customer" });
  await expect(editLink).toHaveAttribute("href", "/app/customers/42/edit");
  await editLink.click();
  await expect(page).toHaveURL(/\/app\/customers\/42\/edit$/);
});

test("mobile customer cards show directory CRM metrics", async ({ page }) => {
  await authAndWhoAmI(page);
  await mockCustomersWorkspaceApi(page);
  await page.setViewportSize({ width: 390, height: 900 });

  await page.goto("/app/customers", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("customer-row-mobile-42")).toBeVisible();
  await expect(page.getByTestId("customer-row-mobile-42")).toContainText("Requests");
  await expect(page.getByTestId("customer-row-mobile-42")).toContainText("Active Work");
  await expect(page.getByTestId("customer-row-mobile-42")).toContainText("Closed Work");
  await expect(page.getByTestId("customer-row-mobile-42")).toContainText("Balance");
  await expect(page.getByTestId("customer-row-mobile-42")).toContainText("1");
  await expect(page.getByTestId("customer-row-mobile-42")).toContainText("3");
  await expect(page.getByTestId("customer-row-mobile-42")).toContainText("4");
  await expect(page.getByTestId("customer-row-mobile-42")).toContainText("$2,500.00");
  await expect(page.getByTestId("customer-row-mobile-42")).toContainText("Invoice activity");

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  );
  expect(hasHorizontalOverflow).toBeFalsy();
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
  await expect(page.getByTestId("customer-workspace-communication")).toContainText("Log Communication");
  await expect(page.getByTestId("customer-workspace-communication-list")).toContainText("No communication logged yet");
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(/\u00e2/);
});

test("customer workspace projects tab supports labels, filters, search, and safe bulk actions", async ({ page }) => {
  await authAndWhoAmI(page);
  await mockCustomersWorkspaceApi(page);

  await page.goto("/app/customers/42", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Projects & Agreements" }).click();

  const projectsTab = page.getByTestId("customer-workspace-projects");
  await expect(projectsTab).toContainText("Kitchen Agreement");
  await expect(page.getByTestId("project-agreement-card-agreement-301").getByRole("link", { name: /Open Agreement/ })).toHaveAttribute("href", "/app/agreements/301");
  await expect(page.getByTestId("project-agreement-card-agreement-302").getByRole("link", { name: /Continue Draft/ })).toHaveAttribute("href", "/app/agreements/302/wizard");
  await expect(projectsTab.getByRole("button", { name: "No linked record" })).toBeDisabled();
  await expect(projectsTab).toContainText("This project is not linked");

  await page.getByTestId("project-agreement-filters").getByRole("button", { name: "Draft" }).click();
  await expect(projectsTab).toContainText("Basement Draft");
  await expect(projectsTab).not.toContainText("Kitchen Agreement");

  await page.getByTestId("project-agreement-filters").getByRole("button", { name: "All" }).click();
  await page.getByTestId("project-agreement-search").fill("patio");
  await expect(projectsTab).toContainText("Cancelled Patio");
  await expect(projectsTab).not.toContainText("Kitchen Agreement");
  await page.getByTestId("project-agreement-search").fill("");

  await page.getByRole("button", { name: "Select records" }).click();
  await page.getByLabel("Select Basement Draft").check();
  await page.getByLabel("Select Kitchen Agreement").check();
  await expect(page.getByTestId("project-selection-toolbar")).toContainText("2");
  await expect(page.getByTestId("project-selection-toolbar")).toContainText("Deletable 1");
  await expect(page.getByTestId("project-selection-toolbar")).toContainText("Blocked 1");

  await page.getByRole("button", { name: "Delete selected drafts only" }).click();
  await expect(page.getByTestId("project-delete-confirmation")).toContainText("Delete selected draft records?");
  await expect(page.getByTestId("project-delete-confirmation")).toContainText("Selected:");
  await page.getByTestId("project-delete-confirmation").getByRole("button", { name: /Delete safe drafts/ }).click();
  await expect(projectsTab).not.toContainText("Basement Draft");
  await expect(projectsTab).toContainText("Kitchen Agreement");
  await expect(page.getByTestId("project-delete-confirmation")).toContainText("Agreement cannot be deleted");

  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByLabel("Select Cancelled Patio").check();
  await page.getByRole("button", { name: "Archive selected" }).click();
  await expect(page.getByTestId("project-archive-confirmation")).toContainText("Archive selected records?");
  await page.getByTestId("project-archive-confirmation").getByRole("button", { name: /Archive selected/ }).click();
  await expect(projectsTab).not.toContainText("Cancelled Patio");

  await page.getByTestId("project-agreement-filters").getByRole("button", { name: "Archived" }).click();
  await expect(projectsTab).toContainText("Cancelled Patio");
  await expect(projectsTab).toContainText("Archived Closet");
});

test("customer workspace projects tab mobile layout avoids horizontal overflow", async ({ page }) => {
  await authAndWhoAmI(page);
  await mockCustomersWorkspaceApi(page);
  await page.setViewportSize({ width: 390, height: 900 });

  await page.goto("/app/customers/42", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Projects & Agreements" }).click();
  await expect(page.getByTestId("customer-workspace-projects")).toContainText("Kitchen Agreement");

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  );
  expect(hasHorizontalOverflow).toBeFalsy();
});

test("customer communication tab logs notes and interactions into timeline", async ({ page }) => {
  await authAndWhoAmI(page);
  await mockCustomersWorkspaceApi(page);

  await page.goto("/app/customers/42", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Communication" }).click();
  await expect(page.getByText("No communication logged yet")).toBeVisible();

  await page.getByRole("button", { name: "Log Communication" }).click();
  const form = page.getByTestId("communication-log-form");
  await form.getByLabel("Type").selectOption("phone_call");
  await form.getByLabel("Direction").selectOption("outbound");
  await form.getByLabel("Subject").fill("Called about cabinet repair");
  await form.getByRole("textbox", { name: "Notes" }).fill("Customer prefers Friday morning.");
  await page.getByRole("button", { name: "Save Communication" }).click();

  await expect(page.getByTestId("customer-workspace-communication-list")).toContainText("Called about cabinet repair");
  await expect(page.getByTestId("customer-workspace-communication-list")).toContainText("Phone call");

  await page.getByRole("button", { name: "Timeline" }).click();
  await expect(page.getByTestId("customer-workspace-timeline")).toContainText("Called about cabinet repair");
  await expect(page.getByTestId("customer-workspace-timeline")).toContainText("Phone call");
});

test("customer communication follow-up produces next action", async ({ page }) => {
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
      communication: [
        {
          id: 701,
          type: "communication",
          communication_type: "email",
          communication_type_label: "Email",
          direction: "outbound",
          direction_label: "Outbound",
          subject: "Send cabinet options",
          body: "Follow up with pricing.",
          occurred_at: new Date(Date.now() - 86400000).toISOString(),
          follow_up_at: new Date(Date.now() - 3600000).toISOString(),
          visibility: "internal_only",
          visibility_label: "Internal only",
          status: "outbound",
          url: "",
        },
      ],
    },
    timeline: [],
  });

  await page.goto("/app/customers/42", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("customer-next-action-card")).toContainText("Follow up with this customer");
  await expect(page.getByTestId("customer-next-action-card")).toContainText("Send cabinet options");
  await page.getByRole("button", { name: /Open communication/ }).click();
  await expect(page.getByTestId("customer-workspace-communication-list")).toContainText("Send cabinet options");
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
  await expect(page.getByTestId("customer-workspace-communication")).toContainText("Log Communication");
  await expect(page.getByText("No communication logged yet")).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  );
  expect(hasHorizontalOverflow).toBeFalsy();
});
