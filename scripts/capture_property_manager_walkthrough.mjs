import playwright from "../frontend/node_modules/@playwright/test/index.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = playwright;
const email = process.env.MHB_QA_EMAIL;
const password = process.env.MHB_QA_PASSWORD;
if (!email || !password) throw new Error("Set MHB_QA_EMAIL and MHB_QA_PASSWORD.");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".tmp", "property-manager-walkthrough-captures");
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
  reducedMotion: "reduce",
});
const page = await context.newPage();

async function capture(name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(output, `${name}.png`) });
}

await page.goto("https://www.myhomebro.com/portal", { waitUntil: "networkidle" });
if (await page.getByTestId("customer-portal-login-form").isVisible().catch(() => false)) {
  await page.getByTestId("customer-portal-login-email-input").fill(email);
  await page.getByTestId("customer-portal-login-password-input").fill(password);
  await page.getByTestId("customer-portal-login-button").click();
}
await page.getByRole("heading", { name: "Property Manager Portal" }).waitFor({ timeout: 30_000 });
await page.waitForLoadState("networkidle");
for (const button of await page.getByRole("button", { name: "Not now", exact: true }).all()) {
  if (await button.isVisible().catch(() => false)) await button.click();
}
for (const button of await page.getByRole("button", { name: "Dismiss notification", exact: true }).all()) {
  if (await button.isVisible().catch(() => false)) await button.click();
}
await capture("01-operations");

await page.getByRole("button", { name: "Maintenance", exact: true }).click();
await page.getByRole("heading", { name: "Resident maintenance review" }).waitFor();
await page.getByRole("button", { name: "Archived", exact: true }).nth(0).click();
await page.getByRole("button", { name: "Archived", exact: true }).nth(1).click();
await page.getByText("TMR-000003", { exact: false }).first().waitFor({ timeout: 15_000 });
await capture("02-maintenance-history");

const workOrderCard = page.getByText("PWO-000003", { exact: false }).first();
await workOrderCard.evaluate((element) => element.scrollIntoView({ block: "start" }));
await capture("03-work-order-closeout");

await page.getByRole("button", { name: "Edit", exact: true }).first().click();
await page.getByTestId("property-work-order-continue-contractors").click();
await page.getByTestId("property-work-order-continue-finalize").click();
await page.getByTestId("property-work-order-scheduled-date").waitFor();
await capture("04-scheduling-and-evidence");
await page.getByRole("button", { name: "Cancel", exact: true }).click();

await page.getByRole("button", { name: "Properties", exact: true }).first().click();
await page.getByTestId("property-summary-selector").selectOption({ label: "QA Sunset Apartments" });
await page.getByText("QA Sunset Apartments", { exact: true }).first().waitFor();
await capture("05-properties");

await page.getByRole("button", { name: "Updates", exact: true }).click();
await capture("06-updates");

const resident = await context.newPage();
await resident.goto(
  "https://www.myhomebro.com/maintenance-request/status/accb8796-eedd-46a0-95ce-e6126ec85dad",
  { waitUntil: "networkidle" },
);
await resident.screenshot({ path: path.join(output, "07-resident-status.png") });

await browser.close();
console.log(output);
