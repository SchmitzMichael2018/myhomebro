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
    payments: 5,
    documents: 4,
    maintenance_work_orders: 1,
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
    year_built: 1998,
    square_feet: 2400,
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
      review: {
        eligible: true,
        reason: "Project is complete.",
        message: "Share feedback about your project experience.",
        existing_review: null,
        submitted: false,
        agreement_id: 1,
      },
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
      request_type_label: "New Project",
      project_mode_label: "Full service",
      project_category: "Kitchen",
      project_type: "Kitchen",
      project_subtype: "Remodel",
      payment_preference_label: "Escrow milestone holds",
      latest_activity: "2026-04-15T14:00:00Z",
      created_at: "2026-04-15T14:00:00Z",
      bids_count: 1,
      status: "submitted",
      status_label: "Submitted",
      action_target: "",
      notes: "Need a commercial remodel.",
      project_scope: "Need a commercial remodel.",
      original_description: "Need a commercial remodel.",
      ai_enhanced_description: "Included Work\n- Prepare the commercial remodel scope for contractor review.",
      ai_generated_title: "Commercial Remodel",
      ai_generated_type: "Commercial Remodeling",
      ai_generated_subtype: "Tenant Improvement",
      source_kind: "project_intake",
      source_kind_label: "Public Intake Request",
      request_source_label: "Landing Page",
      project_address: "123 Main St, Austin, TX, 78701",
      property_name: "Kitchen Remodel",
      homeowner_name: "Pat Customer",
      homeowner_email: "customer@example.com",
      homeowner_phone: "555-111-2222",
      urgency: "normal",
      preferred_timeline: "Within the next month",
      timeline_label: "Within the next month",
      current_next_action: "Open linked agreement",
      conversion_status: "Agreement draft created",
      materials_preferences: "Durable commercial-grade finishes.",
      scheduling_access_notes: "Coordinate access with the office manager.",
      special_instructions: "Access through the side entrance after 9 AM.",
      selected_contractor: {
        business_name: "Builder Co",
        contact_name: "Jordan Builder",
        phone: "512-555-0100",
        email: "builder@example.com",
        service_area: "Austin, TX",
        trade: "Commercial Remodeling",
        status_label: "Agreement created",
        selection_method: "Selected during intake",
        selected_at: "2026-04-15T14:10:00Z",
        accepted_at: "2026-04-15T15:00:00Z",
        profile_url: "/contractors/builder-co",
      },
      photos: [{ id: "intake-photo-1", title: "Existing office", filename: "office-before.jpg", url: "/files/office-before.jpg" }],
      documents: [],
      activity_timeline: [
        {
          title: "Request submitted",
          description: "The request was submitted.",
          occurred_at: "2026-04-15T14:00:00Z",
        },
        {
          title: "Contractor selected",
          description: "Builder Co",
          status: "Agreement created",
          occurred_at: "2026-04-15T14:10:00Z",
        },
        {
          title: "Agreement draft created",
          description: "This request was converted into an agreement draft.",
          status: "converted",
          occurred_at: "2026-04-15T15:00:00Z",
        },
      ],
      linked_work: {
        agreement_id: 1,
        agreement_token: "portal-token",
        agreement_url: "/agreements/magic/portal-token",
        project_id: 1,
        project_title: "Kitchen Remodel",
        status_label: "Signed",
      },
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
      contractor_rating: 4.75,
      contractor_review_count: 8,
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
      id: "invoice-zero",
      project_title: "Kitchen Remodel",
      contractor_name: "Builder Co",
      payment_mode: "direct",
      payment_mode_label: "Direct Pay",
      record_type_label: "Invoice",
      record_type: "invoice",
      date: "2026-04-16T09:30:00Z",
      amount: "0.00",
      amount_label: "$0.00",
      status: "approved",
      status_label: "Approved",
      is_actionable: false,
      action_target: "/invoice/portal-zero-correction-token",
      reference: "INV-20260416-0000",
      invoice_number: "INV-20260416-0000",
      dispute_status: "none",
      dispute_status_label: "No dispute",
      notes: "No payment required",
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
  maintenance_work_orders: [
    {
      id: 1,
      agreement_id: 1,
      project_id: 1,
      project_title: "Kitchen Remodel",
      contractor_name: "Builder Co",
      property_id: 1,
      property_name: "Kitchen Remodel",
      title: "Quarterly service visit",
      description: "Inspect finishes and address routine maintenance items.",
      scheduled_date: "2026-05-01",
      completed_at: "2026-05-02T14:00:00Z",
      status: "completed",
      status_label: "Completed",
      notes: "Service completed and records updated.",
      attachments: [
        {
          id: 1,
          title: "Service record",
          filename: "service-record.pdf",
          url: "/files/service-record.pdf",
          date: "2026-05-02T14:00:00Z",
        },
      ],
    },
  ],
  property_intelligence: {
    property_id: 1,
    property_name: "Kitchen Remodel",
    health: {
      status: "needs_attention",
      label: "Needs Attention",
      score: 64,
      confidence: "medium",
      summary: "Needs Attention: 1 item may need attention. Confidence is medium based on available records.",
    },
    insights: [
      {
        id: "maintenance-hvac-service-due",
        category: "maintenance_due",
        bucket: "needs_attention",
        severity: "medium",
        title: "HVAC service may be due.",
        reason: "No recent completed HVAC service record was found for this property in the last year.",
        property_id: 1,
        property_name: "Kitchen Remodel",
        suggested_action: { label: "Schedule Maintenance", target: "requests" },
      },
      {
        id: "missing-water-heater-records",
        category: "missing_records",
        bucket: "recommended",
        severity: "low",
        title: "No water heater records found.",
        reason: "Water heater installation, warranty, and service records help track age and maintenance needs.",
        property_id: 1,
        property_name: "Kitchen Remodel",
        suggested_action: { label: "Upload Document", target: "property" },
      },
      {
        id: "seasonal-summer-hvac-review",
        category: "seasonal",
        bucket: "recommended",
        severity: "low",
        title: "Summer HVAC review recommended.",
        reason: "Cooling systems work hardest in summer. A service visit can help catch filter, airflow, and condensate issues early.",
        property_id: 1,
        property_name: "Kitchen Remodel",
        suggested_action: { label: "Schedule Maintenance", target: "requests" },
      },
      {
        id: "warranty-review-available",
        category: "warranty_awareness",
        bucket: "informational",
        severity: "info",
        title: "Warranty information is available.",
        reason: "Review saved warranty details and related documents before starting overlapping work.",
        property_id: 1,
        property_name: "Kitchen Remodel",
        suggested_action: { label: "Review Warranty", target: "property" },
      },
    ],
    buckets: {
      needs_attention: [
        {
          id: "maintenance-hvac-service-due",
          category: "maintenance_due",
          bucket: "needs_attention",
          severity: "medium",
          title: "HVAC service may be due.",
          reason: "No recent completed HVAC service record was found for this property in the last year.",
          property_id: 1,
          property_name: "Kitchen Remodel",
          suggested_action: { label: "Schedule Maintenance", target: "requests" },
        },
      ],
      upcoming: [],
      recommended: [
        {
          id: "missing-water-heater-records",
          category: "missing_records",
          bucket: "recommended",
          severity: "low",
          title: "No water heater records found.",
          reason: "Water heater installation, warranty, and service records help track age and maintenance needs.",
          property_id: 1,
          property_name: "Kitchen Remodel",
          suggested_action: { label: "Upload Document", target: "property" },
        },
        {
          id: "seasonal-summer-hvac-review",
          category: "seasonal",
          bucket: "recommended",
          severity: "low",
          title: "Summer HVAC review recommended.",
          reason: "Cooling systems work hardest in summer. A service visit can help catch filter, airflow, and condensate issues early.",
          property_id: 1,
          property_name: "Kitchen Remodel",
          suggested_action: { label: "Schedule Maintenance", target: "requests" },
        },
      ],
      informational: [
        {
          id: "warranty-review-available",
          category: "warranty_awareness",
          bucket: "informational",
          severity: "info",
          title: "Warranty information is available.",
          reason: "Review saved warranty details and related documents before starting overlapping work.",
          property_id: 1,
          property_name: "Kitchen Remodel",
          suggested_action: { label: "Review Warranty", target: "property" },
        },
      ],
    },
    learning_summary: {
      record_counts: { documents: 4, photos: 1, maintenance_work_orders: 1, agreements: 1, projects: 1 },
      categories: ["maintenance_due", "missing_records", "seasonal", "warranty_awareness"],
      common_work_signals: ["HVAC"],
    },
    properties: [
      {
        property_id: 1,
        property_name: "Kitchen Remodel",
        health: { status: "needs_attention", label: "Needs Attention", score: 64, confidence: "medium" },
        insight_count: 4,
      },
    ],
  },
  recommendations: [
    {
      id: "customer-property-hvac",
      key: "customer-property-hvac",
      type: "maintenance_due",
      category: "maintenance_due",
      title: "HVAC service may be due.",
      summary: "No recent completed HVAC service record was found for this property in the last year.",
      explanation: "Generated from customer-owned property records and service history.",
      source: "property_intelligence",
      confidence: "medium",
      severity: "medium",
      audience: "customer",
      object_type: "property_profile",
      object_id: 1,
      action_label: "Create Request",
      action_target: "portal:requests",
      generated_at: "2026-06-09T12:00:00Z",
      metadata: { property_name: "Kitchen Remodel" },
    },
    {
      id: "customer-property-water-heater",
      key: "customer-property-water-heater",
      type: "property_intelligence",
      category: "missing_records",
      title: "No water heater records found.",
      summary: "Water heater installation, warranty, and service records help track age and maintenance needs.",
      explanation: "This customer-safe recommendation is scoped to the active portal token.",
      source: "property_intelligence",
      confidence: "medium",
      severity: "low",
      audience: "customer",
      object_type: "property_profile",
      object_id: 1,
      action_label: "View Property Records",
      action_target: "portal:property",
      generated_at: "2026-06-09T12:00:00Z",
      metadata: { property_name: "Kitchen Remodel" },
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
    {
      id: 103,
      event_type: "payment_received",
      channel: "in_app",
      status: "read",
      title: "Payment received",
      message: "A payment was received for Kitchen Remodel.",
      action_url: "/agreements/magic/portal-token",
      created_at: "2026-04-15T17:02:00Z",
    },
    {
      id: 104,
      event_type: "payment_received",
      channel: "email_stub",
      status: "unread",
      title: "Internal payment email row",
      message: "This delivery row should not render in the customer portal.",
      action_url: "/agreements/magic/portal-token",
      created_at: "2026-04-15T17:03:00Z",
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
          dispute_status_label: "Escrow hold active",
          dispute_escrow_hold_active: true,
          dispute_financial_disposition: "manual_review_required",
          dispute_next_action: "Track issue status",
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
      project_type: "Roofing",
      project_subtype: "Replacement",
      project_mode: "full_service",
      property_id: 1,
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
      project_type: "Patio",
      project_subtype: "Repair",
      project_mode: "full_service",
      property_id: 1,
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
      project_type: "Deck",
      project_subtype: "Repair",
      project_mode: "full_service",
      property_id: 2,
      contractor_name: "Builder Co",
      completed_at: "2026-03-01T12:00:00Z",
      total_cost: "2800.00",
      milestones: [],
    },
    {
      id: "signed-stale-draft-project",
      title: "Signed Stale Draft",
      status: "draft",
      status_label: "Draft",
      contractor_name: "Builder Co",
      agreement_id: 101,
      total_cost: "5000.00",
      milestones: [],
    },
    {
      id: "funded-stale-draft-project",
      title: "Funded Stale Draft",
      status: "draft",
      status_label: "Draft",
      contractor_name: "Builder Co",
      agreement_id: 102,
      total_cost: "8000.00",
      milestones: [],
    },
    {
      id: "completed-stale-draft-project",
      title: "Completed Stale Draft",
      status: "draft",
      status_label: "Draft",
      contractor_name: "Builder Co",
      agreement_id: 103,
      completed_at: "2026-03-05T12:00:00Z",
      total_cost: "6200.00",
      milestones: [],
    },
    {
      id: "escrow-funded-invoice-project",
      title: "Escrow Funded Invoice",
      status: "funded",
      status_label: "Funded",
      contractor_name: "Builder Co",
      agreement_id: 105,
      total_cost: "20000.00",
      customer_status_key: "payment_pending",
      customer_status_label: "Payment Pending",
      customer_status_group: "open",
      homeowner_actions: {
        amendment: { available: true, active: false, label: "Request Amendment" },
        refund: { available: true, active: false, label: "Request Refund" },
        dispute: { available: true, active: false, label: "Open Dispute" },
      },
      active_cases: [],
      payment_summary: {
        project_value: "20000.00",
        escrow_funded: "20000.00",
        released_to_contractor: "7000.00",
        remaining_in_escrow: "13000.00",
        pending_review: "0.00",
        contractor_invoices: "7000.00",
        customer_payments: "0.00",
        refunds_adjustments: "0.00",
      },
      milestones: [],
    },
    {
      id: "true-draft-project",
      title: "True Draft Agreement",
      status: "draft",
      status_label: "Draft",
      contractor_name: "Builder Co",
      agreement_id: 104,
      total_cost: "0.00",
      milestones: [],
    },
  ],
  agreements: [
    ...portalPayload.agreements,
    {
      id: 101,
      project_title: "Signed Stale Draft",
      contractor_name: "Builder Co",
      status: "draft",
      status_label: "Draft",
      is_fully_signed: true,
      signed_by_contractor: true,
      signed_by_homeowner: true,
      updated_at: "2026-04-20T12:00:00Z",
      total_cost: "5000.00",
      payment_mode: "direct",
      agreement_token: "signed-stale-draft-token",
      action_target: "/agreements/magic/signed-stale-draft-token",
    },
    {
      id: 102,
      project_title: "Funded Stale Draft",
      contractor_name: "Builder Co",
      status: "draft",
      status_label: "Draft",
      is_fully_signed: true,
      signed_by_contractor: true,
      signed_by_homeowner: true,
      updated_at: "2026-04-19T12:00:00Z",
      total_cost: "8000.00",
      payment_mode: "escrow",
      agreement_token: "funded-stale-draft-token",
      action_target: "/agreements/magic/funded-stale-draft-token",
    },
    {
      id: 103,
      project_title: "Completed Stale Draft",
      contractor_name: "Builder Co",
      status: "draft",
      status_label: "Draft",
      is_fully_signed: true,
      signed_by_contractor: true,
      signed_by_homeowner: true,
      updated_at: "2026-03-05T12:00:00Z",
      completed_at: "2026-03-05T12:00:00Z",
      total_cost: "6200.00",
      payment_mode: "direct",
      agreement_token: "completed-stale-draft-token",
      action_target: "/agreements/magic/completed-stale-draft-token",
    },
    {
      id: 105,
      project_title: "Escrow Funded Invoice",
      contractor_name: "Builder Co",
      status: "funded",
      status_label: "Funded",
      is_fully_signed: true,
      signed_by_contractor: true,
      signed_by_homeowner: true,
      updated_at: "2026-04-17T12:00:00Z",
      total_cost: "20000.00",
      payment_mode: "escrow",
      agreement_token: "escrow-funded-invoice-token",
      action_target: "/agreements/magic/escrow-funded-invoice-token",
      customer_status_key: "payment_pending",
      customer_status_label: "Payment Pending",
      customer_status_group: "open",
      homeowner_actions: {
        amendment: { available: true, active: false, label: "Request Amendment" },
        refund: { available: true, active: false, label: "Request Refund" },
        dispute: { available: true, active: false, label: "Open Dispute" },
      },
      active_cases: [],
      payment_summary: {
        project_value: "20000.00",
        escrow_funded: "20000.00",
        released_to_contractor: "7000.00",
        remaining_in_escrow: "13000.00",
        pending_review: "0.00",
        contractor_invoices: "7000.00",
        customer_payments: "0.00",
        refunds_adjustments: "0.00",
      },
    },
    {
      id: 104,
      project_title: "True Draft Agreement",
      contractor_name: "Builder Co",
      status: "draft",
      status_label: "Draft",
      updated_at: "2026-04-18T12:00:00Z",
      total_cost: "0.00",
      agreement_token: "true-draft-token",
      action_target: "/agreements/magic/true-draft-token",
    },
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `warranty-agreement-${index + 1}`,
      project_title: `Warranty Project ${index + 1}`,
      contractor_name: "Builder Co",
      status: "completed",
      status_label: "Completed",
      project_type: index % 2 === 0 ? "Maintenance" : "Inspection",
      project_subtype: index % 2 === 0 ? "Seasonal Service" : "Home Inspection",
      completed_at: `2026-04-${String(10 - index).padStart(2, "0")}T12:00:00Z`,
      updated_at: `2026-04-${String(10 - index).padStart(2, "0")}T12:00:00Z`,
      total_cost: "1000.00",
      warranty_text: `Reusable warranty language ${index + 1}.`,
      warranty_type: "Workmanship",
    })),
  ],
  payments: [
    ...portalPayload.payments,
    {
      id: "funded-stale-draft-payment",
      project_title: "Funded Stale Draft",
      agreement_id: 102,
      contractor_name: "Builder Co",
      payment_mode: "escrow",
      payment_mode_label: "Escrow (Milestone Hold)",
      record_type_label: "Escrow Funding",
      record_type: "escrow",
      date: "2026-04-19T12:00:00Z",
      amount_label: "$8,000.00",
      status_label: "Funded",
      status: "funded",
      reference: "escrow_funded",
      dispute_status: "none",
      dispute_status_label: "No dispute",
      escrow_ledger: {
        funded: "8000.00",
        available: "8000.00",
      },
    },
    {
      id: "escrow-funded-20000",
      project_title: "Escrow Funded Invoice",
      agreement_id: 105,
      contractor_name: "Builder Co",
      payment_mode: "escrow",
      payment_mode_label: "Escrow (Milestone Hold)",
      record_type_label: "Escrow Funding",
      record_type: "escrow",
      date: "2026-04-17T12:00:00Z",
      amount_label: "$20,000.00",
      status_label: "Funded",
      status: "funded",
      reference: "escrow_funded",
      dispute_status: "none",
      dispute_status_label: "No dispute",
      escrow_ledger: {
        funded: "20000.00",
        available: "20000.00",
      },
    },
    {
      id: "escrow-invoice-7000",
      project_title: "Escrow Funded Invoice",
      agreement_id: 105,
      contractor_name: "Builder Co",
      payment_mode: "escrow",
      payment_mode_label: "Escrow (Milestone Hold)",
      record_type_label: "Invoice",
      record_type: "invoice",
      date: "2026-04-18T12:00:00Z",
      amount_label: "$7,000.00",
      status_label: "Released",
      status: "paid",
      action_target: "/invoice/escrow-invoice-7000",
      reference: "Invoice 7000",
      invoice_number: "Invoice 7000",
      dispute_status: "none",
      dispute_status_label: "No dispute",
      released_to_contractor: true,
      is_actionable: false,
    },
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
  let submittedReviewPayload = null;
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

    if (requestUrl.includes("/customer-portal/customer-token/agreements/1/review/") && method === "POST") {
      submittedReviewPayload = JSON.parse(route.request().postData() || "{}");
      const reviewedPortalPayload = {
        ...portalPayload,
        projects: portalPayload.projects.map((project) =>
          project.agreement_id === 1
            ? {
                ...project,
                review: {
                  ...project.review,
                  eligible: false,
                  submitted: true,
                  existing_review: {
                    id: 77,
                    rating: Number(submittedReviewPayload.rating || 0),
                    title: submittedReviewPayload.title,
                    review_text: submittedReviewPayload.review_text,
                    moderation_status: "pending",
                    published_at: null,
                  },
                },
              }
            : project
        ),
      };
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Review submitted.",
          review: reviewedPortalPayload.projects[0].review.existing_review,
          portal: reviewedPortalPayload,
        }),
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

    if (requestUrl.includes("/customer-portal/customer-token/requests/improve/") && method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Request details improved.",
          title: "Seasonal HVAC maintenance",
          project_title: "Seasonal HVAC maintenance",
          project_type: "HVAC",
          project_subtype: "Seasonal Service",
          description: "Included Work\n- Inspect the HVAC system before summer.\n- Replace accessible filters if needed.\n- Document any recommended follow-up service.",
          project_scope: "Included Work\n- Inspect the HVAC system before summer.\n- Replace accessible filters if needed.\n- Document any recommended follow-up service.",
          source: "ai",
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
              source_kind_label: "Customer Portal Request",
              request_source_label: "Customer Portal",
              project_title: submittedRequestPayload.project_title || submittedRequestPayload.title,
              project_scope: submittedRequestPayload.project_scope || submittedRequestPayload.description,
              original_description: submittedRequestPayload.project_scope || submittedRequestPayload.description,
              ai_enhanced_description: "",
              status: "submitted",
              status_label: "Submitted",
              current_next_action: "Review request details",
              conversion_status: "Submitted",
              request_type_label: "Maintenance",
              project_mode_label: "Full service",
              project_category: submittedRequestPayload.project_category || submittedRequestPayload.project_type,
              project_type: submittedRequestPayload.project_type || submittedRequestPayload.project_category,
              project_subtype: submittedRequestPayload.project_subtype,
              payment_preference_label: "Escrow milestone holds",
              property_id: submittedRequestPayload.property_id,
              property_name: "Lake House",
              property_profile: {
                id: submittedRequestPayload.property_id,
                display_name: "Lake House",
                property_type_label: "Single Family",
                address: "44 Lake Dr, Austin, TX, 78703",
              },
              homeowner_email: "customer@example.com",
              notes: submittedRequestPayload.project_scope || submittedRequestPayload.description,
              project_address: "44 Lake Dr, Austin, TX, 78703",
              urgency: submittedRequestPayload.urgency,
              preferred_timeline: submittedRequestPayload.preferred_timeline,
              created_at: "2026-06-09T12:00:00Z",
              updated_at: "2026-06-09T12:00:00Z",
              activity_timeline: [
                {
                  title: "Request saved",
                  description: "Saved in your Customer Portal.",
                  occurred_at: "2026-06-09T12:00:00Z",
                },
              ],
              selected_contractor: null,
              photos: [],
              documents: [],
              linked_work: null,
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
  await expect(page.getByTestId("customer-dashboard-header-logout")).toBeVisible();
  await expect(page.getByTestId("customer-portal-create-password-prompt")).not.toBeVisible();
  await expect(page.getByTestId("customer-dashboard-logo")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Customer Portal" })).toBeVisible();
  await expect(page.getByText("track projects, payments, documents, warranties, and property records in one place.")).toBeVisible();
  await expect(page.getByTestId("customer-portal-summary")).toBeVisible();
  await expect(page.getByTestId("customer-portal-summary-active-requests")).toContainText("1");
  await expect(page.getByTestId("customer-portal-summary-agreements")).toContainText("1");
  await expect(page.getByTestId("customer-portal-summary-payments")).toContainText("5");
  await expect(page.getByTestId("customer-portal-summary-documents")).toContainText("4");
  await expect(page.getByTestId("customer-overview-active-projects")).toContainText("Active Projects");
  await expect(page.getByTestId("customer-overview-needs-attention")).toContainText("What needs my attention?");
  await expect(page.getByTestId("customer-overview-property-records")).toContainText("Your home history, organized");
  await expect(page.getByTestId("customer-activation-checklist")).toContainText("Workspace setup: 5 of 6 complete");
  await expect(page.getByTestId("customer-activation-checklist")).toContainText("active task moved to Needs Attention");
  await expect(page.getByTestId("customer-activation-checklist")).not.toContainText("Fund escrow or review payments");
  await expect(page.getByTestId("customer-overview-needs-attention")).toContainText("Invoice for Kitchen Remodel");
  await expect(page.getByTestId("customer-overview-needs-attention")).toContainText("Draw for Kitchen Remodel");
  await expect(page.getByTestId("customer-unified-recommendations")).toBeVisible();
  await expect(page.getByTestId("customer-unified-recommendations")).toContainText("What may need attention");
  await expect(page.getByTestId("customer-unified-recommendations")).toContainText("HVAC Maintenance");
  await expect(page.getByTestId("customer-unified-recommendations")).toContainText("No recent completed HVAC service record was found");
  await expect(page.getByTestId("customer-unified-recommendations")).toContainText("Cooling systems work hardest in summer");
  await expect(page.getByTestId("customer-unified-recommendations")).toContainText("Water Heater Records");
  await expect(page.getByTestId("customer-unified-recommendations")).toContainText("Water heater installation, warranty, and service records");
  await expect(page.getByTestId("customer-unified-recommendations").getByRole("heading", { name: "HVAC Maintenance" })).toHaveCount(1);
  await expect(page.getByTestId("customer-unified-recommendations").getByRole("heading", { name: "Water Heater Records" })).toHaveCount(1);
  await expect(page.getByTestId("customer-unified-recommendations")).not.toContainText("Summer HVAC review recommended.");
  await expect(page.getByTestId("customer-unified-recommendations")).not.toContainText("contractor_performance");
  await expect(page.getByTestId("customer-unified-recommendations")).not.toContainText("Admin");
  await page
    .getByTestId("customer-unified-recommendations")
    .getByRole("button", { name: "Create Request" })
    .click();
  await expect(page.getByTestId("customer-dashboard-tab-requests")).toHaveClass(/border-amber/);
  await page.getByTestId("customer-dashboard-tab-overview").click();
  await page
    .getByTestId("customer-unified-recommendations")
    .getByRole("button", { name: "View Property Records" })
    .click();
  await expect(page.getByTestId("customer-dashboard-tab-property")).toHaveClass(/border-amber/);
  await page.getByTestId("customer-dashboard-tab-overview").click();
  await expect(page.getByTestId("customer-activation-action-payments")).toHaveCount(0);
  await page.getByTestId("customer-activation-expand").click();
  await page.getByTestId("customer-activation-action-property-details").click();
  await expect(page.getByTestId("customer-dashboard-tab-property")).toHaveClass(/border-amber/);
  await page.getByTestId("customer-dashboard-tab-overview").click();
  await expect(page.getByTestId("customer-portal-summary-projects")).toHaveClass(/hover:border-amber/);
  await page.getByTestId("customer-portal-summary-active-requests").click();
  await expect(page.getByTestId("customer-dashboard-tab-requests")).toHaveClass(/border-amber/);
  await expect(page.getByTestId("customer-notifications-panel")).toHaveCount(0);
  await page.getByTestId("customer-dashboard-tab-overview").click();
  await expect(page.getByTestId("customer-notifications-panel")).toContainText("Recent Updates");
  await expect(page.getByRole("heading", { name: "Recent Updates" })).toHaveCount(1);
  await expect(page.getByTestId("customer-notifications-panel")).toContainText("Unread and recent project, payment, request, and property updates.");
  await expect(page.getByTestId("customer-notifications-panel")).toContainText("Agreement needs signature");
  await expect(page.getByTestId("customer-notifications-panel")).not.toContainText("Payment received");
  await expect(page.getByTestId("customer-notifications-panel")).not.toContainText("Internal payment email row");
  await expect(page.getByTestId("customer-notifications-unread-count")).toContainText("1 unread");
  await expect(page.getByTestId("customer-notification-101")).toContainText("Unread");
  await expect(page.getByTestId("customer-notification-101")).toHaveClass(/border-sky-300/);
  await expect(page.getByTestId("customer-notification-102")).toHaveCount(0);
  await page.getByTestId("customer-notification-mark-read-101").click();
  await expect(page.getByTestId("customer-notifications-empty")).toContainText("No new updates");
  await expect(page.getByTestId("customer-notifications-unread-count")).toContainText("No new updates");
  await page.getByTestId("customer-notifications-open-history").click();
  await expect(page.getByTestId("customer-dashboard-tab-notifications")).toHaveClass(/border-amber/);
  await expect(page.getByTestId("customer-notifications-center")).toContainText("Agreement needs signature");
  await expect(page.getByTestId("customer-notifications-center")).toContainText("Payment received");
  await page.getByTestId("customer-dashboard-tab-overview").click();

  await page.getByTestId("customer-dashboard-tab-account").click();
  await expect(page.getByTestId("customer-account-panel")).toContainText("My Profile");
  await expect(page.getByTestId("customer-profile-email")).toHaveValue("customer@example.com");
  await expect(page.getByTestId("customer-profile-phone")).toBeVisible();
  await expect(page.getByTestId("customer-account-linked-properties")).toContainText("Primary Property");
  await expect(page.getByTestId("customer-account-linked-properties")).toContainText("Lake House");
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
  await expect(page.getByText("up to 5 marketplace contractors")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contractor Responses" })).toBeVisible();
  await expect(page.getByText("Bids appear after a request is routed or a contractor submits a response.")).toBeVisible();
  await expect(page.getByText("Create a Request")).toBeVisible();
  await expect(page.getByText("Choose the property this request is for.")).toBeVisible();
  await expect(page.getByTestId("customer-request-property-selector")).toBeVisible();
  await page.getByTestId("customer-request-property-selector").selectOption("2");
  await expect(page.getByLabel("Street").last()).toHaveValue("44 Lake Dr");
  await expect(page.getByLabel("Project Mode")).toBeVisible();
  await expect(page.getByLabel("Project Type")).toBeVisible();
  await expect(page.getByLabel("Project Subtype")).toBeVisible();
  await expect(page.getByLabel("Payment Preference")).toBeVisible();
  await expect(page.getByTestId("customer-request-address-autocomplete").locator("input")).toHaveClass(/text-white/);
  await page.getByLabel("Project Title").last().fill("Seasonal HVAC service");
  await page.getByLabel("Project Type").fill("HVAC");
  await page.getByLabel("Project Subtype").fill("Seasonal Service");
  await page.getByLabel("Payment Preference").selectOption("escrow_milestones");
  await page.getByLabel("Timeline").selectOption("As soon as possible");
  await page.getByLabel("Project Scope").fill("Please inspect the system before summer.");
  await page.getByTestId("customer-request-improve-button").click();
  await expect(page.getByTestId("customer-request-ai-suggestion")).toContainText("Suggested version");
  await expect(page.getByTestId("customer-request-ai-suggestion-text")).toHaveValue(/Inspect the HVAC system/);
  await page.getByTestId("customer-request-use-ai-suggestion").click();
  await expect(page.getByLabel("Project Scope")).toHaveValue(/Document any recommended follow-up service/);
  await page.getByRole("button", { name: "Create Request" }).click();
  await expect.poll(() => String(submittedRequestPayload?.property_id || "")).toBe("2");
  await expect(submittedRequestPayload?.project_title).toBe("Seasonal HVAC maintenance");
  await expect(submittedRequestPayload?.project_scope).toMatch(/Document any recommended follow-up service/);
  await expect(submittedRequestPayload?.project_type).toBe("HVAC");
  await expect(submittedRequestPayload?.project_subtype).toBe("Seasonal Service");
  await expect(submittedRequestPayload?.preferred_timeline).toBe("As soon as possible");
  await expect(submittedRequestPayload?.payment_preference).toBe("escrow_milestones");
  await expect(page.getByTestId("customer-portal-requests")).toContainText("Seasonal HVAC maintenance");
  await page.getByTestId("customer-request-view-customer-request-9").click();
  await expect(page.getByTestId("customer-request-detail-modal")).toContainText("Request Details");
  await expect(page.getByTestId("customer-request-detail-summary")).toContainText("Request Summary");
  await expect(page.getByTestId("customer-request-detail-summary")).toContainText("Customer Portal");
  await expect(page.getByTestId("customer-request-detail-homeowner-property")).toContainText("Homeowner & Property");
  await expect(page.getByTestId("customer-request-detail-project-details")).toContainText("Original Homeowner Description");
  await expect(page.getByTestId("customer-request-detail-modal")).toContainText("Seasonal HVAC maintenance");
  await expect(page.getByTestId("customer-request-detail-modal")).toContainText("Document any recommended follow-up service");
  await expect(page.getByTestId("customer-request-detail-modal")).toContainText("HVAC");
  await expect(page.getByTestId("customer-request-detail-modal")).toContainText("Seasonal Service");
  await expect(page.getByTestId("customer-request-detail-modal")).toContainText("As soon as possible");
  await expect(page.getByTestId("customer-request-detail-modal")).toContainText("Escrow milestone holds");
  await expect(page.getByTestId("customer-request-detail-modal")).toContainText("44 Lake Dr, Austin, TX, 78703");
  await expect(page.getByTestId("customer-request-detail-activity")).toContainText("Request saved");
  await page.getByRole("button", { name: "Close request details" }).click();
  await expect(page.getByTestId("customer-portal-requests")).toContainText("Kitchen Remodel");
  await page.getByTestId("customer-request-view-request-1").click();
  await expect(page.getByTestId("customer-request-detail-project-details")).toContainText("Project Details");
  await expect(page.getByTestId("customer-request-detail-project-details")).toContainText("Original Homeowner Description");
  await expect(page.getByTestId("customer-request-detail-project-details")).toContainText("AI-Enhanced Scope");
  await expect(page.getByTestId("customer-request-detail-project-details")).toContainText("Commercial Remodeling");
  await expect(page.getByTestId("customer-request-detail-project-details")).toContainText("Tenant Improvement");
  await expect(page.getByTestId("customer-request-detail-modal")).toContainText("Need a commercial remodel.");
  await expect(page.getByTestId("customer-request-detail-modal")).toContainText("Prepare the commercial remodel scope for contractor review.");
  await expect(page.getByTestId("customer-request-detail-selected-contractor")).toContainText("Builder Co");
  await expect(page.getByTestId("customer-request-detail-selected-contractor")).toContainText("Agreement created");
  await expect(page.getByTestId("customer-request-detail-selected-contractor")).toContainText("Commercial Remodeling");
  await expect(page.getByTestId("customer-request-detail-files")).toContainText("Existing office");
  await expect(page.getByTestId("customer-request-detail-activity")).toContainText("Contractor selected");
  await expect(page.getByTestId("customer-request-detail-activity")).toContainText("Agreement draft created");
  await expect(page.getByTestId("customer-request-detail-linked-work")).toContainText("Kitchen Remodel");
  await expect(page.getByTestId("customer-request-detail-modal")).toContainText("Within the next month");
  await page.getByRole("button", { name: "Close request details" }).click();
  await expect(page.getByTestId("customer-portal-request-compare-request-2")).toContainText("Compare Bids");
  await page.getByTestId("customer-portal-request-compare-request-2").click();
  await expect(page.getByTestId("customer-bid-comparison")).toContainText("Bid Comparison");
  await expect(page.getByTestId("customer-bid-comparison-card-lead-2")).toContainText("Builder Co");
  await expect(page.getByTestId("customer-bid-comparison-card-lead-3")).toContainText("Partner Co");
  await expect(page.getByTestId("customer-bid-comparison-card-lead-2")).toContainText("4.75 rating");
  await expect(page.getByTestId("customer-bid-comparison-card-lead-2")).toContainText("8 reviews");
  await expect(page.getByTestId("customer-bid-comparison-card-lead-3")).toContainText("Lowest price");
  await expect(page.getByTestId("customer-bid-comparison-card-lead-3")).toContainText("Most detailed milestone plan");
  await expect(page.getByTestId("customer-bid-comparison-card-lead-2")).toContainText("Profile reviewed");
  await expect(page.getByTestId("customer-bid-comparison-card-lead-2")).toContainText("Preferred status reviewed");
  await expect(page.getByTestId("customer-bid-comparison-card-lead-2")).toContainText("One-year workmanship warranty.");
  await expect(page.getByTestId("customer-portal-bids")).toContainText("Builder Co");
  await expect(page.getByTestId("customer-portal-bids")).toContainText("Partner Co");

  await page.getByTestId("customer-dashboard-tab-projects").click();
  await expect(page.getByTestId("customer-project-workspace")).toContainText("Kitchen Remodel");
  await expect(page.getByTestId("customer-project-filter-open")).toBeVisible();
  await expect(page.getByTestId("customer-project-filter-closed")).toBeVisible();
  await expect(page.getByTestId("customer-project-filter-all")).toBeVisible();
  await page.getByTestId("customer-project-card-1").click();
  await expect(page.getByTestId("customer-selected-agreement-summary")).toContainText("Selected agreement");
  await expect(page.getByTestId("customer-selected-agreement-summary")).toContainText("Kitchen Remodel");
  await expect(page.getByTestId("customer-agreement-view-action")).toHaveAttribute("href", "/agreements/magic/portal-token");
  await expect(page.getByTestId("customer-agreement-pdf-action")).toHaveAttribute("href", "/files/agreement.pdf");
  await expect(page.getByTestId("customer-selected-agreement-summary")).not.toContainText("coming soon");
  await expect(page.getByTestId("customer-homeowner-action-center")).toContainText("Request Amendment");
  await expect(page.getByTestId("customer-project-review-prompt")).toContainText("Share feedback about your project experience.");
  await page.getByTestId("customer-project-review-prompt").getByLabel("Rating").selectOption("5");
  await page.getByTestId("customer-project-review-prompt").getByLabel("Review title").fill("Professional project experience");
  await page.getByTestId("customer-project-review-prompt").getByLabel("Written review").fill("The contractor kept the project clean and communicated clearly.");
  await page.getByTestId("customer-project-review-prompt").getByRole("button", { name: "Submit Review" }).click();
  await expect.poll(() => submittedReviewPayload?.rating).toBe(5);
  await expect(submittedReviewPayload?.title).toBe("Professional project experience");
  await expect(page.getByTestId("customer-project-review-submitted")).toContainText("Thank you for sharing feedback");
  await expect(page.getByTestId("customer-project-needs-attention")).toContainText("Review the completed work");
  await expect(page.getByTestId("customer-project-review-draw-2")).toContainText("$3,600.00");
  await expect(page.getByTestId("customer-project-review-dispute-draw-2")).toContainText("Open Dispute");
  await page.getByTestId("customer-project-review-dispute-draw-2").click();
  await expect(page.getByTestId("customer-project-review-dispute-form-draw-2")).toContainText("Tell us what is wrong");
  await page.getByTestId("customer-project-review-dispute-form-draw-2").getByLabel("Homeowner note").fill("The walkthrough items are not complete yet.");
  await page.getByTestId("customer-project-review-dispute-form-draw-2").getByRole("button", { name: "Open Dispute" }).click();
  await expect(page.getByTestId("customer-project-review-draw-2")).toContainText("Escrow hold active");
  await expect(page.getByTestId("customer-project-review-dispute-status-draw-2")).toContainText("Funds tied to this issue remain paused");
  await expect(page.getByTestId("customer-project-review-dispute-draw-2")).toContainText("Track Issue Status");
  await expect(page.getByTestId("customer-project-review-dispute-draw-2")).toHaveAttribute("href", "/disputes/7702?token=draw-dispute-token");
  await page.getByRole("button", { name: "View Payments" }).click();
  await page.getByRole("button", { name: "View Documents" }).click();
  await page.getByRole("button", { name: "View Activity" }).click();
  await expect(page.getByTestId("customer-project-payments")).toContainText("Payment History");
  await expect(page.getByTestId("customer-project-payments")).toContainText("Release Paid");
  await expect(page.getByTestId("customer-project-payments")).not.toContainText("Escrow Funding");
  await expect(page.getByTestId("customer-project-escrow-history")).toContainText("Escrow History");
  await expect(page.getByTestId("customer-project-documents")).toContainText("Scope Addendum");
  await expect(page.getByTestId("customer-project-agreement-summary")).toContainText("One-year workmanship warranty");
  await expect(page.getByTestId("customer-project-updates")).toContainText("Demo is complete and final walkthrough is ready for review.");

  await page.getByTestId("customer-dashboard-tab-payments").click();
  await expect(page.getByTestId("customer-portal-payments")).toContainText("Project Payment Center");
  await expect(page.getByTestId("customer-payments-summary")).toContainText("Direct Payments");
  await expect(page.getByTestId("customer-payments-summary")).toContainText("Pending Review");
  await expect(page.getByTestId("customer-payments-summary")).toContainText("Released to Contractor");
  await expect(page.getByTestId("customer-payments-agreement-list")).toContainText("Payments by project");
  await expect(page.getByTestId("customer-payments-summary")).toContainText("Refunds / Adjustments");
  await expect(page.getByTestId("customer-payment-action-invoice-2")).toContainText("Direct Pay");
  await expect(page.getByTestId("customer-payment-primary-invoice-2")).toContainText("Pay Invoice");
  await expect(page.getByTestId("customer-payment-view-invoice-invoice-2")).toHaveAttribute("href", "/invoices/magic/portal-invoice-pay-token");
  await expect(page.getByTestId("customer-payment-open-dispute-invoice-2")).toHaveAttribute("href", "/invoices/magic/portal-invoice-pay-token?action=dispute");
  const drawPaymentCard = page.getByTestId("customer-payment-action-draw-2");
  await expect(drawPaymentCard).toContainText("Review Release");
  await expect(drawPaymentCard).toContainText("Escrow hold active");
  await expect(drawPaymentCard.getByTestId("customer-payment-dispute-status-draw-2")).toContainText("Funds tied to this issue remain paused");
  await expect(drawPaymentCard.getByTestId("customer-payment-track-dispute-draw-2")).toHaveAttribute("href", "/disputes/7702?token=draw-dispute-token");
  await expect(page.getByTestId("customer-payment-action-invoice-1")).toContainText("View Record");
  await expect(page.getByTestId("customer-payment-action-invoice-zero")).toHaveCount(0);
  await expect(page.getByTestId("customer-portal-payments")).not.toContainText("$0.00");
  await expect(page.getByTestId("customer-portal-payments")).not.toContainText("No payment required");

  await page.getByTestId("customer-dashboard-tab-overview").click();
  await expect(page.getByTestId("customer-dashboard-overview")).toContainText("Open issue for Kitchen Remodel");
  await expect(page.getByTestId("customer-dashboard-overview")).not.toContainText("$0.00 - Approved");

  await page.getByTestId("customer-dashboard-tab-notifications").click();
  await expect(page.getByTestId("customer-notifications-center")).toContainText("Notifications Center");
  await page.getByTestId("customer-notifications-filter-all").click();
  await expect(page.getByTestId("customer-notifications-center")).toContainText("Agreement needs signature");
  await expect(page.getByTestId("customer-notifications-center")).toContainText("Payment received");
  await expect(page.getByTestId("customer-notifications-center").getByRole("heading", { name: "Payment received" })).toHaveCount(1);
  await expect(page.getByTestId("customer-notifications-center")).not.toContainText("Internal payment email row");

  await page.getByTestId("customer-dashboard-tab-documents").click();
  await expect(page.getByTestId("customer-portal-documents")).toContainText("Invoices & Receipts");
  await expect(page.getByTestId("customer-portal-documents")).toContainText("Other Property Documents");
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
  await expect(page.getByTestId("property-command-summary")).toContainText("Property Summary");
  await expect(page.getByTestId("property-command-summary")).toContainText("Kitchen Remodel");
  await expect(page.getByTestId("property-command-summary")).toContainText("123 Main St, Austin, TX, 78701");
  await expect(page.getByTestId("property-command-summary")).toContainText("1998");
  await expect(page.getByTestId("property-command-summary")).toContainText("2,400");
  await expect(page.getByTestId("property-summary-selector")).toBeVisible();
  await expect(page.getByTestId("property-home-systems")).toContainText("Home Systems");
  await expect(page.getByTestId("property-home-systems")).toContainText("HVAC");
  await expect(page.getByTestId("property-home-systems")).toContainText("Water Heater");
  await expect(page.getByTestId("property-active-work")).toContainText("Active Projects");
  await expect(page.getByTestId("property-active-work")).toContainText("Open Requests");
  await expect(page.getByTestId("property-active-work")).toContainText("Kitchen Remodel");
  await expect(page.getByTestId("property-maintenance-center")).toContainText("Maintenance Center");
  await expect(page.getByTestId("property-maintenance-center")).toContainText("HVAC service may be due.");
  await expect(page.getByTestId("customer-property-manager")).toContainText("My Properties");
  await expect(page.getByTestId("customer-property-card-1")).toContainText("Primary Property");
  await expect(page.getByTestId("customer-property-card-2")).toContainText("Lake House");
  await page.getByTestId("property-summary-selector").selectOption("2");
  await expect(page.getByLabel("Property name")).toHaveValue("Lake House");
  await page.getByTestId("customer-property-add-button").click();
  await expect(page.getByRole("button", { name: "Add property", exact: true })).toBeVisible();
  await expect(page.getByTestId("home-records-timeline")).toContainText("Kitchen Remodel");
  await expect(page.getByTestId("home-records-timeline")).toContainText("Water heater warranty");
  await expect(page.getByTestId("home-records-warranty-center")).toContainText("One-year workmanship warranty");
  await expect(page.getByTestId("property-photo-gallery")).toContainText("Before kitchen photo");
  await expect(page.getByTestId("home-records-document-groups")).toContainText("Agreements");
  await expect(page.getByTestId("home-records-document-groups")).toContainText("Invoices & Receipts");
  await expect(page.getByTestId("home-records-document-groups")).toContainText("Warranties");
  await expect(page.getByTestId("home-records-document-groups")).toContainText("Permits");
  await expect(page.getByTestId("home-records-document-groups")).toContainText("Photos");
  await page.getByTestId("home-records-open-documents").click();
  await expect(page.getByTestId("customer-dashboard-tab-documents")).toHaveClass(/border-amber/);
  await page.getByTestId("customer-dashboard-tab-property").click();
  await expect(page.getByTestId("home-records-timeline")).toContainText("Quarterly service visit");
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
  await expect(page.getByTestId("customer-notifications-empty")).toContainText("No new updates");
  await expect(page.getByTestId("customer-overview-projects-empty")).toContainText("No active projects yet");
  await expect(page.getByTestId("customer-overview-requests-empty")).toContainText("No requests yet");

  await page.getByTestId("customer-dashboard-tab-projects").click();
  await expect(page.getByTestId("customer-project-workspace-empty")).toContainText("No projects connected yet");

  await page.getByTestId("customer-dashboard-tab-requests").click();
  await expect(page.getByTestId("customer-requests-empty")).toContainText("No saved requests yet");
  await expect(page.getByText("Saved requests stay internal here first")).toBeVisible();
  await expect(page.getByTestId("customer-bids-empty")).toContainText("No bids yet");

  await page.getByTestId("customer-dashboard-tab-property").click();
  await expect(page.getByTestId("property-command-summary")).toContainText("Property Summary");
  await expect(page.getByTestId("property-home-systems")).toContainText("Home Systems");
  await expect(page.getByTestId("property-active-work")).toContainText("Active Projects");
  await expect(page.getByTestId("property-maintenance-center")).toContainText("Maintenance Center");
  await expect(page.getByTestId("home-records-timeline-empty")).toContainText("No property timeline yet");
  await expect(page.getByTestId("home-records-warranty-empty")).toContainText("No warranty details yet");
  await expect(page.getByTestId("property-photo-gallery-empty")).toContainText("No property photos yet");
  await expect(page.getByTestId("customer-property-files-empty")).toContainText("No property files yet");

  await page.getByTestId("customer-dashboard-tab-notifications").click();
  await expect(page.getByTestId("customer-notifications-center-empty")).toContainText("No notifications yet");

  await page.getByTestId("customer-dashboard-tab-payments").click();
  await expect(page.getByTestId("customer-payments-empty")).toContainText("No payment records yet");

  await page.getByTestId("customer-dashboard-tab-documents").click();
  await expect(page.getByTestId("customer-documents-empty")).toContainText("No documents yet");
});

test("customer portal limits long home records, payments, and documents without dead timeline links", async ({ page }) => {
  let amendmentPayload = null;
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
    if (route.request().method() === "POST" && requestUrl.includes("/agreements/105/amendments/")) {
      amendmentPayload = JSON.parse(route.request().postData() || "{}");
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          amendment_request: { id: 9001, status: "open", status_label: "Open" },
          portal: longPortalPayload,
        }),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/portal/long-token", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("customer-dashboard")).toBeVisible();

  await expect(page.getByTestId("customer-notifications-panel").getByRole("heading", { name: "Recent Updates" })).toBeVisible();
  await page.getByTestId("customer-dashboard-tab-projects").click();
  await expect(page.getByTestId("customer-projects-section-header")).toHaveCount(0);
  await expect(page.getByTestId("customer-project-workspace")).toContainText("Agreements & Projects");
  await expect(page.getByTestId("customer-project-filter-open")).toBeVisible();
  await expect(page.getByTestId("customer-project-filter-closed")).toBeVisible();
  await expect(page.getByTestId("customer-project-filter-all")).toBeVisible();
  await expect(page.getByTestId("customer-project-card-1")).toBeVisible();
  await expect(page.getByTestId("customer-project-card-1")).toHaveClass(/border-amber-300/);
  await expect(page.getByTestId("customer-project-workspace")).not.toContainText("Internal Contractor Draft");
  await expect(page.getByTestId("customer-project-workspace")).not.toContainText("Draft Patio Repair");
  await expect(page.getByTestId("customer-project-card-static-history-project")).not.toBeVisible();
  await expect(page.getByTestId("customer-selected-agreement-summary")).toContainText("Kitchen Remodel");
  await page.getByTestId("customer-project-search").fill("Signed Stale Draft");
  await expect(page.getByTestId("customer-project-status-signed-stale-draft-project")).toContainText("Signed");
  await expect(page.getByTestId("customer-project-status-signed-stale-draft-project")).not.toContainText("Draft");
  await page.getByTestId("customer-project-card-signed-stale-draft-project").click();
  await expect(page.getByTestId("customer-selected-agreement-status")).toContainText("Signed");
  await page.getByTestId("customer-project-search").fill("Funded Stale Draft");
  await expect(page.getByTestId("customer-project-status-funded-stale-draft-project")).toContainText(/Funded|In Progress/);
  await expect(page.getByTestId("customer-project-status-funded-stale-draft-project")).not.toContainText("Draft");
  await page.getByTestId("customer-project-search").fill("Escrow Funded Invoice");
  await expect(page.getByTestId("customer-project-status-escrow-funded-invoice-project")).not.toContainText("Draft");
  await page.getByTestId("customer-project-card-escrow-funded-invoice-project").click();
  await expect(page.getByTestId("customer-payment-summary-project-value")).toContainText("$20,000.00");
  await expect(page.getByTestId("customer-payment-summary-escrow-funded")).toContainText("$20,000.00");
  await expect(page.getByTestId("customer-payment-summary-released")).toContainText("$7,000.00 released to contractor");
  await expect(page.getByTestId("customer-payment-summary-remaining-escrow")).toContainText("$13,000.00 remaining in escrow");
  await expect(page.getByTestId("customer-payment-summary-paid-progress")).toContainText("35% released");
  await expect(page.getByTestId("customer-selected-agreement-summary")).not.toContainText("contractor invoices");
  await page.getByTestId("customer-project-toggle-details").click();
  await expect(page.getByTestId("customer-project-payments")).toContainText("Release Paid");
  await expect(page.getByTestId("customer-project-payments")).toContainText("Paid to contractor from escrow");
  await expect(page.getByTestId("customer-project-payments")).not.toContainText("Escrow Funded");
  await expect(page.getByTestId("customer-project-escrow-history")).toContainText("Escrow Funded");
  await expect(page.getByTestId("customer-project-escrow-history")).toContainText("Escrow Release to Contractor");
  await expect(page.getByTestId("customer-project-escrow-history")).toContainText("Reduced escrow balance and paid contractor");
  await expect(page.getByTestId("customer-project-escrow-history")).toContainText("Linked payment: Release Paid");
  await expect(page.getByTestId("customer-project-escrow-history")).not.toContainText("Escrow Released");
  await expect(page.getByTestId("customer-selected-agreement-summary")).not.toContainText("$27,000.00");
  await expect(page.getByTestId("customer-selected-agreement-summary")).not.toContainText("Released / Paid");
  await expect(page.getByTestId("customer-homeowner-action-center")).toContainText("Need to Change Something?");
  await page.getByTestId("customer-action-amendment").click();
  await expect(page.getByTestId("customer-action-modal")).toContainText("Request Amendment");
  await page.getByTestId("customer-action-change-type").selectOption("descope_remove_work");
  await expect(page.getByTestId("customer-action-descope-summary")).toContainText("De-scope / Remove Work");
  await page.getByTestId("customer-action-revised-project-value").fill("15000");
  await expect(page.getByTestId("customer-action-descope-summary")).toContainText("Original project value");
  await expect(page.getByTestId("customer-action-descope-summary")).toContainText("$20,000.00");
  await expect(page.getByTestId("customer-action-descope-summary")).toContainText("Revised project value");
  await expect(page.getByTestId("customer-action-descope-summary")).toContainText("$15,000.00");
  await expect(page.getByTestId("customer-action-descope-summary")).toContainText("Escrow currently funded");
  await expect(page.getByTestId("customer-action-descope-summary")).toContainText("Estimated refundable escrow surplus");
  await expect(page.getByTestId("customer-action-descope-summary")).toContainText("$5,000.00");
  await page.getByTestId("customer-action-requested-change").fill("Please remove the remaining cabinet installation milestone.");
  await page.getByTestId("customer-action-reason").fill("We are cancelling the remaining work and reducing the project value.");
  await page.getByTestId("customer-action-submit").click();
  await expect(page.getByTestId("customer-action-modal")).toHaveCount(0);
  expect(amendmentPayload).toMatchObject({
    change_type: "descope_remove_work",
    revised_project_value: "15000",
  });
  await page.getByTestId("customer-project-filter-all").click();
  await page.getByTestId("customer-project-search").fill("True Draft Agreement");
  await expect(page.getByTestId("customer-project-status-true-draft-project")).toContainText("Draft");
  await page.getByTestId("customer-project-search").fill("");
  await page.getByTestId("customer-project-filter-closed").click();
  await page.getByTestId("customer-project-search").fill("Completed Stale Draft");
  await expect(page.getByTestId("customer-project-status-completed-stale-draft-project")).toContainText("Completed");
  await expect(page.getByTestId("customer-project-status-completed-stale-draft-project")).not.toContainText("Draft");
  await page.getByTestId("customer-project-search").fill("");
  await expect(page.getByTestId("customer-project-workspace")).toContainText("Warranty Project 1");
  await expect(page.getByTestId("customer-project-card-1")).not.toBeVisible();
  await page.getByTestId("customer-project-filter-all").click();
  await expect(page.getByTestId("customer-project-card-1")).toBeVisible();
  await expect(page.getByTestId("customer-project-workspace")).toContainText("Warranty Project 1");
  await expect(page.getByTestId("customer-project-result-count")).toContainText("Showing 1-10 of");
  await page.getByTestId("customer-project-search").fill("Roof");
  await expect(page.getByTestId("customer-agreement-list")).toContainText("Roof Replacement");
  await expect(page.getByTestId("customer-agreement-list")).not.toContainText("Warranty Project 1");
  await page.getByTestId("customer-project-search").fill("");
  await page.getByTestId("customer-project-filter-all").click();
  await page.getByTestId("customer-project-work-filter").selectOption("maintenance");
  await expect(page.getByTestId("customer-agreement-list")).toContainText("Warranty Project 1");
  await expect(page.getByTestId("customer-agreement-list")).not.toContainText("Warranty Project 2");
  await page.getByTestId("customer-project-work-filter").selectOption("all");
  await page.getByTestId("customer-project-property-filter").selectOption("1");
  await expect(page.getByTestId("customer-agreement-list")).toContainText("Roof Replacement");
  await expect(page.getByTestId("customer-agreement-list")).not.toContainText("Older Deck Repair");
  await page.getByTestId("customer-project-property-filter").selectOption("all");
  await page.getByTestId("customer-project-sort").selectOption("value_low");
  await expect(page.getByTestId("customer-agreement-list").locator("button").first()).toContainText("Draft Patio Repair");
  await page.getByTestId("customer-project-sort").selectOption("value_high");
  await expect(page.getByTestId("customer-agreement-list").locator("button").first()).toContainText("Escrow Funded Invoice");
  await page.getByTestId("customer-project-filter-closed").click();
  await expect(page.getByTestId("customer-project-load-more")).toBeVisible();
  await page.getByTestId("customer-project-load-more").click();
  await expect(page.getByTestId("customer-agreement-list")).toContainText("Warranty Project 12");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("customer-dashboard-tab-projects").click();
  await expect(page.getByTestId("customer-agreement-list")).toBeVisible();
  await expect(page.getByTestId("customer-selected-agreement-summary")).toBeVisible();
  await page.getByTestId("customer-project-card-1").click();
  await expect(page.getByTestId("customer-selected-agreement-summary")).toContainText("Kitchen Remodel");

  await page.getByTestId("customer-dashboard-tab-property").click();
  await expect(page.getByTestId("home-records-timeline")).toBeVisible();
  await expect(page.getByTestId(/home-records-timeline-(action|static)-/)).toHaveCount(5);
  await expect(page.getByTestId("home-records-timeline")).not.toContainText("Older Deck Repair");
  await expect(page.getByTestId("home-records-timeline")).toContainText("Quarterly service visit");
  await expect(page.getByTestId("property-maintenance-center")).toContainText("Completed maintenance");
  await page.getByTestId("home-records-timeline-show-more").click();
  await expect(page.getByTestId("home-records-timeline")).toContainText("Older Deck Repair");
  await expect(page.getByTestId("home-records-timeline-action-document-document-1")).toHaveAttribute("href", "/files/scope-addendum.txt");
  await expect(page.getByTestId("home-records-timeline-action-document-document-1")).toContainText("View document");
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
