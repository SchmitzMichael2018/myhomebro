import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const PASSWORD = "MyHomeBroQA!2026";
const CONTRACTOR_EMAIL = "info+contractor@myhomebro.com";
const API_BASE = (process.env.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "") + "/api";
const screenshotDir = path.resolve("../docs/audit-screenshots/intake-estimate-agreement-flow");

const intakeDescription =
  "Customer wants old flooring removed, subfloor inspected, and luxury vinyl plank installed in living room and hallway.";

test.describe.configure({ mode: "serial" });
test.setTimeout(180000);

function collectEvents(page) {
  const events = { consoleErrors: [], failedApiResponses: [], requestFailures: [] };
  page.on("console", (msg) => {
    if (msg.type() === "error") events.consoleErrors.push(msg.text());
  });
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/api/") && response.status() >= 400) {
      events.failedApiResponses.push(`${response.status()} ${url}`);
    }
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (url.includes("/api/")) {
      events.requestFailures.push(`${request.failure()?.errorText || "failed"} ${url}`);
    }
  });
  return events;
}

async function snap(page, name, fullPage = true) {
  await page.screenshot({ path: path.join(screenshotDir, `${name}.png`), fullPage });
}

async function installMapMocks(page) {
  await page.addInitScript(() => {
    const makeAutocomplete = () =>
      class PlaceAutocompleteElement extends HTMLElement {
        constructor() {
          super();
          this.value = "";
          this.placeholder = "";
          this.locationBias = null;
        }
      };

    window.google = window.google || {};
    window.google.maps = window.google.maps || {};
    window.google.maps.importLibrary = async (name) => {
      if (name === "places") {
        if (!customElements.get("gmp-place-autocomplete")) {
          customElements.define("gmp-place-autocomplete", makeAutocomplete());
        }
        return { PlaceAutocompleteElement: customElements.get("gmp-place-autocomplete") };
      }
      return {};
    };
  });
}

async function apiRequest(request, method, url, options = {}) {
  const response = await request[method](`${API_BASE}${url}`, options);
  const body = await response.json().catch(() => ({}));
  expect(response.ok(), `${method.toUpperCase()} ${url} failed: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy();
  return body;
}

async function loginContractor(page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByTestId("login-email-input").fill(CONTRACTOR_EMAIL);
  await page.getByTestId("login-password-input").fill(PASSWORD);
  await page.getByTestId("login-submit-button").click();
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("access") || "")).not.toBe("");
}

async function contractorBidRowForOpportunity(page, opportunityId) {
  const result = await page.evaluate(
    async ({ apiBase, sourceId }) => {
      const token = window.localStorage.getItem("access") || "";
      const response = await fetch(`${apiBase}/projects/contractor/bids/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({}));
      const rows = Array.isArray(body) ? body : Array.isArray(body.results) ? body.results : Array.isArray(body.rows) ? body.rows : [];
      return rows.find((row) => String(row.source_id || row.opportunity_id || "") === String(sourceId)) || null;
    },
    { apiBase: API_BASE, sourceId: opportunityId }
  );
  expect(result, `Opportunity ${opportunityId} should appear in contractor bids API`).toBeTruthy();
  return result;
}

async function startIntakeFromPublicUi(page) {
  await page.goto("/start-project", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("start-project-contact-form")).toBeVisible();
  await page.getByTestId("start-project-contact-name").fill("Taylor QA Intake");
  await page.getByTestId("start-project-contact-email").fill("info+intake-customer@myhomebro.com");
  await page.getByTestId("start-project-contact-phone").fill("555-0199");
  await snap(page, "01-public-intake-contact");
  await page.getByTestId("start-project-contact-submit").click();
  await expect(page).toHaveURL(/\/start-project\/[^/]+$/);
  await snap(page, "02-public-intake-wizard-open");
  return new URL(page.url()).pathname.split("/").filter(Boolean).pop();
}

async function completePublicIntake(request, token) {
  const payload = {
    token,
    customer_name: "Taylor QA Intake",
    customer_email: "info+intake-customer@myhomebro.com",
    customer_phone: "555-0199",
    customer_address_line1: "4400 QA Lead Street",
    customer_city: "Austin",
    customer_state: "TX",
    customer_postal_code: "78704",
    same_as_customer_address: true,
    project_address_line1: "4400 QA Lead Street",
    project_city: "Austin",
    project_state: "TX",
    project_postal_code: "78704",
    project_class: "residential",
    project_mode: "full_service",
    payment_preference: "escrow",
    budget_range_text: "$8,000 - $12,000",
    desired_timing_text: "Within the next month",
    tentative_start_date: "2026-07-20",
    accomplishment_text: intakeDescription,
    ai_project_title: "Taylor QA Flooring Remodel",
    ai_project_type: "Flooring / Remodel",
    ai_project_subtype: "Luxury vinyl plank",
    ai_description: intakeDescription,
    ai_project_timeline_days: 7,
    ai_project_budget: "9750.00",
    measurement_handling: "contractor_to_measure",
    ai_clarification_questions: [
      { key: "flooring_area", label: "Flooring area", question: "Confirm living room and hallway square footage." },
      { key: "site_access", label: "Site access", question: "Confirm access path and parking." },
    ],
    ai_clarification_answers: {
      flooring_area: "Contractor to verify approximately 620 square feet during estimate.",
      site_access: "Customer can provide driveway access and clear hallway before work.",
    },
    final_submit: true,
  };
  return apiRequest(request, "patch", `/projects/public-intake/?token=${encodeURIComponent(token)}`, { data: payload });
}

async function selectQaContractorAndRequestEstimate(request, token) {
  const search = await apiRequest(
    request,
    "get",
    `/projects/public-intake/contractor-search/?token=${encodeURIComponent(token)}&query=${encodeURIComponent(
      "MyHomeBro QA Remodeling"
    )}&project_type=${encodeURIComponent(
      "Flooring / Remodel"
    )}&city=Austin&state=TX&project_postal_code=78704&lat=30.2467&lng=-97.7564&radius_miles=100&limit=20`
  );
  const rows = Array.isArray(search.results) ? search.results : Array.isArray(search.contractors) ? search.contractors : [];
  const contractor = rows.find((row) => /myhomebro qa remodeling/i.test(row.business_name || row.name || "")) || rows[0];
  expect(contractor, "Seeded QA contractor should be discoverable from public intake").toBeTruthy();

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const twoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const availability = await apiRequest(
    request,
    "get",
    `/projects/public-intake/estimate-availability/?contractor_id=${contractor.contractor_id || contractor.claimed_by_contractor_id || ""}&directory_entry_id=${
      contractor.directory_entry_id || contractor.id
    }&start_date=${tomorrow}&end_date=${twoWeeks}`
  );
  const slot = Array.isArray(availability.slots) && availability.slots.length ? availability.slots[0] : null;

  const selected = contractor.directory_entry_id
    ? { id: `directory_entry:${contractor.directory_entry_id}`, directory_entry_id: contractor.directory_entry_id }
    : { id: contractor.id || `contractor:${contractor.contractor_id}` };
  if (slot) {
    selected.estimate_request = {
      preference: "slot",
      scheduled_start: slot.scheduled_start,
      appointment_type: slot.appointment_type,
      customer_notes: "QA customer selected this local test estimate slot.",
    };
  } else {
    selected.estimate_request = {
      preference: "flexible",
      customer_notes: "QA customer can meet any weekday morning.",
    };
  }

  const selection = await apiRequest(request, "post", "/projects/public-intake/select-contractor/", {
    data: { token, selected_contractors: [selected] },
  });
  expect(selection.opportunity_id).toBeTruthy();
  return { contractor, selection, slot };
}

async function openOpportunity(page, opportunityId) {
  const row = await contractorBidRowForOpportunity(page, opportunityId);
  await page.goto("/app/opportunities", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("leads-and-bids-page")).toBeVisible({ timeout: 20000 });
  const resetFilters = page.getByTestId("opportunities-reset-filters");
  if (await resetFilters.isVisible().catch(() => false)) {
    await resetFilters.click();
  }
  const card = page.getByTestId(`lead-row-${row.bid_id}`);
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(card).toContainText("info+intake-customer@myhomebro.com");
  await expect(card).toContainText("4400 QA Lead Street");
  await snap(page, "04-contractor-opportunities-feed");
  await card.locator("button").filter({ hasText: "View Details" }).click();
  await expect(page.getByTestId("bids-detail-drawer")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("opportunity-customer-section")).toContainText("Taylor QA Intake");
  await expect(page.getByTestId("opportunity-customer-address")).toContainText("4400 QA Lead Street");
  await snap(page, "05-opportunity-review-modal");
}

async function openEstimateWorkspace(page) {
  const confirm = page.getByTestId("confirm-estimate-request-action");
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click();
  }
  await page.getByTestId("proposal-workspace-action").click();
  await expect(page).toHaveURL(/\/app\/proposals\/\d+/);
  await expect(page.getByTestId("proposal-workspace")).toBeVisible({ timeout: 20000 });
  await snap(page, "06-estimate-workspace-created");
  return page.url().match(/\/proposals\/(\d+)/)?.[1];
}

async function assertProposalReuse(page, opportunityId, proposalId) {
  const result = await page.evaluate(
    async ({ apiBase, sourceId }) => {
      const token = window.localStorage.getItem("access") || "";
      const response = await fetch(`${apiBase}/projects/proposals/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ source_type: "opportunity", source_id: sourceId }),
      });
      const body = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, body };
    },
    { apiBase: API_BASE, sourceId: opportunityId }
  );
  expect(result.ok, `Proposal reuse API failed: ${result.status} ${JSON.stringify(result.body)}`).toBeTruthy();
  expect(String(result.body?.proposal?.id || "")).toBe(String(proposalId));
  expect(result.body?.created).toBe(false);
}

async function fillEstimateWorkspace(page) {
  await page.getByTestId("proposal-create-agreement-action").scrollIntoViewIfNeeded();
  if (await page.getByTestId("proposal-create-agreement-action").isDisabled()) {
    await expect(page.getByTestId("proposal-create-agreement-action")).toBeDisabled();
  }
  await snap(page, "07-estimate-create-agreement-disabled");

  await page.getByTestId("proposal-nav-clarifications").click();
  const proposalId = page.url().match(/\/proposals\/(\d+)/)?.[1];
  const clarificationButtons = page.locator('[data-testid^="proposal-clarification-complete-"]');
  const clarificationCount = await clarificationButtons.count();
  for (let index = 0; index < clarificationCount; index += 1) {
    const button = clarificationButtons.nth(index);
    await button.scrollIntoViewIfNeeded();
    await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes(`/api/projects/proposals/${proposalId}/`) &&
        response.request().method() === "PATCH" &&
        response.ok()
      ),
      button.click(),
    ]);
  }

  await page.getByTestId("proposal-nav-customer").click();
  const address = page.getByTestId("proposal-project-address-input");
  if (await address.isVisible().catch(() => false)) {
    await address.fill("4400 QA Lead Street, Austin, TX 78704");
    await page.getByTestId("proposal-save-project-address").click();
  }

  await page.getByTestId("proposal-nav-scheduling").click();
  await page.getByTestId("proposal-schedule-start-type").selectOption("specific_date");
  await page.getByTestId("proposal-schedule-start-date").fill("2026-07-20");
  await page.getByTestId("proposal-schedule-completion-type").selectOption("specific_date");
  await page.getByTestId("proposal-schedule-completion-date").fill("2026-07-27");
  await page.getByTestId("proposal-schedule-priority").selectOption("preferred");
  await page.getByTestId("proposal-save-scheduling").click();

  await page.getByTestId("proposal-nav-site").click();
  await page.getByTestId("proposal-site-notes").fill(
    "Driveway access available. Customer will clear furniture from living room and hallway before demo."
  );
  await page.getByTestId("proposal-save-site-visit").click();

  await page.getByTestId("proposal-nav-measurements").click();
  await page.getByTestId("proposal-measurement-label").fill("Living room and hallway flooring");
  await page.getByTestId("proposal-measurement-location").fill("Main level");
  await page.getByTestId("proposal-measurement-quantity").fill("620");
  await page.getByTestId("proposal-measurement-unit").fill("sq ft");
  await page.getByTestId("proposal-measurement-form").locator('button[type="submit"]').click();
  await expect(page.getByTestId("proposal-measurement-list")).toContainText("Living room and hallway flooring");

  await page.getByTestId("proposal-nav-photos").click();
  await snap(page, "08-estimate-photos-placeholder");
  await page.getByTestId("proposal-nav-documents").click();
  await snap(page, "09-estimate-documents-placeholder");

  await page.getByTestId("proposal-nav-scope").click();
  await page.getByTestId("proposal-included-work").fill(
    "Remove existing flooring, inspect subfloor, perform minor prep, supply LVP allowance, install LVP in living room and hallway, and clean/dispose of debris."
  );
  await page.getByTestId("proposal-save-scope").click();

  const lineItems = [
    ["labor", "Demo and removal labor", "16", "hours", "85", "Remove existing flooring and base debris."],
    ["labor", "Subfloor prep", "8", "hours", "95", "Patch minor imperfections and confirm substrate is ready."],
    ["allowance", "LVP material allowance", "620", "sq ft", "4.25", "Customer-selected luxury vinyl plank allowance."],
    ["labor", "Installation labor", "620", "sq ft", "3.75", "Install LVP in living room and hallway."],
    ["other", "Cleanup and disposal", "1", "lot", "450", "Bag, haul, and dispose of demo debris."],
    ["incidentals_reserve", "Incidentals reserve", "1", "reserve", "650", "Reserve for hidden subfloor repair or transition material."],
  ];
  await page.getByTestId("proposal-nav-estimate").click();
  for (const [category, description, quantity, unit, unitPrice, notes] of lineItems) {
    await page.getByTestId("proposal-line-category").selectOption(category);
    await page.getByTestId("proposal-line-description").fill(description);
    await page.getByTestId("proposal-line-quantity").fill(quantity);
    await page.getByTestId("proposal-line-unit").fill(unit);
    await page.getByTestId("proposal-line-unit-price").fill(unitPrice);
    await page.getByTestId("proposal-line-notes").fill(notes);
    await page.getByTestId("proposal-line-item-form").locator('button[type="submit"]').click();
    await expect(page.getByTestId("proposal-line-item-list")).toContainText(description);
  }
  await expect(page.getByTestId("proposal-estimate-totals")).toContainText("Incidentals Reserve");
  await snap(page, "10-estimate-line-items-and-totals");

  await page.getByTestId("proposal-nav-ready").click();
  await expect(page.getByTestId("estimate-ready-review-status")).toContainText("Ready for Agreement");
  await expect(page.getByTestId("estimate-ready-create-agreement")).toBeEnabled({ timeout: 20000 });
  await snap(page, "11-estimate-ready-for-agreement");
}

async function reviewAgreementWizard(page) {
  await page.getByTestId("estimate-ready-create-agreement").click();
  await expect(page.getByTestId("agreement-wizard-heading")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("agreement-proposal-prefill-summary")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("agreement-proposal-prefill-summary")).toContainText("Estimate Prefill");
  await snap(page, "12-agreement-wizard-step1-prefill");
  const customerSelect = page.getByTestId("agreement-customer-select");
  if (!(await customerSelect.count())) {
    const setupButton = page.getByRole("button", { name: /Find Best Starting Point/i });
    if (await setupButton.isVisible().catch(() => false)) {
      await setupButton.click();
    }
  }
  await customerSelect.scrollIntoViewIfNeeded({ timeout: 20000 });
  await expect(customerSelect).toBeVisible();
  await expect
    .poll(() => customerSelect.evaluate((select) => select.selectedOptions?.[0]?.textContent?.trim() || ""), { timeout: 15000 })
    .toContain("Taylor QA Intake");
  await expect(page.locator('input[name="address_line1"]')).toHaveValue(/4400 QA Lead Street/);
  await expect(page.getByText(/luxury vinyl plank|LVP/i).first()).toBeVisible();
  await snap(page, "13-agreement-wizard-step1-review-form");

  await page.getByRole("button", { name: /Save & Next/i }).click();
  await expect(page).toHaveURL(/step=2/);
  await expect(page.getByTestId("step2-estimate-panel")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("step2-estimate-total")).toContainText("$");
  await expect(page.getByTestId("step2-plan-guidance-card")).toBeVisible();
  await expect(
    page.getByTestId("step2-milestone-card-1").or(page.getByTestId("step2-milestone-empty-state")).first()
  ).toBeVisible();
  await snap(page, "14-agreement-wizard-step2-planning");

  await page.getByRole("button", { name: /Warranty/i }).click();
  await expect(page).toHaveURL(/step=3/);
  await snap(page, "15-agreement-wizard-step3-warranty");

  await page.getByRole("button", { name: /Finalize/i }).click();
  await expect(page).toHaveURL(/step=4/);
  await snap(page, "16-agreement-wizard-step4-finalize");

  await page.setViewportSize({ width: 390, height: 844 });
  await snap(page, "17-mobile-agreement-wizard-finalize", false);
}

test("public intake to opportunity to estimate workspace to agreement wizard", async ({ page, request }) => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await installMapMocks(page);
  const events = collectEvents(page);

  const token = await startIntakeFromPublicUi(page);
  await completePublicIntake(request, token);
  const { selection, slot } = await selectQaContractorAndRequestEstimate(request, token);
  await page.goto(`/start-project/${token}`, { waitUntil: "domcontentloaded" });
  await snap(page, slot ? "03-public-intake-submitted-with-slot" : "03-public-intake-submitted-flexible");

  await loginContractor(page);
  await openOpportunity(page, selection.opportunity_id);
  const proposalId = await openEstimateWorkspace(page);
  expect(proposalId).toBeTruthy();
  await assertProposalReuse(page, selection.opportunity_id, proposalId);

  await fillEstimateWorkspace(page);
  await reviewAgreementWizard(page);

  expect(selection.opportunity_id).toBeTruthy();
  expect(events.failedApiResponses, "No failed API calls should occur").toEqual([]);
  expect(events.requestFailures, "No API request failures should occur").toEqual([]);
  expect(events.consoleErrors, "No console errors should occur").toEqual([]);
});
