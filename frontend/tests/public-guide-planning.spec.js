import { expect, test } from '@playwright/test';

const guidePath = '/improvements/bathroom/replace-bathroom-vanity/';
const draftKey = 'mhb-public-planning-draft-v1';
const guide = {
  id: 101,
  slug: 'replace-bathroom-vanity',
  category_slug: 'bathroom',
  category_name: 'Bathroom',
  title: 'Replace Bathroom Vanity',
  summary: 'Review this project before choosing how to complete it.',
  canonical_path: guidePath,
  seo_title: 'Bathroom vanity guide | MyHomeBro',
  seo_description: 'Review the scope and plan your project.',
  social_image: '/static/social/myhomebro-default-1200x630.png',
  faqs: [],
  milestones: [],
  related: [],
  sections: [],
};
const proposal = {
  summary: 'Measure and inspect before replacing this vanity.',
  limitations:
    'Planning guidance only, not a code, permit, engineering, or safety determination.',
  source: 'Project Assistant',
  questions: [
    { id: 'q1', question: 'Are the existing shutoff valves accessible?' },
  ],
  warnings: [
    {
      level: 'professional_review',
      message: 'Have a qualified professional assess plumbing changes.',
    },
  ],
  assumptions: ['The fixture layout is unchanged.'],
  phases: [
    {
      client_id: 'phase-1',
      title: 'Prepare and inspect',
      description: 'Confirm site conditions.',
      tasks: [
        {
          client_id: 'task-1',
          title: 'Verify vanity clearances',
          description: 'Record opening and fixture dimensions.',
          participation_type: 'DO_IT_MYSELF',
          professional_review_recommended: true,
          reason: 'Confirm the fixture will fit.',
          estimated_duration: 'One planning session',
          estimated_cost: null,
          prerequisite_notes: 'Stop if conditions are uncertain.',
        },
      ],
    },
  ],
};
function preview(inputs) {
  return {
    inputs,
    proposal,
    preview_token: 'signed-preview-token',
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    source_template_id: guide.id,
  };
}
async function setup(page, { planHandler, guideHandler } = {}) {
  const requests = [];
  await page.route('**/api/projects/attribution/track/', (r) =>
    r.fulfill({ status: 201, json: {} })
  );
  await page.route('**/api/projects/public/improvements/**', async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/plan/')) {
      requests.push(route.request().postDataJSON());
      if (planHandler) return planHandler(route, requests);
      return route.fulfill({ json: preview(requests.at(-1)) });
    }
    if (guideHandler) return guideHandler(route);
    return route.fulfill({ json: guide });
  });
  return requests;
}
async function fillQuestions(page) {
  await page
    .getByRole('textbox', { name: /What do you want to change/ })
    .fill('Replace a 36-inch vanity without moving plumbing.');
  await page
    .getByRole('textbox', { name: /What is there now/ })
    .fill('Existing cabinet with accessible shutoffs.');
}
async function prepare(page) {
  await fillQuestions(page);
  await page.getByTestId('prepare-public-plan').click();
  await expect(page.getByTestId('public-plan-preview')).toBeVisible();
}

test('published guide previews a plan and only hands off after Save', async ({
  page,
}) => {
  const requests = await setup(page);
  await page.goto(`${guidePath}?utm_source=san-antonio`);
  await expect(page.getByTestId('diy-this-project')).toBeVisible();
  await expect(page.getByTestId('get-contractor-help')).toBeVisible();
  await page.getByTestId('plan-this-project').click();
  await expect(page).toHaveURL(/\/plan\?utm_source=san-antonio$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex, follow'
  );
  await prepare(page);
  expect(requests).toHaveLength(1);
  await expect(
    page.getByRole('heading', { name: 'Professional review', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '1. Prepare and inspect' })
  ).toBeVisible();
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), draftKey)
  ).toBeNull();
  await page.getByTestId('save-public-plan').click();
  await expect(page).toHaveURL(/\/create-account\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get('next')).toBe(
    '/portal?workspace=diy-planner&action=create&planning_draft=1'
  );
  expect(url.searchParams.get('role')).toBe('customer');
  expect(url.searchParams.get('utm_source')).toBe('san-antonio');
  const saved = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)),
    draftKey
  );
  expect(saved.preview_token).toBe('signed-preview-token');
  expect(saved.inputs.desired_outcome).toContain('36-inch vanity');
  await page.goBack();
  await expect(page.getByTestId('public-plan-preview')).toBeVisible();
  expect(requests).toHaveLength(1);
});

test('edits and follow-up answers require regeneration; discard retains input', async ({
  page,
}) => {
  const requests = await setup(page);
  await page.goto(`${guidePath}plan`);
  await prepare(page);
  await page
    .getByRole('textbox', { name: /Are the existing shutoff/ })
    .fill('Yes, both are accessible.');
  await expect(page.getByTestId('save-public-plan')).toBeDisabled();
  await expect(
    page.getByText('Your answers have changed.', { exact: false })
  ).toBeVisible();
  await page.getByTestId('prepare-public-plan').click();
  await expect(page.getByTestId('save-public-plan')).toBeEnabled();
  expect(requests[1].additional_context).toContain('Yes, both are accessible.');
  await page.getByRole('button', { name: 'Edit project answers' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Project name' })
  ).toBeFocused();
  await page
    .getByRole('textbox', { name: 'Project name' })
    .fill('Updated vanity project');
  await expect(page.getByTestId('save-public-plan')).toBeDisabled();
  await page.getByRole('button', { name: 'Discard suggested plan' }).click();
  await expect(page.getByTestId('public-plan-preview')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue(
    'Updated vanity project'
  );
});

test('plan errors preserve answers and retry without exposing raw failures', async ({
  page,
}) => {
  await setup(page, {
    planHandler: (route, requests) =>
      requests.length === 1
        ? route.fulfill({
            status: 503,
            json: { detail: 'private-provider-stack-trace' },
          })
        : route.fulfill({ json: preview(requests.at(-1)) }),
  });
  await page.goto(`${guidePath}plan`);
  await fillQuestions(page);
  await page.getByTestId('prepare-public-plan').click();
  await expect(page.getByRole('alert')).toContainText(
    'Your answers are still here'
  );
  await expect(page.getByText('private-provider-stack-trace')).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: /What do you want to change/ })
  ).toHaveValue(/36-inch/);
  await page.getByTestId('prepare-public-plan').click();
  await expect(page.getByTestId('public-plan-preview')).toBeVisible();
});

test('blocked storage keeps the page with copyable plan instead of navigating', async ({
  page,
}) => {
  await setup(page);
  await page.goto(`${guidePath}plan`);
  await prepare(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'mhb-public-planning-draft-v1')
        throw new Error('Storage disabled');
      return original.call(this, key, value);
    };
  });
  await page.getByTestId('save-public-plan').click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByRole('alert')).toContainText('nothing was saved');
  await expect(
    page.getByRole('textbox', { name: 'Select and copy this suggested plan' })
  ).toHaveValue(/Verify vanity clearances/);
  await expect(page.getByTestId('save-public-plan')).toBeEnabled();
});

test('pending preparation disables repeated submission and cancel ignores late results', async ({
  page,
}) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const requests = await setup(page, {
    planHandler: async (route, entries) => {
      if (entries.length === 1) await pending;
      await route.fulfill({ json: preview(entries.at(-1)) }).catch(() => {});
    },
  });
  await page.goto(`${guidePath}plan`);
  await fillQuestions(page);
  await page.getByTestId('prepare-public-plan').click();
  await expect(page.getByTestId('prepare-public-plan')).toBeDisabled();
  await expect.poll(() => requests.length).toBe(1);
  await page.getByRole('button', { name: 'Cancel preparation' }).click();
  release();
  await expect(
    page.getByText('Preparation cancelled. Your answers have not changed.')
  ).toBeVisible();
  await expect(page.getByTestId('public-plan-preview')).toHaveCount(0);
  await page.getByTestId('prepare-public-plan').click();
  await expect(page.getByTestId('public-plan-preview')).toBeVisible();
  expect(requests).toHaveLength(2);
});

test('guide failures resolve loading and can be retried', async ({ page }) => {
  let fail = true;
  await setup(page, {
    guideHandler: (route) =>
      fail
        ? route.fulfill({ status: 404, json: {} })
        : route.fulfill({ json: guide }),
  });
  await page.goto(guidePath);
  await expect(
    page.getByRole('heading', { name: 'Project guide unavailable' })
  ).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('plan-this-project')).toBeVisible();
  fail = true;
  await page.getByTestId('plan-this-project').click();
  await expect(
    page.getByRole('heading', { name: 'Project guide unavailable' })
  ).toBeVisible();
  await expect(page.getByTestId('public-planning-questions')).toHaveCount(0);
});

test('editorial guides do not produce public project previews', async ({
  page,
}) => {
  await setup(page, {
    guideHandler: (route) =>
      route.fulfill({ json: { ...guide, problem: 'An editorial article' } }),
  });
  await page.goto(`${guidePath}plan`);
  await expect(
    page.getByRole('heading', { name: 'This is an editorial guide' })
  ).toBeVisible();
  await expect(page.getByTestId('prepare-public-plan')).toHaveCount(0);
});

test('mobile plan remains inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto(`${guidePath}plan`);
  await prepare(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await expect(page.getByTestId('save-public-plan')).toBeVisible();
});
