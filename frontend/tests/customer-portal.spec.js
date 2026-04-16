import { expect, test } from "@playwright/test";

const portalPayload = {
  customer: {
    name: "Pat Customer",
    email: "customer@example.com",
  },
  summary: {
    active_requests: 1,
    bids_received: 3,
    active_agreements: 1,
    payments: 2,
    documents: 1,
  },
  requests: [
    {
      id: "request-1",
      project_title: "Kitchen Remodel",
      project_class_label: "Commercial",
      latest_activity: "2026-04-15T14:00:00Z",
      bids_count: 1,
      status: "submitted",
      status_label: "Submitted",
      action_target: "",
      notes: "Need a commercial remodel.",
    },
    {
      id: "request-2",
      project_title: "Office Fitout",
      project_class_label: "Commercial",
      latest_activity: "2026-04-15T15:30:00Z",
      bids_count: 2,
      status: "submitted",
      status_label: "Submitted",
      action_target: "",
      notes: "Need an office fitout.",
      action_label: "Compare bids",
      comparison_key: "compare-key",
    },
  ],
  bids: [
    {
      id: "lead-1",
      bid_id: 1,
      project_title: "Kitchen Remodel",
      contractor_name: "Builder Co",
      project_class_label: "Commercial",
      bid_amount_label: "$15,000.00",
      submitted_at: "2026-04-15T15:00:00Z",
      status: "awarded",
      status_label: "Awarded",
      status_group: "awarded",
      next_action: { label: "Open Agreement" },
      action_target: "/agreements/magic/portal-token",
      linked_agreement_id: 10,
      linked_agreement_token: "portal-token",
      comparison_key: "kitchen-key",
      notes: "Commercial remodel bid.",
    },
    {
      id: "lead-2",
      bid_id: 2,
      project_title: "Office Fitout",
      contractor_name: "Builder Co",
      project_class_label: "Commercial",
      bid_amount_label: "$22,000.00",
      submitted_at: "2026-04-15T15:20:00Z",
      status: "submitted",
      status_label: "Submitted",
      status_group: "open",
      next_action: { label: "Review Bid" },
      comparison_key: "compare-key",
      request_title: "Office Fitout",
      request_address: "200 Market St, Austin, TX 78701",
      timeline: "Q2",
      proposal_summary: "Office fitout bid from Builder Co.",
      payment_structure_summary: "Bid summary",
      milestone_preview: ["Demo", "Buildout", "Closeout"],
      can_accept: true,
    },
    {
      id: "lead-3",
      bid_id: 3,
      project_title: "Office Fitout",
      contractor_name: "Partner Co",
      project_class_label: "Commercial",
      bid_amount_label: "$20,500.00",
      submitted_at: "2026-04-15T15:25:00Z",
      status: "submitted",
      status_label: "Submitted",
      status_group: "open",
      next_action: { label: "Review Bid" },
      comparison_key: "compare-key",
      request_title: "Office Fitout",
      request_address: "200 Market St, Austin, TX 78701",
      timeline: "Q2",
      proposal_summary: "Office fitout bid from Partner Co.",
      payment_structure_summary: "Bid summary",
      milestone_preview: ["Demo", "Buildout", "Closeout"],
      can_accept: true,
    },
  ],
  agreements: [
    {
      id: 1,
      project_title: "Kitchen Remodel",
      contractor_name: "Builder Co",
      project_class_label: "Commercial",
      status_label: "Signed",
      is_fully_signed: true,
      updated_at: "2026-04-15T16:00:00Z",
      agreement_token: "portal-token",
      action_target: "/agreements/magic/portal-token",
      pdf_url: "/files/agreement.pdf",
      payment_mode: "escrow",
      total_cost: "15000.00",
    },
  ],
  payments: [
    {
      id: "invoice-1",
      project_title: "Kitchen Remodel",
      record_type_label: "Invoice",
      date: "2026-04-15T16:30:00Z",
      amount_label: "$15,000.00",
      status_label: "Paid",
      action_target: "/invoice/portal-invoice-token",
      reference: "INV-20260415-0001",
      notes: "Escrow release",
    },
    {
      id: "draw-1",
      project_title: "Kitchen Remodel",
      record_type_label: "Draw",
      date: "2026-04-15T17:00:00Z",
      amount_label: "$11,400.00",
      status_label: "Paid",
      action_target: "/draws/magic/portal-draw-token",
      reference: "tr_portal_draw",
      notes: "Released draw",
    },
  ],
  documents: [
    {
      id: "document-1",
      title: "Scope Addendum",
      type_label: "Addendum",
      project_title: "Kitchen Remodel",
      date: "2026-04-15T16:45:00Z",
      url: "/files/scope-addendum.txt",
    },
  ],
};

const acceptedPortalPayload = {
  ...portalPayload,
  summary: {
    ...portalPayload.summary,
    active_agreements: 2,
  },
  bids: portalPayload.bids.map((bid) => {
    if (bid.id === "lead-2") {
      return {
        ...bid,
        status: "awarded",
        status_label: "Awarded",
        status_group: "awarded",
        linked_agreement_id: 11,
        linked_agreement_token: "office-agreement-token",
      };
    }
    if (bid.id === "lead-3") {
      return {
        ...bid,
        status: "expired",
        status_label: "Not Selected",
        status_group: "declined_expired",
        status_note: "Another contractor was selected for this project.",
      };
    }
    return bid;
  }),
  requests: portalPayload.requests.map((request) => {
    if (request.id === "request-2") {
      return {
        ...request,
        action_label: "Open Agreement",
        action_target: "/agreements/magic/office-agreement-token",
        agreement_id: 11,
        agreement_token: "office-agreement-token",
      };
    }
    return request;
  }),
};

test("customer portal is reachable from the landing page and loads secure records", async ({
  page,
}) => {
  const consoleErrors = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "customer-portal-token");
  });

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  await page.route("**/api/projects/customer-portal/**", async (route) => {
    const requestUrl = route.request().url();
    const method = route.request().method();

    if (requestUrl.endsWith("/request-link/") && method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          detail: "If we found records for that email, we sent a secure portal link.",
          link_sent: true,
        }),
      });
      return;
    }

    if (method === "GET" && requestUrl.includes("/customer-portal/customer-token/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(portalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/bids/") && requestUrl.endsWith("/accept/") && method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          created: true,
          agreement_id: 11,
          detail_url: "/agreements/magic/office-agreement-token",
          wizard_url: "/app/agreements/11/wizard?step=1",
          portal: acceptedPortalPayload,
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("landing-hero-heading")).toContainText("Start your project with MyHomeBro");
  await expect(page.getByTestId("landing-customer-portal-button")).toHaveText("View Your Project");
  await expect(page.getByRole("button", { name: "Join MyHomeBro" })).toBeVisible();
  await expect(page.getByText("For Contractors")).toBeVisible();

  await page.getByTestId("landing-customer-portal-button").click();
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByText("MyHomeBro Records")).toBeVisible();
  await expect(page.getByTestId("customer-portal-email-input")).toBeVisible();

  await page.getByTestId("customer-portal-email-input").fill("customer@example.com");
  await page.getByTestId("customer-portal-send-link-button").click();
  await expect(page.getByTestId("customer-portal-link-sent")).toBeVisible();

  await page.goto("/portal/customer-token", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("customer-portal-summary")).toBeVisible();
  await expect(page.getByTestId("customer-portal-summary-active-requests")).toContainText("1");
  await expect(page.getByTestId("customer-portal-summary-bids")).toContainText("3");
  await expect(page.getByTestId("customer-portal-summary-agreements")).toContainText("1");
  await expect(page.getByTestId("customer-portal-summary-payments")).toContainText("2");
  await expect(page.getByTestId("customer-portal-summary-documents")).toContainText("1");

  await expect(page.getByTestId("customer-portal-requests")).toContainText("Kitchen Remodel");
  await expect(page.getByTestId("customer-portal-bids")).toContainText("Builder Co");
  await expect(page.getByTestId("customer-portal-bids")).toContainText("Partner Co");
  await expect(page.getByTestId("customer-portal-agreements")).toContainText("Kitchen Remodel");
  await expect(page.getByTestId("customer-portal-payments")).toContainText("Invoice");
  await expect(page.getByTestId("customer-portal-documents")).toContainText("Scope Addendum");

  await page.getByTestId("customer-portal-requests-row-request-1").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Request details");
  await expect(page.getByRole("dialog")).toContainText("Latest Activity");
  await page.getByRole("button", { name: "Close modal" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByTestId("customer-portal-compare-bids-button").click();
  await expect(page.getByRole("dialog")).toContainText("Compare bids");
  await expect(page.getByRole("dialog")).toContainText("Office Fitout");
  await expect(page.getByRole("dialog")).toContainText("Partner Co");
  await page.getByTestId("customer-portal-compare-accept-lead-2").click();

  await expect(page.getByTestId("customer-portal-compare-open-lead-2")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Not Selected");
  await expect(page.getByRole("dialog")).toContainText("Another contractor was selected for this project.");
  await page.getByRole("button", { name: "Close modal" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.screenshot({ path: "test-results/customer-portal.png", fullPage: true });

  expect(consoleErrors.filter((msg) => msg.includes("We could not open that portal link"))).toHaveLength(0);
});
