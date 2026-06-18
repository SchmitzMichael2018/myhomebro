import React, { useEffect, useMemo, useState } from "react";
import AddressAutocomplete from "./AddressAutocomplete.jsx";

const PORTAL_ADDRESS_AUTOCOMPLETE_CLASSES = {
  inputClassName:
    "w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 pr-10 text-sm text-white placeholder:text-slate-400 outline-none focus:border-sky-400 disabled:bg-slate-800 disabled:text-slate-400",
  suggestionsClassName:
    "absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-600 bg-slate-950 text-sm text-slate-100 shadow-xl",
  suggestionButtonClassName:
    "block w-full px-3 py-2 text-left text-slate-100 hover:bg-slate-800 hover:text-white focus:bg-sky-900 focus:text-white focus:outline-none active:bg-sky-800 disabled:bg-slate-900 disabled:text-slate-500",
  helperClassName: "mt-1 text-xs text-slate-300",
};

function formatDate(value) {
  if (!value) return "Date pending";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return String(value);
  }
}

function money(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0
    ? numeric.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "";
}

function EmptyState({ title, children, testId }) {
  return (
    <div data-testid={testId} className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/45 p-4 text-sm text-slate-300">
      <div className="font-semibold text-white">{title}</div>
      <p className="mt-1 leading-6 text-slate-400">{children}</p>
    </div>
  );
}

function Section({ title, eyebrow, children, testId }) {
  return (
    <section data-testid={testId} className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5 shadow-xl shadow-slate-950/20">
      {eyebrow ? <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200/80">{eyebrow}</div> : null}
      <h3 className="mt-1 text-lg font-semibold text-white">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ShowMoreControl({ total, visible, expanded, onToggle, noun = "items", testId }) {
  if (total <= visible) return null;
  return (
    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs font-semibold text-slate-400">
        Showing {expanded ? total : visible} of {total} {noun}
      </div>
      <button
        type="button"
        data-testid={testId}
        onClick={onToggle}
        className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-amber-300/50 hover:text-white"
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </div>
  );
}

function categoryForDocument(item) {
  const text = `${item?.type_label || ""} ${item?.title || ""} ${item?.filename || ""}`.toLowerCase();
  if (text.includes("agreement") || text.includes("contract")) return "Agreements";
  if (text.includes("invoice") || text.includes("receipt") || text.includes("payment")) return "Invoices & Receipts";
  if (text.includes("warranty")) return "Warranties";
  if (text.includes("permit")) return "Permits";
  if (text.includes("manual") || text.includes("owner guide") || text.includes("owner's guide")) return "Manuals";
  if (text.includes("insurance") || text.includes("hoa")) return "Insurance / HOA";
  if (text.includes("photo") || text.includes("image")) return "Photos";
  return "Other";
}

function warrantyRows(agreements, documents, homeSystems = []) {
  const agreementRows = (agreements || [])
    .filter((agreement) => String(agreement.warranty_text || "").trim())
    .map((agreement) => ({
      id: `warranty-${agreement.id}`,
      project: agreement.project_title || "Project",
      contractor: agreement.contractor_name || "Your contractor",
      warrantyType: agreement.warranty_type || "Warranty",
      text: agreement.warranty_text,
      date: agreement.completed_at || agreement.updated_at,
      documents: (documents || []).filter((document) => {
        const haystack = `${document.title || ""} ${document.type_label || ""} ${document.project_title || ""}`.toLowerCase();
        return haystack.includes("warranty") && (!document.project_title || document.project_title === agreement.project_title);
      }),
    }));
  const systemRows = (homeSystems || [])
    .filter((system) => system.warrantyExpiration)
    .map((system) => ({
      id: `system-warranty-${system.id}`,
      project: system.name,
      contractor: system.serviceProvider || "Service provider not recorded",
      warrantyType: `${system.system_type_label || "System"} warranty`,
      text: `${system.name} warranty coverage expires ${formatDate(system.warrantyExpiration)}.`,
      date: system.warrantyStartDate || system.installDate || system.updated_at,
      documents: system.linkedDocuments || [],
    }));
  return [...agreementRows, ...systemRows];
}

function completedProjectRows(projects, agreements, documents) {
  const agreementById = new Map((agreements || []).map((agreement) => [String(agreement.id), agreement]));
  return (projects || [])
    .filter((project) => {
      const status = String(project.status || project.status_label || "").toLowerCase();
      return status.includes("complete") || status.includes("closed") || status.includes("archived");
    })
    .map((project) => {
      const agreement = agreementById.get(String(project.agreement_id)) || {};
      return {
        id: project.id,
        title: project.title || agreement.project_title || "Completed project",
        contractor: project.contractor_name || agreement.contractor_name || "Your contractor",
        completedAt: project.completed_at || project.updated_at || agreement.completed_at || agreement.updated_at,
        amount: project.total_cost || agreement.total_cost,
        warranty: agreement.warranty_text || "",
        action: project.agreement_url || agreement.action_target || "",
        documents: (documents || []).filter((document) => {
          if (project.agreement_id && String(document.agreement_id || "") === String(project.agreement_id)) return true;
          return document.project_title === project.title;
        }),
      };
    });
}

function maintenanceRows(workOrders = []) {
  return (workOrders || [])
    .map((workOrder) => ({
      id: workOrder.id,
      title: workOrder.title || "Maintenance visit",
      projectTitle: workOrder.project_title || "Maintenance service",
      contractor: workOrder.contractor_name || "Your contractor",
      propertyName: workOrder.property_name || "",
      description: workOrder.description || "",
      scheduledDate: workOrder.scheduled_date,
      completedAt: workOrder.completed_at,
      status: workOrder.status || "",
      statusLabel: workOrder.status_label || "Scheduled",
      notes: workOrder.notes || "",
      attachments: workOrder.attachments || [],
    }))
    .sort((a, b) => String(b.completedAt || b.scheduledDate || "").localeCompare(String(a.completedAt || a.scheduledDate || "")));
}

const SYSTEM_KEYWORDS = [
  ["HVAC", ["hvac", "air conditioner", "furnace", "filter", "cooling", "heating"]],
  ["Roof", ["roof", "shingle", "gutter"]],
  ["Water Heater", ["water heater", "tankless", "hot water"]],
  ["Electrical Panel", ["electrical", "panel", "breaker"]],
  ["Plumbing", ["plumbing", "pipe", "sink", "drain", "water line"]],
  ["Appliances", ["appliance", "dishwasher", "range", "oven", "washer", "dryer", "refrigerator"]],
  ["Windows/Doors", ["window", "door", "glazing"]],
  ["Foundation/Basement", ["foundation", "basement", "crawlspace"]],
  ["Exterior/Siding", ["siding", "exterior", "stucco", "paint"]],
];

const HOME_SYSTEM_TYPE_OPTIONS = [
  ["hvac", "HVAC"],
  ["roof", "Roof"],
  ["water_heater", "Water Heater"],
  ["electrical", "Electrical Panel"],
  ["plumbing", "Plumbing"],
  ["appliance", "Appliances"],
  ["windows_doors", "Windows/Doors"],
  ["foundation", "Foundation/Basement"],
  ["exterior_siding", "Exterior/Siding"],
  ["septic_sewer", "Septic/Sewer"],
  ["solar", "Solar"],
  ["pool_spa", "Pool/Spa"],
  ["other", "Other"],
];

const HOME_SYSTEM_DOCUMENT_TYPES = ["Equipment Label", "Receipt", "Invoice", "Warranty", "Manual", "Service Record", "Other"];

const HOME_SYSTEM_CONDITION_OPTIONS = [
  ["unknown", "Unknown"],
  ["excellent", "Excellent"],
  ["good", "Good"],
  ["fair", "Fair"],
  ["needs_service", "Needs Service"],
  ["replace_soon", "Replace Soon"],
];

const PROPERTY_UNIT_TYPE_OPTIONS = [
  ["whole_property", "Whole Property"],
  ["apartment", "Apartment"],
  ["condo", "Condo"],
  ["suite", "Suite"],
  ["room", "Room"],
  ["other", "Other"],
];

const PROPERTY_UNIT_STATUS_OPTIONS = [
  ["active", "Active"],
  ["vacant", "Vacant"],
  ["inactive", "Inactive"],
];

const TENANT_STATUS_OPTIONS = [
  ["pending", "Pending"],
  ["active", "Active"],
  ["former", "Former"],
];

const emptyUnitForm = {
  unit_label: "",
  unit_type: "whole_property",
  status: "active",
  access_notes: "",
  notes: "",
};

const emptyTenantForm = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  unit_id: "",
  status: "pending",
  move_in_date: "",
  move_out_date: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  maintenance_access_enabled: false,
  notes: "",
};

function unitTypeLabel(value) {
  return PROPERTY_UNIT_TYPE_OPTIONS.find(([key]) => key === value)?.[1] || value || "Whole Property";
}

function unitStatusLabel(value) {
  return PROPERTY_UNIT_STATUS_OPTIONS.find(([key]) => key === value)?.[1] || value || "Active";
}

function tenantStatusLabel(value) {
  return TENANT_STATUS_OPTIONS.find(([key]) => key === value)?.[1] || value || "Pending";
}

function systemRows({ projects = [], agreements = [], documents = [], requests = [], maintenanceWorkOrders = [], propertyIntelligence = {} }) {
  const haystackItems = [
    ...projects.map((row) => ({ source: row, text: `${row.title || ""} ${row.description || ""} ${row.project_type || ""}` })),
    ...agreements.map((row) => ({ source: row, text: `${row.project_title || ""} ${row.description || ""} ${row.warranty_text || ""}` })),
    ...documents.map((row) => ({ source: row, text: `${row.title || ""} ${row.type_label || ""} ${row.filename || ""}` })),
    ...requests.map((row) => ({ source: row, text: `${row.project_title || ""} ${row.project_type || ""} ${row.project_subtype || ""} ${row.project_scope || ""}` })),
    ...maintenanceWorkOrders.map((row) => ({ source: row, text: `${row.title || ""} ${row.description || ""} ${row.project_title || ""}` })),
    ...((propertyIntelligence?.insights || []).map((row) => ({ source: row, text: `${row.title || ""} ${row.reason || ""} ${row.category || ""}` }))),
  ];
  return SYSTEM_KEYWORDS.map(([name, keywords]) => {
    const matches = haystackItems.filter((item) => keywords.some((keyword) => item.text.toLowerCase().includes(keyword)));
    const latestMaintenance = matches
      .map((item) => item.source)
      .find((row) => row.completed_at || row.completedAt || row.scheduled_date || row.scheduledDate);
    const linkedDocuments = documents.filter((document) => keywords.some((keyword) => `${document.title || ""} ${document.type_label || ""} ${document.filename || ""}`.toLowerCase().includes(keyword)));
    const linkedProjects = projects.filter((project) => keywords.some((keyword) => `${project.title || ""} ${project.description || ""}`.toLowerCase().includes(keyword)));
    return {
      name,
      manufacturer: "",
      model: "",
      installDate: "",
      lastServiceDate: latestMaintenance?.completed_at || latestMaintenance?.completedAt || latestMaintenance?.scheduled_date || latestMaintenance?.scheduledDate || "",
      warrantyExpiration: "",
      notes: matches.length ? `${matches.length} linked record${matches.length === 1 ? "" : "s"} found.` : "No records saved yet.",
      linkedDocuments,
      linkedProjects,
    };
  });
}

function normalizeHomeSystem(system) {
  return {
    ...system,
    name: system.display_name || system.custom_name || system.system_type_label || "Home system",
    manufacturer: system.manufacturer || "",
    model: system.model_number || system.model || "",
    serialNumber: system.serial_number || "",
    installDate: system.install_date || system.installDate || "",
    lastServiceDate: system.last_service_date || system.lastServiceDate || "",
    warrantyStartDate: system.warranty_start_date || "",
    warrantyExpiration: system.warranty_expiration_date || system.warrantyExpiration || "",
    expectedLifespanYears: system.expected_lifespan_years || "",
    conditionLabel: system.condition_label || HOME_SYSTEM_CONDITION_OPTIONS.find(([value]) => value === system.condition)?.[1] || "Unknown",
    serviceProvider: system.service_provider || "",
    linkedDocuments: system.linked_documents || system.linkedDocuments || [],
    linkedProjects: system.linked_projects || system.linkedProjects || [],
    linkedRequests: system.linked_requests || system.linkedRequests || [],
    linkedRecordsCount: Number(system.linked_records_count ?? 0),
    supplyRecommendations: (system.supply_recommendations || system.supplyRecommendations || []).map((recommendation) => ({
      ...recommendation,
      recommendationKey: recommendation.recommendation_key || recommendation.recommendationKey || recommendation.id || "",
      isIgnored: Boolean(recommendation.is_ignored || recommendation.isIgnored),
    })),
    maintenanceStatus: system.maintenance_status || "unknown",
    priority: system.priority || "low",
    nextRecommendedServiceDate: system.next_recommended_service_date || "",
    daysUntilDue: system.days_until_due,
    reminderReason: system.reminder_reason || "",
    recommendedAction: system.recommended_action || "",
    serviceIntervalMonths: system.service_interval_months || "",
    remindersEnabled: system.reminders_enabled !== false,
    emailRemindersEnabled: system.email_reminders_enabled !== false,
    smsRemindersEnabled: Boolean(system.sms_reminders_enabled),
    reminderLeadDays: Number(system.reminder_lead_days ?? 30),
    reminderFrequency: system.reminder_frequency || "once",
    reminderDeliveryStatus: system.reminder_delivery_status || "",
    reminderChannel: system.reminder_channel || "",
    lastNotifiedAt: system.last_notified_at || "",
    nextNotificationAt: system.next_notification_at || "",
    dismissedUntil: system.dismissed_until || "",
    isArchived: Boolean(system.is_archived || system.isArchived),
    lifecycle: {
      ...(system.lifecycle || {}),
      state: system.lifecycle?.state || "current",
      label: system.lifecycle?.label || "",
      nextAction: system.lifecycle?.next_action || "",
      linkedRequestId: system.lifecycle?.linked_request_id || system.linked_customer_request_id || "",
      linkedAgreementId: system.lifecycle?.linked_agreement_id || system.linked_agreement_id || "",
      linkedWorkOrderId: system.lifecycle?.linked_work_order_id || "",
      scheduledDate: system.lifecycle?.scheduled_date || "",
      completedAt: system.lifecycle?.completed_at || "",
    },
    isStructured: true,
  };
}

function recommendationStatusLabel(recommendation) {
  if (recommendation.kind === "end_of_life") return "Major replacement";
  if (recommendation.next_due_date) return "May be due soon";
  return "Maintenance item";
}

const RETAILER_LINKS = [
  { provider: "amazon", label: "Amazon", testId: "property-supply-amazon-link", urlKey: "amazon_url" },
  { provider: "home_depot", label: "Home Depot", testId: "property-supply-home-depot-link", urlKey: "home_depot_url" },
  { provider: "lowes", label: "Lowe's", testId: "property-supply-lowes-link", urlKey: "lowes_url" },
];

function retailerUrl(recommendation, retailer) {
  if (recommendation?.[retailer.urlKey]) return recommendation[retailer.urlKey];
  const providerLink = (recommendation?.provider_links || []).find((link) => link.provider === retailer.provider);
  if (providerLink?.url) return providerLink.url;
  const action = (recommendation?.actions || []).find((item) => item.provider === retailer.provider);
  return action?.url || "";
}

function RetailerLinks({ recommendation, compact = false }) {
  const links = RETAILER_LINKS.map((retailer) => ({ ...retailer, url: retailerUrl(recommendation, retailer) })).filter((retailer) => retailer.url);
  if (!links.length) return null;
  return (
    <>
      {links.map((retailer) => (
        <a
          key={retailer.provider}
          data-testid={retailer.testId}
          href={retailer.url}
          target="_blank"
          rel="noreferrer"
          className={`rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-amber-300/50 hover:text-white ${compact ? "text-xs" : ""}`}
        >
          {retailer.label}
        </a>
      ))}
    </>
  );
}

function SuggestedSuppliesSection({ systems = [], onCreateServiceRequest, highlightedSystemId, onIgnoreRecommendation, onRestoreRecommendation }) {
  const [viewRecommendation, setViewRecommendation] = useState(null);
  const [filter, setFilter] = useState("active");
  const recommendations = systems.flatMap((system) =>
    (system.supplyRecommendations || []).map((recommendation) => ({
      ...recommendation,
      recommendationKey: recommendation.recommendationKey || recommendation.recommendation_key || recommendation.id || "",
      isIgnored: Boolean(recommendation.isIgnored || recommendation.is_ignored),
      systemRecord: system,
    }))
  );
  const activeRecommendations = recommendations.filter((recommendation) => !recommendation.isIgnored);
  const ignoredRecommendations = recommendations.filter((recommendation) => recommendation.isIgnored);
  const visibleRecommendations = filter === "ignored" ? ignoredRecommendations : filter === "all" ? recommendations : activeRecommendations;
  if (!recommendations.length) return null;
  return (
    <Section title="Recommended Supplies" eyebrow="Helpful upkeep" testId="property-suggested-supplies">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2 text-sm leading-6 text-slate-300">
          <p>Replacement parts, filters, consumables, and upkeep items based on your Home Systems.</p>
          <p className="rounded-xl border border-amber-300/25 bg-amber-300/10 p-3 text-xs font-semibold leading-5 text-amber-100">
            Confirm size, model, quantity, and compatibility before purchasing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested supply filters">
          {[
            ["active", `Active (${activeRecommendations.length})`],
            ["ignored", `Ignored (${ignoredRecommendations.length})`],
            ["all", `All (${recommendations.length})`],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              data-testid={`property-supply-filter-${value}`}
              onClick={() => setFilter(value)}
              className={`rounded-xl border px-3 py-2 text-xs font-bold ${filter === value ? "border-amber-300/60 bg-amber-300/20 text-amber-100" : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {visibleRecommendations.length ? (
        <div className="space-y-2">
          {visibleRecommendations.slice(0, 6).map((recommendation) => {
          const isReplacement = recommendation.kind === "end_of_life";
          const actionLabel = recommendationStatusLabel(recommendation);
          const isHighlighted = String(highlightedSystemId || "") === String(recommendation.systemRecord?.id || recommendation.system_id || "");
          return (
            <article
              key={`${recommendation.systemRecord?.id || recommendation.system_id}-${recommendation.recommendationKey || recommendation.id}`}
              data-testid="property-supply-recommendation-row"
              data-system-id={recommendation.systemRecord?.id || recommendation.system_id || ""}
              className={`grid gap-3 rounded-2xl border p-3 transition md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center ${isHighlighted ? "ring-2 ring-amber-300/70" : ""} ${isReplacement ? "border-amber-300/35 bg-amber-300/10" : "border-slate-700 bg-slate-900/60"}`}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-bold text-white">{recommendation.title || recommendation.supply_name}</h4>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${isReplacement ? "border-amber-300/50 bg-amber-300/15 text-amber-100" : "border-slate-600 bg-slate-950 text-slate-300"}`}>
                    {actionLabel}
                  </span>
                  {recommendation.isIgnored ? (
                    <span className="rounded-full border border-slate-600 bg-slate-950 px-2 py-0.5 text-[11px] font-bold text-slate-300">Ignored</span>
                  ) : null}
                </div>
                <div className="mt-1 text-xs font-semibold text-slate-400">{recommendation.system} - {recommendation.system_type_label}</div>
                <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-300">{recommendation.reason}</p>
              </div>
              <dl className="grid gap-1 text-xs text-slate-400 sm:grid-cols-2 md:grid-cols-1">
                {recommendation.suggested_interval ? <div><dt className="text-slate-500">Interval</dt><dd className="font-semibold text-slate-200">{recommendation.suggested_interval}</dd></div> : null}
                {recommendation.next_due_date ? <div><dt className="text-slate-500">Next due</dt><dd className="font-semibold text-slate-200">{formatDate(recommendation.next_due_date)}</dd></div> : null}
              </dl>
              <div className="flex flex-wrap justify-start gap-2 md:justify-end">
                <button
                  type="button"
                  data-testid="property-supply-view"
                  onClick={() => setViewRecommendation(recommendation)}
                  className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-slate-400"
                >
                  View
                </button>
                {isReplacement ? (
                  <button
                    type="button"
                    data-testid="property-supply-find-contractor"
                    onClick={() => onCreateServiceRequest?.(recommendation.systemRecord)}
                    className="rounded-xl bg-sky-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
                  >
                    Find Contractor
                  </button>
                ) : null}
                <RetailerLinks recommendation={recommendation} compact />
                <button
                  type="button"
                  data-testid="property-supply-create-service-request"
                  onClick={() => onCreateServiceRequest?.(recommendation.systemRecord, recommendation)}
                  className="rounded-xl border border-sky-300/35 bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/20"
                >
                  Create Service Request
                </button>
                {recommendation.isIgnored ? (
                  <button
                    type="button"
                    data-testid="property-supply-restore"
                    onClick={() => onRestoreRecommendation?.(recommendation)}
                    className="rounded-xl border border-emerald-300/35 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/20"
                  >
                    Restore
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="property-supply-ignore"
                    onClick={() => onIgnoreRecommendation?.(recommendation)}
                    className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-slate-400"
                  >
                    Ignore
                  </button>
                )}
              </div>
            </article>
          );
          })}
        </div>
      ) : (
        <EmptyState title={filter === "ignored" ? "No ignored recommendations" : "No active recommendations"} testId="property-suggested-supplies-empty">
          {filter === "ignored"
            ? "Ignored items will appear here so you can restore them later."
            : "All current supply suggestions are hidden or there is nothing due right now."}
        </EmptyState>
      )}
      {viewRecommendation ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="Supply recommendation details">
          <div className="w-full max-w-lg rounded-3xl border border-amber-300/35 bg-slate-950 p-5 shadow-2xl">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-amber-200">Maintenance item</div>
            <h3 className="mt-1 text-xl font-extrabold text-white">{viewRecommendation.title || viewRecommendation.supply_name}</h3>
            <p className="mt-2 text-sm font-semibold text-slate-300">{viewRecommendation.system} - {viewRecommendation.system_type_label}</p>
            <p className="mt-3 text-sm leading-6 text-slate-300">{viewRecommendation.reason}</p>
            {viewRecommendation.safety_note || viewRecommendation.kind === "end_of_life" ? (
              <p className="mt-3 rounded-xl border border-sky-300/25 bg-sky-400/10 p-3 text-sm font-semibold leading-6 text-sky-100">
                {viewRecommendation.safety_note || "For electrical, gas, roofing, structural, or major plumbing work, hire a qualified professional."}
              </p>
            ) : null}
            <p className="mt-3 rounded-xl border border-amber-300/25 bg-amber-300/10 p-3 text-sm font-semibold leading-6 text-amber-100">
              Confirm size, model, quantity, and compatibility before purchasing.
            </p>
            <div className="mt-5 flex flex-wrap justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <RetailerLinks recommendation={viewRecommendation} />
              </div>
              <button
                type="button"
                onClick={() => setViewRecommendation(null)}
                className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

function PropertySummarySection({ profile, profileOptions, rentalToolsEnabled = false, onSelectProperty, onEdit, onAdd, onAddUnit, onAddTenant }) {
  const details = [
    ["Property Type", profile?.property_type_label],
    ["Year Built", profile?.year_built],
    ["Square Feet", profile?.square_feet ? Number(profile.square_feet).toLocaleString() : ""],
    ["Bedrooms", profile?.bedrooms],
    ["Bathrooms", profile?.bathrooms],
  ];
  const activeTenantCount = (profile?.tenants || []).filter((tenant) => tenant?.status === "active").length;
  const openMaintenanceCount = (profile?.tenant_maintenance_requests || []).filter(
    (request) => !["closed", "rejected"].includes(request?.status)
  ).length;
  const rentalStats = [
    ["Units", profile?.unit_count ?? (profile?.units || []).length],
    ["Active Tenants", activeTenantCount],
    ["Open Maintenance", openMaintenanceCount],
  ];
  return (
    <section data-testid="property-command-summary" className="rounded-3xl border border-amber-300/35 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.18),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(12,74,110,0.5))] p-5 shadow-2xl shadow-slate-950/30 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">Property Summary</div>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-white">{profile?.display_name || "Primary Property"}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200">{profile?.address || "Address not set"}</p>
          {profile?.is_primary ? (
            <span className="mt-3 inline-flex rounded-full border border-amber-300/45 bg-amber-300/15 px-2.5 py-1 text-xs font-semibold text-amber-100">
              Primary Property
            </span>
          ) : null}
          {profile?.is_rental_property || rentalToolsEnabled ? (
            <span
              data-testid="property-summary-rental-badge"
              className="ml-2 mt-3 inline-flex rounded-full border border-sky-300/45 bg-sky-400/10 px-2.5 py-1 text-xs font-semibold text-sky-100"
            >
              Rental Property
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="property-summary-edit" onClick={onEdit} className="rounded-xl border border-sky-300/35 bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/20">
            Edit Property
          </button>
          {rentalToolsEnabled ? (
            <>
              <button type="button" data-testid="property-summary-add-unit" onClick={onAddUnit} className="rounded-xl border border-slate-500 bg-slate-950/60 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-sky-300/50">
                Add Unit
              </button>
              <button type="button" data-testid="property-summary-add-tenant" onClick={onAddTenant} className="rounded-xl border border-slate-500 bg-slate-950/60 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-sky-300/50">
                Add Tenant
              </button>
            </>
          ) : null}
          <button type="button" data-testid="property-summary-add" onClick={onAdd} className="rounded-xl border border-amber-300/45 bg-amber-300/15 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/25">
            Add Property
          </button>
        </div>
      </div>
      {rentalToolsEnabled ? (
        <dl data-testid="property-summary-rental-stats" className="mt-5 grid gap-2 sm:grid-cols-3">
          {rentalStats.map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-sky-300/15 bg-slate-950/45 p-3">
              <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
              <dd className="mt-1 text-lg font-bold text-white">{Number(value || 0).toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {profileOptions.length > 1 ? (
        <label className="mt-5 block text-sm font-semibold text-slate-200">
          Switch property
          <select
            data-testid="property-summary-selector"
            value={profile?.id || ""}
            onChange={(event) => onSelectProperty?.(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400 sm:max-w-md"
          >
            {profileOptions.map((property) => (
              <option key={property.id} value={property.id}>{property.display_name || property.address || "Property"}</option>
            ))}
          </select>
        </label>
      ) : null}
      <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {details.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
            <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
            <dd className="mt-1 text-sm font-semibold text-white">{value || "Not recorded yet"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function PropertyUnitModal({ mode = "add", unit = null, saving = false, onClose, onSubmit }) {
  const [form, setForm] = useState(() => ({
    ...emptyUnitForm,
    ...(unit || {}),
    unit_type: unit?.unit_type || "whole_property",
    status: unit?.status || "active",
  }));

  useEffect(() => {
    setForm({
      ...emptyUnitForm,
      ...(unit || {}),
      unit_type: unit?.unit_type || "whole_property",
      status: unit?.status || "active",
    });
  }, [unit]);

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const isEdit = mode === "edit";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6">
      <form
        data-testid={isEdit ? "property-unit-edit-modal" : "property-unit-add-modal"}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.(form);
        }}
        className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Property Units</div>
            <h3 className="mt-1 text-lg font-semibold text-white">{isEdit ? "Edit Unit" : "Add Unit"}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500">
            Close
          </button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-200">
            Unit label
            <input
              data-testid="property-unit-label"
              required
              value={form.unit_label || ""}
              onChange={(event) => update("unit_label", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Unit type
            <select
              data-testid="property-unit-type"
              value={form.unit_type || "whole_property"}
              onChange={(event) => update("unit_type", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            >
              {PROPERTY_UNIT_TYPE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Status
            <select
              data-testid="property-unit-status"
              value={form.status || "active"}
              onChange={(event) => update("status", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            >
              {PROPERTY_UNIT_STATUS_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
            Access notes
            <textarea
              data-testid="property-unit-access-notes"
              rows={3}
              value={form.access_notes || ""}
              onChange={(event) => update("access_notes", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
            Notes
            <textarea
              data-testid="property-unit-notes"
              rows={3}
              value={form.notes || ""}
              onChange={(event) => update("notes", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-500">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            data-testid={isEdit ? "property-unit-save-edit" : "property-unit-save-add"}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
          >
            {saving ? "Saving..." : isEdit ? "Save Unit" : "Add Unit"}
          </button>
        </div>
      </form>
    </div>
  );
}

function expandUnitLabelToken(token) {
  const text = String(token || "").trim();
  if (!text) return [];
  const numeric = text.match(/^(\d+)\s*-\s*(\d+)$/);
  if (numeric) {
    const start = Number(numeric[1]);
    const end = Number(numeric[2]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || end - start > 300) return [text];
    const width = numeric[1].length;
    return Array.from({ length: end - start + 1 }, (_, index) => String(start + index).padStart(width, "0"));
  }
  const alphaNumeric = text.match(/^([A-Za-z]+)(\d+)\s*-\s*([A-Za-z]+)(\d+)$/);
  if (alphaNumeric && alphaNumeric[1].toLowerCase() === alphaNumeric[3].toLowerCase()) {
    const prefix = alphaNumeric[1];
    const start = Number(alphaNumeric[2]);
    const end = Number(alphaNumeric[4]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || end - start > 300) return [text];
    const width = alphaNumeric[2].length;
    return Array.from({ length: end - start + 1 }, (_, index) => `${prefix}${String(start + index).padStart(width, "0")}`);
  }
  return [text];
}

function parseBulkUnitLabels(value) {
  const seen = new Set();
  const labels = [];
  String(value || "")
    .split(/[\n,]+/)
    .flatMap(expandUnitLabelToken)
    .forEach((label) => {
      const trimmed = String(label || "").trim();
      const key = trimmed.toLowerCase();
      if (!trimmed || seen.has(key)) return;
      seen.add(key);
      labels.push(trimmed);
    });
  return labels;
}

function BulkUnitModal({ units = [], saving = false, onClose, onSubmit }) {
  const [text, setText] = useState("");
  const [unitType, setUnitType] = useState("apartment");
  const labels = useMemo(() => parseBulkUnitLabels(text), [text]);
  const existing = useMemo(
    () => new Set((units || []).filter((unit) => unit.status !== "inactive").map((unit) => String(unit.unit_label || "").trim().toLowerCase()).filter(Boolean)),
    [units]
  );
  const newLabels = labels.filter((label) => !existing.has(label.toLowerCase()));
  const duplicateLabels = labels.filter((label) => existing.has(label.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6">
      <form
        data-testid="property-unit-bulk-modal"
        onSubmit={(event) => {
          event.preventDefault();
          if (!newLabels.length) return;
          onSubmit?.({ unit_labels: newLabels, unit_type: unitType, status: "active" });
        }}
        className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Property Units</div>
            <h3 className="mt-1 text-lg font-semibold text-white">Bulk Add Units</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500">
            Close
          </button>
        </div>
        <label className="mt-5 block text-sm font-medium text-slate-200">
          Unit labels
          <textarea
            data-testid="property-unit-bulk-text"
            rows={6}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Paste or type unit labels, one per line or comma separated"
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-sky-400"
          />
        </label>
        <p className="mt-2 text-xs leading-5 text-slate-400">Ranges like 101-112 and A1-A12 are supported.</p>
        <label className="mt-4 block text-sm font-medium text-slate-200">
          Default unit type
          <select
            data-testid="property-unit-bulk-type"
            value={unitType}
            onChange={(event) => setUnitType(event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400 sm:max-w-xs"
          >
            {PROPERTY_UNIT_TYPE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/60 p-3">
          <div className="text-sm font-semibold text-white">Preview</div>
          <div data-testid="property-unit-bulk-preview" className="mt-2 flex flex-wrap gap-2">
            {newLabels.length ? newLabels.slice(0, 60).map((label) => (
              <span key={label} className="rounded-full border border-sky-300/35 bg-sky-400/10 px-2 py-1 text-xs font-semibold text-sky-100">{label}</span>
            )) : <span className="text-xs text-slate-400">No new units ready yet.</span>}
          </div>
          {newLabels.length > 60 ? <div className="mt-2 text-xs text-slate-400">And {newLabels.length - 60} more.</div> : null}
          {duplicateLabels.length ? <div data-testid="property-unit-bulk-duplicates" className="mt-2 text-xs text-amber-100">Skipping existing active units: {duplicateLabels.join(", ")}</div> : null}
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-500">Cancel</button>
          <button type="submit" disabled={saving || !newLabels.length} data-testid="property-unit-bulk-save" className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50">
            {saving ? "Saving..." : `Create ${newLabels.length || ""} Units`.trim()}
          </button>
        </div>
      </form>
    </div>
  );
}

function PropertyUnitsSection({ units = [], saving = false, expanded = false, onToggle, openAddSignal = 0, onAdd, onBulkAdd, onEdit, onDisable }) {
  const [modalMode, setModalMode] = useState("");
  const [editingUnit, setEditingUnit] = useState(null);

  useEffect(() => {
    if (!openAddSignal) return;
    setEditingUnit(null);
    setModalMode("add");
  }, [openAddSignal]);

  return (
    <section data-testid="property-units-section" className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4 shadow-xl shadow-slate-950/20">
      {modalMode ? (
        modalMode === "bulk" ? (
          <BulkUnitModal
            units={units}
            saving={saving}
            onClose={() => setModalMode("")}
            onSubmit={async (payload) => {
              await onBulkAdd?.(payload);
              setModalMode("");
            }}
          />
        ) : (
          <PropertyUnitModal
            mode={modalMode}
            unit={editingUnit}
            saving={saving}
            onClose={() => {
              setModalMode("");
              setEditingUnit(null);
            }}
            onSubmit={async (payload) => {
              if (modalMode === "edit" && editingUnit) {
                await onEdit?.(editingUnit, payload);
              } else {
                await onAdd?.(payload);
              }
              setModalMode("");
              setEditingUnit(null);
            }}
          />
        )
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <button type="button" data-testid="property-units-toggle" onClick={onToggle} className="flex flex-1 items-center justify-between gap-3 text-left">
          <span>
            <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-amber-200/80">Rental Management</span>
            <span className="mt-1 block text-lg font-semibold text-white">Manage Units</span>
            <span className="mt-1 block text-sm text-slate-400">{units.length} unit{units.length === 1 ? "" : "s"} tracked</span>
          </span>
          <span className="rounded-full border border-slate-600 px-2 py-1 text-xs font-semibold text-slate-200">{expanded ? "Collapse" : "Expand"}</span>
        </button>
        {expanded ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid="property-unit-bulk-button" onClick={() => setModalMode("bulk")} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-sky-300/50">
              Bulk Add Units
            </button>
            <button
              type="button"
              data-testid="property-unit-add-button"
              onClick={() => {
                setEditingUnit(null);
                setModalMode("add");
              }}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-sky-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
            >
              Add Unit
            </button>
          </div>
        ) : null}
      </div>
      {expanded ? (
      <div className="mt-4 space-y-2">
        {units.length ? units.map((unit) => (
          <article key={unit.id || unit.unit_label} data-testid={`property-unit-${unit.id}`} className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-bold text-white">{unit.unit_label || "Unit"}</h4>
                  <span className="rounded-full border border-slate-600 bg-slate-950 px-2 py-0.5 text-[11px] font-bold text-slate-300">
                    {unit.unit_type_label || unitTypeLabel(unit.unit_type)}
                  </span>
                  <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-[11px] font-bold text-amber-100">
                    {unit.status_label || unitStatusLabel(unit.status)}
                  </span>
                </div>
                {unit.access_notes ? <p className="mt-2 text-sm leading-5 text-slate-300">{unit.access_notes}</p> : null}
                {unit.notes ? <p className="mt-1 text-xs leading-5 text-slate-400">{unit.notes}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid={`property-unit-edit-${unit.id}`}
                  onClick={() => {
                    setEditingUnit(unit);
                    setModalMode("edit");
                  }}
                  className="min-h-9 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-sky-300/50 hover:text-white"
                >
                  Edit
                </button>
                {unit.status !== "inactive" ? (
                  <button
                    type="button"
                    data-testid={`property-unit-disable-${unit.id}`}
                    onClick={() => onDisable?.(unit)}
                    className="min-h-9 rounded-lg border border-rose-300/40 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-400/10"
                  >
                    Mark inactive
                  </button>
                ) : null}
              </div>
            </div>
          </article>
        )) : (
          <EmptyState title="No units added yet." testId="property-units-empty">
            Add units to track tenants, maintenance requests, and work orders by location.
          </EmptyState>
        )}
      </div>
      ) : null}
    </section>
  );
}

function TenantModal({ mode = "add", tenant = null, units = [], saving = false, onClose, onSubmit }) {
  const [form, setForm] = useState(() => ({
    ...emptyTenantForm,
    ...(tenant || {}),
    unit_id: tenant?.unit_id || "",
    status: tenant?.status || "pending",
    notes: tenant?.notes || "",
  }));

  useEffect(() => {
    setForm({
      ...emptyTenantForm,
      ...(tenant || {}),
      unit_id: tenant?.unit_id || "",
      status: tenant?.status || "pending",
      notes: tenant?.notes || "",
    });
  }, [tenant]);

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const isEdit = mode === "edit";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6">
      <form
        data-testid={isEdit ? "property-tenant-edit-modal" : "property-tenant-add-modal"}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.({
            ...form,
            unit_id: form.unit_id ? Number(form.unit_id) : null,
            move_in_date: form.move_in_date || null,
            move_out_date: form.move_out_date || null,
          });
        }}
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Tenants</div>
            <h3 className="mt-1 text-lg font-semibold text-white">{isEdit ? "Edit Tenant" : "Add Tenant"}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500">
            Close
          </button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-200">
            First name
            <input data-testid="property-tenant-first-name" value={form.first_name || ""} onChange={(event) => update("first_name", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Last name
            <input data-testid="property-tenant-last-name" value={form.last_name || ""} onChange={(event) => update("last_name", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Email
            <input data-testid="property-tenant-email" type="email" value={form.email || ""} onChange={(event) => update("email", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Phone
            <input data-testid="property-tenant-phone" value={form.phone || ""} onChange={(event) => update("phone", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Unit
            <select data-testid="property-tenant-unit" value={form.unit_id || ""} onChange={(event) => update("unit_id", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400">
              <option value="">No unit / whole property</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>{unit.unit_label || "Unit"}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Status
            <select data-testid="property-tenant-status" value={form.status || "pending"} onChange={(event) => update("status", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400">
              {TENANT_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Move-in date
            <input data-testid="property-tenant-move-in" type="date" value={form.move_in_date || ""} onChange={(event) => update("move_in_date", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Move-out date
            <input data-testid="property-tenant-move-out" type="date" value={form.move_out_date || ""} onChange={(event) => update("move_out_date", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Emergency contact name
            <input data-testid="property-tenant-emergency-name" value={form.emergency_contact_name || ""} onChange={(event) => update("emergency_contact_name", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Emergency contact phone
            <input data-testid="property-tenant-emergency-phone" value={form.emergency_contact_phone || ""} onChange={(event) => update("emergency_contact_phone", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm font-medium text-slate-200 sm:col-span-2">
            <input data-testid="property-tenant-maintenance-access" type="checkbox" checked={Boolean(form.maintenance_access_enabled)} onChange={(event) => update("maintenance_access_enabled", event.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-950" />
            Maintenance access enabled
          </label>
          <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
            Notes
            <textarea data-testid="property-tenant-notes" rows={3} value={form.notes || ""} onChange={(event) => update("notes", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-500">Cancel</button>
          <button type="submit" disabled={saving} data-testid={isEdit ? "property-tenant-save-edit" : "property-tenant-save-add"} className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50">
            {saving ? "Saving..." : isEdit ? "Save Tenant" : "Add Tenant"}
          </button>
        </div>
      </form>
    </div>
  );
}

function TenantsSection({ tenants = [], units = [], saving = false, expanded = false, onToggle, openAddSignal = 0, onAdd, onEdit, onFormer }) {
  const [modalMode, setModalMode] = useState("");
  const [editingTenant, setEditingTenant] = useState(null);

  useEffect(() => {
    if (!openAddSignal) return;
    setEditingTenant(null);
    setModalMode("add");
  }, [openAddSignal]);

  return (
    <section data-testid="property-tenants-section" className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4 shadow-xl shadow-slate-950/20">
      {modalMode ? (
        <TenantModal
          mode={modalMode}
          tenant={editingTenant}
          units={units}
          saving={saving}
          onClose={() => {
            setModalMode("");
            setEditingTenant(null);
          }}
          onSubmit={async (payload) => {
            if (modalMode === "edit" && editingTenant) {
              await onEdit?.(editingTenant, payload);
            } else {
              await onAdd?.(payload);
            }
            setModalMode("");
            setEditingTenant(null);
          }}
        />
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <button type="button" data-testid="property-tenants-toggle" onClick={onToggle} className="flex flex-1 items-center justify-between gap-3 text-left">
          <span>
            <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-amber-200/80">Rental Management</span>
            <span className="mt-1 block text-lg font-semibold text-white">Manage Tenants</span>
            <span className="mt-1 block text-sm text-slate-400">{tenants.length} tenant{tenants.length === 1 ? "" : "s"} tracked</span>
          </span>
          <span className="rounded-full border border-slate-600 px-2 py-1 text-xs font-semibold text-slate-200">{expanded ? "Collapse" : "Expand"}</span>
        </button>
        {expanded ? (
          <button type="button" data-testid="property-tenant-add-button" onClick={() => { setEditingTenant(null); setModalMode("add"); }} className="inline-flex min-h-10 items-center justify-center rounded-xl bg-sky-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400">
            Add Tenant
          </button>
        ) : null}
      </div>
      {expanded ? (
      <div className="mt-4 space-y-2">
        {tenants.length ? tenants.map((tenant) => (
          <article key={tenant.id || tenant.email} data-testid={`property-tenant-${tenant.id}`} className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-bold text-white">{tenant.name || `${tenant.first_name || ""} ${tenant.last_name || ""}`.trim() || "Tenant"}</h4>
                  <span className="rounded-full border border-slate-600 bg-slate-950 px-2 py-0.5 text-[11px] font-bold text-slate-300">{tenantStatusLabel(tenant.status)}</span>
                  <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-[11px] font-bold text-amber-100">{tenant.unit_label || "No unit"}</span>
                  {tenant.maintenance_access_enabled ? <span className="rounded-full border border-emerald-300/40 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-bold text-emerald-100">Maintenance access</span> : null}
                </div>
                <div className="mt-2 grid gap-1 text-xs text-slate-400 sm:grid-cols-2">
                  <div>{tenant.email || "No email"}</div>
                  <div>{tenant.phone || "No phone"}</div>
                </div>
                {tenant.notes ? <p className="mt-2 text-xs leading-5 text-slate-400">{tenant.notes}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" data-testid={`property-tenant-edit-${tenant.id}`} onClick={() => { setEditingTenant(tenant); setModalMode("edit"); }} className="min-h-9 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-sky-300/50 hover:text-white">Edit</button>
                {tenant.status !== "former" ? (
                  <button type="button" data-testid={`property-tenant-former-${tenant.id}`} onClick={() => onFormer?.(tenant)} className="min-h-9 rounded-lg border border-rose-300/40 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-400/10">Mark Former</button>
                ) : null}
              </div>
            </div>
          </article>
        )) : (
          <EmptyState title="No tenants added yet." testId="property-tenants-empty">
            Add tenants so maintenance requests can be tied to the right property, unit, and resident.
          </EmptyState>
        )}
      </div>
      ) : null}
    </section>
  );
}

function systemRecommendationPreview(system) {
  const supplyCount = (system.supplyRecommendations || []).length;
  const maintenanceText = (() => {
    if (system.maintenanceStatus && !["current", "unknown"].includes(system.maintenanceStatus)) {
      return system.reminderReason || system.recommendedAction || `${MAINTENANCE_STATUS_LABELS[system.maintenanceStatus] || "Maintenance"} recommendation`;
    }
    return "";
  })();
  const reminderText = (() => {
    if (system.nextNotificationAt) return `Next reminder ${formatDate(system.nextNotificationAt)}`;
    if (system.nextRecommendedServiceDate) return `${formatDate(system.nextRecommendedServiceDate)} suggested service`;
    if (system.warrantyExpiration) return `Warranty through ${formatDate(system.warrantyExpiration)}`;
    return "";
  })();
  const hasRecommendations = Boolean(maintenanceText || supplyCount || reminderText);
  return { supplyCount, maintenanceText, reminderText, hasRecommendations };
}

function recommendationAccuracyPrompt(system) {
  const typeText = `${system.system_type || ""} ${system.system_type_label || ""} ${system.name || ""}`.toLowerCase();
  const supportedType =
    typeText.includes("hvac") ||
    typeText.includes("appliance") ||
    typeText.includes("water heater") ||
    typeText.includes("pool") ||
    typeText.includes("spa");
  if (!supportedType) return null;
  const missing = [
    !system.manufacturer ? "Manufacturer" : "",
    !system.model ? "Model Number" : "",
    !system.notes ? "Notes" : "",
  ].filter(Boolean);
  const missingCoreFields = missing.includes("Manufacturer") || missing.includes("Model Number");
  if (!missingCoreFields) return null;
  return {
    missing,
    summary: "Better system information improves maintenance reminders, supply suggestions, and replacement planning.",
  };
}

function formatSystemDetail(label, value) {
  const text = String(value || "").trim();
  return text ? `* ${label}: ${text}` : "";
}

function requestDraftFromSystemRecommendation(system = {}, recommendation = {}) {
  const title = `${system.name || recommendation.system || "Home System"} Maintenance - ${recommendation.title || recommendation.supply_name || "Recommended Item"}`;
  const status = recommendationStatusLabel(recommendation);
  const systemDetails = [
    formatSystemDetail("System", system.name || recommendation.system),
    formatSystemDetail("Type", system.system_type_label || recommendation.system_type_label),
    formatSystemDetail("Manufacturer", system.manufacturer),
    formatSystemDetail("Model", system.model),
    formatSystemDetail("Serial number", system.serialNumber),
    formatSystemDetail("Install date", system.installDate ? formatDate(system.installDate) : ""),
    formatSystemDetail("Warranty expiration", system.warrantyExpiration ? formatDate(system.warrantyExpiration) : ""),
    formatSystemDetail("Condition", system.conditionLabel),
    formatSystemDetail("Lifecycle", system.lifecycle?.label),
    formatSystemDetail("Last service", system.lastServiceDate ? formatDate(system.lastServiceDate) : ""),
    formatSystemDetail("Next service", system.nextRecommendedServiceDate ? formatDate(system.nextRecommendedServiceDate) : ""),
  ].filter(Boolean);
  const recommendationDetails = [
    formatSystemDetail("Recommended item", recommendation.title || recommendation.supply_name),
    formatSystemDetail("Recommendation key", recommendation.recommendationKey || recommendation.recommendation_key || recommendation.id),
    formatSystemDetail("Suggested interval", recommendation.suggested_interval),
    formatSystemDetail("Status", status),
    formatSystemDetail("Maintenance reason", system.reminderReason || recommendation.reason),
    formatSystemDetail("Compatibility note", recommendation.compatibility_warning),
  ].filter(Boolean);
  return {
    property_id: system.property_profile_id || system.propertyId || "",
    request_type: "maintenance",
    project_mode: "diy_assist",
    project_category: "Maintenance",
    project_type: system.system_type_label || recommendation.system_type_label || "Maintenance",
    project_subtype: recommendation.title || recommendation.supply_name || "Recommended Maintenance",
    payment_preference: "discuss",
    title,
    description: [
      `I would like assistance with a recommended maintenance item for my ${system.name || recommendation.system || "home system"} system.`,
      "",
      "Recommended item:",
      recommendation.title || recommendation.supply_name || "Recommended maintenance item",
      "",
      "System details:",
      ...systemDetails,
      "",
      "Recommendation details:",
      ...recommendationDetails,
      "",
      "Please review the system and advise whether replacement or service is needed.",
    ].join("\n"),
    urgency: system.priority === "high" ? "urgent" : recommendation.next_due_date ? "soon" : "normal",
    preferred_timeline: recommendation.next_due_date || system.maintenanceStatus === "overdue" ? "As soon as possible" : "Within the next month",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    postal_code: "",
    linked_home_system_id: system.id,
    recommendation_key: recommendation.recommendationKey || recommendation.recommendation_key || recommendation.id || "",
    recommendation_title: recommendation.title || recommendation.supply_name || "",
    recommendation_context: {
      source: "home_system_recommendation",
      system_id: system.id,
      system_name: system.name || recommendation.system || "",
      system_type: system.system_type || recommendation.system_type || "",
      system_type_label: system.system_type_label || recommendation.system_type_label || "",
      manufacturer: system.manufacturer || "",
      model_number: system.model || "",
      serial_number: system.serialNumber || "",
      install_date: system.installDate || "",
      warranty_expiration_date: system.warrantyExpiration || "",
      condition: system.condition || "",
      condition_label: system.conditionLabel || "",
      lifecycle_state: system.lifecycle?.state || "",
      lifecycle_label: system.lifecycle?.label || "",
      last_service_date: system.lastServiceDate || "",
      next_service_date: system.nextRecommendedServiceDate || "",
      recommendation_key: recommendation.recommendationKey || recommendation.recommendation_key || recommendation.id || "",
      recommendation_title: recommendation.title || recommendation.supply_name || "",
      suggested_interval: recommendation.suggested_interval || "",
      due_status: status,
      reason: recommendation.reason || "",
      maintenance_reason: system.reminderReason || "",
      compatibility_warning: recommendation.compatibility_warning || "",
      notes: recommendation.safety_note || "",
    },
  };
}

function homeSystemStatus(system) {
  const lifecycleState = system.lifecycle?.state || "";
  if (system.isArchived) return { key: "archived", label: "Archived" };
  if (lifecycleState === "service_requested") return { key: "service_requested", label: "Service Requested" };
  if (lifecycleState === "sent_to_contractors") return { key: "sent_to_contractors", label: "Sent to Contractors" };
  if (lifecycleState === "scheduled") return { key: "scheduled", label: "Scheduled" };
  if (lifecycleState === "in_progress") return { key: "in_progress", label: "In Progress" };
  if (["completed", "resolved"].includes(lifecycleState) || system.reminderDeliveryStatus === "resolved") {
    return { key: "completed", label: "Completed" };
  }
  if (["overdue", "warranty_expired", "lifespan_attention"].includes(system.maintenanceStatus)) {
    return { key: "maintenance_past_due", label: "Maintenance Past Due" };
  }
  if (["due_soon", "warranty_expiring"].includes(system.maintenanceStatus)) {
    return { key: "due_soon", label: "Due Soon" };
  }
  return { key: "current", label: "Current" };
}

function homeSystemStatusClass(key) {
  if (key === "maintenance_past_due") return "border-rose-300/50 bg-rose-400/15 text-rose-100";
  if (key === "due_soon") return "border-amber-300/50 bg-amber-300/15 text-amber-100";
  if (["service_requested", "sent_to_contractors", "scheduled", "in_progress"].includes(key)) return "border-sky-300/45 bg-sky-400/10 text-sky-100";
  if (key === "completed" || key === "current") return "border-emerald-300/45 bg-emerald-400/10 text-emerald-100";
  if (key === "archived") return "border-slate-600 bg-slate-900 text-slate-300";
  return "border-slate-600 bg-slate-950 text-slate-300";
}

function HomeSystemDetails({ system, onEdit, onArchive, onViewRecommendations, onScan }) {
  const preview = systemRecommendationPreview(system);
  const accuracyPrompt = recommendationAccuracyPrompt(system);
  return (
    <div data-testid={`property-home-system-details-${system.id}`} className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
      <div className="grid gap-3 md:grid-cols-3">
        {[
          ["Manufacturer", system.manufacturer],
          ["Model", system.model],
          ["Serial", system.serialNumber],
          ["Install date", system.installDate ? formatDate(system.installDate) : ""],
          ["Warranty expiration", system.warrantyExpiration ? formatDate(system.warrantyExpiration) : ""],
          ["Linked records", system.linkedRecordsCount],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">{value || "Not recorded yet"}</div>
          </div>
        ))}
      </div>
      {system.notes ? <p className="mt-4 text-sm leading-6 text-slate-300">{system.notes}</p> : null}
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-3" data-testid={`property-home-system-recommendation-preview-${system.id}`}>
          {preview.hasRecommendations ? (
            <div className="space-y-2 text-xs text-slate-300">
              {preview.maintenanceText ? (
                <div>
                  <div className="font-bold text-slate-100">Maintenance</div>
                  <p className="mt-0.5 line-clamp-2">{preview.maintenanceText}</p>
                </div>
              ) : null}
              {preview.supplyCount ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold text-slate-100">Supplies</span>
                  <span>{preview.supplyCount} suggested item{preview.supplyCount === 1 ? "" : "s"}</span>
                </div>
              ) : null}
              {preview.reminderText ? (
                <div>
                  <div className="font-bold text-slate-100">Reminders</div>
                  <p className="mt-0.5">{preview.reminderText}</p>
                </div>
              ) : null}
              <button
                type="button"
                data-testid={`property-home-system-view-recommendations-${system.id}`}
                onClick={() => onViewRecommendations?.(system)}
                className="mt-1 rounded-xl border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-xs font-bold text-amber-100 hover:bg-amber-300/20"
              >
                View Recommendations
              </button>
            </div>
          ) : (
            <p className="text-xs font-semibold text-slate-400">No current recommendations</p>
          )}
        </div>
        {accuracyPrompt ? (
          <div className="rounded-2xl border border-sky-300/25 bg-sky-400/10 p-3" data-testid={`property-home-system-accuracy-prompt-${system.id}`}>
            <div className="text-xs font-bold uppercase tracking-wide text-sky-100">Improve recommendation accuracy</div>
            <div className="mt-2 text-xs font-semibold text-slate-200">Add:</div>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-300">
              {accuracyPrompt.missing.map((field) => <li key={field}>{field}</li>)}
            </ul>
            <p className="mt-2 text-xs leading-5 text-slate-300">{accuracyPrompt.summary}</p>
            <button
              type="button"
              data-testid={`property-home-system-accuracy-edit-${system.id}`}
              onClick={() => onEdit?.(system)}
              className="mt-3 rounded-xl border border-sky-300/35 bg-sky-400/10 px-3 py-2 text-xs font-bold text-sky-100 hover:bg-sky-400/20"
            >
              Edit System
            </button>
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" data-testid={`property-home-system-scan-${system.id}`} onClick={() => onScan?.(system)} className="rounded-xl border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/20">
          Scan Document / Label
        </button>
        <button type="button" data-testid={`property-home-system-edit-${system.id}`} onClick={() => onEdit?.(system)} className="rounded-xl border border-sky-300/35 bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/20">
          Edit System
        </button>
        {system.isStructured ? (
          <button type="button" data-testid={`property-home-system-archive-${system.id}`} onClick={() => onArchive?.(system)} className="rounded-xl border border-red-300/35 bg-red-400/10 px-3 py-2 text-sm font-semibold text-red-100 hover:bg-red-400/20">
            Archive
          </button>
        ) : null}
      </div>
    </div>
  );
}

function HomeSystemsSection({ systems = [], onAdd, onEdit, onArchive, onViewRecommendations, onScan }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [viewMode, setViewMode] = useState("list");
  const [expandedId, setExpandedId] = useState("");
  const rows = systems.map((system) => ({ ...system, status: homeSystemStatus(system) }));
  const filteredSystems = rows.filter((system) => {
    const matchesQuery = !query.trim() || `${system.name} ${system.system_type_label} ${system.manufacturer} ${system.model}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "all" || system.status.key === filter;
    return matchesQuery && matchesFilter;
  });
  const counts = {
    all: systems.length,
    current: rows.filter((system) => system.status.key === "current").length,
    due_soon: rows.filter((system) => system.status.key === "due_soon").length,
    maintenance_past_due: rows.filter((system) => system.status.key === "maintenance_past_due").length,
    service_requested: rows.filter((system) => system.status.key === "service_requested").length,
    sent_to_contractors: rows.filter((system) => system.status.key === "sent_to_contractors").length,
    scheduled: rows.filter((system) => system.status.key === "scheduled").length,
    in_progress: rows.filter((system) => system.status.key === "in_progress").length,
    completed: rows.filter((system) => system.status.key === "completed").length,
    archived: rows.filter((system) => system.status.key === "archived").length,
  };
  const renderGridCard = (system) => (
    <article key={system.id || system.name} data-testid={`property-home-system-${String(system.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-white">{system.name}</h4>
          <div className="mt-1 text-xs font-semibold text-slate-400">{system.manufacturer || system.system_type_label} {system.model || ""}</div>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${homeSystemStatusClass(system.status.key)}`}>{system.status.label}</span>
      </div>
      <dl className="mt-3 grid gap-2 text-xs text-slate-300">
        <div><dt className="text-slate-500">Next service</dt><dd className="font-semibold text-slate-100">{system.nextRecommendedServiceDate ? formatDate(system.nextRecommendedServiceDate) : "Not scheduled"}</dd></div>
        <div><dt className="text-slate-500">Last service</dt><dd className="font-semibold text-slate-100">{system.lastServiceDate ? formatDate(system.lastServiceDate) : "No service record yet"}</dd></div>
        <div><dt className="text-slate-500">Condition</dt><dd className="font-semibold text-slate-100">{system.conditionLabel || "Unknown"}</dd></div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" data-testid={`property-home-system-view-${system.id}`} onClick={() => setExpandedId((value) => String(value) === String(system.id) ? "" : system.id)} className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-slate-400">View</button>
        <button type="button" data-testid={`property-home-system-scan-${system.id}`} onClick={() => onScan?.(system)} className="rounded-xl border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/20">Scan</button>
        <button type="button" data-testid={`property-home-system-edit-${system.id}`} onClick={() => onEdit?.(system)} className="rounded-xl border border-sky-300/35 bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/20">Edit</button>
      </div>
      {String(expandedId) === String(system.id) ? <div className="mt-4"><HomeSystemDetails system={system} onEdit={onEdit} onArchive={onArchive} onViewRecommendations={onViewRecommendations} onScan={onScan} /></div> : null}
    </article>
  );
  return (
    <Section title="Home Systems" eyebrow="Systems and components" testId="property-home-systems">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-6 text-slate-300">
          Track HVAC, roof, water heater, electrical, plumbing, appliances, warranties, service dates, and linked records.
        </p>
        <button
          type="button"
          data-testid="property-home-system-add"
          onClick={onAdd}
          className="inline-flex min-h-10 items-center justify-center rounded-xl border border-amber-300/45 bg-amber-300/15 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/25"
        >
          Add System
        </button>
      </div>
      {systems.length ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row">
              <input
                data-testid="property-home-system-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search systems..."
                className="min-h-10 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-sky-400"
              />
              <select
                data-testid="property-home-system-filter"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                className="min-h-10 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-sky-400"
              >
                <option value="all">All Systems ({counts.all})</option>
                <option value="current">Current ({counts.current})</option>
                <option value="due_soon">Due Soon ({counts.due_soon})</option>
                <option value="maintenance_past_due">Maintenance Past Due ({counts.maintenance_past_due})</option>
                <option value="service_requested">Service Requested ({counts.service_requested})</option>
                <option value="sent_to_contractors">Sent to Contractors ({counts.sent_to_contractors})</option>
                <option value="scheduled">Scheduled ({counts.scheduled})</option>
                <option value="in_progress">In Progress ({counts.in_progress})</option>
                <option value="completed">Completed ({counts.completed})</option>
                <option value="archived">Archived ({counts.archived})</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                ["list", "List"],
                ["grid", "Grid"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`property-home-system-view-${value}`}
                  onClick={() => setViewMode(value)}
                  className={`rounded-xl border px-3 py-2 text-sm font-bold ${viewMode === value ? "border-amber-300/60 bg-amber-300/20 text-amber-100" : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {filteredSystems.length ? (
            viewMode === "grid" ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filteredSystems.map(renderGridCard)}</div>
            ) : (
              <div data-testid="property-home-systems-list" className="overflow-hidden rounded-2xl border border-slate-800">
                <div className="hidden grid-cols-[minmax(220px,1.4fr)_110px_140px_150px_130px_130px_170px] gap-3 bg-slate-950 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-400 xl:grid">
                  <div>System</div><div>Type</div><div>Status</div><div>Next Service</div><div>Last Service</div><div>Condition</div><div>Actions</div>
                </div>
                <div className="divide-y divide-slate-800">
                  {filteredSystems.map((system) => (
                    <div key={system.id || system.name} data-testid={`property-home-system-${String(system.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                      <div className="grid gap-3 px-4 py-3 xl:grid-cols-[minmax(220px,1.4fr)_110px_140px_150px_130px_130px_170px] xl:items-center">
                        <div>
                          <div className="text-sm font-bold text-white">{system.name}</div>
                          <div className="mt-1 text-xs font-semibold text-slate-400">{[system.manufacturer, system.model].filter(Boolean).join(" ") || "System details not recorded"}</div>
                        </div>
                        <div className="text-sm font-semibold text-slate-200">{system.system_type_label || "System"}</div>
                        <div><span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold ${homeSystemStatusClass(system.status.key)}`}>{system.status.label}</span></div>
                        <div className="text-sm text-slate-200">{system.nextRecommendedServiceDate ? formatDate(system.nextRecommendedServiceDate) : "Not scheduled"}</div>
                        <div className="text-sm text-slate-300">{system.lastServiceDate ? formatDate(system.lastServiceDate) : "Not recorded"}</div>
                        <div className="text-sm text-slate-200">{system.conditionLabel || "Unknown"}</div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" data-testid={`property-home-system-view-${system.id}`} onClick={() => setExpandedId((value) => String(value) === String(system.id) ? "" : system.id)} className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-slate-400">View</button>
                          <button type="button" data-testid={`property-home-system-scan-${system.id}`} onClick={() => onScan?.(system)} className="rounded-xl border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/20">Scan</button>
                          <button type="button" data-testid={`property-home-system-edit-${system.id}`} onClick={() => onEdit?.(system)} className="rounded-xl border border-sky-300/35 bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/20">Edit</button>
                        </div>
                      </div>
                      {String(expandedId) === String(system.id) ? (
                        <div className="px-4 pb-4">
                          <HomeSystemDetails system={system} onEdit={onEdit} onArchive={onArchive} onViewRecommendations={onViewRecommendations} onScan={onScan} />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : (
            <EmptyState title="No systems match those filters" testId="property-home-systems-filter-empty">
              Try another search term or show all systems.
            </EmptyState>
          )}
          <div className="text-sm font-semibold text-slate-300">Showing {filteredSystems.length ? `1 to ${filteredSystems.length}` : "0"} of {systems.length} systems</div>
        </div>
      ) : (
        <EmptyState title="No systems recorded yet" testId="property-home-systems-empty">
          Add major systems like HVAC, roof, water heater, electrical panel, plumbing, appliances, solar, pool, or septic records.
        </EmptyState>
      )}
    </Section>
  );
}

const MAINTENANCE_STATUS_LABELS = {
  overdue: "Maintenance Past Due",
  due_soon: "Due Soon",
  warranty_expiring: "Warranty Expiring",
  warranty_expired: "Warranty Attention",
  lifespan_attention: "Nearing End of Life",
  current: "Current",
  unknown: "Unknown",
};

const MAINTENANCE_PRIORITY_LABELS = {
  high: "Needs attention",
  medium: "Plan soon",
  low: "For awareness",
};

function reminderDeliveryLabel(system) {
  const channels = [
    system.emailRemindersEnabled ? "Email reminders" : "",
    system.smsRemindersEnabled ? "Text reminders" : "",
  ].filter(Boolean);
  return channels.join(" and ") || "Reminders off";
}

function homeownerMaintenanceText(value, fallback = "") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text
    .replace(/\s*Confidence is [^.]+ based on available records\.?/gi, "")
    .replace(/\s*confidence[:\s][^.]+\.?/gi, "")
    .trim() || fallback;
}

function MaintenanceCenter({ intelligence = {}, maintenance = [], systems = [], onMarkServiced, onEditSystem, onCreateServiceRequest, onDismissReminder, onOpenRequest }) {
  const health = intelligence?.health || {};
  const buckets = intelligence?.buckets || {};
  const groupedSystems = {
    overdue: systems.filter((system) => ["overdue", "warranty_expired"].includes(system.maintenanceStatus)),
    due_soon: systems.filter((system) => system.maintenanceStatus === "due_soon"),
    warranty_expiring: systems.filter((system) => system.maintenanceStatus === "warranty_expiring"),
    lifespan_attention: systems.filter((system) => system.maintenanceStatus === "lifespan_attention"),
    current: systems.filter((system) => system.maintenanceStatus === "current"),
    unknown: systems.filter((system) => system.maintenanceStatus === "unknown"),
  };
  const cards = [
    { label: "Maintenance status", value: health.label || "Needs Attention", body: homeownerMaintenanceText(health.summary, "Add service records to improve future reminders."), target: groupedSystems.overdue.length ? "overdue" : groupedSystems.due_soon.length ? "due_soon" : "" },
    { label: "Due soon", value: `${groupedSystems.due_soon.length + groupedSystems.warranty_expiring.length || (buckets.upcoming || []).length}`, body: groupedSystems.due_soon[0]?.name || groupedSystems.warranty_expiring[0]?.name || (buckets.upcoming || [])[0]?.title || "No upcoming suggestions right now.", target: groupedSystems.due_soon.length ? "due_soon" : groupedSystems.warranty_expiring.length ? "warranty_expiring" : "" },
    { label: "Completed service", value: `${maintenance.filter((row) => String(row.status).toLowerCase().includes("complete")).length}`, body: "Completed service visits linked to this property.", target: "current" },
    { label: "Needs attention", value: `${groupedSystems.overdue.length || (buckets.needs_attention || []).length}`, body: groupedSystems.overdue[0]?.name || (buckets.needs_attention || [])[0]?.title || "No overdue items detected.", target: groupedSystems.overdue.length ? "overdue" : "" },
  ];
  const scrollToGroup = (key) => {
    if (!key) return;
    document.querySelector(`[data-testid='property-maintenance-group-${key}']`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const renderSystemCard = (system) => (
    <article key={system.id} data-testid="property-maintenance-reminder-card" className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-white">{system.name}</div>
          <div className="mt-1 text-xs text-slate-400">{system.system_type_label || "Home system"} - {MAINTENANCE_STATUS_LABELS[system.maintenanceStatus] || "Unknown"}</div>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${system.priority === "high" ? "border-rose-300/50 bg-rose-400/15 text-rose-100" : system.priority === "medium" ? "border-amber-300/50 bg-amber-300/15 text-amber-100" : "border-slate-600 bg-slate-900 text-slate-300"}`}>
          {MAINTENANCE_PRIORITY_LABELS[system.priority] || "For awareness"}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-300">{system.reminderReason || "Add service and warranty records to improve future reminders."}</p>
      {system.lifecycle?.label ? (
        <div className="mt-3 rounded-2xl border border-sky-300/25 bg-sky-400/10 p-3" data-testid={`property-maintenance-lifecycle-${system.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-sky-100">Service lifecycle</div>
              <p className="mt-1 text-sm font-bold text-white">{system.lifecycle.label}</p>
            </div>
            {system.lifecycle.scheduledDate ? (
              <span className="rounded-full border border-sky-300/35 bg-sky-400/10 px-2 py-1 text-xs font-semibold text-sky-100">
                {formatDate(system.lifecycle.scheduledDate)}
              </span>
            ) : null}
          </div>
          {system.lifecycle.nextAction ? <p className="mt-2 text-xs leading-5 text-slate-300">{system.lifecycle.nextAction}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {system.lifecycle.linkedRequestId ? (
              <button
                type="button"
                data-testid={`property-maintenance-view-request-${system.id}`}
                onClick={() => onOpenRequest?.(`customer-request-${system.lifecycle.linkedRequestId}`)}
                className="rounded-xl border border-sky-300/35 bg-sky-400/10 px-3 py-2 text-xs font-bold text-sky-100 hover:bg-sky-400/20"
              >
                View Request
              </button>
            ) : null}
            {system.linkedProjects?.[0]?.url ? (
              <a
                data-testid={`property-maintenance-view-agreement-${system.id}`}
                href={system.linkedProjects[0].url}
                className="rounded-xl border border-sky-300/35 bg-sky-400/10 px-3 py-2 text-xs font-bold text-sky-100 hover:bg-sky-400/20"
              >
                View Agreement
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
      <dl className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
        <div><dt className="text-slate-500">Last service</dt><dd className="font-semibold text-slate-200">{system.lastServiceDate ? formatDate(system.lastServiceDate) : "Not recorded"}</dd></div>
        <div><dt className="text-slate-500">Next suggested</dt><dd className="font-semibold text-slate-200">{system.nextRecommendedServiceDate ? formatDate(system.nextRecommendedServiceDate) : "Needs details"}</dd></div>
        <div><dt className="text-slate-500">Warranty</dt><dd className="font-semibold text-slate-200">{system.warrantyExpiration ? formatDate(system.warrantyExpiration) : "Not recorded"}</dd></div>
        <div><dt className="text-slate-500">Reminder schedule</dt><dd className="font-semibold text-slate-200">{system.remindersEnabled ? `${system.reminderLeadDays} days before due` : "Off"}</dd></div>
        <div><dt className="text-slate-500">Last reminder sent</dt><dd className="font-semibold text-slate-200">{system.lastNotifiedAt ? formatDate(system.lastNotifiedAt) : "Not sent yet"}</dd></div>
        <div><dt className="text-slate-500">Next reminder planned</dt><dd className="font-semibold text-slate-200">{system.nextNotificationAt ? formatDate(system.nextNotificationAt) : system.dismissedUntil ? `Paused until ${formatDate(system.dismissedUntil)}` : "Not scheduled"}</dd></div>
      </dl>
      <div className="mt-3 text-xs text-slate-400">
        Reminder delivery: {reminderDeliveryLabel(system)}
      </div>
      <p className="mt-3 text-sm font-semibold text-sky-100">{system.recommendedAction || "Keep this system record up to date."}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" data-testid={`property-maintenance-mark-serviced-${system.id}`} onClick={() => onMarkServiced?.(system)} className="rounded-xl border border-emerald-300/40 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/20">
          Mark Serviced
        </button>
        <button type="button" data-testid={`property-maintenance-manage-reminder-${system.id}`} onClick={() => onEditSystem?.(system)} className="rounded-xl border border-sky-300/35 bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/20">
          Manage Reminder
        </button>
        <button type="button" data-testid={`property-maintenance-dismiss-${system.id}`} onClick={() => onDismissReminder?.(system)} className="rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-slate-400">
          Dismiss Reminder
        </button>
        <button type="button" data-testid={`property-maintenance-create-request-${system.id}`} onClick={() => onCreateServiceRequest?.(system)} className="rounded-xl bg-sky-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400">
          Create Service Request
        </button>
      </div>
    </article>
  );
  return (
    <Section title="Maintenance Center" eyebrow="Home upkeep" testId="property-maintenance-center">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <button
            key={card.label}
            type="button"
            data-testid={`property-maintenance-kpi-${card.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            onClick={() => scrollToGroup(card.target)}
            className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4 text-left transition hover:border-amber-300/45 focus:border-amber-300/70 focus:outline-none focus:ring-2 focus:ring-amber-300/30"
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{card.label}</div>
            <div className="mt-2 text-2xl font-black text-white">{card.value}</div>
            <p className="mt-2 text-sm leading-5 text-slate-400">{card.body}</p>
            {card.target ? <div className="mt-3 text-xs font-bold text-amber-100">View details</div> : null}
          </button>
        ))}
      </div>
      {systems.length ? (
        <div className="mt-5 space-y-5">
          {[
            ["overdue", "Overdue"],
            ["due_soon", "Due Soon"],
            ["warranty_expiring", "Warranty Expiring"],
            ["lifespan_attention", "Nearing End of Life"],
            ["current", "Current"],
            ["unknown", "Unknown"],
          ].map(([key, label]) => (
            groupedSystems[key].length ? (
              <div key={key} data-testid={`property-maintenance-group-${key}`}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h4 className="text-sm font-bold text-white">{label}</h4>
                  <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-300">{groupedSystems[key].length}</span>
                </div>
                <div className="grid gap-3 xl:grid-cols-2">{groupedSystems[key].map(renderSystemCard)}</div>
              </div>
            ) : null
          ))}
        </div>
      ) : (
        <EmptyState title="No maintenance reminders yet" testId="property-maintenance-reminders-empty">
          Add systems like HVAC, roof, water heater, or appliances to see reminders here.
        </EmptyState>
      )}
    </Section>
  );
}

function emptySystemForm(propertyId) {
  return {
    property_id: propertyId || null,
    system_type: "hvac",
    custom_name: "",
    manufacturer: "",
    model_number: "",
    serial_number: "",
    install_date: "",
    last_service_date: "",
    warranty_start_date: "",
    warranty_expiration_date: "",
    expected_lifespan_years: "",
    condition: "unknown",
    service_provider: "",
    reminders_enabled: true,
    email_reminders_enabled: true,
    sms_reminders_enabled: false,
    reminder_lead_days: 30,
    reminder_frequency: "once",
    dismissed_until: null,
    notes: "",
    linked_document_ids: [],
  };
}

function systemToForm(system, propertyId) {
  return {
    property_id: propertyId || null,
    system_type: system.system_type || "other",
    custom_name: system.custom_name || "",
    manufacturer: system.manufacturer || "",
    model_number: system.model_number || system.model || "",
    serial_number: system.serial_number || "",
    install_date: system.install_date || system.installDate || "",
    last_service_date: system.last_service_date || system.lastServiceDate || "",
    warranty_start_date: system.warranty_start_date || system.warrantyStartDate || "",
    warranty_expiration_date: system.warranty_expiration_date || system.warrantyExpiration || "",
    expected_lifespan_years: system.expected_lifespan_years || system.expectedLifespanYears || "",
    condition: system.condition || "unknown",
    service_provider: system.service_provider || system.serviceProvider || "",
    reminders_enabled: system.reminders_enabled ?? system.remindersEnabled ?? true,
    email_reminders_enabled: system.email_reminders_enabled ?? system.emailRemindersEnabled ?? true,
    sms_reminders_enabled: system.sms_reminders_enabled ?? system.smsRemindersEnabled ?? false,
    reminder_lead_days: system.reminder_lead_days ?? system.reminderLeadDays ?? 30,
    reminder_frequency: system.reminder_frequency || system.reminderFrequency || "once",
    dismissed_until: system.dismissed_until || system.dismissedUntil || null,
    notes: system.notes || "",
    linked_document_ids: (system.linked_documents || system.linkedDocuments || []).map((document) => Number(document.record_id || String(document.id || "").replace("property-document-", ""))).filter(Boolean),
  };
}

function ExtractionReview({ extraction = {}, system = {}, selected = {}, onToggle }) {
  const suggestions = extraction.suggested_fields || {};
  const rows = Object.entries(suggestions);
  if (!rows.length) {
    return (
      <div data-testid="home-system-extraction-empty" className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4 text-sm text-slate-300">
        No structured fields were found yet. The file is still saved to this Home System.
      </div>
    );
  }
  const currentValue = (field) => {
    if (field === "manufacturer") return system.manufacturer;
    if (field === "model_number") return system.model;
    if (field === "serial_number") return system.serialNumber;
    if (field === "install_date") return system.installDate;
    if (field === "warranty_expiration_date") return system.warrantyExpiration;
    if (field === "condition") return system.conditionLabel;
    return "";
  };
  return (
    <div data-testid="home-system-extraction-review" className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
      <h4 className="text-sm font-bold text-white">Document Analysis Results</h4>
      <p className="mt-1 text-xs leading-5 text-slate-400">Review suggestions before applying them. Low confidence suggestions are unchecked by default.</p>
      <div className="mt-3 space-y-2">
        {rows.map(([field, suggestion]) => {
          const isLow = suggestion.confidence === "low";
          const checked = Boolean(selected[field] ?? (!isLow && suggestion.apply_default !== false));
          return (
            <label key={field} data-testid={`home-system-extraction-field-${field}`} className="grid gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-sm md:grid-cols-[90px_1fr_1fr_90px] md:items-center">
              <span className="flex items-center gap-2 font-bold capitalize text-slate-100">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => onToggle?.(field, event.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-amber-300"
                />
                {field.replaceAll("_", " ")}
              </span>
              <span className="text-slate-400">Current: {currentValue(field) || "Not recorded"}</span>
              <span className="font-semibold text-white">Suggested: {suggestion.value || "Not found"}</span>
              <span className={`rounded-full border px-2 py-1 text-center text-xs font-bold ${suggestion.confidence === "high" ? "border-emerald-300/40 bg-emerald-400/10 text-emerald-100" : suggestion.confidence === "medium" ? "border-amber-300/40 bg-amber-300/10 text-amber-100" : "border-slate-600 bg-slate-950 text-slate-300"}`}>
                {suggestion.confidence || "low"}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function HomeSystemScanModal({
  system,
  propertyId,
  saving,
  onClose,
  onUpload,
  onCreateSession,
  onApplyExtraction,
}) {
  const [documentType, setDocumentType] = useState("Equipment Label");
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [selectedFields, setSelectedFields] = useState({});

  useEffect(() => {
    const suggestions = result?.extraction?.suggested_fields || {};
    const next = {};
    for (const [field, suggestion] of Object.entries(suggestions)) {
      next[field] = suggestion.confidence !== "low" && suggestion.apply_default !== false;
    }
    setSelectedFields(next);
  }, [result]);

  if (!system) return null;
  const upload = async () => {
    if (!file) {
      setError("Choose a photo or file first.");
      return;
    }
    setError("");
    const data = await onUpload?.({
      file,
      title: file.name,
      documentType,
      propertyProfileId: propertyId,
      homeSystemId: system.id,
      uploadSource: "portal_desktop",
    });
    if (data) setResult(data);
  };
  const createSession = async () => {
    setError("");
    const data = await onCreateSession?.({
      property_profile_id: propertyId,
      home_system_id: system.id,
      document_type: documentType,
    });
    if (data) setSession(data);
  };
  const apply = async () => {
    const suggestions = result?.extraction?.suggested_fields || {};
    const selected = {};
    for (const [field, checked] of Object.entries(selectedFields)) {
      if (checked && suggestions[field]) selected[field] = suggestions[field];
    }
    if (!Object.keys(selected).length) {
      setError("Select at least one suggestion to apply.");
      return;
    }
    const ok = await onApplyExtraction?.(result?.document?.record_id, selected);
    if (ok !== false) onClose?.();
  };
  return (
    <div data-testid="home-system-scan-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-amber-200">Home System Records</div>
            <h3 className="mt-1 text-xl font-black text-white">Scan or upload document</h3>
            <p className="mt-1 text-sm text-slate-300">Saving to: {system.name}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm font-bold text-slate-200">Close</button>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
            <h4 className="text-sm font-bold text-white">Upload from this device</h4>
            <label className="mt-3 block text-sm font-semibold text-slate-200">
              Document type
              <select
                data-testid="home-system-scan-document-type"
                value={documentType}
                onChange={(event) => setDocumentType(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              >
                {HOME_SYSTEM_DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className="mt-3 block text-sm font-semibold text-slate-200">
              Photo or file
              <input
                data-testid="home-system-scan-file"
                type="file"
                accept="image/*,.pdf"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
              />
            </label>
            <button
              type="button"
              data-testid="home-system-scan-upload"
              onClick={upload}
              disabled={saving}
              className="mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-amber-300 px-4 py-2 text-sm font-black text-slate-950 hover:bg-amber-200 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Upload and analyze"}
            </button>
          </section>
          <section className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
            <h4 className="text-sm font-bold text-white">Scan with phone</h4>
            <p className="mt-2 text-sm leading-6 text-slate-300">Open this on your phone to take a photo or upload a file directly to this Home System.</p>
            <button
              type="button"
              data-testid="home-system-scan-create-qr"
              onClick={createSession}
              disabled={saving}
              className="mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-sky-300/35 bg-sky-400/10 px-4 py-2 text-sm font-bold text-sky-100 hover:bg-sky-400/20 disabled:opacity-60"
            >
              Show QR code for phone scan
            </button>
            {session ? (
              <div data-testid="home-system-scan-qr-panel" className="mt-4 space-y-3">
                {session.qr_code_data_url ? <img src={session.qr_code_data_url} alt="QR code for mobile upload" className="mx-auto h-44 w-44 rounded-2xl bg-white p-2" /> : null}
                <div className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs text-slate-300">
                  Expires {session.expires_at ? new Date(session.expires_at).toLocaleString() : "soon"}
                </div>
                <input data-testid="home-system-scan-copy-link" readOnly value={session.upload_url || ""} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200" />
              </div>
            ) : null}
          </section>
        </div>
        {error ? <div data-testid="home-system-scan-error" className="mt-4 rounded-xl border border-rose-300/35 bg-rose-400/10 p-3 text-sm text-rose-100">{error}</div> : null}
        {result ? (
          <div className="mt-5 space-y-4">
            <div data-testid="home-system-scan-saved" className="rounded-xl border border-emerald-300/35 bg-emerald-400/10 p-3 text-sm font-semibold text-emerald-100">File saved.</div>
            <ExtractionReview
              extraction={result.extraction}
              system={system}
              selected={selectedFields}
              onToggle={(field, checked) => setSelectedFields((prev) => ({ ...prev, [field]: checked }))}
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" data-testid="home-system-extraction-apply" onClick={apply} disabled={saving} className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-black text-slate-950 hover:bg-amber-200 disabled:opacity-60">Apply selected</button>
              {result.document?.url ? <a href={result.document.url} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-bold text-slate-200">View uploaded file</a> : null}
              <button type="button" onClick={onClose} className="rounded-xl border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-bold text-slate-200">Ignore suggestions</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HomeSystemModal({ mode, form, documents = [], saving, onChange, onClose, onSubmit }) {
  if (!mode) return null;
  const title = mode === "edit" ? "Edit Home System" : "Add Home System";
  const update = (field, value) => onChange?.({ ...(form || {}), [field]: value });
  return (
    <div data-testid="property-home-system-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.();
        }}
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-amber-300/35 bg-slate-950 p-5 shadow-2xl shadow-black/50"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Home Systems</div>
            <h3 className="mt-1 text-xl font-bold text-white">{title}</h3>
            <p className="mt-1 text-sm leading-6 text-slate-300">
              Store service dates, warranty details, model numbers, notes, and linked records for this property system.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-slate-400">
            Close
          </button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-200">
            System type
            <select value={form?.system_type || "hvac"} onChange={(event) => update("system_type", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400">
              {HOME_SYSTEM_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Custom name
            <input value={form?.custom_name || ""} onChange={(event) => update("custom_name", event.target.value)} placeholder="Main HVAC, North roof..." className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Manufacturer
            <input value={form?.manufacturer || ""} onChange={(event) => update("manufacturer", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Model number
            <input value={form?.model_number || ""} onChange={(event) => update("model_number", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Serial number
            <input value={form?.serial_number || ""} onChange={(event) => update("serial_number", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Condition
            <select value={form?.condition || "unknown"} onChange={(event) => update("condition", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400">
              {HOME_SYSTEM_CONDITION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Install date
            <input type="date" value={form?.install_date || ""} onChange={(event) => update("install_date", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Last service date
            <input type="date" value={form?.last_service_date || ""} onChange={(event) => update("last_service_date", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Warranty start date
            <input type="date" value={form?.warranty_start_date || ""} onChange={(event) => update("warranty_start_date", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Warranty expiration date
            <input type="date" value={form?.warranty_expiration_date || ""} onChange={(event) => update("warranty_expiration_date", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Expected lifespan
            <input type="number" min="0" value={form?.expected_lifespan_years || ""} onChange={(event) => update("expected_lifespan_years", event.target.value ? Number(event.target.value) : "")} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Service provider
            <input value={form?.service_provider || ""} onChange={(event) => update("service_provider", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 sm:col-span-2">
            <div className="text-sm font-bold text-amber-100">Reminder notifications</div>
            <p className="mt-1 text-xs leading-5 text-slate-300">
              Reminders are advisory. Email reminders use your portal email; SMS reminders stay off unless you opt in.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <input type="checkbox" checked={form?.reminders_enabled !== false} onChange={(event) => update("reminders_enabled", event.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-900" />
                Enable reminders
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <input type="checkbox" checked={form?.email_reminders_enabled !== false} onChange={(event) => update("email_reminders_enabled", event.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-900" />
                Email reminders
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <input type="checkbox" checked={Boolean(form?.sms_reminders_enabled)} onChange={(event) => update("sms_reminders_enabled", event.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-900" />
                SMS reminders
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Lead time
                <input type="number" min="0" max="365" value={form?.reminder_lead_days ?? 30} onChange={(event) => update("reminder_lead_days", event.target.value ? Number(event.target.value) : 0)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
              </label>
              <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
                Reminder frequency
                <select value={form?.reminder_frequency || "once"} onChange={(event) => update("reminder_frequency", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400">
                  <option value="once">Once per reminder</option>
                  <option value="weekly">Weekly until resolved</option>
                  <option value="monthly">Monthly until resolved</option>
                </select>
              </label>
            </div>
          </div>
          <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
            Linked documents
            <select
              multiple
              value={(form?.linked_document_ids || []).map(String)}
              onChange={(event) => update("linked_document_ids", Array.from(event.target.selectedOptions).map((option) => Number(option.value)))}
              className="mt-1 min-h-28 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            >
              {documents.map((document) => (
                <option key={document.id} value={Number(document.record_id || String(document.id || "").replace("property-document-", ""))}>
                  {document.title || document.filename || "Property document"}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">Hold Ctrl or Command to select more than one document.</span>
          </label>
          <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
            Notes
            <textarea rows={4} value={form?.notes || ""} onChange={(event) => update("notes", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:border-slate-400">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50">
            {saving ? "Saving..." : mode === "edit" ? "Save system" : "Add system"}
          </button>
        </div>
      </form>
    </div>
  );
}

function HomeSystemServiceModal({ system, saving, onClose, onSubmit }) {
  const [form, setForm] = useState({
    last_service_date: new Date().toISOString().slice(0, 10),
    service_provider: system?.serviceProvider || "",
    notes: "",
  });
  if (!system) return null;
  return (
    <div data-testid="property-home-system-service-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.(form);
        }}
        className="w-full max-w-xl rounded-3xl border border-emerald-300/35 bg-slate-950 p-5 shadow-2xl shadow-black/50"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">Maintenance</div>
            <h3 className="mt-1 text-xl font-bold text-white">Mark {system.name} serviced</h3>
            <p className="mt-1 text-sm leading-6 text-slate-300">
              Update the service date and keep this property record current.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-slate-400">
            Close
          </button>
        </div>
        <div className="mt-5 grid gap-3">
          <label className="block text-sm font-medium text-slate-200">
            Service date
            <input type="date" value={form.last_service_date} onChange={(event) => setForm((value) => ({ ...value, last_service_date: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Service provider
            <input value={form.service_provider} onChange={(event) => setForm((value) => ({ ...value, service_provider: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Notes
            <textarea rows={4} value={form.notes} onChange={(event) => setForm((value) => ({ ...value, notes: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:border-slate-400">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:opacity-50">
            {saving ? "Saving..." : "Mark serviced"}
          </button>
        </div>
      </form>
    </div>
  );
}


function timelineRows({ profile, projects, requests, agreements, documents, payments, maintenanceWorkOrders, homeSystems = [] }) {
  const rows = [];
  for (const system of homeSystems) {
    if (system.updated_at || system.created_at) {
      rows.push({
        id: `system-${system.id}`,
        date: system.updated_at || system.created_at,
        title: `${system.name} record updated`,
        type: "Home System",
        description: [system.manufacturer, system.model].filter(Boolean).join(" ") || system.notes || "Home system record saved.",
        actionLabel: "View system",
      });
    }
    if (system.lastServiceDate) {
      rows.push({
        id: `system-service-${system.id}`,
        date: system.lastServiceDate,
        title: `${system.name} serviced`,
        type: "Maintenance",
        description: system.serviceProvider || "Service provider not recorded",
        actionLabel: "View system",
      });
    }
    if (system.warrantyExpiration) {
      rows.push({
        id: `system-warranty-expiration-${system.id}`,
        date: system.warrantyExpiration,
        title: `${system.name} warranty expiration`,
        type: "Warranty",
        description: "Warranty expiration date saved in Home Systems.",
        actionLabel: "View warranty",
      });
    }
  }
  for (const project of completedProjectRows(projects, agreements, documents)) {
    rows.push({
      id: `project-${project.id}`,
      date: project.completedAt,
      title: project.title,
      type: "Completed Project",
      detail: `${project.contractor}${project.amount ? ` - ${money(project.amount)}` : ""}`,
      url: project.action,
      actionLabel: project.action ? "View project" : "",
    });
  }
  for (const request of requests || []) {
    const title = request.project_title || request.title || "Service request";
    const status = request.status_label || request.conversion_status || "Submitted";
    const projectAddress = request.project_address || request.property_profile?.address || "";
    rows.push({
      id: `request-${request.id}`,
      date: request.latest_activity || request.updated_at || request.created_at,
      title,
      type: "Request",
      detail: `${status}${projectAddress ? ` - ${projectAddress}` : ""}`,
      actionLabel: request.id ? "View request" : "",
      actionTarget: request.id ? { kind: "request", requestId: request.id } : null,
    });
    if (request.linked_work || request.agreement_token || String(request.conversion_status || "").toLowerCase().includes("agreement")) {
      rows.push({
        id: `request-converted-${request.id}`,
        date: request.updated_at || request.latest_activity || request.created_at,
        title: `${title} became a project`,
        type: "Agreement",
        detail: request.linked_work?.status_label || request.conversion_status || "Agreement draft created",
        url: request.linked_work?.agreement_url || (request.agreement_token ? `/agreements/magic/${request.agreement_token}` : ""),
        actionLabel: request.linked_work?.agreement_url || request.agreement_token ? "View agreement" : "",
      });
    }
  }
  for (const document of [...(documents || []), ...(profile?.documents || [])]) {
    rows.push({
      id: `document-${document.id}`,
      date: document.date,
      title: document.title || "Property document",
      type: categoryForDocument(document),
      detail: document.project_title || document.filename || "Home record",
      url: document.url,
      actionLabel: document.url ? "View document" : "",
    });
  }
  for (const photo of profile?.photos || []) {
    rows.push({
      id: `photo-${photo.id}`,
      date: photo.date,
      title: photo.title || "Property photo",
      type: "Photo",
      detail: photo.filename || "Home photo",
      url: photo.url,
      actionLabel: photo.url ? "View document" : "",
    });
  }
  for (const agreement of warrantyRows(agreements, documents)) {
    rows.push({
      id: `warranty-timeline-${agreement.id}`,
      date: agreement.date,
      title: `${agreement.project} warranty`,
      type: "Warranty",
      detail: agreement.contractor,
      url: agreement.documents[0]?.url || "",
      actionLabel: agreement.documents[0]?.url ? "View warranty" : "",
    });
  }
  for (const payment of payments || []) {
    const type = String(payment.record_type || payment.record_type_label || "").toLowerCase();
    if (!type.includes("invoice") && !type.includes("receipt")) continue;
    rows.push({
      id: `payment-${payment.id}`,
      date: payment.date,
      title: payment.invoice_number || payment.reference || payment.record_type_label || "Payment record",
      type: String(payment.status || payment.status_label || "").toLowerCase().includes("paid") ? "Receipt" : "Invoice",
      detail: `${payment.project_title || "Project"}${payment.amount_label ? ` - ${payment.amount_label}` : ""}`,
      url: payment.receipt_url || payment.action_target || "",
      actionLabel: payment.receipt_url ? "View receipt" : payment.action_target ? "View document" : "",
    });
  }
  for (const workOrder of maintenanceRows(maintenanceWorkOrders)) {
    const attachment = workOrder.attachments?.[0] || {};
    rows.push({
      id: `maintenance-${workOrder.id}`,
      date: workOrder.completedAt || workOrder.scheduledDate,
      title: workOrder.title,
      type: workOrder.status === "completed" ? "Completed Maintenance" : "Scheduled Maintenance",
      detail: `${workOrder.projectTitle} - ${workOrder.contractor}`,
      url: attachment.url || "",
      actionLabel: attachment.url ? "View service record" : "",
    });
  }
  return rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

function HomeRecordsDashboard({ profile, projects, requests, agreements, documents, payments, maintenanceWorkOrders, propertyIntelligence, onOpenRequest, onAddSystem, onEditSystem, onArchiveSystem, onMarkServiced, onCreateServiceRequest, onDismissReminder, onIgnoreRecommendation, onRestoreRecommendation, onScanSystem }) {
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [highlightedRecommendationSystemId, setHighlightedRecommendationSystemId] = useState("");
  const maintenance = maintenanceRows(maintenanceWorkOrders);
  const hasStructuredSystems = Array.isArray(profile?.home_systems);
  const systems = hasStructuredSystems
    ? (profile.home_systems || []).map(normalizeHomeSystem)
    : systemRows({ projects, agreements, documents, requests, maintenanceWorkOrders, propertyIntelligence });
  const timeline = timelineRows({ profile, projects, requests, agreements, documents, payments, maintenanceWorkOrders, homeSystems: systems.filter((system) => system.isStructured) });
  const timelineDefaultCount = 5;
  const visibleTimeline = timelineExpanded ? timeline : timeline.slice(0, timelineDefaultCount);
  const handleViewRecommendations = (system) => {
    setHighlightedRecommendationSystemId(system?.id || "");
    window.requestAnimationFrame(() => {
      document.querySelector("[data-testid='property-suggested-supplies']")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="space-y-5">
      <HomeSystemsSection
        systems={systems}
        onAdd={onAddSystem}
        onEdit={onEditSystem}
        onArchive={onArchiveSystem}
        onViewRecommendations={handleViewRecommendations}
        onScan={onScanSystem}
      />

      <SuggestedSuppliesSection
        systems={systems.filter((system) => system.isStructured)}
        onCreateServiceRequest={(system, recommendation) => onCreateServiceRequest?.(system, recommendation, profile)}
        highlightedSystemId={highlightedRecommendationSystemId}
        onIgnoreRecommendation={onIgnoreRecommendation}
        onRestoreRecommendation={onRestoreRecommendation}
      />

      <MaintenanceCenter
        intelligence={propertyIntelligence}
        maintenance={maintenance}
        systems={systems.filter((system) => system.isStructured)}
        onMarkServiced={onMarkServiced}
        onEditSystem={onEditSystem}
        onCreateServiceRequest={onCreateServiceRequest}
        onDismissReminder={onDismissReminder}
        onOpenRequest={onOpenRequest}
      />

      <Section title="Timeline / History" eyebrow="Property records" testId="home-records-timeline">
        {timeline.length ? (
          <div className="space-y-3">
            {visibleTimeline.map((item) => {
              const requestTarget = item.actionTarget?.kind === "request" && item.actionTarget.requestId ? item.actionTarget : null;
              const content = (
                <>
                  <div className="text-xs font-semibold text-amber-100">{formatDate(item.date)}</div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-slate-600 bg-slate-950 px-2 py-0.5 text-[11px] font-semibold text-slate-200">{item.type}</span>
                      <span className="text-sm font-semibold text-white">{item.title}</span>
                    </div>
                    <div className="mt-1 text-sm text-slate-400">{item.detail || item.description}</div>
                    {item.actionLabel ? (
                      <div className="mt-2 text-xs font-semibold text-sky-100">{item.actionLabel}</div>
                    ) : null}
                  </div>
                </>
              );
              return item.url ? (
                <a
                  key={item.id}
                  data-testid={`home-records-timeline-action-${item.id}`}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="grid gap-3 rounded-2xl border border-slate-700 bg-slate-900/60 p-3 hover:border-amber-300/45 sm:grid-cols-[110px_minmax(0,1fr)]"
                >
                  {content}
                </a>
              ) : requestTarget ? (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`home-records-timeline-action-${item.id}`}
                  aria-label={`View request for ${item.title}`}
                  onClick={() => onOpenRequest?.(requestTarget.requestId)}
                  className="grid w-full gap-3 rounded-2xl border border-slate-700 bg-slate-900/60 p-3 text-left hover:border-amber-300/45 focus:border-amber-300/70 focus:outline-none focus:ring-2 focus:ring-amber-300/30 sm:grid-cols-[110px_minmax(0,1fr)]"
                >
                  {content}
                </button>
              ) : (
                <div
                  key={item.id}
                  data-testid={`home-records-timeline-static-${item.id}`}
                  className="grid gap-3 rounded-2xl border border-slate-700 bg-slate-900/60 p-3 sm:grid-cols-[110px_minmax(0,1fr)]"
                >
                  {content}
                </div>
              );
            })}
            <ShowMoreControl
              total={timeline.length}
              visible={timelineDefaultCount}
              expanded={timelineExpanded}
              onToggle={() => setTimelineExpanded((value) => !value)}
              noun="timeline items"
              testId="home-records-timeline-show-more"
            />
          </div>
        ) : (
          <EmptyState title="No property timeline yet" testId="home-records-timeline-empty">
            Uploaded records, warranties, receipts, photos, and completed projects will build a timeline here.
          </EmptyState>
        )}
      </Section>
    </div>
  );
}

export default function CustomerPropertyProfile({
  profile = {},
  profiles = [],
  projects = [],
  agreements = [],
  documents = [],
  requests = [],
  payments = [],
  maintenanceWorkOrders = [],
  propertyIntelligence = {},
  onOpenRequest,
  onSave,
  onAdd,
  onCreateSystem,
  onUpdateSystem,
  onArchiveSystem,
  onMarkSystemServiced,
  onCreateUnit,
  onBulkCreateUnits,
  onUpdateUnit,
  onDisableUnit,
  onCreateTenant,
  onUpdateTenant,
  onMarkTenantFormer,
  onCreateSystemServiceRequest,
  onUploadSystemDocument,
  onCreateSystemUploadSession,
  onApplySystemDocumentExtraction,
  onCreateRequestDraft,
  onIgnoreSystemRecommendation,
  onRestoreSystemRecommendation,
  saving = false,
  systemSaving = false,
  unitSaving = false,
  tenantSaving = false,
  isPropertyManagementCompany = false,
}) {
  const profileOptions = useMemo(() => (profiles.length ? profiles : profile?.id ? [profile] : []), [profiles, profile]);
  const [selectedProfileId, setSelectedProfileId] = useState(profile?.id || profileOptions[0]?.id || "");
  const selectedProfile =
    String(profile?.id || "") === String(selectedProfileId || "")
      ? profile
      : profileOptions.find((row) => String(row.id) === String(selectedProfileId)) || profile || {};
  const [form, setForm] = useState(selectedProfile || {});
  const [addingProperty, setAddingProperty] = useState(false);
  const [systemModalMode, setSystemModalMode] = useState("");
  const [editingSystemId, setEditingSystemId] = useState(null);
  const [scanSystem, setScanSystem] = useState(null);
  const [systemForm, setSystemForm] = useState(emptySystemForm(selectedProfile?.id));
  const [serviceSystem, setServiceSystem] = useState(null);
  const [expandedRentalPanel, setExpandedRentalPanel] = useState("");
  const [unitAddSignal, setUnitAddSignal] = useState(0);
  const [tenantAddSignal, setTenantAddSignal] = useState(0);
  const startAddProperty = () => {
    setAddingProperty(true);
    const next = {
      display_name: "New Property",
      property_type: "single_family",
      address_line1: "",
      address_line2: "",
      city: "",
      state: "",
      postal_code: "",
      year_built: "",
      square_feet: "",
      bedrooms: "",
      bathrooms: "",
      notes: "",
      is_primary: !profileOptions.length,
      is_rental_property: false,
    };
    setSelectedProfileId("");
    setForm(next);
  };

  useEffect(() => {
    const nextId = profile?.id || profileOptions[0]?.id || "";
    setSelectedProfileId(nextId);
  }, [profile?.id, profileOptions]);

  useEffect(() => {
    setForm(selectedProfile || {});
    setSystemForm((prev) => ({ ...(prev || emptySystemForm(selectedProfile?.id)), property_id: selectedProfile?.id || null }));
  }, [selectedProfileId]);

  const update = (field, value) => setForm((prev) => ({ ...(prev || {}), [field]: value }));
  const closeSystemModal = () => {
    setSystemModalMode("");
    setEditingSystemId(null);
    setSystemForm(emptySystemForm(selectedProfile?.id));
  };
  const rentalToolsEnabled = Boolean(isPropertyManagementCompany || selectedProfile?.rental_tools_enabled || selectedProfile?.is_rental_property);
  const openUnitAdd = () => {
    setExpandedRentalPanel("units");
    setUnitAddSignal((value) => value + 1);
  };
  const openTenantAdd = () => {
    setExpandedRentalPanel("tenants");
    setTenantAddSignal((value) => value + 1);
  };
  const openAddSystem = () => {
    setEditingSystemId(null);
    setSystemForm(emptySystemForm(selectedProfile?.id));
    setSystemModalMode("add");
  };
  const openEditSystem = (system) => {
    setEditingSystemId(system.id);
    setSystemForm(systemToForm(system, selectedProfile?.id));
    setSystemModalMode("edit");
  };
  const submitSystem = async () => {
    const dateFields = ["install_date", "last_service_date", "warranty_start_date", "warranty_expiration_date"];
    const payload = {
      ...systemForm,
      property_id: selectedProfile?.id || systemForm.property_id || null,
      expected_lifespan_years: systemForm.expected_lifespan_years === "" ? null : systemForm.expected_lifespan_years,
    };
    for (const field of dateFields) {
      if (!payload[field]) payload[field] = null;
    }
    const ok = systemModalMode === "edit"
      ? await onUpdateSystem?.(editingSystemId, payload)
      : await onCreateSystem?.(payload);
    if (ok !== false) closeSystemModal();
  };

  return (
    <div data-testid="customer-property-profile" className="space-y-5">
      <PropertySummarySection
        profile={selectedProfile}
        profileOptions={profileOptions}
        onSelectProperty={(id) => {
          setAddingProperty(false);
          setSelectedProfileId(id);
        }}
        onEdit={() => {
          setAddingProperty(false);
          document?.querySelector?.("[data-testid='customer-property-manager']")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
        }}
        onAdd={startAddProperty}
        rentalToolsEnabled={rentalToolsEnabled}
        onAddUnit={openUnitAdd}
        onAddTenant={openTenantAdd}
      />

      {rentalToolsEnabled ? (
        <div className="grid gap-3 xl:grid-cols-2">
          <PropertyUnitsSection
            units={selectedProfile?.units || []}
            saving={unitSaving}
            expanded={expandedRentalPanel === "units"}
            onToggle={() => setExpandedRentalPanel((panel) => (panel === "units" ? "" : "units"))}
            openAddSignal={unitAddSignal}
            onAdd={async (payload) => {
              await onCreateUnit?.(selectedProfile?.id, payload);
            }}
            onBulkAdd={async (payload) => {
              await onBulkCreateUnits?.(selectedProfile?.id, payload);
            }}
            onEdit={async (unit, payload) => {
              await onUpdateUnit?.(selectedProfile?.id, unit.id, payload);
            }}
            onDisable={async (unit) => {
              await onDisableUnit?.(selectedProfile?.id, unit.id);
            }}
          />
          <TenantsSection
            tenants={selectedProfile?.tenants || []}
            units={selectedProfile?.units || []}
            saving={tenantSaving}
            expanded={expandedRentalPanel === "tenants"}
            onToggle={() => setExpandedRentalPanel((panel) => (panel === "tenants" ? "" : "tenants"))}
            openAddSignal={tenantAddSignal}
            onAdd={async (payload) => {
              await onCreateTenant?.(selectedProfile?.id, payload);
            }}
            onEdit={async (tenant, payload) => {
              await onUpdateTenant?.(selectedProfile?.id, tenant.id, payload);
            }}
            onFormer={async (tenant) => {
              await onMarkTenantFormer?.(selectedProfile?.id, tenant.id);
            }}
          />
        </div>
      ) : null}

      <HomeRecordsDashboard
        profile={selectedProfile}
        projects={projects}
        requests={requests}
        agreements={agreements}
        documents={documents}
        payments={payments}
        maintenanceWorkOrders={maintenanceWorkOrders}
        propertyIntelligence={propertyIntelligence}
        onOpenRequest={onOpenRequest}
        onAddSystem={openAddSystem}
        onEditSystem={openEditSystem}
        onArchiveSystem={async (system) => {
          await onArchiveSystem?.(system.id);
        }}
        onMarkServiced={(system) => setServiceSystem(system)}
        onCreateServiceRequest={async (system, recommendation, sourceProfile) => {
          if (recommendation) {
            const draft = {
              ...requestDraftFromSystemRecommendation(system, recommendation),
              property_id: sourceProfile?.id || selectedProfile?.id || "",
              address_line1: sourceProfile?.address_line1 || selectedProfile?.address_line1 || "",
              address_line2: sourceProfile?.address_line2 || selectedProfile?.address_line2 || "",
              city: sourceProfile?.city || selectedProfile?.city || "",
              state: sourceProfile?.state || selectedProfile?.state || "",
              postal_code: sourceProfile?.postal_code || selectedProfile?.postal_code || "",
            };
            onCreateRequestDraft?.(draft);
            return;
          }
          await onCreateSystemServiceRequest?.(system.id);
        }}
        onDismissReminder={async (system) => {
          const dismissedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          await onUpdateSystem?.(system.id, { dismissed_until: dismissedUntil });
        }}
        onIgnoreRecommendation={async (recommendation) => {
          await onIgnoreSystemRecommendation?.(recommendation.systemRecord?.id || recommendation.system_id, recommendation.recommendationKey || recommendation.recommendation_key || recommendation.id);
        }}
        onRestoreRecommendation={async (recommendation) => {
          await onRestoreSystemRecommendation?.(recommendation.systemRecord?.id || recommendation.system_id, recommendation.recommendationKey || recommendation.recommendation_key || recommendation.id);
        }}
        onScanSystem={(system) => setScanSystem(system)}
      />

      <HomeSystemScanModal
        system={scanSystem}
        propertyId={selectedProfile?.id}
        saving={systemSaving}
        onClose={() => setScanSystem(null)}
        onUpload={onUploadSystemDocument}
        onCreateSession={onCreateSystemUploadSession}
        onApplyExtraction={onApplySystemDocumentExtraction}
      />

      <HomeSystemModal
        mode={systemModalMode}
        form={systemForm}
        documents={selectedProfile?.documents || []}
        saving={systemSaving}
        onChange={setSystemForm}
        onClose={closeSystemModal}
        onSubmit={submitSystem}
      />

      <HomeSystemServiceModal
        system={serviceSystem}
        saving={systemSaving}
        onClose={() => setServiceSystem(null)}
        onSubmit={async (payload) => {
          const ok = await onMarkSystemServiced?.(serviceSystem?.id, payload);
          if (ok !== false) setServiceSystem(null);
        }}
      />

      <section data-testid="customer-property-manager" className="rounded-2xl border border-amber-300/35 bg-slate-950/60 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">My Properties</div>
            <h2 className="mt-1 text-xl font-semibold text-white">Property Records</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">
              Choose the property record you want to review or update. The primary property is used first for new requests.
            </p>
          </div>
          <button
            type="button"
            data-testid="customer-property-add-button"
            onClick={startAddProperty}
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-amber-300/45 bg-amber-300/15 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/25"
          >
            Add Property
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {profileOptions.map((property) => (
            <button
              key={property.id}
              type="button"
              data-testid={`customer-property-card-${property.id}`}
              onClick={() => {
                setAddingProperty(false);
                setSelectedProfileId(property.id);
              }}
              className={`rounded-2xl border p-4 text-left ${
                String(selectedProfileId) === String(property.id) && !addingProperty
                  ? "border-amber-300/60 bg-amber-300/15"
                  : "border-slate-700 bg-slate-900/60 hover:border-slate-500"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-semibold text-white">{property.display_name || "Property"}</div>
                {property.is_primary ? (
                  <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
                    Primary Property
                  </span>
                ) : null}
                {property.is_rental_property ? (
                  <span className="rounded-full border border-sky-300/40 bg-sky-400/10 px-2 py-0.5 text-[11px] font-semibold text-sky-100">
                    Rental
                  </span>
                ) : null}
              </div>
              <div className="mt-2 text-xs leading-5 text-slate-400">{property.address || "Address not set"}</div>
            </button>
          ))}
        </div>
      </section>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          addingProperty ? onAdd?.(form) : onSave?.(form);
          setAddingProperty(false);
        }}
        className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5"
      >
          <h2 className="text-xl font-semibold text-white">{addingProperty ? "Add Property" : "Property Profile"}</h2>
          <p className="mt-1 text-sm text-slate-300">
            Keep property details available for future repairs, maintenance, inspections, and project planning.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-200">
            Property name
            <input
              value={form?.display_name || ""}
              onChange={(event) => update("display_name", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Type
            <select
              value={form?.property_type || "single_family"}
              onChange={(event) => update("property_type", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            >
              <option value="single_family">Single Family</option>
              <option value="townhome">Townhome</option>
              <option value="condo">Condo</option>
              <option value="multi_family">Multi-Family</option>
              <option value="commercial">Commercial</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
            Address search
            <div className="mt-1">
              <AddressAutocomplete
                value={form?.address_line1 || ""}
                onChangeText={(value) => update("address_line1", value)}
                onSelect={(address) => {
                  setForm((prev) => ({
                    ...(prev || {}),
                    address_line1: address.line1 || prev.address_line1 || "",
                    address_line2: address.line2 || "",
                    city: address.city || prev.city || "",
                    state: address.state || prev.state || "",
                    postal_code: address.postal_code || prev.postal_code || "",
                  }));
                }}
                placeholder="Search this property address..."
                testId="customer-property-address-autocomplete"
                {...PORTAL_ADDRESS_AUTOCOMPLETE_CLASSES}
              />
            </div>
          </label>
          <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
            Street
            <input
              value={form?.address_line1 || ""}
              onChange={(event) => update("address_line1", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
            Unit / suite
            <input
              value={form?.address_line2 || ""}
              onChange={(event) => update("address_line2", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            City
            <input
              value={form?.city || ""}
              onChange={(event) => update("city", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            State
            <input
              value={form?.state || ""}
              onChange={(event) => update("state", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            ZIP
            <input
              value={form?.postal_code || ""}
              onChange={(event) => update("postal_code", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Year built
            <input
              type="number"
              value={form?.year_built || ""}
              onChange={(event) => update("year_built", event.target.value ? Number(event.target.value) : null)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Square feet
            <input
              type="number"
              value={form?.square_feet || ""}
              onChange={(event) => update("square_feet", event.target.value ? Number(event.target.value) : null)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Bedrooms
            <input
              type="number"
              min="0"
              step="1"
              value={form?.bedrooms || ""}
              onChange={(event) => update("bedrooms", event.target.value ? Number(event.target.value) : null)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Bathrooms
            <input
              type="number"
              min="0"
              step="0.5"
              value={form?.bathrooms || ""}
              onChange={(event) => update("bathrooms", event.target.value ? Number(event.target.value) : null)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
            Notes
            <textarea
              rows={4}
              value={form?.notes || ""}
              onChange={(event) => update("notes", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-3 text-sm font-medium text-slate-200 sm:col-span-2">
            <input
              type="checkbox"
              checked={!!form?.is_primary}
              onChange={(event) => update("is_primary", event.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-950"
            />
            Make this my Primary Property
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-sky-300/25 bg-slate-900/70 px-3 py-3 text-sm font-medium text-slate-200 sm:col-span-2">
            <input
              type="checkbox"
              data-testid="property-rental-toggle"
              checked={!!form?.is_rental_property}
              onChange={(event) => update("is_rental_property", event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-950"
            />
            <span>
              <span className="block text-sm font-semibold text-white">Rental Property</span>
              <span className="mt-1 block text-xs leading-5 text-slate-400">
                Enable tenant, unit, maintenance request, work order, and vendor tools for this property.
              </span>
            </span>
          </label>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="mt-5 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
          >
            {saving ? "Saving..." : addingProperty ? "Add property" : "Save property profile"}
          </button>
      </form>
    </div>
  );
}
