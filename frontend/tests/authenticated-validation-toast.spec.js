import { expect, test } from "@playwright/test";

async function installAuth(page, appearance = "dark") {
  await page.addInitScript((theme) => {
    window.localStorage.setItem("access", "playwright-access-token");
    window.localStorage.setItem("myhomebro.appearance.v1", theme);
  }, appearance);
  await page.route("**/api/projects/whoami/", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: 7, type: "contractor", role: "contractor_owner" }),
    })
  );
  await page.route("**/api/payments/onboarding/status/", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ onboarding_status: "complete", connected: true }),
    })
  );
  await page.route("**/api/projects/contractors/me/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"id":77}' })
  );
}

function channel(value) {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(foreground, background) {
  const parse = (color) => (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const luminance = (color) => {
    const [r, g, b] = parse(color).map(channel);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("missing street address uses the shared readable toast and focuses the field", async ({ page }) => {
  await installAuth(page);
  let createRequests = 0;
  await page.route("**/api/projects/homeowners/", (route) => {
    createRequests += 1;
    return route.fulfill({ status: 201, contentType: "application/json", body: '{"id":91}' });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app/customers/new", { waitUntil: "domcontentloaded" });
  await page.locator('input[name="full_name"]').fill("Preserved Customer");
  await page.locator('input[name="email"]').fill("preserved@example.com");
  await page.locator('input[name="address_line_2"]').fill("Suite 200");
  await page.getByRole("button", { name: "Create Customer" }).click();

  const street = page.locator("#mhb-customerform-290");
  const notification = page.locator(".mhb-toast--error");
  await expect(notification).toContainText("Street address is required.");
  await expect(street).toBeFocused();
  await expect(street).toHaveAttribute("aria-invalid", "true");
  await expect(street).toHaveAttribute("aria-describedby", "customer-street-address-error");
  await expect(page.locator("#customer-street-address-error")).toHaveText(
    "Street address is required."
  );
  await expect(page.locator('input[name="full_name"]')).toHaveValue("Preserved Customer");
  await expect(page.locator('input[name="address_line_2"]')).toHaveValue("Suite 200");
  expect(createRequests).toBe(0);

  const colors = await notification.evaluate((node) => {
    const style = getComputedStyle(node);
    return { foreground: style.color, background: style.backgroundColor };
  });
  expect(contrastRatio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);

  await expect.poll(async () => (await notification.boundingBox())?.y || 0).toBeGreaterThanOrEqual(80);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

  const assistantButton = page.getByRole("button", { name: "Open Project Assistant" });
  await assistantButton.click();
  await expect(notification).toBeVisible();
  await expect(page.getByTestId("assistant-desktop-dock-close")).toBeVisible();
  await page.screenshot({
    path: "test-results/authenticated-validation-toast-with-assistant-1440.png",
    fullPage: true,
  });

  const dismiss = notification.getByRole("button", { name: "Dismiss notification" });
  await dismiss.focus();
  await page.keyboard.press("Enter");
  await expect(notification).toBeHidden();
});

for (const appearance of ["dark", "light"]) {
  for (const width of [900, 390]) {
    test(`validation toast wraps without overflow in ${appearance} appearance at ${width}px`, async ({ page }) => {
      await installAuth(page, appearance);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("/app/customers/new", { waitUntil: "domcontentloaded" });
      await page.locator('input[name="address_line_2"]').fill("Unit 4");
      await page.getByRole("button", { name: "Create Customer" }).click();

      const notification = page.locator(".mhb-toast--error");
      await expect(notification).toContainText("Street address is required.");
      const box = await notification.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      if (appearance === "dark" && width === 390) {
        await page.screenshot({
          path: "test-results/authenticated-validation-toast-390.png",
          fullPage: true,
        });
      }
    });
  }
}
