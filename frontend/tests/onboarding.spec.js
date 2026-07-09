import { expect, test } from "@playwright/test";

async function installGuidedOnboardingMocks(page, role = "contractor") {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  await page.route("**/api/projects/whoami/", async (route) => {
    const selectedRole = typeof role === "function" ? role() : role;
    const payloads = {
      contractor: {
        id: 7,
        type: "contractor",
        role: "contractor_owner",
        email: "contractor@myhomebro.local",
      },
      customer: {
        id: 8,
        type: "customer",
        role: "customer",
        email: "customer@myhomebro.local",
      },
      property_manager: {
        id: 9,
        type: "property_manager",
        role: "property_manager",
        email: "pm@myhomebro.local",
      },
      admin: {
        id: 1,
        type: "admin",
        role: "admin",
        email: "admin@myhomebro.local",
      },
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payloads[selectedRole] || payloads.contractor),
    });
  });

  await page.route("**/api/payments/onboarding/status/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ onboarding_status: "complete", connected: true }),
    });
  });

  await page.route("**/api/projects/contractor-activation-summary/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ guide_sections: {}, attention_counts: {} }),
    });
  });

  await page.route("**/api/projects/reviewer/queue-count/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ count: 0 }),
    });
  });

  await page.route("**/api/notifications/unread-count/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ count: 0 }),
    });
  });

  await page.route("**/api/notifications/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });
}

test("guided onboarding starts, pauses, resumes, skips, restarts, and completes", async ({ page }) => {
  await installGuidedOnboardingMocks(page, "contractor");
  await page.goto("/app/guided-onboarding", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("guided-onboarding-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome, Contractor" })).toBeVisible();
  await expect(page.getByTestId("guided-role-walkthrough")).toContainText("Company setup");
  await expect(page.getByTestId("guided-progress-checklists")).toContainText("Company Setup");
  await expect(page.getByTestId("guided-progress-checklists")).toContainText("Marketing");
  await expect(page.getByTestId("guided-progress-checklists")).toContainText("Team");
  await expect(page.getByTestId("guided-project-assistant-tips")).toContainText("Human approval required");
  await expect(page.getByTestId("guided-help-center")).toContainText("What can Project Assistant do?");
  await expect(page.getByTestId("guided-smart-empty-state")).toContainText("Project Assistant tip");

  await page.getByTestId("guided-start").click();
  await expect(page.getByTestId("guided-walkthrough-status")).toContainText("Step 1 of 10");
  await page.getByTestId("guided-next").click();
  await expect(page.getByTestId("guided-walkthrough-status")).toContainText("Step 2 of 10");
  await page.getByTestId("guided-resume-later").click();
  await expect(page.getByTestId("guided-walkthrough-status")).toContainText("Paused");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("guided-walkthrough-status")).toContainText("Paused");
  await page.getByTestId("guided-restart").click();
  await expect(page.getByTestId("guided-walkthrough-status")).toContainText("Step 1 of 10");
  await page.getByTestId("guided-skip").click();
  await expect(page.getByTestId("guided-walkthrough-status")).toContainText("Skipped");
  await page.getByTestId("guided-start").click();

  for (let i = 0; i < 10; i += 1) {
    await page.getByTestId("guided-next").click();
  }

  await expect(page.getByTestId("guided-walkthrough-status")).toContainText("Completed");
});

test("guided onboarding renders customer, property manager, and admin role paths", async ({ page }) => {
  let currentRole = "customer";
  await installGuidedOnboardingMocks(page, () => currentRole);

  for (const [role, expectedHeading, expectedText] of [
    ["customer", "Welcome, Customer", "Approve milestones"],
    ["property_manager", "Welcome, Property Manager", "Properties"],
    ["admin", "Welcome, Administrator", "Platform Health"],
  ]) {
    currentRole = role;
    await page.goto("/app/guided-onboarding", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: expectedHeading })).toBeVisible();
    await expect(page.getByTestId("guided-role-walkthrough")).toContainText(expectedText);
  }
});
