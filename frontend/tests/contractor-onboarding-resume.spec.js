import { expect, test } from '@playwright/test';

async function installAuthRoutes(page, onboardingState) {
  const profile = {
    id: 77,
    business_name: onboardingState.business_name || '',
    city: onboardingState.city || '',
    state: onboardingState.state || '',
    zip: '',
    service_radius_miles: 25,
    skills: onboardingState.skills || [],
    onboarding: onboardingState,
    contractor_onboarding_status: onboardingState.status,
    contractor_onboarding_step: onboardingState.step,
  };

  await page.route('**/api/auth/login/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access: 'contractor-access',
        refresh: 'contractor-refresh',
        user: { email: 'resume@example.com' },
      }),
    })
  );
  await page.route('**/api/projects/whoami/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'contractor',
        role: 'contractor_owner',
        identity_type: 'contractor_owner',
      }),
    })
  );
  await page.route('**/api/projects/contractors/onboarding/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(onboardingState),
    })
  );
  await page.route('**/api/projects/contractors/me/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(profile),
    })
  );
  await page.route('**/api/payments/onboarding/status/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ connected: false, onboarding_status: 'not_started' }),
    })
  );
}

async function contractorLogin(page) {
  await page.goto('/');
  await page.getByTestId('landing-sign-in-button').click();
  await page
    .getByRole('menu', { name: 'Log in options' })
    .getByRole('button', { name: 'Contractor Log In', exact: true })
    .click();
  const modal = page.getByTestId('login-modal');
  await modal.getByTestId('login-email-input').fill('resume@example.com');
  await modal.getByTestId('login-password-input').fill('Secret123!');
  await modal.getByRole('button', { name: 'Sign In' }).click();
}

test('incomplete contractor login resumes canonical Step 1 without a dashboard flash', async ({
  page,
}) => {
  await installAuthRoutes(page, {
    required_onboarding_complete: false,
    profile_basics_complete: false,
    status: 'not_started',
    step: 'welcome',
    step_number: 1,
    business_name: '',
    trade_count: 0,
    service_region_label: '',
    skills: [],
  });
  const dashboardResponses = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/projects/milestones/')) {
      dashboardResponses.push(response.url());
    }
  });

  await contractorLogin(page);

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByTestId('contractor-onboarding-trades')).toBeVisible();
  await expect(
    page.getByTestId('contractor-onboarding-business-name')
  ).toHaveValue('');
  expect(dashboardResponses).toEqual([]);
});

test('saved Step 1 progress resumes Step 2 and survives refresh', async ({
  page,
}) => {
  await installAuthRoutes(page, {
    required_onboarding_complete: false,
    profile_basics_complete: false,
    status: 'not_started',
    step: 'region',
    step_number: 2,
    business_name: 'Saved Contractor',
    trade_count: 1,
    service_region_label: '',
    skills: ['Electrical'],
  });

  await contractorLogin(page);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByTestId('contractor-onboarding-region')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('contractor-onboarding-region')).toBeVisible();
  await expect(
    page.getByTestId('contractor-onboarding-step-indicator')
  ).toHaveText('Step 2 of 3');
});

test('required-complete contractor enters dashboard and does not see duplicate required questions', async ({
  page,
}) => {
  await installAuthRoutes(page, {
    required_onboarding_complete: true,
    profile_basics_complete: true,
    status: 'in_progress',
    step: 'stripe',
    step_number: 3,
    business_name: 'Complete Contractor',
    trade_count: 1,
    service_region_label: 'Chicago, IL',
    skills: ['Electrical'],
  });

  await contractorLogin(page);
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await expect(page.getByPlaceholder('Your business name')).toHaveCount(0);
  await expect(page.getByText('Which trades do you offer?')).toHaveCount(0);
});

test('direct dashboard access fails closed and offers retry when onboarding state cannot load', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'contractor-access');
  });
  await page.route('**/api/projects/whoami/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ type: 'contractor', role: 'contractor_owner' }),
    })
  );
  await page.route('**/api/projects/contractors/onboarding/', (route) =>
    route.fulfill({ status: 503, body: '{}' })
  );

  await page.goto('/app/dashboard');

  await expect(
    page.getByRole('heading', {
      name: 'We couldn’t verify your setup progress',
    })
  ).toBeVisible();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});
