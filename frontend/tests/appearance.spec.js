import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const APPEARANCE_KEY = "myhomebro.appearance.v1";

async function installAuthenticatedAppearanceMocks(page, savedAppearance) {
  await page.addInitScript(({ key, saved }) => {
    window.localStorage.setItem("access", "playwright-access-token");
    if (!window.sessionStorage.getItem("appearance-fixture-initialized")) {
      if (saved) window.localStorage.setItem(key, saved);
      else window.localStorage.removeItem(key);
      window.sessionStorage.setItem("appearance-fixture-initialized", "true");
    }
  }, { key: APPEARANCE_KEY, saved: savedAppearance });

  await page.route(/^https?:\/\/[^/]+\/api\/.*/, async (route) => {
    const url = route.request().url();
    const body = url.includes("notifications")
      ? { results: [], unread_count: 0 }
      : url.includes("activation-summary")
        ? { should_show_activation_guide: false, guide_sections: {} }
        : { results: [] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.route("**/api/projects/whoami/", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      id: 7,
      type: "contractor",
      role: "contractor_owner",
      email: "appearance@myhomebro.local",
    }),
  }));

  await page.route("**/api/projects/contractors/me/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      id: 77,
      contractor_onboarding_status: "complete",
      business_name: "Appearance Contracting",
      onboarding: { status: "complete", stripe_ready: true, first_value_reached: true },
      ai: { access: "included", enabled: true },
    }),
  }));

  await page.route("**/api/projects/business/contractor/summary/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      command_center: { metrics: {}, needs_attention: [], business_health: {}, morning_brief: {} },
      snapshot: {},
      financial_summary: {},
      business_performance: { funnel: {}, conversion_rates: {}, revenue: {} },
      contractor_insights: { available: false, summary_cards: [], comparison_rows: [], recommendations: [] },
      revenue_series: [],
      workflow_series: [],
      financial_series: [],
      financial_insights: [],
      recent_financial_events: [],
      by_category: [],
    }),
  }));

}

async function chooseAppearance(page, label) {
  await page.getByTestId("appearance-menu-trigger").click();
  await page.getByRole("menuitemradio", { name: label }).click();
}

test("Dark is the authenticated default and the Appearance menu is unique and accessible", async ({ page }) => {
  await installAuthenticatedAppearanceMocks(page);
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });

  await expect(page.locator("html")).toHaveAttribute("data-mhb-appearance", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-mhb-theme", "dark");
  await expect(page.getByTestId("appearance-menu-trigger")).toHaveCount(1);

  await page.getByTestId("appearance-menu-trigger").click();
  await expect(page.getByRole("menuitemradio", { name: "System" })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Light" })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("appearance-menu")).toHaveCount(0);
  await expect(page.getByTestId("appearance-menu-trigger")).toBeFocused();
});

test("Light persists across reload and Insights uses the operational light tokens", async ({ page }) => {
  await installAuthenticatedAppearanceMocks(page);
  await page.goto("/app/business", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Insights", exact: true })).toBeVisible();

  await chooseAppearance(page, "Light");
  await expect(page.locator("html")).toHaveAttribute("data-mhb-theme", "light");
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), APPEARANCE_KEY)).toBe("light");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-mhb-theme", "light");
  await expect(page.locator(".mhb-insights-workspace")).toHaveCSS("color", "rgb(15, 23, 42)");
});

test("System follows OS changes while explicit choices ignore them", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await installAuthenticatedAppearanceMocks(page);
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
  await chooseAppearance(page, "System");
  await expect(page.locator("html")).toHaveAttribute("data-mhb-appearance", "system");
  await expect(page.locator("html")).toHaveAttribute("data-mhb-theme", "dark");

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-mhb-theme", "light");
  await chooseAppearance(page, "Dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-mhb-theme", "dark");
});

test("Marketing stays curated light without overwriting the operational preference", async ({ page }) => {
  await installAuthenticatedAppearanceMocks(page, "dark");
  await page.goto("/app/marketing", { waitUntil: "domcontentloaded" });

  await expect(page.locator("html")).toHaveAttribute("data-mhb-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-mhb-surface", "curated-light");
  await page.getByTestId("appearance-menu-trigger").click();
  await expect(page.getByTestId("appearance-menu")).toContainText("Marketing uses its curated workspace appearance.");
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), APPEARANCE_KEY)).toBe("dark");

  await page.goto("/app/business", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-mhb-surface", "operational");
  await expect(page.locator("html")).toHaveAttribute("data-mhb-theme", "dark");
});

test("Project Assistant inherits operational Dark and Light", async ({ page }) => {
  await installAuthenticatedAppearanceMocks(page, "dark");
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
  await page.getByTestId("assistant-dock-open-button").click();
  await expect(page.getByTestId("assistant-desktop-dock")).toBeVisible();
  await expect(page.getByTestId("assistant-desktop-dock")).toHaveCSS("color", "rgb(248, 251, 255)");

  await page.getByTestId("assistant-desktop-dock-close").click();
  await chooseAppearance(page, "Light");
  await page.getByTestId("assistant-dock-open-button").click();
  await expect(page.getByTestId("assistant-desktop-dock")).toHaveCSS("color", "rgb(15, 23, 42)");
});

test("authenticated header stays contained at supported desktop widths", async ({ page }) => {
  await installAuthenticatedAppearanceMocks(page);
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 1440, height: 1000 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("appearance-menu-trigger")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
  }
});

test("capture authenticated appearance visual QA states", async ({ page }) => {
  test.setTimeout(120000);
  const outputDir = path.join("test-results", "visual-qa", "appearance");
  await fs.mkdir(outputDir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await installAuthenticatedAppearanceMocks(page, "dark");

  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(outputDir, "dashboard-dark.png"), fullPage: false });
  await page.getByTestId("appearance-menu-trigger").click();
  await page.screenshot({ path: path.join(outputDir, "appearance-menu-dark.png"), fullPage: false });
  await page.keyboard.press("Escape");
  await page.getByTestId("assistant-dock-open-button").click();
  await page.screenshot({ path: path.join(outputDir, "assistant-dark.png"), fullPage: false });
  await page.getByTestId("assistant-desktop-dock-close").click();

  await chooseAppearance(page, "Light");
  const dashboardPrimaryAction = page.locator('[data-testid^="dashboard-next-action-button-"]').first();
  await expect(dashboardPrimaryAction).toBeVisible();
  await expect(dashboardPrimaryAction).toHaveCSS("background-color", "rgb(37, 99, 235)");
  await expect(dashboardPrimaryAction).toHaveCSS("color", "rgb(248, 250, 252)");
  await page.screenshot({ path: path.join(outputDir, "dashboard-light.png"), fullPage: false });
  await page.getByTestId("assistant-dock-open-button").click();
  await page.screenshot({ path: path.join(outputDir, "assistant-light.png"), fullPage: false });
  await page.getByTestId("assistant-desktop-dock-close").click();

  await page.goto("/app/business", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Insights", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(outputDir, "insights-light.png"), fullPage: false });
  await chooseAppearance(page, "Dark");
  await expect(page.getByRole("tab", { name: "Executive" })).toHaveCSS("color", "rgb(219, 234, 254)");
  await expect(page.getByRole("tab", { name: "Executive" })).toHaveCSS("background-color", "rgb(13, 36, 64)");
  await page.screenshot({ path: path.join(outputDir, "insights-dark.png"), fullPage: false });

  await page.goto("/app/marketing", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-mhb-surface", "curated-light");
  await page.screenshot({ path: path.join(outputDir, "marketing-saved-dark.png"), fullPage: false });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: path.join(outputDir, "header-1280x800.png"), fullPage: false });
});
