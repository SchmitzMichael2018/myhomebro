import { expect, test } from '@playwright/test';

const PASSWORD = 'MyHomeBroQA!2026';
const screenshotDir = '../docs/audit-screenshots/targeted-qa-followup';

const accounts = {
  contractor: 'info+contractor@myhomebro.com',
  customer: 'info+customer@myhomebro.com',
  propertyManager: 'info+propertymanager@myhomebro.com',
};

function collectEvents(page, label) {
  const events = { label, consoleErrors: [], failedResponses: [], requestFailures: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') events.consoleErrors.push(msg.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) events.failedResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => {
    events.requestFailures.push(`${request.failure()?.errorText || 'failed'} ${request.url()}`);
  });
  return events;
}

async function snap(page, name, fullPage = true) {
  await page.screenshot({ path: `${screenshotDir}/${name}.png`, fullPage });
}

async function loginContractor(page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('login-email-input').fill(accounts.contractor);
  await page.getByTestId('login-password-input').fill(PASSWORD);
  await page.getByTestId('login-submit-button').click();
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem('access') || '')).not.toBe('');
}

async function loginPortal(page, email) {
  await page.goto('/portal', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('customer-portal-login-email-input').fill(email);
  await page.getByTestId('customer-portal-login-password-input').fill(PASSWORD);
  await page.getByTestId('customer-portal-login-button').click();
  await expect(page.getByTestId('customer-dashboard-header-logout')).toBeVisible({ timeout: 15000 });
}

async function openPortalTab(page, key, screenshotName) {
  const tab = page.getByTestId(`customer-dashboard-tab-${key}`);
  await expect(tab).toBeVisible({ timeout: 10000 });
  await tab.click();
  await page.waitForTimeout(900);
  await snap(page, screenshotName);
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(90000);

test('contractor insights page targeted QA screenshots', async ({ page }) => {
  const events = collectEvents(page, 'insights');
  await loginContractor(page);

  await page.goto('/app/business', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('dashboard-view-selector-row')).toBeVisible({ timeout: 20000 });
  await snap(page, 'insights-01-at-a-glance', false);

  for (const key of ['cash-flow', 'contractor-insights', 'profitability']) {
    const selector = page.getByTestId(`dashboard-view-selector-${key}`);
    if (await selector.count()) {
      await selector.click();
      await page.waitForTimeout(900);
      await snap(page, `insights-02-${key}`, false);
    }
  }

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/app/business', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('dashboard-view-selector-row')).toBeVisible({ timeout: 20000 });
  await snap(page, 'insights-04-tablet', false);

  console.log('TARGETED_QA_EVENTS insights', JSON.stringify(events));
});

test('customer portal targeted QA screenshots', async ({ page }) => {
  const events = collectEvents(page, 'customer-portal');
  await loginPortal(page, accounts.customer);
  await snap(page, 'customer-01-dashboard');

  for (const key of ['requests', 'projects', 'payments', 'documents', 'property', 'notifications', 'account']) {
    await openPortalTab(page, key, `customer-02-${key}`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('customer-dashboard-header-logout')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(700);
  await snap(page, 'customer-03-mobile-dashboard');

  console.log('TARGETED_QA_EVENTS customer-portal', JSON.stringify(events));
});

test('property manager portal rental workflow screenshots', async ({ page }) => {
  const events = collectEvents(page, 'property-manager-portal');
  await loginPortal(page, accounts.propertyManager);
  await snap(page, 'pm-01-dashboard');

  for (const key of ['maintenance', 'requests', 'projects', 'property', 'payments', 'documents', 'notifications', 'account']) {
    await openPortalTab(page, key, `pm-02-${key}`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('customer-dashboard-header-logout')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(700);
  await snap(page, 'pm-03-mobile-dashboard');

  console.log('TARGETED_QA_EVENTS property-manager-portal', JSON.stringify(events));
});
