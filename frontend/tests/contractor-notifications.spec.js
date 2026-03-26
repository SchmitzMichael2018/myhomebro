import { expect, test } from '@playwright/test';

async function mockContractorDashboard(page, operationsPayload, options = {}) {
  const milestones = options.milestones || [];
  const agreements = options.agreements || [];
  const publicLeads = options.publicLeads || [];

  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 7,
        type: 'contractor',
        role: 'contractor_owner',
        email: 'playwright@myhomebro.local',
      }),
    });
  });

  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        onboarding_status: 'complete',
        connected: true,
      }),
    });
  });

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        created_at: '2026-03-01T10:00:00Z',
      }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: milestones }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/\d+\/?.*$/, async (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split('/').filter(Boolean).pop();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id,
        title: `Milestone ${id}`,
        agreement: 321,
      }),
    });
  });

  await page.route(/\/api\/projects\/invoices\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/expense-requests\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: agreements }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/\d+\/?.*$/, async (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split('/').filter(Boolean).pop();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id,
        title: `Agreement ${id}`,
      }),
    });
  });

  await page.route('**/api/projects/dashboard/operations/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(operationsPayload),
    });
  });

  await page.route('**/api/projects/contractor/public-leads/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: publicLeads }),
    });
  });
}

function buildTask({
  id,
  item_type,
  title,
  subtitle = 'Kitchen Remodel',
  agreement_id = 321,
  agreement_title = 'Kitchen Remodel Agreement',
  project_title = 'Kitchen Remodel',
  milestone_id,
  milestone_title,
  completion_date = null,
  start_date = null,
  actions = null,
}) {
  return {
    id,
    item_type,
    title,
    subtitle,
    agreement_id,
    agreement_title,
    project_title,
    milestone_id,
    milestone_title,
    status: 'pending',
    completion_date,
    start_date,
    actions:
      actions || [
        { label: 'View Milestone', type: 'route', target: `/app/milestones/${milestone_id}` },
        { label: 'Open Agreement', type: 'route', target: `/app/agreements/${agreement_id}` },
      ],
  };
}

test('contractor dashboard groups by agreement id once and preserves navigation actions', async ({
  page,
}) => {
  await mockContractorDashboard(page, {
    identity_type: 'contractor_owner',
    today: [
      buildTask({
        id: 'overdue-41',
        item_type: 'overdue',
        title: 'Cabinet Install is overdue',
        milestone_id: 41,
        milestone_title: 'Cabinet Install',
        completion_date: '2026-03-20T09:00:00Z',
      }),
      buildTask({
        id: 'due-today-43',
        item_type: 'due_today',
        title: 'Paint Prep is due today',
        milestone_id: 43,
        milestone_title: 'Paint Prep',
        completion_date: '2026-03-24T11:00:00Z',
      }),
    ],
    tomorrow: [
      buildTask({
        id: 'due-tomorrow-44',
        item_type: 'due_tomorrow',
        title: 'Floor Protection is due tomorrow',
        milestone_id: 44,
        milestone_title: 'Floor Protection',
        completion_date: '2026-03-25T09:00:00Z',
      }),
      buildTask({
        id: 'due-tomorrow-46',
        item_type: 'due_tomorrow',
        title: 'Final Paint is due tomorrow',
        agreement_id: 654,
        agreement_title: 'Lake House Agreement',
        project_title: 'Lake House',
        subtitle: 'Lake House',
        milestone_id: 46,
        milestone_title: 'Final Paint',
        completion_date: '2026-03-25T10:00:00Z',
      }),
    ],
    this_week: [],
    recent_activity: [],
    empty_states: {
      recent_activity: 'No recent worker activity yet.',
    },
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('role-workboard-needs-attention')).toBeVisible();
  await expect(page.getByTestId('role-workboard-today')).toHaveCount(0);
  await expect(page.getByTestId('role-workboard-tomorrow')).toBeVisible();
  await expect(page.getByTestId('workboard-item-group-agreement-321')).toHaveCount(1);
  await expect(page.getByTestId('workboard-item-group-agreement-321')).toContainText(
    'Kitchen Remodel'
  );
  await expect(page.getByTestId('workboard-item-group-agreement-321')).toContainText(
    'Earliest: Cabinet Install'
  );
  await expect(page.getByTestId('workboard-agreement-id-group-agreement-321')).toContainText(
    'Agreement #321'
  );
  await expect(page.getByTestId('workboard-agreement-id-group-agreement-321')).toContainText(
    '3 milestones'
  );
  await expect(page.getByTestId('workboard-agreement-id-group-agreement-321')).toContainText(
    '1 overdue'
  );
  await expect(page.getByTestId('role-workboard-tomorrow')).not.toContainText('Kitchen Remodel');

  await page.getByTestId('workboard-action-group-agreement-321-0').click();
  await page.waitForURL('**/app/agreements/321');

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('workboard-action-due-tomorrow-46-0').click();
  await page.waitForURL('**/app/milestones/46');
});

test('contractor dashboard keeps same-title agreements separate and shows ids on all rows', async ({
  page,
}) => {
  await mockContractorDashboard(page, {
    identity_type: 'contractor_owner',
    today: [
      buildTask({
        id: 'overdue-201',
        item_type: 'overdue',
        title: 'Roof Deck is overdue',
        agreement_id: 1042,
        agreement_title: 'Roof Replacement Agreement',
        project_title: 'Roof Replacement',
        subtitle: 'Roof Replacement',
        milestone_id: 201,
        milestone_title: 'Roof Deck',
        completion_date: '2026-03-21T09:00:00Z',
      }),
      buildTask({
        id: 'overdue-202',
        item_type: 'overdue',
        title: 'Shingle Delivery is overdue',
        agreement_id: 2042,
        agreement_title: 'Roof Replacement Agreement',
        project_title: 'Roof Replacement',
        subtitle: 'Roof Replacement',
        milestone_id: 202,
        milestone_title: 'Shingle Delivery',
        completion_date: '2026-03-22T09:00:00Z',
      }),
    ],
    tomorrow: [],
    this_week: [],
    recent_activity: [],
    empty_states: {
      recent_activity: 'No recent worker activity yet.',
    },
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('role-workboard-needs-attention')).toBeVisible();
  await expect(page.getByTestId('workboard-agreement-id-overdue-201')).toContainText('#1042');
  await expect(page.getByTestId('workboard-agreement-id-overdue-201')).toContainText(
    'Roof Replacement'
  );
  await expect(page.getByTestId('workboard-agreement-id-overdue-202')).toContainText('#2042');
  await expect(page.getByTestId('workboard-agreement-id-overdue-202')).toContainText(
    'Roof Replacement'
  );
});

test('contractor dashboard renders no duplicate agreement rows in the dom', async ({ page }) => {
  await mockContractorDashboard(page, {
    identity_type: 'contractor_owner',
    today: [
      buildTask({
        id: 'overdue-301',
        item_type: 'overdue',
        title: 'Demo is overdue',
        agreement_id: 777,
        agreement_title: 'Roof Replacement Agreement',
        project_title: 'Roof Replacement',
        subtitle: 'Roof Replacement',
        milestone_id: 301,
        milestone_title: 'Demo',
        completion_date: '2026-03-20T09:00:00Z',
      }),
      buildTask({
        id: 'due-today-302',
        item_type: 'due_today',
        title: 'Framing is due today',
        agreement_id: 777,
        agreement_title: 'Roof Replacement Agreement',
        project_title: 'Roof Replacement',
        subtitle: 'Roof Replacement',
        milestone_id: 302,
        milestone_title: 'Framing',
        completion_date: '2026-03-24T09:00:00Z',
      }),
    ],
    tomorrow: [
      buildTask({
        id: 'due-tomorrow-303',
        item_type: 'due_tomorrow',
        title: 'Inspection is due tomorrow',
        agreement_id: 777,
        agreement_title: 'Roof Replacement Agreement',
        project_title: 'Roof Replacement',
        subtitle: 'Roof Replacement',
        milestone_id: 303,
        milestone_title: 'Inspection',
        completion_date: '2026-03-25T09:00:00Z',
      }),
    ],
    this_week: [],
    recent_activity: [],
    empty_states: {
      recent_activity: 'No recent worker activity yet.',
    },
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('workboard-item-group-agreement-777')).toHaveCount(1);
  await expect(page.getByTestId('workboard-agreement-id-group-agreement-777')).toContainText(
    'Agreement #777'
  );
  await expect(page.getByTestId('role-workboard-needs-attention')).toContainText(
    'Roof Replacement'
  );
  await expect(page.getByTestId('role-workboard-today')).toHaveCount(0);
  await expect(page.getByTestId('role-workboard-tomorrow')).toHaveCount(0);
});

test('contractor dashboard caps long sections and expands with view all', async ({ page }) => {
  await mockContractorDashboard(page, {
    identity_type: 'contractor_owner',
    today: [
      buildTask({
        id: 'due-today-101',
        item_type: 'due_today',
        title: 'Task 1 is due today',
        agreement_id: 901,
        agreement_title: 'Agreement 901',
        project_title: 'Project 901',
        subtitle: 'Project 901',
        milestone_id: 101,
        milestone_title: 'Task 1',
        completion_date: '2026-03-24T08:00:00Z',
      }),
      buildTask({
        id: 'due-today-102',
        item_type: 'due_today',
        title: 'Task 2 is due today',
        agreement_id: 902,
        agreement_title: 'Agreement 902',
        project_title: 'Project 902',
        subtitle: 'Project 902',
        milestone_id: 102,
        milestone_title: 'Task 2',
        completion_date: '2026-03-24T09:00:00Z',
      }),
      buildTask({
        id: 'due-today-103',
        item_type: 'due_today',
        title: 'Task 3 is due today',
        agreement_id: 903,
        agreement_title: 'Agreement 903',
        project_title: 'Project 903',
        subtitle: 'Project 903',
        milestone_id: 103,
        milestone_title: 'Task 3',
        completion_date: '2026-03-24T10:00:00Z',
      }),
      buildTask({
        id: 'due-today-104',
        item_type: 'due_today',
        title: 'Task 4 is due today',
        agreement_id: 904,
        agreement_title: 'Agreement 904',
        project_title: 'Project 904',
        subtitle: 'Project 904',
        milestone_id: 104,
        milestone_title: 'Task 4',
        completion_date: '2026-03-24T11:00:00Z',
      }),
      buildTask({
        id: 'due-today-105',
        item_type: 'due_today',
        title: 'Task 5 is due today',
        agreement_id: 905,
        agreement_title: 'Agreement 905',
        project_title: 'Project 905',
        subtitle: 'Project 905',
        milestone_id: 105,
        milestone_title: 'Task 5',
        completion_date: '2026-03-24T12:00:00Z',
      }),
      buildTask({
        id: 'due-today-106',
        item_type: 'due_today',
        title: 'Task 6 is due today',
        agreement_id: 906,
        agreement_title: 'Agreement 906',
        project_title: 'Project 906',
        subtitle: 'Project 906',
        milestone_id: 106,
        milestone_title: 'Task 6',
        completion_date: '2026-03-24T13:00:00Z',
      }),
    ],
    tomorrow: [],
    this_week: [],
    recent_activity: [],
    empty_states: {
      recent_activity: 'No recent worker activity yet.',
    },
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('role-workboard-today-view-all')).toContainText('View all (6)');
  await expect(page.getByTestId('workboard-item-due-today-101')).toBeVisible();
  await expect(page.getByTestId('workboard-item-due-today-105')).toBeVisible();
  await expect(page.getByTestId('workboard-item-due-today-106')).toHaveCount(0);

  await page.getByTestId('role-workboard-today-view-all').click();
  await expect(page.getByTestId('workboard-item-due-today-106')).toBeVisible();
});

test('contractor dashboard hides empty task sections and shows one compact empty state', async ({
  page,
}) => {
  await mockContractorDashboard(page, {
    identity_type: 'contractor_owner',
    today: [],
    tomorrow: [],
    this_week: [],
    recent_activity: [],
    empty_states: {
      recent_activity: 'No recent worker activity yet.',
    },
  });

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('role-workboard-empty')).toContainText(
    'No upcoming tasks right now.'
  );
  await expect(page.getByTestId('role-workboard-needs-attention')).toHaveCount(0);
  await expect(page.getByTestId('role-workboard-today')).toHaveCount(0);
  await expect(page.getByTestId('role-workboard-tomorrow')).toHaveCount(0);
  await expect(page.getByTestId('role-workboard-this-week')).toHaveCount(0);
});

test('contractor dashboard shows next steps for leads signatures funding and reviews', async ({
  page,
}) => {
  await mockContractorDashboard(
    page,
    {
      identity_type: 'contractor_owner',
      today: [],
      tomorrow: [],
      this_week: [],
      recent_activity: [],
      empty_states: {
        recent_activity: 'No recent worker activity yet.',
      },
    },
    {
      publicLeads: [
        {
          id: 91,
          status: 'new',
          full_name: 'Casey Prospect',
        },
      ],
      agreements: [
        {
          id: 321,
          title: 'Kitchen Remodel Agreement',
          status: 'draft',
          payment_mode: 'escrow',
          signature_is_satisfied: false,
          is_fully_signed: false,
          escrow_funded: false,
        },
        {
          id: 654,
          title: 'Bath Remodel Agreement',
          status: 'signed',
          payment_mode: 'escrow',
          signature_is_satisfied: true,
          is_fully_signed: true,
          escrow_funded: false,
        },
      ],
      milestones: [
        {
          id: 401,
          title: 'Paint Prep',
          status: 'submitted',
        },
      ],
    }
  );

  await page.goto('/app/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('dashboard-next-steps')).toContainText(
    '1 public lead needs follow-up.'
  );
  await expect(page.getByTestId('dashboard-next-steps')).toContainText(
    '1 agreement is waiting for signature.'
  );
  await expect(page.getByTestId('dashboard-next-steps')).toContainText(
    '1 project is waiting for funding.'
  );
  await expect(page.getByTestId('dashboard-next-steps')).toContainText(
    '1 milestone is awaiting review.'
  );
});
