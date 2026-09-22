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
  await expect(page.getByTestId('diagnostic-key-mode')).toHaveText('TEST');
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

test('production diagnostic uses the compiled public site key without displaying it', async ({ page }) => {
  const businessRequests = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/') && /register|verification|sms|referral|projects\/|intake/i.test(pathname)) {
      businessRequests.push(request.url());
    }
  });
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `window.turnstile = {
      render(container, options) {
        window.__productionDiagnosticOptions = options;
        container.textContent = 'Mock production-key widget';
        return 'production-diagnostic-widget';
      }, remove() {}
    };`,
  }));

  await page.goto('/turnstile-diagnostic/production/');
  await expect(page.getByTestId('diagnostic-key-mode')).toHaveText('PRODUCTION');
  await expect(page.getByTestId('diagnostic-widget-status')).toHaveText('WIDGET RENDERED');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  expect(await page.evaluate(() => window.__productionDiagnosticOptions.sitekey)).toBe('production-public-site-key-for-diagnostic');
  await expect(page.getByTestId('turnstile-diagnostic')).not.toContainText('production-public-site-key-for-diagnostic');
  expect(await page.content()).not.toContain('TURNSTILE_SECRET_KEY');
  expect(businessRequests).toEqual([]);

  await page.evaluate(() => window.__productionDiagnosticOptions['error-callback']('safe-provider-code'));
  await expect(page.getByTestId('diagnostic-challenge-status')).toHaveText('CHALLENGE ERROR');
  await expect(page.getByTestId('turnstile-diagnostic')).not.toContainText('safe-provider-code');
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
