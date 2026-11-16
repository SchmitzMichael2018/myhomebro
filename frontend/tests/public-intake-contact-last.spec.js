import { expect, test } from "@playwright/test";

async function mockPlanner(page, { failStart = false } = {}) {
  const starts = [];
  const saves = [];
  let failSave = false;
  let draft = {
    id: 9101, token: "contact-last-token", status: "draft",
    customer_name: "", customer_email: "", customer_phone: "",
    accomplishment_text: "", ai_milestones: [], ai_clarification_questions: [],
    ai_clarification_answers: {}, clarification_photos: [], ai_analysis_payload: {},
  };
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes("/public-intake/start/") && method === "POST") {
      starts.push(route.request().postDataJSON());
      return route.fulfill({ status: failStart && starts.length === 1 ? 503 : 201,
        json: failStart && starts.length === 1 ? { detail: "Please try again." } :
          { share_token: draft.token, status: "draft" } });
    }
    if (url.includes("/public-intake/") && method === "PATCH") {
      const payload = route.request().postDataJSON();
      saves.push(payload);
      if (failSave) { failSave = false; return route.fulfill({ status: 503, json: { detail: "Could not save your request. Try again." } }); }
      draft = { ...draft, ...payload, ai_project_title: "San Antonio Flooring Project",
        ai_project_type: "Flooring", ai_description: payload.accomplishment_text };
      return route.fulfill({ json: draft });
    }
    if (/\/public-intake\/\?/.test(url) && method === "GET") return route.fulfill({ json: draft });
    return route.fulfill({ json: { results: [], rows: [], contractors: [] } });
  });
  return { starts, saves, failNextSave() { failSave = true; } };
}

for (const width of [1280, 390]) {
  test(`project planning comes before contact details at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const mock = await mockPlanner(page);
    await page.goto("/start-project?source=san_antonio_launch");
    await expect(page).toHaveURL(/\/start-project\/contact-last-token$/);
    await expect(page.getByTestId("public-intake-accomplishment-text")).toBeVisible();
    await expect(page.getByTestId("start-project-contact-form")).toHaveCount(0);
    await expect(page.getByTestId("public-intake-contact-step")).toHaveCount(0);
    expect(mock.starts).toHaveLength(1);
    expect(mock.starts[0]).toMatchObject({ source: "san_antonio_launch", customer_email: "", customer_name: "", customer_phone: "" });

    const idea = "Replace the living room flooring in my San Antonio home.";
    await page.getByTestId("public-intake-accomplishment-text").fill(idea);
    await page.getByTestId("public-intake-generate-structure").click();
    await expect(page.getByTestId("public-intake-clarification-step")).toBeVisible();
    await page.getByTestId("public-intake-clarification-next").click();
    await page.getByTestId("public-intake-project-snapshot-continue").click();
    await expect(page.getByTestId("public-intake-structured-output-step")).toBeVisible();
    await expect(page.getByTestId("public-intake-contact-step")).toHaveCount(0);
    await page.getByTestId("public-intake-structured-continue").click();
    await page.getByTestId("public-intake-customer-address-line1").fill("123 Example Street");
    await page.getByTestId("public-intake-customer-city").fill("San Antonio");
    await page.getByTestId("public-intake-customer-state").fill("TX");
    await page.getByTestId("public-intake-customer-postal-code").fill("78245");
    await page.getByTestId("public-intake-project-details-continue").click();
    const contact = page.getByTestId("public-intake-contact-step");
    await expect(contact).toBeVisible();
    await expect(contact).toContainText("Adding your details does not send invitations");
    await page.getByTestId("public-intake-contact-continue").click();
    await expect(contact).toBeVisible();
    await contact.getByLabel("Full name", { exact: true }).fill("Example Homeowner");
    await contact.getByLabel("Email", { exact: true }).fill("invalid");
    await page.getByTestId("public-intake-contact-continue").click();
    await expect(contact).toBeVisible();
    await contact.getByLabel("Email", { exact: true }).fill("homeowner@example.com");
    mock.failNextSave();
    await page.getByTestId("public-intake-contact-continue").click();
    await expect(page.getByText("Could not save your request. Try again.")).toBeVisible();
    await expect(contact.getByLabel("Email", { exact: true })).toHaveValue("homeowner@example.com");
    await page.getByTestId("public-intake-contact-continue").click();
    await expect(page.getByTestId("public-intake-contractor-discovery-step")).toBeVisible();
    expect(mock.saves.at(-1)).toMatchObject({ accomplishment_text: idea,
      customer_email: "homeowner@example.com", customer_name: "Example Homeowner",
      customer_phone: "", project_city: "San Antonio", project_postal_code: "78245" });
    expect(mock.saves.every((save) => !save.final_submit && !save.branch_flow)).toBeTruthy();
    await page.getByRole("button", { name: /Project Idea/ }).click();
    await expect(page.getByTestId("public-intake-accomplishment-text")).toHaveValue(idea);
    await page.getByRole("button", { name: /Contact Info/ }).click();
    await expect(contact.getByLabel("Email", { exact: true })).toHaveValue("homeowner@example.com");
  });
}

test("opening failure offers retry and retains source and contractor context", async ({ page }) => {
  const mock = await mockPlanner(page, { failStart: true });
  await page.goto("/start-project?source=san_antonio_launch&contractor_slug=example-builder&template_id=17");
  await expect(page.getByRole("alert")).toHaveText("Please try again.");
  await page.getByTestId("start-project-retry").click();
  await expect(page).toHaveURL(/\/start-project\/contact-last-token$/);
  expect(mock.starts).toHaveLength(2);
  expect(mock.starts[1]).toMatchObject({ source: "san_antonio_launch", contractor_slug: "example-builder", template_id: "17" });
});
