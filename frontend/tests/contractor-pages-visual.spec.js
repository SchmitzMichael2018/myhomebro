import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const OUT_DIR_REL = path.join('test-results', 'visual-qa', 'pages');
const OUT_DIR = path.resolve(process.cwd(), OUT_DIR_REL);
const AGREEMENT_ID = 123;
const MILESTONE_ID = 501;
const INVOICE_ID = 701;

const agreement = {
  id: AGREEMENT_ID,
  agreement_id: AGREEMENT_ID,
  title: 'Kitchen Remodel Agreement',
  project_title: 'Kitchen Remodel',
  project_type: 'Remodel',
  project_subtype: 'Kitchen',
  description: 'Full kitchen remodel with cabinets, counters, and finish work.',
  homeowner: 1,
  homeowner_name: 'Jordan Demo',
  homeowner_email: 'jordan@example.com',
  payment_mode: 'escrow',
  payment_structure: 'simple',
  status: 'draft',
  total_cost: 8400,
  display_total: 8400,
  selected_template_id: 88,
  selected_template_name_snapshot: 'Kitchen Remodel Starter',
  agreement_mode: 'maintenance',
  recurring_service_enabled: true,
  recurrence_pattern: 'monthly',
  recurrence_interval: 1,
  recurrence_start_date: '2026-04-15',
  next_occurrence_date: '2026-04-15',
  auto_generate_next_occurrence: true,
  maintenance_status: 'active',
  recurring_summary_label: 'Monthly Kitchen Maintenance',
  service_window_notes: 'First Tuesday mornings.',
  recurring_preview: {
    recurrence_pattern: 'monthly',
    recurrence_interval: 1,
    next_occurrence_date: '2026-04-15',
    recurring_summary_label: 'Monthly Kitchen Maintenance',
    preview_occurrences: [
      {
        sequence_number: 1,
        scheduled_service_date: '2026-04-15',
        service_period_start: '2026-04-15',
        service_period_end: '2026-05-14',
        title: 'April Service Visit',
      },
      {
        sequence_number: 2,
        scheduled_service_date: '2026-05-15',
        service_period_start: '2026-05-15',
        service_period_end: '2026-06-14',
        title: 'May Service Visit',
      },
    ],
  },
  sms_enabled: true,
  sms_opted_out: false,
  sms_status: {
    phone_number_e164: '+15125550123',
  },
  last_sms_event: {
    summary: 'Payment released notification sent.',
  },
  last_sms_automation_decision: {
    reason_code: 'sent_immediately',
    message_preview: 'Payment released for Agreement #123.',
  },
  recent_sms_automation_decisions: [
    {
      id: 1,
      event_type: 'payment_released',
      reason_code: 'sent_immediately',
      channel_decision: 'sms',
      sent: true,
      created_at: '2026-03-28T11:00:00Z',
    },
  ],
};

const agreements = [
  agreement,
  {
    id: 124,
    title: 'Bath Refresh Agreement',
    project_title: 'Bath Refresh',
    homeowner_name: 'Morgan Example',
    homeowner_email: 'morgan@example.com',
    status: 'signed',
    payment_mode: 'escrow',
    total_cost: 6200,
    display_total: 6200,
  },
];

const milestones = [
  {
    id: MILESTONE_ID,
    agreement: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    agreement_title: 'Kitchen Remodel Agreement',
    title: 'Cabinet Install',
    status: 'pending_approval',
    amount: 3200,
    completion_date: '2026-04-15',
    scheduled_service_date: '2026-04-15',
    service_period_start: '2026-04-15',
    service_period_end: '2026-05-14',
  },
  {
    id: 502,
    agreement: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    agreement_title: 'Kitchen Remodel Agreement',
    title: 'Countertops',
    status: 'incomplete',
    amount: 2800,
    completion_date: '2026-04-20',
  },
];

const invoices = [
  {
    id: INVOICE_ID,
    invoice_id: INVOICE_ID,
    agreement_id: AGREEMENT_ID,
    agreement_title: 'Kitchen Remodel Agreement',
    invoice_number: 'INV-20260329-0001',
    milestone_title: 'Cabinet Install',
    amount: 3200,
    gross_amount: 3200,
    status: 'pending_approval',
    display_status: 'Pending Approval',
  },
];

const homeowners = [
  {
    id: 1,
    full_name: 'Jordan Demo',
    company_name: 'Demo Residence',
    email: 'jordan@example.com',
    status: 'active',
    active_projects_count: 1,
    phone_number: '5125550123',
    street_address: '123 Main St',
    city: 'Austin',
    state: 'TX',
    zip_code: '78701',
  },
];

const contractorMe = {
  id: 77,
  created_at: '2026-03-01T10:00:00Z',
  full_name: 'Playwright Builder',
  business_name: 'Playwright Builder Co',
  phone: '555-111-2222',
  address: '123 Main St',
  city: 'Austin',
  state: 'TX',
  zip: '78701',
  license_number: '',
  license_expiration_date: '',
  skills: ['Electrical', 'Painting'],
  compliance_records: [],
  compliance_trade_requirements: [],
  insurance_status: {
    has_insurance: false,
    status: 'missing',
  },
  auto_subcontractor_payouts_enabled: true,
  onboarding: {
    activation: {
      last_step_reached: 'stripe',
    },
  },
  ai: {
    access: 'included',
    enabled: true,
    unlimited: true,
  },
};

const onboardingState = {
  status: 'in_progress',
  step: 'stripe',
  step_number: 4,
  step_total: 4,
  first_value_reached: true,
  stripe_ready: false,
  show_soft_stripe_prompt: true,
  activation: {
    last_step_reached: 'stripe',
  },
};

const businessSummary = {
  snapshot: {
    jobs_completed: 4,
    active_jobs: 2,
    total_revenue: '12800.00',
    avg_revenue_per_job: '3200.00',
    avg_completion_days: '18.5',
    escrow_pending: '900.00',
    platform_fees_paid: '640.00',
    disputes_open: 0,
  },
  bucket: 'week',
  revenue_series: [
    { bucket_start: '2026-03-03', bucket_label: 'Mar 3-9', revenue: '4200.00' },
    { bucket_start: '2026-03-10', bucket_label: 'Mar 10-16', revenue: '8600.00' },
  ],
  fee_series: [],
  payout_series: [],
  workflow_series: [
    { bucket_start: '2026-03-03', bucket_label: 'Mar 3-9', overdue_milestones: 1 },
    { bucket_start: '2026-03-10', bucket_label: 'Mar 10-16', overdue_milestones: 3 },
  ],
  fee_summary: {
    platform_fee_total: '640.00',
    estimated_processing_fee_total: '150.00',
    total_fee: '790.00',
  },
  workflow_summary: {
    metric: 'overdue_milestones',
    label: 'Overdue Milestones',
  },
  progress_summary: {
    project_count: 1,
    contract_value: '8400.00',
    earned_to_date: '3200.00',
    approved_to_date: '2800.00',
    paid_to_date: '1800.00',
    retainage_held: '300.00',
    remaining_balance: '5200.00',
  },
  by_category: [
    {
      category: 'Kitchen Remodel',
      jobs: 2,
      avg_completion_days: '17',
      avg_revenue: '4200',
      total_revenue: '8400',
    },
  ],
  insights: [
    {
      category: 'review_bottleneck',
      title: 'Awaiting review',
      explanation: '3 milestones are waiting for contractor review, which may delay invoicing.',
      severity: 'high',
      action_label: 'View Review Queue',
      action_href: '/app/reviewer/queue',
    },
  ],
};

const dashboardActivity = [
  {
    id: 1,
    event_type: 'payment_released',
    title: 'Payment released',
    summary: 'Funds for Kitchen Remodel Agreement were released.',
    severity: 'success',
    created_at: '2026-03-28T09:00:00Z',
    navigation_target: '/app/agreements/123',
  },
];

const nextBestAction = {
  action_type: 'send_first_agreement',
  title: 'Send your next agreement',
  message: 'You already have a draft agreement ready for review and sending.',
  cta_label: 'Open draft',
  navigation_target: '/app/agreements/123/wizard?step=1',
  rationale: 'Draft agreements create the fastest path to homeowner action and funding.',
};

const subcontractorDirectory = [
  {
    key: 'accepted-sub@example.com',
    display_name: 'Accepted Sub',
    email: 'accepted-sub@example.com',
    status: 'active',
    agreements_count: 1,
    assigned_work_count: 1,
    submitted_for_review_count: 1,
    agreements: [{ agreement_id: AGREEMENT_ID, agreement_title: 'Kitchen Remodel Agreement' }],
  },
];

const subcontractorInvitations = [
  {
    id: 77,
    agreement: AGREEMENT_ID,
    agreement_title: 'Kitchen Remodel Agreement',
    invite_email: 'accepted-sub@example.com',
    invite_name: 'Accepted Sub',
    accepted_name: 'Accepted Sub',
    status: 'accepted',
    invited_at: '2026-03-24T10:00:00Z',
    accepted_at: '2026-03-24T12:00:00Z',
  },
];

const subcontractorAssignments = [
  {
    id: 801,
    agreement_id: AGREEMENT_ID,
    agreement_title: 'Kitchen Remodel Agreement',
    invitation_id: 77,
    invite_name: 'Accepted Sub',
    assigned_milestones_count: 1,
    compliance_status: 'compliant',
  },
];

const subcontractorSubmissions = [
  {
    id: 901,
    agreement_id: AGREEMENT_ID,
    agreement_title: 'Kitchen Remodel Agreement',
    milestone_title: 'Cabinet Install',
    subcontractor_display_name: 'Accepted Sub',
    subcontractor_email: 'accepted-sub@example.com',
    review_status: 'submitted_for_review',
    submitted_at: '2026-03-25T08:00:00Z',
    notes: 'Ready for walkthrough.',
  },
];

const subaccounts = {
  results: [
    {
      id: 31,
      display_name: 'Sam Supervisor',
      email: 'sam@example.com',
    },
  ],
};

const expenseRequests = [
  {
    id: 601,
    agreement: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    description: 'Dumpster rental',
    amount: '275.00',
    status: 'draft',
    incurred_date: '2026-03-25',
    project_title: 'Kitchen Remodel',
  },
];

const pageConfigs = [
  {
    label: 'Agreements List',
    slug: 'agreements-list.png',
    url: '/app/agreements',
    waitFor: async (page) => {
      await page.getByRole('heading', { name: 'Agreements' }).waitFor({ state: 'visible' });
    },
  },
  {
    label: 'Agreement Detail',
    slug: 'agreement-detail.png',
    url: `/app/agreements/${AGREEMENT_ID}`,
    waitFor: async (page) => {
      await page.locator('h1').first().waitFor({ state: 'visible' });
    },
  },
  {
    label: 'Agreement Wizard Step 1',
    slug: 'wizard-step-1.png',
    url: `/app/agreements/${AGREEMENT_ID}/wizard?step=1`,
    waitFor: async (page) => {
      await page.getByTestId('agreement-customer-select').waitFor({ state: 'visible' });
    },
  },
  {
    label: 'Agreement Wizard Step 2',
    slug: 'wizard-step-2.png',
    url: `/app/agreements/${AGREEMENT_ID}/wizard?step=2`,
    waitFor: async (page) => {
      await page.getByTestId('step2-recurring-summary').waitFor({ state: 'visible' });
    },
  },
  {
    label: 'Agreement Wizard Step 3',
    slug: 'wizard-step-3.png',
    url: `/app/agreements/${AGREEMENT_ID}/wizard?step=3`,
    waitFor: async (page) => {
      await page.getByText('Use default 12-month workmanship warranty').waitFor({ state: 'visible' });
    },
  },
  {
    label: 'Agreement Wizard Step 4',
    slug: 'wizard-step-4.png',
    url: `/app/agreements/${AGREEMENT_ID}/wizard?step=4`,
    waitFor: async (page) => {
      await page.getByTestId('step4-financial-summary').waitFor({ state: 'visible' });
    },
  },
  {
    label: 'Milestones Page',
    slug: 'milestones-page.png',
    url: '/app/milestones',
    waitFor: async () => {},
  },
  {
    label: 'Subcontractors Page',
    slug: 'subcontractors-page.png',
    url: '/app/subcontractors',
    waitFor: async (page) => {
      await page.getByTestId('subcontractors-page-title').waitFor({ state: 'visible' });
    },
  },
  {
    label: 'Assignments Page',
    slug: 'assignments-page.png',
    url: '/app/assignments',
    waitFor: async (page) => {
      await page.getByRole('heading', { name: 'Assignments' }).waitFor({ state: 'visible' });
    },
  },
  {
    label: 'Customers Page',
    slug: 'customers-page.png',
    url: '/app/customers',
    waitFor: async (page) => {
      await page.getByRole('heading', { name: 'My Customers' }).waitFor({ state: 'visible' });
    },
  },
  {
    label: 'Expenses Page',
    slug: 'expenses-page.png',
    url: '/app/expenses',
    waitFor: async (page) => {
      await page.getByRole('heading', { name: 'Expenses' }).waitFor({ state: 'visible' });
    },
  },
  {
    label: 'Business Dashboard',
    slug: 'business-dashboard.png',
    url: '/app/business',
    waitFor: async (page) => {
      await page.getByRole('heading', { name: 'Business Dashboard' }).waitFor({ state: 'visible' });
    },
  },
  {
    label: 'Templates Page',
    slug: 'templates-page.png',
    url: '/app/templates',
    waitFor: async (page) => {
      await page.getByRole('heading', { name: 'Templates' }).waitFor({ state: 'visible' });
    },
  },
  {
    label: 'Profile Page',
    slug: 'profile-page.png',
    url: '/app/profile',
    waitFor: async (page) => {
      await page.getByText('Business Profile').first().waitFor({ state: 'visible' });
    },
  },
  {
    label: 'Stripe Onboarding Page',
    slug: 'stripe-onboarding-page.png',
    url: '/app/onboarding',
    waitFor: async (page) => {
      await page.getByTestId('contractor-onboarding-page').waitFor({ state: 'visible' });
    },
  },
];

const dashboardConfig = {
  label: 'Contractor Dashboard',
  slug: 'contractor-dashboard.png',
  url: '/app/dashboard',
};

const agreementPageConfigs = pageConfigs.slice(0, 6);
const operationsPageConfigs = pageConfigs.slice(6, 9);
const businessPageConfigs = pageConfigs.slice(9);

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function isExactPath(pathname, exact) {
  return pathname === exact || pathname === `${exact}/`;
}

function listBody(results) {
  return { results };
}

async function installMocks(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  await page.route(/^https?:\/\/[^/]+\/api\/.*$/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();

    if (isExactPath(pathname, '/api/projects/whoami')) {
      return json(route, {
        id: 7,
        type: 'contractor',
        role: 'contractor_owner',
        email: 'playwright@myhomebro.local',
      });
    }

    if (isExactPath(pathname, '/api/payments/onboarding/status')) {
      return json(route, {
        onboarding_status: 'not_started',
        connected: false,
        charges_enabled: false,
        payouts_enabled: false,
      });
    }

    if (pathname.includes('/api/projects/contractors/me')) {
      return json(route, contractorMe);
    }

    if (pathname.includes('/api/projects/contractors/onboarding/dismiss-stripe-prompt')) {
      return json(route, { ...onboardingState, show_soft_stripe_prompt: false });
    }

    if (pathname.includes('/api/projects/contractors/onboarding')) {
      return json(route, onboardingState);
    }

    if (pathname.includes('/api/payments/onboarding/start')) {
      return json(route, { onboarding_url: 'https://example.test/stripe-start' });
    }

    if (pathname.includes('/api/payments/onboarding/manage')) {
      return json(route, { manage_url: 'https://example.test/stripe-manage' });
    }

    if (pathname.includes('/api/projects/project-types')) {
      return json(route, listBody([{ id: 1, value: 'Remodel', label: 'Remodel', owner_type: 'system' }]));
    }

    if (pathname.includes('/api/projects/project-subtypes')) {
      return json(route, listBody([{ id: 11, value: 'Kitchen', label: 'Kitchen Remodel', owner_type: 'system' }]));
    }

    if (pathname.includes('/api/projects/homeowners')) {
      return json(route, listBody(homeowners));
    }

    if (pathname.includes('/api/projects/templates')) {
      return json(route, listBody([
        {
          id: 88,
          name: 'Kitchen Remodel Starter',
          project_type: 'Remodel',
          project_subtype: 'Kitchen',
          visibility: 'private',
          owner_type: 'contractor',
          milestone_count: 2,
        },
      ]));
    }

    if (pathname.includes('/api/projects/dashboard/operations')) {
      return json(route, {
        identity_type: 'contractor_owner',
        today: [],
        tomorrow: [],
        this_week: [],
        recent_activity: [],
        empty_states: {
          recent_activity: 'No recent worker activity yet.',
        },
      });
    }

    if (pathname.includes('/api/projects/contractor/public-leads')) {
      return json(route, listBody([{ id: 91, status: 'new', full_name: 'Casey Prospect' }]));
    }

    if (pathname.includes('/api/projects/activity-feed')) {
      return json(route, {
        results: dashboardActivity,
        next_best_action: nextBestAction,
      });
    }

    if (pathname.includes('/api/projects/business/contractor/summary')) {
      return json(route, businessSummary);
    }

    if (pathname.includes('/api/projects/business/contractor/drilldown')) {
      return json(route, {
        chart_type: 'revenue',
        bucket: 'week',
        bucket_start: '2026-03-10',
        bucket_label: 'Mar 10-16',
        record_count: 1,
        records: [
          {
            id: INVOICE_ID,
            invoice_id: INVOICE_ID,
            agreement_id: AGREEMENT_ID,
            agreement_title: 'Kitchen Remodel Agreement',
            invoice_number: 'INV-20260329-0001',
            milestone_title: 'Cabinet Install',
            gross_amount: '3200.00',
          },
        ],
      });
    }

    if (pathname.includes('/api/projects/payouts/history')) {
      return json(route, {
        results: [
          {
            id: 991,
            agreement_id: AGREEMENT_ID,
            agreement_title: 'Kitchen Remodel Agreement',
            milestone_id: MILESTONE_ID,
            milestone_title: 'Cabinet Install',
            subcontractor_display_name: 'Accepted Sub',
            payout_amount: '600.00',
            payout_status: 'ready',
          },
        ],
        summary: {
          paid_amount: '900.00',
          ready_amount: '600.00',
          failed_amount: '0.00',
        },
      });
    }

    if (pathname.includes('/api/projects/subcontractors/invite') && method === 'POST') {
      return json(route, subcontractorInvitations[0], 201);
    }

    if (isExactPath(pathname, '/api/projects/subcontractors')) {
      return json(route, listBody(subcontractorDirectory));
    }

    if (isExactPath(pathname, '/api/projects/subcontractor-invitations')) {
      return json(route, listBody(subcontractorInvitations));
    }

    if (isExactPath(pathname, '/api/projects/subcontractor-assignments')) {
      return json(route, listBody(subcontractorAssignments));
    }

    if (isExactPath(pathname, '/api/projects/subcontractor-work-submissions')) {
      return json(route, listBody(subcontractorSubmissions));
    }

    if (pathname.includes('/api/projects/subcontractor-invitations/') && pathname.endsWith('/revoke/')) {
      return json(route, { detail: 'revoked' });
    }

    if (pathname.includes('/api/projects/subaccounts')) {
      return json(route, subaccounts);
    }

    if (pathname.includes('/api/projects/assignments/check-conflicts')) {
      return json(route, { ok: true, is_supervisor: false, conflicts: [], message: '' });
    }

    if (pathname.includes('/api/projects/assignments/agreements/') && pathname.endsWith('/status/')) {
      return json(route, { assigned_subaccounts: subaccounts.results });
    }

    if (pathname.includes('/api/projects/assignments/milestones/') && pathname.endsWith('/status/')) {
      return json(route, { override_subaccount: null });
    }

    if (pathname.includes('/api/projects/agreements/') && pathname.endsWith('/milestones/')) {
      return json(route, listBody(milestones));
    }

    if (isExactPath(pathname, '/api/projects/agreements')) {
      if (method === 'POST') {
        return json(route, agreement, 201);
      }
      return json(route, listBody(agreements));
    }

    if (pathname.includes(`/api/projects/agreements/${AGREEMENT_ID}`)) {
      return json(route, agreement);
    }

    if (pathname.includes('/api/projects/milestones') || pathname.includes('/api/milestones')) {
      if (/\/\d+\/?$/.test(pathname)) {
        return json(route, milestones[0]);
      }
      return json(route, listBody(milestones));
    }

    if (pathname.includes('/api/projects/invoices')) {
      if (/\/\d+\/?$/.test(pathname)) {
        return json(route, invoices[0]);
      }
      return json(route, listBody(invoices));
    }

    if (pathname.includes('/api/projects/warranties')) {
      return json(route, listBody([]));
    }

    if (pathname.includes('/api/projects/expense-requests')) {
      if (/\/\d+\/?$/.test(pathname)) {
        return json(route, expenseRequests[0]);
      }
      return json(route, listBody(expenseRequests));
    }

    if (pathname.includes('/api/projects/homeowners') || pathname.includes('/api/homeowners') || pathname.includes('/api/customers')) {
      return json(route, { count: homeowners.length, results: homeowners });
    }

    if (pathname.includes('/api/projects/compliance/profile-preview')) {
      return json(route, {
        state_code: 'TX',
        trade_requirements: [
          {
            required: true,
            insurance_required: true,
            message: 'Electrical work in Texas typically requires a state license. Upload a license document.',
            official_lookup_url: 'https://www.tdlr.texas.gov/electricians/',
            contractor_has_license_on_file: false,
            warning_level: 'warning',
            state_code: 'TX',
            trade_key: 'electrical',
          },
        ],
      });
    }

    if (method === 'GET') {
      return json(route, listBody([]));
    }

    return json(route, {});
  });
}

async function installDashboardMocks(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  await page.route('**/api/projects/whoami/', async (route) => {
    await json(route, {
      id: 7,
      type: 'contractor',
      role: 'contractor_owner',
      email: 'playwright@myhomebro.local',
    });
  });

  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await json(route, {
      onboarding_status: 'complete',
      connected: true,
    });
  });

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await json(route, {
      id: 77,
      created_at: '2026-03-01T10:00:00Z',
      ...contractorMe,
    });
  });

  await page.route(/\/api\/projects\/milestones\/?$/, async (route) => {
    await json(route, listBody(milestones));
  });

  await page.route(/\/api\/projects\/invoices\/?$/, async (route) => {
    await json(route, listBody(invoices));
  });

  await page.route(/\/api\/projects\/expense-requests\/?.*$/, async (route) => {
    await json(route, listBody([]));
  });

  await page.route(/\/api\/projects\/agreements\/?$/, async (route) => {
    await json(route, listBody(agreements));
  });

  await page.route('**/api/projects/dashboard/operations/', async (route) => {
    await json(route, {
      identity_type: 'contractor_owner',
      today: [],
      tomorrow: [],
      this_week: [],
      recent_activity: [],
      empty_states: {
        recent_activity: 'No recent worker activity yet.',
      },
    });
  });

  await page.route('**/api/projects/contractor/public-leads/', async (route) => {
    await json(route, listBody([{ id: 91, status: 'new', full_name: 'Casey Prospect' }]));
  });

  await page.route('**/api/projects/activity-feed/**', async (route) => {
    await json(route, {
      results: dashboardActivity,
      next_best_action: nextBestAction,
    });
  });
}

async function collectLayoutIssues(page) {
  return page.evaluate(() => {
    const issues = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 6) {
      issues.push('horizontal-overflow');
    }
    if (!document.querySelector('h1')) {
      issues.push('missing-h1');
    }
    return issues;
  });
}

async function mergeManifest(partial) {
  const manifestPath = path.join(OUT_DIR, 'capture-manifest.json');
  let manifest = {
    captured: [],
    failed: [],
    generated_at: new Date().toISOString(),
  };

  try {
    const existing = await fs.readFile(manifestPath, 'utf8');
    manifest = JSON.parse(existing);
  } catch {}

  const capturedMap = new Map((manifest.captured || []).map((item) => [item.label, item]));
  const failedMap = new Map((manifest.failed || []).map((item) => [item.label, item]));

  for (const item of partial.captured || []) {
    capturedMap.set(item.label, item);
    failedMap.delete(item.label);
  }
  for (const item of partial.failed || []) {
    if (!capturedMap.has(item.label)) {
      failedMap.set(item.label, item);
    }
  }

  manifest = {
    captured: Array.from(capturedMap.values()),
    failed: Array.from(failedMap.values()),
    generated_at: new Date().toISOString(),
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return manifestPath;
}

async function capturePageGroup(page, testInfo, configs) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await installMocks(page);
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => {
    console.error(`[visual-qa] pageerror: ${error.message}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error(`[visual-qa] console error: ${msg.text()}`);
    }
  });

  const captured = [];
  const failed = [];

  for (const config of configs) {
    try {
      await page.goto(config.url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const text = document?.body?.innerText || '';
        return text.trim().length > 0;
      });
      await config.waitFor(page);
      const issues = await collectLayoutIssues(page);
      const screenshotPath = path.join(OUT_DIR_REL, config.slug);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      captured.push({
        label: config.label,
        url: config.url,
        screenshot: screenshotPath,
        issues,
      });

      console.log(`[visual-qa] captured ${config.label} -> ${screenshotPath}`);
      if (issues.length) {
        console.warn(`[visual-qa] ${config.label} issues: ${issues.join(', ')}`);
      }
    } catch (error) {
      failed.push({
        label: config.label,
        url: config.url,
        error: error?.message || String(error),
      });
      console.error(`[visual-qa] failed ${config.label}: ${error?.message || error}`);
    }
  }
  const manifestPath = await mergeManifest({ captured, failed });
  await testInfo.attach('visual-qa-manifest', {
    path: manifestPath,
    contentType: 'application/json',
  });

  console.log(`[visual-qa] captured ${captured.length} page(s)`);
  console.log(`[visual-qa] failed ${failed.length} page(s)`);
  return { captured, failed };
}

test('capture agreement pages for visual QA review', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const result = await capturePageGroup(page, testInfo, agreementPageConfigs);
  expect(result.captured.length).toBeGreaterThan(0);
});

test('capture operations pages for visual QA review', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const result = await capturePageGroup(page, testInfo, operationsPageConfigs);
  expect(result.captured.length).toBeGreaterThan(0);
});

test('capture business and settings pages for visual QA review', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const result = await capturePageGroup(page, testInfo, businessPageConfigs);
  expect(result.captured.length).toBeGreaterThan(0);
});

test('capture contractor dashboard for visual QA review', async ({ page }) => {
  test.setTimeout(60000);
  await fs.mkdir(OUT_DIR, { recursive: true });
  await installDashboardMocks(page);

  await page.goto(dashboardConfig.url, { waitUntil: 'domcontentloaded' });
  await page.getByText('Needs Attention').first().waitFor({ state: 'visible' });

  const screenshotPath = path.join(OUT_DIR_REL, dashboardConfig.slug);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`[visual-qa] captured ${dashboardConfig.label} -> ${screenshotPath}`);
});
