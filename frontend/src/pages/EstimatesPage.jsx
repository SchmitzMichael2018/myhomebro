import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArchiveRestore, ExternalLink, FileSignature, Search } from "lucide-react";
import toast from "react-hot-toast";

import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import {
  ProjectAssistantApprovalNotice,
  ProjectAssistantPanel,
  ProjectAssistantSection,
} from "../components/ProjectAssistantExperience.jsx";

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
  if (tabKey === "converted" || tabKey === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (tabKey === "archived") return "border-slate-200 bg-slate-100 text-slate-700";
  if (tabKey === "in_progress") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-blue-200 bg-blue-50 text-blue-800";
}

function EstimateRow({ estimate, tabKey, onOpen, onAgreement, onRestore }) {
  const readiness = readinessPercent(estimate);
  const nextAction = actionLabel(estimate, tabKey);
  const action = tabKey === "converted" ? onAgreement : tabKey === "archived" ? onRestore : onOpen;
  return (
    <div
      data-testid={`estimate-row-${estimate.id}`}
      className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-200 hover:shadow-md lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_130px_130px_160px]"
    >
      <button type="button" onClick={onOpen} className="min-w-0 text-left">
        <div className="text-sm font-black text-slate-950">{estimate.customer_name || "Unknown customer"}</div>
        <div className="mt-1 text-sm font-semibold text-slate-600">{estimate.service_location || "No property address"}</div>
        <div className="mt-2 text-sm text-slate-500">{estimate.project_title || "Untitled estimate"}</div>
      </button>

      <div className="min-w-0 text-sm text-slate-600">
        <div>
          <span className="font-bold text-slate-800">Opportunity:</span>{" "}
          {estimate.linked_opportunity_id ? (
            <button type="button" onClick={() => onOpen("opportunity")} className="font-bold text-blue-700 hover:text-blue-900">
              #{estimate.linked_opportunity_id} {estimate.linked_opportunity_title || ""}
            </button>
          ) : (
            "Not linked"
          )}
        </div>
        <div className="mt-1">
          <span className="font-bold text-slate-800">Agreement:</span>{" "}
          {estimate.linked_agreement_id ? (
            <button type="button" onClick={onAgreement} className="font-bold text-blue-700 hover:text-blue-900">
              #{estimate.linked_agreement_id} {estimate.linked_agreement_title || ""}
            </button>
          ) : (
            "Not converted"
          )}
        </div>
      </div>

      <div>
        <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Readiness</div>
        <div className="mt-2 h-2 rounded-full bg-slate-100">
          <div className="h-2 rounded-full bg-blue-600" style={{ width: `${readiness}%` }} />
        </div>
        <div className="mt-1 text-sm font-black text-slate-900">{readiness}%</div>
      </div>

      <div>
        <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${toneForTab(tabKey)}`}>
          {statusLabel(estimate.status)}
        </div>
        <div className="mt-2 text-xs font-semibold text-slate-500">Updated {formatDateTime(estimate.updated_at)}</div>
      </div>

      <div className="flex items-center lg:justify-end">
        <button
          type="button"
          data-testid={`estimate-primary-action-${estimate.id}`}
          onClick={action}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-black text-white shadow-sm hover:bg-slate-800 lg:w-auto"
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
      subtitle="Review every estimate workspace between opportunity intake and agreement conversion without creating duplicate estimate records."
      variant="operational"
    >
      <ProjectAssistantPanel
        subtitle="Estimate Assistant"
        summary="Project Assistant reviews estimate readiness, missing scope, pricing completeness, incidentals, and agreement handoff blockers for the selected stage."
        testId="estimates-assistant-panel"
      >
        <ProjectAssistantSection title="Recommended next action">
          {activeTab === "ready"
            ? "Review estimate assumptions, then create the agreement from the existing workspace."
            : activeTab === "converted"
              ? "Open the linked agreement for operational work; keep the estimate as read-only sales history."
              : activeTab === "archived"
                ? "Restore only if this estimate should re-enter active sales follow-up."
                : "Open the estimate workspace and complete customer, address, scope, pricing, and scheduling details."}
        </ProjectAssistantSection>
        <ProjectAssistantApprovalNotice compact>
          Estimate Assistant can prepare review guidance, but contractors still approve pricing, scope, customer messages, and agreement creation.
        </ProjectAssistantApprovalNotice>
      </ProjectAssistantPanel>

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid="estimates-filters">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.4fr)_repeat(4,minmax(150px,1fr))]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search estimates"
              className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold text-slate-800 outline-none focus:border-blue-400"
            />
          </label>
          <select value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)} className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800">
            <option value="all">All customers</option>
            {customerOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select value={projectTypeFilter} onChange={(event) => setProjectTypeFilter(event.target.value)} className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800">
            <option value="all">All project types</option>
            {projectTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800">
            <option value="all">All statuses</option>
            {statusOptions.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
          </select>
          <input
            type="date"
            value={updatedSince}
            onChange={(event) => setUpdatedSince(event.target.value)}
            className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800"
            aria-label="Date updated since"
          />
        </div>
      </section>

      <div className="flex gap-2 overflow-x-auto pb-1" data-testid="estimates-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            data-testid={`estimates-tab-${tab.key}`}
            onClick={() => setActiveTab(tab.key)}
            className={`whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-black transition ${
              activeTab === tab.key
                ? "border-slate-950 bg-slate-950 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:text-blue-700"
            }`}
          >
            {tab.label} <span className="ml-1 opacity-70">{tabCounts[tab.key] || 0}</span>
          </button>
        ))}
      </div>

      <section className="space-y-3" data-testid="estimates-list">
        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm font-bold text-slate-600">Loading estimates...</div>
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
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <div className="text-base font-black text-slate-900">No estimates in this stage</div>
            <p className="mt-2 text-sm font-semibold text-slate-600">
              Estimates created from opportunities, dashboard starts, customers, and property work orders will appear here automatically.
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Project Assistant can help identify missing scope, pricing, or handoff details once an estimate exists.
            </p>
          </div>
        )}
      </section>
    </ContractorPageSurface>
  );
}
