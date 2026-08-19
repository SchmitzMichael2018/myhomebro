import { expect, test } from '@playwright/test';

async function installCalendarRoutes(page, milestones = [], appointments = []) {
  await page.addInitScript(() => localStorage.setItem('access', 'calendar-test-token'));
  await page.route('**/api/projects/whoami/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 7, type: 'contractor', role: 'contractor_owner' }) }));
  await page.route('**/api/projects/subaccounts/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));
  await page.route('**/api/projects/milestones/calendar/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(milestones) }));
  await page.route('**/api/projects/assignments/calendar/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [] }) }));
  await page.route('**/api/projects/appointments/calendar/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: appointments }) }));
}

const estimateAppointment = {
  id: 'estimate-appointment-81',
  title: 'Estimate appointment',
  start: '2026-08-21T19:00:00Z',
  end: '2026-08-21T20:00:00Z',
  allDay: false,
  extendedProps: {
    type: 'estimate_appointment', appointment_id: 81, appointment_timezone: 'America/Chicago',
    status: 'scheduled', display_status: 'Scheduled', tentative: false,
    appointment_type: 'in_person', appointment_type_label: 'In-Person Estimate',
    estimate_name: 'Kitchen Estimate', customer_name: 'Casey Customer', location: '123 Main St',
    proposal_id: 501, navigation_target: '/app/estimates/501#appointment',
  },
};

test('Calendar loads once and switches month, week, and day views without stylesheet errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await installCalendarRoutes(page, [{ id: 91, title: 'Kitchen rough-in', start: '2026-08-10', end: '2026-08-11', calendar_status: 'scheduled', agreement_number: 14, order: 2, homeowner_name: 'Test Homeowner', amount: '1200.00' }]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/calendar', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible();
  await expect(page.getByText('Kitchen rough-in')).toBeVisible();
  await page.screenshot({ path: 'test-results/calendar-month.png', fullPage: true });
  await page.getByRole('button', { name: /week/i }).click();
  await expect(page.locator('.fc-timeGridWeek-view')).toBeVisible();
  await page.screenshot({ path: 'test-results/calendar-week.png', fullPage: true });
  await page.getByRole('button', { name: 'day', exact: true }).click();
  await expect(page.locator('.fc-timeGridDay-view')).toBeVisible();
  await page.screenshot({ path: 'test-results/calendar-day.png', fullPage: true });
  expect(errors.filter((message) => /cssRules|Content Security Policy|error boundary/i.test(message))).toEqual([]);
});

test('Calendar empty state refreshes and remains horizontally safe on mobile', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installCalendarRoutes(page, []);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/calendar', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/No calendar events yet/)).toBeVisible();
  await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/calendar-empty-390.png', fullPage: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible();
  expect(errors.filter((message) => /cssRules/i.test(message))).toEqual([]);
});

test('Estimate appointment renders in month, week, and deep-linked day views', async ({ page }) => {
  await installCalendarRoutes(page, [], [estimateAppointment]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/calendar?date=2026-08-21&view=day&event=estimate-appointment-81', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.fc-timeGridDay-view')).toBeVisible();
  await expect(page.getByTestId('calendar-estimate-appointment-81')).toContainText('Kitchen Estimate');
  await expect(page.locator('[data-selected-event="true"]')).toBeVisible();
  await expect(page.getByText(/No calendar events yet/)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/calendar-appointment-day-desktop.png', fullPage: true });

  await page.getByRole('button', { name: /week/i }).click();
  await expect(page.locator('.fc-timeGridWeek-view')).toBeVisible();
  await expect(page.getByTestId('calendar-estimate-appointment-81')).toBeVisible();
  await page.getByRole('button', { name: /month/i }).click();
  await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible();
  await expect(page.getByTestId('calendar-estimate-appointment-81')).toContainText('Estimate appointment');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('calendar-estimate-appointment-81')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/calendar-appointment-month-mobile.png', fullPage: true });
});
