import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 321;

test('agreement detail creates and renders subcontractor invitations', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
    Object.assign(navigator, {
      clipboard: {
        writeText: async () => {},
      },
    });
  });

  const invitationState = {
    pending: [],
    accepted: [
      {
        id: 77,
        invite_email: 'accepted-sub@example.com',
        invite_name: 'Accepted Subcontractor',
        accepted_name: 'Accepted Subcontractor',
        accepted_at: '2026-03-20T12:00:00Z',
        invite_url: 'http://localhost:4173/subcontractor-invitations/accept/accepted-token',
      },
    ],
  };

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

  await page.route(new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: AGREEMENT_ID,
        title: 'Kitchen Remodel Agreement',
        project_title: 'Kitchen Remodel Agreement',
        homeowner_name: 'Jordan Demo',
        homeowner_email: 'jordan@example.com',
        total_cost: '12000.00',
        payment_mode: 'escrow',
        status: 'signed',
        signed_by_contractor: true,
        signed_by_homeowner: true,
        escrow_funded: false,
        invoices: [],
        milestones: [],
        pdf_versions: [],
      }),
    });
  });

  await page.route('**/api/projects/agreements/321/funding_preview/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project_amount: '12000.00',
        platform_fee: '361.00',
        contractor_payout: '11639.00',
        homeowner_escrow: '12361.00',
        rate: 0.03,
        is_intro: false,
        tier_name: 'starter',
        high_risk_applied: false,
      }),
    });
  });

  await page.route('**/api/projects/warranties/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/api/projects/agreements/321/subcontractor-invitations/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          agreement_id: AGREEMENT_ID,
          pending_invitations: invitationState.pending,
          accepted_subcontractors: invitationState.accepted,
        }),
      });
      return;
    }

    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      const created = {
        id: 88,
        invite_email: body.invite_email,
        invite_name: body.invite_name,
        invited_message: body.invited_message,
        invited_at: '2026-03-23T14:00:00Z',
        status: 'pending',
        invite_url: 'http://localhost:4173/subcontractor-invitations/accept/test-token',
      };
      invitationState.pending = [created];
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto(`/app/agreements/${AGREEMENT_ID}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('subcontractor-section')).toBeVisible();
  await expect(page.getByTestId('accepted-subcontractor-77')).toContainText(
    'Accepted Subcontractor'
  );

  await page.getByTestId('invite-subcontractor-button').click();
  await page.getByTestId('subcontractor-email-input').fill('pending-sub@example.com');
  await page.getByTestId('subcontractor-submit-button').click();

  await expect(page.getByTestId('pending-subcontractor-88')).toContainText(
    'pending-sub@example.com'
  );
});

test('subcontractor invitation acceptance page renders and accepts a valid token', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  let accepted = false;

  await page.route('**/api/projects/subcontractor-invitations/accept/test-token/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'test-token',
          status: accepted ? 'accepted' : 'pending',
          invite_email: 'subcontractor@example.com',
          invite_name: 'Taylor Sub',
          invited_message: 'Please collaborate on trim work.',
          invited_at: '2026-03-23T14:00:00Z',
          accepted_at: accepted ? '2026-03-23T15:00:00Z' : null,
          agreement: {
            id: AGREEMENT_ID,
            title: 'Kitchen Remodel Agreement',
          },
          contractor: {
            id: 12,
            business_name: 'Builder Bros',
          },
          email_match: true,
          signed_in: true,
          invite_url: 'http://localhost:4173/subcontractor-invitations/accept/test-token',
        }),
      });
      return;
    }

    if (route.request().method() === 'POST') {
      accepted = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          invitation: {
            status: 'accepted',
            accepted_at: '2026-03-23T15:00:00Z',
          },
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto('/subcontractor-invitations/accept/test-token', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('subcontractor-invite-title')).toBeVisible();
  await expect(page.getByText('Kitchen Remodel Agreement')).toBeVisible();
  await page.getByTestId('subcontractor-invite-accept-button').click();
  await expect(page.getByTestId('subcontractor-invite-accepted')).toBeVisible();
});
