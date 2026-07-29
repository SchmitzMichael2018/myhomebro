import { expect, test } from "@playwright/test";

async function installGuidedOnboardingMocks(page, role = "contractor") {
  await page.addInitScript(() => window.localStorage.setItem("access", "playwright-access-token"));

  await page.route("**/api/projects/whoami/", async (route) => {
    const selectedRole = typeof role === "function" ? role() : role;
    const payloads = {
      contractor: { id: 7, type: "contractor", role: "contractor_owner", email: "contractor@example.test" },
      employee: { id: 10, type: "subaccount", role: "employee", email: "employee@example.test" },
      subcontractor: { id: 11, type: "subcontractor", role: "subcontractor", email: "subcontractor@example.test" },
      customer: { id: 8, type: "customer", role: "homeowner", email: "customer@example.test" },
      property_manager: { id: 9, type: "property_manager", role: "property_manager", email: "pm@example.test" },
      tenant: { id: 12, type: "tenant", role: "tenant", email: "tenant@example.test" },
      admin: { id: 1, type: "admin", role: "reviewer", email: "admin@example.test" },
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payloads[selectedRole] || payloads.contractor) });
  });

  const emptyRoutes = [
    "**/api/projects/contractor-activation-summary/**",
    "**/api/projects/reviewer/queue-count/**",
    "**/api/notifications/unread-count/**",
    "**/api/notifications/**",
  ];
  for (const pattern of emptyRoutes) {
    await page.route(pattern, async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0, results: [] }) }));
  }
}

test("guided hub focuses one step, persists progress, and confirms destructive guide controls", async ({ page }) => {
  await installGuidedOnboardingMocks(page, "contractor");
  await page.goto("/app/guided-onboarding", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("guided-experience-hub")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contractor owner path" })).toBeVisible();
  await expect(page.getByTestId("guided-current-step")).toContainText("Company Setup");
  await expect(page.getByText("Walkthrough progress only.")).toBeVisible();

  await page.getByRole("button", { name: "Open Business profile" }).click();
  await expect(page.getByRole("link", { name: "Back to Guided Help" })).toBeVisible();
  await page.getByRole("link", { name: "Back to Guided Help" }).click();
  await expect(page.getByTestId("guided-current-step")).toContainText("Company Setup");

  await page.getByRole("button", { name: "Mark walkthrough step reviewed" }).click();
  await expect(page.getByTestId("guided-current-step")).toContainText("Marketing");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("guided-current-step")).toContainText("Marketing");

  await page.getByRole("button", { name: "Skip this guide" }).click();
  await expect(page.getByRole("dialog")).toContainText("without marking any workspace work complete");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("guided-current-step")).toContainText("Marketing");

  await page.getByRole("button", { name: "Restart walkthrough" }).click();
  await page.getByRole("button", { name: "Restart walkthrough", exact: true }).last().click();
  await expect(page.getByTestId("guided-current-step")).toContainText("Company Setup");
});

test("guided hub renders role-specific journeys and workspace guides", async ({ page }) => {
  let currentRole = "employee";
  await installGuidedOnboardingMocks(page, () => currentRole);

  for (const [role, heading, step] of [
    ["employee", "Employee path", "Review your dashboard"],
    ["subcontractor", "Subcontractor path", "Review assigned work"],
    ["customer", "Homeowner path", "Open your project portal"],
    ["property_manager", "Property manager path", "Review your property workspace"],
    ["tenant", "Tenant path", "Start a maintenance request"],
    ["admin", "Administrator path", "Review administration"],
  ]) {
    currentRole = role;
    await page.goto("/app/guided-onboarding", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByTestId("guided-current-step")).toContainText(step);
    await expect(page.getByRole("heading", { name: "Help where you work" })).toBeVisible();
  }
});

for (const width of [320, 375, 390, 430]) {
  test(`guided hub remains usable at ${width}px and in standalone display mode`, async ({ page }) => {
    await page.addInitScript(() => {
      const nativeMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) => query === "(display-mode: standalone)"
        ? { matches: true, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }
        : nativeMatchMedia(query);
    });
    await installGuidedOnboardingMocks(page, "contractor");
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/app/guided-onboarding", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("guided-experience-hub")).toBeVisible();
    await expect(page.getByTestId("guided-current-step")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
