// frontend/src/components/Step2Milestones.jsx
// v2026-03-18-step2-template-aware-full
// Changes:
// - preserves existing Step 2 milestone workflow, AI suggestions, clarifications, save-as-template, edit modal
// - keeps Estimate Assist display in milestone rows
// - makes Step 2 template-aware after Step 1 template apply flow
// - refreshes agreement meta safely so selected template + ai_scope stay in sync
// - prevents template-applied agreements from regenerating milestone structure via AI
// - uses stored ai_scope questions as the primary clarification source

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import toast from "react-hot-toast";
import api from "../api";
import ClarificationsModal from "./ClarificationsModal.jsx";
import { StartWithAIEntry } from "./StartWithAIAssistant.jsx";
import SaveTemplateModal from "./step1/SaveTemplateModal.jsx";
import useAgreementMilestoneAI from "./ai/useAgreementMilestoneAI.jsx";
import useAiFieldHighlights from "../hooks/useAiFieldHighlights.js";
import { getAiPanelConfigForStep } from "../lib/agreementWizardAiPanel.js";
import {
  normalizeAssistantMilestoneSuggestion,
  normalizeAssistantQuestion,
} from "../lib/assistantHandoff.js";

function toDateOnly(v) {
  if (!v) return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function friendly(d) {
  const iso = toDateOnly(d);
  if (!iso) return "";
  const [yStr, mStr, dStr] = iso.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const day = Number(dStr);
  if (!y || !m || !day) return iso;
  const dt = new Date(y, m - 1, day);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function money(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  return n;
}

function parseAmountStrict(v) {
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim();
  if (s === "") return NaN;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return n;
}

function roundSuggestedAmount(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 100) return Math.max(1, Math.round(n));
  return Math.max(5, Math.round(n / 5) * 5);
}

function midpointIfValid(low, high) {
  const lo = parseAmountStrict(low);
  const hi = parseAmountStrict(high);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi <= 0 || hi < lo) return null;
  return (lo + hi) / 2;
}

function deriveSuggestedPriceAmount(m) {
  if (!m || typeof m !== "object") return null;
  const mode = safeStr(m?.pricing_mode).toLowerCase();
  const laborMid = midpointIfValid(m?.labor_estimate_low, m?.labor_estimate_high);
  const totalMid = midpointIfValid(m?.suggested_amount_low, m?.suggested_amount_high);

  const base =
    mode === "labor_only" || mode === "hybrid"
      ? laborMid ?? totalMid
      : totalMid ?? laborMid;

  return roundSuggestedAmount(base);
}

function formatSuggestedAmountInput(n) {
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(Number(n.toFixed(2)));
}

function amountIsValidPositive(v) {
  const n = parseAmountStrict(v);
  return Number.isFinite(n) && n > 0;
}

function amountsDifferMeaningfully(currentAmount, suggestedAmount) {
  const current = parseAmountStrict(currentAmount);
  if (!Number.isFinite(current) || !Number.isFinite(suggestedAmount) || suggestedAmount <= 0) return false;
  return Math.abs(current - suggestedAmount) >= 0.01;
}

function truthy(v) {
  return v === true || v === 1 || v === "1" || v === "true" || v === "True" || v === "yes";
}

function safeStr(v) {
  return (v == null ? "" : String(v)).trim();
}

function formatCurrency(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

function derivePricingSources(pricingReason = "") {
  const reason = safeStr(pricingReason).toLowerCase();
  const sources = [];
  if (!reason) return sources;
  if (
    reason.includes("contractor") ||
    reason.includes("historical jobs") ||
    reason.includes("your history") ||
    reason.includes("prior jobs")
  ) {
    sources.push("Contractor History");
  }
  if (
    reason.includes("market") ||
    reason.includes("regional") ||
    reason.includes("benchmark") ||
    reason.includes("baseline")
  ) {
    sources.push("Market");
  }
  if (reason.includes("template")) {
    sources.push("Template");
  }
  if (
    reason.includes("clarification") ||
    reason.includes("refresh") ||
    reason.includes("ai pricing preview")
  ) {
    sources.push("AI Refresh");
  }
  return [...new Set(sources)];
}

function formatEstimateConfidence(conf) {
  const c = String(conf || "").trim().toLowerCase();
  if (!c) return "";
  if (c === "high") return "High confidence";
  if (c === "medium") return "Moderate confidence";
  if (c === "low") return "Preliminary estimate";
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function formatDurationDays(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${n} day${n === 1 ? "" : "s"}`;
}

function formatRecurringCadence(pattern, interval) {
  const safePattern = safeStr(pattern) || "monthly";
  const safeInterval = Math.max(1, Number(interval || 1) || 1);
  const labels = {
    weekly: safeInterval === 1 ? "week" : "weeks",
    monthly: safeInterval === 1 ? "month" : "months",
    quarterly: safeInterval === 1 ? "quarter" : "quarters",
    yearly: safeInterval === 1 ? "year" : "years",
  };
  return `Every ${safeInterval} ${labels[safePattern] || safePattern}`;
}

function addDays(dateValue, offsetDays) {
  const iso = toDateOnly(dateValue);
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const next = new Date(y, (m || 1) - 1, d || 1);
  if (Number.isNaN(next.getTime())) return "";
  next.setDate(next.getDate() + Number(offsetDays || 0));
  const yy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function estimateAmountDiffers(currentAmount, suggestedAmount) {
  const current = parseAmountStrict(currentAmount);
  const next = parseAmountStrict(suggestedAmount);
  if (!Number.isFinite(next) || next <= 0) return false;
  if (!Number.isFinite(current) || current <= 0) return true;
  return Math.abs(current - next) >= 0.01;
}

function timelineDiffers(currentRow, nextStart, nextCompletion) {
  return (
    toDateOnly(currentRow?.start_date || currentRow?.start) !== toDateOnly(nextStart) ||
    toDateOnly(currentRow?.completion_date || currentRow?.end_date || currentRow?.end) !==
      toDateOnly(nextCompletion)
  );
}

function computeMilestoneLock(agreement) {
  const a = agreement || {};
  const status = String(a?.status || a?.project_status || a?.agreement_status || "")
    .trim()
    .toLowerCase();

  const executed =
    a?.signature_is_satisfied === true ||
    a?.signatureIsSatisfied === true ||
    a?.is_locked === true ||
    false;

  const isSigned =
    executed ||
    status === "signed" ||
    status === "executed" ||
    status === "complete" ||
    truthy(a?.is_signed) ||
    truthy(a?.signed) ||
    !!a?.signed_at ||
    !!a?.signed_at_contractor ||
    !!a?.signed_at_homeowner ||
    !!a?.contractor_signed_at ||
    !!a?.customer_signed_at ||
    !!a?.homeowner_signed_at ||
    truthy(a?.signed_by_contractor) ||
    truthy(a?.signed_by_homeowner);

  const isFunded =
    status === "funded" ||
    status === "escrow_funded" ||
    truthy(a?.escrow_funded) ||
    truthy(a?.is_funded) ||
    !!a?.funded_at ||
    !!a?.escrow_funded_at ||
    !!a?.escrow_payment_intent_id;

  const locked = !!(executed || isFunded || isSigned);

  let reason = "";
  if (isFunded) reason = "Agreement is funded.";
  else if (executed) reason = "Agreement is executed (signed/waived).";
  else if (isSigned) reason = "Agreement is signed.";
  else reason = "";

  return { locked, executed, isSigned, isFunded, reason };
}

function deriveSelectedTemplateMeta(agreement) {
  if (!agreement || typeof agreement !== "object") return null;

  const id =
    agreement?.selected_template?.id ??
    agreement?.selected_template_id ??
    agreement?.template_id ??
    null;

  const name =
    agreement?.selected_template?.name ??
    agreement?.selected_template_name_snapshot ??
    agreement?.selected_template_name ??
    agreement?.template_name ??
    "";

  const projectType =
    agreement?.selected_template?.project_type ??
    agreement?.selected_template_type ??
    agreement?.template_type ??
    "";

  const projectSubtype =
    agreement?.selected_template?.project_subtype ??
    agreement?.selected_template_subtype ??
    agreement?.template_subtype ??
    "";

  if (!id && !safeStr(name)) return null;

  return {
    id,
    name: safeStr(name) || "Selected Template",
    project_type: safeStr(projectType),
    project_subtype: safeStr(projectSubtype),
  };
}

function mergeQuestionsByCanonicalKey(existing = [], incoming = []) {
  const list = [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])];
  const byKey = new Map();

  function normKey(q) {
    const key = String(q?.key || "").trim().toLowerCase();
    if (key) return key;
    return String(q?.label || q?.question || "")
      .trim()
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[()/,:.-]+/g, " ")
      .replace(/\s+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function score(q) {
    let s = 0;
    if (q?.required) s += 5;
    if (q?.help) s += 2;
    if (q?.placeholder) s += 1;
    if (Array.isArray(q?.options) && q.options.length) s += 3;
    if (q?.inputType && q.inputType !== "textarea") s += 2;
    if (q?.label) s += 1;
    return s;
  }

  for (const q of list) {
    if (!q || typeof q !== "object") continue;
    const key = normKey(q);
    if (!key) continue;

    const normalized = { ...q, key };

    if (!byKey.has(key)) {
      byKey.set(key, normalized);
      continue;
    }

    const prev = byKey.get(key);
    byKey.set(key, score(normalized) > score(prev) ? normalized : prev);
  }

  return Array.from(byKey.values());
}

function getEstimateAssistMeta(m) {
  const low = m?.suggested_amount_low;
  const high = m?.suggested_amount_high;
  const laborLow = m?.labor_estimate_low;
  const laborHigh = m?.labor_estimate_high;
  const materialsLow = m?.materials_estimate_low;
  const materialsHigh = m?.materials_estimate_high;
  const confidence = safeStr(m?.pricing_confidence);
  const pricingMode = safeStr(m?.pricing_mode).toLowerCase();
  const pricingReason = safeStr(m?.pricing_source_note);
  const materials = safeStr(m?.materials_hint);
  const type = safeStr(m?.normalized_milestone_type);
  const durationDays =
    m?.recommended_duration_days ??
    (typeof m?.duration === "number" ? m.duration : null);

  return {
    hasRange:
      low !== null &&
      low !== undefined &&
      low !== "" &&
    high !== null &&
    high !== undefined &&
    high !== "",
    hasLaborRange:
      laborLow !== null &&
      laborLow !== undefined &&
      laborLow !== "" &&
      laborHigh !== null &&
      laborHigh !== undefined &&
      laborHigh !== "",
    hasMaterialsRange:
      materialsLow !== null &&
      materialsLow !== undefined &&
      materialsLow !== "" &&
      materialsHigh !== null &&
      materialsHigh !== undefined &&
      materialsHigh !== "",
    low,
    high,
    laborLow,
    laborHigh,
    materialsLow,
    materialsHigh,
    confidence,
    pricingReason:
      pricingReason &&
      pricingReason !== "AI pricing preview refreshed from current clarification answers."
        ? pricingReason
        : "",
    pricingMode,
    pricingModeLabel:
      pricingMode === "labor_only"
        ? "Labor Only"
        : pricingMode === "hybrid"
        ? "Hybrid"
        : pricingMode === "full_service"
        ? "Full Service"
        : "",
    primaryLabel:
      pricingMode === "labor_only" || pricingMode === "hybrid" ? "Labor" : "Total",
    primaryLow:
      pricingMode === "labor_only" || pricingMode === "hybrid"
        ? laborLow ?? low
        : low,
    primaryHigh:
      pricingMode === "labor_only" || pricingMode === "hybrid"
        ? laborHigh ?? high
        : high,
    hasPrimaryRange:
      pricingMode === "labor_only" || pricingMode === "hybrid"
        ? laborLow !== null &&
          laborLow !== undefined &&
          laborLow !== "" &&
          laborHigh !== null &&
          laborHigh !== undefined &&
          laborHigh !== ""
        : low !== null &&
          low !== undefined &&
          low !== "" &&
          high !== null &&
          high !== undefined &&
          high !== "",
    materialsLine:
      pricingMode === "labor_only"
        ? "Materials: customer supplied"
        : materialsLow !== null &&
          materialsLow !== undefined &&
          materialsLow !== "" &&
          materialsHigh !== null &&
          materialsHigh !== undefined &&
          materialsHigh !== ""
        ? `Materials: ${formatCurrency(materialsLow)} – ${formatCurrency(materialsHigh)}`
        : "",
    confidenceLabel: formatEstimateConfidence(confidence),
    pricingSources: derivePricingSources(pricingReason),
    materials,
    type,
    durationDays,
    durationLabel: formatDurationDays(durationDays),
    suggestedAmount: deriveSuggestedPriceAmount(m),
    hasAnything:
      !!safeStr(type) ||
      !!safeStr(materials) ||
      !!safeStr(pricingReason) ||
      !!safeStr(confidence) ||
      (
        (pricingMode === "labor_only" || pricingMode === "hybrid")
          ? (laborLow !== null && laborLow !== undefined && laborLow !== "") ||
            (laborHigh !== null && laborHigh !== undefined && laborHigh !== "")
          : (low !== null && low !== undefined && low !== "") ||
            (high !== null && high !== undefined && high !== "")
      ) ||
      (laborLow !== null && laborLow !== undefined && laborLow !== "") ||
      (laborHigh !== null && laborHigh !== undefined && laborHigh !== "") ||
      (materialsLow !== null && materialsLow !== undefined && materialsLow !== "") ||
      (materialsHigh !== null && materialsHigh !== undefined && materialsHigh !== "") ||
      !!durationDays,
  };
}

function toCompactLine(value, maxLen = 140) {
  const text = safeStr(value).replace(/\s+/g, " ");
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trim()}…`;
}

function projectContextQuantitySignals(answers = {}, measurementNotes = "") {
  const entries = [
    ["roof_area", "Roof area"],
    ["square_footage", "Square footage"],
    ["sqft", "Square footage"],
    ["linear_feet", "Linear feet"],
    ["lf", "Linear feet"],
    ["room_count", "Rooms"],
    ["rooms", "Rooms"],
    ["fixture_count", "Fixtures"],
    ["fixtures", "Fixtures"],
    ["gate_count", "Gates"],
  ];

  const signals = [];
  for (const [key, label] of entries) {
    const value = safeStr(answers?.[key]);
    if (!value) continue;
    signals.push({ label, value });
    if (signals.length >= 2) return signals;
  }

  const notes = safeStr(measurementNotes);
  if (notes) {
    signals.push({ label: "Measurements", value: toCompactLine(notes, 60) });
  }

  return signals.slice(0, 2);
}

const PRICING_IMPACT_KEYS = [
  "roof_area",
  "roof_pitch",
  "roofing_material_type",
  "decking_condition",
  "materials_responsibility",
  "measurements_provided",
  "measurement_notes",
  "measurements_notes",
];

function normalizeMaterialsResponsibilityValue(v) {
  const raw = safeStr(v);
  const lowered = raw.toLowerCase();
  if (!lowered) return "";
  if (lowered.includes("split") || lowered.includes("shared") || lowered.includes("hybrid") || lowered.includes("depend")) {
    return "Split";
  }
  if (
    lowered.includes("homeowner") ||
    lowered.includes("customer") ||
    lowered.includes("owner") ||
    lowered.includes("client")
  ) {
    return "Homeowner";
  }
  if (lowered.includes("contractor")) {
    return "Contractor";
  }
  return raw;
}

function normalizeAnswerValue(v) {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") {
    const normalizedMaterials = normalizeMaterialsResponsibilityValue(v);
    if (normalizedMaterials) return normalizedMaterials;
  }
  return String(v).trim();
}

function pricingImpactAnswersChanged(prevAnswers = {}, nextAnswers = {}) {
  return PRICING_IMPACT_KEYS.some(
    (key) => normalizeAnswerValue(prevAnswers?.[key]) !== normalizeAnswerValue(nextAnswers?.[key])
  );
}

function buildMilestonePricingSignature(rows = []) {
  return JSON.stringify(
    (Array.isArray(rows) ? rows : []).map((row, idx) => ({
      id: row?.id ?? null,
      order: row?.order ?? idx + 1,
      title: safeStr(row?.title),
      description: safeStr(row?.description),
    }))
  );
}

function normalizeMilestoneDraftKey(value) {
  return safeStr(value).toLowerCase();
}

function buildDefaultMilestoneAmounts(count, totalBudget) {
  const safeCount = Math.max(1, Number(count || 0));
  const normalizedTotal = Number(totalBudget);
  const fallbackTotal = normalizedTotal > 0 ? normalizedTotal : safeCount <= 4 ? 4000 : 6000;
  const weightSets = {
    4: [0.2, 0.35, 0.3, 0.15],
    5: [0.12, 0.18, 0.28, 0.26, 0.16],
    6: [0.1, 0.15, 0.2, 0.2, 0.2, 0.15],
    7: [0.08, 0.12, 0.16, 0.18, 0.18, 0.16, 0.12],
  };
  const weights = weightSets[safeCount] || Array.from({ length: safeCount }, () => 1 / safeCount);
  let allocated = 0;
  return weights.map((weight, idx) => {
    if (idx === weights.length - 1) {
      return Number((fallbackTotal - allocated).toFixed(2));
    }
    const next = Number((fallbackTotal * weight).toFixed(2));
    allocated += next;
    return next;
  });
}

function buildStep2AutoMilestoneDraft({ projectType = "", projectSubtype = "", description = "", totalBudget = 0 }) {
  const typeKey = normalizeMilestoneDraftKey(projectType);
  const subtypeKey = normalizeMilestoneDraftKey(projectSubtype);
  const text = `${subtypeKey} ${normalizeMilestoneDraftKey(description)}`;

  let rows = [];

  if (subtypeKey.includes("kitchen remodel")) {
    rows = [
      { title: "Planning & protection", description: "Confirm selections, protect adjacent areas, and stage materials." },
      { title: "Demolition & rough-in", description: "Remove existing finishes and complete rough adjustments for the new layout." },
      { title: "Cabinets & surfaces", description: "Install cabinetry, countertops, and major kitchen surfaces." },
      { title: "Fixtures & appliances", description: "Set fixtures, connect appliances, and complete trim details." },
      { title: "Punch list & walkthrough", description: "Finish punch items, final cleanup, and customer walkthrough." },
    ];
  } else if (subtypeKey.includes("bathroom remodel")) {
    rows = [
      { title: "Protection & demolition", description: "Protect nearby finishes and remove existing bathroom components." },
      { title: "Rough plumbing & electrical", description: "Complete rough adjustments needed for the updated bathroom layout." },
      { title: "Walls, waterproofing & tile", description: "Prep surfaces, waterproof wet areas, and install tile finishes." },
      { title: "Vanity, fixtures & trim", description: "Install vanity, fixtures, accessories, and finish details." },
      { title: "Final cleanup & walkthrough", description: "Complete punch work, cleanup, and final customer review." },
    ];
  } else if (subtypeKey.includes("cabinet installation")) {
    rows = [
      { title: "Measurements & prep", description: "Confirm cabinet layout, site readiness, and delivery staging." },
      { title: "Cabinet installation", description: "Install and secure new cabinets in the planned configuration." },
      { title: "Hardware & adjustments", description: "Align doors and drawers, install hardware, and complete trim adjustments." },
      { title: "Final walkthrough", description: "Review fit and finish, cleanup, and confirm punch items with the customer." },
    ];
  } else if (subtypeKey.includes("countertop installation")) {
    rows = [
      { title: "Template & prep", description: "Confirm measurements, protect work areas, and prep cabinet surfaces." },
      { title: "Countertop installation", description: "Install countertops, seams, and edge details." },
      { title: "Sink & fixture reconnect", description: "Reconnect sink and finish related countertop details." },
      { title: "Cleanup & walkthrough", description: "Complete cleanup, seal where needed, and review the finished install." },
    ];
  } else if (subtypeKey.includes("appliance installation")) {
    rows = [
      { title: "Delivery & staging", description: "Stage appliances, verify openings, and prep the install area." },
      { title: "Installation", description: "Set appliances in place and complete all required connections." },
      { title: "Testing & adjustments", description: "Test operation, fine tune fit, and complete any adjustments." },
      { title: "Cleanup & customer review", description: "Clean the area and review operation and handoff details with the customer." },
    ];
  } else if (subtypeKey.includes("roof replacement") || typeKey.includes("roof")) {
    rows = [
      { title: "Protection & tear-off", description: "Protect the site and remove existing roofing materials." },
      { title: "Decking & prep", description: "Inspect decking, complete repairs, and prep the roof system." },
      { title: "Roof system installation", description: "Install underlayment, roofing materials, and required flashings." },
      { title: "Cleanup & final review", description: "Complete cleanup, magnetic sweep, and final walkthrough." },
    ];
  } else if (typeKey.includes("floor")) {
    rows = [
      { title: "Prep & materials", description: "Confirm material staging and prepare the work areas." },
      { title: "Surface preparation", description: "Demo or prep the substrate for the new flooring system." },
      { title: "Flooring installation", description: "Install flooring materials and transitions." },
      { title: "Trim & cleanup", description: "Complete trim details, cleanup, and final walkthrough." },
    ];
  } else {
    const limitedScope =
      /\binstall(ation)?\b/.test(text) &&
      !/\b(remodel|renovation|addition)\b/.test(text);
    rows = limitedScope
      ? [
          { title: "Prep & materials", description: "Confirm scope, stage materials, and prep the work area." },
          { title: "Primary installation", description: "Complete the core installation or replacement work." },
          { title: "Adjustments & finish", description: "Make adjustments, complete finish details, and test where needed." },
          { title: "Cleanup & walkthrough", description: "Clean the site and review the finished work with the customer." },
        ]
      : [
          { title: "Planning & prep", description: "Confirm scope, materials, and site readiness for the project." },
          { title: "Core work phase 1", description: "Begin the main work and complete the first major phase." },
          { title: "Core work phase 2", description: "Continue the main work and complete the next major phase." },
          { title: "Finish work", description: "Complete finish details, punch items, and final quality checks." },
          { title: "Cleanup & handoff", description: "Complete cleanup and customer walkthrough before closeout." },
        ];
  }

  const amounts = buildDefaultMilestoneAmounts(rows.length, totalBudget);
  return rows.map((row, idx) => ({
    ...row,
    amount: amounts[idx],
  }));
}

export default function Step2Milestones({
  agreementId,
  milestones,
  mLocal,
  onLocalChange,
  onMLocalChange,
  saveMilestone,
  deleteMilestone,
  editMilestone,
  setEditMilestone,
  updateMilestone,
  onBack,
  onNext,
  reloadMilestones,
  refreshAgreement,
  assistantSuggestedMilestones = [],
  assistantClarificationQuestions = [],
  assistantEstimatePreview = {},
  assistantProactiveRecommendations = [],
  assistantPredictiveInsights = [],
  assistantGuidedFlow = {},
  onAiUpdateFeedback = () => {},
}) {
  const [overlapConfirm, setOverlapConfirm] = useState(null);

  const [materialsWho, setMaterialsWho] = useState("Homeowner");
  const [needsMeasurements, setNeedsMeasurements] = useState(true);
  const [measurementNotes, setMeasurementNotes] = useState("");
  const [allowanceNotes, setAllowanceNotes] = useState("");
  const [permitNotes, setPermitNotes] = useState("");

  const [clarOpen, setClarOpen] = useState(false);
  const [savingAiScope, setSavingAiScope] = useState(false);

  const didInitFromServerRef = useRef(false);
  const debounceRef = useRef(null);

  const [spreadEnabled, setSpreadEnabled] = useState(true);
  const [spreadTotal, setSpreadTotal] = useState("");
  const [autoSchedule, setAutoSchedule] = useState(false);

  const [milestonesLocked, setMilestonesLocked] = useState(false);
  const [milestonesLockReason, setMilestonesLockReason] = useState("");

  const [clarReviewed, setClarReviewed] = useState(false);
  const pendingNextRef = useRef(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editForm, setEditForm] = useState({
    id: null,
    order: null,
    title: "",
    description: "",
    start_date: "",
    completion_date: "",
    amount: "",
    normalized_milestone_type: "",
    suggested_amount_low: "",
    suggested_amount_high: "",
    labor_estimate_low: "",
    labor_estimate_high: "",
    materials_estimate_low: "",
    materials_estimate_high: "",
    pricing_confidence: "",
    pricing_mode: "",
    pricing_source_note: "",
    recommended_duration_days: "",
    materials_hint: "",
  });

  const [editAiBusy, setEditAiBusy] = useState(false);
  const [editAiErr, setEditAiErr] = useState("");
  const [editAiPreview, setEditAiPreview] = useState("");

  const [agreementMeta, setAgreementMeta] = useState(null);

  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);

  const recurringPreview = agreementMeta?.recurring_preview || {};
  const recurringSummary = useMemo(() => {
    if (!agreementMeta || agreementMeta?.agreement_mode !== "maintenance") return null;
    return {
      cadence: formatRecurringCadence(
        recurringPreview?.recurrence_pattern || agreementMeta?.recurrence_pattern,
        recurringPreview?.recurrence_interval || agreementMeta?.recurrence_interval
      ),
      nextOccurrence:
        recurringPreview?.next_occurrence_date || agreementMeta?.next_occurrence_date || "",
      previewOccurrences: Array.isArray(recurringPreview?.preview_occurrences)
        ? recurringPreview.preview_occurrences
        : [],
      status: safeStr(agreementMeta?.maintenance_status) || "active",
      label: safeStr(recurringPreview?.recurring_summary_label || agreementMeta?.recurring_summary_label),
    };
  }, [agreementMeta, recurringPreview]);
  const [saveTemplateBusy, setSaveTemplateBusy] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState("");
  const [saveTemplateDescription, setSaveTemplateDescription] = useState("");
  const [fallbackMilestones, setFallbackMilestones] = useState(null);
  const [stagedSuggestedMilestoneIds, setStagedSuggestedMilestoneIds] = useState([]);
  const [stagedSuggestedTimelineIds, setStagedSuggestedTimelineIds] = useState([]);
  const [pricingEstimateStale, setPricingEstimateStale] = useState(false);
  const [dismissedPricingReviewSignature, setDismissedPricingReviewSignature] = useState("");
  const [estimatePreview, setEstimatePreview] = useState(null);
  const [estimateBanner, setEstimateBanner] = useState("");
  const [assistantApplyingMilestones, setAssistantApplyingMilestones] = useState(false);
  const [aiChangeSummary, setAiChangeSummary] = useState("");
  const [autoDraftBusy, setAutoDraftBusy] = useState(false);
  const [autoDraftBanner, setAutoDraftBanner] = useState("");
  const [aiSuggestedMilestoneIds, setAiSuggestedMilestoneIds] = useState([]);
  const { highlights: aiHighlights, markUpdated: markAiUpdated } = useAiFieldHighlights({
    durationMs: 5000,
  });
  const [dismissedAssistantSuggestionSignature, setDismissedAssistantSuggestionSignature] =
    useState("");
  const pricingFreshSignatureRef = useRef("");
  const didInitPricingSignatureRef = useRef(false);
  const estimateAutoLoadSignatureRef = useRef("");
  const autoDraftAttemptedRef = useRef(false);
  const milestoneUserModifiedRef = useRef(false);

  const effectiveMilestones = useMemo(() => {
    return Array.isArray(fallbackMilestones) ? fallbackMilestones : Array.isArray(milestones) ? milestones : [];
  }, [fallbackMilestones, milestones]);
  const milestoneUserModifiedKey = useMemo(
    () => `mhb_step2_user_modified_${agreementId || "new"}`,
    [agreementId]
  );
  const pricingReviewState = useMemo(() => {
    const changed = effectiveMilestones
      .map((row, idx) => {
        const suggestedAmount = deriveSuggestedPriceAmount(row);
        if (!Number.isFinite(suggestedAmount) || suggestedAmount <= 0) return null;
        if (!amountsDifferMeaningfully(row?.amount, suggestedAmount)) return null;
        return {
          milestone: row,
          idx,
          currentAmount: Number(row?.amount || 0),
          suggestedAmount,
        };
      })
      .filter(Boolean);

    const currentTotal = changed.reduce((sum, item) => sum + Number(item.currentAmount || 0), 0);
    const suggestedTotal = changed.reduce((sum, item) => sum + Number(item.suggestedAmount || 0), 0);
    const signature = JSON.stringify(
      changed.map((item) => ({
        id: item.milestone?.id ?? null,
        current: item.currentAmount,
        suggested: item.suggestedAmount,
      }))
    );

    return {
      changed,
      count: changed.length,
      currentTotal,
      suggestedTotal,
      signature,
    };
  }, [effectiveMilestones]);
  const milestonePricingSignature = useMemo(
    () => buildMilestonePricingSignature(effectiveMilestones),
    [effectiveMilestones]
  );
  const showPricingReviewPrompt =
    pricingReviewState.count > 0 &&
    pricingReviewState.signature &&
    pricingReviewState.signature !== dismissedPricingReviewSignature;
  const assistantSuggestionRows = useMemo(
    () =>
      (Array.isArray(assistantSuggestedMilestones) ? assistantSuggestedMilestones : [])
        .map((item, idx) => normalizeAssistantMilestoneSuggestion(item, idx))
        .filter(Boolean),
    [assistantSuggestedMilestones]
  );
  const assistantSuggestionSignature = useMemo(
    () => JSON.stringify(assistantSuggestionRows),
    [assistantSuggestionRows]
  );
  const showAssistantMilestoneSuggestions =
    assistantSuggestionRows.length > 0 &&
    assistantSuggestionSignature &&
    assistantSuggestionSignature !== dismissedAssistantSuggestionSignature;
  const assistantClarificationRows = useMemo(
    () =>
      (Array.isArray(assistantClarificationQuestions) ? assistantClarificationQuestions : [])
        .map((item, idx) => normalizeAssistantQuestion(item, idx))
        .filter(Boolean),
    [assistantClarificationQuestions]
  );
  const assistantEstimatePreviewSignature = useMemo(
    () => JSON.stringify(assistantEstimatePreview || {}),
    [assistantEstimatePreview]
  );
  const hasStagedSuggestedAmountChanges = useMemo(() => {
    if (!Array.isArray(stagedSuggestedMilestoneIds) || !stagedSuggestedMilestoneIds.length) return false;
    const fallbackById = new Map(
      (Array.isArray(fallbackMilestones) ? fallbackMilestones : [])
        .filter((row) => row?.id != null)
        .map((row) => [row.id, row])
    );
    const savedById = new Map(
      (Array.isArray(milestones) ? milestones : [])
        .filter((row) => row?.id != null)
        .map((row) => [row.id, row])
    );
    return stagedSuggestedMilestoneIds.some((id) => {
      const fallbackRow = fallbackById.get(id);
      const savedRow = savedById.get(id);
      if (!fallbackRow || !savedRow) return false;
      return amountsDifferMeaningfully(savedRow?.amount, parseAmountStrict(fallbackRow?.amount));
    });
  }, [fallbackMilestones, milestones, stagedSuggestedMilestoneIds]);
  const hasStagedSuggestedTimelineChanges = useMemo(() => {
    if (!Array.isArray(stagedSuggestedTimelineIds) || !stagedSuggestedTimelineIds.length) return false;
    const fallbackById = new Map(
      (Array.isArray(fallbackMilestones) ? fallbackMilestones : [])
        .filter((row) => row?.id != null)
        .map((row) => [row.id, row])
    );
    const savedById = new Map(
      (Array.isArray(milestones) ? milestones : [])
        .filter((row) => row?.id != null)
        .map((row) => [row.id, row])
    );
    return stagedSuggestedTimelineIds.some((id) => {
      const fallbackRow = fallbackById.get(id);
      const savedRow = savedById.get(id);
      if (!fallbackRow || !savedRow) return false;
      return timelineDiffers(
        savedRow,
        fallbackRow?.start_date || fallbackRow?.start,
        fallbackRow?.completion_date || fallbackRow?.end_date || fallbackRow?.end
      );
    });
  }, [fallbackMilestones, milestones, stagedSuggestedTimelineIds]);
  const isCreateDraftDirty = useMemo(() => {
    const title = safeStr(mLocal?.title);
    const description = safeStr(mLocal?.description);
    const startDate = toDateOnly(mLocal?.start_date || mLocal?.start);
    const completionDate = toDateOnly(mLocal?.completion_date || mLocal?.end_date || mLocal?.end);
    const amount = safeStr(mLocal?.amount);
    return !!(title || description || startDate || completionDate || amount);
  }, [mLocal]);
  const isEditDraftDirty = useMemo(() => {
    if (!editOpen || !editForm?.id) return false;
    const base = editMilestone || effectiveMilestones.find((row) => row?.id === editForm.id);
    if (!base) return false;
    return (
      safeStr(editForm.title) !== safeStr(base?.title) ||
      safeStr(editForm.description) !== safeStr(base?.description) ||
      toDateOnly(editForm.start_date) !== toDateOnly(base?.start_date || base?.start) ||
      toDateOnly(editForm.completion_date) !== toDateOnly(base?.completion_date || base?.end_date || base?.end) ||
      amountIsValidPositive(editForm.amount) !== amountIsValidPositive(base?.amount) ||
      (amountIsValidPositive(editForm.amount) &&
        amountsDifferMeaningfully(base?.amount, parseAmountStrict(editForm.amount)))
    );
  }, [editForm, editMilestone, editOpen, effectiveMilestones]);
  const hasUnsavedStep2Changes =
    hasStagedSuggestedAmountChanges ||
    hasStagedSuggestedTimelineChanges ||
    isCreateDraftDirty ||
    isEditDraftDirty;
  const step2UnsavedMessage = "You have unsaved pricing or milestone changes. Leave without saving?";

  useEffect(() => {
    setFallbackMilestones(null);
  }, [milestones]);

  useEffect(() => {
    try {
      milestoneUserModifiedRef.current = sessionStorage.getItem(milestoneUserModifiedKey) === "1";
    } catch {
      milestoneUserModifiedRef.current = false;
    }
  }, [milestoneUserModifiedKey]);

  useEffect(() => {
    if (!Array.isArray(stagedSuggestedMilestoneIds) || !stagedSuggestedMilestoneIds.length) return;
    if (hasStagedSuggestedAmountChanges) return;
    setStagedSuggestedMilestoneIds([]);
  }, [hasStagedSuggestedAmountChanges, stagedSuggestedMilestoneIds]);

  useEffect(() => {
    if (!Array.isArray(stagedSuggestedTimelineIds) || !stagedSuggestedTimelineIds.length) return;
    if (hasStagedSuggestedTimelineChanges) return;
    setStagedSuggestedTimelineIds([]);
  }, [hasStagedSuggestedTimelineChanges, stagedSuggestedTimelineIds]);

  useEffect(() => {
    if (!hasUnsavedStep2Changes) return undefined;
    const beforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [hasUnsavedStep2Changes]);

  function normalizeMilestoneForLocalFallback(milestone, fallbackOrder = null) {
    if (!milestone || typeof milestone !== "object") return null;

    const normalized = {
      ...milestone,
      id: milestone.id,
      title: milestone.title || "",
      description: milestone.description || "",
      amount: milestone.amount != null ? Number(milestone.amount) : 0,
      start_date: toDateOnly(milestone.start_date || milestone.start || ""),
      completion_date: toDateOnly(milestone.completion_date || milestone.end_date || milestone.end || ""),
      due_date: toDateOnly(milestone.due_date || ""),
      order:
        milestone.order != null
          ? Number(milestone.order)
          : Number.isFinite(fallbackOrder)
          ? fallbackOrder
          : null,
    };

    return normalized;
  }

  function sortFallbackMilestones(rows) {
    return [...rows].sort((a, b) => {
      const orderA = Number.isFinite(Number(a?.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isFinite(Number(b?.order)) ? Number(b.order) : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;

      const idA = Number.isFinite(Number(a?.id)) ? Number(a.id) : Number.MAX_SAFE_INTEGER;
      const idB = Number.isFinite(Number(b?.id)) ? Number(b.id) : Number.MAX_SAFE_INTEGER;
      return idA - idB;
    });
  }

  function applyLocalMilestoneFallback(action, payload) {
    setFallbackMilestones((prev) => {
      const base = Array.isArray(prev) ? prev : Array.isArray(milestones) ? milestones : [];

      if (action === "create") {
        const nextOrder = base.reduce((max, row) => Math.max(max, Number(row?.order || 0)), 0) + 1;
        const created = normalizeMilestoneForLocalFallback(payload, nextOrder);
        if (!created?.id) return base;
        return sortFallbackMilestones([...base.filter((row) => row?.id !== created.id), created]);
      }

      if (action === "update") {
        const fallbackOrder = base.reduce((max, row) => Math.max(max, Number(row?.order || 0)), 0) + 1;
        const updated = normalizeMilestoneForLocalFallback(payload, fallbackOrder);
        if (!updated?.id) return base;
        const exists = base.some((row) => row?.id === updated.id);
        const nextRows = exists
          ? base.map((row) => (row?.id === updated.id ? { ...row, ...updated } : row))
          : [...base, updated];
        return sortFallbackMilestones(nextRows);
      }

      if (action === "delete") {
        return base.filter((row) => row?.id !== payload);
      }

      return base;
    });
  }

  function markMilestonesUserModified() {
    milestoneUserModifiedRef.current = true;
    try {
      sessionStorage.setItem(milestoneUserModifiedKey, "1");
    } catch {
      // ignore
    }
  }

  const refreshAgreementMeta = useCallback(async () => {
    if (!agreementId) return null;
    const res = await api.get(`/projects/agreements/${agreementId}/`, {
      params: { _ts: Date.now() },
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
    const a = res?.data || {};
    setAgreementMeta(a);

    const { locked, reason } = computeMilestoneLock(a);
    setMilestonesLocked(locked);
    setMilestonesLockReason(reason || "");
    return a;
  }, [agreementId]);

  function lockToast() {
    toast.error(
      milestonesLockReason
        ? `Milestones are locked — ${milestonesLockReason}`
        : "Milestones are locked for this agreement."
    );
  }

  async function refreshMilestonesSafe() {
    if (typeof reloadMilestones === "function") {
      await reloadMilestones();
    }
    await refreshAgreementMeta();
    if (typeof refreshAgreement === "function") {
      await refreshAgreement();
    }
    setFallbackMilestones(null);
    setStagedSuggestedMilestoneIds([]);
    setStagedSuggestedTimelineIds([]);
  }

  async function refreshAfterAiBulkSuccess() {
    try {
      await refreshMilestonesSafe();
      return true;
    } catch (err) {
      console.warn("refreshAfterAiBulkSuccess failed:", err);
      toast("AI milestones were created, but the latest agreement data could not be refreshed.");
      return false;
    }
  }

  useEffect(() => {
    if (!agreementId) return;

    let alive = true;

    (async () => {
      try {
        const a = await refreshAgreementMeta();
        if (!alive || !a) return;

        const answers = a?.ai_scope?.answers || {};

        const reviewed =
          answers?.clarifications_reviewed_step2 === true ||
          answers?.clarifications_reviewed_step2 === "true" ||
          answers?.clarifications_reviewed === true;
        setClarReviewed(!!reviewed);

        const mw =
          (typeof answers.who_purchases_materials === "string" && answers.who_purchases_materials.trim()) ||
          (typeof answers.materials_purchasing === "string" && answers.materials_purchasing.trim()) ||
          (typeof answers.materials_responsibility === "string" && answers.materials_responsibility.trim()) ||
          "";

        const normalizedMaterialsWho = normalizeMaterialsResponsibilityValue(mw);
        if (normalizedMaterialsWho === "Homeowner" || normalizedMaterialsWho === "Contractor" || normalizedMaterialsWho === "Split") {
          setMaterialsWho(normalizedMaterialsWho);
        }

        if (typeof answers.measurements_provided === "string") {
          const normalized = String(answers.measurements_provided).trim().toLowerCase();
          if (normalized === "yes") setNeedsMeasurements(true);
          else if (normalized === "no") setNeedsMeasurements(false);
        } else if (typeof answers.measurements_needed === "boolean") {
          setNeedsMeasurements(answers.measurements_needed);
        }

        if (typeof answers.measurement_notes === "string") setMeasurementNotes(answers.measurement_notes);
        else if (typeof answers.measurements_notes === "string") setMeasurementNotes(answers.measurements_notes);

        if (typeof answers.allowances_selections === "string") setAllowanceNotes(answers.allowances_selections);
        else if (typeof answers.allowance_notes === "string") setAllowanceNotes(answers.allowance_notes);

        if (typeof answers.permit_notes === "string") setPermitNotes(answers.permit_notes);
        else if (typeof answers.permits_responsibility === "string") setPermitNotes(answers.permits_responsibility);
        else if (typeof answers.permits === "string") setPermitNotes(answers.permits);
        else if (typeof answers.permits_inspections === "string") setPermitNotes(answers.permits_inspections);
        else if (typeof answers.permit_acquisition === "string") setPermitNotes(answers.permit_acquisition);

        didInitFromServerRef.current = true;
      } catch (e) {
        console.warn("Step2Milestones: could not load agreement ai_scope.answers", e);
        didInitFromServerRef.current = true;
      }
    })();

    return () => {
      alive = false;
    };
  }, [agreementId, refreshAgreementMeta]);

  useEffect(() => {
    if (!didInitPricingSignatureRef.current) {
      pricingFreshSignatureRef.current = milestonePricingSignature;
      didInitPricingSignatureRef.current = true;
      return;
    }

    if (!pricingFreshSignatureRef.current) return;
    if (milestonePricingSignature === pricingFreshSignatureRef.current) return;

    setPricingEstimateStale(true);
  }, [milestonePricingSignature]);

  const selectedTemplateMeta = useMemo(() => deriveSelectedTemplateMeta(agreementMeta), [agreementMeta]);
  const templateApplied = !!selectedTemplateMeta;
  const paymentStructure = String(agreementMeta?.payment_structure || "simple").trim().toLowerCase();
  const isProgressPayments = paymentStructure === "progress";
  const projectContextSummary = useMemo(() => {
    const agreementAnswers = agreementMeta?.ai_scope?.answers || {};
    const projectType =
      safeStr(agreementMeta?.project_type) ||
      safeStr(selectedTemplateMeta?.project_type);
    const projectSubtype =
      safeStr(agreementMeta?.project_subtype) ||
      safeStr(selectedTemplateMeta?.project_subtype);
    const materialsResponsibility = normalizeMaterialsResponsibilityValue(
      agreementAnswers?.materials_responsibility ||
      agreementAnswers?.materials_purchasing ||
      agreementAnswers?.who_purchases_materials ||
      materialsWho
    );
    const quantitySignals = projectContextQuantitySignals(agreementAnswers, measurementNotes);
    const scopeSummary = toCompactLine(
      agreementMeta?.description ||
      agreementMeta?.ai_scope?.scope_text ||
      agreementMeta?.project?.description ||
      ""
    );

    return {
      projectType,
      projectSubtype,
      templateName: safeStr(selectedTemplateMeta?.name),
      materialsResponsibility:
        materialsResponsibility === "Contractor"
          ? "Contractor supplied"
          : materialsResponsibility === "Homeowner"
          ? "Customer supplied"
          : materialsResponsibility === "Split"
          ? "Shared responsibility"
          : "",
      quantitySignals,
      scopeSummary,
      hasAny:
        !!projectType ||
        !!projectSubtype ||
        !!safeStr(selectedTemplateMeta?.name) ||
        !!materialsResponsibility ||
        quantitySignals.length > 0 ||
        !!scopeSummary,
    };
  }, [agreementMeta, materialsWho, measurementNotes, selectedTemplateMeta]);
  const estimateContextSignature = useMemo(
    () =>
      JSON.stringify({
        agreementId,
        projectType: agreementMeta?.project_type || "",
        projectSubtype: agreementMeta?.project_subtype || "",
        templateId: agreementMeta?.selected_template?.id || agreementMeta?.selected_template_id || null,
        regionState: agreementMeta?.project_address_state || "",
        regionCity: agreementMeta?.project_address_city || "",
        answers: agreementMeta?.ai_scope?.answers || {},
        milestones: (Array.isArray(milestones) ? milestones : []).map((row) => ({
          id: row?.id ?? null,
          order: row?.order ?? null,
          title: safeStr(row?.title),
          amount: row?.amount ?? "",
        })),
      }),
    [agreementId, agreementMeta, milestones]
  );

  useEffect(() => {
    if (!saveTemplateOpen) return;

    const titleGuess =
      safeStr(agreementMeta?.project?.title) ||
      safeStr(agreementMeta?.project_title) ||
      safeStr(agreementMeta?.title) ||
      "";

    setSaveTemplateName((prev) => prev || (titleGuess ? `${titleGuess} Template` : ""));
    setSaveTemplateDescription((prev) => prev || "");
  }, [saveTemplateOpen, agreementMeta]);

  useEffect(() => {
    if (!assistantEstimatePreview || !Object.keys(assistantEstimatePreview).length) return;
    if (estimateAutoLoadSignatureRef.current === `assistant:${assistantEstimatePreviewSignature}`) return;
    estimateAutoLoadSignatureRef.current = `assistant:${assistantEstimatePreviewSignature}`;
    setEstimatePreview(assistantEstimatePreview);
    setEstimateBanner("Estimate updated based on your project details. Review before applying suggestions.");
  }, [assistantEstimatePreview, assistantEstimatePreviewSignature]);

  useEffect(() => {
    if (!agreementId) return;
    if (!agreementMeta) return;
    if (!effectiveMilestones.length) return;
    if (estimateAutoLoadSignatureRef.current === estimateContextSignature) return;

    estimateAutoLoadSignatureRef.current = estimateContextSignature;
    handleRefreshProjectEstimate({ successMessage: "" }).catch((err) => {
      console.warn("initialEstimatePreview failed:", err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agreementId, agreementMeta, effectiveMilestones.length, estimateContextSignature]);

  function buildStep2Answers() {
    const answers = {};

    if (permitNotes && String(permitNotes).trim()) {
      const v = String(permitNotes).trim();
      answers.permits_responsibility = v;
    }

    if (materialsWho && String(materialsWho).trim()) {
      const v = normalizeMaterialsResponsibilityValue(materialsWho);
      answers.materials_responsibility = v;
    }

    answers.measurements_provided = needsMeasurements ? "Yes" : "No";

    if (measurementNotes && String(measurementNotes).trim()) {
      const v = String(measurementNotes).trim();
      answers.measurement_notes = v;
      answers.measurements_notes = v;
    }

    if (allowanceNotes && String(allowanceNotes).trim()) {
      const v = String(allowanceNotes).trim();
      answers.allowances_selections = v;
      answers.allowance_notes = v;
    }

    return answers;
  }

  async function persistAnswersToAgreement(extraAnswers = null, options = null) {
    if (!agreementId) return;

    const includeStep2Answers = options?.includeStep2Answers !== false;
    const step2Answers = includeStep2Answers ? buildStep2Answers() : {};
    const mergedLocal = { ...(step2Answers || {}), ...(extraAnswers || {}) };
    if (!mergedLocal || Object.keys(mergedLocal).length === 0) return;

    setSavingAiScope(true);
    try {
      const current = await api.get(`/projects/agreements/${agreementId}/`);
      const data = current?.data || {};
      const ai_scope = data.ai_scope || {};
      const previousAnswers = ai_scope.answers || {};
      const mergedAnswers = { ...(ai_scope.answers || {}), ...mergedLocal };

      const patchPayload = { ai_scope: { ...ai_scope, answers: mergedAnswers } };

      if (Object.prototype.hasOwnProperty.call(data, "scope_clarifications")) {
        const sc = data.scope_clarifications || {};
        patchPayload.scope_clarifications = { ...(sc || {}), ...mergedAnswers };
      }

      await api.patch(`/projects/agreements/${agreementId}/`, patchPayload);
      if (pricingImpactAnswersChanged(previousAnswers, mergedAnswers)) {
        setPricingEstimateStale(true);
      }
      setAgreementMeta((prev) => {
        const next = { ...(prev || data || {}) };
        next.ai_scope = {
          ...(next.ai_scope || {}),
          answers: mergedAnswers,
        };
        return next;
      });
    } catch (err) {
      console.error("Step2Milestones: failed to persist answers", err);
    } finally {
      setSavingAiScope(false);
    }
  }

  useEffect(() => {
    if (!agreementId) return;
    if (!didInitFromServerRef.current) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      persistAnswersToAgreement();
    }, 650);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agreementId, materialsWho, needsMeasurements, measurementNotes, allowanceNotes, permitNotes]);

  const {
    aiLoading,
    aiApplying,
    pricingRefreshing,
    estimateRefreshing,
    aiError,
    aiPreview,
    setAiPreview,
    runAiSuggest,
    applyAiMilestones,
    refreshPricingEstimate,
    estimateProject,
  } = useAgreementMilestoneAI({
    agreementId,
    locked: milestonesLocked || templateApplied,
    refreshAgreement: refreshAgreementMeta,
    refreshMilestones: refreshMilestonesSafe,
    onMilestonesReplaced: null,
  });
  const combinedClarificationQuestions = useMemo(
    () =>
      mergeQuestionsByCanonicalKey(
        Array.isArray(aiPreview?.questions) ? aiPreview.questions : [],
        assistantClarificationRows
      ),
    [aiPreview?.questions, assistantClarificationRows]
  );

  const total = effectiveMilestones.reduce((s, m) => s + money(m.amount), 0);
  const isAiPlanningMode =
    Boolean(aiChangeSummary) ||
    Boolean(assistantGuidedFlow?.guided_question) ||
    assistantProactiveRecommendations.length > 0 ||
    assistantPredictiveInsights.length > 0 ||
    assistantSuggestionRows.length > 0 ||
    showAssistantMilestoneSuggestions ||
    hasStagedSuggestedAmountChanges ||
    hasStagedSuggestedTimelineChanges ||
    Boolean(estimatePreview);
  const hasPlanningDetails =
    Boolean(assistantGuidedFlow?.guided_question) ||
    assistantProactiveRecommendations.length > 0 ||
    assistantPredictiveInsights.length > 0;

  const minStart = useMemo(() => {
    const s = effectiveMilestones
      .map((m) => toDateOnly(m.start_date || m.start))
      .filter(Boolean)
      .sort()[0];
    return s || "";
  }, [effectiveMilestones]);

  const maxEnd = useMemo(() => {
    const e = effectiveMilestones
      .map((m) => toDateOnly(m.completion_date || m.end_date || m.end))
      .filter(Boolean)
      .sort()
      .slice(-1)[0];
    return e || "";
  }, [effectiveMilestones]);

  const clarificationsAgreementMeta = useMemo(() => {
    const base = agreementMeta || {};
    const aiScope = base?.ai_scope || {};
    const previewQuestions = Array.isArray(aiPreview?.questions) ? aiPreview.questions : [];

    if (!previewQuestions.length) return base;

    return {
      ...base,
      ai_scope: {
        ...aiScope,
        questions: mergeQuestionsByCanonicalKey(aiScope?.questions || [], previewQuestions),
      },
    };
  }, [agreementMeta, aiPreview]);

  const mergedClarificationQuestions = useMemo(() => {
    const savedQuestions = Array.isArray(agreementMeta?.ai_scope?.questions)
      ? agreementMeta.ai_scope.questions
      : [];
    const previewQuestions = Array.isArray(aiPreview?.questions) ? aiPreview.questions : [];
    return mergeQuestionsByCanonicalKey(savedQuestions, previewQuestions);
  }, [agreementMeta, aiPreview]);

  const recommendedClarificationCount = useMemo(() => {
    return mergedClarificationQuestions.filter((q) => q?.required).length;
  }, [mergedClarificationQuestions]);

  const hasClarifications = mergedClarificationQuestions.length > 0;
  const hasRecommendedClarifications = recommendedClarificationCount > 0;

  const clarButtonBadgeText = hasRecommendedClarifications
    ? "Recommended"
    : hasClarifications
    ? "Optional"
    : null;

  const clarButtonTitle = hasRecommendedClarifications
    ? `Review clarifications (${recommendedClarificationCount} recommended)`
    : hasClarifications
    ? "Review optional clarifications"
    : "Review clarifications";

  function validateExistingMilestonesAmounts() {
    for (let i = 0; i < effectiveMilestones.length; i++) {
      const m = effectiveMilestones[i];
      const title = String(m?.title || `Milestone ${i + 1}`).trim();
      if (!amountIsValidPositive(m?.amount)) {
        return `Milestone "${title}" must have an amount greater than $0.`;
      }
    }
    return "";
  }

  function validateLocalMilestoneBeforeSave(data) {
    const title = String(data?.title || "").trim();
    if (!title) return "Milestone title is required.";
    if (!amountIsValidPositive(data?.amount)) return "Milestone amount must be greater than $0.";
    return "";
  }

  async function handleRunAiSuggest() {
    if (!agreementId) return;
    if (milestonesLocked) {
      lockToast();
      return;
    }
    if (templateApplied) {
      toast("A template is already applied. Use the template-driven milestone structure instead of regenerating milestones with AI here.", {
        icon: "🧩",
      });
      return;
    }

    const extraNotes = [
      `Materials purchasing responsibility: ${materialsWho}.`,
      needsMeasurements
        ? `Measurements needed: YES. Notes: ${measurementNotes || "(none provided)"}.`
        : "Measurements needed: NO.",
      allowanceNotes ? `Allowances / selections: ${allowanceNotes}` : "",
      permitNotes ? `Permits / inspections: ${permitNotes}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await runAiSuggest({
      notes: `${mLocal.description || ""}\n\n${extraNotes}`.trim(),
    });
  }

  async function handleApplyAiMilestonesBulk(mode) {
    if (!agreementId) return;
    if (!aiPreview?.milestones?.length) return;

    if (milestonesLocked) {
      lockToast();
      return;
    }
    if (templateApplied) {
      toast("This agreement is template-driven. AI bulk milestone replacement/appending is disabled here to avoid overwriting the template structure.", {
        icon: "🧩",
      });
      return;
    }

    const st = String(spreadTotal || "").trim();
    if (spreadEnabled && st !== "" && !amountIsValidPositive(st)) {
      toast.error("Auto-spread total must be greater than $0.");
      return;
    }

    const result = await applyAiMilestones({
      mode,
      spreadEnabled,
      spreadTotal,
      autoSchedule,
    });

    toast.success(`Created ${result?.count || 0} milestones via AI.`);
    await refreshAfterAiBulkSuccess();
  }

  async function handleRefreshPricingEstimate() {
    if (!agreementId || !effectiveMilestones.length) return;

    const result = await refreshPricingEstimate();
    pricingFreshSignatureRef.current = milestonePricingSignature;
    setPricingEstimateStale(false);
    try {
      await refreshMilestonesSafe();
    } catch (err) {
      console.warn("refreshAfterPricingEstimate failed:", err);
      toast("Pricing guidance was refreshed, but the latest milestone data could not be reloaded.");
    }
    toast.success(
      `Pricing estimate guidance refreshed${result?.raw?.persisted_count ? ` for ${result.raw.persisted_count} milestone(s)` : ""}.`
    );
  }

  async function handleRefreshProjectEstimate({ successMessage = "Estimate refreshed from current project details." } = {}) {
    if (!agreementId) return null;
    const result = await estimateProject();
    setEstimatePreview(result?.estimate || null);
    if (successMessage) {
      setEstimateBanner(successMessage);
      toast.success(successMessage);
    }
    return result;
  }

  function applyEstimateSuggestedAmounts() {
    const suggestions = Array.isArray(estimatePreview?.milestone_suggestions)
      ? estimatePreview.milestone_suggestions
      : [];
    if (!suggestions.length) {
      toast("No milestone amount suggestions are available yet.");
      return;
    }

    const suggestionById = new Map(
      suggestions.filter((row) => row?.milestone_id != null).map((row) => [row.milestone_id, row])
    );
    let appliedCount = 0;
    const stagedIds = [];
    const nextRows = effectiveMilestones.map((row, idx) => {
      const match =
        suggestionById.get(row?.id) ||
        suggestions.find((item) => Number(item?.suggested_order || 0) === idx + 1);
      const suggestedAmount = parseAmountStrict(match?.suggested_amount);
      if (!Number.isFinite(suggestedAmount) || suggestedAmount <= 0) {
        return { ...row };
      }
      appliedCount += 1;
      if (estimateAmountDiffers(row?.amount, suggestedAmount)) {
        stagedIds.push(row?.id);
      }
      return {
        ...row,
        order: row?.order != null ? row.order : idx + 1,
        amount: roundSuggestedAmount(suggestedAmount) ?? suggestedAmount,
      };
    });

    if (!appliedCount) {
      toast("No milestone amount suggestions were available to apply.");
      return;
    }

    setFallbackMilestones(sortFallbackMilestones(nextRows));
    setStagedSuggestedMilestoneIds((prev) => [...new Set([...(prev || []), ...stagedIds.filter(Boolean)])]);
    setEstimateBanner("Estimate suggestions are staged locally. Review and save when ready.");
    markAiUpdated(stagedIds.filter(Boolean).map((id) => `milestone:${id}`));
    {
      const feedback = "Updated milestone pricing based on project context.";
      setAiChangeSummary(feedback);
      onAiUpdateFeedback(feedback);
    }
    toast.success(
      `Applied estimate amounts to ${appliedCount} milestone${appliedCount === 1 ? "" : "s"} for review.`
    );
  }

  function applyEstimateSuggestedTimeline() {
    const suggestions = Array.isArray(estimatePreview?.milestone_suggestions)
      ? estimatePreview.milestone_suggestions
      : [];
    if (!suggestions.length) {
      toast("No timeline suggestions are available yet.");
      return;
    }

    const baseStart =
      toDateOnly(agreementMeta?.start) ||
      toDateOnly(effectiveMilestones[0]?.start_date || effectiveMilestones[0]?.start);
    if (!baseStart) {
      toast("Add an agreement start date or a milestone start date before applying timeline suggestions.");
      return;
    }

    const suggestionById = new Map(
      suggestions.filter((row) => row?.milestone_id != null).map((row) => [row.milestone_id, row])
    );
    const stagedIds = [];
    let cursor = baseStart;
    const nextRows = effectiveMilestones.map((row, idx) => {
      const match =
        suggestionById.get(row?.id) ||
        suggestions.find((item) => Number(item?.suggested_order || 0) === idx + 1);
      const durationDays = Math.max(Number(match?.suggested_duration_days || row?.recommended_duration_days || 0), 1);
      const startDate = cursor;
      const completionDate = addDays(startDate, durationDays - 1);
      cursor = addDays(completionDate, 1);
      if (timelineDiffers(row, startDate, completionDate)) {
        stagedIds.push(row?.id);
      }
      return {
        ...row,
        order: row?.order != null ? row.order : idx + 1,
        start_date: startDate,
        completion_date: completionDate,
        recommended_duration_days: durationDays,
      };
    });

    setFallbackMilestones(sortFallbackMilestones(nextRows));
    setStagedSuggestedTimelineIds((prev) => [...new Set([...(prev || []), ...stagedIds.filter(Boolean)])]);
    setEstimateBanner("Estimate timeline suggestions are staged locally. Review and save when ready.");
    markAiUpdated(stagedIds.filter(Boolean).map((id) => `milestone:${id}`));
    {
      const changedCount = stagedIds.filter(Boolean).length || nextRows.length;
      const feedback = `Adjusted timeline suggestions for ${changedCount} milestone${
        changedCount === 1 ? "" : "s"
      }.`;
      setAiChangeSummary(feedback);
      onAiUpdateFeedback(feedback);
    }
    toast.success("Applied suggested milestone timeline for review.");
  }

  function applySuggestedPricesToAll() {
    if (!effectiveMilestones.length) {
      toast("No milestones are available to update.");
      return;
    }

    const savedById = new Map(
      (Array.isArray(milestones) ? milestones : [])
        .filter((row) => row?.id != null)
        .map((row) => [row.id, row])
    );
    let appliedCount = 0;
    const stagedIds = [];
    const nextRows = effectiveMilestones.map((row, idx) => {
      const suggestedAmount = deriveSuggestedPriceAmount(row);
      if (!Number.isFinite(suggestedAmount) || suggestedAmount <= 0) {
        return { ...row };
      }
      appliedCount += 1;
      const savedRow = savedById.get(row?.id);
      if (savedRow && amountsDifferMeaningfully(savedRow?.amount, suggestedAmount)) {
        stagedIds.push(row.id);
      }
      return {
        ...row,
        order: row?.order != null ? row.order : idx + 1,
        amount: suggestedAmount,
      };
    });

    if (!appliedCount) {
      toast("No milestones have valid suggested pricing guidance yet.");
      return;
    }

    setFallbackMilestones(sortFallbackMilestones(nextRows));
    setStagedSuggestedMilestoneIds(stagedIds);
    markAiUpdated(stagedIds.filter(Boolean).map((id) => `milestone:${id}`));
    {
      const feedback = `Updated suggested pricing for ${appliedCount} milestone${
        appliedCount === 1 ? "" : "s"
      }.`;
      setAiChangeSummary(feedback);
      onAiUpdateFeedback(feedback);
    }

    if (editOpen && editForm?.id) {
      const editedRow = nextRows.find((row) => row?.id === editForm.id);
      if (editedRow) {
        setEditForm((state) => ({
          ...state,
          amount: String(editedRow.amount),
        }));
      }
    }

    toast.success(
      `Suggested prices applied to ${appliedCount} milestone${appliedCount === 1 ? "" : "s"}. Review before saving.`
    );
  }

  function handleReviewSuggestedPricing() {
    const firstChanged = pricingReviewState.changed[0];
    if (!firstChanged?.milestone) {
      toast("No suggested pricing changes are available to review.");
      return;
    }
    handleEditClick(firstChanged.milestone, firstChanged.idx);
  }

  async function persistStagedMilestoneChanges() {
    if (!Array.isArray(fallbackMilestones) || !fallbackMilestones.length) return 0;

    const baseById = new Map(
      (Array.isArray(milestones) ? milestones : [])
        .filter((row) => row?.id != null)
        .map((row) => [row.id, row])
    );

    const stagedRows = fallbackMilestones.filter((row) => {
      if (!row?.id) return false;
      const base = baseById.get(row.id);
      if (!base) return false;
      return (
        amountsDifferMeaningfully(base?.amount, parseAmountStrict(row?.amount)) ||
        timelineDiffers(
          base,
          row?.start_date || row?.start,
          row?.completion_date || row?.end_date || row?.end
        )
      );
    });

    if (!stagedRows.length) return 0;

    for (const row of stagedRows) {
      await updateMilestone({
        id: row.id,
        title: safeStr(row.title),
        description: safeStr(row.description),
        start_date: row.start_date || null,
        completion_date: row.completion_date || null,
        amount: Number(row.amount),
      });
    }

    try {
      await refreshMilestonesSafe();
    } catch (err) {
      console.warn("persistStagedMilestoneAmounts refresh failed:", err);
      toast("Milestone amounts were saved, but the latest agreement data could not be fully reloaded.");
    }

    return stagedRows.length;
  }

  function isOverlapError(err) {
    const msg = err?.response?.data?.non_field_errors?.[0];
    return !!(msg && String(msg).toLowerCase().includes("overlap"));
  }

  async function handleManualSave() {
    if (milestonesLocked) {
      lockToast();
      return;
    }

    const vErr = validateLocalMilestoneBeforeSave(mLocal);
    if (vErr) {
      toast.error(vErr);
      return;
    }

    try {
      const result = await saveMilestone(mLocal);
      markMilestonesUserModified();
      if (result?.refreshed === false) {
        applyLocalMilestoneFallback("create", result?.milestone);
      }
    } catch (e) {
      if (isOverlapError(e)) {
        setOverlapConfirm({ mode: "create", data: mLocal });
        return;
      }
      throw e;
    }
  }

  async function confirmOverlapAndSave() {
    if (!overlapConfirm?.data) return;

    if (milestonesLocked) {
      setOverlapConfirm(null);
      lockToast();
      return;
    }

    const mode = overlapConfirm?.mode || "create";

    if (mode === "create") {
      const vErr = validateLocalMilestoneBeforeSave(overlapConfirm.data);
      if (vErr) {
        toast.error(vErr);
        setOverlapConfirm(null);
        return;
      }

      try {
        const result = await saveMilestone({ ...overlapConfirm.data, allow_overlap: true });
        markMilestonesUserModified();
        if (result?.refreshed === false) {
          applyLocalMilestoneFallback("create", result?.milestone);
        }
      } finally {
        setOverlapConfirm(null);
      }
      return;
    }

    if (mode === "edit") {
      const d = overlapConfirm.data || {};
      const title = safeStr(d.title);
      if (!title) {
        toast.error("Title is required.");
        setOverlapConfirm(null);
        return;
      }
      if (!amountIsValidPositive(d.amount)) {
        toast.error("Amount must be greater than $0.");
        setOverlapConfirm(null);
        return;
      }

      setEditBusy(true);
      try {
        const result = await updateMilestone({
          id: d.id,
          title,
          description: safeStr(d.description),
          start_date: d.start_date || null,
          completion_date: d.completion_date || null,
          amount: Number(d.amount),
          allow_overlap: true,
        });
        markMilestonesUserModified();
        if (result?.refreshed === false) {
          applyLocalMilestoneFallback("update", result?.milestone);
        }

        toast.success("Milestone updated (overlap allowed).");
        setOverlapConfirm(null);
        setEditOpen(false);
        setEditMilestone(null);
        setEditAiPreview("");
      } catch (e) {
        toast.error(e?.response?.data?.detail || e?.message || "Update failed.");
      } finally {
        setEditBusy(false);
      }
    }
  }

  function cancelOverlap() {
    setOverlapConfirm(null);
  }

  async function handleDelete(id) {
    if (milestonesLocked) {
      lockToast();
      return;
    }
    try {
      const result = await deleteMilestone(id);
      markMilestonesUserModified();
      if (result?.refreshed === false) {
        applyLocalMilestoneFallback("delete", result?.milestoneId ?? id);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Delete failed.");
    }
  }

  function handleEditClick(m, idx, options = {}) {
    if (milestonesLocked) {
      lockToast();
      return;
    }
    if (!m?.id) {
      toast.error("This milestone is missing an id.");
      return;
    }

    const orderNum = m?.order != null ? Number(m.order) : idx != null ? idx + 1 : null;
    const suggestedAmount = deriveSuggestedPriceAmount(m);
    const useSuggestedPrice = !!options?.useSuggestedPrice && Number.isFinite(suggestedAmount) && suggestedAmount > 0;

    setEditMilestone(m);
    setEditForm({
      id: m.id,
      order: Number.isFinite(orderNum) ? orderNum : null,
      title: safeStr(m.title),
      description: safeStr(m.description),
      start_date: toDateOnly(m.start_date || m.start),
      completion_date: toDateOnly(m.completion_date || m.end_date || m.end),
      amount: useSuggestedPrice
        ? formatSuggestedAmountInput(suggestedAmount)
        : m.amount != null
        ? String(m.amount)
        : "",
      normalized_milestone_type: safeStr(m.normalized_milestone_type),
      suggested_amount_low: m.suggested_amount_low ?? "",
      suggested_amount_high: m.suggested_amount_high ?? "",
      labor_estimate_low: m.labor_estimate_low ?? "",
      labor_estimate_high: m.labor_estimate_high ?? "",
      materials_estimate_low: m.materials_estimate_low ?? "",
      materials_estimate_high: m.materials_estimate_high ?? "",
      pricing_confidence: safeStr(m.pricing_confidence),
      pricing_mode: safeStr(m.pricing_mode),
      pricing_source_note: safeStr(m.pricing_source_note),
      recommended_duration_days: m.recommended_duration_days ?? "",
      materials_hint: safeStr(m.materials_hint),
    });
    setEditAiErr("");
    setEditAiPreview("");
    setEditOpen(true);
    if (useSuggestedPrice) {
      toast.success("Suggested price loaded into the editable amount field.");
    }
  }

  function applySuggestedPriceToEditForm() {
    const suggestedAmount = deriveSuggestedPriceAmount(editForm);
    if (!Number.isFinite(suggestedAmount) || suggestedAmount <= 0) return;
    setEditForm((s) => ({
      ...s,
      amount: formatSuggestedAmountInput(suggestedAmount),
    }));
    toast.success("Suggested price loaded into the editable amount field.");
  }

  async function saveEdit() {
    if (milestonesLocked) {
      lockToast();
      return;
    }
    if (!editForm?.id) return;

    const title = safeStr(editForm.title);
    if (!title) {
      toast.error("Title is required.");
      return;
    }
    if (!amountIsValidPositive(editForm.amount)) {
      toast.error("Amount must be greater than $0.");
      return;
    }

    setEditBusy(true);
    try {
      const result = await updateMilestone({
        id: editForm.id,
        title,
        description: safeStr(editForm.description),
        start_date: editForm.start_date || null,
        completion_date: editForm.completion_date || null,
        amount: Number(editForm.amount),
      });
      markMilestonesUserModified();
      if (result?.refreshed === false) {
        applyLocalMilestoneFallback("update", result?.milestone);
      }

      toast.success("Milestone updated.");
      setEditOpen(false);
      setEditMilestone(null);
    } catch (e) {
      if (isOverlapError(e)) {
        setOverlapConfirm({
          mode: "edit",
          data: {
            id: editForm.id,
            title: safeStr(editForm.title),
            description: safeStr(editForm.description),
            start_date: editForm.start_date || null,
            completion_date: editForm.completion_date || null,
            amount: editForm.amount,
          },
        });
        return;
      }
      toast.error(e?.response?.data?.detail || e?.message || "Update failed.");
    } finally {
      setEditBusy(false);
    }
  }

  async function runEditAiImprove() {
    if (!agreementId) {
      toast.error("Save draft first to use AI.");
      return;
    }
    if (milestonesLocked) {
      lockToast();
      return;
    }

    setEditAiErr("");
    setEditAiPreview("");
    setEditAiBusy(true);

    try {
      const payload = {
        mode: "improve",
        agreement_id: agreementId,
        project_title: "",
        project_type: "",
        project_subtype: "",
        current_description: editForm.description || "",
      };

      const res = await api.post(`/projects/agreements/ai/description/`, payload);
      const text = res?.data?.description || "";
      if (!safeStr(text)) throw new Error("AI returned an empty description.");
      setEditAiPreview(text);
    } catch (e) {
      setEditAiErr(e?.response?.data?.detail || e?.message || "AI request failed.");
    } finally {
      setEditAiBusy(false);
    }
  }

  function applyEditAi(action) {
    const suggestion = safeStr(editAiPreview);
    if (!suggestion) return;

    const cur = safeStr(editForm.description);
    const next = action === "append" && cur ? `${cur}\n\n${suggestion}` : suggestion;

    setEditForm((s) => ({ ...s, description: next }));
    setEditAiPreview("");
  }

  async function handleOpenSaveTemplate() {
    if (!agreementId) {
      toast.error("Save the agreement first.");
      return;
    }

    if (!effectiveMilestones.length) {
      toast.error("Add at least one milestone before saving a template.");
      return;
    }

    const amtErr = validateExistingMilestonesAmounts();
    if (amtErr) {
      toast.error(amtErr);
      return;
    }

    setSaveTemplateOpen(true);
  }

  async function handleSaveAsTemplate(payload = {}) {
    if (!agreementId) return;

    const name = safeStr(payload?.name || saveTemplateName);
    if (!name) {
      toast.error("Template name is required.");
      return;
    }

    setSaveTemplateBusy(true);
    try {
      const requestPayload = {
        name,
        description: safeStr(payload?.description || saveTemplateDescription),
        is_active: payload?.is_active !== false,
      };

      const res = await api.post(
        `/projects/agreements/${agreementId}/save-as-template/`,
        requestPayload
      );
      const tplName = res?.data?.template?.name || name;

      toast.success(`Template saved: ${tplName}`);
      setSaveTemplateOpen(false);
      setSaveTemplateName("");
      setSaveTemplateDescription("");
    } catch (e) {
      toast.error(
        e?.response?.data?.detail ||
          e?.response?.data?.error ||
          "Could not save template."
      );
    } finally {
      setSaveTemplateBusy(false);
    }
  }

  async function handleNext() {
    if (!effectiveMilestones.length) {
      toast.error("Add at least one milestone before continuing.");
      return;
    }

    const amtErr = validateExistingMilestonesAmounts();
    if (amtErr) {
      toast.error(amtErr);
      return;
    }

    const persistedCount = await persistStagedMilestoneChanges();
    if (persistedCount > 0) {
      toast.success(
        `Saved staged estimate changes for ${persistedCount} milestone${persistedCount === 1 ? "" : "s"}.`
      );
    }

    await persistAnswersToAgreement();

    if (!clarReviewed) {
      pendingNextRef.current = true;
      setClarOpen(true);

      if (hasRecommendedClarifications) {
        toast(`Quick review: ${recommendedClarificationCount} recommended clarification${recommendedClarificationCount === 1 ? "" : "s"}.`, {
          icon: "📝",
        });
      } else {
        toast("Quick review: clarifications available before continuing.", { icon: "📝" });
      }
      return;
    }

    if (typeof onNext === "function") onNext();
  }

  function handleBackClick() {
    if (hasUnsavedStep2Changes) {
      const shouldLeave = window.confirm(step2UnsavedMessage);
      if (!shouldLeave) return;
    }
    if (typeof onBack === "function") onBack();
  }

  useEffect(() => {
    if (!agreementId) return;
    if (autoDraftAttemptedRef.current) return;
    if (autoDraftBusy) return;
    if (milestonesLocked || templateApplied) return;
    if (!agreementMeta) return;
    if (effectiveMilestones.length > 0) return;
    if (milestoneUserModifiedRef.current || isCreateDraftDirty) return;

    const projectSubtype = safeStr(agreementMeta?.project_subtype);
    const projectType = safeStr(agreementMeta?.project_type);
    const description = safeStr(agreementMeta?.description || agreementMeta?.project_description);
    if (!projectSubtype && !projectType && !description) return;

    autoDraftAttemptedRef.current = true;

    (async () => {
      setAutoDraftBusy(true);
      try {
        const draftRows = buildStep2AutoMilestoneDraft({
          projectSubtype,
          projectType,
          description,
          totalBudget:
            agreementMeta?.display_total ??
            agreementMeta?.total ??
            agreementMeta?.amount ??
            agreementMeta?.total_cost ??
            0,
        });
        const createdIds = [];
        for (const row of draftRows) {
          const result = await saveMilestone({
            title: row.title,
            description: row.description,
            amount: row.amount,
            start_date: "",
            completion_date: "",
          });
          const createdId = result?.milestone?.id ?? null;
          if (createdId != null) createdIds.push(createdId);
          if (result?.refreshed === false) {
            applyLocalMilestoneFallback("create", result?.milestone);
          }
        }
        if (createdIds.length) {
          setAiSuggestedMilestoneIds(createdIds);
          markAiUpdated(createdIds.map((id) => `milestone:${id}`));
        }
        const feedback = "AI drafted your milestones — review and adjust as needed.";
        setAutoDraftBanner(feedback);
        setAiChangeSummary(feedback);
        onAiUpdateFeedback(feedback);
        await refreshMilestonesSafe();
      } catch (err) {
        console.warn("Step2 auto milestone draft failed:", err);
      } finally {
        setAutoDraftBusy(false);
      }
    })();
  }, [
    agreementId,
    agreementMeta,
    autoDraftBusy,
    effectiveMilestones.length,
    isCreateDraftDirty,
    markAiUpdated,
    milestonesLocked,
    onAiUpdateFeedback,
    saveMilestone,
    templateApplied,
  ]);

  const assistantContext = useMemo(
    () => ({
      current_route: agreementId
        ? `/app/agreements/${agreementId}/wizard?step=2`
        : "/app/agreements/new/wizard?step=2",
      agreement_id: agreementId || null,
      agreement_summary: {
        title:
          agreementMeta?.project_title ||
          agreementMeta?.title ||
          "",
        project_title:
          agreementMeta?.project_title ||
          agreementMeta?.title ||
          "",
        project_summary:
          agreementMeta?.description ||
          agreementMeta?.project_description ||
          "",
        description:
          agreementMeta?.description ||
          agreementMeta?.project_description ||
          "",
        customer_name:
          agreementMeta?.homeowner_name ||
          agreementMeta?.customer_name ||
          "",
        milestone_count: effectiveMilestones.length,
        pending_clarifications: Array.isArray(mergedClarificationQuestions)
          ? mergedClarificationQuestions
              .map((item) => item?.label || item?.question || item?.key || "")
              .filter(Boolean)
          : [],
        status: agreementMeta?.status || "draft",
      },
      template_id:
        agreementMeta?.selected_template?.id ||
        agreementMeta?.selected_template_id ||
        null,
      template_summary: {
        name:
          agreementMeta?.selected_template?.name ||
          agreementMeta?.selected_template_name_snapshot ||
          "",
      },
      milestone_summary: {
        count: effectiveMilestones.length,
        suggested_titles: effectiveMilestones.map((item) => item?.title).filter(Boolean),
      },
      ai_panel: getAiPanelConfigForStep(2, {
        agreement: agreementMeta,
        dLocal: {
          project_title: agreementMeta?.project_title || agreementMeta?.title || "",
          description: agreementMeta?.description || agreementMeta?.project_description || "",
          payment_mode: agreementMeta?.payment_mode || "",
        },
        milestones: effectiveMilestones,
        aiUpdateFeedback: aiChangeSummary,
        template_id:
          agreementMeta?.selected_template?.id ||
          agreementMeta?.selected_template_id ||
          null,
      }),
    }),
    [agreementId, agreementMeta, effectiveMilestones, mergedClarificationQuestions, aiChangeSummary]
  );

  async function handleAssistantAction(plan) {
    const actionKey = safeStr(plan?.assistant_action_key || plan?.action_key);
    if (actionKey === "save_as_template") {
      await handleOpenSaveTemplate();
      return true;
    }
    if (plan?.next_action?.action_key === "review_clarifications") {
      setClarOpen(true);
      return true;
    }
    return false;
  }

  async function handleApplyAssistantSuggestedMilestones() {
    if (!agreementId || !assistantSuggestionRows.length) return;
    if (milestonesLocked) {
      lockToast();
      return;
    }

    try {
      setAssistantApplyingMilestones(true);
      const createdIds = [];
      for (const row of assistantSuggestionRows) {
        const result = await saveMilestone({
          title: row.title || "",
          description: row.description || "",
          amount: row.amount || "",
          start_date: row.start_date || "",
          completion_date: row.completion_date || "",
        });
        if (result?.milestone?.id != null) {
          createdIds.push(`milestone:${result.milestone.id}`);
        }
      }
      setDismissedAssistantSuggestionSignature(assistantSuggestionSignature);
      if (createdIds.length) {
        markAiUpdated(createdIds);
      }
      {
        const feedback = `Added ${assistantSuggestionRows.length} milestone suggestion${
          assistantSuggestionRows.length === 1 ? "" : "s"
        } from AI guidance.`;
        setAiChangeSummary(feedback);
        onAiUpdateFeedback(feedback);
      }
      toast.success(
        `Added ${assistantSuggestionRows.length} suggested milestone${
          assistantSuggestionRows.length === 1 ? "" : "s"
        }.`
      );
      await refreshMilestonesSafe();
    } catch (err) {
      toast.error(
        err?.response?.data?.detail || err?.message || "Could not add assistant milestones."
      );
    } finally {
      setAssistantApplyingMilestones(false);
    }
  }

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {milestonesLocked ? (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold">Locked</div>
          <div className="mt-1 text-xs text-amber-900/90">
            Milestones are read-only. {milestonesLockReason || "Create an amendment to change milestones."}
          </div>
        </div>
      ) : null}

      {projectContextSummary.hasAny ? (
        <details className="mb-3 rounded-xl border border-slate-200 bg-slate-50/80 shadow-sm">
          <summary className="cursor-pointer list-none px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Project context</div>
                <div className="mt-1 text-xs text-slate-600">
                  Grounding details that shape milestone planning and pricing.
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isAiPlanningMode ? (
                  <span className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                    AI-guided
                  </span>
                ) : null}
                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  View details
                </span>
              </div>
            </div>
          </summary>
          <div className="border-t border-slate-200 px-4 py-4 text-sm text-slate-800">
            <div className="flex flex-wrap gap-2 text-xs">
              {projectContextSummary.projectType ? (
                <span className="rounded-full bg-white px-2 py-1 font-medium text-slate-700">
                  Type: {projectContextSummary.projectType}
                </span>
              ) : null}
              {projectContextSummary.projectSubtype ? (
                <span className="rounded-full bg-white px-2 py-1 font-medium text-slate-700">
                  Subtype: {projectContextSummary.projectSubtype}
                </span>
              ) : null}
              {projectContextSummary.templateName ? (
                <span className="rounded-full bg-indigo-50 px-2 py-1 font-medium text-indigo-700">
                  Using {projectContextSummary.templateName}
                </span>
              ) : null}
              {projectContextSummary.materialsResponsibility ? (
                <span className="rounded-full bg-white px-2 py-1 font-medium text-slate-700">
                  Materials: {projectContextSummary.materialsResponsibility}
                </span>
              ) : null}
              {projectContextSummary.quantitySignals.map((signal) => (
                <span
                  key={`${signal.label}:${signal.value}`}
                  className="rounded-full bg-white px-2 py-1 font-medium text-slate-700"
                >
                  {signal.label}: {signal.value}
                </span>
              ))}
            </div>
            {projectContextSummary.scopeSummary ? (
              <div className="mt-2 text-xs text-slate-600">
                Scope: {projectContextSummary.scopeSummary}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      {recurringSummary ? (
        <div
          data-testid="step2-recurring-summary"
          className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
              Recurring Service
            </span>
            <span className="text-sm font-semibold text-slate-900">
              {recurringSummary.label || recurringSummary.cadence}
            </span>
          </div>
          <div className="mt-1 text-xs text-emerald-900/90">
            Status: {recurringSummary.status}
            {recurringSummary.nextOccurrence
              ? ` • Next occurrence: ${recurringSummary.nextOccurrence}`
              : ""}
          </div>
          {recurringSummary.previewOccurrences.length ? (
            <div data-testid="step2-recurring-upcoming" className="mt-3 space-y-2">
              {recurringSummary.previewOccurrences.slice(0, 3).map((row) => (
                <div
                  key={`recurring-preview-${row.rule_milestone_id}-${row.sequence_number}-${row.scheduled_service_date}`}
                  className="rounded border border-emerald-100 bg-white px-3 py-2 text-xs text-slate-700"
                >
                  <div className="font-semibold text-slate-900">
                    {row.title} • Visit {row.sequence_number}
                  </div>
                  <div className="mt-1">
                    Service date: {row.scheduled_service_date || "Pending"}
                    {row.amount ? ` • ${formatCurrency(row.amount)}` : ""}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <StartWithAIEntry
        className=""
        testId="milestones-ai-entry"
        title={isAiPlanningMode ? "Refine milestone plan with AI" : "Plan milestones with AI"}
        description="Use current pricing, template, and clarification context to keep milestone work moving."
        context={assistantContext}
        onAction={handleAssistantAction}
      />

      {aiChangeSummary ? (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold">AI updated milestone work</div>
          <div className="mt-1 text-xs text-amber-800">{aiChangeSummary}</div>
        </div>
      ) : null}

      {autoDraftBanner ? (
        <div
          data-testid="step2-ai-autodraft-banner"
          className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900"
        >
          <div className="font-semibold">AI drafted your milestones</div>
          <div className="mt-1 text-xs text-sky-800">Review and adjust as needed.</div>
        </div>
      ) : null}

      {hasPlanningDetails ? (
        <details className="mb-3 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <summary className="cursor-pointer list-none px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Planning details</div>
                <div className="mt-1 text-xs text-slate-600">
                  Clarifications, AI reasoning, and secondary planning guidance.
                </div>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                Expand
              </span>
            </div>
          </summary>
          <div className="space-y-3 border-t border-slate-200 px-4 py-4">
            {assistantGuidedFlow?.guided_question ? (
              <div
                data-testid="assistant-guided-step2"
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3"
              >
                <div className="text-sm font-semibold text-indigo-900">Guided next step</div>
                <div className="mt-1 text-xs text-indigo-800">{assistantGuidedFlow.guided_question}</div>
                {assistantGuidedFlow.why_this_matters ? (
                  <div className="mt-1 text-xs text-indigo-800/90">
                    {assistantGuidedFlow.why_this_matters}
                  </div>
                ) : null}
              </div>
            ) : null}

            {assistantProactiveRecommendations.length ? (
              <div
                data-testid="assistant-proactive-step2"
                className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
              >
                <div className="text-sm font-semibold text-amber-900">Proactive recommendations</div>
                <div className="mt-2 space-y-2">
                  {assistantProactiveRecommendations.slice(0, 2).map((item) => (
                    <div key={`${item.recommendation_type}-${item.title}`}>
                      <div className="text-sm font-medium text-amber-950">{item.title}</div>
                      <div className="text-xs text-amber-800">{item.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {assistantPredictiveInsights.length ? (
              <div
                data-testid="assistant-predictive-step2"
                className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
              >
                <div className="text-sm font-semibold text-slate-900">Predictive insight</div>
                <div className="mt-1 text-sm text-slate-800">{assistantPredictiveInsights[0]?.title}</div>
                <div className="mt-1 text-xs text-slate-600">{assistantPredictiveInsights[0]?.summary}</div>
              </div>
            ) : null}

          </div>
        </details>
      ) : null}

      {showAssistantMilestoneSuggestions ? (
        <div
          data-testid="assistant-suggested-milestones"
          className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4"
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-sm font-semibold text-emerald-900">
                Assistant Suggested Milestones
              </div>
              <div className="mt-1 text-xs text-emerald-800">
                These are suggested only. Review them before adding them to the agreement.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleApplyAssistantSuggestedMilestones}
                disabled={assistantApplyingMilestones || milestonesLocked}
                className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {assistantApplyingMilestones ? "Adding…" : "Add Suggested Milestones"}
              </button>
              <button
                type="button"
                onClick={() => setDismissedAssistantSuggestionSignature(assistantSuggestionSignature)}
                className="rounded border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
              >
                Dismiss
              </button>
            </div>
          </div>
          <ul className="mt-4 space-y-2">
            {assistantSuggestionRows.map((row, idx) => (
              <li
                key={`${row.title}-${idx}`}
                data-testid={`assistant-suggested-milestone-${idx}`}
                className="rounded border border-emerald-100 bg-white px-3 py-3 text-sm text-slate-800"
              >
                <div className="font-semibold text-slate-900">{row.title}</div>
                {safeStr(row.description) ? (
                  <div className="mt-1 text-xs text-slate-600">{row.description}</div>
                ) : null}
                {safeStr(row.amount) ? (
                  <div className="mt-1 text-xs text-emerald-800">
                    Suggested amount: {formatCurrency(Number(row.amount))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-700">
            Primary workspace
          </div>
          <h3 className="mt-1 text-xl font-semibold text-slate-950">Milestone Editor</h3>
          <div className="mt-1 text-sm text-slate-600">
            Add milestones, confirm pricing, and refine the current plan before you continue.
          </div>
        </div>
        <div className="text-sm text-gray-600">
          Schedule:{" "}
          {minStart && maxEnd ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
              {friendly(minStart)} → {friendly(maxEnd)} (est.)
            </span>
          ) : (
            <span className="text-gray-400">add dates to see range</span>
          )}
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
        <div className="mb-3">
          <h4 className="text-sm font-semibold text-slate-900">Planning controls</h4>
          <p className="mt-1 text-[12px] text-slate-600">
            Keep the focus on milestone pricing, schedule, and the edits you want to save next.
          </p>
        </div>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setClarOpen(true)}
              disabled={milestonesLocked}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
              title={clarButtonTitle}
            >
              Clarifications
              {clarButtonBadgeText ? (
                <span
                  className={`ml-2 rounded-full px-2 py-[2px] text-[10px] ${
                    hasRecommendedClarifications
                      ? "bg-blue-50 text-blue-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {clarButtonBadgeText}
                </span>
              ) : null}
              {hasRecommendedClarifications ? (
                <span className="ml-1 text-xs text-gray-500">({recommendedClarificationCount})</span>
              ) : null}
            </button>

            {effectiveMilestones.length && pricingEstimateStale ? (
              <button
                type="button"
                onClick={() =>
                  handleRefreshPricingEstimate().catch((e) =>
                    toast.error(e?.response?.data?.detail || e?.message || "Pricing refresh failed.")
                  )
                }
                disabled={pricingRefreshing}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                title="Refresh estimate-assist guidance from current clarification answers without changing milestone amounts."
              >
                {pricingRefreshing ? "Refreshing Pricing…" : "Refresh Pricing Estimate"}
              </button>
            ) : null}

            {pricingEstimateStale ? (
              <span className="text-xs text-amber-700">
                Pricing inputs changed. Refresh pricing guidance before you lock in milestone amounts.
              </span>
            ) : null}

            {!clarReviewed ? (
              <span className="text-xs text-gray-500">
                {hasRecommendedClarifications
                  ? "You’ll review recommended clarifications before continuing."
                  : "You’ll review clarifications before continuing."}
              </span>
            ) : null}

            {aiError ? <span className="text-sm text-red-600">{aiError}</span> : null}
          </div>

          <details className="relative">
            <summary className="cursor-pointer list-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              More
            </summary>
            <div className="absolute right-0 z-10 mt-2 min-w-[200px] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
              <button
                type="button"
                onClick={handleOpenSaveTemplate}
                disabled={milestonesLocked}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                title={milestonesLocked ? "Locked" : "Save current agreement milestones as a reusable template"}
              >
                Save as Template
              </button>
            </div>
          </details>
        </div>
      </section>

      {showPricingReviewPrompt ? (
        <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/85 px-4 py-3 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-semibold text-indigo-950">Pricing suggestions are ready to review</div>
              <div className="mt-1 text-xs text-indigo-800">
                {pricingReviewState.count} milestone{pricingReviewState.count === 1 ? "" : "s"} have new suggested amount{pricingReviewState.count === 1 ? "" : "s"}.
                {pricingReviewState.count > 0 ? (
                  <>
                    {" "}Current {formatCurrency(pricingReviewState.currentTotal)} → Suggested {formatCurrency(pricingReviewState.suggestedTotal)}
                  </>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleReviewSuggestedPricing}
                className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm font-medium text-indigo-900 hover:bg-indigo-100"
              >
                Review Changes
              </button>
              <button
                type="button"
                onClick={applySuggestedPricesToAll}
                disabled={milestonesLocked}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                Apply Suggested Price to All
              </button>
              <button
                type="button"
                onClick={() => setDismissedPricingReviewSignature(pricingReviewState.signature)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {estimatePreview ? (
        <details
          className="rounded-xl border border-slate-200 bg-slate-50/60"
          data-testid="step2-estimate-panel"
        >
          <summary className="cursor-pointer list-none px-4 py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Estimate summary</div>
                <div className="mt-1 text-xs text-slate-600">
                  Pricing and timeline guidance based on current project details.
                </div>
                {estimateBanner ? (
                  <div
                    className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
                    data-testid="step2-estimate-banner"
                  >
                    {estimateBanner}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  View estimate details
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleRefreshProjectEstimate({
                      successMessage: "Estimate refreshed from current project details.",
                    }).catch((err) =>
                      toast.error(err?.response?.data?.detail || err?.message || "Estimate refresh failed.")
                    );
                  }}
                  disabled={estimateRefreshing}
                  className="rounded border px-3 py-2 text-sm font-medium hover:bg-white disabled:opacity-60"
                  data-testid="step2-refresh-estimate"
                >
                  {estimateRefreshing ? "Refreshing Estimate…" : "Refresh Estimate"}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    applyEstimateSuggestedAmounts();
                  }}
                  disabled={milestonesLocked}
                  className="rounded border px-3 py-2 text-sm font-medium hover:bg-white disabled:opacity-60"
                  data-testid="step2-apply-estimate-amounts"
                >
                  Apply Suggested Amounts
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    applyEstimateSuggestedTimeline();
                  }}
                  disabled={milestonesLocked}
                  className="rounded border px-3 py-2 text-sm font-medium hover:bg-white disabled:opacity-60"
                  data-testid="step2-apply-estimate-timeline"
                >
                  Apply Suggested Timeline
                </button>
              </div>
            </div>
          </summary>

          <div className="border-t border-slate-200 px-4 py-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-md border bg-white px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Suggested Total</div>
                <div className="mt-1 text-lg font-semibold text-slate-900" data-testid="step2-estimate-total">
                  {formatCurrency(estimatePreview.suggested_total_price)}
                </div>
                <div className="text-xs text-slate-600">
                  Range {formatCurrency(estimatePreview.suggested_price_low)} – {formatCurrency(estimatePreview.suggested_price_high)}
                </div>
              </div>
              <div className="rounded-md border bg-white px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Timeline</div>
                <div className="mt-1 text-lg font-semibold text-slate-900" data-testid="step2-estimate-duration">
                  {formatDurationDays(estimatePreview.suggested_duration_days)}
                </div>
                <div className="text-xs text-slate-600">
                  Range {formatDurationDays(estimatePreview.suggested_duration_low)} – {formatDurationDays(estimatePreview.suggested_duration_high)}
                </div>
              </div>
              <div className="rounded-md border bg-white px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Confidence</div>
                <div className="mt-1 text-sm font-semibold text-slate-900" data-testid="step2-estimate-confidence">
                  {formatEstimateConfidence(estimatePreview.confidence_level) || "Estimate available"}
                </div>
                <div className="mt-1 text-xs text-slate-600">{estimatePreview.confidence_reasoning}</div>
              </div>
              <div className="rounded-md border bg-white px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Source</div>
                <div className="mt-1 text-sm font-semibold text-slate-900" data-testid="step2-estimate-source">
                  {safeStr(estimatePreview.template_used) || "Project benchmark"}
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  {safeStr(estimatePreview.benchmark_source).replace(/_/g, " ")}
                  {estimatePreview.source_metadata?.seeded_region_scope
                    ? ` • ${estimatePreview.source_metadata.seeded_region_scope}`
                    : ""}
                </div>
              </div>
            </div>
          </div>
        </details>
      ) : null}

      <ClarificationsModal
        open={clarOpen}
        agreementId={agreementId}
        initialAgreement={clarificationsAgreementMeta}
        overrideQuestions={combinedClarificationQuestions}
        excludeKeys={[
          "permits_responsibility",
          "materials_responsibility",
          "measurements_provided",
          "measurement_notes",
          "allowances_selections",
          "allowance_notes",
        ]}
        onClose={() => {
          setClarOpen(false);
          if (pendingNextRef.current) {
            pendingNextRef.current = false;
            (async () => {
              try {
                await persistAnswersToAgreement({ clarifications_reviewed_step2: true });
              } catch {
                // ignore
              } finally {
                setClarReviewed(true);
                if (typeof onNext === "function") onNext();
              }
            })();
          }
        }}
        onSaved={async (updatedAgreement) => {
          const previousAnswers = agreementMeta?.ai_scope?.answers || {};
          const nextAnswers = updatedAgreement?.ai_scope?.answers || {};
          if (updatedAgreement && pricingImpactAnswersChanged(previousAnswers, nextAnswers)) {
            setPricingEstimateStale(true);
          }
          if (updatedAgreement) {
            setAgreementMeta(updatedAgreement);
            const normalizedMaterialsWho = normalizeMaterialsResponsibilityValue(
              nextAnswers?.materials_responsibility ||
              nextAnswers?.materials_purchasing ||
              nextAnswers?.who_purchases_materials
            );
            if (normalizedMaterialsWho) {
              setMaterialsWho(normalizedMaterialsWho);
            }
          } else {
            await refreshAgreementMeta();
          }
          await persistAnswersToAgreement(
            { clarifications_reviewed_step2: true },
            { includeStep2Answers: false }
          );
          try {
            await refreshMilestonesSafe();
          } catch (err) {
            console.warn("refreshAfterClarificationsSave failed:", err);
          }
          if (updatedAgreement && pricingImpactAnswersChanged(previousAnswers, nextAnswers)) {
            handleRefreshProjectEstimate({
              successMessage: "Estimate updated based on your project details.",
            }).catch((err) => {
              console.warn("refreshEstimateAfterClarifications failed:", err);
            });
          }
          setClarReviewed(true);
          if (pendingNextRef.current) {
            pendingNextRef.current = false;
            if (typeof onNext === "function") onNext();
          }
        }}
      />

      {aiPreview ? (
        <div className="mb-6 rounded-lg border bg-indigo-50 p-4">
          <h4 className="mb-2 font-semibold">AI Suggested Scope</h4>
          <p className="mb-3 whitespace-pre-wrap text-sm">{aiPreview.scope_text}</p>

          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h4 className="mb-2 font-semibold">AI Suggested Milestones</h4>
              <p className="text-xs text-gray-600">Tip: Use auto-spread if AI amounts are $0.00.</p>
            </div>

            <div className="rounded border bg-white p-3">
              <label className="flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={spreadEnabled}
                  onChange={(e) => setSpreadEnabled(e.target.checked)}
                  disabled={milestonesLocked || templateApplied}
                />
                Auto-spread total across milestones
              </label>

              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-gray-600">Total ($)</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="w-40 rounded border px-2 py-2 text-sm"
                  placeholder="e.g., 1250.00"
                  value={spreadTotal}
                  onChange={(e) => setSpreadTotal(e.target.value)}
                  disabled={!spreadEnabled || milestonesLocked || templateApplied}
                />
              </div>

              <div className="mt-1 text-[11px] text-gray-500">
                Leave blank to keep AI amounts (often $0.00).
              </div>

              <label className="mt-3 flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={autoSchedule}
                  onChange={(e) => setAutoSchedule(e.target.checked)}
                  disabled={milestonesLocked || templateApplied}
                />
                Auto-schedule milestones (requires Agreement start/end)
              </label>
            </div>
          </div>

          <ul className="mb-4 list-disc pl-5 text-sm">
            {aiPreview.milestones.map((m, i) => (
              <li key={i}>
                <strong>{m.title}</strong> — ${Number(m.amount || 0).toFixed(2)}
              </li>
            ))}
          </ul>

          {Array.isArray(aiPreview.questions) && aiPreview.questions.length ? (
            <div className="mb-4 rounded border bg-white p-3">
              <div className="mb-2 text-sm font-semibold text-gray-900">
                AI Suggested Clarifications
              </div>
              <div className="mb-2 text-xs text-gray-600">
                These same clarification questions will appear in the popup review below.
              </div>
              <ul className="space-y-2 text-sm">
                {aiPreview.questions.map((q, idx) => (
                  <li key={`${q.key || "q"}-${idx}`} className="rounded border border-slate-200 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">
                        {q.label || q.key || `Question ${idx + 1}`}
                      </span>
                      {q.required ? (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
                          Recommended
                        </span>
                      ) : null}
                      {safeStr(q.type) ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                          {q.type}
                        </span>
                      ) : null}
                    </div>
                    {safeStr(q.help) ? (
                      <div className="mt-1 text-xs text-gray-600">{q.help}</div>
                    ) : null}
                    {Array.isArray(q.options) && q.options.length ? (
                      <div className="mt-1 text-xs text-gray-500">
                        Options: {q.options.join(", ")}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => handleApplyAiMilestonesBulk("replace")}
              disabled={aiApplying || milestonesLocked || templateApplied}
              className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {aiApplying ? "Applying…" : "Replace Milestones (Bulk)"}
            </button>
            <button
              type="button"
              onClick={() => handleApplyAiMilestonesBulk("append")}
              disabled={aiApplying || milestonesLocked || templateApplied}
              className="rounded border px-3 py-2 text-sm disabled:opacity-60"
            >
              {aiApplying ? "Applying…" : "Append Milestones (Bulk)"}
            </button>
            <button
              type="button"
              onClick={() => setAiPreview(null)}
              disabled={aiApplying}
              className="rounded border px-3 py-2 text-sm disabled:opacity-60"
            >
              Cancel
            </button>
            {Array.isArray(aiPreview.questions) && aiPreview.questions.length ? (
              <button
                type="button"
                onClick={() => setClarOpen(true)}
                disabled={aiApplying}
                className="rounded border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
              >
                Review Clarifications
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <section className="rounded-3xl border border-slate-300 bg-white p-5 shadow-md ring-1 ring-slate-100">
      <div className="mb-4">
        <h4 className="text-base font-semibold text-slate-950">Add or edit milestones</h4>
        <p className="mt-1 text-sm text-slate-600">
          Keep milestone editing as the primary task here. Save staged changes only after you review pricing and dates.
        </p>
      </div>

      <div className="mb-2 grid grid-cols-1 gap-3 md:grid-cols-12">
        <input
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-4"
          placeholder="Title"
          name="title"
          value={mLocal.title}
          onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
          disabled={milestonesLocked}
        />
        <input
          type="date"
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-3"
          name="start"
          value={mLocal.start || ""}
          onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
          disabled={milestonesLocked}
        />
        <input
          type="date"
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-3"
          name="end"
          value={mLocal.end || ""}
          onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
          disabled={milestonesLocked}
        />
        <input
          type="number"
          min="0.01"
          step="0.01"
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"
          placeholder={isProgressPayments ? "Scheduled Value" : "Amount"}
          name="amount"
          value={mLocal.amount}
          onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
          disabled={milestonesLocked}
        />
        <div className="md:col-span-12">
          <textarea
            className="w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm"
            rows={3}
            placeholder="Description (details, materials, notes)…"
            name="description"
            value={mLocal.description}
            onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
            disabled={milestonesLocked}
          />
        </div>
      </div>

      <div className="mb-6">
        <button
          type="button"
          onClick={() =>
            handleManualSave().catch((e) =>
              toast.error(e?.response?.data?.detail || e?.message || "Save failed.")
            )
          }
          className="rounded-xl bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
          disabled={milestonesLocked}
        >
          + Add Milestone
        </button>
      </div>

      {isProgressPayments ? (
        <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 text-sm text-indigo-900">
          <div className="font-semibold">Progress Payments</div>
          <div className="mt-1">
            Milestones stay as your schedule of values. Percent complete, earned amount, and remaining balance are
            shown here for draw-request planning after signing.
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left [&>*]:px-3 [&>*]:py-2">
              <th>#</th>
              <th>Title</th>
              <th>Description</th>
              <th>Start</th>
              <th>Due</th>
              <th>Amount</th>
              <th>
                <div className="flex items-center gap-2">
                  <span>Estimate Assist</span>
                  {pricingEstimateStale ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                      Stale
                    </span>
                  ) : null}
                </div>
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {effectiveMilestones.map((m, idx) => {
              const estimate = getEstimateAssistMeta(m);
              const aiHighlight = m?.id != null ? aiHighlights[`milestone:${m.id}`] : null;
              const isAiSuggested = m?.id != null && aiSuggestedMilestoneIds.includes(m.id);
              return (
                <tr
                  key={m.id || `${m.title}-${idx}`}
                  className={`border-t align-top transition-colors ${aiHighlight ? "bg-amber-50/60" : ""}`}
                  data-testid={`step2-milestone-row-${m.id || idx + 1}`}
                >
                  <td className="px-3 py-2">{m?.order ?? idx + 1}</td>

                  <td className="px-3 py-2">
                    <div>{m.title || "—"}</div>
                    {isAiSuggested ? (
                      <div className="mt-1">
                        <span
                          data-testid={`step2-milestone-ai-indicator-${m.id || idx + 1}`}
                          className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
                        >
                          AI suggested
                        </span>
                      </div>
                    ) : null}
                    {estimate.type ? (
                      <div className="mt-1">
                        <span className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                          {estimate.type}
                        </span>
                      </div>
                    ) : null}
                  </td>

                  <td className="whitespace-pre-wrap px-3 py-2">{m.description || "—"}</td>

                  <td className="px-3 py-2" data-testid={`step2-milestone-start-${m.id || idx + 1}`}>
                    {friendly(toDateOnly(m.start_date || m.start))}
                  </td>

                  <td className="px-3 py-2" data-testid={`step2-milestone-due-${m.id || idx + 1}`}>
                    {friendly(toDateOnly(m.completion_date || m.end_date || m.end))}
                  </td>

                  <td className="px-3 py-2" data-testid={`step2-milestone-amount-${m.id || idx + 1}`}>
                    {Number(m.amount || 0).toLocaleString(undefined, { style: "currency", currency: "USD" })}
                  </td>

                  <td className="px-3 py-2">
                    {estimate.hasAnything ? (
                      <div className="space-y-1 text-xs">
                        {pricingEstimateStale ? (
                          <div>
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                              Stale — refresh pricing
                            </span>
                          </div>
                        ) : null}

                        {estimate.pricingModeLabel ? (
                          <div>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                              {estimate.pricingModeLabel}
                            </span>
                          </div>
                        ) : null}

                        {estimate.hasPrimaryRange ? (
                          <div className="text-gray-700">
                            {estimate.primaryLabel}:{" "}
                            <span className="font-medium">
                              {formatCurrency(estimate.primaryLow)} – {formatCurrency(estimate.primaryHigh)}
                            </span>
                          </div>
                        ) : null}

                        {estimate.materialsLine ? (
                          <div className="text-gray-500">{estimate.materialsLine}</div>
                        ) : null}

                        {estimate.pricingReason ? (
                          <div className="text-gray-500">{estimate.pricingReason}</div>
                        ) : null}

                        {estimate.pricingSources?.length ? (
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              Pricing Source
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {estimate.pricingSources.map((source) => (
                                <span
                                  key={`${m.id || "milestone"}-${source}`}
                                  className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700"
                                >
                                  {source}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {estimate.confidenceLabel ? (
                          <div>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                estimate.confidence.toLowerCase() === "high"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : estimate.confidence.toLowerCase() === "medium"
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {estimate.confidenceLabel}
                            </span>
                          </div>
                        ) : null}

                        {estimate.durationLabel ? (
                          <div className="text-gray-600">Est. duration: {estimate.durationLabel}</div>
                        ) : null}

                        {estimate.materials ? (
                          <div className="text-gray-600">
                            <span className="font-medium text-gray-700">Materials:</span> {estimate.materials}
                          </div>
                        ) : null}

                        {Number.isFinite(estimate.suggestedAmount) && estimate.suggestedAmount > 0 ? (
                          <div>
                            <button
                              type="button"
                              className="rounded border px-2 py-1 text-[11px] font-medium hover:bg-gray-50 disabled:opacity-60"
                              onClick={() => handleEditClick(m, idx, { useSuggestedPrice: true })}
                              disabled={milestonesLocked}
                            >
                              Use Suggested Price
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>

                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        type="button"
                        className="rounded border px-2 py-1 disabled:opacity-60"
                        onClick={() => handleEditClick(m, idx)}
                        disabled={milestonesLocked}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 disabled:opacity-60"
                        onClick={() => handleDelete(m.id)}
                        disabled={milestonesLocked}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {!effectiveMilestones.length ? (
              <tr>
                <td colSpan={8} className="py-6 text-center text-gray-400">
                  No milestones yet.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-semibold">
              <td className="px-3 py-2" colSpan={5}>
                Total
              </td>
              <td className="px-3 py-2">
                {total.toLocaleString(undefined, { style: "currency", currency: "USD" })}
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>
      </section>

      <div className="mt-4 flex items-center justify-between">
        <button type="button" onClick={handleBackClick} className="rounded border px-3 py-2 text-sm">
          Back
        </button>
        <button
          type="button"
          onClick={handleNext}
          className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
          disabled={savingAiScope}
        >
          {savingAiScope ? "Saving…" : "Save & Next"}
        </button>
      </div>

      <SaveTemplateModal
        open={saveTemplateOpen}
        onClose={() => {
          if (saveTemplateBusy) return;
          setSaveTemplateOpen(false);
        }}
        onSubmit={handleSaveAsTemplate}
        busy={saveTemplateBusy}
        defaultName={saveTemplateName}
        defaultDescription={saveTemplateDescription}
        projectType={safeStr(agreementMeta?.project_type)}
        projectSubtype={safeStr(agreementMeta?.project_subtype)}
        milestoneCount={effectiveMilestones.length}
        scopeDescription={
          safeStr(agreementMeta?.description) ||
          safeStr(agreementMeta?.project_description) ||
          safeStr(agreementMeta?.scope)
        }
        milestones={effectiveMilestones}
      />

      {false && saveTemplateOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-gray-900">Save as Template</div>
                <div className="text-xs text-gray-500">
                  Save this agreement’s current milestone structure as a reusable template.
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (saveTemplateBusy) return;
                  setSaveTemplateOpen(false);
                }}
                className="rounded border px-2 py-1 text-sm"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">Template Name</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={saveTemplateName}
                  onChange={(e) => setSaveTemplateName(e.target.value)}
                  placeholder="e.g., My Standard Roofing Template"
                  disabled={saveTemplateBusy}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">Description (optional)</label>
                <textarea
                  className="w-full rounded border px-3 py-2 text-sm"
                  rows={4}
                  value={saveTemplateDescription}
                  onChange={(e) => setSaveTemplateDescription(e.target.value)}
                  placeholder="Optional notes about this reusable template…"
                  disabled={saveTemplateBusy}
                />
              </div>

              <div className="rounded-md border bg-gray-50 px-3 py-2 text-xs text-gray-600">
                This saves the current project type, subtype, description, and milestone structure for reuse in future agreements.
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (saveTemplateBusy) return;
                  setSaveTemplateOpen(false);
                }}
                className="rounded border px-4 py-2 text-sm"
                disabled={saveTemplateBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAsTemplate}
                className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
                disabled={saveTemplateBusy}
              >
                {saveTemplateBusy ? "Saving…" : "Save Template"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-gray-900">Edit Milestone</div>
                <div className="text-xs text-gray-500">
                  Milestone #{editForm.order != null ? editForm.order : "—"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (editBusy || editAiBusy) return;
                  setEditOpen(false);
                  setEditMilestone(null);
                  setEditAiPreview("");
                }}
                className="rounded border px-2 py-1 text-sm"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">Title</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={editForm.title}
                  onChange={(e) => setEditForm((s) => ({ ...s, title: e.target.value }))}
                  disabled={editBusy}
                />
              </div>

              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="mb-1 block text-xs font-semibold text-gray-700">Description</label>
                  <button
                    type="button"
                    onClick={runEditAiImprove}
                    disabled={editBusy || editAiBusy || milestonesLocked}
                    className="rounded border px-2 py-1 text-[11px] hover:bg-gray-50 disabled:opacity-60"
                    title="Uses the agreement AI bundle (no extra charge after first use on this agreement)."
                  >
                    {editAiBusy ? "Working…" : "✨ Improve Description"}
                  </button>
                </div>
                <textarea
                  className="w-full rounded border px-3 py-2 text-sm"
                  rows={4}
                  value={editForm.description}
                  onChange={(e) => setEditForm((s) => ({ ...s, description: e.target.value }))}
                  disabled={editBusy}
                />
                {editAiErr ? <div className="mt-1 text-xs text-red-600">{editAiErr}</div> : null}

                {editAiPreview ? (
                  <div className="mt-2 rounded-md border bg-indigo-50 p-3">
                    <div className="mb-2 text-xs font-semibold text-indigo-900">AI Preview</div>
                    <div className="whitespace-pre-wrap text-sm text-indigo-900">{editAiPreview}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => applyEditAi("replace")}
                        className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-700"
                      >
                        Replace
                      </button>
                      <button
                        type="button"
                        onClick={() => applyEditAi("append")}
                        className="rounded border px-3 py-1.5 text-xs"
                      >
                        Append
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditAiPreview("")}
                        className="rounded border px-3 py-1.5 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {(safeStr(editForm.normalized_milestone_type) ||
                safeStr(editForm.pricing_confidence) ||
                editForm.suggested_amount_low !== "" ||
                editForm.suggested_amount_high !== "" ||
                editForm.labor_estimate_low !== "" ||
                editForm.labor_estimate_high !== "" ||
                editForm.materials_estimate_low !== "" ||
                editForm.materials_estimate_high !== "" ||
                safeStr(editForm.materials_hint) ||
                editForm.recommended_duration_days !== "") ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-700">
                    Estimate Assist
                  </div>

                  <div className="space-y-2 text-sm">
                    {safeStr(editForm.normalized_milestone_type) ? (
                      <div>
                        <span className="font-medium text-slate-800">Type:</span>{" "}
                        <span className="text-slate-700">{editForm.normalized_milestone_type}</span>
                      </div>
                    ) : null}

                    {safeStr(editForm.pricing_mode) ? (
                      <div>
                        <span className="font-medium text-slate-800">Pricing mode:</span>{" "}
                        <span className="text-slate-700">
                          {safeStr(editForm.pricing_mode).toLowerCase() === "labor_only"
                            ? "Labor Only"
                            : safeStr(editForm.pricing_mode).toLowerCase() === "hybrid"
                            ? "Hybrid"
                            : "Full Service"}
                        </span>
                      </div>
                    ) : null}

                    {((safeStr(editForm.pricing_mode).toLowerCase() === "labor_only" ||
                      safeStr(editForm.pricing_mode).toLowerCase() === "hybrid")
                      ? (editForm.labor_estimate_low !== "" || editForm.labor_estimate_high !== "")
                      : (editForm.suggested_amount_low !== "" || editForm.suggested_amount_high !== "")) ? (
                      <div>
                        <span className="font-medium text-slate-800">
                          {safeStr(editForm.pricing_mode).toLowerCase() === "labor_only" ||
                          safeStr(editForm.pricing_mode).toLowerCase() === "hybrid"
                            ? "Labor:"
                            : "Total:"}
                        </span>{" "}
                        <span className="text-slate-700">
                          {safeStr(editForm.pricing_mode).toLowerCase() === "labor_only" ||
                          safeStr(editForm.pricing_mode).toLowerCase() === "hybrid"
                            ? `${formatCurrency(editForm.labor_estimate_low)} – ${formatCurrency(editForm.labor_estimate_high)}`
                            : `${formatCurrency(editForm.suggested_amount_low)} – ${formatCurrency(editForm.suggested_amount_high)}`}
                        </span>
                      </div>
                    ) : null}

                    {safeStr(editForm.pricing_mode).toLowerCase() === "labor_only" ? (
                      <div>
                        <span className="font-medium text-slate-800">Materials:</span>{" "}
                        <span className="text-slate-700">customer supplied</span>
                      </div>
                    ) : null}

                    {safeStr(editForm.pricing_mode).toLowerCase() !== "labor_only" &&
                    (editForm.materials_estimate_low !== "" || editForm.materials_estimate_high !== "") ? (
                      <div>
                        <span className="font-medium text-slate-800">Materials:</span>{" "}
                        <span className="text-slate-700">
                          {formatCurrency(editForm.materials_estimate_low)} – {formatCurrency(editForm.materials_estimate_high)}
                        </span>
                      </div>
                    ) : null}

                    {safeStr(editForm.pricing_confidence) ? (
                      <div>
                        <span className="font-medium text-slate-800">Confidence:</span>{" "}
                        <span className="text-slate-700">{formatEstimateConfidence(editForm.pricing_confidence)}</span>
                      </div>
                    ) : null}

                    {editForm.recommended_duration_days !== "" && editForm.recommended_duration_days != null ? (
                      <div>
                        <span className="font-medium text-slate-800">Estimated duration:</span>{" "}
                        <span className="text-slate-700">{formatDurationDays(editForm.recommended_duration_days)}</span>
                      </div>
                    ) : null}

                    {safeStr(editForm.materials_hint) ? (
                      <div>
                        <span className="font-medium text-slate-800">Materials hint:</span>{" "}
                        <span className="text-slate-700">{editForm.materials_hint}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-700">Start</label>
                  <input
                    type="date"
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={editForm.start_date}
                    onChange={(e) => setEditForm((s) => ({ ...s, start_date: e.target.value }))}
                    disabled={editBusy}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-700">Due</label>
                  <input
                    type="date"
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={editForm.completion_date}
                    onChange={(e) => setEditForm((s) => ({ ...s, completion_date: e.target.value }))}
                    disabled={editBusy}
                  />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="block text-xs font-semibold text-gray-700">Amount</label>
                    {Number.isFinite(deriveSuggestedPriceAmount(editForm)) && deriveSuggestedPriceAmount(editForm) > 0 ? (
                      <button
                        type="button"
                        onClick={applySuggestedPriceToEditForm}
                        disabled={editBusy}
                        className="rounded border px-2 py-1 text-[11px] font-medium hover:bg-gray-50 disabled:opacity-60"
                      >
                        Use Suggested Price
                      </button>
                    ) : null}
                  </div>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={editForm.amount}
                    onChange={(e) => setEditForm((s) => ({ ...s, amount: e.target.value }))}
                    disabled={editBusy}
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (editBusy || editAiBusy) return;
                  setEditOpen(false);
                  setEditMilestone(null);
                  setEditAiPreview("");
                }}
                className="rounded border px-4 py-2 text-sm"
                disabled={editBusy || editAiBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
                disabled={editBusy || editAiBusy}
              >
                {editBusy ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {overlapConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Overlapping Schedule</h3>
            <p className="mt-2 text-sm text-gray-700">
              This milestone overlaps an existing milestone’s schedule. Do you want to continue anyway?
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={cancelOverlap} className="rounded border px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmOverlapAndSave}
                className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
              >
                Continue Anyway
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
