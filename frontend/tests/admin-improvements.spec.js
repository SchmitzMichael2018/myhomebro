import { expect, test } from '@playwright/test';

const article = {
  id: 42,
  slug: 'contractor-payment-plan',
  public_slug: 'contractor-payment-plan',
  category_slug: 'contractor-practice',
  public_category_slug: 'contractor-practice',
  category_name: 'Contractor Practice',
  title: 'The job is done. Where’s the payment?',
  public_title: 'The job is done. Where’s the payment?',
  summary: 'Plan the review and payment conversation before the work begins.',
  public_summary:
    'Plan the review and payment conversation before the work begins.',
  audience_label: 'Contractors',
  public_audience: 'contractor',
  problem: 'The job can be done while payment expectations remain unclear.',
  public_problem:
    'The job can be done while payment expectations remain unclear.',
  evidence: 'The FTC recommends a written contract.',
  public_evidence: 'The FTC recommends a written contract.',
  evidence_source:
    'https://consumer.ftc.gov/articles/how-avoid-home-improvement-scam',
  public_evidence_source:
    'https://consumer.ftc.gov/articles/how-avoid-home-improvement-scam',
  viewpoint: 'Agree on deliverables and review steps before work starts.',
  public_viewpoint:
    'Agree on deliverables and review steps before work starts.',
  practical_steps: '1. Define the scope.\n2. Set review steps.',
  public_practical_steps: '1. Define the scope.\n2. Set review steps.',
  next_action: 'sign_up',
  public_next_action: 'sign_up',
  seo_title: 'The job is done. Where’s the payment? | MyHomeBro',
  seo_description: 'A practical contractor guide.',
  is_featured_public: true,
  related_ids: [],
  related: [],
  faqs: [],
  milestones: [],
  publication_status: 'draft',
  canonical_path: '/improvements/contractor-practice/contractor-payment-plan/',
  social_image: '/static/social/myhomebro-default-1200x630.png',
  preview_path: '/app/admin/improvements/preview/contractor-payment-plan',
};

async function setup(page) {
  await page.addInitScript(() =>
    localStorage.setItem('access', 'synthetic-admin-token')
  );
  await page.route('**/api/projects/whoami/', (route) =>
    route.fulfill({
      status: 200,
      json: { id: 1, type: 'admin', role: 'admin' },
    })
  );
  await page.route('**/api/projects/admin/improvements/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/admin/improvements/'))
      return route.fulfill({ status: 200, json: { results: [article] } });
    if (url.pathname.includes('/preview/'))
      return route.fulfill({ status: 200, json: article });
    if (route.request().method() === 'PATCH')
      return route.fulfill({ status: 200, json: article });
    return route.fulfill({ status: 200, json: article });
  });
}

test('admin can edit editorial sections and preview an unpublished article', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 2500 });
  await setup(page);
  await page.goto('/app/admin/improvements/42');
  await expect(
    page.getByRole('heading', { name: 'Improvement Library' })
  ).toBeVisible();
  await expect(
    page.getByLabel('3. MyHomeBro viewpoint — Our take')
  ).toHaveValue(article.public_viewpoint);
  await page
    .getByLabel('3. MyHomeBro viewpoint — Our take')
    .fill('Revised MyHomeBro perspective.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByRole('link', { name: 'Preview design' }).click();
  await expect(page.getByText('Editorial preview · draft.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Our take' })).toBeVisible();
  await expect(page.getByTestId('contractor-visual-example')).toContainText('How one milestone moves forward');
  await expect(page.getByTestId('walkthrough-placement')).toContainText('No walkthrough video is attached');
  await expect(page.getByTestId('walkthrough-video')).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex, nofollow'
  );
  await page.locator('article').screenshot({
    path: 'test-results/improvement-contractor-preview-desktop.png',
  });
});

test('contractor article preview remains readable at 390px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 3300 });
  await setup(page);
  await page.goto(article.preview_path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Practical steps' })
  ).toBeVisible();
  await expect(page.getByTestId('walkthrough-placement')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(overflow).toBe(false);
  await page.locator('article').screenshot({
    path: 'test-results/improvement-contractor-preview-mobile.png',
  });
});

test('reviewed walkthrough renders play, poster, and text alternative', async ({ page }) => {
  await setup(page);
  await page.route('**/api/projects/admin/improvements/preview/**', (route) =>
    route.fulfill({ status: 200, json: {
      ...article,
      video: {
        url: 'https://example.com/watch',
        title: 'Plan the payment conversation',
        description: 'A synthetic project walkthrough.',
        poster_url: 'https://example.com/poster.jpg',
        text_summary: 'Define scope, set milestones, document work, review, then determine the outcome.',
        transcript_url: 'https://example.com/transcript',
      },
    } })
  );
  await page.goto(article.preview_path);
  await expect(page.getByTestId('walkthrough-video')).toBeVisible();
  await expect(page.getByTestId('walkthrough-placement')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Play walkthrough/ })).toHaveAttribute('href', 'https://example.com/watch');
  await expect(page.getByRole('link', { name: /Read the transcript/ })).toHaveAttribute('href', 'https://example.com/transcript');
  await expect(page.getByTestId('walkthrough-video')).toContainText('Text summary:');
});

test('published article without a video has no walkthrough or editorial placeholder', async ({ page }) => {
  await page.route('**/api/projects/public/improvements/contractor-practice/contractor-payment-plan/', (route) =>
    route.fulfill({ status: 200, json: { ...article, publication_status: 'published', video: null } })
  );
  await page.goto(article.canonical_path);
  await expect(page.getByRole('heading', { level: 1, name: article.title })).toBeVisible();
  await expect(page.getByTestId('contractor-visual-example')).toBeVisible();
  await expect(page.getByTestId('walkthrough-video')).toHaveCount(0);
  await expect(page.getByTestId('walkthrough-placement')).toHaveCount(0);
});

test('staff can enter video metadata without publishing', async ({ page }) => {
  await setup(page);
  let saved = null;
  await page.route('**/api/projects/admin/improvements/42/', (route) => {
    if (route.request().method() === 'PATCH') saved = route.request().postDataJSON();
    return route.fulfill({ status: 200, json: article });
  });
  await page.goto('/app/admin/improvements/42');
  await page.getByLabel('Video URL (HTTPS)').fill('https://example.com/watch');
  await page.getByLabel('Video title').fill('Plan one milestone');
  await page.getByLabel('Short video description').fill('A short synthetic walkthrough.');
  await page.getByLabel('Thumbnail or poster image URL (HTTPS)').fill('https://example.com/poster.jpg');
  await page.getByLabel('Text summary').fill('Scope, milestones, proof, review, and outcome.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  expect(saved).toMatchObject({
    public_video_url: 'https://example.com/watch',
    public_video_title: 'Plan one milestone',
    public_video_poster_url: 'https://example.com/poster.jpg',
    public_video_text_summary: 'Scope, milestones, proof, review, and outcome.',
  });
  await expect(page.getByText('Status: Draft')).toBeVisible();
});

test('staff can filter statuses and review an AI rewrite before inserting or saving', async ({
  page,
}) => {
  await setup(page);
  let saves = 0;
  let transitions = 0;
  await page.route('**/api/projects/admin/improvements/42/', (route) => {
    if (route.request().method() === 'PATCH') saves += 1;
    return route.fulfill({ status: 200, json: article });
  });
  await page.route('**/api/projects/admin/improvements/42/*/', (route) => {
    transitions += 1;
    return route.fulfill({ status: 200, json: article });
  });
  await page.route('**/api/projects/admin/improvements/assist/', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      mode: 'rewrite',
      section: 'public_problem',
      article: {
        public_audience: 'contractor',
        public_evidence_source: article.public_evidence_source,
      },
    });
    return route.fulfill({
      status: 200,
      json: {
        proposal: { public_problem: 'A clearer synthetic problem.' },
        saved: false,
      },
    });
  });
  await page.goto('/app/admin/improvements/42');
  await expect(
    page.getByRole('link', { name: /The job is done/ })
  ).toBeVisible();
  await page.getByLabel('Filter by status').selectOption('published');
  await expect(page.getByText('No articles in this status.')).toBeVisible();
  await page.getByLabel('Filter by status').selectOption('draft');
  await page.getByRole('button', { name: 'Rewrite selected section' }).click();
  await expect(page.getByTestId('editorial-ai-proposal')).toBeVisible();
  await expect(page.getByLabel('1. Recognizable problem')).toHaveValue(
    article.public_problem
  );
  await page
    .getByTestId('editorial-ai-proposal')
    .getByLabel('Problem')
    .fill('A staff-edited synthetic problem.');
  expect(saves).toBe(0);
  await page.getByRole('button', { name: 'Insert into editor' }).click();
  await expect(page.getByLabel('1. Recognizable problem')).toHaveValue(
    'A staff-edited synthetic problem.'
  );
  await expect(
    page.getByRole('button', { name: 'Submit for review' })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Save draft' }).click();
  expect(saves).toBe(1);
  expect(transitions).toBe(0);
});

test('outline and draft proposals remain unsaved until staff accepts them', async ({
  page,
}) => {
  await setup(page);
  const requestedModes = [];
  await page.route('**/api/projects/admin/improvements/assist/', (route) => {
    const { mode } = route.request().postDataJSON();
    requestedModes.push(mode);
    const proposal =
      mode === 'outline'
        ? {
            public_practical_steps:
              '- Discuss the scope.\n- Agree on review steps.',
          }
        : {
            public_summary: 'Synthetic draft summary.',
            public_problem: 'Synthetic draft problem.',
            public_viewpoint: 'Synthetic draft viewpoint.',
            public_practical_steps: '- Agree on review steps.',
          };
    return route.fulfill({ status: 200, json: { proposal, saved: false } });
  });
  await page.goto('/app/admin/improvements/42');
  await page.getByRole('button', { name: 'Generate outline' }).click();
  await expect(page.getByTestId('editorial-ai-proposal')).toBeVisible();
  await expect(page.getByLabel('4. Practical steps')).toHaveValue(
    article.public_practical_steps
  );
  await page.getByRole('button', { name: 'Discard proposal' }).click();
  await page.getByRole('button', { name: 'Generate article draft' }).click();
  await expect(page.getByTestId('editorial-ai-proposal')).toBeVisible();
  await expect(page.getByLabel('1. Recognizable problem')).toHaveValue(
    article.public_problem
  );
  await page.getByRole('button', { name: 'Insert into editor' }).click();
  await expect(page.getByLabel('1. Recognizable problem')).toHaveValue(
    'Synthetic draft problem.'
  );
  await expect(
    page.getByRole('button', { name: 'Submit for review' })
  ).toBeDisabled();
  expect(requestedModes).toEqual(['outline', 'draft']);
});
