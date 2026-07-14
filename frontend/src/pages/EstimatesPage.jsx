import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArchiveRestore, ExternalLink, FileSignature, Search } from "lucide-react";
import toast from "react-hot-toast";

import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";

const TABS = [
  { key: "needs_estimate", label: "Needs Estimate" },
  { key: "in_progress", label: "In Progress" },
  { key: "ready", label: "Ready for Agreement" },
  { key: "converted", label: "Converted" },
  { key: "archived", label: "Archived" },
];

const STATUS_LABELS = {
  draft: "Draft",
  site_visit: "Site Visit",
  in_progress: "In Progress",
  ready: "Ready",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  declined: "Declined",
  revision_requested: "Revision Requested",
  expired: "Expired",
  converted: "Converted",
};

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function formatDateTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

function statusLabel(value) {
  return STATUS_LABELS[normalize(value)] || String(value || "Draft").replace(/_/g, " ");
}

function moneyToNumber(value) {
  const amount = Number.parseFloat(String(value || "0").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}

function readinessPercent(estimate) {
  const totals = estimate?.totals || {};
  const lineCount = Number(estimate?.line_item_count || totals.line_item_count || 0);
  const checks = [
    Boolean(estimate?.customer_name && (estimate?.customer_email || estimate?.customer_phone)),
    Boolean(estimate?.service_location),
    Boolean(estimate?.appointment || estimate?.project_start_type || estimate?.scheduling_priority),
    Boolean(estimate?.access_notes || estimate?.site_visit_notes || estimate?.site_conditions),
    Number(estimate?.measurement_count || 0) > 0,
    Number(estimate?.attachment_count || 0) > 0,
    Boolean(estimate?.project_summary || estimate?.included_work),
    Boolean(estimate?.customer_requests || estimate?.assumptions),
    lineCount > 0,
    moneyToNumber(totals.incidentals_reserve) > 0,
  ];
  const complete = checks.filter(Boolean).length;
  return Math.round((complete / checks.length) * 100);
}

function tabForEstimate(estimate) {
  const status = normalize(estimate?.status);
  if (status === "converted" || estimate?.linked_agreement_id) return "converted";
  if (["declined", "expired"].includes(status)) return "archived";
  if (["ready", "sent", "viewed", "accepted"].includes(status)) return "ready";
  if (["site_visit", "in_progress", "revision_requested"].includes(status)) return "in_progress";
  return "needs_estimate";
}

function actionLabel(estimate, tabKey) {
  if (tabKey === "converted") return "Open Agreement";
  if (tabKey === "archived") return "Restore";
  if (tabKey === "ready") return "Create Agreement";
  if (tabKey === "in_progress") return "Continue Estimate";
  return "Open Estimate";
}

function toneForTab(tabKey) {
  if (tabKey === "converted" || tabKey === "ready") return "border-emerald-200/35 bg-emerald-400/12 text-emerald-100";
  if (tabKey === "archived") return "border-white/14 bg-white/8 text-sky-100/78";
  if (tabKey === "in_progress") return "border-amber-200/35 bg-amber-400/12 text-amber-100";
  return "border-sky-200/35 bg-sky-400/12 text-sky-100";
}

function EstimateRow({ estimate, tabKey, onOpen, onAgreement, onRestore }) {
  const readiness = readinessPercent(estimate);
  const nextAction = actionLabel(estimate, tabKey);
  const action = tabKey === "converted" ? onAgreement : tabKey === "archived" ? onRestore : onOpen;
  return (
    <div
      data-testid={`estimate-row-${estimate.id}`}
      className="grid gap-3 rounded-xl border border-sky-200/14 bg-[#061d42]/95 p-3 text-white shadow-[0_18px_46px_rgba(2,8,23,0.26)] transition hover:border-sky-200/28 hover:bg-[#082653] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_150px_150px_150px] lg:items-center"
    >
      <button type="button" onClick={onOpen} className="min-w-0 text-left">
        <div className="text-sm font-black text-white">{estimate.customer_name || "Unknown customer"}</div>
        <div className="mt-1 text-sm font-semibold text-sky-100/72">{estimate.project_title || "Untitled estimate"}</div>
        <div className="mt-1 line-clamp-2 text-xs font-semibold text-sky-100/58">{estimate.service_location || "No property address"}</div>
        <div className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-amber-100/75">
          {[estimate.project_type, estimate.project_subtype].filter(Boolean).join(" / ") || "Project type not set"}
        </div>
      </button>

      <div className="min-w-0 text-sm text-sky-100/70">
        <div>
          <span className="font-bold text-sky-50">Opportunity:</span>{" "}
          {estimate.linked_opportunity_id ? (
            <button type="button" onClick={() => onOpen("opportunity")} className="font-bold text-sky-200 hover:text-white">
              #{estimate.linked_opportunity_id} {estimate.linked_opportunity_title || ""}
            </button>
          ) : (
            "Not linked"
          )}
        </div>
        <div className="mt-1">
          <span className="font-bold text-sky-50">Agreement:</span>{" "}
          {estimate.linked_agreement_id ? (
            <button type="button" onClick={onAgreement} className="font-bold text-sky-200 hover:text-white">
              #{estimate.linked_agreement_id} {estimate.linked_agreement_title || ""}
            </button>
          ) : (
            "Not converted"
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-sky-100/55">Readiness</div>
          <div className="text-sm font-black text-white">{readiness}%</div>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/10">
          <div className="h-3 rounded-full bg-sky-300" style={{ width: `${readiness}%` }} />
        </div>
      </div>

      <div>
        <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${toneForTab(tabKey)}`}>
          {statusLabel(estimate.status)}
        </div>
        <div className="mt-2 text-xs font-semibold text-sky-100/55">Updated {formatDateTime(estimate.updated_at)}</div>
      </div>

      <div className="flex items-center lg:justify-end">
        <button
          type="button"
          data-testid={`estimate-primary-action-${estimate.id}`}
          onClick={action}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-300 px-3 py-2 text-sm font-black text-white shadow-sm hover:bg-amber-200 focus-visible:text-white active:text-white lg:w-auto"
        >
          {tabKey === "archived" ? <ArchiveRestore size={15} /> : tabKey === "converted" ? <ExternalLink size={15} /> : <FileSignature size={15} />}
          {nextAction}
        </button>
      </div>
    </div>
  );
}

export default function EstimatesPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("needs_estimate");
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [projectTypeFilter, setProjectTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [updatedSince, setUpdatedSince] = useState("");

  async function loadEstimates() {
    setLoading(true);
    try {
      const { data } = await api.get("/projects/proposals/");
      setRows(Array.isArray(data?.results) ? data.results : []);
    } catch (error) {
      console.error(error);
      toast.error("Could not load estimates.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEstimates();
  }, []);

  const enriched = useMemo(
    () => rows.map((row) => ({ ...row, tabKey: tabForEstimate(row), readiness: readinessPercent(row) })),
    [rows]
  );

  const customerOptions = useMemo(
    () => [...new Set(enriched.map((row) => row.customer_name).filter(Boolean))].sort(),
    [enriched]
  );
  const projectTypeOptions = useMemo(
    () => [...new Set(enriched.map((row) => row.project_type).filter(Boolean))].sort(),
    [enriched]
  );
  const statusOptions = useMemo(
    () => [...new Set(enriched.map((row) => row.status).filter(Boolean))].sort(),
    [enriched]
  );

  const tabCounts = useMemo(() => {
    const counts = Object.fromEntries(TABS.map((tab) => [tab.key, 0]));
    for (const row of enriched) counts[row.tabKey] = (counts[row.tabKey] || 0) + 1;
    return counts;
  }, [enriched]);
  const queueSummary = useMemo(() => {
    const blockers = enriched.filter((row) => row.tabKey !== "converted" && row.readiness < 100).length;
    const priority =
      tabCounts.needs_estimate > 0
        ? "Complete customer, scope, pricing, and scheduling details."
        : tabCounts.in_progress > 0
          ? "Continue estimates already in progress before opening new work."
          : tabCounts.ready > 0
            ? "Review ready estimates and create agreements when appropriate."
            : "No active estimate blockers in this queue.";
    return {
      needsEstimate: tabCounts.needs_estimate || 0,
      inProgress: tabCounts.in_progress || 0,
      ready: tabCounts.ready || 0,
      blockers,
      priority,
    };
  }, [enriched, tabCounts]);

  const filtered = useMemo(() => {
    const query = normalize(search);
    const since = updatedSince ? Date.parse(`${updatedSince}T00:00:00`) : 0;
    return enriched.filter((row) => {
      if (row.tabKey !== activeTab) return false;
      if (customerFilter !== "all" && row.customer_name !== customerFilter) return false;
      if (projectTypeFilter !== "all" && row.project_type !== projectTypeFilter) return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (since && Date.parse(row.updated_at || "") < since) return false;
      if (!query) return true;
      return [
        row.customer_name,
        row.customer_email,
        row.customer_phone,
        row.service_location,
        row.project_title,
        row.project_type,
        row.project_subtype,
        row.linked_opportunity_title,
        row.linked_agreement_title,
      ].some((value) => normalize(value).includes(query));
    });
  }, [activeTab, customerFilter, enriched, projectTypeFilter, search, statusFilter, updatedSince]);

  const openEstimate = (estimate) => navigate(`/app/estimates/${estimate.id}`);
  const openAgreement = (estimate) => {
    if (estimate.linked_agreement_id) navigate(`/app/agreements/${estimate.linked_agreement_id}`);
    else openEstimate(estimate);
  };
  const restoreEstimate = async (estimate) => {
    try {
      const { data } = await api.patch(`/projects/proposals/${estimate.id}/`, { status: "draft" });
      setRows((prev) => prev.map((row) => (row.id === estimate.id ? data : row)));
      toast.success("Estimate restored.");
      setActiveTab("needs_estimate");
    } catch (error) {
      console.error(error);
      toast.error("Could not restore estimate.");
    }
  };

  return (
    <ContractorPageSurface
      eyebrow="Sales Pipeline"
      title="Estimates"
      subtitle="Review, prepare, and convert estimates into agreements."
      variant="operational"
    >
      <section
        className="rounded-2xl border border-sky-200/14 bg-[#061d42]/95 px-4 py-3 text-white shadow-[0_18px_46px_rgba(2,8,23,0.24)]"
        data-testid="estimates-queue-summary"
      >
        <div className="grid gap-3 xl:grid-cols-[minmax(0,0.7fr)_repeat(4,minmax(7.5rem,0.18fr))_minmax(14rem,0.75fr)] xl:items-center">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-100/80">Estimate Queue</div>
            <div className="mt-1 text-sm font-semibold text-sky-100/70">Final pricing and agreement actions require contractor approval.</div>
          </div>
          {[
            ["Needs Estimate", queueSummary.needsEstimate],
            ["In Progress", queueSummary.inProgress],
            ["Ready", queueSummary.ready],
            ["Blockers", queueSummary.blockers],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-white/10 bg-white/7 px-3 py-2">
              <div className="text-[11px] font-black uppercase tracking-[0.12em] text-sky-100/55">{label}</div>
              <div className="mt-0.5 text-2xl font-black text-white">{Number(value || 0).toLocaleString()}</div>
            </div>
          ))}
          <div className="rounded-xl border border-white/10 bg-white/7 px-3 py-2">
            <div className="text-[11px] font-black uppercase tracking-[0.12em] text-sky-100/55">Next Priority</div>
            <div className="mt-1 text-sm font-bold leading-5 text-white">{queueSummary.priority}</div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-sky-200/14 bg-[#061d42]/95 p-3 text-white shadow-[0_18px_46px_rgba(2,8,23,0.2)]" data-testid="estimates-filters">
        <div className="grid gap-2 lg:grid-cols-[minmax(240px,1.6fr)_repeat(4,minmax(140px,0.8fr))]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sky-100/50" size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search estimates"
              className="h-10 w-full rounded-lg border border-white/12 bg-slate-950/35 pl-9 pr-3 text-sm font-semibold text-white outline-none placeholder:text-sky-100/45 focus:border-sky-300 focus:ring-2 focus:ring-sky-300/20"
            />
          </label>
          <select value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)} className="h-10 rounded-lg border border-white/12 bg-slate-950/35 px-3 text-sm font-semibold text-white focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-300/20">
            <option value="all">All customers</option>
            {customerOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select value={projectTypeFilter} onChange={(event) => setProjectTypeFilter(event.target.value)} className="h-10 rounded-lg border border-white/12 bg-slate-950/35 px-3 text-sm font-semibold text-white focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-300/20">
            <option value="all">All project types</option>
            {projectTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-lg border border-white/12 bg-slate-950/35 px-3 text-sm font-semibold text-white focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-300/20">
            <option value="all">All statuses</option>
            {statusOptions.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
          </select>
          <input
            type="date"
            value={updatedSince}
            onChange={(event) => setUpdatedSince(event.target.value)}
            className="h-10 rounded-lg border border-white/12 bg-slate-950/35 px-3 text-sm font-semibold text-white focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-300/20"
            aria-label="Date updated since"
          />
        </div>
      </section>

      <div className="flex gap-2 overflow-x-auto rounded-2xl border border-sky-200/14 bg-[#061d42]/95 p-2 shadow-[0_18px_46px_rgba(2,8,23,0.18)]" data-testid="estimates-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            data-testid={`estimates-tab-${tab.key}`}
            onClick={() => setActiveTab(tab.key)}
            className={`inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-2 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/50 ${
              activeTab === tab.key
                ? "border-sky-300/45 bg-sky-400/16 text-white"
                : "border-white/10 bg-white/6 text-sky-100/78 hover:border-white/22 hover:bg-white/10 hover:text-white"
            }`}
          >
            <span>{tab.label}</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white">{tabCounts[tab.key] || 0}</span>
          </button>
        ))}
      </div>

      <section className="space-y-3" data-testid="estimates-list">
        {loading ? (
          <div className="rounded-xl border border-white/12 bg-[#061d42]/95 p-6 text-sm font-bold text-sky-100/70">Loading estimates...</div>
        ) : filtered.length ? (
          filtered.map((estimate) => (
            <EstimateRow
              key={estimate.id}
              estimate={estimate}
              tabKey={activeTab}
              onOpen={() => openEstimate(estimate)}
              onAgreement={() => openAgreement(estimate)}
              onRestore={() => restoreEstimate(estimate)}
            />
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-white/16 bg-[#061d42]/95 p-8 text-center">
            <div className="text-base font-black text-white">No estimates in this stage</div>
            <p className="mt-2 text-sm font-semibold text-sky-100/70">
              Estimates created from opportunities, dashboard starts, customers, and property work orders will appear here automatically.
            </p>
            <p className="mt-2 text-sm text-sky-100/55">
              Missing scope, pricing, and handoff details will appear in the relevant estimate workspace.
            </p>
          </div>
        )}
      </section>
    </ContractorPageSurface>
  );
}
