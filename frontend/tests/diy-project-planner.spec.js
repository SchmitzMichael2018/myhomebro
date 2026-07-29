import { expect, test } from '@playwright/test';

const portalPayload = {
  customer: { name: 'Daniel Carter', email: 'daniel.carter@example.com' },
  account: { email: 'daniel.carter@example.com', has_user: true },
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

test('homeowner can create and resume a DIY plan at desktop and mobile widths', async ({
  page,
}) => {
  let projects = [];
  const project = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Backyard Floating Deck',
    desired_outcome: 'Build a durable floating deck for the backyard seating area',
    status: 'planning',
    status_label: 'Planning',
    category: '',
    area: 'Backyard',
    task_count: 0,
    completed_task_count: 0,
    progress_percent: 0,
    updated_at: '2026-07-29T12:00:00Z',
    phases: [],
    measurements: [],
    assets: [],
    progress_entries: [],
    request_links: [],
  };

  await page.route(
    '**/api/projects/customer-portal/customer-token/**',
    async (route) => {
      const request = route.request();
      const url = request.url();
      if (url.endsWith('/diy-projects/') && request.method() === 'GET') {
        return route.fulfill({ json: { projects } });
      }
      if (url.endsWith('/diy-projects/') && request.method() === 'POST') {
        projects = [{ ...project }];
        return route.fulfill({ status: 201, json: project });
      }
      if (
        url.includes(`/diy-projects/${project.id}/`) &&
        request.method() === 'GET'
      ) {
        return route.fulfill({ json: project });
      }
      return route.fulfill({ json: portalPayload });
    }
  );
  await page.route('**/api/projects/customer-portal/customer-token/', (route) =>
    route.fulfill({ json: portalPayload })
  );

  await page.goto('/portal/customer-token');
  await page.getByRole('button', { name: /DIY Planner/i }).click();
  await expect(page.getByTestId('diy-project-planner')).toBeVisible();
  await page.getByTestId('diy-video-watch-do').click();
  await expect(page.getByTestId('guided-video-player')).toHaveCount(1);
  await page.getByTestId('guided-video-dock').selectOption('top-left');
  await page.getByTestId('diy-project-new').click();
  await page.getByLabel('Project title').fill('Backyard Floating Deck');
  await page
    .getByLabel('Desired outcome')
    .fill('Build a durable floating deck for the backyard seating area');
  await page.getByTestId('diy-project-create').click();
  await expect(page.getByText('Backyard Floating Deck')).toBeVisible();
  await expect(page.getByTestId('guided-video-player')).toBeVisible();
  await page.getByTestId('guided-video-preview-checkpoint').click();
  await expect(page.getByTestId('guided-video-checkpoint')).toContainText(
    'Create a private DIY project'
  );
  await page.getByTestId('guided-video-continue').click();
  await page.getByTestId('guided-video-minimize').click();
  await page.getByTestId('diy-section-plan').click();
  await page.getByTestId('guided-video-restore').click();
  await page.screenshot({
    path: 'test-results/diy-project-planner-desktop.png',
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('diy-project-workspace')).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
  );
  expect(overflow).toBe(false);
  await page.screenshot({
    path: 'test-results/diy-project-planner-mobile.png',
    fullPage: true,
  });
});
