import { expect, test } from "@playwright/test";

const bidRows = [
  {
    bid_id: "intake-1",
    source_kind: "intake",
    source_kind_label: "Intake",
    workspace_stage: "active_bid",
    workspace_stage_label: "Active Bid",
    source_id: 1,
    source_reference: "Intake #1",
    project_title: "Draft Customer Kitchen",
    customer_name: "Draft Customer",
    customer_email: "draft@example.com",
    customer_phone: "",
    location: "Austin, TX",
    project_class: "residential",
    project_class_label: "Residential",
    project_type: "Kitchen Remodel",
    project_subtype: "Cabinet Replacement",
    bid_amount: null,
    bid_amount_label: "-",
    submitted_at: "2026-04-01T15:20:00Z",
    status: "draft",
    status_label: "Draft",
    status_group: "open",
    linked_agreement_id: null,
    linked_agreement_label: "",
    linked_agreement_reference: "",
    linked_agreement_url: "",
    notes: "Replace attic insulation",
    timeline: "",
    budget_text: "",
    milestone_preview: [],
    request_signals: ["Guided Intake"],
    request_snapshot: {
      project_title: "Draft Customer Kitchen",
      project_type: "Kitchen Remodel",
      project_subtype: "Cabinet Replacement",
      refined_description: "Replace attic insulation",
      location: "Austin, TX",
      request_path_label: "Project request",
      measurement_handling: "",
      timeline: "",
      budget: "",
      clarification_summary: [],
      clarification_count: 0,
      photo_count: 0,
      photos: [],
      milestones: [],
      request_signals: ["Guided Intake"],
    },
    next_action: { key: "review_bid", label: "Review Bid", target: "" },
  },
  {
    bid_id: "intake-2",
    source_kind: "intake",
    source_kind_label: "Intake",
    workspace_stage: "active_bid",
    workspace_stage_label: "Active Bid",
    source_id: 2,
    source_reference: "Intake #2",
    project_title: "Retail Storefront Buildout",
    customer_name: "Commercial Customer",
    customer_email: "commercial@example.com",
    customer_phone: "",
    location: "Dallas, TX",
    project_class: "commercial",
    project_class_label: "Commercial",
    project_type: "Commercial",
    project_subtype: "Tenant Improvement",
    bid_amount: "27500.00",
    bid_amount_label: "$27,500.00",
    submitted_at: "2026-04-11T15:20:00Z",
    status: "under_review",
    status_label: "Under Review",
    status_group: "under_review",
    linked_agreement_id: null,
    linked_agreement_label: "",
    linked_agreement_reference: "",
    linked_agreement_url: "",
    notes: "Tenant buildout for a retail storefront",
    timeline: "",
    budget_text: "",
    milestone_preview: ["Demo Phase", "Buildout Phase"],
    request_signals: ["Guided Intake", "Budget Provided", "Photos", "Timeline Provided", "Clarifications Answered"],
    request_snapshot: {
      project_title: "Retail Storefront Buildout",
      project_type: "Commercial",
      project_subtype: "Tenant Improvement",
      refined_description: "Commercial tenant improvement with multiple phases.",
      location: "Dallas, TX",
      request_path_label: "Project request",
      measurement_handling: "Site visit required",
      timeline: "30 days",
      budget: "$27,500.00",
      clarification_summary: [
        { key: "materials", label: "Materials", value: "Customer" },
        { key: "start_timing", label: "Timing", value: "Next month" },
      ],
      clarification_count: 2,
      photo_count: 1,
      photos: [
        { id: 10, image_url: "https://example.com/photo.jpg", original_name: "front-room.jpg", caption: "Front room view", uploaded_at: "2026-04-11T15:00:00Z" },
      ],
      milestones: ["Demo Phase", "Buildout Phase"],
      request_signals: ["Guided Intake", "Budget Provided", "Photos", "Timeline Provided", "Clarifications Answered"],
    },
    next_action: { key: "review_bid", label: "Review Bid", target: "" },
  },
  {
    bid_id: "lead-3",
    source_kind: "lead",
    source_kind_label: "Lead",
    workspace_stage: "active_bid",
    workspace_stage_label: "Active Bid",
    source_id: 3,
    source_reference: "Lead #3",
    project_title: "Kitchen Remodel",
    customer_name: "Awarded Lead",
    customer_email: "award@example.com",
    customer_phone: "",
    location: "Austin, TX",
    project_class: "residential",
    project_class_label: "Residential",
    project_type: "Kitchen Remodel",
    bid_amount: "12000.00",
    bid_amount_label: "$12,000.00",
    submitted_at: "2026-04-12T15:20:00Z",
    status: "awarded",
    status_label: "Awarded",
    status_group: "awarded",
    linked_agreement_id: null,
    linked_agreement_label: "",
    linked_agreement_reference: "",
    linked_agreement_url: "",
    notes: "Need a kitchen remodel.",
    timeline: "",
    budget_text: "$12,000.00",
    milestone_preview: [],
    request_signals: ["Budget Provided"],
    request_snapshot: {
      project_title: "Kitchen Remodel",
      project_type: "Kitchen Remodel",
      project_subtype: "",
      refined_description: "Need a kitchen remodel.",
      location: "Austin, TX",
      request_path_label: "Project request",
      measurement_handling: "",
      timeline: "",
      budget: "$12,000.00",
      clarification_summary: [],
      clarification_count: 0,
      photo_count: 0,
      photos: [],
      milestones: [],
      request_signals: ["Budget Provided"],
    },
    next_action: { key: "convert_to_agreement", label: "Convert to Agreement", target: "" },
  },
  {
    bid_id: "lead-4",
    source_kind: "lead",
    source_kind_label: "Lead",
    workspace_stage: "closed",
    workspace_stage_label: "Closed / Archived",
    source_id: 4,
    source_reference: "Lead #4",
    project_title: "Office Suite Renovation",
    customer_name: "Declined Lead",
    customer_email: "declined@example.com",
    customer_phone: "",
    location: "Houston, TX",
    project_class: "commercial",
    project_class_label: "Commercial",
    project_type: "Commercial",
    bid_amount: null,
    bid_amount_label: "-",
    submitted_at: "2026-04-13T15:20:00Z",
    status: "expired",
    status_label: "Not Selected",
    status_group: "declined_expired",
    linked_agreement_id: null,
    linked_agreement_label: "",
    linked_agreement_reference: "",
    linked_agreement_url: "",
    notes: "Office suite renovation.",
    timeline: "",
    budget_text: "",
    milestone_preview: [],
    request_signals: [],
    request_snapshot: {
      project_title: "Office Suite Renovation",
      project_type: "Commercial",
      project_subtype: "",
      refined_description: "Office suite renovation.",
      location: "Houston, TX",
      request_path_label: "Project request",
      measurement_handling: "",
      timeline: "",
      budget: "",
      clarification_summary: [],
      clarification_count: 0,
      photo_count: 0,
      photos: [],
      milestones: [],
      request_signals: [],
    },
    next_action: { key: "view_details", label: "View Details", target: "" },
    status_note: "Another contractor was selected for this project.",
  },
  {
    bid_id: "lead-5",
    source_kind: "lead",
    source_kind_label: "Lead",
    workspace_stage: "active_bid",
    workspace_stage_label: "Active Bid",
    source_id: 5,
    source_reference: "Lead #5",
    project_title: "Retail Buildout",
    customer_name: "Linked Commercial Lead",
    customer_email: "linked@example.com",
    customer_phone: "",
    location: "Dallas, TX",
    project_class: "commercial",
    project_class_label: "Commercial",
    project_type: "Tenant Buildout",
    bid_amount: "48000.00",
    bid_amount_label: "$48,000.00",
    submitted_at: "2026-04-09T15:20:00Z",
    status: "awarded",
    status_label: "Awarded",
    status_group: "awarded",
    linked_agreement_id: 480,
    linked_agreement_label: "Retail Buildout",
    linked_agreement_reference: "Agreement #480",
    linked_agreement_url: "/app/agreements/480",
    notes: "Commercial retail buildout.",
    timeline: "",
    budget_text: "",
    milestone_preview: ["Demo Phase", "Buildout Phase"],
    request_signals: ["Photos", "Timeline Provided"],
    request_snapshot: {
      project_title: "Retail Buildout",
      project_type: "Tenant Buildout",
      project_subtype: "Retail Buildout",
      refined_description: "Commercial retail buildout.",
      location: "Dallas, TX",
      request_path_label: "Project request",
      measurement_handling: "Provided",
      timeline: "45 days",
      budget: "$48,000.00",
      clarification_summary: [],
      clarification_count: 0,
      photo_count: 2,
      photos: [
        { id: 20, image_url: "https://example.com/lead-photo-1.jpg", original_name: "layout.png", caption: "Layout", uploaded_at: "2026-04-09T15:00:00Z" },
        { id: 21, image_url: "", original_name: "sketch.pdf", caption: "Sketch", uploaded_at: "2026-04-09T15:05:00Z" },
      ],
      milestones: ["Demo Phase", "Buildout Phase"],
      request_signals: ["Photos", "Timeline Provided"],
    },
    next_action: { key: "open_agreement", label: "Open Agreement", target: "/app/agreements/480" },
  },
  {
    bid_id: "lead-6",
    source_kind: "lead",
    source_kind_label: "Lead",
    workspace_stage: "new_lead",
    workspace_stage_label: "New Lead",
    source_id: 6,
    source_reference: "Lead #6",
    project_title: "Bathroom Remodel",
    customer_name: "New Lead Customer",
    customer_email: "newlead@example.com",
    customer_phone: "",
    location: "Austin, TX",
    project_class: "residential",
    project_class_label: "Residential",
    project_type: "Bathroom Remodel",
    project_subtype: "Primary Bath",
    bid_amount: "18500.00",
    bid_amount_label: "$18,500.00",
    submitted_at: "2026-04-14T15:20:00Z",
    status: "submitted",
    status_label: "Submitted",
    status_group: "open",
    linked_agreement_id: null,
    linked_agreement_label: "",
    linked_agreement_reference: "",
    linked_agreement_url: "",
    notes: "Replace shower tile and vanity.",
    timeline: "21 days",
    budget_text: "$18,500.00",
    milestone_preview: ["Demolition", "Tile and Fixtures"],
    request_signals: ["Guided Intake", "Photos", "Budget Provided", "Timeline Provided", "Clarifications Answered", "Multi-Quote Request"],
    request_snapshot: {
      project_title: "Bathroom Remodel",
      project_type: "Bathroom Remodel",
      project_subtype: "Primary Bath",
      refined_description: "Replace shower tile and vanity.",
      location: "Austin, TX",
      request_path_label: "Multi-quote request",
      measurement_handling: "Provided",
      timeline: "21 days",
      budget: "$18,500.00",
      clarification_summary: [
        { key: "materials", label: "Materials", value: "Contractor" },
        { key: "layout", label: "Layout", value: "No layout changes" },
      ],
      clarification_count: 2,
      photo_count: 1,
      photos: [
        { id: 30, image_url: "https://example.com/bathroom.jpg", original_name: "bathroom.jpg", caption: "Shower area", uploaded_at: "2026-04-14T15:00:00Z" },
      ],
      milestones: ["Demolition", "Tile and Fixtures"],
      request_signals: ["Guided Intake", "Photos", "Budget Provided", "Timeline Provided", "Clarifications Answered", "Multi-Quote Request"],
    },
    next_action: { key: "review_bid", label: "Review Request", target: "" },
  },
  {
    bid_id: "lead-7",
    source_kind: "lead",
    source_kind_label: "Lead",
    workspace_stage: "new_lead",
    workspace_stage_label: "New Lead",
    source_id: 7,
    source_reference: "Lead #7",
    project_title: "Guest Bath Refresh",
    customer_name: "Need More Info",
    customer_email: "guestbath@example.com",
    customer_phone: "",
    location: "Round Rock, TX",
    project_class: "residential",
    project_class_label: "Residential",
    project_type: "Bathroom Remodel",
    project_subtype: "Guest Bath",
    bid_amount: null,
    bid_amount_label: "-",
    submitted_at: "2026-04-08T15:20:00Z",
    status: "submitted",
    status_label: "Submitted",
    status_group: "open",
    linked_agreement_id: null,
    linked_agreement_label: "",
    linked_agreement_reference: "",
    linked_agreement_url: "",
    notes: "Need a quote for a guest bath refresh.",
    timeline: "",
    budget_text: "",
    milestone_preview: [],
    request_signals: ["Guided Intake"],
    request_snapshot: {
      project_title: "Guest Bath Refresh",
      project_type: "Bathroom Remodel",
      project_subtype: "Guest Bath",
      refined_description: "Need a quote for a guest bath refresh.",
      location: "Round Rock, TX",
      request_path_label: "Project request",
      measurement_handling: "",
      timeline: "",
      budget: "",
      clarification_summary: [],
      clarification_count: 0,
      photo_count: 0,
      photos: [],
      milestones: [],
      request_signals: ["Guided Intake"],
    },
    next_action: { key: "review_bid", label: "Review Request", target: "" },
  },
  {
    bid_id: "lead-8",
    source_kind: "lead",
    source_kind_label: "Lead",
    workspace_stage: "follow_up",
    workspace_stage_label: "Follow-Up",
    source_id: 8,
    source_reference: "Lead #8",
    project_title: "Patio Repair Follow-Up",
    customer_name: "Saved Customer",
    customer_email: "saved@example.com",
    customer_phone: "",
    location: "Round Rock, TX",
    project_class: "residential",
    project_class_label: "Residential",
    project_type: "Patio Repair",
    project_subtype: "Flagstone Patio",
    bid_amount: null,
    bid_amount_label: "-",
    submitted_at: "2026-04-07T15:20:00Z",
    status: "follow_up",
    status_label: "Follow-Up",
    status_group: "follow_up",
    linked_agreement_id: null,
    linked_agreement_label: "",
    linked_agreement_reference: "",
    linked_agreement_url: "",
    notes: "Saved for later review.",
    timeline: "14 days",
    budget_text: "$9,500.00",
    milestone_preview: ["Clean-up", "Reset Stone"],
    request_signals: ["Guided Intake", "Budget Provided", "Timeline Provided"],
    request_snapshot: {
      project_title: "Patio Repair Follow-Up",
      project_type: "Patio Repair",
      project_subtype: "Flagstone Patio",
      refined_description: "Saved for later review.",
      location: "Round Rock, TX",
      request_path_label: "Project request",
      measurement_handling: "Not sure",
      timeline: "14 days",
      budget: "$9,500.00",
      clarification_summary: [],
      clarification_count: 0,
      photo_count: 0,
      photos: [],
      milestones: ["Clean-up", "Reset Stone"],
      request_signals: ["Guided Intake", "Budget Provided", "Timeline Provided"],
    },
    next_action: { key: "review_bid", label: "Review Lead", target: "" },
    status_note: "This lead is saved for later review.",
  },
];

const propertyWorkOrderRows = [
  {
    bid_id: "opportunity-31",
    source_kind: "property_work_order",
    source_kind_label: "Property Management Work Order",
    workspace_stage: "new_lead",
    workspace_stage_label: "New Lead",
    source_id: 31,
    source_reference: "PWO-000031",
    project_title: "Repair sink leak",
    customer_name: "Oak Tree Property Management",
    customer_email: "ops@oaktree.example",
    customer_phone: "512-555-0131",
    location: "123 Managed Way\nAustin, TX 78701",
    project_class: "commercial",
    project_class_label: "Commercial",
    project_type: "Plumbing",
    project_subtype: "Urgent",
    bid_amount: null,
    bid_amount_label: "-",
    submitted_at: "2026-04-06T15:20:00Z",
    status: "submitted",
    status_label: "Needs Response",
    status_group: "open",
    linked_agreement_id: null,
    linked_agreement_label: "",
    linked_agreement_reference: "",
    linked_agreement_url: "",
    notes: "Kitchen sink is leaking into the cabinet.",
    timeline: "",
    budget_text: "",
    milestone_preview: [],
    property_work_order_id: 310,
    work_order_number: "PWO-000031",
    marketplace_status: "sent",
    marketplace_status_label: "Sent",
    request_signals: ["Property Management", "Urgent", "Plumbing", "Photos/Attachments"],
    request_snapshot: {
      project_title: "Repair sink leak",
      project_type: "Plumbing",
      project_subtype: "Urgent",
      project_family_label: "Property Management Work Order",
      refined_description: "Kitchen sink is leaking into the cabinet.",
      project_scope_summary: "Kitchen sink is leaking into the cabinet.",
      location: "123 Managed Way\nAustin, TX 78701",
      request_path_label: "Property Management Work Order",
      property: "Oak Duplex",
      unit: "Unit B",
      tenant: "Taylor Tenant",
      priority: "Urgent",
      category: "Plumbing",
      work_order_number: "PWO-000031",
      clarification_summary: [
        { key: "property", label: "Property", value: "Oak Duplex" },
        { key: "unit", label: "Unit", value: "Unit B" },
        { key: "tenant", label: "Tenant", value: "Taylor Tenant" },
        { key: "priority", label: "Priority", value: "Urgent" },
        { key: "category", label: "Category", value: "Plumbing" },
      ],
      clarification_count: 5,
      photo_count: 1,
      photos: [
        { id: 3101, image_url: "https://example.com/leak.jpg", url: "https://example.com/leak.jpg", original_name: "leak.jpg", caption: "Tenant upload", uploaded_at: "2026-04-06T15:00:00Z" },
      ],
      milestones: [],
      request_signals: ["Property Management", "Urgent", "Plumbing", "Photos/Attachments"],
    },
    next_action: { key: "accept_property_work_order", label: "Accept Work Order", target: "" },
  },
  {
    bid_id: "opportunity-32",
    source_kind: "property_work_order",
    source_kind_label: "Property Management Work Order",
    workspace_stage: "follow_up",
    workspace_stage_label: "Follow-Up",
    source_id: 32,
    source_reference: "PWO-000032",
    project_title: "Replace disposal",
    customer_name: "Oak Tree Property Management",
    customer_email: "ops@oaktree.example",
    customer_phone: "512-555-0131",
    location: "125 Managed Way\nAustin, TX 78701",
    project_class: "commercial",
    project_class_label: "Commercial",
    project_type: "Appliance",
    project_subtype: "Normal",
    bid_amount: null,
    bid_amount_label: "-",
    submitted_at: "2026-04-05T15:20:00Z",
    status: "accepted",
    status_label: "Accepted",
    status_group: "follow_up",
    linked_agreement_id: null,
    linked_agreement_label: "",
    linked_agreement_reference: "",
    linked_agreement_url: "",
    notes: "Accepted disposal replacement work order.",
    timeline: "",
    budget_text: "",
    milestone_preview: [],
    property_work_order_id: 320,
    work_order_number: "PWO-000032",
    marketplace_status: "accepted",
    marketplace_status_label: "Accepted",
    request_signals: ["Property Management", "Normal", "Appliance"],
    request_snapshot: {
      project_title: "Replace disposal",
      project_type: "Appliance",
      project_subtype: "Normal",
      project_family_label: "Property Management Work Order",
      refined_description: "Accepted disposal replacement work order.",
      project_scope_summary: "Accepted disposal replacement work order.",
      location: "125 Managed Way\nAustin, TX 78701",
      request_path_label: "Property Management Work Order",
      property: "Oak Duplex",
      unit: "Unit A",
      tenant: "Jamie Resident",
      priority: "Normal",
      category: "Appliance",
      work_order_number: "PWO-000032",
      clarification_summary: [],
      clarification_count: 0,
      photo_count: 0,
      photos: [],
      milestones: [],
      request_signals: ["Property Management", "Normal", "Appliance"],
    },
    next_action: { key: "prepare_agreement_draft", label: "Prepare Agreement Draft", target: "" },
  },
  {
    bid_id: "opportunity-33",
    source_kind: "property_work_order",
    source_kind_label: "Property Management Work Order",
    workspace_stage: "active_bid",
    workspace_stage_label: "Active Bid",
    source_id: 33,
    source_reference: "PWO-000033",
    project_title: "Repair panel issue",
    customer_name: "Oak Tree Property Management",
    customer_email: "ops@oaktree.example",
    customer_phone: "512-555-0131",
    location: "127 Managed Way\nAustin, TX 78701",
    project_class: "commercial",
    project_class_label: "Commercial",
    project_type: "Electrical",
    project_subtype: "Urgent",
    bid_amount: null,
    bid_amount_label: "-",
    submitted_at: "2026-04-04T15:20:00Z",
    status: "awarded",
    status_label: "Agreement Draft Ready",
    status_group: "awarded",
    linked_agreement_id: 933,
    linked_agreement_label: "Repair panel issue",
    linked_agreement_reference: "Agreement #933",
    linked_agreement_url: "/app/agreements/933/wizard?step=1",
    notes: "Agreement draft is already linked.",
    timeline: "",
    budget_text: "",
    milestone_preview: [],
    property_work_order_id: 330,
    work_order_number: "PWO-000033",
    marketplace_status: "accepted",
    marketplace_status_label: "Accepted",
    request_signals: ["Property Management", "Urgent", "Electrical"],
    request_snapshot: {
      project_title: "Repair panel issue",
      project_type: "Electrical",
      project_subtype: "Urgent",
      project_family_label: "Property Management Work Order",
      refined_description: "Agreement draft is already linked.",
      project_scope_summary: "Agreement draft is already linked.",
      location: "127 Managed Way\nAustin, TX 78701",
      request_path_label: "Property Management Work Order",
      property: "Oak Duplex",
      unit: "Unit C",
      tenant: "Morgan Resident",
      priority: "Urgent",
      category: "Electrical",
      work_order_number: "PWO-000033",
      clarification_summary: [],
      clarification_count: 0,
      photo_count: 0,
      photos: [],
      milestones: [],
      request_signals: ["Property Management", "Urgent", "Electrical"],
    },
    next_action: { key: "open_agreement", label: "Open Agreement Draft", target: "/app/agreements/933/wizard?step=1" },
  },
];

function buildSummary(rows) {
  return {
    total_bids: rows.length,
    new_leads: rows.filter((row) => row.workspace_stage === "new_lead").length,
    follow_up_leads: rows.filter((row) => row.workspace_stage === "follow_up").length,
    active_bids: rows.filter((row) => row.workspace_stage === "active_bid").length,
    closed: rows.filter((row) => row.workspace_stage === "closed").length,
    open_bids: rows.filter((row) => row.status_group === "open").length,
    under_review_bids: rows.filter((row) => row.status_group === "under_review").length,
    awarded_bids: rows.filter((row) => row.status_group === "awarded").length,
    declined_expired_bids: rows.filter((row) => row.status_group === "declined_expired").length,
    residential_count: rows.filter((row) => row.project_class === "residential").length,
    commercial_count: rows.filter((row) => row.project_class === "commercial").length,
    property_work_order_count: rows.filter((row) => row.source_kind === "property_work_order").length,
    website_leads: rows.filter((row) => row.is_website_lead).length,
    new_website_leads: rows.filter((row) => row.is_website_lead && row.workspace_stage === "new_lead").length,
    website_leads_needing_follow_up: rows.filter(
      (row) => row.is_website_lead && ["new_lead", "follow_up"].includes(row.workspace_stage)
    ).length,
  };
}

function buildPayload(rows = bidRows) {
  return {
    results: rows,
    summary: buildSummary(rows),
    filters: {
      status: "all",
      project_class: "all",
      search: "",
    },
  };
}

function cloneBidRows() {
  return JSON.parse(JSON.stringify(bidRows));
}

function applyLeadStatus(rows, leadId, status) {
  const row = rows.find((entry) => String(entry.source_id) === String(leadId) && entry.source_kind === "lead");
  if (!row) return null;

  const normalizedStatus =
    status === "new"
      ? "submitted"
      : status === "ready_for_review"
        ? "under_review"
        : status === "accepted"
          ? "awarded"
          : status;
  row.status = normalizedStatus;
  row.status_label =
    normalizedStatus === "follow_up"
      ? "Follow-Up"
      : normalizedStatus === "under_review"
        ? "Under Review"
      : normalizedStatus === "submitted"
          ? "Submitted"
          : normalizedStatus === "awarded"
            ? "Awarded"
            : normalizedStatus;
  row.status_group =
    normalizedStatus === "follow_up"
      ? "follow_up"
      : normalizedStatus === "under_review"
        ? "under_review"
        : normalizedStatus === "awarded"
          ? "awarded"
          : normalizedStatus === "submitted"
            ? "submitted"
          : row.status_group;
  row.workspace_stage =
    normalizedStatus === "follow_up"
      ? "follow_up"
      : normalizedStatus === "under_review" || normalizedStatus === "awarded"
        ? "active_bid"
      : normalizedStatus === "submitted"
          ? "new_lead"
          : row.workspace_stage;
  row.workspace_stage_label =
    row.workspace_stage === "follow_up"
      ? "Follow-Up"
      : row.workspace_stage === "new_lead"
        ? "New Lead"
        : row.workspace_stage === "closed"
          ? "Closed / Archived"
          : "Active Bid";
  row.status_note = normalizedStatus === "follow_up" ? "This lead is saved for later review." : "";
  row.next_action =
    normalizedStatus === "follow_up"
      ? { key: "review_bid", label: "Review Lead", target: "" }
      : normalizedStatus === "submitted"
        ? { key: "review_bid", label: "Review Request", target: "" }
        : normalizedStatus === "under_review"
          ? { key: "review_bid", label: "Review Bid", target: "" }
          : row.next_action;
  return row;
}

test("contractor bids workspace renders, filters, opens details, and converts awarded rows", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {},
      },
      configurable: true,
    });
  });

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  let authHeader = "";
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

  await page.route(/\/api\/projects\/contractor\/bids\/?.*$/, async (route) => {
    authHeader = route.request().headers().authorization || route.request().headers().Authorization || "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildPayload()),
    });
  });

  await page.route("**/api/projects/contractor/public-leads/3/create-agreement/**", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        agreement_id: 900,
        detail_url: "/app/agreements/900",
        wizard_url: "/app/agreements/900/wizard?step=1",
        created: true,
      }),
    });
  });

  await page.goto("/app/opportunities", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("contractor-bids-title")).toBeVisible();
  await expect(page.getByTestId("leads-tab-new")).toContainText("New Leads");
  await expect(page.getByTestId("leads-tab-follow-up")).toContainText("Follow-Up");
  await expect(page.getByTestId("leads-tab-active")).toContainText("Active Opportunities");
  await expect(page.getByTestId("leads-tab-closed")).toContainText("Closed / Archived");
  await expect(page.getByTestId("bids-summary-new-leads")).toContainText("New Leads");
  await expect(page.getByTestId("bids-summary-follow-up")).toContainText("Follow-Up");
  await expect(page.getByTestId("bids-summary-active-bids")).toContainText("Active Opportunities");
  await expect(page.getByTestId("bids-summary-closed")).toContainText("Closed / Archived");
  await expect(page.getByTestId("bids-summary-total")).toContainText("Total Opportunities");
  await expect(page.getByTestId("lead-row-lead-6")).toContainText("New Lead");
  await expect(page.getByTestId("lead-row-lead-6")).toContainText("Guided Intake");
  await expect(page.getByTestId("lead-row-lead-6")).toContainText("Photos");
  await expect(page.getByTestId("lead-row-action-lead-6")).toContainText("Review Lead");
  await page.getByTestId("bids-summary-follow-up").click();
  await expect(page.getByTestId("lead-row-lead-8")).toBeVisible();
  await expect(page.getByTestId("lead-row-lead-6")).toHaveCount(0);
  await page.getByTestId("bids-summary-new-leads").click();
  await expect(page.getByTestId("lead-row-lead-6")).toBeVisible();
  await expect(page.locator('article[data-testid^="lead-row-"]').nth(0)).toContainText("Bathroom Remodel");
  await expect(page.locator('article[data-testid^="lead-row-"]').nth(1)).toContainText("Guest Bath Refresh");
  expect(authHeader).toContain("Bearer ");

  await page.getByTestId("workspace-sort-control").selectOption("needs_attention");
  await expect(page.locator('article[data-testid^="lead-row-"]').nth(0)).toContainText("Guest Bath Refresh");
  await expect(page.locator('article[data-testid^="lead-row-"]').nth(1)).toContainText("Bathroom Remodel");

  await page.getByTestId("workspace-sort-control").selectOption("recommended");
  await page.getByTestId("workspace-filter-has_photos").click();
  await expect(page.locator('article[data-testid^="lead-row-"]')).toHaveCount(1);
  await expect(page.getByTestId("lead-row-lead-6")).toBeVisible();

  await page.getByTestId("lead-row-action-lead-6").click();
  await expect(page.getByTestId("lead-detail-container")).toBeVisible();
  await expect(page.getByTestId("lead-action-section")).toBeVisible();
  await expect(page.getByTestId("response-prep-section")).toBeVisible();
  await expect(page.getByTestId("response-starter-section")).toBeVisible();
  await expect(page.getByTestId("create-bid-context-note")).toContainText("Photos are available to review");
  await expect(page.getByTestId("lead-overview")).toContainText("Project Title");
  await expect(page.getByTestId("lead-overview")).toContainText("Project Family");
  await expect(page.getByTestId("project-snapshot")).toContainText("Scope Summary");
  await expect(page.getByTestId("project-type-cue")).toContainText("Bathroom remodel-focused review");
  await expect(page.getByTestId("photos-section")).toContainText("Shower area");
  await expect(page.getByTestId("project-phases-section")).toContainText("Demolition");
  await expect(page.getByTestId("request-signals-section")).toContainText("Multi-Quote Request");
  await expect(page.getByTestId("suggested-next-step-section")).toContainText("ready for a bid decision");
  await expect(page.getByTestId("response-templates-section")).toBeVisible();
  await expect(page.getByTestId("response-template-general")).toContainText("General Response");
  await expect(page.getByTestId("response-template-photos")).toContainText("With Photos");
  await page.getByTestId("response-template-copy-general").click();
  await expect(page.getByTestId("response-template-copy-general")).toContainText("Copied");
  await expect(page.getByTestId("create-bid-context-note")).toContainText("Bathroom remodels are clearer");
  await expect(page.getByTestId("create-bid-action")).toContainText("Create Estimate");
  await expect(page.getByTestId("follow-up-action-button")).toContainText("Save for Later");
  await expect(page.getByTestId("lead-detail-secondary-action")).toContainText("Copy Reference");
  await page.getByRole("button", { name: "Close bid details" }).click();
  await expect(page.getByTestId("bids-detail-drawer")).toHaveCount(0);

  await page.getByTestId("workspace-filter-all").click();

  await page.getByTestId("leads-tab-follow-up").click();
  await expect(page.getByTestId("lead-row-lead-8")).toContainText("Follow-Up");
  await expect(page.getByTestId("lead-stage-lead-8")).toContainText("Follow-Up");
  await expect(page.getByTestId("lead-row-action-lead-8")).toContainText("Follow Up");
  await page.getByTestId("lead-row-action-lead-8").click();
  await expect(page.getByTestId("follow-up-state-note")).toContainText("saved for later review");
  await expect(page.getByTestId("resume-review-action")).toContainText("Resume Review");
  await expect(page.getByTestId("create-bid-action")).toContainText("Create Estimate");
  await page.getByRole("button", { name: "Close bid details" }).click();
  await expect(page.getByTestId("bids-detail-drawer")).toHaveCount(0);

  await page.getByTestId("leads-tab-active").click();
  await expect(page.getByTestId("lead-row-intake-2")).toContainText("Active Opportunity");
  await expect(page.getByTestId("lead-row-lead-3")).toContainText("Active Opportunity");
  await expect(page.getByTestId("lead-row-lead-5")).toContainText("Open Agreement");
  await expect(page.getByTestId("lead-row-intake-2")).toContainText("Guided Intake");

  await page.getByTestId("leads-tab-closed").click();
  await expect(page.getByTestId("lead-row-lead-4")).toContainText("Closed / Archived");
  await page.getByTestId("lead-row-lead-4").click();
  await expect(page.getByTestId("lead-detail-container")).toBeVisible();
  await expect(page.getByTestId("suggested-next-step-section")).toContainText("closed for now");
  await page.getByRole("button", { name: "Close bid details" }).click();
  await expect(page.getByTestId("bids-detail-drawer")).toHaveCount(0);

  await page.getByTestId("leads-tab-active").click();
  await page.getByTestId("lead-row-lead-5").click();
  await expect(page.getByTestId("lead-detail-container")).toBeVisible();
  await expect(page.getByTestId("lead-action-section")).toBeVisible();
  await expect(page.getByTestId("lead-overview")).toContainText("Project Title");
  await expect(page.getByTestId("lead-overview")).toContainText("Project Family");
  await expect(page.getByTestId("project-snapshot")).toContainText("Scope Summary");
  await expect(page.getByTestId("project-snapshot")).toContainText("Budget");
  await expect(page.getByTestId("recommended-setup-section")).toContainText("Recommended Setup");
  await expect(page.getByTestId("recommended-setup-section")).toContainText("Project Type");
  await expect(page.getByTestId("photos-section")).toContainText("layout.png");
  await expect(page.getByTestId("project-phases-section")).toContainText("Demo Phase");
  await expect(page.getByTestId("request-signals-section")).toContainText("Photos");
  await expect(page.getByTestId("lead-detail-primary-action")).toContainText("Open Agreement");
  await expect(page.getByTestId("lead-detail-secondary-action")).toContainText("Copy Reference");
  await page.getByRole("button", { name: "Close bid details" }).click();
  await expect(page.getByTestId("bids-detail-drawer")).toHaveCount(0);

  await page.getByTestId("bids-filter-project-class").selectOption("commercial");
  await expect(page.getByTestId("lead-row-intake-2")).toBeVisible();
  await expect(page.getByTestId("lead-row-lead-5")).toBeVisible();

  await page.getByTestId("bids-filter-status").selectOption("awarded");
  await expect(page.getByTestId("lead-row-lead-5")).toBeVisible();

  await page.getByTestId("bids-filter-project-class").selectOption("all");
  await page.getByTestId("bids-filter-status").selectOption("all");
  await page.getByTestId("leads-tab-active").click();
  await page.getByTestId("lead-row-action-lead-3").click();
  await expect(page).toHaveURL("/app/agreements/900/wizard?step=1");

  await page.screenshot({ path: "test-results/contractor-bids.png", fullPage: true });

  expect(consoleErrors.filter((msg) => msg.includes("Failed to load bids"))).toHaveLength(0);
});

test("website leads are summarized, labeled, and filterable in opportunities", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  const websiteLead = {
    ...cloneBidRows()[0],
    bid_id: "lead-901",
    source_kind: "lead",
    source_kind_label: "Website",
    lead_source: "quote_request",
    lead_source_label: "Website",
    lead_source_filter: "website",
    is_website_lead: true,
    workspace_stage: "new_lead",
    workspace_stage_label: "New Lead",
    source_id: 901,
    source_reference: "Lead #901",
    project_title: "Website Kitchen Lead",
    customer_name: "Website Customer",
    customer_email: "website@example.com",
    project_type: "Kitchen Remodel",
    status: "submitted",
    status_label: "Submitted",
    status_group: "submitted",
    submitted_at: "2026-06-22T15:20:00Z",
  };
  const profileLead = {
    ...websiteLead,
    bid_id: "lead-902",
    source_kind_label: "Public Profile",
    lead_source: "public_profile",
    lead_source_label: "Public Profile",
    lead_source_filter: "public_profile",
    source_id: 902,
    source_reference: "Lead #902",
    project_title: "Profile Bathroom Lead",
    customer_name: "Profile Customer",
    customer_email: "profile@example.com",
    project_type: "Bathroom Remodel",
    submitted_at: "2026-06-21T15:20:00Z",
  };
  const qrLead = {
    ...websiteLead,
    bid_id: "lead-903",
    source_kind_label: "QR Code",
    lead_source: "qr",
    lead_source_label: "QR Code",
    lead_source_filter: "qr",
    source_id: 903,
    source_reference: "Lead #903",
    project_title: "QR Deck Lead",
    customer_name: "QR Customer",
    customer_email: "qr@example.com",
    project_type: "Deck Repair",
    submitted_at: "2026-06-20T15:20:00Z",
  };
  const landingLead = {
    ...websiteLead,
    bid_id: "lead-904",
    source_kind_label: "Landing",
    lead_source: "landing_page",
    lead_source_label: "Landing",
    lead_source_filter: "landing",
    is_website_lead: true,
    source_id: 904,
    source_reference: "Lead #904",
    project_title: "Landing Page Fence Lead",
    customer_name: "Landing Customer",
    customer_email: "landing@example.com",
    project_type: "Fence Repair",
    submitted_at: "2026-06-19T15:20:00Z",
  };
  const portalLead = {
    ...websiteLead,
    bid_id: "lead-905",
    source_kind_label: "Portal",
    lead_source: "customer_portal",
    lead_source_label: "Portal",
    lead_source_filter: "portal",
    is_website_lead: false,
    source_id: 905,
    source_reference: "Lead #905",
    project_title: "Portal Roof Lead",
    customer_name: "Portal Customer",
    customer_email: "portal@example.com",
    project_type: "Roof Repair",
    submitted_at: "2026-06-18T15:20:00Z",
  };
  const marketplaceLead = {
    ...websiteLead,
    bid_id: "lead-906",
    source_kind_label: "Marketplace",
    lead_source: "marketplace",
    lead_source_label: "Marketplace",
    lead_source_filter: "marketplace",
    is_website_lead: false,
    source_id: 906,
    source_reference: "Lead #906",
    project_title: "Marketplace Drywall Lead",
    customer_name: "Marketplace Customer",
    customer_email: "marketplace@example.com",
    project_type: "Drywall",
    submitted_at: "2026-06-17T15:20:00Z",
  };
  const manualLead = {
    ...websiteLead,
    bid_id: "lead-907",
    source_kind_label: "Manual",
    lead_source: "manual",
    lead_source_label: "Manual",
    lead_source_filter: "manual",
    is_website_lead: false,
    source_id: 907,
    source_reference: "Lead #907",
    project_title: "Manual Paint Lead",
    customer_name: "Manual Customer",
    customer_email: "manual@example.com",
    project_type: "Painting",
    submitted_at: "2026-06-16T15:20:00Z",
  };

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
  await page.route("**/api/projects/contractor/bids/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildPayload([websiteLead, profileLead, qrLead, landingLead, portalLead, marketplaceLead, manualLead])),
    });
  });
  await page.route("**/api/projects/contractors/me/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: 7, public_profile: {} }),
    });
  });

  await page.goto("/app/opportunities?source=website", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("bids-summary-website-leads")).toContainText("4");
  await expect(page.getByTestId("bids-summary-new-website-leads")).toContainText("4 / 4");
  await expect(page.getByTestId("lead-row-lead-901")).toContainText("Website Customer");
  await expect(page.getByTestId("lead-source-lead-901")).toContainText("Website");
  await expect(page.getByTestId("lead-row-lead-902")).toHaveCount(0);
  await expect(page.getByTestId("lead-row-lead-903")).toHaveCount(0);

  await page.getByTestId("workspace-source-landing").click();
  await expect(page.getByTestId("lead-row-lead-904")).toContainText("Landing Customer");
  await expect(page.getByTestId("lead-row-lead-901")).toHaveCount(0);

  await page.getByTestId("workspace-source-qr").click();
  await expect(page.getByTestId("lead-row-lead-903")).toContainText("QR Customer");

  await page.getByTestId("workspace-source-portal").click();
  await expect(page.getByTestId("lead-row-lead-905")).toContainText("Portal Customer");

  await page.getByTestId("workspace-source-marketplace").click();
  await expect(page.getByTestId("lead-row-lead-906")).toContainText("Marketplace Customer");

  await page.getByTestId("workspace-source-manual").click();
  await expect(page.getByTestId("lead-row-lead-907")).toContainText("Manual Customer");

  await page.goto("/app/opportunities?source=public_profile", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("bids-summary-website-leads")).toContainText("4");
  await expect(page.getByTestId("lead-row-lead-901")).toContainText("Website Customer");
  await expect(page.getByTestId("lead-row-lead-902")).toContainText("Profile Customer");
  await expect(page.getByTestId("lead-source-lead-902")).toContainText("Public Profile");
});

test("contractor bids workspace renders property management work orders and routes actions", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {},
      },
      configurable: true,
    });
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
  await page.route("**/api/projects/contractors/me/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: 7, public_profile: {} }),
    });
  });

  const rows = JSON.parse(JSON.stringify(propertyWorkOrderRows));
  await page.route(/\/api\/projects\/contractor\/bids\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildPayload(rows)),
    });
  });
  await page.route("**/api/projects/contractor-opportunities/31/accept/**", async (route) => {
    const row = rows.find((entry) => entry.bid_id === "opportunity-31");
    row.status = "accepted";
    row.status_label = "Accepted";
    row.status_group = "follow_up";
    row.workspace_stage = "follow_up";
    row.workspace_stage_label = "Follow-Up";
    row.marketplace_status = "accepted";
    row.marketplace_status_label = "Accepted";
    row.next_action = { key: "prepare_agreement_draft", label: "Prepare Agreement Draft", target: "" };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, status: "accepted" }),
    });
  });
  await page.route("**/api/projects/contractor-opportunities/31/decline/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, status: "declined" }),
    });
  });
  await page.route("**/api/projects/contractor-opportunities/32/create-agreement-draft/**", async (route) => {
    const row = rows.find((entry) => entry.bid_id === "opportunity-32");
    row.status = "awarded";
    row.status_label = "Agreement Draft Ready";
    row.status_group = "awarded";
    row.workspace_stage = "active_bid";
    row.workspace_stage_label = "Active Bid";
    row.linked_agreement_id = 932;
    row.linked_agreement_reference = "Agreement #932";
    row.linked_agreement_url = "/app/agreements/932/wizard?step=1";
    row.next_action = { key: "open_agreement", label: "Open Agreement Draft", target: "/app/agreements/932/wizard?step=1" };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        linked_agreement_id: 932,
        agreement_id: 932,
        next_url: "/app/agreements/932/wizard?step=1",
      }),
    });
  });

  await page.goto("/app/opportunities?source=property_work_order", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("leads-tab-work-orders")).toContainText("Work Orders");
  await page.getByTestId("workspace-source-work_orders").click();
  await expect(page.getByTestId("lead-row-opportunity-31")).toContainText("Property Management Work Order");
  await expect(page.getByTestId("lead-source-opportunity-31")).toContainText("Property Management Work Order");
  await expect(page.getByTestId("lead-row-opportunity-31")).toContainText("PWO-000031");
  await expect(page.getByTestId("lead-row-opportunity-31")).toContainText("Oak Tree Property Management");
  await expect(page.getByTestId("lead-row-opportunity-31")).toContainText("Urgent");
  await expect(page.getByTestId("lead-row-opportunity-31")).toContainText("Plumbing");
  await expect(page.getByTestId("lead-row-opportunity-31")).toContainText("Photos/Attachments");
  await expect(page.getByTestId("lead-row-action-opportunity-31")).toContainText("Accept Work Order");

  await page.getByTestId("lead-row-opportunity-31").click();
  await expect(page.getByTestId("lead-overview")).toContainText("Work Order");
  await expect(page.getByTestId("lead-overview")).toContainText("Unit B");
  await expect(page.getByTestId("photos-section")).toContainText("leak.jpg");
  await expect(page.getByTestId("decline-property-work-order-action")).toContainText("Decline");
  await page.getByRole("button", { name: "Close bid details" }).click();

  await page.getByTestId("lead-row-action-opportunity-31").click();
  await expect(page.getByTestId("leads-tab-follow-up")).toContainText("Follow-Up");
  await expect(page.getByTestId("lead-row-opportunity-31")).toContainText("Convert to Agreement");

  await page.getByTestId("lead-row-action-opportunity-32").click();
  await expect(page).toHaveURL("/app/agreements/932/wizard?step=1");

  await page.goto("/app/opportunities?source=property_work_order", { waitUntil: "domcontentloaded" });
  await page.getByTestId("lead-row-action-opportunity-33").click();
  await expect(page).toHaveURL("/app/agreements/933/wizard?step=1");
});

test("contractor bids workspace lead helpers support create bid handoff", async ({ page }) => {
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

  await page.route("**/api/projects/contractor/bids/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildPayload()),
    });
  });

  await page.route("**/api/projects/contractor/public-leads/6/create-agreement/**", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        agreement_id: 901,
        detail_url: "/app/agreements/901",
        wizard_url: "/app/agreements/901/wizard?step=1",
        created: true,
      }),
    });
  });

  let agreement = {
    id: 901,
    agreement_id: 901,
    project_title: "Bathroom Remodel",
    title: "Bathroom Remodel",
    description: "",
    homeowner: 1,
    source_lead: 6,
    status: "draft",
    project_type: "Bathroom Remodel",
    project_subtype: "Primary Bath",
    payment_mode: "escrow",
  };

  await page.route("**/api/projects/homeowners**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{ id: 1, company_name: "New Lead Customer", full_name: "New Lead Customer" }],
      }),
    });
  });

  await page.route("**/api/projects/project-types/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{ id: 1, value: "Bathroom Remodel", label: "Bathroom Remodel", owner_type: "system" }],
      }),
    });
  });

  await page.route("**/api/projects/project-subtypes/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{ id: 11, value: "Primary Bath", label: "Primary Bath", owner_type: "system", project_type: "Bathroom Remodel" }],
      }),
    });
  });

  await page.route("**/api/projects/templates/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route("**/api/projects/contractors/me/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 7,
        ai: { access: "included", enabled: true, unlimited: true },
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/901\/?(\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(agreement),
      });
      return;
    }
    if (request.method() === "PATCH") {
      const payload = request.postDataJSON();
      agreement = { ...agreement, ...payload };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(agreement),
      });
      return;
    }
    await route.fallback();
  });

  await page.route("**/api/projects/agreements/ai/draft/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "OK",
        agreement_id: 901,
        project_title: "Bathroom Remodel",
        project_type: "Remodel",
        project_subtype: "Primary Bath",
        normalized_description:
          "Thanks for sharing the details for Bathroom Remodel. I reviewed similar successful projects and put together a starting proposal draft you can edit before sending.",
        proposal_draft: {
          title: "Bathroom Remodel",
          text: "Thanks for sharing the details for Bathroom Remodel. Bright Build Co - Trusted renovations and repairs.\nI reviewed similar successful projects and put together a starting proposal draft you can edit before sending.\n\nScope understanding\n- Scope focus: Remodel - Primary Bath.\n- Project summary: Update the primary bath with new finishes and fixtures.\n- 2 photos attached, which helps confirm the scope.\n- Request type: Multi-Quote Request.\n- Helpful signals: Guided Intake, Photos, Budget Provided, Timeline Provided.\n- Clarifications already captured: Measurements.\n\nImportant confirmation points\n- Measurements may need a site visit before final pricing.\n- Budget guidance was shared: $18,000 - $24,000.\n- Timing guidance: Within the next month.\n- Similar successful bids often confirmed verify measurements, review photos, confirm materials up front.\n\nClose\nIf this looks right, I’m happy to review the next steps and refine the bid with you.\nBest, Bright Build Co",
        },
        proposal_learning: {
          template_name: "Bathroom Remodel successful template",
          sample_size: 2,
          learned_opening: "Thanks for sharing the details for Bathroom Remodel.",
          learned_close: "If this looks right, I’m happy to review the next steps and refine the bid with you.",
          highlights: ["verify measurements", "review photos", "confirm materials"],
          based_on_successful_projects: true,
        },
        used_successful_learning: true,
        used_brand_voice: true,
      }),
    });
  });

  await page.route("**/api/projects/contractor/public-leads/6/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 6,
        source: "lead",
        full_name: "New Lead Customer",
        email: "lead-customer@example.com",
        phone: "",
        project_address: "123 Main St",
        city: "Austin",
        state: "TX",
        zip_code: "78701",
        project_type: "Bathroom Remodel",
        project_description: "Update the primary bath with new finishes and fixtures.",
        preferred_timeline: "Within the next month",
        budget_text: "$18,000 - $24,000",
        status: "ready_for_review",
        internal_notes: "",
        ai_analysis: {
          request_snapshot: {
            project_title: "Bathroom Remodel",
            project_type: "Bathroom Remodel",
            project_subtype: "Primary Bath",
            refined_description: "Update the primary bath with new finishes and fixtures.",
            location: "123 Main St, Austin, TX 78701",
            measurement_handling: "site_visit_required",
            budget: "$18,000 - $24,000",
            timeline: "Within the next month",
            photo_count: 2,
            request_path_label: "Multi-Quote Request",
            request_signals: ["Guided Intake", "Photos", "Budget Provided", "Timeline Provided"],
            milestones: ["Site measurement and layout review", "Finalize finishes and fixtures"],
            clarification_summary: [
              { key: "measurement_handling", label: "Measurements", value: "Site visit required" },
            ],
          },
        },
      }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/attachments\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.goto("/app/opportunities", { waitUntil: "domcontentloaded" });
  await page.getByTestId("lead-row-action-lead-6").click();
  await expect(page.getByTestId("response-prep-section")).toBeVisible();
  await expect(page.getByTestId("response-starter-section")).toBeVisible();
  await expect(page.getByTestId("create-bid-context-note")).toBeVisible();
  await expect(page.getByTestId("create-bid-action")).toBeVisible();

  await page.getByTestId("create-bid-action").click();
  await expect(page).toHaveURL("/app/agreements/901/wizard?step=1");
  await expect(page.getByTestId("step1-no-template-review")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("step1-no-template-preview-title")).toContainText("Bathroom Remodel");
  await expect(page.getByTestId("step1-no-template-preview-scope")).toContainText("Thanks for sharing the details");
  await page.getByRole("button", { name: "Continue with AI Draft" }).first().click();
  const proposalDraftField = page.getByTestId("proposal-draft-textarea");
  await expect(proposalDraftField).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("agreement-project-title-input")).toHaveValue("Bathroom Remodel");
  await expect(proposalDraftField).toHaveValue(
    /Thanks for sharing the details for Bathroom Remodel/
  );

  await proposalDraftField.fill("Custom contractor note");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("agreement-ai-generate-scope-button").click();
  await expect(page.getByTestId("proposal-draft-textarea")).toBeVisible();
});

test("quote requests open the convert-to-agreement panel and persist the draft into the agreement wizard", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });
  await page.setViewportSize({ width: 390, height: 844 });

  let agreement = {
    id: 901,
    agreement_id: 901,
    project_title: "Primary Bath Refresh",
    title: "Primary Bath Refresh",
    description: "Need a refreshed primary bath.",
    homeowner: 1,
    source_lead: 9,
    status: "draft",
    project_type: "Bathroom Remodel",
    project_subtype: "Primary Bath",
    project_class: "residential",
    payment_mode: "escrow",
    payment_structure: "simple",
    total_cost: 22500,
    milestone_count: 3,
    step_status: "step1",
    wizard_step: 1,
    project: {
      id: 77,
      title: "Primary Bath Refresh",
      description: "Need a refreshed primary bath.",
    },
  };

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

  await page.route(/\/api\/projects\/contractor\/public-leads\/\d+\/analyze\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        lead_id: 9,
        ai_analysis: {
          suggested_title: "Primary Bath Refresh",
          suggested_description: "Refined agreement scope for the primary bath refresh.",
          project_type: "Bathroom Remodel",
          project_subtype: "Primary Bath",
          budget_range_text: "$20,000 - $25,000",
          desired_timing_text: "Within the next month",
          milestone_outline: [
            { title: "Demo", description: "Remove existing finishes" },
            { title: "Tile", description: "Install tile and waterproofing" },
            { title: "Finish", description: "Fixtures and final touches" },
          ],
        },
      }),
    });
  });

  await page.route(/\/api\/projects\/contractor\/public-leads\/\d+\/create-agreement\/?.*$/, async (route) => {
    const payload = route.request().postDataJSON?.() || {};
    const draft = payload.draft_payload || {};
    agreement = {
      ...agreement,
      project_title: draft.project_title || agreement.project_title,
      title: draft.project_title || agreement.title,
      description: draft.project_description || agreement.description,
      project_type: draft.project_type || agreement.project_type,
      project_subtype: draft.project_subtype || agreement.project_subtype,
      project_class: draft.project_class || agreement.project_class,
      payment_mode: draft.payment_mode || agreement.payment_mode,
      payment_structure: draft.payment_structure || agreement.payment_structure,
      total_cost: draft.total_cost || agreement.total_cost,
      milestone_count: Array.isArray(draft.milestones) ? draft.milestones.length : agreement.milestone_count,
      step_status: "step1",
      wizard_step: 1,
      project: {
        ...agreement.project,
        title: draft.project_title || agreement.project.title,
        description: draft.project_description || agreement.project.description,
      },
    };
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        agreement_id: 901,
        detail_url: "/app/agreements/901",
        wizard_url: "/app/agreements/901/wizard?step=1",
        created: true,
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/901\/?(\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(agreement),
      });
      return;
    }
    if (request.method() === "PATCH") {
      const payload = request.postDataJSON();
      agreement = { ...agreement, ...payload };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(agreement),
      });
      return;
    }
    await route.fallback();
  });

  await page.route(/\/api\/projects\/milestones\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/attachments\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  const quoteRows = [
    {
      ...cloneBidRows().find((row) => row.bid_id === "lead-6"),
      bid_id: "lead-9",
      source_kind: "quote_request",
      source_kind_label: "Quote Request",
      source_id: 9,
      source_reference: "Lead #9",
      project_title: "Primary Bath Refresh",
      customer_name: "Quote Customer",
      customer_email: "quote@example.com",
      request_path_label: "Request a Quote",
      request_snapshot: {
        ...cloneBidRows().find((row) => row.bid_id === "lead-6").request_snapshot,
        project_title: "Primary Bath Refresh",
        project_type: "Bathroom Remodel",
        project_subtype: "Primary Bath",
        request_path_label: "Request a Quote",
      },
      next_action: { key: "convert_to_agreement", label: "Convert to Agreement", target: "" },
    },
  ];
  await page.route(/\/api\/projects\/contractor\/bids\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildPayload(quoteRows)),
    });
  });

  await page.goto("/app/opportunities", { waitUntil: "domcontentloaded" });
  const convertButton = page.getByTestId("lead-row-action-lead-9");
  await expect(convertButton).toBeVisible();
  await convertButton.click();
  await expect(page.getByTestId("convert-to-agreement-panel")).toBeVisible();
  await expect(page.getByTestId("convert-project-title")).not.toHaveValue("");
  await expect(page.getByTestId("convert-milestone-list")).toBeVisible();
  await page.getByTestId("convert-project-title").fill("Primary Bath Refresh - Updated");
  await page.getByTestId("convert-project-description").fill("Updated agreement scope before sending.");
  await page.getByTestId("convert-total-cost").fill("$24,500.00");
  await page.getByTestId("convert-agreement-send").click();
  await expect(page).toHaveURL("/app/agreements/901/wizard?step=1");
  await expect(page.getByTestId("agreement-project-title-input")).toHaveValue("Primary Bath Refresh - Updated");
});

test("contractor bids workspace keeps learning signals hidden when fallback draft is used", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  const workspaceRows = cloneBidRows();

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

  await page.route(/\/api\/projects\/contractor\/bids\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildPayload(workspaceRows)),
    });
  });

  await page.route("**/api/projects/contractor/public-leads/6/create-agreement/**", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        agreement_id: 901,
        detail_url: "/app/agreements/901",
        wizard_url: "/app/agreements/901/wizard?step=1",
        created: true,
      }),
    });
  });

  let agreement = {
    id: 901,
    agreement_id: 901,
    project_title: "Bathroom Remodel",
    title: "Bathroom Remodel",
    description: "",
    homeowner: 1,
    source_lead: 6,
    status: "draft",
    project_type: "Bathroom Remodel",
    project_subtype: "Primary Bath",
    payment_mode: "escrow",
  };

  await page.route(/\/api\/projects\/agreements\/901\/?(\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(agreement),
      });
      return;
    }
    if (request.method() === "PATCH") {
      const payload = request.postDataJSON();
      agreement = { ...agreement, ...payload };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(agreement),
      });
      return;
    }
    await route.fallback();
  });

  await page.route("**/api/projects/agreements/ai/draft/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "OK",
        agreement_id: 901,
        project_title: "Bathroom Remodel",
        project_type: "Remodel",
        project_subtype: "Primary Bath",
        normalized_description:
          "Thanks for sharing the details for Bathroom Remodel. I reviewed the request and put together a starting proposal draft you can edit before sending.",
        proposal_draft: {
          title: "Bathroom Remodel",
          text: "Thanks for sharing the details for Bathroom Remodel.\nI reviewed the request and put together a starting proposal draft you can edit before sending.\n\nScope understanding\n- Scope focus: Remodel - Primary Bath.\n- Project summary: Update the primary bath with new finishes and fixtures.\n\nImportant confirmation points\n- Measurements may need a site visit before final pricing.\n- Budget guidance was shared: $18,000 - $24,000.\n- Timing guidance: Within the next month.\n\nClose\nIf this looks right, I’m happy to review the next steps and refine the bid with you.",
        },
        used_successful_learning: false,
        used_brand_voice: false,
      }),
    });
  });

  await page.route("**/api/projects/contractor/public-leads/6/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 6,
        source: "lead",
        full_name: "New Lead Customer",
        email: "lead-customer@example.com",
        phone: "",
        project_address: "123 Main St",
        city: "Austin",
        state: "TX",
        zip_code: "78701",
        project_type: "Bathroom Remodel",
        project_description: "Update the primary bath with new finishes and fixtures.",
        preferred_timeline: "Within the next month",
        budget_text: "$18,000 - $24,000",
        status: "ready_for_review",
        internal_notes: "",
        ai_analysis: {
          request_snapshot: {
            project_title: "Bathroom Remodel",
            project_type: "Bathroom Remodel",
            project_subtype: "Primary Bath",
            refined_description: "Update the primary bath with new finishes and fixtures.",
            location: "123 Main St, Austin, TX 78701",
            measurement_handling: "site_visit_required",
            budget: "$18,000 - $24,000",
            timeline: "Within the next month",
            photo_count: 2,
            request_path_label: "Multi-Quote Request",
            request_signals: ["Guided Intake", "Photos", "Budget Provided", "Timeline Provided"],
            milestones: ["Site measurement and layout review", "Finalize finishes and fixtures"],
            clarification_summary: [
              { key: "measurement_handling", label: "Measurements", value: "Site visit required" },
            ],
          },
        },
      }),
    });
  });

  await page.route(/\/api\/projects\/milestones\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/attachments\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.goto("/app/opportunities", { waitUntil: "domcontentloaded" });
  await page.getByTestId("lead-row-action-lead-6").click();
  await page.getByTestId("create-bid-action").click();
  const noTemplateReview = page.getByTestId("step1-no-template-review");
  if (await noTemplateReview.count()) {
    await expect(noTemplateReview).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Continue with AI Draft" }).first().click();
  }
  await expect(page.getByTestId("proposal-draft-textarea")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("agreement-ai-generate-scope-button").click();
  await expect(page.getByTestId("proposal-learning-note")).toHaveCount(0);
  await expect(page.getByTestId("proposal-learning-context-toggle")).toHaveCount(0);
  await expect(page.getByTestId("proposal-brand-note")).toHaveCount(0);
});

test("contractor bids workspace can save a lead for follow-up and reopen it", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  const workspaceRows = cloneBidRows();

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

  await page.route(/\/api\/projects\/contractor\/bids\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildPayload(workspaceRows)),
    });
  });

  await page.route("**/api/projects/contractor/public-leads/6/**", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fallback();
      return;
    }

    const body = route.request().postDataJSON?.() || {};
    applyLeadStatus(workspaceRows, 6, body.status);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 6,
        status: body.status,
        internal_notes: "",
      }),
    });
  });

  await page.goto("/app/opportunities", { waitUntil: "domcontentloaded" });
  await page.getByTestId("lead-row-action-lead-6").click();
  await expect(page.getByTestId("lead-detail-container")).toBeVisible();
  await page.getByTestId("follow-up-action-button").click();
  await expect(page.getByTestId("leads-tab-follow-up")).toContainText("2");
  await expect(page.getByTestId("lead-row-lead-6")).toContainText("Follow-Up");
  await page.getByRole("button", { name: "Close bid details" }).click();
  await expect(page.getByTestId("bids-detail-drawer")).toHaveCount(0);

  await page.getByTestId("leads-tab-follow-up").click();
  await page.getByTestId("lead-row-action-lead-6").click();
  await expect(page.getByTestId("follow-up-state-note")).toContainText("saved for later review");
  await page.getByTestId("resume-review-action").click();
  await expect(page.getByTestId("leads-tab-new")).toContainText("2");
  await expect(page.getByTestId("lead-row-lead-6")).toContainText("New Lead");
});

test("contractor bids workspace can create a bid from a follow-up lead", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  const workspaceRows = cloneBidRows();

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

  await page.route("**/api/projects/contractor/bids/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildPayload(workspaceRows)),
    });
  });

  await page.route("**/api/projects/contractor/public-leads/8/**", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON?.() || {};
      applyLeadStatus(workspaceRows, 8, body.status);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 8,
          status: body.status,
          internal_notes: "",
        }),
      });
      return;
    }

    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          agreement_id: 902,
          detail_url: "/app/agreements/902",
          wizard_url: "/app/agreements/902/wizard?step=1",
          created: true,
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/app/opportunities", { waitUntil: "domcontentloaded" });
  await page.getByTestId("leads-tab-follow-up").click();
  await page.getByTestId("lead-row-action-lead-8").click();
  await expect(page.getByTestId("follow-up-state-note")).toContainText("saved for later review");
  await expect(page.getByTestId("create-bid-action")).toContainText("Create Estimate");
  await page.getByTestId("create-bid-action").click();
  await expect(page).toHaveURL("/app/agreements/902/wizard?step=1");
});

test("contractor bids workspace shows a friendly empty state", async ({ page }) => {
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

  await page.route(/\/api\/projects\/contractor\/bids\/?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [],
        summary: {
          total_bids: 0,
          open_bids: 0,
          under_review_bids: 0,
          awarded_bids: 0,
          declined_expired_bids: 0,
          residential_count: 0,
          commercial_count: 0,
        },
        filters: {
          status: "all",
          project_class: "all",
          search: "",
        },
      }),
    });
  });

  await page.goto("/app/opportunities", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("bids-empty")).toContainText("No opportunities match your current filters");
});
