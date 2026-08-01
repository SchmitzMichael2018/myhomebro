import { expect, test } from "@playwright/test";

async function installStripeEmbeddedOnboardingRoutes(page, options = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  let connected = false;
  let sessionRequests = 0;
  let hostedRequests = 0;

  await page.route("**/api/projects/whoami/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 91,
        type: "contractor",
        role: "contractor_owner",
        email: "stripe-embedded@example.com",
      }),
    });
  });

  await page.route("**/api/payments/onboarding/status/", async (route) => {
    if (options.statusDelay) await new Promise((resolve) => setTimeout(resolve, options.statusDelay));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        onboarding_status: connected ? "completed" : "in_progress",
        linked: true,
        connected,
        account_id: "acct_embedded_123",
        charges_enabled: connected,
        payouts_enabled: connected,
        details_submitted: connected,
        requirements_pending: !connected,
        resume_url: "/app/onboarding/stripe",
        onboarding: {
          business_name: "Stripe Embedded Contractor",
          step: connected ? "complete" : "stripe",
          stripe_ready: connected,
        },
      }),
    });
  });

  await page.route("**/api/payments/onboarding/account-session/", async (route) => {
    sessionRequests += 1;
    if (options.sessionDelay) await new Promise((resolve) => setTimeout(resolve, options.sessionDelay));
    if (options.sessionFailure) {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Stripe setup is temporarily unavailable.", support_reference: "STRIPE-ACCOUNT-SESSION" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        account_id: "acct_embedded_123",
        client_secret: "seti_embedded_secret_123",
        resume_url: "/app/onboarding/stripe",
        onboarding: {
          business_name: "Stripe Embedded Contractor",
          step: "stripe",
          stripe_ready: false,
        },
      }),
    });
  });

  await page.route("**/connect-js.stripe.com/v1.0/connect.js", async (route) => {
    if (options.scriptFailure) {
      await route.abort("blockedbyclient");
      return;
    }
    const script = `
      const stripeConnectOnLoad = window.StripeConnect && window.StripeConnect.onLoad;
      if (!customElements.get("stripe-connect-account-onboarding")) {
        customElements.define("stripe-connect-account-onboarding", class extends HTMLElement {
          connectedCallback() {
            if (this.querySelector("button")) return;
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = "Complete embedded onboarding";
            button.setAttribute("data-testid", "stripe-connect-complete");
            button.addEventListener("click", async () => {
              await fetch("/__stripe_embedded_complete__", { method: "POST" });
              if (typeof this.__onExit === "function") await this.__onExit();
            });
            this.appendChild(button);
          }
          setConnector() {}
          setOnExitInternalOnly(fn) { this.__onExit = fn; }
          setOnStepChangeInternalOnly(fn) {
            if (typeof fn === "function") fn({ step: "business_profile" });
          }
          setOnLoaderStartInternalOnly(fn) {
            if (!window.__stripeLoadFailure && typeof fn === "function") setTimeout(() => fn({}), 0);
          }
          setOnLoadErrorInternalOnly(fn) {
            if (window.__stripeLoadFailure && typeof fn === "function") {
              setTimeout(() => fn({ elementTagName: "account-onboarding", error: { type: "render_error", message: "mock secret must stay hidden" } }), 0);
            }
          }
        });
      }
      window.StripeConnect = {
        init({ publishableKey, fetchClientSecret }) {
          window.__stripePublishableKey = publishableKey;
          window.__stripeFetchClientSecretPromise = Promise.resolve(fetchClientSecret && fetchClientSecret());
          return { connect: {} };
        },
      };
      if (typeof stripeConnectOnLoad === "function") stripeConnectOnLoad();
    `;
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: script,
    });
  });

  await page.route("**/__stripe_embedded_complete__", async (route) => {
    connected = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route("**/api/payments/onboarding/start/", async (route) => {
    hostedRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ onboarding_url: "https://connect.stripe.com/setup/test-safe" }),
    });
  });

  await page.route("https://connect.stripe.com/setup/test-safe", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html", body: "<title>Stripe secure setup</title>" });
  });

  return {
    get sessionRequests() { return sessionRequests; },
    get hostedRequests() { return hostedRequests; },
  };
}

test("embedded Stripe onboarding stays in-app and shows success after completion", async ({ page }) => {
  await installStripeEmbeddedOnboardingRoutes(page);

  await page.goto("/app/onboarding/stripe", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("embedded-stripe-onboarding-page")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByRole("heading", { name: "Set up payments securely" })).toBeVisible();
  await expect(page.getByTestId("embedded-stripe-connect-container")).toBeVisible();
  await expect(page.getByTestId("stripe-connect-complete")).toBeVisible();
  await page.screenshot({ path: "test-results/stripe-embedded-success-mock.png", fullPage: true });

  await page.getByTestId("stripe-connect-complete").click();

  await expect(page.getByTestId("embedded-stripe-success")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText("Payment setup complete")).toBeVisible();
});

test("embedded Stripe shows one loading state while preparing a fresh session", async ({ page }) => {
  await installStripeEmbeddedOnboardingRoutes(page, { statusDelay: 800 });
  await page.goto("/app/onboarding/stripe", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("embedded-stripe-loading")).toBeVisible();
  await expect(page.getByTestId("embedded-stripe-error")).toHaveCount(0);
  await page.screenshot({ path: "test-results/stripe-embedded-loading.png", fullPage: true });
  await expect(page.getByTestId("embedded-stripe-ready")).toBeVisible({ timeout: 15000 });
});

test("a blocked Connect.js load becomes one handled operational error", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const calls = await installStripeEmbeddedOnboardingRoutes(page, { scriptFailure: true });

  await page.goto("/app/onboarding/stripe", { waitUntil: "domcontentloaded" });

  const error = page.getByTestId("embedded-stripe-error");
  await expect(error).toBeVisible({ timeout: 15000 });
  await expect(error).toContainText("Support reference: CONNECT-INITIALIZATION");
  await expect(page.getByTestId("embedded-stripe-loading")).toHaveCount(0);
  await expect(page.getByTestId("embedded-stripe-ready")).toBeHidden();
  expect(calls.sessionRequests).toBe(1);
  expect(pageErrors).toEqual([]);
});

test("embedded failure is exclusive, compact, retryable, and hides the raw account ID", async ({ page }) => {
  await page.addInitScript(() => { window.__stripeLoadFailure = true; });
  const calls = await installStripeEmbeddedOnboardingRoutes(page, { statusDelay: 500 });
  await page.goto("/app/onboarding/stripe", { waitUntil: "domcontentloaded" });

  const error = page.getByTestId("embedded-stripe-error");
  await expect(error).toBeVisible({ timeout: 15000 });
  await expect(error).toContainText("Stripe setup could not be loaded");
  await expect(error).toContainText("Support reference: CONNECT-RENDER_ERROR");
  await expect(page.getByTestId("embedded-stripe-loading")).toHaveCount(0);
  await expect(page.getByTestId("embedded-stripe-ready")).toBeHidden();
  await expect(page.getByText("acct_embedded_123")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("mock secret");
  expect(calls.sessionRequests).toBe(1);
  await page.screenshot({ path: "test-results/stripe-embedded-error-desktop.png", fullPage: true });

  const retry = page.getByTestId("embedded-stripe-retry");
  await retry.evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(page.getByTestId("embedded-stripe-loading")).toBeVisible();
  await expect(error).toBeVisible({ timeout: 15000 });
  expect(calls.sessionRequests).toBe(2);
  expect(await error.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(300);
});

test("hosted fallback confirms and launches exactly once", async ({ page }) => {
  await page.addInitScript(() => { window.__stripeLoadFailure = true; });
  const calls = await installStripeEmbeddedOnboardingRoutes(page);
  await page.goto("/app/onboarding/stripe", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("embedded-stripe-error")).toBeVisible({ timeout: 15000 });

  await page.getByTestId("embedded-stripe-hosted-fallback").click();
  const confirmation = page.getByTestId("embedded-stripe-hosted-confirmation");
  await expect(confirmation).toContainText("You’ll temporarily leave MyHomeBro");
  await page.screenshot({ path: "test-results/stripe-hosted-fallback-confirmation.png", fullPage: true });
  await page.getByTestId("embedded-stripe-hosted-confirm").evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(page).toHaveURL(/connect\.stripe\.com\/setup\/test-safe/);
  expect(calls.hostedRequests).toBe(1);
});

for (const { width, height, name } of [
  { width: 1440, height: 900, name: "desktop" },
  { width: 900, height: 900, name: "tablet" },
  { width: 390, height: 844, name: "mobile" },
]) {
  test(`compact Stripe error has no document overflow on ${name}`, async ({ page }) => {
    await page.addInitScript(() => { window.__stripeLoadFailure = true; });
    await installStripeEmbeddedOnboardingRoutes(page);
    await page.setViewportSize({ width, height });
    await page.goto("/app/onboarding/stripe", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("embedded-stripe-error")).toBeVisible({ timeout: 15000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/stripe-embedded-error-${name}.png`, fullPage: true });
  });
}
