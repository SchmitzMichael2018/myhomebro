import { expect, test } from "@playwright/test";

async function installStripeEmbeddedOnboardingRoutes(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  let connected = false;

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
    const script = `
      window.StripeConnect = {
        init({ publishableKey, fetchClientSecret }) {
          window.__stripePublishableKey = publishableKey;
          window.__stripeFetchClientSecretPromise = Promise.resolve(fetchClientSecret && fetchClientSecret());
          return {
            create(name) {
              const root = document.createElement("div");
              root.setAttribute("data-testid", "stripe-connect-account-onboarding");
              root.dataset.component = name;

              const button = document.createElement("button");
              button.type = "button";
              button.textContent = "Complete embedded onboarding";
              button.setAttribute("data-testid", "stripe-connect-complete");
              button.className = "rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white";
              button.addEventListener("click", async () => {
                await fetch("/__stripe_embedded_complete__", { method: "POST" });
                if (typeof root.__onExit === "function") {
                  await root.__onExit();
                }
              });

              root.setOnExit = (fn) => {
                root.__onExit = fn;
              };
              root.setOnStepChange = (fn) => {
                root.__onStepChange = fn;
                if (typeof fn === "function") {
                  fn({ step: "business_profile" });
                }
              };
              root.appendChild(button);
              return root;
            },
          };
        },
      };
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
}

test("embedded Stripe onboarding stays in-app and shows success after completion", async ({ page }) => {
  await installStripeEmbeddedOnboardingRoutes(page);

  await page.goto("/app/onboarding/stripe", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("embedded-stripe-onboarding-page")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText("Finish payment setup without leaving MyHomeBro")).toBeVisible();
  await expect(page.getByTestId("embedded-stripe-connect-container")).toBeVisible();
  await expect(page.getByTestId("stripe-connect-complete")).toBeVisible();

  await page.getByTestId("stripe-connect-complete").click();

  await expect(page.getByTestId("embedded-stripe-success")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText("Your Stripe account is ready.")).toBeVisible();
});
