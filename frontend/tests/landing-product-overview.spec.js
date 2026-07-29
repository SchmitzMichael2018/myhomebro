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

test("existing play action opens the combined overview and restores focus on close", async ({ page }) => {
  const trigger = page.getByTestId("product-overview-trigger");
  const modal = await openOverview(page);

  await expect(modal).toHaveAttribute("role", "dialog");
  await expect(modal).toHaveAttribute("aria-modal", "true");
  await expect(modal.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await expect(modal.getByRole("heading", { name: "See how MyHomeBro keeps projects moving" })).toBeVisible();
  const workflowContent = [
    ["Capture the customer and job", "Collect the request, property details, photos, and field notes."],
    ["Prepare the estimate", "Turn the job details into clear scope, pricing, and next steps."],
    ["Review and approve the agreement", "Confirm the work, responsibilities, schedule, and payment terms."],
    ["Track work, milestones, and payments", "Keep progress, approvals, updates, and payment status connected."],
    ["Keep records, warranties, and project history", "Organize the documents and history needed after the work is done."],
  ];
  for (const [title, description] of workflowContent) {
    await expect(modal.getByText(title, { exact: true })).toBeVisible();
    await expect(modal.getByText(description, { exact: true })).toBeVisible();
  }
  for (const audience of ["For contractors", "For homeowners", "For property managers"]) {
    await expect(modal.getByRole("heading", { name: audience })).toBeVisible();
  }
  await expect(modal.getByRole("button", { name: "Create Free Account" })).toBeVisible();
  await expect(modal.getByRole("button", { name: "Log In" })).toBeVisible();
  await expect(modal.getByRole("button", { name: "Contact Support" })).toBeVisible();

  const surfaceColor = await modal.getByTestId("product-overview-surface").evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
  expect(surfaceColor).toBe("rgb(2, 6, 23)");
  const workflowBox = await modal.getByTestId("product-overview-workflow").boundingBox();
  const audienceBox = await modal.getByTestId("product-overview-audiences").boundingBox();
  expect(audienceBox.y - (workflowBox.y + workflowBox.height)).toBeLessThanOrEqual(24);

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

test("Watch provides an honest fallback and Questions derives curated and full FAQ content", async ({ page }) => {
  const modal = await openOverview(page);

  await modal.getByRole("tab", { name: "Watch" }).click();
  await expect(modal.getByTestId("product-video-fallback")).toBeVisible();
  await expect(modal.getByRole("heading", { name: "Demo video coming soon" })).toBeVisible();
  await expect(modal.locator("video")).toHaveCount(0);

  await modal.getByRole("tab", { name: "Questions" }).click();
  const questionsPanel = modal.getByTestId("product-questions-panel");
  expect(
    await questionsPanel.evaluate((element) => getComputedStyle(element).backgroundColor)
  ).toBe("rgb(2, 6, 23)");
  await expect(modal.locator('[data-testid^="product-question-"]')).toHaveCount(12);
  const curatedAccordion = modal.getByTestId("product-curated-accordion");
  expect(
    await curatedAccordion.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)
  ).toBe(2);
  const firstQuestion = modal.getByRole("button", { name: "What is MyHomeBro?" });
  const firstQuestionRow = modal.getByTestId("product-question-what-is-myhomebro");
  expect(
    await firstQuestionRow.evaluate((element) => getComputedStyle(element).backgroundColor)
  ).toBe("rgb(15, 23, 42)");
  await expect(firstQuestion).toHaveAttribute("aria-expanded", "false");
  await firstQuestion.click();
  await expect(firstQuestion).toHaveAttribute("aria-expanded", "true");
  await expect(modal.getByText(/home-project operating platform/)).toBeVisible();
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
  await viewAll.click();
  await expect(modal.getByRole("heading", { name: "For Contractors" })).toBeVisible();
  await expect(modal.getByRole("button", { name: "Does MyHomeBro replace accounting software?" })).toBeVisible();
  await expect(modal.locator('[data-testid^="product-question-"]')).toHaveCount(28);

  const jsonLd = JSON.parse(await page.getByTestId("landing-faq-jsonld").textContent());
  expect(jsonLd["@type"]).toBe("FAQPage");
  expect(jsonLd.mainEntity).toHaveLength(12);
  expect(await page.evaluate(() => window.__productAnalytics)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ event: "product_overview_tab_selected", tab: "watch" }),
      expect.objectContaining({ event: "product_overview_tab_selected", tab: "questions" }),
      expect.objectContaining({ event: "product_question_opened", question_id: "what-is-myhomebro" }),
      expect.objectContaining({ event: "product_view_all_questions_clicked" }),
    ])
  );
});

test("tabs support arrow navigation and the dialog traps focus", async ({ page }) => {
  const modal = await openOverview(page);
  const overview = modal.getByRole("tab", { name: "Overview" });
  const watch = modal.getByRole("tab", { name: "Watch" });

  await overview.focus();
  await page.keyboard.press("ArrowRight");
  await expect(watch).toBeFocused();
  await expect(watch).toHaveAttribute("aria-selected", "true");

  await modal.getByRole("button", { name: "Contact Support" }).focus();
  await page.keyboard.press("Tab");
  await expect(modal.getByRole("button", { name: "Close product overview" })).toBeFocused();
});

for (const width of [320, 375, 390, 430, 768]) {
  test(`modal is safe-area aware and has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    const modal = await openOverview(page);
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("tab", { name: "Questions" })).toBeVisible();
    await modal.getByRole("tab", { name: "Questions" }).click();
    const curatedAccordion = modal.getByTestId("product-curated-accordion");
    const columnCount = await curatedAccordion.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length
    );
    expect(columnCount).toBe(width >= 768 ? 2 : 1);
    const firstQuestion = modal.getByRole("button", { name: "What is MyHomeBro?" });
    await firstQuestion.click();
    await expect(modal.getByText(/home-project operating platform/)).toBeVisible();
    await modal.getByRole("button", { name: "Create Free Account" }).scrollIntoViewIfNeeded();
    await expect(modal.getByRole("button", { name: "Create Free Account" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const box = await modal.boundingBox();
    expect(box.height).toBeLessThanOrEqual(760);
  });
}

for (const width of [1366, 1920]) {
  test(`overview remains compact and dark at ${width}px desktop`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const modal = await openOverview(page);
    const box = await modal.boundingBox();
    expect(box.width).toBeLessThanOrEqual(1024);
    expect(box.height).toBeLessThanOrEqual(900);
    await expect(modal.getByTestId("product-workflow-step-5")).toBeVisible();
    await expect(modal.getByTestId("product-audience-for-property-managers")).toBeVisible();
  });
}

test("header duplicate conversion actions are removed while hero actions remain", async ({ page }) => {
  const header = page.getByRole("banner");
  await expect(header.getByRole("button", { name: "Start a Project" })).toHaveCount(0);
  await expect(header.getByRole("button", { name: "Create Free Account" })).toHaveCount(0);
  await expect(page.getByTestId("landing-start-project-intake-button")).toBeVisible();
  await expect(page.getByTestId("landing-create-free-account-button")).toBeVisible();
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
