import { expect, test } from '@playwright/test';

async function installCustomerFormAuth(page, appearance) {
  await page.addInitScript((theme) => {
    window.localStorage.setItem('access', 'playwright-access-token');
    window.localStorage.setItem('myhomebro.appearance.v1', theme);
  }, appearance);
  await page.route('**/api/projects/whoami/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 7, type: 'contractor', role: 'contractor_owner' }) }));
  await page.route('**/api/payments/onboarding/status/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ onboarding_status: 'complete', connected: true }) }));
  await page.route('**/api/projects/contractors/me/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 77 }) }));
}

function channel(value) {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(foreground, background) {
  const parse = (color) => (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const luminance = (color) => {
    const [r, g, b] = parse(color).map(channel);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

for (const appearance of ['dark', 'light']) {
  for (const width of [1440, 900, 390]) {
    test(`customer light controls remain readable in ${appearance} appearance at ${width}px`, async ({ page }) => {
      await installCustomerFormAuth(page, appearance);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto('/app/customers/new', { waitUntil: 'domcontentloaded' });

      await page.locator('input[name="full_name"]').fill('QA Homeowner');
      await page.locator('input[name="email"]').fill('qa@example.com');
      await page.locator('input[name="phone_number"]').fill('5555551212');
      await page.locator('#mhb-customerform-290').fill('101 Main St');
      await page.locator('select[name="status"]').selectOption('prospect');
      await page.locator('input[name="full_name"]').blur();

      for (const selector of ['input[name="full_name"]', 'input[name="email"]', 'input[name="phone_number"]', '#mhb-customerform-290', 'select[name="status"]']) {
        const styles = await page.locator(selector).evaluate((node) => {
          const computed = getComputedStyle(node);
          return { color: computed.color, background: computed.backgroundColor };
        });
        expect(contrastRatio(styles.color, styles.background)).toBeGreaterThanOrEqual(4.5);
      }

      const placeholderStyles = await page.locator('input[name="company_name"]').evaluate((node) => ({
        foreground: getComputedStyle(node, '::placeholder').color,
        background: getComputedStyle(node).backgroundColor,
        entered: getComputedStyle(node).color,
      }));
      expect(contrastRatio(placeholderStyles.foreground, placeholderStyles.background)).toBeGreaterThanOrEqual(4.5);
      expect(placeholderStyles.foreground).not.toBe(placeholderStyles.entered);

      await page.locator('input[name="full_name"]').focus();
      const focusStyle = await page.locator('input[name="full_name"]').evaluate((node) => getComputedStyle(node).outlineStyle);
      expect(focusStyle).not.toBe('none');
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

      if (appearance === 'dark' && width === 1440) {
        await page.screenshot({ path: 'test-results/customer-form-entered-values.png', fullPage: true });
      }
      if (appearance === 'dark' && width === 390) {
        await page.screenshot({ path: 'test-results/customer-form-390.png', fullPage: true });
      }
    });
  }
}

test('customer light panel includes a Chromium autofill foreground safeguard', async ({ page }) => {
  await installCustomerFormAuth(page, 'dark');
  await page.goto('/app/customers/new', { waitUntil: 'domcontentloaded' });
  const hasAutofillRule = await page.evaluate(() => [...document.styleSheets].some((sheet) => {
    try {
      return [...sheet.cssRules].some((rule) => rule.cssText.includes('.mhb-light-form-panel') && rule.cssText.includes('-webkit-autofill'));
    } catch {
      return false;
    }
  }));
  expect(hasAutofillRule).toBe(true);
});
