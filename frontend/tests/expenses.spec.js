import { expect, test } from "@playwright/test";

const whoamiPayload = {
  user_id: 7,
  email: "owner@example.com",
  type: "contractor",
  role: "contractor_owner",
  identity_type: "contractor_owner",
  attention_counts: {},
};

const agreementsPayload = {
  results: [
    {
      id: 101,
      title: "Kitchen Remodel",
      project_title: "Kitchen Remodel",
      homeowner_name: "Jordan Customer",
      payment_model: "escrow",
      payment_mode: "escrow",
      incidentals_reserve_amount: "500.00",
      incidentals_reserve_summary: {
        original: "500.00",
        pending: "55.00",
        spent: "245.50",
        remaining: "254.50",
        configured: true,
        escrow_funding_integration_pending: true,
      },
    },
    {
      id: 202,
      title: "Deck Repair",
      project_title: "Deck Repair",
      homeowner_name: "Casey Customer",
      payment_model: "direct_pay",
      payment_mode: "direct",
    },
  ],
};

const expensesPayload = {
  results: [
    {
      id: 1,
      agreement: 101,
      description: "Home Depot",
      amount: "245.50",
      incurred_date: "2026-06-12",
      request_kind: "escrow_reimbursement",
      funding_source: "incidentals_reserve",
      category: "materials",
      status: "approved",
      status_label: "Approved",
      notes_to_homeowner: "Fasteners and sealant for the kitchen install.",
      receipt_url: "https://example.test/receipt-1.pdf",
      created_at: "2026-06-12T14:00:00Z",
      approved_at: "2026-06-13T14:00:00Z",
    },
    {
      id: 2,
      agreement: 202,
      description: "Permit Office",
      amount: "85.00",
      incurred_date: "2026-06-14",
      request_kind: "direct_expense",
      funding_source: "reimbursement",
      category: "permit",
      status: "sent_to_homeowner",
      status_label: "Sent to Customer",
      notes_to_homeowner: "Permit reimbursement request.",
      attachments: [],
      created_at: "2026-06-14T14:00:00Z",
    },
  ],
};

async function installExpenseRoutes(page, expenses = expensesPayload, agreements = agreementsPayload) {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  await page.route("**/api/projects/whoami/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(whoamiPayload) });
  });

  await page.route("**/api/payments/onboarding/status/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ connected: true, onboarding_complete: true }),
    });
  });

  await page.route("**/api/projects/agreements/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(agreements) });
  });

  await page.route("**/api/projects/expense-requests/*/attachments/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });

  await page.route("**/api/projects/expense-requests/", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(expenses) });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ id: 99, status: "draft", ...JSON.parse(route.request().postData() || "{}") }),
    });
  });
}

test("expenses page shows financial operations dashboard and incidentals labels", async ({ page }) => {
  await installExpenseRoutes(page);

  await page.goto("/app/expenses");

  await expect(page.getByTestId("expenses-summary")).toContainText("Pending Reimbursements");
  await expect(page.getByTestId("incidentals-reserve-panel")).toContainText("$500.00");
  await expect(page.getByTestId("incidentals-reserve-panel")).toContainText("$55.00");
  await expect(page.getByTestId("expenses-ledger")).toContainText("Home Depot");
  await expect(page.getByTestId("expenses-ledger")).toContainText("Incidentals Reserve");
  await expect(page.getByTestId("expenses-ledger")).toContainText("Reimbursement");
  await expect(page.getByTestId("expenses-ledger")).toContainText("Permit Office");

  await page.getByPlaceholder("Merchant").fill("Home");
  await expect(page.getByTestId("expenses-ledger")).toContainText("Home Depot");
  await expect(page.getByTestId("expenses-ledger")).not.toContainText("Permit Office");

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByTestId("expenses-ledger")).toContainText("Permit Office");

  await page.getByRole("button", { name: "Home Depot" }).click();
  await expect(page.getByText(/Expense Details/)).toBeVisible();
  await expect(page.getByText("Funding Source:", { exact: true })).toBeVisible();
  await expect(page.getByText("Audit History")).toBeVisible();
});

test("expenses page shows direct-pay reimbursement guidance when no escrow data exists", async ({ page }) => {
  await installExpenseRoutes(
    page,
    {
      results: [
        {
          id: 3,
          agreement: 202,
          description: "Lumber Yard",
          amount: "120.00",
          incurred_date: "2026-06-15",
          request_kind: "direct_expense",
          funding_source: "reimbursement",
          category: "materials",
          status: "draft",
          created_at: "2026-06-15T14:00:00Z",
        },
      ],
    },
    {
      results: [
        {
          id: 202,
          title: "Deck Repair",
          project_title: "Deck Repair",
          homeowner_name: "Casey Customer",
          payment_model: "direct_pay",
          payment_mode: "direct",
        },
      ],
    }
  );

  await page.goto("/app/expenses");

  await expect(page.getByTestId("incidentals-reserve-panel")).toContainText(
    "Direct-pay projects continue to use the existing reimbursement request workflow."
  );
  await expect(page.getByTestId("expenses-ledger")).toContainText("Reimbursement");
});
