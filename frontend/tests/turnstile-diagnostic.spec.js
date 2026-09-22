import { expect, test } from '@playwright/test';

test('temporary diagnostic isolates Cloudflare loading from registration and business APIs', async ({ page }) => {
  const apiRequests = [];
  let requestedScript = '';
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', (route) => {
    requestedScript = route.request().url();
    return route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.turnstile = {
        render(container, options) {
          window.__diagnosticSitekey = options.sitekey;
          window.__diagnosticCallback = options.callback;
          container.textContent = 'Mock Turnstile widget';
          return 'diagnostic-widget';
        },
        remove() {}
      };`,
    });
  });

  await page.goto('/turnstile-diagnostic/');
  await expect(page.getByRole('heading', { name: 'MyHomeBro Turnstile Diagnostic' })).toBeVisible();
  await expect(page.getByTestId('diagnostic-script-status')).toHaveText('SCRIPT LOADED');
  await expect(page.getByTestId('diagnostic-runtime-status')).toHaveText('WINDOW.TURNSTILE AVAILABLE');
  await expect(page.getByTestId('diagnostic-widget-status')).toHaveText('WIDGET RENDERED');
  await expect(page.getByTestId('diagnostic-challenge-status')).toHaveText('CHALLENGE NOT VERIFIED');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  expect(requestedScript).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
  expect(await page.evaluate(() => window.__diagnosticSitekey)).toBe('1x00000000000000000000AA');
  expect(await page.content()).not.toContain('TURNSTILE_SECRET_KEY');
  expect(apiRequests.filter((url) => /register|verification|sms|referral/i.test(url))).toEqual([]);

  await page.evaluate(() => window.__diagnosticCallback('ignored-diagnostic-token'));
  await expect(page.getByTestId('diagnostic-challenge-status')).toHaveText('CHALLENGE VERIFIED');
});

test('diagnostic reports a safe script failure without calling APIs', async ({ page }) => {
  const apiRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', (route) => route.abort('blockedbyclient'));

  await page.goto('/turnstile-diagnostic/');
  await expect(page.getByTestId('diagnostic-script-status')).toHaveText('SCRIPT FAILED');
  await expect(page.getByRole('alert')).toContainText('Cloudflare Turnstile script could not load.');
  expect(apiRequests.filter((url) => /register|verification|sms|referral/i.test(url))).toEqual([]);
});
