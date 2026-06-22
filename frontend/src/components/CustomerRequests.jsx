import React, { useEffect, useMemo, useState } from "react";
import AddressAutocomplete from "./AddressAutocomplete.jsx";
import ContractorDiscoveryStep from "./intake/ContractorDiscoveryStep.jsx";

const REQUEST_TYPES = [
  ["repair", "Repair"],
  ["maintenance", "Maintenance"],
  ["new_project", "New Project"],
  ["diy_assistance", "DIY Assistance"],
  ["inspection", "Inspection"],
  ["emergency", "Emergency"],
];

const PROJECT_MODES = [
  ["full_service", "Full service"],
  ["diy_assist", "DIY Assistance"],
  ["inspection_only", "Consultation / advice"],
  ["not_sure", "Not sure yet"],
];

const TIMELINE_OPTIONS = [
  ["", "Not provided"],
  ["As soon as possible", "As soon as possible"],
  ["Within the next month", "Within the next month"],
  ["1-3 months", "1-3 months"],
  ["Just planning right now", "Just planning right now"],
  ["Specific date", "Specific date"],
];

const PAYMENT_PREFERENCES = [
  ["", "Not sure yet"],
  ["escrow_milestones", "Escrow milestone holds"],
  ["direct_pay", "Direct payment"],
  ["discuss", "Discuss with contractor"],
];

const NEW_PROPERTY_VALUE = "__new_property__";

const TENANT_MAINTENANCE_STATUS_ACTIONS = [
  ["under_review", "Mark Under Review"],
  ["approved", "Approve"],
  ["more_info_requested", "Request More Info"],
  ["rejected", "Reject"],
  ["closed", "Close"],
];

const WORK_ORDER_CATEGORIES = [
  ["general_repair", "General Repair"],
  ["plumbing", "Plumbing"],
  ["electrical", "Electrical"],
  ["hvac", "HVAC"],
  ["appliance", "Appliance"],
  ["pest", "Pest"],
  ["access_lock", "Access / Lock"],
  ["safety", "Safety"],
  ["other", "Other"],
];

const WORK_ORDER_PRIORITIES = [
  ["emergency", "Emergency"],
  ["urgent", "Urgent"],
  ["normal", "Normal"],
  ["low", "Low"],
];

const WORK_ORDER_STATUSES = [
  ["open", "Open"],
  ["scheduled", "Scheduled"],
  ["in_progress", "In Progress"],
  ["waiting", "Waiting"],
  ["completed", "Completed"],
  ["closed", "Closed"],
  ["cancelled", "Cancelled"],
];

const WORK_ORDER_ASSIGNMENT_TYPES = [
  ["internal_staff", "Internal Staff"],
  ["vendor", "Vendor"],
  ["marketplace_contractor", "Marketplace Contractor"],
];

const MAINTENANCE_FILTERS = [
  ["active", "Active"],
  ["archived", "Archived"],
  ["all", "All"],
];

const SEARCH_RADIUS_OPTIONS = [5, 10, 25, 50, 100];

const TENANT_MAINTENANCE_ACTIVE_STATUSES = new Set(["submitted", "under_review", "more_info_requested", "approved"]);
const TENANT_MAINTENANCE_ARCHIVED_STATUSES = new Set(["rejected", "closed"]);
const WORK_ORDER_ACTIVE_STATUSES = new Set(["open", "scheduled", "in_progress", "waiting"]);
const WORK_ORDER_ARCHIVED_STATUSES = new Set(["completed", "closed", "cancelled"]);

const DEFAULT_WORK_ORDER_FORM = {
  title: "",
  description: "",
  category: "general_repair",
  priority: "normal",
  status: "open",
  unit_id: "",
  tenant_id: "",
  assignment_type: "internal_staff",
  assigned_staff_member_id: "",
  assigned_vendor_id: "",
  assigned_contractor_id: "",
  scheduled_for: "",
  internal_notes: "",
  completion_notes: "",
};

function Badge({ children }) {
  return (
    <span className="inline-flex rounded-full border border-slate-600 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-200">
      {children}
    </span>
  );
}

function HighlightBadge({ children }) {
  return (
    <span className="inline-flex rounded-full border border-amber-200/40 bg-amber-300/15 px-2.5 py-1 text-xs font-bold text-amber-100">
      {children}
    </span>
  );
}

function PassiveBadge({ children, tone = "slate" }) {
  const classes = {
    slate: "border-slate-700 bg-slate-950/70 text-slate-300",
    amber: "border-amber-200/35 bg-amber-300/10 text-amber-100",
    sky: "border-sky-300/30 bg-sky-400/10 text-sky-100",
    rose: "border-rose-300/35 bg-rose-400/10 text-rose-100",
  };
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${classes[tone] || classes.slate}`}>
      {children}
    </span>
  );
}

function EmptyState({ title, children, testId }) {
  return (
    <div data-testid={testId} className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-5 text-sm text-slate-300">
      <div className="font-semibold text-white">{title}</div>
      <p className="mt-1 leading-6 text-slate-400">{children}</p>
    </div>
  );
}

function statusMatchesFilter(status, filter, activeStatuses, archivedStatuses) {
  const normalized = String(status || "").toLowerCase();
  if (filter === "all") return true;
  if (filter === "archived") return archivedStatuses.has(normalized);
  return activeStatuses.has(normalized);
}

function MaintenanceFilterControls({ value, onChange, testIdPrefix, label }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      {MAINTENANCE_FILTERS.map(([filterValue, filterLabel]) => {
        const active = value === filterValue;
        return (
          <button
            key={filterValue}
            type="button"
            data-testid={`${testIdPrefix}-${filterValue}`}
            onClick={() => onChange(filterValue)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
              active
                ? "border-amber-200 bg-amber-300 text-slate-950"
                : "border-slate-700 bg-slate-950/70 text-slate-300 hover:border-amber-300/50 hover:text-white"
            }`}
          >
            {filterLabel}
          </button>
        );
      })}
    </div>
  );
}

function tenantMaintenanceEmptyTitle(filter) {
  if (filter === "active") return "No active maintenance requests.";
  if (filter === "archived") return "No archived maintenance requests yet.";
  return "No maintenance requests yet.";
}

function workOrderEmptyTitle(filter) {
  if (filter === "active") return "No active work orders.";
  if (filter === "archived") return "No archived work orders yet.";
  return "No work orders yet.";
}

function parseMoney(value) {
  const cleaned = String(value || "").replace(/[^0-9.]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function timelineScore(value) {
  const text = String(value || "").toLowerCase();
  const number = Number((text.match(/\d+/) || [])[0]);
  if (!Number.isFinite(number)) return Number.POSITIVE_INFINITY;
  if (text.includes("day")) return number;
  if (text.includes("week")) return number * 7;
  if (text.includes("month")) return number * 30;
  if (text.includes("q1") || text.includes("q2") || text.includes("q3") || text.includes("q4")) return 90;
  return number;
}

function formatDateTime(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch (_error) {
    return "";
  }
}

function TenantMaintenanceReviewQueue({
  requests = [],
  onReview,
  onCreateWorkOrder,
  updatingId = "",
  convertingId = "",
}) {
  const [notesById, setNotesById] = useState({});
  const [requestFilter, setRequestFilter] = useState("active");
  const filteredRequests = requests.filter((request) =>
    statusMatchesFilter(request.status, requestFilter, TENANT_MAINTENANCE_ACTIVE_STATUSES, TENANT_MAINTENANCE_ARCHIVED_STATUSES)
  );

  const noteFor = (request) => {
    const key = String(request.id || "");
    return Object.prototype.hasOwnProperty.call(notesById, key)
      ? notesById[key]
      : request.manager_notes || "";
  };

  const submitReview = (request, status) => {
    if (!request?.id || !request?.property_profile_id || !onReview) return;
    onReview(request.property_profile_id, request.id, {
      status,
      manager_notes: noteFor(request),
    });
  };

  return (
    <section data-testid="tenant-maintenance-review-queue" className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Maintenance Requests</h2>
          <p className="mt-1 text-sm text-slate-300">
            Review resident-submitted maintenance requests before converting them into work orders later.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Badge>{filteredRequests.length} tenant request{filteredRequests.length === 1 ? "" : "s"}</Badge>
          <MaintenanceFilterControls
            value={requestFilter}
            onChange={setRequestFilter}
            testIdPrefix="tenant-maintenance-filter"
            label="Filter maintenance requests"
          />
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {filteredRequests.length ? (
          filteredRequests.map((request) => {
            const busy = String(updatingId) === String(request.id);
            return (
              <article
                key={request.id}
                data-testid={`tenant-maintenance-request-${request.id}`}
                className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">{request.title || "Maintenance request"}</h3>
                      <PassiveBadge tone={request.urgency === "emergency" || request.urgency === "urgent" ? "rose" : "amber"}>
                        {request.urgency_label || request.urgency || "Normal"}
                      </PassiveBadge>
                      <PassiveBadge tone="sky">{request.status_label || "Submitted"}</PassiveBadge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{request.description || "No description provided."}</p>
                    <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2 lg:grid-cols-4">
                      <span><strong className="text-slate-200">Resident:</strong> {request.submitted_by_name || request.tenant_name || "Resident"}</span>
                      <span><strong className="text-slate-200">Unit:</strong> {request.unit_label || "Whole property"}</span>
                      <span><strong className="text-slate-200">Category:</strong> {request.category_label || "General Repair"}</span>
                      <span><strong className="text-slate-200">Submitted:</strong> {formatDateTime(request.created_at) || "Recently"}</span>
                    </div>
                    <div className="mt-2 grid gap-2 text-xs text-slate-400 sm:grid-cols-3">
                      <span><strong className="text-slate-200">Email:</strong> {request.submitted_by_email || "-"}</span>
                      <span><strong className="text-slate-200">Phone:</strong> {request.submitted_by_phone || "-"}</span>
                      <span><strong className="text-slate-200">Access:</strong> {request.permission_to_enter ? "Permission to enter" : "Coordinate first"}</span>
                    </div>
                    {(request.attachments || []).length ? (
                      <div data-testid={`tenant-maintenance-attachments-${request.id}`} className="mt-3 flex flex-wrap gap-2">
                        {request.attachments.map((attachment) => (
                          <a
                            key={attachment.id || attachment.url || attachment.filename}
                            href={attachment.url || "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-full items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs font-semibold text-slate-200 hover:border-sky-300/50"
                          >
                            {attachment.is_image && attachment.url ? (
                              <img
                                src={attachment.url}
                                alt=""
                                className="h-10 w-10 rounded-lg border border-slate-700 object-cover"
                              />
                            ) : null}
                            <span className="min-w-0 truncate">{attachment.filename || "Attachment"}</span>
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-xs text-slate-500">{request.reference || `#${request.id}`}</div>
                </div>

                <label className="mt-4 block text-sm font-medium text-slate-200">
                  Manager notes
                  <textarea
                    data-testid={`tenant-maintenance-notes-${request.id}`}
                    value={noteFor(request)}
                    onChange={(event) => setNotesById((prev) => ({ ...prev, [request.id]: event.target.value }))}
                    rows={2}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                  />
                </label>

                <div className="mt-3 flex flex-wrap gap-2" data-testid={`tenant-maintenance-actions-${request.id}`}>
                  {TENANT_MAINTENANCE_STATUS_ACTIONS.map(([status, label]) => (
                    <button
                      key={status}
                      type="button"
                      data-testid={`tenant-maintenance-${status}-${request.id}`}
                      disabled={busy}
                      onClick={() => submitReview(request, status)}
                      className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-amber-300/60 hover:bg-amber-300/10 disabled:opacity-50"
                    >
                      {busy ? "Saving..." : label}
                    </button>
                  ))}
                  <button
                    type="button"
                    data-testid={`tenant-maintenance-save-notes-${request.id}`}
                    disabled={busy}
                    onClick={() => submitReview(request, request.status || "under_review")}
                    className="rounded-lg bg-amber-300 px-3 py-1.5 text-xs font-extrabold text-slate-950 hover:bg-amber-200 disabled:opacity-50"
                  >
                    Save Notes
                  </button>
                  {request.can_create_work_order || (request.status === "approved" && !request.converted_to_work_order) ? (
                    <button
                      type="button"
                      data-testid={`tenant-maintenance-create-work-order-${request.id}`}
                      disabled={busy || String(convertingId) === String(request.id)}
                      onClick={() => onCreateWorkOrder?.(request)}
                      className="rounded-lg border border-emerald-300/45 bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-50"
                    >
                      {String(convertingId) === String(request.id) ? "Creating..." : "Create Work Order"}
                    </button>
                  ) : null}
                  {request.converted_to_work_order ? (
                    <PassiveBadge tone="sky">Work Order {request.work_order_number || "Created"}</PassiveBadge>
                  ) : null}
                </div>
              </article>
            );
          })
        ) : (
          <EmptyState title={tenantMaintenanceEmptyTitle(requestFilter)} testId="tenant-maintenance-requests-empty">
            {requestFilter === "archived"
              ? "Closed or rejected resident maintenance requests will remain available here as history."
              : "Resident-submitted maintenance requests will appear here for manager review."}
          </EmptyState>
        )}
      </div>
    </section>
  );
}

function workOrderFormFromRow(row = {}) {
  if (!row?.id) return DEFAULT_WORK_ORDER_FORM;
  const scheduled = row.scheduled_for ? String(row.scheduled_for).slice(0, 16) : "";
  return {
    title: row.title || "",
    description: row.description || "",
    category: row.category || "general_repair",
    priority: row.priority || "normal",
    status: row.status || "open",
    unit_id: row.unit_id || "",
    tenant_id: row.tenant_id || "",
    assignment_type: row.assignment_type || "internal_staff",
    assigned_staff_member_id: row.assigned_staff_member_id || "",
    assigned_vendor_id: row.assigned_vendor_id || "",
    assigned_contractor_id: row.assigned_contractor_id || "",
    scheduled_for: scheduled,
    internal_notes: row.internal_notes || "",
    completion_notes: row.completion_notes || "",
  };
}

function PropertyWorkOrdersSection({
  workOrders = [],
  propertyProfile = {},
  propertyProfiles = [],
  teamMembers = [],
  vendors = [],
  onCreate,
  onUpdate,
  onSendToMarketplace,
  onWithdrawMarketplace,
  onCreateAgreementDraft,
  onPreviewContractorMatches,
  onImportVendor,
  saving = false,
}) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(DEFAULT_WORK_ORDER_FORM);
  const [completionFiles, setCompletionFiles] = useState([]);
  const [error, setError] = useState("");
  const [vendorSearch, setVendorSearch] = useState("");
  const [marketplaceSearch, setMarketplaceSearch] = useState({ location: "", search: "", radius_miles: "25" });
  const [marketplaceMatches, setMarketplaceMatches] = useState(null);
  const [marketplaceSearching, setMarketplaceSearching] = useState(false);
  const [marketplaceImportingKey, setMarketplaceImportingKey] = useState("");
  const [workOrderFilter, setWorkOrderFilter] = useState("active");
  const [workflowStep, setWorkflowStep] = useState(1);
  const [selectedRecipients, setSelectedRecipients] = useState([]);
  const propertyOptions = propertyProfiles.length ? propertyProfiles : propertyProfile?.id ? [propertyProfile] : [];
  const activePropertyId = editing?.property_profile_id || form.property_id || propertyProfile?.id || propertyOptions[0]?.id || "";
  const activeProperty = propertyOptions.find((property) => String(property.id) === String(activePropertyId)) || propertyProfile || {};
  const units = activeProperty?.units || propertyProfile?.units || [];
  const tenants = activeProperty?.tenants || propertyProfile?.tenants || [];
  const activeStaff = teamMembers.filter((member) => member.status === "active");
  const activeVendors = vendors.filter((vendor) => vendor.status === "active");
  const matchingVendors = activeVendors.filter((vendor) => {
    const text = `${vendor.name || ""} ${vendor.trade_category || ""} ${vendor.email || ""} ${vendor.phone || ""}`.toLowerCase();
    return !vendorSearch.trim() || text.includes(vendorSearch.trim().toLowerCase());
  });
  const filteredWorkOrders = workOrders.filter((row) =>
    statusMatchesFilter(row.status, workOrderFilter, WORK_ORDER_ACTIVE_STATUSES, WORK_ORDER_ARCHIVED_STATUSES)
  );
  const marketplaceEligibleCount = Number(marketplaceMatches?.eligible_marketplace_count || 0);
  const selectedMarketplaceContractorIds = selectedRecipients
    .filter((recipient) => recipient.source === "myhomebro_contractor" && recipient.directory_entry_id)
    .map((recipient) => Number(recipient.directory_entry_id));
  const selectedMarketplaceCount = selectedMarketplaceContractorIds.length;
  const selectedRecipientCount = selectedRecipients.length;
  const selectedRecipientCountValid = selectedRecipientCount >= 3 && selectedRecipientCount <= 5;
  const canSendToMarketplace =
    form.assignment_type === "marketplace_contractor" &&
    selectedMarketplaceCount >= 3 &&
    selectedMarketplaceCount <= 5 &&
    marketplaceEligibleCount > 0;
  const marketplaceSendHelper =
    selectedRecipientCount && !canSendToMarketplace
      ? selectedMarketplaceCount > 0
        ? "Only MyHomeBro contractors can receive marketplace opportunities right now. Select at least 3 MyHomeBro contractors to send, or save this work order for review."
        : "Selected preferred vendors and local businesses are review-only for now. Import/save local businesses as vendors or select at least 3 MyHomeBro contractors to send marketplace opportunities."
      : "";
  const marketplaceDisplayLocation = marketplaceMatches?.display_location || marketplaceMatches?.location || marketplaceSearch.location || "this property";
  const marketplaceRadius = marketplaceMatches?.radius_miles || marketplaceSearch.radius_miles || 25;
  const marketplaceGeocodeFailed = Boolean(
    marketplaceMatches?.diagnostics?.geocode_error &&
      marketplaceMatches?.diagnostics?.geocode_error !== "google_geocode_api_key_missing" &&
      !marketplaceMatches?.diagnostics?.geocoded
  );

  const resetMarketplacePreview = () => {
    setMarketplaceMatches(null);
    setMarketplaceSearching(false);
    setMarketplaceImportingKey("");
    setSelectedRecipients([]);
  };

  const openCreate = () => {
    setEditing({ mode: "create" });
    setForm({ ...DEFAULT_WORK_ORDER_FORM, property_id: activePropertyId || "" });
    setCompletionFiles([]);
    setVendorSearch("");
    setMarketplaceSearch({ location: activeProperty?.address || activeProperty?.display_name || "", search: "", radius_miles: "25" });
    resetMarketplacePreview();
    setWorkflowStep(1);
    setError("");
  };

  const openEdit = (row, overrides = {}) => {
    setEditing(row);
    setForm({ ...workOrderFormFromRow(row), ...overrides, property_id: row.property_profile_id || activePropertyId || "" });
    setCompletionFiles([]);
    setVendorSearch(row.assigned_vendor_name || row.assigned_vendor_trade_category || "");
    const propertyForRow = propertyOptions.find((property) => String(property.id) === String(row.property_profile_id || activePropertyId)) || activeProperty || propertyProfile || {};
    setMarketplaceSearch({
      location: propertyForRow.address || propertyForRow.display_name || row.property_name || "",
      search: "",
      radius_miles: "25",
    });
    resetMarketplacePreview();
    setWorkflowStep(1);
    setError("");
  };

  const close = () => {
    if (saving) return;
    setEditing(null);
    setForm(DEFAULT_WORK_ORDER_FORM);
    setCompletionFiles([]);
    setVendorSearch("");
    setMarketplaceSearch({ location: "", search: "", radius_miles: "25" });
    resetMarketplacePreview();
    setWorkflowStep(1);
    setError("");
  };

  const update = (field, value) => {
    setForm((prev) => {
      if (field === "assignment_type") {
        resetMarketplacePreview();
        return {
          ...prev,
          assignment_type: value,
          assigned_staff_member_id: value === "internal_staff" ? prev.assigned_staff_member_id : "",
          assigned_vendor_id: value === "vendor" ? prev.assigned_vendor_id : "",
          assigned_contractor_id: value === "marketplace_contractor" ? prev.assigned_contractor_id : "",
        };
      }
      if (["category", "priority", "unit_id", "tenant_id"].includes(field)) {
        resetMarketplacePreview();
      }
      return { ...prev, [field]: value };
    });
    setError("");
  };

  const recipientKey = (recipient) => `${recipient.source}:${recipient.directory_entry_id || recipient.vendor_id || recipient.business_id || recipient.name}`;
  const recipientFromContractor = (contractor) => ({
    source: "myhomebro_contractor",
    source_label: "MyHomeBro Contractor",
    directory_entry_id: contractor.directory_entry_id,
    contractor_id: contractor.contractor_id,
    name: contractor.business_name || "MyHomeBro Contractor",
    trade: contractor.primary_trade || contractor.trade_categories?.join?.(", ") || marketplaceMatches?.trade || "",
    location: contractor.location || "",
  });
  const recipientFromVendor = (vendor) => ({
    source: "preferred_vendor",
    source_label: "Preferred Vendor",
    vendor_id: vendor.id,
    name: vendor.name || "Vendor",
    trade: vendor.trade_category || "",
    location: vendor.email || vendor.phone || "",
  });
  const recipientFromBusiness = (business) => ({
    source: "local_business",
    source_label: "Local Business",
    business_id: business.business_id || business.business_name,
    name: business.business_name || "Local Business",
    trade: business.trade_category || marketplaceMatches?.trade || "",
    location: business.location || business.address || "",
  });
  const recipientSelected = (recipient) => {
    const key = recipientKey(recipient);
    return selectedRecipients.some((item) => recipientKey(item) === key);
  };
  const toggleRecipient = (recipient) => {
    const key = recipientKey(recipient);
    setSelectedRecipients((prev) => {
      if (prev.some((item) => recipientKey(item) === key)) {
        return prev.filter((item) => recipientKey(item) !== key);
      }
      if (prev.length >= 5) return prev;
      return [...prev, recipient];
    });
  };

  const continueFromDetails = () => {
    if (!form.title.trim() || !form.description.trim()) {
      setError("Add a title and description before continuing.");
      return;
    }
    setError("");
    setWorkflowStep(form.assignment_type === "internal_staff" ? 3 : 2);
  };

  const continueFromContractors = () => {
    if (form.assignment_type === "vendor" && !form.assigned_vendor_id && !selectedRecipients.some((recipient) => recipient.source === "preferred_vendor")) {
      setError("Choose a preferred vendor before continuing.");
      return;
    }
    if (form.assignment_type === "marketplace_contractor" && !selectedRecipientCountValid) {
      setError("Select 3-5 total recipients before continuing.");
      return;
    }
    setError("");
    setWorkflowStep(3);
  };

  const submit = async (event, options = {}) => {
    event.preventDefault();
    if (!form.title.trim() || !form.description.trim()) return;
    if (form.status === "completed" && !form.completion_notes.trim()) {
      setError("Completion notes are required before marking a work order completed.");
      return;
    }
    const payloadObject = {
      title: form.title,
      description: form.description,
      category: form.category,
      priority: form.priority,
      status: form.status,
      unit_id: form.unit_id ? Number(form.unit_id) : null,
      tenant_id: form.tenant_id ? Number(form.tenant_id) : null,
      assignment_type: form.assignment_type || "internal_staff",
      assigned_staff_member_id: form.assignment_type === "internal_staff" && form.assigned_staff_member_id ? Number(form.assigned_staff_member_id) : null,
      assigned_vendor_id: form.assignment_type === "vendor" && form.assigned_vendor_id ? Number(form.assigned_vendor_id) : null,
      assigned_contractor_id: form.assignment_type === "marketplace_contractor" && form.assigned_contractor_id ? Number(form.assigned_contractor_id) : null,
      scheduled_for: form.scheduled_for || "",
      internal_notes: form.internal_notes,
      completion_notes: form.completion_notes,
    };
    let payload = payloadObject;
    if (completionFiles.length) {
      payload = new FormData();
      Object.entries(payloadObject).forEach(([key, value]) => {
        payload.append(key, value ?? "");
      });
      payload.append("attachment_type", "completion_photo");
      completionFiles.forEach((file) => payload.append("completion_attachments", file));
    }
    try {
      if (editing?.mode === "create") {
          const created = await onCreate?.(form.property_id || activePropertyId, payload);
          if (options.sendToMarketplace && form.assignment_type === "marketplace_contractor" && created?.work_order?.id) {
            await onSendToMarketplace?.(form.property_id || activePropertyId, created.work_order.id, { directory_entry_ids: selectedMarketplaceContractorIds });
          }
      } else {
        await onUpdate?.(editing.property_profile_id || activePropertyId, editing.id, payload);
        if (options.sendToMarketplace && form.assignment_type === "marketplace_contractor") {
          await onSendToMarketplace?.(editing.property_profile_id || activePropertyId, editing.id, { directory_entry_ids: selectedMarketplaceContractorIds });
        }
      }
      close();
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not save that work order.");
    }
  };

  const quickStatus = async (row, status) => {
    if (!row?.id) return;
    try {
      await onUpdate?.(row.property_profile_id || activePropertyId, row.id, { status });
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not update that work order.");
    }
  };

  const sendToMarketplace = async (row) => {
    if (!row?.id) return;
    try {
      await onSendToMarketplace?.(row.property_profile_id || activePropertyId, row.id);
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not send that work order to the marketplace.");
    }
  };

  const withdrawMarketplace = async (row) => {
    if (!row?.id) return;
    try {
      await onWithdrawMarketplace?.(row.property_profile_id || activePropertyId, row.id);
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not withdraw that marketplace work order.");
    }
  };

  const createAgreementDraft = async (row) => {
    if (!row?.id) return;
    try {
      await onCreateAgreementDraft?.(row.property_profile_id || activePropertyId, row.id);
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not create that agreement draft.");
    }
  };

  const previewMarketplaceMatches = async () => {
    if (!editing?.id || editing?.mode === "create") return;
    setMarketplaceSearching(true);
    setError("");
    try {
      const data = await onPreviewContractorMatches?.(editing.property_profile_id || activePropertyId, editing.id, marketplaceSearch);
      setMarketplaceMatches(data || { myhomebro_contractors: [], local_businesses: [], eligible_marketplace_count: 0 });
    } catch (err) {
      setMarketplaceMatches(null);
      setError(err?.response?.data?.detail || "Could not preview contractor matches.");
    } finally {
      setMarketplaceSearching(false);
    }
  };

  const importLocalBusinessVendor = async (row) => {
    const key = row.business_id || row.business_name || row.name;
    setMarketplaceImportingKey(String(key || ""));
    setError("");
    try {
      await onImportVendor?.({
        import_type: "local_business",
        business_id: row.business_id,
        name: row.business_name || row.name || "",
        trade_category: row.trade_category || row.primary_trade || marketplaceMatches?.trade || "",
        phone: row.phone || "",
        website: row.website || "",
        address: row.address || "",
        city: row.city || "",
        state: row.state || "",
        rating: row.rating || undefined,
        source_metadata: row.source_metadata || row,
      });
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not import that local business as a vendor.");
    } finally {
      setMarketplaceImportingKey("");
    }
  };

  return (
    <section data-testid="property-work-orders-section" className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Work Orders</h2>
          <p className="mt-1 text-sm text-slate-300">
            Track approved maintenance follow-up, staff ownership, schedule, and completion notes.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Badge>{filteredWorkOrders.length} work order{filteredWorkOrders.length === 1 ? "" : "s"}</Badge>
          <MaintenanceFilterControls
            value={workOrderFilter}
            onChange={setWorkOrderFilter}
            testIdPrefix="property-work-order-filter"
            label="Filter work orders"
          />
          <button
            type="button"
            data-testid="property-work-order-add"
            onClick={openCreate}
            className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-extrabold text-slate-950 hover:bg-amber-200"
          >
            Create Work Order
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {filteredWorkOrders.length ? (
          filteredWorkOrders.map((row) => (
            <article key={row.id} data-testid={`property-work-order-${row.id}`} className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">{row.title || "Work order"}</h3>
                    <PassiveBadge tone={row.priority === "emergency" || row.priority === "urgent" ? "rose" : "amber"}>
                      {row.priority_label || row.priority || "Normal"}
                    </PassiveBadge>
                    <PassiveBadge tone="sky">{row.status_label || row.status || "Open"}</PassiveBadge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{row.description || "No description provided."}</p>
                  <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2 lg:grid-cols-4">
                    <span><strong className="text-slate-200">Property:</strong> {row.property_name || "Property"}</span>
                    <span><strong className="text-slate-200">Unit:</strong> {row.unit_label || "Whole property"}</span>
                    <span><strong className="text-slate-200">Tenant:</strong> {row.tenant_name || "-"}</span>
                    <span><strong className="text-slate-200">Assignment Type:</strong> {row.assignment_type_label || WORK_ORDER_ASSIGNMENT_TYPES.find(([value]) => value === row.assignment_type)?.[1] || "Internal Staff"}</span>
                    <span>
                      <strong className="text-slate-200">Assigned:</strong>{" "}
                      {row.assignment_type === "vendor"
                        ? row.assigned_vendor_name || "Unassigned vendor"
                        : row.assignment_type === "marketplace_contractor"
                          ? row.assigned_contractor_name || "Ready to send to marketplace contractors"
                          : row.assigned_staff_member_name || "-"}
                    </span>
                    <span><strong className="text-slate-200">Scheduled:</strong> {formatDateTime(row.scheduled_for) || "-"}</span>
                    <span><strong className="text-slate-200">Source:</strong> {row.source_tenant_request_reference || "Manual"}</span>
                    {row.assignment_type === "marketplace_contractor" ? (
                      <>
                        <span><strong className="text-slate-200">Marketplace:</strong> {row.marketplace_status_label || "Not Sent"}</span>
                        <span><strong className="text-slate-200">Sent:</strong> {formatDateTime(row.marketplace_sent_at) || "-"}</span>
                        <span><strong className="text-slate-200">Response:</strong> {formatDateTime(row.marketplace_response_at) || "-"}</span>
                        <span><strong className="text-slate-200">Agreement:</strong> {row.linked_agreement_id ? `Draft #${row.linked_agreement_id}` : "Not created"}</span>
                      </>
                    ) : null}
                  </div>
                  {(row.source_attachments || []).length ? (
                    <div data-testid={`property-work-order-attachments-${row.id}`} className="mt-3 flex flex-wrap gap-2">
                      {row.source_attachments.map((attachment) => (
                        <a
                          key={attachment.id || attachment.filename}
                          href={attachment.url || "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs font-semibold text-slate-200 hover:border-sky-300/50"
                        >
                          {attachment.filename || "Attachment"}
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {(row.completion_attachments || []).length ? (
                    <div data-testid={`property-work-order-completion-attachments-${row.id}`} className="mt-3">
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Completion Evidence</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {row.completion_attachments.map((attachment) => (
                          <a
                            key={attachment.id || attachment.filename}
                            href={attachment.url || "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-2.5 py-2 text-xs font-semibold text-emerald-100 hover:border-emerald-200/60"
                          >
                            {attachment.filename || "Attachment"}
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {(row.timeline || row.activities || []).length ? (
                    <div data-testid={`property-work-order-timeline-${row.id}`} className="mt-3 rounded-xl border border-slate-700 bg-slate-950/70 p-3">
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Activity Timeline</div>
                      <div className="mt-2 space-y-1">
                        {(row.timeline || row.activities || []).map((activity) => (
                          <div key={activity.id || `${activity.activity_type}-${activity.created_at}`} className="text-xs leading-5 text-slate-300">
                            <strong className="text-slate-100">{activity.activity_type_label || activity.activity_type}</strong>
                            {activity.message ? ` - ${activity.message}` : ""}
                            {activity.created_at ? <span className="text-slate-500"> ({formatDateTime(activity.created_at)})</span> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-col items-start gap-2 lg:items-end">
                  <div className="text-xs text-slate-500">{row.work_order_number || `#${row.id}`}</div>
                  <div className="flex flex-wrap gap-2 lg:justify-end" data-testid={`property-work-order-actions-${row.id}`}>
                    {row.status !== "in_progress" && row.status !== "completed" && row.status !== "closed" && row.status !== "cancelled" ? (
                      <button
                        type="button"
                        data-testid={`property-work-order-start-${row.id}`}
                        onClick={() => quickStatus(row, "in_progress")}
                        className="rounded-lg border border-sky-300/40 px-3 py-1.5 text-xs font-semibold text-sky-100 hover:bg-sky-400/10"
                      >
                        Start Work
                      </button>
                    ) : null}
                    {row.status !== "waiting" && row.status !== "completed" && row.status !== "closed" && row.status !== "cancelled" ? (
                      <button
                        type="button"
                        data-testid={`property-work-order-waiting-${row.id}`}
                        onClick={() => quickStatus(row, "waiting")}
                        className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
                      >
                        Mark Waiting
                      </button>
                    ) : null}
                    {row.status === "in_progress" ? (
                      <button
                        type="button"
                        data-testid={`property-work-order-complete-${row.id}`}
                        onClick={() => openEdit(row, { status: "completed" })}
                        className="rounded-lg border border-emerald-300/45 bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-100 hover:bg-emerald-400/20"
                      >
                        Complete Work
                      </button>
                    ) : null}
                    {row.status === "completed" ? (
                      <button
                        type="button"
                        data-testid={`property-work-order-close-${row.id}`}
                        onClick={() => quickStatus(row, "closed")}
                        className="rounded-lg border border-amber-300/45 bg-amber-300/10 px-3 py-1.5 text-xs font-bold text-amber-100 hover:bg-amber-300/20"
                      >
                        Close Work
                      </button>
                    ) : null}
                    {row.assignment_type === "marketplace_contractor" && (!row.marketplace_status || row.marketplace_status === "not_sent" || row.marketplace_status === "withdrawn" || row.marketplace_status === "declined") ? (
                      <button
                        type="button"
                        data-testid={`property-work-order-send-marketplace-${row.id}`}
                        onClick={() => sendToMarketplace(row)}
                        className="rounded-lg border border-amber-300/45 bg-amber-300/10 px-3 py-1.5 text-xs font-bold text-amber-100 hover:bg-amber-300/20"
                      >
                        Send To Marketplace
                      </button>
                    ) : null}
                    {row.assignment_type === "marketplace_contractor" && row.marketplace_status === "sent" ? (
                      <button
                        type="button"
                        data-testid={`property-work-order-withdraw-marketplace-${row.id}`}
                        onClick={() => withdrawMarketplace(row)}
                        className="rounded-lg border border-rose-300/45 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-400/10"
                      >
                        Withdraw
                      </button>
                    ) : null}
                    {row.assignment_type === "marketplace_contractor" && row.marketplace_status === "accepted" && row.linked_agreement_wizard_url ? (
                      <a
                        data-testid={`property-work-order-open-agreement-${row.id}`}
                        href={row.linked_agreement_wizard_url}
                        className="rounded-lg border border-emerald-300/45 bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-100 hover:bg-emerald-400/20"
                      >
                        Open Agreement Draft
                      </a>
                    ) : null}
                    {row.assignment_type === "marketplace_contractor" && row.marketplace_status === "accepted" && !row.linked_agreement_wizard_url ? (
                      <button
                        type="button"
                        data-testid={`property-work-order-create-agreement-${row.id}`}
                        onClick={() => createAgreementDraft(row)}
                        className="rounded-lg border border-emerald-300/45 bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-100 hover:bg-emerald-400/20"
                      >
                        Create Agreement Draft
                      </button>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    data-testid={`property-work-order-edit-${row.id}`}
                    onClick={() => openEdit(row)}
                    className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-amber-300/60 hover:bg-amber-300/10"
                  >
                    Edit
                  </button>
                </div>
              </div>
            </article>
          ))
        ) : (
          <EmptyState title={workOrderEmptyTitle(workOrderFilter)} testId="property-work-orders-empty">
            {workOrderFilter === "archived"
              ? "Completed, closed, and cancelled work orders will remain available here as history."
              : "Create work orders manually or convert approved tenant maintenance requests into actionable follow-up."}
          </EmptyState>
        )}
      </div>

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6">
          <form data-testid="property-work-order-modal" onSubmit={submit} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-white">{editing.mode === "create" ? "Create Work Order" : "Edit Work Order"}</h3>
                <p className="mt-1 text-sm text-slate-400">Create the work order, find the right recipients, then finalize scheduling and notes.</p>
              </div>
              <button type="button" onClick={close} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800">
                Close
              </button>
            </div>

            <div data-testid="property-work-order-stepper" className="mt-5 grid gap-2 sm:grid-cols-3">
              {[
                [1, "Work Order"],
                [2, "Contractors"],
                [3, "Finalize"],
              ].map(([step, label]) => (
                <button
                  key={step}
                  type="button"
                  onClick={() => setWorkflowStep(step)}
                  className={`rounded-xl border px-3 py-2 text-left text-sm font-semibold ${
                    workflowStep === step
                      ? "border-amber-300/60 bg-amber-300/15 text-amber-100"
                      : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                  }`}
                  data-testid={`property-work-order-step-${step}`}
                >
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-[11px]">{step}</span>
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {workflowStep === 1 ? (
                <>
              {editing.mode === "create" && propertyOptions.length > 1 ? (
                <label className="block text-sm font-medium text-slate-200">
                  Property
                  <select data-testid="property-work-order-property" value={form.property_id || activePropertyId} onChange={(event) => update("property_id", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400">
                    {propertyOptions.map((property) => (
                      <option key={property.id} value={property.id}>{property.display_name || property.address || "Property"}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
                Title
                <input data-testid="property-work-order-title" value={form.title} onChange={(event) => update("title", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
              </label>
              <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
                Description
                <textarea data-testid="property-work-order-description" rows={4} value={form.description} onChange={(event) => update("description", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Category
                <select data-testid="property-work-order-category" value={form.category} onChange={(event) => update("category", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400">
                  {WORK_ORDER_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Priority
                <select data-testid="property-work-order-priority" value={form.priority} onChange={(event) => update("priority", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400">
                  {WORK_ORDER_PRIORITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Status
                <select data-testid="property-work-order-status" value={form.status} onChange={(event) => update("status", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400">
                  {WORK_ORDER_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Unit
                <select data-testid="property-work-order-unit" value={form.unit_id} onChange={(event) => update("unit_id", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400">
                  <option value="">Whole property</option>
                  {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.unit_label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Tenant
                <select data-testid="property-work-order-tenant" value={form.tenant_id} onChange={(event) => update("tenant_id", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400">
                  <option value="">No tenant</option>
                  {tenants.map((tenant) => <option key={tenant.tenant_id || tenant.id} value={tenant.tenant_id || tenant.id}>{tenant.name || `${tenant.first_name || ""} ${tenant.last_name || ""}`.trim() || tenant.email}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Assignment Type
                <select data-testid="property-work-order-assignment-type" value={form.assignment_type} onChange={(event) => update("assignment_type", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400">
                  {WORK_ORDER_ASSIGNMENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
                </>
              ) : null}
              {workflowStep === 3 && form.assignment_type === "internal_staff" ? (
                <div data-testid="property-work-order-staff-panel" className="rounded-2xl border border-sky-300/25 bg-sky-400/10 p-3 sm:col-span-2">
                  <label className="block text-sm font-medium text-sky-50">
                    Internal staff owner
                    <select data-testid="property-work-order-staff" value={form.assigned_staff_member_id} onChange={(event) => update("assigned_staff_member_id", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400">
                      <option value="">Choose staff member</option>
                      {activeStaff.map((member) => <option key={member.id} value={member.id}>{member.name || member.email}{member.role_label || member.role ? ` - ${member.role_label || member.role}` : ""}</option>)}
                    </select>
                  </label>
                  <p className="mt-2 text-xs leading-5 text-sky-100/80">
                    This staff member owns scheduling, follow-up, and completion updates for the work order.
                  </p>
                </div>
              ) : null}
              {workflowStep === 2 && form.assignment_type === "vendor" ? (
                <div data-testid="property-work-order-vendor-panel" className="rounded-2xl border border-amber-300/25 bg-amber-300/10 p-3 sm:col-span-2">
                  <label className="block text-sm font-medium text-amber-50">
                    Search preferred vendors
                    <input
                      data-testid="property-work-order-vendor-search"
                      value={vendorSearch}
                      onChange={(event) => setVendorSearch(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
                      placeholder="Search by vendor name, trade, email, or phone"
                    />
                  </label>
                  <label className="mt-3 block text-sm font-medium text-amber-50">
                    Vendor who will receive this work order
                    <select data-testid="property-work-order-vendor" value={form.assigned_vendor_id} onChange={(event) => update("assigned_vendor_id", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300">
                      <option value="">Choose vendor</option>
                      {matchingVendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}{vendor.trade_category ? ` - ${vendor.trade_category}` : ""}</option>)}
                    </select>
                  </label>
                  <p className="mt-2 text-xs leading-5 text-amber-100/80">
                    Vendor assignment records your preferred outside company. It does not create a contractor account or start payment steps.
                  </p>
                </div>
              ) : null}
              {workflowStep === 2 && form.assignment_type === "marketplace_contractor" ? (
                <div data-testid="property-work-order-marketplace-placeholder" className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-50 sm:col-span-2">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-100">Contractor Search</div>
                      <div className="mt-1 text-base font-semibold text-white">Find marketplace matches</div>
                      <p className="mt-1 text-sm text-emerald-50">
                        Find MyHomeBro contractors and local businesses for this work order before sending it.
                      </p>
                    </div>
                    {marketplaceMatches ? (
                      <Badge>{marketplaceEligibleCount} eligible contractor{marketplaceEligibleCount === 1 ? "" : "s"}</Badge>
                    ) : null}
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <label className="block text-sm font-medium text-emerald-50">
                      Trade/category
                      <select
                        data-testid="property-work-order-marketplace-trade"
                        value={form.category}
                        onChange={(event) => update("category", event.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-300"
                      >
                        {WORK_ORDER_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label className="block text-sm font-medium text-emerald-50">
                      Location/service area
                      <input
                        data-testid="property-work-order-marketplace-location"
                        value={marketplaceSearch.location}
                        onChange={(event) => {
                          setMarketplaceSearch((prev) => ({ ...prev, location: event.target.value }));
                          resetMarketplacePreview();
                        }}
                        placeholder="San Antonio, TX"
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-300"
                      />
                    </label>
                    <label className="block text-sm font-medium text-emerald-50">
                      Search
                      <input
                        data-testid="property-work-order-marketplace-search"
                        value={marketplaceSearch.search}
                        onChange={(event) => {
                          setMarketplaceSearch((prev) => ({ ...prev, search: event.target.value }));
                          resetMarketplacePreview();
                        }}
                        placeholder="Optional company or specialty"
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-300"
                      />
                    </label>
                    <label className="block text-sm font-medium text-emerald-50">
                      Radius
                      <select
                        data-testid="property-work-order-marketplace-radius"
                        value={marketplaceSearch.radius_miles}
                        onChange={(event) => {
                          setMarketplaceSearch((prev) => ({ ...prev, radius_miles: event.target.value }));
                          resetMarketplacePreview();
                        }}
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-300"
                      >
                        {SEARCH_RADIUS_OPTIONS.map((radius) => (
                          <option key={radius} value={String(radius)}>{radius} miles</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="property-work-order-preview-matches"
                      disabled={marketplaceSearching || editing?.mode === "create"}
                      onClick={previewMarketplaceMatches}
                      className="rounded-xl bg-emerald-300 px-4 py-2 text-sm font-extrabold text-slate-950 hover:bg-emerald-200 disabled:opacity-50"
                    >
                      {marketplaceSearching ? "Searching..." : "Preview Matches"}
                    </button>
                    <button
                      type="button"
                      data-testid="property-work-order-add-vendor-manually"
                      onClick={() => update("assignment_type", "vendor")}
                      className="rounded-xl border border-amber-300/45 bg-amber-300/10 px-4 py-2 text-sm font-bold text-amber-100 hover:bg-amber-300/20"
                    >
                      Add Vendor Manually
                    </button>
                    {editing?.mode === "create" ? (
                      <span className="text-xs text-emerald-100/80">Save the work order first, then preview marketplace matches.</span>
                    ) : null}
                  </div>
                  <div data-testid="property-work-order-recipient-summary" className="mt-3 rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-300">
                    <strong className="text-white">{selectedRecipientCount}</strong> selected recipient{selectedRecipientCount === 1 ? "" : "s"}.
                    <span className="ml-2 text-slate-400">
                      Select 3-5 total recipients to review. MyHomeBro contractors can receive marketplace opportunities today; vendors and local businesses are review-only here.
                    </span>
                  </div>

                  {marketplaceMatches ? (
                    <div className="mt-4 space-y-4" data-testid="property-work-order-marketplace-results">
                      {marketplaceEligibleCount > 0 ? (
                        <div data-testid="property-work-order-marketplace-eligible" className="rounded-xl border border-emerald-300/30 bg-slate-950/60 p-3">
                          <div className="font-semibold text-white">
                            {marketplaceEligibleCount} approved MyHomeBro contractor{marketplaceEligibleCount === 1 ? "" : "s"} within {marketplaceMatches.radius_miles || marketplaceSearch.radius_miles || 25} miles
                          </div>
                          <div className="mt-2 grid gap-2">
                            {(marketplaceMatches.myhomebro_contractors || []).map((contractor) => (
                              <article key={contractor.contractor_id || contractor.directory_entry_id} className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-semibold text-white">{contractor.business_name || "MyHomeBro Contractor"}</span>
                                      <span className="rounded-full border border-emerald-300/40 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                                        MyHomeBro Contractor
                                      </span>
                                      <span className="rounded-full border border-slate-600 bg-slate-950 px-2 py-0.5 text-[11px] font-semibold text-slate-200">
                                        {contractor.verification_status_label || "Verified"}
                                      </span>
                                    </div>
                                    <div className="mt-2 grid gap-1 text-xs text-slate-300 sm:grid-cols-2">
                                      <span>{contractor.primary_trade || contractor.trade_categories?.join?.(", ") || marketplaceMatches.trade || "General"}</span>
                                      <span>{contractor.location || "Service area available"}</span>
                                      <span>{contractor.phone || "No phone listed"}</span>
                                      <span>{contractor.website || "No website listed"}</span>
                                    </div>
                                  </div>
                                  <label className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-100">
                                    <input
                                      type="checkbox"
                                      data-testid={`property-work-order-select-contractor-${contractor.directory_entry_id || contractor.contractor_id}`}
                                      checked={recipientSelected(recipientFromContractor(contractor))}
                                      onChange={() => toggleRecipient(recipientFromContractor(contractor))}
                                      className="h-4 w-4 accent-emerald-300"
                                    />
                                    Select
                                  </label>
                                </div>
                              </article>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div data-testid="property-work-order-marketplace-no-eligible" className="rounded-xl border border-amber-300/35 bg-amber-300/10 p-3 text-amber-50">
                          <div className="font-semibold">No approved MyHomeBro contractors found for this trade/location yet.</div>
                          <p className="mt-1 text-xs leading-5 text-amber-100/85">
                            You can import a local business as a preferred vendor or add a vendor manually. Try increasing the radius to 50 or 100 miles.
                          </p>
                          {marketplaceGeocodeFailed ? (
                            <p className="mt-2 text-xs font-semibold text-amber-100">
                              We could not verify that location. Try city/state or a ZIP code.
                            </p>
                          ) : null}
                        </div>
                      )}

                      <div data-testid="property-work-order-preferred-vendor-results" className="rounded-xl border border-amber-300/25 bg-slate-950/60 p-3">
                        <div className="font-semibold text-white">Preferred vendors</div>
                        <div className="mt-2 grid gap-2">
                          {activeVendors.length ? activeVendors.map((vendor) => (
                            <article key={vendor.id} className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                  <div className="font-semibold text-white">{vendor.name}</div>
                                  <div className="mt-1 text-xs text-slate-300">{vendor.trade_category || "General"} - {vendor.email || vendor.phone || "No contact listed"}</div>
                                </div>
                                <label className="inline-flex items-center gap-2 rounded-xl border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-xs font-bold text-amber-100">
                                  <input
                                    type="checkbox"
                                    data-testid={`property-work-order-select-vendor-${vendor.id}`}
                                    checked={recipientSelected(recipientFromVendor(vendor))}
                                    onChange={() => toggleRecipient(recipientFromVendor(vendor))}
                                    className="h-4 w-4 accent-amber-300"
                                  />
                                  Select
                                </label>
                              </div>
                            </article>
                          )) : (
                            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-3 text-sm text-slate-400">
                              No preferred vendors saved yet.
                            </div>
                          )}
                        </div>
                      </div>

                      <div data-testid="property-work-order-local-business-results" className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="font-semibold text-white">Local business results</div>
                            <div className="text-xs text-slate-400">
                              {(marketplaceMatches.local_businesses || []).length} local business{(marketplaceMatches.local_businesses || []).length === 1 ? "" : "es"} within {marketplaceRadius} miles of {marketplaceDisplayLocation}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              Searching {marketplaceMatches.trade || "contractors"} near {marketplaceDisplayLocation} within {marketplaceRadius} miles
                            </div>
                            {marketplaceGeocodeFailed ? (
                              <div className="mt-1 text-xs font-semibold text-amber-100">
                                We could not verify that location. Try city/state or a ZIP code.
                              </div>
                            ) : null}
                          </div>
                          <Badge>{(marketplaceMatches.local_businesses || []).length} local</Badge>
                        </div>
                        <div className="mt-3 grid gap-2">
                          {(marketplaceMatches.local_businesses || []).length ? (
                            marketplaceMatches.local_businesses.map((business) => {
                              const key = business.business_id || business.business_name;
                              return (
                                <article key={key} className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
                                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                    <div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-semibold text-white">{business.business_name || "Local Business"}</span>
                                        <span className="rounded-full border border-slate-600 bg-slate-950 px-2 py-0.5 text-[11px] font-semibold text-slate-200">Local Business</span>
                                      </div>
                                      <div className="mt-2 grid gap-1 text-xs text-slate-300 sm:grid-cols-2">
                                        <span>{business.trade_category || marketplaceMatches.trade || "General"}</span>
                                        <span>{business.location || business.address || "Location unavailable"}</span>
                                        <span>{business.phone || "No phone listed"}</span>
                                        <span>{business.website || "No website listed"}</span>
                                        {business.rating ? <span>Rating: {business.rating}</span> : null}
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      data-testid={`property-work-order-import-local-business-${key}`}
                                      disabled={saving || marketplaceImportingKey === String(key)}
                                      onClick={() => importLocalBusinessVendor(business)}
                                      className="rounded-xl border border-amber-300/45 bg-amber-300/10 px-3 py-2 text-sm font-bold text-amber-100 hover:bg-amber-300/20 disabled:opacity-50"
                                    >
                                      {marketplaceImportingKey === String(key) ? "Importing..." : "Import as Vendor"}
                                    </button>
                                    <label className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-xs font-bold text-slate-200">
                                      <input
                                        type="checkbox"
                                        data-testid={`property-work-order-select-local-business-${key}`}
                                        checked={recipientSelected(recipientFromBusiness(business))}
                                        onChange={() => toggleRecipient(recipientFromBusiness(business))}
                                        className="h-4 w-4 accent-slate-300"
                                      />
                                      Select
                                    </label>
                                  </div>
                                </article>
                              );
                            })
                          ) : (
                            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-3 text-sm text-slate-400">
                              No local businesses returned for this search yet.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div data-testid="property-work-order-marketplace-empty" className="mt-4 rounded-xl border border-dashed border-emerald-300/25 bg-slate-950/50 p-3 text-sm text-emerald-100/80">
                      Preview matches to see who can receive this work order before sending.
                    </div>
                  )}
                </div>
              ) : null}
              {workflowStep === 3 ? (
                <>
              {selectedRecipients.length ? (
                      <div data-testid="property-work-order-selected-recipients" className="rounded-2xl border border-slate-700 bg-slate-950/70 p-3 sm:col-span-2">
                  <div className="text-sm font-semibold text-white">Selected recipients</div>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    MyHomeBro contractors can receive marketplace opportunities now. Preferred vendors and local businesses are included for manager review; invitation sending for those recipients is not enabled yet.
                  </p>
                  <div className="mt-2 grid gap-2">
                    {selectedRecipients.map((recipient) => (
                      <div key={recipientKey(recipient)} className="rounded-xl border border-slate-700 bg-slate-900/70 p-3 text-xs text-slate-300">
                        <span className="font-semibold text-white">{recipient.name}</span>
                        <span className="ml-2 rounded-full border border-slate-600 bg-slate-950 px-2 py-0.5 text-[11px] text-slate-200">{recipient.source_label}</span>
                        <span className="ml-2">{recipient.trade || "General"}</span>
                        <span className="ml-2 text-slate-400">
                          {recipient.source === "myhomebro_contractor"
                            ? "Can receive marketplace opportunity"
                            : recipient.source === "preferred_vendor"
                              ? "Review-only until vendor invitations are enabled"
                              : "Import/save as vendor before sending"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <label className="block text-sm font-medium text-slate-200">
                Scheduled Date
                <input data-testid="property-work-order-scheduled" type="datetime-local" value={form.scheduled_for} onChange={(event) => update("scheduled_for", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
              </label>
              <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
                Internal Notes
                <textarea data-testid="property-work-order-internal-notes" rows={3} value={form.internal_notes} onChange={(event) => update("internal_notes", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
              </label>
              <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
                Completion Notes
                <textarea data-testid="property-work-order-completion-notes" rows={3} value={form.completion_notes} onChange={(event) => update("completion_notes", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
              </label>
              <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
                Completion Photos or Files
                <input
                  data-testid="property-work-order-completion-files"
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(event) => setCompletionFiles(Array.from(event.target.files || []))}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-300 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-950"
                />
              </label>
              {completionFiles.length ? (
                <div data-testid="property-work-order-selected-files" className="rounded-xl border border-slate-700 bg-slate-950/70 p-3 text-xs text-slate-300 sm:col-span-2">
                  <div className="font-semibold text-white">Selected files</div>
                  <ul className="mt-2 space-y-1">
                    {completionFiles.map((file) => (
                      <li key={`${file.name}-${file.size}`}>{file.name}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
                </>
              ) : null}
            </div>

            {error ? <div data-testid="property-work-order-error" className="mt-4 rounded-xl border border-rose-300/35 bg-rose-400/10 p-3 text-sm text-rose-100">{error}</div> : null}

            <div className="mt-5 flex flex-wrap gap-2">
              {workflowStep > 1 ? (
                <button
                  type="button"
                  data-testid="property-work-order-back"
                  onClick={() => setWorkflowStep(workflowStep === 3 && form.assignment_type === "internal_staff" ? 1 : workflowStep - 1)}
                  className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                >
                  Back
                </button>
              ) : null}
              {workflowStep === 1 ? (
                <button
                  type="button"
                  data-testid="property-work-order-continue-contractors"
                  disabled={!form.title.trim() || !form.description.trim()}
                  onClick={continueFromDetails}
                  className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-extrabold text-slate-950 hover:bg-amber-200 disabled:opacity-50"
                >
                  {form.assignment_type === "internal_staff" ? "Continue to Finalize" : "Continue to Contractor Search"}
                </button>
              ) : null}
              {workflowStep === 2 ? (
                <button
                  type="button"
                  data-testid="property-work-order-continue-finalize"
                  disabled={form.assignment_type === "marketplace_contractor" && !selectedRecipientCountValid}
                  onClick={continueFromContractors}
                  className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-extrabold text-slate-950 hover:bg-amber-200 disabled:opacity-50"
                >
                  Continue to Finalize
                </button>
              ) : null}
              {workflowStep === 3 && form.assignment_type === "marketplace_contractor" && editing?.mode !== "create" && (!editing.marketplace_status || editing.marketplace_status === "not_sent" || editing.marketplace_status === "withdrawn" || editing.marketplace_status === "declined") ? (
                <button
                  type="button"
                  data-testid="property-work-order-save-send-marketplace"
                  disabled={saving || !form.title.trim() || !form.description.trim() || !canSendToMarketplace}
                  onClick={(event) => submit(event, { sendToMarketplace: true })}
                  className="rounded-xl border border-emerald-300/50 bg-emerald-400/15 px-4 py-2 text-sm font-extrabold text-emerald-100 hover:bg-emerald-400/25 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Send Work Order to Selected Contractors"}
                </button>
              ) : null}
              {workflowStep === 3 && form.assignment_type === "marketplace_contractor" && marketplaceSendHelper ? (
                <div data-testid="property-work-order-send-helper" className="w-full rounded-xl border border-amber-300/35 bg-amber-300/10 p-3 text-xs font-semibold leading-5 text-amber-100">
                  {marketplaceSendHelper}
                </div>
              ) : null}
              {workflowStep === 3 ? (
              <button type="submit" data-testid="property-work-order-save" disabled={saving || !form.title.trim() || !form.description.trim()} className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-extrabold text-slate-950 hover:bg-amber-200 disabled:opacity-50">
                {saving ? "Saving..." : "Save Work Order"}
              </button>
              ) : null}
              <button type="button" onClick={close} className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800">
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function displayValue(value) {
  return String(value || "").trim();
}

function requestClarifyingQuestions(description = "", suggestion = {}) {
  const questions = Array.isArray(suggestion.clarification_questions)
    ? suggestion.clarification_questions.filter(Boolean)
    : [];
  if (questions.length) return questions;
  const text = String(description || "").trim();
  if (text.length < 50) {
    return ["What room, area, or system needs attention?", "What outcome would you like the contractor to review?"];
  }
  return [];
}

function requestEvidenceSuggestion(projectType = "", description = "", suggestion = {}) {
  if (suggestion.evidence_note || suggestion.attachment_suggestion) return suggestion.evidence_note || suggestion.attachment_suggestion;
  const text = `${projectType} ${description}`.toLowerCase();
  if (text.includes("leak") || text.includes("damage") || text.includes("repair")) {
    return "Photos of the affected area and any related receipts or inspection notes may help.";
  }
  if (text.includes("hvac") || text.includes("water heater") || text.includes("appliance")) {
    return "Photos of the equipment label, model number, and recent service records may help.";
  }
  if (text.includes("remodel") || text.includes("install")) {
    return "Inspiration photos, sketches, measurements, or product links may help.";
  }
  return "Photos, documents, receipts, manuals, or inspection notes can help contractors understand the request.";
}

function MetadataCard({ label, value, className = "" }) {
  const text = displayValue(value);
  if (!text) return null;
  return (
    <div className={`rounded-2xl border border-slate-700 bg-slate-900/70 p-4 ${className}`}>
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <p className="mt-1 text-sm font-semibold text-white">{text}</p>
    </div>
  );
}

function joinPresent(parts, separator = " · ") {
  return parts.map(displayValue).filter(Boolean).join(separator);
}

function DetailSection({ title, eyebrow, children, testId, className = "" }) {
  return (
    <section data-testid={testId} className={`rounded-2xl border border-slate-700 bg-slate-900/70 p-4 ${className}`}>
      {eyebrow ? <div className="text-xs font-bold uppercase tracking-[0.18em] text-amber-200">{eyebrow}</div> : null}
      <h4 className="text-base font-extrabold text-white">{title}</h4>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function DetailField({ label, value }) {
  const text = displayValue(value);
  if (!text) return null;
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-white">{text}</dd>
    </div>
  );
}

function TextBlock({ label, value, empty }) {
  const text = displayValue(value);
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <p className={`mt-1 whitespace-pre-wrap text-sm leading-6 ${text ? "text-slate-100" : "text-slate-400"}`}>
        {text || empty}
      </p>
    </div>
  );
}

function homeownerRequestStatus(request = {}, bids = []) {
  if (displayValue(request.workflow_status_label)) return normalizeRequestStatusLabel(request.workflow_status_label);
  const status = String(request.status || "").toLowerCase();
  const label = String(request.status_label || "").trim();
  const conversion = String(request.conversion_status || "").toLowerCase();
  const contractor = request.selected_contractor || null;
  const bidCount = Number(request.bids_count ?? bids.length ?? 0);
  if (request.linked_work || request.agreement_token || conversion.includes("agreement")) return "Agreement Draft Created";
  if (contractor?.status_label && String(contractor.status_label).toLowerCase().includes("agreement")) return "Agreement Draft Created";
  if (contractor || status.includes("selected") || status.includes("awarded")) return "Contractor selected";
  if (bidCount > 0) return "Contractor Responses Received";
  if (status.includes("routed") || status.includes("sent")) return "Sent to Contractors";
  if (status.includes("analyzed") || status.includes("matching")) return "Finding contractors";
  if (status.includes("submitted")) return "Reviewing Request";
  if (status.includes("draft")) return "Draft";
  if (status.includes("cancel")) return "Cancelled";
  if (status.includes("closed") || status.includes("archived")) return "Closed";
  return label || "Submitted";
}

function normalizeRequestStatusLabel(label = "") {
  const text = displayValue(label);
  if (!text) return "";
  const lowered = text.toLowerCase();
  if (lowered === "contractor matching" || lowered === "preparing contractor match") return "Finding contractors";
  if (lowered === "contractor selected") return "Contractor selected";
  return text;
}

function requestMatchingText(request = {}, bids = []) {
  const bidCount = Number(request.bids_count ?? bids.length ?? 0);
  const routedCount = Number(request.routed_contractor_count || 0);
  if (request.linked_work || request.agreement_token) return "Converted to project agreement";
  if (bidCount > 0) return `${bidCount} contractor response${bidCount === 1 ? "" : "s"} received`;
  if (routedCount > 0) return `Sent to ${routedCount} contractor${routedCount === 1 ? "" : "s"}`;
  if (request.contractor_matching_started) return "Contractor search started";
  if (request.selected_contractor) return "Contractor selected";
  const status = homeownerRequestStatus(request, bids).toLowerCase();
  if (status.includes("sent")) return "Contractor matching has started";
  if (status.includes("preparing")) return "Preparing contractor match";
  if (status.includes("reviewing")) return "Matching has not started yet";
  if (status.includes("draft")) return "Not submitted or routed yet";
  return "Matching status pending";
}

function requestNextStep(request = {}, bids = []) {
  const explicit = displayValue(request.current_next_action || request.action_label);
  if (explicit && !["view request", "review request details"].includes(explicit.toLowerCase())) return explicit;
  if (request.linked_work || request.agreement_token) return "Open the linked agreement when you are ready.";
  if (Number(request.bids_count ?? bids.length ?? 0) > 1) return "Compare contractor responses before selecting a contractor.";
  if (Number(request.bids_count ?? bids.length ?? 0) === 1) return "Review the contractor response.";
  if (request.selected_contractor) return "Wait for the contractor to respond or prepare agreement details.";
  return "Review the request details. It stays private until contractor routing is started.";
}

function requestCanEditText(request = {}) {
  if (String(request.workflow_status || request.status || "").toLowerCase().includes("cancel")) return "Cancelled";
  if (request.can_edit === true) return "Editable until sent";
  if (request.cancel_lock_reason) return request.cancel_lock_reason;
  if (request.can_edit === false) return request.edit_lock_reason || "Editing locked after routing";
  if (request.linked_work || request.agreement_token) return "Linked agreement available";
  const status = homeownerRequestStatus(request).toLowerCase();
  if (status.includes("draft") || status.includes("reviewing")) return "Editable until sent";
  if (status.includes("closed")) return "Closed";
  return "Contact contractor to change";
}

function requestCanCancel(request = {}) {
  return request.can_cancel === true;
}

function requestCanDelete(request = {}) {
  return request.can_delete === true;
}

function requestContractorRoutes(request = {}) {
  const routed = request.routed_contractors || [];
  if (routed.length) return routed;
  return request.selected_contractor ? [request.selected_contractor] : [];
}

function RequestTimeline({ items = [] }) {
  const visible = items.filter((item) => displayValue(item?.title) || displayValue(item?.description));
  if (!visible.length) {
    return <p className="text-sm text-slate-400">No activity has been recorded for this request yet.</p>;
  }
  return (
    <ol className="space-y-3">
      {visible.map((item, index) => (
        <li key={`${item.title}-${item.occurred_at || index}`} className="flex gap-3">
          <span className="mt-1 h-2.5 w-2.5 flex-none rounded-full bg-amber-300" />
          <div>
            <div className="text-sm font-bold text-white">{item.title}</div>
            {item.description ? <p className="mt-0.5 text-sm text-slate-300">{item.description}</p> : null}
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
              {item.occurred_at ? <span>{formatDateTime(item.occurred_at)}</span> : null}
              {item.status ? <span>{item.status}</span> : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function comparisonHighlights(bids) {
  const prices = bids
    .map((bid) => ({ id: bid.id, value: parseMoney(bid.bid_amount ?? bid.bid_amount_label) }))
    .filter((row) => row.value != null && row.value > 0);
  const timelines = bids
    .map((bid) => ({ id: bid.id, value: timelineScore(bid.timeline) }))
    .filter((row) => Number.isFinite(row.value));
  const milestoneCounts = bids.map((bid) => ({
    id: bid.id,
    value: Number(bid.milestone_count || (Array.isArray(bid.milestone_preview) ? bid.milestone_preview.length : 0)),
  }));
  const lowestPrice = prices.length ? Math.min(...prices.map((row) => row.value)) : null;
  const shortestTimeline = timelines.length ? Math.min(...timelines.map((row) => row.value)) : null;
  const mostMilestones = milestoneCounts.length ? Math.max(...milestoneCounts.map((row) => row.value)) : 0;

  return bids.reduce((acc, bid) => {
    const badges = [];
    const price = parseMoney(bid.bid_amount ?? bid.bid_amount_label);
    const time = timelineScore(bid.timeline);
    const milestoneCount = Number(bid.milestone_count || (Array.isArray(bid.milestone_preview) ? bid.milestone_preview.length : 0));
    if (lowestPrice != null && price === lowestPrice) badges.push("Lowest price");
    if (Number.isFinite(shortestTimeline) && time === shortestTimeline) badges.push("Shortest timeline");
    if (mostMilestones > 0 && milestoneCount === mostMilestones) badges.push("Most detailed milestone plan");
    if (bid.contractor_preferred) badges.push("Preferred status reviewed");
    if (bid.contractor_verified) badges.push("Profile reviewed");
    acc[bid.id] = badges;
    return acc;
  }, {});
}

export default function CustomerRequests({
  requests = [],
  bids = [],
  tenantMaintenanceRequests = [],
  propertyWorkOrders = [],
  teamMembers = [],
  vendors = [],
  propertyProfile = {},
  propertyProfiles = [],
  isPropertyManagementCompany = false,
  onCreateRequest,
  onUpdateRequest,
  onReviewTenantMaintenanceRequest,
  onCreatePropertyWorkOrder,
  onUpdatePropertyWorkOrder,
  onSendPropertyWorkOrderToMarketplace,
  onWithdrawPropertyWorkOrderMarketplace,
  onCreatePropertyWorkOrderAgreementDraft,
  onPreviewPropertyWorkOrderContractorMatches,
  onImportVendor,
  onCreateWorkOrderFromTenantRequest,
  onImproveRequest,
  onStartContractorSearch,
  onRouteRequestContractors,
  onCancelRequest,
  onDeleteRequest,
  onAcceptBid,
  acceptingBidId = "",
  creating = false,
  focusedRequestId = "",
  onFocusedRequestHandled,
  initialDraft = null,
  onInitialDraftHandled,
  mode = "requests",
}) {
  const [pendingAwardBid, setPendingAwardBid] = useState(null);
  const [activeComparisonKey, setActiveComparisonKey] = useState("");
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [editingRequest, setEditingRequest] = useState(null);
  const [contractorSearchRequest, setContractorSearchRequest] = useState(null);
  const [selectedContractors, setSelectedContractors] = useState([]);
  const [routingContractors, setRoutingContractors] = useState(false);
  const [contractorSearchLoading, setContractorSearchLoading] = useState(false);
  const [contractorSearchError, setContractorSearchError] = useState("");
  const [cancelRequest, setCancelRequest] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [deleteRequest, setDeleteRequest] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [updatingTenantMaintenanceRequestId, setUpdatingTenantMaintenanceRequestId] = useState("");
  const [convertingTenantMaintenanceRequestId, setConvertingTenantMaintenanceRequestId] = useState("");
  const [savingPropertyWorkOrder, setSavingPropertyWorkOrder] = useState(false);
  const [improvingRequest, setImprovingRequest] = useState(false);
  const [improveError, setImproveError] = useState("");
  const [requestSuggestion, setRequestSuggestion] = useState(null);
  const propertyOptions = propertyProfiles.length ? propertyProfiles : propertyProfile?.id ? [propertyProfile] : [];
  const [form, setForm] = useState({
    property_id: propertyProfile?.id || "",
    request_type: "repair",
    project_mode: "full_service",
    project_category: "",
    project_type: "",
    project_subtype: "",
    payment_preference: "",
    title: "",
    description: "",
    urgency: "normal",
    preferred_timeline: "",
    address_line1: propertyProfile?.address_line1 || "",
    address_line2: propertyProfile?.address_line2 || "",
    city: propertyProfile?.city || "",
    state: propertyProfile?.state || "",
    postal_code: propertyProfile?.postal_code || "",
    linked_home_system_id: "",
    recommendation_key: "",
    recommendation_title: "",
    recommendation_context: null,
  });

  const reviewTenantMaintenanceRequest = async (propertyId, requestId, payload) => {
    if (!onReviewTenantMaintenanceRequest) return;
    setUpdatingTenantMaintenanceRequestId(String(requestId));
    try {
      await onReviewTenantMaintenanceRequest(propertyId, requestId, payload);
    } finally {
      setUpdatingTenantMaintenanceRequestId("");
    }
  };

  const convertTenantRequestToWorkOrder = async (request) => {
    if (!request?.id || !request?.property_profile_id || !onCreateWorkOrderFromTenantRequest) return;
    setConvertingTenantMaintenanceRequestId(String(request.id));
    try {
      await onCreateWorkOrderFromTenantRequest(request.property_profile_id, request.id);
    } finally {
      setConvertingTenantMaintenanceRequestId("");
    }
  };

  const createPropertyWorkOrder = async (propertyId, payload) => {
    if (!onCreatePropertyWorkOrder) return;
    setSavingPropertyWorkOrder(true);
    try {
      await onCreatePropertyWorkOrder(propertyId, payload);
    } finally {
      setSavingPropertyWorkOrder(false);
    }
  };

  const updatePropertyWorkOrder = async (propertyId, workOrderId, payload) => {
    if (!onUpdatePropertyWorkOrder) return;
    setSavingPropertyWorkOrder(true);
    try {
      await onUpdatePropertyWorkOrder(propertyId, workOrderId, payload);
    } finally {
      setSavingPropertyWorkOrder(false);
    }
  };

  const internalRequests = useMemo(
    () => requests.filter((row) => row.source_kind === "customer_request"),
    [requests]
  );
  useEffect(() => {
    if (!focusedRequestId) return;
    const request = requests.find((row) => String(row.id) === String(focusedRequestId));
    if (!request) return;
    setSelectedRequest(request);
    onFocusedRequestHandled?.();
  }, [focusedRequestId, requests, onFocusedRequestHandled]);
  useEffect(() => {
    if (!initialDraft) return;
    setEditingRequest(null);
    setSelectedRequest(null);
    setContractorSearchRequest(null);
    setRequestSuggestion(null);
    setImproveError("");
    setForm((prev) => ({
      ...prev,
      ...initialDraft,
      property_id: initialDraft.property_id || prev.property_id || propertyProfile?.id || "",
      request_type: initialDraft.request_type || "maintenance",
      project_mode: initialDraft.project_mode || "diy_assist",
      payment_preference: initialDraft.payment_preference || "discuss",
      urgency: initialDraft.urgency || "normal",
    }));
    window.requestAnimationFrame(() => {
      document.querySelector("[data-testid='customer-request-create-panel']")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    onInitialDraftHandled?.();
  }, [initialDraft, onInitialDraftHandled, propertyProfile?.id]);
  const bidsByComparisonKey = useMemo(() => {
    const grouped = {};
    bids.forEach((bid) => {
      const key = bid.comparison_key || "";
      if (!key) return;
      grouped[key] = grouped[key] || [];
      grouped[key].push(bid);
    });
    return grouped;
  }, [bids]);
  const comparisonRequests = useMemo(
    () => requests.filter((row) => row.comparison_key && (bidsByComparisonKey[row.comparison_key] || []).length),
    [bidsByComparisonKey, requests]
  );
  const activeComparisonRequest = useMemo(() => {
    if (activeComparisonKey) {
      return comparisonRequests.find((row) => row.comparison_key === activeComparisonKey) || null;
    }
    return comparisonRequests.find((row) => (bidsByComparisonKey[row.comparison_key] || []).length > 1) || comparisonRequests[0] || null;
  }, [activeComparisonKey, bidsByComparisonKey, comparisonRequests]);
  const activeComparisonBids = activeComparisonRequest
    ? bidsByComparisonKey[activeComparisonRequest.comparison_key] || []
    : [];
  const activeHighlights = useMemo(() => comparisonHighlights(activeComparisonBids), [activeComparisonBids]);
  const awardedBid = activeComparisonBids.find((bid) => bid.is_awarded || bid.linked_agreement_id);
  const selectedRequestProperty = propertyOptions.find((property) => String(property.id) === String(form.property_id)) || null;
  const shouldShowRequestAddressFields = !propertyOptions.length || !form.property_id;
  const selectedRequestPropertyAddress = [
    selectedRequestProperty?.address_line1,
    selectedRequestProperty?.address_line2,
    selectedRequestProperty?.city,
    selectedRequestProperty?.state,
    selectedRequestProperty?.postal_code,
  ].filter(Boolean).join(", ") || selectedRequestProperty?.address || "";
  const selectedRequestPropertyTitle = selectedRequestProperty?.display_name || selectedRequestProperty?.address || "Saved property";
  const normalizePropertySummaryText = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const selectedRequestPropertyAddressIsDuplicate = Boolean(
    selectedRequestPropertyAddress &&
      normalizePropertySummaryText(selectedRequestPropertyAddress) === normalizePropertySummaryText(selectedRequestPropertyTitle)
  );

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const formFromRequest = (request = {}) => ({
    property_id: request.property_id || request.property_profile?.id || propertyProfile?.id || "",
    request_type: request.request_type || "repair",
    project_mode: request.project_mode || "full_service",
    project_category: request.project_category || request.project_type || "",
    project_type: request.project_type || request.project_category || "",
    project_subtype: request.project_subtype || "",
    payment_preference: request.payment_preference || "",
    title: request.project_title || "",
    description: request.project_scope || request.notes || request.original_description || "",
    urgency: request.urgency || "normal",
    preferred_timeline: request.preferred_timeline || request.timeline_label || "",
    address_line1: request.address_line1 || request.project_address_line1 || propertyProfile?.address_line1 || "",
    address_line2: request.address_line2 || propertyProfile?.address_line2 || "",
    city: request.city || request.project_city || propertyProfile?.city || "",
    state: request.state || request.project_state || propertyProfile?.state || "",
    postal_code: request.postal_code || request.project_postal_code || propertyProfile?.postal_code || "",
    linked_home_system_id: request.linked_home_system_id || "",
    recommendation_key: request.recommendation_key || "",
    recommendation_title: request.recommendation_title || "",
    recommendation_context: request.recommendation_context || null,
  });

  const applyProperty = (propertyId) => {
    if (propertyId === NEW_PROPERTY_VALUE) {
      setForm((prev) => ({
        ...prev,
        property_id: "",
        address_line1: "",
        address_line2: "",
        city: "",
        state: "",
        postal_code: "",
      }));
      return;
    }
    const selected = propertyOptions.find((property) => String(property.id) === String(propertyId));
    setForm((prev) => ({
      ...prev,
      property_id: propertyId || "",
      address_line1: selected?.address_line1 || prev.address_line1 || "",
      address_line2: selected?.address_line2 || "",
      city: selected?.city || prev.city || "",
      state: selected?.state || prev.state || "",
      postal_code: selected?.postal_code || prev.postal_code || "",
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!form.title.trim() || !form.description.trim()) return;
    const payload = {
      ...form,
      project_title: form.title,
      project_scope: form.description,
      project_category: form.project_category || form.project_type,
    };
    try {
      if (editingRequest?.request_id) {
        await onUpdateRequest?.(editingRequest.request_id, payload);
      } else {
        await onCreateRequest?.(payload);
      }
    } catch (_error) {
      return;
    }
    setRequestSuggestion(null);
    setImproveError("");
    setEditingRequest(null);
    setForm((prev) => ({
      ...prev,
      project_mode: "full_service",
      project_category: "",
      project_type: "",
      project_subtype: "",
      payment_preference: "",
      title: "",
      description: "",
      preferred_timeline: "",
      urgency: "normal",
      property_id: form.property_id,
      linked_home_system_id: "",
      recommendation_key: "",
      recommendation_title: "",
      recommendation_context: null,
    }));
  };

  const improveRequestDetails = async () => {
    if (!String(form.description || "").trim()) return;
    setImprovingRequest(true);
    setImproveError("");
    setRequestSuggestion(null);
    try {
      const data = await onImproveRequest?.({
        ...form,
        project_title: form.title,
        project_scope: form.description,
        project_category: form.project_category || form.project_type,
      });
      setRequestSuggestion({
        original_description: form.description,
        title: data?.project_title || data?.title || form.title,
        description: data?.project_scope || data?.description || form.description,
        project_type: data?.project_type || form.project_type,
        project_subtype: data?.project_subtype || form.project_subtype,
        urgency: data?.urgency || form.urgency,
        clarification_questions: requestClarifyingQuestions(form.description, data || {}),
        evidence_note: requestEvidenceSuggestion(data?.project_type || form.project_type, data?.project_scope || data?.description || form.description, data || {}),
        source: data?.source || "fallback",
      });
    } catch (error) {
      setImproveError(error?.response?.data?.detail || "Could not improve these request details.");
    } finally {
      setImprovingRequest(false);
    }
  };

  const applyRequestSuggestion = () => {
    if (!requestSuggestion) return;
    setForm((prev) => ({
      ...prev,
      title: requestSuggestion.title || prev.title,
      description: requestSuggestion.description || prev.description,
      project_type: requestSuggestion.project_type || prev.project_type,
      project_subtype: requestSuggestion.project_subtype || prev.project_subtype,
      urgency: requestSuggestion.urgency || prev.urgency,
    }));
    setRequestSuggestion(null);
  };

  const requestBids = (request) => {
    const key = request?.comparison_key || "";
    return key ? bidsByComparisonKey[key] || [] : [];
  };

  const beginEditRequest = (request) => {
    if (!request?.can_edit) return;
    setEditingRequest(request);
    setSelectedRequest(null);
    setContractorSearchRequest(null);
    setContractorSearchError("");
    setContractorSearchLoading(false);
    setRequestSuggestion(null);
    setImproveError("");
    setForm(formFromRequest(request));
  };

  const closeContractorSearch = () => {
    setContractorSearchRequest(null);
    setSelectedContractors([]);
    setContractorSearchError("");
    setContractorSearchLoading(false);
    setRoutingContractors(false);
  };

  const beginContractorSearch = async (request) => {
    setSelectedRequest(null);
    setEditingRequest(null);
    setSelectedContractors([]);
    setContractorSearchError("");
    setContractorSearchRequest({
      ...request,
      contractor_matching_started: true,
      workflow_status_label: request.workflow_status_label || "Contractor Matching",
    });
    setContractorSearchLoading(true);
    try {
      const response = await onStartContractorSearch?.(request.request_id);
      const updatedRequest =
        response?.portal?.requests?.find((row) => String(row.request_id) === String(request.request_id) && row.source_kind === "customer_request") ||
        {
          ...request,
          source_intake_token: response?.source_intake_token || request.source_intake_token,
          contractor_matching_started: true,
          workflow_status_label: "Contractor Matching",
        };
      setContractorSearchRequest(updatedRequest);
    } catch (error) {
      setContractorSearchError(error?.response?.data?.detail || error?.message || "Contractor search could not be opened. Please try again.");
    } finally {
      setContractorSearchLoading(false);
    }
  };

  const routeSelectedContractors = async () => {
    if (!contractorSearchRequest?.request_id || !selectedContractors.length) return;
    setRoutingContractors(true);
    try {
      const response = await onRouteRequestContractors?.(contractorSearchRequest.request_id, selectedContractors);
      const updatedRequest =
        response?.portal?.requests?.find((row) => String(row.request_id) === String(contractorSearchRequest.request_id) && row.source_kind === "customer_request") ||
        null;
      if (updatedRequest) {
        setContractorSearchRequest(updatedRequest);
      }
      closeContractorSearch();
    } finally {
      setRoutingContractors(false);
    }
  };

  const openCancelRequest = (request) => {
    if (!requestCanCancel(request)) return;
    setCancelRequest(request);
    setCancelReason("");
    setCancelError("");
  };

  const closeCancelRequest = () => {
    if (cancelBusy) return;
    setCancelRequest(null);
    setCancelReason("");
    setCancelError("");
  };

  const submitCancelRequest = async () => {
    if (!cancelRequest?.request_id) return;
    setCancelBusy(true);
    setCancelError("");
    try {
      await onCancelRequest?.(cancelRequest.request_id, cancelReason);
      setSelectedRequest(null);
      setCancelRequest(null);
      setCancelReason("");
      setCancelError("");
    } catch (error) {
      setCancelError(error?.response?.data?.detail || error?.message || "Could not cancel this request.");
    } finally {
      setCancelBusy(false);
    }
  };

  const openDeleteRequest = (request) => {
    if (!requestCanDelete(request)) return;
    setDeleteRequest(request);
    setDeleteError("");
  };

  const closeDeleteRequest = () => {
    if (deleteBusy) return;
    setDeleteRequest(null);
    setDeleteError("");
  };

  const submitDeleteRequest = async () => {
    if (!deleteRequest?.request_id) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await onDeleteRequest?.(deleteRequest.request_id);
      setSelectedRequest(null);
      setDeleteRequest(null);
    } catch (error) {
      setDeleteError(error?.response?.data?.detail || error?.message || "Could not delete this request.");
    } finally {
      setDeleteBusy(false);
    }
  };

  const discoveryFormForRequest = (request = {}) => ({
    ai_project_title: request.project_title,
    ai_project_type: request.project_type || request.project_category,
    ai_project_subtype: request.project_subtype,
    accomplishment_text: request.project_scope || request.notes || request.original_description,
    original_description: request.original_description || request.project_scope,
    refined_description: request.ai_enhanced_description || request.project_scope,
    ai_description: request.ai_enhanced_description || request.project_scope,
    project_scope_summary: request.project_scope || request.notes,
    project_address_line1: request.address_line1 || request.project_address,
    project_city: request.city,
    project_state: request.state,
    project_postal_code: request.postal_code,
    customer_address_line1: request.address_line1 || request.project_address,
    customer_city: request.city,
    customer_state: request.state,
    customer_postal_code: request.postal_code,
    project_class: request.project_class || "residential",
    project_mode: request.project_mode,
    payment_preference: request.payment_preference,
  });

  if (mode === "maintenance") {
    return (
      <div data-testid="customer-maintenance-workspace" className="space-y-5">
        <section className="rounded-2xl border border-amber-300/35 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.14),transparent_34%),rgba(15,23,42,0.78)] p-5 shadow-xl shadow-slate-950/20">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Maintenance</div>
              <h2 className="mt-1 text-xl font-semibold text-white">Resident maintenance review</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">
                Review resident-submitted requests, inspect photos and attachments, update status, and create work orders when approved.
              </p>
            </div>
            <Badge>{tenantMaintenanceRequests.length} request{tenantMaintenanceRequests.length === 1 ? "" : "s"}</Badge>
          </div>
          <div className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-700 bg-slate-950/55 p-3">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Status filters</div>
              <div className="mt-1 text-slate-200">Submitted, under review, approved, closed</div>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-950/55 p-3">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Property / unit filters</div>
              <div className="mt-1 text-slate-200">Use property, unit, and resident details on each request</div>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-950/55 p-3">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Urgency filters</div>
              <div className="mt-1 text-slate-200">Emergency, urgent, normal, low</div>
            </div>
          </div>
        </section>

        <TenantMaintenanceReviewQueue
          requests={tenantMaintenanceRequests}
          onReview={reviewTenantMaintenanceRequest}
          onCreateWorkOrder={convertTenantRequestToWorkOrder}
          updatingId={updatingTenantMaintenanceRequestId}
          convertingId={convertingTenantMaintenanceRequestId}
        />

        <PropertyWorkOrdersSection
          workOrders={propertyWorkOrders}
          propertyProfile={propertyProfile}
          propertyProfiles={propertyProfiles}
          teamMembers={teamMembers}
          vendors={vendors}
          onCreate={createPropertyWorkOrder}
          onUpdate={updatePropertyWorkOrder}
          onSendToMarketplace={onSendPropertyWorkOrderToMarketplace}
          onWithdrawMarketplace={onWithdrawPropertyWorkOrderMarketplace}
          onCreateAgreementDraft={onCreatePropertyWorkOrderAgreementDraft}
          onPreviewContractorMatches={onPreviewPropertyWorkOrderContractorMatches}
          onImportVendor={onImportVendor}
          saving={savingPropertyWorkOrder}
        />
      </div>
    );
  }

  return (
    <div data-testid="customer-requests" className="space-y-5">
      <form onSubmit={submit} data-testid="customer-request-create-panel" className="rounded-2xl border border-amber-300/35 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.14),transparent_34%),rgba(15,23,42,0.78)] p-5 shadow-xl shadow-slate-950/20">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Create a Request</div>
            <h2 className="mt-1 text-xl font-semibold text-white">Tell us what you need help with next</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">
              Save repairs, maintenance, inspections, new projects, or follow-up work here first. Requests stay private until you choose to send them to a contractor.
            </p>
          </div>
          <Badge>Private until sent to a contractor</Badge>
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className={`space-y-3 ${shouldShowRequestAddressFields ? "" : "lg:col-span-2"}`}>
            <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4">
              <label className="block text-sm font-semibold text-amber-50">
                Describe what you need help with
                <textarea
                  value={form.description}
                  onChange={(event) => {
                    update("description", event.target.value);
                    setImproveError("");
                  }}
                  rows={6}
                  className="mt-2 w-full rounded-xl border border-amber-200/40 bg-slate-950 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-amber-200"
                  placeholder={`The ceiling has water damage from a leak and needs repair.
I want to remodel the upstairs bathroom.
The HVAC is making noise and needs inspection.
I need help installing shelves and patching drywall.`}
                />
              </label>
              <p className="mt-3 text-sm leading-6 text-amber-50/85">
                Tell us what's going on in your own words. MyHomeBro can help organize it before you submit.
              </p>
              <div className="mt-4 rounded-2xl border border-sky-300/25 bg-sky-400/10 p-4" data-testid="customer-request-ai-helper">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-sky-100">Organize this request before saving</div>
                    <p className="mt-1 text-sm leading-6 text-sky-100/80">
                      AI can suggest a title, type, subtype, urgency, and clearer scope. You review everything before it changes the form.
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid="customer-request-improve-button"
                    onClick={improveRequestDetails}
                    disabled={improvingRequest || !String(form.description || "").trim()}
                    className="rounded-xl border border-sky-200/40 bg-sky-300/15 px-4 py-2 text-sm font-bold text-sky-50 hover:bg-sky-300/25 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {improvingRequest ? "Organizing..." : "Improve & Organize with AI"}
                  </button>
                </div>
                {improveError ? <div className="mt-3 text-sm text-red-200">{improveError}</div> : null}
                {requestSuggestion ? (
                  <div className="mt-4 rounded-xl border border-sky-200/35 bg-slate-950/70 p-3" data-testid="customer-request-ai-suggestion">
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-sky-200">Review AI suggestion before submitting</div>
                    <div className="mt-3 grid gap-3">
                      <TextBlock label="Original homeowner description" value={requestSuggestion.original_description} empty="" />
                      <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                        Suggested request title
                        <input
                          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-sky-300"
                          value={requestSuggestion.title}
                          onChange={(event) => setRequestSuggestion((prev) => ({ ...prev, title: event.target.value }))}
                          aria-label="Suggested request title"
                        />
                      </label>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                          Project Type
                          <input
                            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-sky-300"
                            value={requestSuggestion.project_type}
                            onChange={(event) => setRequestSuggestion((prev) => ({ ...prev, project_type: event.target.value }))}
                            aria-label="Suggested project type"
                          />
                        </label>
                        <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                          Project Subtype
                          <input
                            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-sky-300"
                            value={requestSuggestion.project_subtype}
                            onChange={(event) => setRequestSuggestion((prev) => ({ ...prev, project_subtype: event.target.value }))}
                            aria-label="Suggested project subtype"
                          />
                        </label>
                        <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                          Urgency
                          <select
                            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-sky-300"
                            value={requestSuggestion.urgency || "normal"}
                            onChange={(event) => setRequestSuggestion((prev) => ({ ...prev, urgency: event.target.value }))}
                            aria-label="Suggested urgency"
                          >
                            <option value="normal">Normal</option>
                            <option value="soon">Soon</option>
                            <option value="urgent">Urgent</option>
                            <option value="emergency">Emergency</option>
                          </select>
                        </label>
                      </div>
                      <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                        Improved description
                        <textarea
                          data-testid="customer-request-ai-suggestion-text"
                          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-sky-300"
                          rows={5}
                          value={requestSuggestion.description}
                          onChange={(event) => setRequestSuggestion((prev) => ({ ...prev, description: event.target.value }))}
                        />
                      </label>
                      {requestSuggestion.clarification_questions?.length ? (
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Clarifying questions</div>
                          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-300">
                            {requestSuggestion.clarification_questions.map((question) => (
                              <li key={question}>{question}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {requestSuggestion.evidence_note ? (
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Suggested documents or photos</div>
                          <p className="mt-1 text-sm leading-6 text-slate-300">{requestSuggestion.evidence_note}</p>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        data-testid="customer-request-use-ai-suggestion"
                        onClick={applyRequestSuggestion}
                        className="rounded-lg bg-sky-300 px-3 py-2 text-xs font-extrabold text-slate-950 hover:bg-sky-200"
                      >
                        Apply AI suggestions
                      </button>
                      <button
                        type="button"
                        onClick={() => setRequestSuggestion(null)}
                        className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
                      >
                        Edit manually
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-3">
              <label className="block text-sm font-medium text-amber-100">
                Choose the property this request is for.
                {propertyOptions.length ? (
                  <select
                    data-testid="customer-request-property-selector"
                    value={form.property_id}
                    onChange={(event) => applyProperty(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                  >
                    {propertyOptions.map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.display_name || property.address || "Property"}{property.is_primary ? " - Primary Property" : ""}
                      </option>
                    ))}
                    <option value={NEW_PROPERTY_VALUE}>New property / unlisted address</option>
                  </select>
                ) : (
                  <div className="mt-2 text-sm text-amber-50">No saved property yet. Enter the address for this request below.</div>
                )}
              </label>
              {selectedRequestProperty && !shouldShowRequestAddressFields ? (
                <div data-testid="customer-request-property-summary" className="mt-3 rounded-xl border border-amber-200/25 bg-slate-950/55 p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-amber-100">Selected property</div>
                  <div className="mt-1 text-sm font-semibold text-white">
                    {selectedRequestPropertyTitle}
                  </div>
                  {selectedRequestPropertyAddress && !selectedRequestPropertyAddressIsDuplicate ? (
                    <div className="mt-1 text-sm text-slate-300">{selectedRequestPropertyAddress}</div>
                  ) : (
                    !selectedRequestPropertyAddress ? (
                      <div className="mt-1 text-sm text-slate-400">Address saved on property profile.</div>
                    ) : null
                  )}
                </div>
              ) : null}
            </div>
            {form.linked_home_system_id || form.recommendation_key ? (
              <div data-testid="customer-request-recommendation-context" className="rounded-xl border border-sky-300/30 bg-sky-400/10 p-3 text-sm leading-6 text-sky-50">
                <div className="font-bold">Created from a Home System recommendation</div>
                <p className="mt-1">
                  {form.recommendation_title || "Recommended maintenance"} is linked to this request so it stays connected to your property timeline and maintenance history.
                </p>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-200">
                Request type
                <select
                  value={form.request_type}
                  onChange={(event) => update("request_type", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                >
                  {REQUEST_TYPES.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Project Mode
                <select
                  value={form.project_mode}
                  onChange={(event) => update("project_mode", event.target.value)}
                  data-testid="customer-request-help-mode"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                >
                  {PROJECT_MODES.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Project Type
                <input
                  value={form.project_type}
                  onChange={(event) => update("project_type", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                  placeholder="Flooring, plumbing, patio, HVAC..."
                />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Project Subtype
                <input
                  value={form.project_subtype}
                  onChange={(event) => update("project_subtype", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                  placeholder="Luxury vinyl plank, leak repair, patio slab..."
                />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Payment Preference
                <select
                  value={form.payment_preference}
                  onChange={(event) => update("payment_preference", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                >
                  {PAYMENT_PREFERENCES.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Timeline
                <select
                  value={form.preferred_timeline}
                  onChange={(event) => update("preferred_timeline", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                >
                  {TIMELINE_OPTIONS.map(([value, label]) => (
                    <option key={value || "blank"} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-sm font-medium text-slate-200">
              Project Title
              <input
                value={form.title}
                onChange={(event) => update("title", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                placeholder="Leaking sink, spring maintenance, deck inspection..."
              />
            </label>
            <label className="block text-sm font-medium text-slate-200">
              Urgency
              <select
                value={form.urgency}
                onChange={(event) => update("urgency", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
              >
                <option value="normal">Normal</option>
                <option value="soon">Soon</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">Emergency</option>
              </select>
            </label>
          </div>
          {shouldShowRequestAddressFields ? (
          <div data-testid="customer-request-address-fields" className="space-y-3 rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
            <label className="block text-sm font-medium text-slate-200">
              Address search
              <div className="mt-1">
                <AddressAutocomplete
                  value={form.address_line1}
                  onChangeText={(value) => update("address_line1", value)}
                  onSelect={(address) => {
                    setForm((prev) => ({
                      ...prev,
                      address_line1: address.line1 || prev.address_line1,
                      address_line2: address.line2 || "",
                      city: address.city || prev.city,
                      state: address.state || prev.state,
                      postal_code: address.postal_code || prev.postal_code,
                    }));
                  }}
                  placeholder="Search the request property address..."
                  testId="customer-request-address-autocomplete"
                  inputClassName="w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 pr-10 text-sm text-white placeholder:text-slate-400 outline-none focus:border-sky-400"
                  suggestionsClassName="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-600 bg-slate-950 text-sm text-slate-100 shadow-xl"
                  suggestionButtonClassName="block w-full px-3 py-2 text-left text-slate-100 hover:bg-slate-800 hover:text-white focus:bg-sky-900 focus:text-white focus:outline-none active:bg-sky-800 disabled:bg-slate-900 disabled:text-slate-500"
                  helperClassName="mt-1 text-xs text-slate-300"
                />
              </div>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-200">
                City
                <input
                  value={form.city}
                  onChange={(event) => update("city", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                State
                <input
                  value={form.state}
                  onChange={(event) => update("state", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
            </div>
            <label className="block text-sm font-medium text-slate-200">
              ZIP
              <input
                value={form.postal_code}
                onChange={(event) => update("postal_code", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
              />
            </label>
          </div>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={creating || !form.title.trim() || !form.description.trim()}
          className="mt-5 w-full rounded-xl bg-amber-300 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-44"
        >
          {creating ? "Saving..." : editingRequest ? "Save Request Updates" : "Create Request"}
        </button>
        {editingRequest ? (
          <button
            type="button"
            onClick={() => {
              setEditingRequest(null);
              setRequestSuggestion(null);
              setImproveError("");
              setForm((prev) => ({
                ...prev,
                title: "",
                description: "",
                project_category: "",
                project_type: "",
                project_subtype: "",
                payment_preference: "",
                preferred_timeline: "",
                urgency: "normal",
              }));
            }}
            className="ml-0 mt-3 rounded-xl border border-slate-600 px-4 py-3 text-sm font-bold text-slate-200 hover:bg-slate-800 sm:ml-3"
          >
            Cancel Edit
          </button>
        ) : null}
      </form>

      <section data-testid="customer-portal-requests" className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white">Project & Service Requests</h2>
            <p className="mt-1 text-sm text-slate-300">
              Use Requests to tell us what you need help with next. Saved requests stay private until you choose to send them to a contractor or, where available, up to 5 marketplace contractors.
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Contractor responses and bids appear here after a request is routed or a contractor replies.
            </p>
          </div>
          <Badge>{requests.length} total</Badge>
        </div>

        <div className="mt-4 space-y-3">
          {requests.length ? (
            requests.map((request) => (
              <div key={request.id} data-testid={`customer-request-card-${request.id}`} className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white">{request.project_title}</div>
                      <div className="mt-2 flex flex-wrap gap-2" data-testid={`customer-request-badges-${request.id}`}>
                        <PassiveBadge>{request.project_type || request.project_category || request.request_type_label || request.project_class_label || "Request"}</PassiveBadge>
                        <PassiveBadge tone={String(request.workflow_status || request.status || "").toLowerCase().includes("cancel") ? "rose" : "amber"}>
                          {homeownerRequestStatus(request, requestBids(request))}
                        </PassiveBadge>
                        {request.can_edit ? <PassiveBadge tone="sky">Editable until sent</PassiveBadge> : null}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-400">{request.project_scope || request.notes || request.project_address || "Request details pending."}</div>
                    <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2 lg:grid-cols-3">
                      <span><strong className="text-slate-200">Property:</strong> {request.property_name || request.project_address || request.property_profile?.address || "Property pending"}</span>
                      <span><strong className="text-slate-200">Matching:</strong> {requestMatchingText(request, requestBids(request))}</span>
                      <span><strong className="text-slate-200">Next:</strong> {requestNextStep(request, requestBids(request))}</span>
                    </div>
                    {!request.can_edit && requestCanEditText(request) && !String(requestCanEditText(request)).toLowerCase().includes("cancelled") ? (
                      <p className="mt-2 text-xs font-semibold text-slate-500">{requestCanEditText(request)}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2" data-testid={`customer-request-actions-${request.id}`}>
                    <button
                      type="button"
                      data-testid={`customer-request-view-${request.id}`}
                      onClick={() => setSelectedRequest(request)}
                      className="rounded-lg border border-sky-300/40 px-3 py-1.5 text-xs font-semibold text-sky-100 hover:bg-sky-400/10"
                    >
                      View Request
                    </button>
                    {request.can_edit ? (
                      <button
                        type="button"
                        data-testid={`customer-request-edit-${request.id}`}
                        onClick={() => beginEditRequest(request)}
                        className="rounded-lg border border-amber-300/50 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-300/10"
                      >
                        Edit Request
                      </button>
                    ) : null}
                    {request.can_edit || request.workflow_status === "contractor_matching" ? (
                      <button
                        type="button"
                        data-testid={`customer-request-find-contractor-${request.id}`}
                        onClick={() => beginContractorSearch(request)}
                        className="rounded-lg bg-sky-300 px-3 py-1.5 text-xs font-extrabold text-slate-950 hover:bg-sky-200"
                      >
                        Find Contractor
                      </button>
                    ) : null}
                    {requestCanCancel(request) ? (
                      <button
                        type="button"
                        data-testid={`customer-request-cancel-${request.id}`}
                        onClick={() => openCancelRequest(request)}
                        className="rounded-lg border border-rose-300/40 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-400/10"
                      >
                        Cancel Request
                      </button>
                    ) : null}
                    {requestCanDelete(request) ? (
                      <button
                        type="button"
                        data-testid={`customer-request-delete-${request.id}`}
                        onClick={() => openDeleteRequest(request)}
                        className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
                      >
                        Delete Request
                      </button>
                    ) : null}
                    {(request.linked_work?.agreement_url || request.agreement_token) ? (
                      <a
                        data-testid={`customer-request-view-agreement-${request.id}`}
                        href={request.linked_work?.agreement_url || `/agreements/magic/${request.agreement_token}`}
                        className="rounded-lg border border-sky-300/40 px-3 py-1.5 text-xs font-semibold text-sky-100 hover:bg-sky-400/10"
                      >
                        View Agreement
                      </a>
                    ) : null}
                    {(bidsByComparisonKey[request.comparison_key] || []).length > 1 ? (
                      <button
                        type="button"
                        data-testid={`customer-portal-request-compare-${request.id}`}
                        onClick={() => setActiveComparisonKey(request.comparison_key)}
                        className="rounded-lg bg-amber-300 px-3 py-1.5 text-xs font-extrabold text-slate-950 hover:bg-amber-200"
                      >
                        Compare Bids
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <EmptyState title="No saved requests yet" testId="customer-requests-empty">
              Start with a repair, maintenance task, inspection, DIY help request, emergency, or new project idea. It stays private in your workspace until routing is needed.
            </EmptyState>
          )}
        </div>

        {contractorSearchRequest ? (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-3 sm:items-center"
            data-testid="customer-request-contractor-search-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Find a Contractor"
          >
            <div
              data-testid="customer-request-contractor-search-panel"
              className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-3xl border border-sky-300/30 bg-slate-950 p-5 shadow-2xl shadow-slate-950"
            >
              <div className="flex flex-col gap-4 border-b border-slate-800 pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.2em] text-sky-200">Contractor Matching</div>
                  <h3 className="mt-1 text-2xl font-extrabold text-white">Find a Contractor</h3>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                    Select up to 5 contractors to review this request. The request stays in your portal, and contractor responses will appear here.
                  </p>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                    <DetailField label="Request" value={contractorSearchRequest.project_title || contractorSearchRequest.title || "Customer request"} />
                    <DetailField
                      label="Type"
                      value={joinPresent([
                        contractorSearchRequest.project_type || contractorSearchRequest.project_category,
                        contractorSearchRequest.project_subtype,
                      ])}
                    />
                    <DetailField
                      label="Location"
                      value={
                        contractorSearchRequest.project_address ||
                        joinPresent([contractorSearchRequest.city, contractorSearchRequest.state, contractorSearchRequest.postal_code])
                      }
                    />
                  </dl>
                </div>
                <button
                  type="button"
                  onClick={closeContractorSearch}
                  className="rounded-full border border-slate-700 px-3 py-1 text-sm font-bold text-slate-200 hover:bg-slate-800"
                  aria-label="Close contractor search"
                >
                  Close
                </button>
              </div>

              <div className="mt-5 space-y-4">
                {contractorSearchError ? (
                  <div
                    data-testid="customer-request-contractor-search-error"
                    className="rounded-2xl border border-rose-300/40 bg-rose-500/10 p-4 text-sm font-semibold text-rose-100"
                  >
                    {contractorSearchError}
                  </div>
                ) : null}
                {contractorSearchLoading ? (
                  <div
                    data-testid="customer-request-contractor-search-loading"
                    className="rounded-2xl border border-sky-300/30 bg-sky-300/10 p-5 text-sm font-semibold text-sky-100"
                  >
                    Preparing contractor matches for this request...
                  </div>
                ) : contractorSearchRequest.source_intake_token ? (
                  <ContractorDiscoveryStep
                    token={contractorSearchRequest.source_intake_token}
                    form={discoveryFormForRequest(contractorSearchRequest)}
                    active
                    variant="portal"
                    selectedTargets={selectedContractors}
                    setSelectedTargets={setSelectedContractors}
                    onSkipToManual={() => setSelectedContractors([])}
                  />
                ) : (
                  <EmptyState title="Contractor search is not ready yet">
                    Save this request and try again. We need a request record before showing contractor matches.
                  </EmptyState>
                )}
                <div className="flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-900/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-slate-300">
                    {selectedContractors.length
                      ? `${selectedContractors.length} contractor${selectedContractors.length === 1 ? "" : "s"} selected for review.`
                      : "Choose contractor cards above before sending this request."}
                  </div>
                  <button
                    type="button"
                    data-testid="customer-request-route-contractors"
                    onClick={routeSelectedContractors}
                    disabled={routingContractors || contractorSearchLoading || !selectedContractors.length}
                    className="rounded-xl bg-amber-300 px-4 py-3 text-sm font-extrabold text-slate-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {routingContractors ? "Sending..." : "Send Request to Selected Contractors"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {selectedRequest ? (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 p-3 sm:items-center"
            data-testid="customer-request-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Request details"
          >
            <div className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-3xl border border-slate-700 bg-slate-950 p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.2em] text-amber-200">Request Details</div>
                  <h3 className="mt-1 text-2xl font-extrabold text-white">{selectedRequest.project_title || "Customer request"}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Review what was submitted before routing, comparing bids, or opening linked project records.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedRequest(null)}
                  className="rounded-full border border-slate-700 px-3 py-1 text-sm font-bold text-slate-200 hover:bg-slate-800"
                  aria-label="Close request details"
                >
                  Close
                </button>
              </div>

              <div className="mt-5 space-y-4">
                <div className="flex flex-wrap gap-2">
                  {selectedRequest.can_edit ? (
                    <button
                      type="button"
                      data-testid="customer-request-detail-edit"
                      onClick={() => beginEditRequest(selectedRequest)}
                      className="rounded-xl border border-amber-300/50 px-4 py-2 text-sm font-bold text-amber-100 hover:bg-amber-300/10"
                    >
                      Edit Request
                    </button>
                  ) : null}
                  {selectedRequest.can_edit || selectedRequest.workflow_status === "contractor_matching" ? (
                    <button
                      type="button"
                      data-testid="customer-request-detail-find-contractor"
                      onClick={() => beginContractorSearch(selectedRequest)}
                      className="rounded-xl bg-sky-300 px-4 py-2 text-sm font-extrabold text-slate-950 hover:bg-sky-200"
                    >
                      Find Contractor
                    </button>
                  ) : null}
                  {requestCanCancel(selectedRequest) ? (
                    <button
                      type="button"
                      data-testid="customer-request-detail-cancel"
                      onClick={() => openCancelRequest(selectedRequest)}
                      className="rounded-xl border border-rose-300/40 px-4 py-2 text-sm font-bold text-rose-100 hover:bg-rose-400/10"
                    >
                      Cancel Request
                    </button>
                  ) : null}
                </div>
                {String(selectedRequest.workflow_status || selectedRequest.status || "").toLowerCase().includes("cancel") ? (
                  <div data-testid="customer-request-cancelled-banner" className="rounded-2xl border border-rose-300/35 bg-rose-400/10 p-4 text-sm text-rose-50">
                    <div className="font-bold">This request was cancelled.</div>
                    <p className="mt-1 leading-6 text-rose-100/85">
                      {selectedRequest.cancellation_reason || "It will not be sent to contractors."}
                    </p>
                  </div>
                ) : null}
                <DetailSection title="Request Summary" eyebrow="Submitted Request" testId="customer-request-detail-summary">
                  <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <DetailField label="Current Status" value={homeownerRequestStatus(selectedRequest, requestBids(selectedRequest))} />
                    <DetailField label="Request Channel" value={selectedRequest.request_source_label || selectedRequest.source_kind_label} />
                    <DetailField label="What Happens Next" value={requestNextStep(selectedRequest, requestBids(selectedRequest))} />
                    <DetailField label="Contractor Matching" value={requestMatchingText(selectedRequest, requestBids(selectedRequest))} />
                    <DetailField label="Can Edit / Cancel" value={requestCanEditText(selectedRequest)} />
                    <DetailField label="Agreement Status" value={selectedRequest.conversion_status} />
                    <DetailField label="Cancelled" value={formatDateTime(selectedRequest.cancelled_at)} />
                    <DetailField label="Submitted" value={formatDateTime(selectedRequest.created_at)} />
                    <DetailField label="Last Updated" value={formatDateTime(selectedRequest.updated_at || selectedRequest.latest_activity)} />
                    <DetailField label="Contractor Responses" value={`${requestBids(selectedRequest).length} response${requestBids(selectedRequest).length === 1 ? "" : "s"}`} />
                  </dl>
                </DetailSection>

                <DetailSection title="Homeowner & Property" testId="customer-request-detail-homeowner-property">
                  <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <DetailField label="Homeowner" value={selectedRequest.homeowner_name} />
                    <DetailField label="Email" value={selectedRequest.homeowner_email} />
                    <DetailField label="Phone" value={selectedRequest.homeowner_phone} />
                    <DetailField label="Property" value={selectedRequest.property_name || selectedRequest.property_profile?.display_name} />
                    <DetailField label="Property Type" value={selectedRequest.property_profile?.property_type_label} />
                    <DetailField label="Property / Address" value={selectedRequest.project_address || selectedRequest.property_profile?.address} />
                  </dl>
                </DetailSection>

                <DetailSection title="Project Details" testId="customer-request-detail-project-details">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <TextBlock
                      label="Original Homeowner Description"
                      value={selectedRequest.original_description || selectedRequest.project_scope || selectedRequest.notes}
                      empty="No original description was submitted."
                    />
                    <TextBlock
                      label="AI-Enhanced Scope"
                      value={selectedRequest.ai_enhanced_description}
                      empty="No AI-enhanced description is saved for this request yet."
                    />
                  </div>
                  <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <DetailField label="AI Suggested Title" value={selectedRequest.ai_generated_title} />
                    <DetailField label="Project Type" value={selectedRequest.ai_generated_type || selectedRequest.project_type || selectedRequest.project_category} />
                    <DetailField label="Project Subtype" value={selectedRequest.ai_generated_subtype || selectedRequest.project_subtype} />
                    <DetailField label="Project Mode" value={selectedRequest.project_mode_label} />
                    <DetailField label="Request Type" value={selectedRequest.request_type_label || selectedRequest.project_class_label} />
                    <DetailField label="Linked Home System" value={selectedRequest.linked_home_system_name} />
                    <DetailField label="Recommendation" value={selectedRequest.recommendation_title} />
                    <DetailField label="Timeline" value={joinPresent([selectedRequest.timeline_label || selectedRequest.preferred_timeline, selectedRequest.urgency])} />
                    <DetailField label="Budget" value={selectedRequest.budget_preference} />
                    <DetailField label="Payment Preference" value={selectedRequest.payment_preference_label} />
                    <DetailField label="Materials Preferences" value={selectedRequest.materials_preferences} />
                    <DetailField label="Scheduling / Access Notes" value={selectedRequest.scheduling_access_notes} />
                    <DetailField label="Special Instructions" value={selectedRequest.special_instructions} />
                  </dl>
                </DetailSection>

                <DetailSection title="Contractor Routing" testId="customer-request-detail-selected-contractor">
                  {requestContractorRoutes(selectedRequest).length ? (
                    <div className="space-y-3">
                      {requestContractorRoutes(selectedRequest).map((contractor) => (
                        <div key={contractor.id || contractor.business_name} className="rounded-2xl border border-emerald-300/30 bg-emerald-300/10 p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <h5 className="text-lg font-extrabold text-white">{contractor.business_name || "Selected contractor"}</h5>
                            <Badge>{contractor.status_label || "Sent"}</Badge>
                          </div>
                          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            <DetailField label="Contact" value={contractor.contact_name} />
                            <DetailField label="Phone" value={contractor.phone} />
                            <DetailField label="Email" value={contractor.email} />
                            <DetailField label="Service Area" value={contractor.service_area || contractor.location} />
                            <DetailField label="Trade / Match" value={contractor.trade} />
                            <DetailField label="How Selected" value={contractor.selection_method} />
                            <DetailField label="Sent" value={formatDateTime(contractor.invited_at || contractor.selected_at)} />
                            <DetailField label="Accepted" value={formatDateTime(contractor.accepted_at)} />
                          </dl>
                          {contractor.profile_url ? (
                            <a
                              href={contractor.profile_url}
                              className="mt-4 inline-flex rounded-xl border border-sky-300/40 px-4 py-2 text-sm font-bold text-sky-100 hover:bg-sky-400/10"
                            >
                              View contractor profile
                            </a>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm leading-6 text-slate-400">No contractor has been sent this request yet. Use Find Contractor when you are ready.</p>
                  )}
                </DetailSection>

                <DetailSection title="Photos & Documents" testId="customer-request-detail-files">
                  {selectedRequest.photos?.length || selectedRequest.documents?.length ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {[...(selectedRequest.photos || []), ...(selectedRequest.documents || [])].map((file) => (
                        <a
                          key={file.id || file.url || file.filename}
                          href={file.url || "#"}
                          className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-sm font-semibold text-sky-100 hover:bg-sky-400/10"
                        >
                          {file.title || file.filename || "Attached file"}
                          {file.filename ? <span className="mt-1 block text-xs font-normal text-slate-400">{file.filename}</span> : null}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm leading-6 text-slate-400">No photos or documents are attached to this request yet.</p>
                  )}
                </DetailSection>

                <DetailSection title="Activity Timeline" testId="customer-request-detail-activity">
                  <RequestTimeline items={selectedRequest.activity_timeline || []} />
                </DetailSection>

                <DetailSection title="Linked Work" testId="customer-request-detail-linked-work">
                  {selectedRequest.linked_work || selectedRequest.agreement_token ? (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-bold text-white">
                          {selectedRequest.linked_work?.project_title || selectedRequest.project_title || "Linked agreement"}
                        </div>
                        <p className="mt-1 text-sm text-slate-400">
                          {selectedRequest.linked_work?.status_label || selectedRequest.status_label || "Agreement record available"}
                        </p>
                      </div>
                      {(selectedRequest.linked_work?.agreement_url || selectedRequest.agreement_token) ? (
                        <a
                          href={selectedRequest.linked_work?.agreement_url || `/agreements/magic/${selectedRequest.agreement_token}`}
                          className="rounded-xl border border-sky-300/40 px-4 py-2 text-sm font-bold text-sky-100 hover:bg-sky-400/10"
                        >
                          View linked agreement
                        </a>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm leading-6 text-slate-400">This request has not been converted into an agreement yet.</p>
                  )}
                </DetailSection>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {requestBids(selectedRequest).length > 1 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveComparisonKey(selectedRequest.comparison_key);
                      setSelectedRequest(null);
                    }}
                    className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-extrabold text-slate-950 hover:bg-amber-200"
                  >
                    View bid comparison
                  </button>
                ) : null}
                {selectedRequest.agreement_token ? (
                  <a
                    href={`/agreements/magic/${selectedRequest.agreement_token}`}
                    className="rounded-xl border border-sky-300/40 px-4 py-2 text-sm font-bold text-sky-100 hover:bg-sky-400/10"
                  >
                    View linked agreement
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {cancelRequest ? (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 p-3 sm:items-center"
            data-testid="customer-request-cancel-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Cancel Request"
          >
            <div className="w-full max-w-lg rounded-3xl border border-rose-300/35 bg-slate-950 p-5 shadow-2xl">
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-rose-200">Cancel Request</div>
              <h3 className="mt-1 text-2xl font-extrabold text-white">Cancel Request</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Cancelling keeps the request in your portal history but stops it from moving forward. If it has already been sent to contractors, they may be notified that the request was withdrawn.
              </p>
              <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
                <div className="text-sm font-bold text-white">{cancelRequest.project_title || "Customer request"}</div>
                <p className="mt-1 text-sm text-slate-400">{homeownerRequestStatus(cancelRequest, requestBids(cancelRequest))}</p>
              </div>
              <label className="mt-4 block text-sm font-semibold text-slate-200">
                Reason (optional)
                <textarea
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  rows={4}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-rose-300"
                  placeholder="Share a short note for your records or for contractors who already received the request."
                />
              </label>
              {cancelError ? (
                <div data-testid="customer-request-cancel-error" className="mt-3 rounded-xl border border-rose-300/40 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
                  {cancelError}
                </div>
              ) : null}
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeCancelRequest}
                  disabled={cancelBusy}
                  className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
                >
                  Keep Request
                </button>
                <button
                  type="button"
                  data-testid="customer-request-confirm-cancel"
                  onClick={submitCancelRequest}
                  disabled={cancelBusy}
                  className="rounded-xl bg-rose-300 px-4 py-2 text-sm font-extrabold text-slate-950 hover:bg-rose-200 disabled:opacity-60"
                >
                  {cancelBusy ? "Cancelling..." : "Cancel Request"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {deleteRequest ? (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 p-3 sm:items-center"
            data-testid="customer-request-delete-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Delete Request"
          >
            <div className="w-full max-w-lg rounded-3xl border border-slate-600 bg-slate-950 p-5 shadow-2xl">
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-300">Delete Request</div>
              <h3 className="mt-1 text-2xl font-extrabold text-white">Delete private request?</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                This is only available before a request is sent to contractors. Deleting removes the private draft from your portal instead of keeping it in history.
              </p>
              <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
                <div className="text-sm font-bold text-white">{deleteRequest.project_title || "Customer request"}</div>
                <p className="mt-1 text-sm text-slate-400">{deleteRequest.project_scope || deleteRequest.notes || "Private request"}</p>
              </div>
              {deleteError ? (
                <div data-testid="customer-request-delete-error" className="mt-3 rounded-xl border border-rose-300/40 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
                  {deleteError}
                </div>
              ) : null}
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeDeleteRequest}
                  disabled={deleteBusy}
                  className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
                >
                  Keep Request
                </button>
                <button
                  type="button"
                  data-testid="customer-request-confirm-delete"
                  onClick={submitDeleteRequest}
                  disabled={deleteBusy}
                  className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-extrabold text-slate-950 hover:bg-white disabled:opacity-60"
                >
                  {deleteBusy ? "Deleting..." : "Delete Request"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-4 rounded-xl border border-sky-300/30 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
          {internalRequests.length
            ? "New portal requests are private first and are not sent to contractors unless routing is enabled and you choose that next step."
            : "Saved requests stay private here first. They can later be prepared for contractor routing when you choose the next step."}
        </div>

        {activeComparisonRequest ? (
          <div
            data-testid="customer-bid-comparison"
            className="mt-6 rounded-2xl border border-amber-200/25 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.12),transparent_35%),rgba(15,23,42,0.92)] p-5"
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.22em] text-amber-200">Bid Comparison</div>
                <h3 className="mt-1 text-xl font-extrabold text-white">{activeComparisonRequest.project_title || "Marketplace Request"}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  Compare up to 5 contractor bids before selecting who should create the agreement draft.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge>{activeComparisonBids.length} bid{activeComparisonBids.length === 1 ? "" : "s"}</Badge>
                {awardedBid ? <HighlightBadge>Awarded Contractor: {awardedBid.contractor_name || "Selected"}</HighlightBadge> : null}
              </div>
            </div>
            <div className="mt-5 grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {activeComparisonBids.map((bid) => {
                const highlights = activeHighlights[bid.id] || [];
                const isAwarded = bid.is_awarded || Boolean(bid.linked_agreement_id);
                const canAward = bid.can_accept && !awardedBid;
                return (
                  <article
                    key={bid.id}
                    data-testid={`customer-bid-comparison-card-${bid.id}`}
                    className={`rounded-2xl border p-4 ${
                      isAwarded
                        ? "border-emerald-300/40 bg-emerald-400/10"
                        : "border-slate-700 bg-slate-950/65"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-base font-extrabold text-white">{bid.contractor_business_name || bid.contractor_name || "Contractor"}</h4>
                        <p className="mt-1 text-xs text-slate-400">{bid.contractor_contact_name || bid.service_area || "Service area pending"}</p>
                      </div>
                      <Badge>{bid.status_label || "Submitted"}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {highlights.map((label) => <HighlightBadge key={label}>{label}</HighlightBadge>)}
                      {Number(bid.contractor_review_count || 0) > 0 ? (
                        <HighlightBadge>
                          {Number(bid.contractor_rating || 0).toFixed(2)} rating · {bid.contractor_review_count} review{Number(bid.contractor_review_count || 0) === 1 ? "" : "s"}
                        </HighlightBadge>
                      ) : null}
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Price</dt>
                        <dd className="mt-1 text-lg font-extrabold text-white">{bid.bid_amount_label || "Bid pending"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Timeline</dt>
                        <dd className="mt-1 font-semibold text-slate-100">{bid.timeline || "Timeline pending"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Milestones</dt>
                        <dd className="mt-1 font-semibold text-slate-100">
                          {Number(bid.milestone_count || 0) || (Array.isArray(bid.milestone_preview) ? bid.milestone_preview.length : 0) || "No plan yet"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Service Area</dt>
                        <dd className="mt-1 font-semibold text-slate-100">{bid.service_area || bid.request_address || "Not listed"}</dd>
                      </div>
                    </dl>
                    <div className="mt-4 space-y-3 text-sm">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Warranty</div>
                        <p className="mt-1 leading-6 text-slate-300">{bid.warranty_summary || "Warranty details not included yet."}</p>
                      </div>
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Proposal Notes</div>
                        <p className="mt-1 leading-6 text-slate-300">{bid.proposal_summary || bid.notes || "No proposal notes yet."}</p>
                      </div>
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Milestone Structure</div>
                        <p className="mt-1 leading-6 text-slate-300">
                          {Array.isArray(bid.milestone_preview) && bid.milestone_preview.length ? bid.milestone_preview.join(" • ") : "No milestone preview yet."}
                        </p>
                      </div>
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {bid.linked_agreement_token ? (
                        <a
                          data-testid={`customer-bid-comparison-open-${bid.id}`}
                          href={`/agreements/magic/${bid.linked_agreement_token}`}
                          className="rounded-lg border border-sky-300/40 px-3 py-2 text-xs font-bold text-sky-100 hover:bg-sky-400/10"
                        >
                          Open Agreement Draft
                        </a>
                      ) : canAward ? (
                        <button
                          type="button"
                          data-testid={`customer-bid-comparison-award-${bid.id}`}
                          onClick={() => setPendingAwardBid(bid)}
                          className="rounded-lg bg-amber-300 px-3 py-2 text-xs font-extrabold text-slate-950 hover:bg-amber-200"
                        >
                          Award Contractor
                        </button>
                      ) : (
                        <span className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-400">
                          {awardedBid ? "Not Selected" : "Award unavailable"}
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : null}

        <div data-testid="customer-portal-bids" className="mt-6 border-t border-slate-700 pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-white">Contractor Responses</h3>
              <p className="mt-1 text-sm text-slate-400">
                Bids appear after a request is routed or a contractor submits a response.
              </p>
            </div>
            <Badge>{bids.length} bids</Badge>
          </div>
          <div className="mt-3 space-y-3">
            {bids.length ? (
              bids.map((bid) => (
                <div key={bid.id} className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-white">{bid.project_title}</div>
                      <div className="mt-1 text-sm text-slate-400">{bid.contractor_name || "Contractor"} - {bid.bid_amount_label || "Bid pending"}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{bid.status_label || "Submitted"}</Badge>
                      {bid.linked_agreement_token ? (
                        <a
                          data-testid={`customer-portal-bid-open-${bid.id}`}
                          href={`/agreements/magic/${bid.linked_agreement_token}`}
                          className="rounded-lg border border-sky-300/40 px-3 py-1.5 text-xs font-semibold text-sky-100 hover:bg-sky-400/10"
                        >
                          Open agreement
                        </a>
                      ) : bid.can_accept ? (
                        <button
                          type="button"
                          data-testid={`customer-portal-bid-accept-${bid.id}`}
                          onClick={() => setPendingAwardBid(bid)}
                          disabled={acceptingBidId === bid.id}
                          className="rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-300 disabled:opacity-50"
                      >
                          {acceptingBidId === bid.id ? "Creating draft..." : "Award Bid"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState title="No bids yet" testId="customer-bids-empty">
                Contractor bids will appear here after a request is routed or an agreement flow brings contractor proposals back to this portal.
              </EmptyState>
            )}
          </div>
        </div>
      </section>

      {pendingAwardBid ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="customer-bid-award-title"
          data-testid="customer-portal-bid-award-modal"
        >
          <div className="w-full max-w-lg rounded-2xl border border-amber-200/30 bg-slate-950 p-6 shadow-2xl">
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-amber-200">Award contractor</div>
            <h3 id="customer-bid-award-title" className="mt-2 text-xl font-extrabold text-white">
              Select this contractor?
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-200">
              Selecting this contractor will create a project agreement draft.
            </p>
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
              <div className="font-semibold text-white">{pendingAwardBid.contractor_name || "Selected contractor"}</div>
              <div>{pendingAwardBid.project_title || "Marketplace request"}</div>
              <div>{pendingAwardBid.bid_amount_label || "Bid amount pending"}</div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setPendingAwardBid(null)}
                className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="customer-portal-bid-award-confirm"
                disabled={acceptingBidId === pendingAwardBid.id}
                onClick={async () => {
                  const bid = pendingAwardBid;
                  setPendingAwardBid(null);
                  await onAcceptBid?.(bid);
                }}
                className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-extrabold text-slate-950 hover:bg-amber-200 disabled:opacity-60"
              >
                {acceptingBidId === pendingAwardBid.id ? "Creating draft..." : "Create agreement draft"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
