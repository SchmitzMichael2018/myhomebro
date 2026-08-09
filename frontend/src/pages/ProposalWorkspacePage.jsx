import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, Camera, Check, CheckCircle2, Circle, FileSignature, FileUp, Lock, Mail, Mic, Phone, Plus, Ruler, Save, ShieldCheck, StickyNote, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";

import api from "../api";
import { useAssistantDock } from "../components/AssistantDock.jsx";
import UnitSelect from "../components/UnitSelect.jsx";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import { writeSessionAssistantHandoff } from "../lib/assistantHandoff.js";
import { customUnitError, recognizeUnit, unitDisplay, unitValueForSave } from "../lib/units.js";
import { buildMilestoneAllocations, getTemplatePricingState } from "../lib/templatePricingState.js";

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

const PREFERRED_CONTACT_OPTIONS = [
  ["", "No preference"],
  ["email", "Email"],
  ["text", "Text"],
  ["phone", "Phone"],
];

function preferredContactLabel(value) {
  return PREFERRED_CONTACT_OPTIONS.find(([key]) => key === String(value || "").trim().toLowerCase())?.[1] || "No preference";
}

const WORKSPACE_STEPS = [
  {
    ...WORKFLOW_GROUPS[0],
    number: 1,
  },
  { ...WORKFLOW_GROUPS[1], number: 2, label: "Scope" },
  { ...WORKFLOW_GROUPS[2], number: 3 },
  { ...WORKFLOW_GROUPS[3], number: 4 },
];

const WORKSPACE_SECTION_IDS = new Set(WORKSPACE_STEPS.flatMap((step) => step.sections.map(([key]) => key)));

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
  "estimate-workflow-primary inline-flex items-center justify-center gap-2 rounded-lg bg-amber-300 px-3 py-2 text-sm font-black text-slate-950 shadow-sm hover:bg-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100 active:translate-y-px active:bg-amber-500 disabled:cursor-not-allowed disabled:bg-amber-200/55 disabled:text-slate-600";

const EMPTY_MEASUREMENT = {
  label: "",
  location: "",
  quantity: "",
  unit: "",
  notes: "",
};

const WALKTHROUGH_TASK_LABELS = {
  customer: "Review customer",
  "project-address": "Add project address",
  scheduling: "Set scheduling",
  "site-visit": "Capture site details",
  measurements: "Add measurement",
  files: "Upload photos or documents",
  photos: "Upload photos",
  documents: "Upload documents",
  clarifications: "Review questions",
  scope: "Review scope notes",
  pricing: "Add estimate pricing",
  ready: "Check readiness",
};

function walkthroughTaskForItem(item, fallbackTarget = "overview") {
  if (!item) return null;
  return {
    key: item.key || fallbackTarget,
    target: item.target || fallbackTarget,
    title: WALKTHROUGH_TASK_LABELS[item.key] || item.action || item.title || "Complete walkthrough task",
    description: item.summary || `Complete ${item.title || "this section"}, then return to the capture checklist.`,
  };
}

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

function benchmarkPositionCopy(position, subject) {
  if (position === "below") return `Below ${subject} range`;
  if (position === "above") return `Above ${subject} range`;
  if (position === "within") return `Within ${subject} range`;
  return "Position unavailable";
}

function benchmarkAdvice(position) {
  if (position === "below") return "This estimate is below your completed-project range for similar work. Review whether labor, materials, subcontractor work, allowances, or project conditions are fully captured.";
  if (position === "above") return "This estimate is above your completed-project range. The higher amount may still be appropriate when scope, finishes, site conditions, or subcontractor requirements differ.";
  if (position === "within") return "This estimate is generally aligned with your completed-project history for comparable work.";
  return "";
}

function PricingBenchmarkCard({ benchmark, loading }) {
  const section = (title, data, subject, market = false) => (
    <article className="min-w-0 rounded-xl border border-white/10 bg-slate-950/30 p-4" data-testid={market ? "pricing-benchmark-market" : "pricing-benchmark-business"}>
      <h4 className="font-black text-white">{title}</h4>
      {data?.available ? (
        <div className="mt-3 space-y-1 text-sm font-semibold text-sky-50/80">
          <p className="text-lg font-black tabular-nums text-white">{money(data.p25)}–{money(data.p75)}</p>
          <p className="font-black text-sky-100">{benchmarkPositionCopy(data.position, subject)}</p>
          <p>Median: {money(data.median)}</p>
          <p>Based on {data.count} {market ? "anonymized " : ""}completed comparable project{data.count === 1 ? "" : "s"}</p>
          {market && data.region_label ? <p>{data.region_label} region</p> : null}
          <p>Confidence: {String(data.confidence || "low").replace("medium", "Moderate").replace("high", "High").replace("low", "Low")}</p>
          {data.reference_only ? <p className="text-sky-100/65">Historical reference only; one project does not establish a reliable range.</p> : null}
          {!market && !data.reference_only ? <p className="mt-2 border-t border-white/10 pt-2 text-sky-100/70">{benchmarkAdvice(data.position)}</p> : null}
        </div>
      ) : (
        <div className="mt-3 text-sm font-semibold text-sky-100/70">
          <p className="font-black text-white">{market ? "Insufficient comparable MyHomeBro data" : "Not enough completed comparable projects yet."}</p>
          <p className="mt-1">{market ? "More completed comparable projects are needed before a reliable anonymous market range can be shown." : "As you complete more projects, MyHomeBro will build a stronger pricing history for your business."}</p>
        </div>
      )}
    </article>
  );
  return (
    <section className="rounded-xl border border-sky-300/20 bg-white/7 p-4" aria-labelledby="pricing-benchmark-title" data-testid="pricing-benchmark-card">
      <h3 id="pricing-benchmark-title" className="font-black text-white">Pricing Benchmark</h3>
      <p className="mt-1 text-sm font-semibold text-sky-100/70">Compare this estimate with your completed project history and anonymized MyHomeBro project data.</p>
      {loading ? <p role="status" className="mt-4 text-sm font-semibold text-sky-100/70">Loading pricing benchmark…</p> : benchmark ? (
        <>
          <div className="mt-3 text-xs font-bold text-sky-100/55" data-testid="pricing-benchmark-classification">
            <p>{benchmark.classification?.match_description}</p>
            <p>Advisory only</p>
          </div>
          <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2">
            {section("Your Business", benchmark.contractor, "your historical")}
            {section("MyHomeBro Market", benchmark.regional, "the MyHomeBro regional", true)}
          </div>
        </>
      ) : <p className="mt-4 text-sm font-semibold text-sky-100/70">Pricing benchmark is temporarily unavailable. Agreement creation is unaffected.</p>}
    </section>
  );
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

function activityDisplay(item) {
  const message = String(item?.message || "Estimate updated");
  const detail = message.includes(":") ? message.split(":").slice(1).join(":").trim() : "";
  const labels = {
    line_item_added: "Pricing item added",
    line_item_updated: "Pricing item updated",
    line_item_removed: "Pricing item removed",
    site_visit_updated: "Site details updated",
    scope_edited: "Scope details updated",
    notes_edited: "Internal notes updated",
    created: "Estimate created",
  };
  return { label: labels[item?.event_type] || item?.event_label || message, detail };
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

function clarificationSuggestion(question, { proposal, draft, photos }) {
  if (!questionAnsweredByEvidence(question, { proposal, draft, photos })) return null;
  const key = compactText(question.key).toLowerCase();
  if (key.includes("photo")) return { answer: `${(photos || []).length} supporting photo${(photos || []).length === 1 ? "" : "s"} attached.`, source: "photos", label: "Suggested from photos" };
  if (key.includes("square") || key.includes("measurement") || key.includes("footage")) {
    const measurements = Array.isArray(proposal?.measurements) ? proposal.measurements : [];
    const answer = measurements.map((item) => [item.label, item.quantity, unitDisplay(item.unit), item.notes].filter(Boolean).join(" ")).filter(Boolean).join("\n");
    return { answer, source: "measurements", label: "Suggested from measurements" };
  }
  if (key.includes("schedul") || key.includes("date") || key.includes("timeline")) {
    return { answer: proposalScheduleSummary({ ...proposal, ...draft }), source: "scheduling", label: "Suggested from scheduling" };
  }
  const answer = compactText(draft?.included_work || draft?.site_visit_notes || proposal?.project_summary);
  return answer ? { answer, source: "scope", label: "Suggested from scope notes" } : null;
}

function clarificationRecord(checklist, key) {
  return (checklist || []).find((item) => item && typeof item === "object" && item.type === "clarification" && item.key === key) || null;
}

function buildClarificationRows({ selectedTemplate, proposal, draft, photos }) {
  const checklist = Array.isArray(draft?.quick_checklist) ? draft.quick_checklist : [];
  return templateQuestionRows(selectedTemplate).map((question) => {
    const completeKey = `clarification:${question.key}:complete`;
    const ignoredKey = `clarification:${question.key}:ignored`;
    const suggestion = clarificationSuggestion(question, { proposal, draft, photos });
    const record = clarificationRecord(checklist, question.key);
    const manuallyComplete = checklist.includes(completeKey);
    const ignored = record?.status === "ignored" || checklist.includes(ignoredKey);
    const accepted = record?.status === "complete";
    const reopened = record?.status === "reopened";
    const legacyComplete = manuallyComplete && !record;
    const complete = ignored || accepted || legacyComplete;
    return {
      ...question,
      completeKey,
      ignoredKey,
      suggestion,
      autoComplete: Boolean(suggestion) && !complete && !reopened,
      manuallyComplete,
      ignored,
      answer: compactText(record?.answer),
      source: compactText(record?.source || suggestion?.source),
      sourceLabel: suggestion?.label || "",
      complete,
      status: ignored ? "Ignored" : complete ? "Complete" : reopened ? "Reopened" : suggestion ? "Suggested" : "Needs Answer",
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

function clarificationTargetLabel(target) {
  return ({ measurements: "Open measurements", photos: "Upload photos", documents: "Open documents", scheduling: "View scheduling", scope: "Review scope notes", site: "Open site access" })[target] || "";
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
  const [searchParams] = useSearchParams();
  const { updateAssistantContext } = useAssistantDock();
  const [proposal, setProposal] = useState(null);
  const [customerPreview, setCustomerPreview] = useState(null);
  const [reviewSending, setReviewSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState("customer");
  const [draft, setDraft] = useState({});
  const [measurementForm, setMeasurementForm] = useState(EMPTY_MEASUREMENT);
  const [measurementUnitError, setMeasurementUnitError] = useState("");
  const [lineItemForm, setLineItemForm] = useState(EMPTY_LINE_ITEM);
  const [editingLineItemId, setEditingLineItemId] = useState(null);
  const [pricingEditorOpen, setPricingEditorOpen] = useState(false);
  const [pricingAdjustmentsOpen, setPricingAdjustmentsOpen] = useState(false);
  const [lineItemSaving, setLineItemSaving] = useState(false);
  const [lineItemErrors, setLineItemErrors] = useState({});
  const [uploading, setUploading] = useState(false);
  const [walkthroughMode, setWalkthroughMode] = useState(false);
  const [walkthroughTask, setWalkthroughTask] = useState(null);
  const [walkthroughScrollY, setWalkthroughScrollY] = useState(0);
  const [walkthroughMeasurementOpen, setWalkthroughMeasurementOpen] = useState(false);
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateRecommendation, setTemplateRecommendation] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateChoice, setTemplateChoice] = useState("pending");
  const [templatePricingPreviewOpen, setTemplatePricingPreviewOpen] = useState(false);
  const [templatePricingMode, setTemplatePricingMode] = useState("add");
  const [templatePricingApplying, setTemplatePricingApplying] = useState(false);
  const [templatePricingReceipt, setTemplatePricingReceipt] = useState("");
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templatePickerLoading, setTemplatePickerLoading] = useState(false);
  const [templatePickerSearch, setTemplatePickerSearch] = useState("");
  const [templateOptions, setTemplateOptions] = useState([]);
  const [templateSelecting, setTemplateSelecting] = useState(false);
  const [templateViewOpen, setTemplateViewOpen] = useState(false);
  const [allocationOpen, setAllocationOpen] = useState(false);
  const [allocationStep, setAllocationStep] = useState(1);
  const [targetSubtotal, setTargetSubtotal] = useState("");
  const [allocationRows, setAllocationRows] = useState([]);
  const [allocationApplying, setAllocationApplying] = useState(false);
  const templateViewTriggerRef = useRef(null);
  const templatePricingDialogRef = useRef(null);
  const templatePricingTriggerRef = useRef(null);
  const templatePickerDialogRef = useRef(null);
  const templatePickerTriggerRef = useRef(null);
  const [customerMatches, setCustomerMatches] = useState([]);
  const [saveAddressToCustomer, setSaveAddressToCustomer] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [clarificationEdits, setClarificationEdits] = useState({});
  const [editingClarifications, setEditingClarifications] = useState({});
  const [savingClarificationKey, setSavingClarificationKey] = useState("");
  const [clarificationErrors, setClarificationErrors] = useState({});
  const [showCompletedClarifications, setShowCompletedClarifications] = useState(false);
  const [showIgnoredClarifications, setShowIgnoredClarifications] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [pricingBenchmark, setPricingBenchmark] = useState(null);
  const [pricingBenchmarkLoading, setPricingBenchmarkLoading] = useState(false);

  const photos = useMemo(
    () => (proposal?.attachments || []).filter((item) => item.attachment_type === "photo"),
    [proposal]
  );
  const documents = useMemo(
    () => (proposal?.attachments || []).filter((item) => item.attachment_type !== "photo"),
    [proposal]
  );
  const totals = proposal?.totals || {};
  const coreLineItems = useMemo(() => (proposal?.line_items || []).filter((item) => COST_CATEGORY_VALUES.has(item.category)), [proposal]);
  const adjustmentLineItems = useMemo(() => (proposal?.line_items || []).filter((item) => PRICING_ADJUSTMENT_VALUES.has(item.category)), [proposal]);
  const templatePricingItems = useMemo(() => (selectedTemplate?.milestones || []).filter((item) => Number(item.suggested_amount_fixed) > 0), [selectedTemplate]);
  const templateAllocationItems = useMemo(() => (selectedTemplate?.milestones || []).filter((item) => Number(item.suggested_amount_percent) > 0), [selectedTemplate]);
  const templatePricingState = useMemo(() => getTemplatePricingState({ template: selectedTemplate, proposal }), [selectedTemplate, proposal]);
  const templatePricingSubtotal = useMemo(() => templatePricingItems.reduce((sum, item) => sum + Number(item.suggested_amount_fixed || 0), 0), [templatePricingItems]);
  const filteredTemplateOptions = useMemo(() => {
    const query = compactText(templatePickerSearch).toLowerCase();
    return templateOptions.filter((item) => !query || `${item.name} ${item.project_type || ""} ${item.project_subtype || ""}`.toLowerCase().includes(query));
  }, [templateOptions, templatePickerSearch]);
  useEffect(() => {
    if (!templatePricingPreviewOpen) return undefined;
    const dialog = templatePricingDialogRef.current;
    const returnFocusTarget = templatePricingTriggerRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') || []);
    window.requestAnimationFrame(() => focusable()[0]?.focus());
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setTemplatePricingPreviewOpen(false);
        window.requestAnimationFrame(() => templatePricingTriggerRef.current?.focus());
      } else if (event.key === "Tab") {
        const controls = focusable();
        if (!controls.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.requestAnimationFrame(() => returnFocusTarget?.focus());
    };
  }, [templatePricingPreviewOpen]);
  useEffect(() => {
    if (!templatePickerOpen) return undefined;
    const dialog = templatePickerDialogRef.current;
    const returnTarget = templatePickerTriggerRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') || []);
    window.requestAnimationFrame(() => focusable()[0]?.focus());
    const onKeyDown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); setTemplatePickerOpen(false); }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (!controls.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); window.requestAnimationFrame(() => returnTarget?.focus()); };
  }, [templatePickerOpen]);
  useEffect(() => {
    if (!templateViewOpen && !allocationOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setTemplateViewOpen(false);
      setAllocationOpen(false);
      window.requestAnimationFrame(() => templateViewTriggerRef.current?.focus());
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [templateViewOpen, allocationOpen]);
  const pricingAdjustmentImpact = useMemo(() => adjustmentLineItems.reduce((sum, item) => {
    const amount = moneyToNumber(item.total);
    return sum + (item.category === "discount" ? -Math.abs(amount) : amount);
  }, 0), [adjustmentLineItems]);
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
  const projectAddress = compactText(draft.service_location || proposal?.service_location);
  const selectedExistingProperty = propertyOptions.some((option) => option.value === projectAddress) ? projectAddress : "";
  const projectDetailsDirty = compactText(draft.project_title) !== compactText(proposal?.project_title)
    || compactText(draft.customer_preferred_contact).toLowerCase() !== compactText(proposal?.customer_preferred_contact).toLowerCase();
  const estimateChecklist = useMemo(
    () => buildEstimateChecklist({ proposal, draft, totals, photos, documents, clarificationRows }),
    [proposal, draft, totals, photos, documents, clarificationRows]
  );
  const notesDirty = String(draft.internal_notes || "") !== String(proposal?.internal_notes || "");
  const recentActivity = useMemo(() => (proposal?.activity || []).slice(0, historyExpanded ? 50 : 2), [proposal, historyExpanded]);
  const sortedClarificationRows = useMemo(() => [...clarificationRows].sort((a, b) => {
    const rank = { "Needs Answer": 0, Reopened: 0, Suggested: 1, Complete: 2, Ignored: 3 };
    return (rank[a.status] ?? 4) - (rank[b.status] ?? 4);
  }), [clarificationRows]);
  const isReadOnlyHistory = Boolean(
    proposal && (compactText(proposal.status).toLowerCase() === "converted" || proposal.linked_agreement_id)
  );
  useEffect(() => {
    setClarificationEdits((previous) => {
      const next = { ...previous };
      for (const row of clarificationRows) {
        if (!Object.prototype.hasOwnProperty.call(next, row.key)) next[row.key] = row.answer || row.suggestion?.answer || "";
      }
      return next;
    });
  }, [clarificationRows]);
  const overviewGroups = useMemo(
    () => buildOverviewGroups({ estimateChecklist, proposal, photos, documents, isReadOnlyHistory }),
    [estimateChecklist, proposal, photos, documents, isReadOnlyHistory]
  );
  const highestPriorityItem =
    estimateChecklist.requiredMissing[0] ||
    estimateChecklist.items.find((item) => !item.complete) ||
    estimateChecklist.items.find((item) => item.key === "ready");
  const activeStepIndex = Math.max(0, WORKSPACE_STEPS.findIndex((step) => step.sections.some(([key]) => key === active)));
  const activeStep = WORKSPACE_STEPS[activeStepIndex];
  useEffect(() => {
    if (!proposal || activeStep.key !== "review") return;
    let activeRequest = true;
    setPricingBenchmarkLoading(true);
    api.get(`/projects/proposals/${proposalId}/pricing-benchmark/`)
      .then(({ data }) => { if (activeRequest) setPricingBenchmark(data); })
      .catch(() => { if (activeRequest) setPricingBenchmark(null); })
      .finally(() => { if (activeRequest) setPricingBenchmarkLoading(false); });
    return () => { activeRequest = false; };
  }, [activeStep.key, proposalId, proposal, totals.total]);
  useEffect(() => {
    if (!proposal || !["project", "site_scope", "pricing", "review"].includes(activeStep.key)) return;
    const scopeSources = {
      measurements: (proposal.measurements || []).map((item) => ({ label: item.label, quantity: item.quantity, unit: item.unit, location: item.location })),
      photo_count: photos.length,
      document_count: documents.length,
      access_notes: draft.access_notes || "",
      risk_notes: draft.risk_notes || "",
      site_conditions: draft.site_conditions || "",
      customer_requests: draft.customer_requests || "",
      included_work: proposal.included_work || draft.included_work || "",
      excluded_work: proposal.excluded_work || draft.excluded_work || "",
      assumptions: proposal.assumptions || draft.assumptions || "",
      allowances: proposal.allowances || draft.allowances || "",
    };
    updateAssistantContext({
      workspace_mode: "estimates",
      page: "estimates",
      active_workspace: activeStep.key,
      entity_type: "proposal",
      entity_id: proposalId,
      proposal_id: proposalId,
      proposal_summary: {
        project: {
          customer: proposal.customer_name || "",
          title: draft.project_title || proposal.project_title || "",
          service_location: draft.service_location || proposal.service_location || "",
          preferred_contact: draft.customer_preferred_contact || proposal.customer_preferred_contact || "",
          schedule_complete: estimateChecklist.items.find((item) => item.key === "scheduling")?.complete || false,
        },
        line_item_count: (proposal.line_items || []).length,
        subtotal: totals.subtotal,
        total: totals.total,
        pricing_complete: estimateChecklist.items.find((item) => item.key === "pricing")?.complete || false,
        pricing_blockers: estimateChecklist.items.find((item) => item.key === "pricing")?.missing || [],
        scope: {
          title: draft.project_title || proposal.project_title || "",
          description: proposal.description || draft.description || "",
          included_work: proposal.included_work || draft.included_work || "",
          excluded_work: proposal.excluded_work || draft.excluded_work || "",
          assumptions: proposal.assumptions || draft.assumptions || "",
        },
        scope_sources: scopeSources,
        template_pricing: {
          available: templatePricingItems.length > 0,
          template_id: selectedTemplate?.id || null,
          template_name: selectedTemplate?.name || "",
          item_count: templatePricingItems.length,
          requires_approval: true,
        },
        review: activeStep.key === "review" ? {
          ready: estimateChecklist.readyMinimum,
          blockers: estimateChecklist.requiredMissing.map((item) => item.title),
          customer: proposal.customer_name || "",
          project_title: proposal.project_title || "",
          clarification_complete_count: clarificationRows.filter((row) => row.complete).length,
          clarification_unresolved_count: clarificationRows.filter((row) => !row.complete).length,
          recent_activity: (proposal.activity || []).slice(0, 2).map((item) => activityDisplay(item).label),
          agreement_creation_available: estimateChecklist.readyMinimum && !isReadOnlyHistory,
          pricing_benchmark: pricingBenchmark || undefined,
        } : undefined,
      },
    });
  }, [activeStep.key, documents.length, draft, estimateChecklist.items, photos.length, pricingBenchmark, proposal, proposalId, selectedTemplate, templatePricingItems.length, totals, updateAssistantContext]);
  function blockReadOnlyHistory() {
    if (!isReadOnlyHistory) return false;
    toast.error("Converted estimates are read-only history. Open the linked agreement for active work.");
    return true;
  }

  function openWorkspaceSection(sectionKey) {
    const nextSection = WORKSPACE_SECTION_IDS.has(sectionKey) ? sectionKey : "customer";
    setActive(nextSection);
    navigate(`/app/proposals/${proposalId}?section=${encodeURIComponent(nextSection)}`);
    window.requestAnimationFrame(() => document.getElementById(nextSection)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }

  function openWorkspaceStep(stepIndex) {
    const step = WORKSPACE_STEPS[stepIndex];
    if (!step) return;
    const currentSectionInStep = step.sections.some(([key]) => key === active) ? active : step.sections[0][0];
    openWorkspaceSection(currentSectionInStep);
  }

  function handleStepKeyDown(event, stepIndex) {
    let nextIndex = stepIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (stepIndex + 1) % WORKSPACE_STEPS.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (stepIndex - 1 + WORKSPACE_STEPS.length) % WORKSPACE_STEPS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = WORKSPACE_STEPS.length - 1;
    else return;
    event.preventDefault();
    openWorkspaceStep(nextIndex);
    window.requestAnimationFrame(() => document.querySelector(`[data-testid="estimate-workflow-step-${WORKSPACE_STEPS[nextIndex].key}"]`)?.focus());
  }

  function handleStepPrimaryAction() {
    if (activeStepIndex === 0) return openWorkspaceStep(1);
    if (activeStepIndex === 1) {
      const clarificationItem = checklistItemByKey(estimateChecklist.items, "clarifications");
      if (!clarificationItem?.complete) return openWorkspaceSection("clarifications");
      const scopeItem = checklistItemByKey(estimateChecklist.items, "scope");
      if (!scopeItem?.complete) return openWorkspaceSection("scope");
      return openWorkspaceStep(2);
    }
    if (activeStepIndex === 2) {
      const pricingItem = checklistItemByKey(estimateChecklist.items, "pricing");
      if (!pricingItem?.complete) return openWorkspaceSection("estimate");
      return openWorkspaceStep(3);
    }
    return undefined;
  }

  function stepPrimaryLabel() {
    if (activeStepIndex === 0) return "Continue to Scope";
    if (activeStepIndex === 1) {
      if (!checklistItemByKey(estimateChecklist.items, "clarifications")?.complete) return "Review questions";
      if (!checklistItemByKey(estimateChecklist.items, "scope")?.complete) return "Add scope notes";
      return "Continue to Pricing";
    }
    if (!checklistItemByKey(estimateChecklist.items, "pricing")?.complete) return "Add pricing";
    return "Continue to Review";
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
    const clarificationAnswers = Object.fromEntries(
      clarificationRows.filter((row) => row.complete && !row.ignored && row.answer).map((row) => [row.key, row.answer])
    );
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
        clarification_answers: clarificationAnswers,
        scope_clarifications: clarificationAnswers,
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
        project_title: data.project_title || "",
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
      if (data.selected_template_id) {
        api.get(`/projects/templates/${data.selected_template_id}/`).then((response) => {
          setSelectedTemplate(response.data);
          setTemplateChoice("selected");
        }).catch(() => loadTemplateRecommendation(data));
      } else {
        loadTemplateRecommendation(data);
      }
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

  useEffect(() => {
    const requestedSection = searchParams.get("section");
    const fromWalkthrough = searchParams.get("from") === "walkthrough";
    const walkthroughRequested = searchParams.get("walkthrough") === "1";
    if (requestedSection) {
      setActive(WORKSPACE_SECTION_IDS.has(requestedSection) ? requestedSection : "customer");
      if (WORKSPACE_SECTION_IDS.has(requestedSection)) window.requestAnimationFrame(() => document.getElementById(requestedSection)?.scrollIntoView({ block: "start" }));
    }
    if (fromWalkthrough) {
      const taskKey = searchParams.get("task") || requestedSection || "overview";
      const sourceItem = estimateChecklist.items.find((item) => item.key === taskKey || item.target === requestedSection);
      setWalkthroughTask(walkthroughTaskForItem(sourceItem || { key: taskKey, target: requestedSection }));
      setWalkthroughMode(false);
    } else if (walkthroughRequested) {
      setWalkthroughTask(null);
      setWalkthroughMode(true);
    } else {
      setWalkthroughTask(null);
      setWalkthroughMode(false);
      if (!requestedSection) {
        setActive("customer");
        navigate(`/app/proposals/${proposalId}?section=customer`, { replace: true });
      }
    }
  }, [navigate, proposalId, searchParams]);

  useEffect(() => {
    if (!walkthroughMode || !walkthroughScrollY) return;
    window.requestAnimationFrame(() => window.scrollTo({ top: walkthroughScrollY, behavior: "auto" }));
  }, [walkthroughMode, walkthroughScrollY]);

  function openWalkthroughSection(item) {
    const task = walkthroughTaskForItem(item);
    if (!task) return;
    setWalkthroughScrollY(window.scrollY || 0);
    setWalkthroughTask(task);
    setWalkthroughMode(false);
    setActive(task.target);
    navigate(`/app/proposals/${proposalId}?section=${encodeURIComponent(task.target)}&from=walkthrough&task=${encodeURIComponent(task.key)}`);
  }

  async function previewCustomerEstimate() {
    try {
      const { data } = await api.get(`/projects/proposals/${proposalId}/customer-preview/`);
      setCustomerPreview(data.estimate);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Customer preview could not be loaded.");
    }
  }

  async function sendEstimateToCustomer(resend = false) {
    if (reviewSending) return;
    setReviewSending(true);
    try {
      const { data } = await api.post(`/projects/proposals/${proposalId}/send-review/`, { resend });
      setProposal(data.proposal);
      setDraft((current) => ({ ...current, status: data.proposal.status }));
      if (data.delivery?.email?.ok) toast.success(resend ? "Estimate resent to customer." : "Estimate sent to customer.");
      else toast.error(data.delivery?.email?.message || "Estimate saved, but delivery failed. Copy the review link and contact the customer.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Estimate could not be sent.");
    } finally { setReviewSending(false); }
  }

  async function returnToWalkthrough() {
    await loadProposal();
    setWalkthroughTask(null);
    setWalkthroughMode(true);
    navigate(`/app/proposals/${proposalId}?walkthrough=1`, { replace: true });
  }

  function exitWalkthrough() {
    setWalkthroughTask(null);
    setWalkthroughMode(false);
    navigate(`/app/proposals/${proposalId}`, { replace: true });
  }

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
        let detailedMatch = match;
        try {
          const detailResponse = await api.get(`/projects/templates/${match.id}/`);
          detailedMatch = { ...match, ...detailResponse.data };
        } catch (detailError) {
          console.warn("Template detail unavailable for estimate pricing.", detailError);
        }
        setTemplateRecommendation(detailedMatch);
        setSelectedTemplate(detailedMatch);
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
        const customerAddressFields = parseServiceLocationForAgreement(address);
        await api.patch(`/projects/homeowners/${matchedCustomer.id}/`, {
          street_address: customerAddressFields.address_line1 || address,
          city: customerAddressFields.city || "",
          state: customerAddressFields.state || "",
          zip_code: customerAddressFields.postal_code || "",
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

  async function persistClarification(row, status, answer = "") {
    if (blockReadOnlyHistory()) return;
    const normalizedAnswer = compactText(answer);
    if (status === "complete" && !normalizedAnswer) {
      setClarificationErrors((previous) => ({ ...previous, [row.key]: "Enter an answer before saving." }));
      return;
    }
    const current = Array.isArray(draft.quick_checklist) ? draft.quick_checklist : [];
    const withoutRow = current.filter((item) => item !== row.completeKey && item !== row.ignoredKey && !(item && typeof item === "object" && item.type === "clarification" && item.key === row.key));
    const record = { type: "clarification", key: row.key, status, answer: normalizedAnswer, source: row.source || row.suggestion?.source || "contractor", updated_at: new Date().toISOString() };
    const next = [...withoutRow, record];
    setSavingClarificationKey(row.key);
    setClarificationErrors((previous) => ({ ...previous, [row.key]: "" }));
    try {
      const { data } = await api.patch(`/projects/proposals/${proposalId}/`, { quick_checklist: next });
      setProposal(data);
      setDraft((previous) => ({ ...previous, quick_checklist: data.quick_checklist || next }));
      setClarificationEdits((previous) => ({ ...previous, [row.key]: normalizedAnswer }));
      setEditingClarifications((previous) => ({ ...previous, [row.key]: status === "reopened" }));
      if (status === "complete") setShowCompletedClarifications(true);
      if (status === "ignored") setShowIgnoredClarifications(true);
      toast.success(status === "reopened" ? "Question reopened." : status === "ignored" ? "Question ignored." : "Answer saved.");
      if (status === "reopened") window.requestAnimationFrame(() => document.getElementById(`clarification-answer-${row.key}`)?.focus());
    } catch (error) {
      console.error(error);
      setClarificationErrors((previous) => ({ ...previous, [row.key]: error?.response?.data?.detail || "Could not update this clarification." }));
      toast.error("Could not update this clarification.");
    } finally {
      setSavingClarificationKey("");
    }
  }

  async function openTemplatePicker() {
    setTemplatePickerOpen(true);
    setTemplatePickerLoading(true);
    setTemplatePickerSearch("");
    try {
      const { data } = await api.get("/projects/templates/", { params: { include_drafts: false } });
      const rows = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
      const details = await Promise.all(rows.map(async (row) => {
        try { const response = await api.get(`/projects/templates/${row.id}/`); return { ...row, ...response.data }; }
        catch { return row; }
      }));
      setTemplateOptions(details.filter((item) => item.lifecycle_status === "active" && item.is_active !== false).sort((a, b) => {
        const owner = Number(Boolean(a.is_system_template)) - Number(Boolean(b.is_system_template));
        return owner || String(a.name || "").localeCompare(String(b.name || ""));
      }));
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not load templates.");
    } finally {
      setTemplatePickerLoading(false);
    }
  }

  async function choosePricingTemplate(template) {
    if (templateSelecting) return;
    setTemplateSelecting(true);
    try {
      const { data } = await api.patch(`/projects/proposals/${proposalId}/`, { selected_template_id: template.id });
      setProposal(data);
      setSelectedTemplate(template);
      setTemplateChoice("selected");
      setTemplatePricingReceipt("");
      setTemplatePickerOpen(false);
      toast.success(`${template.name} selected. Pricing was not changed.`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not select this template.");
    } finally {
      setTemplateSelecting(false);
    }
  }

  function openTemplatePricingPreview() {
    setTemplatePricingMode("add");
    setTemplatePricingPreviewOpen(true);
  }

  function openAllocationBuilder() {
    setTargetSubtotal("");
    setAllocationRows([]);
    setAllocationStep(1);
    setTemplatePricingMode("add");
    setAllocationOpen(true);
  }

  function previewAllocations() {
    const rows = buildMilestoneAllocations(selectedTemplate, targetSubtotal);
    if (!rows.length) { toast.error("Enter a target estimate subtotal greater than zero."); return; }
    setAllocationRows(rows.map((row) => ({
      ...row,
      category: "other",
      pricingDescription: row.title,
      quantity: "1",
      unit: "ls",
      unitPrice: row.amount.toFixed(2),
      selected: true,
    })));
    setAllocationStep(2);
  }

  function patchAllocationRow(index, patch) {
    setAllocationRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  async function applyAllocationPricing() {
    if (allocationApplying) return;
    const selectedRows = allocationRows.filter((row) => row.selected);
    if (!selectedRows.length) { toast.error("Select at least one reviewed pricing row."); return; }
    setAllocationApplying(true);
    try {
      const { data } = await api.post(`/projects/proposals/${proposalId}/apply-template-pricing/`, {
        template_id: selectedTemplate.id,
        mode: templatePricingMode,
        confirm_replace: templatePricingMode === "replace",
        target_subtotal: targetSubtotal,
        pricing_items: selectedRows.map((row) => ({
          category: row.category,
          description: row.pricingDescription,
          quantity: row.quantity,
          unit: row.unit,
          unit_price: row.unitPrice,
          notes: `Template milestone: ${row.title} (${row.percent}%)`,
        })),
      });
      setProposal((previous) => ({ ...previous, line_items: data.line_items, totals: data.totals, pricing_template_name: data.template_name }));
      setTemplatePricingReceipt(data.detail);
      setAllocationOpen(false);
      toast.success(data.detail);
    } catch (error) {
      toast.error(error?.response?.data?.detail || error?.response?.data?.pricing_items?.[0] || "Could not apply reviewed pricing.");
    } finally {
      setAllocationApplying(false);
    }
  }

  async function applyTemplatePricing() {
    if (templatePricingApplying || !selectedTemplate?.id || !templatePricingItems.length) return;
    setTemplatePricingApplying(true);
    try {
      const { data } = await api.post(`/projects/proposals/${proposalId}/apply-template-pricing/`, {
        template_id: selectedTemplate.id,
        mode: templatePricingMode,
        confirm_replace: templatePricingMode === "replace",
      });
      setProposal((previous) => ({ ...previous, line_items: data.line_items, totals: data.totals }));
      setTemplatePricingReceipt(data.detail || `Pricing copied from ${selectedTemplate.name}`);
      setTemplatePricingPreviewOpen(false);
      toast.success(data.detail || "Template pricing copied.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not copy template pricing.");
    } finally {
      setTemplatePricingApplying(false);
    }
  }

  function ignoreClarification(row) {
    if (!window.confirm("Ignore this required clarification? Ignored questions count as resolved for estimate readiness.")) return;
    persistClarification(row, "ignored", clarificationEdits[row.key] || row.answer || "");
  }

  function openClarificationSource(row) {
    if (!clarificationTargetLabel(row.target)) return;
    navigate(`/app/proposals/${proposalId}?section=clarifications`, { replace: true });
    window.requestAnimationFrame(() => openWorkspaceSection(row.target));
  }

  async function addMeasurement(event) {
    event?.preventDefault?.();
    if (blockReadOnlyHistory()) return;
    const unitError = measurementForm.unit && !recognizeUnit(measurementForm.unit) ? customUnitError(measurementForm.unit) : "";
    if (unitError) { setMeasurementUnitError(unitError); return; }
    setMeasurementUnitError("");
    try {
      const { data } = await api.post(`/projects/proposals/${proposalId}/measurements/`, { ...measurementForm, unit: unitValueForSave(measurementForm.unit) });
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
    setPricingEditorOpen(false);
    setLineItemErrors({});
  }

  function patchLineItemForm(key, value) {
    setLineItemForm((prev) => ({ ...prev, [key]: value }));
  }

  function openPricingEditor(category = "labor") {
    setLineItemForm({ ...EMPTY_LINE_ITEM, category });
    setEditingLineItemId(null);
    setLineItemErrors({});
    setPricingEditorOpen(true);
    if (PRICING_ADJUSTMENT_VALUES.has(category)) setPricingAdjustmentsOpen(true);
    window.requestAnimationFrame(() => document.getElementById("pricing-item-editor")?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }

  async function submitLineItem(event) {
    event.preventDefault();
    if (blockReadOnlyHistory()) return;
    if (lineItemSaving) return;
    const errors = {};
    if (!compactText(lineItemForm.description)) errors.description = "Description is required.";
    if (lineItemForm.quantity === "" || !Number.isFinite(Number(lineItemForm.quantity))) errors.quantity = "Enter a valid quantity.";
    if (lineItemForm.unit_price === "" || !Number.isFinite(Number(lineItemForm.unit_price))) errors.unit_price = "Enter a valid unit price.";
    if (lineItemForm.unit && !recognizeUnit(lineItemForm.unit)) errors.unit = customUnitError(lineItemForm.unit);
    if (Object.keys(errors).length) {
      setLineItemErrors(errors);
      return;
    }
    setLineItemErrors({});
    setLineItemSaving(true);
    try {
      if (editingLineItemId) {
        const { data } = await api.patch(`/projects/proposals/${proposalId}/line-items/${editingLineItemId}/`, { ...lineItemForm, unit: unitValueForSave(lineItemForm.unit) });
        setProposal((prev) => ({
          ...prev,
          totals: data.totals || prev?.totals,
          line_items: (prev?.line_items || []).map((item) => (item.id === editingLineItemId ? data.line_item : item)),
        }));
        toast.success("Line item updated.");
      } else {
        const { data } = await api.post(`/projects/proposals/${proposalId}/line-items/`, { ...lineItemForm, unit: unitValueForSave(lineItemForm.unit) });
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
      const responseErrors = error?.response?.data || {};
      setLineItemErrors({
        description: responseErrors?.description?.[0] || "",
        quantity: responseErrors?.quantity?.[0] || "",
        unit: responseErrors?.unit?.[0] || "",
        unit_price: responseErrors?.unit_price?.[0] || "",
        form: responseErrors?.detail || "Could not save line item. Your entries have been preserved.",
      });
      toast.error("Could not save line item. Your entries have been preserved.");
    } finally {
      setLineItemSaving(false);
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
    setLineItemErrors({});
    setPricingEditorOpen(true);
    window.requestAnimationFrame(() => document.getElementById("pricing-item-editor")?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }

  async function deleteLineItem(id) {
    if (blockReadOnlyHistory()) return;
    if (!window.confirm("Remove this pricing item? The estimate total and readiness may change.")) return;
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
              onClick={exitWalkthrough}
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
                    onClick={() => openWalkthroughSection(item)}
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
                {["label", "location", "quantity"].map((key) => (
                  <input
                    key={key}
                    data-testid={`walkthrough-measurement-${key}`}
                    className="min-h-12 rounded-xl border border-slate-300 px-4 py-3 text-base font-semibold"
                    placeholder={key === "quantity" ? "Quantity" : key.charAt(0).toUpperCase() + key.slice(1)}
                    value={measurementForm[key]}
                    onChange={(event) => setMeasurementForm((prev) => ({ ...prev, [key]: event.target.value }))}
                  />
                ))}
                <UnitSelect tone="light" label="Unit" testId="walkthrough-measurement-unit" value={measurementForm.unit} onChange={(value) => setMeasurementForm((prev) => ({ ...prev, unit: value }))} error={measurementUnitError} />
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
                      <button key={item.id} type="button" onClick={() => openWalkthroughSection({ key: "photos", title: "Photos", target: "photos", action: "Upload photos", summary: "Review recently captured photos." })} className="rounded-xl bg-slate-100 p-2 text-left">
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
                      <button key={item.id} type="button" onClick={() => openWalkthroughSection({ key: "measurements", title: "Measurements", target: "measurements", action: "Add measurement", summary: "Review captured measurements." })} className="w-full rounded-xl bg-slate-100 px-3 py-2 text-left">
                        <div className="font-black">{item.label}</div>
                        <div className="text-sm font-semibold text-slate-600">{item.quantity} {unitDisplay(item.unit)} - {field(item.location)}</div>
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
                      <button key={item.label} type="button" onClick={() => openWalkthroughSection({ key: "site-visit", title: "Site Visit", target: "site", action: "Capture site details", summary: "Review captured site notes." })} className="w-full rounded-xl bg-slate-100 px-3 py-2 text-left">
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
      <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-sky-200/14 bg-[#061d42]/95 px-4 py-3 text-sm font-black text-white shadow-sm" data-testid="proposal-workspace-header" aria-live="polite">
        <span data-testid="estimate-header-progress">{estimateChecklist.percent}% ready</span>
        <span aria-hidden="true">·</span>
        <span>{estimateChecklist.requiredMissing.length} required item{estimateChecklist.requiredMissing.length === 1 ? "" : "s"} remaining</span>
        <span aria-hidden="true">·</span>
        <span>{money(totals.total)}</span>
        {isReadOnlyHistory ? <span className="ml-auto text-emerald-200">Converted history</span> : null}
      </div>

      <div className="space-y-4" data-testid="proposal-workspace">
        <section className="rounded-2xl border border-sky-200/14 bg-[#061d42]/95 p-3 text-white shadow-[0_24px_70px_rgba(2,8,23,0.3)] md:p-4" data-testid="proposal-nav">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4" role="tablist" aria-label="Estimate workflow steps" data-testid="estimate-workflow-tabs">
            {WORKSPACE_STEPS.map((step, index) => {
              const selected = index === activeStepIndex;
              const status = workflowGroupStatus(WORKFLOW_GROUPS[index], estimateChecklist, proposal, photos, documents, isReadOnlyHistory);
              return (
                <button
                  key={step.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="estimate-step-workspace"
                  aria-label={`${step.number}. ${step.label}: ${status.label}`}
                  data-testid={`estimate-workflow-step-${step.key}`}
                  onClick={() => openWorkspaceStep(index)}
                  onKeyDown={(event) => handleStepKeyDown(event, index)}
                  tabIndex={selected ? 0 : -1}
                  className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 ${selected ? "border-amber-200/50 bg-amber-300 text-slate-950 shadow-sm" : "border-white/12 bg-white/7 text-white hover:border-white/24 hover:bg-white/11"}`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${selected ? "bg-slate-950 text-amber-200" : "bg-white/10 text-white"}`}>{step.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black">{step.label}</span>
                    <span className={`block truncate text-[10px] font-bold uppercase tracking-wide ${selected ? "text-slate-700" : "text-sky-100/55"}`}>{status.label}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-3 border-t border-white/10 pt-3 text-sm font-semibold text-sky-100/68">{activeStep.purpose}</p>
        </section>

        <main id="estimate-step-workspace" role="tabpanel" aria-label={`${activeStep.label} estimate step`} tabIndex={0} className="min-w-0 space-y-4 outline-none focus-visible:ring-2 focus-visible:ring-sky-300" data-testid={`estimate-step-panel-${activeStep.key}`}>
          {walkthroughTask ? (
            <div
              className="rounded-2xl border border-sky-200/18 bg-[#061d42]/95 p-4 text-white shadow-[0_18px_48px_rgba(2,8,23,0.24)]"
              data-testid="walkthrough-return-banner"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-100/80">Walkthrough Task</div>
                  <h2 className="mt-1 text-lg font-black text-white">{walkthroughTask.title}</h2>
                  <p className="mt-1 text-sm font-semibold leading-6 text-sky-100/70">
                    Complete this section, then return to the capture checklist. {walkthroughTask.description}
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="back-to-walkthrough"
                  onClick={returnToWalkthrough}
                  className="inline-flex shrink-0 items-center justify-center rounded-lg border border-white/18 bg-white/10 px-4 py-2 text-sm font-black text-white hover:bg-white/15"
                >
                  Back to Walkthrough
                </button>
              </div>
            </div>
          ) : null}

          <Section id="overview" active={activeStep.key === "project"} title="Estimate Status" description="Keep the estimate lifecycle status current while project details are prepared.">
            <div className="rounded-xl border border-white/10 bg-white/7 p-4">
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

          <Section id="assistant" active={false} title="Project Assistant">
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

          <Section id="clarifications" active={activeStep.key === "site_scope"} title="Clarification Questions">
            <div className="rounded-lg border border-white/10 bg-white/7 p-3 text-sm font-semibold text-sky-100/72" data-testid="proposal-clarification-intro">
              Questions come from the selected agreement template. Project Assistant may suggest answers from captured context, but the contractor must review and accept them.
            </div>
            <div className="mt-3 text-sm font-black text-sky-100/78" data-testid="proposal-clarification-summary" aria-live="polite">
              {clarificationRows.filter((row) => row.status === "Needs Answer" || row.status === "Reopened").length} need answers · {clarificationRows.filter((row) => row.status === "Suggested").length} suggested · {clarificationRows.filter((row) => row.status === "Ignored").length} ignored
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" aria-expanded={showCompletedClarifications} onClick={() => setShowCompletedClarifications((value) => !value)} className="rounded-lg border border-white/14 bg-white/8 px-3 py-2 text-xs font-black text-white">{showCompletedClarifications ? "Hide" : "Show"} completed ({clarificationRows.filter((row) => row.status === "Complete").length})</button>
              <button type="button" aria-expanded={showIgnoredClarifications} onClick={() => setShowIgnoredClarifications((value) => !value)} className="rounded-lg border border-white/14 bg-white/8 px-3 py-2 text-xs font-black text-white">{showIgnoredClarifications ? "Hide" : "Show"} ignored ({clarificationRows.filter((row) => row.status === "Ignored").length})</button>
            </div>
            <div className="mt-4 space-y-3" data-testid="proposal-clarification-questions">
              {sortedClarificationRows.filter((row) => (row.status !== "Complete" || showCompletedClarifications) && (row.status !== "Ignored" || showIgnoredClarifications)).map((row) => {
                const editable = row.status === "Needs Answer" || row.status === "Reopened" || editingClarifications[row.key];
                const suggestedAnswer = row.suggestion?.answer || "";
                const answerValue = clarificationEdits[row.key] ?? row.answer ?? suggestedAnswer;
                const busy = savingClarificationKey === row.key;
                const sourceAction = clarificationTargetLabel(row.target);
                return (
                  <article key={row.key} data-testid={`proposal-clarification-card-${row.key}`} className={`rounded-xl border p-4 ${row.ignored ? "border-slate-400/25 bg-slate-500/10" : row.complete ? "border-emerald-200/30 bg-emerald-400/10" : "border-amber-200/30 bg-amber-400/10"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-black text-white">{row.label}</h3>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${row.ignored ? "bg-slate-500 text-white" : row.complete ? "bg-emerald-600 text-white" : "bg-amber-300 text-amber-950"}`} data-testid={`proposal-clarification-status-${row.key}`}>{row.status}</span>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-sky-100/74">{row.question}</p>
                        {row.status === "Suggested" ? (
                          <div className="mt-3 rounded-lg border border-sky-200/20 bg-sky-400/10 p-3">
                            <div className="text-xs font-black uppercase tracking-wide text-sky-100">Suggested · {row.sourceLabel}</div>
                            <p className="mt-2 whitespace-pre-wrap text-sm font-semibold text-white">{suggestedAnswer}</p>
                            <p className="mt-2 text-xs font-bold text-amber-100">Review this answer before accepting it. This suggestion is unaccepted and does not satisfy readiness.</p>
                          </div>
                        ) : null}
                        {editable ? (
                          <div className="mt-3">
                            <label htmlFor={`clarification-answer-${row.key}`} className="text-sm font-black text-white">Answer</label>
                            <textarea id={`clarification-answer-${row.key}`} data-testid={`proposal-clarification-answer-${row.key}`} rows={3} value={answerValue} onChange={(event) => setClarificationEdits((previous) => ({ ...previous, [row.key]: event.target.value }))} aria-describedby={clarificationErrors[row.key] ? `clarification-error-${row.key}` : undefined} className="mt-1 w-full rounded-lg border border-white/14 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-white placeholder:text-sky-100/40 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-300/25" placeholder="Enter the contractor-reviewed answer" />
                            <div className="mt-1 text-xs font-semibold text-sky-100/55">Plain text; line breaks are preserved.</div>
                          </div>
                        ) : row.answer ? <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-950/30 p-3 text-sm font-semibold text-white">{row.answer}</p> : row.complete ? <p className="mt-3 text-xs font-bold text-amber-100">Previously completed before answer text was supported. Reopen to add an answer.</p> : null}
                        {clarificationErrors[row.key] ? <p id={`clarification-error-${row.key}`} role="alert" className="mt-2 text-sm font-bold text-rose-200">{clarificationErrors[row.key]}</p> : null}
                      </div>
                    </div>
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      {row.status === "Suggested" && !editable ? <button type="button" disabled={busy} data-testid={`proposal-clarification-accept-${row.key}`} onClick={() => persistClarification(row, "complete", suggestedAnswer)} className={ESTIMATE_PRIMARY_GOLD_BUTTON}>Accept answer</button> : null}
                      {editable ? <button type="button" disabled={busy} data-testid={`proposal-clarification-save-${row.key}`} onClick={() => persistClarification(row, "complete", answerValue)} className={ESTIMATE_PRIMARY_GOLD_BUTTON}>{busy ? "Saving…" : "Save answer"}</button> : null}
                      {(row.status === "Suggested" || row.status === "Complete") && !editable ? <button type="button" onClick={() => setEditingClarifications((previous) => ({ ...previous, [row.key]: true }))} className="rounded-lg border border-white/16 bg-white/10 px-3 py-2 text-xs font-black text-white">Edit answer</button> : null}
                      {(row.status === "Complete" || row.status === "Ignored") ? <button type="button" disabled={busy} data-testid={`proposal-clarification-reopen-${row.key}`} onClick={() => persistClarification(row, "reopened", row.answer || answerValue)} className="rounded-lg border border-white/16 bg-white/10 px-3 py-2 text-xs font-black text-white">Reopen</button> : null}
                      {!row.complete ? <button type="button" disabled={busy} data-testid={`proposal-clarification-ignore-${row.key}`} onClick={() => ignoreClarification(row)} className="rounded-lg border border-white/16 bg-white/8 px-3 py-2 text-xs font-black text-white">Ignore</button> : null}
                      {sourceAction ? <button type="button" onClick={() => openClarificationSource(row)} className="rounded-lg border border-white/16 bg-white/8 px-3 py-2 text-xs font-black text-white">{row.status === "Suggested" ? "View source" : sourceAction}</button> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </Section>

          <Section id="appointment" active={activeStep.key === "project"} title="Estimate Appointment">
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

          <Section id="customer" active={activeStep.key === "project"} title="Customer & Contact">
            <InfoGrid
              rows={[
                ["Customer", proposal.customer_name],
                ["Phone", proposal.customer_phone],
                ["Email", proposal.customer_email],
                ["Project Address", projectAddress || "Not provided"],
                ["Preferred contact", preferredContactLabel(draft.customer_preferred_contact)],
              ]}
            />
            <div className="mt-4 grid gap-4 rounded-xl border border-white/10 bg-white/7 p-4 md:grid-cols-2" data-testid="proposal-project-identity">
              <label className="block">
                <span className="text-sm font-semibold text-sky-100/78">Project Title</span>
                <input data-testid="proposal-project-title" value={draft.project_title || ""} onChange={(event) => patchDraft("project_title", event.target.value)} placeholder="e.g. Primary Bathroom Renovation" maxLength={255} className="mt-1 w-full rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white placeholder:text-sky-100/42 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-300/20" />
                <span className="mt-1 block text-xs font-semibold text-sky-100/55">Used to identify this estimate and shown in Review.</span>
              </label>
              <div>
                <SelectField label="Preferred Contact" testId="proposal-preferred-contact" value={draft.customer_preferred_contact} onChange={(value) => patchDraft("customer_preferred_contact", value)} options={PREFERRED_CONTACT_OPTIONS} />
                <span className="mt-1 block text-xs font-semibold text-sky-100/55">Applies to this estimate only; the customer profile is not changed.</span>
              </div>
              <div className="md:col-span-2">
                {projectDetailsDirty ? <button type="button" data-testid="proposal-save-project-identity" disabled={saving} onClick={() => saveProposal({ project_title: draft.project_title, customer_preferred_contact: draft.customer_preferred_contact }, "Project details saved.")} className={ESTIMATE_PRIMARY_GOLD_BUTTON}>{saving ? "Saving…" : "Save Project Details"}</button> : <p className="text-xs font-bold text-sky-100/55">Project details are saved.</p>}
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-white/10 bg-white/7 p-4" data-testid="proposal-project-address-workflow">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-sm font-black text-white">Project Address</h3>
                  <p className="mt-1 text-sm font-semibold text-sky-100/70">
                    {projectAddress ? "This saved estimate address is used for readiness and Review. Select a saved property or edit it below." : "Choose a saved property or enter a new project address before agreement handoff."}
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
                    value={selectedExistingProperty}
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
                Save this address to customer profile
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

          <Section id="scheduling" active={activeStep.key === "project"} title="Project Scheduling">
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

          <Section id="site" active={activeStep.key === "site_scope"} title="Site Access & Conditions">
            <div className="mb-4 flex flex-wrap gap-2" data-testid="proposal-site-navigation-actions">
              <button type="button" data-testid="site-go-photos" onClick={() => openWorkspaceSection("photos")} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm font-bold text-blue-800"><Camera size={16} /> Go to Photos</button>
              <button type="button" data-testid="site-go-measurements" onClick={() => openWorkspaceSection("measurements")} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800"><Ruler size={16} /> Add measurement</button>
              {String(import.meta.env.VITE_CAPTURE_MEASUREMENT_ENABLED || "").toLowerCase() === "true" ? (
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent("mhb:open-capture", { detail: { mode: "measurement", projectId: proposal?.project_id || proposal?.project?.id } }))}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-bold text-sky-900"
                  data-testid="estimate-measure-space"
                >
                  <Ruler size={16} /> Measure a Space
                </button>
              ) : null}
              <button type="button" data-testid="site-go-documents" onClick={() => openWorkspaceSection("documents")} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/14 bg-white/8 px-3 py-2 text-sm font-bold text-white hover:bg-white/12"><FileUp size={16} /> Attach document</button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <TextAreaField label="Access instructions" testId="proposal-access-notes" value={draft.access_notes} onChange={(value) => patchDraft("access_notes", value)} />
              <TextAreaField label="Risk notes" value={draft.risk_notes} onChange={(value) => patchDraft("risk_notes", value)} />
              <TextAreaField label="Customer requests" value={draft.customer_requests} onChange={(value) => patchDraft("customer_requests", value)} />
              <TextAreaField label="Conditions" value={draft.site_conditions} onChange={(value) => patchDraft("site_conditions", value)} />
            </div>
            <button
              type="button"
              data-testid="proposal-save-site-visit"
              onClick={() => saveProposal({
                access_notes: draft.access_notes,
                risk_notes: draft.risk_notes,
                customer_requests: draft.customer_requests,
                site_conditions: draft.site_conditions,
              }, "Site access saved.")}
              disabled={saving}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              <Save size={16} /> Save site access
            </button>
          </Section>

          <Section id="measurements" active={activeStep.key === "site_scope"} title="Measurements">
            <div className="mb-3 text-sm font-black text-sky-100/75" aria-live="polite">{(proposal.measurements || []).length} measurement{(proposal.measurements || []).length === 1 ? "" : "s"}</div>
            <form onSubmit={addMeasurement} className="grid gap-3 rounded-lg border border-white/10 bg-white/7 p-3 md:grid-cols-5" data-testid="proposal-measurement-form">
              {["label", "location", "quantity"].map((key) => (
                <input
                  key={key}
                  data-testid={`proposal-measurement-${key}`}
                  className="rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white placeholder:text-sky-100/42 focus:border-sky-300 focus:outline-none"
                  placeholder={key === "quantity" ? "Quantity" : key.charAt(0).toUpperCase() + key.slice(1)}
                  value={measurementForm[key]}
                  onChange={(event) => setMeasurementForm((prev) => ({ ...prev, [key]: event.target.value }))}
                />
              ))}
              <UnitSelect label="Unit" testId="proposal-measurement-unit" value={measurementForm.unit} onChange={(value) => setMeasurementForm((prev) => ({ ...prev, unit: value }))} error={measurementUnitError} />
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
                    <div className="text-sm text-sky-100/70">{field(item.location)} - {item.quantity} {unitDisplay(item.unit)}</div>
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

          <Section id="photos" active={activeStep.key === "site_scope"} title="Photos">
            <div className="mb-3 text-sm font-black text-sky-100/75" aria-live="polite">{photos.length} photo{photos.length === 1 ? "" : "s"}</div>
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

          <Section id="documents" active={activeStep.key === "site_scope"} title="Documents">
            <div className="mb-3 text-sm font-black text-sky-100/75" aria-live="polite">{documents.length} document{documents.length === 1 ? "" : "s"}</div>
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

          <Section id="estimate" active={activeStep.key === "pricing"} title="Estimate Pricing">
            <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/7 p-4 lg:flex-row lg:items-start lg:justify-between" data-testid="pricing-header">
              <div>
                <p className="text-sm font-semibold text-sky-100/78">Build the estimate total from labor, materials, and supported adjustments.</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs font-black uppercase tracking-wide">
                  <span className={`rounded-full px-2.5 py-1 ${(proposal.line_items || []).length ? "bg-emerald-400/15 text-emerald-100" : "bg-amber-300/15 text-amber-100"}`}>{(proposal.line_items || []).length ? "Pricing complete" : "Pricing needs attention"}</span>
                  <span className="rounded-full bg-white/8 px-2.5 py-1 text-sky-100/70">{(proposal.line_items || []).length} item{(proposal.line_items || []).length === 1 ? "" : "s"}</span>
                </div>
              </div>
              <dl className="grid min-w-64 grid-cols-2 gap-x-6 gap-y-2 text-right text-sm tabular-nums" data-testid="proposal-estimate-totals" aria-label="Estimate totals">
                <dt className="text-sky-100/60">Subtotal</dt><dd className="font-black text-white">{money(totals.subtotal)}</dd>
                <dt className="text-sky-100/60">Tax</dt><dd className="font-black text-white">{money(totals.tax)}</dd>
                <dt className="text-sky-100/60">Incidentals reserve</dt><dd className="font-black text-white">{money(totals.incidentals_reserve)}</dd>
                <dt className="text-sky-100/60">Discounts</dt><dd className="font-black text-white">-{money(totals.discounts)}</dd>
                <dt className="border-t border-white/12 pt-2 font-black text-white">Estimate total</dt><dd className="border-t border-white/12 pt-2 text-lg font-black text-amber-200">{money(totals.total)}</dd>
              </dl>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-slate-950/25 p-4" data-testid="template-pricing-availability">
              {selectedTemplate?.id ? <>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-black uppercase tracking-[0.14em] text-sky-100/55">Template</div>
                  <div className="text-sm font-black text-white">{selectedTemplate.name}</div>
                  <div className="text-xs font-semibold text-sky-100/65">{[selectedTemplate.project_type, selectedTemplate.project_subtype].filter(Boolean).join(" · ") || "General project"} · {selectedTemplate.is_system_template ? "System Template" : "My Template"} · Active</div>
                  <div className="mt-1 text-xs font-bold text-sky-100/75">{templatePricingState.pricingApplied ? `Pricing started from ${selectedTemplate.name} · template-derived items are edited independently from the source.` : templatePricingItems.length ? `Pricing guidance available · ${templatePricingItems.length} reusable priced milestone${templatePricingItems.length === 1 ? "" : "s"} · ${money(templatePricingSubtotal)}` : templateAllocationItems.length ? "Pricing basis needed · allocation guidance is available, but this template does not store project-specific dollar prices." : "Selected template · this template does not include reusable pricing guidance."}</div>
                  {proposal?.pricing_template_name && proposal.pricing_template_name !== selectedTemplate.name ? <div role="status" className="mt-2 text-xs font-bold text-amber-100">This estimate already contains pricing copied from {proposal.pricing_template_name}. Existing items will remain unless you explicitly replace them during pricing preview.</div> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button ref={templateViewTriggerRef} type="button" onClick={() => setTemplateViewOpen(true)} className="rounded-lg border border-white/14 px-3 py-2 text-sm font-black text-white underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300">View template</button>
                  <button ref={templatePickerTriggerRef} type="button" onClick={openTemplatePicker} className="rounded-lg border border-white/14 px-3 py-2 text-sm font-black text-white">Change template</button>
                  {templatePricingItems.length ? <button ref={templatePricingTriggerRef} type="button" data-testid="apply-template-pricing-open" onClick={openTemplatePricingPreview} className="rounded-lg border border-amber-200/30 bg-amber-300 px-3 py-2 text-sm font-black text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200">Apply template pricing</button> : null}
                  {!templatePricingItems.length && templateAllocationItems.length ? <button type="button" data-testid="build-template-pricing" onClick={openAllocationBuilder} className="rounded-lg border border-amber-200/30 bg-amber-300 px-3 py-2 text-sm font-black text-slate-950">Build pricing from template</button> : null}
                </div>
              </> : <>
                <div className="min-w-0 flex-1"><div className="text-sm font-black text-white">Template</div><div className="text-sm font-semibold text-sky-100/70">Apply a reusable template to speed up pricing.</div></div>
                <button ref={templatePickerTriggerRef} type="button" data-testid="choose-pricing-template" onClick={openTemplatePicker} className="rounded-lg border border-amber-200/30 bg-amber-300 px-3 py-2 text-sm font-black text-slate-950">Choose template</button>
              </>}
            </div>
            {templatePricingReceipt ? <p className="mt-3 text-sm font-black text-emerald-100" role="status" data-testid="template-pricing-receipt">{templatePricingReceipt}</p> : null}

            {pricingEditorOpen ? (
            <form id="pricing-item-editor" onSubmit={submitLineItem} className="mt-4 grid gap-3 rounded-xl border border-sky-200/18 bg-slate-950/30 p-4 md:grid-cols-6" data-testid="proposal-line-item-form" aria-busy={lineItemSaving}>
              <div className="md:col-span-6">
                <h3 className="text-lg font-black text-white">{editingLineItemId ? "Edit pricing item" : "Add pricing item"}</h3>
                <p className="mt-1 text-sm font-semibold text-sky-100/65">The server calculates line totals as quantity × unit price.</p>
              </div>
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
              <label className="md:col-span-2"><span className="text-xs font-black uppercase tracking-wide text-sky-100/60">Category</span><select
                data-testid="proposal-line-category"
                className="mt-1 w-full rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white focus:border-sky-300 focus:outline-none"
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
              </select></label>
              <label className="md:col-span-4"><span className="text-xs font-black uppercase tracking-wide text-sky-100/60">Description</span><input
                data-testid="proposal-line-description"
                className="mt-1 w-full rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white placeholder:text-sky-100/42 focus:border-sky-300 focus:outline-none"
                placeholder="Description"
                value={lineItemForm.description}
                onChange={(event) => patchLineItemForm("description", event.target.value)}
                aria-invalid={Boolean(lineItemErrors.description)} aria-describedby={lineItemErrors.description ? "pricing-description-error" : undefined}
              />{lineItemErrors.description ? <span id="pricing-description-error" className="mt-1 block text-xs font-bold text-rose-200">{lineItemErrors.description}</span> : null}</label>
              <label><span className="text-xs font-black uppercase tracking-wide text-sky-100/60">Quantity</span><input
                data-testid="proposal-line-quantity"
                inputMode="decimal" className="mt-1 w-full rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white placeholder:text-sky-100/42 focus:border-sky-300 focus:outline-none"
                placeholder="Qty"
                value={lineItemForm.quantity}
                onChange={(event) => patchLineItemForm("quantity", event.target.value)}
              />{lineItemErrors.quantity ? <span className="mt-1 block text-xs font-bold text-rose-200">{lineItemErrors.quantity}</span> : null}</label>
              <UnitSelect label="Unit" testId="proposal-line-unit" value={lineItemForm.unit} onChange={(value) => patchLineItemForm("unit", value)} error={lineItemErrors.unit} />
              <label><span className="text-xs font-black uppercase tracking-wide text-sky-100/60">Unit price</span><input
                data-testid="proposal-line-unit-price"
                inputMode="decimal" className="mt-1 w-full rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white placeholder:text-sky-100/42 focus:border-sky-300 focus:outline-none"
                placeholder="Unit price"
                value={lineItemForm.unit_price}
                onChange={(event) => patchLineItemForm("unit_price", event.target.value)}
              />{lineItemErrors.unit_price ? <span className="mt-1 block text-xs font-bold text-rose-200">{lineItemErrors.unit_price}</span> : null}</label>
              <label className="md:col-span-2"><span className="text-xs font-black uppercase tracking-wide text-sky-100/60">Notes (optional)</span><input
                data-testid="proposal-line-notes"
                className="mt-1 w-full rounded-lg border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-white placeholder:text-sky-100/42 focus:border-sky-300 focus:outline-none"
                placeholder="Notes"
                value={lineItemForm.notes}
                onChange={(event) => patchLineItemForm("notes", event.target.value)}
              /></label>
              {lineItemErrors.form ? <div role="alert" className="md:col-span-6 text-sm font-bold text-rose-200">{lineItemErrors.form}</div> : null}
              <div className="flex gap-2 md:col-span-6">
                <button type="submit" disabled={lineItemSaving} className={ESTIMATE_PRIMARY_GOLD_BUTTON}>
                  <Save size={16} /> {lineItemSaving ? "Saving…" : "Save item"}
                </button>
                {editingLineItemId ? (
                  <button type="button" onClick={resetLineItemForm} className="rounded-lg border border-white/16 px-3 py-2 text-sm font-bold text-white">
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
            ) : null}

            <div className="mt-4 overflow-hidden rounded-lg border border-white/10" data-testid="proposal-line-item-list">
              {coreLineItems.length ? (
                <div className="divide-y divide-white/10">
                  {coreLineItems.map((item) => (
                    <div key={item.id} className="grid gap-3 bg-white/7 p-3 md:grid-cols-[minmax(0,1fr)_120px_120px_120px_auto] md:items-center">
                      <div className="min-w-0">
                        <div className="text-xs font-black uppercase tracking-wide text-sky-100/55">{item.category_label}</div>
                        <div className="font-bold text-white">{item.description}</div>
                        {item.notes ? <div className="text-sm text-sky-100/55">{item.notes}</div> : null}
                      </div>
                      <div className="text-sm font-semibold text-sky-100/72">{item.quantity} {unitDisplay(item.unit)}</div>
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
                <div className="border border-dashed border-white/16 bg-white/6 p-6 text-center" data-testid="pricing-empty-state">
                  <h3 className="text-lg font-black text-white">Add pricing to continue</h3>
                  <p className="mt-1 text-sm font-semibold text-sky-100/70">Add at least one priced item to build the estimate total.</p>
                  {!pricingEditorOpen ? <div className="mt-4 flex flex-wrap justify-center gap-2">{templatePricingItems.length ? <button type="button" onClick={openTemplatePricingPreview} className={ESTIMATE_PRIMARY_GOLD_BUTTON}>Apply template pricing</button> : <button type="button" data-testid="pricing-empty-add" onClick={() => openPricingEditor()} className={ESTIMATE_PRIMARY_GOLD_BUTTON}><Plus size={16} /> Add pricing item</button>}{templatePricingItems.length ? <button type="button" data-testid="pricing-empty-add" onClick={() => openPricingEditor()} className="rounded-lg border border-white/16 px-3 py-2 text-sm font-black text-white">Add pricing item</button> : <button type="button" onClick={openTemplatePicker} className="rounded-lg border border-white/16 px-3 py-2 text-sm font-black text-white">Choose another template</button>}</div> : null}
                </div>
              )}
            </div>
            {coreLineItems.length && !pricingEditorOpen ? <button type="button" data-testid="pricing-add-another" onClick={() => openPricingEditor()} className="mt-4 rounded-lg border border-white/16 bg-white/8 px-3 py-2 text-sm font-black text-white hover:bg-white/12"><Plus size={16} className="mr-2 inline" />Add another item</button> : null}
            {(proposal.line_items || []).length && !pricingEditorOpen ? <button type="button" data-testid="pricing-continue-review" onClick={() => openWorkspaceStep(3)} className={`mt-4 ${ESTIMATE_PRIMARY_GOLD_BUTTON}`}>Continue to Review</button> : null}
          </Section>

          <Section id="incidentals" active={activeStep.key === "pricing"} title="Adjustments" description="Optional tax, discounts, allowances, and incidentals remain separate from core job pricing.">
            <details open={pricingAdjustmentsOpen} onToggle={(event) => setPricingAdjustmentsOpen(event.currentTarget.open)} className="rounded-xl border border-white/10 bg-slate-950/30 p-4" data-testid="pricing-adjustments">
              <summary className="cursor-pointer text-sm font-black text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300">
                Adjustments · {adjustmentLineItems.length} item{adjustmentLineItems.length === 1 ? "" : "s"}{adjustmentLineItems.length ? ` · ${money(pricingAdjustmentImpact)}` : ""}
              </summary>
              <div className="mt-4 space-y-2">
                {adjustmentLineItems.length ? adjustmentLineItems.map((item) => (
                  <div key={item.id} className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/7 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div><div className="text-xs font-black uppercase tracking-wide text-sky-100/55">{item.category_label}</div><div className="font-bold text-white">{item.description}</div><div className="text-sm text-sky-100/65">{item.quantity} {unitDisplay(item.unit)} × {money(item.unit_price)} = <span className="font-black text-white">{money(item.total)}</span></div></div>
                    <div className="flex gap-2"><button type="button" onClick={() => editLineItem(item)} className="rounded-lg border border-white/16 px-3 py-2 text-sm font-bold text-white">Edit</button><button type="button" onClick={() => deleteLineItem(item.id)} className="rounded-lg border border-rose-200/30 px-3 py-2 text-sm font-bold text-rose-200">Remove</button></div>
                  </div>
                )) : <p className="text-sm font-semibold text-sky-100/65">No optional adjustments. Tax is represented only by explicit tax line items; no rate or jurisdiction is configured here.</p>}
                {!pricingEditorOpen ? <button type="button" onClick={() => openPricingEditor("allowance")} className="rounded-lg border border-white/16 bg-white/8 px-3 py-2 text-sm font-black text-white">Add adjustment</button> : null}
              </div>
            </details>
          </Section>

          <Section id="scope" active={activeStep.key === "site_scope"} title="Scope Notes, Exclusions, and Assumptions">
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

          <Section id="ready" active={activeStep.key === "review"} title="Agreement Review" description="Confirm the estimate is complete, then continue into the existing Agreement Wizard.">
            <div className="space-y-5" data-testid="estimate-review-workspace">
              <div role="status" className={`rounded-xl border p-4 ${estimateChecklist.readyMinimum ? "border-emerald-200/30 bg-emerald-400/10" : "border-amber-200/30 bg-amber-400/10"}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className={`text-lg font-black ${estimateChecklist.readyMinimum ? "text-emerald-100" : "text-amber-100"}`} data-testid="estimate-ready-review-status">
                      {estimateChecklist.readyMinimum ? "Ready for Agreement" : "Agreement blockers remain"}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-sky-50/80">
                      {estimateChecklist.readyMinimum ? "This estimate is ready to create an agreement." : "Resolve the remaining required items before creating the agreement."}
                    </p>
                  </div>
                  <div className="shrink-0 text-left sm:text-right"><span className="block text-xs font-black uppercase tracking-wide text-sky-100/55">Estimate total</span><strong className="text-xl text-white">{money(totals.total)}</strong></div>
                </div>
                {!estimateChecklist.readyMinimum ? <div className="mt-4 border-t border-amber-100/15 pt-3" data-testid="estimate-review-blockers"><div className="text-xs font-black uppercase tracking-wide text-amber-100/75">Required before handoff</div><div className="mt-2 flex flex-wrap gap-2">{estimateChecklist.requiredMissing.map((item) => <button key={item.key} type="button" onClick={() => openWorkspaceSection(item.target)} className="rounded-lg border border-amber-100/25 bg-slate-950/25 px-3 py-2 text-left text-sm font-bold text-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300">{item.title}</button>)}</div></div> : null}
              </div>

              <div className="grid gap-3 lg:grid-cols-3" data-testid="estimate-review-summaries">
                <article className="rounded-xl border border-white/10 bg-white/7 p-4" data-testid="estimate-review-project-summary">
                  <div className="flex items-start justify-between gap-2"><h3 className="font-black text-white">Project</h3><button type="button" onClick={() => openWorkspaceStep(0)} className="rounded-md px-2 py-1 text-xs font-black text-sky-200 underline decoration-sky-300/50 underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300">Edit</button></div>
                  <dl className="mt-3 space-y-2 text-sm"><div><dt className="text-xs font-bold text-sky-100/50">Customer</dt><dd className="font-bold text-white">{proposal.customer_name || "Not selected"}</dd></div><div><dt className="text-xs font-bold text-sky-100/50">Property</dt><dd className="font-semibold text-sky-50/80">{proposal.service_location || "Not provided"}</dd></div><div><dt className="text-xs font-bold text-sky-100/50">Project</dt><dd className="font-semibold text-sky-50/80">{proposal.project_title || "Untitled estimate"}</dd></div><div><dt className="text-xs font-bold text-sky-100/50">Preferred Contact</dt><dd className="font-semibold text-sky-50/80">{preferredContactLabel(proposal.customer_preferred_contact)}</dd></div><div><dt className="text-xs font-bold text-sky-100/50">Schedule</dt><dd className="font-semibold text-sky-50/80">{proposalScheduleSummary({ ...proposal, ...draft })}</dd></div></dl>
                </article>
                <article className="rounded-xl border border-white/10 bg-white/7 p-4" data-testid="estimate-review-scope-summary">
                  <div className="flex items-start justify-between gap-2"><h3 className="font-black text-white">Scope</h3><button type="button" onClick={() => openWorkspaceStep(1)} className="rounded-md px-2 py-1 text-xs font-black text-sky-200 underline decoration-sky-300/50 underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300">Edit</button></div>
                  <dl className="mt-3 space-y-2 text-sm"><div><dt className="text-xs font-bold text-sky-100/50">Clarifications</dt><dd className="font-semibold text-sky-50/80">{clarificationRows.filter((row) => row.complete).length} complete · {clarificationRows.filter((row) => !row.complete).length} unresolved</dd></div><div><dt className="text-xs font-bold text-sky-100/50">Site records</dt><dd className="font-semibold text-sky-50/80">{(proposal.measurements || []).length} measurements · {photos.length} photos · {documents.length} documents</dd></div><div><dt className="text-xs font-bold text-sky-100/50">Scope definition</dt><dd className="font-semibold text-sky-50/80">{[draft.included_work, draft.excluded_work, draft.assumptions, draft.allowances].filter((value) => compactText(value)).length} of 4 scope note areas completed</dd></div></dl>
                </article>
                <article className="rounded-xl border border-white/10 bg-white/7 p-4" data-testid="estimate-review-pricing-summary">
                  <div className="flex items-start justify-between gap-2"><h3 className="font-black text-white">Pricing</h3><button type="button" onClick={() => openWorkspaceStep(2)} className="rounded-md px-2 py-1 text-xs font-black text-sky-200 underline decoration-sky-300/50 underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300">Edit</button></div>
                  <dl className="mt-3 space-y-2 text-sm"><div><dt className="text-xs font-bold text-sky-100/50">Pricing items</dt><dd className="font-bold text-white">{(proposal.line_items || []).length}</dd></div><div className="flex justify-between gap-3"><dt className="text-sky-100/60">Subtotal</dt><dd className="font-bold text-white">{money(totals.subtotal)}</dd></div>{Number(totals.tax || 0) ? <div className="flex justify-between gap-3"><dt className="text-sky-100/60">Tax</dt><dd className="font-bold text-white">{money(totals.tax)}</dd></div> : null}{Number(totals.incidentals_reserve || 0) ? <div className="flex justify-between gap-3"><dt className="text-sky-100/60">Incidentals</dt><dd className="font-bold text-white">{money(totals.incidentals_reserve)}</dd></div> : null}{Number(totals.discounts || 0) ? <div className="flex justify-between gap-3"><dt className="text-sky-100/60">Discounts</dt><dd className="font-bold text-white">−{money(totals.discounts)}</dd></div> : null}<div className="flex justify-between gap-3 border-t border-white/10 pt-2"><dt className="font-black text-white">Total</dt><dd className="font-black text-white">{money(totals.total)}</dd></div>{proposal.pricing_template_name ? <div><dt className="text-xs font-bold text-sky-100/50">Pricing source</dt><dd className="font-semibold text-sky-50/80">{proposal.pricing_template_name}</dd></div> : null}</dl>
                </article>
              </div>

              <PricingBenchmarkCard benchmark={pricingBenchmark} loading={pricingBenchmarkLoading} />

              <section className="rounded-xl border border-sky-300/20 bg-slate-950/30 p-4" aria-labelledby="agreement-handoff-title" data-testid="estimate-agreement-handoff">
                <h3 id="agreement-handoff-title" className="font-black text-white">Customer review</h3>
                <p className="mt-1 text-sm font-semibold text-sky-100/70">Send the customer a private, versioned estimate before preparing the agreement. Acceptance approves the estimate as a basis for the agreement; it is not a signature.</p>
                {proposal.customer_review ? <div className="mt-4 rounded-lg border border-white/12 bg-white/7 p-3 text-sm" data-testid="estimate-review-lifecycle"><strong className="block text-white">{proposal.status === "accepted" ? "Customer accepted this estimate" : proposal.status === "revision_requested" ? "Customer requested changes" : proposal.status === "declined" ? "Customer declined this estimate" : proposal.status === "viewed" ? "Viewed by customer · awaiting decision" : "Sent · awaiting customer review"}</strong>{proposal.customer_review.sent_at ? <span className="mt-1 block text-sky-100/65">Sent {formatDateTime(proposal.customer_review.sent_at)} · Version {proposal.customer_review.version}</span> : null}{proposal.customer_review.revision_request_message ? <p className="mt-2 text-sky-50">{proposal.customer_review.revision_request_message}</p> : null}{proposal.customer_review.decline_reason ? <p className="mt-2 text-sky-50">Reason: {proposal.customer_review.decline_reason}</p> : null}</div> : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" data-testid="estimate-customer-preview" onClick={previewCustomerEstimate} className="rounded-lg border border-white/18 bg-white/8 px-4 py-2 text-sm font-black text-white">Preview Customer Estimate</button>
                  {["ready", "revision_requested", "declined", "expired"].includes(proposal.status) ? <button type="button" data-testid="estimate-send-customer" onClick={() => sendEstimateToCustomer(false)} disabled={!estimateChecklist.readyMinimum || reviewSending || isReadOnlyHistory} className={`${ESTIMATE_PRIMARY_GOLD_BUTTON} disabled:opacity-50`}><Mail size={16} /> {reviewSending ? "Sending…" : proposal.customer_review ? "Send Revised Estimate" : "Send Estimate to Customer"}</button> : null}
                  {["sent", "viewed"].includes(proposal.status) ? <button type="button" data-testid="estimate-resend-customer" onClick={() => sendEstimateToCustomer(true)} disabled={reviewSending} className={ESTIMATE_PRIMARY_GOLD_BUTTON}><Mail size={16} /> {reviewSending ? "Sending…" : "Resend"}</button> : null}
                  {proposal.status === "accepted" ? <button type="button" data-testid="estimate-ready-create-agreement" onClick={createAgreementFromProposal} className={ESTIMATE_PRIMARY_GOLD_BUTTON}><FileSignature size={16} /> Create Agreement</button> : null}
                </div>
                {!estimateChecklist.readyMinimum ? <p id="agreement-action-disabled-reason" className="mt-2 text-sm font-semibold text-amber-100">Complete the required items listed above to continue.</p> : null}
              </section>
            </div>
          </Section>

          <Section id="notes" active={activeStep.key === "review"} title="Internal Notes" description="Optional contractor-only context. These notes are not included in the customer agreement handoff.">
            <details className="rounded-xl border border-white/10 bg-white/5 p-4">
              <summary className="cursor-pointer font-black text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300">Add or review internal notes</summary>
              <div className="mt-4"><TextAreaField label="Contractor notes" testId="proposal-internal-notes" value={draft.internal_notes} onChange={(value) => patchDraft("internal_notes", value)} rows={5} />
                {notesDirty ? <button type="button" data-testid="proposal-save-notes" onClick={() => saveProposal({ internal_notes: draft.internal_notes }, "Notes saved.")} disabled={saving} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"><Save size={16} /> {saving ? "Saving…" : "Save Notes"}</button> : <p className="mt-3 text-xs font-bold text-sky-100/55">Notes are saved.</p>}
              </div>
            </details>
          </Section>

          <Section id="history" active={activeStep.key === "review"} title="Recent Activity" description="The two latest estimate events are shown by default. The complete recorded history remains available.">
            <div className="space-y-2" data-testid="proposal-history">
              {(proposal.activity || []).length ? recentActivity.map((item) => { const display = activityDisplay(item); return <div key={item.id} className="rounded-lg border border-white/10 bg-white/7 p-3"><div className="font-bold text-white">{display.label}</div>{display.detail && display.detail !== display.label ? <div className="mt-0.5 text-sm font-semibold text-sky-100/65">{display.detail}</div> : null}<div className="mt-1 text-xs font-semibold text-sky-100/55">{formatDateTime(item.created_at)}</div></div>; }) : <div className="rounded-lg border border-dashed border-white/16 bg-white/6 p-4 text-sm font-semibold text-sky-100/70">No estimate activity has been recorded yet. Updates, revisions, and conversion events will appear here.</div>}
            </div>
            {(proposal.activity || []).length > 2 ? <button type="button" data-testid="proposal-history-toggle" aria-expanded={historyExpanded} onClick={() => setHistoryExpanded((value) => !value)} className="mt-3 rounded-lg border border-white/16 bg-white/7 px-3 py-2 text-sm font-black text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300">{historyExpanded ? "Show recent activity" : `View full history (${proposal.activity.length})`}</button> : null}
          </Section>
        </main>

        {customerPreview ? <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 p-3" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCustomerPreview(null); }}><section role="dialog" aria-modal="true" aria-labelledby="customer-preview-title" className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/15 bg-[#071d3d] p-5 text-white shadow-2xl" data-testid="estimate-customer-preview-dialog"><div className="flex justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-sky-200">Customer preview</p><h2 id="customer-preview-title" className="text-2xl font-black">{customerPreview.project?.title}</h2><p className="mt-1 text-sky-100/70">{customerPreview.project?.property}</p></div><button type="button" aria-label="Close customer preview" onClick={() => setCustomerPreview(null)} className="h-10 rounded-lg border border-white/15 p-2"><X /></button></div><div className="mt-5 space-y-4"><section className="rounded-xl border border-white/10 bg-white/7 p-4"><h3 className="font-black">Project description</h3><p className="mt-2 whitespace-pre-wrap text-sky-50/80">{customerPreview.project?.description || "No description provided."}</p></section><section className="rounded-xl border border-white/10 bg-white/7 p-4"><h3 className="font-black">Pricing</h3><div className="mt-2 space-y-2">{(customerPreview.pricing?.line_items || []).map((item, index) => <div key={`${item.description}-${index}`} className="flex justify-between gap-3 border-t border-white/10 pt-2"><span>{item.description}</span><strong>{money(item.total)}</strong></div>)}<div className="flex justify-between border-t border-white/20 pt-3 text-lg"><strong>Total</strong><strong>{money(customerPreview.pricing?.total)}</strong></div></div></section><p className="text-xs font-semibold text-sky-100/55">This preview excludes internal notes, Pricing Benchmark, activity, assistant context, and attachments.</p></div></section></div> : null}

        {templateViewOpen ? (
          <div className="fixed inset-0 z-[82] flex items-center justify-center bg-slate-950/75 p-3 sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTemplateViewOpen(false); }}>
            <section role="dialog" aria-modal="true" aria-labelledby="template-view-title" className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/14 bg-[#071d3d] p-4 text-white shadow-2xl sm:p-5" data-testid="estimate-template-view">
              <div className="flex items-start justify-between gap-3"><div><h2 id="template-view-title" className="text-xl font-black">{selectedTemplate?.name}</h2><p className="mt-1 text-sm font-semibold text-sky-100/65">{[selectedTemplate?.project_type, selectedTemplate?.project_subtype].filter(Boolean).join(" · ")} · {selectedTemplate?.is_system_template ? "System Template" : "My Template"}</p></div><button type="button" aria-label="Close template details" onClick={() => setTemplateViewOpen(false)} className="rounded-lg border border-white/14 p-2"><X size={18} /></button></div>
              <section className="mt-5"><h3 className="font-black">Milestones · {selectedTemplate?.milestones?.length || 0}</h3><div className="mt-2 space-y-2">{(selectedTemplate?.milestones || []).map((item) => <article key={item.id} className="rounded-xl border border-white/10 bg-white/7 p-3"><div className="font-black">{item.title}</div>{item.description ? <p className="mt-1 text-sm text-sky-100/70">{item.description}</p> : null}<div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-sky-100/65">{Number(item.suggested_amount_fixed) > 0 ? <span>Fixed {money(item.suggested_amount_fixed)}</span> : null}{Number(item.suggested_amount_percent) > 0 ? <span>{item.suggested_amount_percent}% allocation</span> : null}{item.recommended_days_from_start != null ? <span>Day {Number(item.recommended_days_from_start) + 1}</span> : null}{item.recommended_duration_days ? <span>{item.recommended_duration_days} days</span> : null}</div>{item.materials_hint ? <p className="mt-2 text-xs text-sky-100/60">Materials: {item.materials_hint}</p> : null}</article>)}</div></section>
              {selectedTemplate?.project_materials_hint ? <section className="mt-4 rounded-xl border border-white/10 bg-white/7 p-3"><h3 className="font-black">Materials guidance</h3><p className="mt-1 text-sm text-sky-100/70">{selectedTemplate.project_materials_hint}</p></section> : null}
              <div className="mt-5 flex flex-wrap justify-end gap-2">{!selectedTemplate?.is_system_template ? <a href={`/app/templates?template=${selectedTemplate?.id}`} className="rounded-lg border border-white/14 px-3 py-2 text-sm font-black text-white">Open full Template Builder</a> : null}<button type="button" onClick={() => { setTemplateViewOpen(false); openTemplatePicker(); }} className="rounded-lg border border-white/14 px-3 py-2 text-sm font-black">Change template</button>{templatePricingItems.length ? <button type="button" onClick={() => { setTemplateViewOpen(false); openTemplatePricingPreview(); }} className={ESTIMATE_PRIMARY_GOLD_BUTTON}>Preview & apply pricing</button> : templateAllocationItems.length ? <button type="button" onClick={() => { setTemplateViewOpen(false); openAllocationBuilder(); }} className={ESTIMATE_PRIMARY_GOLD_BUTTON}>Use pricing guidance</button> : <button type="button" onClick={() => { setTemplateViewOpen(false); openPricingEditor(); }} className={ESTIMATE_PRIMARY_GOLD_BUTTON}>Add pricing manually</button>}</div>
            </section>
          </div>
        ) : null}
        {allocationOpen ? (
          <div className="fixed inset-0 z-[83] flex items-center justify-center bg-slate-950/80 p-3 sm:p-4" role="presentation">
            <section role="dialog" aria-modal="true" aria-labelledby="allocation-title" className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-white/14 bg-[#071d3d] p-4 text-white shadow-2xl sm:p-5" data-testid="template-allocation-builder">
              <div className="flex items-start justify-between gap-3"><div><h2 id="allocation-title" className="text-xl font-black">Build pricing from template</h2><p className="mt-1 text-sm font-semibold text-sky-100/70">{allocationStep === 1 ? "Step 1 — Pricing basis" : "Step 2 — Milestone budgets and cost categories"}</p></div><button type="button" aria-label="Close pricing builder" onClick={() => setAllocationOpen(false)} className="rounded-lg border border-white/14 p-2"><X size={18} /></button></div>
              {allocationStep === 1 ? <div className="mt-5"><label className="block"><span className="font-black">What do you expect to charge for this project?</span><span className="mt-1 block text-sm font-semibold text-sky-100/65">Target estimate subtotal</span><input data-testid="target-estimate-subtotal" inputMode="decimal" value={targetSubtotal} onChange={(event) => setTargetSubtotal(event.target.value)} className="mt-2 w-full rounded-lg border border-white/14 bg-slate-950/35 px-3 py-3 text-lg font-black text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300" /></label><p className="mt-2 text-sm text-sky-100/65">MyHomeBro will use saved milestone allocations to create a starting pricing plan. You can edit everything before saving. Tax, discounts, allowances, and incidentals remain separate.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setAllocationOpen(false)} className="rounded-lg border border-white/14 px-4 py-2 font-black">Cancel</button><button type="button" onClick={previewAllocations} className={ESTIMATE_PRIMARY_GOLD_BUTTON}>Review milestone allocation</button></div></div> : <div className="mt-5"><div className="mb-4 grid gap-2 rounded-xl border border-white/10 bg-white/7 p-3 sm:grid-cols-3"><div><span className="block text-xs text-sky-100/55">Target subtotal</span><strong>{money(targetSubtotal)}</strong></div><div><span className="block text-xs text-sky-100/55">Total allocated</span><strong>{money(allocationRows.reduce((sum, row) => sum + row.amount, 0))}</strong></div><div><span className="block text-xs text-sky-100/55">Remaining / over</span><strong>{money(Number(targetSubtotal || 0) - allocationRows.reduce((sum, row) => sum + row.amount, 0))}</strong></div></div><p className="mb-3 text-sm font-semibold text-sky-100/70">Milestone budgets describe project phases. Cost categories describe what each reviewed line pays for. Review every row before applying.</p>{(proposal?.line_items || []).length ? <fieldset className="mb-4 rounded-xl border border-amber-200/20 p-3"><legend className="px-1 text-sm font-black">This estimate already contains pricing</legend><label className="mt-2 flex gap-2"><input type="radio" name="allocation-mode" checked={templatePricingMode === "add"} onChange={() => setTemplatePricingMode("add")} />Add template pricing and keep current items</label><label className="mt-2 flex gap-2"><input type="radio" name="allocation-mode" checked={templatePricingMode === "replace"} onChange={() => setTemplatePricingMode("replace")} />Replace existing pricing after confirmation</label></fieldset> : null}<div className="space-y-3">{allocationRows.map((row, index) => <article key={row.milestoneId} className="rounded-xl border border-white/10 bg-white/7 p-3"><label className="flex items-start gap-2"><input type="checkbox" checked={row.selected} onChange={(event) => patchAllocationRow(index, { selected: event.target.checked })} /><span><strong>{row.title}</strong><span className="block text-xs text-sky-100/60">Milestone budget · {row.percent}% · {money(row.amount)}</span></span></label><div className="mt-3 grid gap-2 md:grid-cols-4"><label><span className="text-xs font-black">Cost category</span><select value={row.category} onChange={(event) => patchAllocationRow(index, { category: event.target.value })} className="mt-1 w-full rounded-lg border border-white/12 bg-slate-950/40 px-2 py-2">{LINE_ITEM_CATEGORIES.filter(([value]) => COST_CATEGORY_VALUES.has(value)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="md:col-span-2"><span className="text-xs font-black">Pricing description</span><input value={row.pricingDescription} onChange={(event) => patchAllocationRow(index, { pricingDescription: event.target.value })} className="mt-1 w-full rounded-lg border border-white/12 bg-slate-950/40 px-2 py-2" /></label><label><span className="text-xs font-black">Flat price</span><input inputMode="decimal" value={row.unitPrice} onChange={(event) => patchAllocationRow(index, { unitPrice: event.target.value })} className="mt-1 w-full rounded-lg border border-white/12 bg-slate-950/40 px-2 py-2" /></label></div><div className="mt-2 text-xs text-sky-100/55">Quantity 1 · Unit LS (Lump Sum). No quantity or unit price was guessed from market data.</div></article>)}</div><div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setAllocationStep(1)} className="rounded-lg border border-white/14 px-4 py-2 font-black">Back</button><button type="button" onClick={() => setAllocationOpen(false)} className="rounded-lg border border-white/14 px-4 py-2 font-black">Keep current pricing / Cancel</button><button type="button" disabled={allocationApplying} onClick={applyAllocationPricing} className={ESTIMATE_PRIMARY_GOLD_BUTTON}>{allocationApplying ? "Applying…" : templatePricingMode === "replace" ? "Confirm replacement" : "Apply selected pricing"}</button></div></div>}
            </section>
          </div>
        ) : null}
        {templatePickerOpen ? (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/75 p-3 sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTemplatePickerOpen(false); }}>
            <section ref={templatePickerDialogRef} role="dialog" aria-modal="true" aria-labelledby="template-picker-title" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/14 bg-[#071d3d] text-white shadow-2xl" data-testid="pricing-template-picker">
              <header className="flex items-start justify-between gap-3 border-b border-white/12 p-4 sm:p-5"><div><h2 id="template-picker-title" className="text-xl font-black">Choose template</h2><p className="mt-1 text-sm font-semibold text-sky-100/70">Selecting a template changes estimate context only. Pricing is copied only after preview and confirmation.</p></div><button type="button" aria-label="Close template picker" onClick={() => setTemplatePickerOpen(false)} className="rounded-lg border border-white/14 p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300"><X size={18} /></button></header>
              <div className="border-b border-white/10 p-4"><label className="block"><span className="text-sm font-black">Search templates</span><input value={templatePickerSearch} onChange={(event) => setTemplatePickerSearch(event.target.value)} placeholder="Search name, type, or subtype" className="mt-1 w-full rounded-lg border border-white/14 bg-slate-950/35 px-3 py-2 text-white placeholder:text-sky-100/45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300" /></label></div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                {templatePickerLoading ? <p role="status" className="text-sm font-semibold text-sky-100/70">Loading templates…</p> : [false, true].map((systemGroup) => {
                  const rows = filteredTemplateOptions.filter((item) => Boolean(item.is_system_template) === systemGroup);
                  if (!rows.length) return null;
                  return <section key={String(systemGroup)} className="mb-5"><h3 className="mb-2 text-sm font-black uppercase tracking-[0.14em] text-sky-100/60">{systemGroup ? "Built-in Templates" : "My Templates"}</h3><div className="grid gap-2 sm:grid-cols-2">{rows.map((item) => {
                    const fixed = (item.milestones || []).filter((row) => Number(row.suggested_amount_fixed) > 0);
                    const percent = (item.milestones || []).filter((row) => Number(row.suggested_amount_percent) > 0);
                    const pricingLabel = fixed.length ? "Reusable pricing available" : percent.length ? "Percentage guidance only" : "No reusable pricing";
                    return <button key={item.id} type="button" disabled={templateSelecting} onClick={() => choosePricingTemplate(item)} className="rounded-xl border border-white/12 bg-white/7 p-3 text-left hover:border-sky-300/45 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300" data-testid={`pricing-template-option-${item.id}`}><span className="block font-black text-white">{item.name}</span><span className="mt-1 block text-xs font-semibold text-sky-100/60">{[item.project_type, item.project_subtype].filter(Boolean).join(" · ") || "General project"} · {item.milestone_count || item.milestones?.length || 0} milestones</span><span className="mt-2 inline-flex rounded-full border border-white/12 px-2 py-1 text-xs font-black text-sky-100">{pricingLabel}</span></button>;
                  })}</div></section>;
                })}
                {!templatePickerLoading && !filteredTemplateOptions.length ? <p className="text-sm font-semibold text-sky-100/70">No active templates match your search.</p> : null}
              </div>
            </section>
          </div>
        ) : null}
        {templatePricingPreviewOpen ? (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/75 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTemplatePricingPreviewOpen(false); }}>
            <section ref={templatePricingDialogRef} role="dialog" aria-modal="true" aria-labelledby="template-pricing-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/14 bg-[#071d3d] p-5 text-white shadow-2xl" data-testid="template-pricing-preview">
              <div className="flex items-start justify-between gap-3">
                <div><h2 id="template-pricing-title" className="text-xl font-black">Preview template pricing</h2><p className="mt-1 text-sm font-semibold text-sky-100/70">Copies saved fixed-price milestone guidance from {selectedTemplate?.name}. The template is never changed.</p></div>
                <button type="button" aria-label="Close template pricing preview" onClick={() => setTemplatePricingPreviewOpen(false)} className="rounded-lg border border-white/14 p-2 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300"><X size={18} /></button>
              </div>
              <div className="mt-4 space-y-2">
                {templatePricingItems.map((item) => <div key={item.id} className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/7 p-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="font-black">{item.title}</div>{item.description ? <div className="text-sm font-semibold text-sky-100/65">{item.description}</div> : null}<div className="text-xs font-bold text-sky-100/50">1 item × {money(item.suggested_amount_fixed)}</div></div><div className="font-black tabular-nums">{money(item.suggested_amount_fixed)}</div></div>)}
              </div>
              <div className="mt-4 flex justify-between border-t border-white/12 pt-3 text-sm"><span className="font-black">Preview subtotal</span><span className="font-black tabular-nums">{money(templatePricingSubtotal)}</span></div>
              {(proposal.line_items || []).length ? <fieldset className="mt-4 space-y-2"><legend className="text-sm font-black">Existing pricing found</legend><label className="flex items-start gap-2 rounded-lg border border-white/10 p-3"><input type="radio" name="template-pricing-mode" value="add" checked={templatePricingMode === "add"} onChange={() => setTemplatePricingMode("add")} /><span><strong>Add template items</strong><span className="block text-xs text-sky-100/65">Keep existing pricing and append these copies.</span></span></label><label className="flex items-start gap-2 rounded-lg border border-rose-200/20 p-3"><input type="radio" name="template-pricing-mode" value="replace" checked={templatePricingMode === "replace"} onChange={() => setTemplatePricingMode("replace")} /><span><strong>Replace existing pricing</strong><span className="block text-xs text-rose-100/70">Remove current items and replace them with these copies.</span></span></label></fieldset> : null}
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setTemplatePricingPreviewOpen(false)} className="rounded-lg border border-white/14 px-4 py-2 text-sm font-black">Cancel</button><button type="button" data-testid="apply-template-pricing-confirm" disabled={templatePricingApplying} onClick={applyTemplatePricing} className={ESTIMATE_PRIMARY_GOLD_BUTTON}>{templatePricingApplying ? "Copying…" : templatePricingMode === "replace" && (proposal.line_items || []).length ? "Confirm replacement" : "Copy pricing items"}</button></div>
            </section>
          </div>
        ) : null}

        <footer className="sticky bottom-2 z-10 flex justify-end rounded-2xl border border-sky-200/14 bg-[#061d42]/95 p-3 text-white shadow-[0_18px_48px_rgba(2,8,23,0.34)]" data-testid="estimate-workflow-footer">
          <div className="flex w-full gap-2 sm:w-auto">
            <button type="button" disabled={activeStepIndex === 0} onClick={() => openWorkspaceStep(activeStepIndex - 1)} className="rounded-lg border border-white/14 bg-white/8 px-4 py-2 text-sm font-black text-white hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-40" data-testid="estimate-workflow-previous">
              Previous
            </button>
            {activeStepIndex < WORKSPACE_STEPS.length - 1 && activeStepIndex !== 2 ? (
              <button type="button" onClick={handleStepPrimaryAction} className={`${ESTIMATE_PRIMARY_GOLD_BUTTON} flex-1 sm:flex-none`} data-testid="estimate-workflow-next">
                {stepPrimaryLabel()}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </ContractorPageSurface>
  );
}
