import playwright from "../frontend/node_modules/@playwright/test/index.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = playwright;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".tmp", "onboarding-howto-captures");
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
page.setDefaultTimeout(12_000);
page.on("console", (message) => {
  if (message.type() === "error") console.error(`browser: ${message.text()}`);
});
page.on("pageerror", (error) => console.error(`page: ${error.message}`));

async function capture(name) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(output, `${name}.png`) });
}

console.log("Capturing signup");
await page.goto("http://127.0.0.1:5173/signup", { waitUntil: "domcontentloaded", timeout: 12_000 });
await page.getByRole("heading", { name: "Contractor Sign Up" }).waitFor();
await capture("profile-01-signup");

await page.addInitScript(() => {
  window.localStorage.setItem("access", "howto-demo-token");
});

const identity = {
  id: 77,
  type: "contractor",
  role: "contractor_owner",
  email: "demo.contractor@example.test",
};
const contractor = {
  id: 77,
  business_name: "Demo Home Services",
  city: "San Antonio",
  state: "TX",
  zip: "78205",
  skills: [],
  onboarding: {
    status: "not_started",
    step: "welcome",
    first_value_reached: false,
    stripe_ready: false,
    stripe_onboarding_status: "not_started",
    show_soft_stripe_prompt: false,
    trade_count: 0,
    service_region_label: "",
    step_number: 1,
    step_total: 3,
  },
  stripe_onboarding_status: "not_started",
};
let setupState = {
  work_description: "",
  project_family: { key: "", label: "" },
  project_families: [],
  project_style: {},
  milestone_tendencies: [],
  pricing_baseline: {},
  agreement_defaults: {},
  business_details: {
    service_area_type: "both",
    service_radius_miles: 25,
    emergency_services: false,
    licensed: false,
    insured: false,
  },
  recommended_setup: {},
  suggested_plan: {},
  source: "server",
  summary: "Tell us what kind of work you do and we will build your setup for you.",
  completed_at: null,
};

await page.route("**/api/projects/whoami/", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(identity) })
);
await page.route("**/api/projects/contractors/me/**", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(contractor) })
);
await page.route("**/api/projects/project-types/**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ results: [{ id: 1, value: "Remodeling", label: "Remodeling" }] }),
  })
);
await page.route("**/api/projects/project-subtypes/**", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) })
);
await page.route("**/api/projects/homeowners**", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) })
);
await page.route("**/api/projects/workspace-context/**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ project_family: { key: "", label: "" }, source: "server" }),
  })
);
await page.route("**/api/projects/contractors/onboarding/setup/**", async (route) => {
  if (route.request().method() === "PATCH") {
    const payload = route.request().postDataJSON();
    setupState = {
      ...setupState,
      work_description: payload.work_description || setupState.work_description,
      business_details: payload.business_details || setupState.business_details,
      project_family: { key: "bathroom_remodel", label: "Bathroom Remodel" },
      project_families: [{ key: "bathroom_remodel", label: "Bathroom Remodel" }],
      project_style: {
        workflow_style: "Remodel workflow",
        materials_behavior: "Materials are coordinated in a planned sequence.",
        project_family_cue: "Bathroom work benefits from clear preparation and finish phases.",
      },
      milestone_tendencies: [
        { title: "Preparation", note: "Confirm scope and protect the work area." },
        { title: "Installation", note: "Complete approved installation work." },
      ],
      pricing_baseline: {
        low: "3500",
        high: "6500",
        center: "5000",
        duration_low_days: 4,
        duration_high_days: 7,
        duration_days: 5,
        milestone_count: 3,
        confidence_level: "medium",
        confidence_reasoning: "A starting point to review before using on a project.",
      },
      agreement_defaults: {
        project_type: "Bathroom Remodel",
        project_subtype: "Bathroom Update",
        suggested_workflow: "Prepare, install, finish",
        suggested_template_label: "Bathroom Remodel Starter",
        payment_mode: "escrow",
        payment_structure: "progress",
      },
      completed_at: payload.completed ? "2026-09-15T12:00:00Z" : null,
    };
  }
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(setupState) });
});

await page.goto("http://127.0.0.1:5173/app/onboarding", { waitUntil: "domcontentloaded" });
await page.getByTestId("contractor-onboarding-welcome").waitFor();
await capture("profile-02-welcome");
await page.getByRole("button", { name: "Get started" }).click();
await page.getByTestId("contractor-onboarding-description").waitFor();
await page.getByPlaceholder("What kind of work do you usually do?").fill(
  "Bathroom remodeling, flooring, painting, and finish carpentry"
);
await capture("profile-03-services");
await page.getByRole("button", { name: "Continue" }).click();
await page.getByTestId("contractor-onboarding-business-details").waitFor();
await capture("profile-04-business-details");
await page.getByRole("button", { name: "Build my setup" }).click();
await page.getByTestId("contractor-onboarding-generated-setup").waitFor();
await capture("profile-05-review");

let stripeConnected = false;
await page.route("**/api/payments/onboarding/status/**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      onboarding_status: stripeConnected ? "completed" : "in_progress",
      linked: true,
      connected: stripeConnected,
      account_id: "acct_demo_safe_1234",
      charges_enabled: stripeConnected,
      payouts_enabled: stripeConnected,
      details_submitted: stripeConnected,
      requirements_pending: !stripeConnected,
      resume_url: "/app/onboarding/stripe",
      onboarding: { business_name: "Demo Home Services", stripe_ready: stripeConnected },
    }),
  })
);
await page.route("**/api/payments/onboarding/account-session/**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ account_id: "acct_demo_safe_1234", client_secret: "seti_demo_safe_secret" }),
  })
);
await page.route("**/connect-js.stripe.com/v1.0/connect.js", (route) => {
  const script = `
    const stripeConnectOnLoad = window.StripeConnect && window.StripeConnect.onLoad;
    if (!customElements.get("stripe-connect-account-onboarding")) {
      customElements.define("stripe-connect-account-onboarding", class extends HTMLElement {
        connectedCallback() {
          this.innerHTML = ` + "`" + `
            <section style="font-family:Arial,sans-serif;padding:24px;color:#f8fafc;background:#0b1f39;border-radius:16px">
              <div style="font-size:12px;letter-spacing:.16em;color:#93c5fd;font-weight:700">SECURE STRIPE SETUP · DEMO</div>
              <h2 style="margin:10px 0 8px;font-size:24px">Tell Stripe about your business</h2>
              <p style="margin:0 0 20px;color:#cbd5e1">Complete each section with accurate information.</p>
              <div style="display:grid;gap:12px">
                <div style="padding:14px;border:1px solid #334155;border-radius:12px">✓ Business details</div>
                <div style="padding:14px;border:1px solid #334155;border-radius:12px">○ Identity verification</div>
                <div style="padding:14px;border:1px solid #334155;border-radius:12px">○ Payout bank account</div>
              </div>
              <button data-testid="stripe-demo-complete" style="margin-top:20px;border:0;border-radius:10px;padding:12px 18px;background:#635bff;color:white;font-weight:700">Submit demo setup</button>
            </section>` + "`" + `;
          this.querySelector("button").addEventListener("click", async () => {
            await fetch("/__stripe_demo_complete__", { method: "POST" });
            if (typeof this.__onExit === "function") await this.__onExit();
          });
        }
        setConnector() {}
        setOnExitInternalOnly(fn) { this.__onExit = fn; }
        setOnStepChangeInternalOnly(fn) { if (fn) fn({ step: "business_profile" }); }
        setOnLoaderStartInternalOnly(fn) { if (fn) setTimeout(() => fn({}), 0); }
        setOnLoadErrorInternalOnly() {}
      });
    }
    window.StripeConnect = { init() { return { connect: {} }; } };
    if (typeof stripeConnectOnLoad === "function") stripeConnectOnLoad();
  `;
  return route.fulfill({ status: 200, contentType: "application/javascript", body: script });
});
await page.route("**/__stripe_demo_complete__", (route) => {
  stripeConnected = true;
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
});

await page.goto("http://127.0.0.1:5173/app/onboarding/stripe", { waitUntil: "domcontentloaded" });
await page.getByTestId("embedded-stripe-onboarding-page").waitFor({ timeout: 15000 });
await page.getByTestId("stripe-demo-complete").waitFor({ timeout: 15000 });
await capture("stripe-01-secure-setup");
await page.getByTestId("stripe-demo-complete").click();
await page.getByTestId("embedded-stripe-success").waitFor({ timeout: 15000 });
await capture("stripe-02-complete");

await browser.close();
console.log(output);
