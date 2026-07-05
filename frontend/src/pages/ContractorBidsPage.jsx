import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, ClipboardList, Copy, ExternalLink, Mail, MessageSquare, Phone, X } from "lucide-react";
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

function lifecycleStatus(row) {
  const stage = workspaceStageFromRow(row);
  const status = normalize(row?.status);
  const statusGroup = normalize(row?.status_group);
  const sourceKind = normalize(row?.source_kind);
  const nextKey = normalize(row?.next_action?.key);
  const hasAgreement = Boolean(row?.linked_agreement_id || row?.agreement_id || row?.linked_agreement_url);

  if (hasAgreement || nextKey === "open_agreement") {
    return { label: "Converted", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" };
  }
  if (stage === "closed" || status === "declined" || status === "expired" || statusGroup === "declined_expired") {
    return { label: "Declined", tone: "border-rose-200 bg-rose-50 text-rose-800" };
  }
  if (row?.estimate_completed || normalize(row?.latest_estimate_appointment?.status) === "completed") {
    return { label: "Estimate Completed", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" };
  }
  if (row?.latest_estimate_appointment || row?.estimate_scheduled) {
    return { label: "Estimate Scheduled", tone: "border-indigo-200 bg-indigo-50 text-indigo-800" };
  }
  if (sourceKind === "property_work_order" && nextKey === "accept_property_work_order") {
    return { label: "Needs Response", tone: "border-amber-200 bg-amber-50 text-amber-800" };
  }
  if (isConvertToAgreementRow(row) || status === "awarded" || statusGroup === "awarded" || nextKey === "prepare_agreement_draft") {
    return { label: "Ready to Convert", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" };
  }
  if (stage === "new_lead" || stage === "follow_up" || status === "draft" || status === "submitted" || status === "open") {
    return { label: "Estimate Needed", tone: "border-sky-200 bg-sky-50 text-sky-800" };
  }
  if (status === "under_review" || statusGroup === "under_review") {
    return { label: "Needs Response", tone: "border-amber-200 bg-amber-50 text-amber-800" };
  }
  return { label: "Needs Response", tone: "border-amber-200 bg-amber-50 text-amber-800" };
}

function hasLinkedAgreement(row) {
  return Boolean(row?.linked_agreement_id || row?.agreement_id || row?.linked_agreement_url);
}

function DetailField({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-semibold text-slate-900">{value || "-"}</div>
    </div>
  );
}

function SectionCard({ title, testId, children, subtitle = "", className = "" }) {
  return (
    <section
      data-testid={testId}
      className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 ${className}`.trim()}
    >
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ModalSection({ title, testId, children, subtitle = "", className = "" }) {
  return (
    <section data-testid={testId} className={`rounded-xl bg-white ${className}`.trim()}>
      <div className="flex flex-col gap-1 border-b border-slate-100 pb-3">
        <div className="text-sm font-bold text-slate-950">{title}</div>
        {subtitle ? <p className="text-sm text-slate-600">{subtitle}</p> : null}
      </div>
      <div className="pt-3">{children}</div>
    </section>
  );
}

function SummaryMetric({ label, value, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-50 text-slate-900",
    emerald: "bg-emerald-50 text-emerald-900",
    amber: "bg-amber-50 text-amber-900",
    sky: "bg-sky-50 text-sky-900",
  };
  return (
    <div className={`rounded-lg px-3 py-2 ${tones[tone] || tones.slate}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-60">{label}</div>
      <div className="mt-1 text-sm font-bold">{value || "-"}</div>
    </div>
  );
}

function InfoRow({ label, value, testId = "" }) {
  return (
    <div data-testid={testId || undefined} className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-950">{value || "-"}</div>
    </div>
  );
}

function formatAppointmentWindow(appointment) {
  if (!appointment) return "";
  const date = fmtDate(appointment.start_at || appointment.date || appointment.scheduled_for);
  const time = appointment.start_time || appointment.time || "";
  const type = appointment.appointment_type_label || appointment.appointment_type || "Estimate";
  return [date, time, type].filter(Boolean).join(" - ");
}

function buildAvailabilitySummary({ row, lifecycle, canScheduleEstimate }) {
  const appointment = row?.latest_estimate_appointment;
  const workload =
    firstPresent(
      row?.workload_indicator,
      row?.capacity_summary,
      row?.request_snapshot?.workload_indicator,
      row?.request_snapshot?.capacity_summary
    ) || "Workload data is not connected to this opportunity yet.";
  const fit =
    firstPresent(
      row?.project_fit_summary,
      row?.request_snapshot?.project_fit_summary,
      row?.project_class_label,
      row?.project_type
    ) || "Fit is based on request details only.";

  return {
    estimate:
      appointment
        ? formatAppointmentWindow(appointment)
        : canScheduleEstimate
          ? "Ready to schedule with customer contact on file."
          : "Add customer contact before scheduling.",
    project:
      lifecycle?.label === "Converted"
        ? "Continue planning from the linked agreement."
        : lifecycle?.label === "Ready to Convert"
          ? "Project timing can be confirmed during agreement setup."
          : "Project availability is confirmed after estimate and scope review.",
    workload,
    capacity:
      appointment
        ? "Estimate is on the calendar; project capacity still needs agreement review."
        : "No appointment scheduled yet.",
    fit,
  };
}

function buildPlanningGuidance({ projectIntelligence, projectSetup, snapshot, row }) {
  const description = firstPresent(
    snapshot?.project_scope_summary,
    snapshot?.refined_description,
    row?.notes,
    row?.project_description
  );
  const signals = Array.isArray(row?.request_signals) ? row.request_signals : [];
  const hasPhotos = Number(snapshot?.photo_count || 0) > 0 || signals.map(normalize).includes("photos");
  const complexity =
    normalize(projectSetup?.suggestedWorkflow).includes("remodel") || normalize(description).includes("full")
      ? "Higher complexity"
      : normalize(projectSetup?.suggestedWorkflow).includes("repair")
        ? "Focused repair"
        : "Standard review";
  const trades =
    firstPresent(
      projectSetup?.recommendedProjectType,
      projectSetup?.projectFamilyLabel,
      projectIntelligence?.familyLabel,
      row?.project_type
    ) || "General trade review";
  const duration =
    firstPresent(snapshot?.timeline, row?.timeline) ||
    (complexity === "Higher complexity" ? "Confirm during estimate" : "Likely short once scope is confirmed");
  const risks = [];
  if (!description) risks.push("Scope details are light.");
  if (!hasPhotos) risks.push("Photos are not attached.");
  if (!snapshot?.budget && !row?.budget_text && !row?.bid_amount_label) risks.push("Budget basis is missing.");
  if (normalize(snapshot?.measurement_handling) === "site visit required") risks.push("Site visit or measurements may be required.");
  if (!risks.length) risks.push("No major request risks detected from existing intake data.");
  return { complexity, trades, duration, risks };
}

function splitDescriptionBullets(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const sentenceParts = raw
    .replace(/\r/g, "\n")
    .split(/\n+|(?:\.\s+)/)
    .map((part) => part.replace(/^[-*•\s]+/, "").trim())
    .filter(Boolean);
  if (sentenceParts.length > 1) return sentenceParts.slice(0, 6).map((part) => (part.endsWith(".") ? part : `${part}.`));

  const commaParts = raw
    .split(/,\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (commaParts.length > 2) return commaParts.slice(0, 6);
  return [raw];
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
  if (stage === "new_lead") return "Lead Received";
  if (stage === "follow_up") return "Follow-Up";
  if (stage === "closed") return "Closed / Archived";
  if (stage === "work_order") return "Work Order";
  return "Needs Review";
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

function encodeContactMessage(message) {
  return encodeURIComponent(String(message || "").trim());
}

function buildEmailHref(email, subject, message) {
  const cleanEmail = String(email || "").trim();
  if (!cleanEmail) return "";
  return `mailto:${cleanEmail}?subject=${encodeContactMessage(subject)}&body=${encodeContactMessage(message)}`;
}

function buildSmsHref(phone, message) {
  const cleanPhone = String(phone || "").trim();
  if (!cleanPhone) return "";
  return `sms:${cleanPhone}?&body=${encodeContactMessage(message)}`;
}

function ContactActionButton({ kind, href, disabledReason, children, testId, onClick }) {
  const icon =
    kind === "email" ? <Mail size={14} /> : kind === "text" ? <MessageSquare size={14} /> : <Phone size={14} />;
  const baseClass =
    "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition";
  if (!href) {
    return (
      <button
        type="button"
        data-testid={testId}
        disabled
        title={disabledReason}
        className={`${baseClass} cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500`}
      >
        {icon}
        {children}
      </button>
    );
  }
  return (
    <a
      data-testid={testId}
      href={href}
      onClick={onClick}
      className={`${baseClass} border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}
    >
      {icon}
      {children}
    </a>
  );
}

function scheduleSourceForRow(row) {
  if (!row?.source_id) return null;
  const kind = normalize(row.source_kind);
  if (kind === "lead" || kind === "quote_request") return { source_type: "lead", source_id: row.source_id };
  if (kind === "intake") return { source_type: "intake", source_id: row.source_id };
  if (kind === "marketplace" || kind === "property_work_order") return { source_type: "opportunity", source_id: row.source_id };
  return null;
}

function defaultScheduleDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function defaultScheduleTime() {
  return "09:00";
}

function ScheduleEstimateModal({ row, open, onClose, onScheduled }) {
  const source = scheduleSourceForRow(row);
  const [date, setDate] = useState(defaultScheduleDate());
  const [time, setTime] = useState(defaultScheduleTime());
  const [duration, setDuration] = useState("60");
  const [appointmentType, setAppointmentType] = useState("phone_call");
  const [notes, setNotes] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [serviceLocation, setServiceLocation] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !row) return;
    setDate(defaultScheduleDate());
    setTime(defaultScheduleTime());
    setDuration("60");
    setAppointmentType(row.location ? "in_person" : "phone_call");
    setNotes("");
    setCustomerName(row.customer_name || "");
    setCustomerEmail(row.customer_email || row.request_snapshot?.customer_email || "");
    setCustomerPhone(row.customer_phone || row.request_snapshot?.customer_phone || "");
    setServiceLocation(row.location || row.request_snapshot?.location || "");
    setError("");
    setLoading(false);
    setResult(null);
    setCopied(false);
  }, [open, row?.bid_id]);

  if (!open || !row) return null;

  const hasContact = Boolean(customerEmail || customerPhone);
  const message = result?.customer_message || "";
  const emailHref = buildEmailHref(customerEmail, `Estimate appointment for ${row.project_title || "your project"}`, message);
  const smsHref = buildSmsHref(customerPhone, message);
  const telHref = customerPhone ? `tel:${customerPhone}` : "";

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (!source) {
      setError("This opportunity is missing a schedulable source.");
      return;
    }
    if (!customerName.trim()) {
      setError("Customer name is required.");
      return;
    }
    if (!customerEmail.trim() && !customerPhone.trim()) {
      setError("Customer email or phone is required.");
      return;
    }
    if (!date || !time) {
      setError("Date and start time are required.");
      return;
    }
    if (appointmentType === "in_person" && !serviceLocation.trim()) {
      setError("Service location is required for an in-person estimate.");
      return;
    }

    const scheduledStart = new Date(`${date}T${time}`);
    if (Number.isNaN(scheduledStart.getTime())) {
      setError("Choose a valid date and start time.");
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post("/projects/contractor-opportunities/estimate-appointments/", {
        ...source,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        service_location: serviceLocation,
        appointment_type: appointmentType,
        scheduled_start: scheduledStart.toISOString(),
        duration_minutes: Number(duration || 60),
        notes,
      });
      setResult(data || {});
      onScheduled?.(data);
      toast.success("Estimate appointment scheduled.");
    } catch (err) {
      console.error(err);
      const payload = err?.response?.data;
      if (payload?.detail) setError(payload.detail);
      else if (payload && typeof payload === "object") {
        const first = Object.values(payload).flat().find(Boolean);
        setError(first || "Could not schedule this estimate.");
      } else {
        setError("Could not schedule this estimate.");
      }
    } finally {
      setLoading(false);
    }
  };

  const copyMessage = async () => {
    if (!message || !navigator?.clipboard?.writeText) return;
    await navigator.clipboard.writeText(message);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6">
      <button type="button" aria-label="Close schedule estimate backdrop" className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-estimate-title"
        data-testid="schedule-estimate-modal"
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-slate-200 p-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Estimate Appointment</div>
            <h3 id="schedule-estimate-title" className="mt-2 text-2xl font-extrabold text-slate-950">Schedule Estimate</h3>
            <p className="mt-1 text-sm text-slate-600">{row.project_title} - {row.source_reference}</p>
          </div>
          <button type="button" aria-label="Close schedule estimate" onClick={onClose} className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600 hover:bg-slate-50">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-semibold text-slate-800">
              Customer name
              <input data-testid="schedule-estimate-customer-name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Customer email
              <input data-testid="schedule-estimate-customer-email" type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Customer phone
              <input data-testid="schedule-estimate-customer-phone" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Appointment type
              <select data-testid="schedule-estimate-type" value={appointmentType} onChange={(event) => setAppointmentType(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="phone_call">Phone call</option>
                <option value="video_call">Video call</option>
                <option value="in_person">In-person estimate</option>
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Date
              <input data-testid="schedule-estimate-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Start time
              <input data-testid="schedule-estimate-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Duration
              <select data-testid="schedule-estimate-duration" value={duration} onChange={(event) => setDuration(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="30">30 minutes</option>
                <option value="60">1 hour</option>
                <option value="90">1.5 hours</option>
                <option value="120">2 hours</option>
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-800 md:col-span-2">
              Service address / location
              <input data-testid="schedule-estimate-location" value={serviceLocation} onChange={(event) => setServiceLocation(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800 md:col-span-2">
              Notes
              <textarea data-testid="schedule-estimate-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Access notes, call details, or questions to cover" />
            </label>
          </div>

          {!hasContact ? (
            <div data-testid="schedule-estimate-missing-contact" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
              Add an email or phone number before scheduling.
            </div>
          ) : null}
          {error ? (
            <div data-testid="schedule-estimate-error" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
              {error}
            </div>
          ) : null}

          {result?.appointment ? (
            <div data-testid="schedule-estimate-confirmation" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-sm font-bold text-emerald-950">Estimate Scheduled</div>
              <p className="mt-2 text-sm text-emerald-900">{message}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <ContactActionButton kind="email" href={emailHref} disabledReason="Customer email is not available." testId="schedule-estimate-email-customer">
                  Email Customer
                </ContactActionButton>
                <ContactActionButton kind="call" href={telHref} disabledReason="Customer phone is not available." testId="schedule-estimate-call-customer">
                  Call Customer
                </ContactActionButton>
                <ContactActionButton kind="text" href={smsHref} disabledReason="Customer phone is not available." testId="schedule-estimate-text-customer">
                  Text Customer
                </ContactActionButton>
                <button type="button" onClick={copyMessage} data-testid="schedule-estimate-copy-message" className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100">
                  <Copy size={14} />
                  {copied ? "Copied" : "Copy Message"}
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Close
            </button>
            <button
              type="submit"
              data-testid="schedule-estimate-submit"
              disabled={loading || Boolean(result?.appointment)}
              className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Scheduling..." : result?.appointment ? "Scheduled" : "Schedule Estimate"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function crewPreviewSourceForRow(row) {
  if (!row) return null;
  const linkedAgreementId = row.linked_agreement_id || row.agreement_id;
  if (linkedAgreementId) {
    return { source_type: "agreement", source_id: Number(linkedAgreementId) };
  }
  const sourceKind = normalize(row.source_kind);
  if (sourceKind === "quote_request" || sourceKind === "lead") return null;
  const sourceId = row.source_id || row.opportunity_id || row.id;
  if (!sourceId) return null;
  return { source_type: "opportunity", source_id: Number(sourceId) };
}

function AdvisoryCrewPanel({ preview, loading, error, onCreateDraft, creatingDraft, draftError }) {
  const required = Array.isArray(preview?.required_capabilities) ? preview.required_capabilities : [];
  const members = Array.isArray(preview?.recommended_members) ? preview.recommended_members : [];
  const gaps = Array.isArray(preview?.gaps) ? preview.gaps : [];
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
  const canCreateDraft = Boolean(preview && !loading && !error);

  return (
    <div
      className="rounded-xl border border-slate-200 bg-slate-50 p-4"
      data-testid="recommended-crew-panel"
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Advisory
          </div>
          <div className="mt-1 text-base font-bold text-slate-900">Recommended Crew</div>
          <div className="mt-1 text-sm text-slate-700">
            {preview?.advisory_notice ||
              "Recommended Crew is advisory only. Review before assigning work."}
          </div>
        </div>
        {canCreateDraft ? (
          <button
            type="button"
            data-testid="assignment-draft-create"
            onClick={onCreateDraft}
            disabled={creatingDraft}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ClipboardList size={16} />
            {creatingDraft ? "Creating draft..." : "Create assignment draft"}
          </button>
        ) : null}
      </div>

      {draftError ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {draftError}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-4 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-700">Loading crew preview...</div>
      ) : error ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {error}
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Needed Capabilities
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {required.length ? (
                required.map((item) => (
                  <span
                    key={`${item.skill_name}-${item.quantity}`}
                    className="inline-flex rounded-full border border-white bg-white px-3 py-1 text-xs font-semibold text-slate-800 shadow-sm"
                  >
                    {item.quantity || 1}x {item.skill_name}
                  </span>
                ))
              ) : (
                <span className="text-sm text-slate-600">No capability needs detected yet.</span>
              )}
            </div>

            <div className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Skill Gaps
            </div>
            <div className="mt-2 space-y-2">
              {gaps.length ? (
                gaps.map((gap) => (
                  <div key={`${gap.skill_name}-${gap.missing_quantity}`} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-amber-900">
                    Missing {gap.missing_quantity} {gap.skill_name}
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-emerald-800">
                  No capability gaps found from current employee data.
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Suggested Employees
            </div>
            <div className="mt-2 space-y-2">
              {members.length ? (
                members.map((member) => (
                  <div key={`${member.subaccount_id}-${member.matched_skill_id}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                    <div className="font-semibold text-slate-900">{member.display_name}</div>
                    <div className="mt-1 text-slate-600">
                      {member.matched_skill_name} - {member.skill_level_label}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{member.explanation}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                  No matching employees found yet.
                </div>
              )}
            </div>

            {warnings.length ? (
              <>
                <div className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Warnings
                </div>
                <div className="mt-2 space-y-2">
                  {warnings.slice(0, 4).map((warning, index) => (
                    <div key={`${warning.type}-${index}`} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-amber-900">
                      {warning.message}
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function AssignmentDraftModal({
  draft,
  open,
  onClose,
  validation,
  validationLoading,
  validationError,
  onCheckReadiness,
  onApplyAgreementTargets,
  applyLoading,
  applyError,
  applyResult,
  confirmedSupervisorIds,
  onToggleSupervisorConfirmation,
  selectedMilestoneIds,
  confirmedReplacementMilestoneIds,
  onToggleMilestoneSelection,
  onToggleReplacementConfirmation,
  onApplyMilestoneTargets,
}) {
  if (!open || !draft) return null;
  const required = Array.isArray(draft.required_capabilities) ? draft.required_capabilities : [];
  const members = Array.isArray(draft.recommended_members) ? draft.recommended_members : [];
  const gaps = Array.isArray(draft.gaps) ? draft.gaps : [];
  const warnings = Array.isArray(draft.warnings) ? draft.warnings : [];
  const plan = draft.assignment_plan || {};
  const agreementTargets = Array.isArray(plan.suggested_agreement_assignments) ? plan.suggested_agreement_assignments : [];
  const milestoneTargets = Array.isArray(plan.suggested_milestone_assignments) ? plan.suggested_milestone_assignments : [];
  const source = draft.source_summary || {};
  const blockers = Array.isArray(validation?.blocking_issues) ? validation.blocking_issues : [];
  const validationWarnings = Array.isArray(validation?.warnings) ? validation.warnings : [];
  const requiredConfirmations = Array.isArray(validation?.required_confirmations) ? validation.required_confirmations : [];
  const safeTargets = Array.isArray(validation?.safe_targets) ? validation.safe_targets : [];
  const agreementValidationRows = Array.isArray(validation?.selected_targets?.agreement_assignments)
    ? validation.selected_targets.agreement_assignments
    : [];
  const agreementBlockers = agreementValidationRows.flatMap((target) => target.blocking_issues || []);
  const milestoneValidationRows = Array.isArray(validation?.selected_targets?.milestone_assignments)
    ? validation.selected_targets.milestone_assignments
    : [];
  const milestoneRowsById = new Map(milestoneValidationRows.map((target) => [Number(target.milestone_id), target]));
  const selectedMilestoneSet = new Set(selectedMilestoneIds || []);
  const confirmedReplacementSet = new Set(confirmedReplacementMilestoneIds || []);
  const agreementConfirmations = requiredConfirmations.filter((item) => item.type === "supervisor_overlap");
  const replacementConfirmations = requiredConfirmations.filter((item) => item.type === "replace_milestone_assignment");
  const confirmedSupervisorSet = new Set(confirmedSupervisorIds || []);
  const hasSafeAgreementTargets = agreementValidationRows.some((target) => target.status === "safe" || target.status === "requires_confirmation");
  const supervisorConfirmationsMet = agreementConfirmations.every((item) => confirmedSupervisorSet.has(Number(item.subaccount_id)));
  const canApplyAgreementTargets =
    Boolean(validation) &&
    hasSafeAgreementTargets &&
    agreementBlockers.length === 0 &&
    supervisorConfirmationsMet &&
    !applyResult?.applied;
  const selectedMilestoneRows = milestoneValidationRows.filter((target) => selectedMilestoneSet.has(Number(target.milestone_id)));
  const selectedMilestoneBlockers = selectedMilestoneRows.flatMap((target) => target.blocking_issues || []);
  const selectedReplacementConfirmations = replacementConfirmations.filter((item) => selectedMilestoneSet.has(Number(item.milestone_id)));
  const replacementConfirmationsMet = selectedReplacementConfirmations.every((item) => confirmedReplacementSet.has(Number(item.milestone_id)));
  const selectedMilestoneSupervisorConfirmations = agreementConfirmations.filter((item) =>
    selectedMilestoneRows.some((target) => Number(target.subaccount_id) === Number(item.subaccount_id))
  );
  const selectedMilestoneSupervisorConfirmationsMet = selectedMilestoneSupervisorConfirmations.every((item) =>
    confirmedSupervisorSet.has(Number(item.subaccount_id))
  );
  const canApplyMilestoneTargets =
    Boolean(validation) &&
    selectedMilestoneRows.length > 0 &&
    selectedMilestoneBlockers.length === 0 &&
    replacementConfirmationsMet &&
    selectedMilestoneSupervisorConfirmationsMet;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        aria-label="Close assignment draft backdrop"
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assignment-draft-title"
        data-testid="assignment-draft-modal"
        className="relative flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-slate-200 p-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">Review Only</div>
            <h3 id="assignment-draft-title" className="mt-2 text-2xl font-extrabold text-slate-900">Assignment Draft</h3>
            <div className="mt-2 text-sm text-slate-600">
              {source.project_title || "Crew recommendation"} - {source.source_type || "source"} #{source.source_id || draft.id}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close assignment draft"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600 hover:bg-slate-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
            {draft.advisory_notice || "This draft is advisory only."}
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Apply Readiness</div>
                <div className="mt-1 text-sm text-slate-600">
                  Validation checks employee status, source agreement ownership, conflicts, and milestone replacement risk.
                </div>
              </div>
              <button
                type="button"
                data-testid="assignment-draft-validate-apply"
                onClick={onCheckReadiness}
                disabled={validationLoading}
                className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {validationLoading ? "Checking..." : "Check apply readiness"}
              </button>
            </div>
            {validationError ? (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {validationError}
              </div>
            ) : null}
            {validation ? (
              <div className="mt-3 grid gap-3 lg:grid-cols-4" data-testid="assignment-draft-validation-results">
                <div className={`rounded-lg border px-3 py-2 text-sm ${validation.apply_ready ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                  <div className="text-xs font-semibold uppercase tracking-[0.14em]">Status</div>
                  <div className="mt-1 font-semibold">{validation.apply_ready ? "Ready later" : "Needs review"}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em]">Safe Rows</div>
                  <div className="mt-1 font-semibold">{safeTargets.length}</div>
                </div>
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em]">Blockers</div>
                  <div className="mt-1 font-semibold">{blockers.length}</div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em]">Confirmations</div>
                  <div className="mt-1 font-semibold">{requiredConfirmations.length}</div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <SectionCard title="Crew Needs" testId="assignment-draft-needs">
              <div className="flex flex-wrap gap-2">
                {required.length ? (
                  required.map((item) => (
                    <span key={`${item.skill_name}-${item.quantity}`} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-800">
                      {item.quantity || 1}x {item.skill_name}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-slate-600">No capability needs detected.</span>
                )}
              </div>
            </SectionCard>

            <SectionCard title="Suggested Employees" testId="assignment-draft-members">
              <div className="space-y-2">
                {members.length ? (
                  members.map((member) => (
                    <div key={`${member.subaccount_id}-${member.matched_skill_id}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                      <div className="font-semibold text-slate-900">{member.display_name}</div>
                      <div className="mt-1 text-slate-600">{member.matched_skill_name} - {member.skill_level_label}</div>
                      <div className="mt-1 text-xs text-slate-500">{member.explanation}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-slate-600">No suggested employees in this draft.</div>
                )}
              </div>
            </SectionCard>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <SectionCard title="Proposed Agreement Targets" testId="assignment-draft-agreement-targets">
              <div className="space-y-2">
                {agreementTargets.length ? (
                  agreementTargets.map((target) => (
                    <div key={`agreement-${target.subaccount_id}-${target.target_type}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                      <div className="font-semibold text-slate-900">{target.display_name}</div>
                      <div className="mt-1 text-slate-600">
                        {target.target_type === "agreement" ? "Agreement-level assignment" : "Future agreement assignment"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{target.reason}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-slate-600">No agreement-level targets suggested.</div>
                )}
              </div>
            </SectionCard>

            <SectionCard title="Proposed Milestone Targets" testId="assignment-draft-milestone-targets">
              <div className="space-y-2">
                {milestoneTargets.length ? (
                  milestoneTargets.map((target) => (
                    <div key={`milestone-${target.milestone_id}-${target.subaccount_id}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                      <div className="flex items-start gap-2">
                        {validation ? (
                          <input
                            type="checkbox"
                            data-testid={`assignment-draft-milestone-select-${target.milestone_id}`}
                            className="mt-1"
                            checked={selectedMilestoneSet.has(Number(target.milestone_id))}
                            onChange={() => onToggleMilestoneSelection(Number(target.milestone_id))}
                          />
                        ) : null}
                        <div>
                          <div className="font-semibold text-slate-900">{target.milestone_title}</div>
                          <div className="mt-1 text-slate-600">{target.display_name} - {target.matched_skill_name}</div>
                          <div className="mt-1 text-xs text-slate-500">{target.reason}</div>
                          {milestoneRowsById.get(Number(target.milestone_id))?.status ? (
                            <div className="mt-1 text-xs font-semibold text-slate-600">
                              Status: {milestoneRowsById.get(Number(target.milestone_id)).status.replaceAll("_", " ")}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-slate-600">No safe milestone-level targets suggested yet.</div>
                )}
              </div>
            </SectionCard>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <SectionCard title="Gaps" testId="assignment-draft-gaps">
              <div className="space-y-2">
                {gaps.length ? gaps.map((gap) => (
                  <div key={`${gap.skill_name}-${gap.missing_quantity}`} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-amber-900">
                    Missing {gap.missing_quantity} {gap.skill_name}
                  </div>
                )) : <div className="text-sm text-slate-600">No capability gaps recorded.</div>}
              </div>
            </SectionCard>

            <SectionCard title="Warnings" testId="assignment-draft-warnings">
              <div className="space-y-2">
                {warnings.length ? warnings.map((warning, index) => (
                  <div key={`${warning.type}-${index}`} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-amber-900">
                    {warning.message}
                  </div>
                )) : <div className="text-sm text-slate-600">No warnings recorded.</div>}
              </div>
            </SectionCard>
          </div>

          {validation ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <SectionCard title="Safe Rows" testId="assignment-draft-safe-rows">
                <div className="space-y-2">
                  {safeTargets.length ? safeTargets.map((target) => (
                    <div key={target.target_key} className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-emerald-800">
                      {target.target_type} - {target.target_key}
                    </div>
                  )) : <div className="text-sm text-slate-600">No safe rows yet.</div>}
                </div>
              </SectionCard>

              <SectionCard title="Apply Blockers" testId="assignment-draft-blockers">
                <div className="space-y-2">
                  {blockers.length ? blockers.map((issue, index) => (
                    <div key={`${issue.type}-${index}`} className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm text-rose-800">
                      {issue.message}
                    </div>
                  )) : <div className="text-sm text-slate-600">No blocking issues found.</div>}
                </div>
              </SectionCard>

              <SectionCard title="Confirmations" testId="assignment-draft-confirmations">
                <div className="space-y-2">
                  {requiredConfirmations.length ? requiredConfirmations.map((item, index) => (
                    <div key={`${item.type}-${index}`} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-amber-900">
                      {item.message}
                      {item.type === "supervisor_overlap" && item.subaccount_id ? (
                        <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-amber-950">
                          <input
                            type="checkbox"
                            checked={confirmedSupervisorSet.has(Number(item.subaccount_id))}
                            onChange={() => onToggleSupervisorConfirmation(Number(item.subaccount_id))}
                          />
                          Confirm supervisor overlap
                        </label>
                      ) : null}
                      {item.type === "replace_milestone_assignment" && item.milestone_id ? (
                        <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-amber-950">
                          <input
                            type="checkbox"
                            data-testid={`assignment-draft-replace-confirm-${item.milestone_id}`}
                            checked={confirmedReplacementSet.has(Number(item.milestone_id))}
                            onChange={() => onToggleReplacementConfirmation(Number(item.milestone_id))}
                          />
                          Confirm milestone replacement
                        </label>
                      ) : null}
                    </div>
                  )) : <div className="text-sm text-slate-600">No extra confirmations required.</div>}
                </div>
              </SectionCard>
            </div>
          ) : null}

          {validationWarnings.length ? (
            <SectionCard title="Validation Warnings" testId="assignment-draft-validation-warnings" className="mt-4">
              <div className="space-y-2">
                {validationWarnings.slice(0, 6).map((warning, index) => (
                  <div key={`${warning.type}-${index}`} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-amber-900">
                    {warning.message}
                  </div>
                ))}
              </div>
            </SectionCard>
          ) : null}

          {applyError ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {applyError}
            </div>
          ) : null}

          {applyResult ? (
            <SectionCard title="Apply Result" testId="assignment-draft-apply-result" className="mt-4">
              <div className="space-y-2 text-sm">
                <div className={applyResult.applied ? "font-semibold text-emerald-800" : "font-semibold text-amber-900"}>
                  {applyResult.message || (applyResult.applied ? "Agreement-level assignments applied." : "Assignments were not applied.")}
                </div>
                <div className="text-slate-600">
                  Agreement applied {Array.isArray(applyResult.applied_targets) ? applyResult.applied_targets.length : 0}; milestone applied {Array.isArray(applyResult.milestone_targets?.applied) ? applyResult.milestone_targets.applied.length : 0}.
                </div>
                {Array.isArray(applyResult.applied_targets) && applyResult.applied_targets.length ? (
                  <div className="space-y-1">
                    {applyResult.applied_targets.map((target) => (
                      <div key={target.target_key || target.assignment_id} className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-emerald-800">
                        {target.display_name} assigned to agreement #{target.agreement_id}
                      </div>
                    ))}
                  </div>
                ) : null}
                {Array.isArray(applyResult.skipped_targets) && applyResult.skipped_targets.length ? (
                  <div className="space-y-1">
                    {applyResult.skipped_targets.map((target) => (
                      <div key={target.target_key || target.assignment_id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700">
                        {target.display_name || "Target"} skipped: {target.reason || "Already handled."}
                      </div>
                    ))}
                  </div>
                ) : null}
                {Array.isArray(applyResult.milestone_targets?.applied) && applyResult.milestone_targets.applied.length ? (
                  <div className="space-y-1">
                    {applyResult.milestone_targets.applied.map((target) => (
                      <div key={target.target_key || target.assignment_id} className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-emerald-800">
                        {target.display_name} assigned to {target.milestone_title}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </SectionCard>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4">
          <div className="mr-auto text-xs font-semibold text-slate-600">
            This will create assignment records and appear on team calendars.
          </div>
          <button
            type="button"
            data-testid="assignment-draft-apply-agreement"
            onClick={onApplyAgreementTargets}
            disabled={!canApplyAgreementTargets || applyLoading}
            title="This will create assignment records and appear on team calendars."
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applyLoading ? "Applying..." : "Apply agreement assignments"}
          </button>
          <button
            type="button"
            data-testid="assignment-draft-apply-milestones"
            onClick={onApplyMilestoneTargets}
            disabled={!canApplyMilestoneTargets || applyLoading}
            title="This will update milestone assignment records and calendar-facing views."
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applyLoading ? "Applying..." : "Apply selected milestones"}
          </button>
          <button
            type="button"
            data-testid="assignment-draft-apply-disabled"
            disabled
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-500"
          >
            {draft.apply_disabled_reason || "Apply coming soon."}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ContractorBidsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const mountedRef = useRef(true);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [selectedRow, setSelectedRow] = useState(null);
  const [detailTab, setDetailTab] = useState("overview");
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
  const [crewPreview, setCrewPreview] = useState(null);
  const [crewPreviewLoading, setCrewPreviewLoading] = useState(false);
  const [crewPreviewError, setCrewPreviewError] = useState("");
  const [assignmentDraft, setAssignmentDraft] = useState(null);
  const [assignmentDraftOpen, setAssignmentDraftOpen] = useState(false);
  const [assignmentDraftLoading, setAssignmentDraftLoading] = useState(false);
  const [assignmentDraftError, setAssignmentDraftError] = useState("");
  const [assignmentDraftValidation, setAssignmentDraftValidation] = useState(null);
  const [assignmentDraftValidationLoading, setAssignmentDraftValidationLoading] = useState(false);
  const [assignmentDraftValidationError, setAssignmentDraftValidationError] = useState("");
  const [assignmentDraftApplyLoading, setAssignmentDraftApplyLoading] = useState(false);
  const [assignmentDraftApplyError, setAssignmentDraftApplyError] = useState("");
  const [assignmentDraftApplyResult, setAssignmentDraftApplyResult] = useState(null);
  const [confirmedSupervisorIds, setConfirmedSupervisorIds] = useState([]);
  const [selectedMilestoneIds, setSelectedMilestoneIds] = useState([]);
  const [confirmedReplacementMilestoneIds, setConfirmedReplacementMilestoneIds] = useState([]);
  const [scheduleEstimateOpen, setScheduleEstimateOpen] = useState(false);

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
    if (selectedRow) setDetailTab("overview");
  }, [selectedRow?.bid_id]);

  useEffect(() => {
    setCrewPreview(null);
    setCrewPreviewError("");
    setCrewPreviewLoading(false);
    setAssignmentDraft(null);
    setAssignmentDraftOpen(false);
    setAssignmentDraftError("");
    setAssignmentDraftValidation(null);
    setAssignmentDraftValidationError("");
    setAssignmentDraftApplyError("");
    setAssignmentDraftApplyResult(null);
    setConfirmedSupervisorIds([]);
    setSelectedMilestoneIds([]);
    setConfirmedReplacementMilestoneIds([]);
  }, [selectedRow?.bid_id, selectedRow?.source_id, selectedRow?.linked_agreement_id]);

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
  const selectedLifecycle = lifecycleStatus(selectedRow);
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
      : selectedLifecycle.label === "Estimate Scheduled"
      ? "View Appointment"
      : selectedStage === "new_lead" || selectedStage === "follow_up"
      ? "Schedule Estimate"
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
      : selectedLifecycle.label === "Estimate Scheduled"
      ? "Review the scheduled estimate details, then follow up with the customer if anything changes."
      : selectedStage === "new_lead"
      ? "Schedule the estimate first so scope, timing, and pricing are grounded before conversion."
      : selectedStage === "follow_up"
        ? "Resume customer follow-up and schedule or complete the estimate before conversion."
        : selectedStage === "closed"
          ? "This opportunity is closed, but you can still review the history."
          : "Continue the current bid workflow from here.";
  const selectedCreateBidActionLabel =
    selectedStage === "new_lead" || selectedStage === "follow_up"
      ? "Send Estimate Response"
      : selectedPrimaryActionLabel;
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
  const selectedDescriptionBullets = useMemo(
    () => splitDescriptionBullets(selectedProjectDescription),
    [selectedProjectDescription]
  );
  const selectedTimeline = firstPresent(selectedSnapshot?.timeline, selectedRow?.timeline);
  const selectedCustomerEmail = String(selectedRow?.customer_email || selectedSnapshot?.customer_email || "").trim();
  const selectedCustomerPhone = String(selectedRow?.customer_phone || selectedSnapshot?.customer_phone || "").trim();
  const selectedResponseSubject = `Re: ${selectedRow?.project_title || "Your project request"}`;
  const selectedResponseMessage = selectedResponseStarter || "Thanks for sharing your project details. I will review the request and follow up with next steps.";
  const selectedEmailHref = buildEmailHref(selectedCustomerEmail, selectedResponseSubject, selectedResponseMessage);
  const selectedTelHref = selectedCustomerPhone ? `tel:${selectedCustomerPhone}` : "";
  const selectedSmsHref = buildSmsHref(selectedCustomerPhone, selectedResponseMessage);
  const selectedScheduleSource = scheduleSourceForRow(selectedRow);
  const selectedCanScheduleEstimate = Boolean(selectedScheduleSource && (selectedCustomerEmail || selectedCustomerPhone));
  const selectedScheduleDisabledReason = !selectedScheduleSource
    ? "This opportunity is missing source data for scheduling."
    : !(selectedCustomerEmail || selectedCustomerPhone)
      ? "Customer email or phone is required before scheduling."
      : "";
  const selectedAvailability = useMemo(
    () =>
      buildAvailabilitySummary({
        row: selectedRow,
        lifecycle: selectedLifecycle,
        canScheduleEstimate: selectedCanScheduleEstimate,
      }),
    [selectedCanScheduleEstimate, selectedLifecycle, selectedRow]
  );
  const selectedPlanningGuidance = useMemo(
    () =>
      buildPlanningGuidance({
        projectIntelligence: selectedProjectIntelligence,
        projectSetup: selectedProjectSetup,
        snapshot: selectedSnapshot,
        row: selectedRow,
      }),
    [selectedProjectIntelligence, selectedProjectSetup, selectedRow, selectedSnapshot]
  );
  const selectedChecklistItems = useMemo(() => {
    const items = [];
    const signalSet = new Set((Array.isArray(selectedSignals) ? selectedSignals : []).map(normalize));
    const hasScope = Boolean(selectedProjectDescription);
    const hasContact = Boolean(selectedCustomerEmail || selectedCustomerPhone);
    const hasBudget = Boolean(selectedSnapshot?.budget || selectedRow?.budget_text || selectedRow?.bid_amount_label);
    const hasTiming = Boolean(selectedTimeline || signalSet.has("timeline provided"));
    const hasMeasurements = Boolean(selectedSnapshot?.measurement_handling || signalSet.has("measurements noted"));
    items.push({ key: "scope", label: "Scope reviewed", complete: hasScope });
    items.push({ key: "contact", label: "Customer contact available", complete: hasContact });
    items.push({ key: "budget", label: "Budget or estimate basis available", complete: hasBudget });
    items.push({ key: "timing", label: "Timeline reviewed", complete: hasTiming });
    if (normalize(selectedSnapshot?.measurement_handling) === "site visit required") {
      items.push({ key: "measurements", label: "Measurements or site visit acknowledged", complete: hasMeasurements });
    }
    return items;
  }, [
    selectedCustomerEmail,
    selectedCustomerPhone,
    selectedProjectDescription,
    selectedRow?.bid_amount_label,
    selectedRow?.budget_text,
    selectedSignals,
    selectedSnapshot,
    selectedTimeline,
  ]);
  const selectedChecklistComplete = selectedChecklistItems.every((item) => item.complete);
  const detailTabs = [
    { key: "overview", label: "Overview" },
    { key: "project", label: "Project Details" },
    { key: "next", label: "Next Steps" },
    { key: "history", label: "Activity" },
  ];
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
    if (stage === "new_lead") return "Schedule Estimate";
    if (stage === "follow_up") return "Send Estimate Response";
    if (stage === "closed") return "View Details";
    if (normalize(row?.next_action?.key) === "open_agreement" && row?.linked_agreement_url) return "Open Agreement";
    if (stage === "active_bid") return "Send Estimate Response";
    return row?.next_action?.label || "View Details";
  };

  const closeDrawer = () => {
    setSelectedRow(null);
    setConvertPanelOpen(false);
    setScheduleEstimateOpen(false);
    setAssignmentDraft(null);
    setAssignmentDraftOpen(false);
    setAssignmentDraftError("");
    setAssignmentDraftValidation(null);
    setAssignmentDraftValidationError("");
    setAssignmentDraftApplyError("");
    setAssignmentDraftApplyResult(null);
    setConfirmedSupervisorIds([]);
    setSelectedMilestoneIds([]);
    setConfirmedReplacementMilestoneIds([]);
    setCopiedRefId("");
  };

  const handleEstimateScheduled = (data) => {
    const appointment = data?.appointment;
    if (!appointment) return;
    setSelectedRow((prev) =>
      prev
        ? {
            ...prev,
            latest_estimate_appointment: appointment,
            estimate_scheduled: true,
          }
        : prev
    );
    setRows((prev) =>
      prev.map((row) => {
        const source = scheduleSourceForRow(row);
        if (
          source &&
          source.source_type === appointment.source_type &&
          Number(source.source_id) === Number(appointment.source_id)
        ) {
          return {
            ...row,
            latest_estimate_appointment: appointment,
            estimate_scheduled: true,
          };
        }
        return row;
      })
    );
  };

  const createAssignmentDraft = async () => {
    const source = crewPreviewSourceForRow(selectedRow);
    if (!source) {
      setAssignmentDraftError("Assignment drafts are available after this lead becomes an opportunity or agreement.");
      return;
    }
    setAssignmentDraftLoading(true);
    setAssignmentDraftError("");
    try {
      const { data } = await api.post("/projects/crew-recommendations/drafts/", source);
      setAssignmentDraft(data || null);
      setAssignmentDraftValidation(null);
      setAssignmentDraftValidationError("");
      setAssignmentDraftApplyError("");
      setAssignmentDraftApplyResult(null);
      setConfirmedSupervisorIds([]);
      setSelectedMilestoneIds([]);
      setConfirmedReplacementMilestoneIds([]);
      setAssignmentDraftOpen(true);
      toast.success("Assignment draft created for review.");
    } catch (err) {
      console.error(err);
      setAssignmentDraftError(err?.response?.data?.detail || "Could not create this assignment draft.");
    } finally {
      setAssignmentDraftLoading(false);
    }
  };

  const toggleSupervisorConfirmation = (subaccountId) => {
    setConfirmedSupervisorIds((prev) => {
      const value = Number(subaccountId);
      if (!value) return prev;
      return prev.includes(value) ? prev.filter((id) => id !== value) : [...prev, value];
    });
  };

  const toggleMilestoneSelection = (milestoneId) => {
    setSelectedMilestoneIds((prev) => {
      const value = Number(milestoneId);
      if (!value) return prev;
      return prev.includes(value) ? prev.filter((id) => id !== value) : [...prev, value];
    });
  };

  const toggleReplacementConfirmation = (milestoneId) => {
    setConfirmedReplacementMilestoneIds((prev) => {
      const value = Number(milestoneId);
      if (!value) return prev;
      return prev.includes(value) ? prev.filter((id) => id !== value) : [...prev, value];
    });
  };

  const validateAssignmentDraft = async () => {
    if (!assignmentDraft?.id) return;
    setAssignmentDraftValidationLoading(true);
    setAssignmentDraftValidationError("");
    setAssignmentDraftApplyError("");
    try {
      const { data } = await api.post(`/projects/crew-recommendations/drafts/${assignmentDraft.id}/validate-apply/`, {});
      setAssignmentDraftValidation(data || null);
      setSelectedMilestoneIds([]);
      setConfirmedReplacementMilestoneIds([]);
    } catch (err) {
      console.error(err);
      setAssignmentDraftValidationError(err?.response?.data?.detail || "Could not check apply readiness.");
    } finally {
      setAssignmentDraftValidationLoading(false);
    }
  };

  const applyAssignmentDraft = async () => {
    if (!assignmentDraft?.id) return;
    const confirmed = window.confirm(
      "Apply agreement-level assignments?\n\nThis will create assignment records and appear on team calendars. Milestone assignments are still coming soon."
    );
    if (!confirmed) return;
    setAssignmentDraftApplyLoading(true);
    setAssignmentDraftApplyError("");
    try {
      const { data } = await api.post(`/projects/crew-recommendations/drafts/${assignmentDraft.id}/apply/`, {
        confirmations: {
          supervisor_overlap_subaccount_ids: confirmedSupervisorIds,
        },
        selected_targets: {
          include_milestones: false,
        },
      });
      setAssignmentDraftApplyResult(data || null);
      if (data?.validation) setAssignmentDraftValidation(data.validation);
      setAssignmentDraft((prev) => (prev ? { ...prev, status: data?.status || prev.status, applied_at: data?.applied_at || prev.applied_at } : prev));
      toast.success("Agreement assignments applied.");
    } catch (err) {
      console.error(err);
      const payload = err?.response?.data || {};
      if (payload.validation) setAssignmentDraftValidation(payload.validation);
      setAssignmentDraftApplyResult(payload?.draft_id ? payload : null);
      setAssignmentDraftApplyError(payload?.message || payload?.detail || "Could not apply this assignment draft.");
    } finally {
      setAssignmentDraftApplyLoading(false);
    }
  };

  const applyMilestoneAssignmentDraft = async () => {
    if (!assignmentDraft?.id || !selectedMilestoneIds.length) return;
    const confirmed = window.confirm(
      "Apply selected milestone assignments?\n\nThis will update milestone assignment records and calendar-facing views."
    );
    if (!confirmed) return;
    setAssignmentDraftApplyLoading(true);
    setAssignmentDraftApplyError("");
    try {
      const { data } = await api.post(`/projects/crew-recommendations/drafts/${assignmentDraft.id}/apply/`, {
        confirmations: {
          supervisor_overlap_subaccount_ids: confirmedSupervisorIds,
          replace_milestone_ids: confirmedReplacementMilestoneIds,
        },
        selected_targets: {
          include_agreements: false,
          include_milestones: true,
          milestone_ids: selectedMilestoneIds,
        },
      });
      setAssignmentDraftApplyResult(data || null);
      if (data?.validation) setAssignmentDraftValidation(data.validation);
      setAssignmentDraft((prev) => (prev ? { ...prev, status: data?.status || prev.status, applied_at: data?.applied_at || prev.applied_at } : prev));
      toast.success("Milestone assignments applied.");
    } catch (err) {
      console.error(err);
      const payload = err?.response?.data || {};
      if (payload.validation) setAssignmentDraftValidation(payload.validation);
      setAssignmentDraftApplyResult(payload?.draft_id ? payload : null);
      setAssignmentDraftApplyError(payload?.message || payload?.detail || "Could not apply selected milestone assignments.");
    } finally {
      setAssignmentDraftApplyLoading(false);
    }
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
                <option value="awarded">Ready to Convert</option>
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
              const lifecycle = lifecycleStatus(row);
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
                        <span
                          data-testid={`lead-lifecycle-${row.bid_id}`}
                          className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${lifecycle.tone}`}
                        >
                          {lifecycle.label}
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
            className="relative flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
              <div className="flex items-start justify-between gap-4 p-5 pb-4">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Opportunity Review</div>
                  <h3 id="opportunity-review-title" className="mt-2 truncate text-2xl font-extrabold text-slate-900">{selectedRow.project_title}</h3>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    <span className="font-semibold text-slate-800">{selectedRow.customer_name}</span>
                    {selectedRow.source_kind_label ? <span>{selectedRow.source_kind_label}</span> : null}
                    <span data-testid="opportunity-review-lifecycle-status">{selectedLifecycle.label}</span>
                  </div>
                </div>
              <button
                type="button"
                aria-label="Close bid details"
                onClick={closeDrawer}
                className="shrink-0 rounded-lg border border-slate-300 bg-white p-2 text-slate-600 hover:bg-slate-50"
              >
                <X size={16} />
              </button>
              </div>

              <div className="flex gap-2 overflow-x-auto bg-slate-50 px-5 py-3" data-testid="opportunity-review-tabs">
                {detailTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    data-testid={`opportunity-review-tab-${tab.key}`}
                    onClick={() => setDetailTab(tab.key)}
                    className={`shrink-0 rounded-lg border px-5 py-2.5 text-sm font-bold transition ${
                      detailTab === tab.key
                        ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-50/70 p-5 sm:p-6" data-testid="lead-detail-container">
              {detailTab === "overview" ? (
                <section
                  data-testid="opportunity-overview-tab-panel"
                  className="space-y-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
                >
                  <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        {selectedRow.source_kind_label ? (
                          <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                            {selectedRow.source_kind_label}
                          </span>
                        ) : null}
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${workspaceStageTone(selectedStage)}`}>
                          {workspaceStageLabel(selectedStage)}
                        </span>
                        <span
                          data-testid="opportunity-overview-lifecycle-status"
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${selectedLifecycle.tone}`}
                        >
                          {selectedLifecycle.label}
                        </span>
                      </div>
                      <div className="mt-4 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Overview</div>
                      <h4 className="mt-2 text-xl font-extrabold text-slate-950">{selectedRow.project_title}</h4>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                        <span className="font-semibold text-slate-900">{selectedRow.customer_name || "Customer unavailable"}</span>
                        <span>{firstPresent(selectedRow.customer_email, selectedRow.customer_phone, "No contact listed")}</span>
                        {selectedServiceLocation ? <span>{selectedServiceLocation}</span> : null}
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
                      <SummaryMetric label={selectedValueDisplay.label} value={selectedValueDisplay.value} tone="emerald" />
                      <SummaryMetric label="Timeline" value={selectedTimeline || "Not provided"} tone="sky" />
                      <SummaryMetric label="Received" value={fmtDate(selectedRow.submitted_at)} />
                    </div>
                  </div>

                  <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
                    <ModalSection title="Scope Summary" testId="overview-scope-summary" subtitle="A quick scan of the customer's request.">
                      {selectedDescriptionBullets.length ? (
                        <ul className="space-y-2 text-sm text-slate-700">
                          {selectedDescriptionBullets.map((item, index) => (
                            <li key={`${item}-${index}`} className="flex gap-2">
                              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                          No project description was provided.
                        </div>
                      )}
                    </ModalSection>

                    <ModalSection title="Recommended Next Action" testId="overview-next-action" subtitle="Primary action stays below for a deliberate click.">
                      <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                        {selectedPrimaryActionLabel}
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{selectedPrimaryActionHint}</p>
                    </ModalSection>
                  </div>

                  <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
                    <ModalSection
                      title="Availability"
                      testId="opportunity-availability-section"
                      subtitle="Existing scheduling and capacity context for deciding whether to pursue this job."
                    >
                      <div className="grid gap-2 sm:grid-cols-2">
                        <InfoRow label="Earliest estimate availability" value={selectedAvailability.estimate} />
                        <InfoRow label="Earliest project availability" value={selectedAvailability.project} />
                        <InfoRow label="Current workload" value={selectedAvailability.workload} />
                        <InfoRow label="Capacity summary" value={selectedAvailability.capacity} />
                      </div>
                      <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900">
                        Project fit: {selectedAvailability.fit}
                      </div>
                    </ModalSection>

                    <ModalSection
                      title="Customer"
                      testId="opportunity-customer-section"
                      subtitle="Contact details and browser-safe outreach actions."
                    >
                      <div className="grid gap-2 sm:grid-cols-2">
                        <InfoRow label="Customer" value={selectedRow.customer_name || "Customer unavailable"} />
                        <InfoRow label="Preferred contact" value={firstPresent(selectedSnapshot.preferred_contact, selectedRow.preferred_contact, "Not provided")} />
                        <InfoRow label="Phone" value={selectedCustomerPhone || "Not provided"} />
                        <InfoRow label="Email" value={selectedCustomerEmail || "Not provided"} />
                      </div>
                      <InfoRow label="Address" value={selectedServiceLocation || "Service address not provided"} testId="opportunity-customer-address" />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <ContactActionButton kind="call" href={selectedTelHref} disabledReason="Customer phone is not available." testId="customer-call-action">
                          Call
                        </ContactActionButton>
                        <ContactActionButton kind="email" href={selectedEmailHref} disabledReason="Customer email is not available." testId="customer-email-action">
                          Email
                        </ContactActionButton>
                        <ContactActionButton kind="text" href={selectedSmsHref} disabledReason="Customer phone is not available." testId="customer-text-action">
                          Text
                        </ContactActionButton>
                        <button
                          type="button"
                          onClick={() =>
                            copyReference(
                              [selectedRow.customer_name, selectedCustomerPhone, selectedCustomerEmail, selectedServiceLocation].filter(Boolean).join("\n"),
                              `${selectedRow.bid_id}-contact`
                            )
                          }
                          data-testid="customer-copy-contact-action"
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Copy size={14} />
                          {copiedRefId === `${selectedRow.bid_id}-contact` ? "Copied" : "Copy Contact"}
                        </button>
                      </div>
                    </ModalSection>
                  </div>

                  <ModalSection
                    title="Planning Guidance"
                    testId="planning-guidance-section"
                    subtitle="Advisory only. This is not a confirmed project plan or staffing recommendation."
                  >
                    <div className="grid gap-2 sm:grid-cols-3">
                      <InfoRow label="Estimated complexity" value={selectedPlanningGuidance.complexity} />
                      <InfoRow label="Estimated trades involved" value={selectedPlanningGuidance.trades} />
                      <InfoRow label="Estimated duration" value={selectedPlanningGuidance.duration} />
                    </div>
                    <div className="mt-3">
                      <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Potential risks</div>
                      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                        {selectedPlanningGuidance.risks.map((risk) => (
                          <li key={risk} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
                            {risk}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </ModalSection>
                </section>
              ) : null}

              <SectionCard
                title="Project Details"
                testId="lead-overview"
                subtitle="The customer's request details, separated from your recommended next steps."
                className={detailTab === "project" ? "" : "hidden"}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailField label="Project Title" value={selectedRow.project_title} />
                  <DetailField label="Customer" value={selectedRow.customer_name || "-"} />
                  <DetailField label="Contact" value={firstPresent(selectedRow.customer_email, selectedRow.customer_phone, "No contact listed")} />
                  <DetailField label="Source" value={selectedRow.source_kind_label || "Lead"} />
                  <DetailField label="Received" value={fmtDate(selectedRow.submitted_at)} />
                  <DetailField label="Lifecycle Status" value={selectedLifecycle.label} />
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
                <div className="mt-4 rounded-xl bg-white px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Project Description</div>
                  {selectedDescriptionBullets.length ? (
                    <ul className="mt-2 space-y-2">
                      {selectedDescriptionBullets.map((item, index) => (
                        <li key={`${item}-${index}`} className="flex gap-2">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-2">No project description was provided.</div>
                  )}
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
                className={detailTab === "overview" || detailTab === "next" ? "" : "hidden"}
              >
                <div
                  data-testid="opportunity-prerequisite-checklist"
                  className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-slate-950">Before conversion</div>
                      <p className="mt-1 text-sm text-slate-600">
                        Review these items before sending an estimate response or converting this request into an agreement.
                      </p>
                    </div>
                    <span
                      data-testid="opportunity-prerequisite-status"
                      className={`rounded-full border px-3 py-1 text-xs font-bold ${
                        selectedChecklistComplete
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-amber-200 bg-amber-50 text-amber-900"
                      }`}
                    >
                      {selectedChecklistComplete ? "Ready" : "Needs review"}
                    </span>
                  </div>
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                    {selectedChecklistItems.map((item) => (
                      <li
                        key={item.key}
                        className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                          item.complete
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                            : "border-amber-200 bg-amber-50 text-amber-950"
                        }`}
                      >
                        {item.complete ? "Complete: " : "Review: "}
                        {item.label}
                      </li>
                    ))}
                  </ul>
                  {!selectedChecklistComplete ? (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
                      Some prerequisites need review before conversion. You can still continue when you have confirmed them outside MyHomeBro.
                    </div>
                  ) : null}
                </div>
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
                      disabled={!selectedCanScheduleEstimate}
                      onClick={() => setScheduleEstimateOpen(true)}
                      className="inline-flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 disabled:shadow-none"
                      title={selectedScheduleDisabledReason || "Schedule an estimate appointment with this customer."}
                    >
                      {selectedLifecycle.label === "Estimate Scheduled" ? "View Appointment" : "Schedule Estimate"}
                      {!selectedCanScheduleEstimate ? <span className="text-xs font-medium">(Unavailable)</span> : null}
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
                      {actionBusyId === String(selectedRow.bid_id) ? "Working..." : selectedCreateBidActionLabel}
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
                className={detailTab === "project" ? "" : "hidden"}
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
                title="Suggested Setup"
                testId="recommended-setup-section"
                subtitle="Advisory only. Use this as a starting point while you confirm scope, pricing, and agreement details."
                className={detailTab === "project" ? "" : "hidden"}
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
                  className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950"
                >
                  {selectedProjectSetup.recommendationNote ||
                    "This is a suggested setup only. Confirm project details before using it to shape an estimate or agreement."}
                </div>
              </SectionCard>

              <SectionCard
                title="Photos and Reference Images"
                testId="photos-section"
                subtitle="Visual context helps the contractor understand scope faster."
                className={detailTab === "project" ? "" : "hidden"}
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
                className={detailTab === "project" ? "" : "hidden"}
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
                  className={detailTab === "next" ? "" : "hidden"}
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
                  className={detailTab === "next" ? "" : "hidden"}
                >
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                    {selectedResponseStarter}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <ContactActionButton
                      kind="email"
                      href={selectedEmailHref}
                      disabledReason="Customer email is not available."
                      testId="response-starter-email-action"
                      onClick={() => copyReference(selectedResponseStarter, `${selectedRow.bid_id}-starter-email`)}
                    >
                      Email Customer
                    </ContactActionButton>
                    <ContactActionButton
                      kind="call"
                      href={selectedTelHref}
                      disabledReason="Customer phone is not available."
                      testId="response-starter-call-action"
                    >
                      Call Customer
                    </ContactActionButton>
                    <ContactActionButton
                      kind="text"
                      href={selectedSmsHref}
                      disabledReason="Customer phone is not available."
                      testId="response-starter-text-action"
                      onClick={() => copyReference(selectedResponseStarter, `${selectedRow.bid_id}-starter-text`)}
                    >
                      Text Customer
                    </ContactActionButton>
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
                  className={detailTab === "next" ? "" : "hidden"}
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
                            <ContactActionButton
                              kind="email"
                              href={buildEmailHref(selectedCustomerEmail, selectedResponseSubject, template.text)}
                              disabledReason="Customer email is not available."
                              testId={`response-template-email-${template.key}`}
                              onClick={() => copyReference(template.text, `${copyId}-email`)}
                            >
                              Email
                            </ContactActionButton>
                            <ContactActionButton
                              kind="call"
                              href={selectedTelHref}
                              disabledReason="Customer phone is not available."
                              testId={`response-template-call-${template.key}`}
                            >
                              Call
                            </ContactActionButton>
                            <ContactActionButton
                              kind="text"
                              href={buildSmsHref(selectedCustomerPhone, template.text)}
                              disabledReason="Customer phone is not available."
                              testId={`response-template-text-${template.key}`}
                              onClick={() => copyReference(template.text, `${copyId}-text`)}
                            >
                              Text
                            </ContactActionButton>
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
                className={detailTab === "history" ? "" : "hidden"}
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

              <SectionCard title="Internal Notes" testId="lead-notes-section" className={detailTab === "history" ? "" : "hidden"}>
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

              <div data-testid="opportunity-activity-timeline" className={`mt-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 ${detailTab === "history" ? "" : "hidden"}`}>
                <div className="text-sm font-bold text-slate-950">Activity Timeline</div>
                <p className="mt-1 text-sm text-slate-600">Current opportunity activity from existing request data.</p>
                <div className="mt-4 flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Reference</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{selectedRow.source_reference || "No reference available"}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyReference(selectedRow.source_reference, selectedRow.bid_id)}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Copy size={14} />
                    {copiedRefId === String(selectedRow.bid_id) ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="mt-4 rounded-xl border border-dashed border-sky-300 bg-sky-50 px-4 py-5 text-sm text-sky-900">
                  Status-change history is not available yet. Customer request signals, notes, and reference details are shown above for review.
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
      <ScheduleEstimateModal
        row={selectedRow}
        open={scheduleEstimateOpen && Boolean(selectedRow)}
        onClose={() => setScheduleEstimateOpen(false)}
        onScheduled={handleEstimateScheduled}
      />
      <AssignmentDraftModal
        draft={assignmentDraft}
        open={assignmentDraftOpen}
        onClose={() => setAssignmentDraftOpen(false)}
        validation={assignmentDraftValidation}
        validationLoading={assignmentDraftValidationLoading}
        validationError={assignmentDraftValidationError}
        onCheckReadiness={validateAssignmentDraft}
        onApplyAgreementTargets={applyAssignmentDraft}
        applyLoading={assignmentDraftApplyLoading}
        applyError={assignmentDraftApplyError}
        applyResult={assignmentDraftApplyResult}
        confirmedSupervisorIds={confirmedSupervisorIds}
        onToggleSupervisorConfirmation={toggleSupervisorConfirmation}
        selectedMilestoneIds={selectedMilestoneIds}
        confirmedReplacementMilestoneIds={confirmedReplacementMilestoneIds}
        onToggleMilestoneSelection={toggleMilestoneSelection}
        onToggleReplacementConfirmation={toggleReplacementConfirmation}
        onApplyMilestoneTargets={applyMilestoneAssignmentDraft}
      />
      </div>
    </ContractorPageSurface>
  );
}



