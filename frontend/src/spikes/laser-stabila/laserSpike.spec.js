import { expect, test } from "@playwright/test";

test("arms, captures with Enter, previews assignment, and resets locally", async ({ page }) => {
  await page.goto("/src/spikes/laser-stabila/index.html");
  await expect(page.getByText("HARNESS COMPLETE — HARDWARE VALIDATION BLOCKED")).toBeVisible();
  await page.getByLabel("Decimal separator").selectOption("period");
  await page.getByRole("button", { name: "Arm Capture" }).click();
  await expect(page.getByText("ARMED", { exact: true })).toBeVisible();
  const capture = page.getByLabel("Dedicated armed input");
  await capture.fill("12.345 m");
  await capture.press("Enter");
  await expect(page.getByText("DISARMED", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "12.3450000000" })).toBeVisible();
  await page.getByLabel("Project").fill("Synthetic Project");
  await expect(page.getByText(/"project": "Synthetic Project"/)).toBeVisible();
  await page.getByRole("button", { name: "Clear / Reset" }).click();
  await expect(page.getByText("No observations captured. Nothing is stored or uploaded.")).toBeVisible();
});

test("requires locale choice and warns when the dedicated field loses focus", async ({ page }) => {
  await page.goto("/src/spikes/laser-stabila/index.html");
  await page.getByRole("button", { name: "Arm Capture" }).click();
  const capture = page.getByLabel("Dedicated armed input");
  await capture.fill("12,345");
  await capture.press("Enter");
  await expect(page.getByRole("cell", { name: /^ambiguous Choose the expected/ })).toBeVisible();

  await page.getByRole("button", { name: "Arm Capture" }).click();
  await expect(capture).toBeFocused();
  await page.getByLabel("Capture session label").focus();
  await expect(page.getByText("Dedicated input lost focus. Disarm or refocus it before transmitting.")).toBeVisible();
  await page.getByRole("button", { name: "Disarm" }).click();
  await expect(page.getByText("DISARMED", { exact: true })).toBeVisible();
});
