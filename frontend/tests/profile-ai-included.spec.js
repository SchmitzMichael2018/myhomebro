import { expect, test } from '@playwright/test';

test('profile billing view renders with included AI wording', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 7,
        type: 'contractor',
        role: 'contractor_owner',
        email: 'playwright@myhomebro.local',
      }),
    });
  });

  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        onboarding_status: 'not_started',
        connected: false,
      }),
    });
  });

  await page.route('**/api/projects/contractors/me/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        full_name: 'Profile Demo',
        email: 'playwright@myhomebro.local',
        business_name: 'Demo Contracting',
        phone: '555-0100',
        address: '123 Main St',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        service_radius_miles: 25,
        skills: ['Carpentry'],
        pricing_summary: {
          current_rate: '0.045',
          current_rate_label: '4.5% + $1 per agreement',
          tier_name: 'tier1',
          tier_type: 'standard',
          fee_cap: '750.00',
          fee_cap_label: '$750 per agreement',
          intro_active: false,
          intro_status_label: 'Intro period ended',
          intro_days_remaining: 0,
          monthly_volume: '8200.00',
          monthly_volume_label: '$8,200.00',
          volume_discount_threshold: '25000.00',
          volume_discount_active: false,
          volume_discount_label: '$16,800.00 away from discounted rate (3.5% + $1)',
          volume_shortfall: '16800.00',
          volume_progress_pct: 32,
          next_discount_rate_label: '3.5% + $1',
        },
        ai: {
          access: 'included',
          enabled: true,
          unlimited: true,
        },
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.goto('/app/profile', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  expect(pageErrors.map((error) => error.message)).toEqual([]);

  const profileCompleteness = page.getByTestId('profile-completeness-bar');
  await expect(profileCompleteness).toBeVisible();
  await expect(profileCompleteness).toContainText('100%');
  await page.getByRole('button', { name: /View details/ }).click();
  await expect(profileCompleteness).not.toContainText('First job or template');
  await expect(profileCompleteness).not.toContainText('Team members');
  await expect(profileCompleteness).not.toContainText('Stripe');
  const launchChecklist = page.getByTestId('business-launch-checklist');
  await expect(launchChecklist).toBeVisible();
  await expect(launchChecklist).toContainText('These actions help you start using MyHomeBro but do not affect your profile completeness.');
  await expect(page.getByTestId('launch-item-first_estimate')).toContainText('Create your first estimate');
  await expect(page.getByTestId('launch-item-template')).toContainText('Choose a reusable template');
  await expect(page.getByTestId('launch-item-team')).toContainText('Optional');
  await expect(page.getByTestId('launch-item-payments')).toContainText('Optional');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'test-results/profile-completeness-and-launch.png', fullPage: true });
  await profileCompleteness.screenshot({ path: 'test-results/profile-completeness.png' });
  await launchChecklist.screenshot({ path: 'test-results/business-launch-checklist.png' });
  await page.screenshot({ path: 'test-results/profile-solo-contractor.png', fullPage: true });
  await page.setViewportSize({ width: 900, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/profile-launch-tablet.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/profile-launch-solo-390.png', fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel('Business Name').fill('Demo Contracting Updated');
  await expect(page.getByTestId('profile-save-bar')).toBeVisible();
  await page.screenshot({ path: 'test-results/profile-sticky-save.png', fullPage: true });
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Discard unsaved profile changes');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: /Account & Login/ }).click();
  await expect(page.getByRole('heading', { name: 'Business Profile' })).toBeVisible();
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByTestId('profile-save-bar')).toHaveCount(0);
  await expect(page.getByLabel('Business Name')).toHaveValue('Demo Contracting');

  await page.getByRole('button', { name: /Account & Login/ }).click();
  await expect(page.getByRole('heading', { name: 'Account & Login' })).toBeVisible();
  const dangerZone = page.getByTestId('profile-danger-zone');
  await expect(dangerZone).not.toHaveAttribute('open', '');
  await dangerZone.locator('summary').click();
  await expect(page.getByRole('heading', { name: 'Delete contractor profile' })).toBeVisible();
  await page.screenshot({ path: 'test-results/profile-account-danger-zone.png', fullPage: true });

  await expect(page.getByRole('button', { name: /Plan & Billing/ })).toBeVisible();
  await page.getByRole('button', { name: /Plan & Billing/ }).click();

  await expect(page.getByTestId('contractor-pricing-summary')).toBeVisible();
  await expect(page.getByText('Current Platform Rate')).toBeVisible();
  await expect(page.getByText('4.5% + $1 per agreement')).toBeVisible();
  await expect(page.getByText('Tier type: Standard')).toBeVisible();
  await expect(page.getByText('Fee cap: $750 per agreement')).toBeVisible();
  await expect(page.getByText("This month's processed volume: $8,200.00")).toBeVisible();
  await expect(
    page.getByText('$16,800.00 away from discounted rate (3.5% + $1)').last()
  ).toBeVisible();

  await expect(page.getByText('Billing & Fees')).toBeVisible();
  await expect(page.getByText('All AI tools are included with your account.')).toBeVisible();
  await expect(page.getByText('Platform Fees (MyHomeBro)')).toBeVisible();
  await expect(page.getByText('Intro pricing: 3% + $1 for the first 60 days')).toBeVisible();
  await expect(page.getByText('Payment Processing (Stripe)')).toBeVisible();
  await expect(page.getByText('Card payments: typically about 2.9% + $0.30')).toBeVisible();
  await expect(page.getByText("What You'll See in the App")).toBeVisible();
  await expect(page.getByText('MyHomeBro platform fee', { exact: true })).toBeVisible();
  await expect(page.getByText('Net payout')).toBeVisible();
});
