import { expect, test } from "@playwright/test";

function makeNotification(overrides = {}) {
  return {
    id: overrides.id ?? 1,
    category: overrides.category ?? "agreement_signed",
    category_label: overrides.category_label ?? "Agreement Signed",
    title: overrides.title ?? "Agreement signed",
    body: overrides.body ?? "A customer signed the agreement.",
    action_label: overrides.action_label ?? "Open Agreement",
    action_url: overrides.action_url ?? "/app/agreements/321",
    created_at: overrides.created_at ?? "2026-04-15T15:30:00Z",
    is_read: overrides.is_read ?? false,
    action_needed: overrides.action_needed ?? false,
  };
}

async function mockAuthenticatedShell(page, notifications = [], options = {}) {
  let rows = notifications.map((notification, index) => makeNotification({ id: index + 1, ...notification }));
  const opportunityRows = Array.isArray(options.opportunityRows) ? options.opportunityRows : [];

  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  await page.route("**/api/projects/whoami/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 7,
        type: "contractor",
        role: "contractor_owner",
        email: "playwright@myhomebro.local",
      }),
    });
  });

  await page.route("**/api/payments/onboarding/status/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        onboarding_status: "complete",
        connected: true,
      }),
    });
  });

  await page.route("**/api/projects/contractors/me/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 77,
        created_at: "2026-03-01T10:00:00Z",
      }),
    });
  });

  await page.route("**/api/projects/dashboard/operations/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        identity_type: "contractor_owner",
        today: [],
        tomorrow: [],
        this_week: [],
        recent_activity: [],
        empty_states: {
          recent_activity: "No recent worker activity yet.",
        },
      }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/reviewer-queue\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ count: 0, groups: [] }),
    });
  });

  await page.route(/\/api\/projects\/invoices\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/draws\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/contractor\/payout-history\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [], summary: {} }),
    });
  });

  await page.route(/\/api\/projects\/expense-requests\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/contractor\/bids\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route("**/api/projects/homeowners/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route("**/api/projects/activity-feed/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [],
        next_best_action: null,
      }),
    });
  });

  await page.route(/\/api\/projects\/contractor-activation-summary\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ guide_sections: {} }),
    });
  });

  await page.route(/\/api\/projects\/contractor\/public-leads\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: opportunityRows }),
    });
  });

  await page.route(/\/api\/projects\/contractor-opportunities\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: opportunityRows,
        summary: {
          website_leads: opportunityRows.filter((row) => row.is_website_lead).length,
          new_website_leads: opportunityRows.filter((row) => row.is_website_lead && row.workspace_stage === "new_lead").length,
          website_leads_needing_follow_up: opportunityRows.filter(
            (row) => row.is_website_lead && ["new_lead", "follow_up"].includes(row.workspace_stage)
          ).length,
        },
      }),
    });
  });

  await page.route("**/api/notifications**", async (route) => {
    if (route.request().method() === "GET") {
      const url = new URL(route.request().url());
      const limit = Number(url.searchParams.get("limit") || rows.length || 10);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rows.slice(0, limit)),
      });
      return;
    }
    await route.continue();
  });

  await page.route("**/api/notifications/unread-count/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        count: rows.filter((notification) => !notification.is_read).length,
      }),
    });
  });

  await page.route("**/api/notifications/*/read/", async (route) => {
    const match = route.request().url().match(/\/api\/notifications\/(\d+)\/read\/?$/);
    const id = match ? Number(match[1]) : null;
    if (id) {
      rows = rows.map((notification) => (notification.id === id ? { ...notification, is_read: true } : notification));
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(rows.find((notification) => notification.id === id) || null),
    });
  });

  await page.route("**/api/notifications/mark-all-read/", async (route) => {
    rows = rows.map((notification) => ({ ...notification, is_read: true }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, updated: notifications.length }),
    });
  });
}

test("authenticated shell renders notifications bell and dropdown panel", async ({ page }) => {
  await mockAuthenticatedShell(page, [
    makeNotification({
      id: 1,
      category: "quote_request_received",
      category_label: "Quote Request Received",
      title: "New quote request",
      body: "Jordan Prospect submitted a quote request for Kitchen Remodel.",
      action_label: "Review Request",
      action_url: "/app/opportunities",
      action_needed: true,
      is_read: false,
    }),
    makeNotification({
      id: 2,
      category: "agreement_signed",
      category_label: "Agreement Signed",
      title: "Agreement signed",
      body: "The customer signed the agreement.",
      action_label: "Open Agreement",
      action_url: "/app/agreements/321",
      is_read: false,
    }),
    makeNotification({
      id: 3,
      category: "payment_released",
      category_label: "Payment Released",
      title: "Payment released",
      body: "Funds were released for invoice INV-102.",
      action_label: "View Payment",
      action_url: "/app/invoices/77",
      is_read: true,
    }),
  ]);

  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });

  const bell = page.getByTestId("notifications-bell-button");
  await expect(bell).toBeVisible();
  await expect(page.getByTestId("notifications-unread-badge")).toHaveText("2");

  await bell.click();
  const panel = page.getByTestId("notifications-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("New quote request");
  await expect(panel).toContainText("Agreement signed");
  await expect(panel).toContainText("Payment released");
  await expect(panel.getByTestId("notification-item-1")).toContainText("Action Needed");
  await expect(panel.getByTestId("notifications-dropdown-view-all")).toHaveAttribute("href", "/app/notifications");

  await panel.getByTestId("notification-item-1").click();
  await expect(page).toHaveURL(/\/app\/opportunities$/);
});

test("notifications page groups items and deep-links to targets", async ({ page }) => {
  const datedAt = (daysAgo, hour = 15) => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    date.setHours(hour, 30, 0, 0);
    return date.toISOString();
  };

  await mockAuthenticatedShell(page, [
    makeNotification({
      id: 11,
      category: "milestone_pending_approval",
      category_label: "Milestone Pending Approval",
      title: "Milestone waiting on review",
      body: "Bathroom Demo is waiting for approval.",
      action_label: "Review Work",
      action_url: "/app/reviewer/queue",
      action_needed: true,
      created_at: datedAt(0),
      is_read: false,
    }),
    makeNotification({
      id: 12,
      category: "agreement_signed",
      category_label: "Agreement Signed",
      title: "Agreement signed yesterday",
      body: "Customer signed the agreement.",
      action_label: "Open Agreement",
      action_url: "/app/agreements/321",
      created_at: datedAt(2, 10),
      is_read: true,
    }),
    makeNotification({
      id: 13,
      category: "escrow_funded",
      category_label: "Escrow Funded",
      title: "Escrow funded last week",
      body: "Escrow funds were received for this agreement.",
      action_label: "Open Agreement",
      action_url: "/app/agreements/444",
      created_at: datedAt(10, 10),
      is_read: true,
    }),
  ]);

  await page.goto("/app/notifications", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("notifications-page")).toBeVisible();
  await expect(page.getByTestId("notifications-group-today")).toContainText("Milestone waiting on review");
  await expect(page.getByTestId("notifications-group-earlier-this-week")).toContainText("Agreement signed yesterday");
  await expect(page.getByTestId("notifications-group-older")).toContainText("Escrow funded last week");

  await page.getByTestId("notifications-filter-unread").click();
  await expect(page.getByTestId("notifications-group-today")).toContainText("Milestone waiting on review");
  await expect(page.getByTestId("notifications-group-earlier-this-week")).toHaveCount(0);

  await page.getByTestId("notifications-filter-all").click();
  await page.getByTestId("notification-item-11").click();
  await expect(page).toHaveURL(/\/app\/reviewer\/queue$/);
});
