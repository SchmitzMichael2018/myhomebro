import { expect, test } from '@playwright/test';

const key = 'mhb-public-planning-draft-v1';
const task = {
  client_id: 'task-1',
  title: 'Confirm vanity dimensions',
  description: 'Measure before ordering.',
  participation_type: 'DO_IT_MYSELF',
  professional_review_recommended: false,
  reason: 'Verify fit.',
  estimated_duration: '',
  estimated_cost: null,
  prerequisite_notes: '',
};
const proposal = {
  summary: 'Measure and plan the vanity replacement.',
  limitations: 'Planning guidance only.',
  source: 'Project Assistant',
  questions: [],
  warnings: [],
  assumptions: [],
  phases: [
    { client_id: 'phase-1', title: 'Plan', description: '', tasks: [task] },
  ],
};
const inputs = {
  title: 'Bathroom vanity',
  desired_outcome: 'Replace the bathroom vanity.',
  existing_conditions: '',
  additional_context: '',
  confidence_notes: '',
};
const project = {
  id: '11111111-1111-4111-8111-111111111111',
  ...inputs,
  status: 'planning',
  status_label: 'Planning',
  category: 'bathroom',
  area: '',
  task_count: 1,
  completed_task_count: 0,
  progress_percent: 0,
  updated_at: '2026-11-07T00:00:00Z',
  phases: [
    {
      id: 1,
      title: 'Plan',
      description: '',
      tasks: [
        {
          id: 1,
          ...task,
          status: 'not_started',
          status_label: 'Not Started',
          participation_label: 'Doing Myself',
        },
      ],
    },
  ],
  measurements: [],
  assets: [],
  progress_entries: [],
  request_links: [],
};
const portal = {
  customer: { name: 'Test Homeowner', email: 'homeowner@example.com' },
  account: { email: 'homeowner@example.com', has_user: true },
  summary: {},
  property_profiles: [],
  requests: [],
  projects: [],
  agreements: [],
  invoices: [],
  payments: [],
  documents: [],
  bids: [],
  disputes: [],
  notifications: [],
};

async function setup(page, failFirst = false) {
  const draft = {
    version: 1,
    preview_token: 'signed-test-preview',
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    source_template_id: 101,
    inputs,
    proposal,
    guide_path: '/improvements/bathroom/replace-bathroom-vanity/',
  };
  await page.addInitScript(
    ({ key, draft }) => sessionStorage.setItem(key, JSON.stringify(draft)),
    { key, draft }
  );
  let saves = 0;
  const bodies = [];
  await page.route(
    '**/api/projects/customer-portal/customer-token/**',
    async (route) => {
      const request = route.request();
      if (
        request.url().endsWith('/diy-projects/') &&
        request.method() === 'POST'
      ) {
        saves += 1;
        bodies.push(request.postDataJSON());
        if (failFirst && saves === 1)
          return route.fulfill({
            status: 503,
            json: { detail: 'Temporary save failure. Please retry.' },
          });
        return route.fulfill({ status: 201, json: project });
      }
      if (request.url().endsWith('/diy-projects/'))
        return route.fulfill({ json: { projects: [] } });
      if (request.url().includes(`/diy-projects/${project.id}/`))
        return route.fulfill({ json: project });
      return route.fulfill({ json: portal });
    }
  );
  await page.goto(
    '/portal/customer-token?workspace=diy-planner&action=create&planning_draft=1'
  );
  return { bodies, saves: () => saves };
}

test('saving a reviewed guide plan is explicit and offers DIY or professional help', async ({
  page,
}) => {
  const calls = await setup(page);
  await expect(page.getByTestId('diy-public-plan-review')).toBeVisible();
  expect(calls.saves()).toBe(0);
  await page.getByTestId('diy-public-plan-save').click();
  await expect(page.getByTestId('diy-public-plan-saved')).toBeVisible();
  expect(calls.bodies).toEqual([
    { preview_token: 'signed-test-preview', confirm: true },
  ]);
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), key)
  ).toBeNull();
  await expect(page).toHaveURL(/project=11111111/);
  await page
    .getByRole('button', { name: 'Explore professional help', exact: true })
    .click();
  await expect(page.getByTestId('diy-help-create-draft')).toBeVisible();
  expect(calls.saves()).toBe(1);
});

test('failed save keeps the reviewed plan available for retry', async ({
  page,
}) => {
  const calls = await setup(page, true);
  await page.getByTestId('diy-public-plan-save').click();
  await expect(page.getByRole('alert')).toContainText('Temporary save failure');
  await expect(page.getByTestId('diy-public-plan-review')).toBeVisible();
  expect(
    await page.evaluate((key) => Boolean(sessionStorage.getItem(key)), key)
  ).toBe(true);
  await page.getByTestId('diy-public-plan-save').click();
  await expect(page.getByTestId('diy-public-plan-saved')).toBeVisible();
  expect(calls.saves()).toBe(2);
});

test('email verification in another tab points back to the original private plan', async ({ page, context }) => {
  await setup(page);
  await context.route('**/api/accounts/auth/verification/status/', (route) => route.fulfill({ json: { email_verified: true, phone_verified: true, role: 'customer', continuation: '/portal?workspace=diy-planner&action=create&planning_draft=1' } }));
  const verificationTab = await context.newPage();
  await verificationTab.goto('/verify-account?verification_session=mock-session');
  await expect(verificationTab.getByTestId('planning-return-original-tab')).toBeVisible();
  await expect(verificationTab.getByTestId('verification-resume')).toHaveAttribute('href', '/portal');
  await page.goto('/verify-account?verification_session=mock-session');
  await expect(page.getByTestId('verification-resume')).toHaveAttribute('href', '/portal?workspace=diy-planner&action=create&planning_draft=1');
  await expect(page.getByTestId('verification-resume')).toHaveText('Sign in and save your plan');
});
