import { expect, test } from "@playwright/test";

const payoutRows = [
  {
    id: "invoice-1",
    record_id: 1,
    record_type: "invoice",
    record_type_label: "Invoice",
    payout_date: "2026-04-12T15:20:00Z",
    agreement_label: "Residential Finish",
    agreement_reference: "Agreement #101",
    project_title: "Residential Finish",
    project_class: "residential",
    project_class_label: "Residential",
    source_label: "INV-20260412-0001",
    gross_amount: "1200.00",
    gross_released_amount: "1200.00",
    platform_fee: "60.00",
    net_payout: "1140.00",
    transfer_ref: "tr_invoice_completed",
    status: "paid",
    status_label: "Paid",
    notes: "Escrow released",
  },
  {
    id: "draw-2",
    record_id: 2,
    record_type: "draw_request",
    record_type_label: "Draw",
    payout_date: "2026-04-13T15:20:00Z",
    agreement_label: "Commercial Finish",
    agreement_reference: "Agreement #102",
    project_title: "Commercial Finish",
    project_class: "commercial",
    project_class_label: "Commercial",
    source_label: "Draw #1",
    gross_amount: "1800.00",
    gross_released_amount: "1800.00",
    platform_fee: "90.00",
    net_payout: "1710.00",
    transfer_ref: "tr_draw_completed",
    status: "paid",
    status_label: "Paid",
    notes: "Released to contractor",
  },
];

function payoutResponse(projectClass = "all") {
  const rows =
    projectClass === "commercial"
      ? payoutRows.filter((row) => row.project_class === "commercial")
      : projectClass === "residential"
        ? payoutRows.filter((row) => row.project_class === "residential")
        : payoutRows;

  const totalPaidOut = rows.reduce((sum, row) => sum + Number(row.net_payout || 0), 0);
  const totalFees = rows.reduce((sum, row) => sum + Number(row.platform_fee || 0), 0);
  const totalGross = rows.reduce((sum, row) => sum + Number(row.gross_released_amount || 0), 0);

  return {
    results: rows,
    summary: {
      total_paid_out: totalPaidOut.toFixed(2),
      total_platform_fees_retained: totalFees.toFixed(2),
      total_gross_released: totalGross.toFixed(2),
      payout_count: rows.length,
      invoice_count: rows.filter((row) => row.record_type === "invoice").length,
      draw_count: rows.filter((row) => row.record_type === "draw_request").length,
    },
    filters: {
      project_class: projectClass,
      record_type: "all",
    },
  };
}

test("contractor can reach payout history from payments and filter completed payouts", async ({
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

  await page.route("**/api/projects/invoices/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route("**/api/projects/draws/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  let payoutAuthHeader = "";
  await page.route("**/api/projects/contractor/payout-history/**", async (route) => {
    payoutAuthHeader = route.request().headers().authorization || route.request().headers().Authorization || "";
    const url = new URL(route.request().url());
    const projectClass = url.searchParams.get("project_class") || "all";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payoutResponse(projectClass)),
    });
  });

  await page.goto("/app/invoices", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Payments")).toBeVisible();
  await page.getByTestId("payments-open-payout-history").click();

  await expect(page).toHaveURL(/\/app\/payout-history$/);
  await expect(page.getByTestId("contractor-payout-history-title")).toBeVisible();
  await expect(page.getByTestId("payout-history-summary-paid-out")).toContainText("$2,850.00");
  await expect(page.getByTestId("payout-history-summary-fees")).toContainText("$150.00");
  await expect(page.getByTestId("payout-history-summary-gross")).toContainText("$3,000.00");
  await expect(page.getByTestId("payout-history-summary-count")).toContainText("2");
  await expect(page.getByTestId("payout-history-row-1")).toContainText("Residential Finish");
  await expect(page.getByTestId("payout-history-row-2")).toContainText("Commercial Finish");
  await expect(page.getByTestId("payout-history-row-1")).toContainText("Invoice");
  await expect(page.getByTestId("payout-history-row-2")).toContainText("Draw");
  expect(payoutAuthHeader).toContain("Bearer ");

  await page.getByTestId("payout-history-filter-project-class").selectOption("commercial");
  await expect(page.getByTestId("payout-history-summary-paid-out")).toContainText("$1,710.00");
  await expect(page.getByTestId("payout-history-summary-count")).toContainText("1");
  await expect(page.getByTestId("payout-history-row-2")).toBeVisible();
  await expect(page.getByTestId("payout-history-row-1")).toHaveCount(0);

  await page.screenshot({ path: "test-results/contractor-payout-history.png", fullPage: true });

  expect(consoleErrors.filter((msg) => msg.includes("Failed to load payout history"))).toHaveLength(0);
});
