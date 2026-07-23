import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarClock, ClipboardCheck, FileText, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import {
  ProjectAssistantApprovalNotice,
  ProjectAssistantConfidenceBadge,
  ProjectAssistantEvidenceList,
  ProjectAssistantMissingInfoList,
  ProjectAssistantPanel,
  ProjectAssistantSection,
} from "../components/ProjectAssistantExperience.jsx";

const statusLabel = (value) =>
  String(value || "submitted")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

function daysBetween(start, end) {
  if (!start || !end) return 0;
  try {
    const left = start instanceof Date ? start : new Date(start);
    const right = end instanceof Date ? end : new Date(end);
    if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return 0;
    return Math.max(Math.floor((right.getTime() - left.getTime()) / 86400000), 0);
  } catch {
    return 0;
  }
}

const metricTone = {
  active_warranties: "border-emerald-200/30 bg-emerald-400/10 text-emerald-100",
  open_warranty_requests: "border-sky-200/30 bg-sky-400/10 text-sky-100",
  repairs_scheduled: "border-indigo-200/30 bg-indigo-400/10 text-indigo-100",
  expiring_soon: "border-amber-200/30 bg-amber-400/10 text-amber-100",
};

const operationalPanel = "mhb-operational-panel";
const operationalCard = "mhb-glass";
const operationalControl = "mhb-operational-control";
const operationalButton = "mhb-btn";
const operationalPrimaryButton = "mhb-btn primary";

function MetricCard({ label, value, id, icon: Icon }) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${metricTone[id] || "border-white/10 bg-white/7 text-white"}`}
      data-operational-metric-tone={id}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-black uppercase tracking-[0.13em] opacity-70">{label}</div>
        <Icon className="h-4 w-4 opacity-75" />
      </div>
      <div className="mt-2 text-2xl font-black">{value ?? 0}</div>
    </div>
  );
}

function WarrantyEmptyState({ title, description, action = null }) {
  return (
    <div className={`${operationalCard} flex min-h-[11rem] items-center justify-center rounded-2xl px-5 py-7 text-center`} data-testid="warranty-empty-state">
      <div className="max-w-xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-200/20 bg-sky-400/12 text-sky-100">
          <ShieldCheck className="h-6 w-6" aria-hidden="true" />
        </div>
        <h3 className="mt-4 text-lg font-black text-white">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-sky-100/70">{description}</p>
        {action ? (
          <Link to={action.to} className={`${operationalPrimaryButton} mt-4 inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-black`}>
            {action.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function RequestCard({ row, busyId, runAction }) {
  return (
    <article className={`${operationalCard} rounded-xl p-4 text-white`} data-testid={`warranty-request-${row.id}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold text-white">{row.title}</h3>
            <span className="rounded-full border border-white/12 bg-white/8 px-2.5 py-1 text-xs font-bold text-sky-100/78">{statusLabel(row.status)}</span>
            <span className="rounded-full border border-amber-200/25 bg-amber-400/12 px-2.5 py-1 text-xs font-bold text-amber-100">{statusLabel(row.severity)}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-sky-100/72">{row.description}</p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-sky-100/55">
            <span>Customer: {row.customer_name || "Customer"}</span>
            <span>Project: {row.agreement_title || "Project"}</span>
            <span>Area: {row.area_affected || "Not specified"}</span>
            <span>Submitted: {daysBetween(row.created_at, new Date())} day(s) ago</span>
            <span>Noticed: {row.date_noticed || "Not provided"}</span>
            <span>Evidence: {row.evidence?.length || 0}</span>
          </div>
          <div className="mt-2 text-xs font-semibold text-sky-100/60">
            Next action: {row.next_expected_action || "Review warranty request."}
            {row.work_order?.scheduled_for ? ` Scheduled: ${new Date(row.work_order.scheduled_for).toLocaleString()}` : ""}
          </div>
          {row.ai_review?.summary ? (
            <ProjectAssistantPanel
              subtitle="Warranty Assistant"
              summary={row.ai_review.summary}
              className={`${operationalCard} mt-3 text-white`}
              testId={`warranty-assistant-review-${row.id}`}
            >
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-xs font-black text-sky-800">
                  Coverage review signal: {statusLabel(row.ai_review.likely_coverage || "needs_review")}
                </span>
                <ProjectAssistantConfidenceBadge
                  value={row.ai_review.confidence_level}
                  explanation="Warranty confidence is based on coverage dates, request details, evidence count, and status history."
                />
              </div>
              {row.ai_review.possible_exclusions ? (
                <ProjectAssistantSection title="Possible exclusion to review">
                  {row.ai_review.possible_exclusions}
                </ProjectAssistantSection>
              ) : null}
              <ProjectAssistantSection title="Evidence reviewed">
                <ProjectAssistantEvidenceList
                  items={[
                    row.ai_review.evidence_considered?.agreement_id ? { type: "Agreement", label: `Agreement #${row.ai_review.evidence_considered.agreement_id}` } : null,
                    row.ai_review.evidence_considered?.warranty_id ? { type: "Warranty request", label: `Warranty #${row.ai_review.evidence_considered.warranty_id}` } : null,
                    { type: "Evidence", label: `${row.ai_review.evidence_considered?.evidence_count || 0} uploaded item(s)` },
                    row.ai_review.evidence_considered?.work_order_id ? { type: "Work order", label: `Work order #${row.ai_review.evidence_considered.work_order_id}` } : null,
                  ].filter(Boolean)}
                />
              </ProjectAssistantSection>
              <ProjectAssistantSection title="Missing information">
                <ProjectAssistantMissingInfoList
                  items={row.ai_review.missing_information || []}
                  empty="No missing information listed for this warranty review."
                />
              </ProjectAssistantSection>
              <ProjectAssistantSection title="Recommended next review step">
                {row.ai_review.recommended_next_step || "Review request and evidence."}
              </ProjectAssistantSection>
              <ProjectAssistantApprovalNotice compact>
                Human decision required before approving coverage, denying coverage, scheduling repair work, assigning team members, or creating payment obligations.
              </ProjectAssistantApprovalNotice>
            </ProjectAssistantPanel>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button className={`${operationalButton} rounded-lg px-3 py-2 text-sm font-semibold`} onClick={() => runAction(row, "ai")} disabled={busyId === `${row.id}:ai`}>
            Generate recommendation
          </button>
          <button className={`${operationalPrimaryButton} rounded-lg px-3 py-2 text-sm font-black`} onClick={() => runAction(row, "work-order")} disabled={busyId === `${row.id}:work-order`}>
            Create Work Order
          </button>
          <button className="rounded-lg border border-emerald-200/35 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/16" onClick={() => runAction(row, "status", { status: "completed", note: "Warranty work completed." })} disabled={busyId === `${row.id}:status`}>
            Complete
          </button>
        </div>
      </div>
    </article>
  );
}

function WarrantyRecordCard({ row }) {
  return (
    <article className={`${operationalCard} rounded-xl p-4 text-white`} data-testid={`warranty-record-${row.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-white">{row.title}</h3>
          <p className="mt-1 text-sm text-sky-100/65">{row.customer_name || "Customer"} - {row.agreement_title || `Agreement #${row.agreement}`}</p>
        </div>
        <span className="rounded-full border border-emerald-200/35 bg-emerald-400/12 px-2.5 py-1 text-xs font-bold text-emerald-100">{statusLabel(row.status)}</span>
      </div>
      <p className="mt-3 line-clamp-3 text-sm leading-6 text-sky-100/70">{row.coverage_details || row.covered_work || "Coverage details not recorded."}</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs font-semibold text-sky-100/55">
        <span>{row.start_date || "-"} to {row.end_date || "-"}</span>
        <span>{row.open_request_count || 0} open request(s)</span>
      </div>
      <div className="mt-4 flex gap-2">
        <Link to={`/app/agreements/${row.agreement}`} className={`${operationalButton} inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold`}>
          <FileText className="h-4 w-4" />
          Agreement
        </Link>
        <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/7 px-3 py-2 text-sm font-semibold text-sky-100/70">
          <Wrench className="h-4 w-4" />
          Warranty Work
        </span>
      </div>
    </article>
  );
}

export default function WarrantyDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [activeTab, setActiveTab] = useState("requests");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    status: "",
    warrantyType: "",
    expiringSoon: false,
    overdue: false,
    assigned: "",
    search: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/projects/warranty/dashboard/");
      setData(res.data || {});
    } catch (err) {
      setError(err?.response?.data?.detail || "Unable to load warranties.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const metrics = data?.metrics || {};
  const requests = Array.isArray(data?.requests) ? data.requests : [];
  const warranties = Array.isArray(data?.warranties) ? data.warranties : [];

  const warrantyById = useMemo(() => {
    const map = new Map();
    warranties.forEach((row) => map.set(String(row.id), row));
    return map;
  }, [warranties]);

  const openRequests = useMemo(
    () => requests.filter((row) => !["completed", "denied", "closed", "escalated_to_resolution"].includes(row.status)),
    [requests]
  );

  const filteredRequests = useMemo(() => {
    const today = new Date();
    return openRequests.filter((row) => {
      const warranty = warrantyById.get(String(row.warranty)) || {};
      const workOrder = row.work_order || {};
      const text = `${row.title || ""} ${row.customer_name || ""} ${row.agreement_title || ""} ${row.area_affected || ""}`.toLowerCase();
      const daysSince = daysBetween(row.created_at, today);
      const expirationDays = warranty.end_date ? daysBetween(today, warranty.end_date) : null;
      if (filters.status && row.status !== filters.status) return false;
      if (filters.warrantyType && warranty.applies_to !== filters.warrantyType) return false;
      if (filters.expiringSoon && !(expirationDays !== null && expirationDays >= 0 && expirationDays <= 30)) return false;
      if (filters.overdue && !(row.response_due_at && new Date(row.response_due_at) < today) && !(daysSince > 2 && ["submitted", "under_review"].includes(row.status))) return false;
      if (filters.assigned && String(workOrder.assigned_user || "") !== String(filters.assigned)) return false;
      if (filters.search && !text.includes(filters.search.toLowerCase())) return false;
      return true;
    });
  }, [filters, openRequests, warrantyById]);

  const activeWarranties = useMemo(
    () => warranties.filter((row) => ["active", "in_effect", "open"].includes(String(row.status || "").toLowerCase())),
    [warranties]
  );

  const repairRequests = useMemo(
    () => filteredRequests.filter((row) => ["inspection_scheduled", "repair_scheduled", "repair_in_progress"].includes(row.status) || row.work_order),
    [filteredRequests]
  );

  const expiringWarranties = useMemo(() => {
    const today = new Date();
    return warranties.filter((row) => {
      if (!row.end_date) return false;
      const days = daysBetween(today, row.end_date);
      return days >= 0 && days <= 30;
    });
  }, [warranties]);

  const statusOptions = useMemo(() => Array.from(new Set(requests.map((row) => row.status).filter(Boolean))).sort(), [requests]);
  const warrantyTypes = useMemo(() => Array.from(new Set(warranties.map((row) => row.applies_to).filter(Boolean))).sort(), [warranties]);
  const assignedOptions = useMemo(() => {
    const map = new Map();
    requests.forEach((row) => {
      const userId = row.work_order?.assigned_user;
      if (userId) map.set(String(userId), row.work_order?.assigned_team_notes || `User #${userId}`);
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [requests]);
  const hasWarrantyData = requests.length > 0 || warranties.length > 0;

  async function runAction(row, action, payload = {}) {
    setBusyId(`${row.id}:${action}`);
    try {
      if (action === "ai") {
        await api.post(`/projects/warranty-requests/${row.id}/ai-review/`);
      } else if (action === "work-order") {
        await api.post(`/projects/warranty-requests/${row.id}/work-order/`, {
          title: row.title,
          scope: row.description,
          ...payload,
        });
      } else if (action === "status") {
        await api.post(`/projects/warranty-requests/${row.id}/status/`, payload);
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const tabs = [
    { key: "requests", label: "Requests", count: filteredRequests.length },
    { key: "active", label: "Active Warranties", count: activeWarranties.length },
    { key: "repair", label: "Repair Work", count: repairRequests.length },
    { key: "expiring", label: "Expiring", count: expiringWarranties.length },
  ];
  const priorityRequest = filteredRequests[0];
  const assistantSummary = hasWarrantyData
    ? priorityRequest
      ? `${priorityRequest.title || "Warranty request"} needs review for ${priorityRequest.customer_name || "a customer"}. ${priorityRequest.next_expected_action || "Review warranty request, evidence, and next step."}`
      : `${activeWarranties.length} active warranty record${activeWarranties.length === 1 ? "" : "s"} are available. No open customer warranty request needs immediate attention.`
    : "Warranty Center is populated from completed projects with active warranty coverage and from customer warranty requests submitted after completion.";
  const assistantActions = !hasWarrantyData ? (
    <>
      <Link to="/app/agreements" className={`${operationalPrimaryButton} inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-black`}>
        View completed projects
      </Link>
      <Link to="/app/templates" className={`${operationalButton} inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-black`}>
        Review warranty templates
      </Link>
    </>
  ) : null;

  return (
    <ContractorPageSurface
      eyebrow="Operations"
      title="Warranties"
      subtitle="Track active coverage, customer warranty requests, advisory reviews, and repair work orders after project completion."
      actions={
          <button
            type="button"
            onClick={load}
            className={`${operationalButton} inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold`}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
      }
      className="mx-auto max-w-[1180px]"
      contentClassName="space-y-4"
      variant="operational"
    >
      <div data-testid="warranty-dashboard">

        {error ? (
          <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</div>
        ) : null}

        {loading ? (
          <div className={`${operationalCard} rounded-xl p-6 text-sm font-bold text-sky-100/70`}>Loading warranties...</div>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="warranty-metrics">
              <MetricCard id="active_warranties" label="Active Coverage" value={metrics.active_warranties} icon={ShieldCheck} />
              <MetricCard id="open_warranty_requests" label="Requests Needing Attention" value={metrics.open_warranty_requests} icon={AlertCircle} />
              <MetricCard id="repairs_scheduled" label="Repairs Scheduled" value={metrics.repairs_scheduled} icon={CalendarClock} />
              <MetricCard id="expiring_soon" label="Expiring in 30 Days" value={metrics.expiring_soon} icon={ClipboardCheck} />
            </section>

            <ProjectAssistantPanel
              subtitle="Warranty Assistant"
              summary={assistantSummary}
              actions={assistantActions}
              className={`${operationalPanel} text-white`}
            >
              {hasWarrantyData ? (
                <ProjectAssistantSection title="Operations focus">
                  {priorityRequest
                    ? `Prioritize ${priorityRequest.customer_name || "the customer"} request: ${priorityRequest.title || "Warranty request"}.`
                    : "Monitor active coverage and new customer requests as completed projects move into their warranty period."}
                </ProjectAssistantSection>
              ) : (
                <ProjectAssistantSection title="How this workspace fills in">
                  Completed projects create warranty coverage records. Customer warranty requests, repair scheduling, evidence, and advisory reviews appear here after coverage exists.
                </ProjectAssistantSection>
              )}
            </ProjectAssistantPanel>

            <section className="mhb-operational-toolbar rounded-2xl p-3 text-white" data-testid="warranty-dashboard-filters">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <label className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sky-100/50" aria-hidden="true" />
                  <input
                    value={filters.search}
                    onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
                    placeholder="Search customer, project, or warranty issue"
                    className={`${operationalControl} w-full rounded-xl py-2 pl-9 pr-3 text-sm font-semibold`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setFiltersOpen((value) => !value)}
                  className={`${operationalButton} inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-black`}
                  data-testid="warranty-filter-toggle"
                >
                  <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                  Filters
                </button>
              </div>
              <div className={`${filtersOpen || hasWarrantyData ? "grid" : "hidden"} mt-3 gap-3 sm:grid-cols-2 lg:grid-cols-5`} data-testid="warranty-advanced-filters">
                <select value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))} className={`${operationalControl} rounded-lg px-3 py-2 text-sm font-semibold`}>
                  <option value="">All statuses</option>
                  {statusOptions.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
                </select>
                <select value={filters.warrantyType} onChange={(event) => setFilters((prev) => ({ ...prev, warrantyType: event.target.value }))} className={`${operationalControl} rounded-lg px-3 py-2 text-sm font-semibold`}>
                  <option value="">All warranty types</option>
                  {warrantyTypes.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
                </select>
                <select value={filters.assigned} onChange={(event) => setFilters((prev) => ({ ...prev, assigned: event.target.value }))} className={`${operationalControl} rounded-lg px-3 py-2 text-sm font-semibold`}>
                  <option value="">All technicians</option>
                  {assignedOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
                <label className="flex items-center gap-2 rounded-lg border border-white/12 bg-white/6 px-3 py-2 text-sm font-semibold text-sky-100/80">
                  <input type="checkbox" checked={filters.expiringSoon} onChange={(event) => setFilters((prev) => ({ ...prev, expiringSoon: event.target.checked }))} />
                  Expiring soon
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-white/12 bg-white/6 px-3 py-2 text-sm font-semibold text-sky-100/80">
                  <input type="checkbox" checked={filters.overdue} onChange={(event) => setFilters((prev) => ({ ...prev, overdue: event.target.checked }))} />
                  Overdue
                </label>
              </div>
            </section>

            <section className={`${operationalPanel} rounded-2xl text-white`} data-testid="warranty-tabbed-workspace">
              <div className="overflow-x-auto border-b border-white/10 px-3 pt-3">
                <div className="flex min-w-max gap-2" role="tablist" aria-label="Warranty workspace tabs">
                  {tabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === tab.key}
                      data-testid={`warranty-tab-${tab.key}`}
                      onClick={() => setActiveTab(tab.key)}
                      className={`inline-flex items-center gap-2 rounded-t-xl px-4 py-2 text-sm font-black ${
                        activeTab === tab.key
                          ? "border border-sky-300/45 bg-sky-400/16 text-white"
                          : "border border-white/10 bg-white/6 text-sky-100/78 hover:border-white/22 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {tab.label}
                      <span className={`rounded-full px-2 py-0.5 text-xs ${activeTab === tab.key ? "bg-white/16 text-white" : "bg-white/10 text-sky-100/75"}`}>
                        {tab.count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4" data-testid="warranty-tab-panel">
                {activeTab === "requests" ? (
                  filteredRequests.length ? (
                    <div className="space-y-3">
                      {filteredRequests.map((row) => <RequestCard key={row.id} row={row} busyId={busyId} runAction={runAction} />)}
                    </div>
                  ) : (
                    <WarrantyEmptyState
                      title="No warranty requests"
                      description="Customer requests will appear here after a completed project has active warranty coverage."
                      action={{ label: "View completed projects", to: "/app/agreements" }}
                    />
                  )
                ) : null}

                {activeTab === "active" ? (
                  activeWarranties.length ? (
                    <div className="grid gap-3 lg:grid-cols-2">
                      {activeWarranties.map((row) => <WarrantyRecordCard key={row.id} row={row} />)}
                    </div>
                  ) : (
                    <WarrantyEmptyState
                      title="No active warranties"
                      description="Active coverage appears here after completed projects create warranty records."
                      action={{ label: "Review warranty templates", to: "/app/templates" }}
                    />
                  )
                ) : null}

                {activeTab === "repair" ? (
                  repairRequests.length ? (
                    <div className="space-y-3">
                      {repairRequests.map((row) => <RequestCard key={row.id} row={row} busyId={busyId} runAction={runAction} />)}
                    </div>
                  ) : (
                    <WarrantyEmptyState
                      title="No repair work scheduled"
                      description="Warranty repair work appears here after a request has an inspection, repair schedule, or work order."
                    />
                  )
                ) : null}

                {activeTab === "expiring" ? (
                  expiringWarranties.length ? (
                    <div className="grid gap-3 lg:grid-cols-2">
                      {expiringWarranties.map((row) => <WarrantyRecordCard key={row.id} row={row} />)}
                    </div>
                  ) : (
                    <WarrantyEmptyState
                      title="No warranties expiring soon"
                      description="Coverage ending in the next 30 days appears here so you can review upcoming customer expectations."
                    />
                  )
                ) : null}
              </div>
            </section>
          </>
        )}
      </div>
    </ContractorPageSurface>
  );
}
