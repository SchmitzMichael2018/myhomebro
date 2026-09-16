import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('employee milestones use readable stacked cards on mobile', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user_id: 55, type: 'subaccount', role: 'employee_milestones' }),
    });
  });
  await page.route('**/api/projects/employee/milestones/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        can_work: true,
        milestones: [{
          id: 901,
          title: 'Install custom wood paneling',
          agreement_id: 35,
          project_title: 'Master Bath Renovation',
          customer_name: 'QA Homeowner',
          project_address: '123 Main Street, Austin, TX',
          due_date: '2026-09-10',
          completed: false,
        }],
      }),
    });
  });

  await page.goto('/app/employee/milestones', { waitUntil: 'domcontentloaded' });

  const card = page.getByTestId('employee-milestone-mobile-card-901');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Install custom wood paneling');
  await expect(card).toContainText('Agreement #35');
  await expect(card).toContainText('Master Bath Renovation');
  await expect(card).toContainText('QA Homeowner');
  await expect(card).toContainText('123 Main Street, Austin, TX');
  await expect(page.locator('table')).toBeHidden();
});
