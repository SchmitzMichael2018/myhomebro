import { expect, test } from "@playwright/test";

async function installWizardMocks(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
    window.sessionStorage.setItem(
      "mhb_first_project_assist_handoff",
      JSON.stringify({
        assistantPrefill: {
          project_title: "Bathroom Remodel",
          project_summary: "Refresh the guest bathroom.",
          customer_name: "New Lead Customer",
          email: "lead@example.com",
          address_line1: "123 Main St, Austin, TX",
          incidentals_reserve_amount: "200.00",
        },
        assistantDraftPayload: {
          source: "proposal",
          proposal_id: 42,
          project_title: "Bathroom Remodel",
          project_type: "Bathroom",
          project_subtype: "Refresh",
          description:
            "Project Summary\nRefresh the guest bathroom.\n\nIncluded Work\nDemo, prep, and install.\n\nEstimate Line Items\n- Labor - Crew labor - 10 hours @ $75.00 = $750.00",
          payment_mode: "escrow",
          incidentals_reserve_amount: "200.00",
          proposal_total: "950.00",
        },
        assistantContext: {
          source: "proposal",
          proposal_id: 42,
          proposal_total: "950.00",
          incidentals_reserve_amount: "200.00",
        },
        assistantEstimatePreview: {
          source: "proposal",
          suggested_total_price: "950.00",
          incidentals_reserve_amount: "200.00",
        },
        assistantWizardStepTarget: 1,
        assistantIntent: "proposal_to_agreement",
      })
    );
    window.sessionStorage.setItem("mhb_step1_cache_new_start_mode", "manual");
    window.sessionStorage.setItem("mhb_step1_cache_new_start_mode_committed", "1");
    window.sessionStorage.setItem("mhb_step1_cache_new_start_mode_source", "session");
  });

  await page.route("**/api/projects/whoami/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: 7, type: "contractor", role: "contractor_owner", email: "playwright@example.com" }),
    });
  });
  await page.route("**/api/projects/contractors/me/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ public_profile: {} }) });
  });
  await page.route("**/api/projects/contractor-activation-summary/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });
  await page.route("**/api/projects/project-types/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ id: 1, value: "Bathroom", label: "Bathroom", owner_type: "system" }] }),
    });
  });
  await page.route("**/api/projects/project-subtypes/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ id: 2, value: "Refresh", label: "Refresh", owner_type: "system" }] }),
    });
  });
  await page.route("**/api/projects/homeowners**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });
  await page.route("**/api/projects/templates/recommend/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ recommendations: [] }) });
  });
  await page.route("**/api/projects/templates/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });
  await page.route(/\/api\/payments\/onboarding\/status\/?.*$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });
  await page.route(/\/api\/projects\/notifications\/?.*$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });
}

test("Agreement Wizard prefills editable fields from Proposal Workspace handoff", async ({ page }) => {
  await installWizardMocks(page);

  await page.goto("/app/agreements/new/wizard?step=1", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("agreement-assistant-prefill-banner")).toContainText("Proposal data prefilled");
  await expect(page.getByTestId("agreement-proposal-prefill-summary")).toContainText("$950.00");
  await expect(page.getByTestId("agreement-proposal-prefill-summary")).toContainText("$200.00");
  await expect(page.getByTestId("agreement-proposal-prefill-scope")).toContainText("Demo, prep, and install.");
  await expect(page.getByTestId("agreement-proposal-prefill-scope")).toContainText("Crew labor");
});
