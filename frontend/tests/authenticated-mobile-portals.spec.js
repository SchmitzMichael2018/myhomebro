import { expect, test } from '@playwright/test';

const contractorEmail = process.env.QA_CONTRACTOR_EMAIL;
const contractorPassword = process.env.QA_CONTRACTOR_PASSWORD;
const homeownerEmail = process.env.QA_HOMEOWNER_EMAIL;
const homeownerPassword = process.env.QA_HOMEOWNER_PASSWORD;

const screenshotRoot = 'test-results/mobile-portal-audit';

function requireCredentials() {
  for (const [name, value] of Object.entries({
    QA_CONTRACTOR_EMAIL: contractorEmail,
    QA_CONTRACTOR_PASSWORD: contractorPassword,
    QA_HOMEOWNER_EMAIL: homeownerEmail,
    QA_HOMEOWNER_PASSWORD: homeownerPassword,
  })) {
    if (!value) throw new Error(`${name} is required for the authenticated mobile audit.`);
  }
}

function collectBrowserEvents(page) {
  const events = { consoleErrors: [], pageErrors: [], failedResponses: [], requestFailures: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') events.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => events.pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) events.failedResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => {
    events.requestFailures.push(`${request.failure()?.errorText || 'failed'} ${request.url()}`);
  });
  return events;
}

async function settle(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(900);
}

async function auditSurface(page, testInfo, name) {
  await settle(page);
  const metrics = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const documentWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
    const smallControls = [...document.querySelectorAll('button, a, input, select, textarea')]
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      })
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.height < 40 && rect.width < 40;
      })
      .slice(0, 20)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        label: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 80),
        width: Math.round(element.getBoundingClientRect().width),
        height: Math.round(element.getBoundingClientRect().height),
      }));
    const overflowElements = [...document.querySelectorAll('body *')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.right > viewportWidth + 2 || rect.left < -2);
      })
      .slice(0, 30)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === 'string' ? element.className.slice(0, 180) : '',
          testId: element.getAttribute('data-testid') || '',
          text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      });
    return { viewportWidth, documentWidth, smallControls, overflowElements };
  });

  const screenshotPath = `${screenshotRoot}/${name}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(`${name}-metrics`, {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });
  console.log('MOBILE_SURFACE_METRICS', name, JSON.stringify(metrics));
  expect(metrics.documentWidth, `${name} has global horizontal overflow`).toBeLessThanOrEqual(
    metrics.viewportWidth + 2,
  );
  await expect(page.locator('body')).toBeVisible();
  return metrics;
}

async function loginContractor(page) {
  await page.goto('/login');
  await page.getByTestId('login-email-input').fill(contractorEmail);
  await page.getByTestId('login-password-input').fill(contractorPassword);
  await page.getByTestId('login-submit-button').click();
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('access') || ''))
    .not.toBe('');
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}

async function loginHomeowner(page) {
  await page.goto('/portal');
  await page.getByTestId('customer-portal-login-email-input').fill(homeownerEmail);
  await page.getByTestId('customer-portal-login-password-input').fill(homeownerPassword);
  await page.getByTestId('customer-portal-login-button').click();
  await expect(page.getByTestId('customer-dashboard-header-logout')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => requireCredentials());

test('QA contractor portal is usable at iPhone 17 dimensions', async ({ page }, testInfo) => {
  const events = collectBrowserEvents(page);
  await loginContractor(page);

  const routes = [
    ['/app/dashboard', 'contractor-dashboard'],
    ['/app/opportunities', 'contractor-opportunities'],
    ['/app/estimates', 'contractor-estimates'],
    ['/app/agreements', 'contractor-agreements'],
    ['/app/milestones', 'contractor-milestones'],
    ['/app/payments', 'contractor-payments'],
    ['/app/expenses', 'contractor-expenses'],
    ['/app/disputes', 'contractor-resolution'],
    ['/app/warranties', 'contractor-warranties'],
    ['/app/templates', 'contractor-templates'],
    ['/app/calendar', 'contractor-calendar'],
    ['/app/marketing', 'contractor-marketing'],
    ['/app/profile', 'contractor-profile'],
  ];

  const metrics = {};
  for (const [route, name] of routes) {
    await page.goto(route);
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    metrics[name] = await auditSurface(page, testInfo, name);
  }

  console.log('MOBILE_CONTRACTOR_METRICS', JSON.stringify(metrics));
  console.log('MOBILE_CONTRACTOR_EVENTS', JSON.stringify(events));
  expect(events.pageErrors, 'contractor portal page errors').toEqual([]);
});

test('QA homeowner portal is usable at iPhone 17 dimensions', async ({ page }, testInfo) => {
  const events = collectBrowserEvents(page);
  await loginHomeowner(page);

  const tabs = ['requests', 'projects', 'payments', 'documents', 'property', 'notifications', 'account'];
  const metrics = { dashboard: await auditSurface(page, testInfo, 'homeowner-dashboard') };
  for (const tabName of tabs) {
    const tab = page.getByTestId(`customer-dashboard-tab-${tabName}`).first();
    if (!(await tab.count())) continue;
    await tab.click();
    metrics[tabName] = await auditSurface(page, testInfo, `homeowner-${tabName}`);
  }

  console.log('MOBILE_HOMEOWNER_METRICS', JSON.stringify(metrics));
  console.log('MOBILE_HOMEOWNER_EVENTS', JSON.stringify(events));
  expect(events.pageErrors, 'homeowner portal page errors').toEqual([]);
});
