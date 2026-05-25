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
  await page.getByTestId('landing-sign-in-button').click();
  const loginMenu = page.getByRole('menu', { name: 'Log in options' });
  await expect(loginMenu).toBeVisible();
  await expect(loginMenu.getByRole('button', { name: 'Homeowner Log In' })).toBeVisible();
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

test('landing login dropdown opens homeowner modal and routes to portal after login', async ({
  page,
}) => {
  await page.route('**/api/auth/login/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access: 'homeowner-access-token',
        refresh: 'homeowner-refresh-token',
        user: { email: 'homeowner@example.com' },
      }),
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('landing-sign-in-button').click();
  await page.getByRole('button', { name: 'Homeowner Log In' }).click();

  await expect(page.getByTestId('login-modal')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  await page.getByTestId('login-email-input').fill('homeowner@example.com');
  await page.getByTestId('login-password-input').fill('password123');
  await page.getByTestId('login-submit-button').click();

  await expect(page).toHaveURL(/\/portal$/);
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

  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('login-modal')).toBeHidden();

  await page.getByTestId('landing-sign-in-button').click();
  await page.getByRole('button', { name: 'Homeowner Log In' }).click();
  await expect(page.getByTestId('login-modal')).toBeVisible();

  await page.mouse.click(8, 8);
  await expect(page.getByTestId('login-modal')).toBeHidden();
});
