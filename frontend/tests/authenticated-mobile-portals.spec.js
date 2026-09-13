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
  const events = { consoleErrors: [], cspErrors: [], pageErrors: [], failedResponses: [], requestFailures: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      events.consoleErrors.push(text);
      if (text.includes('Content Security Policy')) {
        events.cspErrors.push({ text, location: message.location() });
      }
    }
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
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  const installDismiss = page.getByRole('button', { name: 'Not now' }).first();
  if (await installDismiss.isVisible().catch(() => false)) await installDismiss.click();
  const loading = page.getByText(/^(Loading|Loading…|Loading\.\.\.)/).first();
  if (await loading.isVisible().catch(() => false)) {
    await loading.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
  }
  await page.waitForTimeout(500);
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
    const undersizedControls = [...document.querySelectorAll('button, a, input, select, textarea')]
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      })
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width >= 24 && rect.height >= 24) return false;
        if (element.matches('input[type="checkbox"], input[type="radio"]')) {
          const labelRect = element.closest('label')?.getBoundingClientRect();
          if (labelRect && labelRect.width >= 24 && labelRect.height >= 24) return false;
        }
        return true;
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
    const mobileMenu = document.querySelector('[data-testid="authenticated-mobile-menu-button"]');
    const pageTitle = document.querySelector('main h1') || document.querySelector('h1');
    let mobileMenuTitleOverlap = null;
    if (mobileMenu && pageTitle) {
      const menuRect = mobileMenu.getBoundingClientRect();
      const titleRect = pageTitle.getBoundingClientRect();
      mobileMenuTitleOverlap = !(
        menuRect.right <= titleRect.left
        || menuRect.left >= titleRect.right
        || menuRect.bottom <= titleRect.top
        || menuRect.top >= titleRect.bottom
      );
    }
    return { viewportWidth, documentWidth, smallControls, undersizedControls, overflowElements, mobileMenuTitleOverlap };
  });

  const screenshotPath = `${screenshotRoot}/${name}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(`${name}-metrics`, {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });
  console.log('MOBILE_SURFACE', JSON.stringify({
    name,
    viewportWidth: metrics.viewportWidth,
    documentWidth: metrics.documentWidth,
    smallControlCount: metrics.smallControls.length,
    overflowElements: metrics.documentWidth > metrics.viewportWidth + 2 ? metrics.overflowElements : [],
  }));
  expect(metrics.documentWidth, `${name} has global horizontal overflow`).toBeLessThanOrEqual(
    metrics.viewportWidth + 2,
  );
  expect(metrics.mobileMenuTitleOverlap, `${name} mobile menu overlaps the page title`).not.toBe(true);
  expect(metrics.undersizedControls, `${name} has controls below the 24px minimum target`).toEqual([]);
  await expect(page.locator('body')).toBeVisible();
  return metrics;
}

async function openLoginSurface(page, route, testId) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(route, { waitUntil: 'commit', timeout: 45_000 });
      await page.getByTestId(testId).waitFor({ state: 'visible', timeout: 60_000 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await page.waitForTimeout(1_000);
    }
  }
  throw lastError;
}

async function loginContractor(page) {
  await openLoginSurface(page, '/login', 'login-email-input');
  await page.getByTestId('login-email-input').fill(contractorEmail);
  await page.getByTestId('login-password-input').fill(contractorPassword);
  await page.getByTestId('login-submit-button').click();
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('access') || ''))
    .not.toBe('');
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  // Let the post-login route finish loading before the audit begins navigating.
  // WebKit otherwise reports the intentionally cancelled lazy route import as a page error.
  await settle(page);
}

async function loginHomeowner(page) {
  await openLoginSurface(page, '/portal', 'customer-portal-login-email-input');
  await page.getByTestId('customer-portal-login-email-input').fill(homeownerEmail);
  await page.getByTestId('customer-portal-login-password-input').fill(homeownerPassword);
  await page.getByTestId('customer-portal-login-button').click();
  await expect(page.getByTestId('customer-dashboard-header-logout')).toBeVisible();
}

async function openContractorRoute(page, route) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(route, { waitUntil: 'commit', timeout: 45_000 });
      await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
      await page.locator('h1').first().waitFor({ state: 'visible', timeout: 60_000 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await page.waitForTimeout(1_000);
    }
  }
  throw lastError;
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
    ['/app/agreements/37/workspace', 'contractor-agreement-37-workspace'],
  ];

  const metrics = {};
  for (const [route, name] of routes) {
    await openContractorRoute(page, route);
    if (name === 'contractor-agreements') {
      await page.getByTestId('agreement-list-mobile-cards').waitFor({ state: 'visible', timeout: 60_000 });
    }
    if (name === 'contractor-resolution') {
      await page.getByTestId('resolution-mobile-cards').waitFor({ state: 'visible', timeout: 60_000 });
    }
    metrics[name] = await auditSurface(page, testInfo, name);
    if (name === 'contractor-agreements') {
      await expect(page.getByTestId('agreement-list-mobile-cards')).toBeVisible();
      await expect(page.getByTestId('agreement-list-table-shell')).toBeHidden();
    }
    if (name === 'contractor-resolution') {
      await expect(page.getByTestId('resolution-mobile-cards')).toBeVisible();
    }
    if (name === 'contractor-calendar') {
      await expect(page.locator('.fc-timeGridDay-button')).toHaveClass(/fc-button-active/);
    }
  }

  const actionablePageErrors = events.pageErrors.filter(
    (message) => !message.includes('due to access control checks.'),
  );
  console.log('MOBILE_CONTRACTOR_SUMMARY', JSON.stringify({
    surfaces: Object.keys(metrics),
    consoleErrorCount: events.consoleErrors.length,
    cspDiagnostics: events.cspErrors.slice(0, 10),
    failedResponses: events.failedResponses,
    actionablePageErrors,
  }));
  expect(actionablePageErrors, 'contractor portal page errors').toEqual([]);
  expect(events.cspErrors.filter((entry) => entry.location.url.startsWith('https://www.myhomebro.com')), 'contractor same-origin CSP errors').toEqual([]);
  expect(events.failedResponses.filter((entry) => entry.includes('myhomebro.com')), 'contractor same-origin failed responses').toEqual([]);
});

test('QA homeowner portal is usable at iPhone 17 dimensions', async ({ page }, testInfo) => {
  const events = collectBrowserEvents(page);
  await loginHomeowner(page);

  const metrics = { dashboard: await auditSurface(page, testInfo, 'homeowner-dashboard') };
  const pendingTabs = [];
  const queuedTabs = new Set();
  const discoverTabs = async () => {
    const ids = await page.locator('[data-testid^="customer-dashboard-tab-"]').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-testid')).filter(Boolean),
    );
    for (const id of ids) {
      if (id === 'customer-dashboard-tab-account' || queuedTabs.has(id)) continue;
      queuedTabs.add(id);
      pendingTabs.push(id);
    }
  };
  await discoverTabs();
  while (pendingTabs.length) {
    const tabId = pendingTabs.shift();
    const tabName = tabId.replace('customer-dashboard-tab-', '');
    const tab = page.getByTestId(tabId).first();
    if (!(await tab.count())) continue;
    await tab.click();
    metrics[tabName] = await auditSurface(page, testInfo, `homeowner-${tabName}`);
    await discoverTabs();
  }
  await page.getByTestId('customer-dashboard-tab-account').click();
  metrics.account = await auditSurface(page, testInfo, 'homeowner-account');

  console.log('MOBILE_HOMEOWNER_SUMMARY', JSON.stringify({
    surfaces: Object.keys(metrics),
    consoleErrorCount: events.consoleErrors.length,
    cspDiagnostics: events.cspErrors.slice(0, 10),
    failedResponses: events.failedResponses,
    pageErrors: events.pageErrors,
  }));
  expect(events.pageErrors, 'homeowner portal page errors').toEqual([]);
  expect(events.cspErrors.filter((entry) => entry.location.url.startsWith('https://www.myhomebro.com')), 'homeowner same-origin CSP errors').toEqual([]);
  expect(events.failedResponses.filter((entry) => entry.includes('myhomebro.com')), 'homeowner same-origin failed responses').toEqual([]);
});
