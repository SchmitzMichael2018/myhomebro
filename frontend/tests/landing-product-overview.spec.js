import { expect, test } from "@playwright/test";

async function openOverview(page) {
  const trigger = page.getByTestId("product-overview-trigger");
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  return page.getByTestId("product-overview-modal");
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__productAnalytics = [];
    window.addEventListener("mhb:analytics", (event) => window.__productAnalytics.push(event.detail));
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
});

test("interactive tour entry opens role selection and restores focus on close", async ({ page }) => {
  const trigger = page.getByTestId("product-overview-trigger");
  const modal = await openOverview(page);

  await expect(modal).toHaveAttribute("role", "dialog");
  await expect(modal).toHaveAttribute("aria-modal", "true");
  await expect(modal.getByRole("tab", { name: "Tour" })).toHaveAttribute("aria-selected", "true");
  await expect(modal.getByRole("heading", { name: "Choose your role and follow the workflow" })).toBeVisible();
  await expect(modal.getByTestId("product-overview-role-prompt")).toBeVisible();
  await expect(modal.getByTestId("product-overview-workflow")).toHaveCount(0);
  const contractorAudience = modal.getByTestId("product-audience-contractor");
  await expect(contractorAudience).toHaveAttribute("aria-pressed", "false");
  await contractorAudience.click();
  const workflowContent = [
    ["Capture the customer and job", "Collect the request, property details, photos, and field notes."],
    ["Prepare the estimate", "Build scope, pricing, options, and next steps."],
    ["Send the agreement", "Confirm responsibilities, schedule, milestones, and payment terms."],
    ["Manage work and payments", "Coordinate customers, team members, progress, approvals, and funding."],
    ["Close out and keep records", "Preserve documents, warranties, receipts, photos, and project history."],
  ];
  for (const [title, description] of workflowContent) {
    await expect(modal.getByText(title, { exact: true })).toBeVisible();
    await expect(modal.getByText(description, { exact: true })).toBeVisible();
  }
  await expect(contractorAudience).toHaveAttribute("aria-pressed", "true");
  await expect(contractorAudience).toContainText("Selected");
  await expect(modal.getByTestId("product-audience-homeowner")).toHaveAttribute("aria-pressed", "false");
  await expect(modal.getByTestId("product-audience-property_manager")).toHaveAttribute("aria-pressed", "false");
  await expect(modal.getByRole("button", { name: "Create Contractor Account" })).toBeVisible();
  await expect(modal.getByRole("button", { name: "Log In", exact: true })).toBeVisible();
  await expect(modal.getByTestId("product-workflow-detail-desktop")).toContainText("What you do");

  const surfaceColor = await modal.getByTestId("product-overview-surface").evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
  expect(surfaceColor).toBe("rgb(2, 6, 23)");
  const workflowBox = await modal.getByTestId("product-overview-workflow").boundingBox();
  const audienceBox = await modal.getByTestId("product-overview-audiences").boundingBox();
  expect(workflowBox.y - (audienceBox.y + audienceBox.height)).toBeLessThanOrEqual(24);

  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => window.__productAnalytics)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ event: "product_overview_opened", category: "product_overview" }),
      expect.objectContaining({ event: "product_overview_closed", category: "product_overview" }),
    ])
  );
});

test("landing guidance explains each stage by hover, focus, and activation", async ({ page }) => {
  const firstStep = page.getByTestId("how-it-works-step-1");
  const thirdStep = page.getByTestId("how-it-works-step-3");

  await firstStep.scrollIntoViewIfNeeded();
  await expect(firstStep).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("how-it-works-detail-1")).toBeVisible();

  await thirdStep.hover();
  await expect(thirdStep).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("how-it-works-detail-3")).toContainText("Availability and matching");

  const secondStep = page.getByTestId("how-it-works-step-2");
  await secondStep.focus();
  await expect(secondStep).toHaveAttribute("aria-expanded", "true");

  await page.setViewportSize({ width: 390, height: 844 });
  const fifthStep = page.getByTestId("how-it-works-step-5");
  await fifthStep.click();
  await expect(fifthStep).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("how-it-works-detail-5")).toContainText("Follow milestones");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("landing FAQ answers essentials and opens the complete Questions view", async ({ page }) => {
  const faqPreview = page.getByTestId("landing-faq-preview");
  await faqPreview.scrollIntoViewIfNeeded();
  await expect(faqPreview.getByRole("button")).toHaveCount(6);

  const paymentQuestion = faqPreview.getByRole("button", {
    name: "What is the difference between escrow, direct pay, and a draw?",
  });
  await paymentQuestion.click();
  await expect(paymentQuestion).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#landing-faq-answer-payment-method-differences")).toBeVisible();

  const viewAll = page.getByTestId("landing-view-all-faqs");
  await viewAll.click();
  await expect(page).toHaveURL(/\/faq$/);
  await expect(page.getByRole("heading", { name: "Frequently Asked Questions" })).toBeVisible();
});

test("audience selectors personalize all five steps and persist across tabs", async ({ page }) => {
  const modal = await openOverview(page);
  const homeowner = modal.getByTestId("product-audience-homeowner");
  await homeowner.click();
  await expect(homeowner).toHaveAttribute("aria-pressed", "true");
  await expect(modal.getByTestId("product-overview-workflow")).toHaveAttribute("data-audience", "homeowner");
  for (const title of [
    "Start or join a project",
    "Review estimates",
    "Approve the agreement",
    "Follow progress and payments",
    "Keep your property records",
  ]) {
    await expect(modal.getByText(title, { exact: true })).toBeVisible();
  }
  await modal.getByTestId("product-workflow-step-4").click();
  await expect(modal.getByTestId("product-workflow-detail-desktop")).toContainText(
    "Follow milestone updates"
  );

  await modal.getByRole("tab", { name: "Videos" }).click();
  await expect(modal.getByTestId("product-video-homeowner")).toBeVisible();
  await modal.getByRole("tab", { name: "Quick Answers" }).click();
  await expect(modal.getByRole("button", { name: "What happens after I submit a project request?" })).toBeVisible();
  await modal.getByRole("tab", { name: "Tour" }).click();
  await expect(homeowner).toHaveAttribute("aria-pressed", "true");
  await expect(modal.getByText("Keep your property records", { exact: true })).toBeVisible();

  const propertyManager = modal.getByTestId("product-audience-property_manager");
  await propertyManager.click();
  await expect(propertyManager).toHaveAttribute("aria-pressed", "true");
  for (const title of [
    "Add the property or unit",
    "Capture a maintenance need",
    "Coordinate vendor work",
    "Track completion and payment",
    "Maintain property history",
  ]) {
    await expect(modal.getByText(title, { exact: true })).toBeVisible();
  }
  await expect(modal.locator('[data-testid^="product-workflow-step-"]')).toHaveCount(5);
  expect(await page.evaluate(() => window.__productAnalytics)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        event: "product_audience_selected",
        audience: "homeowner",
        source: "product_overview",
      }),
      expect.objectContaining({
        event: "product_audience_selected",
        audience: "property_manager",
        source: "product_overview",
      }),
    ])
  );

  await modal.getByRole("button", { name: "Close product overview" }).click();
  const reopened = await openOverview(page);
  await expect(reopened.getByTestId("product-audience-contractor")).toHaveAttribute("aria-pressed", "false");
  await expect(reopened.getByTestId("product-overview-role-prompt")).toBeVisible();
});

test("audience transition respects reduced-motion preference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const modal = await openOverview(page);
  const workflow = modal.getByTestId("product-overview-workflow");
  await modal.getByTestId("product-audience-contractor").click();
  expect(await workflow.evaluate((element) => getComputedStyle(element).transitionProperty)).toBe("none");
  await modal.getByTestId("product-audience-homeowner").click();
  await expect(workflow).toHaveAttribute("data-audience", "homeowner");
});

test("Videos provide honest role-aware placeholders and Quick Answers links to the full FAQ", async ({ page }) => {
  const modal = await openOverview(page);

  await modal.getByRole("tab", { name: "Videos" }).click();
  await expect(modal.getByTestId("product-video-library")).toBeVisible();
  await expect(modal.locator('[data-testid^="product-video-"]')).toHaveCount(4);
  await expect(modal.getByText("Video in preparation")).toHaveCount(3);
  await expect(modal.locator("video")).toHaveCount(0);

  await modal.getByRole("tab", { name: "Tour" }).click();
  await modal.getByTestId("product-audience-contractor").click();
  await modal.getByRole("tab", { name: "Quick Answers" }).click();
  const questionsPanel = modal.getByTestId("product-questions-panel");
  expect(
    await questionsPanel.evaluate((element) => getComputedStyle(element).backgroundColor)
  ).toBe("rgb(2, 6, 23)");
  await expect(modal.locator('[data-testid^="product-question-"]')).toHaveCount(5);
  const curatedAccordion = modal.getByTestId("product-curated-accordion");
  expect(
    await curatedAccordion.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)
  ).toBe(2);
  const firstQuestion = modal.getByRole("button", { name: "What can contractors manage in MyHomeBro?" });
  const firstQuestionRow = modal.getByTestId("product-question-contractor-tools");
  expect(
    await firstQuestionRow.evaluate((element) => getComputedStyle(element).backgroundColor)
  ).toBe("rgb(15, 23, 42)");
  await expect(firstQuestion).toHaveAttribute("aria-expanded", "false");
  await firstQuestion.click();
  await expect(firstQuestion).toHaveAttribute("aria-expanded", "true");
  await expect(modal.getByText(/customer intake, estimates, agreements/)).toBeVisible();
  const answerPanel = page.locator(`#${await firstQuestion.getAttribute("aria-controls")}`);
  await expect(answerPanel).toBeVisible();
  expect(
    await answerPanel.evaluate((element) => getComputedStyle(element).backgroundColor)
  ).not.toBe("rgb(255, 255, 255)");

  const viewAll = modal.getByTestId("product-view-all-questions");
  await expect(viewAll).toBeVisible();
  expect(await viewAll.evaluate((element) => getComputedStyle(element).color)).not.toBe(
    "rgba(0, 0, 0, 0)"
  );
  const jsonLd = JSON.parse(await page.getByTestId("landing-faq-jsonld").textContent());
  expect(jsonLd["@type"]).toBe("FAQPage");
  expect(jsonLd.mainEntity).toHaveLength(12);
  await viewAll.click();
  await expect(page).toHaveURL(/\/faq$/);
  await expect(page.getByRole("heading", { name: "Frequently Asked Questions" })).toBeVisible();
  expect(await page.evaluate(() => window.__productAnalytics)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ event: "product_overview_tab_selected", tab: "watch" }),
      expect.objectContaining({ event: "product_overview_tab_selected", tab: "questions" }),
      expect.objectContaining({ event: "product_question_opened", question_id: "contractor-tools" }),
      expect.objectContaining({ event: "product_view_all_questions_clicked" }),
    ])
  );
});

test("tabs support arrow navigation and the dialog traps focus", async ({ page }) => {
  const modal = await openOverview(page);
  const overview = modal.getByRole("tab", { name: "Tour" });
  const watch = modal.getByRole("tab", { name: "Videos" });

  await overview.focus();
  await page.keyboard.press("ArrowRight");
  await expect(watch).toBeFocused();
  await expect(watch).toHaveAttribute("aria-selected", "true");

  await modal.getByRole("button", { name: "Log In" }).focus();
  await page.keyboard.press("Tab");
  await expect(modal.getByRole("button", { name: "Close product overview" })).toBeFocused();
});

for (const width of [320, 375, 390, 430, 768]) {
  test(`modal is safe-area aware and has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    const modal = await openOverview(page);
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("tab", { name: "Quick Answers" })).toBeVisible();
    await modal.getByTestId("product-audience-homeowner").click();
    await modal.getByRole("tab", { name: "Quick Answers" }).click();
    const curatedAccordion = modal.getByTestId("product-curated-accordion");
    const columnCount = await curatedAccordion.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length
    );
    expect(columnCount).toBe(width >= 768 ? 2 : 1);
    const firstQuestion = modal.getByRole("button", { name: "What happens after I submit a project request?" });
    await firstQuestion.click();
    await expect(modal.getByText(/organized project record/)).toBeVisible();
    await expect(modal.getByRole("button", { name: "Start a Project" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const box = await modal.boundingBox();
    expect(box.height).toBeLessThanOrEqual(760);
    const footerHeight = await modal.locator("footer").evaluate((element) => element.getBoundingClientRect().height);
    expect(footerHeight).toBeLessThanOrEqual(width < 640 ? 90 : 100);
    await modal.getByRole("tab", { name: "Tour" }).click();
    const audienceColumns = await modal.getByTestId("product-overview-audiences").evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length
    );
    const workflowColumns = await modal.getByTestId("product-overview-workflow").evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length
    );
    expect(audienceColumns).toBe(width >= 640 ? 3 : 1);
    expect(workflowColumns).toBe(width >= 1024 ? 5 : width >= 640 ? 2 : 1);
  });
}

for (const width of [1366, 1920]) {
  test(`overview remains compact and dark at ${width}px desktop`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const modal = await openOverview(page);
    await modal.getByTestId("product-audience-contractor").click();
    const box = await modal.boundingBox();
    expect(box.width).toBeLessThanOrEqual(1024);
    expect(box.height).toBeLessThanOrEqual(900);
    await expect(modal.getByTestId("product-workflow-step-5")).toBeVisible();
    await expect(modal.getByTestId("product-audience-property_manager")).toBeVisible();
  });
}

test("header duplicate conversion actions are removed while hero actions remain", async ({ page }) => {
  const header = page.getByRole("banner");
  await expect(header.getByRole("button", { name: "Start a Project" })).toHaveCount(0);
  await expect(header.getByRole("button", { name: "Create Free Account" })).toHaveCount(0);
  await expect(page.getByTestId("landing-start-project-intake-button")).toBeVisible();
  await expect(page.getByTestId("landing-create-free-account-button")).toBeVisible();
});

for (const [audience, label, path] of [
  ["homeowner", "Start a Project", "/start-project"],
  ["contractor", "Create Contractor Account", "/signup"],
  ["property_manager", "Submit Maintenance Request", "/maintenance-request"],
]) {
  test(`product overview ${label} action is personalized and keeps its verified destination`, async ({ page }) => {
    const modal = await openOverview(page);
    await modal.getByTestId(`product-audience-${audience}`).click();
    await modal.getByRole("button", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
  });
}

test("product overview keeps login available before role selection", async ({ page }) => {
  const modal = await openOverview(page);
  await modal.getByRole("button", { name: "Log In" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("combined overview renders when launched in installed-app mode", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      query === "(display-mode: standalone)"
        ? {
            matches: true,
            media: query,
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent: () => true,
          }
        : original(query);
    Object.defineProperty(window.navigator, "standalone", { configurable: true, value: true });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(await openOverview(page)).toBeVisible();
});
