import { expect, test } from "@playwright/test";

const portalPayload = {
  customer: {
    name: "Pat Customer",
    email: "customer@example.com",
  },
  account: {
    email: "customer@example.com",
    has_user: true,
    has_usable_password: true,
    portal_token: "customer-token",
  },
  summary: {
    active_requests: 1,
    active_projects: 1,
    bids_received: 3,
    active_agreements: 1,
    payments: 4,
    documents: 4,
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
    documents: [
      {
        id: "property-document-1",
        title: "Roof warranty",
        type_label: "Warranty",
        filename: "roof-warranty.pdf",
        date: "2026-04-14T12:00:00Z",
        url: "/files/roof-warranty.pdf",
      },
      {
        id: "property-document-2",
        title: "Kitchen permit",
        type_label: "Permit",
        filename: "kitchen-permit.pdf",
        date: "2026-04-13T12:00:00Z",
        url: "/files/kitchen-permit.pdf",
      },
    ],
    photos: [
      {
        id: "property-photo-1",
        title: "Before kitchen photo",
        type_label: "Property Photo",
        filename: "before-kitchen.jpg",
        date: "2026-04-12T12:00:00Z",
        url: "/files/before-kitchen.jpg",
      },
    ],
  },
  property_profiles: [
    {
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
      is_primary: true,
      documents: [
        {
          id: "property-document-1",
          title: "Roof warranty",
          type_label: "Warranty",
          filename: "roof-warranty.pdf",
          date: "2026-04-14T12:00:00Z",
          url: "/files/roof-warranty.pdf",
        },
      ],
      photos: [],
    },
    {
      id: 2,
      customer_email: "customer@example.com",
      display_name: "Lake House",
      property_type: "single_family",
      property_type_label: "Single Family",
      address_line1: "44 Lake Dr",
      city: "Austin",
      state: "TX",
      postal_code: "78703",
      address: "44 Lake Dr, Austin, TX, 78703",
      is_primary: false,
      documents: [],
      photos: [],
    },
  ],
  projects: [
    {
      id: 1,
      project_number: "PRJ-20260415-001",
      title: "Kitchen Remodel",
      description: "Primary project",
      status: "completed",
      status_label: "Completed",
      address: "123 Main St, Austin, TX 78701",
      contractor_name: "Builder Co",
      agreement_id: 1,
      agreement_token: "portal-token",
      agreement_url: "/agreements/magic/portal-token",
      total_cost: "15000.00",
      completed_at: "2026-04-17T16:00:00Z",
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
      contractor_business_name: "Builder Co",
      contractor_contact_name: "Jordan Builder",
      contractor_verified: true,
      contractor_preferred: true,
      service_area: "Austin, TX",
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
      milestone_count: 3,
      warranty_summary: "One-year workmanship warranty.",
      can_accept: true,
    },
    {
      id: "lead-3",
      bid_id: 3,
      project_title: "Office Fitout",
      contractor_name: "Partner Co",
      contractor_business_name: "Partner Co",
      contractor_contact_name: "Alex Partner",
      contractor_verified: false,
      contractor_preferred: false,
      service_area: "Austin, TX",
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
      milestone_preview: ["Demo", "Buildout", "Closeout", "Final walkthrough"],
      milestone_count: 4,
      warranty_summary: "Two-year service warranty.",
      can_accept: true,
    },
  ],
  bid_comparisons: [
    {
      comparison_key: "compare-key",
      project_title: "Office Fitout",
      bid_count: 2,
      status: "open",
      bids: [],
    },
  ],
  agreements: [
    {
      id: 1,
      project_title: "Kitchen Remodel",
      contractor_name: "Builder Co",
      project_class_label: "Commercial",
      status_label: "Signed",
      status: "completed",
      is_fully_signed: true,
      updated_at: "2026-04-15T16:00:00Z",
      completed_at: "2026-04-17T16:00:00Z",
      agreement_token: "portal-token",
      action_target: "/agreements/magic/portal-token",
      pdf_url: "/files/agreement.pdf",
      payment_mode: "escrow",
      payment_mode_label: "Escrow",
      total_cost: "15000.00",
      warranty_text: "One-year workmanship warranty for covered remodel labor.",
      warranty_type: "Workmanship",
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
    {
      id: "agreement-pdf-1",
      title: "Kitchen Remodel agreement PDF",
      type_label: "Agreement PDF",
      project_title: "Kitchen Remodel",
      filename: "agreement.pdf",
      date: "2026-04-15T16:10:00Z",
      url: "/files/agreement.pdf",
      agreement_id: 1,
    },
    {
      id: "invoice-pdf-1",
      title: "Invoice INV-20260415-0001 PDF",
      type_label: "Invoice PDF",
      project_title: "Kitchen Remodel",
      filename: "invoice.pdf",
      date: "2026-04-15T16:40:00Z",
      url: "/files/invoice.pdf",
      agreement_id: 1,
    },
    {
      id: "receipt-pdf-1",
      title: "Receipt R-001 PDF",
      type_label: "Receipt PDF",
      project_title: "Kitchen Remodel",
      filename: "receipt.pdf",
      date: "2026-04-15T17:40:00Z",
      url: "/files/receipt.pdf",
      agreement_id: 1,
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

const uploadedPhotoPortalPayload = {
  ...portalPayload,
  summary: {
    ...portalPayload.summary,
    documents: 5,
  },
  property_profile: {
    ...portalPayload.property_profile,
    photos: [
      {
        id: "property-photo-9",
        title: "Kitchen after photo",
        type_label: "Property Photo",
        filename: "kitchen-after.jpg",
        date: "2026-04-16T13:00:00Z",
        url: "/files/kitchen-after.jpg",
      },
      ...portalPayload.property_profile.photos,
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

const reimbursementPortalPayload = {
  ...portalPayload,
  summary: {
    ...portalPayload.summary,
    payments: 5,
  },
  payments: [
    {
      id: "reimbursement-99",
      record_id: 99,
      project_title: "Kitchen Remodel",
      contractor_name: "Builder Co",
      payment_mode: "escrow",
      payment_mode_label: "Escrow",
      record_type_label: "Reimbursement",
      record_type: "reimbursement",
      date: "2026-04-17T10:00:00Z",
      amount: "425.00",
      amount_label: "$425.00",
      status: "submitted",
      status_label: "Submitted",
      reference: "Expense #99",
      notes: "Flooring materials with receipt attached.",
      receipt_url: "/files/materials-receipt.pdf",
      can_approve: true,
      can_deny: true,
      escrow_ledger: {
        funded: "15000.00",
        available: "15000.00",
      },
    },
    ...portalPayload.payments,
  ],
};

const approvedReimbursementPortalPayload = {
  ...reimbursementPortalPayload,
  payments: reimbursementPortalPayload.payments.map((payment) =>
    payment.id === "reimbursement-99"
      ? {
          ...payment,
          status: "pending_release",
          status_label: "Pending Release",
          can_approve: false,
          can_deny: false,
          escrow_ledger: {
            funded: "15000.00",
            available: "14575.00",
          },
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

const longPortalPayload = {
  ...portalPayload,
  property_profile: {
    ...portalPayload.property_profile,
    documents: [
      ...portalPayload.property_profile.documents,
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `property-extra-document-${index + 1}`,
        title: `Extra warranty document ${index + 1}`,
        type_label: index % 2 === 0 ? "Warranty" : "Permit",
        filename: `extra-document-${index + 1}.pdf`,
        date: `2026-04-${String(11 - index).padStart(2, "0")}T12:00:00Z`,
        url: `/files/extra-document-${index + 1}.pdf`,
      })),
    ],
    photos: [
      ...portalPayload.property_profile.photos,
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `property-extra-photo-${index + 1}`,
        title: `Extra property photo ${index + 1}`,
        type_label: "Property Photo",
        filename: `extra-photo-${index + 1}.jpg`,
        date: `2026-04-${String(8 - index).padStart(2, "0")}T12:00:00Z`,
        url: `/files/extra-photo-${index + 1}.jpg`,
      })),
    ],
  },
  projects: [
    ...portalPayload.projects,
    {
      id: "active-project",
      project_number: "PRJ-ACTIVE-001",
      title: "Roof Replacement",
      description: "Active roof replacement project.",
      status: "active",
      status_label: "Active",
      address: "123 Main St, Austin, TX 78701",
      contractor_name: "Builder Co",
      agreement_id: 44,
      agreement_url: "/agreements/magic/active-project-token",
      total_cost: "9000.00",
      milestones: [{ id: 44, title: "Roof install", status: "active", amount: "9000.00" }],
    },
    {
      id: "draft-project",
      project_number: "PRJ-DRAFT-001",
      title: "Draft Patio Repair",
      description: "Draft patio repair project.",
      status: "draft",
      status_label: "Draft",
      address: "123 Main St, Austin, TX 78701",
      contractor_name: "Builder Co",
      total_cost: "0.00",
      milestones: [],
    },
    {
      id: "static-history-project",
      title: "Older Deck Repair",
      status: "completed",
      status_label: "Completed",
      contractor_name: "Builder Co",
      completed_at: "2026-03-01T12:00:00Z",
      total_cost: "2800.00",
      milestones: [],
    },
  ],
  agreements: [
    ...portalPayload.agreements,
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `warranty-agreement-${index + 1}`,
      project_title: `Warranty Project ${index + 1}`,
      contractor_name: "Builder Co",
      status: "completed",
      status_label: "Completed",
      completed_at: `2026-04-${String(10 - index).padStart(2, "0")}T12:00:00Z`,
      updated_at: `2026-04-${String(10 - index).padStart(2, "0")}T12:00:00Z`,
      total_cost: "1000.00",
      warranty_text: `Reusable warranty language ${index + 1}.`,
      warranty_type: "Workmanship",
    })),
  ],
  payments: [
    ...portalPayload.payments,
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `paid-extra-${index + 1}`,
      project_title: "Kitchen Remodel",
      contractor_name: "Builder Co",
      payment_mode: "direct",
      payment_mode_label: "Direct Pay",
      record_type_label: "Invoice",
      record_type: "invoice",
      date: `2026-03-${String(20 - index).padStart(2, "0")}T12:00:00Z`,
      amount_label: `$${(100 + index * 25).toFixed(2)}`,
      status_label: "Paid",
      status: "paid",
      action_target: `/invoice/paid-extra-${index + 1}`,
      reference: `Paid receipt ${index + 1}`,
      invoice_number: `Paid receipt ${index + 1}`,
      dispute_status: "none",
      dispute_status_label: "No dispute",
    })),
  ],
  documents: [
    ...portalPayload.documents,
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `portal-extra-document-${index + 1}`,
      title: `Portal extra document ${index + 1}`,
      type_label: index % 2 === 0 ? "Agreement PDF" : "Receipt PDF",
      project_title: "Kitchen Remodel",
      filename: `portal-extra-document-${index + 1}.pdf`,
      date: `2026-04-${String(9 - Math.min(index, 8)).padStart(2, "0")}T12:00:00Z`,
      url: `/files/portal-extra-document-${index + 1}.pdf`,
      agreement_id: 1,
    })),
  ],
};

test("customer portal is reachable from the landing page and loads secure records", async ({
  page,
}) => {
  const consoleErrors = [];
  let submittedRequestPayload = null;
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

    if (requestUrl.includes("/customer-portal/customer-token/profile/") && method === "PATCH") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...portalPayload,
          customer: {
            ...portalPayload.customer,
            full_name: "Pat Updated",
            phone_number: "512-555-1212",
            address_line1: "700 Customer Ln",
          },
        }),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/requests/") && method === "POST") {
      submittedRequestPayload = JSON.parse(route.request().postData() || "{}");
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ...portalPayload,
          requests: [
            {
              id: "customer-request-9",
              source_kind: "customer_request",
              project_title: submittedRequestPayload.title,
              status: "submitted",
              status_label: "Submitted",
              request_type_label: "Maintenance",
              property_id: submittedRequestPayload.property_id,
              property_name: "Lake House",
              notes: submittedRequestPayload.description,
            },
            ...portalPayload.requests,
          ],
        }),
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

    if (requestUrl.includes("/customer-portal/customer-token/property/photos/") && method === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(uploadedPhotoPortalPayload),
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
  await expect(page.getByTestId("customer-portal-access-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Customer Portal" })).toBeVisible();
  await expect(page.getByText("Access your projects, payments, documents, warranties, and property records in one secure place.")).toBeVisible();
  await expect(page.getByText("Project updates and milestones")).toBeVisible();
  await expect(page.getByText("Secure payment and invoice review")).toBeVisible();
  await expect(page.getByText("Documents, warranties, and home records")).toBeVisible();
  await expect(page.getByTestId("customer-portal-access-card")).toContainText("Need a secure access link?");
  await expect(page.getByTestId("customer-portal-access-card")).toContainText("Only records connected to your email will be shown.");
  await expect(page.getByText("Projects & Payments")).toBeVisible();
  await expect(page.getByText("Documents & Warranties")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Property Records" })).toBeVisible();
  await expect(page.getByTestId("customer-portal-start-project-link")).toHaveAttribute("href", "/start-project");
  await expect(page.getByTestId("customer-portal-back-home-link")).toHaveAttribute("href", "/");
  await expect(page.getByTestId("customer-portal-email-input")).toBeVisible();

  await page.getByTestId("customer-portal-email-input").fill("customer@example.com");
  await page.getByTestId("customer-portal-send-link-button").click();
  await expect(page.getByTestId("customer-portal-link-sent")).toBeVisible();

  await page.goto("/portal/customer-token", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("customer-dashboard")).toBeVisible();
  await expect(page.getByTestId("customer-portal-create-password-prompt")).not.toBeVisible();
  await expect(page.getByTestId("customer-dashboard-logo")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Customer Portal" })).toBeVisible();
  await expect(page.getByText("track projects, payments, documents, warranties, and property records in one place.")).toBeVisible();
  await expect(page.getByTestId("customer-portal-summary")).toBeVisible();
  await expect(page.getByTestId("customer-portal-summary-active-requests")).toContainText("1");
  await expect(page.getByTestId("customer-portal-summary-agreements")).toContainText("1");
  await expect(page.getByTestId("customer-portal-summary-payments")).toContainText("4");
  await expect(page.getByTestId("customer-portal-summary-documents")).toContainText("4");
  await expect(page.getByTestId("customer-portal-summary-projects")).toHaveClass(/hover:border-amber/);
  await page.getByTestId("customer-portal-summary-active-requests").click();
  await expect(page.getByTestId("customer-dashboard-tab-requests")).toHaveClass(/border-amber/);
  await expect(page.getByTestId("customer-notifications-panel")).toHaveCount(0);
  await page.getByTestId("customer-dashboard-tab-overview").click();
  await expect(page.getByTestId("customer-notifications-panel")).toContainText("Recent Activity");
  await expect(page.getByRole("heading", { name: "Recent Activity" })).toHaveCount(1);
  await expect(page.getByTestId("customer-notifications-panel")).toContainText("Recent project, payment, request, and property updates.");
  await expect(page.getByTestId("customer-notifications-panel")).toContainText("Agreement needs signature");
  await expect(page.getByTestId("customer-notifications-panel")).toContainText("Payment received");
  await expect(page.getByTestId("customer-notifications-unread-count")).toContainText("1 unread");
  await expect(page.getByTestId("customer-notification-101")).toContainText("Unread");
  await expect(page.getByTestId("customer-notification-101")).toHaveClass(/border-sky-300/);
  await expect(page.getByTestId("customer-notification-102")).not.toContainText("Unread");
  await expect(page.getByTestId("customer-notification-102")).not.toHaveClass(/border-sky-300/);
  await page.getByTestId("customer-notification-mark-read-101").click();
  await expect(page.getByTestId("customer-notifications-unread-count")).toContainText("2 recent");
  await expect(page.getByTestId("customer-notification-101")).not.toContainText("Unread");
  await expect(page.getByTestId("customer-notification-101")).not.toHaveClass(/border-sky-300/);

  await page.getByTestId("customer-dashboard-tab-account").click();
  await expect(page.getByTestId("customer-account-panel")).toContainText("My Profile");
  await expect(page.getByTestId("customer-profile-email")).toHaveValue("customer@example.com");
  await expect(page.getByTestId("customer-profile-phone")).toBeVisible();
  await expect(page.getByTestId("customer-account-logout")).toContainText("Log out");
  await page.getByTestId("customer-profile-name").fill("Pat Updated");
  await page.getByTestId("customer-profile-phone").fill("512-555-1212");
  await page.getByTestId("customer-profile-address-line1").fill("700 Customer Ln");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByTestId("customer-profile-phone")).toHaveValue("512-555-1212");

  await page.getByTestId("customer-dashboard-tab-requests").click();
  await expect(page.getByTestId("customer-notifications-panel")).toHaveCount(0);
  await expect(page.getByTestId("customer-request-create-panel")).toBeVisible();
  await expect(page.getByTestId("customer-request-create-panel")).toContainText("Tell us what you need help with next");
  await expect(page.getByRole("heading", { name: "Project & Service Requests" })).toBeVisible();
  await expect(page.getByText("Use Requests to tell us what you need help with next.")).toBeVisible();
  await expect(page.getByText("up to 5 vetted MyHomeBro marketplace contractors")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contractor Responses" })).toBeVisible();
  await expect(page.getByText("Create a Request")).toBeVisible();
  await expect(page.getByText("Choose the property this request is for.")).toBeVisible();
  await expect(page.getByTestId("customer-request-property-selector")).toBeVisible();
  await page.getByTestId("customer-request-property-selector").selectOption("2");
  await expect(page.getByLabel("Street").last()).toHaveValue("44 Lake Dr");
  await page.getByLabel("Title").last().fill("Seasonal HVAC service");
  await page.getByLabel("Details").fill("Please inspect the system before summer.");
  await page.getByRole("button", { name: "Create Request" }).click();
  await expect.poll(() => String(submittedRequestPayload?.property_id || "")).toBe("2");
  await expect(page.getByTestId("customer-portal-requests")).toContainText("Seasonal HVAC service");
  await expect(page.getByTestId("customer-portal-requests")).toContainText("Kitchen Remodel");
  await expect(page.getByTestId("customer-portal-request-compare-request-2")).toContainText("Compare Bids");
  await page.getByTestId("customer-portal-request-compare-request-2").click();
  await expect(page.getByTestId("customer-bid-comparison")).toContainText("Bid Comparison");
  await expect(page.getByTestId("customer-bid-comparison-card-lead-2")).toContainText("Builder Co");
  await expect(page.getByTestId("customer-bid-comparison-card-lead-3")).toContainText("Partner Co");
  await expect(page.getByTestId("customer-bid-comparison-card-lead-3")).toContainText("Lowest price");
  await expect(page.getByTestId("customer-bid-comparison-card-lead-3")).toContainText("Most detailed milestone plan");
  await expect(page.getByTestId("customer-bid-comparison-card-lead-2")).toContainText("Verified contractor");
  await expect(page.getByTestId("customer-bid-comparison-card-lead-2")).toContainText("Preferred contractor");
  await expect(page.getByTestId("customer-bid-comparison-card-lead-2")).toContainText("One-year workmanship warranty.");
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

  await page.getByTestId("customer-dashboard-tab-property").click();
  await expect(page.getByTestId("home-records-dashboard")).toContainText("Your home history, organized.");
  await expect(page.getByTestId("home-records-dashboard")).toContainText("Completed MyHomeBro projects automatically become part of your home record.");
  await expect(page.getByTestId("customer-property-manager")).toContainText("My Properties");
  await expect(page.getByTestId("customer-property-card-1")).toContainText("Primary Property");
  await expect(page.getByTestId("customer-property-card-2")).toContainText("Lake House");
  await page.getByTestId("customer-property-card-2").click();
  await expect(page.getByLabel("Property name")).toHaveValue("Lake House");
  await page.getByTestId("customer-property-add-button").click();
  await expect(page.getByRole("button", { name: "Add property", exact: true })).toBeVisible();
  await expect(page.getByTestId("home-records-timeline")).toContainText("Kitchen Remodel");
  await expect(page.getByTestId("home-records-timeline")).toContainText("Water heater warranty");
  await expect(page.getByTestId("home-records-warranty-center")).toContainText("One-year workmanship warranty");
  await expect(page.getByTestId("home-records-completed-projects")).toContainText("Kitchen Remodel");
  await expect(page.getByTestId("home-records-completed-projects")).toContainText("Warranty on file");
  await expect(page.getByTestId("home-records-document-groups")).toContainText("Agreements");
  await expect(page.getByTestId("home-records-document-groups")).toContainText("Invoices & Receipts");
  await expect(page.getByTestId("home-records-document-groups")).toContainText("Warranties");
  await expect(page.getByTestId("home-records-document-groups")).toContainText("Permits");
  await expect(page.getByTestId("home-records-document-groups")).toContainText("Photos");
  await expect(page.getByTestId("home-records-maintenance-history")).toContainText("No service history yet");
  await expect(page.getByTestId("home-records-request-guidance")).toContainText("Use these records when starting a new project");
  await page.getByLabel("File type").selectOption("photo");
  await page.getByLabel("Title").fill("Kitchen after photo");
  await page.getByTestId("customer-property-upload-file").setInputFiles({
    name: "kitchen-after.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("photo"),
  });
  await page.getByRole("button", { name: "Upload property file" }).click();
  await expect(page.getByTestId("customer-property-profile")).toContainText("Kitchen after photo");

  await page.getByTestId("customer-dashboard-tab-requests").click();
  await expect(page.getByTestId("customer-portal-bid-accept-lead-2")).toContainText("Award Bid");
  await page.getByTestId("customer-bid-comparison-award-lead-2").click();
  await expect(page.getByTestId("customer-portal-bid-award-modal")).toContainText("Selecting this contractor will create a project agreement draft.");
  await page.getByTestId("customer-portal-bid-award-confirm").click();
  await expect(page.getByTestId("customer-portal-bid-open-lead-2")).toBeVisible();
  await expect(page.getByTestId("customer-bid-comparison")).toContainText("Awarded Contractor");
  await expect(page.getByTestId("customer-bid-comparison-card-lead-3")).toContainText("Not Selected");

  await page.screenshot({ path: "test-results/customer-portal.png", fullPage: true });

  expect(consoleErrors.filter((msg) => msg.includes("We could not open that portal link"))).toHaveLength(0);
});

test("customer portal supports returning customer login", async ({ page }) => {
  await page.route("**/api/auth/login/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access: "customer-access-token",
        refresh: "customer-refresh-token",
        user: { email: "customer@example.com" },
      }),
    });
  });
  await page.route("**/api/projects/customer-portal/account/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(portalPayload),
    });
  });

  await page.goto("/portal", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("customer-portal-logo")).toBeVisible();
  await expect(page.getByText("Customer Portal").first()).toBeVisible();
  await expect(page.getByTestId("customer-portal-login-form")).toBeVisible();
  await expect(page.getByTestId("customer-portal-email-input")).toBeVisible();
  await expect(page.getByText("Need a secure access link?")).toBeVisible();
  await page.getByTestId("customer-portal-login-email-input").fill("customer@example.com");
  await page.getByTestId("customer-portal-login-password-input").fill("CustomerPass123!");
  await page.getByTestId("customer-portal-login-button").click();
  await expect(page.getByTestId("customer-dashboard")).toBeVisible();
  await expect(page.getByTestId("customer-dashboard-logo")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Customer Portal" })).toBeVisible();
});

test("customer portal can approve escrow reimbursement requests from payments", async ({ page }) => {
  let approveCalled = false;
  await page.route("**/api/projects/customer-portal/**", async (route) => {
    const requestUrl = route.request().url();
    const method = route.request().method();

    if (method === "GET" && requestUrl.includes("/customer-portal/reimbursement-token/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reimbursementPortalPayload),
      });
      return;
    }

    if (
      method === "POST" &&
      requestUrl.includes("/customer-portal/reimbursement-token/reimbursements/99/approve/")
    ) {
      approveCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Reimbursement approved for escrow release.",
          reimbursement_id: 99,
          status: "pending_release",
          portal: approvedReimbursementPortalPayload,
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/portal/reimbursement-token", { waitUntil: "domcontentloaded" });
  await page.getByTestId("customer-dashboard-tab-projects").click();
  await expect(page.getByTestId("customer-project-payment-reimbursement-99")).toContainText("Reimbursement");
  await expect(page.getByTestId("customer-project-payment-approve-reimbursement-99")).toContainText("Approve Reimbursement");

  await page.getByTestId("customer-dashboard-tab-payments").click();
  await expect(page.getByTestId("customer-payment-action-reimbursement-99")).toContainText("Reimbursement");
  await expect(page.getByTestId("customer-payment-action-reimbursement-99")).toContainText("$425.00");
  await expect(page.getByTestId("customer-payment-action-reimbursement-99")).toContainText("Available escrow before this request: $15000.00");
  await expect(page.getByTestId("customer-payment-primary-reimbursement-99")).toHaveAttribute("href", "/files/materials-receipt.pdf");
  await page.getByTestId("customer-payment-approve-reimbursement-99").click();
  await expect.poll(() => approveCalled).toBe(true);
  await expect(page.getByTestId("customer-payment-action-reimbursement-99")).toContainText("Pending Release");
  await expect(page.getByTestId("customer-payment-approve-reimbursement-99")).toHaveCount(0);
});

test("customer portal login failure and token password creation states render", async ({ page }) => {
  await page.route("**/api/auth/login/", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Invalid email or password." }),
    });
  });
  const needsPasswordPayload = {
    ...portalPayload,
    account: {
      email: "customer@example.com",
      has_user: false,
      has_usable_password: false,
      portal_token: "customer-token",
    },
  };
  const passwordCreatedPayload = {
    ...portalPayload,
    account: {
      email: "customer@example.com",
      has_user: true,
      has_usable_password: true,
      portal_token: "customer-token",
    },
  };
  await page.route("**/api/projects/customer-portal/customer-token/", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(needsPasswordPayload),
      });
      return;
    }
    await route.fallback();
  });
  await page.route("**/api/projects/customer-portal/customer-token/create-password/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, portal: passwordCreatedPayload }),
    });
  });

  await page.goto("/portal", { waitUntil: "domcontentloaded" });
  await page.getByTestId("customer-portal-login-email-input").fill("customer@example.com");
  await page.getByTestId("customer-portal-login-password-input").fill("bad-password");
  await page.getByTestId("customer-portal-login-button").click();
  await expect(page.getByTestId("customer-portal-login-error")).toContainText("Invalid email or password.");

  await page.goto("/portal/customer-token", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("customer-dashboard")).toBeVisible();
  await expect(page.getByTestId("customer-portal-create-password-prompt")).toContainText("Create a password for faster access next time.");
  await page.getByTestId("customer-portal-create-password-input").fill("CustomerPass123!");
  await page.getByTestId("customer-portal-create-password-confirm-input").fill("CustomerPass123!");
  await page.getByRole("button", { name: "Create Password" }).click();
  await expect(page.getByTestId("customer-portal-create-password-prompt")).not.toBeVisible();
});

test("customer portal access page handles errors and mobile layout", async ({ page }) => {
  await page.route("**/api/projects/customer-portal/request-link/", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Email service is unavailable." }),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/portal", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("customer-portal-access-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Customer Portal" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);

  await page.getByTestId("customer-portal-send-link-button").click();
  await expect(page.getByTestId("customer-portal-link-error")).toContainText("Please enter the email address connected to your project.");
  await page.getByTestId("customer-portal-email-input").fill("customer@example.com");
  await page.getByTestId("customer-portal-send-link-button").click();
  await expect(page.getByTestId("customer-portal-link-error")).toContainText("Email service is unavailable.");
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
  await expect(page.getByTestId("home-records-dashboard")).toContainText("Your home history, organized.");
  await expect(page.getByTestId("home-records-timeline-empty")).toContainText("No home history yet");
  await expect(page.getByTestId("home-records-warranty-empty")).toContainText("No warranty details yet");
  await expect(page.getByTestId("home-records-completed-empty")).toContainText("No completed projects yet");
  await expect(page.getByTestId("customer-property-files-empty")).toContainText("No property files yet");

  await page.getByTestId("customer-dashboard-tab-notifications").click();
  await expect(page.getByTestId("customer-notifications-center-empty")).toContainText("No unread notifications");

  await page.getByTestId("customer-dashboard-tab-payments").click();
  await expect(page.getByTestId("customer-payments-empty")).toContainText("No payment records yet");

  await page.getByTestId("customer-dashboard-tab-documents").click();
  await expect(page.getByTestId("customer-documents-empty")).toContainText("No documents yet");
});

test("customer portal limits long home records, payments, and documents without dead timeline links", async ({ page }) => {
  await page.route("**/api/projects/customer-portal/**", async (route) => {
    const requestUrl = route.request().url();
    if (route.request().method() === "GET" && requestUrl.includes("/customer-portal/long-token/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(longPortalPayload),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/portal/long-token", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("customer-dashboard")).toBeVisible();

  await expect(page.getByTestId("customer-notifications-panel").getByRole("heading", { name: "Recent Activity" })).toBeVisible();
  await page.getByTestId("customer-dashboard-tab-projects").click();
  await expect(page.getByTestId("customer-projects-section-header")).toHaveCount(0);
  await expect(page.getByTestId("customer-projects-navigation")).toContainText("Project Navigation");
  await expect(page.getByTestId("customer-project-group-needs_attention")).toContainText("Needs Attention (1)");
  await expect(page.getByTestId("customer-project-group-active")).toContainText("Active Projects (1)");
  await expect(page.getByTestId("customer-project-group-draft")).toContainText("Draft / Pending (1)");
  await expect(page.getByTestId("customer-project-group-completed")).toContainText("Completed / Archived (1)");
  await expect(page.getByTestId("customer-project-card-1")).toBeVisible();
  await expect(page.getByTestId("customer-project-card-1")).toHaveClass(/border-amber-300/);
  await expect(page.getByTestId("customer-project-card-active-project")).toBeVisible();
  await expect(page.getByTestId("customer-project-workspace")).not.toContainText("Internal Contractor Draft");
  await expect(page.getByTestId("customer-project-card-draft-project")).not.toBeVisible();
  await expect(page.getByTestId("customer-project-card-static-history-project")).not.toBeVisible();
  await page.getByTestId("customer-project-group-toggle-draft").click();
  await expect(page.getByTestId("customer-project-card-draft-project")).toBeVisible();
  await page.getByTestId("customer-project-card-draft-project").click();
  await expect(page.getByTestId("customer-project-card-draft-project")).toHaveClass(/border-amber-300/);
  await expect(page.getByTestId("customer-rich-project-workspace")).toContainText("Draft Patio Repair");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("customer-dashboard-tab-projects").click();
  await expect(page.getByTestId("customer-projects-navigation")).toBeVisible();
  await expect(page.getByTestId("customer-rich-project-workspace")).not.toBeVisible();
  await page.getByTestId("customer-project-card-1").click();
  await expect(page.getByTestId("customer-rich-project-workspace")).toBeVisible();
  await expect(page.getByTestId("customer-projects-back-button")).toBeVisible();
  await page.getByTestId("customer-projects-back-button").click();
  await expect(page.getByTestId("customer-projects-navigation")).toBeVisible();

  await page.getByTestId("customer-dashboard-tab-property").click();
  await expect(page.getByTestId("home-records-timeline")).toBeVisible();
  await expect(page.getByTestId(/home-records-timeline-(action|static)-/)).toHaveCount(5);
  await expect(page.getByTestId("home-records-timeline")).not.toContainText("Older Deck Repair");
  await expect(page.getByTestId("home-records-timeline-action-document-document-1")).toHaveAttribute("href", "/files/scope-addendum.txt");
  await expect(page.getByTestId("home-records-timeline-action-document-document-1")).toContainText("View document");
  await page.getByTestId("home-records-timeline-show-more").click();
  await expect(page.getByTestId("home-records-timeline")).toContainText("Older Deck Repair");
  await expect(page.getByTestId("home-records-timeline-static-project-static-history-project")).toBeVisible();
  await expect(page.getByTestId("home-records-timeline-static-project-static-history-project")).not.toHaveAttribute("href", /#/);

  await expect(page.getByTestId("home-records-important-documents")).not.toContainText("Extra warranty document 7");
  await page.getByTestId("home-records-important-documents-show-more").click();
  await expect(page.getByTestId("home-records-important-documents")).toContainText("Extra warranty document 7");

  await expect(page.getByTestId("home-records-warranty-center")).not.toContainText("Warranty Project 5");
  await page.getByTestId("home-records-warranty-show-more").click();
  await expect(page.getByTestId("home-records-warranty-center")).toContainText("Warranty Project 5");

  await page.getByTestId("customer-dashboard-tab-payments").click();
  await expect(page.getByTestId("customer-portal-payments")).not.toContainText("Paid receipt 6");
  await page.getByTestId("customer-payments-history-show-more").click();
  await expect(page.getByTestId("customer-portal-payments")).toContainText("Paid receipt 6");

  await page.getByTestId("customer-dashboard-tab-documents").click();
  await expect(page.getByTestId("customer-portal-documents")).not.toContainText("Portal extra document 10");
  await page.getByTestId("customer-documents-show-more").click();
  await expect(page.getByTestId("customer-portal-documents")).toContainText("Portal extra document 10");
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
