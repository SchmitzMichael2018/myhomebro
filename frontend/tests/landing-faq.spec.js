import { expect, test } from "@playwright/test";

test("public FAQ is grouped, accessible, synchronized, and uses one open disclosure", async ({ page }) => {
  await page.addInitScript(() => {
    window.__faqAnalytics = [];
    window.addEventListener("mhb:analytics", (event) => window.__faqAnalytics.push(event.detail));
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const faq = page.getByTestId("landing-faq-section");
  await expect(faq).toBeVisible();
  await expect(faq.getByRole("heading", { name: "Understand MyHomeBro before you begin" })).toBeVisible();
  await expect(faq.getByRole("heading", { name: "For Contractors" })).toBeVisible();
  await expect(faq.getByRole("heading", { name: "For Homeowners" })).toBeVisible();
  await expect(faq.getByRole("heading", { name: "Smart Capture and Project Assistant" })).toBeVisible();

  const first = faq.getByRole("button", { name: "What is MyHomeBro?" });
  const second = faq.getByRole("button", { name: "Who is MyHomeBro for?" });
  await expect(first).toHaveAttribute("aria-expanded", "false");
  const panelId = await first.getAttribute("aria-controls");
  expect(panelId).toBeTruthy();
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(`#${panelId}`)).toBeVisible();
  await second.click();
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(second).toHaveAttribute("aria-expanded", "true");

  const jsonLd = JSON.parse(await page.getByTestId("landing-faq-jsonld").textContent());
  expect(jsonLd["@type"]).toBe("FAQPage");
  expect(jsonLd.mainEntity.map((entry) => entry.name)).toContain("What is Smart Capture?");
  expect(jsonLd.mainEntity).toHaveLength(await faq.locator("article").count());
  expect(await page.evaluate(() => window.__faqAnalytics)).toContainEqual(
    expect.objectContaining({ event: "faq_question_opened", category: "public_faq" })
  );
  await expect(faq).not.toContainText("AI Copilot");
});

for (const width of [320, 375, 390, 430]) {
  test(`public FAQ remains readable without overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const faq = page.getByTestId("landing-faq-section");
    await faq.scrollIntoViewIfNeeded();

    const control = faq.getByRole("button", { name: "How are payments handled?" });
    await expect(control).toBeVisible();
    expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await control.click();
    await expect(faq.getByText(/Payment steps are tied to/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("public FAQ renders in standalone mode and routes toward the authenticated Support workflow", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) => (
      query === "(display-mode: standalone)"
        ? { matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true }
        : original(query)
    );
    Object.defineProperty(window.navigator, "standalone", { configurable: true, value: true });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const support = page.getByTestId("landing-faq-support");
  await expect(support).toBeVisible();
  await support.click();
  await expect(page).toHaveURL(/\/login$/);
});
