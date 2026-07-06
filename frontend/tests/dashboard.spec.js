import { expect, test } from "@playwright/test";

const customers = [
  {
    id: 101,
    full_name: "Taylor Homeowner",
    email: "taylor@example.com",
    phone_number: "555-0101",
    street_address: "120 Oak Street",
    address_line_2: "",
    city: "Austin",
    state: "TX",
    zip_code: "78701",
  },
];

function emptyResults() {
  return { results: [] };
}

async function mockDashboard(page, { proposalId = 501, onProposalCreate = null } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
    window.localStorage.setItem("mhb_last_login_ts", String(Date.now()));
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const isBackendApi = url.port === "8000" || path.startsWith("/api/");
    if (!isBackendApi) {
      return route.continue();
    }

    if (path.endsWith("/api/projects/whoami/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 7,
          type: "contractor",
          role: "contractor_owner",
          email: "contractor@example.com",
        }),
      });
    }

    if (path.endsWith("/api/projects/contractors/me/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 77,
          business_name: "Builder Co",
          contractor_onboarding_status: "complete",
          marketplace_verification_status: "verified",
          payments: { connected: true, payouts_enabled: true },
          ai: { access: "included", enabled: true },
        }),
      });
    }

    if (path.endsWith("/api/payments/onboarding/status/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ onboarding_status: "complete", connected: true, payouts_enabled: true }),
      });
    }

    if (path.endsWith("/api/projects/homeowners/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ results: customers }),
      });
    }

    if (path.endsWith("/api/projects/proposals/") && method === "POST") {
      const payload = request.postDataJSON();
      onProposalCreate?.(payload);
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          created: true,
          proposal: {
            id: proposalId,
            source_type: "dashboard",
            source_id: 9001,
            status: "draft",
            status_label: "Draft",
            project_title: payload.project_title,
            project_summary: payload.project_description || "",
            customer_name: payload.customer_name || "Taylor Homeowner",
            customer_email: payload.customer_email || "taylor@example.com",
            customer_phone: payload.customer_phone || "555-0101",
            service_location: payload.property_address || "",
            quick_checklist: [],
            measurements: [],
            attachments: [],
            line_items: [],
            activity: [],
            totals: { subtotal: "0.00", tax: "0.00", discounts: "0.00", incidentals_reserve: "0.00", total: "0.00" },
          },
        }),
      });
    }

    if (/\/api\/projects\/proposals\/\d+\/?$/.test(path)) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: proposalId,
          source_type: "dashboard",
          source_id: 9001,
          status: "draft",
          status_label: "Draft",
          project_title: "Kitchen Estimate",
          project_summary: "",
          customer_name: "Taylor Homeowner",
          customer_email: "taylor@example.com",
          customer_phone: "555-0101",
          service_location: "120 Oak Street, Austin, TX 78701",
          quick_checklist: [],
          measurements: [],
          attachments: [],
          line_items: [],
          activity: [],
          totals: { subtotal: "0.00", tax: "0.00", discounts: "0.00", incidentals_reserve: "0.00", total: "0.00" },
        }),
      });
    }

    if (path.includes("/api/projects/dashboard/operations/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ today: [], tomorrow: [], this_week: [], recent_activity: [] }),
      });
    }

    if (path.includes("/api/projects/contractor-activation/summary/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ should_show_activation_guide: false, guide_sections: {} }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(emptyResults()),
    });
  });
}

test("dashboard quick actions show estimate-first workflow in order", async ({ page }) => {
  await mockDashboard(page);
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });

  const actions = page.getByTestId("dashboard-quick-actions-row");
  await expect(actions).toBeVisible();
  await expect(actions.getByText("Choose your workflow")).toBeVisible();

  await expect(actions.getByRole("button")).toHaveText([
    /Create Estimate\s*Primary/,
    "New Agreement",
    "Today's Schedule",
    "Expense",
    "Payment",
  ]);
});

test("Create Estimate launches workspace from an existing customer", async ({ page }) => {
  let createPayload = null;
  await mockDashboard(page, {
    proposalId: 601,
    onProposalCreate: (payload) => {
      createPayload = payload;
    },
  });
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });

  await page.getByTestId("dashboard-quick-action-create-estimate").click();
  await expect(page.getByRole("heading", { name: "Create Estimate" })).toBeVisible();
  await page.getByTestId("dashboard-estimate-customer-search").fill("Taylor");
  await page.getByTestId("dashboard-estimate-customer-101").click();
  await page.getByTestId("dashboard-estimate-existing-title").fill("Kitchen Estimate");
  await page.getByTestId("dashboard-estimate-existing-description").fill("Cabinet and backsplash refresh.");
  await page.getByTestId("dashboard-estimate-launch").click();

  await expect(page).toHaveURL(/\/app\/proposals\/601$/);
  expect(createPayload).toMatchObject({
    source_type: "dashboard",
    customer_id: 101,
    project_title: "Kitchen Estimate",
  });
});

test("Create Estimate launches workspace from a new customer capture", async ({ page }) => {
  let createPayload = null;
  await mockDashboard(page, {
    proposalId: 602,
    onProposalCreate: (payload) => {
      createPayload = payload;
    },
  });
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });

  await page.getByTestId("dashboard-quick-action-create-estimate").click();
  await page.getByTestId("dashboard-estimate-new-tab").click();
  await page.getByTestId("dashboard-estimate-new-customer").fill("Jordan Lee");
  await page.getByTestId("dashboard-estimate-new-phone").fill("555-0199");
  await page.getByTestId("dashboard-estimate-new-email").fill("jordan@example.com");
  await page.getByTestId("dashboard-estimate-new-property").fill("44 Cedar Lane, Austin, TX");
  await page.getByTestId("dashboard-estimate-new-title").fill("Bathroom Estimate");
  await page.getByTestId("dashboard-estimate-new-description").fill("Update tile, vanity, and fixtures.");
  await page.getByTestId("dashboard-estimate-new-timeline").fill("Next month");
  await page.getByTestId("dashboard-estimate-launch").click();

  await expect(page).toHaveURL(/\/app\/proposals\/602$/);
  expect(createPayload).toMatchObject({
    source_type: "dashboard",
    customer_name: "Jordan Lee",
    customer_email: "jordan@example.com",
    customer_phone: "555-0199",
    property_address: "44 Cedar Lane, Austin, TX",
    project_title: "Bathroom Estimate",
  });
});

test("dashboard quick action navigation stays wired", async ({ page }) => {
  await mockDashboard(page);
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });

  await page.getByTestId("dashboard-quick-action-new-agreement").click();
  await expect(page).toHaveURL(/\/app\/agreements\/new\/wizard\?step=1$/);

  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
  await page.getByTestId("dashboard-quick-action-todays-schedule").click();
  await expect(page).toHaveURL(/\/app\/team\/schedule$/);

  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
  await page.getByTestId("dashboard-quick-action-expense").click();
  await expect(page.getByRole("heading", { name: "New Expense" })).toBeVisible();

  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
  await page.getByTestId("dashboard-quick-action-payment").click();
  await expect(page).toHaveURL(/\/app\/payments$/);
});
