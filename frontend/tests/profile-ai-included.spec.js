import { expect, test } from '@playwright/test';

test('profile billing view renders with included AI wording', async ({ page }) => {
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
        skills: [],
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
