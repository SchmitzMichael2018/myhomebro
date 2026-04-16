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

  await page.goto("/app/customer-records", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("customer-records-summary-requests")).toContainText("1");
  await expect(page.getByTestId("customer-records-summary-bids")).toContainText("2");
  await expect(page.getByTestId("customer-records-summary-agreements")).toContainText("2");
  await expect(page.getByTestId("customer-records-summary-payments")).toContainText("2");

  await expect(page.getByTestId("customer-records-requests-table")).toContainText("Kitchen Refresh");
  await expect(page.getByTestId("customer-records-bids-table")).toContainText("Commercial Renovation");
  await expect(page.getByTestId("customer-records-bids-table")).toContainText("Not Selected");
  await expect(page.getByTestId("customer-records-agreements-table")).toContainText("Commercial Renovation");
  await expect(page.getByTestId("customer-records-payments-table")).toContainText("Commercial Renovation");

  await expect(page.getByRole("link", { name: "View all bids" })).toHaveAttribute("href", "/app/bids");
  await expect(page.getByRole("link", { name: "View all agreements" })).toHaveAttribute("href", "/app/agreements");
  await expect(page.getByRole("link", { name: "View all payments" })).toHaveAttribute("href", "/app/invoices");

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

  await page.goto("/app/customer-records", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("customer-records-summary-requests")).toContainText("0");
  await expect(page.getByTestId("customer-records-summary-bids")).toContainText("0");
  await expect(page.getByTestId("customer-records-summary-agreements")).toContainText("0");
  await expect(page.getByTestId("customer-records-summary-payments")).toContainText("0");

  await expect(page.getByTestId("customer-records-requests-table-empty")).toBeVisible();
  await expect(page.getByTestId("customer-records-bids-table-empty")).toBeVisible();
  await expect(page.getByTestId("customer-records-agreements-table-empty")).toBeVisible();
  await expect(page.getByTestId("customer-records-payments-table-empty")).toBeVisible();
});
