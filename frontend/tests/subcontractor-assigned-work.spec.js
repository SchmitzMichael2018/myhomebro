import { expect, test } from '@playwright/test';

test('subcontractor assigned work page renders grouped milestones and empty state', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  let emptyMode = false;

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user_id: 99,
        email: 'subcontractor@example.com',
        type: 'subcontractor',
        role: 'subcontractor',
      }),
    });
  });

  await page.route('**/api/projects/subcontractor/milestones/my-assigned/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        emptyMode
          ? {
              groups: [],
              milestones: [],
              count: 0,
            }
          : {
              groups: [
                {
                  agreement_id: 321,
                  agreement_title: 'Kitchen Remodel Agreement',
                  project_title: 'Kitchen Remodel Agreement',
                  milestones: [
                    {
                      id: 901,
                      title: 'Cabinet Install',
                      description: 'Install all upper and lower cabinets.',
                      status: 'pending',
                      start_date: '2026-03-25',
                      completion_date: '2026-03-28',
                      assigned_subcontractor: {
                        invitation_id: 77,
                        display_name: 'Taylor Sub',
                        email: 'subcontractor@example.com',
                      },
                    },
                  ],
                },
              ],
              milestones: [
                {
                  id: 901,
                  title: 'Cabinet Install',
                },
              ],
              count: 1,
            }
      ),
    });
  });

  await page.goto('/app/subcontractor/assigned-work', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('subcontractor-assigned-work-title')).toBeVisible();
  await expect(page.getByTestId('assigned-work-group-321')).toContainText(
    'Kitchen Remodel Agreement'
  );
  await expect(page.getByTestId('assigned-milestone-901')).toContainText(
    'Cabinet Install'
  );
  await expect(page.getByTestId('assigned-milestone-901')).toContainText(
    'Taylor Sub'
  );

  emptyMode = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('subcontractor-assigned-work-empty')).toBeVisible();
});
