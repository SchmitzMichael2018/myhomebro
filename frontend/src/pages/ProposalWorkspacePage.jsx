import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Camera, Check, CheckCircle2, Circle, FileSignature, FileUp, Lock, Mail, Mic, Phone, Plus, Ruler, Save, ShieldCheck, StickyNote, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";

import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import { writeSessionAssistantHandoff } from "../lib/assistantHandoff.js";

const WORKFLOW_GROUPS = [
  {
    key: "project",
    label: "Project",
    purpose: "Confirm who the project is for, where it is, and when the work may occur.",
    sections: [
      ["customer", "Customer & Contact"],
      ["appointment", "Appointment"],
      ["scheduling", "Scheduling"],
    ],
  },
  {
    key: "site_scope",
    label: "Site & Scope",
    purpose: "Gather the information needed to understand and define the work.",
    sections: [
      ["site", "Site Access"],
      ["measurements", "Measurements"],
      ["photos", "Photos"],
      ["documents", "Documents"],
      ["clarifications", "Clarifications"],
      ["scope", "Scope Notes"],
    ],
  },
  {
    key: "pricing",
    label: "Pricing",
    purpose: "Build the cost of the job and account for pricing adjustments.",
    sections: [
      ["estimate", "Estimate Pricing"],
      ["incidentals", "Incidentals & Allowances"],
    ],
  },
  {
    key: "review",
    label: "Review",
    purpose: "Confirm the estimate is complete and prepare it for agreement conversion.",
    sections: [
      ["ready", "Ready for Agreement"],
      ["notes", "Notes"],
      ["history", "History"],
    ],
  },
];

const NAV = [["overview", "Project Overview"], ...WORKFLOW_GROUPS.flatMap((group) => group.sections)];

const SECTION_DESCRIPTIONS = {
  overview: "Confirm required readiness, missing items, and the next action before turning estimate work into an agreement.",
  assistant: "Use compact Project Assistant guidance to choose a template, review blockers, and keep contractor approval in control.",
  clarifications: "Resolve template-driven questions before the estimate becomes agreement language.",
  appointment: "Review the estimate appointment linked to this workspace.",
  customer: "Verify the customer, contact information, and project address used for agreement prefill.",
  scheduling: "Capture start, completion, and priority expectations for planning context.",
  site: "Record access details, site conditions, risks, and customer requests from the visit.",
  measurements: "Add quantities and notes that support scope and pricing.",
  photos: "Upload jobsite photos that document existing conditions and estimate context.",
  documents: "Attach plans, receipts, customer files, or supporting estimate documents.",
  estimate: "Build the labor, materials, equipment, subcontractor costs, and adjustments that make up this estimate.",
  incidentals: "Review the reserve, allowances, tax, discount, and other pricing adjustments already represented in this estimate.",
  scope: "Write included work, exclusions, assumptions, and allowances for agreement review.",
  ready: "Review remaining blockers and open the existing Agreement Wizard when minimum readiness is met.",
  notes: "Keep internal contractor notes that do not become customer-facing agreement terms automatically.",
  history: "Review estimate activity, updates, revisions, and conversion events.",
};

const ESTIMATE_PRIMARY_GOLD_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-amber-300 px-3 py-2 text-sm font-black text-slate-950 shadow-sm hover:bg-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100 active:translate-y-px active:bg-amber-500 disabled:cursor-not-allowed disabled:bg-amber-200/55 disabled:text-slate-600";

const EMPTY_MEASUREMENT = {
  label: "",
  location: "",
  quantity: "",
  unit: "",
  notes: "",
};

const EMPTY_LINE_ITEM = {
  category: "labor",
  description: "",
  quantity: "1",
  unit: "",
  unit_price: "",
  notes: "",
};

const LINE_ITEM_CATEGORIES = [
  ["labor", "Labor"],
  ["materials", "Materials"],
  ["equipment", "Equipment"],
  ["subcontractor", "Subcontractor"],
  ["incidentals_reserve", "Incidentals Reserve"],
  ["tax", "Tax"],
  ["discount", "Discount"],
  ["allowance", "Allowance"],
  ["other", "Other"],
];

const COST_CATEGORY_VALUES = new Set(["labor", "materials", "equipment", "subcontractor", "other"]);
const PRICING_ADJUSTMENT_VALUES = new Set(["allowance", "incidentals_reserve", "tax", "discount"]);

const PROJECT_START_OPTIONS = [
  ["asap", "ASAP"],
  ["specific_date", "Specific Date"],
  ["flexible", "Flexible"],
];

const PROJECT_COMPLETION_OPTIONS = [
  ["no_deadline", "No Deadline"],
  ["specific_date", "Specific Date"],
  ["flexible", "Flexible"],
];

const SCHEDULING_PRIORITY_OPTIONS = [
  ["flexible", "Flexible"],
  ["preferred", "Preferred"],
  ["required", "Required"],
];

const WALKTHROUGH_CHECKLIST = [
  "Exterior reviewed",
  "Interior reviewed",
  "Measurements complete",
  "Photos complete",
  "Customer requests documented",
  "Existing damage documented",
];

const FALLBACK_TEMPLATE_QUESTIONS = [
  {
    key: "square_footage",
    label: "Square footage",
    question: "What square footage or quantity should the estimate use?",
    section: "measurements",
    keywords: ["sq ft", "square", "footage", "area"],
  },
  {
    key: "material_responsibility",
    label: "Material responsibility",
    question: "Who is responsible for supplying finish materials, fixtures, or specialty items?",
    section: "site",
    keywords: ["material", "fixture", "customer supplied", "contractor supplied", "preserve"],
  },
  {
    key: "customer_scheduling",
    label: "Customer scheduling",
    question: "What start, completion, and priority expectations should planning use?",
    section: "scheduling",
    keywords: ["timeline", "schedule", "start", "completion", "priority", "urgent", "asap"],
  },
  {
    key: "permit_responsibility",
    label: "Permit responsibility",
    question: "Are permits, HOA approvals, or inspections required, and who handles them?",
    section: "scope",
    keywords: ["permit", "hoa", "inspection", "approval"],
  },
  {
    key: "existing_condition_photos",
    label: "Existing condition photos",
    question: "Are existing condition photos captured for the areas affected by the work?",
    section: "photos",
    keywords: ["photo", "damage", "existing condition", "before"],
  },
];

function field(value, fallback = "-") {
  return value == null || value === "" ? fallback : String(value);
}

function customerAddress(customer) {
  return [
    customer?.street_address,
    customer?.address_line_2,
    customer?.city,
    customer?.state,
    customer?.zip_code,
  ].filter(Boolean).join(", ");
}

function money(value) {
  const num = Number(value || 0);
  return Number.isFinite(num)
    ? num.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "$0.00";
}

function moneyToNumber(value) {
  const amount = Number.parseFloat(String(value || "0").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
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

function optionLabel(options, value) {
  return options.find(([key]) => key === value)?.[1] || field(value);
}

function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return String(value);
  }
}

function proposalScheduleSummary(source = {}) {
  const startType = source.project_start_type || "flexible";
  const completionType = source.project_completion_type || "no_deadline";
  const priority = source.scheduling_priority || "flexible";
  const start = startType === "specific_date" && source.project_start_date
    ? `${optionLabel(PROJECT_START_OPTIONS, startType)}: ${formatDate(source.project_start_date)}`
    : optionLabel(PROJECT_START_OPTIONS, startType);
  const completion = completionType === "specific_date" && source.project_completion_date
    ? `${optionLabel(PROJECT_COMPLETION_OPTIONS, completionType)}: ${formatDate(source.project_completion_date)}`
    : optionLabel(PROJECT_COMPLETION_OPTIONS, completionType);
  return `Start ${start}; completion ${completion}; priority ${optionLabel(SCHEDULING_PRIORITY_OPTIONS, priority)}`;
}

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  if (["ready", "sent", "viewed", "accepted", "converted"].includes(value)) return "border-emerald-200/35 bg-emerald-400/12 text-emerald-100";
  if (["site_visit", "in_progress", "revision_requested"].includes(value)) return "border-amber-200/35 bg-amber-400/12 text-amber-100";
  if (["declined", "expired"].includes(value)) return "border-rose-200/35 bg-rose-400/12 text-rose-100";
  return "border-white/14 bg-white/8 text-sky-100/78";
}

function safeHref(kind, value, subject = "", body = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (kind === "email") {
    const params = new URLSearchParams();
    if (subject) params.set("subject", subject);
    if (body) params.set("body", body);
    return `mailto:${text}${params.toString() ? `?${params.toString()}` : ""}`;
  }
  if (kind === "sms") return `sms:${text}`;
  return `tel:${text}`;
}

function compactText(value) {
  return String(value || "").trim();
}

function sectionBlock(title, value) {
  const text = compactText(value);
  return text ? `${title}\n${text}` : "";
}

function proposalLineItemLabel(item) {
  const qty = compactText(item.quantity);
  const unit = compactText(item.unit);
  const unitPrice = compactText(item.unit_price);
  const total = compactText(item.total);
  const quantityLabel = [qty, unit].filter(Boolean).join(" ");
  const priceLabel = unitPrice ? ` @ ${money(unitPrice)}` : "";
  const totalLabel = total ? ` = ${money(total)}` : "";
  return [
    compactText(item.category_label || item.category || "Line item"),
    compactText(item.description),
    quantityLabel || null,
    `${priceLabel}${totalLabel}`.trim() || null,
  ].filter(Boolean).join(" - ");
}

function buildProposalAgreementScope(proposal) {
  const measurements = Array.isArray(proposal.measurements) ? proposal.measurements : [];
  const attachments = Array.isArray(proposal.attachments) ? proposal.attachments : [];
  const lineItems = Array.isArray(proposal.line_items) ? proposal.line_items : [];

  const measurementLines = measurements
    .map((item) => {
      const quantity = [compactText(item.quantity), compactText(item.unit)].filter(Boolean).join(" ");
      const location = compactText(item.location);
      const notes = compactText(item.notes);
      return [`- ${compactText(item.label) || "Measurement"}`, location ? `(${location})` : "", quantity, notes ? `- ${notes}` : ""]
        .filter(Boolean)
        .join(" ");
    })
    .join("\n");

  const attachmentLines = attachments
    .map((item) => `- ${compactText(item.original_name || item.caption || item.attachment_type || "Attachment")}`)
    .join("\n");

  const lineItemLines = lineItems.map((item) => `- ${proposalLineItemLabel(item)}`).join("\n");

  return [
    sectionBlock("Project Summary", proposal.project_summary),
    sectionBlock("Scheduling Expectations", proposalScheduleSummary(proposal)),
    sectionBlock("Site Visit Notes", proposal.site_visit_notes),
    sectionBlock("Customer Requests", proposal.customer_requests),
    sectionBlock("Site Conditions", proposal.site_conditions),
    sectionBlock("Included Work", proposal.included_work),
    sectionBlock("Excluded Work", proposal.excluded_work),
    sectionBlock("Assumptions", proposal.assumptions),
    sectionBlock("Allowances", proposal.allowances),
    measurementLines ? `Measurements\n${measurementLines}` : "",
    attachmentLines ? `Referenced Photos and Documents\n${attachmentLines}` : "",
    lineItemLines ? `Estimate Pricing\n${lineItemLines}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function checklistPercent(items) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return 0;
  return Math.round((rows.filter((item) => item.complete).length / rows.length) * 100);
}

function readinessStatus({ complete, started }) {
  if (complete) return "Complete";
  if (started) return "In Progress";
  return "Not Started";
}

function readinessTone(status) {
  if (status === "Complete") return "border-emerald-300/28 bg-emerald-400/10 text-emerald-50";
  if (status === "In Progress") return "border-amber-300/32 bg-amber-400/10 text-amber-50";
  return "border-white/12 bg-white/7 text-sky-100/78";
}

function navItemForSection(key, estimateChecklist, isReadOnlyHistory) {
  if (key === "assistant") {
    return estimateChecklist.requiredMissing.length ? { status: "Needs attention", tone: "warning" } : { status: "Ready", tone: "complete" };
  }
  if (key === "ready") {
    if (isReadOnlyHistory) return { status: "Blocked", tone: "blocked" };
    return estimateChecklist.readyMinimum ? { status: "Complete", tone: "complete" } : { status: "Blocked", tone: "blocked" };
  }
  if (["notes", "history", "appointment", "incidentals"].includes(key)) {
    return { status: "Optional", tone: "optional" };
  }
  const checklistItem = estimateChecklist.items.find((item) => item.target === key || item.key === key);
  if (!checklistItem) return { status: "Optional", tone: "optional" };
  if (checklistItem.complete) return { status: "Complete", tone: "complete" };
  if (checklistItem.required) return { status: "Needs attention", tone: "warning" };
  return checklistItem.status === "In Progress"
    ? { status: "In progress", tone: "warning" }
    : { status: "Not started", tone: "empty" };
}

function sectionChecklistItemForNav(key, estimateChecklist, proposal, photos, documents) {
  const items = estimateChecklist.items || [];
  if (key === "customer") return checklistItemByKey(items, "customer");
  if (key === "appointment") {
    return {
      key: "appointment",
      title: "Appointment",
      complete: Boolean(proposal?.appointment),
      required: false,
      target: "appointment",
      action: "Review appointment",
      missing: proposal?.appointment ? [] : ["No linked appointment"],
    };
  }
  if (key === "scheduling") return checklistItemByKey(items, "scheduling");
  if (key === "site") return checklistItemByKey(items, "site-visit");
  if (key === "measurements") return checklistItemByKey(items, "measurements");
  if (key === "photos") {
    return {
      key: "photos",
      title: "Photos",
      complete: (photos || []).length > 0,
      required: false,
      target: "photos",
      action: "Upload photos",
      missing: (photos || []).length ? [] : ["No photos uploaded"],
    };
  }
  if (key === "documents") {
    return {
      key: "documents",
      title: "Documents",
      complete: (documents || []).length > 0,
      required: false,
      target: "documents",
      action: "Upload documents",
      missing: (documents || []).length ? [] : ["No documents uploaded"],
    };
  }
  if (key === "clarifications") return checklistItemByKey(items, "clarifications");
  if (key === "scope") return checklistItemByKey(items, "scope");
  if (key === "estimate") return checklistItemByKey(items, "pricing");
  if (key === "incidentals") {
    return {
      key: "adjustments",
      title: "Incidentals & Allowances",
      complete: moneyToNumber(proposal?.totals?.incidentals_reserve) > 0,
      required: false,
      target: "incidentals",
      action: "Review adjustments",
      missing: moneyToNumber(proposal?.totals?.incidentals_reserve) > 0 ? [] : ["No reserve or adjustment entries"],
    };
  }
  if (key === "ready") return checklistItemByKey(items, "ready");
  return {
    key,
    title: key,
    complete: false,
    required: false,
    target: key,
    action: "Review",
    missing: [],
  };
}

function statusToneFromItem(item, isBlocked = false) {
  if (isBlocked || item?.blocked) return "blocked";
  if (item?.complete) return "complete";
  if (item?.required) return item?.status === "In Progress" ? "warning" : "warning";
  return "empty";
}

function statusLabelFromTone(tone, required = false) {
  if (tone === "complete") return "Complete";
  if (tone === "blocked") return "Blocked";
  if (tone === "warning") return required ? "Needs attention" : "In progress";
  return required ? "Not started" : "Optional";
}

function NavStatusIcon({ tone, label }) {
  const accessibleLabel = label || statusLabelFromTone(tone);
  if (tone === "complete") return <CheckCircle2 className="h-4 w-4 text-emerald-200" aria-label={accessibleLabel} role="img" />;
  if (tone === "warning") return <AlertTriangle className="h-4 w-4 text-amber-200" aria-label={accessibleLabel} role="img" />;
  if (tone === "blocked") return <Lock className="h-4 w-4 text-rose-200" aria-label={accessibleLabel} role="img" />;
  return <Circle className="h-4 w-4 text-sky-100/45" aria-label={accessibleLabel} role="img" />;
}

function RequiredMarker({ required }) {
  if (!required) return null;
  return (
    <span
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-sm font-black leading-none text-amber-200"
      aria-label="Required"
      title="Required"
    >
      *
    </span>
  );
}

function workflowGroupStatus(group, estimateChecklist, proposal, photos, documents, isReadOnlyHistory) {
  const childItems = group.sections.map(([key]) => sectionChecklistItemForNav(key, estimateChecklist, proposal, photos, documents));
  const requiredItems = childItems.filter((item) => item?.required);
  if (!requiredItems.length) return { tone: "empty", label: "Optional" };
  if (group.key === "review" && isReadOnlyHistory) return { tone: "blocked", label: "Blocked" };
  const completeCount = requiredItems.filter((item) => item.complete).length;
  if (completeCount === requiredItems.length) return { tone: "complete", label: "Complete" };
  if (completeCount === 0) return { tone: "empty", label: "Not started" };
  return { tone: "warning", label: "Needs attention" };
}

function checklistItemByKey(items, key) {
  return (items || []).find((item) => item.key === key);
}

function buildOverviewGroups({ estimateChecklist, proposal, photos, documents, isReadOnlyHistory = false }) {
  const items = estimateChecklist.items || [];
  const customer = checklistItemByKey(items, "customer");
  const address = checklistItemByKey(items, "project-address");
  const scheduling = checklistItemByKey(items, "scheduling");
  const site = checklistItemByKey(items, "site-visit");
  const measurements = checklistItemByKey(items, "measurements");
  const files = checklistItemByKey(items, "files");
  const clarifications = checklistItemByKey(items, "clarifications");
  const scope = checklistItemByKey(items, "scope");
  const pricing = checklistItemByKey(items, "pricing");
  const ready = checklistItemByKey(items, "ready");
  const photoReady = (photos || []).length > 0;
  const documentReady = (documents || []).length > 0;

  return [
    {
      key: "project",
      label: "Project",
      purpose: WORKFLOW_GROUPS[0].purpose,
      rows: [
        customer,
        address,
        {
          key: "appointment",
          title: "Appointment",
          complete: Boolean(proposal?.appointment),
          required: false,
          target: "appointment",
          action: "Review appointment",
          missing: proposal?.appointment ? [] : ["No linked appointment"],
        },
        scheduling,
      ].filter(Boolean),
    },
    {
      key: "site_scope",
      label: "Site & Scope",
      purpose: WORKFLOW_GROUPS[1].purpose,
      rows: [
        site,
        measurements,
        {
          key: "photos",
          title: "Photos",
          complete: photoReady,
          required: false,
          target: "photos",
          action: "Upload photos",
          missing: photoReady ? [] : ["No photos uploaded"],
        },
        {
          key: "documents",
          title: "Documents",
          complete: documentReady,
          required: false,
          target: "documents",
          action: "Upload documents",
          missing: documentReady ? [] : ["No documents uploaded"],
        },
        clarifications,
        scope,
      ].filter(Boolean),
    },
    {
      key: "pricing",
      label: "Pricing",
      purpose: WORKFLOW_GROUPS[2].purpose,
      rows: [
        pricing,
        {
          key: "adjustments",
          title: "Incidentals & Allowances",
          complete: moneyToNumber(proposal?.totals?.incidentals_reserve) > 0,
          required: false,
          target: "incidentals",
          action: "Review adjustments",
          missing: moneyToNumber(proposal?.totals?.incidentals_reserve) > 0 ? [] : ["No reserve or adjustment entries"],
        },
      ].filter(Boolean),
    },
    {
      key: "review",
      label: "Review",
      purpose: WORKFLOW_GROUPS[3].purpose,
      rows: [ready ? { ...ready, blocked: isReadOnlyHistory } : null].filter(Boolean),
    },
  ];
}

function OverviewWorkflowGroup({ group, onOpen }) {
  const completed = group.rows.filter((row) => row.complete).length;
  const requiredMissing = group.rows.filter((row) => row.required && !row.complete);
  const nextRow = requiredMissing[0] || group.rows.find((row) => !row.complete) || group.rows[0];
  const requiredRows = group.rows.filter((row) => row.required);
  const groupStatus = (() => {
    if (requiredRows.some((row) => row.blocked)) return { tone: "blocked", label: "Blocked" };
    if (!requiredRows.length) return { tone: "empty", label: "Optional" };
    const requiredComplete = requiredRows.filter((row) => row.complete).length;
    if (requiredComplete === requiredRows.length) return { tone: "complete", label: "Complete" };
    if (requiredComplete === 0) return { tone: "empty", label: "Not started" };
    return { tone: "warning", label: "Needs attention" };
  })();
  const complete = requiredRows.length
    ? requiredRows.every((row) => row.complete)
    : group.rows.every((row) => row.complete);
  const actionLabel = group.key === "review" ? "Check Readiness" : complete ? "Review" : "Continue";
  return (
    <article
      data-testid={`estimate-overview-group-${group.key}`}
      className="rounded-2xl border border-white/10 bg-white/7 p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-amber-100/80">
            <NavStatusIcon tone={groupStatus.tone} label={groupStatus.label} />
            <span>{group.label}</span>
          </div>
          <p className="mt-1 text-sm font-semibold leading-6 text-sky-100/68">{group.purpose}</p>
        </div>
        <div className={`rounded-full border px-3 py-1 text-xs font-black ${
          groupStatus.tone === "blocked"
            ? "border-rose-200/35 bg-rose-400/12 text-rose-100"
            : requiredMissing.length
              ? "border-amber-200/35 bg-amber-400/12 text-amber-100"
              : "border-emerald-200/35 bg-emerald-400/12 text-emerald-100"
        }`}>
          {completed} of {group.rows.length} complete
        </div>
      </div>
      <div className="mt-3 grid gap-2">
        {group.rows.map((row) => {
          const tone = statusToneFromItem(row);
          const statusLabel = statusLabelFromTone(tone, row.required);
          return (
            <button
              key={row.key}
              data-testid={`estimate-overview-row-${row.key}`}
              aria-label={`${row.title}: ${row.required ? "Required" : "Optional"}, ${statusLabel}`}
              type="button"
              onClick={() => onOpen(row.target)}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/24 px-3 py-2 text-left hover:bg-white/10"
            >
              <span className="flex min-w-0 items-center gap-2">
                <NavStatusIcon tone={tone} label={statusLabel} />
                <RequiredMarker required={row.required} />
                <span className="truncate text-sm font-bold text-white">{row.title}</span>
                {!row.required ? <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-black uppercase text-sky-100/45">Optional</span> : null}
              </span>
              <span className="shrink-0 text-xs font-black text-sky-100/62">{row.complete ? "Done" : row.action}</span>
            </button>
          );
        })}
      </div>
      {requiredMissing.length ? (
        <div className="mt-3 rounded-xl border border-amber-200/20 bg-amber-400/10 px-3 py-2 text-sm font-semibold text-amber-100" data-testid={`estimate-overview-missing-${group.key}`}>
          Needs attention: {requiredMissing.map((row) => row.title).join(", ")}
        </div>
      ) : null}
      {nextRow ? (
        <button
          type="button"
          data-testid={`estimate-overview-action-${group.key}`}
          onClick={() => onOpen(nextRow.target)}
          className={`mt-3 ${ESTIMATE_PRIMARY_GOLD_BUTTON}`}
        >
          {actionLabel}
        </button>
      ) : null}
    </article>
  );
}

function questionText(question) {
  return compactText(question?.question || question?.label || question);
}

function normalizeQuestion(raw, index = 0) {
  if (raw && typeof raw === "object") {
    const text = questionText(raw);
    return {
      key: compactText(raw.key || raw.id || raw.label || text).toLowerCase().replace(/[^a-z0-9]+/g, "_") || `clarification_${index + 1}`,
      label: compactText(raw.label || text) || `Question ${index + 1}`,
      question: text,
      section: compactText(raw.section || raw.target || "site") || "site",
      keywords: Array.isArray(raw.keywords) ? raw.keywords : [],
    };
  }
  const text = questionText(raw);
  return {
    key: `clarification_${index + 1}`,
    label: text || `Question ${index + 1}`,
    question: text,
    section: "site",
    keywords: [],
  };
}

function templateQuestionRows(template) {
  const raw =
    template?.default_clarifications ||
    template?.clarification_questions ||
    template?.clarifications ||
    template?.questions ||
    [];
  const rows = Array.isArray(raw) && raw.length ? raw.map(normalizeQuestion) : FALLBACK_TEMPLATE_QUESTIONS;
  return rows.slice(0, 8);
}

function proposalEvidenceText(proposal, draft) {
  return [
    proposal?.project_summary,
    proposal?.project_title,
    proposal?.project_type,
    proposal?.project_subtype,
    proposal?.service_location,
    proposalScheduleSummary({ ...proposal, ...draft }),
    draft?.site_visit_notes,
    draft?.access_notes,
    draft?.risk_notes,
    draft?.customer_requests,
    draft?.site_conditions,
    draft?.included_work,
    draft?.excluded_work,
    draft?.assumptions,
    draft?.allowances,
  ].filter(Boolean).join(" ").toLowerCase();
}

function questionAnsweredByEvidence(question, { proposal, draft, photos }) {
  const key = compactText(question.key).toLowerCase();
  const evidence = proposalEvidenceText(proposal, draft);
  const measurements = Array.isArray(proposal?.measurements) ? proposal.measurements : [];
  if (key.includes("photo")) return (photos || []).length > 0;
  if (key.includes("square") || key.includes("measurement") || key.includes("footage")) {
    return measurements.some((item) => {
      const text = `${item.label || ""} ${item.location || ""} ${item.unit || ""} ${item.notes || ""}`.toLowerCase();
      return text.includes("sq") || text.includes("square") || text.includes("area") || Number(item.quantity || 0) > 0;
    });
  }
  const keywords = Array.isArray(question.keywords) ? question.keywords : [];
  if (keywords.some((keyword) => evidence.includes(String(keyword).toLowerCase()))) return true;
  return false;
}

function buildClarificationRows({ selectedTemplate, proposal, draft, photos }) {
  const checklist = Array.isArray(draft?.quick_checklist) ? draft.quick_checklist : [];
  return templateQuestionRows(selectedTemplate).map((question) => {
    const completeKey = `clarification:${question.key}:complete`;
    const ignoredKey = `clarification:${question.key}:ignored`;
    const autoComplete = questionAnsweredByEvidence(question, { proposal, draft, photos });
    const manuallyComplete = checklist.includes(completeKey);
    const ignored = checklist.includes(ignoredKey);
    return {
      ...question,
      completeKey,
      ignoredKey,
      autoComplete,
      manuallyComplete,
      ignored,
      complete: ignored || manuallyComplete || autoComplete,
      status: ignored ? "Ignored" : manuallyComplete ? "Complete" : autoComplete ? "Auto-complete" : "Needs Answer",
      target: question.section || "site",
    };
  });
}

function fallbackTemplateForProposal(proposal) {
  const type = compactText(proposal?.project_type || proposal?.project_title || "Project");
  return {
    id: "generated",
    name: `${type} Draft Agreement Template`,
    match_label: "Generated Draft",
    match_reason: "No library template was selected, so Project Assistant prepared a blank draft template structure for review.",
    default_clarifications: FALLBACK_TEMPLATE_QUESTIONS,
    generated: true,
  };
}

function normalizeProposalClassificationForAgreement(projectType, projectSubtype) {
  const rawType = compactText(projectType);
  const rawSubtype = compactText(projectSubtype);
  if (!rawType.includes("/")) {
    return { projectType: rawType, projectSubtype: rawSubtype };
  }

  const parts = rawType.split("/").map((part) => compactText(part)).filter(Boolean);
  return {
    projectType: parts[0] || rawType,
    projectSubtype: rawSubtype || parts.slice(1).join(" / "),
  };
}

function parseServiceLocationForAgreement(serviceLocation) {
  const raw = compactText(serviceLocation);
  if (!raw) return { address_line1: "", city: "", state: "", postal_code: "" };

  const parts = raw.split(",").map((part) => compactText(part)).filter(Boolean);
  if (parts.length < 3) {
    return { address_line1: raw, city: "", state: "", postal_code: "" };
  }

  const stateZip = parts[parts.length - 1] || "";
  const stateZipMatch = stateZip.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  return {
    address_line1: parts.slice(0, -2).join(", "),
    city: parts[parts.length - 2] || "",
    state: stateZipMatch ? stateZipMatch[1].toUpperCase() : stateZip,
    postal_code: stateZipMatch ? stateZipMatch[2] : "",
  };
}

function normalizeTemplateRecommendation(data, proposal) {
  const recs = data?.recommendations || data?.results || data?.templates || [];
  const first = Array.isArray(recs) ? recs[0] : data?.recommendation || data?.template || null;
  if (!first) return null;
  return {
    ...first,
    name: first.name || first.title || first.template_name || `${proposal?.project_type || "Project"} Template`,
    match_label: first.match_label || first.confidence_label || "Template Match",
    match_reason: first.match_reason || first.reason || first.description || "Project Assistant found a possible template match from your library.",
    default_clarifications: first.default_clarifications || first.clarification_questions || first.questions || FALLBACK_TEMPLATE_QUESTIONS,
  };
}

function buildEstimateChecklist({ proposal, draft, totals, photos, documents, clarificationRows = [] }) {
  const contactReady = Boolean(compactText(proposal?.customer_name) && (compactText(proposal?.customer_email) || compactText(proposal?.customer_phone)));
  const locationReady = Boolean(compactText(proposal?.service_location));
  const hasAccessNotes = Boolean(compactText(draft?.access_notes) || locationReady);
  const hasConditions = Boolean(compactText(draft?.site_conditions) || compactText(draft?.risk_notes));
  const hasMeasurements = (proposal?.measurements || []).length > 0;
  const hasFiles = (photos || []).length > 0 || (documents || []).length > 0;
  const hasRequests = Boolean(compactText(draft?.customer_requests));
  const hasSchedule =
    Boolean(draft?.project_start_type && draft?.project_completion_type && draft?.scheduling_priority) &&
    (draft.project_start_type !== "specific_date" || Boolean(draft.project_start_date)) &&
    (draft.project_completion_type !== "specific_date" || Boolean(draft.project_completion_date));
  const hasScope = Boolean(compactText(draft?.included_work) || compactText(draft?.site_visit_notes) || compactText(proposal?.project_summary));
  const hasLineItems = (proposal?.line_items || []).length > 0;
  const clarificationsReady = clarificationRows.length ? clarificationRows.every((row) => row.complete) : false;
  const readyMinimum = contactReady && locationReady && hasScope && hasLineItems && clarificationsReady;

  const items = [
    {
      key: "customer",
      title: "Customer",
      complete: contactReady,
      status: readinessStatus({ complete: contactReady, started: Boolean(compactText(proposal?.customer_name)) }),
      required: true,
      missing: contactReady ? [] : ["Customer name and at least one email or phone"],
      target: "customer",
      action: "Review contact",
      summary: `${field(proposal?.customer_name, "No customer")} - ${field(proposal?.customer_email || proposal?.customer_phone, "No contact method")}`,
    },
    {
      key: "project-address",
      title: "Project Address",
      complete: locationReady,
      status: readinessStatus({ complete: locationReady, started: Boolean(compactText(proposal?.service_location)) }),
      required: true,
      missing: locationReady ? [] : ["Project address"],
      target: "customer",
      action: "Add address",
      summary: compactText(proposal?.service_location) || "No project address selected",
    },
    {
      key: "scheduling",
      title: "Scheduling",
      complete: hasSchedule,
      status: readinessStatus({ complete: hasSchedule, started: Boolean(draft?.project_start_type || draft?.project_completion_type || draft?.scheduling_priority) }),
      required: false,
      missing: hasSchedule ? [] : ["Start, completion, and priority"],
      target: "scheduling",
      action: "Set schedule",
      summary: proposalScheduleSummary({ ...proposal, ...draft }),
    },
    {
      key: "site-visit",
      title: "Site Visit",
      complete: hasAccessNotes && hasConditions,
      status: readinessStatus({ complete: hasAccessNotes && hasConditions, started: hasAccessNotes || hasConditions || hasRequests }),
      required: false,
      missing: hasAccessNotes && hasConditions ? [] : ["Access notes and existing conditions"],
      target: "site",
      action: "Capture site",
      summary: compactText(draft?.site_conditions) || compactText(draft?.risk_notes) || compactText(draft?.access_notes) || "No site visit details captured",
    },
    {
      key: "measurements",
      title: "Measurements",
      complete: hasMeasurements,
      status: readinessStatus({ complete: hasMeasurements, started: hasMeasurements }),
      required: false,
      missing: hasMeasurements ? [] : ["At least one measurement"],
      target: "measurements",
      action: "Add measurement",
      summary: hasMeasurements ? `${proposal.measurements.length} measurement${proposal.measurements.length === 1 ? "" : "s"} captured` : "No measurements yet",
    },
    {
      key: "files",
      title: "Photos / Documents",
      complete: hasFiles,
      status: readinessStatus({ complete: hasFiles, started: hasFiles }),
      required: false,
      missing: hasFiles ? [] : ["Photo or document"],
      target: photos?.length ? "photos" : "documents",
      action: "Attach files",
      summary: `${(photos || []).length} photo${(photos || []).length === 1 ? "" : "s"}, ${(documents || []).length} document${(documents || []).length === 1 ? "" : "s"}`,
    },
    {
      key: "clarifications",
      title: "Clarifications",
      complete: clarificationsReady,
      status: readinessStatus({ complete: clarificationsReady, started: clarificationRows.some((row) => row.complete) }),
      required: true,
      missing: clarificationsReady ? [] : ["Clarification questions"],
      target: "clarifications",
      action: "Review questions",
      summary: clarificationRows.length
        ? `${clarificationRows.filter((row) => row.complete).length} of ${clarificationRows.length} clarification${clarificationRows.length === 1 ? "" : "s"} complete`
        : "Template questions not loaded yet",
    },
    {
      key: "scope",
      title: "Scope Notes",
      complete: hasScope,
      status: readinessStatus({ complete: hasScope, started: Boolean(compactText(draft?.included_work) || compactText(draft?.site_visit_notes) || compactText(proposal?.project_summary)) }),
      required: true,
      missing: hasScope ? [] : ["Scope notes or included work"],
      target: "scope",
      action: "Write scope",
      summary: compactText(draft?.included_work) || compactText(draft?.site_visit_notes) || compactText(proposal?.project_summary) || "No scope notes yet",
    },
    {
      key: "pricing",
      title: "Estimate Pricing",
      complete: hasLineItems,
      status: readinessStatus({ complete: hasLineItems, started: hasLineItems }),
      required: true,
      missing: hasLineItems ? [] : ["At least one estimate pricing entry"],
      target: "estimate",
      action: "Add pricing",
      summary: hasLineItems ? `${proposal.line_items.length} pricing entr${proposal.line_items.length === 1 ? "y" : "ies"} - ${money(totals?.total)}` : "No estimate pricing yet",
    },
    {
      key: "ready",
      title: "Agreement Ready",
      complete: readyMinimum,
      status: readinessStatus({ complete: readyMinimum, started: contactReady || locationReady || hasScope || hasLineItems }),
      required: true,
      missing: readyMinimum ? [] : ["Customer/contact", "project address", "clarifications", "scope notes", "estimate pricing"].filter((label) => {
        if (label === "Customer/contact") return !contactReady;
        if (label === "project address") return !locationReady;
        if (label === "clarifications") return !clarificationsReady;
        if (label === "scope notes") return !hasScope;
        if (label === "estimate pricing") return !hasLineItems;
        return false;
      }),
      target: "ready",
      action: "Review readiness",
      summary: readyMinimum ? "Minimum estimate checklist is ready for Agreement Wizard review" : "Finish required checklist items before agreement review",
    },
  ];

  return {
    items,
    percent: checklistPercent(items),
    readyMinimum,
    completedCount: items.filter((item) => item.complete).length,
    requiredMissing: items.filter((item) => item.required && !item.complete),
  };
}

function primeAgreementWizardForProposalDraft() {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    window.sessionStorage.setItem("mhb_step1_cache_new_start_mode", "manual");
    window.sessionStorage.setItem("mhb_step1_cache_new_start_mode_committed", "1");
    window.sessionStorage.setItem("mhb_step1_cache_new_start_mode_source", "session");
  } catch {
    // ignore storage failures
  }
}

function Section({ id, active, title, children, description }) {
  if (!active) return null;
  return (
    <section
      id={id}
      className="rounded-2xl border border-sky-200/14 bg-[#061d42]/95 p-4 text-white shadow-[0_24px_70px_rgba(2,8,23,0.34)] md:p-5"
      data-testid={`proposal-section-${id}`}
    >
      <div className="flex flex-col gap-1.5 border-b border-white/10 pb-4">
        <h2 className="text-xl font-black text-white">{title}</h2>
        {(description || SECTION_DESCRIPTIONS[id]) ? (
          <p className="max-w-3xl text-sm font-semibold leading-6 text-sky-100/72">
            {description || SECTION_DESCRIPTIONS[id]}
          </p>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ChecklistCard({ item, onOpen }) {
  return (
    <article
      data-testid={`estimate-checklist-${item.key}`}
      className={`rounded-xl border p-4 shadow-sm ${readinessTone(item.status)}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${item.complete ? "bg-emerald-400 text-emerald-950" : "bg-white/8 text-sky-100/45 ring-1 ring-white/14"}`}>
              {item.complete ? <Check size={16} /> : null}
            </span>
            <h3 className="text-sm font-black text-white">{item.title}</h3>
            {item.required ? <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-black uppercase text-amber-100 ring-1 ring-amber-200/24">Required</span> : null}
            <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-black uppercase text-sky-100/78 ring-1 ring-white/12" data-testid={`estimate-readiness-status-${item.key}`}>
              {item.status}
            </span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm font-semibold text-sky-100/76">{item.summary}</p>
          {!item.complete && item.missing?.length ? (
            <div className="mt-2 text-xs font-bold text-amber-100">
              Missing: {item.missing.join(", ")}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onOpen(item.target)}
          className="shrink-0 rounded-lg border border-white/18 bg-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/15"
        >
          {item.action}
        </button>
      </div>
    </article>
  );
}

function InfoGrid({ rows }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-white/10 bg-white/7 px-3 py-2">
          <dt className="text-xs font-semibold uppercase tracking-wide text-sky-100/55">{label}</dt>
          <dd className="mt-1 whitespace-pre-wrap text-sm font-semibold text-white">{field(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function TextAreaField({ label, value, onChange, rows = 4, testId }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-sky-100/78">{label}</span>
      <textarea
        data-testid={testId}
        className="mt-1 min-h-[104px] w-full rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white shadow-sm placeholder:text-sky-100/42 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-300/20"
        rows={rows}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options, testId }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-sky-100/78">{label}</span>
      <select
        data-testid={testId}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white shadow-sm focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-300/20"
      >
        {options.map(([optionValue, labelText]) => (
          <option key={optionValue} value={optionValue}>
            {labelText}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateField({ label, value, onChange, disabled = false, testId }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-sky-100/78">{label}</span>
      <input
        type="date"
        data-testid={testId}
        value={value || ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white shadow-sm focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-300/20 disabled:bg-slate-950/20 disabled:text-sky-100/38"
      />
    </label>
  );
}

export default function ProposalWorkspacePage() {
  const { proposalId } = useParams();
  const navigate = useNavigate();
  const [proposal, setProposal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState("overview");
  const [draft, setDraft] = useState({});
  const [measurementForm, setMeasurementForm] = useState(EMPTY_MEASUREMENT);
  const [lineItemForm, setLineItemForm] = useState(EMPTY_LINE_ITEM);
  const [editingLineItemId, setEditingLineItemId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [walkthroughMode, setWalkthroughMode] = useState(false);
  const [walkthroughMeasurementOpen, setWalkthroughMeasurementOpen] = useState(false);
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateRecommendation, setTemplateRecommendation] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateChoice, setTemplateChoice] = useState("pending");
  const [customerMatches, setCustomerMatches] = useState([]);
  const [saveAddressToCustomer, setSaveAddressToCustomer] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);

  const photos = useMemo(
    () => (proposal?.attachments || []).filter((item) => item.attachment_type === "photo"),
    [proposal]
  );
  const documents = useMemo(
    () => (proposal?.attachments || []).filter((item) => item.attachment_type !== "photo"),
    [proposal]
  );
  const totals = proposal?.totals || {};
  const clarificationRows = useMemo(
    () => buildClarificationRows({ selectedTemplate, proposal, draft, photos }),
    [selectedTemplate, proposal, draft, photos]
  );
  const matchedCustomer = useMemo(() => {
    if (!customerMatches.length) return null;
    const email = compactText(proposal?.customer_email).toLowerCase();
    const phone = compactText(proposal?.customer_phone).replace(/\D/g, "");
    return customerMatches.find((customer) => {
      const cEmail = compactText(customer.email).toLowerCase();
      const cPhone = compactText(customer.phone_number).replace(/\D/g, "");
      return (email && cEmail === email) || (phone && cPhone && cPhone === phone);
    }) || customerMatches[0] || null;
  }, [customerMatches, proposal]);
  const propertyOptions = useMemo(() => {
    const options = [];
    for (const customer of customerMatches) {
      const address = customerAddress(customer);
      if (address && !options.some((item) => item.value === address)) {
        options.push({ label: `${customer.full_name || "Customer"} property`, value: address });
      }
    }
    return options;
  }, [customerMatches]);
  const estimateChecklist = useMemo(
    () => buildEstimateChecklist({ proposal, draft, totals, photos, documents, clarificationRows }),
    [proposal, draft, totals, photos, documents, clarificationRows]
  );
  const isReadOnlyHistory = Boolean(
    proposal && (compactText(proposal.status).toLowerCase() === "converted" || proposal.linked_agreement_id)
  );
  const overviewGroups = useMemo(
    () => buildOverviewGroups({ estimateChecklist, proposal, photos, documents, isReadOnlyHistory }),
    [estimateChecklist, proposal, photos, documents, isReadOnlyHistory]
  );
  const highestPriorityItem =
    estimateChecklist.requiredMissing[0] ||
    estimateChecklist.items.find((item) => !item.complete) ||
    estimateChecklist.items.find((item) => item.key === "ready");
  const recommendedSectionKey = highestPriorityItem?.target || "";
  const activeSectionStatus = navItemForSection(active, estimateChecklist, isReadOnlyHistory);
  const opportunityReference = [
    proposal?.source_type ? `${proposal.source_type} #${proposal.source_id || proposal.contractor_opportunity_id || "-"}` : "",
    proposal?.estimate_appointment_id ? `Appointment #${proposal.estimate_appointment_id}` : "",
  ].filter(Boolean).join(" | ");

  function blockReadOnlyHistory() {
    if (!isReadOnlyHistory) return false;
    toast.error("Converted estimates are read-only history. Open the linked agreement for active work.");
    return true;
  }

  function createAgreementFromProposal() {
    if (!proposal) return;
    if (blockReadOnlyHistory()) return;
    if (!estimateChecklist.readyMinimum) {
      toast.error("Finish required estimate readiness items before creating an agreement.");
      setActive("overview");
      return;
    }
    const workspaceProposal = { ...proposal, ...draft };
    const scopeText = buildProposalAgreementScope(workspaceProposal);
    const proposalTotal = compactText(totals.total || "0.00");
    const incidentalsReserve = compactText(totals.incidentals_reserve || "0.00");
    const lineItems = Array.isArray(proposal.line_items) ? proposal.line_items : [];
    const measurements = Array.isArray(proposal.measurements) ? proposal.measurements : [];
    const attachments = Array.isArray(proposal.attachments) ? proposal.attachments : [];
    const classification = normalizeProposalClassificationForAgreement(
      workspaceProposal.project_type,
      workspaceProposal.project_subtype
    );
    const address = parseServiceLocationForAgreement(workspaceProposal.service_location);
    const scheduling = {
      project_start_type: workspaceProposal.project_start_type || "flexible",
      project_start_date: workspaceProposal.project_start_date || "",
      project_completion_type: workspaceProposal.project_completion_type || "no_deadline",
      project_completion_date: workspaceProposal.project_completion_date || "",
      scheduling_priority: workspaceProposal.scheduling_priority || "flexible",
      summary: proposalScheduleSummary(workspaceProposal),
    };

    const handoff = {
      assistantPrefill: {
        homeowner_id: workspaceProposal.homeowner_id || workspaceProposal.customer_id || "",
        project_title: workspaceProposal.project_title || "",
        project_summary: workspaceProposal.project_summary || "",
        project_type: classification.projectType,
        project_subtype: classification.projectSubtype,
        customer_name: workspaceProposal.customer_name || "",
        email: workspaceProposal.customer_email || "",
        address_line1: address.address_line1 || workspaceProposal.service_location || "",
        city: address.city,
        state: address.state,
        postal_code: address.postal_code,
        incidentals_reserve_amount: incidentalsReserve,
      },
      assistantDraftPayload: {
        source: "proposal",
        proposal_id: proposal.id,
        source_type: proposal.source_type || "",
        source_id: proposal.source_id || null,
        opportunity_id: proposal.contractor_opportunity_id || null,
        estimate_appointment_id: proposal.estimate_appointment_id || null,
        project_title: workspaceProposal.project_title || "",
        title: workspaceProposal.project_title || "",
        homeowner: workspaceProposal.homeowner_id || workspaceProposal.customer_id || "",
        homeowner_id: workspaceProposal.homeowner_id || workspaceProposal.customer_id || "",
        customer_id: workspaceProposal.customer_id || workspaceProposal.homeowner_id || "",
        project_type: classification.projectType,
        project_subtype: classification.projectSubtype,
        project_summary: workspaceProposal.project_summary || "",
        description: scopeText || workspaceProposal.project_summary || "",
        scope_of_work: scopeText || workspaceProposal.project_summary || "",
        customer_name: workspaceProposal.customer_name || "",
        homeowner_name: workspaceProposal.customer_name || "",
        email: workspaceProposal.customer_email || "",
        customer_email: workspaceProposal.customer_email || "",
        customer_phone: workspaceProposal.customer_phone || "",
        service_location: workspaceProposal.service_location || "",
        address_line1: address.address_line1 || workspaceProposal.service_location || "",
        city: address.city,
        state: address.state,
        postal_code: address.postal_code,
        payment_mode: Number(incidentalsReserve || 0) > 0 ? "escrow" : "",
        incidentals_reserve_amount: incidentalsReserve,
        proposal_total: proposalTotal,
        proposal_totals: totals,
        proposal_line_items: lineItems,
        proposal_measurements: measurements,
        proposal_attachments: attachments,
        proposal_scheduling: scheduling,
        project_start_type: scheduling.project_start_type,
        project_start_date: scheduling.project_start_date,
        project_completion_type: scheduling.project_completion_type,
        project_completion_date: scheduling.project_completion_date,
        scheduling_priority: scheduling.scheduling_priority,
        site_visit_notes: workspaceProposal.site_visit_notes || "",
        included_work: workspaceProposal.included_work || "",
        excluded_work: workspaceProposal.excluded_work || "",
        assumptions: workspaceProposal.assumptions || "",
        allowances: workspaceProposal.allowances || "",
      },
      assistantContext: {
        source: "proposal",
        source_label: "Estimate Workspace",
        proposal_id: proposal.id,
        source_type: proposal.source_type || "",
        source_id: proposal.source_id || null,
        customer_name: workspaceProposal.customer_name || "",
        service_location: workspaceProposal.service_location || "",
        proposal_total: proposalTotal,
        incidentals_reserve_amount: incidentalsReserve,
        proposal_scheduling: scheduling,
        line_item_count: lineItems.length,
        measurement_count: measurements.length,
        attachment_count: attachments.length,
      },
      assistantEstimatePreview: {
        source: "proposal",
        confidence_level: "contractor-entered",
        suggested_total_price: proposalTotal,
        incidentals_reserve_amount: incidentalsReserve,
        line_items: lineItems.map((item) => ({
          category: item.category,
          label: item.category_label,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unit_price,
          total: item.total,
          notes: item.notes,
        })),
      },
      assistantWizardStepTarget: 1,
      assistantIntent: "proposal_to_agreement",
    };

    writeSessionAssistantHandoff(handoff);
    primeAgreementWizardForProposalDraft();
    toast.success("Estimate checklist loaded into the Agreement Wizard.");
    navigate("/app/agreements/new/wizard?step=1", { state: handoff });
  }

  async function loadProposal() {
    setLoading(true);
    try {
      const { data } = await api.get(`/projects/proposals/${proposalId}/`);
      setProposal(data);
      setDraft({
        status: data.status || "draft",
        customer_preferred_contact: data.customer_preferred_contact || "",
        site_visit_notes: data.site_visit_notes || "",
        access_notes: data.access_notes || "",
        risk_notes: data.risk_notes || "",
        customer_requests: data.customer_requests || "",
        site_conditions: data.site_conditions || "",
        quick_checklist: Array.isArray(data.quick_checklist) ? data.quick_checklist : [],
        included_work: data.included_work || "",
        excluded_work: data.excluded_work || "",
        assumptions: data.assumptions || "",
        allowances: data.allowances || "",
        internal_notes: data.internal_notes || "",
        service_location: data.service_location || "",
        project_start_type: data.project_start_type || "flexible",
        project_start_date: data.project_start_date || "",
        project_completion_type: data.project_completion_type || "no_deadline",
        project_completion_date: data.project_completion_date || "",
        scheduling_priority: data.scheduling_priority || "flexible",
      });
      loadTemplateRecommendation(data);
      loadCustomerMatches(data);
    } catch (error) {
      console.error(error);
      toast.error("Could not load proposal.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProposal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalId]);

  async function loadTemplateRecommendation(sourceProposal) {
    setTemplateLoading(true);
    try {
      const { data } = await api.post("/projects/templates/recommend/", {
        project_title: sourceProposal?.project_title || "",
        project_type: sourceProposal?.project_type || "",
        project_subtype: sourceProposal?.project_subtype || "",
        project_summary: sourceProposal?.project_summary || "",
        source: "estimate_workspace",
      });
      const match = normalizeTemplateRecommendation(data, sourceProposal);
      setTemplateRecommendation(match);
      if (match) {
        setSelectedTemplate(match);
        setTemplateChoice("recommended");
      } else {
        setSelectedTemplate(fallbackTemplateForProposal(sourceProposal));
        setTemplateChoice("generated");
      }
    } catch (error) {
      console.error(error);
      setTemplateRecommendation(null);
      setSelectedTemplate(fallbackTemplateForProposal(sourceProposal));
      setTemplateChoice("generated");
    } finally {
      setTemplateLoading(false);
    }
  }

  async function loadCustomerMatches(sourceProposal) {
    const query = compactText(sourceProposal?.customer_email || sourceProposal?.customer_phone || sourceProposal?.customer_name);
    if (!query) return;
    try {
      const { data } = await api.get("/projects/homeowners/", { params: { q: query, page_size: 10 } });
      setCustomerMatches(Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      setCustomerMatches([]);
    }
  }

  function patchDraft(key, value) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function saveProposal(payload, success = "Estimate saved.") {
    if (blockReadOnlyHistory()) return;
    setSaving(true);
    try {
      const { data } = await api.patch(`/projects/proposals/${proposalId}/`, payload);
      setProposal(data);
      setDraft((prev) => ({ ...prev, ...payload }));
      toast.success(success);
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.detail || "Could not save estimate.");
    } finally {
      setSaving(false);
    }
  }

  async function saveProjectAddress() {
    if (blockReadOnlyHistory()) return;
    const address = compactText(draft.service_location);
    if (!address) {
      toast.error("Project Address is required.");
      return;
    }
    setSavingAddress(true);
    try {
      const { data } = await api.patch(`/projects/proposals/${proposalId}/`, { service_location: address });
      setProposal(data);
      setDraft((prev) => ({ ...prev, service_location: data.service_location || address }));
      if (saveAddressToCustomer && matchedCustomer?.id) {
        await api.patch(`/projects/homeowners/${matchedCustomer.id}/`, {
          street_address: address,
        });
        toast.success("Project address saved to estimate and customer profile.");
      } else {
        toast.success("Project address saved.");
      }
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.detail || "Could not save project address.");
    } finally {
      setSavingAddress(false);
    }
  }

  async function setClarificationState(row, state) {
    if (blockReadOnlyHistory()) return;
    const current = Array.isArray(draft.quick_checklist) ? draft.quick_checklist : [];
    const withoutRow = current.filter((item) => item !== row.completeKey && item !== row.ignoredKey);
    const next = state === "complete"
      ? [...withoutRow, row.completeKey]
      : state === "ignored"
        ? [...withoutRow, row.ignoredKey]
        : withoutRow;
    patchDraft("quick_checklist", next);
    await saveProposal({ quick_checklist: next }, "Clarification updated.");
  }

  async function addMeasurement(event) {
    event?.preventDefault?.();
    if (blockReadOnlyHistory()) return;
    try {
      const { data } = await api.post(`/projects/proposals/${proposalId}/measurements/`, measurementForm);
      setProposal((prev) => ({ ...prev, measurements: [...(prev?.measurements || []), data] }));
      setMeasurementForm(EMPTY_MEASUREMENT);
      setWalkthroughMeasurementOpen(false);
      toast.success("Measurement added.");
    } catch (error) {
      console.error(error);
      toast.error("Could not add measurement.");
    }
  }

  async function deleteMeasurement(id) {
    if (blockReadOnlyHistory()) return;
    await api.delete(`/projects/proposals/${proposalId}/measurements/${id}/`);
    setProposal((prev) => ({
      ...prev,
      measurements: (prev?.measurements || []).filter((item) => item.id !== id),
    }));
    toast.success("Measurement removed.");
  }

  function resetLineItemForm() {
    setLineItemForm(EMPTY_LINE_ITEM);
    setEditingLineItemId(null);
  }

  function patchLineItemForm(key, value) {
    setLineItemForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submitLineItem(event) {
    event.preventDefault();
    if (blockReadOnlyHistory()) return;
    try {
      if (editingLineItemId) {
        const { data } = await api.patch(`/projects/proposals/${proposalId}/line-items/${editingLineItemId}/`, lineItemForm);
        setProposal((prev) => ({
          ...prev,
          totals: data.totals || prev?.totals,
          line_items: (prev?.line_items || []).map((item) => (item.id === editingLineItemId ? data.line_item : item)),
        }));
        toast.success("Line item updated.");
      } else {
        const { data } = await api.post(`/projects/proposals/${proposalId}/line-items/`, lineItemForm);
        setProposal((prev) => ({
          ...prev,
          totals: data.totals || prev?.totals,
          line_items: [...(prev?.line_items || []), data.line_item],
        }));
        toast.success("Line item added.");
      }
      resetLineItemForm();
    } catch (error) {
      console.error(error);
      toast.error("Could not save line item.");
    }
  }

  function editLineItem(item) {
    setEditingLineItemId(item.id);
    setLineItemForm({
      category: item.category || "labor",
      description: item.description || "",
      quantity: item.quantity || "1",
      unit: item.unit || "",
      unit_price: item.unit_price || "",
      notes: item.notes || "",
    });
  }

  async function deleteLineItem(id) {
    if (blockReadOnlyHistory()) return;
    try {
      const { data } = await api.delete(`/projects/proposals/${proposalId}/line-items/${id}/`);
      setProposal((prev) => ({
        ...prev,
        totals: data?.totals || prev?.totals,
        line_items: (prev?.line_items || []).filter((item) => item.id !== id),
      }));
      if (editingLineItemId === id) resetLineItemForm();
      toast.success("Line item removed.");
    } catch (error) {
      console.error(error);
      toast.error("Could not remove line item.");
    }
  }

  async function uploadAttachment(event, type) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (blockReadOnlyHistory()) {
      event.target.value = "";
      return;
    }
    setUploading(true);
    const body = new FormData();
    body.append("file", file);
    body.append("attachment_type", type);
    body.append("category", type === "photo" ? "before" : "customer_file");
    body.append("caption", "");
    try {
      const { data } = await api.post(`/projects/proposals/${proposalId}/attachments/`, body, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setProposal((prev) => ({ ...prev, attachments: [data, ...(prev?.attachments || [])] }));
      toast.success(type === "photo" ? "Photo uploaded." : "Document uploaded.");
    } catch (error) {
      console.error(error);
      toast.error("Upload failed.");
    } finally {
      event.target.value = "";
      setUploading(false);
    }
  }

  async function deleteAttachment(id) {
    if (blockReadOnlyHistory()) return;
    await api.delete(`/projects/proposals/${proposalId}/attachments/${id}/`);
    setProposal((prev) => ({
      ...prev,
      attachments: (prev?.attachments || []).filter((item) => item.id !== id),
    }));
    toast.success("Attachment removed.");
  }

  async function toggleChecklistItem(label) {
    if (blockReadOnlyHistory()) return;
    const current = Array.isArray(draft.quick_checklist) ? draft.quick_checklist : [];
    const next = current.includes(label) ? current.filter((item) => item !== label) : [...current, label];
    patchDraft("quick_checklist", next);
    await saveProposal({ quick_checklist: next }, "Checklist updated.");
  }

  const emailHref = safeHref("email", proposal?.customer_email, `Re: ${proposal?.project_title || "Your project"}`);
  const telHref = safeHref("tel", proposal?.customer_phone);
  const smsHref = safeHref("sms", proposal?.customer_phone);
  const recentPhotos = photos.slice(0, 3);
  const recentMeasurements = (proposal?.measurements || []).slice(-3).reverse();
  const recentNotes = [
    draft.site_visit_notes ? { label: "General note", value: draft.site_visit_notes } : null,
    draft.customer_requests ? { label: "Customer requests", value: draft.customer_requests } : null,
    draft.risk_notes ? { label: "Risk note", value: draft.risk_notes } : null,
  ].filter(Boolean);

  if (loading) {
    return (
      <ContractorPageSurface eyebrow="Estimate Workspace" title="Loading estimate checklist" subtitle="Preparing the pre-agreement workspace.">
        <div className="rounded-xl bg-white p-8 text-sm font-semibold text-slate-600 ring-1 ring-slate-200" data-testid="proposal-loading">
          Loading estimate checklist...
        </div>
      </ContractorPageSurface>
    );
  }

  if (!proposal) {
    return (
      <ContractorPageSurface eyebrow="Estimate Workspace" title="Estimate checklist not found" subtitle="This estimate workspace could not be loaded.">
        <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white" onClick={() => navigate("/app/opportunities")}>
          Back to Opportunities
        </button>
      </ContractorPageSurface>
    );
  }

  if (walkthroughMode) {
    const checklist = Array.isArray(draft.quick_checklist) ? draft.quick_checklist : [];
    return (
      <div className="min-h-screen bg-slate-950 px-3 py-3 text-white md:px-5" data-testid="proposal-walkthrough-mode">
        <header className="sticky top-0 z-50 -mx-3 border-b border-white/10 bg-slate-950/95 px-3 py-3 backdrop-blur md:-mx-5 md:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-blue-200/80">Estimate Checklist Walkthrough</div>
              <h1 className="mt-1 truncate text-2xl font-black text-white">{proposal.project_title || "Estimate"}</h1>
              <p className="mt-1 text-sm font-semibold text-slate-300">{proposal.customer_name || "Customer"} - {proposal.service_location || "Site visit"}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-blue-100" data-testid="walkthrough-checklist-progress">
                  {estimateChecklist.percent}% complete
                </span>
                <span className={`rounded-full px-3 py-1 text-xs font-black ${estimateChecklist.readyMinimum ? "bg-emerald-400 text-emerald-950" : "bg-amber-300 text-amber-950"}`}>
                  {estimateChecklist.readyMinimum ? "Ready for Agreement" : "Checklist in progress"}
                </span>
              </div>
            </div>
            <button
              type="button"
              data-testid="exit-walkthrough-mode"
              onClick={() => setWalkthroughMode(false)}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-black text-slate-950 shadow-sm"
            >
              <X size={18} /> Exit
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-4xl space-y-4 py-4">
          <section className="rounded-2xl bg-white p-4 text-slate-950 shadow-xl" data-testid="walkthrough-primary-actions">
            <div className="mb-3">
              <div className="text-xs font-black uppercase tracking-wide text-slate-500">Next capture steps</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2" data-testid="walkthrough-estimate-checklist">
                {estimateChecklist.items.slice(0, 6).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setWalkthroughMode(false);
                      setActive(item.target);
                    }}
                    className={`rounded-xl px-3 py-2 text-left text-sm font-black ${
                      item.complete ? "bg-emerald-50 text-emerald-900" : "bg-slate-100 text-slate-800"
                    }`}
                  >
                    {item.complete ? "✓ " : "□ "}{item.title}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex min-h-20 cursor-pointer items-center justify-center gap-3 rounded-2xl bg-blue-600 px-4 py-4 text-lg font-black text-white shadow-sm">
                <Camera size={24} /> Take Photo
                <input type="file" accept="image/*" className="hidden" data-testid="walkthrough-photo-upload" onChange={(event) => uploadAttachment(event, "photo")} />
              </label>
              <button
                type="button"
                data-testid="walkthrough-add-measurement"
                onClick={() => setWalkthroughMeasurementOpen((value) => !value)}
                className="flex min-h-20 items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-4 py-4 text-lg font-black text-white shadow-sm"
              >
                <Ruler size={24} /> Add Measurement
              </button>
              <button
                type="button"
                data-testid="walkthrough-quick-note"
                onClick={() => setQuickNoteOpen((value) => !value)}
                className="flex min-h-20 items-center justify-center gap-3 rounded-2xl bg-amber-500 px-4 py-4 text-lg font-black text-slate-950 shadow-sm"
              >
                <StickyNote size={24} /> Quick Note
              </button>
              <button
                type="button"
                disabled
                title="Voice notes are a placeholder for a future phase."
                className="flex min-h-20 cursor-not-allowed items-center justify-center gap-3 rounded-2xl bg-slate-200 px-4 py-4 text-lg font-black text-slate-500"
              >
                <Mic size={24} /> Voice Note
              </button>
              <label className="flex min-h-20 cursor-pointer items-center justify-center gap-3 rounded-2xl bg-slate-900 px-4 py-4 text-lg font-black text-white shadow-sm sm:col-span-2">
                <FileUp size={24} /> Attach Document
                <input type="file" className="hidden" data-testid="walkthrough-document-upload" onChange={(event) => uploadAttachment(event, "document")} />
              </label>
            </div>
          </section>

          {walkthroughMeasurementOpen ? (
            <section className="rounded-2xl bg-white p-4 text-slate-950 shadow-xl" data-testid="walkthrough-measurement-panel">
              <h2 className="text-lg font-black">Add Measurement</h2>
              <form onSubmit={addMeasurement} className="mt-3 grid gap-3 sm:grid-cols-2">
                {["label", "location", "quantity", "unit"].map((key) => (
                  <input
                    key={key}
                    data-testid={`walkthrough-measurement-${key}`}
                    className="min-h-12 rounded-xl border border-slate-300 px-4 py-3 text-base font-semibold"
                    placeholder={key === "quantity" ? "Quantity" : key.charAt(0).toUpperCase() + key.slice(1)}
                    value={measurementForm[key]}
                    onChange={(event) => setMeasurementForm((prev) => ({ ...prev, [key]: event.target.value }))}
                  />
                ))}
                <textarea
                  className="min-h-24 rounded-xl border border-slate-300 px-4 py-3 text-base font-semibold sm:col-span-2"
                  placeholder="Notes"
                  value={measurementForm.notes}
                  onChange={(event) => setMeasurementForm((prev) => ({ ...prev, notes: event.target.value }))}
                />
                <button type="submit" className="min-h-12 rounded-xl bg-emerald-600 px-4 py-3 text-base font-black text-white sm:col-span-2">
                  Save Measurement
                </button>
              </form>
            </section>
          ) : null}

          {quickNoteOpen ? (
            <section className="rounded-2xl bg-white p-4 text-slate-950 shadow-xl" data-testid="walkthrough-note-panel">
              <h2 className="text-lg font-black">Quick Note</h2>
              <textarea
                data-testid="walkthrough-note-input"
                className="mt-3 min-h-36 w-full rounded-xl border border-slate-300 px-4 py-3 text-base font-semibold"
                value={draft.site_visit_notes || ""}
                onChange={(event) => patchDraft("site_visit_notes", event.target.value)}
                placeholder="Capture site observations, customer comments, or follow-up items."
              />
              <button
                type="button"
                data-testid="walkthrough-save-note"
                onClick={() => saveProposal({ site_visit_notes: draft.site_visit_notes || "" }, "Quick note saved.")}
                className="mt-3 min-h-12 w-full rounded-xl bg-blue-600 px-4 py-3 text-base font-black text-white"
              >
                Save Quick Note
              </button>
            </section>
          ) : null}

          <section className="rounded-2xl bg-white p-4 text-slate-950 shadow-xl" data-testid="walkthrough-checklist">
            <h2 className="text-lg font-black">Checklist</h2>
            <div className="mt-3 grid gap-2">
              {WALKTHROUGH_CHECKLIST.map((item) => {
                const checked = checklist.includes(item);
                return (
                  <button
                    key={item}
                    type="button"
                    data-testid={`walkthrough-check-${item.toLowerCase().replaceAll(" ", "-")}`}
                    onClick={() => toggleChecklistItem(item)}
                    className={`flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 text-left text-base font-black ${
                      checked ? "bg-emerald-50 text-emerald-900 ring-2 ring-emerald-300" : "bg-slate-100 text-slate-800"
                    }`}
                  >
                    <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${checked ? "bg-emerald-600 text-white" : "bg-white ring-1 ring-slate-300"}`}>
                      {checked ? <Check size={18} /> : null}
                    </span>
                    {item}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl bg-white p-4 text-slate-950 shadow-xl" data-testid="walkthrough-recent-captures">
            <h2 className="text-lg font-black">Recent Captures</h2>
            <div className="mt-3 grid gap-3">
              {recentPhotos.length ? (
                <div>
                  <div className="text-sm font-black uppercase tracking-wide text-slate-500">Photos</div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {recentPhotos.map((item) => (
                      <button key={item.id} type="button" onClick={() => { setWalkthroughMode(false); setActive("photos"); }} className="rounded-xl bg-slate-100 p-2 text-left">
                        {item.url ? <img src={item.url} alt={item.caption || item.original_name || "Recent photo"} className="h-20 w-full rounded-lg object-cover" /> : null}
                        <div className="mt-1 truncate text-xs font-bold">{item.caption || item.original_name || "Photo"}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {recentMeasurements.length ? (
                <div>
                  <div className="text-sm font-black uppercase tracking-wide text-slate-500">Measurements</div>
                  <div className="mt-2 space-y-2">
                    {recentMeasurements.map((item) => (
                      <button key={item.id} type="button" onClick={() => { setWalkthroughMode(false); setActive("measurements"); }} className="w-full rounded-xl bg-slate-100 px-3 py-2 text-left">
                        <div className="font-black">{item.label}</div>
                        <div className="text-sm font-semibold text-slate-600">{item.quantity} {item.unit} - {field(item.location)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {recentNotes.length ? (
                <div>
                  <div className="text-sm font-black uppercase tracking-wide text-slate-500">Notes</div>
                  <div className="mt-2 space-y-2">
                    {recentNotes.slice(0, 3).map((item) => (
                      <button key={item.label} type="button" onClick={() => { setWalkthroughMode(false); setActive("site"); }} className="w-full rounded-xl bg-slate-100 px-3 py-2 text-left">
                        <div className="font-black">{item.label}</div>
                        <div className="line-clamp-2 text-sm font-semibold text-slate-600">{item.value}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {!recentPhotos.length && !recentMeasurements.length && !recentNotes.length ? (
                <div className="rounded-xl bg-slate-100 p-4 text-sm font-bold text-slate-600">No captures yet. Start with a photo, measurement, or quick note.</div>
              ) : null}
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <ContractorPageSurface
      variant="operational"
      eyebrow="Estimate Workspace"
      title={proposal.project_title || "Estimate Workspace"}
      subtitle="Prepare scope, pricing, evidence, and agreement handoff details in one focused workspace."
      actions={
        <>
          <button
            type="button"
            data-testid="enter-walkthrough-mode"
            className="rounded-lg border border-sky-300/30 bg-sky-400/15 px-3 py-2 text-sm font-black text-white shadow-sm hover:bg-sky-400/24"
            onClick={() => setWalkthroughMode(true)}
          >
            Enter Walkthrough Mode
          </button>
          <button
            type="button"
            data-testid="proposal-create-agreement-action"
            disabled={!estimateChecklist.readyMinimum || isReadOnlyHistory}
            className={ESTIMATE_PRIMARY_GOLD_BUTTON}
            onClick={createAgreementFromProposal}
          >
            <FileSignature size={16} /> Create Agreement from Estimate
          </button>
          <button
            type="button"
            className="rounded-lg border border-white/18 bg-white/10 px-3 py-2 text-sm font-bold text-white shadow-sm hover:bg-white/15"
            onClick={() => navigate("/app/opportunities")}
          >
            Opportunities
          </button>
        </>
      }
    >
      {isReadOnlyHistory ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900" data-testid="proposal-read-only-history">
          This estimate has been converted and remains available as read-only history. The linked agreement is now the active operational record.
        </div>
      ) : null}
      <div
        className="mb-4 rounded-2xl border border-sky-200/14 bg-[#061d42]/95 p-4 text-white shadow-[0_24px_70px_rgba(2,8,23,0.34)] md:p-5"
        data-testid="proposal-workspace-header"
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase ${estimateChecklist.readyMinimum ? "border-emerald-200/35 bg-emerald-400/12 text-emerald-100" : "border-amber-200/35 bg-amber-400/12 text-amber-100"}`}>
                {estimateChecklist.readyMinimum ? "Ready for agreement" : "Preparing estimate"}
              </span>
              <span className="rounded-full border border-white/12 bg-white/8 px-3 py-1 text-xs font-bold text-sky-100/80">
                {proposal.status_label || proposal.status || "Draft"}
              </span>
              {isReadOnlyHistory ? (
                <span className="rounded-full border border-emerald-200/35 bg-emerald-400/12 px-3 py-1 text-xs font-bold text-emerald-100">
                  Converted history
                </span>
              ) : null}
            </div>
            <h2 className="mt-3 truncate text-2xl font-black text-white md:text-3xl">
              {proposal.project_title || "Untitled estimate"}
            </h2>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-sky-100/78">
              <span>{proposal.customer_name || "Customer not set"}</span>
              <span>{proposal.service_location || "No project address"}</span>
              {opportunityReference ? <span>{opportunityReference}</span> : null}
              <span>Updated {formatDateTime(proposal.updated_at)}</span>
            </div>
          </div>
          <div className="grid min-w-[14rem] gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-xl border border-white/10 bg-white/8 p-3">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-100/55">Readiness</div>
              <div className="mt-1 text-2xl font-black text-white">{estimateChecklist.percent}%</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/8 p-3">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-100/55">Missing</div>
              <div className="mt-1 text-2xl font-black text-white">{estimateChecklist.requiredMissing.length}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/8 p-3">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-100/55">Value</div>
              <div className="mt-1 text-2xl font-black text-white">{money(totals.total)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)_280px]" data-testid="proposal-workspace">
        <aside className="rounded-2xl border border-sky-200/14 bg-[#061d42]/95 p-3 text-white shadow-[0_24px_70px_rgba(2,8,23,0.3)] lg:sticky lg:top-4 lg:self-start" data-testid="proposal-nav">
          <div className="mb-3 px-1">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-100/80">Estimate progress</div>
            <div className="mt-1 text-sm font-semibold text-sky-100/68">{estimateChecklist.completedCount} of {estimateChecklist.items.length} readiness requirements complete</div>
          </div>
          <nav className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <button
              type="button"
              data-testid="proposal-nav-overview"
              onClick={() => setActive("overview")}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                active === "overview"
                  ? "border-sky-300/45 bg-sky-400/16 text-white shadow-[0_12px_32px_rgba(14,165,233,0.12)]"
                  : "border-white/10 bg-white/6 text-sky-100/78 hover:border-white/22 hover:bg-white/10 hover:text-white"
              }`}
            >
              <NavStatusIcon tone={estimateChecklist.readyMinimum ? "complete" : "warning"} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-black">Project Overview</span>
              </span>
            </button>
            <button
              type="button"
              data-testid="proposal-nav-assistant"
              onClick={() => setActive("assistant")}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                active === "assistant"
                  ? "border-sky-300/45 bg-sky-400/16 text-white shadow-[0_12px_32px_rgba(14,165,233,0.12)]"
                  : "border-white/10 bg-white/6 text-sky-100/78 hover:border-white/22 hover:bg-white/10 hover:text-white"
              }`}
            >
              <NavStatusIcon tone={estimateChecklist.requiredMissing.length ? "warning" : "complete"} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-black">Project Assistant</span>
                <span className="block truncate text-[10px] font-bold uppercase tracking-[0.08em] text-sky-100/45">Guidance</span>
              </span>
            </button>
            {WORKFLOW_GROUPS.map((group) => (
              <div key={group.key} className="space-y-1.5">
                <div className="flex items-center gap-2 px-1 text-[10px] font-black uppercase tracking-[0.18em] text-sky-100/45">
                  <NavStatusIcon {...workflowGroupStatus(group, estimateChecklist, proposal, photos, documents, isReadOnlyHistory)} />
                  <span>{group.label}</span>
                </div>
                {group.sections.map(([key, label]) => {
              const sectionItem = sectionChecklistItemForNav(key, estimateChecklist, proposal, photos, documents);
              const isBlocked = key === "ready" && isReadOnlyHistory;
              const tone = statusToneFromItem(sectionItem, isBlocked);
              const statusLabel = statusLabelFromTone(tone, sectionItem?.required);
              const isRecommended = key === recommendedSectionKey && active !== key;
              return (
                <button
                  key={key}
                  type="button"
                  data-testid={`proposal-nav-${key}`}
                  aria-label={`${label}: ${sectionItem?.required ? "Required" : "Optional"}, ${statusLabel}${isRecommended ? ", next recommended section" : ""}`}
                  title={`${sectionItem?.required ? "Required" : "Optional"} - ${statusLabel}${isRecommended ? " - Next" : ""}`}
                  onClick={() => setActive(key)}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                    active === key
                      ? "border-sky-300/45 bg-sky-400/16 text-white shadow-[0_12px_32px_rgba(14,165,233,0.12)]"
                      : isRecommended
                        ? "border-amber-200/42 bg-amber-300/10 text-white shadow-[inset_3px_0_0_rgba(251,191,36,0.78)] hover:bg-amber-300/14"
                        : "border-white/10 bg-white/6 text-sky-100/78 hover:border-white/22 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <NavStatusIcon tone={tone} label={statusLabel} />
                  <RequiredMarker required={sectionItem?.required} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black">{label}</span>
                    {!sectionItem?.required ? (
                      <span className="block truncate text-[10px] font-bold uppercase tracking-[0.08em] text-sky-100/45">Optional</span>
                    ) : null}
                  </span>
                  {isRecommended ? <span className="rounded-full bg-amber-300/18 px-2 py-0.5 text-[10px] font-black uppercase text-amber-100">Next</span> : null}
                </button>
              );
                })}
              </div>
            ))}
          </nav>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-white/10 px-1 pt-3 text-[10px] font-bold text-sky-100/55" data-testid="proposal-nav-legend">
            <span><span className="text-amber-200" aria-hidden="true">*</span> Required</span>
            <span><CheckCircle2 className="inline h-3 w-3 text-emerald-200" aria-hidden="true" /> Complete</span>
            <span><AlertTriangle className="inline h-3 w-3 text-amber-200" aria-hidden="true" /> Needs attention</span>
            <span><Circle className="inline h-3 w-3 text-sky-100/45" aria-hidden="true" /> Optional</span>
            <span><Lock className="inline h-3 w-3 text-rose-200" aria-hidden="true" /> Blocked</span>
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          <Section id="overview" active={active === "overview"} title="Project Overview">
            <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4 text-white" data-testid="estimate-checklist-progress">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-200/80">Estimate Readiness</div>
                  <div className="mt-1 text-3xl font-black">{estimateChecklist.percent}%</div>
                  <div className="mt-1 text-sm font-semibold text-slate-300">
                    {estimateChecklist.completedCount} of {estimateChecklist.items.length} readiness requirements complete
                  </div>
                </div>
                <div className={`rounded-xl px-4 py-3 text-sm font-black ${estimateChecklist.readyMinimum ? "bg-emerald-400 text-emerald-950" : "bg-amber-300 text-amber-950"}`} data-testid="estimate-ready-status">
                  {estimateChecklist.readyMinimum ? "Estimate Ready" : "Required items missing"}
                </div>
              </div>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-emerald-400" style={{ width: `${estimateChecklist.percent}%` }} />
              </div>
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-2" data-testid="estimate-checklist-sections">
              {overviewGroups.map((group) => (
                <OverviewWorkflowGroup key={group.key} group={group} onOpen={setActive} />
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-white/7 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(proposal.status)}`} data-testid="proposal-status">
                  {proposal.status_label}
                </span>
                <select
                  data-testid="proposal-status-select"
                  value={draft.status}
                  onChange={(event) => patchDraft("status", event.target.value)}
                  className="rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white"
                >
                  <option value="draft">Draft</option>
                  <option value="site_visit">Site Visit</option>
                  <option value="in_progress">Estimate In Progress</option>
                  <option value="ready">Estimate Ready</option>
                  <option value="sent">Estimate Sent</option>
                  <option value="viewed">Viewed</option>
                  <option value="accepted">Accepted</option>
                  <option value="declined">Declined</option>
                  <option value="revision_requested">Revision Requested</option>
                  <option value="expired">Expired</option>
                  <option value="converted">Converted</option>
                </select>
                <button
                  type="button"
                  data-testid="proposal-save-status"
                  onClick={() => saveProposal({ status: draft.status }, "Status updated.")}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
                >
                  <Save size={16} /> Save
                </button>
              </div>
            </div>
          </Section>

          <Section id="assistant" active={active === "assistant"} title="Project Assistant">
            <div className="rounded-2xl border border-sky-200/16 bg-slate-950/42 p-4 text-white" data-testid="proposal-assistant-guidance">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.45fr)] lg:items-start">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-100/80">Project Assistant</div>
                  <h3 className="mt-1 text-xl font-black text-white">
                    {highestPriorityItem?.complete ? "Estimate guidance is current" : highestPriorityItem?.action || "Review readiness"}
                  </h3>
                  <p className="mt-2 text-sm font-semibold leading-6 text-sky-100/72">
                    {highestPriorityItem?.summary || "Project Assistant organizes estimate readiness so the contractor can review and approve the handoff."}
                  </p>
                  {highestPriorityItem && !highestPriorityItem.complete ? (
                    <button
                      type="button"
                      data-testid="proposal-assistant-primary-action"
                      onClick={() => setActive(highestPriorityItem.target || "overview")}
                      className={`mt-3 ${ESTIMATE_PRIMARY_GOLD_BUTTON}`}
                    >
                      {highestPriorityItem.action || "Open section"}
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                  <div className="rounded-xl border border-white/10 bg-white/8 p-3">
                    <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-100/55">Readiness</div>
                    <div className="mt-1 text-2xl font-black text-white">{estimateChecklist.percent}%</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/8 p-3">
                    <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-100/55">Unresolved blockers</div>
                    <div className="mt-1 text-2xl font-black text-white">{estimateChecklist.requiredMissing.length}</div>
                  </div>
                </div>
              </div>
              <div
                className="mt-4 flex items-start gap-2 rounded-xl border border-white/10 bg-white/6 px-3 py-2 text-xs font-semibold leading-5 text-sky-100/68"
                data-testid="proposal-assistant-approval-reminder"
              >
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-100/70" aria-hidden="true" />
                <span>Contractor approval is required before pricing, messages, or agreement creation are finalized.</span>
              </div>
            </div>

            <div className="mt-4 grid gap-4">
              <div className="rounded-xl border border-white/10 bg-white/7 p-4 text-white" data-testid="proposal-template-recommendation">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-200/80">Template Workflow</div>
                <h3 className="mt-2 text-lg font-black text-white">
                  {templateLoading
                    ? "Searching Agreement Template Library..."
                    : templateRecommendation
                      ? "Recommended agreement template"
                      : "Generated draft agreement template"}
                </h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-sky-100/72">
                  {selectedTemplate?.match_reason || "Project Assistant prepares a draft template structure for contractor review before the Agreement Wizard."}
                </p>
                <div className="mt-4 rounded-xl bg-white/10 p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-sky-100/55">Selected</div>
                  <div className="mt-1 text-lg font-black text-white">{selectedTemplate?.name || "Template search pending"}</div>
                  <div className="mt-1 text-sm font-semibold text-blue-100">{selectedTemplate?.match_label || templateChoice}</div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {templateRecommendation ? (
                    <>
                      <button
                        type="button"
                        data-testid="proposal-use-template"
                        onClick={() => {
                          setSelectedTemplate(templateRecommendation);
                          setTemplateChoice("recommended");
                          toast.success("Template selected for estimate checklist.");
                        }}
                        className="rounded-lg bg-emerald-400 px-3 py-2 text-sm font-black text-emerald-950"
                      >
                        Use Template
                      </button>
                      <button
                        type="button"
                        data-testid="proposal-choose-template"
                        onClick={() => navigate("/app/templates")}
                        className="rounded-lg bg-white/10 px-3 py-2 text-sm font-black text-white ring-1 ring-white/20"
                      >
                        Choose Another
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      data-testid="proposal-generate-template"
                      onClick={() => {
                        setSelectedTemplate(fallbackTemplateForProposal(proposal));
                        setTemplateChoice("generated");
                        toast.success("Draft agreement template generated for review.");
                      }}
                      className={ESTIMATE_PRIMARY_GOLD_BUTTON}
                    >
                      Generate Draft Agreement Template
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="proposal-start-blank-template"
                    onClick={() => {
                      setSelectedTemplate(fallbackTemplateForProposal({ project_type: "Blank" }));
                      setTemplateChoice("blank");
                      toast.success("Estimate checklist set to start blank.");
                    }}
                      className="rounded-lg border border-white/18 bg-white/10 px-3 py-2 text-sm font-black text-white hover:bg-white/15"
                  >
                    Start Blank
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/7 p-4" data-testid="proposal-assistant-suggestions">
                <div className="text-xs font-black uppercase tracking-wide text-sky-100/58">Suggestions</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[
                    ["Improve Scope", "scope", !compactText(draft.included_work)],
                    ["Missing Information", "clarifications", !clarificationRows.every((row) => row.complete)],
                    ["Risk Review", "site", !compactText(draft.risk_notes)],
                    ["Suggested Questions", "clarifications", true],
                    ["Template Match", "assistant", true],
                    ["Generate Scope", "scope", !compactText(draft.included_work)],
                    ["Estimate Readiness", "overview", true],
                  ].map(([label, target, show]) => show ? (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setActive(target)}
                      className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/8 px-3 py-2 text-left text-sm font-black text-white hover:bg-white/12"
                    >
                      {label}
                      <span className="text-xs text-sky-100/70">Jump</span>
                    </button>
                  ) : null)}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-white/7 p-4" data-testid="proposal-readiness-missing">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-xs font-black uppercase tracking-wide text-sky-100/58">Estimate Readiness</div>
                  <div className="mt-1 text-2xl font-black text-white">{estimateChecklist.percent}%</div>
                </div>
                <button type="button" onClick={() => setActive("overview")} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-black text-white">
                  Jump to Readiness
                </button>
              </div>
              {estimateChecklist.requiredMissing.length ? (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {estimateChecklist.requiredMissing.map((item) => (
                    <div key={item.key} className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
                      <div className="font-black text-white">{item.title}</div>
                      <div className="mt-1 text-sm font-semibold text-sky-100/68">{item.missing.join(", ")}</div>
                      <div className="mt-2 flex gap-2">
                        <button type="button" onClick={() => setActive(item.target)} className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-black text-white">Jump to Section</button>
                        <button type="button" onClick={() => toast.success("Assumption noted for contractor review.")} className="rounded-lg border border-white/14 bg-white/8 px-3 py-1.5 text-xs font-black text-white">Mark Assumption</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-emerald-200/25 bg-emerald-400/10 p-3 text-sm font-black text-emerald-100">
                  Estimate Ready. Open the Agreement Wizard when you are ready to review the draft agreement.
                </div>
              )}
            </div>
          </Section>

          <Section id="clarifications" active={active === "clarifications"} title="Clarification Questions">
            <div className="rounded-lg border border-white/10 bg-white/7 p-3 text-sm font-semibold text-sky-100/72" data-testid="proposal-clarification-intro">
              Questions come from the selected or generated agreement template. Project Assistant auto-completes questions when measurements, photos, notes, or scope already answer them.
            </div>
            <div className="mt-4 space-y-3" data-testid="proposal-clarification-questions">
              {clarificationRows.map((row) => (
                <article key={row.key} className={`rounded-xl border p-4 ${row.complete ? "border-emerald-200/30 bg-emerald-400/10" : "border-amber-200/30 bg-amber-400/10"}`}>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-black text-white">{row.label}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${row.complete ? "bg-emerald-600 text-white" : "bg-amber-300 text-amber-950"}`} data-testid={`proposal-clarification-status-${row.key}`}>
                          {row.status}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-sky-100/74">{row.question}</p>
                      {row.autoComplete ? (
                        <p className="mt-2 text-xs font-bold text-emerald-800">Auto-completed from captured estimate details.</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button type="button" onClick={() => setActive(row.target)} className="rounded-lg border border-white/16 bg-white/10 px-3 py-2 text-xs font-black text-white">Jump</button>
                      <button type="button" data-testid={`proposal-clarification-complete-${row.key}`} onClick={() => setClarificationState(row, "complete")} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white">Mark Complete</button>
                      <button type="button" onClick={() => setClarificationState(row, "ignored")} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white">Ignore</button>
                      <button type="button" onClick={() => setClarificationState(row, "open")} className="rounded-lg border border-white/16 bg-white/10 px-3 py-2 text-xs font-black text-white">Reopen</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </Section>

          <Section id="appointment" active={active === "appointment"} title="Estimate Appointment">
            {proposal.appointment ? (
              <InfoGrid
                rows={[
                  ["Date and time", formatDateTime(proposal.appointment.scheduled_start)],
                  ["Type", proposal.appointment.appointment_type_label],
                  ["Status", proposal.appointment.status],
                  ["Requested by", proposal.appointment.requested_by],
                  ["Timezone", proposal.appointment.timezone],
                  ["Notes", proposal.appointment.notes],
                ]}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-white/16 bg-white/6 p-4 text-sm font-semibold text-sky-100/70">
                No estimate appointment is linked yet. Appointment details from intake or opportunity review will appear here when available.
              </div>
            )}
          </Section>

          <Section id="customer" active={active === "customer"} title="Customer & Contact">
            <InfoGrid
              rows={[
                ["Customer", proposal.customer_name],
                ["Phone", proposal.customer_phone],
                ["Email", proposal.customer_email],
                ["Project Address", draft.service_location || proposal.service_location],
                ["Preferred contact", draft.customer_preferred_contact || "Not set"],
              ]}
            />
            <div className="mt-4 rounded-xl border border-white/10 bg-white/7 p-4" data-testid="proposal-project-address-workflow">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-sm font-black text-white">Project Address</h3>
                  <p className="mt-1 text-sm font-semibold text-sky-100/70">
                    Every estimate needs a project address before it can move to the Agreement Wizard.
                  </p>
                </div>
                {matchedCustomer ? (
                  <span className="rounded-full border border-white/14 bg-white/8 px-3 py-1 text-xs font-black text-sky-100/78">
                    Matched customer profile
                  </span>
                ) : null}
              </div>
              {propertyOptions.length ? (
                <label className="mt-4 block">
                  <span className="text-xs font-black uppercase tracking-wide text-sky-100/55">Select Existing Property</span>
                  <select
                    data-testid="proposal-existing-property-select"
                    value=""
                    onChange={(event) => {
                      if (event.target.value) patchDraft("service_location", event.target.value);
                    }}
                    className="mt-1 w-full rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white"
                  >
                    <option value="">Choose saved property...</option>
                    {propertyOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.value}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="mt-4 rounded-lg border border-dashed border-white/16 bg-white/6 px-3 py-3 text-sm font-semibold text-sky-100/70">
                  No saved properties found for this customer. Enter a new project address below.
                </div>
              )}
              <label className="mt-4 block">
                <span className="text-xs font-black uppercase tracking-wide text-sky-100/55">New Project Address</span>
                <input
                  data-testid="proposal-project-address-input"
                  value={draft.service_location || ""}
                  onChange={(event) => patchDraft("service_location", event.target.value)}
                  placeholder="Street, city, state, zip"
                  className="mt-1 w-full rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white"
                />
              </label>
              <label className={`mt-3 flex items-center gap-2 text-sm font-bold ${matchedCustomer ? "text-sky-100/78" : "text-sky-100/38"}`}>
                <input
                  type="checkbox"
                  data-testid="proposal-save-address-to-customer"
                  checked={saveAddressToCustomer}
                  disabled={!matchedCustomer}
                  onChange={(event) => setSaveAddressToCustomer(event.target.checked)}
                />
                Save new project address back to customer profile
              </label>
              <button
                type="button"
                data-testid="proposal-save-project-address"
                onClick={saveProjectAddress}
                disabled={savingAddress}
                className="mt-3 rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
              >
                {savingAddress ? "Saving..." : "Save Project Address"}
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2" data-testid="proposal-customer-actions">
              <a className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold ${telHref ? "bg-slate-900 text-white" : "pointer-events-none bg-slate-100 text-slate-400"}`} href={telHref || "#"}><Phone size={16} /> Call</a>
              <a className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold ${emailHref ? "bg-blue-600 text-white" : "pointer-events-none bg-slate-100 text-slate-400"}`} href={emailHref || "#"}><Mail size={16} /> Email</a>
              <a className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold ${smsHref ? "bg-emerald-600 text-white" : "pointer-events-none bg-slate-100 text-slate-400"}`} href={smsHref || "#"}>Text</a>
              <button
                type="button"
                className="rounded-lg border border-white/16 bg-white/10 px-3 py-2 text-sm font-bold text-white hover:bg-white/15"
                onClick={() => {
                  navigator.clipboard?.writeText(`${proposal.customer_name}\n${proposal.customer_email}\n${proposal.customer_phone}\n${proposal.service_location}`);
                  toast.success("Customer details copied.");
                }}
              >
                Copy
              </button>
            </div>
          </Section>

          <Section id="scheduling" active={active === "scheduling"} title="Project Scheduling">
            <div className="rounded-xl bg-slate-950 p-4 text-white" data-testid="proposal-scheduling-summary">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-200/80">Structured scheduling inputs</div>
              <div className="mt-2 text-lg font-black">{proposalScheduleSummary({ ...proposal, ...draft })}</div>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">
                These fields stay separate from scope notes so future milestone planning and Project Assistant scheduling analysis can use them directly.
              </p>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <SelectField
                label="Project Start"
                value={draft.project_start_type || "flexible"}
                onChange={(value) => patchDraft("project_start_type", value)}
                options={PROJECT_START_OPTIONS}
                testId="proposal-schedule-start-type"
              />
              <DateField
                label="Start Date"
                value={draft.project_start_date || ""}
                onChange={(value) => patchDraft("project_start_date", value)}
                disabled={draft.project_start_type !== "specific_date"}
                testId="proposal-schedule-start-date"
              />
              <SelectField
                label="Priority"
                value={draft.scheduling_priority || "flexible"}
                onChange={(value) => patchDraft("scheduling_priority", value)}
                options={SCHEDULING_PRIORITY_OPTIONS}
                testId="proposal-schedule-priority"
              />
              <SelectField
                label="Project Completion"
                value={draft.project_completion_type || "no_deadline"}
                onChange={(value) => patchDraft("project_completion_type", value)}
                options={PROJECT_COMPLETION_OPTIONS}
                testId="proposal-schedule-completion-type"
              />
              <DateField
                label="Completion Date"
                value={draft.project_completion_date || ""}
                onChange={(value) => patchDraft("project_completion_date", value)}
                disabled={draft.project_completion_type !== "specific_date"}
                testId="proposal-schedule-completion-date"
              />
            </div>
            <button
              type="button"
              data-testid="proposal-save-scheduling"
              onClick={() => saveProposal({
                project_start_type: draft.project_start_type || "flexible",
                project_start_date: draft.project_start_type === "specific_date" ? draft.project_start_date : "",
                project_completion_type: draft.project_completion_type || "no_deadline",
                project_completion_date: draft.project_completion_type === "specific_date" ? draft.project_completion_date : "",
                scheduling_priority: draft.scheduling_priority || "flexible",
              }, "Scheduling saved.")}
              disabled={saving}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              <Save size={16} /> Save Scheduling
            </button>
          </Section>

          <Section id="site" active={active === "site"} title="Site Access, Conditions, and Requests">
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="proposal-mobile-capture-actions">
              <button type="button" onClick={() => setActive("photos")} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm font-bold text-blue-800"><Camera size={16} /> Take Photo</button>
              <button type="button" onClick={() => setActive("measurements")} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800"><Ruler size={16} /> Add Measurement</button>
              <button type="button" onClick={() => patchDraft("site_visit_notes", `${draft.site_visit_notes || ""}${draft.site_visit_notes ? "\n" : ""}`)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800"><StickyNote size={16} /> Quick Note</button>
              <button type="button" disabled className="rounded-lg border border-white/10 bg-white/6 px-3 py-2 text-sm font-bold text-sky-100/38">Voice Note</button>
              <button type="button" onClick={() => setActive("documents")} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/14 bg-white/8 px-3 py-2 text-sm font-bold text-white hover:bg-white/12"><FileUp size={16} /> Attach File</button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <TextAreaField label="General notes" testId="proposal-site-notes" value={draft.site_visit_notes} onChange={(value) => patchDraft("site_visit_notes", value)} />
              <TextAreaField label="Access notes" value={draft.access_notes} onChange={(value) => patchDraft("access_notes", value)} />
              <TextAreaField label="Risk notes" value={draft.risk_notes} onChange={(value) => patchDraft("risk_notes", value)} />
              <TextAreaField label="Customer requests" value={draft.customer_requests} onChange={(value) => patchDraft("customer_requests", value)} />
              <TextAreaField label="Conditions" value={draft.site_conditions} onChange={(value) => patchDraft("site_conditions", value)} />
            </div>
            <button
              type="button"
              data-testid="proposal-save-site-visit"
              onClick={() => saveProposal({
                site_visit_notes: draft.site_visit_notes,
                access_notes: draft.access_notes,
                risk_notes: draft.risk_notes,
                customer_requests: draft.customer_requests,
                site_conditions: draft.site_conditions,
              }, "Site visit saved.")}
              disabled={saving}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              <Save size={16} /> Save Site Visit
            </button>
          </Section>

          <Section id="measurements" active={active === "measurements"} title="Measurements">
            <form onSubmit={addMeasurement} className="grid gap-3 rounded-lg border border-white/10 bg-white/7 p-3 md:grid-cols-5" data-testid="proposal-measurement-form">
              {["label", "location", "quantity", "unit"].map((key) => (
                <input
                  key={key}
                  data-testid={`proposal-measurement-${key}`}
                  className="rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white placeholder:text-sky-100/42 focus:border-sky-300 focus:outline-none"
                  placeholder={key === "quantity" ? "Quantity" : key.charAt(0).toUpperCase() + key.slice(1)}
                  value={measurementForm[key]}
                  onChange={(event) => setMeasurementForm((prev) => ({ ...prev, [key]: event.target.value }))}
                />
              ))}
              <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white">
                <Plus size={16} /> Add
              </button>
              <textarea
                className="md:col-span-5 rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white placeholder:text-sky-100/42 focus:border-sky-300 focus:outline-none"
                placeholder="Notes"
                value={measurementForm.notes}
                onChange={(event) => setMeasurementForm((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </form>
            <div className="mt-4 space-y-2" data-testid="proposal-measurement-list">
              {(proposal.measurements || []).length ? proposal.measurements.map((item) => (
                <div key={item.id} className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/7 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-bold text-white">{item.label}</div>
                    <div className="text-sm text-sky-100/70">{field(item.location)} - {item.quantity} {item.unit}</div>
                    {item.notes ? <div className="text-sm text-sky-100/55">{item.notes}</div> : null}
                  </div>
                  <button type="button" onClick={() => deleteMeasurement(item.id)} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-2 text-sm font-bold text-rose-700">
                    <Trash2 size={15} /> Remove
                  </button>
                </div>
              )) : (
                <div className="rounded-lg border border-dashed border-white/16 bg-white/6 p-4 text-sm font-semibold text-sky-100/70">No measurements have been entered yet. Add dimensions, quantities, or site notes that support the estimate scope.</div>
              )}
            </div>
          </Section>

          <Section id="photos" active={active === "photos"} title="Photos">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white">
              <Camera size={16} /> {uploading ? "Uploading..." : "Upload Photo"}
              <input type="file" accept="image/*" className="hidden" data-testid="proposal-photo-upload" onChange={(event) => uploadAttachment(event, "photo")} />
            </label>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="proposal-photo-gallery">
              {photos.length ? photos.map((item) => (
                <div key={item.id} className="rounded-lg border border-white/10 bg-white/7 p-3">
                {item.url ? <img src={item.url} alt={item.caption || item.original_name || "Estimate photo"} className="h-40 w-full rounded-md object-cover" /> : null}
                  <div className="mt-2 text-sm font-bold text-white">{item.caption || item.original_name || "Photo"}</div>
                  <button type="button" onClick={() => deleteAttachment(item.id)} className="mt-2 text-sm font-bold text-rose-700">Remove</button>
                </div>
              )) : <div className="rounded-lg border border-dashed border-white/16 bg-white/6 p-4 text-sm font-semibold text-sky-100/70">No photos uploaded yet. Add before photos, access constraints, or existing-condition images when available.</div>}
            </div>
          </Section>

          <Section id="documents" active={active === "documents"} title="Documents">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white">
              <FileUp size={16} /> {uploading ? "Uploading..." : "Upload Document"}
              <input type="file" className="hidden" data-testid="proposal-document-upload" onChange={(event) => uploadAttachment(event, "document")} />
            </label>
            <div className="mt-4 space-y-2" data-testid="proposal-document-list">
              {documents.length ? documents.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/7 p-3">
                  <a href={item.url || "#"} className="font-bold text-sky-100" target="_blank" rel="noreferrer">{item.original_name || "Document"}</a>
                  <button type="button" onClick={() => deleteAttachment(item.id)} className="text-sm font-bold text-rose-700">Remove</button>
                </div>
              )) : <div className="rounded-lg border border-dashed border-white/16 bg-white/6 p-4 text-sm font-semibold text-sky-100/70">No documents uploaded yet. Plans, customer files, material sheets, and supporting documents will appear here.</div>}
            </div>
          </Section>

          <Section id="estimate" active={active === "estimate"} title="Estimate Pricing">
            <div className="rounded-lg border border-sky-200/18 bg-sky-400/10 p-3 text-sm font-semibold text-sky-100/78">
              Build the labor, materials, equipment, subcontractor costs, and adjustments that make up this estimate. Pricing remains editable when carried into the Agreement Wizard.
            </div>
            <form onSubmit={submitLineItem} className="mt-4 grid gap-3 rounded-lg border border-white/10 bg-white/7 p-3 md:grid-cols-6" data-testid="proposal-line-item-form">
              <div className="md:col-span-6 grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-slate-950/24 px-3 py-2">
                  <div className="text-xs font-black uppercase tracking-[0.12em] text-sky-100/55">Cost Categories</div>
                  <div className="mt-1 text-sm font-semibold text-sky-100/72">Labor, materials, equipment, subcontractor, and other direct job costs.</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-950/24 px-3 py-2">
                  <div className="text-xs font-black uppercase tracking-[0.12em] text-sky-100/55">Pricing Adjustments</div>
                  <div className="mt-1 text-sm font-semibold text-sky-100/72">Allowances, incidentals reserve, tax, and discounts.</div>
                </div>
              </div>
              <select
                data-testid="proposal-line-category"
                className="rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white focus:border-sky-300 focus:outline-none md:col-span-2"
                value={lineItemForm.category}
                onChange={(event) => patchLineItemForm("category", event.target.value)}
              >
                <optgroup label="Cost Categories">
                  {LINE_ITEM_CATEGORIES.filter(([value]) => COST_CATEGORY_VALUES.has(value)).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </optgroup>
                <optgroup label="Pricing Adjustments">
                  {LINE_ITEM_CATEGORIES.filter(([value]) => PRICING_ADJUSTMENT_VALUES.has(value)).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </optgroup>
              </select>
              <input
                data-testid="proposal-line-description"
                className="rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white placeholder:text-sky-100/42 focus:border-sky-300 focus:outline-none md:col-span-4"
                placeholder="Description"
                value={lineItemForm.description}
                onChange={(event) => patchLineItemForm("description", event.target.value)}
              />
              <input
                data-testid="proposal-line-quantity"
                className="rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white placeholder:text-sky-100/42 focus:border-sky-300 focus:outline-none"
                placeholder="Qty"
                value={lineItemForm.quantity}
                onChange={(event) => patchLineItemForm("quantity", event.target.value)}
              />
              <input
                data-testid="proposal-line-unit"
                className="rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white placeholder:text-sky-100/42 focus:border-sky-300 focus:outline-none"
                placeholder="Unit"
                value={lineItemForm.unit}
                onChange={(event) => patchLineItemForm("unit", event.target.value)}
              />
              <input
                data-testid="proposal-line-unit-price"
                className="rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white placeholder:text-sky-100/42 focus:border-sky-300 focus:outline-none"
                placeholder="Unit price"
                value={lineItemForm.unit_price}
                onChange={(event) => patchLineItemForm("unit_price", event.target.value)}
              />
              <input
                data-testid="proposal-line-notes"
                className="rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white placeholder:text-sky-100/42 focus:border-sky-300 focus:outline-none md:col-span-2"
                placeholder="Notes"
                value={lineItemForm.notes}
                onChange={(event) => patchLineItemForm("notes", event.target.value)}
              />
              <div className="flex gap-2">
                <button type="submit" className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white">
                  <Plus size={16} /> {editingLineItemId ? "Update" : "Add"}
                </button>
                {editingLineItemId ? (
                  <button type="button" onClick={resetLineItemForm} className="rounded-lg border border-white/16 px-3 py-2 text-sm font-bold text-white">
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>

            <div className="mt-4 overflow-hidden rounded-lg border border-white/10" data-testid="proposal-line-item-list">
              {(proposal.line_items || []).length ? (
                <div className="divide-y divide-white/10">
                  {(proposal.line_items || []).map((item) => (
                    <div key={item.id} className="grid gap-3 bg-white/7 p-3 md:grid-cols-[minmax(0,1fr)_120px_120px_120px_auto] md:items-center">
                      <div className="min-w-0">
                        <div className="text-xs font-black uppercase tracking-wide text-sky-100/55">{item.category_label}</div>
                        <div className="font-bold text-white">{item.description}</div>
                        {item.notes ? <div className="text-sm text-sky-100/55">{item.notes}</div> : null}
                      </div>
                      <div className="text-sm font-semibold text-sky-100/72">{item.quantity} {item.unit}</div>
                      <div className="text-sm font-semibold text-sky-100/72">{money(item.unit_price)}</div>
                      <div className="text-base font-black text-white">{money(item.total)}</div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => editLineItem(item)} className="rounded-lg border border-white/16 px-3 py-2 text-sm font-bold text-white">Edit</button>
                        <button type="button" onClick={() => deleteLineItem(item.id)} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-bold text-rose-700">Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="border border-dashed border-white/16 bg-white/6 p-4 text-sm font-semibold text-sky-100/70">No estimate pricing entries yet. Add labor, materials, allowances, or incidentals before creating an agreement.</div>
              )}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="proposal-estimate-totals">
              {[
                ["Subtotal", totals.subtotal],
                ["Tax", totals.tax],
                ["Discounts", totals.discounts],
                ["Incidentals & Allowances", totals.incidentals_reserve],
                ["Total", totals.total],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-slate-950 px-3 py-3 text-white">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</div>
                  <div className="mt-1 text-lg font-black">{money(value)}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section id="incidentals" active={active === "incidentals"} title="Incidentals & Allowances">
            <div className="rounded-xl bg-slate-950 p-4 text-white">
              <div className="text-xs font-black uppercase tracking-wide text-slate-400">Current reserve</div>
              <div className="mt-1 text-3xl font-black">{money(totals.incidentals_reserve)}</div>
              <p className="mt-2 text-sm font-semibold text-slate-300">
                Incidentals, allowances, tax, discounts, and reserve adjustments stay in estimate pricing and pass to the Agreement Wizard as editable pricing inputs.
              </p>
              <button
                type="button"
                onClick={() => setActive("estimate")}
                className="mt-4 rounded-lg border border-white/18 bg-white/10 px-3 py-2 text-sm font-black text-white hover:bg-white/15"
              >
                Edit Reserve Line Item
              </button>
            </div>
          </Section>

          <Section id="scope" active={active === "scope"} title="Scope Notes, Exclusions, and Assumptions">
            <div className="grid gap-4 md:grid-cols-2">
              <TextAreaField label="Included work" testId="proposal-included-work" value={draft.included_work} onChange={(value) => patchDraft("included_work", value)} />
              <TextAreaField label="Excluded work" value={draft.excluded_work} onChange={(value) => patchDraft("excluded_work", value)} />
              <TextAreaField label="Assumptions" value={draft.assumptions} onChange={(value) => patchDraft("assumptions", value)} />
              <TextAreaField label="Allowances" value={draft.allowances} onChange={(value) => patchDraft("allowances", value)} />
            </div>
            <button
              type="button"
              data-testid="proposal-save-scope"
              onClick={() => saveProposal({
                included_work: draft.included_work,
                excluded_work: draft.excluded_work,
                assumptions: draft.assumptions,
                allowances: draft.allowances,
              }, "Scope saved.")}
              disabled={saving}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              <Save size={16} /> Save Scope
            </button>
          </Section>

          <Section id="ready" active={active === "ready"} title="Ready for Agreement">
            <div className={`rounded-xl border p-4 ${estimateChecklist.readyMinimum ? "border-emerald-200/30 bg-emerald-400/10 text-emerald-100" : "border-amber-200/30 bg-amber-400/10 text-amber-100"}`}>
              <div className="text-lg font-black" data-testid="estimate-ready-review-status">
                {estimateChecklist.readyMinimum ? "Ready for Agreement" : "Finish required checklist items"}
              </div>
              <div className="mt-1 text-sm font-semibold">
                {estimateChecklist.readyMinimum
                  ? "The minimum estimate checklist is complete. The contractor still reviews and edits everything in the Agreement Wizard."
                  : `Missing: ${estimateChecklist.requiredMissing.map((item) => item.title).join(", ")}`}
              </div>
              <button
                type="button"
                data-testid="estimate-ready-create-agreement"
                onClick={createAgreementFromProposal}
                disabled={!estimateChecklist.readyMinimum}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                <FileSignature size={16} /> Create Agreement from Estimate
              </button>
            </div>
          </Section>

          <Section id="notes" active={active === "notes"} title="Internal Notes">
            <TextAreaField label="Contractor notes" testId="proposal-internal-notes" value={draft.internal_notes} onChange={(value) => patchDraft("internal_notes", value)} rows={8} />
            <button
              type="button"
              data-testid="proposal-save-notes"
              onClick={() => saveProposal({ internal_notes: draft.internal_notes }, "Notes saved.")}
              disabled={saving}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              <Save size={16} /> Save Notes
            </button>
          </Section>

          <Section id="history" active={active === "history"} title="History">
            <div className="space-y-2" data-testid="proposal-history">
              {(proposal.activity || []).length ? proposal.activity.map((item) => (
                <div key={item.id} className="rounded-lg border border-white/10 bg-white/7 p-3">
                  <div className="font-bold text-white">{item.message}</div>
                  <div className="text-xs font-semibold text-sky-100/55">{formatDateTime(item.created_at)}</div>
                </div>
              )) : <div className="rounded-lg border border-dashed border-white/16 bg-white/6 p-4 text-sm font-semibold text-sky-100/70">No estimate activity has been recorded yet. Updates, revisions, and conversion events will appear here.</div>}
            </div>
          </Section>
        </main>

        <aside className="rounded-2xl border border-sky-200/14 bg-[#061d42]/95 p-4 text-white shadow-[0_24px_70px_rgba(2,8,23,0.34)] lg:sticky lg:top-4 lg:self-start" data-testid="proposal-summary-rail">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-100/80">Context Summary</div>
          <div className="mt-2 text-lg font-bold">{proposal.customer_name || "Customer"}</div>
          <div className="mt-1 text-sm text-slate-300">{proposal.service_location || "No service location"}</div>
          <div className="mt-4 rounded-lg bg-white/10 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase text-slate-400">Progress</span>
              <span className="text-lg font-black" data-testid="estimate-summary-progress">{estimateChecklist.percent}%</span>
            </div>
            <div className="mt-1 text-xs font-semibold text-sky-100/62">
              {estimateChecklist.completedCount} of {estimateChecklist.items.length} readiness requirements complete
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-emerald-400" style={{ width: `${estimateChecklist.percent}%` }} />
            </div>
            <div className={`mt-2 text-xs font-black ${estimateChecklist.readyMinimum ? "text-emerald-200" : "text-amber-200"}`}>
              {estimateChecklist.readyMinimum ? "Ready for Agreement" : `${estimateChecklist.requiredMissing.length} required readiness item${estimateChecklist.requiredMissing.length === 1 ? "" : "s"} missing`}
            </div>
          </div>
          <div className="mt-4 rounded-lg bg-white/10 p-3">
            <div className="text-xs font-semibold uppercase text-slate-400">Next action</div>
            <div className="mt-1 text-sm font-bold">{highestPriorityItem?.complete ? "Review in Agreement Wizard" : highestPriorityItem?.action || "Finish required items"}</div>
            {highestPriorityItem && !highestPriorityItem.complete ? (
              <button type="button" onClick={() => setActive(highestPriorityItem.target || "overview")} className="mt-2 text-xs font-black text-blue-200">
                Open section
              </button>
            ) : null}
          </div>
          <div className="mt-4 rounded-lg bg-white/10 p-3" data-testid="proposal-summary-scheduling">
            <div className="text-xs font-semibold uppercase text-slate-400">Scheduling</div>
            <div className="mt-1 text-sm font-bold">{proposalScheduleSummary({ ...proposal, ...draft })}</div>
            <button type="button" onClick={() => setActive("scheduling")} className="mt-2 text-xs font-black text-blue-200">Edit scheduling</button>
          </div>
          <div className="mt-4 rounded-lg bg-white/10 p-3" data-testid="proposal-summary-template">
            <div className="text-xs font-semibold uppercase text-slate-400">Template</div>
            <div className="mt-1 text-sm font-bold">{selectedTemplate?.name || "Searching templates"}</div>
            <button type="button" onClick={() => setActive("assistant")} className="mt-2 text-xs font-black text-blue-200">Open Project Assistant</button>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-white/10 p-2"><div className="text-lg font-bold">{proposal.measurements?.length || 0}</div><div className="text-xs text-slate-300">Measures</div></div>
            <div className="rounded-lg bg-white/10 p-2"><div className="text-lg font-bold">{photos.length}</div><div className="text-xs text-slate-300">Photos</div></div>
            <div className="rounded-lg bg-white/10 p-2"><div className="text-lg font-bold">{documents.length}</div><div className="text-xs text-slate-300">Docs</div></div>
          </div>
          <div className="mt-4 rounded-lg bg-white/10 p-3" data-testid="proposal-summary-totals">
            <div className="text-xs font-semibold uppercase text-slate-400">Estimate Total</div>
            <div className="mt-1 text-2xl font-black">{money(totals.total)}</div>
            <div className="mt-3 space-y-1 text-sm text-slate-300">
              <div className="flex justify-between gap-3"><span>Subtotal</span><span className="font-bold text-white">{money(totals.subtotal)}</span></div>
              <div className="flex justify-between gap-3"><span>Tax</span><span className="font-bold text-white">{money(totals.tax)}</span></div>
              <div className="flex justify-between gap-3"><span>Incidentals</span><span className="font-bold text-white">{money(totals.incidentals_reserve)}</span></div>
              <div className="flex justify-between gap-3"><span>Discounts</span><span className="font-bold text-white">-{money(totals.discounts)}</span></div>
            </div>
          </div>
          <button
            type="button"
            data-testid="proposal-summary-create-agreement"
            onClick={createAgreementFromProposal}
            disabled={!estimateChecklist.readyMinimum}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/18 bg-white/10 px-3 py-2 text-sm font-black text-white hover:bg-white/15 focus-visible:text-white active:text-white disabled:cursor-not-allowed disabled:bg-slate-500 disabled:text-slate-200"
          >
            <FileSignature size={16} /> Create Agreement from Estimate
          </button>
          <div className="mt-2 text-xs leading-5 text-slate-400">
            Opens the existing Agreement Wizard with this estimate checklist as editable draft input.
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-white/10 bg-white/6 p-2 text-xs leading-5 text-slate-300">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-100/70" aria-hidden="true" />
            <span>Prepared outputs still require contractor review.</span>
          </div>
        </aside>
      </div>
    </ContractorPageSurface>
  );
}
