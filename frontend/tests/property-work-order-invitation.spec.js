import { expect, test } from "@playwright/test";

test("vendor reviews and accepts a property work order on a polished public page", async ({ page }) => {
  const token = "qa-work-order-token";
  let status = "sent";

  await page.route(`**/api/projects/work-order-invitations/${token}/details/`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        company: { name: "MyHomeBro QA Property Management" },
        invitation: { status, status_label: status === "accepted" ? "Accepted" : "Sent" },
        work_order: {
          work_order_number: "PWO-000003",
          title: "QA - Slow kitchen sink drain",
          description: "Inspect and repair the slow kitchen sink drain.",
          property_name: "QA Sunset Apartments",
          unit_label: "Unit 101",
          priority_label: "Normal",
          scheduled_for: "2026-09-16T15:30:00Z",
        },
      }),
    });
  });

  await page.route(`**/api/projects/work-order-invitations/${token}/accept/`, async (route) => {
    status = "accepted";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        company: { name: "MyHomeBro QA Property Management" },
        invitation: { status: "accepted", status_label: "Accepted" },
        work_order: {
          work_order_number: "PWO-000003",
          title: "QA - Slow kitchen sink drain",
          description: "Inspect and repair the slow kitchen sink drain.",
          property_name: "QA Sunset Apartments",
          unit_label: "Unit 101",
          priority_label: "Normal",
          scheduled_for: "2026-09-16T15:30:00Z",
        },
      }),
    });
  });

  await page.goto(`/work-order-invitations/${token}`);
  await expect(page.getByTestId("property-work-order-invitation")).toContainText("QA - Slow kitchen sink drain");
  await expect(page.getByTestId("property-work-order-invitation")).toContainText("QA Sunset Apartments · Unit 101");
  await page.getByTestId("property-work-order-invitation-accept").click();
  await expect(page.getByTestId("property-work-order-invitation-status")).toHaveText("Accepted");
  await expect(page.getByTestId("property-work-order-invitation-complete")).toBeVisible();
});
