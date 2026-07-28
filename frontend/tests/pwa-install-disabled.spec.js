import { expect, test } from "@playwright/test";

test("disabled PWA flag hides public installation access", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("landing-pwa-install-section")).toHaveCount(0);
  await expect(page.getByTestId("landing-header-pwa-install-button")).toHaveCount(0);
  await expect(page.getByTestId("pwa-install-button")).toHaveCount(0);
});
