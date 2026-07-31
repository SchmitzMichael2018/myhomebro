import { expect, test } from '@playwright/test';

async function installEntryOnboardingRoutes(page, initial = {}) {
  const state = {
    me: {
      id: 77,
      business_name: 'MyHomeBro QA Contractor',
      city: '',
      state: '',
      zip: '',
      service_radius_miles: 25,
      skills: [],
      ...initial.me,
    },
    onboarding: {
      step: 'welcome',
      step_number: 1,
      trade_count: 0,
      stripe_ready: false,
      show_soft_stripe_prompt: false,
      ...initial.onboarding,
    },
    patches: 0,
  };

  await page.route('**/api/projects/contractors/me/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.me),
    })
  );
  await page.route('**/api/projects/contractors/onboarding/', async (route) => {
    if (route.request().method() === 'PATCH') {
      state.patches += 1;
      const payload = route.request().postDataJSON();
      state.me = { ...state.me, ...payload };
      state.onboarding = {
        ...state.onboarding,
        step: payload.contractor_onboarding_step || state.onboarding.step,
        step_number:
          payload.contractor_onboarding_step === 'region' ? 2 : 1,
        trade_count: payload.skills?.length || 0,
      };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.onboarding),
    });
  });
  await page.route('**/api/payments/onboarding/status/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        connected: false,
        onboarding_status: 'not_started',
      }),
    })
  );

  return state;
}

test('Step 1 has one clear hierarchy and a live setup checklist', async ({
  page,
}) => {
  await installEntryOnboardingRoutes(page);
  await page.goto('/onboarding');

  await expect(
    page.getByRole('heading', { name: 'Set up your contractor profile' })
  ).toBeVisible();
  await expect(
    page.getByTestId('contractor-onboarding-step-indicator')
  ).toHaveCount(1);
  await expect(page.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '1'
  );
  await expect(
    page.getByRole('heading', { name: 'Setup checklist' })
  ).toHaveCount(1);
  await expect(page.getByText('Activation Snapshot')).toHaveCount(0);
  await expect(page.getByText('What comes next')).toHaveCount(0);
  await expect(page.getByText('Progress so far')).toHaveCount(0);

  const businessName = page.getByTestId(
    'contractor-onboarding-business-name'
  );
  const servicesHeading = page.getByRole('heading', {
    name: 'Services you offer',
  });
  await expect(businessName).toHaveValue('MyHomeBro QA Contractor');
  expect(
    await businessName.evaluate(
      (input, heading) =>
        input.getBoundingClientRect().top <
        heading.getBoundingClientRect().top,
      await servicesHeading.elementHandle()
    )
  ).toBe(true);

  await businessName.fill('Calm Contractor Co.');
  await expect(page.getByTestId('contractor-onboarding-summary')).toContainText(
    'Calm Contractor Co.'
  );
  await expect(
    page.getByTestId('contractor-onboarding-save-basics')
  ).toBeDisabled();
  await expect(
    page.getByText('Select at least one service to continue.')
  ).toBeVisible();
});

test('service selection is deduplicated, searchable, removable, and keyboard accessible', async ({
  page,
}) => {
  await installEntryOnboardingRoutes(page);
  await page.goto('/onboarding');

  const popularService = page.getByRole('button', {
    name: 'General Contractor',
    exact: true,
  });
  await popularService.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByTestId('contractor-onboarding-trade-chip-general-contractor')
  ).toBeVisible();
  await expect(
    page.getByTestId('contractor-onboarding-trade-count')
  ).toHaveText('1 service selected');

  await page
    .getByTestId('contractor-onboarding-trade-search')
    .fill('tile');
  const tileResult = page.getByTestId(
    'contractor-onboarding-trade-option-tile'
  );
  await tileResult.click();
  await expect(
    page.getByTestId('contractor-onboarding-trade-chip-tile')
  ).toHaveCount(1);
  await expect(tileResult).toHaveCount(0);
  await expect(
    page.getByTestId('contractor-onboarding-trade-count')
  ).toHaveText('2 services selected');

  await page.getByRole('button', { name: 'Remove Tile' }).click();
  await expect(
    page.getByTestId('contractor-onboarding-trade-chip-tile')
  ).toHaveCount(0);
  await page.getByTestId('contractor-onboarding-trade-search').clear();
  await expect(
    page.getByTestId('contractor-onboarding-trade-option-tile')
  ).toBeVisible();
});

test('Continue saves once, advances to Step 2, and refresh preserves state', async ({
  page,
}) => {
  const state = await installEntryOnboardingRoutes(page);
  await page.goto('/onboarding');
  await page
    .getByTestId('contractor-onboarding-business-name')
    .fill('Persisted Contractor');
  await page
    .getByRole('button', { name: 'General Contractor', exact: true })
    .click();

  await page.getByTestId('contractor-onboarding-save-basics').click();
  await expect(page.getByTestId('contractor-onboarding-region')).toBeVisible();
  expect(state.patches).toBe(1);
  expect(state.me.business_name).toBe('Persisted Contractor');
  expect(state.me.skills).toEqual(['General Contractor']);
  await expect(page.getByText('Payments not connected')).toBeVisible();
  await page.screenshot({
    path: 'test-results/onboarding-step2-desktop.png',
    fullPage: true,
  });

  await page.reload();
  await expect(page.getByTestId('contractor-onboarding-region')).toBeVisible();
  await expect(
    page.getByTestId('contractor-onboarding-step-indicator')
  ).toHaveText('Step 2 of 3');
});

for (const { width, height, name } of [
  { width: 1440, height: 1000, name: 'desktop' },
  { width: 900, height: 1000, name: 'tablet' },
  { width: 390, height: 844, name: 'mobile' },
]) {
  test(`Step 1 is usable without document overflow on ${name}`, async ({
    page,
  }) => {
    await installEntryOnboardingRoutes(page);
    await page.setViewportSize({ width, height });
    await page.goto('/onboarding');
    await expect(page.getByTestId('contractor-onboarding-page')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: `test-results/onboarding-step1-${name}.png`,
      fullPage: true,
    });
  });
}
