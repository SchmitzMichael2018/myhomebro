import { expect, test } from "@playwright/test";

const ACTIVE_DISPUTE_ID = 8801;
const TERMINAL_DISPUTE_ID = 8802;

async function mockDisputeLists(page, role = "contractor") {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  await page.route("**/api/projects/whoami/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: role === "admin" ? 1 : 7,
        type: role,
        role: role === "admin" ? "admin" : "contractor_owner",
        email: `${role}@myhomebro.local`,
      }),
    });
  });

  await page.route(/\/api\/projects\/disputes\/\?mine=true(?:&.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            id: ACTIVE_DISPUTE_ID,
            agreement: 321,
            agreement_number: "321",
            initiator: "contractor",
            reason: "Scope disagreement",
            description: "Active dispute.",
            status: "open",
            fee_amount: 250,
            fee_paid: true,
            escrow_frozen: true,
            homeowner_response: "",
            contractor_response: "",
            attachments: [],
            created_at: "2026-03-23T10:00:00Z",
            updated_at: "2026-03-23T10:00:00Z",
          },
          {
            id: TERMINAL_DISPUTE_ID,
            agreement: 322,
            agreement_number: "322",
            initiator: "contractor",
            reason: "Resolved issue",
            description: "Terminal dispute.",
            status: "resolved_contractor",
            fee_amount: 250,
            fee_paid: true,
            escrow_frozen: false,
            homeowner_response: "",
            contractor_response: "",
            attachments: [],
            created_at: "2026-03-20T10:00:00Z",
            updated_at: "2026-03-21T10:00:00Z",
          },
        ],
      }),
    });
  });

  await page.route(/\/api\/projects\/disputes\/\?initiator=homeowner(?:&.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });
}

test("contractor dispute view hides actions for terminal disputes", async ({ page }) => {
  await mockDisputeLists(page, "contractor");

  await page.goto("/app/disputes", { waitUntil: "domcontentloaded" });

  const activeRow = page.locator("tr", { hasText: `#${ACTIVE_DISPUTE_ID}` });
  const terminalRow = page.locator("tr", { hasText: `#${TERMINAL_DISPUTE_ID}` });

  await expect(activeRow).toBeVisible();
  await expect(activeRow.getByRole("button", { name: "Respond" })).toBeVisible();
  await expect(activeRow.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(activeRow.getByRole("button", { name: "Upload" })).toBeVisible();
  await expect(activeRow.getByRole("button", { name: "Propose" })).toBeVisible();

  await expect(terminalRow).toBeVisible();
  await expect(terminalRow.getByText("Resolved - read only")).toBeVisible();
  await expect(terminalRow.getByRole("button", { name: "Respond" })).toHaveCount(0);
  await expect(terminalRow.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await expect(terminalRow.getByRole("button", { name: "Upload" })).toHaveCount(0);
  await expect(terminalRow.getByRole("button", { name: "Resolve" })).toHaveCount(0);
  await expect(terminalRow.getByRole("button", { name: "Propose" })).toHaveCount(0);
});
