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
  await page.goto('/signup');
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
