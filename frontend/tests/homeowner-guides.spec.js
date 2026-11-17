import fs from 'node:fs';
import { expect, test } from '@playwright/test';

const guide = JSON.parse(fs.readFileSync(new URL('../../backend/projects/data/homeowner_guides_v1.json', import.meta.url), 'utf8'))[0];
const canonicalPath = `/improvements/${guide.category}/${guide.slug}/`;
const article = {
  id: 9102, slug: guide.slug, category_slug: guide.category, category_name: 'Bathroom',
  title: guide.title, summary: guide.summary, intro: guide.intro, scope: guide.scope,
  audience: 'homeowner', audiences: ['homeowner'], audience_label: 'Homeowners',
  diy_guidance: guide.diy, pro_guidance: guide.pro,
  sections: guide.sections.map(([id, title, body]) => ({ id, title, body })).concat({
    id: 'guide-sources', title: 'Sources and local checks', body: guide.sources.map(s => s.join(' | ')).join('\n'),
  }),
  milestones: [], faqs: [], related: [], canonical_path: canonicalPath,
  seo_title: guide.title, seo_description: guide.summary,
  social_image: '/static/social/myhomebro-default-1200x630.png',
};

test('homeowner guide offers readable DIY and hiring paths with source links and planning handoff', async ({ page }) => {
  await page.route('**/api/projects/public/improvements/bathroom/*/', route => route.fulfill({ json: article }));
  await page.goto(canonicalPath);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(guide.title);
  await page.getByRole('link', { name: 'Explore DIY tasks' }).click();
  await expect(page).toHaveURL(/#diy-route$/);
  await expect(page.getByTestId('homeowner-diy-guide')).toContainText('cosmetic');
  await page.getByRole('link', { name: 'Prepare to hire' }).click();
  await expect(page).toHaveURL(/#hire-route$/);
  await expect(page.getByTestId('homeowner-hiring-guide')).toContainText('waterproofing');
  await expect(page.getByRole('link', { name: /San Antonio residential permits/ })).toHaveAttribute('href', /https:\/\/www.sa.gov\//);
  await expect(page.getByTestId('diy-this-project')).toHaveText('Build my DIY plan');
  const request = page.waitForURL(/\/start-project/);
  await page.route('**/api/projects/public-intake/start/', route => route.fulfill({ status: 500, json: { detail: 'Synthetic preflight stop' } }));
  await page.getByTestId('get-contractor-help').click();
  await request;
  expect(new URL(page.url()).searchParams.get('template_id')).toBe('9102');
});

test('San Antonio only links to guides returned by the published library', async ({ page }) => {
  await page.route('**/api/projects/public/improvements/?audience=homeowner', route => route.fulfill({ json: { improvements: [{ ...article }] } }));
  await page.goto('/san-antonio/');
  await expect(page.getByTestId(`san-antonio-guide-${guide.slug}`)).toHaveAttribute('href', new RegExp(guide.slug));
  await expect(page.getByTestId('san-antonio-guide-shed-planning-and-finishing-guide')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Backyard shed' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Deck', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Patio', exact: true })).toBeVisible();
});
