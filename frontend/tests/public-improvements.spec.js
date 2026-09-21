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
  await expect
    .poll(() =>
      page
        .locator('script[data-seo-structured-data]')
        .evaluate((node) => node.textContent)
    )
    .toContain('BreadcrumbList');
});

test('improvement CTAs remain usable on a mobile viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockImprovementApi(page);
  await page.goto(improvement.canonical_path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('diy-this-project')).toBeVisible();
  await expect(page.getByTestId('get-contractor-help')).toBeVisible();
  await expect(page.getByTestId('improvement-breadcrumbs')).toBeVisible();
});
