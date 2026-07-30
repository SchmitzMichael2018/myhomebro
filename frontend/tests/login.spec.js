import { expect, test } from '@playwright/test';

test('landing page smoke renders core entry points', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('landing-hero-heading')).toBeVisible();
  await expect(page.getByTestId('landing-sign-in-button')).toBeVisible();
  await expect(
    page.getByTestId('landing-start-project-intake-button')
  ).toBeVisible();
  await expect(page.getByTestId('landing-hero-heading')).toContainText(
    'Everything you need to plan, hire, and manage your project.'
  );
  await expect(page.getByRole('button', { name: 'How It Works' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'For Customers' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'For Contractors' })).toBeVisible();
  await expect(page.getByTestId('landing-resident-maintenance-link')).toHaveText('Resident Maintenance');
  await expect(page.getByTestId('landing-resident-maintenance-link')).toHaveAttribute('href', '/maintenance-request');
  await expect(page.getByTestId('landing-maintenance-request-button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resources' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'About Us' })).toHaveCount(0);

  await page.getByRole('button', { name: 'For Customers' }).click();
  await expect(page.getByTestId('landing-homeowner-card')).toBeInViewport();
  await page.getByRole('button', { name: 'For Contractors' }).click();
  await expect(page.getByTestId('landing-contractor-card')).toBeInViewport();
  await page.getByRole('button', { name: 'How It Works' }).first().click();
  await expect(page.getByRole('heading', { name: 'How It Works' })).toBeInViewport();

  await page.getByTestId('landing-sign-in-button').click();
  const loginMenu = page.getByRole('menu', { name: 'Log in options' });
  await expect(loginMenu).toBeVisible();
  await expect(loginMenu.getByRole('button', { name: 'Customer Log In' })).toBeVisible();
  await expect(loginMenu.getByRole('button', { name: 'Contractor Log In' })).toBeVisible();
  await expect(loginMenu.getByRole('button', { name: 'Contractors: Sign Up' })).toBeVisible();
  await expect(page.getByTestId('landing-homeowner-card')).toBeVisible();
  await expect(page.getByTestId('landing-contractor-card')).toBeVisible();
  await expect(page.getByTestId('landing-video-preview')).toBeVisible();
  await expect(page.getByTestId('landing-homeowner-image-panel')).toBeVisible();
  await expect(page.getByTestId('landing-contractor-image-panel')).toBeVisible();
  await expect(page.getByTestId('landing-video-preview-asset')).toBeVisible();
  await expect(page.getByTestId('landing-homeowner-visual-asset')).toBeVisible();
  await expect(page.getByTestId('landing-contractor-visual-asset')).toBeVisible();
  const trustSection = page.getByTestId('landing-trust-section');
  await expect(trustSection.getByText('Escrow-Based Milestone Holds')).toBeVisible();
  await expect(trustSection.getByText('Property Records & Maintenance History')).toBeVisible();
  await expect(trustSection.getByText('Structured Agreements & Approvals')).toBeVisible();
  await expect(trustSection.getByText('Project Transparency & Dispute Workflow')).toBeVisible();
  await expect(page.getByText('10K+')).toHaveCount(0);
  await expect(page.getByText('Average homeowner rating')).toHaveCount(0);
  await expect(page.getByText('Thousands of projects started')).toHaveCount(0);
  await expect(trustSection.getByRole('link', { name: 'Terms of Service' })).toHaveCount(0);
  await expect(trustSection.getByRole('link', { name: 'Privacy Policy' })).toHaveCount(0);
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('link', { name: 'Terms of Service' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();
});

test('landing page mobile layout does not horizontally overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('landing-hero-heading')).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test('landing customer login routes directly to the customer portal', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('landing-sign-in-button').click();
  await page
    .getByRole('menu', { name: 'Log in options' })
    .getByRole('button', { name: 'Customer Log In' })
    .click();

  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByTestId('login-modal')).toHaveCount(0);
});

test('landing login dropdown opens contractor modal and routes to contractor dashboard after login', async ({
  page,
}) => {
  await page.route('**/api/auth/login/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access: 'contractor-access-token',
        refresh: 'contractor-refresh-token',
        user: { email: 'contractor@example.com' },
      }),
    });
  });
  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'contractor',
        role: 'contractor_owner',
        identity_type: 'contractor_owner',
        email: 'contractor@example.com',
      }),
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('landing-sign-in-button').click();
  await page
    .getByRole('menu', { name: 'Log in options' })
    .getByRole('button', { name: 'Contractor Log In', exact: true })
    .click();

  await expect(page.getByTestId('login-modal')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  await page.getByTestId('login-email-input').fill('contractor@example.com');
  await page.getByTestId('login-password-input').fill('password123');
  await page.getByTestId('login-submit-button').click();

  await expect(page).toHaveURL(/\/app\/dashboard$/);
});

test('landing login modal closes with close button and backdrop click', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('landing-sign-in-button').click();
  await page
    .getByRole('menu', { name: 'Log in options' })
    .getByRole('button', { name: 'Contractor Log In', exact: true })
    .click();
  await expect(page.getByTestId('login-modal')).toBeVisible();

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('login-modal')).toBeHidden();

  await page.getByTestId('landing-sign-in-button').click();
  await page
    .getByRole('menu', { name: 'Log in options' })
    .getByRole('button', { name: 'Contractor Log In', exact: true })
    .click();
  await expect(page.getByTestId('login-modal')).toBeVisible();

  await page.mouse.click(8, 8);
  await expect(page.getByTestId('login-modal')).toBeHidden();
});

test('landing contractor login modal keeps all dialog controls interactive', async ({ page }) => {
  const openContractorLogin = async () => {
    await page.getByTestId('landing-sign-in-button').click();
    await page
      .getByRole('menu', { name: 'Log in options' })
      .getByRole('button', { name: 'Contractor Log In', exact: true })
      .click();
    await expect(page.getByTestId('login-modal')).toBeVisible();
  };

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openContractorLogin();

  const modal = page.getByTestId('login-modal');
  const dialog = modal.getByRole('dialog');
  const email = page.getByTestId('login-email-input');
  const password = page.getByTestId('login-password-input');
  const showPassword = dialog.getByRole('checkbox', { name: 'Show' });
  const rememberMe = dialog.getByRole('checkbox', { name: 'Remember me' });

  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await email.click();
  await expect(email).toBeFocused();
  await email.fill('interaction@example.com');
  await expect(email).toHaveValue('interaction@example.com');
  expect(await email.evaluate((element) => getComputedStyle(element).cursor)).toBe('text');

  await password.click();
  await expect(password).toBeFocused();
  await password.fill('not-a-real-password');
  await expect(password).toHaveValue('not-a-real-password');
  await showPassword.check();
  await expect(password).toHaveAttribute('type', 'text');
  await rememberMe.uncheck();
  await expect(rememberMe).not.toBeChecked();

  await dialog.getByRole('heading', { name: 'Sign In' }).click();
  await expect(modal).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }

  await page.mouse.click(8, 8);
  await expect(modal).toBeHidden();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');

  await openContractorLogin();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(page.getByTestId('landing-sign-in-button')).toBeFocused();
});

test('landing contractor login modal remains interactive and contained at supported widths', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 900, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByTestId('landing-sign-in-button').click();
    await page
      .getByRole('menu', { name: 'Log in options' })
      .getByRole('button', { name: 'Contractor Log In', exact: true })
      .click();

    const modal = page.getByTestId('login-modal');
    const dialog = modal.getByRole('dialog');
    const email = page.getByTestId('login-email-input');
    await email.click();
    await email.fill(`width-${viewport.width}@example.com`);
    await expect(modal).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    expect(Number(await dialog.evaluate((element) => getComputedStyle(element).zIndex))).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  }
});
