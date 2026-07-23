import { expect, test } from "@playwright/test";

const draws = [
  {
    id: 901,
    agreement_id: 301,
    agreement_project_class: "commercial",
    agreement_title: "Office Renovation",
    draw_number: 1,
    title: "Mobilization",
    status: "submitted",
    workflow_status: "submitted",
    workflow_status_label: "Submitted",
    payment_mode: "escrow",
    net_amount: "1250.00",
    current_requested_amount: "1400.00",
    public_review_url: "https://app.myhomebro.test/draws/magic/submitted",
    line_items: [{ id: 1, milestone_title: "Mobilization" }],
  },
  {
    id: 902,
    agreement_id: 301,
    agreement_project_class: "commercial",
    agreement_title: "Office Renovation",
    draw_number: 2,
    title: "Framing",
    status: "approved",
    workflow_status: "payment_pending",
    workflow_status_label: "Payment Pending",
    payment_mode: "direct",
    net_amount: "2400.00",
    current_requested_amount: "2600.00",
    public_review_url: "https://app.myhomebro.test/draws/magic/pending",
    line_items: [{ id: 2, milestone_title: "Framing" }],
  },
];

async function mockPaymentsPage(page, extraInvoices = []) {
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

  await page.route(/\/api\/projects\/invoices\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            id: 71,
            amount: "2600.00",
            status: "approved",
            display_status: "approved",
            agreement: { id: 401, title: "Kitchen Remodel", project_class: "residential", payment_mode: "direct" },
            milestone_title: "Cabinet Install",
            invoice_number: "INV-71",
          },
          {
            id: 72,
            amount: "1100.00",
            status: "paid",
            display_status: "paid",
            agreement: { id: 301, title: "Office Renovation", project_class: "commercial", payment_mode: "escrow" },
            milestone_title: "Deposit",
            invoice_number: "INV-72",
          },
          {
            id: 73,
            amount: "900.00",
            status: "pending_approval",
            display_status: "pending_approval",
            agreement: { id: 402, title: "Bath Refresh", project_class: "residential", payment_mode: "direct" },
            milestone_title: "Tile Demo",
            invoice_number: "INV-73",
          },
          ...extraInvoices,
        ],
      }),
    });
  });

  await page.route("**/api/projects/draws/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: draws }),
    });
  });
}

test("unified payments page filters invoices and draw requests by project class, record type, and money status", async ({
  page,
}) => {
  await mockPaymentsPage(page);

  await page.goto("/app/payments", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("payments-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  await expect(page.locator("text=Awaiting Customer Approval").first()).toBeVisible();
  await expect(page.locator("text=Payment Pending").first()).toBeVisible();
  await expect(page.locator("text=Paid").first()).toBeVisible();
  await expect(page.locator("text=Resolution / Holds").first()).toBeVisible();

  await expect(page.getByTestId("payments-section-invoice-residential")).toBeVisible();
  await expect(page.getByTestId("payments-section-invoice-commercial")).toBeVisible();
  await expect(page.getByTestId("payments-section-draw_request-commercial")).toBeVisible();

  await page.getByTestId("payments-filter-project-class").selectOption("commercial");
  await expect(page.getByTestId("payments-section-invoice-commercial")).toBeVisible();
  await expect(page.getByTestId("payments-section-draw_request-commercial")).toBeVisible();
  await expect(page.getByTestId("payments-section-invoice-residential")).toHaveCount(0);

  await page.getByTestId("payments-filter-record-type").selectOption("draw_request");
  await expect(page.getByTestId("payments-section-draw_request-commercial")).toBeVisible();
  await expect(page.getByTestId("payments-section-invoice-commercial")).toHaveCount(0);

  await page.getByTestId("payments-filter-money-status").selectOption("payment_pending");
  await expect(page.getByTestId("payments-section-draw_request-commercial")).toContainText("Payment Pending");
  await expect(page.getByText("Mobilization")).toHaveCount(0);
  await expect(page.getByText("Framing")).toBeVisible();
});

test("payments pagination preserves filters, supports rows per page, and recovers to page one", async ({ page }) => {
  const extraInvoices = Array.from({ length: 10 }, (_, index) => ({
    id: 100 + index,
    amount: `${500 + index}.00`,
    status: "paid",
    display_status: "paid",
    updated_at: `2026-05-${String(20 - index).padStart(2, "0")}T12:00:00Z`,
    agreement: {
      id: 500 + index,
      title: `Pagination Project ${index + 1}`,
      project_class: "residential",
      payment_mode: "direct",
    },
    milestone_title: `Pagination Milestone ${index + 1}`,
    invoice_number: `INV-PAGE-${index + 1}`,
  }));
  await mockPaymentsPage(page, extraInvoices);

  await page.goto("/app/payments", { waitUntil: "domcontentloaded" });
  const pagination = page.getByTestId("payments-pagination");
  await expect(pagination).toContainText("Showing 1-10 of 15 payment records");
  await pagination.getByRole("button", { name: "Next" }).click();
  await expect(pagination).toContainText("Showing 11-15 of 15 payment records");

  await page.getByPlaceholder(/Search by agreement/i).fill("Pagination Project 1");
  await expect(pagination).toContainText("Showing 1-2 of 2 payment records");
  await expect(pagination).toContainText("Page 1 of 1");

  await page.getByPlaceholder(/Search by agreement/i).fill("");
  await pagination.getByLabel("Rows per page for payment records").selectOption("25");
  await expect(pagination).toContainText("Showing 1-15 of 15 payment records");
  await expect(pagination.getByRole("button", { name: "Next" })).toBeDisabled();

  await page.getByTestId("payments-filter-record-type").selectOption("draw_request");
  await expect(pagination).toContainText("Showing 1-2 of 2 payment records");
  await expect(page.getByTestId("payments-section-draw_request-commercial")).toBeVisible();
});
