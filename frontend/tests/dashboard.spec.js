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

async function mockDashboard(page, { proposalId = 501, onProposalCreate = null, agreementRows = [], customerResponse = null } = {}) {
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

    if (path.endsWith("/api/projects/contractors/onboarding/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          required_onboarding_complete: true,
          profile_basics_complete: true,
          status: "complete",
          step: "complete",
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
      const responseBody = customerResponse?.(url) || {
        count: customers.length,
        directory_total: customers.length,
        directory_letters: ["T"],
        results: customers,
      };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(responseBody),
      });
    }

    if (path.endsWith("/api/projects/agreements/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ results: agreementRows }),
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
            project_start_type: payload.project_start_type || "flexible",
            project_start_date: payload.project_start_date || "",
            project_completion_type: payload.project_completion_type || "no_deadline",
            project_completion_date: payload.project_completion_date || "",
            scheduling_priority: payload.scheduling_priority || "flexible",
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
          project_start_type: "flexible",
          project_start_date: "",
          project_completion_type: "no_deadline",
          project_completion_date: "",
          scheduling_priority: "flexible",
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
    /Smart Capture\s*Capture customers, receipts, labels & job details/,
    "New Agreement",
    "Today's Schedule",
    "Expense",
    "Payment",
  ]);

  const quickActionButtons = await actions.getByRole("button").all();
  for (const button of quickActionButtons) {
    await expect(button).toHaveCSS("color", "rgb(255, 255, 255)");
    await button.hover();
    await expect(button).toHaveCSS("color", "rgb(255, 255, 255)");
    await button.focus();
    await expect(button).toHaveCSS("color", "rgb(255, 255, 255)");
  }

  await expect(actions.getByText("Primary")).toHaveCSS("color", "rgb(254, 243, 199)");
});

test("Smart Capture dashboard action opens the shared launcher and its hint dismisses once", async ({ page }) => {
  await mockDashboard(page);
  await page.addInitScript(() => {
    window.__captureAnalytics = [];
    window.addEventListener("mhb:analytics", (event) => window.__captureAnalytics.push(event.detail));
  });
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("dashboard-smart-capture-hint")).toContainText(
    "New: Capture customer details, receipts, labels, and field information."
  );
  await page.getByTestId("dashboard-quick-action-smart-capture").click();
  await expect(page.getByTestId("capture-launcher")).toBeVisible();
  await expect(page.getByTestId("capture-launcher-actions")).toContainText("Capture first. Organize later.");
  await expect(page.getByTestId("capture-launcher-actions")).toContainText("Capture a receipt");
  expect(await page.evaluate(() => window.__captureAnalytics)).toContainEqual({
    event: "smart_capture_opened",
    category: "capture",
    source: "dashboard_quick_action",
  });

  await page.getByTestId("capture-launcher").getByRole("button", { name: "Close modal" }).click();
  await page.getByRole("button", { name: "Dismiss Smart Capture hint" }).click();
  await expect(page.getByTestId("dashboard-smart-capture-hint")).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("dashboard-smart-capture-hint")).toHaveCount(0);
});

test("Smart Capture quick action remains usable at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await mockDashboard(page);
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });

  const action = page.getByTestId("dashboard-quick-action-smart-capture");
  await expect(action).toBeVisible();
  expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await action.click();
  await expect(page.getByTestId("capture-launcher")).toBeVisible();
});

for (const width of [320, 375, 390, 393, 430]) {
  test(`authenticated navigation remains visible after dashboard settles at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await mockDashboard(page);
    await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });

    const menu = page.getByTestId("authenticated-mobile-menu-button");
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("aria-label", "Open navigation menu");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("dashboard-workspace-header")).toBeVisible();
    await expect(menu).toBeVisible();
    expect((await menu.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}

test("standalone authenticated navigation opens the existing drawer and restores focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) => (
      query === "(display-mode: standalone)"
        ? { matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true }
        : original(query)
    );
    Object.defineProperty(window.navigator, "standalone", { configurable: true, value: true });
  });
  await mockDashboard(page);
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });

  const menu = page.getByTestId("authenticated-mobile-menu-button");
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  const drawer = page.getByRole("dialog", { name: "Authenticated navigation" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Logout" })).toBeVisible();
  const drawerBox = await drawer.boundingBox();
  expect(drawerBox.width / 390).toBeGreaterThanOrEqual(0.84);
  expect(drawerBox.width / 390).toBeLessThanOrEqual(0.88);
  await expect(drawer).toHaveCSS("background-color", "rgb(3, 17, 38)");
  await expect(drawer.getByRole("link", { name: "Dashboard" })).toHaveCSS("min-height", "44px");
  await expect(drawer.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
  expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(menu).toBeFocused();
});

test("desktop keeps its sidebar and does not render the mobile fallback", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockDashboard(page);
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("authenticated-mobile-menu-button")).toBeHidden();
  await expect(page.getByTestId("authenticated-sidebar-footer").last()).toBeVisible();
  await expect(page.getByTestId("dashboard-quick-actions-row")).toBeVisible();
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
  await page.getByTestId("dashboard-estimate-existing-start-type").selectOption("asap");
  await page.getByTestId("dashboard-estimate-existing-priority").selectOption("required");
  await page.getByTestId("dashboard-estimate-launch").click();

  await expect(page).toHaveURL(/\/app\/proposals\/601$/);
  expect(createPayload).toMatchObject({
    source_type: "dashboard",
    customer_id: 101,
    project_title: "Kitchen Estimate",
    project_start_type: "asap",
    project_start_date: "",
    project_completion_type: "no_deadline",
    project_completion_date: "",
    scheduling_priority: "required",
  });
});

test("Create Estimate customer picker paginates, searches, and preserves selection", async ({ page }) => {
  const directory = Array.from({ length: 30 }, (_, index) => ({
    id: 200 + index,
    company_name: `Company ${String(index + 1).padStart(2, "0")}`,
    full_name: `Contact ${String(index + 1).padStart(2, "0")}`,
    email: `contact${index + 1}@example.com`,
    phone_number: `555-${String(index + 1).padStart(4, "0")}`,
    street_address: `${index + 1} Main Street`,
    city: "Austin",
    state: "TX",
    zip_code: "78701",
  }));
  const customerResponse = (url) => {
    const query = (url.searchParams.get("q") || "").toLowerCase();
    const letter = url.searchParams.get("starts_with") || "";
    const pageNumber = Number(url.searchParams.get("page") || 1);
    const pageSize = Number(url.searchParams.get("page_size") || 8);
    const filtered = directory.filter((customer) => {
      const display = customer.company_name || customer.full_name;
      if (letter && !display.toUpperCase().startsWith(letter)) return false;
      return !query || Object.values(customer).some((value) => String(value).toLowerCase().includes(query));
    });
    const start = (pageNumber - 1) * pageSize;
    return {
      count: filtered.length,
      directory_total: directory.length,
      directory_letters: ["C"],
      results: filtered.slice(start, start + pageSize),
    };
  };

  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockDashboard(page, { customerResponse });
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
  await page.getByTestId("dashboard-quick-action-create-estimate").click();

  await expect(page.getByTestId("dashboard-estimate-customer-pagination")).toContainText("Showing 1–8 of 30");
  await expect(page.getByTestId("dashboard-estimate-customer-pagination")).toContainText("Page 1 of 4");
  await expect(page.getByTestId("dashboard-estimate-customer-alphabet")).toBeVisible();
  await page.screenshot({ path: "test-results/estimate-customer-picker-desktop-page-1.png", fullPage: true });

  await page.getByTestId("dashboard-estimate-customer-201").click();
  await expect(page.getByTestId("dashboard-estimate-selected-customer")).toContainText("Company 02");
  await expect(page.getByTestId("dashboard-estimate-existing-property")).toHaveValue("2 Main Street, Austin, TX, 78701");
  await page.screenshot({ path: "test-results/estimate-customer-picker-selected.png", fullPage: true });

  await page.getByRole("button", { name: "Next customer page" }).click();
  await expect(page.getByTestId("dashboard-estimate-customer-pagination")).toContainText("Showing 9–16 of 30");
  await expect(page.getByTestId("dashboard-estimate-selected-customer")).toContainText("remains selected");
  await page.screenshot({ path: "test-results/estimate-customer-picker-desktop-page-2.png", fullPage: true });

  await page.getByTestId("dashboard-estimate-customer-search").fill("Company 18");
  await expect(page.getByTestId("dashboard-estimate-customer-217")).toBeVisible();
  await expect(page.getByTestId("dashboard-estimate-customer-pagination")).toContainText("Page 1 of 1");
  await expect(page.getByTestId("dashboard-estimate-selected-customer")).toContainText("Company 02");
  await expect(page.getByTestId("dashboard-estimate-customer-alphabet")).toHaveCount(0);
  await page.screenshot({ path: "test-results/estimate-customer-picker-search.png", fullPage: true });

  await page.getByTestId("dashboard-estimate-customer-search-clear").click();
  await expect(page.getByTestId("dashboard-estimate-customer-pagination")).toContainText("Showing 1–8 of 30");
  await page.getByRole("button", { name: "Show customers beginning with C" }).click();
  await expect(page.getByRole("button", { name: "Show customers beginning with C" })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "test-results/estimate-customer-picker-alphabet.png", fullPage: true });
});

for (const width of [1440, 900, 390]) {
  test(`Create Estimate gives long-form project details adequate space at ${width}px`, async ({ page }) => {
    let createCount = 0;
    await page.setViewportSize({ width, height: width === 390 ? 844 : 950 });
    await mockDashboard(page, {
      onProposalCreate: () => {
        createCount += 1;
      },
    });
    await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
    await page.getByTestId("dashboard-quick-action-create-estimate").click({ force: true });
    await page.getByTestId("dashboard-estimate-customer-101").click();

    const property = page.getByTestId("dashboard-estimate-existing-property");
    const title = page.getByTestId("dashboard-estimate-existing-title");
    const description = page.getByTestId("dashboard-estimate-existing-description");
    const descriptionRow = page.getByTestId("dashboard-estimate-existing-description-row");
    const detailsPanel = page.getByTestId("dashboard-estimate-existing-details-panel");
    const customerPanel = page.getByTestId("dashboard-estimate-customer-panel");
    const schedule = page.getByTestId("dashboard-estimate-existing-scheduling-grid");
    const scheduleNote = page.getByTestId("dashboard-estimate-existing-scheduling-note");

    await property.fill("120 Oak Street, Austin, TX, 78701");
    await title.fill("Whole-home renovation estimate");
    await description.fill("Kitchen and bath renovation.\nPreserve the existing floors.\nCoordinate work around customer access.");
    await description.press("Enter");
    await description.type("Include alternate cabinet pricing.");

    await expect(property).toHaveValue("120 Oak Street, Austin, TX, 78701");
    await expect(title).toHaveValue("Whole-home renovation estimate");
    await expect(description).toHaveValue(/Kitchen and bath renovation\.\nPreserve the existing floors\.[\s\S]*Include alternate cabinet pricing\./);
    expect(createCount).toBe(0);

    const descriptionBox = await description.boundingBox();
    const descriptionRowBox = await descriptionRow.boundingBox();
    const scheduleBox = await schedule.boundingBox();
    const scheduleNoteBox = await scheduleNote.boundingBox();
    expect(descriptionBox.height).toBeGreaterThanOrEqual(176);
    expect(descriptionBox.width / descriptionRowBox.width).toBeGreaterThanOrEqual(0.98);
    expect(scheduleNoteBox.width / (scheduleBox.width - 24)).toBeGreaterThanOrEqual(0.95);
    await expect(schedule).toHaveAttribute("aria-describedby", "dashboard-estimate-existing-scheduling-note");

    if (width === 1440) {
      const customerBox = await customerPanel.boundingBox();
      const detailsBox = await detailsPanel.boundingBox();
      expect(Math.abs(customerBox.y - detailsBox.y)).toBeLessThanOrEqual(2);
      expect(detailsBox.width).toBeGreaterThan(customerBox.width);
      expect(descriptionBox.width).toBeGreaterThan(600);
    } else if (width === 900) {
      expect(descriptionBox.width).toBeGreaterThan(700);
    } else {
      expect(descriptionBox.width).toBeGreaterThan(280);
    }

    const modal = page.getByRole("dialog", { name: "Create Estimate" });
    expect(await modal.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.getByTestId("dashboard-estimate-launch").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("dashboard-estimate-launch")).toBeVisible();

    const suffix = width === 1440 ? "desktop" : `${width}px`;
    await page.screenshot({ path: `test-results/create-estimate-layout-${suffix}.png`, fullPage: true });
  });
}

for (const appearance of ["dark", "light"]) {
  for (const width of [1440, 900, 390]) {
    test(`Create Estimate native date controls work in ${appearance} appearance at ${width}px`, async ({ page }) => {
      let createCount = 0;
      let createPayload = null;
      await page.addInitScript((theme) => {
        window.localStorage.setItem("myhomebro.appearance.v1", theme);
        window.__estimateDatePickerCalls = [];
        HTMLInputElement.prototype.showPicker = function showPickerForTest() {
          window.__estimateDatePickerCalls.push(this.name);
          this.focus();
        };
      }, appearance);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 950 });
      await mockDashboard(page, {
        proposalId: 710,
        onProposalCreate: (payload) => {
          createCount += 1;
          createPayload = payload;
        },
      });
      await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
      await page.getByTestId("dashboard-quick-action-create-estimate").click({ force: true });
      await page.getByTestId("dashboard-estimate-customer-101").click();
      await page.getByTestId("dashboard-estimate-existing-title").fill("Scheduled kitchen estimate");
      await page.getByTestId("dashboard-estimate-existing-description").fill("Preserve cabinets and update counters.");
      await page.getByTestId("dashboard-estimate-existing-priority").selectOption("required");
      await page.getByTestId("dashboard-estimate-existing-start-type").selectOption("specific_date");
      await page.getByTestId("dashboard-estimate-existing-completion-type").selectOption("specific_date");

      const start = page.getByTestId("dashboard-estimate-existing-start-date");
      const completion = page.getByTestId("dashboard-estimate-existing-completion-date");
      const startButton = page.getByRole("button", { name: "Choose start date" });
      const completionButton = page.getByRole("button", { name: "Choose completion date" });
      await expect(startButton).toBeVisible();
      await expect(completionButton).toBeVisible();

      await startButton.click();
      await expect.poll(() => page.evaluate(() => window.__estimateDatePickerCalls)).toContain("project_start_date");
      await start.fill("2026-09-10");
      await completion.fill("2026-09-09");

      await page.getByTestId("dashboard-estimate-launch").click();
      await expect(page.locator("#dashboard-estimate-existing-completion-date-error")).toHaveText(
        "Completion date cannot be before start date."
      );
      await expect(completion).toHaveAttribute("aria-invalid", "true");
      expect(createCount).toBe(0);

      await completion.fill("2026-09-20");
      await completionButton.click();
      await expect.poll(() => page.evaluate(() => window.__estimateDatePickerCalls)).toContain("project_completion_date");
      await page.getByTestId("dashboard-estimate-customer-101").click();
      await expect(start).toHaveValue("2026-09-10");
      await expect(completion).toHaveValue("2026-09-20");
      await expect(page.getByTestId("dashboard-estimate-existing-title")).toHaveValue("Scheduled kitchen estimate");
      await expect(page.getByTestId("dashboard-estimate-existing-description")).toHaveValue("Preserve cabinets and update counters.");
      await expect(page.getByTestId("dashboard-estimate-existing-priority")).toHaveValue("required");

      await page.getByRole("button", { name: "Clear completion date" }).click();
      await expect(completion).toHaveValue("");
      await completion.fill("2026-09-21");

      if (appearance === "dark" && width === 1440) {
        await startButton.focus();
        await page.screenshot({ path: "test-results/create-estimate-start-date-picker.png", fullPage: true });
        await completionButton.focus();
        await page.screenshot({ path: "test-results/create-estimate-completion-date-picker.png", fullPage: true });
      }
      if (appearance === "dark" && width === 390) {
        await completionButton.scrollIntoViewIfNeeded();
        await completionButton.focus();
        await page.screenshot({ path: "test-results/create-estimate-date-picker-390px.png", fullPage: true });
      }

      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      await page.getByTestId("dashboard-estimate-launch").click();
      await expect(page).toHaveURL(/\/app\/proposals\/710$/);
      expect(createCount).toBe(1);
      expect(createPayload).toMatchObject({
        project_start_type: "specific_date",
        project_start_date: "2026-09-10",
        project_completion_type: "specific_date",
        project_completion_date: "2026-09-21",
        scheduling_priority: "required",
      });
    });
  }
}

for (const width of [900, 390]) {
  test(`Create Estimate customer picker remains bounded and reachable at ${width}px`, async ({ page }) => {
    const directory = Array.from({ length: 12 }, (_, index) => ({
      id: 300 + index,
      full_name: `Mobile Customer ${String(index + 1).padStart(2, "0")}`,
      email: `mobile${index + 1}@example.com`,
      street_address: `${index + 1} Pine Road`,
      city: "Austin",
      state: "TX",
      zip_code: "78702",
    }));
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await mockDashboard(page, {
      customerResponse: (url) => {
        const pageNumber = Number(url.searchParams.get("page") || 1);
        const pageSize = Number(url.searchParams.get("page_size") || 8);
        const start = (pageNumber - 1) * pageSize;
        return { count: 12, directory_total: 12, directory_letters: ["M"], results: directory.slice(start, start + pageSize) };
      },
    });
    await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
    await page.getByTestId("dashboard-quick-action-create-estimate").click();

    await expect(page.getByRole("radiogroup", { name: "Existing customers" }).locator("label")).toHaveCount(8);
    await expect(page.getByRole("button", { name: "Next customer page" })).toBeVisible();
    await expect(page.getByTestId("dashboard-estimate-launch")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    if (width === 390) {
      await page.screenshot({ path: "test-results/estimate-customer-picker-mobile.png", fullPage: true });
    }
  });
}

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
  await page.getByTestId("dashboard-estimate-new-start-type").selectOption("specific_date");
  await page.getByTestId("dashboard-estimate-new-start-date").fill("2026-08-15");
  await page.getByTestId("dashboard-estimate-new-completion-type").selectOption("specific_date");
  await page.getByTestId("dashboard-estimate-new-completion-date").fill("2026-09-01");
  await page.getByTestId("dashboard-estimate-new-priority").selectOption("preferred");
  await page.getByTestId("dashboard-estimate-launch").click();

  await expect(page).toHaveURL(/\/app\/proposals\/602$/);
  expect(createPayload).toMatchObject({
    source_type: "dashboard",
    customer_name: "Jordan Lee",
    customer_email: "jordan@example.com",
    customer_phone: "555-0199",
    property_address: "44 Cedar Lane, Austin, TX",
    project_title: "Bathroom Estimate",
    project_start_type: "specific_date",
    project_start_date: "2026-08-15",
    project_completion_type: "specific_date",
    project_completion_date: "2026-09-01",
    scheduling_priority: "preferred",
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

test("dashboard surfaces internal agreement planning alerts", async ({ page }) => {
  await mockDashboard(page, {
    agreementRows: [
      {
        id: 882,
        project_title: "Kitchen Remodel",
        status: "draft",
        planning_validation_status: "needs_review",
        planning_validation_checked_at: "2026-07-06T12:00:00Z",
        planning_validation_summary: {
          status: "needs_review",
          reason: "Timeline overlaps committed work or lacks complete planning context.",
        },
      },
    ],
  });
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("dashboard-next-action-item-planning-validation:882:needs_review")).toContainText(
    "Kitchen Remodel timeline needs review"
  );
  await expect(page.getByTestId("dashboard-next-action-button-planning-validation:882:needs_review")).toContainText(
    "Review timeline"
  );
});
