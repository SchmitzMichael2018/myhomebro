import { expect, test } from "@playwright/test";

test("customer can create a free account, verify, add property, and reach dashboard step", async ({ page }) => {
  await page.route("**/api/accounts/auth/customer-register/", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        next_step: "verify_email",
        message: "Account created. Please check your email to verify your account.",
        user: { id: 11, email: "pat@example.com", first_name: "Pat", last_name: "Customer", is_active: false },
        customer: { id: 22, full_name: "Pat Customer", email: "pat@example.com", phone_number: "555-111-2222", created: true },
      }),
    });
  });

  await page.route("**/api/auth/login/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access: "access-token",
        refresh: "refresh-token",
        user: { id: 11, email: "pat@example.com", first_name: "Pat", last_name: "Customer", is_active: true },
      }),
    });
  });

  await page.route("**/api/projects/customer-portal/account/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        customer: { name: "Pat Customer", email: "pat@example.com" },
        account: { email: "pat@example.com", portal_token: "portal-token", has_user: true, has_usable_password: true },
        property_profiles: [
          {
            id: 31,
            display_name: "Primary Property",
            property_type: "single_family",
            address_line1: "",
            city: "",
            state: "",
            postal_code: "",
          },
        ],
        summary: {},
        requests: [],
        projects: [],
        bids: [],
        agreements: [],
        payments: [],
        documents: [],
      }),
    });
  });

  await page.route("**/api/projects/customer-portal/portal-token/property/", async (route) => {
    expect(route.request().method()).toBe("PATCH");
    const payload = route.request().postDataJSON();
    expect(payload.id).toBe(31);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto("/create-account", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("customer-account-create-form")).toBeVisible();

  await page.getByTestId("customer-account-name").fill("Pat Customer");
  await page.getByTestId("customer-account-email").fill("pat@example.com");
  await page.getByTestId("customer-account-phone").fill("555-111-2222");
  await page.getByTestId("customer-account-password").fill("StrongPass123!");
  await page.getByTestId("customer-account-password-confirm").fill("StrongPass123!");
  await page.getByTestId("customer-account-create-submit").click();

  await expect(page.getByTestId("customer-account-verify-step")).toBeVisible();
  await page.getByTestId("customer-account-verified-continue").click();

  await page.getByTestId("customer-account-signin-password").fill("StrongPass123!");
  await page.getByTestId("customer-account-signin-submit").click();

  await expect(page.getByTestId("customer-account-property-form")).toBeVisible();
  await page.getByTestId("customer-account-property-name").fill("Main Home");
  await page.getByTestId("customer-account-property-address").fill("123 Main St");
  await page.getByTestId("customer-account-property-city").fill("Austin");
  await page.getByTestId("customer-account-property-state").fill("TX");
  await page.getByTestId("customer-account-property-zip").fill("78701");
  await page.getByTestId("customer-account-property-submit").click();

  await expect(page.getByTestId("customer-account-dashboard-ready")).toBeVisible();
  await expect(page.getByText("link it to this account automatically")).toBeVisible();
});

test("landing page exposes Create Free Account separately from Start a Project", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("landing-start-project-intake-button")).toBeVisible();
  await expect(page.getByTestId("landing-create-free-account-button")).toBeVisible();

  await page.getByTestId("landing-create-free-account-button").click();
  await expect(page).toHaveURL(/\/create-account$/);
  await expect(page.getByTestId("customer-account-create-form")).toBeVisible();
});
