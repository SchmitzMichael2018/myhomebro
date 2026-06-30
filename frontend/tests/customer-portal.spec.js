import { expect, test } from "@playwright/test";

const portalPayload = {
  customer: {
    name: "Pat Customer",
    email: "customer@example.com",
    account_type: "individual",
    company_name: "",
    company_phone: "",
    company_email: "",
    company_website: "",
    company_street: "",
    company_unit: "",
    company_city: "",
    company_state: "",
    company_zip: "",
    company_license_number: "",
    company_notes: "",
  },
  account: {
    email: "customer@example.com",
    has_user: true,
    has_usable_password: true,
    portal_token: "customer-token",
    account_type: "individual",
    rental_operations: {
      plan: "rental_operations",
      plan_label: "Rental Operations",
      subscription_status: "active",
      trial_active: false,
      trial_days_remaining: 0,
      subscription_active: true,
      rental_operations_locked: false,
      checkout_endpoint: "/projects/customer-portal/customer-token/rental-operations/checkout/",
    },
    subscription_status: "active",
    trial_active: false,
    trial_days_remaining: 0,
    subscription_active: true,
    rental_operations_locked: false,
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
    bedrooms: 3,
    bathrooms: "2.5",
    home_systems: [
      {
        id: 11,
        display_name: "Main HVAC",
        system_type: "hvac",
        system_type_label: "HVAC",
        custom_name: "Main HVAC",
        manufacturer: "Carrier",
        model_number: "XR-500",
        serial_number: "SN-123",
        install_date: "2022-05-01",
        last_service_date: "2026-05-15",
        warranty_start_date: "2022-05-01",
        warranty_expiration_date: "2032-05-01",
        expected_lifespan_years: 15,
        condition: "good",
        condition_label: "Good",
        service_provider: "Builder Co",
        notes: "Filter size documented.",
        maintenance_status: "overdue",
        priority: "high",
        next_recommended_service_date: "2025-11-15",
        days_until_due: -208,
        reminder_reason: "Main HVAC service is overdue based on a 6-month maintenance interval.",
        recommended_action: "Mark it serviced if completed, or create a service request.",
        service_interval_months: 6,
        reminders_enabled: true,
        email_reminders_enabled: true,
        sms_reminders_enabled: false,
        reminder_lead_days: 30,
        reminder_frequency: "once",
        reminder_delivery_status: "",
        lifecycle: {
          state: "service_requested",
          label: "Service Requested",
          linked_request_id: 9,
          linked_agreement_id: null,
          linked_work_order_id: null,
          scheduled_date: "",
          completed_at: "",
          next_action: "Open the linked request to find or contact a contractor.",
        },
        supply_recommendations: [
          {
            id: "system-11-supply-1",
            recommendation_key: "system-11-supply-1",
            kind: "supply",
            system_id: 11,
            system: "Main HVAC",
            system_type_label: "HVAC",
            title: "HVAC filter",
            supply_name: "HVAC filter",
            reason: "Filters are a recurring upkeep item for most forced-air systems.",
            suggested_interval: "Every 1-3 months",
            next_due_date: "2025-11-15",
            compatibility_warning: "Confirm size, model, quantity, and compatibility before purchasing.",
            priority: "medium",
            confidence: "medium",
            source_note: "Based on the saved home system type and maintenance records.",
            amazon_url: "https://www.amazon.com/s?k=Carrier+XR-500+HVAC+air+filter&tag=myhomebro-test-20",
            home_depot_url: "https://www.homedepot.com/s/Carrier+XR-500+HVAC+air+filter",
            lowes_url: "https://www.lowes.com/search?searchTerm=Carrier+XR-500+HVAC+air+filter",
            provider_links: [
              { provider: "amazon", label: "Amazon", url: "https://www.amazon.com/s?k=Carrier+XR-500+HVAC+air+filter&tag=myhomebro-test-20" },
              { provider: "home_depot", label: "Home Depot", url: "https://www.homedepot.com/s/Carrier+XR-500+HVAC+air+filter" },
              { provider: "lowes", label: "Lowe's", url: "https://www.lowes.com/search?searchTerm=Carrier+XR-500+HVAC+air+filter" },
            ],
            actions: [
              { type: "amazon_search", label: "Amazon", url: "https://www.amazon.com/s?k=Carrier+XR-500+HVAC+air+filter&tag=myhomebro-test-20", provider: "amazon" },
              { type: "home_depot_search", label: "Home Depot", url: "https://www.homedepot.com/s/Carrier+XR-500+HVAC+air+filter", provider: "home_depot" },
              { type: "lowes_search", label: "Lowe's", url: "https://www.lowes.com/search?searchTerm=Carrier+XR-500+HVAC+air+filter", provider: "lowes" },
            ],
            is_ignored: false,
          },
        ],
        linked_records_count: 2,
        linked_documents: [
          {
            id: "property-document-1",
            record_id: 1,
            title: "Roof warranty",
            type_label: "Warranty",
            filename: "roof-warranty.pdf",
            url: "/files/roof-warranty.pdf",
          },
        ],
        linked_projects: [{ id: 1, agreement_id: 1, title: "Kitchen Remodel", contractor_name: "Builder Co" }],
        linked_requests: [],
      },
      {
        id: 12,
        display_name: "Laundry Dryer",
        system_type: "appliance",
        system_type_label: "Appliance",
        custom_name: "Laundry Dryer",
        manufacturer: "",
        model_number: "",
        condition: "good",
        condition_label: "Good",
        maintenance_status: "current",
        priority: "low",
        notes: "",
        supply_recommendations: [],
        linked_records_count: 0,
        linked_documents: [],
        linked_projects: [],
        linked_requests: [],
      },
    ],
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
    units: [],
    unit_count: 0,
    tenants: [],
    tenant_count: 0,
    tenant_maintenance_request_token: "property-maintenance-token",
    tenant_maintenance_requests: [],
    tenant_maintenance_request_count: 0,
  },
  tenant_maintenance_requests: [],
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
      year_built: 1998,
      square_feet: 2400,
      bedrooms: 3,
      bathrooms: "2.5",
      is_primary: true,
      home_systems: [
        {
          id: 11,
          display_name: "Main HVAC",
          system_type: "hvac",
          system_type_label: "HVAC",
          custom_name: "Main HVAC",
          manufacturer: "Carrier",
          model_number: "XR-500",
          serial_number: "SN-123",
          install_date: "2022-05-01",
          last_service_date: "2026-05-15",
          warranty_expiration_date: "2032-05-01",
          condition: "good",
          condition_label: "Good",
          service_provider: "Builder Co",
          notes: "Filter size documented.",
          maintenance_status: "overdue",
          priority: "high",
          next_recommended_service_date: "2025-11-15",
          days_until_due: -208,
          reminder_reason: "Main HVAC service is overdue based on a 6-month maintenance interval.",
          recommended_action: "Mark it serviced if completed, or create a service request.",
          service_interval_months: 6,
          reminders_enabled: true,
          email_reminders_enabled: true,
          sms_reminders_enabled: false,
          reminder_lead_days: 30,
          reminder_frequency: "once",
          reminder_delivery_status: "",
          supply_recommendations: [
            {
              id: "system-11-supply-1",
              recommendation_key: "system-11-supply-1",
              kind: "supply",
              system_id: 11,
              system: "Main HVAC",
              system_type_label: "HVAC",
              title: "HVAC filter",
              supply_name: "HVAC filter",
              reason: "Filters are a recurring upkeep item for most forced-air systems.",
              suggested_interval: "Every 1-3 months",
              next_due_date: "2025-11-15",
              compatibility_warning: "Confirm size, model, quantity, and compatibility before purchasing.",
              priority: "medium",
              confidence: "medium",
              source_note: "Based on the saved home system type and maintenance records.",
              amazon_url: "https://www.amazon.com/s?k=Carrier+XR-500+HVAC+air+filter&tag=myhomebro-test-20",
              home_depot_url: "https://www.homedepot.com/s/Carrier+XR-500+HVAC+air+filter",
              lowes_url: "https://www.lowes.com/search?searchTerm=Carrier+XR-500+HVAC+air+filter",
              provider_links: [
                { provider: "amazon", label: "Amazon", url: "https://www.amazon.com/s?k=Carrier+XR-500+HVAC+air+filter&tag=myhomebro-test-20" },
                { provider: "home_depot", label: "Home Depot", url: "https://www.homedepot.com/s/Carrier+XR-500+HVAC+air+filter" },
                { provider: "lowes", label: "Lowe's", url: "https://www.lowes.com/search?searchTerm=Carrier+XR-500+HVAC+air+filter" },
              ],
              actions: [
                { type: "amazon_search", label: "Amazon", url: "https://www.amazon.com/s?k=Carrier+XR-500+HVAC+air+filter&tag=myhomebro-test-20", provider: "amazon" },
                { type: "home_depot_search", label: "Home Depot", url: "https://www.homedepot.com/s/Carrier+XR-500+HVAC+air+filter", provider: "home_depot" },
                { type: "lowes_search", label: "Lowe's", url: "https://www.lowes.com/search?searchTerm=Carrier+XR-500+HVAC+air+filter", provider: "lowes" },
              ],
              is_ignored: false,
            },
          ],
          linked_records_count: 2,
          linked_documents: [],
          linked_projects: [{ id: 1, agreement_id: 1, title: "Kitchen Remodel", contractor_name: "Builder Co" }],
          linked_requests: [],
        },
        {
          id: 12,
          display_name: "Laundry Dryer",
          system_type: "appliance",
          system_type_label: "Appliance",
          custom_name: "Laundry Dryer",
          manufacturer: "",
          model_number: "",
          condition: "good",
          condition_label: "Good",
          maintenance_status: "current",
          priority: "low",
          notes: "",
          supply_recommendations: [],
          linked_records_count: 0,
          linked_documents: [],
          linked_projects: [],
          linked_requests: [],
        },
      ],
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
      home_systems: [],
      documents: [],
      photos: [],
    },
    {
      id: 3,
      customer_email: "customer@example.com",
      display_name: "88 Pine St, Austin, TX, 78704",
      property_type: "single_family",
      property_type_label: "Single Family",
      address_line1: "88 Pine St",
      city: "Austin",
      state: "TX",
      postal_code: "78704",
      address: "88 Pine St, Austin, TX, 78704",
      is_primary: false,
      home_systems: [],
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
      suggested_materials: [
        {
          id: "project-1-material-1",
          name: "Dust barriers",
          category: "Project material",
          reason: "Suggested from saved milestone material guidance.",
          related_milestone: "Demo",
          compatibility_warning: "Confirm exact product, size, quantity, and compatibility before purchasing.",
          provider_links: [{ provider: "amazon", label: "Search on Amazon", url: "https://www.amazon.com/s?k=Dust+barriers&tag=myhomebro-test-20" }],
        },
      ],
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
      id: 105,
      event_type: "customer_request_submitted",
      channel: "in_app",
      status: "dismissed",
      is_archived: true,
      archived_at: "2026-05-20T12:00:00Z",
      title: "Request submitted",
      message: "Pool service request was saved.",
      action_url: "/portal#requests",
      created_at: "2026-04-10T16:00:00Z",
    },
    {
      id: 106,
      event_type: "home_system_maintenance_reminder",
      channel: "in_app",
      status: "read",
      title: "Main HVAC maintenance reminder",
      message: "Main HVAC may need attention.",
      action_url: "#reminder:11",
      created_at: "2026-04-15T16:30:00Z",
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
  notification_cleanup_preferences: {
    auto_archive_enabled: true,
    auto_archive_frequency: "daily",
    auto_archive_read_after_days: 30,
    auto_archive_maintenance_after_days: 60,
    auto_archive_completed_work_after_days: 90,
    last_auto_archive_run_at: "2026-05-10T12:00:00Z",
    next_auto_archive_run_at: "2026-06-16T12:00:00Z",
  },
  notification_preferences: {
    categories: {
      project_request_updates: true,
      contractor_responses: true,
      agreement_updates: true,
      milestone_updates: true,
      invoice_payment_updates: true,
      maintenance_due_soon: true,
      maintenance_overdue: true,
      maintenance_completed: true,
      tenant_maintenance_requests: true,
      work_order_updates: true,
      warranty_expiration: true,
      lifecycle_events: true,
      document_updates: true,
      recommended_supplies: true,
      seasonal_supplies: true,
    },
    channels: {
      in_app_enabled: true,
      email_enabled: true,
      sms_enabled: false,
    },
    sms_status: {
      phone_number_e164: "+12105551212",
      sms_enabled: false,
      sms_opted_out: false,
      can_send_sms: false,
      consent_on_file: false,
      opted_in_at: null,
      opted_out_at: null,
      quiet_hours: {
        enabled: true,
        start_hour: 21,
        end_hour: 8,
        notice: "Most SMS notifications pause overnight unless the update is urgent.",
      },
    },
    frequency: "immediate",
    groups: {
      Projects: ["project_request_updates", "contractor_responses", "agreement_updates", "milestone_updates", "invoice_payment_updates"],
      Maintenance: ["maintenance_due_soon", "maintenance_overdue", "maintenance_completed", "tenant_maintenance_requests", "work_order_updates"],
      Property: ["warranty_expiration", "lifecycle_events", "document_updates"],
      Supplies: ["recommended_supplies", "seasonal_supplies"],
    },
    frequency_options: [
      { value: "immediate", label: "Immediate" },
      { value: "daily_digest", label: "Daily" },
      { value: "weekly_digest", label: "Weekly" },
      { value: "monthly_digest", label: "Monthly" },
      { value: "off", label: "Off" },
    ],
  },
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

const scanUploadResult = {
  detail: "File saved. Review suggested fields before applying anything to your Home System.",
  document: {
    id: "property-document-44",
    record_id: 44,
    title: "carrier-model-ABC123.jpg",
    type_label: "Equipment Label",
    filename: "carrier-model-ABC123.jpg",
    date: "2026-06-15T12:00:00Z",
    url: "/files/carrier-model-ABC123.jpg",
    upload_source: "portal_desktop",
    extraction: {
      status: "completed",
      document_classification: "Equipment Label",
      suggested_fields: {
        manufacturer: { value: "Carrier", confidence: "medium", source_text: "Carrier", apply_default: false },
        model_number: { value: "ABC123", confidence: "high", source_text: "model ABC123", apply_default: true },
        serial_number: { value: "SN9876", confidence: "low", source_text: "serial SN9876", apply_default: false },
      },
    },
  },
  extraction: {
    status: "completed",
    document_classification: "Equipment Label",
    suggested_fields: {
      manufacturer: { value: "Carrier", confidence: "medium", source_text: "Carrier", apply_default: false },
      model_number: { value: "ABC123", confidence: "high", source_text: "model ABC123", apply_default: true },
      serial_number: { value: "SN9876", confidence: "low", source_text: "serial SN9876", apply_default: false },
    },
  },
  portal: portalPayload,
};

const scanAppliedPortalPayload = {
  ...portalPayload,
  property_profile: {
    ...portalPayload.property_profile,
    home_systems: portalPayload.property_profile.home_systems.map((system) =>
      system.id === 11
        ? {
            ...system,
            model_number: "ABC123",
            linked_documents: [
              ...system.linked_documents,
              {
                id: "property-document-44",
                record_id: 44,
                title: "carrier-model-ABC123.jpg",
                type_label: "Equipment Label",
                filename: "carrier-model-ABC123.jpg",
                url: "/files/carrier-model-ABC123.jpg",
                extraction: scanUploadResult.extraction,
              },
            ],
          }
        : system
    ),
  },
};

const scanSessionPayload = {
  session_token: "scan-session-token",
  upload_url: "https://www.myhomebro.com/portal/upload-session/scan-session-token",
  frontend_path: "/portal/upload-session/scan-session-token",
  expires_at: "2026-06-15T12:30:00Z",
  document_type: "Equipment Label",
  property_profile_id: 1,
  home_system_id: 11,
  home_system_name: "Main HVAC",
  qr_code_data_url: "data:image/svg+xml;base64,PHN2Zy8+",
};

const systemCreatedPortalPayload = {
  ...portalPayload,
  property_profile: {
    ...portalPayload.property_profile,
    home_systems: [
      ...portalPayload.property_profile.home_systems,
      {
        id: 12,
        display_name: "Water Heater",
        system_type: "water_heater",
        system_type_label: "Water Heater",
        custom_name: "",
        manufacturer: "Rheem",
        model_number: "WH-200",
        serial_number: "",
        install_date: "2024-01-10",
        last_service_date: "",
        warranty_start_date: "",
        warranty_expiration_date: "2030-01-10",
        expected_lifespan_years: 10,
        condition: "good",
        condition_label: "Good",
        service_provider: "Austin Plumbing",
        notes: "Located in garage.",
        maintenance_status: "warranty_expiring",
        priority: "medium",
        next_recommended_service_date: "",
        days_until_due: null,
        reminder_reason: "Water Heater warranty expires in 45 days.",
        recommended_action: "Review coverage and upload any missing warranty documents.",
        service_interval_months: 12,
        reminders_enabled: true,
        email_reminders_enabled: true,
        sms_reminders_enabled: false,
        reminder_lead_days: 30,
        reminder_frequency: "once",
        reminder_delivery_status: "",
        linked_records_count: 0,
        linked_documents: [],
        linked_projects: [],
        linked_requests: [],
      },
    ],
  },
};

const systemUpdatedPortalPayload = {
  ...portalPayload,
  property_profile: {
    ...portalPayload.property_profile,
    home_systems: portalPayload.property_profile.home_systems.map((system) =>
      system.id === 11
        ? { ...system, condition: "needs_service", condition_label: "Needs Service", notes: "Annual service is due." }
        : system
    ),
  },
};

const systemArchivedPortalPayload = {
  ...portalPayload,
  property_profile: {
    ...portalPayload.property_profile,
    home_systems: [],
  },
};

const systemServicedPortalPayload = {
  ...portalPayload,
  property_profile: {
    ...portalPayload.property_profile,
    home_systems: portalPayload.property_profile.home_systems.map((system) =>
      system.id === 11
        ? {
            ...system,
            last_service_date: "2026-06-10",
            service_provider: "Austin HVAC",
            notes: "Filter size documented.\n\nService note 2026-06-10: Filter replaced.",
            maintenance_status: "current",
            priority: "low",
            next_recommended_service_date: "2026-12-10",
            days_until_due: 183,
            reminder_reason: "Main HVAC maintenance appears current from the last recorded service date.",
            recommended_action: "Keep records updated after the next service.",
            reminder_delivery_status: "resolved",
            lifecycle: {
              state: "completed",
              label: "Completed",
              linked_request_id: 9,
              linked_agreement_id: null,
              linked_work_order_id: null,
              scheduled_date: "",
              completed_at: "2026-06-10",
              next_action: "Keep records updated after the next service.",
            },
          }
        : system
    ),
  },
  property_profiles: portalPayload.property_profiles.map((profile) =>
    profile.id === portalPayload.property_profile.id
      ? {
          ...profile,
          home_systems: profile.home_systems.map((system) =>
            system.id === 11
              ? {
                  ...system,
                  last_service_date: "2026-06-10",
                  service_provider: "Austin HVAC",
                  notes: "Filter size documented.\n\nService note 2026-06-10: Filter replaced.",
                  maintenance_status: "current",
                  priority: "low",
                  next_recommended_service_date: "2026-12-10",
                  days_until_due: 183,
                  reminder_reason: "Main HVAC maintenance appears current from the last recorded service date.",
                  recommended_action: "Keep records updated after the next service.",
                  reminder_delivery_status: "resolved",
                  lifecycle: {
                    state: "completed",
                    label: "Completed",
                    linked_request_id: 9,
                    linked_agreement_id: null,
                    linked_work_order_id: null,
                    scheduled_date: "",
                    completed_at: "2026-06-10",
                    next_action: "Keep records updated after the next service.",
                  },
                }
              : system
          ),
        }
      : profile
  ),
};

const systemServiceRequestPortalPayload = {
  ...portalPayload,
  summary: {
    ...portalPayload.summary,
    active_requests: portalPayload.summary.active_requests + 1,
  },
  requests: [
    {
      id: "request-system-11",
      project_title: "Main HVAC service request",
      request_type_label: "Maintenance",
      project_mode_label: "Full service",
      project_type: "HVAC",
      project_subtype: "Maintenance Service",
      payment_preference_label: "Discuss With Contractor",
      status: "submitted",
      status_label: "Submitted",
      project_scope: "Request service for Main HVAC.",
      project_address: "123 Main St, Austin, TX, 78701",
      urgency: "high",
      timeline_label: "ASAP",
      created_at: "2026-06-10T12:00:00Z",
      current_next_action: "Saved in your requests.",
    },
    ...portalPayload.requests,
  ],
};

const notificationReadPortalPayload = {
  ...portalPayload,
  notifications: portalPayload.notifications.map((notification) =>
    notification.id === 101 ? { ...notification, status: "read" } : notification
  ),
};

const notificationsAllReadPortalPayload = {
  ...portalPayload,
  notifications: portalPayload.notifications.map((notification) =>
    notification.channel === "in_app" ? { ...notification, status: "read" } : notification
  ),
};

const notificationArchivedPortalPayload = {
  ...notificationReadPortalPayload,
  notifications: notificationReadPortalPayload.notifications.map((notification) =>
    notification.id === 102 || notification.id === 103
      ? { ...notification, status: "dismissed", is_archived: true, archived_at: "2026-06-01T12:00:00Z", archive_reason: "manual_archive" }
      : notification
  ),
};

const notificationRestoredPortalPayload = {
  ...notificationArchivedPortalPayload,
  notifications: notificationArchivedPortalPayload.notifications.map((notification) =>
    notification.id === 102
      ? { ...notification, status: "read", is_archived: false, archived_at: "", auto_archived_at: "", archive_reason: "" }
      : notification
  ),
};

const notificationCleanupUpdatedPortalPayload = {
  ...portalPayload,
  notification_cleanup_preferences: {
    ...portalPayload.notification_cleanup_preferences,
    auto_archive_enabled: false,
    auto_archive_frequency: "weekly",
    auto_archive_read_after_days: 45,
    auto_archive_maintenance_after_days: 75,
    auto_archive_completed_work_after_days: 120,
    next_auto_archive_run_at: "2026-06-22T12:00:00Z",
  },
};

const notificationPreferencesUpdatedPortalPayload = {
  ...portalPayload,
  notification_preferences: {
    ...portalPayload.notification_preferences,
    categories: {
      ...portalPayload.notification_preferences.categories,
      maintenance_due_soon: false,
      recommended_supplies: false,
    },
    channels: {
      ...portalPayload.notification_preferences.channels,
      email_enabled: false,
      sms_enabled: true,
    },
    frequency: "weekly_digest",
  },
};

const reminderDetailPayload = {
  reminder: {
    id: 11,
    home_system: {
      id: 11,
      display_name: "Main HVAC",
      system_type_label: "HVAC",
      manufacturer: "Carrier",
      model_number: "ABC123",
    },
    property: {
      id: 1,
      display_name: "Primary Home",
      address: "123 Main St, Austin, TX, 78701",
    },
    status: "overdue",
    priority: "high",
    due_date: "2026-06-01",
    days_until_due: -22,
    reason: "Main HVAC service is overdue based on a 6-month maintenance interval.",
    recommended_action: "Mark it serviced if completed, or create a service request.",
    service_interval_months: 6,
    supplies: portalPayload.property_profile.home_systems[0].supply_recommendations,
    service_request: { enabled: true },
  },
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
    account_type: "individual",
  },
  account: {
    email: "empty@example.com",
    has_user: false,
    has_usable_password: false,
    portal_token: "empty-token",
    account_type: "individual",
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
    home_systems: [],
    documents: [],
    photos: [],
    units: [],
    unit_count: 0,
    tenants: [],
    tenant_count: 0,
    tenant_maintenance_request_token: "empty-maintenance-token",
    tenant_maintenance_requests: [],
    tenant_maintenance_request_count: 0,
  },
  tenant_maintenance_requests: [],
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
      escrow_ledger: {
        available: "13000.00",
      },
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

function clonePortal(value = portalPayload) {
  return JSON.parse(JSON.stringify(value));
}

async function setupRecommendedSuppliesPortal(page) {
  let currentPortalPayload = clonePortal();
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "customer-portal-token");
  });
  await page.route("**/api/projects/customer-portal/**", async (route) => {
    const requestUrl = route.request().url();
    const method = route.request().method();

    if (requestUrl.includes("/customer-portal/customer-token/property/systems/11/reminder") && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reminderDetailPayload),
      });
      return;
    }

    if (method === "GET" && requestUrl.includes("/customer-portal/customer-token/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/property/systems/recommendations/system-11-supply-1/ignore/") && method === "POST") {
      const updateRecommendations = (systems = []) => systems.map((system) =>
        system.id === 11
          ? {
              ...system,
              supply_recommendations: (system.supply_recommendations || []).map((recommendation) =>
                recommendation.recommendation_key === "system-11-supply-1" || recommendation.id === "system-11-supply-1"
                  ? { ...recommendation, is_ignored: true }
                  : recommendation
              ),
            }
          : system
      );
      currentPortalPayload = {
        ...currentPortalPayload,
        property_profile: {
          ...currentPortalPayload.property_profile,
          home_systems: updateRecommendations(currentPortalPayload.property_profile.home_systems),
        },
        property_profiles: currentPortalPayload.property_profiles.map((property) =>
          property.id === currentPortalPayload.property_profile.id
            ? { ...property, home_systems: updateRecommendations(property.home_systems) }
            : property
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Recommendation ignored.", portal: currentPortalPayload }),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/property/systems/recommendations/system-11-supply-1/restore/") && method === "POST") {
      const updateRecommendations = (systems = []) => systems.map((system) =>
        system.id === 11
          ? {
              ...system,
              supply_recommendations: (system.supply_recommendations || []).map((recommendation) =>
                recommendation.recommendation_key === "system-11-supply-1" || recommendation.id === "system-11-supply-1"
                  ? { ...recommendation, is_ignored: false }
                  : recommendation
              ),
            }
          : system
      );
      currentPortalPayload = {
        ...currentPortalPayload,
        property_profile: {
          ...currentPortalPayload.property_profile,
          home_systems: updateRecommendations(currentPortalPayload.property_profile.home_systems),
        },
        property_profiles: currentPortalPayload.property_profiles.map((property) =>
          property.id === currentPortalPayload.property_profile.id
            ? { ...property, home_systems: updateRecommendations(property.home_systems) }
            : property
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Recommendation restored.", portal: currentPortalPayload }),
      });
      return;
    }

    await route.fallback();
  });
}

test("customer portal recommended supplies retailer links and actions are isolated", async ({ page }) => {
  await setupRecommendedSuppliesPortal(page);

  await page.goto("/portal/customer-token", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("customer-dashboard")).toBeVisible();
  await page.getByTestId("customer-dashboard-tab-property").click();

  await expect(page.getByTestId("property-suggested-supplies")).toContainText("Recommended Supplies");
  await expect(page.getByTestId("property-suggested-supplies")).toContainText("Replacement parts, filters, consumables, and upkeep items based on your Home Systems.");
  await expect(page.getByTestId("property-suggested-supplies")).toContainText("HVAC filter");
  await expect(page.getByTestId("property-suggested-supplies")).toContainText("May be due soon");
  await expect(page.getByTestId("property-suggested-supplies")).not.toContainText("Confidence");
  await expect(page.getByTestId("property-suggested-supplies")).not.toContainText("Source");

  await page.getByTestId("property-home-system-view-11").click();
  await page.getByTestId("property-home-system-view-recommendations-11").click();
  await expect(page.getByTestId("property-supply-recommendation-row").first()).toHaveClass(/ring-2/);
  await expect(page.getByTestId("property-supply-amazon-link").first()).toHaveText("Amazon");
  await expect(page.getByTestId("property-supply-amazon-link").first()).toHaveAttribute("href", /amazon\.com\/s\?/);
  await expect(page.getByTestId("property-supply-amazon-link").first()).toHaveAttribute("href", /tag=myhomebro-test-20/);
  await expect(page.getByTestId("property-supply-home-depot-link").first()).toHaveText("Home Depot");
  await expect(page.getByTestId("property-supply-home-depot-link").first()).toHaveAttribute("href", /homedepot\.com\/s\/Carrier\+XR-500\+HVAC\+air\+filter/);
  await expect(page.getByTestId("property-supply-lowes-link").first()).toHaveText("Lowe's");
  await expect(page.getByTestId("property-supply-lowes-link").first()).toHaveAttribute("href", /lowes\.com\/search\?searchTerm=Carrier\+XR-500\+HVAC\+air\+filter/);

  await page.getByTestId("property-supply-view").first().click();
  const detailDialog = page.getByRole("dialog", { name: "Supply recommendation details" });
  await expect(detailDialog).toContainText("HVAC filter");
  await expect(detailDialog.getByTestId("property-supply-amazon-link")).toHaveText("Amazon");
  await expect(detailDialog.getByTestId("property-supply-home-depot-link")).toHaveText("Home Depot");
  await expect(detailDialog.getByTestId("property-supply-lowes-link")).toHaveText("Lowe's");
  await detailDialog.getByRole("button", { name: "Close" }).click();

  await page.getByTestId("property-supply-create-service-request").first().click();
  await expect(page.getByTestId("customer-request-create-panel")).toBeVisible();
  await expect(page.getByTestId("customer-request-recommendation-context")).toContainText("Created from a Home System recommendation");
  await expect(page.getByLabel("Project Title")).toHaveValue("Main HVAC Maintenance - HVAC filter");
  await expect(page.getByLabel("Describe what you need help with")).toHaveValue(/Recommended item:/);
  await expect(page.getByLabel("Describe what you need help with")).toHaveValue(/HVAC filter/);
  await expect(page.getByLabel("Describe what you need help with")).toHaveValue(/Manufacturer: Carrier/);
  await expect(page.getByLabel("Describe what you need help with")).toHaveValue(/Model: XR-500/);

  await page.getByTestId("customer-dashboard-tab-property").click();
  await page.getByTestId("property-supply-ignore").first().click();
  await expect(page.getByTestId("property-home-systems")).not.toContainText("Ignored");
  await expect(page.getByTestId("property-suggested-supplies-empty")).toContainText("No active recommendations");
  await page.getByTestId("property-supply-filter-ignored").click();
  await expect(page.getByTestId("property-suggested-supplies")).toContainText("HVAC filter");
  await expect(page.getByTestId("property-suggested-supplies")).toContainText("Ignored");
  await page.getByTestId("property-supply-restore").first().click();
  await page.getByTestId("property-supply-filter-active").click();
  await expect(page.getByTestId("property-suggested-supplies")).toContainText("HVAC filter");
});

test("customer portal is reachable from the landing page and loads secure records", async ({
  page,
}) => {
  test.setTimeout(60000);
  const consoleErrors = [];
  let submittedRequestPayload = null;
  let submittedReviewPayload = null;
  let savedProfilePayload = null;
  let submittedTeamPayload = null;
  let submittedUnitPayload = null;
  let submittedTenantPayload = null;
  let submittedTenantMaintenanceReviewPayload = null;
  let submittedWorkOrderPayload = null;
  let submittedWorkOrderEditPayload = null;
  let submittedMarketplacePayload = null;
  let convertedWorkOrderCalled = false;
  let currentPortalPayload = portalPayload;
  let teamMembers = [];
  let vendors = [];
  let propertyUnits = [];
  let propertyTenants = [];
  let tenantMaintenanceRequests = [];
  let propertyWorkOrders = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "customer-portal-token");
    window.__mhbPlacePredictionInputs = [];

    class MockAutocompleteSessionToken {}

    class MockAutocompleteService {
      getPlacePredictions(request, callback) {
        window.__mhbPlacePredictionInputs.push(request.input);
        callback(
          [
            {
              description: "1515 South Ellison Drive, San Antonio, TX 78245, USA",
              place_id: "mock-place-1515-ellison",
            },
          ],
          "OK"
        );
      }
    }

    class MockPlacesService {
      getDetails(request, callback) {
        callback(
          {
            place_id: request.placeId,
            formatted_address: "1515 South Ellison Drive, San Antonio, TX 78245, USA",
            geometry: {
              location: {
                lat: () => 29.402,
                lng: () => -98.672,
              },
            },
            address_components: [
              { long_name: "1515", short_name: "1515", types: ["street_number"] },
              { long_name: "South Ellison Drive", short_name: "S Ellison Dr", types: ["route"] },
              { long_name: "San Antonio", short_name: "San Antonio", types: ["locality"] },
              { long_name: "Texas", short_name: "TX", types: ["administrative_area_level_1"] },
              { long_name: "78245", short_name: "78245", types: ["postal_code"] },
              { long_name: "United States", short_name: "US", types: ["country"] },
            ],
          },
          "OK"
        );
      }
    }

    window.google = {
      maps: {
        importLibrary: async () => ({
          AutocompleteService: MockAutocompleteService,
          PlacesService: MockPlacesService,
          AutocompleteSessionToken: MockAutocompleteSessionToken,
        }),
        places: {
          AutocompleteService: MockAutocompleteService,
          PlacesService: MockPlacesService,
          AutocompleteSessionToken: MockAutocompleteSessionToken,
          PlacesServiceStatus: {
            OK: "OK",
            ZERO_RESULTS: "ZERO_RESULTS",
          },
        },
      },
    };
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

    if (requestUrl.includes("/customer-portal/customer-token/vendor-search/contractors/") && method === "GET") {
      const parsedUrl = new URL(requestUrl);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          radius_miles: Number(parsedUrl.searchParams.get("radius_miles") || 25),
          results: [
            {
              contractor_id: 910,
              business_name: "Verified HVAC Co",
              trade_categories: ["HVAC"],
              primary_trade: "HVAC",
              city: "San Antonio",
              state: "TX",
              location: "San Antonio, TX",
              phone: "210-555-0110",
              website: "https://verifiedhvac.example",
              verification_status_label: "Verified",
            },
          ],
        }),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/vendor-search/businesses/") && method === "GET") {
      const parsedUrl = new URL(requestUrl);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          radius_miles: Number(parsedUrl.searchParams.get("radius_miles") || 25),
          display_location: "San Antonio, TX",
          diagnostics: {
            query_text: "Plumbing Joe San Antonio, TX",
            display_location: "San Antonio, TX",
            cached_count: 1,
            live_count: 0,
            geocoded: true,
          },
          results: [
            {
              business_id: "local-joe-plumbing",
              business_name: "Joe's Plumbing",
              trade_category: "Plumbing",
              address: "800 Pipe Rd, San Antonio, TX",
              city: "San Antonio",
              state: "TX",
              location: "San Antonio, TX",
              phone: "210-555-0220",
              website: "https://joesplumbing.example",
              rating: 4.8,
              source_metadata: { business_id: "local-joe-plumbing" },
            },
          ],
        }),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/properties/1/work-orders/901/contractor-matches/") && method === "GET") {
      const parsedUrl = new URL(requestUrl);
      const searchText = parsedUrl.searchParams.get("search") || "";
      const noEligible = searchText.toLowerCase().includes("nomatch");
      const radiusMiles = Number(parsedUrl.searchParams.get("radius_miles") || 25);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          radius_miles: radiusMiles,
          eligible_marketplace_count: noEligible ? 0 : 3,
          trade: "Plumbing",
          category: "plumbing",
          location: parsedUrl.searchParams.get("location") || "San Antonio, TX",
          display_location: "San Antonio, TX",
          query_text: `Plumbing ${searchText ? `${searchText} ` : ""}San Antonio, TX`,
          diagnostics: {
            query_text: `Plumbing ${searchText ? `${searchText} ` : ""}San Antonio, TX`,
            display_location: "San Antonio, TX",
            cached_count: 1,
            live_count: 0,
            geocoded: true,
          },
          myhomebro_contractors: noEligible
            ? []
            : [
                {
                  contractor_id: 77,
                  directory_entry_id: 7701,
                  business_name: "ABC Plumbing",
                  primary_trade: "Plumbing",
                  trade_categories: ["Plumbing"],
                  location: "San Antonio, TX",
                  phone: "210-555-0770",
                  website: "https://abcplumbing.example",
                  verification_status_label: "Verified",
                  source_label: "MyHomeBro Contractor",
                },
                {
                  contractor_id: 78,
                  directory_entry_id: 7702,
                  business_name: "River City Plumbing",
                  primary_trade: "Plumbing",
                  trade_categories: ["Plumbing"],
                  location: "San Antonio, TX",
                  phone: "210-555-0778",
                  website: "https://rivercityplumbing.example",
                  verification_status_label: "Verified",
                  source_label: "MyHomeBro Contractor",
                },
                {
                  contractor_id: 79,
                  directory_entry_id: 7703,
                  business_name: "Alamo Pipe Repair",
                  primary_trade: "Plumbing",
                  trade_categories: ["Plumbing"],
                  location: "San Antonio, TX",
                  phone: "210-555-0779",
                  website: "https://alamopipe.example",
                  verification_status_label: "Verified",
                  source_label: "MyHomeBro Contractor",
                },
              ],
          local_businesses: [
            {
              business_id: "local-joe-plumbing",
              business_name: "Joe's Plumbing",
              trade_category: "Plumbing",
              address: "800 Pipe Rd, San Antonio, TX",
              city: "San Antonio",
              state: "TX",
              location: "San Antonio, TX",
              phone: "210-555-0220",
              website: "https://joesplumbing.example",
              rating: 4.8,
              source_label: "Local Business",
              source_metadata: { business_id: "local-joe-plumbing" },
            },
          ],
        }),
      });
      return;
    }

    if (method === "GET" && requestUrl.includes("/customer-portal/customer-token/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
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
      savedProfilePayload = JSON.parse(route.request().postData() || "{}");
      if (savedProfilePayload.account_type === "property_management_company" && !tenantMaintenanceRequests.length) {
        tenantMaintenanceRequests = [
          {
            id: 801,
            reference: "TMR-000801",
            property_profile_id: 1,
            property_name: "Kitchen Remodel",
            unit_id: null,
            unit_label: "",
            submitted_by_name: "Taylor Tenant",
            submitted_by_email: "taylor@example.com",
            submitted_by_phone: "512-555-1111",
            category: "plumbing",
            category_label: "Plumbing",
            urgency: "urgent",
            urgency_label: "Urgent",
            title: "Kitchen sink leak",
            description: "Water is dripping under the kitchen sink.",
            permission_to_enter: true,
            pets_present: false,
            preferred_access_times: "Weekday mornings",
            status: "submitted",
            status_label: "Submitted",
            manager_notes: "",
            attachments: [
              {
                id: 901,
                filename: "sink-leak.jpg",
                content_type: "image/jpeg",
                size_bytes: 1234,
                url: "/files/sink-leak.jpg",
                is_image: true,
              },
            ],
            attachment_count: 1,
            created_at: "2026-06-16T15:00:00Z",
          },
          {
            id: 802,
            reference: "TMR-000802",
            property_profile_id: 1,
            property_name: "Kitchen Remodel",
            unit_id: 601,
            unit_label: "Unit 101",
            submitted_by_name: "Jordan Resident",
            submitted_by_email: "jordan@example.com",
            submitted_by_phone: "512-555-2222",
            category: "appliance",
            category_label: "Appliance",
            urgency: "normal",
            urgency_label: "Normal",
            title: "Old dishwasher leak",
            description: "Archived maintenance request for history.",
            permission_to_enter: false,
            pets_present: false,
            preferred_access_times: "",
            status: "closed",
            status_label: "Closed",
            manager_notes: "Closed after repair.",
            attachments: [],
            attachment_count: 0,
            created_at: "2026-06-10T15:00:00Z",
          },
        ];
      }
      currentPortalPayload = {
        ...currentPortalPayload,
        tenant_maintenance_requests: tenantMaintenanceRequests,
        property_work_orders: propertyWorkOrders,
        summary: {
          ...currentPortalPayload.summary,
          tenant_maintenance_requests: tenantMaintenanceRequests.length,
          property_work_orders: propertyWorkOrders.length,
        },
        customer: {
          ...currentPortalPayload.customer,
          ...savedProfilePayload,
        },
        property_profile: {
          ...currentPortalPayload.property_profile,
          tenant_maintenance_requests: tenantMaintenanceRequests,
          tenant_maintenance_request_count: tenantMaintenanceRequests.length,
          work_orders: propertyWorkOrders,
          work_order_count: propertyWorkOrders.length,
        },
        property_profiles: (currentPortalPayload.property_profiles || []).map((property) =>
          property.id === 1
            ? {
                ...property,
                tenant_maintenance_requests: tenantMaintenanceRequests,
                tenant_maintenance_request_count: tenantMaintenanceRequests.length,
                work_orders: propertyWorkOrders,
                work_order_count: propertyWorkOrders.length,
              }
            : property
        ),
        account: {
          ...currentPortalPayload.account,
          account_type: savedProfilePayload.account_type,
          is_property_management_company: savedProfilePayload.account_type === "property_management_company",
          company_name: savedProfilePayload.company_name,
          company_phone: savedProfilePayload.company_phone,
          company_email: savedProfilePayload.company_email,
          company_website: savedProfilePayload.company_website,
          company_street: savedProfilePayload.company_street,
          company_unit: savedProfilePayload.company_unit,
          company_city: savedProfilePayload.company_city,
          company_state: savedProfilePayload.company_state,
          company_zip: savedProfilePayload.company_zip,
          company_license_number: savedProfilePayload.company_license_number,
          company_notes: savedProfilePayload.company_notes,
          team_members: teamMembers,
          vendors,
        },
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/team-members/") && method === "POST") {
      submittedTeamPayload = JSON.parse(route.request().postData() || "{}");
      teamMembers = [
        ...teamMembers,
        {
          id: 501,
          name: submittedTeamPayload.name,
          email: submittedTeamPayload.email,
          phone: submittedTeamPayload.phone,
          role: submittedTeamPayload.role,
          role_label: "Manager",
          status: "invited",
          status_label: "Invited",
        },
      ];
      currentPortalPayload = {
        ...currentPortalPayload,
        account: {
          ...currentPortalPayload.account,
          team_members: teamMembers,
        },
      };
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/team-members/501/") && method === "PATCH") {
      const editPayload = JSON.parse(route.request().postData() || "{}");
      teamMembers = teamMembers.map((member) =>
        member.id === 501
          ? {
              ...member,
              name: editPayload.name ?? member.name,
              phone: editPayload.phone ?? member.phone,
              role: editPayload.role ?? member.role,
              role_label: editPayload.role === "accounting" ? "Accounting" : member.role_label,
              status: editPayload.status ?? member.status,
              status_label: editPayload.status === "active" ? "Active" : member.status_label,
            }
          : member
      );
      currentPortalPayload = {
        ...currentPortalPayload,
        account: {
          ...currentPortalPayload.account,
          team_members: teamMembers,
        },
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/team-members/501/") && method === "DELETE") {
      teamMembers = teamMembers.map((member) =>
        member.id === 501
          ? {
              ...member,
              status: "disabled",
              status_label: "Disabled",
            }
          : member
      );
      if (!teamMembers.some((member) => member.id === 502)) {
        teamMembers = [
          ...teamMembers,
          {
            id: 502,
            name: "Sam Supervisor",
            email: "sam@austinrentals.example",
            phone: "512-555-9090",
            role: "maintenance_coordinator",
            role_label: "Maintenance Coordinator",
            status: "active",
            status_label: "Active",
          },
        ];
      }
      currentPortalPayload = {
        ...currentPortalPayload,
        account: {
          ...currentPortalPayload.account,
          team_members: teamMembers,
        },
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/vendors/import/") && method === "POST") {
      const importPayload = JSON.parse(route.request().postData() || "{}");
      const isContractor = importPayload.import_type === "myhomebro_contractor";
      vendors = [
        ...vendors,
        {
          id: isContractor ? 702 : 703,
          name: importPayload.name || (isContractor ? "Verified HVAC Co" : "Joe's Plumbing"),
          trade_category: importPayload.trade_category || (isContractor ? "HVAC" : "Plumbing"),
          email: importPayload.email || "",
          phone: importPayload.phone || (isContractor ? "210-555-0110" : "210-555-0220"),
          website: importPayload.website || (isContractor ? "https://verifiedhvac.example" : "https://joesplumbing.example"),
          notes: importPayload.address || "",
          vendor_source: importPayload.import_type,
          vendor_source_label: isContractor ? "MyHomeBro Contractor" : "Local Business",
          linked_contractor_id: importPayload.contractor_id || null,
          status: "active",
          status_label: "Active",
        },
      ];
      currentPortalPayload = {
        ...currentPortalPayload,
        account: {
          ...currentPortalPayload.account,
          vendors,
        },
      };
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/vendors/") && method === "POST") {
      const submittedVendorPayload = JSON.parse(route.request().postData() || "{}");
      vendors = [
        ...vendors,
        {
          id: 701,
          name: submittedVendorPayload.name,
          trade_category: submittedVendorPayload.trade_category,
          email: submittedVendorPayload.email,
          phone: submittedVendorPayload.phone,
          website: submittedVendorPayload.website,
          notes: submittedVendorPayload.notes,
          vendor_source: "manual",
          vendor_source_label: "Manual Vendor",
          status: "active",
          status_label: "Active",
        },
      ];
      currentPortalPayload = {
        ...currentPortalPayload,
        account: {
          ...currentPortalPayload.account,
          vendors,
        },
      };
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/vendors/701/") && method === "PATCH") {
      const editPayload = JSON.parse(route.request().postData() || "{}");
      vendors = vendors.map((vendor) =>
        vendor.id === 701
          ? {
              ...vendor,
              name: editPayload.name ?? vendor.name,
              trade_category: editPayload.trade_category ?? vendor.trade_category,
              email: editPayload.email ?? vendor.email,
              phone: editPayload.phone ?? vendor.phone,
              website: editPayload.website ?? vendor.website,
              notes: editPayload.notes ?? vendor.notes,
              status: editPayload.status ?? vendor.status,
              status_label: editPayload.status === "inactive" ? "Inactive" : editPayload.status === "active" ? "Active" : vendor.status_label,
            }
          : vendor
      );
      currentPortalPayload = {
        ...currentPortalPayload,
        account: {
          ...currentPortalPayload.account,
          vendors,
        },
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/vendors/701/") && method === "DELETE") {
      vendors = vendors.map((vendor) =>
        vendor.id === 701
          ? {
              ...vendor,
              status: "inactive",
              status_label: "Inactive",
            }
          : vendor
      );
      currentPortalPayload = {
        ...currentPortalPayload,
        account: {
          ...currentPortalPayload.account,
          vendors,
        },
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/properties/1/units/bulk/") && method === "POST") {
      const bulkPayload = JSON.parse(route.request().postData() || "{}");
      const nextIdStart = 650;
      const existingLabels = new Set(propertyUnits.filter((unit) => unit.status !== "inactive").map((unit) => String(unit.unit_label || "").toLowerCase()));
      const created = (bulkPayload.unit_labels || [])
        .filter((label) => !existingLabels.has(String(label || "").toLowerCase()))
        .map((label, index) => ({
          id: nextIdStart + index,
          unit_label: label,
          unit_type: bulkPayload.unit_type || "apartment",
          unit_type_label: "Apartment",
          status: "active",
          status_label: "Active",
          access_notes: "",
          notes: "",
        }));
      propertyUnits = [...propertyUnits, ...created];
      currentPortalPayload = {
        ...currentPortalPayload,
        property_profile: {
          ...currentPortalPayload.property_profile,
          units: propertyUnits,
          unit_count: propertyUnits.length,
        },
        property_profiles: currentPortalPayload.property_profiles.map((property) =>
          property.id === 1
            ? {
                ...property,
                units: propertyUnits,
                unit_count: propertyUnits.length,
              }
            : property
        ),
      };
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          created,
          created_count: created.length,
          skipped: [],
          skipped_count: 0,
          portal: currentPortalPayload,
        }),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/properties/1/units/") && method === "POST") {
      submittedUnitPayload = JSON.parse(route.request().postData() || "{}");
      propertyUnits = [
        ...propertyUnits,
        {
          id: 601,
          unit_label: submittedUnitPayload.unit_label,
          unit_type: submittedUnitPayload.unit_type,
          unit_type_label: "Apartment",
          status: submittedUnitPayload.status || "active",
          status_label: "Vacant",
          access_notes: submittedUnitPayload.access_notes,
          notes: submittedUnitPayload.notes,
        },
      ];
      currentPortalPayload = {
        ...currentPortalPayload,
        property_profile: {
          ...currentPortalPayload.property_profile,
          units: propertyUnits,
          unit_count: propertyUnits.length,
        },
        property_profiles: currentPortalPayload.property_profiles.map((property) =>
          property.id === 1
            ? {
                ...property,
                units: propertyUnits,
                unit_count: propertyUnits.length,
              }
            : property
        ),
      };
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/properties/1/units/601/") && method === "PATCH") {
      const editPayload = JSON.parse(route.request().postData() || "{}");
      propertyUnits = propertyUnits.map((unit) =>
        unit.id === 601
          ? {
              ...unit,
              unit_label: editPayload.unit_label ?? unit.unit_label,
              unit_type: editPayload.unit_type ?? unit.unit_type,
              unit_type_label: editPayload.unit_type === "condo" ? "Condo" : unit.unit_type_label,
              status: editPayload.status ?? unit.status,
              status_label: editPayload.status === "active" ? "Active" : unit.status_label,
              access_notes: editPayload.access_notes ?? unit.access_notes,
              notes: editPayload.notes ?? unit.notes,
            }
          : unit
      );
      currentPortalPayload = {
        ...currentPortalPayload,
        property_profile: {
          ...currentPortalPayload.property_profile,
          units: propertyUnits,
          unit_count: propertyUnits.length,
        },
        property_profiles: currentPortalPayload.property_profiles.map((property) =>
          property.id === 1
            ? {
                ...property,
                units: propertyUnits,
                unit_count: propertyUnits.length,
              }
            : property
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/properties/1/units/601/") && method === "DELETE") {
      propertyUnits = propertyUnits.map((unit) =>
        unit.id === 601
          ? {
              ...unit,
              status: "inactive",
              status_label: "Inactive",
            }
          : unit
      );
      currentPortalPayload = {
        ...currentPortalPayload,
        property_profile: {
          ...currentPortalPayload.property_profile,
          units: propertyUnits,
          unit_count: propertyUnits.length,
        },
        property_profiles: currentPortalPayload.property_profiles.map((property) =>
          property.id === 1
            ? {
                ...property,
                units: propertyUnits,
                unit_count: propertyUnits.length,
              }
            : property
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/properties/1/tenants/") && method === "POST") {
      submittedTenantPayload = JSON.parse(route.request().postData() || "{}");
      propertyTenants = [
        ...propertyTenants,
        {
          id: 701,
          tenant_id: 801,
          first_name: submittedTenantPayload.first_name,
          last_name: submittedTenantPayload.last_name,
          name: `${submittedTenantPayload.first_name} ${submittedTenantPayload.last_name}`.trim(),
          email: submittedTenantPayload.email,
          phone: submittedTenantPayload.phone,
          unit_id: submittedTenantPayload.unit_id,
          unit_label: "Unit 101",
          status: submittedTenantPayload.status || "pending",
          status_label: "Active",
          move_in_date: submittedTenantPayload.move_in_date,
          move_out_date: submittedTenantPayload.move_out_date || "",
          emergency_contact_name: submittedTenantPayload.emergency_contact_name,
          emergency_contact_phone: submittedTenantPayload.emergency_contact_phone,
          maintenance_access_enabled: Boolean(submittedTenantPayload.maintenance_access_enabled),
          notes: submittedTenantPayload.notes,
        },
      ];
      currentPortalPayload = {
        ...currentPortalPayload,
        property_profile: {
          ...currentPortalPayload.property_profile,
          tenants: propertyTenants,
          tenant_count: propertyTenants.length,
        },
        property_profiles: currentPortalPayload.property_profiles.map((property) =>
          property.id === 1
            ? {
                ...property,
                tenants: propertyTenants,
                tenant_count: propertyTenants.length,
              }
            : property
        ),
      };
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/properties/1/tenants/701/") && method === "PATCH") {
      const editPayload = JSON.parse(route.request().postData() || "{}");
      propertyTenants = propertyTenants.map((tenant) =>
        tenant.id === 701
          ? {
              ...tenant,
              first_name: editPayload.first_name ?? tenant.first_name,
              last_name: editPayload.last_name ?? tenant.last_name,
              name: `${editPayload.first_name ?? tenant.first_name} ${editPayload.last_name ?? tenant.last_name}`.trim(),
              email: editPayload.email ?? tenant.email,
              phone: editPayload.phone ?? tenant.phone,
              unit_id: editPayload.unit_id ?? tenant.unit_id,
              unit_label: editPayload.unit_id ? "Unit 101" : "",
              status: editPayload.status ?? tenant.status,
              status_label: editPayload.status === "pending" ? "Pending" : tenant.status_label,
              maintenance_access_enabled: editPayload.maintenance_access_enabled ?? tenant.maintenance_access_enabled,
              notes: editPayload.notes ?? tenant.notes,
            }
          : tenant
      );
      currentPortalPayload = {
        ...currentPortalPayload,
        property_profile: {
          ...currentPortalPayload.property_profile,
          tenants: propertyTenants,
          tenant_count: propertyTenants.length,
        },
        property_profiles: currentPortalPayload.property_profiles.map((property) =>
          property.id === 1
            ? {
                ...property,
                tenants: propertyTenants,
                tenant_count: propertyTenants.length,
              }
            : property
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/properties/1/tenants/701/") && method === "DELETE") {
      propertyTenants = propertyTenants.map((tenant) =>
        tenant.id === 701
          ? {
              ...tenant,
              status: "former",
              status_label: "Former",
            }
          : tenant
      );
      currentPortalPayload = {
        ...currentPortalPayload,
        property_profile: {
          ...currentPortalPayload.property_profile,
          tenants: propertyTenants,
          tenant_count: propertyTenants.length,
        },
        property_profiles: currentPortalPayload.property_profiles.map((property) =>
          property.id === 1
            ? {
                ...property,
                tenants: propertyTenants,
                tenant_count: propertyTenants.length,
              }
            : property
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/properties/1/tenant-maintenance-requests/801/") && method === "PATCH") {
      submittedTenantMaintenanceReviewPayload = JSON.parse(route.request().postData() || "{}");
      tenantMaintenanceRequests = tenantMaintenanceRequests.map((request) =>
        request.id === 801
          ? {
              ...request,
              ...submittedTenantMaintenanceReviewPayload,
              status_label:
                submittedTenantMaintenanceReviewPayload.status === "under_review"
                  ? "Under Review"
                  : submittedTenantMaintenanceReviewPayload.status === "more_info_requested"
                    ? "More Info Requested"
                    : submittedTenantMaintenanceReviewPayload.status === "approved"
                      ? "Approved"
                      : submittedTenantMaintenanceReviewPayload.status === "rejected"
                        ? "Rejected"
                        : submittedTenantMaintenanceReviewPayload.status === "closed"
                          ? "Closed"
                          : request.status_label,
              reviewed_by: "customer@example.com",
              reviewed_at: "2026-06-16T16:00:00Z",
              can_create_work_order: submittedTenantMaintenanceReviewPayload.status === "approved",
              converted_to_work_order: false,
            }
          : request
      );
      currentPortalPayload = {
        ...currentPortalPayload,
        tenant_maintenance_requests: tenantMaintenanceRequests,
        property_profile: {
          ...currentPortalPayload.property_profile,
          tenant_maintenance_requests: tenantMaintenanceRequests,
          tenant_maintenance_request_count: tenantMaintenanceRequests.length,
        },
        property_profiles: (currentPortalPayload.property_profiles || []).map((property) =>
          property.id === 1
            ? {
                ...property,
                tenant_maintenance_requests: tenantMaintenanceRequests,
                tenant_maintenance_request_count: tenantMaintenanceRequests.length,
              }
            : property
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          request: tenantMaintenanceRequests.find((request) => request.id === 801),
          portal: currentPortalPayload,
        }),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/properties/1/tenant-maintenance-requests/801/create-work-order/") && method === "POST") {
      convertedWorkOrderCalled = true;
      const sourceRequest = tenantMaintenanceRequests.find((request) => request.id === 801);
      const convertedWorkOrder = {
        id: 901,
        work_order_number: "PWO-000901",
        reference: "PWO-000901",
        property_profile_id: 1,
        property_name: "Kitchen Remodel",
        unit_id: sourceRequest?.unit_id || null,
        unit_label: sourceRequest?.unit_label || "",
        tenant_id: sourceRequest?.tenant_id || null,
        tenant_name: sourceRequest?.tenant_name || "Taylor Tenant",
        source_tenant_request_id: 801,
        source_tenant_request_reference: "TMR-000801",
        title: sourceRequest?.title || "Kitchen sink leak",
        description: sourceRequest?.description || "Water is dripping under the kitchen sink.",
        category: sourceRequest?.category || "plumbing",
        category_label: sourceRequest?.category_label || "Plumbing",
        priority: sourceRequest?.urgency || "urgent",
        priority_label: sourceRequest?.urgency_label || "Urgent",
        status: "open",
        status_label: "Open",
        assignment_type: "internal_staff",
        assignment_type_label: "Internal Staff",
        assigned_staff_member_id: null,
        assigned_staff_member_name: "",
        assigned_vendor_id: null,
        assigned_vendor_name: "",
        assigned_vendor_trade_category: "",
        assigned_contractor_id: null,
        assigned_contractor_name: "",
        marketplace_status: "not_sent",
        marketplace_status_label: "Not Sent",
        marketplace_sent_at: "",
        marketplace_response_at: "",
        marketplace_opportunity_count: 0,
        scheduled_for: "",
        internal_notes: sourceRequest?.manager_notes || "",
        completion_notes: "",
        source_attachments: sourceRequest?.attachments || [],
        completion_attachments: [],
        activities: [
          {
            id: 1,
            activity_type: "created",
            activity_type_label: "Created",
            message: "Work order created from tenant maintenance request.",
            actor: "customer@example.com",
            created_at: "2026-06-16T16:30:00Z",
          },
        ],
        timeline: [
          {
            id: 1,
            activity_type: "created",
            activity_type_label: "Created",
            message: "Work order created from tenant maintenance request.",
            actor: "customer@example.com",
            created_at: "2026-06-16T16:30:00Z",
          },
        ],
        attachment_count: sourceRequest?.attachment_count || 0,
        completion_attachment_count: 0,
        created_at: "2026-06-16T16:30:00Z",
      };
      const acceptedMarketplaceWorkOrder = {
        ...convertedWorkOrder,
        id: 903,
        work_order_number: "PWO-000903",
        reference: "PWO-000903",
        source_tenant_request_id: null,
        source_tenant_request_reference: "",
        title: "Accepted marketplace repair",
        description: "Contractor accepted this marketplace work order.",
        assignment_type: "marketplace_contractor",
        assignment_type_label: "Marketplace Contractor",
        assigned_contractor_id: 77,
        assigned_contractor_name: "ABC Plumbing",
        assigned_staff_member_id: null,
        assigned_staff_member_name: "",
        assigned_vendor_id: null,
        assigned_vendor_name: "",
        assigned_vendor_trade_category: "",
        marketplace_status: "accepted",
        marketplace_status_label: "Accepted",
        marketplace_sent_at: "2026-06-16T18:00:00Z",
        marketplace_response_at: "2026-06-16T18:05:00Z",
        marketplace_opportunity_count: 1,
        linked_project_id: null,
        linked_project_number: "",
        linked_agreement_id: null,
        linked_agreement_status: "",
        linked_agreement_status_label: "",
        linked_agreement_token: "",
        linked_agreement_wizard_url: "",
        activities: [
          {
            id: 9905,
            activity_type: "marketplace_accepted",
            activity_type_label: "Marketplace Accepted",
            message: "Marketplace opportunity accepted by ABC Plumbing.",
            actor: "contractor@example.com",
            created_at: "2026-06-16T18:05:00Z",
          },
        ],
        timeline: [
          {
            id: 9905,
            activity_type: "marketplace_accepted",
            activity_type_label: "Marketplace Accepted",
            message: "Marketplace opportunity accepted by ABC Plumbing.",
            actor: "contractor@example.com",
            created_at: "2026-06-16T18:05:00Z",
          },
        ],
      };
      propertyWorkOrders = [acceptedMarketplaceWorkOrder, convertedWorkOrder, ...propertyWorkOrders];
      tenantMaintenanceRequests = tenantMaintenanceRequests.map((request) =>
        request.id === 801
          ? {
              ...request,
              converted_to_work_order: true,
              can_create_work_order: false,
              work_order_id: 901,
              work_order_number: "PWO-000901",
            }
          : request
      );
      currentPortalPayload = {
        ...currentPortalPayload,
        tenant_maintenance_requests: tenantMaintenanceRequests,
        property_work_orders: propertyWorkOrders,
        summary: {
          ...currentPortalPayload.summary,
          tenant_maintenance_requests: tenantMaintenanceRequests.length,
          property_work_orders: propertyWorkOrders.length,
        },
        property_profile: {
          ...currentPortalPayload.property_profile,
          tenant_maintenance_requests: tenantMaintenanceRequests,
          tenant_maintenance_request_count: tenantMaintenanceRequests.length,
          work_orders: propertyWorkOrders,
          work_order_count: propertyWorkOrders.length,
        },
        property_profiles: (currentPortalPayload.property_profiles || []).map((property) =>
          property.id === 1
            ? {
                ...property,
                tenant_maintenance_requests: tenantMaintenanceRequests,
                tenant_maintenance_request_count: tenantMaintenanceRequests.length,
                work_orders: propertyWorkOrders,
                work_order_count: propertyWorkOrders.length,
              }
            : property
        ),
      };
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          work_order: convertedWorkOrder,
          request: tenantMaintenanceRequests.find((request) => request.id === 801),
          portal: currentPortalPayload,
        }),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/properties/1/work-orders/903/create-agreement-draft/") && method === "POST") {
      propertyWorkOrders = propertyWorkOrders.map((row) =>
        row.id === 903
          ? {
              ...row,
              linked_project_id: 1203,
              linked_project_number: "PRJ-20260617-0001",
              linked_agreement_id: 3303,
              linked_agreement_status: "draft",
              linked_agreement_status_label: "Draft",
              linked_agreement_wizard_url: "/app/agreements/3303/wizard?step=1",
              activities: [
                ...(row.activities || []),
                {
                  id: 9906,
                  activity_type: "agreement_draft_created",
                  activity_type_label: "Agreement Draft Created",
                  message: "Agreement draft created for ABC Plumbing.",
                  actor: "customer@example.com",
                  created_at: "2026-06-16T18:45:00Z",
                },
              ],
            }
          : row
      );
      propertyWorkOrders = propertyWorkOrders.map((row) => ({ ...row, timeline: row.activities || [] }));
      currentPortalPayload = {
        ...currentPortalPayload,
        property_work_orders: propertyWorkOrders,
        property_profile: {
          ...currentPortalPayload.property_profile,
          work_orders: propertyWorkOrders,
          work_order_count: propertyWorkOrders.length,
        },
        property_profiles: (currentPortalPayload.property_profiles || []).map((property) =>
          property.id === 1 ? { ...property, work_orders: propertyWorkOrders, work_order_count: propertyWorkOrders.length } : property
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          created: true,
          linked_project_id: 1203,
          linked_agreement_id: 3303,
          next_url: "/app/agreements/3303/wizard?step=1",
          work_order: propertyWorkOrders.find((row) => row.id === 903),
          portal: currentPortalPayload,
        }),
      });
      return;
    }

    const workOrderPatchMatch = requestUrl.match(/\/customer-portal\/customer-token\/properties\/1\/work-orders\/(\d+)\//);
    if (workOrderPatchMatch && method === "PATCH") {
      const patchedWorkOrderId = Number(workOrderPatchMatch[1]);
      const rawBody = route.request().postData() || "";
      const isMultipart = (route.request().headers()["content-type"] || "").includes("multipart/form-data");
      submittedWorkOrderEditPayload = isMultipart
        ? {
            status: rawBody.includes("completed") ? "completed" : rawBody.includes("in_progress") ? "in_progress" : rawBody.includes("waiting") ? "waiting" : "",
            priority: rawBody.includes("normal") ? "normal" : "",
            completion_notes: rawBody.includes("Leak repaired and tested.") ? "Leak repaired and tested." : "",
            hasAttachment: rawBody.includes("completion.jpg"),
          }
        : JSON.parse(rawBody || "{}");
      propertyWorkOrders = propertyWorkOrders.map((row) =>
        row.id === patchedWorkOrderId
          ? {
              ...row,
              ...submittedWorkOrderEditPayload,
              status_label:
                submittedWorkOrderEditPayload.status === "completed"
                  ? "Completed"
                  : submittedWorkOrderEditPayload.status === "in_progress"
                  ? "In Progress"
                  : submittedWorkOrderEditPayload.status === "waiting"
                    ? "Waiting"
                    : submittedWorkOrderEditPayload.status === "closed"
                      ? "Closed"
                  : submittedWorkOrderEditPayload.status === "scheduled"
                    ? "Scheduled"
                    : row.status_label,
              priority_label:
                submittedWorkOrderEditPayload.priority === "normal"
                  ? "Normal"
                  : submittedWorkOrderEditPayload.priority === "low"
                    ? "Low"
                    : row.priority_label,
              assignment_type: submittedWorkOrderEditPayload.assignment_type || row.assignment_type || "internal_staff",
              assignment_type_label:
                submittedWorkOrderEditPayload.assignment_type === "vendor"
                  ? "Vendor"
                  : submittedWorkOrderEditPayload.assignment_type === "marketplace_contractor"
                    ? "Marketplace Contractor"
                    : submittedWorkOrderEditPayload.assignment_type === "internal_staff"
                      ? "Internal Staff"
                      : row.assignment_type_label || "Internal Staff",
              assigned_staff_member_id: submittedWorkOrderEditPayload.assignment_type === "internal_staff" ? submittedWorkOrderEditPayload.assigned_staff_member_id : row.assigned_staff_member_id,
              assigned_staff_member_name:
                submittedWorkOrderEditPayload.assignment_type === "internal_staff" && submittedWorkOrderEditPayload.assigned_staff_member_id
                  ? "Sam Supervisor"
                  : submittedWorkOrderEditPayload.assignment_type === "vendor" || submittedWorkOrderEditPayload.assignment_type === "marketplace_contractor"
                    ? ""
                    : row.assigned_staff_member_name,
              assigned_vendor_id: submittedWorkOrderEditPayload.assignment_type === "vendor" ? submittedWorkOrderEditPayload.assigned_vendor_id : submittedWorkOrderEditPayload.assignment_type ? null : row.assigned_vendor_id,
              assigned_vendor_name: submittedWorkOrderEditPayload.assignment_type === "vendor" && submittedWorkOrderEditPayload.assigned_vendor_id ? "Pipe Pros" : submittedWorkOrderEditPayload.assignment_type ? "" : row.assigned_vendor_name,
              assigned_vendor_trade_category: submittedWorkOrderEditPayload.assignment_type === "vendor" && submittedWorkOrderEditPayload.assigned_vendor_id ? "Plumbing" : submittedWorkOrderEditPayload.assignment_type ? "" : row.assigned_vendor_trade_category,
              assigned_contractor_id: submittedWorkOrderEditPayload.assignment_type === "marketplace_contractor" ? submittedWorkOrderEditPayload.assigned_contractor_id || null : submittedWorkOrderEditPayload.assignment_type ? null : row.assigned_contractor_id,
              assigned_contractor_name: submittedWorkOrderEditPayload.assignment_type === "marketplace_contractor" ? "" : row.assigned_contractor_name,
              marketplace_status: submittedWorkOrderEditPayload.assignment_type === "marketplace_contractor" ? "not_sent" : row.marketplace_status,
              marketplace_status_label: submittedWorkOrderEditPayload.assignment_type === "marketplace_contractor" ? "Not Sent" : row.marketplace_status_label,
              marketplace_sent_at: submittedWorkOrderEditPayload.assignment_type === "marketplace_contractor" ? "" : row.marketplace_sent_at,
              marketplace_response_at: submittedWorkOrderEditPayload.assignment_type === "marketplace_contractor" ? "" : row.marketplace_response_at,
              completed_at: submittedWorkOrderEditPayload.status === "completed" ? "2026-06-16T17:30:00Z" : row.completed_at,
              closed_at: submittedWorkOrderEditPayload.status === "closed" ? "2026-06-16T18:00:00Z" : row.closed_at,
              completion_attachments: submittedWorkOrderEditPayload.hasAttachment
                ? [
                    {
                      id: 991,
                      filename: "completion.jpg",
                      content_type: "image/jpeg",
                      size_bytes: 123,
                      url: "/files/completion.jpg",
                      is_image: true,
                      attachment_type: "completion_photo",
                      attachment_type_label: "Completion Photo",
                    },
                  ]
                : row.completion_attachments || [],
              completion_attachment_count: submittedWorkOrderEditPayload.hasAttachment ? 1 : row.completion_attachment_count || 0,
              activities: [
                ...(row.activities || []),
                {
                  id: (row.activities || []).length + 2,
                  activity_type: submittedWorkOrderEditPayload.status === "completed" ? "completed" : "status_changed",
                  activity_type_label: submittedWorkOrderEditPayload.status === "completed" ? "Completed" : "Status Changed",
                  message: submittedWorkOrderEditPayload.status === "completed" ? "Status changed to Completed." : "Work order updated.",
                  actor: "customer@example.com",
                  created_at: "2026-06-16T17:30:00Z",
                },
              ],
            }
          : row
      );
      propertyWorkOrders = propertyWorkOrders.map((row) => ({ ...row, timeline: row.activities || [] }));
      currentPortalPayload = {
        ...currentPortalPayload,
        property_work_orders: propertyWorkOrders,
        property_profile: {
          ...currentPortalPayload.property_profile,
          work_orders: propertyWorkOrders,
          work_order_count: propertyWorkOrders.length,
        },
        property_profiles: (currentPortalPayload.property_profiles || []).map((property) =>
          property.id === 1 ? { ...property, work_orders: propertyWorkOrders, work_order_count: propertyWorkOrders.length } : property
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          work_order: propertyWorkOrders.find((row) => row.id === 901),
          portal: currentPortalPayload,
        }),
      });
      return;
    }

    const sendMatch = requestUrl.match(/\/customer-portal\/customer-token\/properties\/1\/work-orders\/(\d+)\/send-to-marketplace\//);
    if (sendMatch && method === "POST") {
      const sentWorkOrderId = Number(sendMatch[1]);
      submittedMarketplacePayload = JSON.parse(route.request().postData() || "{}");
      const recipientInvitations = (submittedMarketplacePayload.recipients || []).map((recipient, index) => ({
        id: 9900 + index,
        recipient_type: recipient.source,
        recipient_type_label:
          recipient.source === "myhomebro_contractor"
            ? "MyHomeBro Contractor"
            : recipient.source === "preferred_vendor"
              ? "Preferred Vendor"
              : recipient.source === "manual_vendor"
                ? "Manual Vendor"
                : "Local Business",
        status: recipient.email || recipient.phone || recipient.source === "myhomebro_contractor" ? "sent" : "no_contact",
        status_label: recipient.email || recipient.phone || recipient.source === "myhomebro_contractor" ? "Sent" : "No Contact Info",
        name: recipient.name,
        email: recipient.email || "",
        phone: recipient.phone || "",
        trade_category: recipient.trade || "",
        location: recipient.location || "",
      }));
      propertyWorkOrders = propertyWorkOrders.map((row) =>
        row.id === sentWorkOrderId
          ? {
              ...row,
              marketplace_status: "sent",
              marketplace_status_label: "Sent",
              marketplace_sent_at: "2026-06-16T18:15:00Z",
              marketplace_response_at: "",
              marketplace_opportunity_count: (submittedMarketplacePayload.directory_entry_ids || []).length,
              recipient_invitations: recipientInvitations,
              recipient_summary: {
                total: recipientInvitations.length,
                sent: recipientInvitations.filter((recipient) => recipient.status === "sent").length,
                accepted: 0,
                declined: 0,
                no_contact: recipientInvitations.filter((recipient) => recipient.status === "no_contact").length,
              },
              activities: [
                ...(row.activities || []),
                {
                  id: 9903,
                  activity_type: "marketplace_sent",
                  activity_type_label: "Marketplace Sent",
                  message: `Sent to ${recipientInvitations.length} selected recipient${recipientInvitations.length === 1 ? "" : "s"}.`,
                  actor: "customer@example.com",
                  created_at: "2026-06-16T18:15:00Z",
                },
              ],
            }
          : row
      );
      propertyWorkOrders = propertyWorkOrders.map((row) => ({ ...row, timeline: row.activities || [] }));
      currentPortalPayload = {
        ...currentPortalPayload,
        property_work_orders: propertyWorkOrders,
        property_profile: {
          ...currentPortalPayload.property_profile,
          work_orders: propertyWorkOrders,
          work_order_count: propertyWorkOrders.length,
        },
        property_profiles: (currentPortalPayload.property_profiles || []).map((property) =>
          property.id === 1 ? { ...property, work_orders: propertyWorkOrders, work_order_count: propertyWorkOrders.length } : property
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          work_order: propertyWorkOrders.find((row) => row.id === sentWorkOrderId),
          opportunity_count: (submittedMarketplacePayload.directory_entry_ids || []).length,
          created_opportunity_count: (submittedMarketplacePayload.directory_entry_ids || []).length,
          invitation_count: recipientInvitations.length - (submittedMarketplacePayload.directory_entry_ids || []).length,
          portal: currentPortalPayload,
        }),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/properties/1/work-orders/901/withdraw-marketplace/") && method === "POST") {
      propertyWorkOrders = propertyWorkOrders.map((row) =>
        row.id === 901
          ? {
              ...row,
              marketplace_status: "withdrawn",
              marketplace_status_label: "Withdrawn",
              marketplace_response_at: "2026-06-16T18:30:00Z",
              activities: [
                ...(row.activities || []),
                {
                  id: 9904,
                  activity_type: "marketplace_withdrawn",
                  activity_type_label: "Marketplace Withdrawn",
                  message: "Marketplace opportunity withdrawn.",
                  actor: "customer@example.com",
                  created_at: "2026-06-16T18:30:00Z",
                },
              ],
            }
          : row
      );
      propertyWorkOrders = propertyWorkOrders.map((row) => ({ ...row, timeline: row.activities || [] }));
      currentPortalPayload = {
        ...currentPortalPayload,
        property_work_orders: propertyWorkOrders,
        property_profile: {
          ...currentPortalPayload.property_profile,
          work_orders: propertyWorkOrders,
          work_order_count: propertyWorkOrders.length,
        },
        property_profiles: (currentPortalPayload.property_profiles || []).map((property) =>
          property.id === 1 ? { ...property, work_orders: propertyWorkOrders, work_order_count: propertyWorkOrders.length } : property
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          work_order: propertyWorkOrders.find((row) => row.id === 901),
          portal: currentPortalPayload,
        }),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/properties/1/work-orders/") && method === "POST") {
      submittedWorkOrderPayload = JSON.parse(route.request().postData() || "{}");
      const manualWorkOrder = {
        id: 902,
        work_order_number: "PWO-000902",
        reference: "PWO-000902",
        property_profile_id: 1,
        property_name: "Kitchen Remodel",
        unit_id: submittedWorkOrderPayload.unit_id,
        unit_label: submittedWorkOrderPayload.unit_id ? "Unit 101" : "",
        tenant_id: submittedWorkOrderPayload.tenant_id,
        tenant_name: submittedWorkOrderPayload.tenant_id ? "Taylor Resident" : "",
        source_tenant_request_id: null,
        source_tenant_request_reference: "",
        title: submittedWorkOrderPayload.title,
        description: submittedWorkOrderPayload.description,
        category: submittedWorkOrderPayload.category,
        category_label: "HVAC",
        priority: submittedWorkOrderPayload.priority,
        priority_label: "Normal",
        status: submittedWorkOrderPayload.status,
        status_label:
          submittedWorkOrderPayload.status === "scheduled"
            ? "Scheduled"
            : submittedWorkOrderPayload.status === "in_progress"
              ? "In Progress"
              : "Open",
        assignment_type: submittedWorkOrderPayload.assignment_type || "internal_staff",
        assignment_type_label:
          submittedWorkOrderPayload.assignment_type === "vendor"
            ? "Vendor"
            : submittedWorkOrderPayload.assignment_type === "marketplace_contractor"
              ? "Marketplace Contractor"
              : "Internal Staff",
        assigned_staff_member_id: submittedWorkOrderPayload.assigned_staff_member_id,
        assigned_staff_member_name: submittedWorkOrderPayload.assigned_staff_member_id ? "Sam Supervisor" : "",
        assigned_vendor_id: submittedWorkOrderPayload.assigned_vendor_id,
        assigned_vendor_name: submittedWorkOrderPayload.assigned_vendor_id ? "Pipe Pros" : "",
        assigned_vendor_trade_category: submittedWorkOrderPayload.assigned_vendor_id ? "Plumbing" : "",
        assigned_contractor_id: submittedWorkOrderPayload.assigned_contractor_id,
        assigned_contractor_name: "",
        marketplace_status: "not_sent",
        marketplace_status_label: "Not Sent",
        marketplace_sent_at: "",
        marketplace_response_at: "",
        marketplace_opportunity_count: 0,
        scheduled_for: submittedWorkOrderPayload.scheduled_for,
        internal_notes: submittedWorkOrderPayload.internal_notes,
        completion_notes: submittedWorkOrderPayload.completion_notes,
        source_attachments: [],
        completion_attachments: [],
        attachment_count: 0,
        completion_attachment_count: 0,
        activities: [
          {
            id: 9902,
            activity_type: "created",
            activity_type_label: "Created",
            message: "Work order created.",
            actor: "customer@example.com",
            created_at: "2026-06-16T17:00:00Z",
          },
        ],
        timeline: [
          {
            id: 9902,
            activity_type: "created",
            activity_type_label: "Created",
            message: "Work order created.",
            actor: "customer@example.com",
            created_at: "2026-06-16T17:00:00Z",
          },
        ],
        created_at: "2026-06-16T17:00:00Z",
      };
      propertyWorkOrders = [manualWorkOrder, ...propertyWorkOrders];
      currentPortalPayload = {
        ...currentPortalPayload,
        property_work_orders: propertyWorkOrders,
        summary: {
          ...currentPortalPayload.summary,
          property_work_orders: propertyWorkOrders.length,
        },
        property_profile: {
          ...currentPortalPayload.property_profile,
          work_orders: propertyWorkOrders,
          work_order_count: propertyWorkOrders.length,
        },
        property_profiles: (currentPortalPayload.property_profiles || []).map((property) =>
          property.id === 1 ? { ...property, work_orders: propertyWorkOrders, work_order_count: propertyWorkOrders.length } : property
        ),
      };
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          work_order: manualWorkOrder,
          portal: currentPortalPayload,
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

    if (requestUrl.includes("/customer-portal/customer-token/requests/9/contractor-search/") && method === "POST") {
      currentPortalPayload = {
        ...currentPortalPayload,
        requests: currentPortalPayload.requests.map((request) =>
          request.request_id === 9
            ? {
                ...request,
                workflow_status: "contractor_matching",
                workflow_status_label: "Contractor Matching",
                current_next_action: "Review local contractor matches and select who should receive this request.",
                contractor_matching_started: true,
                source_intake_id: 99,
                source_intake_token: "portal-intake-token",
                source_intake: {
                  id: 99,
                  token: "portal-intake-token",
                  status: "analyzed",
                  post_submit_flow: "",
                },
              }
            : request
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Contractor matching started.",
          request_id: 9,
          source_intake_id: 99,
          source_intake_token: "portal-intake-token",
          portal: currentPortalPayload,
        }),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/requests/9/contractors/select/") && method === "POST") {
      currentPortalPayload = {
        ...currentPortalPayload,
        requests: currentPortalPayload.requests.map((request) =>
          request.request_id === 9
            ? {
                ...request,
                workflow_status: "sent_to_contractors",
                workflow_status_label: "Sent to 1 Contractor",
                current_next_action: "Wait for contractor responses or continue reviewing this request.",
                status: "routed",
                status_label: "Routed",
                can_edit: false,
                can_cancel: true,
                can_delete: false,
                edit_lock_reason: "Editing is locked after a request is sent to contractors or converted to an agreement.",
                contractor_matching_started: true,
                routed_contractor_count: 1,
                routed_contractors: [
                  {
                    id: "opportunity-77",
                    business_name: "Austin HVAC Pros",
                    contact_name: "Alex Tech",
                    phone: "512-555-0900",
                    email: "hello@austinhvac.test",
                    service_area: "Austin, TX",
                    trade: "HVAC",
                    status_label: "Sent",
                    selection_method: "Sent from Customer Portal",
                    selected_at: "2026-06-09T12:05:00Z",
                  },
                ],
              }
            : request
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Request sent to selected contractors.",
          created: [{ opportunity_id: 77, contractor: "Austin HVAC Pros" }],
          opportunity_count: 1,
          portal: currentPortalPayload,
        }),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/requests/9/cancel/") && method === "POST") {
      const payload = JSON.parse(route.request().postData() || "{}");
      currentPortalPayload = {
        ...currentPortalPayload,
        requests: currentPortalPayload.requests.map((request) =>
          request.request_id === 9
            ? {
                ...request,
                workflow_status: "cancelled",
                workflow_status_label: "Cancelled",
                current_next_action: "This request was cancelled and will not be sent to contractors.",
                status: "cancelled",
                status_label: "Cancelled",
                can_edit: false,
                can_cancel: false,
                can_delete: false,
                cancellation_reason: payload.reason || "",
                cancelled_at: "2026-06-09T12:30:00Z",
                activity_timeline: [
                  ...(request.activity_timeline || []),
                  {
                    title: "Request cancelled",
                    description: payload.reason || "Cancelled by homeowner.",
                    occurred_at: "2026-06-09T12:30:00Z",
                    status: "cancelled",
                  },
                ],
              }
            : request
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Request cancelled.",
          request_id: 9,
          notified_contractors: 1,
          portal: currentPortalPayload,
        }),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/requests/") && method === "POST") {
      submittedRequestPayload = JSON.parse(route.request().postData() || "{}");
      currentPortalPayload = {
        ...portalPayload,
        requests: [
          {
            id: "customer-request-9",
            request_id: 9,
            source_kind: "customer_request",
            source_kind_label: "Customer Portal Request",
            request_source_label: "Customer Portal",
            project_title: submittedRequestPayload.project_title || submittedRequestPayload.title,
            project_scope: submittedRequestPayload.project_scope || submittedRequestPayload.description,
            original_description: submittedRequestPayload.project_scope || submittedRequestPayload.description,
            ai_enhanced_description: "",
            status: "submitted",
            status_label: "Submitted",
            workflow_status: "reviewing_request",
            workflow_status_label: "Reviewing Request",
            current_next_action: "Edit the request or find contractors when you are ready.",
            conversion_status: "Reviewing Request",
            can_edit: true,
            can_cancel: true,
            can_delete: true,
            edit_lock_reason: "",
            contractor_matching_started: false,
            routed_contractor_count: 0,
            routed_contractors: [],
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
            city: "Austin",
            state: "TX",
            postal_code: "78703",
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
      };
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
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

    if (/\/customer-portal\/customer-token\/property\/(?:\?|$)/.test(requestUrl) && method === "PATCH") {
      const updatePayload = route.request().postDataJSON();
      const updatedProperty = {
        ...currentPortalPayload.property_profile,
        ...updatePayload,
        property_type_label: updatePayload.property_type === "townhome" ? "Townhome" : currentPortalPayload.property_profile.property_type_label,
      };
      currentPortalPayload = {
        ...currentPortalPayload,
        property_profile: updatedProperty,
        property_profiles: currentPortalPayload.property_profiles.map((property) =>
          property.id === updatedProperty.id ? { ...property, ...updatedProperty } : property
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/property/upload-sessions/") && method === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(scanSessionPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/property/documents/44/apply-extraction/") && method === "POST") {
      currentPortalPayload = scanAppliedPortalPayload;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(scanAppliedPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/property/documents/") && method === "POST") {
      const postData = await route.request().postData();
      if (postData && postData.includes("home_system_id")) {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(scanUploadResult),
        });
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(uploadedPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/upload-sessions/scan-session-token/") && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(scanSessionPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/upload-sessions/scan-session-token/") && method === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(scanUploadResult),
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

    if (requestUrl.includes("/customer-portal/customer-token/property/systems/11/reminder") && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reminderDetailPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/property/systems/11/") && method === "PATCH") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(systemUpdatedPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/property/systems/11/") && method === "DELETE") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(systemArchivedPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/property/systems/11/mark-serviced/") && method === "POST") {
      currentPortalPayload = systemServicedPortalPayload;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/property/systems/11/service-request/") && method === "POST") {
      currentPortalPayload = systemServiceRequestPortalPayload;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/property/systems/recommendations/system-11-supply-1/ignore/") && method === "POST") {
      const updateRecommendations = (systems = []) => systems.map((system) =>
        system.id === 11
          ? {
              ...system,
              supply_recommendations: (system.supply_recommendations || []).map((recommendation) =>
                recommendation.recommendation_key === "system-11-supply-1" || recommendation.id === "system-11-supply-1"
                  ? { ...recommendation, is_ignored: true }
                  : recommendation
              ),
            }
          : system
      );
      currentPortalPayload = {
        ...currentPortalPayload,
        property_profile: {
          ...currentPortalPayload.property_profile,
          home_systems: updateRecommendations(currentPortalPayload.property_profile.home_systems),
        },
        property_profiles: currentPortalPayload.property_profiles.map((property) =>
          property.id === currentPortalPayload.property_profile.id
            ? { ...property, home_systems: updateRecommendations(property.home_systems) }
            : property
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Recommendation ignored.", portal: currentPortalPayload }),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/property/systems/recommendations/system-11-supply-1/restore/") && method === "POST") {
      const updateRecommendations = (systems = []) => systems.map((system) =>
        system.id === 11
          ? {
              ...system,
              supply_recommendations: (system.supply_recommendations || []).map((recommendation) =>
                recommendation.recommendation_key === "system-11-supply-1" || recommendation.id === "system-11-supply-1"
                  ? { ...recommendation, is_ignored: false }
                  : recommendation
              ),
            }
          : system
      );
      currentPortalPayload = {
        ...currentPortalPayload,
        property_profile: {
          ...currentPortalPayload.property_profile,
          home_systems: updateRecommendations(currentPortalPayload.property_profile.home_systems),
        },
        property_profiles: currentPortalPayload.property_profiles.map((property) =>
          property.id === currentPortalPayload.property_profile.id
            ? { ...property, home_systems: updateRecommendations(property.home_systems) }
            : property
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Recommendation restored.", portal: currentPortalPayload }),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/property/systems/") && method === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(systemCreatedPortalPayload),
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

    if (requestUrl.includes("/customer-portal/customer-token/notifications/mark-all-read/") && method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(notificationsAllReadPortalPayload),
      });
      return;
    }

    if (
      (
        requestUrl.includes("/customer-portal/customer-token/notifications/102/archive/")
        || requestUrl.includes("/customer-portal/customer-token/notifications/103/archive/")
      )
      && method === "POST"
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(notificationArchivedPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/notifications/102/restore/") && method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(notificationRestoredPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/notifications/cleanup-preferences/") && method === "PATCH") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(notificationCleanupUpdatedPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/notifications/preferences/") && method === "PATCH") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(notificationPreferencesUpdatedPortalPayload),
      });
      return;
    }

    if (requestUrl.includes("/customer-portal/customer-token/property/systems/11/reminder") && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reminderDetailPayload),
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

  await page.route("**/api/projects/public-intake/contractor-search/**", async (route) => {
    const requestUrl = route.request().url();
    const method = route.request().method();
    if (method === "GET" && requestUrl.includes("token=portal-intake-token")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              id: "directory:17",
              source: "directory",
              business_name: "Austin HVAC Pros",
              contact_name: "Alex Tech",
              phone: "512-555-0900",
              email: "hello@austinhvac.test",
              formatted_address: "Austin, TX",
              service_area: "Austin, TX",
              primary_service: "HVAC",
              match_tier: "strong",
              match_score: 96,
              distance_miles: 4.2,
            },
          ],
          summary: {
            total: 1,
            radius_miles: 25,
            search_query: "hvac contractor",
          },
        }),
      });
      return;
    }
    await route.fallback();
  });
  await page.route("**/api/projects/customer-portal/customer-token/property/systems/11/reminder**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(reminderDetailPayload),
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("landing-hero-heading")).toContainText("Everything you need to plan, hire, and manage your project.");
  await expect(page.getByTestId("landing-customer-portal-button")).toContainText("Customer Log In");
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
  await expect(page.getByRole("navigation", { name: "Customer workspace tabs" }).locator("button")).toHaveText([
    /Overview/,
    /Requests/,
    /Projects/,
    /Property/,
    /Payments/,
    /Documents/,
    /Notifications/,
    /Account/,
  ]);
  await expect(page.getByTestId("customer-portal-summary")).toBeVisible();
  await expect(page.getByTestId("customer-portal-summary-active-requests")).toContainText("1");
  await expect(page.getByTestId("customer-portal-summary-agreements")).toContainText("1");
  await expect(page.getByTestId("customer-portal-summary-payments")).toContainText("5");
  await expect(page.getByTestId("customer-portal-summary-documents")).toContainText("4");
  await expect(page.getByTestId("customer-overview-active-projects")).toContainText("Active Projects");
  await expect(page.getByTestId("customer-overview-needs-attention")).toContainText("What needs my attention?");
  await expect(page.getByTestId("customer-overview-property-records")).toContainText("Your home history, organized");
  await expect(page.getByTestId("customer-activation-checklist")).toContainText("Home Profile Setup: 5 of 6 complete");
  await expect(page.getByTestId("customer-activation-checklist")).toContainText("active task moved to Needs Attention");
  await expect(page.getByTestId("customer-activation-checklist")).not.toContainText("Fund escrow or review payments");
  await expect(page.getByTestId("customer-overview-needs-attention")).toContainText("Invoice for Kitchen Remodel");
  await expect(page.getByTestId("customer-overview-needs-attention")).toContainText("Draw for Kitchen Remodel");
  await expect(page.getByTestId("customer-overview-needs-attention")).toContainText("Main HVAC may need attention");
  await expect(page.getByTestId("customer-unified-recommendations")).toBeVisible();
  await expect(page.getByTestId("customer-unified-recommendations")).toContainText("Recommended for you");
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
  await expect(page.getByTestId("customer-notifications-panel")).toContainText("New notifications that may need your attention.");
  await expect(page.getByTestId("customer-notifications-panel")).toContainText("Agreement needs signature");
  await expect(page.getByTestId("customer-notifications-panel")).not.toContainText("Payment received");
  await expect(page.getByTestId("customer-notifications-panel")).not.toContainText("Internal payment email row");
  await expect(page.getByTestId("customer-notifications-unread-count")).toContainText("1 unread");
  await expect(page.getByTestId("customer-notification-101")).toContainText("Unread");
  await expect(page.getByTestId("customer-notification-101")).toHaveClass(/border-sky-300/);
  await expect(page.getByTestId("customer-notification-102")).toHaveCount(0);
  await page.getByTestId("customer-notification-mark-read-101").click();
  await expect(page.getByTestId("customer-notifications-empty")).toContainText("No new notifications");
  await expect(page.getByTestId("customer-notifications-unread-count")).toContainText("No new notifications");
  await page.getByTestId("customer-notifications-open-history").click();
  await expect(page.getByTestId("customer-dashboard-tab-notifications")).toHaveClass(/border-amber/);
  await expect(page.getByTestId("customer-notifications-center")).toContainText("Agreement needs signature");
  await expect(page.getByTestId("customer-notifications-center")).toContainText("Payment received");
  await expect(page.getByTestId("customer-notifications-center")).toContainText("Main HVAC maintenance reminder");
  await expect(page.getByTestId("customer-notifications-center")).not.toContainText("Pool service request was saved.");
  await expect(page.getByTestId("customer-notification-preferences")).toContainText("Notification preferences");
  await expect(page.getByTestId("customer-notification-cleanup-settings")).toContainText("Notification cleanup");
  await expect(page.getByTestId("customer-notification-cleanup-settings")).toContainText(
    "Unread and action-required notifications are never auto-archived."
  );
  await expect(page.getByTestId("notification-cleanup-enabled")).toBeChecked();
  await expect(page.getByTestId("notification-cleanup-frequency")).toHaveValue("daily");
  await page.getByTestId("notification-cleanup-read-days").fill("6");
  await page.getByTestId("notification-cleanup-save").click();
  await expect(page.getByTestId("notification-cleanup-error")).toContainText("at least 7 days");
  await page.getByTestId("notification-cleanup-read-days").fill("45");
  await page.getByTestId("notification-cleanup-maintenance-days").fill("75");
  await page.getByTestId("notification-cleanup-completed-days").fill("120");
  await page.getByTestId("notification-cleanup-frequency").selectOption("weekly");
  await page.getByTestId("notification-cleanup-enabled").uncheck();
  await page.getByTestId("notification-cleanup-save").click();
  await expect(page.getByTestId("notification-cleanup-enabled")).not.toBeChecked();
  await expect(page.getByTestId("notification-cleanup-frequency")).toHaveValue("weekly");
  await expect(page.getByTestId("notification-cleanup-read-days")).toHaveValue("45");
  await page.getByTestId("customer-notifications-filter-archived").click();
  await expect(page.getByTestId("customer-notifications-center")).toContainText("Pool service request was saved.");
  await expect(page.getByTestId("customer-notifications-center")).not.toContainText("Payment received");
  await page.getByTestId("customer-notifications-filter-recent").click();
  await expect(page.getByTestId("customer-notifications-center")).toContainText("Agreement needs signature");
  await expect(page.getByTestId("customer-notifications-center")).toContainText("Payment received");
  await page.getByTestId("customer-notifications-center-archive-102").click();
  await expect(page.getByTestId("customer-notifications-center")).not.toContainText("Payment received");
  await page.getByTestId("customer-notifications-filter-archived").click();
  await expect(page.getByTestId("customer-notifications-center")).toContainText("Payment received");
  await page.getByTestId("customer-notifications-center-restore-102").click();
  await page.getByTestId("customer-notifications-filter-recent").click();
  await expect(page.getByTestId("customer-notifications-center")).toContainText("Payment received");
  await page.getByTestId("customer-notifications-filter-archived").click();
  await expect(page.getByTestId("customer-notifications-center")).not.toContainText("Payment received");
  await page.getByTestId("customer-dashboard-tab-overview").click();

  await page.getByTestId("customer-dashboard-tab-account").click();
  await expect(page.getByTestId("customer-account-panel")).toContainText("My Profile");
  await expect(page.getByTestId("address-autocomplete-suggestions")).toHaveCount(0);
  await expect(page.getByTestId("customer-profile-email")).toHaveValue("customer@example.com");
  await expect(page.getByTestId("customer-profile-phone")).toBeVisible();
  await expect(page.getByTestId("customer-account-type-section")).toContainText("Account Type");
  await expect(page.getByTestId("customer-account-type-individual")).toBeChecked();
  await expect(page.getByTestId("customer-company-profile-section")).toHaveCount(0);
  await expect(page.getByTestId("pm-team-members-section")).toHaveCount(0);
  await expect(page.getByTestId("pm-vendors-section")).toHaveCount(0);
  await expect(page.getByTestId("customer-account-linked-properties")).toContainText("Primary Property");
  await expect(page.getByTestId("customer-account-linked-properties")).toContainText("Lake House");
  await expect(page.getByTestId("customer-account-logout")).toContainText("Log out");
  await page.getByTestId("customer-account-type-property_management_company").check();
  await expect(page.getByTestId("customer-company-profile-section")).toContainText("Company Profile");
  await expect(page.getByTestId("pm-team-members-section")).toContainText("Team Members");
  await expect(page.getByTestId("pm-team-members-section")).toContainText(
    "Team members help manage properties, maintenance requests, tenants, vendors, and operations."
  );
  await expect(page.getByTestId("pm-team-members-empty")).toContainText("Add team members");
  await expect(page.getByTestId("pm-vendors-section")).toContainText("Vendors");
  await expect(page.getByTestId("pm-vendors-empty")).toContainText("Add preferred vendors");
  await page.getByTestId("customer-company-name").fill("Austin Rentals Group");
  await page.getByTestId("customer-company-phone").fill("512-555-3434");
  await page.getByTestId("customer-company-email").fill("ops@austinrentals.example");
  await page.getByTestId("customer-company-website").fill("https://austinrentals.example");
  await page.getByTestId("customer-company-street").fill("700 Leasing Ave");
  await page.getByTestId("customer-company-license-number").fill("PM-12345");
  await page.getByTestId("customer-company-notes").fill("Portfolio onboarding account.");
  await page.getByTestId("customer-profile-name").fill("Pat Updated");
  await page.getByTestId("customer-profile-phone").fill("512-555-1212");
  await page.getByTestId("customer-profile-address-line1").fill("700 Customer Ln");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByTestId("customer-profile-phone")).toHaveValue("512-555-1212");
  await expect(page.getByTestId("customer-company-name")).toHaveValue("Austin Rentals Group");
  expect(savedProfilePayload).toMatchObject({
    account_type: "property_management_company",
    company_name: "Austin Rentals Group",
    company_phone: "512-555-3434",
    company_email: "ops@austinrentals.example",
    company_website: "https://austinrentals.example",
    company_street: "700 Leasing Ave",
    company_license_number: "PM-12345",
    company_notes: "Portfolio onboarding account.",
  });
  await expect(page.getByRole("navigation", { name: "Customer workspace tabs" }).locator("button")).toHaveText([
    /Overview/,
    /Maintenance/,
    /Requests/,
    /Projects/,
    /Property/,
    /Payments/,
    /Documents/,
    /Notifications/,
    /Account/,
  ]);
  await page.getByTestId("customer-account-type-individual").check();
  await expect(page.getByTestId("customer-company-profile-section")).toHaveCount(0);
  await expect(page.getByTestId("pm-team-members-section")).toHaveCount(0);
  await expect(page.getByTestId("pm-vendors-section")).toHaveCount(0);
  await page.getByTestId("customer-account-type-property_management_company").check();
  await expect(page.getByTestId("customer-company-name")).toHaveValue("Austin Rentals Group");
  await page.getByTestId("pm-team-add-button").click();
  await expect(page.getByTestId("pm-team-add-modal")).toBeVisible();
  await page.getByTestId("pm-team-member-name").fill("Morgan Manager");
  await page.getByTestId("pm-team-member-email").fill("manager@austinrentals.example");
  await page.getByTestId("pm-team-member-phone").fill("512-555-5656");
  await page.getByTestId("pm-team-member-role").selectOption("manager");
  await page.getByTestId("pm-team-save-add").click();
  await expect(page.getByTestId("pm-team-add-modal")).toHaveCount(0);
  expect(submittedTeamPayload).toMatchObject({
    name: "Morgan Manager",
    email: "manager@austinrentals.example",
    phone: "512-555-5656",
    role: "manager",
  });
  await expect(page.getByTestId("pm-team-member-501")).toContainText("Morgan Manager");
  await expect(page.getByTestId("pm-team-member-501")).toContainText("Manager");
  await expect(page.getByTestId("pm-team-member-501")).toContainText("Invited");
  await page.getByTestId("pm-team-edit-501").click();
  await expect(page.getByTestId("pm-team-edit-modal")).toBeVisible();
  await page.getByTestId("pm-team-member-phone").fill("512-555-7878");
  await page.getByTestId("pm-team-member-role").selectOption("accounting");
  await page.getByTestId("pm-team-member-status").selectOption("active");
  await page.getByTestId("pm-team-save-edit").click();
  await expect(page.getByTestId("pm-team-edit-modal")).toHaveCount(0);
  await expect(page.getByTestId("pm-team-member-501")).toContainText("Accounting");
  await expect(page.getByTestId("pm-team-member-501")).toContainText("Active");
  await expect(page.getByTestId("pm-team-member-501")).toContainText("512-555-7878");
  await page.getByTestId("pm-team-disable-501").click();
  await expect(page.getByTestId("pm-team-member-501")).toContainText("Disabled");
  await expect(page.getByTestId("pm-team-disable-501")).toHaveCount(0);
  await page.getByTestId("pm-vendor-add-button").click();
  await expect(page.getByTestId("pm-vendor-add-modal")).toBeVisible();
  await expect(page.getByTestId("pm-vendor-source-myhomebro_contractor")).toBeVisible();
  await expect(page.getByTestId("pm-vendor-source-local_business")).toBeVisible();
  await expect(page.getByTestId("pm-vendor-source-manual")).toBeVisible();
  await expect(page.getByTestId("pm-vendor-search-myhomebro_contractor")).toBeVisible();
  await page.getByTestId("pm-vendor-source-manual").click();
  await page.getByTestId("pm-vendor-name").fill("Pipe Pros");
  await page.getByTestId("pm-vendor-trade").fill("Plumbing");
  await page.getByTestId("pm-vendor-email").fill("dispatch@pipepros.example");
  await page.getByTestId("pm-vendor-phone").fill("512-555-0101");
  await page.getByTestId("pm-vendor-website").fill("https://pipepros.example");
  await page.getByTestId("pm-vendor-notes").fill("Preferred plumbing vendor.");
  await page.getByTestId("pm-vendor-save-add").click();
  await expect(page.getByTestId("pm-vendor-add-modal")).toHaveCount(0);
  await expect(page.getByTestId("pm-vendor-701")).toContainText("Pipe Pros");
  await expect(page.getByTestId("pm-vendor-701")).toContainText("Plumbing");
  await expect(page.getByTestId("pm-vendor-701")).toContainText("Active");
  await expect(page.getByTestId("pm-vendor-701")).toContainText("Manual Vendor");
  await page.getByTestId("pm-vendor-edit-701").click();
  await expect(page.getByTestId("pm-vendor-edit-modal")).toBeVisible();
  await page.getByTestId("pm-vendor-phone").fill("512-555-0199");
  await page.getByTestId("pm-vendor-save-edit").click();
  await expect(page.getByTestId("pm-vendor-edit-modal")).toHaveCount(0);
  await expect(page.getByTestId("pm-vendor-701")).toContainText("512-555-0199");
  await page.getByTestId("pm-vendor-disable-701").click();
  await expect(page.getByTestId("pm-vendor-701")).toContainText("Inactive");
  await expect(page.getByTestId("pm-vendor-disable-701")).toHaveCount(0);
  await page.getByTestId("pm-vendor-edit-701").click();
  await page.getByTestId("pm-vendor-status").selectOption("active");
  await page.getByTestId("pm-vendor-save-edit").click();
  await expect(page.getByTestId("pm-vendor-701")).toContainText("Active");
  await page.getByTestId("pm-vendor-add-button").click();
  await page.getByTestId("pm-vendor-search-trade").fill("HVAC");
  await page.getByTestId("pm-vendor-search-location").fill("San Antonio");
  await page.getByTestId("pm-vendor-search-text").fill("Verified");
  await expect(page.getByTestId("pm-vendor-search-radius")).toHaveValue("25");
  await page.getByTestId("pm-vendor-search-radius").selectOption("50");
  await page.getByTestId("pm-vendor-run-search-myhomebro_contractor").click();
  await expect(page.getByTestId("pm-vendor-results-myhomebro_contractor")).toContainText("Verified HVAC Co");
  await expect(page.getByTestId("pm-vendor-results-myhomebro_contractor")).toContainText("1 MyHomeBro contractor within 50 miles");
  await page.getByTestId("pm-vendor-import-myhomebro_contractor-910").click();
  await expect(page.getByTestId("pm-vendor-add-modal")).toHaveCount(0);
  await expect(page.getByTestId("pm-vendor-702")).toContainText("Verified HVAC Co");
  await expect(page.getByTestId("pm-vendor-702")).toContainText("MyHomeBro Contractor");
  await page.getByTestId("pm-vendor-add-button").click();
  await page.getByTestId("pm-vendor-source-local_business").click();
  await page.getByTestId("pm-vendor-search-trade").fill("Plumbing");
  await page.getByTestId("pm-vendor-search-location").fill("San Antonio");
  await page.getByTestId("pm-vendor-search-text").fill("Joe");
  await page.getByTestId("pm-vendor-search-radius").selectOption("100");
  await page.getByTestId("pm-vendor-run-search-local_business").click();
  await expect(page.getByTestId("pm-vendor-results-local_business")).toContainText("Joe's Plumbing");
  await expect(page.getByTestId("pm-vendor-results-local_business")).toContainText("1 local business within 100 miles of San Antonio, TX");
  await page.getByTestId("pm-vendor-import-local_business-local-joe-plumbing").click();
  await expect(page.getByTestId("pm-vendor-add-modal")).toHaveCount(0);
  await expect(page.getByTestId("pm-vendor-703")).toContainText("Joe's Plumbing");
  await expect(page.getByTestId("pm-vendor-703")).toContainText("Local Business");

  await page.getByTestId("customer-dashboard-tab-property").click();
  await expect(page.getByTestId("property-command-summary")).toContainText("Property Summary");
  await expect(page.getByTestId("property-command-summary")).toContainText("Rental Property");
  await expect(page.getByTestId("property-summary-rental-stats")).toContainText("Units");
  await page.getByTestId("property-profile-form-toggle").click();
  await expect(page.getByTestId("property-profile-collapsed-summary")).toContainText("Rental Property");
  await expect(page.getByTestId("property-profile-collapsed-summary")).toContainText("Units");
  await expect(page.getByTestId("property-summary-add-unit")).toBeVisible();
  await page.getByTestId("property-profile-form-toggle").click();
  await expect(page.getByTestId("property-profile-fields")).toBeVisible();
  await expect(page.getByTestId("property-summary-add-unit")).toBeVisible();
  await expect(page.getByTestId("property-summary-add-tenant")).toBeVisible();
  await expect(page.getByTestId("property-units-section")).toContainText("Manage Units");
  await expect(page.getByTestId("property-unit-add-button")).toHaveCount(0);
  await expect(page.getByTestId("property-units-empty")).toHaveCount(0);
  await page.getByTestId("property-units-toggle").click();
  await expect(page.getByTestId("property-units-empty")).toContainText("No units added yet.");
  await expect(page.getByTestId("property-units-empty")).toContainText("Add units to track tenants, maintenance requests, and work orders by location.");
  await page.getByTestId("property-unit-bulk-button").click();
  await expect(page.getByTestId("property-unit-bulk-modal")).toBeVisible();
  await page.getByTestId("property-unit-bulk-text").fill("201-202, A1-A2");
  await expect(page.getByTestId("property-unit-bulk-preview")).toContainText("201");
  await expect(page.getByTestId("property-unit-bulk-preview")).toContainText("A2");
  await page.getByTestId("property-unit-bulk-save").click();
  await expect(page.getByTestId("property-unit-bulk-modal")).toHaveCount(0);
  await expect(page.getByTestId("property-unit-650")).toContainText("201");
  await expect(page.getByTestId("property-unit-653")).toContainText("A2");
  await page.getByTestId("property-unit-add-button").click();
  await expect(page.getByTestId("property-unit-add-modal")).toBeVisible();
  await page.getByTestId("property-unit-label").fill("Unit A");
  await page.getByTestId("property-unit-type").selectOption("apartment");
  await page.getByTestId("property-unit-status").selectOption("vacant");
  await page.getByTestId("property-unit-access-notes").fill("Use north stairwell.");
  await page.getByTestId("property-unit-notes").fill("Top floor unit.");
  await page.getByTestId("property-unit-save-add").click();
  await expect(page.getByTestId("property-unit-add-modal")).toHaveCount(0);
  expect(submittedUnitPayload).toMatchObject({
    unit_label: "Unit A",
    unit_type: "apartment",
    status: "vacant",
    access_notes: "Use north stairwell.",
    notes: "Top floor unit.",
  });
  await expect(page.getByTestId("property-unit-601")).toContainText("Unit A");
  await expect(page.getByTestId("property-unit-601")).toContainText("Apartment");
  await expect(page.getByTestId("property-unit-601")).toContainText("Vacant");
  await page.getByTestId("property-unit-edit-601").click();
  await expect(page.getByTestId("property-unit-edit-modal")).toBeVisible();
  await page.getByTestId("property-unit-label").fill("Unit 101");
  await page.getByTestId("property-unit-type").selectOption("condo");
  await page.getByTestId("property-unit-status").selectOption("active");
  await page.getByTestId("property-unit-access-notes").fill("Use keypad entry.");
  await page.getByTestId("property-unit-save-edit").click();
  await expect(page.getByTestId("property-unit-edit-modal")).toHaveCount(0);
  await expect(page.getByTestId("property-unit-601")).toContainText("Unit 101");
  await expect(page.getByTestId("property-unit-601")).toContainText("Condo");
  await expect(page.getByTestId("property-unit-601")).toContainText("Active");
  await page.getByTestId("property-unit-disable-601").click();
  await expect(page.getByTestId("property-unit-601")).toContainText("Inactive");
  await expect(page.getByTestId("property-unit-disable-601")).toHaveCount(0);

  await expect(page.getByTestId("property-tenants-section")).toContainText("Manage Tenants");
  await expect(page.getByTestId("property-tenant-add-button")).toHaveCount(0);
  await page.getByTestId("property-tenants-toggle").click();
  await expect(page.getByTestId("property-tenants-empty")).toContainText("No tenants added yet.");
  await expect(page.getByTestId("property-tenants-empty")).toContainText(
    "Add tenants so maintenance requests can be tied to the right property, unit, and resident.",
  );
  await page.getByTestId("property-tenant-add-button").click();
  await expect(page.getByTestId("property-tenant-add-modal")).toBeVisible();
  await expect(page.getByTestId("property-tenant-unit")).toContainText("Unit 101");
  await page.getByTestId("property-tenant-first-name").fill("Taylor");
  await page.getByTestId("property-tenant-last-name").fill("Tenant");
  await page.getByTestId("property-tenant-email").fill("taylor@example.com");
  await page.getByTestId("property-tenant-phone").fill("512-555-1111");
  await page.getByTestId("property-tenant-unit").selectOption("601");
  await page.getByTestId("property-tenant-status").selectOption("active");
  await page.getByTestId("property-tenant-move-in").fill("2026-06-01");
  await page.getByTestId("property-tenant-emergency-name").fill("Casey Contact");
  await page.getByTestId("property-tenant-emergency-phone").fill("512-555-2222");
  await page.getByTestId("property-tenant-maintenance-access").check();
  await page.getByTestId("property-tenant-notes").fill("Prefers text messages.");
  await page.getByTestId("property-tenant-save-add").click();
  await expect(page.getByTestId("property-tenant-add-modal")).toHaveCount(0);
  expect(submittedTenantPayload).toMatchObject({
    first_name: "Taylor",
    last_name: "Tenant",
    email: "taylor@example.com",
    phone: "512-555-1111",
    unit_id: 601,
    status: "active",
    move_in_date: "2026-06-01",
    emergency_contact_name: "Casey Contact",
    emergency_contact_phone: "512-555-2222",
    maintenance_access_enabled: true,
    notes: "Prefers text messages.",
  });
  await expect(page.getByTestId("property-tenant-701")).toContainText("Taylor Tenant");
  await expect(page.getByTestId("property-tenant-701")).toContainText("Active");
  await expect(page.getByTestId("property-tenant-701")).toContainText("Unit 101");
  await expect(page.getByTestId("property-tenant-701")).toContainText("Maintenance access");
  await page.getByTestId("property-tenant-edit-701").click();
  await expect(page.getByTestId("property-tenant-edit-modal")).toBeVisible();
  await page.getByTestId("property-tenant-last-name").fill("Resident");
  await page.getByTestId("property-tenant-email").fill("resident@example.com");
  await page.getByTestId("property-tenant-status").selectOption("pending");
  await page.getByTestId("property-tenant-maintenance-access").uncheck();
  await page.getByTestId("property-tenant-notes").fill("Updated notes.");
  await page.getByTestId("property-tenant-save-edit").click();
  await expect(page.getByTestId("property-tenant-edit-modal")).toHaveCount(0);
  await expect(page.getByTestId("property-tenant-701")).toContainText("Taylor Resident");
  await expect(page.getByTestId("property-tenant-701")).toContainText("Pending");
  await expect(page.getByTestId("property-tenant-701")).not.toContainText("Maintenance access");
  await page.getByTestId("property-tenant-former-701").click();
  await expect(page.getByTestId("property-tenant-701")).toContainText("Former");
  await expect(page.getByTestId("property-tenant-former-701")).toHaveCount(0);

  await expect(page.getByTestId("home-records-timeline-new-badge")).toContainText("1 new");
  await expect(page.getByTestId("home-records-timeline-collapsed-summary")).toContainText("total records");
  await expect(page.getByTestId("home-records-timeline-collapsed-summary")).toContainText("1 new");
  await page.getByTestId("home-records-timeline-toggle").click();
  await expect(page.getByTestId("home-records-timeline-action-tenant-maintenance-801")).toContainText("Kitchen sink leak");
  await expect(page.getByTestId("home-records-timeline-action-tenant-maintenance-801")).toContainText("Maintenance Request");
  await expect(page.getByTestId("home-records-timeline-action-tenant-maintenance-801")).toContainText("Review maintenance request");
  await expect(page.getByTestId("home-records-timeline")).toContainText("Old dishwasher leak");
  await page.getByTestId("home-records-timeline-action-tenant-maintenance-801").click();
  await expect(page.getByTestId("customer-dashboard-tab-maintenance")).toHaveClass(/border-amber/);
  await expect(page.getByTestId("tenant-maintenance-review-queue")).toBeVisible();
  await page.getByTestId("customer-dashboard-tab-overview").click();
  await expect(page.getByTestId("customer-overview-needs-attention")).toContainText("Kitchen sink leak");
  await expect(page.getByTestId("customer-overview-needs-attention")).toContainText("Review maintenance request");
  await expect(page.getByTestId("customer-overview-needs-attention")).not.toContainText("Old dishwasher leak");
  await page.getByTestId("customer-dashboard-tab-requests").click();
  await expect(page.getByTestId("tenant-maintenance-review-queue")).toHaveCount(0);
  await expect(page.getByTestId("property-work-orders-section")).toHaveCount(0);
  await expect(page.getByTestId("customer-portal-requests")).toContainText("Project & Service Requests");
  await page.getByTestId("customer-dashboard-tab-maintenance").click();

  await expect(page.getByTestId("property-work-orders-section")).toContainText("Work Orders");
  await expect(page.getByTestId("property-work-orders-empty")).toContainText("No active work orders.");
  await expect(page.getByTestId("tenant-maintenance-review-queue")).toContainText("Maintenance Requests");
  await expect(page.getByTestId("tenant-maintenance-request-801")).toContainText("Kitchen sink leak");
  await expect(page.getByTestId("tenant-maintenance-request-801")).toContainText("Urgent");
  await expect(page.getByTestId("tenant-maintenance-request-801")).toContainText("Submitted");
  await expect(page.getByTestId("tenant-maintenance-attachments-801")).toContainText("sink-leak.jpg");
  await expect(page.getByTestId("tenant-maintenance-request-802")).toHaveCount(0);
  await expect(page.getByTestId("maintenance-filter-count")).toContainText("1 of 2 requests");
  await page.getByTestId("maintenance-status-filter").selectOption("submitted");
  await expect(page.getByTestId("tenant-maintenance-request-801")).toContainText("Kitchen sink leak");
  await expect(page.getByTestId("tenant-maintenance-request-802")).toHaveCount(0);
  await expect(page.getByTestId("maintenance-filter-count")).toContainText("1 of 2 requests");
  await page.getByTestId("maintenance-urgency-filter").selectOption("normal");
  await expect(page.getByTestId("tenant-maintenance-request-801")).toHaveCount(0);
  await expect(page.getByTestId("tenant-maintenance-requests-empty")).toContainText("No active maintenance requests.");
  await expect(page.getByTestId("maintenance-filter-count")).toContainText("0 of 2 requests");
  await page.getByTestId("maintenance-reset-filters").click();
  await expect(page.getByTestId("tenant-maintenance-request-801")).toContainText("Kitchen sink leak");
  await page.getByTestId("tenant-maintenance-filter-archived").click();
  await page.getByTestId("maintenance-status-filter").selectOption("closed");
  await page.getByTestId("maintenance-location-filter").selectOption("unit:601");
  await expect(page.getByTestId("tenant-maintenance-request-802")).toContainText("Old dishwasher leak");
  await expect(page.getByTestId("tenant-maintenance-request-802")).toContainText("Unit 101");
  await expect(page.getByTestId("tenant-maintenance-request-801")).toHaveCount(0);
  await expect(page.getByTestId("maintenance-filter-count")).toContainText("1 of 2 requests");
  await page.getByTestId("maintenance-reset-filters").click();
  await expect(page.getByTestId("tenant-maintenance-request-801")).toContainText("Kitchen sink leak");
  await expect(page.getByTestId("tenant-maintenance-request-802")).toHaveCount(0);
  await page.getByTestId("tenant-maintenance-filter-archived").click();
  await expect(page.getByTestId("tenant-maintenance-request-802")).toContainText("Old dishwasher leak");
  await expect(page.getByTestId("tenant-maintenance-request-802")).toContainText("Closed");
  await expect(page.getByTestId("tenant-maintenance-request-801")).toHaveCount(0);
  await page.getByTestId("tenant-maintenance-filter-all").click();
  await expect(page.getByTestId("tenant-maintenance-request-801")).toContainText("Kitchen sink leak");
  await expect(page.getByTestId("tenant-maintenance-request-802")).toContainText("Old dishwasher leak");
  await page.getByTestId("tenant-maintenance-filter-active").click();
  await page.getByTestId("tenant-maintenance-notes-801").fill("Checking with maintenance coordinator.");
  await page.getByTestId("tenant-maintenance-under_review-801").click();
  await expect(page.getByTestId("tenant-maintenance-request-801")).toContainText("Under Review");
  expect(submittedTenantMaintenanceReviewPayload).toMatchObject({
    status: "under_review",
    manager_notes: "Checking with maintenance coordinator.",
  });
  await page.getByTestId("tenant-maintenance-notes-801").fill("Approved for maintenance follow-up.");
  await page.getByTestId("tenant-maintenance-approved-801").click();
  await expect(page.getByTestId("tenant-maintenance-request-801")).toContainText("Approved");
  expect(submittedTenantMaintenanceReviewPayload).toMatchObject({
    status: "approved",
    manager_notes: "Approved for maintenance follow-up.",
  });
  await page.getByTestId("tenant-maintenance-create-work-order-801").click();
  await expect.poll(() => convertedWorkOrderCalled).toBe(true);
  await expect(page.getByTestId("property-work-order-901")).toContainText("Kitchen sink leak");
  await expect(page.getByTestId("property-work-order-901")).toContainText("PWO-000901");
  await expect(page.getByTestId("property-work-order-901")).toContainText("Open");
  await expect(page.getByTestId("property-work-order-attachments-901")).toContainText("sink-leak.jpg");
  await expect(page.getByTestId("property-work-order-timeline-901")).toContainText("Created");
  await expect(page.getByTestId("tenant-maintenance-request-801")).toContainText("Work Order PWO-000901");
  await expect(page.getByTestId("tenant-maintenance-create-work-order-801")).toHaveCount(0);

  await page.getByTestId("property-work-order-edit-901").click();
  await expect(page.getByTestId("property-work-order-modal")).toBeVisible();
  await expect(page.getByTestId("property-work-order-stepper")).toContainText("Work Order");
  await expect(page.getByTestId("property-work-order-stepper")).toContainText("Contractors");
  await page.getByTestId("property-work-order-status").selectOption("in_progress");
  await page.getByTestId("property-work-order-priority").selectOption("normal");
  await page.getByTestId("property-work-order-continue-contractors").click();
  await page.getByTestId("property-work-order-completion-notes").fill("Parts ordered.");
  await page.getByTestId("property-work-order-save").click();
  await expect(page.getByTestId("property-work-order-modal")).toHaveCount(0);
  expect(submittedWorkOrderEditPayload).toMatchObject({
    status: "in_progress",
    priority: "normal",
    completion_notes: "Parts ordered.",
  });
  await expect(page.getByTestId("property-work-order-901")).toContainText("In Progress");
  await expect(page.getByTestId("property-work-order-901")).toContainText("Normal");
  await expect(page.getByTestId("property-work-order-actions-901")).toContainText("Complete Work");

  await page.getByTestId("property-work-order-complete-901").click();
  await expect(page.getByTestId("property-work-order-modal")).toBeVisible();
  await expect(page.getByTestId("property-work-order-status")).toHaveValue("completed");
  await page.getByTestId("property-work-order-continue-contractors").click();
  await page.getByTestId("property-work-order-completion-notes").fill("");
  await page.getByTestId("property-work-order-save").click();
  await expect(page.getByTestId("property-work-order-error")).toContainText("Completion notes are required");
  await page.getByTestId("property-work-order-completion-notes").fill("Leak repaired and tested.");
  await page.getByTestId("property-work-order-completion-files").setInputFiles({
    name: "completion.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("fake completion image"),
  });
  await expect(page.getByTestId("property-work-order-selected-files")).toContainText("completion.jpg");
  await page.getByTestId("property-work-order-save").click();
  await expect(page.getByTestId("property-work-order-modal")).toHaveCount(0);
  expect(submittedWorkOrderEditPayload).toMatchObject({
    status: "completed",
    priority: "normal",
    completion_notes: "Leak repaired and tested.",
    hasAttachment: true,
  });
  await expect(page.getByTestId("property-work-order-901")).toHaveCount(0);
  await page.getByTestId("property-work-order-filter-archived").click();
  await expect(page.getByTestId("property-work-order-901")).toContainText("Completed");
  await expect(page.getByTestId("property-work-order-completion-attachments-901")).toContainText("completion.jpg");
  await expect(page.getByTestId("property-work-order-timeline-901")).toContainText("Completed");
  await page.getByTestId("property-work-order-close-901").click();
  await expect(page.getByTestId("property-work-order-901")).toContainText("Closed");
  await page.getByTestId("property-work-order-edit-901").click();
  await expect(page.getByTestId("property-work-order-modal")).toBeVisible();
  await page.getByTestId("property-work-order-assignment-type").selectOption("vendor");
  await page.getByTestId("property-work-order-continue-contractors").click();
  await expect(page.getByTestId("property-work-order-vendor-panel")).toContainText("Search preferred vendors");
  await page.getByTestId("property-work-order-vendor-search").fill("Pipe");
  await page.getByTestId("property-work-order-vendor").selectOption("701");
  await page.getByTestId("property-work-order-continue-finalize").click();
  await page.getByTestId("property-work-order-save").click();
  await expect(page.getByTestId("property-work-order-modal")).toHaveCount(0);
  expect(submittedWorkOrderEditPayload).toMatchObject({
    assignment_type: "vendor",
    assigned_vendor_id: 701,
  });
  await expect(page.getByTestId("property-work-order-901")).toContainText("Vendor");
  await expect(page.getByTestId("property-work-order-901")).toContainText("Pipe Pros");
  await page.getByTestId("property-work-order-edit-901").click();
  await page.getByTestId("property-work-order-assignment-type").selectOption("marketplace_contractor");
  await page.getByTestId("property-work-order-continue-contractors").click();
  await expect(page.getByTestId("property-work-order-marketplace-placeholder")).toContainText("Contractor Search");
  await expect(page.getByTestId("property-work-order-marketplace-placeholder")).toContainText("Find MyHomeBro contractors and local businesses");
  await expect(page.getByTestId("property-work-order-continue-finalize")).toBeDisabled();
  await expect(page.getByTestId("property-work-order-marketplace-radius")).toHaveValue("25");
  await page.getByTestId("property-work-order-marketplace-search").fill("NoMatch");
  await page.getByTestId("property-work-order-preview-matches").click();
  await expect(page.getByTestId("property-work-order-marketplace-no-eligible")).toContainText("No approved MyHomeBro contractors found");
  await expect(page.getByTestId("property-work-order-marketplace-no-eligible")).toContainText("Try increasing the radius to 50 or 100 miles");
  await expect(page.getByTestId("property-work-order-local-business-results")).toContainText("Joe's Plumbing");
  await expect(page.getByTestId("property-work-order-continue-finalize")).toBeDisabled();
  await page.getByTestId("property-work-order-import-local-business-local-joe-plumbing").click();
  await expect(page.getByTestId("property-work-order-marketplace-placeholder")).toBeVisible();
  await page.getByTestId("property-work-order-marketplace-search").fill("Pipe");
  await page.getByTestId("property-work-order-marketplace-radius").selectOption("50");
  await page.getByTestId("property-work-order-preview-matches").click();
  await expect(page.getByTestId("property-work-order-marketplace-eligible")).toContainText("3 approved MyHomeBro contractors within 50 miles");
  await expect(page.getByTestId("property-work-order-marketplace-results")).toContainText("ABC Plumbing");
  await expect(page.getByTestId("property-work-order-local-business-results")).toContainText("1 local business within 50 miles of San Antonio, TX");
  await expect(page.getByTestId("property-work-order-local-business-results")).toContainText("Searching Plumbing near San Antonio, TX within 50 miles");
  await page.getByTestId("property-work-order-select-vendor-701").check();
  await page.getByTestId("property-work-order-select-local-business-local-joe-plumbing").check();
  await page.getByTestId("property-work-order-select-contractor-7701").check();
  await expect(page.getByTestId("property-work-order-recipient-summary")).toContainText("3 selected recipients");
  await page.getByTestId("property-work-order-continue-finalize").click();
  await expect(page.getByTestId("property-work-order-selected-recipients")).toContainText("Pipe Pros");
  await expect(page.getByTestId("property-work-order-selected-recipients")).toContainText("Joe's Plumbing");
  await expect(page.getByTestId("property-work-order-selected-recipients")).toContainText("SMS available");
  await expect(page.getByTestId("property-work-order-selected-recipients")).not.toContainText("invitation sending for those recipients is not enabled yet");
  await expect(page.getByTestId("property-work-order-save-send-marketplace")).toBeEnabled();
  await page.getByTestId("property-work-order-back").click();
  await page.getByTestId("property-work-order-select-vendor-701").uncheck();
  await page.getByTestId("property-work-order-select-local-business-local-joe-plumbing").uncheck();
  await expect(page.getByTestId("property-work-order-recipient-summary")).toContainText("1 selected recipient");
  await page.getByTestId("property-work-order-continue-finalize").click();
  await expect(page.getByTestId("property-work-order-selected-recipients")).toContainText("ABC Plumbing");
  await expect(page.getByTestId("property-work-order-selected-recipients")).toContainText("Marketplace opportunity");
  await expect(page.getByTestId("property-work-order-save-send-marketplace")).toBeEnabled();
  await page.getByTestId("property-work-order-save-send-marketplace").click();
  await expect(page.getByTestId("property-work-order-modal")).toHaveCount(0);
  expect(submittedWorkOrderEditPayload).toMatchObject({
    assignment_type: "marketplace_contractor",
  });
  expect(submittedMarketplacePayload).toMatchObject({
    directory_entry_ids: [7701],
    recipients: [
      expect.objectContaining({
        source: "myhomebro_contractor",
        directory_entry_id: 7701,
      }),
    ],
  });
  await expect(page.getByTestId("property-work-order-901")).toContainText("Marketplace Contractor");
  await expect(page.getByTestId("property-work-order-901")).toContainText("Ready to send to marketplace contractors");
  await expect(page.getByTestId("property-work-order-901")).toContainText("Sent");
  await expect(page.getByTestId("property-work-order-recipient-summary-901")).toContainText("1 sent");
  await expect(page.getByTestId("property-work-order-recipient-list-901")).toContainText("ABC Plumbing");
  await expect(page.getByTestId("property-work-order-timeline-901")).toContainText("Marketplace Sent");
  await page.getByTestId("property-work-order-withdraw-marketplace-901").click();
  await expect(page.getByTestId("property-work-order-901")).toContainText("Withdrawn");
  await expect(page.getByTestId("property-work-order-timeline-901")).toContainText("Marketplace Withdrawn");
  await page.getByTestId("property-work-order-filter-all").click();
  await expect(page.getByTestId("property-work-order-901")).toContainText("Closed");
  await expect(page.getByTestId("property-work-order-903")).toContainText("Accepted marketplace repair");
  await expect(page.getByTestId("property-work-order-903")).toContainText("ABC Plumbing");
  await expect(page.getByTestId("property-work-order-903")).toContainText("Agreement:");
  await expect(page.getByTestId("property-work-order-actions-903")).toContainText("Create Agreement Draft");
  await page.getByTestId("property-work-order-create-agreement-903").click();
  await expect(page.getByTestId("property-work-order-actions-903")).toContainText("Open Agreement Draft");
  await expect(page.getByTestId("property-work-order-open-agreement-903")).toHaveAttribute("href", "/app/agreements/3303/wizard?step=1");
  await expect(page.getByTestId("property-work-order-timeline-903")).toContainText("Agreement Draft Created");

  await page.getByTestId("property-work-order-add").evaluate((element) => element.click());
  await expect(page.getByTestId("property-work-order-modal")).toBeVisible();
  await expect(page.getByTestId("property-work-order-unit")).toContainText("Unit 101");
  await expect(page.getByTestId("property-work-order-tenant")).toContainText("Taylor Resident");
  await expect(page.getByTestId("property-work-order-assignment-type")).toHaveValue("internal_staff");
  await page.getByTestId("property-work-order-title").fill("Seasonal HVAC follow-up");
  await page.getByTestId("property-work-order-description").fill("Schedule HVAC service for the rental unit.");
  await page.getByTestId("property-work-order-category").selectOption("hvac");
  await page.getByTestId("property-work-order-priority").selectOption("normal");
  await page.getByTestId("property-work-order-status").selectOption("scheduled");
  await page.getByTestId("property-work-order-unit").selectOption("601");
  await page.getByTestId("property-work-order-tenant").selectOption("801");
  await page.getByTestId("property-work-order-continue-contractors").click();
  await expect(page.getByTestId("property-work-order-staff")).toBeVisible();
  await page.getByTestId("property-work-order-staff").selectOption("502");
  await page.getByTestId("property-work-order-scheduled").fill("2026-06-20T10:30");
  await page.getByTestId("property-work-order-internal-notes").fill("Use tenant text thread for scheduling.");
  await page.getByTestId("property-work-order-save").click();
  await expect(page.getByTestId("property-work-order-modal")).toHaveCount(0);
  expect(submittedWorkOrderPayload).toMatchObject({
    title: "Seasonal HVAC follow-up",
    description: "Schedule HVAC service for the rental unit.",
    category: "hvac",
    priority: "normal",
    status: "scheduled",
    assignment_type: "internal_staff",
    unit_id: 601,
    tenant_id: 801,
    assigned_staff_member_id: 502,
    scheduled_for: "2026-06-20T10:30",
    internal_notes: "Use tenant text thread for scheduling.",
  });
  await expect(page.getByTestId("property-work-order-902")).toContainText("Seasonal HVAC follow-up");
  await expect(page.getByTestId("property-work-order-902")).toContainText("Unit 101");
  await expect(page.getByTestId("property-work-order-902")).toContainText("Sam Supervisor");
  await expect(page.getByTestId("property-work-order-902")).toContainText("Scheduled");
  await page.getByTestId("property-work-order-edit-902").click();
  await expect(page.getByTestId("property-work-order-modal")).toBeVisible();
  await page.getByTestId("property-work-order-assignment-type").selectOption("vendor");
  await page.getByTestId("property-work-order-continue-contractors").click();
  await expect(page.getByTestId("property-work-order-vendor-panel")).toContainText("Select Saved Vendor");
  await expect(page.getByTestId("property-work-order-vendor-panel")).toContainText("Enter Vendor Manually");
  await page.getByTestId("property-work-order-vendor-mode-manual").click();
  await expect(page.getByTestId("property-work-order-manual-vendor-form")).toBeVisible();
  await page.getByTestId("property-work-order-manual-vendor-name").fill("Rapid Rooter");
  await page.getByTestId("property-work-order-manual-vendor-trade").fill("Plumbing");
  await page.getByTestId("property-work-order-manual-vendor-contact").fill("Riley Dispatcher");
  await page.getByTestId("property-work-order-manual-vendor-email").fill("dispatch@rapidrooter.example");
  await page.getByTestId("property-work-order-manual-vendor-phone").fill("210-555-9191");
  await page.getByTestId("property-work-order-manual-vendor-website").fill("https://rapidrooter.example");
  await page.getByTestId("property-work-order-manual-vendor-notes").fill("Available after hours.");
  await expect(page.getByTestId("property-work-order-continue-finalize")).toBeEnabled();
  await page.getByTestId("property-work-order-continue-finalize").click();
  await expect(page.getByTestId("property-work-order-selected-recipients")).toContainText("Rapid Rooter");
  await expect(page.getByTestId("property-work-order-selected-recipients")).toContainText("Email available");
  await expect(page.getByTestId("property-work-order-selected-recipients")).toContainText("SMS available");
  await expect(page.getByTestId("property-work-order-send-manual-vendor")).toBeEnabled();
  await page.getByTestId("property-work-order-send-manual-vendor").click();
  await expect(page.getByTestId("property-work-order-modal")).toHaveCount(0);
  expect(submittedMarketplacePayload).toMatchObject({
    recipients: [
      expect.objectContaining({
        source: "manual_vendor",
        name: "Rapid Rooter",
        email: "dispatch@rapidrooter.example",
        phone: "210-555-9191",
        save_as_vendor: true,
      }),
    ],
  });
  await expect(page.getByTestId("property-work-order-recipient-list-902")).toContainText("Rapid Rooter");
  await expect(page.getByTestId("property-work-order-recipient-list-902")).toContainText("Manual Vendor");
  await expect(page.getByTestId("customer-notifications-panel")).toHaveCount(0);
  await page.getByTestId("customer-dashboard-tab-requests").click();
  await expect(page.getByTestId("customer-request-create-panel")).toBeVisible();
  await expect(page.getByTestId("customer-request-create-panel")).toContainText("Tell us what you need help with next");
  await expect(page.getByRole("heading", { name: "Project & Service Requests" })).toBeVisible();
  await expect(page.getByText("Use Requests to tell us what you need help with next.")).toBeVisible();
  await expect(page.getByText("up to 5 marketplace contractors")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contractor Responses" })).toBeVisible();
  await expect(page.getByText("Bids appear after a request is routed or a contractor submits a response.")).toBeVisible();
  await expect(page.getByText("Create a Request")).toBeVisible();
  await expect(page.getByLabel("Describe what you need help with")).toBeVisible();
  await expect(page.getByText("Tell us what's going on in your own words. MyHomeBro can help organize it before you submit.")).toBeVisible();
  await expect(page.getByText("Choose the property this request is for.")).toBeVisible();
  await expect(page.getByTestId("customer-request-property-selector")).toBeVisible();
  await page.getByTestId("customer-request-property-selector").selectOption("2");
  await expect(page.getByTestId("customer-request-property-summary")).toContainText("Lake House");
  await expect(page.getByTestId("customer-request-property-summary")).toContainText("44 Lake Dr");
  await page.getByTestId("customer-request-property-selector").selectOption("3");
  await expect(page.getByTestId("customer-request-property-summary")).toContainText("88 Pine St, Austin, TX, 78704");
  const duplicateAddressSummaryText = await page.getByTestId("customer-request-property-summary").innerText();
  expect((duplicateAddressSummaryText.match(/88 Pine St, Austin, TX, 78704/g) || []).length).toBe(1);
  await page.getByTestId("customer-request-property-selector").selectOption("2");
  await expect(page.getByTestId("customer-request-property-summary")).toContainText("Lake House");
  await expect(page.getByTestId("customer-request-property-summary")).toContainText("44 Lake Dr");
  await expect(page.getByTestId("customer-request-address-fields")).toHaveCount(0);
  await expect(page.getByTestId("customer-request-address-autocomplete")).toHaveCount(0);
  await page.getByTestId("customer-request-property-selector").selectOption("__new_property__");
  await expect(page.getByTestId("customer-request-address-fields")).toBeVisible();
  await expect(page.getByTestId("customer-request-address-autocomplete").locator("input")).toHaveValue("");
  await page.getByTestId("customer-request-address-autocomplete").locator("input").fill("1515 South Ellison");
  await expect(page.getByTestId("address-autocomplete-suggestions")).toContainText("1515 South Ellison Drive");
  await page.getByTestId("address-autocomplete-suggestions").getByRole("button", { name: /1515 South Ellison Drive/ }).click();
  await expect(page.getByTestId("customer-request-address-autocomplete").locator("input")).toHaveValue("1515 South Ellison Drive");
  await page.getByTestId("customer-request-property-selector").selectOption("2");
  await expect(page.getByTestId("customer-request-address-fields")).toHaveCount(0);
  await expect(page.getByLabel("Project Mode")).toBeVisible();
  await expect(page.getByLabel("Project Type")).toBeVisible();
  await expect(page.getByLabel("Project Subtype")).toBeVisible();
  await expect(page.getByLabel("Payment Preference")).toBeVisible();
  await page.getByLabel("Project Title").last().fill("Seasonal HVAC service");
  await page.getByLabel("Project Type").fill("HVAC");
  await page.getByLabel("Project Subtype").fill("Seasonal Service");
  await page.getByLabel("Payment Preference").selectOption("escrow_milestones");
  await page.getByLabel("Timeline").selectOption("As soon as possible");
  await page.getByLabel("Describe what you need help with").fill("Please inspect the system before summer.");
  await page.getByTestId("customer-request-improve-button").click();
  await expect(page.getByTestId("customer-request-ai-suggestion")).toContainText("Review AI suggestion before submitting");
  await expect(page.getByTestId("customer-request-ai-suggestion")).toContainText("Original homeowner description");
  await expect(page.getByTestId("customer-request-ai-suggestion")).toContainText("Project Type");
  await expect(page.getByTestId("customer-request-ai-suggestion")).toContainText("Project Subtype");
  await expect(page.getByTestId("customer-request-ai-suggestion")).toContainText("Suggested documents or photos");
  await expect(page.getByTestId("customer-request-ai-suggestion-text")).toHaveValue(/Inspect the HVAC system/);
  await page.getByTestId("customer-request-use-ai-suggestion").click();
  await expect(page.getByLabel("Describe what you need help with")).toHaveValue(/Document any recommended follow-up service/);
  await page.getByRole("button", { name: "Create Request" }).click();
  await expect.poll(() => String(submittedRequestPayload?.property_id || "")).toBe("2");
  await expect(submittedRequestPayload?.project_title).toBe("Seasonal HVAC maintenance");
  await expect(submittedRequestPayload?.project_scope).toMatch(/Document any recommended follow-up service/);
  await expect(submittedRequestPayload?.project_type).toBe("HVAC");
  await expect(submittedRequestPayload?.project_subtype).toBe("Seasonal Service");
  await expect(submittedRequestPayload?.preferred_timeline).toBe("As soon as possible");
  await expect(submittedRequestPayload?.payment_preference).toBe("escrow_milestones");
  await expect(page.getByTestId("customer-portal-requests")).toContainText("Seasonal HVAC maintenance");
  await expect(page.getByTestId("customer-request-badges-customer-request-9")).toContainText("HVAC");
  await expect(page.getByTestId("customer-request-badges-customer-request-9")).toContainText("Reviewing Request");
  await expect(page.getByTestId("customer-request-badges-customer-request-9")).toContainText("Editable until sent");
  await expect(page.getByTestId("customer-request-actions-customer-request-9")).toContainText("View Request");
  await expect(page.getByTestId("customer-request-actions-customer-request-9")).toContainText("Edit Request");
  await expect(page.getByTestId("customer-request-actions-customer-request-9")).toContainText("Find Contractor");
  await expect(page.getByTestId("customer-request-actions-customer-request-9")).toContainText("Cancel Request");
  await expect(page.getByTestId("customer-request-actions-customer-request-9")).toContainText("Delete Request");
  await expect(page.getByTestId("customer-request-card-customer-request-9").getByRole("button", { name: "HVAC" })).toHaveCount(0);
  await expect(page.getByTestId("customer-request-card-customer-request-9").getByRole("button", { name: "Reviewing Request" })).toHaveCount(0);
  await expect(page.getByTestId("customer-request-card-customer-request-9").getByRole("button", { name: "Editable until sent" })).toHaveCount(0);
  await page.getByTestId("customer-dashboard-tab-property").click();
  if ((await page.getByTestId("home-records-timeline-collapsed-summary").count()) > 0) {
    await page.getByTestId("home-records-timeline-toggle").click();
  }
  await expect(page.getByTestId("home-records-timeline-action-request-customer-request-9")).toBeVisible();
  await expect(page.getByTestId("home-records-timeline-action-request-customer-request-9")).toContainText("View request");
  await expect(page.getByTestId("home-records-timeline-action-request-customer-request-9")).toHaveAttribute("aria-label", "View request for Seasonal HVAC maintenance");
  await page.getByTestId("home-records-timeline-action-request-customer-request-9").click();
  await expect(page.getByTestId("customer-dashboard-tab-requests")).toHaveClass(/border-amber/);
  await expect(page.getByTestId("customer-request-detail-modal")).toContainText("Seasonal HVAC maintenance");
  await expect(page.getByTestId("customer-request-detail-modal")).toContainText("Request Details");
  await page.getByRole("button", { name: "Close request details" }).click();
  await page.getByTestId("customer-request-delete-customer-request-9").click();
  await expect(page.getByTestId("customer-request-delete-modal")).toBeVisible();
  await page.getByRole("button", { name: "Keep Request" }).click();
  await expect(page.getByTestId("customer-request-delete-modal")).toHaveCount(0);
  await page.getByTestId("customer-request-find-contractor-customer-request-9").click();
  await expect(page.getByTestId("customer-request-contractor-search-modal")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Find a Contractor" })).toBeVisible();
  await expect(page.getByTestId("customer-request-contractor-search-panel")).toContainText("Seasonal HVAC maintenance");
  await expect(page.getByTestId("customer-request-contractor-search-panel")).toContainText("HVAC");
  await expect(page.getByTestId("public-intake-contractor-discovery-step")).toBeVisible();
  await expect(page.getByTestId("public-intake-contractor-results-list")).toContainText("Austin HVAC Pros");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("customer-request-contractor-search-modal")).toHaveCount(0);
  await page.getByTestId("customer-request-find-contractor-customer-request-9").click();
  await expect(page.getByTestId("customer-request-contractor-search-modal")).toBeVisible();
  await page.getByTestId("public-intake-contractor-select-directory:17").click();
  await expect(page.getByTestId("customer-request-route-contractors")).toBeEnabled();
  await page.getByTestId("customer-request-route-contractors").click();
  await expect(page.getByTestId("customer-request-contractor-search-modal")).toHaveCount(0);
  await expect(page.getByTestId("customer-request-card-customer-request-9")).toContainText("Sent to 1 Contractor");
  await expect(page.getByTestId("customer-request-actions-customer-request-9")).not.toContainText("Delete Request");
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
  await expect(page.getByTestId("customer-request-detail-selected-contractor")).toContainText("Austin HVAC Pros");
  await expect(page.getByTestId("customer-request-detail-activity")).toContainText("Request saved");
  await page.getByRole("button", { name: "Close request details" }).click();
  await page.getByTestId("customer-request-cancel-customer-request-9").click();
  await expect(page.getByTestId("customer-request-cancel-modal")).toBeVisible();
  await page.getByTestId("customer-request-confirm-cancel").click();
  await expect(page.getByTestId("customer-request-card-customer-request-9")).toContainText("Cancelled");
  await page.getByTestId("customer-request-view-customer-request-9").click();
  await expect(page.getByTestId("customer-request-cancelled-banner")).toContainText("This request was cancelled.");
  await expect(page.getByTestId("customer-request-detail-activity")).toContainText("Request cancelled");
  await page.getByRole("button", { name: "Close request details" }).click();
  await expect(page.getByTestId("customer-portal-requests")).toContainText("Kitchen Remodel");
  await expect(page.getByTestId("customer-request-card-request-1")).toContainText("Agreement Draft Created");
  await expect(page.getByTestId("customer-request-card-request-1")).toContainText("Converted to project agreement");
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
  await expect(page.getByTestId("customer-projects-layout")).toHaveClass(/xl:grid-cols-\[minmax\(280px,0\.72fr\)_minmax\(0,1\.7fr\)\]/);
  await expect(page.getByTestId("customer-selected-agreement-summary")).toContainText("Selected agreement");
  await expect(page.getByTestId("customer-selected-agreement-summary")).toContainText("Kitchen Remodel");
  await expect(page.getByTestId("customer-project-detail-layout")).toHaveClass(/space-y-4/);
  await expect(page.getByTestId("customer-project-detail-primary")).toBeVisible();
  await expect(page.getByTestId("customer-project-detail-financial-summary")).toHaveCount(0);
  await expect(page.getByTestId("customer-project-detail-layout")).not.toContainText("Financial Summary");
  await expect(page.getByTestId("customer-project-detail-layout")).not.toContainText("Project money");
  const projectDetailMetrics = await page.evaluate(() => {
    const workspace = document.querySelector('[data-testid="customer-project-workspace"]')?.getBoundingClientRect();
    const details = document.querySelector('[data-testid="customer-project-detail-layout"]')?.getBoundingClientRect();
    const summary = document.querySelector('[data-testid="customer-selected-agreement-summary"]');
    const summaryBox = summary?.getBoundingClientRect();
    const actionPanels = document.querySelector('[data-testid="customer-selected-action-panels"]');
    const actionBox = actionPanels?.getBoundingClientRect();
    const primary = document.querySelector('[data-testid="customer-project-detail-primary"]')?.getBoundingClientRect();
    const projectRow = document.querySelector('[data-testid="customer-projects-layout"]')?.getBoundingClientRect();
    return {
      workspaceWidth: workspace?.width || 0,
      detailsWidth: details?.width || 0,
      detailsTop: details?.top || 0,
      projectRowBottom: projectRow?.bottom || 0,
      summaryLeft: summaryBox?.left || 0,
      summaryBottom: summaryBox?.bottom || 0,
      actionLeft: actionBox?.left || 0,
      actionTop: actionBox?.top || 0,
      actionBottom: actionBox?.bottom || 0,
      primaryWidth: primary?.width || 0,
      primaryLeft: primary?.left || 0,
      primaryTop: primary?.top || 0,
      summaryContainsDetails: Boolean(summary && details && summary.contains(document.querySelector('[data-testid="customer-project-detail-layout"]'))),
      detailsContainActionPanels: Boolean(details && actionPanels && document.querySelector('[data-testid="customer-project-detail-layout"]').contains(actionPanels)),
    };
  });
  expect(projectDetailMetrics.detailsWidth).toBeGreaterThan(projectDetailMetrics.workspaceWidth * 0.9);
  expect(projectDetailMetrics.detailsTop).toBeGreaterThanOrEqual(projectDetailMetrics.projectRowBottom - 1);
  expect(Math.abs(projectDetailMetrics.actionLeft - projectDetailMetrics.summaryLeft)).toBeLessThan(8);
  expect(projectDetailMetrics.actionTop).toBeGreaterThanOrEqual(projectDetailMetrics.summaryBottom - 1);
  expect(projectDetailMetrics.detailsTop).toBeGreaterThanOrEqual(projectDetailMetrics.actionBottom - 1);
  expect(projectDetailMetrics.primaryWidth).toBeGreaterThan(projectDetailMetrics.detailsWidth * 0.9);
  expect(projectDetailMetrics.summaryContainsDetails).toBe(false);
  expect(projectDetailMetrics.detailsContainActionPanels).toBe(false);
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
  await expect(page.getByTestId("customer-project-expanded-detail-grid")).toHaveClass(/lg:grid-cols-2/);
  await expect(page.getByTestId("customer-project-payments")).toContainText("Invoice & Payment History");
  await expect(page.getByTestId("customer-project-payments")).toContainText("Release Paid");
  await expect(page.getByTestId("customer-project-payments")).toContainText("Paid to contractor from escrow");
  await expect(page.getByTestId("customer-project-payments")).not.toContainText("Escrow Funding");
  await expect(page.getByTestId("customer-project-escrow-history")).toHaveCount(0);
  await expect(page.getByTestId("customer-rich-project-workspace")).not.toContainText("Balance ledger");
  await expect(page.getByTestId("customer-project-documents")).toContainText("Scope Addendum");
  await expect(page.getByTestId("customer-project-agreement-summary")).toContainText("One-year workmanship warranty");
  await expect(page.getByTestId("customer-project-suggested-materials")).toContainText("Suggested Materials");
  await expect(page.getByTestId("customer-project-suggested-materials")).toContainText("Dust barriers");
  await expect(page.getByTestId("customer-project-suggested-materials")).toContainText("Temporary dust-control protection.");
  await expect(page.getByTestId("customer-project-suggested-materials-notice")).toContainText("Confirm size, quantity, finish, model, and compatibility");
  await expect(page.getByTestId("customer-project-suggested-material-card").first()).not.toContainText("Confirm exact product");
  await expect(page.getByTestId("customer-project-suggested-materials")).not.toContainText("Suggested from saved milestone material guidance.");
  await expect(page.getByTestId("customer-project-suggested-materials")).not.toContainText("material guidance");
  await expect(page.getByTestId("customer-project-suggested-materials")).not.toContainText("materials_hint");
  await expect(page.getByTestId("customer-project-suggested-materials")).not.toContainText("Confidence");
  await expect(page.getByTestId("customer-project-suggested-materials")).not.toContainText("Source");
  await expect(page.getByTestId("customer-project-suggested-material-amazon")).toHaveAttribute("href", /amazon\.com\/s\?/);
  await expect(page.getByTestId("customer-project-suggested-material-amazon")).toHaveAttribute("href", /tag=myhomebro-test-20/);
  await expect(page.getByTestId("customer-project-suggested-material-amazon").first()).toContainText("Amazon");
  await expect(page.getByTestId("customer-project-updates")).toContainText("Demo is complete and final walkthrough is ready for review.");
  const expandedGridMetrics = await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="customer-project-expanded-detail-grid"]')?.getBoundingClientRect();
    const updates = document.querySelector('[data-testid="customer-project-updates"]')?.getBoundingClientRect();
    const materials = document.querySelector('[data-testid="customer-project-suggested-materials"]')?.getBoundingClientRect();
    const payments = document.querySelector('[data-testid="customer-project-payments"]')?.getBoundingClientRect();
    const documents = document.querySelector('[data-testid="customer-project-documents"]')?.getBoundingClientRect();
    const agreement = document.querySelector('[data-testid="customer-project-agreement-summary"]')?.getBoundingClientRect();
    return {
      gridWidth: grid?.width || 0,
      updatesLeft: updates?.left || 0,
      updatesTop: updates?.top || 0,
      updatesWidth: updates?.width || 0,
      materialsLeft: materials?.left || 0,
      materialsTop: materials?.top || 0,
      paymentsLeft: payments?.left || 0,
      paymentsTop: payments?.top || 0,
      documentsLeft: documents?.left || 0,
      documentsTop: documents?.top || 0,
      agreementLeft: agreement?.left || 0,
      agreementTop: agreement?.top || 0,
    };
  });
  expect(expandedGridMetrics.updatesWidth).toBeLessThan(expandedGridMetrics.gridWidth * 0.7);
  expect(expandedGridMetrics.materialsLeft).toBeGreaterThan(expandedGridMetrics.updatesLeft);
  expect(Math.abs(expandedGridMetrics.materialsTop - expandedGridMetrics.updatesTop)).toBeLessThan(8);
  expect(expandedGridMetrics.paymentsTop).toBeGreaterThan(expandedGridMetrics.updatesTop);
  expect(expandedGridMetrics.documentsLeft).toBeGreaterThan(expandedGridMetrics.paymentsLeft);
  expect(Math.abs(expandedGridMetrics.documentsTop - expandedGridMetrics.paymentsTop)).toBeLessThan(8);
  expect(expandedGridMetrics.agreementTop).toBeGreaterThan(expandedGridMetrics.paymentsTop);

  await page.getByTestId("customer-dashboard-tab-payments").click();
  await expect(page.getByTestId("customer-portal-payments")).toContainText("Project Payment Center");
  await expect(page.getByTestId("customer-payments-escrow-summary")).toContainText("Escrow Summary");
  await expect(page.getByTestId("customer-payments-escrow-summary")).toContainText("Escrow History shows how the escrow balance changed");
  await expect(page.getByTestId("customer-payments-summary")).toContainText("Direct Payments");
  await expect(page.getByTestId("customer-payments-summary")).toContainText("Pending Review");
  await expect(page.getByTestId("customer-payments-summary")).toContainText("Released to Contractor");
  await expect(page.getByTestId("customer-payments-agreement-list")).toContainText("Payments by project");
  await expect(page.getByTestId("customer-payment-agreement-detail")).toContainText("Project Financial Summary");
  await expect(page.getByTestId("customer-payment-agreement-detail")).toContainText("Remaining Project Value");
  await expect(page.getByTestId("customer-payment-agreement-detail")).toContainText("Invoice & Payment History");
  await expect(page.getByTestId("customer-payment-agreement-detail")).toContainText("Total Paid To Date");
  await expect(page.getByTestId("customer-payment-agreement-detail")).toContainText("Escrow History");
  await expect(page.getByTestId("customer-payment-agreement-detail")).toContainText("Current Escrow Balance");
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
  await expect(page.getByTestId("customer-payment-history").getByTestId("customer-payment-action-invoice-1")).toContainText("View Record");
  await page.getByTestId("customer-payments-history-toggle").click();
  await expect(page.getByTestId("customer-payment-history-collapsed-summary")).toContainText("records hidden");
  await expect(page.getByTestId("customer-payment-history")).toHaveCount(0);
  await page.getByTestId("customer-payments-history-toggle").click();
  await expect(page.getByTestId("customer-payment-history").getByTestId("customer-payment-action-invoice-1")).toContainText("View Record");
  await page.getByTestId("customer-escrow-history-toggle").click();
  await expect(page.getByTestId("customer-escrow-history-collapsed-summary")).toContainText("escrow records hidden");
  await expect(page.getByTestId("customer-escrow-history")).toHaveCount(0);
  await page.getByTestId("customer-escrow-history-toggle").click();
  await expect(page.getByTestId("customer-escrow-history")).toBeVisible();
  await expect(page.getByTestId("customer-payment-action-invoice-zero")).toHaveCount(0);
  await expect(page.getByTestId("customer-portal-payments")).not.toContainText("$0.00");
  await expect(page.getByTestId("customer-portal-payments")).not.toContainText("No payment required");
  await expect(page.getByTestId("customer-portal-payments")).not.toContainText("Escrow balance reduced");

  await page.getByTestId("customer-dashboard-tab-overview").click();
  await expect(page.getByTestId("customer-dashboard-overview")).toContainText("Open issue for Kitchen Remodel");
  await expect(page.getByTestId("customer-dashboard-overview")).not.toContainText("$0.00 - Approved");

  await page.getByTestId("customer-dashboard-tab-notifications").click();
  await expect(page.getByTestId("customer-notifications-center")).toContainText("Notifications Center");
  await page.getByTestId("customer-notifications-filter-recent").click();
  await expect(page.getByTestId("customer-notifications-center")).toContainText("Agreement needs signature");
  await expect(page.getByTestId("customer-notifications-center")).toContainText("Payment received");
  await expect(page.getByTestId("customer-notifications-center").getByRole("heading", { name: "Payment received" })).toHaveCount(1);
  await expect(page.getByTestId("customer-notifications-center")).not.toContainText("Internal payment email row");

  await page.getByTestId("customer-dashboard-tab-documents").click();
  await expect(page.getByTestId("customer-portal-documents")).toContainText("Home Document Vault");
  await expect(page.getByTestId("customer-documents-vault-controls")).toBeVisible();
  await expect(page.getByTestId("customer-portal-documents")).toContainText("Invoices & Receipts");
  await expect(page.getByTestId("customer-portal-documents")).toContainText("Other");
  await expect(page.getByTestId("customer-portal-documents")).toContainText("Scope Addendum");
  await expect(page.getByTestId("customer-portal-documents")).toContainText("scope-addendum.txt");
  await page.getByTestId("customer-documents-category-filter").selectOption("Warranties");
  await expect(page.getByTestId("customer-portal-documents")).toContainText("Roof warranty");
  await expect(page.getByTestId("customer-portal-documents")).not.toContainText("Scope Addendum");
  await page.getByTestId("customer-documents-category-filter").selectOption("All");
  await page.getByTestId("customer-documents-search").fill("scope");
  await expect(page.getByTestId("customer-portal-documents")).toContainText("Scope Addendum");
  await expect(page.getByTestId("customer-portal-documents")).not.toContainText("Roof warranty");
  await page.getByTestId("customer-documents-search").fill("");
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

  const predictionInputsBeforePropertyTab = await page.evaluate(
    () => window.__mhbPlacePredictionInputs?.length || 0
  );
  await page.getByTestId("customer-dashboard-tab-property").click();
  await expect(page.getByTestId("property-command-summary")).toContainText("Property Summary");
  await expect(page.getByTestId("property-command-summary")).toContainText("Kitchen Remodel");
  await expect(page.getByTestId("property-command-summary")).toContainText("123 Main St, Austin, TX, 78701");
  await expect(page.getByTestId("property-command-summary")).toContainText("1998");
  await expect(page.getByTestId("property-command-summary")).toContainText("2,400");
  await expect(page.getByTestId("property-command-summary")).toContainText("3");
  await expect(page.getByTestId("property-command-summary")).toContainText("2.5");
  await expect(page.getByTestId("property-command-summary")).not.toContainText("Lot Size");
  await expect(page.getByTestId("property-command-summary")).not.toContainText("Occupancy");
  await expect(page.getByTestId("property-summary-details")).toBeVisible();
  await page.getByTestId("property-summary-details-toggle").click();
  await expect(page.getByTestId("property-summary-details-collapsed")).toContainText("Single Family");
  await expect(page.getByTestId("property-summary-details")).toHaveCount(0);
  await expect(page.getByTestId("property-command-summary")).toContainText("Kitchen Remodel");
  await expect(page.getByTestId("property-summary-edit")).toBeVisible();
  await page.getByTestId("property-summary-details-toggle").click();
  await expect(page.getByTestId("property-summary-details")).toContainText("1998");
  await expect(page.getByTestId("property-summary-selector")).toBeVisible();
  await expect(page.getByTestId("property-profile-fields")).toBeVisible();
  await page.getByTestId("property-profile-form-toggle").click();
  await expect(page.getByTestId("property-profile-collapsed-summary")).toContainText("Kitchen Remodel");
  await expect(page.getByTestId("property-profile-collapsed-summary")).toContainText("123 Main St, Austin, TX, 78701");
  await expect(page.getByTestId("property-profile-collapsed-summary")).toContainText("Single Family");
  await expect(page.getByTestId("property-profile-fields")).toHaveCount(0);
  await expect(page.getByLabel("Year built")).toHaveCount(0);
  await page.getByTestId("property-profile-form-toggle").click();
  await expect(page.getByTestId("property-profile-fields")).toBeVisible();
  await expect(page.getByLabel("Year built")).toBeVisible();
  await expect(page.getByTestId("customer-property-address-autocomplete").locator("input")).toHaveClass(/text-white/);
  await expect(page.getByTestId("customer-property-address-autocomplete").locator("input")).toHaveClass(/placeholder:text-slate-400/);
  await page.waitForTimeout(350);
  await expect(page.getByTestId("address-autocomplete-suggestions")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.__mhbPlacePredictionInputs || []))
    .toHaveLength(predictionInputsBeforePropertyTab);
  await page.getByTestId("property-summary-edit").click();
  const propertyAddressSearch = page.getByTestId("customer-property-address-autocomplete").locator("input");
  await propertyAddressSearch.fill("1515 South Ellison");
  await expect(page.getByTestId("address-autocomplete-suggestions")).toContainText("1515 South Ellison Drive");
  await page.getByTestId("address-autocomplete-suggestions").getByRole("button", { name: /1515 South Ellison Drive/ }).click();
  await expect(page.getByTestId("address-autocomplete-suggestions")).toHaveCount(0);
  await page.waitForTimeout(350);
  await expect(page.getByTestId("address-autocomplete-suggestions")).toHaveCount(0);
  await expect(page.getByLabel("Street")).toHaveValue("1515 South Ellison Drive");
  await expect(page.getByLabel("City")).toHaveValue("San Antonio");
  await expect(page.getByLabel("State")).toHaveValue("TX");
  await expect(page.getByLabel("ZIP")).toHaveValue("78245");
  await page.getByTestId("customer-property-address-autocomplete").getByLabel("Clear address search").click();
  await expect(propertyAddressSearch).toHaveValue("");
  await page.getByLabel("Bedrooms").fill("4");
  await page.getByLabel("Bathrooms").fill("3.5");
  await page.getByRole("button", { name: "Save property profile" }).click();
  await expect(page.getByRole("button", { name: "Save property profile" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("property-command-summary")).toContainText("4");
  await expect(page.getByTestId("property-command-summary")).toContainText("3.5", { timeout: 15000 });
  await expect(page.getByTestId("property-home-systems")).toContainText("Home Systems");
  await expect(page.getByTestId("property-home-systems-list")).toBeVisible();
  await expect(page.getByTestId("property-home-systems")).toContainText("Main HVAC");
  await expect(page.getByTestId("property-home-systems")).toContainText("Carrier");
  await page.getByTestId("property-home-system-search").fill("dryer");
  await expect(page.getByTestId("property-home-systems")).toContainText("Laundry Dryer");
  await expect(page.getByTestId("property-home-systems")).not.toContainText("Main HVAC");
  await page.getByTestId("property-home-system-search").fill("");
  await page.getByTestId("property-home-system-filter").selectOption("service_requested");
  await expect(page.getByTestId("property-home-systems")).toContainText("Main HVAC");
  await expect(page.getByTestId("property-home-systems")).toContainText("Service Requested");
  await expect(page.getByTestId("property-home-systems")).not.toContainText("Laundry Dryer");
  await page.getByTestId("property-home-system-filter").selectOption("all");
  await page.getByTestId("property-home-system-view-grid").click();
  await expect(page.getByTestId("property-home-system-main-hvac")).toBeVisible();
  await page.getByTestId("property-home-system-view-list").click();
  await page.getByTestId("property-home-system-view-11").click();
  await expect(page.getByTestId("property-home-system-details-11")).toContainText("2032");
  await expect(page.getByTestId("property-home-system-recommendation-preview-11")).toContainText("Maintenance");
  await expect(page.getByTestId("property-home-system-recommendation-preview-11")).toContainText("Main HVAC service is overdue");
  await expect(page.getByTestId("property-home-system-recommendation-preview-11")).toContainText("Supplies");
  await expect(page.getByTestId("property-home-system-recommendation-preview-11")).toContainText("1 suggested item");
  await expect(page.getByTestId("property-home-system-recommendation-preview-11")).toContainText("Reminders");
  await page.getByTestId("property-home-system-scan-11").first().click();
  await expect(page.getByTestId("home-system-scan-modal")).toContainText("Scan or upload document");
  await expect(page.getByTestId("home-system-scan-modal")).toContainText("Saving to: Main HVAC");
  await page.getByTestId("home-system-scan-document-type").selectOption("Equipment Label");
  await page.getByTestId("home-system-scan-create-qr").click();
  await expect(page.getByTestId("home-system-scan-qr-panel")).toContainText("Expires");
  await expect(page.getByTestId("home-system-scan-copy-link")).toHaveValue(/\/portal\/upload-session\/scan-session-token/);
  await page.getByTestId("home-system-scan-file").setInputFiles({
    name: "carrier-model-ABC123.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("fake image"),
  });
  await page.getByTestId("home-system-scan-upload").click();
  await expect(page.getByTestId("home-system-scan-saved")).toContainText("File saved");
  await expect(page.getByTestId("home-system-extraction-review")).toContainText("Document Analysis Results");
  await expect(page.getByTestId("home-system-extraction-field-model_number")).toContainText("ABC123");
  await expect(page.getByTestId("home-system-extraction-field-model_number").locator("input")).toBeChecked();
  await expect(page.getByTestId("home-system-extraction-field-serial_number").locator("input")).not.toBeChecked();
  await page.getByTestId("home-system-extraction-apply").click();
  await expect(page.getByTestId("home-system-scan-modal")).toHaveCount(0);
  await expect(page.getByTestId("property-home-system-details-11")).toContainText("ABC123");
  await page.getByTestId("property-home-system-view-12").click();
  await expect(page.getByTestId("property-home-system-recommendation-preview-12")).toContainText("No current recommendations");
  await expect(page.getByTestId("property-home-system-accuracy-prompt-11")).toHaveCount(0);
  await expect(page.getByTestId("property-home-system-accuracy-prompt-12")).toContainText("Improve recommendation accuracy");
  await expect(page.getByTestId("property-home-system-accuracy-prompt-12")).toContainText("Manufacturer");
  await expect(page.getByTestId("property-home-system-accuracy-prompt-12")).toContainText("Model Number");
  await expect(page.getByTestId("property-home-system-accuracy-prompt-12")).toContainText("Notes");
  await expect(page.getByTestId("property-home-system-accuracy-prompt-12")).toContainText("Better system information improves maintenance reminders");
  await page.getByTestId("property-home-system-accuracy-edit-12").click();
  await expect(page.getByTestId("property-home-system-modal")).toContainText("Edit Home System");
  await expect(page.getByTestId("property-home-system-modal").getByLabel("System type")).toHaveValue("appliance");
  await page.getByTestId("property-home-system-modal").getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("property-maintenance-center")).toContainText("Maintenance Center");
  await expect(page.getByTestId("property-maintenance-center")).toContainText("Home upkeep");
  await expect(page.getByTestId("property-maintenance-kpi-needs-attention")).toContainText("View details");
  await expect(page.getByTestId("property-maintenance-kpi-due-soon")).toContainText("Due soon");
  await expect(page.getByTestId("property-maintenance-center")).toContainText("Overdue");
  await expect(page.getByTestId("property-maintenance-center")).toContainText("Main HVAC service is overdue");
  await expect(page.getByTestId("property-maintenance-center")).toContainText("Needs attention");
  await expect(page.getByTestId("property-maintenance-center")).toContainText("Reminder schedule");
  await expect(page.getByTestId("property-maintenance-center")).toContainText("Reminder delivery: Email reminders");
  await expect(page.getByTestId("property-maintenance-lifecycle-11")).toContainText("Service Requested");
  await expect(page.getByTestId("property-maintenance-lifecycle-11")).toContainText("Open the linked request to find or contact a contractor.");
  await expect(page.getByTestId("property-maintenance-center")).not.toContainText("Channels:");
  await expect(page.getByTestId("property-maintenance-center")).not.toContainText("Last reminded");
  await expect(page.getByTestId("property-maintenance-center")).not.toContainText("Confidence");
  await expect(page.getByTestId("property-maintenance-group-overdue")).toBeVisible();
  await page.getByTestId("property-maintenance-kpi-needs-attention").click();
  await expect(page.getByTestId("property-maintenance-group-overdue")).toBeVisible();
  await page.getByTestId("property-maintenance-manage-reminder-11").click();
  await expect(page.getByTestId("property-home-system-modal")).toContainText("Reminder notifications");
  await page.getByTestId("property-home-system-modal").getByRole("button", { name: "Close" }).click();
  await page.getByTestId("property-maintenance-mark-serviced-11").click();
  await expect(page.getByTestId("property-home-system-service-modal")).toContainText("Mark Main HVAC serviced");
  await page.getByTestId("property-home-system-service-modal").getByLabel("Service provider").fill("Austin HVAC");
  await page.getByTestId("property-home-system-service-modal").getByLabel("Notes").fill("Filter replaced.");
  await page.getByTestId("property-home-system-service-modal").getByRole("button", { name: "Mark serviced" }).click();
  await expect(page.getByTestId("property-maintenance-center")).toContainText("Current");
  await expect(page.getByTestId("property-maintenance-center")).toContainText("maintenance appears current");

  await page.getByTestId("property-maintenance-create-request-11").click();
  await expect(page.getByTestId("customer-portal-requests")).toContainText("Main HVAC service request");
  await expect(page.getByTestId("customer-portal-requests")).toContainText("HVAC");
  await page.getByTestId("customer-dashboard-tab-property").click();
  await page.getByTestId("property-home-system-add").click();
  await expect(page.getByTestId("property-home-system-modal")).toContainText("Add Home System");
  await page.getByLabel("System type").selectOption("water_heater");
  await page.getByLabel("Manufacturer").fill("Rheem");
  await page.getByLabel("Model number").fill("WH-200");
  await page.getByLabel("Warranty expiration date").fill("2030-01-10");
  await page.getByLabel("Service provider").fill("Austin Plumbing");
  await page.getByTestId("property-home-system-modal").getByRole("button", { name: "Add system" }).click();
  await expect(page.getByTestId("property-home-systems")).toContainText("Water Heater");
  await expect(page.getByTestId("property-home-systems")).toContainText("Rheem");
  await page.getByTestId("property-home-system-edit-11").click();
  await expect(page.getByTestId("property-home-system-modal")).toContainText("Edit Home System");
  await page.getByLabel("Condition").selectOption("needs_service");
  await page.getByTestId("property-home-system-modal").getByLabel("Notes").fill("Annual service is due.");
  await page.getByTestId("property-home-system-modal").getByRole("button", { name: "Save system" }).click();
  await expect(page.getByTestId("property-home-systems")).toContainText("Needs Service");
  if ((await page.getByTestId("property-home-system-details-11").count()) === 0) {
    await page.getByTestId("property-home-system-view-11").click();
  }
  await expect(page.getByTestId("property-home-system-details-11")).toContainText("Annual service is due.");
  await expect(page.getByTestId("home-records-warranty-center")).toHaveCount(0);
  await page.getByTestId("property-home-system-archive-11").click();
  await expect(page.getByTestId("property-home-systems-empty")).toContainText("No systems recorded yet");
  await expect(page.getByTestId("property-active-work")).toHaveCount(0);
  await expect(page.getByTestId("property-active-project")).toHaveCount(0);
  await expect(page.getByTestId("property-open-request")).toHaveCount(0);
  await expect(page.getByTestId("customer-dashboard-tab-projects")).toBeVisible();
  await expect(page.getByTestId("customer-dashboard-tab-requests")).toBeVisible();
  await expect(page.getByTestId("customer-property-manager")).toContainText("My Properties");
  await expect(page.getByTestId("customer-property-card-1")).toContainText("Primary Property");
  await expect(page.getByTestId("customer-property-card-2")).toContainText("Lake House");
  await page.getByTestId("property-summary-selector").selectOption("2");
  await expect(page.getByLabel("Property name")).toHaveValue("Lake House");
  await page.getByTestId("customer-property-add-button").click();
  await expect(page.getByRole("button", { name: "Add property", exact: true })).toBeVisible();
  if ((await page.getByTestId("home-records-timeline-collapsed-summary").count()) > 0) {
    await page.getByTestId("home-records-timeline-toggle").click();
  }
  await expect(page.getByTestId("home-records-timeline")).toContainText("Kitchen Remodel");
  await expect(page.getByTestId("home-records-warranty-center")).toHaveCount(0);
  await expect(page.getByTestId("property-photo-gallery")).toHaveCount(0);
  await expect(page.getByTestId("home-records-important-documents")).toHaveCount(0);
  await expect(page.getByTestId("home-records-document-groups")).toHaveCount(0);
  await expect(page.getByTestId("home-records-documents-photos")).toHaveCount(0);
  await expect(page.getByTestId("home-records-document-filters")).toHaveCount(0);
  await expect(page.getByTestId("customer-property-upload-form")).toHaveCount(0);
  await expect(page.getByTestId("property-view-documents")).toHaveCount(0);
  await expect(page.getByTestId("customer-property-profile")).not.toContainText("Document library");
  await page.getByTestId("customer-dashboard-tab-documents").click();
  await expect(page.getByTestId("customer-dashboard-tab-documents")).toHaveClass(/border-amber/);
  await page.getByTestId("customer-dashboard-tab-property").click();
  await expect(page.getByTestId("home-records-timeline")).toContainText("Quarterly service visit");

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

test("customer notification preferences save and reminder details show supplies", async ({ page }) => {
  await page.route("**/api/projects/customer-portal/customer-token/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(portalPayload),
    });
  });
  await page.route("**/api/projects/customer-portal/customer-token/notifications/preferences/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(notificationPreferencesUpdatedPortalPayload),
    });
  });
  await page.route("**/api/projects/customer-portal/customer-token/property/systems/11/reminder**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(reminderDetailPayload),
    });
  });

  await page.goto("/portal/customer-token", { waitUntil: "domcontentloaded" });
  await page.getByTestId("customer-dashboard-tab-notifications").click();
  await expect(page.getByTestId("customer-notification-preferences")).toContainText("Notification preferences");
  await expect(page.getByTestId("notification-category-maintenance_due_soon")).toBeChecked();
  await expect(page.getByTestId("notification-channel-email_enabled")).toBeChecked();
  await expect(page.getByTestId("notification-channel-sms_enabled")).not.toBeChecked();
  await expect(page.getByTestId("customer-sms-status-panel")).toContainText("SMS status");
  await expect(page.getByTestId("customer-sms-status-label")).toContainText("No SMS consent on file");
  await expect(page.getByTestId("customer-sms-status-phone")).toContainText("+12105551212");
  await expect(page.getByTestId("customer-sms-quiet-hours")).toContainText("pause overnight");
  await page.getByTestId("notification-category-maintenance_due_soon").uncheck();
  await page.getByTestId("notification-category-recommended_supplies").uncheck();
  await page.getByTestId("notification-channel-email_enabled").uncheck();
  await page.getByTestId("notification-channel-sms_enabled").check();
  await page.getByTestId("notification-preference-frequency").selectOption("weekly_digest");
  await page.getByTestId("notification-preferences-save").click();
  await expect(page.getByTestId("notification-category-maintenance_due_soon")).not.toBeChecked();
  await expect(page.getByTestId("notification-channel-email_enabled")).not.toBeChecked();
  await expect(page.getByTestId("notification-channel-sms_enabled")).toBeChecked();
  await expect(page.getByTestId("notification-preference-frequency")).toHaveValue("weekly_digest");

  await page.getByTestId("customer-notifications-center-item-106").getByRole("link", { name: /Open related item/ }).click();
  await expect(page.getByTestId("customer-reminder-detail-modal")).toContainText("Main HVAC");
  await expect(page.getByTestId("customer-reminder-detail-modal")).toContainText("Recommended Supplies");
  await expect(page.getByTestId("customer-reminder-supply").first()).toContainText("HVAC");
  await expect(page.getByTestId("customer-reminder-retailer-link").first()).toBeVisible();
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

test("tenant maintenance request intake form submits and confirms", async ({ page }) => {
  let submittedPayload = null;
  await page.route("**/api/projects/maintenance-request/public-token/", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          property: {
            id: 1,
            display_name: "Duplex",
          },
          unit: null,
          units: [
            {
              id: 601,
              unit_label: "Unit 101",
              unit_type: "apartment",
              unit_type_label: "Apartment",
              status: "active",
              status_label: "Active",
            },
          ],
          categories: [
            { value: "plumbing", label: "Plumbing" },
            { value: "general_repair", label: "General Repair" },
          ],
          urgencies: [
            { value: "urgent", label: "Urgent" },
            { value: "normal", label: "Normal" },
          ],
        }),
      });
      return;
    }
    if (method === "POST") {
      const rawBody = route.request().postData() || "";
      if ((route.request().headers()["content-type"] || "").includes("multipart/form-data")) {
        submittedPayload = {
          rawBody,
          hasAttachment: rawBody.includes("sink-leak.jpg"),
          hasTitle: rawBody.includes("Kitchen sink leak"),
        };
      } else {
        submittedPayload = JSON.parse(rawBody || "{}");
      }
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          detail: "Maintenance request submitted.",
          request: {
            id: 901,
            reference: "TMR-000901",
            status_url: "/maintenance-request/status/status-token-901",
            status: "submitted",
            status_label: "Submitted",
            title: submittedPayload.title,
          },
        }),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/maintenance-request/public-token", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("tenant-maintenance-form")).toBeVisible();
  await expect(page.getByText("Duplex")).toBeVisible();
  await expect(page.getByTestId("tenant-maintenance-unit")).toContainText("Unit 101");
  await page.getByTestId("tenant-maintenance-name").fill("Taylor Tenant");
  await page.getByTestId("tenant-maintenance-email").fill("taylor@example.com");
  await page.getByTestId("tenant-maintenance-phone").fill("512-555-1111");
  await page.getByTestId("tenant-maintenance-unit").selectOption("601");
  await page.getByTestId("tenant-maintenance-category").selectOption("plumbing");
  await page.getByTestId("tenant-maintenance-urgency").selectOption("urgent");
  await page.getByTestId("tenant-maintenance-title").fill("Kitchen sink leak");
  await page.getByTestId("tenant-maintenance-description").fill("Water is dripping under the kitchen sink.");
  await page.getByTestId("tenant-maintenance-permission").check();
  await page.getByTestId("tenant-maintenance-access-times").fill("Weekday mornings");
  await page.getByTestId("tenant-maintenance-attachments").setInputFiles({
    name: "sink-leak.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("fake-image"),
  });
  await expect(page.getByTestId("tenant-maintenance-selected-files")).toContainText("sink-leak.jpg");
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/projects/maintenance-request/public-token/") &&
      response.request().method() === "POST"
    ),
    page.getByTestId("tenant-maintenance-submit").click(),
  ]);

  expect(submittedPayload).toMatchObject({
    hasAttachment: true,
    hasTitle: true,
  });
  await expect(page.getByTestId("tenant-maintenance-confirmation")).toContainText("Maintenance request submitted.");
  await expect(page.getByTestId("tenant-maintenance-confirmation")).toContainText("TMR-000901");
  await expect(page.getByTestId("tenant-maintenance-status-link")).toHaveAttribute(
    "href",
    "/maintenance-request/status/status-token-901"
  );
});

test("tenant maintenance request verification flow starts from landing and submits with attachment", async ({ page }) => {
  let verifyPayload = null;
  let submittedPayload = null;

  await page.route("**/api/projects/maintenance-request/verify/", async (route) => {
    verifyPayload = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        verification_token: "verified-tenant-token",
        property: {
          id: 1,
          display_name: "Duplex on Main",
          address: "123 Main St, Austin, TX, 78701",
        },
        unit: {
          id: 601,
          unit_label: "Unit A",
          unit_type: "apartment",
          unit_type_label: "Apartment",
          status: "active",
          status_label: "Active",
        },
        property_management_company: {
          id: 44,
          name: "Austin Rentals Group",
          is_active: true,
        },
        units: [],
        categories: [
          { value: "plumbing", label: "Plumbing" },
          { value: "general_repair", label: "General Repair" },
        ],
        urgencies: [
          { value: "urgent", label: "Urgent" },
          { value: "normal", label: "Normal" },
        ],
      }),
    });
  });

  await page.route("**/api/projects/maintenance-request/verified-submit/", async (route) => {
    const rawBody = route.request().postData() || "";
    submittedPayload = {
      rawBody,
      hasAttachment: rawBody.includes("sink-leak.jpg"),
      hasVerificationToken: rawBody.includes("verified-tenant-token"),
      hasTitle: rawBody.includes("Kitchen sink leak"),
    };
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        detail: "Maintenance request submitted.",
        request: {
          id: 902,
          reference: "TMR-000902",
          status_url: "/maintenance-request/status/status-token-902",
          status: "submitted",
          status_label: "Submitted",
          title: "Kitchen sink leak",
        },
      }),
    });
  });

  await page.route("**/api/projects/maintenance-request/status/status-token-902/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reference: "TMR-000902",
        submitted_at: "2026-06-22T15:00:00Z",
        current_status: "submitted",
        status: "submitted",
        status_label: "Submitted",
        title: "Kitchen sink leak",
        category: "plumbing",
        category_label: "Plumbing",
        urgency: "urgent",
        urgency_label: "Urgent",
        property: {
          display_name: "Duplex on Main",
          address: "123 Main St, Austin, TX, 78701",
        },
        unit: {
          unit_label: "Unit A",
          display: "Unit A",
        },
        timeline: [
          {
            label: "Submitted",
            status: "submitted",
            description: "Your request was received.",
            created_at: "2026-06-22T15:00:00Z",
          },
        ],
      }),
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("landing-maintenance-request-button")).toHaveCount(0);
  await page.getByTestId("landing-resident-maintenance-link").click();
  await expect(page).toHaveURL(/\/maintenance-request$/);
  await expect(page.getByTestId("tenant-maintenance-verify-form")).toBeVisible();

  await page.getByTestId("tenant-maintenance-first-name").fill("Taylor");
  await page.getByTestId("tenant-maintenance-last-name").fill("Tenant");
  await page.getByTestId("tenant-maintenance-contact").fill("taylor@example.com");
  await page.getByTestId("tenant-maintenance-verify-submit").click();

  expect(verifyPayload).toMatchObject({
    first_name: "Taylor",
    last_name: "Tenant",
    contact: "taylor@example.com",
  });
  await expect(page.getByTestId("tenant-maintenance-residence-confirmation")).toContainText("Is this your residence?");
  await expect(page.getByTestId("tenant-maintenance-residence-confirmation")).toContainText("123 Main St, Austin, TX, 78701");
  await expect(page.getByTestId("tenant-maintenance-residence-confirmation")).toContainText("Unit: Unit A");
  await expect(page.getByTestId("tenant-maintenance-residence-confirmation")).toContainText("Austin Rentals Group");
  await page.getByTestId("tenant-maintenance-confirm-residence").click();
  await expect(page.getByTestId("tenant-maintenance-form")).toBeVisible();
  await expect(page.getByText("Duplex on Main")).toBeVisible();
  await expect(page.getByText("Unit: Unit A")).toBeVisible();

  await page.getByTestId("tenant-maintenance-name").fill("Taylor Tenant");
  await page.getByTestId("tenant-maintenance-category").selectOption("plumbing");
  await page.getByTestId("tenant-maintenance-urgency").selectOption("urgent");
  await page.getByTestId("tenant-maintenance-title").fill("Kitchen sink leak");
  await page.getByTestId("tenant-maintenance-description").fill("Water is dripping under the kitchen sink.");
  await page.getByTestId("tenant-maintenance-attachments").setInputFiles({
    name: "sink-leak.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("fake-image"),
  });
  await expect(page.getByTestId("tenant-maintenance-selected-files")).toContainText("sink-leak.jpg");
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/projects/maintenance-request/verified-submit/") &&
      response.request().method() === "POST"
    ),
    page.getByTestId("tenant-maintenance-submit").click(),
  ]);

  expect(submittedPayload).toMatchObject({
    hasAttachment: true,
    hasVerificationToken: true,
    hasTitle: true,
  });
  await expect(page.getByTestId("tenant-maintenance-confirmation")).toContainText("Maintenance request submitted.");
  await expect(page.getByTestId("tenant-maintenance-confirmation")).toContainText("TMR-000902");
  await expect(page.getByTestId("tenant-maintenance-status-link")).toHaveAttribute(
    "href",
    "/maintenance-request/status/status-token-902"
  );
  await page.getByTestId("tenant-maintenance-status-link").click();
  await expect(page).toHaveURL(/\/maintenance-request\/status\/status-token-902$/);
  await expect(page.getByTestId("tenant-maintenance-status-page")).toContainText("TMR-000902");
  await expect(page.getByTestId("tenant-maintenance-status-label")).toContainText("Submitted");
  await expect(page.getByTestId("tenant-maintenance-status-page")).toContainText("Duplex on Main");
});

test("tenant maintenance request verification supports whole-property rentals without unit", async ({ page }) => {
  let verifyPayload = null;
  let submittedPayload = null;

  await page.route("**/api/projects/maintenance-request/verify/", async (route) => {
    verifyPayload = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        verification_token: "whole-property-token",
        property: {
          id: 7,
          display_name: "Single Family Rental",
          address: "789 Oak St, Austin, TX, 78704",
        },
        unit: null,
        property_management_company: {
          id: 44,
          name: "Austin Rentals Group",
          is_active: true,
        },
        units: [],
        categories: [
          { value: "plumbing", label: "Plumbing" },
          { value: "general_repair", label: "General Repair" },
        ],
        urgencies: [
          { value: "urgent", label: "Urgent" },
          { value: "normal", label: "Normal" },
        ],
      }),
    });
  });

  await page.route("**/api/projects/maintenance-request/verified-submit/", async (route) => {
    const rawBody = route.request().postData() || "";
    submittedPayload = {
      rawBody,
      hasVerificationToken: rawBody.includes("whole-property-token"),
      hasTitle: rawBody.includes("Water heater issue"),
    };
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        detail: "Maintenance request submitted.",
        request: {
          id: 903,
          reference: "TMR-000903",
          status_url: "/maintenance-request/status/status-token-903",
          status: "submitted",
          status_label: "Submitted",
          title: "Water heater issue",
        },
      }),
    });
  });

  await page.goto("/maintenance-request", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("tenant-maintenance-verify-form")).toBeVisible();

  await page.getByTestId("tenant-maintenance-first-name").fill("Taylor");
  await page.getByTestId("tenant-maintenance-last-name").fill("Tenant");
  await page.getByTestId("tenant-maintenance-contact").fill("taylor@example.com");
  await expect(page.getByTestId("tenant-maintenance-verify-submit")).toBeEnabled();
  await page.getByTestId("tenant-maintenance-verify-submit").click();

  expect(verifyPayload).toMatchObject({
    first_name: "Taylor",
    last_name: "Tenant",
    contact: "taylor@example.com",
  });
  await expect(page.getByTestId("tenant-maintenance-residence-confirmation")).toContainText("Whole property residence");
  await page.getByTestId("tenant-maintenance-confirm-residence").click();
  await expect(page.getByTestId("tenant-maintenance-form")).toBeVisible();
  await expect(page.getByText("Single Family Rental")).toBeVisible();
  await expect(page.getByText("Unit:")).toHaveCount(0);

  await page.getByTestId("tenant-maintenance-name").fill("Taylor Tenant");
  await page.getByTestId("tenant-maintenance-category").selectOption("plumbing");
  await page.getByTestId("tenant-maintenance-title").fill("Water heater issue");
  await page.getByTestId("tenant-maintenance-description").fill("The water heater is not producing hot water.");
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/projects/maintenance-request/verified-submit/") &&
      response.request().method() === "POST"
    ),
    page.getByTestId("tenant-maintenance-submit").click(),
  ]);

  expect(submittedPayload).toMatchObject({
    hasVerificationToken: true,
    hasTitle: true,
  });
  await expect(page.getByTestId("tenant-maintenance-confirmation")).toContainText("TMR-000903");
  await expect(page.getByTestId("tenant-maintenance-status-link")).toHaveAttribute(
    "href",
    "/maintenance-request/status/status-token-903"
  );
});

test("tenant maintenance verification failure is generic", async ({ page }) => {
  await page.route("**/api/projects/maintenance-request/verify/", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "We could not verify those details. Check the information and try again.",
      }),
    });
  });

  await page.goto("/maintenance-request", { waitUntil: "domcontentloaded" });
  await page.getByTestId("tenant-maintenance-first-name").fill("Wrong");
  await page.getByTestId("tenant-maintenance-last-name").fill("Wrong");
  await page.getByTestId("tenant-maintenance-contact").fill("wrong@example.com");
  await page.getByTestId("tenant-maintenance-verify-submit").click();

  await expect(page.getByTestId("tenant-maintenance-verify-error")).toContainText(
    "We could not verify those details. Check the information and try again.",
  );
  await expect(page.getByTestId("tenant-maintenance-form")).toHaveCount(0);
});

test("tenant maintenance blank-unit verification failure is generic", async ({ page }) => {
  let verifyPayload = null;
  await page.route("**/api/projects/maintenance-request/verify/", async (route) => {
    verifyPayload = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "We could not verify those details. Check the information and try again.",
      }),
    });
  });

  await page.goto("/maintenance-request", { waitUntil: "domcontentloaded" });
  await page.getByTestId("tenant-maintenance-first-name").fill("Taylor");
  await page.getByTestId("tenant-maintenance-last-name").fill("Tenant");
  await page.getByTestId("tenant-maintenance-contact").fill("taylor@example.com");
  await page.getByTestId("tenant-maintenance-verify-submit").click();

  expect(verifyPayload).toMatchObject({
    first_name: "Taylor",
    last_name: "Tenant",
    contact: "taylor@example.com",
  });
  await expect(page.getByTestId("tenant-maintenance-verify-error")).toContainText(
    "We could not verify those details. Check the information and try again.",
  );
  await expect(page.getByTestId("tenant-maintenance-form")).toHaveCount(0);
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
  await expect(page.getByTestId("customer-dashboard-tab-maintenance")).toHaveCount(0);
  await expect(page.getByTestId("customer-notifications-empty")).toContainText("No new notifications");
  await expect(page.getByTestId("customer-overview-projects-empty")).toContainText("No active projects yet");
  await expect(page.getByTestId("customer-overview-requests-empty")).toContainText("No requests yet");

  await page.getByTestId("customer-dashboard-tab-projects").click();
  await expect(page.getByTestId("customer-project-workspace-empty")).toContainText("No projects connected yet");

  await page.getByTestId("customer-dashboard-tab-requests").click();
  await expect(page.getByTestId("customer-requests-empty")).toContainText("No saved requests yet");
  await expect(page.getByText("Saved requests stay private here first")).toBeVisible();
  await expect(page.getByTestId("customer-bids-empty")).toContainText("No bids yet");
  await expect(page.getByTestId("tenant-maintenance-review-queue")).toHaveCount(0);

  await page.getByTestId("customer-dashboard-tab-property").click();
  await expect(page.getByTestId("property-command-summary")).toContainText("Property Summary");
  await expect(page.getByTestId("property-units-section")).toHaveCount(0);
  await expect(page.getByTestId("property-tenants-section")).toHaveCount(0);
  await expect(page.getByTestId("property-home-systems")).toContainText("Home Systems");
  await expect(page.getByTestId("property-active-work")).toHaveCount(0);
  await expect(page.getByTestId("customer-dashboard-tab-projects")).toBeVisible();
  await expect(page.getByTestId("customer-dashboard-tab-requests")).toBeVisible();
  await expect(page.getByTestId("property-maintenance-center")).toContainText("Maintenance Center");
  await expect(page.getByTestId("home-records-timeline-empty")).toContainText("No property timeline yet");
  await expect(page.getByTestId("home-records-warranty-center")).toHaveCount(0);
  await expect(page.getByTestId("property-photo-gallery")).toHaveCount(0);
  await expect(page.getByTestId("home-records-documents-photos")).toHaveCount(0);
  await expect(page.getByTestId("home-records-document-filters")).toHaveCount(0);
  await expect(page.getByTestId("customer-property-upload-form")).toHaveCount(0);
  await expect(page.getByTestId("property-view-documents")).toHaveCount(0);
  await expect(page.getByTestId("customer-property-profile")).not.toContainText("Document library");

  await page.getByTestId("customer-dashboard-tab-notifications").click();
  await expect(page.getByTestId("customer-notifications-center-empty")).toContainText("No recent notifications");

  await page.getByTestId("customer-dashboard-tab-payments").click();
  await expect(page.getByTestId("customer-payments-empty")).toContainText("No payment records yet");

  await page.getByTestId("customer-dashboard-tab-documents").click();
  await expect(page.getByTestId("customer-documents-empty")).toContainText("No documents yet");

  await page.getByTestId("customer-dashboard-tab-account").click();
  await expect(page.getByTestId("customer-profile-address-autocomplete").locator("input")).toHaveClass(/text-white/);
  await expect(page.getByTestId("customer-profile-address-autocomplete").locator("input")).toHaveClass(/placeholder:text-slate-400/);
});

test("tenant maintenance notification opens the Maintenance tab", async ({ page }) => {
  let currentPortalPayload = clonePortal({
    ...portalPayload,
    account: {
      ...portalPayload.account,
      account_type: "property_management_company",
      is_property_management_company: true,
      has_rental_properties: true,
    },
    property_profile: {
      ...portalPayload.property_profile,
      rental_tools_enabled: true,
      is_rental_property: true,
    },
    property_profiles: portalPayload.property_profiles.map((property) => ({
      ...property,
      rental_tools_enabled: true,
      is_rental_property: true,
    })),
    notifications: [
      {
        id: 901,
        event_type: "tenant_maintenance_request_submitted",
        channel: "in_app",
        status: "unread",
        title: "New tenant maintenance request",
        message: "TMR-000901 was submitted for Kitchen Remodel.",
        action_url: "#maintenance",
        created_at: "2026-06-22T15:00:00Z",
      },
    ],
  });

  await page.addInitScript(() => {
    window.localStorage.setItem("access", "customer-portal-token");
  });
  await page.route("**/api/projects/customer-portal/**", async (route) => {
    const requestUrl = route.request().url();
    const method = route.request().method();
    if (method === "GET" && requestUrl.includes("/customer-portal/customer-token/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }
    if (method === "POST" && requestUrl.includes("/customer-portal/customer-token/notifications/901/read/")) {
      currentPortalPayload = {
        ...currentPortalPayload,
        notifications: currentPortalPayload.notifications.map((notification) =>
          notification.id === 901 ? { ...notification, status: "read" } : notification
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPortalPayload),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/portal/customer-token", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("customer-dashboard-tab-maintenance")).toBeVisible();
  await page.getByTestId("customer-dashboard-tab-notifications").click();
  await expect(page.getByTestId("customer-notifications-center-item-901")).toContainText("New tenant maintenance request");
  await page
    .getByTestId("customer-notifications-center-item-901")
    .getByRole("link", { name: /Open related item/ })
    .click();
  await expect(page.getByTestId("customer-dashboard-tab-maintenance")).toHaveClass(/border-amber/);
  await expect(page.getByTestId("customer-maintenance-workspace")).toBeVisible();
});

test("rental operations gating locks internal work orders but keeps marketplace routing visible", async ({ page }) => {
  const lockedPortal = clonePortal({
    ...portalPayload,
    account: {
      ...portalPayload.account,
      account_type: "property_management_company",
      is_property_management_company: true,
      has_rental_properties: true,
      rental_operations: {
        ...portalPayload.account.rental_operations,
        subscription_status: "canceled",
        trial_active: false,
        trial_days_remaining: 0,
        subscription_active: false,
        rental_operations_locked: true,
      },
      subscription_status: "canceled",
      trial_active: false,
      trial_days_remaining: 0,
      subscription_active: false,
      rental_operations_locked: true,
    },
    property_profile: {
      ...portalPayload.property_profile,
      rental_tools_enabled: true,
      is_rental_property: true,
    },
    property_profiles: portalPayload.property_profiles.map((profile) => ({
      ...profile,
      rental_tools_enabled: true,
      is_rental_property: true,
    })),
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("access", "customer-portal-token");
  });
  await page.route("**/api/projects/customer-portal/**", async (route) => {
    const requestUrl = route.request().url();
    const method = route.request().method();
    if (method === "POST" && requestUrl.includes("/rental-operations/checkout/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ checkout_url: "https://checkout.stripe.test/rental-ops" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(lockedPortal),
    });
  });

  await page.goto("/portal/customer-token");
  await expect(page.getByTestId("rental-operations-subscription-banner")).toContainText("Internal maintenance tools require Rental Operations.");
  await page.getByTestId("customer-dashboard-tab-maintenance").click();
  await page.getByTestId("property-work-order-add").click();
  await page.getByTestId("property-work-order-title").fill("Locked staff repair");
  await page.getByTestId("property-work-order-description").fill("Route this repair internally.");
  await expect(page.getByTestId("property-work-order-assignment-type")).toHaveValue("internal_staff");
  await page.getByTestId("property-work-order-continue-contractors").click();
  await expect(page.getByTestId("property-work-order-error")).toContainText("Internal staff assignment requires Rental Operations");
  await page.getByTestId("property-work-order-assignment-type").selectOption("vendor");
  await page.getByTestId("property-work-order-continue-contractors").click();
  await expect(page.getByTestId("property-work-order-vendor-panel")).toContainText("Enter Vendor Manually");
  await page.getByTestId("property-work-order-vendor-mode-manual").click();
  await page.getByTestId("property-work-order-manual-vendor-name").fill("Free Vendor Route");
  await page.getByTestId("property-work-order-manual-vendor-email").fill("dispatch@freevendor.example");
  await expect(page.getByTestId("property-work-order-continue-finalize")).toBeEnabled();
  await page.getByTestId("property-work-order-continue-finalize").click();
  await expect(page.getByTestId("property-work-order-rental-operations-lock")).toHaveCount(0);
  await expect(page.getByTestId("property-work-order-send-manual-vendor")).toBeEnabled();
  await page.getByTestId("property-work-order-back").click();
  await page.getByTestId("property-work-order-back").click();
  await page.getByTestId("property-work-order-assignment-type").selectOption("marketplace_contractor");
  await page.getByTestId("property-work-order-continue-contractors").click();
  await expect(page.getByTestId("property-work-order-marketplace-placeholder")).toContainText("Contractor Search");
});

test("customer portal paginates projects and requests", async ({ page }) => {
  const paginationProjects = Array.from({ length: 12 }, (_, index) => ({
    id: 1000 + index,
    project_number: `PRJ-PAGE-${index + 1}`,
    title: `Pagination Project ${index + 1}`,
    description: `Pagination project ${index + 1}`,
    status: "in_progress",
    status_label: "In Progress",
    address: "123 Main St, Austin, TX 78701",
    property_id: 1,
    contractor_name: "Builder Co",
    agreement_id: null,
    agreement_token: "",
    agreement_url: "",
    total_cost: "1000.00",
    created_at: `2026-04-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
    updated_at: `2026-04-${String(index + 1).padStart(2, "0")}T11:00:00Z`,
    project_type: "maintenance",
    milestones: [],
    suggested_materials: [],
    updates: [],
  }));
  const paginationRequests = Array.from({ length: 12 }, (_, index) => ({
    id: `pagination-request-${index + 1}`,
    request_id: 2000 + index,
    source_kind: "customer_request",
    source_kind_label: "Customer Portal",
    request_source_label: "Customer Portal",
    project_title: `Pagination Request ${index + 1}`,
    project_scope: `Pagination request ${index + 1}`,
    notes: `Pagination request ${index + 1}`,
    project_category: "Maintenance",
    project_type: "Maintenance",
    status: "submitted",
    status_label: "Submitted",
    workflow_status: "reviewing_request",
    can_edit: true,
    property_name: "Kitchen Remodel",
    project_address: "123 Main St, Austin, TX, 78701",
    current_next_action: "Review request details.",
    urgency: "normal",
    preferred_timeline: "Within the next month",
    latest_activity: `2026-04-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
  }));
  const paginationPayload = {
    ...portalPayload,
    summary: {
      ...portalPayload.summary,
      active_projects: paginationProjects.length,
      active_requests: paginationRequests.length,
      bids_received: 0,
      active_agreements: 0,
      payments: 0,
      documents: 0,
    },
    projects: paginationProjects,
    requests: paginationRequests,
    bids: [],
    bid_comparisons: [],
    agreements: [],
    payments: [],
    documents: [],
    maintenance_work_orders: [],
    property_profile: {
      ...portalPayload.property_profile,
      tenant_maintenance_requests: [],
    },
    tenant_maintenance_requests: [],
  };

  await page.route("**/api/projects/customer-portal/**", async (route) => {
    const requestUrl = route.request().url();
    if (route.request().method() === "GET" && requestUrl.includes("/customer-portal/pagination-token/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(paginationPayload),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/portal/pagination-token", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("customer-dashboard")).toBeVisible();

  await page.getByTestId("customer-dashboard-tab-projects").click();
  await expect(page.getByTestId("customer-project-result-count")).toContainText("Showing 1-10 of 12 projects");
  await expect(page.getByTestId("customer-project-card-1011")).toContainText("Pagination Project 12");
  await expect(page.getByText("Pagination Project 2")).toHaveCount(0);
  await page.getByTestId("customer-project-load-more").click();
  await expect(page.getByTestId("customer-project-result-count")).toContainText("Showing 1-12 of 12 projects");
  await expect(page.getByTestId("customer-project-card-1001")).toContainText("Pagination Project 2");
  await page.getByTestId("customer-project-filter-closed").click();
  await expect(page.getByTestId("customer-project-closed-empty")).toContainText("No completed projects yet.");
  await page.getByTestId("customer-project-filter-open").click();
  await expect(page.getByTestId("customer-project-result-count")).toContainText("Showing 1-10 of 12 projects");

  await page.getByTestId("customer-dashboard-tab-requests").click();
  await expect(page.getByTestId("customer-request-result-count")).toContainText("Showing 1-10 of 12 requests");
  await expect(page.getByTestId("customer-request-card-pagination-request-1")).toContainText("Pagination Request 1");
  await expect(page.getByText("Pagination Request 11")).toHaveCount(0);
  await page.getByTestId("customer-request-load-more").click();
  await expect(page.getByTestId("customer-request-result-count")).toContainText("Showing 1-12 of 12 requests");
  await expect(page.getByTestId("customer-request-card-pagination-request-11")).toContainText("Pagination Request 11");
});

test("individual customer rental toggle unlocks tenant and unit tools for that property", async ({ page }) => {
  let currentPayload = {
    ...emptyPortalPayload,
    account: {
      ...emptyPortalPayload.account,
      has_rental_properties: false,
    },
    property_profile: {
      ...emptyPortalPayload.property_profile,
      id: 44,
      display_name: "Rental House",
      is_rental_property: false,
      rental_tools_enabled: false,
    },
    property_profiles: [
      {
        ...emptyPortalPayload.property_profile,
        id: 44,
        display_name: "Rental House",
        is_rental_property: false,
        rental_tools_enabled: false,
      },
    ],
  };

  await page.route("**/api/projects/customer-portal/**", async (route) => {
    const requestUrl = route.request().url();
    if (!requestUrl.includes("/customer-portal/rental-toggle-token/")) {
      await route.fallback();
      return;
    }
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPayload),
      });
      return;
    }
    if (route.request().method() === "PATCH" && requestUrl.endsWith("/property/")) {
      const body = route.request().postDataJSON();
      currentPayload = {
        ...currentPayload,
        account: {
          ...currentPayload.account,
          has_rental_properties: Boolean(body.is_rental_property),
        },
        property_profile: {
          ...currentPayload.property_profile,
          ...body,
          rental_tools_enabled: Boolean(body.is_rental_property),
        },
        property_profiles: currentPayload.property_profiles.map((property) =>
          property.id === body.id
            ? { ...property, ...body, rental_tools_enabled: Boolean(body.is_rental_property) }
            : property
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPayload),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/portal/rental-toggle-token", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("customer-dashboard-tab-maintenance")).toHaveCount(0);
  await page.getByTestId("customer-dashboard-tab-property").click();
  await expect(page.getByTestId("property-units-section")).toHaveCount(0);
  await expect(page.getByTestId("property-tenants-section")).toHaveCount(0);

  await page.getByTestId("property-rental-toggle").check();
  await page.getByRole("button", { name: "Save property profile" }).click();

  await expect(page.getByTestId("property-units-section")).toBeVisible();
  await expect(page.getByTestId("property-tenants-section")).toBeVisible();
  await expect(page.getByTestId("customer-dashboard-tab-maintenance")).toBeVisible();
  await page.getByTestId("customer-dashboard-tab-maintenance").click();
  await expect(page.getByTestId("customer-maintenance-workspace")).toBeVisible();
  await expect(page.getByTestId("tenant-maintenance-requests-empty")).toContainText("No active maintenance requests.");
  await expect(page.getByTestId("property-work-orders-empty")).toContainText("No active work orders.");
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
    if (route.request().method() === "POST" && requestUrl.includes("/agreements/105/amendments/improve/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Amendment request improved.",
          original_request: "I want to remove the remaining cabinet installation milestone.",
          suggested_change_type: "descope_remove_work",
          suggested_change_type_label: "De-scope / Remove Work",
          improved_description: "Please review this proposed de-scope change: remove the remaining cabinet installation milestone.",
          clarification_questions: ["What revised project value should the contractor consider, if known?"],
          evidence_note: "A revised scope list or estimate can help the contractor review this.",
          source: "ai_advisory",
        }),
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
  await expect(page.getByTestId("customer-payment-summary-remaining-escrow-primary")).toContainText("$13,000.00");
  await expect(page.getByTestId("customer-payment-summary-escrow-funded")).toContainText("$20,000.00 escrow funded");
  await expect(page.getByTestId("customer-payment-summary-released")).toContainText("$7,000.00 released to contractor");
  await expect(page.getByTestId("customer-payment-summary-remaining-escrow")).toContainText("$13,000.00 remaining in escrow");
  await expect(page.getByTestId("customer-payment-summary-paid-progress")).toContainText("35% released");
  await expect(page.getByTestId("customer-selected-agreement-summary")).not.toContainText("contractor invoices");
  await page.getByTestId("customer-project-toggle-details").click();
  await expect(page.getByTestId("customer-project-payments")).toContainText("Invoice & Payment History");
  await expect(page.getByTestId("customer-project-payments")).toContainText("Release Paid");
  await expect(page.getByTestId("customer-project-payments")).toContainText("Paid to contractor from escrow");
  await expect(page.getByTestId("customer-project-payments")).not.toContainText("Escrow Funded");
  await expect(page.getByTestId("customer-project-escrow-history")).toHaveCount(0);
  await expect(page.getByTestId("customer-rich-project-workspace")).not.toContainText("Balance ledger");
  await expect(page.getByTestId("customer-rich-project-workspace")).not.toContainText("Escrow Released");
  await expect(page.getByTestId("customer-selected-agreement-summary")).not.toContainText("$27,000.00");
  await expect(page.getByTestId("customer-selected-agreement-summary")).not.toContainText("Released / Paid");
  await page.getByTestId("customer-dashboard-tab-payments").click();
  await page.getByTestId("customer-payment-agreement-105").click();
  await expect(page.getByTestId("customer-selected-project-financial-summary")).toContainText("Project Value");
  await expect(page.getByTestId("customer-selected-project-financial-summary")).toContainText("$20,000");
  await expect(page.getByTestId("customer-selected-project-financial-summary")).toContainText("Paid to Contractor");
  await expect(page.getByTestId("customer-selected-project-financial-summary")).toContainText("$7,000");
  await expect(page.getByTestId("customer-selected-project-financial-summary")).toContainText("Remaining Project Value");
  await expect(page.getByTestId("customer-selected-project-financial-summary")).toContainText("$13,000");
  await expect(page.getByTestId("customer-selected-project-financial-summary")).toContainText("Remaining Escrow");
  await expect(page.getByTestId("customer-selected-payment-running-escrow-invoice-7000")).toContainText("Amount Paid");
  await expect(page.getByTestId("customer-selected-payment-running-escrow-invoice-7000")).toContainText("Total Paid To Date");
  await expect(page.getByTestId("customer-selected-payment-running-escrow-invoice-7000")).toContainText("$7,000");
  await expect(page.getByTestId("customer-selected-payment-running-escrow-invoice-7000")).toContainText("35% of Project Value Paid");
  await expect(page.getByTestId("customer-selected-escrow-running-escrow-funded-20000")).toContainText("+$20,000");
  await expect(page.getByTestId("customer-selected-escrow-running-escrow-funded-20000")).toContainText("Balance");
  await expect(page.getByTestId("customer-selected-escrow-running-escrow-funded-20000")).toContainText("$20,000");
  await expect(page.getByTestId("customer-selected-escrow-running-escrow-invoice-7000")).toContainText("-$7,000");
  await expect(page.getByTestId("customer-selected-escrow-running-escrow-invoice-7000")).toContainText("$13,000");
  await expect(page.getByTestId("customer-selected-current-escrow-balance")).toContainText("$13,000");
  await expect(page.getByTestId("customer-payment-agreement-detail")).not.toContainText("Escrow balance reduced");
  await page.getByTestId("customer-dashboard-tab-projects").click();
  await page.getByTestId("customer-project-search").fill("Escrow Funded Invoice");
  await page.getByTestId("customer-project-card-escrow-funded-invoice-project").click();
  await expect(page.getByTestId("customer-homeowner-action-center")).toContainText("Need to Change Something?");
  await page.getByTestId("customer-action-amendment").click();
  await expect(page.getByTestId("customer-action-modal")).toContainText("Request Amendment");
  await expect(page.getByTestId("customer-action-modal")).toContainText("Describe the change you want to request");
  await expect(page.getByTestId("customer-action-modal")).toContainText("does not modify the signed agreement automatically");
  await page.getByTestId("customer-action-requested-change").fill("I want to remove the remaining cabinet installation milestone.");
  await page.getByTestId("customer-action-ai-improve").click();
  await expect(page.getByTestId("customer-action-ai-suggestion")).toContainText("Original request");
  await expect(page.getByTestId("customer-action-ai-suggestion")).toContainText("Suggested category");
  await expect(page.getByTestId("customer-action-ai-suggestion")).toContainText("De-scope / Remove Work");
  await expect(page.getByTestId("customer-action-ai-suggestion")).toContainText("Improved description");
  await expect(page.getByTestId("customer-action-ai-suggestion")).toContainText("Evidence or document suggestion");
  await page.getByTestId("customer-action-apply-ai-suggestion").click();
  await expect(page.getByTestId("customer-action-requested-change")).toHaveValue(
    "Please review this proposed de-scope change: remove the remaining cabinet installation milestone."
  );
  await expect(page.getByTestId("customer-action-change-type")).toHaveValue("descope_remove_work");
  await page.getByTestId("customer-action-change-type").selectOption("materials_change");
  await expect(page.getByTestId("customer-action-change-type")).toHaveValue("materials_change");
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
  await page.getByTestId("customer-action-reason").fill("We are cancelling the remaining work and reducing the project value.");
  await page.getByTestId("customer-action-submit").click();
  await expect(page.getByTestId("customer-action-modal")).toHaveCount(0);
  expect(amendmentPayload).toMatchObject({
    change_type: "descope_remove_work",
    requested_change: "Please review this proposed de-scope change: remove the remaining cabinet installation milestone.",
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
  await expect(page.getByTestId("home-records-timeline-collapsed-summary")).toBeVisible();
  await page.getByTestId("home-records-timeline-toggle").click();
  await expect(page.getByTestId(/home-records-timeline-(action|static)-/)).toHaveCount(5);
  await expect(page.getByTestId("home-records-timeline")).not.toContainText("Older Deck Repair");
  await expect(page.getByTestId("home-records-timeline")).toContainText("Quarterly service visit");
  await expect(page.getByTestId("property-maintenance-center")).toContainText("Completed service");
  await page.getByTestId("home-records-timeline-show-more").click();
  await expect(page.getByTestId("home-records-timeline")).toContainText("Older Deck Repair");
  await expect(page.getByTestId("home-records-timeline-action-document-document-1")).toHaveAttribute("href", "/files/scope-addendum.txt");
  await expect(page.getByTestId("home-records-timeline-action-document-document-1")).toContainText("View document");
  await expect(page.getByTestId("home-records-timeline-static-project-static-history-project")).toBeVisible();
  await expect(page.getByTestId("home-records-timeline-static-project-static-history-project")).not.toHaveAttribute("href", /#/);

  await expect(page.getByTestId("home-records-important-documents")).toHaveCount(0);
  await expect(page.getByTestId("home-records-warranty-center")).toHaveCount(0);
  await expect(page.getByTestId("property-photo-gallery")).toHaveCount(0);
  await expect(page.getByTestId("home-records-documents-photos")).toHaveCount(0);
  await expect(page.getByTestId("home-records-document-filters")).toHaveCount(0);
  await expect(page.getByTestId("customer-property-upload-form")).toHaveCount(0);
  await expect(page.getByTestId("property-view-documents")).toHaveCount(0);
  await expect(page.getByTestId("customer-property-profile")).not.toContainText("Document library");

  await page.getByTestId("customer-dashboard-tab-payments").click();
  await expect(page.getByTestId("customer-payment-history-collapsed-summary")).toContainText("records hidden");
  await expect(page.getByTestId("customer-payment-history")).toHaveCount(0);
  await page.getByTestId("customer-payments-history-toggle").click();
  await expect(page.getByTestId("customer-payment-history")).toContainText("Paid receipt 6");

  await page.getByTestId("customer-dashboard-tab-documents").click();
  await expect(page.getByTestId("customer-portal-documents")).not.toContainText("Portal extra document 10");
  await page.getByTestId("customer-documents-show-more").click();
  await expect(page.getByTestId("customer-portal-documents")).toContainText("Portal extra document 10");
});

test("customer portal mobile upload session saves a home system document", async ({ page }) => {
  await page.route("**/api/projects/customer-portal/upload-sessions/scan-session-token/**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(scanSessionPayload),
      });
      return;
    }
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(scanUploadResult),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/portal/upload-session/scan-session-token", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("portal-upload-session-page")).toContainText("Saving to:");
  await expect(page.getByTestId("portal-upload-session-page")).toContainText("Main HVAC");
  await page.getByTestId("portal-upload-session-document-type").selectOption("Warranty");
  await page.getByTestId("portal-upload-session-file").setInputFiles({
    name: "carrier-model-ABC123.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("fake image"),
  });
  await page.getByTestId("portal-upload-session-submit").click();
  await expect(page.getByTestId("portal-upload-session-result")).toContainText("File saved");
  await expect(page.getByTestId("portal-upload-session-result")).toContainText("Document Analysis Results");
  await expect(page.getByTestId("portal-upload-session-result")).toContainText("ABC123");
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
