import { test } from "@playwright/test";

test("dashboard screenshot", async ({ page }) => {
  await page.goto("http://localhost:5173/app/dashboard");

  // wait for UI to settle
  await page.waitForTimeout(2000);

  await page.screenshot({
    path: "dashboard-full.png",
    fullPage: true,
  });
});