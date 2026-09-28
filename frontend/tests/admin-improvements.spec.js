import { expect, test } from '@playwright/test';

const article = {
  id: 42, slug: 'contractor-payment-plan', public_slug: 'contractor-payment-plan',
  category_slug: 'contractor-practice', public_category_slug: 'contractor-practice', category_name: 'Contractor Practice',
  title: 'The job is done. Where’s the payment?', public_title: 'The job is done. Where’s the payment?',
  summary: 'Plan the review and payment conversation before the work begins.',
  public_summary: 'Plan the review and payment conversation before the work begins.',
  audience_label: 'Contractors', public_audience: 'contractor',
  problem: 'The job can be done while payment expectations remain unclear.',
  public_problem: 'The job can be done while payment expectations remain unclear.',
  evidence: 'The FTC recommends a written contract.', public_evidence: 'The FTC recommends a written contract.',
  evidence_source: 'https://consumer.ftc.gov/articles/how-avoid-home-improvement-scam',
  public_evidence_source: 'https://consumer.ftc.gov/articles/how-avoid-home-improvement-scam',
  viewpoint: 'Agree on deliverables and review steps before work starts.',
  public_viewpoint: 'Agree on deliverables and review steps before work starts.',
  practical_steps: '1. Define the scope.\n2. Set review steps.',
  public_practical_steps: '1. Define the scope.\n2. Set review steps.',
  next_action: 'sign_up', public_next_action: 'sign_up',
  seo_title: 'The job is done. Where’s the payment? | MyHomeBro',
  seo_description: 'A practical contractor guide.',
  is_featured_public: true, related_ids: [], related: [],
  faqs: [], milestones: [], publication_status: 'draft',
  canonical_path: '/improvements/contractor-practice/contractor-payment-plan/',
  social_image: '/static/social/myhomebro-default-1200x630.png',
  preview_path: '/app/admin/improvements/preview/contractor-payment-plan',
};

async function setup(page) {
  await page.addInitScript(() => localStorage.setItem('access', 'synthetic-admin-token'));
  await page.route('**/api/projects/whoami/', (route) => route.fulfill({ status: 200, json: { id: 1, type: 'admin', role: 'admin' } }));
  await page.route('**/api/projects/admin/improvements/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/admin/improvements/')) return route.fulfill({ status: 200, json: { results: [article] } });
    if (url.pathname.includes('/preview/')) return route.fulfill({ status: 200, json: article });
    if (route.request().method() === 'PATCH') return route.fulfill({ status: 200, json: article });
    return route.fulfill({ status: 200, json: article });
  });
};

test('admin can edit editorial sections and preview an unpublished article', async ({ page }) => {
  await setup(page);
  await page.goto('/app/admin/improvements/42');
  await expect(page.getByRole('heading', { name: 'Improvement Library' })).toBeVisible();
  await expect(page.getByLabel('3. MyHomeBro viewpoint — Our take')).toHaveValue(article.public_viewpoint);
  await page.getByLabel('3. MyHomeBro viewpoint — Our take').fill('Revised MyHomeBro perspective.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByRole('link', { name: 'Preview design' }).click();
  await expect(page.getByText('Editorial preview · draft.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Our take' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await page.screenshot({ path: 'test-results/improvement-contractor-preview-desktop.png', fullPage: true });
});

test('contractor article preview remains readable at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto(article.preview_path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Practical steps' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: 'test-results/improvement-contractor-preview-mobile.png', fullPage: true });
});
