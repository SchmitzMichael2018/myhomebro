import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const APPEARANCE_KEY = "myhomebro.appearance.v1";

function contrastRatio(foreground, background) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const parse = (hex) => {
    const value = hex.replace("#", "");
    return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  };
  const luminance = (hex) => {
    const [red, green, blue] = parse(hex).map(channel);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

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
  const darkTokens = await page.locator("html").evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      app: styles.getPropertyValue("--mhb-surface-app").trim(),
      card: styles.getPropertyValue("--mhb-surface-card").trim(),
    };
  });
  expect(darkTokens).toEqual({ app: "#020713", card: "#0a1d35" });

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
  const lightTokens = await page.locator("html").evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      app: styles.getPropertyValue("--mhb-surface-app").trim(),
      workspace: styles.getPropertyValue("--mhb-surface-workspace").trim(),
      card: styles.getPropertyValue("--mhb-surface-card").trim(),
      primaryText: styles.getPropertyValue("--mhb-text-primary").trim(),
      mutedText: styles.getPropertyValue("--mhb-text-muted").trim(),
      primaryAction: styles.getPropertyValue("--mhb-interactive-primary").trim(),
      inverseText: styles.getPropertyValue("--mhb-text-inverse").trim(),
    };
  });
  expect(lightTokens.app).toBe("#e4eaf1");
  expect(lightTokens.workspace).toBe("#edf2f7");
  expect(lightTokens.card).toBe("#ffffff");
  expect(contrastRatio(lightTokens.primaryText, lightTokens.app)).toBeGreaterThan(12);
  expect(contrastRatio(lightTokens.mutedText, lightTokens.card)).toBeGreaterThan(5);
  expect(contrastRatio(lightTokens.inverseText, lightTokens.primaryAction)).toBeGreaterThan(5);
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
  const dashboardPriorityCard = page.locator('[data-testid^="dashboard-next-action-item-"]').first();
  await expect(dashboardPrimaryAction).toBeVisible();
  await expect(dashboardPrimaryAction).toHaveCSS("background-color", "rgb(29, 78, 216)");
  await expect(dashboardPrimaryAction).toHaveCSS("color", "rgb(248, 250, 252)");
  await expect(dashboardPriorityCard).toHaveAttribute("data-priority-tone", "growth");
  await expect(dashboardPriorityCard).toHaveCSS("border-left-color", "rgb(5, 150, 105)");
  await expect(page.getByTestId("dashboard-quick-action-create-estimate")).toHaveCSS("background-color", "rgb(29, 78, 216)");
  await expect(page.getByTestId("dashboard-quick-action-new-agreement")).toHaveCSS("background-color", "rgb(248, 250, 252)");
  await expect(page.getByTestId("dashboard-work-not-started")).toHaveCSS("background-color", "rgb(248, 250, 252)");
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 1440, height: 1000 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.screenshot({
      path: path.join(outputDir, `dashboard-light-${viewport.width}x${viewport.height}.png`),
      fullPage: false,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: path.join(outputDir, "dashboard-light-full.png"), fullPage: true });
  await page.locator("main").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.screenshot({ path: path.join(outputDir, "dashboard-light-lower.png"), fullPage: false });
  await page.locator("main").evaluate((element) => {
    element.scrollTop = 0;
  });
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

  await chooseAppearance(page, "Light");
  await page.goto("/app/marketing", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-mhb-surface", "curated-light");
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), APPEARANCE_KEY)).toBe("light");
  await page.screenshot({ path: path.join(outputDir, "marketing-saved-light.png"), fullPage: false });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: path.join(outputDir, "header-1280x800.png"), fullPage: false });
});
