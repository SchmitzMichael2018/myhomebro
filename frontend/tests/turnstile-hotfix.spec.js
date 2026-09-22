import { expect, test } from '@playwright/test';

const runtimeSource = `
  window.__turnstileRenderCount = window.__turnstileRenderCount || 0;
  window.__turnstileWidgets = window.__turnstileWidgets || new Map();
  window.turnstile = {
    render(container, options) {
      window.__turnstileRenderCount += 1;
      window.__turnstileOptions = options;
      const widget = document.createElement('div');
      widget.dataset.mockTurnstile = String(window.__turnstileRenderCount);
      container.replaceChildren(widget);
      const id = 'widget-' + window.__turnstileRenderCount;
      window.__turnstileWidgets.set(id, widget);
      return id;
    },
    remove(id) {
      window.__turnstileWidgets.get(id)?.remove();
      window.__turnstileWidgets.delete(id);
    }
  };
`;

test('absent script loads, renders once, verifies, and expires safely', async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: runtimeSource,
  }));
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  const submit = page.getByRole('button', { name: 'Sign Up' });
  await expect(page.getByTestId('turnstile-status')).toHaveText('Complete the security check to continue.');
  await expect(submit).toBeDisabled();
  await page.evaluate(() => window.__turnstileOptions.callback('valid-test-token'));
  await expect(page.getByTestId('turnstile-status')).toHaveText('Security check complete.');
  await expect(submit).toBeEnabled();
  await page.evaluate(() => window.__turnstileOptions['expired-callback']());
  await expect(page.getByTestId('turnstile-status')).toContainText('expired');
  await expect(submit).toBeDisabled();
  await expect(page.locator('[data-mock-turnstile]')).toHaveCount(1);
});

test('an already available runtime renders immediately without adding a script', async ({ page }) => {
  await page.addInitScript(runtimeSource);
  await page.goto('/signup');
  await expect(page.locator('[data-mock-turnstile]')).toHaveCount(1);
  await expect(page.locator('#cloudflare-turnstile-script')).toHaveCount(0);
});

test('an existing script whose load event already fired recovers when runtime becomes ready', async ({ page }) => {
  await page.route(/\/signup$/, async (route) => {
    const response = await route.fetch();
    const recoveryScript = `<script id="cloudflare-turnstile-script"></script><script>
      setTimeout(() => { window.turnstile = {
        render(container, options) {
          window.__turnstileOptions = options;
          const widget = document.createElement('div');
          widget.dataset.mockTurnstile = 'recovered';
          container.appendChild(widget);
          return 'recovered-widget';
        }, remove() {}
      }; }, 250);
    </script>`;
    await route.fulfill({ response, body: (await response.text()).replace('</head>', recoveryScript + '</head>') });
  });
  await page.goto('/signup');
  await expect(page.locator('[data-mock-turnstile="recovered"]')).toHaveCount(1);
  await expect(page.getByTestId('turnstile-status')).toContainText('Complete');
});

test('script errors fail closed and retry can recover', async ({ page }) => {
  let requests = 0;
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', (route) => {
    requests += 1;
    if (requests === 1) return route.abort('failed');
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: runtimeSource });
  });
  await page.goto('/signup');
  await expect(page.getByText("We couldn't load the security check.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign Up' })).toBeDisabled();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('[data-mock-turnstile]')).toHaveCount(1);
});

test('widget render errors fail closed', async ({ page }) => {
  await page.addInitScript(() => {
    window.turnstile = {
      render() { throw new Error('render failed'); },
      remove() {},
    };
  });
  await page.goto('/signup');
  await expect(page.getByText("We couldn't load the security check.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign Up' })).toBeDisabled();
});

test('customer registration is gated until a valid callback', async ({ page }) => {
  await page.addInitScript(runtimeSource);
  await page.goto('/create-account?role=customer');
  const submit = page.getByTestId('customer-account-create-submit');
  await expect(submit).toBeDisabled();
  await page.evaluate(() => window.__turnstileOptions.callback('customer-test-token'));
  await expect(submit).toBeEnabled();
});

test('a rejected registration discards the consumed challenge before retry', async ({ page }) => {
  await page.addInitScript(runtimeSource);
  const submittedResponses = [];
  await page.route('**/api/accounts/auth/customer-register/', (route) => {
    submittedResponses.push(route.request().postDataJSON()?.turnstile_token);
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Registration could not be completed.' }),
    });
  });
  await page.goto('/create-account?role=customer', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('customer-account-name').fill('QA Example');
  await page.getByTestId('customer-account-email').fill('qa@example.invalid');
  await page.getByTestId('customer-account-password').fill('Local-Test-Password-123!');
  await page.getByTestId('customer-account-password-confirm').fill('Local-Test-Password-123!');
  await page.evaluate(() => window.__turnstileOptions.callback('local-first-challenge'));
  const submit = page.getByTestId('customer-account-create-submit');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByTestId('customer-account-error')).toBeVisible();
  await expect(submit).toBeDisabled();
  await expect(page.getByTestId('turnstile-status')).toHaveText('Complete the security check to continue.');
  await expect(page.locator('[data-mock-turnstile]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.__turnstileRenderCount)).toBe(2);
  await page.evaluate(() => window.__turnstileOptions.callback('local-second-challenge'));
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect.poll(() => submittedResponses.length).toBe(2);
  expect(submittedResponses[0]).toBeTruthy();
  expect(submittedResponses[1]).toBeTruthy();
  expect(submittedResponses[1]).not.toBe(submittedResponses[0]);
});

test('contractor registration also discards a challenge after rejection', async ({ page }) => {
  await page.addInitScript(runtimeSource);
  const submittedResponses = [];
  await page.route('**/api/accounts/auth/contractor-register/', (route) => {
    submittedResponses.push(route.request().postDataJSON()?.turnstile_token);
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Registration could not be completed.' }),
    });
  });
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'First Name' }).fill('QA');
  await page.getByRole('textbox', { name: 'Last Name' }).fill('Example');
  await page.getByRole('textbox', { name: 'Email' }).fill('qa@example.invalid');
  await page.getByRole('textbox', { name: 'Phone (10 digits)' }).fill('2105550199');
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Local-Test-Password-123!');
  await page.getByRole('textbox', { name: 'Confirm Password' }).fill('Local-Test-Password-123!');
  await page.locator('input[name="agree"]').check();
  await page.evaluate(() => window.__turnstileOptions.callback('local-first-challenge'));
  const submit = page.getByRole('button', { name: 'Sign Up' });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(page.getByTestId('turnstile-status')).toHaveText('Complete the security check to continue.');
  await expect.poll(() => page.evaluate(() => window.__turnstileRenderCount)).toBe(2);
  await page.evaluate(() => window.__turnstileOptions.callback('local-second-challenge'));
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect.poll(() => submittedResponses.length).toBe(2);
  expect(submittedResponses[0]).toBeTruthy();
  expect(submittedResponses[1]).toBeTruthy();
  expect(submittedResponses[1]).not.toBe(submittedResponses[0]);
});

test('SPA unmount and remount cleans up and creates no duplicate widget', async ({ page }) => {
  await page.addInitScript(runtimeSource);
  await page.goto('/signup');
  await expect(page.locator('[data-mock-turnstile]')).toHaveCount(1);
  await page.evaluate(() => {
    history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByTestId('turnstile-security-check')).toHaveCount(0);
  await page.evaluate(() => {
    history.pushState({}, '', '/signup');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByTestId('turnstile-security-check')).toBeVisible();
  await expect(page.locator('[data-mock-turnstile]')).toHaveCount(1);
});
