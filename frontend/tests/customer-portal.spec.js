import { expect, test } from "@playwright/test";

const portalPayload = {
  customer: {
    name: "Pat Customer",
    email: "customer@example.com",
  },
  summary: {
    active_requests: 1,
    active_projects: 1,
    bids_received: 3,
    active_agreements: 1,
    payments: 4,
    documents: 1,
  },
  property_profile: {
    id: 1,
    customer_email: "customer@example.com",
    display_name: "Kitchen Remodel",
    property_type: "single_family",
    property_type_label: "Single Family",
    address_line1: "123 Main St",
    city: "Austin",
    state: "TX",
    postal_code: "78701",
    address: "123 Main St, Austin, TX, 78701",
    documents: [],
    photos: [],
  },
  projects: [
    {
      id: 1,
      project_number: "PRJ-20260415-001",
      title: "Kitchen Remodel",
      description: "Primary project",
      status: "active",
      status_label: "Active",
      address: "123 Main St, Austin, TX 78701",
      contractor_name: "Builder Co",
      agreement_id: 1,
      agreement_token: "portal-token",
      agreement_url: "/agreements/magic/portal-token",
      total_cost: "15000.00",
      milestones: [{ id: 1, title: "Demo", status: "active", amount: "5000.00" }],
      updates: [
        {
          id: 501,
          milestone_title: "Demo",
          author: "Builder Co",
          body: "Demo is complete and final walkthrough is ready for review.",
          created_at: "2026-04-16T11:00:00Z",
        },
      ],
    },
  ],
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
      payment_mode_label: "Escrow",
      total_cost: "15000.00",
      warranty_text: "One-year workmanship warranty for covered remodel labor.",
    },
  ],
  payments: [
    {
      id: "invoice-1",
      project_title: "Kitchen Remodel",
      contractor_name: "Builder Co",
      payment_mode: "escrow",
      payment_mode_label: "Escrow",
      record_type_label: "Invoice",
      record_type: "invoice",
      date: "2026-04-15T16:30:00Z",
      amount_label: "$15,000.00",
      status_label: "Paid",
      status: "paid",
      action_target: "/invoice/portal-invoice-token",
      reference: "INV-20260415-0001",
      invoice_number: "INV-20260415-0001",
      dispute_status: "none",
      dispute_status_label: "No dispute",
      notes: "Escrow release",
    },
    {
      id: "invoice-2",
      project_title: "Kitchen Remodel",
      contractor_name: "Builder Co",
      payment_mode: "direct",
      payment_mode_label: "Direct Pay",
      record_type_label: "Invoice",
      record_type: "invoice",
      date: "2026-04-16T09:00:00Z",
      due_date: "2026-04-20T09:00:00Z",
      amount: "1200.00",
      amount_label: "$1,200.00",
      status: "pending",
      status_label: "Pending",
      action_target: "/invoice/portal-invoice-pay-token",
      reference: "INV-20260416-0002",
      invoice_number: "INV-20260416-0002",
      dispute_status: "none",
      dispute_status_label: "No dispute",
      notes: "Direct pay invoice awaiting payment.",
    },
    {
      id: "draw-1",
      project_title: "Kitchen Remodel",
      record_type_label: "Draw",
      record_type: "draw_request",
      date: "2026-04-15T17:00:00Z",
      amount_label: "$11,400.00",
      status_label: "Paid",
      status: "paid",
      action_target: "/draws/magic/portal-draw-token",
      reference: "tr_portal_draw",
      record_id: 1,
      dispute_status: "none",
      dispute_status_label: "No dispute",
      notes: "Released draw",
    },
    {
      id: "draw-2",
      record_id: 2,
      project_title: "Kitchen Remodel",
      record_type_label: "Draw",
      record_type: "draw_request",
      date: "2026-04-16T10:00:00Z",
      amount: "3600.00",
      amount_label: "$3,600.00",
      status: "submitted",
      status_label: "Submitted",
      action_target: "/draws/magic/portal-draw-review-token",
      reference: "draw_review_2",
      dispute_status: "none",
      dispute_status_label: "No dispute",
      notes: "Final walkthrough release is ready for review.",
    },
  ],
  documents: [
    {
      id: "document-1",
      title: "Scope Addendum",
      type_label: "Addendum",
      project_title: "Kitchen Remodel",
      filename: "scope-addendum.txt",
      date: "2026-04-15T16:45:00Z",
      url: "/files/scope-addendum.txt",
    },
  ],
  notifications: [
    {
      id: 101,
      event_type: "agreement_needs_signature",
      channel: "in_app",
      status: "unread",
      title: "Agreement needs signature",
      message: "Kitchen Remodel is waiting for a customer signature.",
      action_url: "/agreements/magic/portal-token",
      created_at: "2026-04-15T18:00:00Z",
    },
    {
      id: 102,
      event_type: "payment_received",
      channel: "in_app",
      status: "read",
      title: "Payment received",
      message: "A payment was received for Kitchen Remodel.",
      action_url: "/agreements/magic/portal-token",
      created_at: "2026-04-15T17:00:00Z",
    },
  ],
};

const uploadedPortalPayload = {
  ...portalPayload,
  summary: {
    ...portalPayload.summary,
    documents: 2,
  },
  documents: [
    {
      id: "property-document-9",
      title: "Water heater warranty",
      type_label: "Warranty",
      project_title: "Kitchen Remodel",
      filename: "water-heater-warranty.pdf",
      date: "2026-04-16T12:00:00Z",
      url: "/files/water-heater-warranty.pdf",
    },
    ...portalPayload.documents,
  ],
  property_profile: {
    ...portalPayload.property_profile,
    documents: [
      {
        id: "property-document-9",
        title: "Water heater warranty",
        type_label: "Warranty",
        filename: "water-heater-warranty.pdf",
        date: "2026-04-16T12:00:00Z",
        url: "/files/water-heater-warranty.pdf",
      },
    ],
  },
};

const notificationReadPortalPayload = {
  ...portalPayload,
  notifications: portalPayload.notifications.map((notification) =>
    notification.id === 101 ? { ...notification, status: "read" } : notification
  ),
};

const disputedPortalPayload = {
  ...portalPayload,
  payments: portalPayload.payments.map((payment) =>
    payment.id === "draw-2"
      ? {
          ...payment,
          dispute_status: "open",
          dispute_status_label: "Dispute opened",
          dispute_url: "/disputes/7702?token=draw-dispute-token",
        }
      : payment
  ),
};

const emptyPortalPayload = {
  customer: {
    name: "Empty Customer",
    email: "empty@example.com",
  },
  summary: {
    active_requests: 0,
    active_projects: 0,
    bids_received: 0,
    active_agreements: 0,
    payments: 0,
    documents: 0,
  },
  property_profile: {
    id: 2,
    customer_email: "empty@example.com",
    display_name: "",
    property_type: "single_family",
    property_type_label: "Single Family",
    address_line1: "",
    city: "",
    state: "",
    postal_code: "",
    address: "",
    documents: [],
    photos: [],
  },
  projects: [],
  requests: [],
  bids: [],
  agreements: [],
  payments: [],
  documents: [],
  notifications: [],
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

    if (method === "GET" && requestUrl.includes("/customer-portal/empty-token/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptyPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/property/documents/") && method === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(uploadedPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/notifications/101/read/") && method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(notificationReadPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/draws/2/dispute/") && method === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          dispute: {
            id: 7702,
            status: "open",
            status_label: "Dispute opened",
            public_url: "/disputes/7702?token=draw-dispute-token",
          },
          portal: disputedPortalPayload,
        }),
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
  await expect(page.getByTestId("landing-hero-heading")).toContainText("Everything you need to plan, hire, and manage your project.");
  await expect(page.getByTestId("landing-customer-portal-button")).toContainText("View Your Project");
  await expect(page.getByRole("button", { name: "Contractor Sign Up" })).toBeVisible();
  await expect(page.getByRole("button", { name: "For Contractors" })).toBeVisible();
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: "Terms of Service" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "Terms of Service" })).toHaveAttribute(
    "href",
    "/legal/terms-of-service/"
  );
  await expect(footer.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
    "href",
    "/legal/privacy-policy/"
  );

  await page.getByTestId("landing-customer-portal-button").click();
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByText("MyHomeBro Records")).toBeVisible();
  await expect(page.getByTestId("customer-portal-email-input")).toBeVisible();

  await page.getByTestId("customer-portal-email-input").fill("customer@example.com");
  await page.getByTestId("customer-portal-send-link-button").click();
  await expect(page.getByTestId("customer-portal-link-sent")).toBeVisible();

  await page.goto("/portal/customer-token", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("customer-dashboard")).toBeVisible();
  await expect(page.getByText("MyHomeBro Records")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Customer Workspace" })).toBeVisible();
  await expect(page.getByTestId("customer-portal-summary")).toBeVisible();
  await expect(page.getByTestId("customer-portal-summary-active-requests")).toContainText("1");
  await expect(page.getByTestId("customer-portal-summary-agreements")).toContainText("1");
  await expect(page.getByTestId("customer-portal-summary-payments")).toContainText("4");
  await expect(page.getByTestId("customer-portal-summary-documents")).toContainText("1");
  await expect(page.getByTestId("customer-notifications-panel")).toContainText("Agreement needs signature");
  await expect(page.getByTestId("customer-notifications-panel")).toContainText("Payment received");
  await expect(page.getByTestId("customer-notifications-unread-count")).toContainText("1 unread");
  await page.getByTestId("customer-notification-mark-read-101").click();
  await expect(page.getByTestId("customer-notifications-unread-count")).toContainText("0 unread");
  await expect(page.getByTestId("customer-notification-101")).not.toContainText("Unread");

  await page.getByTestId("customer-dashboard-tab-requests").click();
  await expect(page.getByTestId("customer-portal-requests")).toContainText("Kitchen Remodel");
  await expect(page.getByTestId("customer-portal-bids")).toContainText("Builder Co");
  await expect(page.getByTestId("customer-portal-bids")).toContainText("Partner Co");

  await page.getByTestId("customer-dashboard-tab-projects").click();
  await expect(page.getByTestId("customer-project-workspace")).toContainText("Kitchen Remodel");
  await page.getByTestId("customer-project-card-1").click();
  await expect(page.getByTestId("customer-rich-project-workspace")).toContainText("Track your project from agreement to completion.");
  await expect(page.getByTestId("customer-project-needs-attention")).toContainText("Review the completed work");
  await expect(page.getByTestId("customer-project-review-draw-2")).toContainText("$3,600.00");
  await expect(page.getByTestId("customer-project-review-dispute-draw-2")).toContainText("Open Dispute");
  await page.getByTestId("customer-project-review-dispute-draw-2").click();
  await expect(page.getByTestId("customer-project-review-dispute-form-draw-2")).toContainText("Tell us what is wrong");
  await page.getByTestId("customer-project-review-dispute-form-draw-2").getByLabel("Homeowner note").fill("The walkthrough items are not complete yet.");
  await page.getByTestId("customer-project-review-dispute-form-draw-2").getByRole("button", { name: "Open Dispute" }).click();
  await expect(page.getByTestId("customer-project-review-draw-2")).toContainText("Dispute opened");
  await expect(page.getByTestId("customer-project-review-dispute-draw-2")).toContainText("Track Issue Status");
  await expect(page.getByTestId("customer-project-review-dispute-draw-2")).toHaveAttribute("href", "/disputes/7702?token=draw-dispute-token");
  await expect(page.getByTestId("customer-project-payments")).toContainText("Review payments before funds are released.");
  await expect(page.getByTestId("customer-project-payment-draw-2")).toContainText("Dispute opened");
  await expect(page.getByTestId("customer-project-payment-track-dispute-draw-2")).toHaveAttribute("href", "/disputes/7702?token=draw-dispute-token");
  await expect(page.getByTestId("customer-project-payment-invoice-2")).toContainText("INV-20260416-0002");
  await expect(page.getByTestId("customer-project-payment-primary-invoice-2")).toContainText("Pay Invoice");
  await expect(page.getByTestId("customer-project-payment-view-invoice-invoice-2")).toHaveAttribute("href", "/invoices/magic/portal-invoice-pay-token");
  await expect(page.getByTestId("customer-project-payment-dispute-invoice-2")).toHaveAttribute("href", "/invoices/magic/portal-invoice-pay-token?action=dispute");
  await expect(page.getByTestId("customer-project-documents")).toContainText("Scope Addendum");
  await expect(page.getByTestId("customer-project-agreement-summary")).toContainText("One-year workmanship warranty");
  await expect(page.getByTestId("customer-project-updates")).toContainText("Demo is complete and final walkthrough is ready for review.");

  await page.getByTestId("customer-dashboard-tab-payments").click();
  await expect(page.getByTestId("customer-portal-payments")).toContainText("Payments Action Center");
  await expect(page.getByTestId("customer-payment-action-invoice-2")).toContainText("Direct Pay");
  await expect(page.getByTestId("customer-payment-primary-invoice-2")).toContainText("Pay Invoice");
  await expect(page.getByTestId("customer-payment-view-invoice-invoice-2")).toHaveAttribute("href", "/invoices/magic/portal-invoice-pay-token");
  await expect(page.getByTestId("customer-payment-open-dispute-invoice-2")).toHaveAttribute("href", "/invoices/magic/portal-invoice-pay-token?action=dispute");
  await expect(page.getByTestId("customer-payment-action-draw-2")).toContainText("Review Release");
  await expect(page.getByTestId("customer-payment-action-draw-2")).toContainText("Dispute opened");
  await expect(page.getByTestId("customer-payment-track-dispute-draw-2")).toHaveAttribute("href", "/disputes/7702?token=draw-dispute-token");
  await expect(page.getByTestId("customer-payment-action-invoice-1")).toContainText("View Record");

  await page.getByTestId("customer-dashboard-tab-overview").click();
  await expect(page.getByTestId("customer-dashboard-overview")).toContainText("Open issue for Kitchen Remodel");

  await page.getByTestId("customer-dashboard-tab-notifications").click();
  await expect(page.getByTestId("customer-notifications-center")).toContainText("Notifications Center");
  await page.getByTestId("customer-notifications-filter-all").click();
  await expect(page.getByTestId("customer-notifications-center")).toContainText("Agreement needs signature");
  await expect(page.getByTestId("customer-notifications-center")).toContainText("Payment received");

  await page.getByTestId("customer-dashboard-tab-documents").click();
  await expect(page.getByTestId("customer-portal-documents")).toContainText("Scope Addendum");
  await expect(page.getByTestId("customer-portal-documents")).toContainText("scope-addendum.txt");
  await page.getByLabel("Title").fill("Water heater warranty");
  await page.getByLabel("Document type").fill("Warranty");
  await page.getByTestId("customer-documents-upload-file").setInputFiles({
    name: "water-heater-warranty.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("warranty"),
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByTestId("customer-portal-documents")).toContainText("Water heater warranty");
  await expect(page.getByTestId("customer-portal-documents")).toContainText("water-heater-warranty.pdf");

  await page.getByTestId("customer-dashboard-tab-requests").click();
  await page.getByTestId("customer-portal-bid-accept-lead-2").click();
  await expect(page.getByTestId("customer-portal-bid-open-lead-2")).toBeVisible();

  await page.screenshot({ path: "test-results/customer-portal.png", fullPage: true });

  expect(consoleErrors.filter((msg) => msg.includes("We could not open that portal link"))).toHaveLength(0);
});

test("customer portal shows friendly empty states", async ({ page }) => {
  await page.route("**/api/projects/customer-portal/**", async (route) => {
    const requestUrl = route.request().url();
    if (route.request().method() === "GET" && requestUrl.includes("/customer-portal/empty-token/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptyPortalPayload),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/portal/empty-token", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("customer-dashboard")).toBeVisible();
  await expect(page.getByTestId("customer-notifications-empty")).toContainText("No updates yet");
  await expect(page.getByTestId("customer-overview-projects-empty")).toContainText("No active projects yet");
  await expect(page.getByTestId("customer-overview-requests-empty")).toContainText("No requests yet");

  await page.getByTestId("customer-dashboard-tab-projects").click();
  await expect(page.getByTestId("customer-project-workspace-empty")).toContainText("No projects connected yet");

  await page.getByTestId("customer-dashboard-tab-requests").click();
  await expect(page.getByTestId("customer-requests-empty")).toContainText("No saved requests yet");
  await expect(page.getByText("Saved requests stay internal here first")).toBeVisible();
  await expect(page.getByTestId("customer-bids-empty")).toContainText("No bids yet");

  await page.getByTestId("customer-dashboard-tab-property").click();
  await expect(page.getByTestId("customer-property-files-empty")).toContainText("No property files yet");

  await page.getByTestId("customer-dashboard-tab-notifications").click();
  await expect(page.getByTestId("customer-notifications-center-empty")).toContainText("No unread notifications");

  await page.getByTestId("customer-dashboard-tab-payments").click();
  await expect(page.getByTestId("customer-payments-empty")).toContainText("No payment records yet");

  await page.getByTestId("customer-dashboard-tab-documents").click();
  await expect(page.getByTestId("customer-documents-empty")).toContainText("No documents yet");
});

test("legacy customer portal aliases redirect to the active portal", async ({ page }) => {
  await page.route("**/api/projects/customer-portal/**", async (route) => {
    const requestUrl = route.request().url();
    if (route.request().method() === "GET" && requestUrl.includes("/customer-portal/empty-token/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptyPortalPayload),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/customer-portal/empty-token", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/portal\/empty-token$/);
  await expect(page.getByTestId("customer-dashboard")).toBeVisible();

  await page.goto("/my-records/empty-token", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/portal\/empty-token$/);
  await expect(page.getByTestId("customer-dashboard")).toBeVisible();
});
