import { expect, test } from "@playwright/test";

test("public landing page exposes persistent install access at mobile widths", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  const section = page.getByTestId("landing-pwa-install-section");
  await expect(section).toBeVisible();
  await expect(page.getByTestId("landing-header-pwa-install-button")).toBeVisible();
  await expect(page.getByTestId("landing-header-pwa-install-button")).toHaveAttribute(
    "aria-label",
    "Install MyHomeBro"
  );
  await expect(section.getByTestId("pwa-app-icon")).toBeVisible();
  await expect(section.getByTestId("landing-pwa-benefits").getByRole("listitem")).toHaveCount(3);
  const passiveBanner = page.getByTestId("pwa-passive-install-banner");
  await expect(passiveBanner.getByTestId("pwa-app-icon")).toBeVisible();
  await expect(section.getByRole("button", { name: "Install MyHomeBro" })).toBeVisible();
  await page.getByTestId("landing-header-pwa-install-button").click();
  await expect(page.getByTestId("pwa-install-dialog")).toBeVisible();
  await expect(page.getByTestId("pwa-install-value-copy")).toContainText(
    "Keep projects, estimates, messages, agreements, photos, payments, and property records in one place."
  );
  await expect(page.getByText("App installation is temporarily unavailable.")).toBeVisible();

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 375, height: 760 });
  await expect(section).toBeVisible();
  const headerBox = await page.getByTestId("landing-header-pwa-install-button").boundingBox();
  const bannerBox = await passiveBanner.boundingBox();
  expect(headerBox && bannerBox && bannerBox.y >= headerBox.y + headerBox.height).toBeTruthy();
});

test("captured Chromium prompt is invoked from the shared install dialog", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    event.prompt = () => {
      window.__pwaPromptInvoked = true;
      return Promise.resolve();
    };
    event.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(event);
  });
  await page.getByTestId("pwa-install-button").click();
  await page.getByRole("button", { name: "Install app" }).click();
  await expect.poll(() => page.evaluate(() => window.__pwaPromptInvoked)).toBe(true);
});

test("authenticated contractor sidebar exposes the same install dialog", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("access", "pwa-install-test-token");
  });
  await page.route("http://127.0.0.1:8000/api/**", async (route) => {
    const url = route.request().url();
    const body = url.includes("whoami")
      ? { id: 7, type: "contractor", role: "contractor_owner", email: "pwa@example.test" }
      : { results: [] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/app/notifications");
  const action = page.getByTestId("authenticated-pwa-install-button").first();
  await expect(action).toBeVisible();
  await expect(action.locator("svg")).toBeVisible();
  await expect(action).toHaveAttribute("aria-label", "Install MyHomeBro");
  await action.click();
  await expect(page.getByTestId("pwa-install-dialog")).toBeVisible();
  await expect(page.getByTestId("pwa-install-value-copy")).toContainText(
    "Manage customers, estimates, projects, milestones, payments, and field records from one place."
  );
});

test.describe("iOS installation guidance", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
      + "AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
    viewport: { width: 375, height: 812 },
  });

  test("shows Add to Home Screen steps", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("pwa-install-button").click();
    await expect(page.getByTestId("pwa-ios-instructions")).toContainText("Add to Home Screen");
    await expect(page.getByTestId("pwa-ios-instructions")).toContainText("Tap Add");
  });
});

test("standalone mode replaces install language with installed state", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) => (
      query === "(display-mode: standalone)"
        ? { matches: true, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } }
        : original(query)
    );
  });
  await page.goto("/");
  await expect(page.getByTestId("landing-header-pwa-install-button")).toHaveCount(0);
  await expect(page.getByTestId("pwa-install-button")).toContainText("App Installed");
  await expect(page.getByTestId("pwa-passive-install-banner")).toHaveCount(0);
});
