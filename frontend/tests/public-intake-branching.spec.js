import { expect, test } from "@playwright/test";

test("landing page drives into intake and public intake shows branching choices after submit", async ({
  page,
}) => {
  const branchRequests = [];

  await page.route("**/api/projects/public-intake/**", async (route) => {
    const requestUrl = route.request().url();
    const method = route.request().method();

    if (requestUrl.endsWith("/start/") && method === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          intake_id: 501,
          token: "landing-token",
          status: "draft",
          public_url: "http://localhost:5173/start-project/landing-token",
        }),
      });
      return;
    }

    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 501,
          token: "landing-token",
          status: "draft",
          contractor_name: "Your contractor",
          customer_name: "",
          customer_email: "",
          customer_phone: "",
          customer_address_line1: "",
          customer_address_line2: "",
          customer_city: "",
          customer_state: "",
          customer_postal_code: "",
          same_as_customer_address: true,
          project_class: "residential",
          project_address_line1: "",
          project_address_line2: "",
          project_city: "",
          project_state: "",
          project_postal_code: "",
          accomplishment_text: "",
          post_submit_flow: "",
          post_submit_flow_selected_at: null,
          submitted_at: null,
          sent_at: null,
          completed_at: null,
        }),
      });
      return;
    }

    const body = route.request().postDataJSON();
    branchRequests.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "Intake updated successfully.",
        id: 501,
        status: "submitted",
        lead_id: 88,
        post_submit_flow: body.branch_flow || "",
        branch_invites:
          body.branch_flow === "multi_contractor"
            ? [
                { token: "invite-1", invite_url: "/login?invite=invite-1" },
                { token: "invite-2", invite_url: "/login?invite=invite-2" },
              ]
            : [{ token: "invite-1", invite_url: "/login?invite=invite-1" }],
        completed_at: "2026-04-15T16:00:00Z",
      }),
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("landing-hero-heading")).toContainText("Start your project with MyHomeBro");
  await expect(page.getByTestId("landing-start-project-intake-button")).toHaveText("Start a Project");
  await expect(page.getByText("After you submit your request, you can either invite one contractor or request multiple bids.")).toBeVisible();

  await page.getByTestId("landing-start-project-intake-button").click();
  await expect(page).toHaveURL(/\/start-project\/landing-token$/);
  await expect(page.getByText("Project Intake", { exact: true })).toBeVisible();

  await page.getByPlaceholder("Your full name").fill("Branch Prospect");
  await page.getByPlaceholder("you@example.com").fill("branch@example.com");
  await page.getByTestId("public-intake-customer-address-line1").fill("500 Bid Lane");
  await page.getByTestId("public-intake-customer-city").fill("Austin");
  await page.getByTestId("public-intake-customer-state").fill("TX");
  await page.getByTestId("public-intake-customer-postal-code").fill("78701");
  await page.getByLabel("Commercial").check();
  await page.getByTestId("public-intake-accomplishment-text").fill("Need a bid-ready commercial scope.");
  await page.getByTestId("public-intake-submit-button").click();

  await expect(page.getByTestId("public-intake-branching-section")).toBeVisible();
  await expect(page.getByTestId("public-intake-branching-section")).toContainText("How would you like to proceed?");
  await expect(page.getByTestId("public-intake-branch-single")).toHaveText("Work with one contractor");
  await expect(page.getByTestId("public-intake-branch-multi")).toHaveText("Get multiple quotes");

  await page.getByTestId("public-intake-branch-multi").click();
  const multiBranch = page.getByTestId("public-intake-branching-section");
  await multiBranch.getByPlaceholder("Name").first().fill("Alpha Build");
  await multiBranch.getByPlaceholder("Email").first().fill("alpha@example.com");
  await multiBranch.getByPlaceholder("Phone").first().fill("555-101-0001");
  await multiBranch.getByPlaceholder("Name").nth(1).fill("Beta Contracting");
  await multiBranch.getByPlaceholder("Email").nth(1).fill("beta@example.com");
  await multiBranch.getByPlaceholder("Phone").nth(1).fill("555-202-0002");
  await page.getByTestId("public-intake-branch-submit").click();

  await expect(page.getByTestId("public-intake-branching-section")).toContainText("2 invites");
  await expect(page.getByText("Get Multiple Quotes").first()).toBeVisible();
  expect(branchRequests.some((body) => body.branch_flow === "multi_contractor")).toBeTruthy();

  await page.getByTestId("public-intake-branch-single").click();
  const singleBranch = page.getByTestId("public-intake-branching-section");
  await singleBranch.getByPlaceholder("Contractor name").fill("Prime Builder");
  await singleBranch.getByPlaceholder("contractor@example.com").fill("prime@example.com");
  await singleBranch.getByPlaceholder("(555) 555-5555").fill("555-303-0003");
  await page.getByTestId("public-intake-branch-submit").click();

  await expect(page.getByTestId("public-intake-branching-section")).toContainText("1 invite");
  expect(branchRequests.some((body) => body.branch_flow === "single_contractor")).toBeTruthy();
});
