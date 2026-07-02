import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, ClipboardList, Copy, ExternalLink, X } from "lucide-react";
import toast from "react-hot-toast";

import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import { buildLeadAgreementAssistantState } from "../lib/leadProposalDraft";
import ConvertToAgreementPanel from "../components/ConvertToAgreementPanel.jsx";
import {
  buildProjectIntelligenceGuidance,
  buildProjectSetupRecommendation,
  normalizeProjectSetupRecommendation,
} from "../lib/projectIntelligence";

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

function isConvertToAgreementRow(row) {
  if (!row) return false;
  const sourceKind = normalize(row.source_kind);
  if (sourceKind === "quote_request") return true;
  const requestPath = normalize(row?.request_snapshot?.request_path_label);
  if (requestPath === "request a quote") return true;
  return false;
}

function statusTone(status) {
  const normalized = normalize(status);
  if (normalized === "awarded") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (normalized === "under_review") return "border-amber-200 bg-amber-50 text-amber-800";
  if (normalized === "follow_up") return "border-amber-200 bg-amber-50 text-amber-800";
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
  const sourceKind = normalize(row?.source_kind);
  if (sourceKind === "property_work_order" && !["follow_up", "active_bid", "closed"].includes(stage)) return "work_order";
  if (stage) return stage;
  const statusGroup = normalize(row?.status_group);
  if (statusGroup === "declined_expired") return "closed";
  if (sourceKind === "lead" && (statusGroup === "open" || normalize(row?.status) === "submitted")) return "new_lead";
  return "active_bid";
}

function workspaceStageLabel(stage) {
  if (stage === "new_lead") return "New Lead";
  if (stage === "follow_up") return "Follow-Up";
  if (stage === "closed") return "Closed / Archived";
  if (stage === "work_order") return "Work Order";
  return "Active Opportunity";
}

function workspaceStageTone(stage) {
  if (stage === "new_lead") return "border-blue-200 bg-blue-50 text-blue-700";
  if (stage === "follow_up") return "border-amber-200 bg-amber-50 text-amber-700";
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

function firstPresent(...values) {
  return values.find((value) => {
    const text = String(value || "").trim();
    return text && text !== "-";
  }) || "";
}

function opportunityValueDisplay(row) {
  const snapshot = row?.request_snapshot || {};
  const customerBudget = firstPresent(snapshot.budget, row?.budget_text, row?.customer_budget_label, row?.customer_budget);
  if (customerBudget) return { label: "Budget", value: customerBudget, tone: "text-emerald-100" };

  const estimate = firstPresent(
    row?.ai_estimate_label,
    row?.estimated_amount_label,
    row?.estimated_budget_label,
    row?.estimate_amount_label,
    row?.estimated_value_label,
    snapshot.ai_estimate_label,
    snapshot.estimated_amount_label
  );
  if (estimate) return { label: "Estimated", value: estimate, tone: "text-sky-100" };

  return { label: "Budget", value: "Budget not provided", tone: "text-blue-100/70" };
}

function sourceKeyForRow(row) {
  const sourceKind = normalize(row?.source_kind);
  if (sourceKind === "property_work_order") return "work_orders";

  const raw = normalize(row?.lead_source_filter || row?.lead_source || row?.source_kind_label || row?.source_kind);
  if (raw === "website_leads") return "website_leads";
  if (["website", "quote_request", "website_quote", "website_contact", "request_quote"].includes(raw)) return "website";
  if (["landing", "landing_page", "public_intake"].includes(raw)) return "landing";
  if (["qr", "qr_code"].includes(raw)) return "qr";
  if (["portal", "customer_portal", "customer_request"].includes(raw)) return "portal";
  if (["marketplace", "marketplace_request", "marketplace_opportunity"].includes(raw)) return "marketplace";
  if (["manual", "direct", "contractor_sent_form", "intake", "lead"].includes(raw)) return "manual";
  return raw || "manual";
}

function rowMatchesSourceFilter(row, filter) {
  if (filter === "all") return true;
  if (filter === "website_leads") return Boolean(row?.is_website_lead);
  return sourceKeyForRow(row) === filter;
}

function receivedLabel(value) {
  if (!value) return "Received date unknown";
  const timestamp = toTimestamp(value);
  if (!timestamp) return fmtDate(value);
  const diffDays = Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
  if (diffDays === 0) return "Received today";
  if (diffDays === 1) return "Received yesterday";
  if (diffDays < 30) return `Received ${diffDays} days ago`;
  return `Received ${fmtDate(value)}`;
}

function nextBestActionLine(row) {
  const stage = workspaceStageFromRow(row);
  const sourceKind = normalize(row?.source_kind);
  const nextKey = normalize(row?.next_action?.key);
  if (sourceKind === "property_work_order") {
    if (nextKey === "accept_property_work_order") return "Decide whether to accept this routed work order.";
    if (nextKey === "prepare_agreement_draft") return "Accepted work order is ready to become an agreement draft.";
    if (nextKey === "open_agreement") return "Continue the agreement already created for this work order.";
    return "Review the work order details and decide the next step.";
  }
  if (isConvertToAgreementRow(row)) return "Review the customer request and convert it into an agreement.";
  if (stage === "new_lead") return "Review the lead, then create an estimate or save it for follow-up.";
  if (stage === "follow_up") return "Follow up with the customer or resume the estimate workflow.";
  if (stage === "closed") return row?.status_note || "Review the history for this closed opportunity.";
  if (nextKey === "open_agreement" && row?.linked_agreement_url) return "Agreement is ready to manage from the workspace.";
  return "Review the opportunity and choose the next sales step.";
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

  if (stage === "follow_up") {
    return 0;
  }
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

function buildBidPrepItems({ snapshot, signals, stage, projectIntelligence }) {
  const items = [];
  const signalSet = new Set((Array.isArray(signals) ? signals : []).map(normalize));
  const photoCount = Number(snapshot?.photo_count || 0);
  const measurementValue = normalize(snapshot?.measurement_handling);
  const clarificationCount = Number(snapshot?.clarification_count || 0);
  const hasBudget = Boolean(snapshot?.budget);
  const hasTimeline = Boolean(snapshot?.timeline);

  if (projectIntelligence?.prepItems?.length) {
    for (const item of projectIntelligence.prepItems) {
      if (item && !items.includes(item)) items.push(item);
    }
  }
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

  return Array.from(new Set(items)).slice(0, 4);
}

function buildResponseStarter({ snapshot, signals, stage, projectIntelligence }) {
  if (stage === "closed") return "";
  const signalSet = new Set((Array.isArray(signals) ? signals : []).map(normalize));
  const parts = [projectIntelligence?.responseStarter || "Thanks for sharing the project details."];

  if ((snapshot?.photo_count || 0) > 0 || signalSet.has("photos")) {
    parts.push("I reviewed the photos and will confirm the scope before I price the work.");
  } else {
    parts.push("I'll review the scope and follow up if anything needs clarification.");
  }

  if (normalize(snapshot?.measurement_handling) === "site visit required") {
    parts.push("I may want to verify measurements on site before final pricing.");
  } else if (normalize(snapshot?.measurement_handling) === "provided") {
    parts.push("I'll check the provided measurements against the work requested.");
  }

  if (snapshot?.timeline || signalSet.has("timeline provided")) {
    parts.push("I'll also confirm timing and availability.");
  }

  if (normalize(snapshot?.request_path_label) === "multi-quote request" || signalSet.has("multi-quote request")) {
    parts.push("It looks like the customer is comparing options, so I'll keep the response clear and practical.");
  }

  return parts.join(" ");
}

function buildCreateBidContext({ snapshot, signals, projectIntelligence }) {
  const signalSet = new Set((Array.isArray(signals) ? signals : []).map(normalize));
  const parts = [];
  if (projectIntelligence?.createBidContext) {
    parts.push(projectIntelligence.createBidContext);
  }
  if ((snapshot?.photo_count || 0) > 0 || signalSet.has("photos")) parts.push("Photos are available to review.");
  if (normalize(snapshot?.measurement_handling) === "site visit required") parts.push("Measurements may still need verification.");
  if (snapshot?.budget || signalSet.has("budget provided")) parts.push("Budget guidance is available.");
  if (snapshot?.timeline || signalSet.has("timeline provided")) parts.push("Timing guidance is available.");
  if ((snapshot?.clarification_count || 0) > 0 || signalSet.has("clarifications answered")) parts.push("Clarified details are available.");
  if (parts.length) return parts.join(" ");
  return "Review the request details and create your bid when you're ready.";
}

function buildResponseTemplates({ snapshot, signals }) {
  const signalSet = new Set((Array.isArray(signals) ? signals : []).map(normalize));
  const templates = [];
  const timeline = (snapshot?.timeline || "").trim();
  const budget = (snapshot?.budget || "").trim();

  templates.push({
    key: "general",
    label: "General Response",
    text: "Thanks for sharing your project details. I've reviewed your request and would be happy to take a closer look and provide an estimate.",
  });

  if ((snapshot?.photo_count || 0) > 0 || signalSet.has("photos")) {
    templates.push({
      key: "photos",
      label: "With Photos",
      text: "I reviewed the photos you provided and have a good understanding of the project. I can help confirm details and next steps.",
    });
  }

  if (timeline || signalSet.has("timeline provided")) {
    templates.push({
      key: "timeline",
      label: "With Timeline",
      text: `I see you're looking to complete this within ${timeline || "your requested timeline"}. I can check availability and outline next steps.`,
    });
  }

  if (budget || signalSet.has("budget provided")) {
    templates.push({
      key: "budget",
      label: "With Budget",
      text: "Based on your budget guidance, I can help suggest options that fit your goals.",
    });
  }

  if (normalize(snapshot?.measurement_handling) === "site visit required") {
    templates.push({
      key: "measurements",
      label: "With Measurements",
      text: "I may want to verify measurements on site before final pricing so I can make sure the scope is accurate.",
    });
  }

  return templates.slice(0, 4);
}

export default function ContractorBidsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const mountedRef = useRef(true);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [selectedRow, setSelectedRow] = useState(null);
  const [convertPanelOpen, setConvertPanelOpen] = useState(false);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState("new_lead");
  const [sortBy, setSortBy] = useState("recommended");
  const [requestFilter, setRequestFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectClassFilter, setProjectClassFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [actionBusyId, setActionBusyId] = useState("");
  const [copiedRefId, setCopiedRefId] = useState("");
  const [contractorBrandVoice, setContractorBrandVoice] = useState({});
  const [serverSummary, setServerSummary] = useState({});

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadWorkspace = async ({ keepSelectedBidId = "" } = {}) => {
    try {
      setLoading(true);
      const [{ data }, meResponse] = await Promise.all([
        api.get("/projects/contractor/bids/"),
        api.get("/projects/contractors/me/").catch(() => ({ data: {} })),
      ]);
      if (!mountedRef.current) return;
      const nextRows = Array.isArray(data?.results) ? data.results : [];
      setRows(nextRows);
      setServerSummary(data?.summary || {});
      setContractorBrandVoice(meResponse?.data?.public_profile || {});
      if (keepSelectedBidId) {
        const nextSelected = nextRows.find((row) => String(row.bid_id) === String(keepSelectedBidId));
        setSelectedRow(nextSelected || null);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      console.error(err);
      toast.error(err?.response?.data?.detail || "Failed to load opportunities.");
      setRows([]);
      setServerSummary({});
      setContractorBrandVoice({});
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspace();
  }, []);

  useEffect(() => {
    const source = new URLSearchParams(location.search).get("source");
    const normalizedSource = normalize(source);
    if (normalizedSource === "property_work_order") {
      setActiveWorkspaceTab("work_order");
      setSourceFilter("all");
    } else if (["website", "website_leads", "landing", "landing_page", "public_profile", "qr", "portal", "customer_portal", "marketplace", "manual"].includes(normalizedSource)) {
      setActiveWorkspaceTab("new_lead");
      setSourceFilter(
        normalizedSource === "landing_page"
          ? "landing"
          : normalizedSource === "public_profile"
            ? "website_leads"
            : normalizedSource === "customer_portal"
              ? "portal"
              : normalizedSource
      );
    } else {
      setSourceFilter("all");
    }
  }, [location.search]);

  const visibleRows = useMemo(() => {
    const q = normalize(search);
    const scopedRows = rows.filter((row) => {
      const workspaceStage = workspaceStageFromRow(row);
      if (activeWorkspaceTab === "work_order") {
        if (normalize(row.source_kind) !== "property_work_order") return false;
      } else if (activeWorkspaceTab !== "all" && workspaceStage !== activeWorkspaceTab) {
        return false;
      }
      if (!requestMatchesFilter(row, requestFilter)) return false;
      if (!rowMatchesSourceFilter(row, sourceFilter)) return false;
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
  }, [rows, search, statusFilter, projectClassFilter, activeWorkspaceTab, requestFilter, sourceFilter, sortBy]);

  const summary = useMemo(() => {
    const counts = {
      new_leads: 0,
      follow_up_leads: 0,
      active_bids: 0,
      closed: 0,
      work_orders: 0,
      website_leads: 0,
      new_website_leads: 0,
      website_leads_needing_follow_up: 0,
    };

    for (const row of rows) {
      const stage = workspaceStageFromRow(row);
      if (normalize(row.source_kind) === "property_work_order") counts.work_orders += 1;
      if (row.is_website_lead) {
        counts.website_leads += 1;
        if (stage === "new_lead") counts.new_website_leads += 1;
        if (stage === "new_lead" || stage === "follow_up") counts.website_leads_needing_follow_up += 1;
      }
      if (stage === "new_lead") counts.new_leads += 1;
      else if (stage === "follow_up") counts.follow_up_leads += 1;
      else if (stage === "closed") counts.closed += 1;
      else counts.active_bids += 1;
    }

    return counts;
  }, [rows]);
  const activeStageLabel =
    activeWorkspaceTab === "all"
      ? "All Opportunities"
      : activeWorkspaceTab === "new_lead"
      ? "New Leads"
      : activeWorkspaceTab === "follow_up"
        ? "Follow-Up"
        : activeWorkspaceTab === "closed"
          ? "Closed / Archived"
          : activeWorkspaceTab === "work_order"
            ? "Work Orders"
            : "Active Opportunities";
  const activeStageNoun =
    activeWorkspaceTab === "all"
      ? "opportunity"
      : activeWorkspaceTab === "new_lead"
      ? "lead"
      : activeWorkspaceTab === "follow_up"
        ? "follow-up lead"
        : activeWorkspaceTab === "closed"
          ? "opportunity"
          : activeWorkspaceTab === "work_order"
            ? "work order"
            : "opportunity";
  const sortOptions = useMemo(() => {
    const isLeadView = activeWorkspaceTab === "new_lead";
    const isFollowUpView = activeWorkspaceTab === "follow_up";
    const isClosedView = activeWorkspaceTab === "closed";
    return [
      { key: "recommended", label: "Recommended" },
      { key: "newest", label: "Newest First" },
      { key: "most_complete", label: "Most Complete" },
      { key: "needs_attention", label: isLeadView ? "Needs Response" : isFollowUpView ? "Needs Follow-Up" : "Needs Follow-up" },
      { key: "highest_value", label: isClosedView ? "Highest Value" : "Highest Value" },
    ];
  }, [activeWorkspaceTab]);
  const workspaceTabs = useMemo(
    () => [
      { key: "all", label: "All", count: rows.length, testId: "leads-tab-all" },
      { key: "new_lead", label: "New Leads", count: summary.new_leads, testId: "leads-tab-new" },
      { key: "follow_up", label: "Follow-Up", count: summary.follow_up_leads, testId: "leads-tab-follow-up" },
      { key: "active_bid", label: "Active Opportunities", count: summary.active_bids, testId: "leads-tab-active" },
      { key: "work_order", label: "Work Orders", count: summary.work_orders, testId: "leads-tab-work-orders" },
      { key: "closed", label: "Closed / Archived", count: summary.closed, testId: "leads-tab-closed" },
    ],
    [rows.length, summary.active_bids, summary.closed, summary.follow_up_leads, summary.new_leads, summary.work_orders]
  );
  const activeSortLabel = sortOptions.find((option) => option.key === sortBy)?.label || "Recommended";
  const hasActiveFilters = sourceFilter !== "all" || requestFilter !== "all" || statusFilter !== "all" || projectClassFilter !== "all" || search.trim();
  const resetFilters = () => {
    setSourceFilter("all");
    setRequestFilter("all");
    setStatusFilter("all");
    setProjectClassFilter("all");
    setSearch("");
  };

  const outcomeNote =
    normalize(selectedRow?.status_label) === "not selected"
      ? selectedRow?.status_note || "Another contractor was selected for this project."
      : "";

  const selectedStage = workspaceStageFromRow(selectedRow);
  const selectedSnapshot = selectedRow?.request_snapshot || {};
  const selectedProjectIntelligence = useMemo(
    () =>
      buildProjectIntelligenceGuidance({
        projectTitle: selectedSnapshot.project_title || selectedRow?.project_title || "",
        projectType: selectedSnapshot.project_type || selectedRow?.project_type || "",
        projectSubtype: selectedSnapshot.project_subtype || selectedRow?.project_subtype || "",
        description:
          selectedSnapshot.project_scope_summary ||
          selectedSnapshot.refined_description ||
          selectedRow?.notes ||
          selectedRow?.project_description ||
          "",
      }),
    [selectedRow?.notes, selectedRow?.project_description, selectedRow?.project_subtype, selectedRow?.project_title, selectedRow?.project_type, selectedSnapshot]
  );
  const selectedProjectSetup = useMemo(
    () => {
      const baseRecommendation = buildProjectSetupRecommendation({
        projectTitle: selectedSnapshot.project_title || selectedRow?.project_title || "",
        projectType: selectedSnapshot.project_type || selectedRow?.project_type || "",
        projectSubtype: selectedSnapshot.project_subtype || selectedRow?.project_subtype || "",
        description:
          selectedSnapshot.project_scope_summary ||
          selectedSnapshot.refined_description ||
          selectedRow?.notes ||
          selectedRow?.project_description ||
          "",
      });
      const backendRecommendation = normalizeProjectSetupRecommendation(
        selectedSnapshot?.recommended_setup || selectedRow?.ai_analysis?.recommended_setup || {}
      );
      return {
        ...baseRecommendation,
        ...backendRecommendation,
        strongTemplateMatch:
          backendRecommendation.strongTemplateMatch || baseRecommendation.strongTemplateMatch,
      };
    },
    [
      selectedRow?.ai_analysis?.recommended_setup,
      selectedRow?.project_description,
      selectedRow?.project_subtype,
      selectedRow?.project_title,
      selectedRow?.project_type,
      selectedSnapshot,
    ]
  );
  const selectedSignals = prioritizeSignals(selectedRow?.request_signals);
  const selectedPhotos = Array.isArray(selectedSnapshot?.photos) ? selectedSnapshot.photos : [];
  const selectedMilestones = Array.isArray(selectedSnapshot?.milestones) ? selectedSnapshot.milestones : [];
  const selectedClarifications = Array.isArray(selectedSnapshot?.clarification_summary) ? selectedSnapshot.clarification_summary : [];
  const selectedBidPrepItems = useMemo(
    () =>
      buildBidPrepItems({
        snapshot: selectedSnapshot,
        signals: selectedSignals,
        stage: selectedStage,
        projectIntelligence: selectedProjectIntelligence,
      }),
    [selectedProjectIntelligence, selectedSnapshot, selectedSignals, selectedStage]
  );
  const selectedResponseStarter = useMemo(
    () =>
      buildResponseStarter({
        snapshot: selectedSnapshot,
        signals: selectedSignals,
        stage: selectedStage,
        projectIntelligence: selectedProjectIntelligence,
      }),
    [selectedProjectIntelligence, selectedSnapshot, selectedSignals, selectedStage]
  );
  const selectedResponseTemplates = useMemo(
    () => buildResponseTemplates({ snapshot: selectedSnapshot, signals: selectedSignals }),
    [selectedSnapshot, selectedSignals]
  );
  const selectedCreateBidContext = useMemo(
    () =>
      buildCreateBidContext({
        snapshot: selectedSnapshot,
        signals: selectedSignals,
        projectIntelligence: selectedProjectIntelligence,
      }),
    [selectedProjectIntelligence, selectedSnapshot, selectedSignals]
  );
  const selectedProjectTypeCue = selectedSnapshot.project_family_label || selectedProjectIntelligence?.familyCueLabel || "";
  const selectedCanConvertToAgreement = isConvertToAgreementRow(selectedRow);
  const selectedIsPropertyWorkOrder = normalize(selectedRow?.source_kind) === "property_work_order";
  const selectedNextActionKey = normalize(selectedRow?.next_action?.key);
  const selectedPrimaryActionLabel =
    selectedIsPropertyWorkOrder
      ? selectedNextActionKey === "accept_property_work_order"
        ? "Accept Work Order"
        : selectedNextActionKey === "prepare_agreement_draft"
          ? "Convert to Agreement"
          : selectedNextActionKey === "open_agreement"
            ? "Open Agreement"
            : selectedRow?.next_action?.label || "View Details"
      : selectedCanConvertToAgreement
      ? "Convert to Agreement"
      : selectedStage === "new_lead" || selectedStage === "follow_up"
      ? "Create Estimate"
      : selectedNextActionKey === "open_agreement" && selectedRow?.linked_agreement_url
        ? "Open Agreement"
        : selectedRow?.next_action?.label || "View Details";
  const selectedPrimaryActionHint =
    selectedIsPropertyWorkOrder
      ? selectedNextActionKey === "accept_property_work_order"
        ? "Accept this routed work order to let the property manager know you can take it."
        : selectedNextActionKey === "prepare_agreement_draft"
          ? "Prepare a draft agreement from the accepted work order, then continue in the existing agreement wizard."
          : selectedNextActionKey === "open_agreement"
            ? "Open the draft agreement to continue the existing MyHomeBro agreement workflow."
            : "Review the property management work order details."
      : selectedCanConvertToAgreement
      ? "Review the request and adjust the draft before sending the agreement."
      : selectedStage === "new_lead"
      ? "This starts the existing bid workflow for the reviewed request."
      : selectedStage === "follow_up"
        ? "This lead is saved for later. Create your bid when you're ready."
        : selectedStage === "closed"
          ? "This opportunity is closed, but you can still review the history."
          : "Continue the current bid workflow from here.";
  const selectedCanOpenAgreement = selectedNextActionKey === "open_agreement" && selectedRow?.linked_agreement_url;
  const selectedValueDisplay = opportunityValueDisplay(selectedRow);
  const selectedCustomerId = firstPresent(
    selectedRow?.customer_id,
    selectedRow?.homeowner_id,
    selectedRow?.homeowner?.id,
    selectedSnapshot?.customer_id,
    selectedSnapshot?.homeowner_id
  );
  const selectedServiceLocation = firstPresent(
    selectedRow?.service_location,
    selectedRow?.address,
    selectedRow?.location,
    selectedSnapshot?.service_location,
    selectedSnapshot?.address,
    selectedSnapshot?.location
  );
  const selectedProjectDescription = firstPresent(
    selectedSnapshot?.project_scope_summary,
    selectedSnapshot?.refined_description,
    selectedRow?.notes,
    selectedRow?.project_description
  );
  const selectedTimeline = firstPresent(selectedSnapshot?.timeline, selectedRow?.timeline);
  const selectedScheduleSupported = Boolean(selectedRow?.schedule_estimate_url || selectedRow?.calendar_event_url);
  const rowPrimaryActionLabel = (row) => {
    if (normalize(row?.source_kind) === "property_work_order") {
      const nextKey = normalize(row?.next_action?.key);
      if (nextKey === "accept_property_work_order") return "Accept Work Order";
      if (nextKey === "prepare_agreement_draft") return "Convert to Agreement";
      if (nextKey === "open_agreement") return "Open Agreement";
      return row?.next_action?.label || "View Details";
    }
    if (isConvertToAgreementRow(row)) return "Convert to Agreement";
    const stage = workspaceStageFromRow(row);
    if (stage === "new_lead") return "Review Lead";
    if (stage === "follow_up") return "Follow Up";
    if (stage === "closed") return "View Details";
    if (normalize(row?.next_action?.key) === "open_agreement" && row?.linked_agreement_url) return "Open Agreement";
    if (stage === "active_bid") return "Create Estimate";
    return row?.next_action?.label || "View Details";
  };

  const closeDrawer = () => {
    setSelectedRow(null);
    setConvertPanelOpen(false);
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

  const patchLeadStatus = async (row, status, { keepSelected = false, nextWorkspaceTab = "" } = {}) => {
    if (!row?.source_id) return null;
    setActionBusyId(String(row.bid_id));
    try {
      const { data } = await api.patch(`/projects/contractor/public-leads/${row.source_id}/`, { status });
      toast.success(status === "follow_up" ? "Lead saved for follow-up." : status === "new" ? "Lead moved back to New Leads." : "Lead updated.");
      await loadWorkspace({ keepSelectedBidId: keepSelected ? String(row.bid_id) : "" });
      if (nextWorkspaceTab) {
        setActiveWorkspaceTab(nextWorkspaceTab);
      }
      return data;
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Could not update this lead.");
      return null;
    } finally {
      setActionBusyId("");
    }
  };

  const respondToPropertyWorkOrder = async (row, action) => {
    if (!row?.source_id) return null;
    const keepSelected = Boolean(selectedRow && String(selectedRow.bid_id) === String(row.bid_id));
    setActionBusyId(String(row.bid_id));
    try {
      await api.post(`/projects/contractor-opportunities/${row.source_id}/${action}/`);
      toast.success(action === "accept" ? "Work order accepted." : "Work order declined.");
      await loadWorkspace({ keepSelectedBidId: keepSelected ? String(row.bid_id) : "" });
      setActiveWorkspaceTab(action === "accept" ? "follow_up" : "closed");
      return true;
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || `Could not ${action} this work order.`);
      return null;
    } finally {
      setActionBusyId("");
    }
  };

  const preparePropertyWorkOrderAgreementDraft = async (row) => {
    if (!row?.source_id) return null;
    setActionBusyId(String(row.bid_id));
    try {
      const { data } = await api.post(`/projects/contractor-opportunities/${row.source_id}/create-agreement-draft/`);
      await loadWorkspace({ keepSelectedBidId: String(row.bid_id) });
      const target =
        data?.next_url ||
        data?.wizard_url ||
        (data?.linked_agreement_id || data?.agreement_id
          ? `/app/agreements/${data.linked_agreement_id || data.agreement_id}/wizard?step=1`
          : "");
      if (target) {
        navigate(target);
        return data;
      }
      toast.success("Agreement draft prepared.");
      return data;
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Could not prepare this agreement draft.");
      return null;
    } finally {
      setActionBusyId("");
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

    if (sourceKind === "property_work_order") {
      const actionKey = normalize(row.next_action?.key);
      if (actionKey === "accept_property_work_order") {
        await respondToPropertyWorkOrder(row, "accept");
        return;
      }
      if (actionKey === "prepare_agreement_draft") {
        await preparePropertyWorkOrderAgreementDraft(row);
        return;
      }
      setSelectedRow(row);
      return;
    }

    setActionBusyId(String(row.bid_id));
    try {
      if (sourceKind === "lead" && workspaceStageFromRow(row) === "follow_up") {
        const followUpResponse = await api.patch(`/projects/contractor/public-leads/${sourceId}/`, {
          status: "ready_for_review",
        });
        if (!followUpResponse?.data) {
          throw new Error("Could not promote this follow-up lead.");
        }
      }
      const endpoint =
        sourceKind === "lead"
          ? `/projects/contractor/public-leads/${sourceId}/create-agreement/`
          : `/projects/intakes/${sourceId}/convert-to-agreement/`;
      const { data } = await api.post(endpoint, {});
      const target =
        data?.wizard_url || data?.detail_url || (data?.agreement_id ? `/app/agreements/${data.agreement_id}` : "");
      if (target) {
        const assistantState =
          sourceKind === "lead" || sourceKind === "intake"
            ? buildLeadAgreementAssistantState(row, { currentRoute: "/app/opportunities", brandVoice: contractorBrandVoice })
            : null;
        navigate(target, assistantState ? { state: assistantState } : undefined);
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
    if (normalize(row.source_kind) === "property_work_order") {
      runAction(row);
      return;
    }
    if (isConvertToAgreementRow(row)) {
      setSelectedRow(row);
      setConvertPanelOpen(true);
      return;
    }
    const stage = workspaceStageFromRow(row);
    if (stage === "new_lead") {
      setSelectedRow(row);
      return;
    }
    if (stage === "follow_up") {
      setSelectedRow(row);
      return;
    }
    runAction(row);
  };

  const emptyStateTitle =
    sourceFilter === "website" || sourceFilter === "website_leads"
      ? "No website leads"
      : sourceFilter === "landing"
        ? "No landing page leads"
        : sourceFilter === "qr"
          ? "No QR leads"
          : sourceFilter === "portal"
            ? "No portal leads"
            : sourceFilter === "marketplace"
              ? "No marketplace leads"
              : sourceFilter === "manual"
                ? "No manual leads"
                : activeWorkspaceTab === "follow_up"
                  ? "No follow-up items"
                  : activeWorkspaceTab === "active_bid"
                    ? "No active opportunities"
                    : activeWorkspaceTab === "work_order"
                      ? "No work orders"
                      : activeWorkspaceTab === "closed"
                        ? "No closed opportunities"
                        : "No opportunities match your current filters";
  const emptyStateCopy =
    sourceFilter !== "all"
      ? "Try another source, clear filters, or check back when new leads arrive."
      : activeWorkspaceTab === "new_lead"
        ? "New lead requests will appear here as customers submit project details."
        : "Try another stage, clear filters, or check back when more activity lands in the pipeline.";

  return (
    <ContractorPageSurface
      variant="operational"
      contentClassName="mx-auto max-w-7xl"
    >
      <div className="space-y-6" data-testid="leads-and-bids-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <ClipboardList size={14} />
            Opportunity Center
          </div>
          <h1 data-testid="contractor-bids-title" className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">
            Opportunities
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Review new leads first, then move into active opportunities and closed work without leaving the same workspace.
          </p>
        </div>
      </div>

      <section className="rounded-2xl border border-blue-300/15 bg-slate-950/60 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">{activeStageLabel}</h2>
            <div className="mt-1 text-sm text-blue-100/70">
              {loading
                ? "Loading opportunity workspace..."
                : `${visibleRows.length} ${activeStageNoun}${visibleRows.length === 1 ? "" : "s"} · ${activeSortLabel}`}
            </div>
          </div>

          <div className="flex flex-wrap gap-2" data-testid="leads-and-bids-tabs">
            {workspaceTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                data-testid={tab.testId}
                onClick={() => {
                  setActiveWorkspaceTab(tab.key);
                  setSourceFilter("all");
                  setRequestFilter("all");
                }}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                  activeWorkspaceTab === tab.key
                    ? "border-blue-300 bg-blue-600 text-white shadow-sm"
                    : "border-blue-300/20 bg-slate-900/60 text-blue-100 hover:bg-slate-800"
                }`}
              >
                <span>{tab.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${activeWorkspaceTab === tab.key ? "bg-white/15 text-white" : "bg-blue-400/10 text-blue-100"}`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-medium text-blue-50">
              Sort by
              <select
                data-testid="workspace-sort-control"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
                className="mt-1 w-full rounded-lg border border-blue-300/20 bg-slate-900 px-3 py-2 text-white"
              >
                {sortOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-medium text-blue-50">
              Project class
              <select
                data-testid="bids-filter-project-class"
                value={projectClassFilter}
                onChange={(event) => setProjectClassFilter(event.target.value)}
                className="mt-1 w-full rounded-lg border border-blue-300/20 bg-slate-900 px-3 py-2 text-white"
              >
                <option value="all">All</option>
                <option value="residential">Residential</option>
                <option value="commercial">Commercial</option>
              </select>
            </label>

            <label className="text-sm font-medium text-blue-50">
              Status
              <select
                data-testid="bids-filter-status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="mt-1 w-full rounded-lg border border-blue-300/20 bg-slate-900 px-3 py-2 text-white"
              >
                <option value="all">All</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="follow_up">Follow-Up</option>
                <option value="accepted">Accepted</option>
                <option value="under_review">Under Review</option>
                <option value="awarded">Awarded</option>
                <option value="declined">Declined</option>
                <option value="expired">Not Selected</option>
              </select>
            </label>
          </div>

          <label className="text-sm font-medium text-blue-50">
            Search
            <input
              data-testid="bids-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Project, customer, or signal"
              className="mt-1 w-full rounded-lg border border-blue-300/20 bg-slate-900 px-3 py-2 text-white placeholder:text-blue-100/50"
            />
          </label>
        </div>

        {hasActiveFilters ? (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              data-testid="opportunities-reset-filters"
              onClick={resetFilters}
              className="rounded-lg border border-blue-300/25 bg-slate-900 px-4 py-2 text-sm font-semibold text-blue-100 hover:bg-slate-800"
            >
              Reset filters
            </button>
          </div>
        ) : null}

        <div className="mt-3 text-xs text-blue-100/60">
          {activeWorkspaceTab === "new_lead"
            ? "New leads are requests you can review before you start the bid workflow."
            : activeWorkspaceTab === "active_bid"
              ? "Active bids include opportunities you are already shaping or have already responded to."
              : activeWorkspaceTab === "work_order"
                ? "Work orders are property management opportunities routed through MyHomeBro."
                : "Closed opportunities stay available for reference and follow-up."}
        </div>

        {loading ? (
          <div className="mt-5 text-sm text-blue-100/70">Loading opportunity workspace...</div>
        ) : visibleRows.length === 0 ? (
          <div
            data-testid="bids-empty"
            className="mt-5 rounded-xl border border-dashed border-blue-300/25 bg-slate-900/60 p-6 text-sm text-blue-100/70"
          >
            <div className="text-base font-semibold text-white">{emptyStateTitle}</div>
            <p className="mt-1">{emptyStateCopy}</p>
          </div>
        ) : (
          <div className="mt-5 grid gap-4" data-testid="opportunity-card-feed">
            {visibleRows.map((row) => {
              const stage = workspaceStageFromRow(row);
              const actionLabel = rowPrimaryActionLabel(row);
              const signals = prioritizeSignals(row.request_signals).slice(0, 4);
              const valueDisplay = opportunityValueDisplay(row);
              return (
                <article
                  key={`${row.source_kind}-${row.bid_id}`}
                  data-testid={`lead-row-${row.bid_id}`}
                  className={`rounded-2xl border p-4 shadow-sm transition hover:border-blue-300/60 hover:bg-slate-900/90 ${
                    stage === "new_lead"
                      ? "border-blue-300/25 bg-blue-950/35"
                      : stage === "follow_up"
                        ? "border-amber-300/25 bg-amber-950/20"
                        : stage === "closed"
                          ? "border-slate-600 bg-slate-900/60"
                          : "border-blue-300/15 bg-slate-900/70"
                  }`}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedRow(row)}>
                      <div className="flex flex-wrap items-center gap-2">
                        {row.source_kind_label ? (
                          <span
                            data-testid={`lead-source-${row.bid_id}`}
                            className="inline-flex rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100"
                          >
                            {row.source_kind_label}
                          </span>
                        ) : null}
                        <span
                          data-testid={`lead-stage-${row.bid_id}`}
                          className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${workspaceStageTone(stage)}`}
                        >
                          {workspaceStageLabel(stage)}
                        </span>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusTone(row.status)}`}>
                          {row.status_label}
                        </span>
                      </div>

                      <h3 className="mt-3 text-lg font-bold text-white">{row.project_title}</h3>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-blue-100/70">
                        <span className="font-semibold text-blue-50">{row.customer_name}</span>
                        <span>{row.customer_email || row.customer_phone || "No contact listed"}</span>
                        <span>{row.location || "Location unavailable"}</span>
                      </div>

                      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-xl border border-blue-300/10 bg-slate-950/50 p-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-100/50">{valueDisplay.label}</div>
                          <div className={`mt-1 font-bold ${valueDisplay.tone}`}>{valueDisplay.value}</div>
                        </div>
                        <div className="rounded-xl border border-blue-300/10 bg-slate-950/50 p-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-100/50">Received</div>
                          <div className="mt-1 font-bold text-white">{receivedLabel(row.submitted_at)}</div>
                        </div>
                        <div className="rounded-xl border border-blue-300/10 bg-slate-950/50 p-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-100/50">Project Class</div>
                          <div className="mt-1 font-bold text-white">{row.project_class_label || "Residential"}</div>
                        </div>
                        <div className="rounded-xl border border-blue-300/10 bg-slate-950/50 p-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-100/50">Reference</div>
                          <div className="mt-1 font-bold text-white">{row.source_reference || "-"}</div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {signals.length ? (
                          signals.map((signal) => (
                            <span
                              key={`${row.bid_id}-${signal}`}
                              className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${signalTone(signal)}`}
                            >
                              {signal}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-blue-100/60">No signals yet</span>
                        )}
                      </div>

                      <div className="mt-4 rounded-xl border border-blue-300/15 bg-blue-950/30 p-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-100/50">Next best action</div>
                        <div className="mt-1 text-sm font-semibold text-blue-50">{nextBestActionLine(row)}</div>
                      </div>
                    </button>

                    <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:w-56 lg:flex-col">
                      <button
                        type="button"
                        data-testid={`lead-row-action-${row.bid_id}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleRowPrimaryAction(row);
                        }}
                        disabled={actionBusyId === String(row.bid_id)}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-300 bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-60"
                      >
                        {actionBusyId === String(row.bid_id) ? "Working..." : actionLabel}
                        <ArrowRight size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedRow(row)}
                        className="inline-flex w-full items-center justify-center rounded-lg border border-blue-300/25 bg-slate-900 px-4 py-2 text-sm font-semibold text-blue-100 hover:bg-slate-800"
                      >
                        View Details
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {selectedRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
          <button
            type="button"
            aria-label="Close opportunity review backdrop"
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
            onClick={closeDrawer}
          />
          <div
            data-testid="bids-detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="opportunity-review-title"
            className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-slate-200 p-5">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Opportunity Review</div>
                <h3 id="opportunity-review-title" className="mt-2 text-2xl font-extrabold text-slate-900">{selectedRow.project_title}</h3>
                <div className="mt-2 text-sm text-slate-600">{selectedRow.customer_name}</div>
              </div>
              <button
                type="button"
                aria-label="Close bid details"
                onClick={closeDrawer}
                className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600 hover:bg-slate-50"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5" data-testid="lead-detail-container">
              <SectionCard
                title="Project Details"
                testId="lead-overview"
                subtitle="The customer's request details, separated from your recommended next steps."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailField label="Project Title" value={selectedRow.project_title} />
                  <DetailField label="Customer" value={selectedRow.customer_name || "-"} />
                  <DetailField label="Contact" value={firstPresent(selectedRow.customer_email, selectedRow.customer_phone, "No contact listed")} />
                  <DetailField label="Source" value={selectedRow.source_kind_label || "Lead"} />
                  <DetailField label="Received" value={fmtDate(selectedRow.submitted_at)} />
                  <DetailField label="Status" value={selectedRow.status_label} />
                  <DetailField label="Project Type" value={firstPresent(selectedRow.project_type, selectedRow.project_class_label, "-")} />
                  <DetailField label="Project Family" value={selectedSnapshot.project_family_label || selectedRow.project_class_label || "-"} />
                  <DetailField label="Project Class" value={selectedRow.project_class_label || "-"} />
                  {selectedRow.project_subtype ? <DetailField label="Area / Subtype" value={selectedRow.project_subtype} /> : null}
                  {selectedTimeline ? <DetailField label="Timeline" value={selectedTimeline} /> : null}
                  <DetailField label={selectedValueDisplay.label} value={selectedValueDisplay.value} />
                  {selectedServiceLocation ? <DetailField label="Service Location" value={selectedServiceLocation} /> : null}
                  {selectedIsPropertyWorkOrder ? (
                    <>
                      <DetailField label="Work Order" value={selectedRow.work_order_number || selectedRow.source_reference || "-"} />
                      <DetailField label="Property" value={selectedSnapshot.property || "-"} />
                      <DetailField label="Unit" value={selectedSnapshot.unit || "Whole property"} />
                      <DetailField label="Priority" value={selectedSnapshot.priority || selectedRow.project_subtype || "-"} />
                      <DetailField label="Category" value={selectedSnapshot.category || selectedRow.project_type || "-"} />
                    </>
                  ) : null}
                </div>
                <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Project Description</div>
                  <div className="mt-2">{selectedProjectDescription || "No project description was provided."}</div>
                </div>
                <div className="mt-4 text-xs text-slate-500">
                  Reference: {selectedRow.source_reference || "-"} · Agreement: {selectedRow.linked_agreement_reference || "-"}
                </div>
                {selectedProjectTypeCue ? (
                  <div
                    data-testid="project-type-cue"
                    className="mt-4 inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800"
                  >
                    {selectedProjectTypeCue}
                  </div>
                ) : null}
                {outcomeNote ? (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    {outcomeNote}
                  </div>
                ) : null}
                {selectedStage === "follow_up" ? (
                  <div
                    data-testid="follow-up-state-note"
                    className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                  >
                    This lead is saved for later review. Resume it when you are ready or create your bid now.
                  </div>
                ) : null}
              </SectionCard>
              <SectionCard
                title="Recommended Next Steps"
                testId="lead-action-section"
                subtitle="Choose the next sales action for this opportunity."
              >
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                  {selectedIsPropertyWorkOrder && selectedNextActionKey === "accept_property_work_order"
                    ? "This property management work order needs your response. Accept it if you can take the job, or decline it to close the request for your workspace."
                    : selectedIsPropertyWorkOrder && selectedNextActionKey === "prepare_agreement_draft"
                      ? "This work order is accepted. Prepare an agreement draft to continue in the existing MyHomeBro agreement workflow."
                      : selectedIsPropertyWorkOrder && selectedNextActionKey === "open_agreement"
                        ? "The draft agreement is ready. Open it to continue scope review, signing, and later funding steps."
                        : selectedStage === "new_lead"
                          ? "Review the request, schedule an estimate if needed, then convert it into an agreement when the scope is clear."
                          : selectedStage === "follow_up"
                            ? "This lead is saved for later. Follow up with the customer or create your estimate when ready."
                            : selectedStage === "closed"
                              ? "This opportunity is closed for now, but the record stays here for reference."
                              : selectedCanOpenAgreement
                                ? "This opportunity already has a linked agreement. Open it to continue the project workflow."
                                : "Continue the current bid workflow from here."}
                </div>

                {(selectedStage === "new_lead" || selectedStage === "follow_up") && !selectedIsPropertyWorkOrder ? (
                  <div
                    className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
                    data-testid="create-bid-context-note"
                  >
                    {selectedCreateBidContext}
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-3">
                  {selectedStage !== "closed" && !selectedCanOpenAgreement ? (
                    <button
                      type="button"
                      data-testid="schedule-estimate-action"
                      disabled={!selectedScheduleSupported}
                      onClick={() => {
                        if (selectedRow?.schedule_estimate_url) navigate(selectedRow.schedule_estimate_url);
                        else if (selectedRow?.calendar_event_url) navigate(selectedRow.calendar_event_url);
                      }}
                      className="inline-flex items-center gap-2 rounded-lg border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500"
                      title={
                        selectedScheduleSupported
                          ? "Schedule an estimate using the existing calendar flow."
                          : "Calendar estimate scheduling is coming soon."
                      }
                    >
                      Schedule Estimate
                      {!selectedScheduleSupported ? <span className="text-xs font-medium">(Coming soon)</span> : null}
                    </button>
                  ) : null}

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
                  ) : selectedCanConvertToAgreement ? (
                    <button
                      type="button"
                      onClick={() => setConvertPanelOpen(true)}
                      data-testid="convert-to-agreement-action"
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500"
                    >
                      {selectedPrimaryActionLabel}
                      <ArrowRight size={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => runAction(selectedRow)}
                      disabled={actionBusyId === String(selectedRow.bid_id)}
                      data-testid={
                        selectedStage === "new_lead" || selectedStage === "follow_up"
                          ? "create-bid-action"
                          : "lead-detail-primary-action"
                      }
                      className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
                    >
                      {actionBusyId === String(selectedRow.bid_id) ? "Working..." : selectedPrimaryActionLabel}
                      <ExternalLink size={14} />
                    </button>
                  )}

                  {selectedCustomerId ? (
                    <button
                      type="button"
                      data-testid="open-customer-workspace-action"
                      onClick={() => navigate(`/app/customers/${selectedCustomerId}`)}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Open Customer Workspace
                    </button>
                  ) : null}

                  {selectedIsPropertyWorkOrder && selectedNextActionKey === "accept_property_work_order" ? (
                    <button
                      type="button"
                      onClick={() => respondToPropertyWorkOrder(selectedRow, "decline")}
                      disabled={actionBusyId === String(selectedRow.bid_id)}
                      data-testid="decline-property-work-order-action"
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-60"
                    >
                      Decline
                    </button>
                  ) : null}
                  {selectedStage === "new_lead" && !selectedIsPropertyWorkOrder ? (
                    <button
                      type="button"
                      onClick={() => patchLeadStatus(selectedRow, "follow_up", { keepSelected: true, nextWorkspaceTab: "follow_up" })}
                      disabled={actionBusyId === String(selectedRow.bid_id)}
                      data-testid="follow-up-action-button"
                      className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                    >
                      Follow Up
                    </button>
                  ) : null}
                  {selectedStage === "follow_up" && !selectedIsPropertyWorkOrder ? (
                    <button
                      type="button"
                      onClick={() => patchLeadStatus(selectedRow, "new", { keepSelected: true, nextWorkspaceTab: "new_lead" })}
                      disabled={actionBusyId === String(selectedRow.bid_id)}
                      data-testid="resume-review-action"
                      className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                    >
                      Resume Review
                    </button>
                  ) : null}
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
              </SectionCard>
              <SectionCard
                title="Project Snapshot"
                testId="project-snapshot"
                subtitle="Useful project details pulled from the request and the structured intake."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailField label="Scope Summary" value={selectedSnapshot.project_scope_summary || selectedSnapshot.refined_description || selectedRow.notes || "-"} />
                  <DetailField label="Measurements" value={selectedSnapshot.measurement_handling || selectedRow.measurement_handling || "-"} />
                  {selectedTimeline ? <DetailField label="Timing" value={selectedTimeline} /> : null}
                  <DetailField label={selectedValueDisplay.label} value={selectedValueDisplay.value} />
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
                title="Recommended Setup"
                testId="recommended-setup-section"
                subtitle="A suggested starting point based on the project details provided."
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <DetailField
                    label="Project Type"
                    value={
                      selectedProjectSetup.recommendedProjectType ||
                      selectedProjectSetup.projectFamilyLabel ||
                      selectedRow.project_type ||
                      "-"
                    }
                  />
                  <DetailField
                    label="Workflow"
                    value={selectedProjectSetup.suggestedWorkflow || "General project review"}
                  />
                  <DetailField
                    label="Template"
                    value={
                      selectedProjectSetup.suggestedTemplateLabel ||
                      selectedProjectSetup.recommendedTemplateName ||
                      "General project template"
                    }
                  />
                </div>
                <div
                  data-testid="recommended-setup-note"
                  className="mt-3 rounded-xl border border-white/80 bg-white/80 px-4 py-3 text-sm text-slate-700"
                >
                  {selectedProjectSetup.recommendationNote ||
                    "This is a suggested setup. You can still choose a different path when you create the bid."}
                </div>
              </SectionCard>

              <SectionCard
                title="Photos and Reference Images"
                testId="photos-section"
                subtitle="Visual context helps the contractor understand scope faster."
              >
                {selectedPhotos.length ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {selectedPhotos.map((photo) => (
                      <div key={photo.id || photo.image_url || photo.url || photo.original_name} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
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
                          {photo.url ? (
                            <a href={photo.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-semibold text-sky-700 hover:text-sky-900">
                              Open attachment
                            </a>
                          ) : null}
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

              {selectedStage !== "closed" && selectedResponseTemplates.length ? (
                <SectionCard
                  title="Quick Response Templates"
                  testId="response-templates-section"
                  subtitle="Short starting points you can copy into a response or bid note."
                >
                  <div className="space-y-3">
                    {selectedResponseTemplates.map((template) => {
                      const copyId = `${selectedRow.bid_id}-template-${template.key}`;
                      return (
                        <div
                          key={template.key}
                          data-testid={`response-template-${template.key}`}
                          className="rounded-xl border border-slate-200 bg-white px-4 py-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-slate-900">{template.label}</div>
                              <p className="mt-2 text-sm text-slate-700">{template.text}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => copyReference(template.text, copyId)}
                              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                              data-testid={`response-template-copy-${template.key}`}
                            >
                              <Copy size={14} />
                              {copiedRefId === copyId ? "Copied" : "Copy"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
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
          </div>
        </div>
      ) : null}
      <ConvertToAgreementPanel
        open={convertPanelOpen && Boolean(selectedRow)}
        row={selectedRow}
        onClose={() => setConvertPanelOpen(false)}
      />
      </div>
    </ContractorPageSurface>
  );
}



