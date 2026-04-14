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

async function mockPaymentsPage(page) {
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

  await page.goto("/app/invoices", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("payments-page")).toBeVisible();
  await expect(page.getByText("Payments")).toBeVisible();
  await expect(page.locator("text=Awaiting Customer Approval").first()).toBeVisible();
  await expect(page.locator("text=Payment Pending").first()).toBeVisible();
  await expect(page.locator("text=Paid").first()).toBeVisible();
  await expect(page.locator("text=Issues / Disputes").first()).toBeVisible();

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
