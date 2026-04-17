import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ClipboardList, Copy, ExternalLink, X } from "lucide-react";
import toast from "react-hot-toast";

import api from "../api";

function fmtDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return String(value);
  }
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function SummaryCard({ label, value, tone = "slate", testId }) {
  const tones = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-900",
    slate: "border-slate-200 bg-white text-slate-900",
  };

  return (
    <div data-testid={testId} className={`rounded-xl border p-4 shadow-sm ${tones[tone] || tones.slate}`}>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function statusTone(status) {
  const normalized = normalize(status);
  if (normalized === "awarded") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (normalized === "under_review") return "border-amber-200 bg-amber-50 text-amber-800";
  if (normalized === "declined" || normalized === "expired") return "border-rose-200 bg-rose-50 text-rose-800";
  if (normalized === "draft" || normalized === "submitted") return "border-slate-200 bg-slate-50 text-slate-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function DetailField({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-semibold text-slate-900">{value || "-"}</div>
    </div>
  );
}

function SectionCard({ title, testId, children, subtitle = "", className = "" }) {
  return (
    <section
      data-testid={testId}
      className={`rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm ${className}`.trim()}
    >
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function workspaceStageFromRow(row) {
  const stage = normalize(row?.workspace_stage);
  if (stage) return stage;
  const statusGroup = normalize(row?.status_group);
  const sourceKind = normalize(row?.source_kind);
  if (statusGroup === "declined_expired") return "closed";
  if (sourceKind === "lead" && (statusGroup === "open" || normalize(row?.status) === "submitted")) return "new_lead";
  return "active_bid";
}

function workspaceStageLabel(stage) {
  if (stage === "new_lead") return "New Lead";
  if (stage === "closed") return "Closed / Archived";
  return "Active Bid";
}

function workspaceStageTone(stage) {
  if (stage === "new_lead") return "border-blue-200 bg-blue-50 text-blue-700";
  if (stage === "active_bid") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  return "border-slate-200 bg-slate-100 text-slate-600";
}

function signalTone(signal) {
  const normalized = normalize(signal);
  if (normalized === "guided intake" || normalized === "clarifications answered") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (normalized === "photos" || normalized === "multi-quote request") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (normalized === "budget provided" || normalized === "timeline provided" || normalized === "measurements noted") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  return "border-slate-200 bg-white text-slate-700";
}

function toTimestamp(value) {
  if (!value) return 0;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? stamp : 0;
}

function moneyToNumber(value) {
  const text = normalize(value).replace(/[^0-9.-]/g, "");
  if (!text) return 0;
  const amount = Number.parseFloat(text);
  return Number.isFinite(amount) ? amount : 0;
}

function prioritizeSignals(signals) {
  const items = Array.isArray(signals) ? signals : [];
  const priority = [
    "Guided Intake",
    "Clarifications Answered",
    "Photos",
    "Budget Provided",
    "Timeline Provided",
    "Measurements Noted",
    "Multi-Quote Request",
  ];
  return [...items].sort((left, right) => {
    const leftIndex = priority.indexOf(left);
    const rightIndex = priority.indexOf(right);
    const safeLeft = leftIndex === -1 ? priority.length + 1 : leftIndex;
    const safeRight = rightIndex === -1 ? priority.length + 1 : rightIndex;
    if (safeLeft !== safeRight) return safeLeft - safeRight;
    return normalize(left).localeCompare(normalize(right));
  });
}

function requestCompletenessScore(row) {
  const snapshot = row?.request_snapshot || {};
  const signals = new Set((Array.isArray(row?.request_signals) ? row.request_signals : []).map(normalize));
  let score = 0;
  if ((snapshot.photo_count || 0) > 0 || signals.has("photos")) score += 2;
  if (snapshot.budget || normalize(row?.bid_amount_label) !== "-" || signals.has("budget provided")) score += 2;
  if (snapshot.timeline || signals.has("timeline provided")) score += 1;
  if ((snapshot.clarification_count || 0) > 0 || signals.has("clarifications answered")) score += 2;
  if (snapshot.guided_intake_completed || signals.has("guided intake")) score += 1;
  if (normalize(snapshot.request_path_label) === "multi-quote request" || signals.has("multi-quote request")) score += 1;
  return score;
}

function requestAttentionRank(row) {
  const stage = workspaceStageFromRow(row);
  const statusGroup = normalize(row?.status_group);
  const status = normalize(row?.status);

  if (stage === "new_lead") {
    return Math.max(0, 6 - requestCompletenessScore(row));
  }

  if (statusGroup === "under_review" || status === "under_review" || status === "draft" || status === "open" || status === "submitted") {
    return 0;
  }
  if (statusGroup === "awarded" || status === "awarded") {
    return 1;
  }
  return 2;
}

function requestMatchesFilter(row, filter) {
  if (filter === "all") return true;
  const snapshot = row?.request_snapshot || {};
  const signals = new Set((Array.isArray(row?.request_signals) ? row.request_signals : []).map(normalize));
  const hasPhotos = (snapshot.photo_count || 0) > 0 || signals.has("photos");
  const hasBudget = Boolean(snapshot.budget || normalize(row?.bid_amount_label) !== "-" || signals.has("budget provided"));
  const hasTimeline = Boolean(snapshot.timeline || signals.has("timeline provided"));
  const hasClarifications = (snapshot.clarification_count || 0) > 0 || signals.has("clarifications answered");
  const isMultiQuote = normalize(snapshot.request_path_label) === "multi-quote request" || signals.has("multi-quote request");
  const needsAttention = workspaceStageFromRow(row) === "new_lead" ? requestCompletenessScore(row) < 4 : requestAttentionRank(row) === 0;

  if (filter === "has_photos") return hasPhotos;
  if (filter === "budget_provided") return hasBudget;
  if (filter === "timeline_provided") return hasTimeline;
  if (filter === "clarifications_included") return hasClarifications;
  if (filter === "multi_quote") return isMultiQuote;
  if (filter === "needs_attention") return needsAttention;
  return true;
}

function sortWorkspaceRows(rows, sortBy, stage) {
  const list = [...rows];
  list.sort((left, right) => {
    const leftSubmitted = toTimestamp(left?.submitted_at);
    const rightSubmitted = toTimestamp(right?.submitted_at);
    const leftValue = moneyToNumber(left?.bid_amount || left?.request_snapshot?.budget || left?.bid_amount_label);
    const rightValue = moneyToNumber(right?.bid_amount || right?.request_snapshot?.budget || right?.bid_amount_label);
    const leftCompleteness = requestCompletenessScore(left);
    const rightCompleteness = requestCompletenessScore(right);
    const leftAttention = requestAttentionRank(left);
    const rightAttention = requestAttentionRank(right);

    const compareNewest = rightSubmitted - leftSubmitted;
    const compareValue = rightValue - leftValue;
    const compareCompleteness = rightCompleteness - leftCompleteness;
    const compareAttention = leftAttention - rightAttention;

    if (sortBy === "newest") return compareNewest || compareCompleteness || compareValue;
    if (sortBy === "most_complete") return compareCompleteness || compareNewest || compareValue;
    if (sortBy === "highest_value") return compareValue || compareNewest || compareCompleteness;
    if (sortBy === "needs_attention") {
      if (stage === "new_lead") return compareCompleteness * -1 || compareNewest || compareValue;
      return compareAttention || compareNewest || compareValue;
    }
    if (stage === "new_lead") {
      return compareNewest || compareCompleteness || compareValue;
    }
    if (stage === "closed") {
      return compareNewest || compareValue || compareCompleteness;
    }
    return compareAttention || compareNewest || compareValue;
  });
  return list;
}

function buildBidPrepItems({ snapshot, signals, stage }) {
  const items = [];
  const signalSet = new Set((Array.isArray(signals) ? signals : []).map(normalize));
  const photoCount = Number(snapshot?.photo_count || 0);
  const measurementValue = normalize(snapshot?.measurement_handling);
  const clarificationCount = Number(snapshot?.clarification_count || 0);
  const hasBudget = Boolean(snapshot?.budget);
  const hasTimeline = Boolean(snapshot?.timeline);

  if (photoCount > 0 || signalSet.has("photos")) items.push("Review the photos before you price the work.");
  if (measurementValue === "site visit required") items.push("Verify measurements on site before final pricing.");
  else if (measurementValue === "provided") items.push("Check the provided measurements against the scope.");
  if (hasBudget) items.push("Use the budget guidance as a starting point.");
  if (hasTimeline) items.push("Confirm the requested timing and your availability.");
  if (clarificationCount > 0 || signalSet.has("clarifications answered")) items.push("Review the clarifications already captured.");
  if (normalize(snapshot?.request_path_label) === "multi-quote request" || signalSet.has("multi-quote request")) {
    items.push("This customer is comparing options, so keep your first response clear and useful.");
  }

  if (stage === "new_lead" && items.length === 0) {
    items.push("Confirm the scope, measurements, and timing before you respond.");
  }

  return items.slice(0, 4);
}

function buildResponseStarter({ snapshot, signals, stage }) {
  if (stage === "closed") return "";
  const signalSet = new Set((Array.isArray(signals) ? signals : []).map(normalize));
  const parts = ["Thanks for sharing the project details."];

  if ((snapshot?.photo_count || 0) > 0 || signalSet.has("photos")) {
    parts.push("I reviewed the photos and will confirm the scope before I price the work.");
  } else {
    parts.push("I’ll review the scope and follow up if anything needs clarification.");
  }

  if (normalize(snapshot?.measurement_handling) === "site visit required") {
    parts.push("I may want to verify measurements on site before final pricing.");
  } else if (normalize(snapshot?.measurement_handling) === "provided") {
    parts.push("I’ll check the provided measurements against the work requested.");
  }

  if (snapshot?.timeline || signalSet.has("timeline provided")) {
    parts.push("I’ll also confirm timing and availability.");
  }

  if (normalize(snapshot?.request_path_label) === "multi-quote request" || signalSet.has("multi-quote request")) {
    parts.push("It looks like the customer is comparing options, so I’ll keep the response clear and practical.");
  }

  return parts.join(" ");
}

function buildCreateBidContext({ snapshot, signals }) {
  const signalSet = new Set((Array.isArray(signals) ? signals : []).map(normalize));
  if ((snapshot?.photo_count || 0) > 0 || signalSet.has("photos")) return "Photos are available to review.";
  if (normalize(snapshot?.measurement_handling) === "site visit required") return "Measurements may still need verification.";
  if (snapshot?.budget || signalSet.has("budget provided")) return "Budget guidance is available.";
  if (snapshot?.timeline || signalSet.has("timeline provided")) return "Timing guidance is available.";
  if ((snapshot?.clarification_count || 0) > 0 || signalSet.has("clarifications answered")) return "Clarified details are available.";
  return "Review the request details and create your bid when you’re ready.";
}

export default function ContractorBidsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [selectedRow, setSelectedRow] = useState(null);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState("new_lead");
  const [sortBy, setSortBy] = useState("recommended");
  const [requestFilter, setRequestFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectClassFilter, setProjectClassFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [actionBusyId, setActionBusyId] = useState("");
  const [copiedRefId, setCopiedRefId] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        const { data } = await api.get("/projects/contractor/bids/");
        if (!active) return;
        setRows(Array.isArray(data?.results) ? data.results : []);
      } catch (err) {
        if (!active) return;
        console.error(err);
        toast.error(err?.response?.data?.detail || "Failed to load bids.");
        setRows([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const visibleRows = useMemo(() => {
    const q = normalize(search);
    const scopedRows = rows.filter((row) => {
      const workspaceStage = workspaceStageFromRow(row);
      if (activeWorkspaceTab !== "all" && workspaceStage !== activeWorkspaceTab) return false;
      if (!requestMatchesFilter(row, requestFilter)) return false;
      if (statusFilter !== "all" && normalize(row.status) !== statusFilter) return false;
      if (projectClassFilter !== "all" && normalize(row.project_class) !== projectClassFilter) return false;
      if (!q) return true;
      return [
        row.project_title,
        row.customer_name,
        row.customer_email,
        row.location,
        row.notes,
        row.timeline,
        row.source_reference,
        row.linked_agreement_reference,
        ...(Array.isArray(row.request_signals) ? row.request_signals : []),
      ]
        .map((value) => normalize(value))
        .join(" ")
        .includes(q);
    });
    return sortWorkspaceRows(scopedRows, sortBy, activeWorkspaceTab);
  }, [rows, search, statusFilter, projectClassFilter, activeWorkspaceTab, requestFilter, sortBy]);

  const summary = useMemo(() => {
    const counts = {
      new_leads: 0,
      active_bids: 0,
      closed: 0,
    };

    for (const row of rows) {
      const stage = workspaceStageFromRow(row);
      if (stage === "new_lead") counts.new_leads += 1;
      else if (stage === "closed") counts.closed += 1;
      else counts.active_bids += 1;
    }

    return counts;
  }, [rows]);

  const activeStageLabel = activeWorkspaceTab === "new_lead" ? "New Leads" : activeWorkspaceTab === "closed" ? "Closed / Archived" : "Active Bids";
  const activeStageNoun = activeWorkspaceTab === "new_lead" ? "lead" : activeWorkspaceTab === "closed" ? "opportunity" : "bid";
  const sortOptions = useMemo(() => {
    const isLeadView = activeWorkspaceTab === "new_lead";
    const isClosedView = activeWorkspaceTab === "closed";
    return [
      { key: "recommended", label: "Recommended" },
      { key: "newest", label: "Newest First" },
      { key: "most_complete", label: "Most Complete" },
      { key: "needs_attention", label: isLeadView ? "Needs Response" : "Needs Follow-up" },
      { key: "highest_value", label: isClosedView ? "Highest Value" : "Highest Value" },
    ];
  }, [activeWorkspaceTab]);
  const requestFilterOptions = useMemo(
    () => [
      { key: "all", label: "All" },
      { key: "has_photos", label: "Has Photos" },
      { key: "budget_provided", label: "Budget Provided" },
      { key: "timeline_provided", label: "Timeline Provided" },
      { key: "clarifications_included", label: "Clarifications Included" },
      { key: "multi_quote", label: "Multi-Quote" },
      { key: "needs_attention", label: activeWorkspaceTab === "new_lead" ? "Needs Response" : "Needs Attention" },
    ],
    [activeWorkspaceTab]
  );
  const workspaceTabs = useMemo(
    () => [
      { key: "new_lead", label: "New Leads", count: summary.new_leads, testId: "leads-tab-new" },
      { key: "active_bid", label: "Active Bids", count: summary.active_bids, testId: "leads-tab-active" },
      { key: "closed", label: "Closed / Archived", count: summary.closed, testId: "leads-tab-closed" },
    ],
    [summary.active_bids, summary.closed, summary.new_leads]
  );
  const activeSortLabel = sortOptions.find((option) => option.key === sortBy)?.label || "Recommended";
  const activeFilterLabel = requestFilterOptions.find((option) => option.key === requestFilter)?.label || "All";

  const outcomeNote =
    normalize(selectedRow?.status_label) === "not selected"
      ? selectedRow?.status_note || "Another contractor was selected for this project."
      : "";

  const selectedStage = workspaceStageFromRow(selectedRow);
  const selectedSnapshot = selectedRow?.request_snapshot || {};
  const selectedSignals = prioritizeSignals(selectedRow?.request_signals);
  const selectedPhotos = Array.isArray(selectedSnapshot?.photos) ? selectedSnapshot.photos : [];
  const selectedMilestones = Array.isArray(selectedSnapshot?.milestones) ? selectedSnapshot.milestones : [];
  const selectedClarifications = Array.isArray(selectedSnapshot?.clarification_summary) ? selectedSnapshot.clarification_summary : [];
  const selectedBidPrepItems = useMemo(
    () => buildBidPrepItems({ snapshot: selectedSnapshot, signals: selectedSignals, stage: selectedStage }),
    [selectedSnapshot, selectedSignals, selectedStage]
  );
  const selectedResponseStarter = useMemo(
    () => buildResponseStarter({ snapshot: selectedSnapshot, signals: selectedSignals, stage: selectedStage }),
    [selectedSnapshot, selectedSignals, selectedStage]
  );
  const selectedCreateBidContext = useMemo(
    () => buildCreateBidContext({ snapshot: selectedSnapshot, signals: selectedSignals }),
    [selectedSnapshot, selectedSignals]
  );
  const selectedPrimaryActionLabel =
    selectedStage === "new_lead"
      ? "Create Bid"
      : normalize(selectedRow?.next_action?.key) === "open_agreement" && selectedRow?.linked_agreement_url
        ? "Open Agreement"
        : selectedRow?.next_action?.label || "View Details";
  const selectedPrimaryActionHint =
    selectedStage === "new_lead"
      ? "This starts the existing bid workflow for the reviewed request."
      : selectedStage === "closed"
        ? "This opportunity is closed, but you can still review the history."
        : "Continue the current bid workflow from here.";
  const selectedCanOpenAgreement = normalize(selectedRow?.next_action?.key) === "open_agreement" && selectedRow?.linked_agreement_url;
  const rowPrimaryActionLabel = (row) => {
    const stage = workspaceStageFromRow(row);
    if (stage === "new_lead") return "Review Request";
    if (stage === "closed") return "View Details";
    if (normalize(row?.next_action?.key) === "open_agreement" && row?.linked_agreement_url) return "Open Agreement";
    return row?.next_action?.label || "View Details";
  };

  const closeDrawer = () => {
    setSelectedRow(null);
    setCopiedRefId("");
  };

  const copyReference = async (value, rowId) => {
    const text = String(value || "").trim();
    if (!text || !navigator?.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedRefId(rowId);
      window.setTimeout(() => {
        setCopiedRefId((current) => (current === rowId ? "" : current));
      }, 1200);
    } catch {
      setCopiedRefId("");
    }
  };

  const runAction = async (row) => {
    if (!row) return;
    if (normalize(row.next_action?.key) === "open_agreement" && row.linked_agreement_url) {
      navigate(row.linked_agreement_url);
      return;
    }

    if (normalize(row.status_group) === "declined_expired") {
      setSelectedRow(row);
      return;
    }

    const sourceKind = normalize(row.source_kind);
    const sourceId = row.source_id || row.bid_id;
    if (!sourceKind || !sourceId) return;

    setActionBusyId(String(row.bid_id));
    try {
      const endpoint =
        sourceKind === "lead"
          ? `/projects/contractor/public-leads/${sourceId}/create-agreement/`
          : `/projects/intakes/${sourceId}/convert-to-agreement/`;
      const { data } = await api.post(endpoint, {});
      const target =
        data?.wizard_url || data?.detail_url || (data?.agreement_id ? `/app/agreements/${data.agreement_id}` : "");
      if (target) {
        navigate(target);
        return;
      }
      toast.success("Agreement created.");
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Could not convert bid to agreement.");
    } finally {
      setActionBusyId("");
    }
  };

  const handleRowPrimaryAction = (row) => {
    if (!row) return;
    const stage = workspaceStageFromRow(row);
    if (stage === "new_lead") {
      setSelectedRow(row);
      return;
    }
    runAction(row);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6" data-testid="leads-and-bids-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <ClipboardList size={14} />
            Opportunity Center
          </div>
          <h1 data-testid="contractor-bids-title" className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">
            Leads &amp; Bids Workspace
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Review new leads first, then move into active bids and closed opportunities without leaving the same workspace.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/app/public-presence")}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Public Leads
        </button>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="New Leads" value={String(summary.new_leads)} tone="slate" testId="bids-summary-new-leads" />
        <SummaryCard
          label="Active Bids"
          value={String(summary.active_bids)}
          tone="indigo"
          testId="bids-summary-active-bids"
        />
        <SummaryCard label="Closed / Archived" value={String(summary.closed)} tone="amber" testId="bids-summary-closed" />
        <SummaryCard label="Total Opportunities" value={String(rows.length)} tone="emerald" testId="bids-summary-total" />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{activeStageLabel}</h2>
            <div className="mt-1 text-sm text-slate-500">
              {loading
                ? "Loading opportunity workspace..."
                : `${visibleRows.length} ${activeStageNoun}${visibleRows.length === 1 ? "" : "s"} · ${activeSortLabel} · ${activeFilterLabel}`}
            </div>
          </div>

          <div className="flex flex-wrap gap-2" data-testid="leads-and-bids-tabs">
            {workspaceTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                data-testid={tab.testId}
                onClick={() => setActiveWorkspaceTab(tab.key)}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                  activeWorkspaceTab === tab.key
                    ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span>{tab.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${activeWorkspaceTab === tab.key ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"}`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-medium text-slate-700">
              Sort by
              <select
                data-testid="workspace-sort-control"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {sortOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-medium text-slate-700">
              Project class
              <select
                data-testid="bids-filter-project-class"
                value={projectClassFilter}
                onChange={(event) => setProjectClassFilter(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="all">All</option>
                <option value="residential">Residential</option>
                <option value="commercial">Commercial</option>
              </select>
            </label>

            <label className="text-sm font-medium text-slate-700">
              Status
              <select
                data-testid="bids-filter-status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="all">All</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="under_review">Under Review</option>
                <option value="awarded">Awarded</option>
                <option value="declined">Declined</option>
                <option value="expired">Not Selected</option>
              </select>
            </label>
          </div>

          <label className="text-sm font-medium text-slate-700">
            Search
            <input
              data-testid="bids-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Project, customer, or signal"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2" data-testid="workspace-filter-chips">
          {requestFilterOptions.map((option) => {
            const active = requestFilter === option.key;
            return (
              <button
                key={option.key}
                type="button"
                data-testid={`workspace-filter-${option.key}`}
                onClick={() => setRequestFilter(option.key)}
                className={`inline-flex items-center rounded-full border px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="mt-3 text-xs text-slate-500">
          {activeWorkspaceTab === "new_lead"
            ? "New leads are requests you can review before you start the bid workflow."
            : activeWorkspaceTab === "active_bid"
              ? "Active bids include opportunities you are already shaping or have already responded to."
              : "Closed opportunities stay available for reference and follow-up."}
        </div>

        {loading ? (
          <div className="mt-5 text-sm text-slate-500">Loading opportunity workspace...</div>
        ) : visibleRows.length === 0 ? (
          <div
            data-testid="bids-empty"
            className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600"
          >
            No opportunities match your current filters.
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Project</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Signals</th>
                  <th className="px-3 py-2">Project Class</th>
                  <th className="px-3 py-2">Bid Amount</th>
                  <th className="px-3 py-2">Submitted Date</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr
                    key={`${row.source_kind}-${row.bid_id}`}
                    data-testid={`lead-row-${row.bid_id}`}
                    className={`cursor-pointer border-b border-slate-100 align-top hover:bg-slate-50 ${
                      workspaceStageFromRow(row) === "new_lead" ? "bg-blue-50/30" : ""
                    }`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedRow(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedRow(row);
                      }
                    }}
                  >
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-900">{row.project_title}</div>
                      <div className="mt-1 text-xs text-slate-500">{row.source_reference}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${workspaceStageTone(
                            workspaceStageFromRow(row)
                          )}`}
                        >
                          {workspaceStageLabel(workspaceStageFromRow(row))}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-900">{row.customer_name}</div>
                      <div className="mt-1 text-xs text-slate-500">{row.customer_email || row.customer_phone || "-"}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-sm font-semibold text-slate-900">{row.location || "-"}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        {Array.isArray(row.request_signals) && row.request_signals.length ? (
                          prioritizeSignals(row.request_signals).slice(0, 4).map((signal) => (
                            <span
                              key={`${row.bid_id}-${signal}`}
                              className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${signalTone(signal)}`}
                            >
                              {signal}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-500">No signals yet</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800">
                        {row.project_class_label || "Residential"}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-semibold text-slate-900">{row.bid_amount_label || "-"}</td>
                    <td className="px-3 py-3 text-slate-700">{fmtDate(row.submitted_at)}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(row.status)}`}>
                        {row.status_label}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        data-testid={`lead-row-action-${row.bid_id}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleRowPrimaryAction(row);
                        }}
                        disabled={actionBusyId === String(row.bid_id)}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {actionBusyId === String(row.bid_id)
                          ? "Working..."
                          : rowPrimaryActionLabel(row)}
                        <ArrowRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedRow ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close bid details"
            className="absolute inset-0 bg-black/40"
            onClick={closeDrawer}
          />
          <aside
            data-testid="bids-detail-drawer"
            className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-slate-200 p-5">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Bid Detail</div>
                <h3 className="mt-2 text-2xl font-extrabold text-slate-900">{selectedRow.project_title}</h3>
                <div className="mt-2 text-sm text-slate-600">{selectedRow.customer_name}</div>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600 hover:bg-slate-50"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5" data-testid="lead-detail-container">
              <SectionCard
                title="Lead Overview"
                testId="lead-overview"
                subtitle="A fast read on what this opportunity is and where it came from."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailField label="Project Title" value={selectedRow.project_title} />
                  <DetailField label="Project Type" value={selectedRow.project_type || selectedRow.project_class_label || "-"} />
                  <DetailField label="Area / Subtype" value={selectedRow.project_subtype || "-"} />
                  <DetailField label="Location" value={selectedRow.location || "-"} />
                  <DetailField label="Request Path" value={selectedRow.request_path_label || "Project request"} />
                  <DetailField label="Status" value={selectedRow.status_label} />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <DetailField label="Customer" value={selectedRow.customer_name || "-"} />
                  <DetailField label="Email" value={selectedRow.customer_email || "-"} />
                  <DetailField label="Phone" value={selectedRow.customer_phone || "-"} />
                </div>
                <div className="mt-4 text-xs text-slate-500">
                  Source: {selectedRow.source_kind_label || "Lead"} · Submitted: {fmtDate(selectedRow.submitted_at)} · Agreement: {selectedRow.linked_agreement_reference || "-"}
                </div>
                {outcomeNote ? (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    {outcomeNote}
                  </div>
                ) : null}
              </SectionCard>

              <SectionCard
                title="Project Snapshot"
                testId="project-snapshot"
                subtitle="Useful project details pulled from the request and the structured intake."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailField label="Refined Description" value={selectedSnapshot.refined_description || selectedRow.notes || "-"} />
                  <DetailField label="Measurements" value={selectedSnapshot.measurement_handling || selectedRow.measurement_handling || "-"} />
                  <DetailField label="Timing" value={selectedSnapshot.timeline || selectedRow.timeline || "-"} />
                  <DetailField label="Budget" value={selectedSnapshot.budget || selectedRow.bid_amount_label || "-"} />
                </div>
                {selectedClarifications.length ? (
                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Clarification Answers</div>
                    <div className="mt-3 space-y-2">
                      {selectedClarifications.slice(0, 4).map((item) => (
                        <div key={item.key || item.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                          <span className="font-semibold text-slate-900">{item.label}:</span> {item.value}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </SectionCard>

              <SectionCard
                title="Photos and Reference Images"
                testId="photos-section"
                subtitle="Visual context helps the contractor understand scope faster."
              >
                {selectedPhotos.length ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {selectedPhotos.map((photo) => (
                      <div key={photo.id || photo.image_url || photo.original_name} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                        {photo.image_url ? (
                          <img src={photo.image_url} alt={photo.caption || photo.original_name || "Clarification upload"} className="h-40 w-full object-cover" />
                        ) : (
                          <div className="flex h-40 items-center justify-center bg-slate-100 text-sm text-slate-500">
                            Preview unavailable
                          </div>
                        )}
                        <div className="p-3">
                          <div className="text-sm font-semibold text-slate-900">{photo.original_name || "Uploaded photo"}</div>
                          {photo.caption ? <div className="mt-1 text-xs text-slate-500">{photo.caption}</div> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-600">
                    {selectedSnapshot.photo_count ? `${selectedSnapshot.photo_count} photo${selectedSnapshot.photo_count === 1 ? "" : "s"} attached.` : "No photos attached yet."}
                  </div>
                )}
              </SectionCard>

              <SectionCard
                title="Project Phases"
                testId="project-phases-section"
                subtitle="Readable plan phases from the current request."
              >
                {selectedMilestones.length ? (
                  <div className="space-y-3">
                    {selectedMilestones.map((item, index) => (
                      <div key={item || index} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Phase {index + 1}</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{item}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-600">
                    No project phases were added yet.
                  </div>
                )}
              </SectionCard>

              {selectedStage !== "closed" && selectedBidPrepItems.length ? (
                <SectionCard
                  title="Before You Respond"
                  testId="response-prep-section"
                  subtitle="A short checklist to help you prepare a useful bid."
                >
                  <ul className="space-y-2 text-sm text-slate-700">
                    {selectedBidPrepItems.map((item) => (
                      <li key={item} className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                        <span className="mt-1 h-2 w-2 rounded-full bg-slate-400" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </SectionCard>
              ) : null}

              {selectedStage !== "closed" && selectedResponseStarter ? (
                <SectionCard
                  title="Suggested First Response"
                  testId="response-starter-section"
                  subtitle="This is a helper, not a sent message."
                >
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                    {selectedResponseStarter}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => copyReference(selectedResponseStarter, `${selectedRow.bid_id}-starter`)}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Copy size={14} />
                      Copy Starter
                    </button>
                  </div>
                </SectionCard>
              ) : null}

              <SectionCard
                title="Request Signals"
                testId="request-signals-section"
                subtitle="Quick human-readable cues that help you judge the request at a glance."
              >
                <div className="flex flex-wrap gap-2">
                  {selectedSignals.length ? (
                    selectedSignals.map((signal) => (
                      <span
                        key={`${selectedRow.bid_id}-${signal}`}
                        className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${signalTone(signal)}`}
                      >
                        {signal}
                      </span>
                    ))
                  ) : (
                    <div className="text-sm text-slate-600">No request signals are available yet.</div>
                  )}
                </div>
              </SectionCard>

              <SectionCard
                title="Suggested Next Step"
                testId="suggested-next-step-section"
                subtitle="Keep the decision simple and move the opportunity forward from here."
              >
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                  {selectedStage === "new_lead"
                    ? "This request is ready for a bid decision. Review the details, then create your bid when you're ready."
                    : selectedStage === "closed"
                      ? "This opportunity is closed for now, but the record stays here for reference."
                      : selectedRow.next_action?.label || "Continue the existing bid workflow."}
                </div>
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4" data-testid="lead-action-section">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Lead Actions</div>
                  {selectedStage === "new_lead" ? (
                    <div
                      className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
                      data-testid="create-bid-context-note"
                    >
                      {selectedCreateBidContext}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-3">
                    {selectedStage === "closed" && !selectedCanOpenAgreement ? null : selectedCanOpenAgreement ? (
                      <button
                        type="button"
                        onClick={() => navigate(selectedRow.linked_agreement_url)}
                        data-testid="lead-detail-primary-action"
                        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
                      >
                        {selectedPrimaryActionLabel}
                        <ExternalLink size={14} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => runAction(selectedRow)}
                        disabled={actionBusyId === String(selectedRow.bid_id)}
                        data-testid={selectedStage === "new_lead" ? "create-bid-action" : "lead-detail-primary-action"}
                        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
                      >
                        {actionBusyId === String(selectedRow.bid_id) ? "Working..." : selectedPrimaryActionLabel}
                        <ExternalLink size={14} />
                      </button>
                    )}
                    {selectedRow?.source_reference ? (
                      <button
                        type="button"
                        onClick={() => copyReference(selectedRow.source_reference, selectedRow.bid_id)}
                        data-testid="lead-detail-secondary-action"
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Copy size={14} />
                        {copiedRefId === String(selectedRow.bid_id) ? "Copied" : "Copy Reference"}
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-3 text-xs text-slate-500">{selectedPrimaryActionHint}</div>
                </div>
              </SectionCard>

              <SectionCard title="Internal Notes" testId="lead-notes-section">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                  {selectedRow.notes || "No bid notes were provided."}
                </div>
                <textarea
                  value={selectedRow.internal_notes || ""}
                  onChange={(e) => setSelectedRow((prev) => ({ ...prev, internal_notes: e.target.value }))}
                  rows={4}
                  className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Internal notes"
                />
              </SectionCard>

              <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Reference</div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="text-sm font-semibold text-slate-900">{selectedRow.source_reference}</div>
                  <button
                    type="button"
                    onClick={() => copyReference(selectedRow.source_reference, selectedRow.bid_id)}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Copy size={14} />
                    {copiedRefId === String(selectedRow.bid_id) ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
