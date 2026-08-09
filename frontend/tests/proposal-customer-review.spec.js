import { expect, test } from "@playwright/test";

const review = {
  version: 1,
  status: "viewed",
  sent_at: "2026-08-09T12:00:00Z",
  expires_at: "2026-09-08T12:00:00Z",
  is_expired: false,
  acknowledgement: "I approve this estimate as the basis for preparing the project agreement. This does not sign or execute the agreement.",
  estimate: {
    contractor: { name: "Proposal Builder LLC" },
    customer: { name: "Casey Homeowner" },
    project: { title: "Kitchen Refresh", property: "123 Main St", description: "Refresh cabinets.", included_work: "Install cabinets", excluded_work: "Appliances", assumptions: "Clear access", allowances: "Fixtures" },
    pricing: { line_items: [{ category: "labor", category_label: "Labor", description: "Installation", quantity: "1.00", unit: "ls", unit_price: "500.00", total: "500.00" }], subtotal: "500.00", tax: "0.00", discounts: "0.00", incidentals_reserve: "0.00", total: "500.00" },
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
  await page.getByRole("button", { name: "Accept Estimate" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm acceptance" }).click();
  await expect(page.getByText("Estimate accepted", { exact: true })).toBeVisible();
  await expect(page.getByText(/not an Agreement signature/i)).toBeVisible();
});

test("customer estimate review is contained at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/projects/proposal-reviews/review-token/", (route) => route.fulfill({ json: review }));
  await page.goto("/estimate-review/review-token");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await expect(page.getByRole("button", { name: "Request Changes" })).toBeVisible();
});
