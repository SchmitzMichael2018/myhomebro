import { test, expect } from '@playwright/test';

const PASSWORD = 'MyHomeBroQA!2026';
const screenshotDir = '../docs/audit-screenshots/authenticated-full-platform';

const roles = {
  contractor: 'info+contractor@myhomebro.com',
  customer: 'info+customer@myhomebro.com',
  propertyManager: 'info+propertymanager@myhomebro.com',
  employee: 'info+employee@myhomebro.com',
  subcontractor: 'info+subcontractor@myhomebro.com',
};

const seeded = {
  proposalId: process.env.QA_PROPOSAL_ID || '1',
  draftAgreementId: process.env.QA_DRAFT_AGREEMENT_ID || '17',
  fundedAgreementId: process.env.QA_FUNDED_AGREEMENT_ID || '20',
  subcontractorInviteToken:
    process.env.QA_SUBCONTRACTOR_INVITE_TOKEN ||
    'BMgmbYkl6ogxNQY_XKzabg3jAsFCJtWj3Hcp7A_S1R8',
};

function installCollectors(page, label) {
  const events = { label, consoleErrors: [], consoleWarnings: [], failedResponses: [], requestFailures: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') events.consoleErrors.push(msg.text());
    if (msg.type() === 'warning') events.consoleWarnings.push(msg.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      events.failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    events.requestFailures.push(`${request.failure()?.errorText || 'failed'} ${request.url()}`);
  });
  return events;
}

async function snap(page, name, fullPage = true) {
  await page.screenshot({ path: `${screenshotDir}/${name}.png`, fullPage });
}

async function loginApp(page, email) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('login-email-input').fill(email);
  await page.getByTestId('login-password-input').fill(PASSWORD);
  await page.getByTestId('login-submit-button').click();
  await expect
    .poll(async () => page.evaluate(() => window.localStorage.getItem('access') || ''))
    .not.toBe('');
}

async function loginPortal(page, email) {
  await page.goto('/portal', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('customer-portal-login-email-input').fill(email);
  await page.getByTestId('customer-portal-login-password-input').fill(PASSWORD);
  await page.getByTestId('customer-portal-login-button').click();
  await page.waitForTimeout(2500);
  return (await page.getByTestId('customer-portal-summary').count()) > 0;
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(90000);

test('authenticated contractor walkthrough screenshots', async ({ page }) => {
  const events = installCollectors(page, 'contractor');
  await loginApp(page, roles.contractor);

  const pages = [
    ['/app/dashboard', 'contractor-01-dashboard'],
    ['/app/opportunities', 'contractor-02-opportunities'],
    [`/app/proposals/${seeded.proposalId}`, 'contractor-03-estimate-workspace'],
    ['/app/agreements/new/wizard?step=1', 'contractor-04-agreement-wizard'],
    [`/app/agreements/${seeded.fundedAgreementId}/workspace`, 'contractor-05-funded-agreement-workspace'],
    ['/app/team', 'contractor-06-team'],
    ['/app/team/members', 'contractor-07-employees-labor'],
    ['/app/team/subcontractors', 'contractor-08-subcontractors'],
    ['/app/team/schedule', 'contractor-09-team-schedule'],
    ['/app/team/estimate-availability', 'contractor-10-estimate-availability'],
    ['/app/expenses', 'contractor-11-expenses'],
    ['/app/payments', 'contractor-12-payments'],
    ['/app/templates', 'contractor-13-templates'],
    ['/app/marketing', 'contractor-14-marketing-docs-photos'],
  ];

  for (const [url, name] of pages) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await snap(page, name);
  }

  console.log('AUDIT_EVENTS contractor', JSON.stringify(events));
});

test('authenticated customer portal walkthrough screenshots', async ({ page }) => {
  const events = installCollectors(page, 'customer');
  const loggedIn = await loginPortal(page, roles.customer);
  if (!loggedIn) {
    await snap(page, 'customer-00-login-failed');
    console.log('AUDIT_EVENTS customer', JSON.stringify(events));
    return;
  }

  await snap(page, 'customer-01-portal-dashboard');
  for (const tab of ['Projects', 'Payments', 'Documents', 'Maintenance']) {
    const tabButton = page.getByRole('button', { name: new RegExp(tab, 'i') }).first();
    if (await tabButton.count()) {
      await tabButton.click();
      await page.waitForTimeout(500);
      await snap(page, `customer-02-${tab.toLowerCase()}`);
    }
  }
  console.log('AUDIT_EVENTS customer', JSON.stringify(events));
});

test('authenticated property manager portal walkthrough screenshots', async ({ page }) => {
  const events = installCollectors(page, 'property-manager');
  const loggedIn = await loginPortal(page, roles.propertyManager);
  if (!loggedIn) {
    await snap(page, 'property-manager-00-login-failed');
    console.log('AUDIT_EVENTS property-manager', JSON.stringify(events));
    return;
  }

  await snap(page, 'property-manager-01-portal-dashboard');
  for (const tab of ['Properties', 'Maintenance', 'Vendors', 'Team']) {
    const tabButton = page.getByRole('button', { name: new RegExp(tab, 'i') }).first();
    if (await tabButton.count()) {
      await tabButton.click();
      await page.waitForTimeout(500);
      await snap(page, `property-manager-02-${tab.toLowerCase()}`);
    }
  }
  console.log('AUDIT_EVENTS property-manager', JSON.stringify(events));
});

test('authenticated employee walkthrough screenshots', async ({ page }) => {
  const events = installCollectors(page, 'employee');
  await loginApp(page, roles.employee);

  const pages = [
    ['/app/employee/dashboard', 'employee-01-dashboard'],
    ['/app/employee/agreements', 'employee-02-agreements'],
    ['/app/employee/milestones', 'employee-03-milestones'],
    ['/app/employee/calendar', 'employee-04-calendar'],
  ];
  for (const [url, name] of pages) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await snap(page, name);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/employee/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await snap(page, 'employee-05-mobile-dashboard');
  console.log('AUDIT_EVENTS employee', JSON.stringify(events));
});

test('authenticated subcontractor walkthrough screenshots', async ({ page }) => {
  const events = installCollectors(page, 'subcontractor');
  await loginApp(page, roles.subcontractor);

  await page.goto('/app/subcontractor/assigned-work', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await snap(page, 'subcontractor-01-assigned-work');

  await page.goto(`/subcontractor-invitations/accept/${seeded.subcontractorInviteToken}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(700);
  await snap(page, 'subcontractor-02-invitation');
  console.log('AUDIT_EVENTS subcontractor', JSON.stringify(events));
});
