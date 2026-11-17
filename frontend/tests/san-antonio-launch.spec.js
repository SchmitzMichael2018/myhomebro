import { expect, test } from '@playwright/test';

async function mockAnonymousIntake(page) {
  const starts = [];
  await page.route('**/api/projects/public-intake/**', route => {
    if (route.request().method() === 'POST') {
      starts.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, json: { token: 'san-antonio-smoke-token' } });
    }
    return route.fulfill({ json: { id: 1, status: 'draft', ai_milestones: [], ai_clarification_questions: [], ai_clarification_answers: {}, clarification_photos: [] } });
  });
  return starts;
}


for (const { name, width, height } of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`San Antonio public launch is accessible at ${name} width`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    const starts = await mockAnonymousIntake(page);
    await page.route('**/api/projects/attribution/track/', (route) => route.fulfill({ status: 200, json: {} }));
    await page.goto('/san-antonio/?utm_source=synthetic&ref=TEST-1&unsafe=discard');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('San Antonio');
    await expect(page.getByRole('heading', { name: 'Keep control of milestone payments' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Build a maintenance history for your home' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Plan it yourself; ask for help when you need it' })).toBeVisible();
    await expect(page.getByTestId('san-antonio-diy')).toHaveAttribute('href', /\/create-account\?role=customer/);
    await expect(page.getByText('Automatic matching is available only where trade-specific readiness is met and approved.')).toBeVisible();
    await expect(page.getByTestId('san-antonio-start-project')).toHaveAttribute('href', /\/start-project\?/);
    await expect(page.getByTestId('san-antonio-find-contractor')).toHaveAttribute('href', /\/start-project\?/);
    await expect(page.getByTestId('san-antonio-homeowner')).toHaveAttribute('href', /\/create-account\?role=customer/);
    await expect(page.getByTestId('san-antonio-contractor')).toHaveAttribute('href', /\/signup\?/);
    await expect(page.getByTestId('san-antonio-property-manager')).toHaveAttribute('href', /\/create-account\?role=property_manager/);
    const link = await page.getByTestId('san-antonio-find-contractor').getAttribute('href');
    expect(link).toContain('utm_source=synthetic');
    expect(link).toContain('ref=TEST-1');
    expect(link).not.toContain('unsafe');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://www.myhomebro.com/san-antonio/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expect(page.getByTestId('san-antonio-find-contractor')).toHaveCSS('color', 'rgb(255, 255, 255)');
    await page.screenshot({ path: testInfo.outputPath(`san-antonio-${name}.png`), fullPage: true });
    await page.getByTestId('san-antonio-find-contractor').click();
    await expect(page.getByTestId('public-intake-accomplishment-text')).toBeVisible();
    expect(starts[0].source).toBe('san_antonio_launch');
    expect(starts[0].customer_email).toBe('');

  });
}

test('national homepage and direct intake refresh retain their existing routes', async ({ page }) => {
  await mockAnonymousIntake(page);
  await page.goto('/');
  await expect(page.getByTestId('landing-start-project-intake-button')).toBeVisible();
  await page.goto('/start-project');
  await expect(page.getByTestId('public-intake-accomplishment-text')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('public-intake-accomplishment-text')).toBeVisible();
});

