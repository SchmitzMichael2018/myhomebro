import { expect, test } from "@playwright/test";

const review = {
  version: 1,
  status: "viewed",
  sent_at: "2026-08-09T12:00:00Z",
  expires_at: "2026-09-08T12:00:00Z",
  is_expired: false,
  acknowledgement: "I approve this estimate as the basis for preparing the project agreement. This does not sign or execute the agreement.",
  portal: { account_exists: false, status: "setup_pending", url: "/activate-customer/setup-token", label: "Create MyHomeBro Account" },
  estimate: {
    contractor: { name: "Proposal Builder LLC" },
    customer: { name: "Casey Homeowner" },
    project: { title: "Kitchen Refresh", property: "123 Main St", description: "Refresh cabinets.", included_work: "Install cabinets", excluded_work: "Appliances", assumptions: "Clear access", allowances: "Fixtures" },
    pricing: { line_items: [{ category: "labor", category_label: "Labor", description: "Installation of cabinets and finish trim around existing architectural details", quantity: "2.00", unit: "hours", unit_price: "250.00", total: "500.00" }], subtotal: "500.00", tax: "0.00", discounts: "0.00", incidentals_reserve: "50.00", total: "550.00" },
  },
};

test("customer reviews and accepts the exact estimate version", async ({ page }) => {
  await page.route("**/api/projects/proposal-reviews/review-token/", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      expect(body.action).toBe("accept");
      expect(body.acknowledgement).toContain("does not sign or execute");
      return route.fulfill({ json: { ...review, status: "accepted" } });
    }
    return route.fulfill({ json: review });
  });
  await page.goto("/estimate-review/review-token");
  await expect(page.getByTestId("customer-estimate-review")).toContainText("Kitchen Refresh");
  await expect(page.getByTestId("customer-estimate-review")).not.toContainText("Pricing Benchmark");
  await expect(page.getByTestId("customer-estimate-pricing").getByRole("columnheader")).toHaveText(["Description", "Price"]);
  await expect(page.getByTestId("customer-estimate-pricing")).not.toContainText("2.00 hours");
  await expect(page.getByTestId("estimate-portal-promotion")).toContainText("without an account");
  await page.getByRole("button", { name: "Accept Estimate" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm acceptance" }).click();
  await expect(page.getByText("Estimate accepted", { exact: true })).toBeVisible();
  await expect(page.getByText(/not an Agreement signature/i)).toBeVisible();
});

test("estimate-origin activation sets a chosen password and enters the portal", async ({ page }) => {
  await page.route("**/api/projects/proposal-portal-activations/setup-token/", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      expect(body.password).toBe("Customer-pass-937!");
      return route.fulfill({ json: { ok: true, portal_url: "/portal/portal-token" } });
    }
    return route.fulfill({ json: { email: "casey@example.com", account_exists: false, estimate_url: "/estimate-review/review-token" } });
  });
  await page.route("**/api/projects/customer-portal/portal-token/", (route) => route.fulfill({ json: { customer: { name: "Casey", email: "casey@example.com" }, account: { has_usable_password: true }, summary: { estimates: 1 }, estimates: [{ project_title: "Kitchen Refresh", contractor_name: "Proposal Builder LLC", property: "123 Main St", total: "500.00", status: "accepted", status_label: "Accepted", review_url: "/estimate-review/review-token", agreement_url: "" }], requests: [], projects: [], agreements: [], payments: [], documents: [], notifications: [], property_profiles: [] } }));
  await page.goto("/activate-customer/setup-token");
  await page.getByLabel("Create password").fill("Customer-pass-937!");
  await page.getByLabel("Confirm password").fill("Customer-pass-937!");
  await page.getByRole("button", { name: "Create MyHomeBro Account" }).click();
  await expect(page).toHaveURL(/\/portal\/portal-token/);
  await page.getByTestId("customer-dashboard-tab-estimates").click();
  await expect(page.getByTestId("customer-portal-estimates")).toContainText("Kitchen Refresh");
});

test("customer estimate review is contained at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/projects/proposal-reviews/review-token/", (route) => route.fulfill({ json: review }));
  await page.goto("/estimate-review/review-token");
  const pricing = page.getByTestId("customer-estimate-pricing");
  await expect(pricing.getByRole("columnheader", { name: "Description" })).toBeVisible();
  await expect(pricing.getByRole("columnheader", { name: "Price" })).toBeVisible();
  await expect(pricing.getByRole("columnheader", { name: "Quantity" })).toHaveCount(0);
  await expect(pricing).not.toContainText("2.00 hours");
  await expect(pricing.getByTestId("customer-estimate-line-price")).toHaveText("$500.00");
  await expect(pricing).toContainText("Incidentals");
  await expect(pricing).toContainText("Estimate Total");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await expect(page.getByRole("button", { name: "Request Changes" })).toBeVisible();
});
