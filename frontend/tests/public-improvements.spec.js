import { expect, test } from '@playwright/test';

const improvement = {
  id: 101,
  slug: 'replace-bathroom-vanity',
  category_slug: 'bathroom',
  category_name: 'Bathroom',
  title: 'Replace Bathroom Vanity',
  summary: 'A reviewed summary of the existing project template.',
  intro:
    'Understand the existing scope before deciding how to complete the work.',
  scope: 'Protect the area and complete the reviewed template milestones.',
  difficulty: 'intermediate',
  difficulty_label: 'Intermediate',
  estimated_duration_min_days: 1,
  estimated_duration_max_days: 2,
  cost_guidance: '',
  tools_guidance:
    'Plan for measuring, leveling, fastening, and plumbing tools appropriate to the work.',
  preparation: 'Confirm measurements and protect adjacent finishes.',
  safety_guidance:
    'Follow manufacturer instructions and stop when professional work is required.',
  common_mistakes: '',
  diy_guidance: 'Use the reviewed project scope and know your limits.',
  pro_guidance:
    'Get professional help when plumbing changes exceed your experience.',
  materials: 'Use materials specified by the reviewed project template.',
  faqs: [],
  milestones: [
    {
      id: 1,
      title: 'Prepare',
      description: 'Protect the work area.',
      materials: '',
      duration_days: 1,
      optional: false,
    },
  ],
  related: [],
  reviewed_at: '2026-09-21T12:00:00Z',
  canonical_path: '/improvements/bathroom/replace-bathroom-vanity/',
  seo_title: 'Replace a Bathroom Vanity: DIY & Project Guide | MyHomeBro',
  seo_description:
    'Review the project scope and choose whether to DIY or get contractor help.',
  social_image: '/static/social/myhomebro-default-1200x630.png',
};

async function mockImprovementApi(page) {
  await page.route('**/api/projects/attribution/track/', (route) =>
    route.fulfill({ status: 201, json: { recorded: true } })
  );
  await page.route('**/api/projects/public/improvements/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/bathroom/replace-bathroom-vanity/')) {
      return route.fulfill({ status: 200, json: improvement });
    }
    if (pathname.endsWith('/bathroom/')) {
      return route.fulfill({
        status: 200,
        json: {
          slug: 'bathroom',
          name: 'Bathroom',
          improvements: [improvement],
        },
      });
    }
    return route.fulfill({
      status: 200,
      json: {
        categories: [{ slug: 'bathroom', name: 'Bathroom', count: 1 }],
        published_count: 1,
        improvements: [improvement],
      },
    });
  });
}

test('public library search, category, breadcrumbs, metadata, and CTAs work', async ({
  page,
}) => {
  await mockImprovementApi(page);
  await page.goto('/improvements/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Plan your next home project.'
  );
  await expect(page.getByRole('button', { name: /Contractors/ })).toBeVisible();
  await page.screenshot({
    path: 'test-results/improvement-library-desktop.png',
    fullPage: true,
  });
  await page.getByTestId('improvement-search').fill('vanity');
  await expect(
    page.getByRole('link', { name: 'Replace Bathroom Vanity' })
  ).toBeVisible();
  await page.getByRole('link', { name: 'Replace Bathroom Vanity' }).click();
  await expect(page.getByTestId('improvement-breadcrumbs')).toContainText(
    'Bathroom'
  );
  await expect(page).toHaveTitle(
    'Replace a Bathroom Vanity: DIY & Project Guide | MyHomeBro'
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `https://www.myhomebro.com${improvement.canonical_path}`
  );
  await expect(page.getByTestId('diy-this-project')).toBeVisible();
  await expect(page.getByTestId('get-contractor-help')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Tools to plan for' })
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('script[data-seo-structured-data]')
        .evaluate((node) => node.textContent)
    )
    .toContain('BreadcrumbList');
});

test('launch empty state is purposeful before any search', async ({ page }) => {
  await page.route('**/api/projects/public/improvements/**', (route) =>
    route.fulfill({
      status: 200,
      json: { categories: [], published_count: 0, improvements: [] },
    })
  );
  await page.goto('/improvements/');
  await expect(page.getByText('The library is getting ready.')).toBeVisible();
  const startProject = page.getByRole('link', {
    name: 'Start a project',
    exact: true,
  });
  await expect(startProject).toHaveCSS('color', 'rgb(255, 255, 255)');
  await startProject.hover();
  await expect(startProject).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(
    page.getByText('No published improvements match this search')
  ).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex, follow'
  );
});

test('editorial contractor guide shows source, distinct Our take, and contextual signup', async ({
  page,
}) => {
  await page.route('**/api/projects/attribution/track/', (route) =>
    route.fulfill({ status: 201, json: {} })
  );
  await page.route(
    '**/api/projects/public/improvements/contractor-practice/payment-plan/',
    (route) =>
      route.fulfill({
        status: 200,
        json: {
          ...improvement,
          slug: 'payment-plan',
          category_slug: 'contractor-practice',
          category_name: 'Contractor Practice',
          canonical_path: '/improvements/contractor-practice/payment-plan/',
          audience: 'contractor',
          audience_label: 'Contractors',
          problem: 'Payment timing is unclear.',
          evidence: 'FTC consumer guidance supports written contracts.',
          evidence_source:
            'https://consumer.ftc.gov/articles/how-avoid-home-improvement-scam',
          viewpoint: 'Agree on milestones before work begins.',
          practical_steps: '1. Define work.\n2. Set review steps.',
          next_action: 'sign_up',
        },
      })
  );
  await page.goto(
    '/improvements/contractor-practice/payment-plan/?utm_source=guide'
  );
  await expect(page.getByRole('heading', { name: 'Our take' })).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Define work.' })
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Read the source/ })
  ).toHaveAttribute(
    'href',
    'https://consumer.ftc.gov/articles/how-avoid-home-improvement-scam'
  );
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page).toHaveURL(/\/signup\?[^#]*source=improvement_library/);
  await expect(page).toHaveURL(/utm_source=guide/);
  await expect(page).toHaveURL(/next=/);
  await expect(page).toHaveURL(/cta=sign_up/);
  const signupUrl = new URL(page.url());
  const continuation = new URL(
    signupUrl.searchParams.get('next'),
    signupUrl.origin
  );
  expect(continuation.pathname).toBe(
    '/improvements/contractor-practice/payment-plan/'
  );
  expect(continuation.searchParams.get('article')).toBe('payment-plan');
  expect(continuation.searchParams.get('cta')).toBe('sign_up');
  expect(continuation.searchParams.get('utm_source')).toBe('guide');
});

test('improvement CTAs remain usable on a mobile viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockImprovementApi(page);
  await page.goto('/improvements/');
  await expect(
    page.getByRole('heading', { name: 'Guidance for the role you play' })
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  ).toBe(false);
  await page.screenshot({
    path: 'test-results/improvement-library-mobile.png',
    fullPage: true,
  });
  await page.goto(improvement.canonical_path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.screenshot({
    path: 'test-results/improvement-article-mobile.png',
    fullPage: true,
  });
  await expect(page.getByTestId('diy-this-project')).toBeVisible();
  await expect(page.getByTestId('get-contractor-help')).toBeVisible();
  await expect(page.getByTestId('improvement-breadcrumbs')).toBeVisible();
});
