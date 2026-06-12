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

const HOME_SYSTEM_CONDITION_OPTIONS = [
  ["unknown", "Unknown"],
  ["excellent", "Excellent"],
  ["good", "Good"],
  ["fair", "Fair"],
  ["needs_service", "Needs Service"],
  ["replace_soon", "Replace Soon"],
];

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
    isStructured: true,
  };
}

function PropertySummarySection({ profile, profileOptions, onSelectProperty, onEdit, onAdd }) {
  const details = [
    ["Property Type", profile?.property_type_label],
    ["Year Built", profile?.year_built],
    ["Square Feet", profile?.square_feet ? Number(profile.square_feet).toLocaleString() : ""],
    ["Bedrooms", profile?.bedrooms],
    ["Bathrooms", profile?.bathrooms],
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
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="property-summary-edit" onClick={onEdit} className="rounded-xl border border-sky-300/35 bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/20">
            Edit Property
          </button>
          <button type="button" data-testid="property-summary-add" onClick={onAdd} className="rounded-xl border border-amber-300/45 bg-amber-300/15 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/25">
            Add Property
          </button>
        </div>
      </div>
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

function HomeSystemsSection({ systems = [], onAdd, onEdit, onArchive }) {
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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {systems.map((system) => (
            <article key={system.id || system.name} data-testid={`property-home-system-${String(system.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-white">{system.name}</h4>
                  <div className="mt-1 text-xs font-semibold text-slate-400">{system.system_type_label || system.conditionLabel || "Home system"}</div>
                </div>
                <span className="rounded-full border border-slate-600 bg-slate-950 px-2 py-0.5 text-[11px] font-semibold text-slate-300">
                  {system.linkedRecordsCount || system.linkedDocuments.length + system.linkedProjects.length + system.linkedRequests.length} linked
                </span>
              </div>
              <dl className="mt-3 grid gap-2 text-xs text-slate-300">
                <div><dt className="text-slate-500">Manufacturer</dt><dd className="font-semibold text-slate-100">{system.manufacturer || "Not recorded yet"}</dd></div>
                <div><dt className="text-slate-500">Model</dt><dd className="font-semibold text-slate-100">{system.model || "Not recorded yet"}</dd></div>
                <div><dt className="text-slate-500">Install date</dt><dd className="font-semibold text-slate-100">{system.installDate ? formatDate(system.installDate) : "Not recorded yet"}</dd></div>
                <div><dt className="text-slate-500">Last service</dt><dd className="font-semibold text-slate-100">{system.lastServiceDate ? formatDate(system.lastServiceDate) : "No service record yet"}</dd></div>
                <div><dt className="text-slate-500">Warranty expiration</dt><dd className="font-semibold text-slate-100">{system.warrantyExpiration ? formatDate(system.warrantyExpiration) : "Not recorded yet"}</dd></div>
                <div><dt className="text-slate-500">Condition</dt><dd className="font-semibold text-slate-100">{system.conditionLabel || "Unknown"}</dd></div>
              </dl>
              {system.notes ? <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-400">{system.notes}</p> : null}
              {system.isStructured ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" data-testid={`property-home-system-edit-${system.id}`} onClick={() => onEdit?.(system)} className="rounded-xl border border-sky-300/35 bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/20">
                    Edit System
                  </button>
                  <button type="button" data-testid={`property-home-system-archive-${system.id}`} onClick={() => onArchive?.(system)} className="rounded-xl border border-red-300/35 bg-red-400/10 px-3 py-2 text-sm font-semibold text-red-100 hover:bg-red-400/20">
                    Archive
                  </button>
                </div>
              ) : null}
            </article>
          ))}
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
  overdue: "Overdue",
  due_soon: "Due Soon",
  warranty_expiring: "Warranty Expiring",
  warranty_expired: "Warranty Attention",
  lifespan_attention: "Nearing End of Life",
  current: "Current",
  unknown: "Unknown",
};

function MaintenanceCenter({ intelligence = {}, maintenance = [], systems = [], onMarkServiced, onEditSystem, onCreateServiceRequest, onDismissReminder }) {
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
    ["Maintenance status", health.label || "Needs Attention", health.summary || "Add service records to improve recommendations."],
    ["Upcoming suggested maintenance", `${groupedSystems.due_soon.length + groupedSystems.warranty_expiring.length || (buckets.upcoming || []).length}`, groupedSystems.due_soon[0]?.name || groupedSystems.warranty_expiring[0]?.name || (buckets.upcoming || [])[0]?.title || "No upcoming suggestions right now."],
    ["Completed maintenance", `${maintenance.filter((row) => String(row.status).toLowerCase().includes("complete")).length}`, "Completed service visits linked to this property."],
    ["Overdue items", `${groupedSystems.overdue.length || (buckets.needs_attention || []).length}`, groupedSystems.overdue[0]?.name || (buckets.needs_attention || [])[0]?.title || "No overdue items detected."],
  ];
  const renderSystemCard = (system) => (
    <article key={system.id} data-testid="property-maintenance-reminder-card" className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-white">{system.name}</div>
          <div className="mt-1 text-xs text-slate-400">{system.system_type_label || "Home system"} - {MAINTENANCE_STATUS_LABELS[system.maintenanceStatus] || "Unknown"}</div>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${system.priority === "high" ? "border-rose-300/50 bg-rose-400/15 text-rose-100" : system.priority === "medium" ? "border-amber-300/50 bg-amber-300/15 text-amber-100" : "border-slate-600 bg-slate-900 text-slate-300"}`}>
          {system.priority || "low"}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-300">{system.reminderReason || "Add service and warranty records to improve this recommendation."}</p>
      <dl className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
        <div><dt className="text-slate-500">Last service</dt><dd className="font-semibold text-slate-200">{system.lastServiceDate ? formatDate(system.lastServiceDate) : "Not recorded"}</dd></div>
        <div><dt className="text-slate-500">Next suggested</dt><dd className="font-semibold text-slate-200">{system.nextRecommendedServiceDate ? formatDate(system.nextRecommendedServiceDate) : "Needs details"}</dd></div>
        <div><dt className="text-slate-500">Warranty</dt><dd className="font-semibold text-slate-200">{system.warrantyExpiration ? formatDate(system.warrantyExpiration) : "Not recorded"}</dd></div>
        <div><dt className="text-slate-500">Reminders</dt><dd className="font-semibold text-slate-200">{system.remindersEnabled ? `${system.reminderLeadDays} day ${system.reminderFrequency}` : "Off"}</dd></div>
        <div><dt className="text-slate-500">Last reminded</dt><dd className="font-semibold text-slate-200">{system.lastNotifiedAt ? formatDate(system.lastNotifiedAt) : "Not sent"}</dd></div>
        <div><dt className="text-slate-500">Next reminder</dt><dd className="font-semibold text-slate-200">{system.nextNotificationAt ? formatDate(system.nextNotificationAt) : system.dismissedUntil ? `Dismissed until ${formatDate(system.dismissedUntil)}` : "Not scheduled"}</dd></div>
      </dl>
      <div className="mt-3 text-xs text-slate-400">
        Channels: {[
          system.emailRemindersEnabled ? "Email" : "",
          system.smsRemindersEnabled ? "SMS" : "",
        ].filter(Boolean).join(", ") || "None"}
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
    <Section title="Maintenance Center" eyebrow="Compact property health" testId="property-maintenance-center">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, body]) => (
          <div key={label} className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-2 text-2xl font-black text-white">{value}</div>
            <p className="mt-2 text-sm leading-5 text-slate-400">{body}</p>
          </div>
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

function HomeRecordsDashboard({ profile, projects, requests, agreements, documents, payments, maintenanceWorkOrders, propertyIntelligence, onOpenRequest, onAddSystem, onEditSystem, onArchiveSystem, onMarkServiced, onCreateServiceRequest, onDismissReminder }) {
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const maintenance = maintenanceRows(maintenanceWorkOrders);
  const hasStructuredSystems = Array.isArray(profile?.home_systems);
  const systems = hasStructuredSystems
    ? (profile.home_systems || []).map(normalizeHomeSystem)
    : systemRows({ projects, agreements, documents, requests, maintenanceWorkOrders, propertyIntelligence });
  const timeline = timelineRows({ profile, projects, requests, agreements, documents, payments, maintenanceWorkOrders, homeSystems: systems.filter((system) => system.isStructured) });
  const timelineDefaultCount = 5;
  const visibleTimeline = timelineExpanded ? timeline : timeline.slice(0, timelineDefaultCount);

  return (
    <div className="space-y-5">
      <HomeSystemsSection systems={systems} onAdd={onAddSystem} onEdit={onEditSystem} onArchive={onArchiveSystem} />

      <MaintenanceCenter
        intelligence={propertyIntelligence}
        maintenance={maintenance}
        systems={systems.filter((system) => system.isStructured)}
        onMarkServiced={onMarkServiced}
        onEditSystem={onEditSystem}
        onCreateServiceRequest={onCreateServiceRequest}
        onDismissReminder={onDismissReminder}
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
  onCreateSystemServiceRequest,
  saving = false,
  systemSaving = false,
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
  const [systemForm, setSystemForm] = useState(emptySystemForm(selectedProfile?.id));
  const [serviceSystem, setServiceSystem] = useState(null);
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
      />

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
        onCreateServiceRequest={async (system) => {
          await onCreateSystemServiceRequest?.(system.id);
        }}
        onDismissReminder={async (system) => {
          const dismissedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          await onUpdateSystem?.(system.id, { dismissed_until: dismissedUntil });
        }}
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
