import { expect, test } from "@playwright/test";

test("authenticated user can submit a support ticket and view it in My Tickets", async ({ page }) => {
  const createdTicket = {
    id: 501,
    ticket_number: "MHB-000501",
    submitted_by: 7,
    submitted_by_name: "Pat Owner",
    email: "playwright@myhomebro.local",
    user_role: "contractor_owner",
    subject: "Agreement needs help",
    category: "agreement_help",
    category_display: "Agreement Help",
    priority: "high",
    priority_display: "High",
    message: "Please review the latest agreement changes.",
    status: "open",
    status_display: "Open",
    related_object_type: "",
    related_object_id: "",
    related_object: null,
    attachment_url: "",
    attachment_name: "",
    created_at: "2026-04-21T14:20:00Z",
    updated_at: "2026-04-21T14:20:00Z",
    messages: [
      {
        id: 1,
        sender_display: "Pat Owner",
        sender_role_display: "User",
        sender_role: "user",
        message_text: "Please review the latest agreement changes.",
        is_internal: false,
        created_at: "2026-04-21T14:20:00Z",
      },
    ],
  };
  const repliedTicket = {
    ...createdTicket,
    updated_at: "2026-04-21T15:20:00Z",
    messages: [
      ...createdTicket.messages,
      {
        id: 2,
        sender_display: "Pat Owner",
        sender_role_display: "User",
        sender_role: "user",
        message_text: "Here is the follow-up details.",
        is_internal: false,
        created_at: "2026-04-21T15:20:00Z",
      },
    ],
  };

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
        charges_enabled: true,
        payouts_enabled: true,
      }),
    });
  });

  await page.route("**/api/notifications**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route("**/api/notifications/unread-count/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ count: 0 }),
    });
  });

  let supportTickets = [];

  await page.route("**/api/projects/support-tickets/**", async (route) => {
    const request = route.request();
    const url = request.url();

    if (request.method() === "POST" && url.endsWith("/api/projects/support-tickets/")) {
      supportTickets = [createdTicket];
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(createdTicket),
      });
      return;
    }

    if (request.method() === "GET" && /\/api\/projects\/support-tickets\/MHB-\d+\/?$/.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(supportTickets.find((ticket) => ticket.ticket_number === createdTicket.ticket_number) || createdTicket),
      });
      return;
    }

    if (request.method() === "POST" && /\/api\/projects\/support-tickets\/MHB-\d+\/reply\/?$/.test(url)) {
      supportTickets = [repliedTicket];
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(repliedTicket),
      });
      return;
    }

    if (request.method() === "GET" && url.endsWith("/api/projects/support-tickets/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ results: supportTickets }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/app/support", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("open-support-request-button")).toBeVisible();
  await page.getByTestId("open-support-request-button").click();

  await expect(page.getByTestId("support-request-modal")).toBeVisible();
  await expect(page.getByTestId("support-email-input")).toHaveValue("playwright@myhomebro.local");

  await page.getByTestId("support-subject-input").fill("Agreement needs help");
  await page.getByTestId("support-category-select").selectOption("agreement_help");
  await page.getByTestId("support-priority-select").selectOption("high");
  await page.getByTestId("support-message-input").fill("Please review the latest agreement changes.");
  await page.getByTestId("support-submit-button").click();

  await expect(page.getByTestId("support-request-success")).toBeVisible();
  await expect(page.getByTestId("support-ticket-number")).toContainText(createdTicket.ticket_number);
  await expect(page.getByText("We sent a confirmation email to playwright@myhomebro.local.")).toBeVisible();

  await page.getByRole("button", { name: "View My Tickets" }).click();

  await expect(page).toHaveURL("/app/support");
  await expect(page.getByTestId(`support-ticket-row-${createdTicket.ticket_number}`)).toBeVisible();

  await page.getByTestId(`support-ticket-row-${createdTicket.ticket_number}`).click();
  await expect(page).toHaveURL(`/app/support/${createdTicket.ticket_number}`);
  await expect(page.getByTestId("support-ticket-detail")).toContainText(createdTicket.ticket_number);
  await expect(page.getByTestId("support-ticket-detail")).toContainText("Agreement Help");
  await expect(page.getByTestId("support-ticket-detail")).toContainText("Conversation");
  await page.getByTestId("support-ticket-add-reply-button").click();
  await expect(page.getByTestId("support-ticket-reply-input")).toBeVisible();
  await page.getByTestId("support-ticket-reply-input").fill("Here is the follow-up details.");
  await page.getByTestId("support-ticket-submit-reply-button").click();
  await expect(page.getByTestId("support-ticket-detail")).toContainText("Here is the follow-up details.");
  await expect(page.getByTestId("support-ticket-detail")).toContainText("Conversation");
});
