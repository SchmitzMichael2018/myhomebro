import { expect, test } from "@playwright/test";

test("project intake payment preferences explain each option without changing selection behavior", async ({
  page,
}) => {
  await page.route("**/api/projects/public-intake/**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Saved." }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 701,
        token: "payment-tooltip-token",
        status: "draft",
        contractor_name: "Your contractor",
        customer_name: "Taylor Customer",
        customer_email: "taylor@example.com",
        customer_phone: "555-0100",
        customer_address_line1: "1515 South Ellison Drive",
        customer_address_line2: "",
        customer_city: "San Antonio",
        customer_state: "TX",
        customer_postal_code: "78245-1519",
        same_as_customer_address: true,
        project_class: "residential",
        project_address_line1: "1515 South Ellison Drive",
        project_address_line2: "",
        project_city: "San Antonio",
        project_state: "TX",
        project_postal_code: "78245-1519",
        accomplishment_text: "Replace damaged trim and repaint exterior windows.",
        refined_description: "",
        ai_project_title: "Exterior Window Trim Repair",
        ai_project_type: "Carpentry",
        ai_project_subtype: "Exterior Trim Repair",
        ai_description: "Repair damaged exterior window trim and repaint affected areas.",
        ai_project_timeline_days: 3,
        ai_project_budget: null,
        budget_range_text: "",
        desired_timing_text: "",
        tentative_start_date: "",
        payment_preference: "escrow",
        ai_milestones: [{ title: "Repair and Paint", description: "Repair trim and repaint." }],
        measurement_handling: "",
        ai_clarification_questions: [{ key: "access", question: "Is exterior access clear?" }],
        ai_clarification_answers: { access: "Yes" },
        clarification_photos: [],
        ai_analysis_payload: {},
        post_submit_flow: "",
        post_submit_flow_selected_at: null,
        submitted_at: null,
        sent_at: null,
        completed_at: null,
      }),
    });
  });

  await page.goto("/start-project/payment-tooltip-token", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("public-intake-project-details-step")).toBeVisible();

  await expect(page.getByText("Payment Preferences")).toBeVisible();
  await expect(
    page.getByText(
      "Milestone-based escrow holds keep project funding organized and tied to completed work approvals."
    )
  ).toBeVisible();
  await expect(page.getByText(/help protect both homeowners and contractors/i)).toHaveCount(0);

  await page.getByRole("button", { name: "Escrow milestone payments help" }).click();
  await expect(
    page.getByText(
      "Funds are held until approved milestones are completed. Both parties can track approvals, payments, and project records through MyHomeBro."
    )
  ).toBeVisible();

  await page.getByRole("button", { name: "Direct payment to contractor help" }).click();
  await expect(
    page.getByText(
      "Payments are handled directly between the homeowner and contractor. MyHomeBro can still help manage agreements, milestones, and project records."
    )
  ).toBeVisible();

  await page.getByRole("button", { name: "Discuss payment options with contractor help" }).click();
  await expect(
    page.getByText(
      "Choose this option if you want to compare payment approaches before finalizing your agreement. Payment terms can be decided later."
    )
  ).toBeVisible();

  await expect(page.getByTestId("public-intake-payment-preference-escrow")).toBeChecked();
  await page.getByText("Direct payment to contractor").click();
  await expect(page.getByTestId("public-intake-payment-preference-direct")).toBeChecked();
  await page.getByText("Discuss payment options with contractor").click();
  await expect(page.getByTestId("public-intake-payment-preference-discuss")).toBeChecked();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Escrow milestone payments help" }).click();
  await expect(
    page.getByText(
      "Funds are held until approved milestones are completed. Both parties can track approvals, payments, and project records through MyHomeBro."
    )
  ).toBeVisible();
});
