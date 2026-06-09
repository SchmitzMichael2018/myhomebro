import { expect, test } from "@playwright/test";

const ACTIVE_DISPUTE_ID = 8801;
const TERMINAL_DISPUTE_ID = 8802;
const ARCHIVED_DISPUTE_ID = 8803;

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
            financial_disposition: "manual_review_required",
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
            resolution_type: "contractor_prevails",
            financial_disposition: "eligible_for_release",
            homeowner_response: "",
            contractor_response: "",
            attachments: [],
            created_at: "2026-03-20T10:00:00Z",
            updated_at: "2026-03-21T10:00:00Z",
          },
          {
            id: ARCHIVED_DISPUTE_ID,
            agreement: 323,
            agreement_number: "323",
            initiator: "contractor",
            reason: "Archived issue",
            description: "Archived dispute.",
            status: "resolved_contractor",
            is_archived: true,
            fee_amount: 250,
            fee_paid: true,
            escrow_frozen: false,
            resolution_type: "administrative_closure",
            financial_disposition: "no_financial_action",
            homeowner_response: "",
            contractor_response: "",
            attachments: [],
            created_at: "2026-03-19T10:00:00Z",
            updated_at: "2026-03-20T10:00:00Z",
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

  await page.route(/\/api\/projects\/disputes\/\?include_archived=(?:0|1)$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            id: ACTIVE_DISPUTE_ID,
            agreement: 321,
            agreement_number: "321",
            milestone_title: "Final Walkthrough",
            initiator: "homeowner",
            reason: "Work incomplete",
            description: "Both parties responded and admin needs to review.",
            status: "under_review",
            fee_amount: 250,
            fee_paid: true,
            escrow_frozen: true,
            financial_disposition: "manual_review_required",
            homeowner_response: "The punch list is incomplete.",
            contractor_response: "We can address the remaining items.",
            attachments: [{ id: 1 }],
            created_at: "2026-03-23T10:00:00Z",
            updated_at: "2026-03-23T10:00:00Z",
          },
          {
            id: TERMINAL_DISPUTE_ID,
            agreement: 322,
            agreement_number: "322",
            milestone_title: "Rework",
            initiator: "homeowner",
            reason: "Rework needed",
            description: "Rework required.",
            status: "resolved_contractor",
            fee_amount: 250,
            fee_paid: true,
            escrow_frozen: true,
            resolution_type: "rework_required",
            financial_disposition: "manual_review_required",
            homeowner_response: "Needs correction.",
            contractor_response: "Rework proposed.",
            attachments: [{ id: 2 }],
            created_at: "2026-03-20T10:00:00Z",
            updated_at: "2026-03-21T10:00:00Z",
          },
        ],
      }),
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
  await expect(activeRow.getByText("Upload")).toBeVisible();
  await expect(activeRow.getByRole("button", { name: "Propose" })).toBeVisible();
  await expect(activeRow.getByRole("button", { name: "Archive" })).toHaveCount(0);
  await expect(activeRow).toContainText("Escrow Hold Active");
  await expect(activeRow).toContainText("Manual Review Required");

  await expect(terminalRow).toBeVisible();
  await expect(terminalRow).toContainText("Resolved");
  await expect(terminalRow).toContainText("Contractor Prevails");
  await expect(terminalRow).toContainText("Eligible for Release");
  await expect(terminalRow.getByText(/^Read only$/)).toHaveCount(1);
  await expect(terminalRow.getByRole("button", { name: "View" })).toBeVisible();
  await expect(terminalRow.getByRole("button", { name: "Archive" })).toBeVisible();
  await expect(terminalRow.getByRole("button", { name: "Respond" })).toHaveCount(0);
  await expect(terminalRow.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await expect(terminalRow.getByRole("button", { name: "Upload" })).toHaveCount(0);
  await expect(terminalRow.getByRole("button", { name: "Resolve" })).toHaveCount(0);
  await expect(terminalRow.getByRole("button", { name: "Propose" })).toHaveCount(0);
  await expect(terminalRow.getByText("Response received")).toHaveCount(0);
  await expect(page.locator("tr", { hasText: `#${ARCHIVED_DISPUTE_ID}` })).toHaveCount(0);

  await page.getByRole("button", { name: "Show archived" }).click();
  const archivedRow = page.locator("tr", { hasText: `#${ARCHIVED_DISPUTE_ID}` });
  await expect(archivedRow).toBeVisible();
  await expect(archivedRow.getByText(/^Archived$/)).toHaveCount(1);
  await expect(archivedRow.getByRole("button", { name: "View" })).toBeVisible();
  await expect(archivedRow.getByRole("button", { name: "Archive" })).toHaveCount(0);
});

test("admin dispute board exposes framework filters and resolution metadata", async ({ page }) => {
  await mockDisputeLists(page, "admin");

  await page.goto("/app/admin/disputes", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("button", { name: /Awaiting admin review/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Rework required/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Archived/ })).toBeVisible();

  const activeRow = page.locator("tr", { hasText: `#${ACTIVE_DISPUTE_ID}` });
  await expect(activeRow).toContainText("Escrow Hold Active");
  await expect(activeRow).toContainText("Manual Review Required");
  await expect(activeRow).toContainText("Ready for decision");

  await page.getByRole("button", { name: /Awaiting admin review/ }).click();
  await expect(activeRow).toBeVisible();
  await expect(page.locator("tr", { hasText: `#${TERMINAL_DISPUTE_ID}` })).toHaveCount(0);

  await page.getByRole("button", { name: /Rework required/ }).click();
  const reworkRow = page.locator("tr", { hasText: `#${TERMINAL_DISPUTE_ID}` });
  await expect(reworkRow).toBeVisible();
  await expect(reworkRow).toContainText("Rework Required");
  await expect(reworkRow).toContainText("Manual Review Required");
});
