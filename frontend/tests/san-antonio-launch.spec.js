import { expect, test } from '@playwright/test';

for (const { name, width, height } of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`San Antonio public launch is accessible at ${name} width`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
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
    await expect(page.getByTestId('start-project-contact-form')).toBeVisible();
    const handoff = new URL(page.url());
    expect(handoff.pathname).toBe('/start-project');
    expect(handoff.searchParams.get('utm_source')).toBe('synthetic');
    expect(handoff.searchParams.get('ref')).toBe('TEST-1');
    expect(handoff.searchParams.get('source')).toBe('san_antonio_launch');
    expect(handoff.searchParams.has('unsafe')).toBe(false);
  });
}

test('national homepage and direct intake refresh retain their existing routes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('landing-start-project-intake-button')).toBeVisible();
  await page.goto('/start-project');
  await expect(page.getByTestId('start-project-contact-form')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('start-project-contact-form')).toBeVisible();
});
