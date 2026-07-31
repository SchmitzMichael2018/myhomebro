import { expect, test } from '@playwright/test';

async function openSignupFromHeader(page) {
  await page.getByTestId('landing-sign-in-button').click();
  await page
    .getByRole('menu', { name: 'Log in options' })
    .getByTestId('landing-contractor-signup-button')
    .click();
  return page.getByTestId('signup-modal');
}

async function fillValidSignup(dialog) {
  await dialog.getByLabel('First Name').fill('Sam');
  await dialog.getByLabel('Last Name').fill('Builder');
  await dialog.getByLabel('Email').fill('sam.builder@example.com');
  await dialog.getByLabel('Password', { exact: true }).fill('Secret123!');
  await dialog.getByLabel('Confirm Password').fill('Secret123!');
  await dialog.getByLabel('Phone (10 digits)').fill('3125550199');
  await dialog.getByRole('checkbox').check();
}

test('landing contractor signup opens an accessible modal without changing the URL', async ({
  page,
}) => {
  await page.goto('/');
  const trigger = page.getByTestId('landing-sign-in-button');
  const modal = await openSignupFromHeader(page);
  const dialog = modal.getByRole('dialog');

  await expect(modal).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(page).toHaveURL(/\/$/);
  await expect(dialog.getByLabel('First Name')).toBeFocused();

  await dialog.getByLabel('Email').fill('contractor@example.com');
  await dialog.getByLabel('Password', { exact: true }).fill('Secret123!');
  await dialog.getByLabel('Confirm Password').fill('Secret123!');
  await dialog.getByLabel('Phone (10 digits)').fill('3125550199');
  await dialog.getByRole('checkbox').check();
  await expect(dialog.getByLabel('Email')).toHaveValue(
    'contractor@example.com'
  );
  await expect(dialog.getByRole('checkbox')).toBeChecked();

  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('signup modal keeps validation visible and only backdrop clicks dismiss it', async ({
  page,
}) => {
  await page.goto('/');
  const modal = await openSignupFromHeader(page);
  const dialog = modal.getByRole('dialog');

  await dialog.getByLabel('First Name').fill('Sam');
  await dialog.getByLabel('Last Name').fill('Builder');
  await dialog.getByLabel('Email').fill('sam.builder@example.com');
  await dialog.getByLabel('Password', { exact: true }).fill('Secret123!');
  await dialog.getByLabel('Confirm Password').fill('Secret123!');
  await expect(modal).toBeVisible();
  await dialog.getByRole('button', { name: 'Sign Up', exact: true }).click();
  await expect(
    page.getByText('Please agree to the Terms to continue.')
  ).toBeVisible();
  await expect(modal).toBeVisible();

  await modal.click({ position: { x: 5, y: 5 } });
  await expect(modal).toHaveCount(0);
});

test('signup modal Terms link preserves consent state and the dialog', async ({
  page,
}) => {
  await page.goto('/');
  const modal = await openSignupFromHeader(page);
  const dialog = modal.getByRole('dialog');
  const checkbox = dialog.getByRole('checkbox');
  const terms = dialog.getByRole('link', { name: 'Terms of Service' });
  const privacy = dialog.getByRole('link', { name: 'Privacy Policy' });

  await expect(terms).toHaveAttribute('href', '/legal/terms-of-service/');
  await expect(privacy).toHaveAttribute('href', '/legal/privacy-policy/');
  await expect(checkbox).not.toBeChecked();

  await terms.click();
  await expect(page).toHaveURL(/\/legal\/terms-of-service\/?$/);
  await expect(modal).toBeVisible();
  await expect(checkbox).not.toBeChecked();
});

test('signup modal Privacy link preserves consent state and the dialog', async ({
  page,
}) => {
  await page.goto('/');
  const modal = await openSignupFromHeader(page);
  const dialog = modal.getByRole('dialog');
  const checkbox = dialog.getByRole('checkbox');
  const privacy = dialog.getByRole('link', { name: 'Privacy Policy' });

  await privacy.click();
  await expect(page).toHaveURL(/\/legal\/privacy-policy\/?$/);
  await expect(modal).toBeVisible();
  await expect(checkbox).not.toBeChecked();
});

test('signup consent label toggles the checkbox and links have separate tab stops', async ({
  page,
}) => {
  await page.goto('/');
  const modal = await openSignupFromHeader(page);
  const dialog = modal.getByRole('dialog');
  const checkbox = dialog.getByRole('checkbox');
  const terms = dialog.getByRole('link', { name: 'Terms of Service' });
  const privacy = dialog.getByRole('link', { name: 'Privacy Policy' });

  await dialog.getByTestId('signup-consent-copy').click();
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(terms).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(privacy).toBeFocused();
});

test('mocked contractor registration follows the existing onboarding redirect', async ({
  page,
}) => {
  await page.route('**/api/accounts/auth/contractor-register/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access: 'contractor-access-token',
        refresh: 'contractor-refresh-token',
      }),
    })
  );
  await page.goto('/');
  const modal = await openSignupFromHeader(page);
  await fillValidSignup(modal.getByRole('dialog'));
  await modal.getByRole('button', { name: 'Sign Up', exact: true }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
});

test('direct signup route remains usable and preserves browser history', async ({
  page,
}) => {
  await page.goto('/');
  await page.goto('/signup');
  await expect(
    page.getByRole('heading', { name: 'Contractor Sign Up' })
  ).toBeVisible();
  await expect(page.getByLabel('Email')).toBeEditable();
  await expect(
    page.getByRole('link', { name: 'Terms of Service' })
  ).toHaveAttribute('href', '/legal/terms-of-service/');
  await expect(
    page.getByRole('link', { name: 'Privacy Policy' })
  ).toHaveAttribute('href', '/legal/privacy-policy/');

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('landing-hero-heading')).toBeVisible();
});

for (const width of [1440, 900, 390]) {
  test(`signup modal fits without page overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('/');
    const modal = await openSignupFromHeader(page);
    await expect(modal.getByRole('dialog')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
  });
}
