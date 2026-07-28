import { expect, test } from "@playwright/test";

const iphoneUserAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
  + "AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";

async function openContractorLogin(page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("landing-sign-in-button").click();
  await page
    .getByTestId("landing-login-menu")
    .getByRole("button", { name: "Contractor Log In", exact: true })
    .click();
  await expect(page.getByTestId("login-modal")).toBeVisible();
}

async function expectInsideViewport(page, locator) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.width).toBeLessThanOrEqual(viewport.width - 24);
}

test.describe("standalone iPhone login viewport", () => {
  test.use({ userAgent: iphoneUserAgent });

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    { width: 393, height: 852 },
    { width: 430, height: 932 },
  ]) {
    test(`keeps login menu and modal inside ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(() => {
        const original = window.matchMedia.bind(window);
        window.matchMedia = (query) => (
          query === "(display-mode: standalone)"
            ? { matches: true, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } }
            : original(query)
        );
      });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.getByTestId("landing-sign-in-button").click();
      await expectInsideViewport(page, page.getByTestId("landing-login-menu"));
      await page
        .getByTestId("landing-login-menu")
        .getByRole("button", { name: "Contractor Log In", exact: true })
        .click();
      await expectInsideViewport(page, page.locator(".mhb-login-modal-card"));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }

  test("preserves focused fields and typed values through visual viewport resize", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      const viewport = new EventTarget();
      Object.assign(viewport, { height: 844, offsetTop: 0, width: 390 });
      Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    });
    await openContractorLogin(page);

    const email = page.getByTestId("login-email-input");
    const password = page.getByTestId("login-password-input");
    await email.focus();
    await email.fill("contractor@example.com");
    await page.evaluate(() => {
      window.visualViewport.height = 420;
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    await expect(page.getByTestId("login-modal")).toBeVisible();
    await expect(email).toHaveValue("contractor@example.com");
    await password.focus();
    await password.fill("password123");
    await page.evaluate(() => {
      window.visualViewport.height = 844;
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    await expect(page.getByTestId("login-modal")).toBeVisible();
    await expect(password).toHaveValue("password123");
    await expect(password).toHaveAttribute("autocomplete", "current-password");
    await expect(email).toHaveAttribute("autocomplete", "username");
  });
});

test("ordinary mobile and desktop login remain bounded", async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await openContractorLogin(page);
    await expectInsideViewport(page, page.locator(".mhb-login-modal-card"));
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
});
