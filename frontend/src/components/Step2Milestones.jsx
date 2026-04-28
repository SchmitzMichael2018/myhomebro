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
import CommercialPaymentOverviewPanel from "./step2/CommercialPaymentOverviewPanel.jsx";
import useAgreementMilestoneAI from "./ai/useAgreementMilestoneAI.jsx";
import useAiFieldHighlights from "../hooks/useAiFieldHighlights.js";
import { getAiPanelConfigForStep } from "../lib/agreementWizardAiPanel.js";
import { labelForTemplateMilestoneType } from "../lib/milestoneTypes.js";
import { normalizeProjectClass } from "../utils/projectClass.js";
import {
  buildActionableTemplateInsightCards,
  deriveTemplateInsights,
} from "../lib/templateInsights.js";
import {
  buildClarificationAwareMilestoneDraft,
} from "../lib/milestoneDraftShaping.js";
import {
  normalizeAssistantMilestoneSuggestion,
  normalizeAssistantQuestion,
} from "../lib/assistantHandoff.js";
import { normalizeProjectFamilyContext } from "../lib/projectFamilyContext.js";

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

function InsightCard({
  title,
  body,
  actionLabel,
  onAction,
  actionTestId,
  dataTestId,
  disabled = false,
}) {
  return (
    <div
      className="rounded-xl border border-sky-200 bg-sky-50/80 px-3 py-3 shadow-sm"
      data-testid={dataTestId}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">{title}</div>
      <div className="mt-2 text-sm text-slate-800">{body}</div>
      {actionLabel ? (
        <button
          type="button"
          onClick={onAction}
          disabled={disabled}
          data-testid={actionTestId}
          className="mt-3 rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-60"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function formatPercent(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return `${(n * 100).toFixed(digits)}%`;
}

function projectClassLabel(value) {
  return normalizeProjectClass(value) === "commercial" ? "Commercial" : "Residential";
}

function estimateWeightLabel(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return "0%";
  return formatPercent(n, n < 0.1 ? 1 : 0);
}

function explainBenchmarkSource(preview) {
  const source = safeStr(preview?.benchmark_source).toLowerCase();
  const regionScope = safeStr(preview?.source_metadata?.seeded_region_scope).toLowerCase();
  const templateUsed = safeStr(preview?.template_used);

  if (source === "seeded_plus_learned") {
    if (regionScope) {
      return `Based on ${templateUsed || "template"} defaults and similar completed ${regionScope}-level jobs.`;
    }
    return `Based on ${templateUsed || "template"} defaults and completed job benchmarks.`;
  }

  if (templateUsed) {
    return `Based on ${templateUsed} defaults and current project details.`;
  }

  return "Based on template defaults and current project details.";
}

function explainRangeVariability(preview) {
  const low = Number(preview?.suggested_price_low || 0);
  const high = Number(preview?.suggested_price_high || 0);
  const total = Number(preview?.suggested_total_price || 0);
  const confidence = safeStr(preview?.confidence_level).toLowerCase();

  if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(total) || total <= 0) {
    return "Ranges stay broad when there is limited pricing context.";
  }

  const spread = Math.max(high - low, 0);
  const spreadPct = spread / total;

  if (confidence === "low") {
    return "Limited data means this range should be treated as an early planning guide.";
  }
  if (spreadPct <= 0.2) {
    return "The range is relatively tight because the current project context is more consistent.";
  }
  return "The range stays wider to reflect job-to-job variability, finish choices, and site conditions.";
}

function formatBenchmarkSourceLabel(sourceType) {
  const source = safeStr(sourceType).toLowerCase();
  if (source === "platform" || source === "platform_only") return "Platform";
  if (source === "regional") return "Regional";
  if (source === "contractor" || source === "contractor_only") return "Contractor";
  if (source === "blended_platform_regional") return "Platform + Regional";
  if (source === "blended_platform_contractor" || source === "platform_plus_contractor") return "Platform + Contractor";
  if (source === "blended_all") return "Platform + Regional + Contractor";
  return source ? source.replace(/_/g, " ") : "Platform";
}

function explainPlanBenchmarkSource(plan) {
  const blended = plan?.source_metadata?.blended_benchmark || {};
  const sourceType = safeStr(blended?.source_type).toLowerCase();
  const platformCount = Number(blended?.platform?.sample_size || 0);
  const regionalCount = Number(blended?.regional?.sample_size || 0);
  const contractorCount = Number(blended?.contractor?.sample_size || 0);

  let explanation = "Based on template defaults and current project details.";
  if (sourceType === "blended_all") {
    explanation = "Based on similar projects on MyHomeBro, your market, and your past work.";
  } else if (sourceType === "blended_platform_regional") {
    explanation = "Based on similar projects on MyHomeBro and your market.";
  } else if (sourceType === "blended_platform_contractor" || sourceType === "platform_plus_contractor") {
    explanation = "Based on similar projects on MyHomeBro and your past work.";
  } else if (sourceType === "regional") {
    explanation = "Based on similar projects in your market.";
  } else if (sourceType === "contractor" || sourceType === "contractor_only") {
    explanation = "Based on your past work for similar projects.";
  } else if (sourceType === "platform" || sourceType === "platform_only") {
    explanation = "Based on similar projects on MyHomeBro.";
  }

  const countBits = [];
  if (platformCount > 0) countBits.push(`${platformCount} platform project${platformCount === 1 ? "" : "s"}`);
  if (regionalCount > 0) countBits.push(`${regionalCount} market project${regionalCount === 1 ? "" : "s"}`);
  if (contractorCount > 0) countBits.push(`${contractorCount} of your completed job${contractorCount === 1 ? "" : "s"}`);
  const countText = countBits.length
    ? `Based on ${
        countBits.length === 1
          ? countBits[0]
          : `${countBits.slice(0, -1).join(", ")} and ${countBits[countBits.length - 1]}`
      }.`
    : "";

  return {
    sourceType: formatBenchmarkSourceLabel(sourceType),
    explanation,
    countText,
    confidence: formatEstimateConfidence(plan?.confidence_level) || "Advisory",
  };
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
        ? `Materials: ${formatCurrency(materialsLow)}  ${formatCurrency(materialsHigh)}`
        : "",
    confidenceLabel: formatEstimateConfidence(confidence),
    pricingSources: derivePricingSources(pricingReason),
    materials,
    type,
    typeLabel: labelForTemplateMilestoneType(type) || type,
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
  return `${text.slice(0, maxLen - 1).trim()}`;
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

function normalizeCardRows(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])]
    .map((row, idx) => ({
      ...row,
      order: row?.order != null && row.order !== "" ? Number(row.order) : idx + 1,
    }))
    .sort((a, b) => {
      const orderA = Number.isFinite(Number(a?.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isFinite(Number(b?.order)) ? Number(b.order) : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;

      const idA = Number.isFinite(Number(a?.id)) ? Number(a.id) : Number.MAX_SAFE_INTEGER;
      const idB = Number.isFinite(Number(b?.id)) ? Number(b.id) : Number.MAX_SAFE_INTEGER;
      return idA - idB;
    });
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
  projectClassOverride = "",
  assistantSuggestedMilestones = [],
  assistantClarificationQuestions = [],
  assistantEstimatePreview = {},
  assistantProactiveRecommendations = [],
  assistantPredictiveInsights = [],
  assistantGuidedFlow = {},
  projectFamilyContext = {},
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
  const [newMilestoneOpen, setNewMilestoneOpen] = useState(false);
  const [expandedMilestoneId, setExpandedMilestoneId] = useState(null);
  const newMilestoneTitleRef = useRef(null);
  const dragSourceIndexRef = useRef(null);
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

  useEffect(() => {
    if (!newMilestoneOpen) return;
    const timer = window.requestAnimationFrame(() => {
      newMilestoneTitleRef.current?.focus?.();
    });
    return () => window.cancelAnimationFrame(timer);
  }, [newMilestoneOpen]);

  const [agreementMeta, setAgreementMeta] = useState(null);

  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const lastProjectClassRef = useRef("");
  const warnedMissingTotalCostRef = useRef(false);

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
  const [projectBudgetInput, setProjectBudgetInput] = useState("");
  const [assistantApplyingMilestones, setAssistantApplyingMilestones] = useState(false);
  const [aiChangeSummary, setAiChangeSummary] = useState("");
  const [autoDraftBusy, setAutoDraftBusy] = useState(false);
  const resolvedProjectFamily = useMemo(
    () => normalizeProjectFamilyContext(projectFamilyContext),
    [projectFamilyContext]
  );
  const [autoDraftBanner, setAutoDraftBanner] = useState("");
  const [aiSuggestedMilestoneIds, setAiSuggestedMilestoneIds] = useState([]);
  const [aiMilestonePreviewMode, setAiMilestonePreviewMode] = useState("");
  const [aiMilestoneGenerationBusy, setAiMilestoneGenerationBusy] = useState(false);
  const [aiMilestoneGenerationError, setAiMilestoneGenerationError] = useState("");
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
  const step2UnsavedMessage = "You have unsaved pricing or milestone changes. Leave without saving'";

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

  function updateCardMilestoneField(milestoneId, field, value) {
    setFallbackMilestones((prev) => {
      const base = Array.isArray(prev) ? prev : Array.isArray(effectiveMilestones) ? effectiveMilestones : [];
      const nextRows = base.map((row) => {
        if (row?.id !== milestoneId) return row;
        const next = { ...row, [field]: value };
        if (field === "order") {
          next.order = Number(value) || row.order;
        }
        return next;
      });
      return normalizeCardRows(nextRows);
    });
    markMilestonesUserModified();
  }

  function toggleCardExpanded(milestoneId) {
    setExpandedMilestoneId((current) => (current === milestoneId ? null : milestoneId));
  }

  function moveCardMilestone(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    setFallbackMilestones((prev) => {
      const base = Array.isArray(prev) ? [...prev] : Array.isArray(effectiveMilestones) ? [...effectiveMilestones] : [];
      if (!base.length) return base;
      if (fromIndex < 0 || fromIndex >= base.length) return base;
      if (toIndex < 0 || toIndex >= base.length) return base;
      const next = [...base];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return normalizeCardRows(
        next.map((row, idx) => ({
          ...row,
          order: idx + 1,
        }))
      );
    });
    markMilestonesUserModified();
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
        ? `Milestones are locked  ${milestonesLockReason}`
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

  useEffect(() => {
    const incomingProjectClass = safeStr(projectClassOverride)
      ? normalizeProjectClass(projectClassOverride)
      : "";
    const currentProjectClass = normalizeProjectClass(agreementMeta?.project_class);

    if (lastProjectClassRef.current !== currentProjectClass) {
      lastProjectClassRef.current = currentProjectClass;
    }

    if (!agreementMeta || !incomingProjectClass || incomingProjectClass === currentProjectClass) {
      return;
    }

    setAgreementMeta((prev) =>
      prev
        ? {
            ...prev,
            project_class: incomingProjectClass,
          }
        : prev
    );
    setPricingEstimateStale(true);
  }, [agreementMeta?.project_class, projectClassOverride]);

  useEffect(() => {
    if (!agreementMeta) return;

    const hasTotalCost = safeStr(agreementMeta?.total_cost) !== "";
    if (hasTotalCost) {
      warnedMissingTotalCostRef.current = false;
      return;
    }

    if (!warnedMissingTotalCostRef.current) {
      console.warn("Missing total_cost in agreementMeta");
      warnedMissingTotalCostRef.current = true;
    }
  }, [agreementMeta, agreementMeta?.total_cost]);

  const selectedTemplateMeta = useMemo(() => deriveSelectedTemplateMeta(agreementMeta), [agreementMeta]);
  const templateApplied = !!selectedTemplateMeta;
  const projectClass = normalizeProjectClass(agreementMeta?.project_class);
  const isCommercialProject = projectClass === "commercial";
  const isResidentialProject = !isCommercialProject;
  const paymentStructure = String(agreementMeta?.payment_structure || "simple").trim().toLowerCase();
  const isProgressPayments = paymentStructure === "progress";
  const step2ModeMeta = useMemo(() => {
    const aiPlanningActive =
      Boolean(aiChangeSummary) ||
      Boolean(assistantGuidedFlow?.guided_question) ||
      assistantProactiveRecommendations.length > 0 ||
      assistantPredictiveInsights.length > 0 ||
      assistantSuggestionRows.length > 0 ||
      showAssistantMilestoneSuggestions ||
      hasStagedSuggestedAmountChanges ||
      hasStagedSuggestedTimelineChanges ||
      Boolean(estimatePreview);

    if (isCommercialProject) {
      return {
        pathLabel: "Commercial",
        workspaceEyebrow: "Structured planning",
        workspaceTitle: "Commercial Schedule Builder",
        workspaceDescription:
          "Build the schedule of values, sequencing, and pricing plan you want the project team to work from.",
        aiEntryTitle: aiPlanningActive ? "Refine commercial schedule with AI" : "Plan commercial schedule with AI",
        aiEntryDescription:
          "Use current scope, pricing, clarifications, and benchmark context to shape a professional milestone schedule.",
        contextDescription:
          "Contract context that shapes the schedule of values, sequencing, and commercial pricing guidance.",
        planningDetailsDescription:
          "Clarifications, AI reasoning, and secondary planning guidance for this commercial job.",
        controlsDescription:
          "Keep the focus on schedule of values, sequencing, pricing guidance, and what should be saved next.",
        estimateTitle: "Commercial Estimate Summary",
        estimateDescription:
          "Benchmark and template guidance for commercial pricing, sequencing, and payment-schedule planning.",
        budgetDescription:
          "Enter a planning contract value to translate schedule shares into advisory commercial dollar targets. This will not overwrite milestone values.",
        timelineLabel: "Schedule window",
        pricingColumnLabel: "Schedule guidance",
        amountLabel: isProgressPayments ? "Scheduled Value" : "Contract Value",
        progressPanelTitle: "Progress Payments",
        progressPanelBody:
          "Milestones act as your schedule of values. Use the suggested shares, durations, and sequencing here to prepare for draw requests after signing.",
        simplePanelTitle: "Commercial milestone planning",
        simplePanelBody:
          "These milestones still support a structured commercial workflow even when you stay on simple milestone billing.",
      };
    }

    return {
      pathLabel: "Residential",
      workspaceEyebrow: "Simple planning",
      workspaceTitle: "Residential Milestone Planner",
      workspaceDescription:
        "Keep the plan easy to review with homeowner-friendly milestones, pricing, and timing.",
      aiEntryTitle: aiPlanningActive ? "Refine milestone plan with AI" : "Plan milestones with AI",
      aiEntryDescription:
        "Use current pricing, template, and clarification context to keep milestone work moving.",
      contextDescription:
        "Grounding details that shape milestone planning and pricing for this homeowner-facing project.",
      planningDetailsDescription:
        "Clarifications, AI reasoning, and secondary planning guidance for this residential job.",
      controlsDescription:
        "Keep the focus on milestone pricing, schedule, and the edits you want to save next.",
      estimateTitle: "Residential Estimate Summary",
      estimateDescription:
        "Pricing and timeline guidance to help you shape a clear, homeowner-friendly milestone plan.",
      budgetDescription:
        "Enter a planning budget to convert milestone guidance into advisory dollar suggestions. This will not overwrite milestone amounts.",
      timelineLabel: "Project window",
      pricingColumnLabel: "Estimate Assist",
      amountLabel: "Amount",
      progressPanelTitle: "Structured payment planning",
      progressPanelBody:
        "This residential agreement is using progress payments. Keep milestones clear and customer-friendly while using them for draw planning after signing.",
      simplePanelTitle: "Simple milestone planning",
      simplePanelBody:
        "Keep milestones straightforward so the homeowner can easily understand the order of work and when payments are expected.",
    };
  }, [
    aiChangeSummary,
    assistantGuidedFlow,
    assistantPredictiveInsights.length,
    assistantProactiveRecommendations.length,
    assistantSuggestionRows.length,
    estimatePreview,
    hasStagedSuggestedAmountChanges,
    hasStagedSuggestedTimelineChanges,
    isCommercialProject,
    isProgressPayments,
    showAssistantMilestoneSuggestions,
  ]);
  const projectContextSummary = useMemo(() => {
    const agreementAnswers = agreementMeta?.ai_scope?.answers || {};
    const projectType =
      safeStr(agreementMeta?.project_type) ||
      safeStr(selectedTemplateMeta?.project_type) ||
      safeStr(resolvedProjectFamily.project_family_label);
    const projectFamilyLabel =
      safeStr(agreementMeta?.project_family_label) ||
      safeStr(resolvedProjectFamily.project_family_label);
    const projectFamilyKey =
      safeStr(agreementMeta?.project_family_key) ||
      safeStr(resolvedProjectFamily.project_family_key);
    const projectSubtype =
      safeStr(agreementMeta?.project_subtype) ||
      safeStr(selectedTemplateMeta?.project_subtype) ||
      safeStr(resolvedProjectFamily.project_family_label);
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
      projectFamilyKey,
      projectFamilyLabel,
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
        !!projectFamilyLabel ||
        !!safeStr(selectedTemplateMeta?.name) ||
        !!materialsResponsibility ||
        quantitySignals.length > 0 ||
        !!scopeSummary,
    };
  }, [agreementMeta, materialsWho, measurementNotes, resolvedProjectFamily, selectedTemplateMeta]);
  const estimateContextSignature = useMemo(
    () =>
      JSON.stringify({
        agreementId,
        projectType: agreementMeta?.project_type || "",
        projectSubtype: agreementMeta?.project_subtype || "",
        projectFamilyKey: agreementMeta?.project_family_key || resolvedProjectFamily.project_family_key || "",
        projectFamilyLabel:
          agreementMeta?.project_family_label || resolvedProjectFamily.project_family_label || "",
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
    [agreementId, agreementMeta, milestones, resolvedProjectFamily.project_family_key, resolvedProjectFamily.project_family_label]
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
    applyAiMilestones,
    refreshPricingEstimate,
    estimateProject,
  } = useAgreementMilestoneAI({
    agreementId,
    locked: milestonesLocked || templateApplied,
    refreshAgreement: refreshAgreementMeta,
    refreshMilestones: refreshMilestonesSafe,
    onMilestonesReplaced: null,
    projectFamilyContext: resolvedProjectFamily,
  });
  const aiMilestonePreview = useMemo(
    () => (Array.isArray(aiPreview?.milestones) ? aiPreview.milestones : []),
    [aiPreview]
  );
  const hasAiMilestonePreview = aiMilestonePreview.length > 0;
  const aiMilestonePreviewQuestions = useMemo(
    () => (Array.isArray(aiPreview?.questions) ? aiPreview.questions : []),
    [aiPreview]
  );
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
  const estimateSuggestions = useMemo(
    () =>
      Array.isArray(estimatePreview?.milestone_suggestions)
        ? estimatePreview.milestone_suggestions
        : Array.isArray(estimatePreview?.suggested_milestones)
        ? estimatePreview.suggested_milestones
        : [],
    [estimatePreview]
  );
  const estimateBudgetValue = useMemo(() => {
    const parsed = parseAmountStrict(projectBudgetInput);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [projectBudgetInput]);
  const estimateSummaryMeta = useMemo(() => {
    if (!estimatePreview) return null;
    const explanation = explainBenchmarkSource(estimatePreview);
    const templateWeight = estimateWeightLabel(estimatePreview?.source_metadata?.template_weight);
    const learnedWeight = estimateWeightLabel(estimatePreview?.source_metadata?.learned_weight);
    const clarificationCount =
      (Array.isArray(estimatePreview?.price_adjustments) ? estimatePreview.price_adjustments.length : 0) +
      (Array.isArray(estimatePreview?.timeline_adjustments) ? estimatePreview.timeline_adjustments.length : 0);
    const fallbackMode =
      !estimatePreview?.learned_benchmark_used || safeStr(estimatePreview?.benchmark_source) === "seeded_only";
    const lowConfidence = safeStr(estimatePreview?.confidence_level).toLowerCase() === "low";
    return {
      explanation,
      templateWeight,
      learnedWeight,
      clarificationCount,
      fallbackMode,
      lowConfidence,
      fallbackMessage: fallbackMode
        ? "No strong learned benchmark is available yet, so this estimate is leaning on template baseline guidance."
        : "",
      confidenceMessage: lowConfidence
        ? "Limited completed-job data means these numbers should be treated as advisory planning guidance."
        : "",
      variabilityMessage: explainRangeVariability(estimatePreview),
    };
  }, [estimatePreview]);
  const contractorInsights = useMemo(() => estimatePreview?.contractor_insights || null, [estimatePreview]);
  const step2TemplateInsights = useMemo(
    () =>
      deriveTemplateInsights({
        milestones: effectiveMilestones,
        estimated_days: estimatePreview?.suggested_duration_days || agreementMeta?.estimated_days || 0,
        pricing:
          estimatePreview?.suggested_price_low && estimatePreview?.suggested_price_high
            ? {
                total_range: `${formatCurrency(estimatePreview.suggested_price_low)}${formatCurrency(
                  estimatePreview.suggested_price_high
                )}`,
              }
            : {},
        timeline: estimatePreview?.suggested_duration_days
          ? `About ${estimatePreview.suggested_duration_days} working days`
          : "",
      }),
    [
      agreementMeta?.estimated_days,
      effectiveMilestones,
      estimatePreview?.suggested_duration_days,
      estimatePreview?.suggested_price_high,
      estimatePreview?.suggested_price_low,
    ]
  );
  const step2InsightCards = useMemo(
    () =>
      buildActionableTemplateInsightCards({
        currentMilestoneCount: effectiveMilestones.length,
        contractorInsights,
        estimatePreview,
        templateInsights: step2TemplateInsights,
      }),
    [contractorInsights, effectiveMilestones.length, estimatePreview, step2TemplateInsights]
  );
  const suggestedPlan = useMemo(() => {
    const plan = estimatePreview?.suggested_plan;
    if (!plan || typeof plan !== "object") return null;
    const milestones = Array.isArray(plan?.milestones) ? plan.milestones : [];
    return {
      ...plan,
      milestones,
    };
  }, [estimatePreview]);
  const suggestedPlanBenchmarkSource = useMemo(() => {
    if (!suggestedPlan) return null;
    return explainPlanBenchmarkSource(suggestedPlan);
  }, [suggestedPlan]);
  const contractorInsightsConfidence = safeStr(contractorInsights?.confidence).toLowerCase();
  const contractorInsightsCountsVisible = contractorInsightsConfidence !== "low";
  const estimateGuidanceByMilestone = useMemo(() => {
    const rows = Array.isArray(effectiveMilestones) ? effectiveMilestones : [];
    if (!rows.length) return new Map();

    const suggestionById = new Map(
      estimateSuggestions.filter((row) => row?.milestone_id != null).map((row) => [row.milestone_id, row])
    );
    const enriched = rows.map((row, idx) => {
      const suggestion =
        suggestionById.get(row?.id) ||
        estimateSuggestions.find((item) => Number(item?.suggested_order || 0) === idx + 1) ||
        null;
      const suggestedAmount = parseAmountStrict(suggestion?.suggested_amount);
      const fallbackWeight = parseAmountStrict(row?.amount);
      return {
        row,
        idx,
        suggestion,
        weight:
          (isCommercialProject && Number.isFinite(fallbackWeight) && fallbackWeight > 0
            ? fallbackWeight
            : null) ??
          (Number.isFinite(suggestedAmount) && suggestedAmount > 0 ? suggestedAmount : null) ??
          (Number.isFinite(fallbackWeight) && fallbackWeight > 0 ? fallbackWeight : 1),
        suggestedAmount: Number.isFinite(suggestedAmount) && suggestedAmount > 0 ? suggestedAmount : null,
      };
    });
    const totalWeight = enriched.reduce((sum, item) => sum + Number(item.weight || 0), 0) || enriched.length || 1;
    const map = new Map();
    enriched.forEach((item) => {
      const share = Number(item.weight || 0) / totalWeight;
      const budgetSuggestion = estimateBudgetValue ? roundSuggestedAmount(estimateBudgetValue * share) : null;
      map.set(item.row?.id ?? `row-${item.idx + 1}`, {
        share,
        suggestedAmount: item.suggestedAmount,
        budgetSuggestion,
        durationDays: Number(item.suggestion?.suggested_duration_days || 0) || null,
      });
    });
    return map;
  }, [effectiveMilestones, estimateBudgetValue, estimateSuggestions, isCommercialProject]);
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

  function shapeAiMilestonePreview(preview) {
    if (!preview || !Array.isArray(preview.milestones)) return preview;
    if (preview?.raw?.clarification_shaped) return preview;

    const projectType =
      safeStr(agreementMeta?.project_type) ||
      safeStr(selectedTemplateMeta?.project_type) ||
      safeStr(resolvedProjectFamily.project_family_label);
    const projectSubtype =
      safeStr(agreementMeta?.project_subtype) ||
      safeStr(selectedTemplateMeta?.project_subtype) ||
      safeStr(resolvedProjectFamily.project_family_label);

    return {
      ...preview,
      milestones: buildClarificationAwareMilestoneDraft({
        projectType,
        projectSubtype,
        projectFamilyKey: resolvedProjectFamily.project_family_key,
        projectFamilyLabel: resolvedProjectFamily.project_family_label,
        description:
          safeStr(agreementMeta?.description || agreementMeta?.project_description || preview.scope_text),
        clarificationAnswers: agreementMeta?.ai_scope?.answers || {},
        amountMode: "preserve_base",
      baseMilestones: preview.milestones,
      }),
    };
  }

  function buildLocalMilestoneSuggestions() {
    const projectType = safeStr(agreementMeta?.project_type);
    const projectSubtype = safeStr(agreementMeta?.project_subtype);
    const projectTitle = safeStr(agreementMeta?.project_title || agreementMeta?.title);
    const projectScope = safeStr(
      agreementMeta?.scope_of_work || agreementMeta?.description || agreementMeta?.project_description
    );
    const familyText = [
      projectType,
      projectSubtype,
      projectTitle,
      projectScope,
      safeStr(projectContextSummary?.projectFamilyLabel),
      safeStr(projectContextSummary?.projectType),
    ]
      .join(" ")
      .toLowerCase();

    if (/(shed|storage shed|backyard shed|outbuilding)/.test(familyText)) {
      return [
        {
          title: "Site Prep and Foundation",
          description: "Prepare the site and pour or set the foundation.",
          recommended_duration_days: 2,
        },
        {
          title: "Floor and Framing",
          description: "Frame the floor, walls, and primary structure.",
          recommended_duration_days: 2,
        },
        {
          title: "Roof, Siding, and Weatherproofing",
          description: "Install roof, siding, and exterior weatherproofing.",
          recommended_duration_days: 3,
        },
        {
          title: "Doors, Windows, and Finish Details",
          description: "Install doors, windows, trim, and finish details.",
          recommended_duration_days: 1,
        },
        {
          title: "Final Inspection and Cleanup",
          description: "Complete inspection, punch list, and cleanup.",
          recommended_duration_days: 1,
        },
      ];
    }

    if (/(roof|roofing)/.test(familyText)) {
      return [
        {
          title: "Site Setup and Protection",
          description: "Protect the home, staging area, and landscaping before roof work begins.",
          recommended_duration_days: 1,
        },
        {
          title: "Tear-Off and Deck Prep",
          description: "Remove existing roofing and prepare the deck for repair or replacement.",
          recommended_duration_days: 1,
        },
        {
          title: "Roof Installation",
          description: "Install underlayment, flashing, and new roofing materials.",
          recommended_duration_days: 2,
        },
        {
          title: "Cleanup and Final Inspection",
          description: "Complete cleanup, magnet sweep, and final walkthrough.",
          recommended_duration_days: 1,
        },
      ];
    }

    if (/(concrete|slab|foundation|grading)/.test(familyText)) {
      return [
        {
          title: "Site Layout and Excavation",
          description: "Lay out the work area and complete excavation or grading.",
          recommended_duration_days: 1,
        },
        {
          title: "Forming and Reinforcement",
          description: "Set forms, reinforcement, and base preparation.",
          recommended_duration_days: 1,
        },
        {
          title: "Pour and Finish",
          description: "Place, finish, and cure the slab or foundation.",
          recommended_duration_days: 1,
        },
        {
          title: "Cleanup and Closeout",
          description: "Remove forms, clean the area, and complete closeout.",
          recommended_duration_days: 1,
        },
      ];
    }

    const fallbackRows = buildClarificationAwareMilestoneDraft({
      projectType,
      projectSubtype,
      projectFamilyKey: resolvedProjectFamily.project_family_key,
      projectFamilyLabel: resolvedProjectFamily.project_family_label,
      description: projectScope || projectTitle || projectType || "",
      clarificationAnswers: agreementMeta?.ai_scope?.answers || {},
      amountMode: "preserve_base",
      baseMilestones: [],
    });

    if (Array.isArray(fallbackRows) && fallbackRows.length) {
      return fallbackRows;
    }

    return [
      {
        title: "Project Setup",
        description: "Review scope, materials, and site setup.",
        recommended_duration_days: 1,
      },
      {
        title: "Work in Progress",
        description: "Complete the core build or installation work.",
        recommended_duration_days: 2,
      },
      {
        title: "Final Review",
        description: "Complete walkthrough, punch list, and cleanup.",
        recommended_duration_days: 1,
      },
    ];
  }

  function clearAiMilestonePreview({ clearSuggestedIds = true } = {}) {
    setAiPreview(null);
    setAiMilestonePreviewMode("");
    setAiMilestoneGenerationError("");
    if (clearSuggestedIds) {
      setAiSuggestedMilestoneIds([]);
    }
  }

  function materializeAiSuggestedMilestones(mode = "replace") {
    const source = Array.isArray(aiMilestonePreview) ? aiMilestonePreview : [];
    if (!source.length) return [];

    const previewRows = normalizeCardRows(
      source.map((row, idx) =>
        normalizeMilestoneForLocalFallback(
          {
            ...row,
            id: row?.milestone_id ?? row?.id ?? `ai-${Date.now()}-${idx + 1}`,
            order: row?.order ?? idx + 1,
          },
          idx + 1
        )
      )
    ).filter(Boolean);

    if (mode === "append") {
      return sortFallbackMilestones([
        ...effectiveMilestones,
        ...previewRows.map((row, idx) => ({
          ...row,
          order: effectiveMilestones.length + idx + 1,
        })),
      ]);
    }

    return sortFallbackMilestones(
      previewRows.map((row, idx) => ({
        ...row,
        order: idx + 1,
      }))
    );
  }

  function applyAiSuggestedMilestones(mode = "replace") {
    if (!hasAiMilestonePreview) {
      toast("No AI milestone preview is available yet.");
      return;
    }

    if (milestonesLocked) {
      lockToast();
      return;
    }
    if (templateApplied) {
      toast(
        "This agreement is template-driven. Use the template structure instead of applying AI milestone suggestions here.",
        {
          icon: "",
        }
      );
      return;
    }

    const nextRows = materializeAiSuggestedMilestones(mode);
    if (!nextRows.length) {
      toast("No milestone suggestions are available to apply.");
      return;
    }

    const nextIds = nextRows.map((row) => row?.id).filter(Boolean);
    setFallbackMilestones(nextRows);
    setExpandedMilestoneId(nextRows[0]?.id || null);
    setNewMilestoneOpen(false);
    setAiChangeSummary("AI suggested milestones are ready for review.");
    onAiUpdateFeedback("AI suggested milestones are ready for review.");
    clearAiMilestonePreview({ clearSuggestedIds: false });
    setAiSuggestedMilestoneIds(nextIds);
    toast.success(
      mode === "append"
        ? `Appended ${nextRows.length} suggested milestone${nextRows.length === 1 ? "" : "s"} for review.`
        : `Applied ${nextRows.length} suggested milestone${nextRows.length === 1 ? "" : "s"} for review.`
    );
  }

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

  function handleRunAiSuggest() {
    if (!agreementId) return;
    setAiMilestoneGenerationError("");
    if (milestonesLocked) {
      lockToast();
      return;
    }
    if (templateApplied) {
      toast("A template is already applied. Use the template-driven milestone structure instead of regenerating milestones with AI here.", {
        icon: "",
      });
      return;
    }

    setAiMilestoneGenerationBusy(true);
    setTimeout(() => {
      try {
        const previewRows = normalizeCardRows(
          buildLocalMilestoneSuggestions().map((row, idx) =>
            normalizeMilestoneForLocalFallback(
              {
                ...row,
                id: `ai-${idx + 1}`,
                order: idx + 1,
              },
              idx + 1
            )
          )
        ).filter(Boolean);

        const preview = {
          scope_text:
            safeStr(
              agreementMeta?.scope_of_work ||
                agreementMeta?.description ||
                agreementMeta?.project_description
            ) ||
            safeStr(agreementMeta?.project_title || agreementMeta?.title) ||
            safeStr(projectContextSummary?.projectFamilyLabel),
          milestones: previewRows,
          questions: aiMilestonePreviewQuestions.length
            ? aiMilestonePreviewQuestions
            : mergedClarificationQuestions,
          raw: { clarification_shaped: true },
        };

        setAiPreview(preview);
        setAiMilestonePreviewMode(effectiveMilestones.length ? "replace" : "apply");
        setAiSuggestedMilestoneIds([]);
        setAiChangeSummary("AI suggested milestones are ready for review.");
        onAiUpdateFeedback("AI suggested milestones are ready for review.");
        setNewMilestoneOpen(false);
        toast.success(
          `Generated ${previewRows.length} suggested milestone${previewRows.length === 1 ? "" : "s"}.`
        );
      } catch (err) {
        console.error("Step2 suggested milestone generation failed:", err);
        setAiPreview(null);
        setAiMilestoneGenerationError(
          safeStr(err?.response?.data?.detail) ||
            safeStr(err?.message) ||
            "Couldn't generate milestones. You can add milestones manually or try again."
        );
        toast.error("Couldn't generate milestones. You can add milestones manually or try again.");
      } finally {
        setAiMilestoneGenerationBusy(false);
      }
    }, 450);
  }

  async function handleApplyAiMilestonesBulk(mode) {
    if (!agreementId) return;
    if (!hasAiMilestonePreview) return;

    if (milestonesLocked) {
      lockToast();
      return;
    }
    if (templateApplied) {
      toast("This agreement is template-driven. AI bulk milestone replacement/appending is disabled here to avoid overwriting the template structure.", {
        icon: "",
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

    const shouldApply = window.confirm(
      "Apply pricing guidance to the current milestones' Existing amounts will be updated for review."
    );
    if (!shouldApply) return;

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
        safeStr(base?.title) !== safeStr(row?.title) ||
        safeStr(base?.description) !== safeStr(row?.description) ||
        amountsDifferMeaningfully(base?.amount, parseAmountStrict(row?.amount)) ||
        timelineDiffers(
          base,
          row?.start_date || row?.start,
          row?.completion_date || row?.end_date || row?.end
        )
        || Number(base?.order || 0) !== Number(row?.order || 0)
      );
    });

    if (!stagedRows.length) return 0;

    for (const row of stagedRows) {
      await updateMilestone({
        id: row.id,
        order: Number(row.order || 0) || null,
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
      setNewMilestoneOpen(false);
      onMLocalChange("title", "");
      onMLocalChange("start", "");
      onMLocalChange("end", "");
      onMLocalChange("amount", "");
      onMLocalChange("description", "");
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
          icon: "",
        });
      } else {
        toast("Quick review: clarifications available before continuing.", { icon: "" });
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

    const projectFamilyLabel =
      safeStr(agreementMeta?.project_family_label) ||
      safeStr(resolvedProjectFamily.project_family_label);
    const projectSubtype =
      safeStr(agreementMeta?.project_subtype) || projectFamilyLabel;
    const projectType =
      safeStr(agreementMeta?.project_type) || projectFamilyLabel;
    const description = safeStr(agreementMeta?.description || agreementMeta?.project_description);
    const clarificationAnswers = agreementMeta?.ai_scope?.answers || {};
    if (!projectSubtype && !projectType && !description) return;

    autoDraftAttemptedRef.current = true;

    (async () => {
      setAutoDraftBusy(true);
      try {
        const draftRows = buildClarificationAwareMilestoneDraft({
          projectSubtype,
          projectType,
          projectFamilyKey: resolvedProjectFamily.project_family_key,
          projectFamilyLabel: resolvedProjectFamily.project_family_label,
          description,
          clarificationAnswers,
          totalBudget: agreementMeta?.total_cost ?? 0,
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
        const feedback = "AI drafted your milestones  review and adjust as needed.";
        setAutoDraftBanner(feedback);
        setAiChangeSummary(feedback);
        onAiUpdateFeedback(feedback);
        await refreshMilestonesSafe();
      } catch (err) {
        console.error("Step2 suggested milestone generation failed:", err);
        setAiPreview(null);
        setAiMilestoneGenerationError(
          safeStr(err?.response?.data?.detail) ||
            safeStr(err?.message) ||
            "Couldn't generate milestones. You can add milestones manually or try again."
        );
        toast.error("Couldn't generate milestones. You can add milestones manually or try again.");
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
    resolvedProjectFamily.project_family_label,
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
        project_class: projectClass,
        project_family_key:
          agreementMeta?.project_family_key || resolvedProjectFamily.project_family_key || "",
        project_family_label:
          agreementMeta?.project_family_label || resolvedProjectFamily.project_family_label || "",
        payment_structure: agreementMeta?.payment_structure || "simple",
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
          project_class: projectClass,
          payment_structure: agreementMeta?.payment_structure || "simple",
        },
        milestones: effectiveMilestones,
        aiUpdateFeedback: aiChangeSummary,
        template_id:
          agreementMeta?.selected_template?.id ||
          agreementMeta?.selected_template_id ||
          null,
      }),
    }),
    [
      agreementId,
      agreementMeta,
      effectiveMilestones,
      mergedClarificationQuestions,
      aiChangeSummary,
      projectClass,
      resolvedProjectFamily.project_family_key,
      resolvedProjectFamily.project_family_label,
    ]
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
      <section
        className={`rounded-2xl border px-4 py-4 shadow-sm ${
          isCommercialProject
            ? "border-slate-300 bg-gradient-to-br from-slate-50 via-white to-blue-50/50"
            : "border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-sky-50/40"
        }`}
        data-testid="step2-workflow-panel"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
              {step2ModeMeta.workspaceEyebrow}
            </div>
            <h3 className="mt-1 text-xl font-semibold text-slate-950">{step2ModeMeta.workspaceTitle}</h3>
            <p className="mt-2 text-sm text-slate-600">{step2ModeMeta.workspaceDescription}</p>
          </div>
          <div className="grid min-w-[280px] grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Project path</div>
              <div className="mt-1 text-sm font-semibold text-slate-900" data-testid="step2-project-class-label">
                {projectClassLabel(projectClass)}
              </div>
              <div className="mt-1 text-xs text-slate-600">
                {isCommercialProject ? "Structured workflow" : "Homeowner-friendly workflow"}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {step2ModeMeta.timelineLabel}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {minStart && maxEnd ? `${friendly(minStart)}  ${friendly(maxEnd)}` : "Add dates to map timing"}
              </div>
              <div className="mt-1 text-xs text-slate-600">
                {effectiveMilestones.length} milestone{effectiveMilestones.length === 1 ? "" : "s"} planned
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {isCommercialProject ? "Billing structure" : "Planning style"}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {isProgressPayments
                  ? "Progress-payment aware"
                  : isCommercialProject
                  ? "Commercial milestone billing"
                  : "Simple milestone billing"}
              </div>
              <div className="mt-1 text-xs text-slate-600">
                {isProgressPayments
                  ? "Supports draw-request planning after signing."
                  : isCommercialProject
                  ? "Keeps commercial milestones structured without draw schedules."
                  : "Designed to stay easy for customers to follow."}
              </div>
            </div>
          </div>
        </div>
      </section>

      <CommercialPaymentOverviewPanel
        agreementMeta={agreementMeta}
        effectiveMilestones={effectiveMilestones}
        paymentStructure={paymentStructure}
      />

      {milestonesLocked ? (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold">Locked</div>
          <div className="mt-1 text-xs text-amber-900/90">
            Milestones are read-only. {milestonesLockReason || "Create an amendment to change milestones."}
          </div>
        </div>
      ) : null}

      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="step2-work-plan-summary">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold text-slate-950">Review the work plan</div>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                  Path: {projectClassLabel(projectClass)}
                </span>
              </div>
            <div className="mt-1 text-sm text-slate-600">
              Review and adjust the milestone cards below. Keep the plan simple enough to scan at a glance.
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-700">
              <span className="rounded-full bg-slate-50 px-2 py-1 font-medium">
                {effectiveMilestones.length} milestone{effectiveMilestones.length === 1 ? "" : "s"}
              </span>
              <span className="rounded-full bg-slate-50 px-2 py-1 font-medium">
                Total: {formatCurrency(total)}
              </span>
              <span className="rounded-full bg-slate-50 px-2 py-1 font-medium">
                Duration: {estimateSummaryMeta?.variabilityMessage ? estimatePreview?.suggested_duration_days ? `${estimatePreview.suggested_duration_days} days` : "Edit below" : "Edit below"}
              </span>
              <span className="rounded-full bg-sky-50 px-2 py-1 font-medium text-sky-700">
                {projectContextSummary.projectFamilyLabel || projectContextSummary.projectType || "Project path"}
              </span>
            </div>
          </div>
        </div>
      </section>

      {false && recurringSummary ? (
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
              ? `  Next occurrence: ${recurringSummary.nextOccurrence}`
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
                    {row.title}  Visit {row.sequence_number}
                  </div>
                  <div className="mt-1">
                    Service date: {row.scheduled_service_date || "Pending"}
                    {row.amount ? `  ${formatCurrency(row.amount)}` : ""}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {false && (
        <StartWithAIEntry
        className=""
        testId="milestones-ai-entry"
        title={step2ModeMeta.aiEntryTitle}
        description={step2ModeMeta.aiEntryDescription}
        context={assistantContext}
        onAction={handleAssistantAction}
      />
      )}

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

      {false && hasPlanningDetails ? (
        <details className="mb-3 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <summary className="cursor-pointer list-none px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Planning details</div>
                <div className="mt-1 text-xs text-slate-600">
                  {step2ModeMeta.planningDetailsDescription}
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

      {false && showAssistantMilestoneSuggestions ? (
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
                {assistantApplyingMilestones ? "Adding" : "Add Suggested Milestones"}
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
            {step2ModeMeta.workspaceEyebrow}
          </div>
          <h3 className="mt-1 text-xl font-semibold text-slate-950">{step2ModeMeta.workspaceTitle}</h3>
          <div className="mt-1 text-sm text-slate-600">
            {step2ModeMeta.workspaceDescription}
          </div>
        </div>
        <div className="text-sm text-gray-600">
          {step2ModeMeta.timelineLabel}:{" "}
          {minStart && maxEnd ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
              {friendly(minStart)} - {friendly(maxEnd)} (est.)
            </span>
          ) : (
            <span className="text-gray-400">add dates to see range</span>
          )}
        </div>
      </div>

      {showPricingReviewPrompt ? (
        <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/85 px-4 py-3 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-semibold text-indigo-950">Pricing suggestions are ready to review</div>
              <div className="mt-1 text-xs text-indigo-800">
                {pricingReviewState.count} milestone{pricingReviewState.count === 1 ? "" : "s"} have new suggested amount{pricingReviewState.count === 1 ? "" : "s"}.
                {pricingReviewState.count > 0 ? (
                  <>
                    {" "}Current {formatCurrency(pricingReviewState.currentTotal)} - Suggested {formatCurrency(pricingReviewState.suggestedTotal)}
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

      <section
        className="mb-4 rounded-2xl border border-sky-200 bg-sky-50/70 shadow-sm"
        data-testid="step2-plan-guidance-card"
      >
        <div className="px-4 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold text-slate-950">Plan Guidance</div>
                <span className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-sky-700">
                  Advisory only
                </span>
              </div>
              <div className="mt-1 text-sm text-slate-700">
                Keep these suggestions in view while you edit milestones. They're advisory and easy to ignore.
              </div>
              <ul className="mt-3 space-y-1 text-sm text-slate-700">
                <li>{step2InsightCards.milestones.body}</li>
                <li>{step2InsightCards.timeline.body}</li>
                <li>{step2InsightCards.pricing.body}</li>
                <li>
                  {step2TemplateInsights.completeness.has_materials
                    ? "Materials guidance is included."
                    : "Materials guidance could benefit from more detail."}
                </li>
                <li>
                  {step2TemplateInsights.completeness.has_clarifications
                    ? "Clarification guidance is included."
                    : "Clarification guidance could benefit from more detail."}
                </li>
              </ul>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleRunAiSuggest}
                  disabled={aiLoading || aiMilestoneGenerationBusy || milestonesLocked || templateApplied}
                  className="rounded-xl border border-sky-300 bg-white px-3 py-2 text-sm font-medium text-sky-800 hover:bg-sky-50 disabled:opacity-60"
                  data-testid="step2-generate-suggested-milestones"
                >
                  {aiLoading || aiMilestoneGenerationBusy
                    ? "Generating milestones..."
                    : "Generate Suggested Milestones"}
                </button>
              </div>
              {aiLoading || aiMilestoneGenerationBusy ? (
                <div
                  className="mt-3 rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs text-slate-600"
                  data-testid="step2-ai-generation-progress-card"
                  aria-live="polite"
                >
                  AI is turning the project scope into work phases.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {((aiError || aiMilestoneGenerationError) && !hasAiMilestonePreview) ? (
        <section
          className="mb-4 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-4 shadow-sm"
          data-testid="step2-ai-generation-error-card"
          aria-live="polite"
        >
          <div className="text-sm font-semibold text-rose-900">Couldn&apos;t generate milestones</div>
          <div className="mt-1 text-sm text-rose-800">
            {aiMilestoneGenerationError || aiError || "You can add milestones manually or try again."}
          </div>
          <div className="mt-1 text-sm text-rose-800">
            You can add milestones manually or try again.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleRunAiSuggest}
              disabled={aiLoading || aiMilestoneGenerationBusy || milestonesLocked || templateApplied}
              className="rounded-xl border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-50 disabled:opacity-60"
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={() => setNewMilestoneOpen(true)}
              className="rounded-xl border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-50"
            >
              Add Milestone
            </button>
          </div>
        </section>
      ) : null}

      {hasAiMilestonePreview ? (
        <section
          className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-4 shadow-sm"
          data-testid="step2-ai-milestone-preview-card"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-amber-950">Suggested milestones</div>
            {effectiveMilestones.length ? (
              <span className="rounded-full border border-amber-200 bg-white px-2 py-1 text-[11px] font-semibold text-amber-700">
                This will replace your current milestone plan.
              </span>
            ) : (
              <span className="rounded-full border border-amber-200 bg-white px-2 py-1 text-[11px] font-semibold text-amber-700">
                Review before applying
              </span>
            )}
          </div>
          <div className="mt-1 text-sm text-amber-950/80">
            AI is turning the project scope into work phases. Review the draft before applying it.
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {aiMilestonePreview.map((row, idx) => {
              const previewAmount = Number(row?.amount || row?.suggested_amount || 0);
              const previewStart = friendly(toDateOnly(row?.start_date || row?.start));
              const previewDue = friendly(toDateOnly(row?.completion_date || row?.end_date || row?.end));
              const previewDuration = row?.recommended_duration_days
                ? formatDurationDays(row.recommended_duration_days)
                : "";
              return (
                <div
                  key={`${row?.id || row?.milestone_id || row?.title || "ai"}-${idx}`}
                  className="rounded-xl border border-amber-200 bg-white px-3 py-3 shadow-sm"
                >
                  <div className="text-sm font-semibold text-slate-950">{row?.title || `Milestone ${idx + 1}`}</div>
                  {safeStr(row?.description) ? (
                    <div className="mt-1 text-xs text-slate-600">{row.description}</div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
                    {previewDuration ? (
                      <span className="rounded-full bg-slate-50 px-2 py-1 font-medium">{previewDuration}</span>
                    ) : null}
                    {Number.isFinite(previewAmount) && previewAmount > 0 ? (
                      <span className="rounded-full bg-slate-50 px-2 py-1 font-medium">
                        {formatCurrency(previewAmount)}
                      </span>
                    ) : null}
                    {previewStart || previewDue ? (
                      <span className="rounded-full bg-slate-50 px-2 py-1 font-medium">
                        {previewStart || "Start"} - {previewDue || "Due"}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {aiMilestonePreviewQuestions.length ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-white px-3 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                Related clarifications
              </div>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                {aiMilestonePreviewQuestions.slice(0, 3).map((q, idx) => (
                  <li key={`${q?.key || "q"}-${idx}`}>- {safeStr(q?.label) || safeStr(q?.question)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {effectiveMilestones.length ? (
              <>
                <button
                  type="button"
                  onClick={() => applyAiSuggestedMilestones("replace")}
                  disabled={aiLoading || milestonesLocked || templateApplied}
                  className="rounded-xl bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                  data-testid="step2-apply-suggested-milestones"
                >
                  Replace Existing Milestones
                </button>
                <button
                  type="button"
                  onClick={() => applyAiSuggestedMilestones("append")}
                  disabled={aiLoading || milestonesLocked || templateApplied}
                  className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-60"
                >
                  Append to Existing Milestones
                </button>
                <button
                  type="button"
                  onClick={clearAiMilestonePreview}
                  disabled={aiLoading}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => applyAiSuggestedMilestones("replace")}
                  disabled={aiLoading || milestonesLocked || templateApplied}
                  className="rounded-xl bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                  data-testid="step2-apply-suggested-milestones"
                >
                  Apply Suggested Milestones
                </button>
                <button
                  type="button"
                  onClick={clearAiMilestonePreview}
                  disabled={aiLoading}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </section>
      ) : null}

      {estimatePreview ? (
        <details
          className="mb-4 rounded-2xl border border-slate-200 bg-white shadow-sm"
          data-testid="step2-estimate-guidance-details"
        >
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-900">
            View estimate guidance
          </summary>
          <div className="border-t border-slate-200 px-4 py-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cost range</div>
                <div className="mt-1 text-lg font-semibold text-slate-900" data-testid="step2-estimate-total">
                  {formatCurrency(estimatePreview.suggested_price_low)} - {formatCurrency(estimatePreview.suggested_price_high)}
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  Centered around {formatCurrency(estimatePreview.suggested_total_price)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Duration range</div>
                <div className="mt-1 text-lg font-semibold text-slate-900" data-testid="step2-estimate-duration">
                  {formatDurationDays(estimatePreview.suggested_duration_low)} - {formatDurationDays(estimatePreview.suggested_duration_high)}
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  Typical pace: {formatDurationDays(estimatePreview.suggested_duration_days)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Confidence</div>
                <div className="mt-1 text-sm font-semibold text-slate-900" data-testid="step2-estimate-confidence">
                  {formatEstimateConfidence(estimatePreview.confidence_level) || "Estimate available"}
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  {estimateSummaryMeta?.lowConfidence ? "Limited data available." : estimatePreview.confidence_reasoning}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Optional Project Budget</div>
              <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="text-sm text-slate-700">
                  {step2ModeMeta.budgetDescription}
                </div>
                <div className="w-full max-w-xs">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Planning budget
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={projectBudgetInput}
                    onChange={(e) => setProjectBudgetInput(e.target.value)}
                    placeholder={safeStr(estimatePreview?.suggested_total_price) || "Enter budget"}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
                    data-testid="step2-project-budget-input"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  handleRefreshProjectEstimate({
                    successMessage: "Estimate refreshed from current project details.",
                  }).catch((err) =>
                    toast.error(err?.response?.data?.detail || err?.message || "Estimate refresh failed.")
                  );
                }}
                disabled={estimateRefreshing}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                data-testid="step2-refresh-estimate"
              >
                {estimateRefreshing ? "Refreshing Estimate" : "Refresh Estimate"}
              </button>
              <button
                type="button"
                onClick={applyEstimateSuggestedAmounts}
                disabled={milestonesLocked}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                data-testid="step2-apply-estimate-amounts"
              >
                Apply Suggested Amounts
              </button>
              <button
                type="button"
                onClick={applyEstimateSuggestedTimeline}
                disabled={milestonesLocked}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                data-testid="step2-apply-estimate-timeline"
              >
                Apply Suggested Timeline
              </button>
            </div>
          </div>
        </details>
      ) : null}

      {false && suggestedPlan ? (
        <section
          className="rounded-2xl border border-emerald-200 bg-emerald-50/60 shadow-sm"
          data-testid="step2-suggested-plan-card"
        >
          <div className="px-4 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold text-emerald-950">Suggested Plan</div>
                  <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                    Based on the project details provided
                  </span>
                </div>
                <div className="mt-1 text-sm text-emerald-950/80">
                  {suggestedPlan?.project_family_label || "Project review"} and the current agreement details shape this recommended starting plan.
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-emerald-950/80 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-emerald-200 bg-white px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Project type</div>
                    <div className="mt-1 font-semibold text-slate-900" data-testid="step2-suggested-plan-type">
                      {suggestedPlan?.recommended_project_type || suggestedPlan?.project_family_label || "General project review"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-white px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Workflow</div>
                    <div className="mt-1 font-semibold text-slate-900" data-testid="step2-suggested-plan-workflow">
                      {suggestedPlan?.suggested_workflow || "General project review"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-white px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Template</div>
                    <div className="mt-1 font-semibold text-slate-900" data-testid="step2-suggested-plan-template">
                      {suggestedPlan?.recommended_template_name || suggestedPlan?.suggested_template_label || "Suggested template"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-white px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Confidence</div>
                    <div className="mt-1 font-semibold text-slate-900" data-testid="step2-suggested-plan-confidence">
                      {formatEstimateConfidence(suggestedPlan?.confidence_level) || "Advisory"}
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-emerald-200 bg-white px-3 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Suggested budget</div>
                    <div className="mt-1 text-base font-semibold text-slate-900" data-testid="step2-suggested-plan-budget">
                      {formatCurrency(suggestedPlan?.suggested_budget_low)} - {formatCurrency(suggestedPlan?.suggested_budget_high)}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      Centered around {formatCurrency(suggestedPlan?.suggested_budget_center || estimatePreview?.suggested_total_price)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-white px-3 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Suggested duration</div>
                    <div className="mt-1 text-base font-semibold text-slate-900" data-testid="step2-suggested-plan-duration">
                      {formatDurationDays(suggestedPlan?.suggested_duration_low_days)} - {formatDurationDays(suggestedPlan?.suggested_duration_high_days)}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      {suggestedPlan?.suggested_duration_days
                        ? `Typical pace: ${formatDurationDays(suggestedPlan.suggested_duration_days)}`
                        : "Plan timing stays editable."}
                    </div>
                  </div>
                </div>
                {suggestedPlan?.confidence_reasoning ? (
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs text-slate-700">
                    {suggestedPlan.confidence_reasoning}
                  </div>
                ) : null}
                {suggestedPlanBenchmarkSource ? (
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-white px-3 py-3" data-testid="step2-suggested-plan-benchmark-source">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Benchmark source</div>
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        {suggestedPlanBenchmarkSource.sourceType}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-slate-700">
                      {suggestedPlanBenchmarkSource.explanation}
                    </div>
                    {suggestedPlanBenchmarkSource.countText ? (
                      <div className="mt-1 text-xs text-slate-600">
                        {suggestedPlanBenchmarkSource.countText}
                      </div>
                    ) : null}
                    <div className="mt-2 text-[11px] font-medium text-slate-600">
                      Confidence: {suggestedPlanBenchmarkSource.confidence}
                    </div>
                  </div>
                ) : null}
                {contractorInsights ? (
                  <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-3" data-testid="step2-contractor-insights-card">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">Contractor insights</div>
                      <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                        {formatEstimateConfidence(contractorInsights?.confidence) || "Advisory"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-700">
                      {contractorInsightsCountsVisible
                        ? `Based on ${contractorInsights?.sample_sizes?.platform || 0} platform projects, ${contractorInsights?.sample_sizes?.regional || 0} market projects, and ${contractorInsights?.sample_sizes?.contractor || 0} of your completed jobs.`
                        : "Broad guidance only until more completed-job data is available."}
                    </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                    <div className="rounded-lg border border-sky-100 bg-white px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">Pricing vs platform</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {safeStr(contractorInsights?.pricing_delta_vs_platform?.direction) === "above"
                            ? "Above average"
                            : safeStr(contractorInsights?.pricing_delta_vs_platform?.direction) === "below"
                            ? "Below average"
                            : "Close to average"}
                        </div>
                        {contractorInsightsCountsVisible ? (
                          <div className="mt-1 text-xs text-slate-600">{contractorInsights?.pricing_delta_vs_platform?.explanation}</div>
                        ) : null}
                      </div>
                      <div className="rounded-lg border border-sky-100 bg-white px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">Duration vs platform</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {safeStr(contractorInsights?.duration_delta_vs_platform?.direction) === "above"
                            ? "Longer than average"
                            : safeStr(contractorInsights?.duration_delta_vs_platform?.direction) === "below"
                            ? "Shorter than average"
                            : "Close to average"}
                        </div>
                        {contractorInsightsCountsVisible ? (
                          <div className="mt-1 text-xs text-slate-600">{contractorInsights?.duration_delta_vs_platform?.explanation}</div>
                        ) : null}
                      </div>
                      <div className="rounded-lg border border-sky-100 bg-white px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">Milestone complexity</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {safeStr(contractorInsights?.milestone_count_delta?.direction) === "above"
                            ? "More detailed than peers"
                            : safeStr(contractorInsights?.milestone_count_delta?.direction) === "below"
                            ? "Simpler than peers"
                            : "Close to peers"}
                        </div>
                        {contractorInsightsCountsVisible ? (
                          <div className="mt-1 text-xs text-slate-600">{contractorInsights?.milestone_count_delta?.explanation}</div>
                        ) : null}
                      </div>
                      <div className="rounded-lg border border-sky-100 bg-white px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">Dispute pattern</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {safeStr(contractorInsights?.dispute_rate_comparison?.direction) === "above"
                            ? "Above market"
                            : safeStr(contractorInsights?.dispute_rate_comparison?.direction) === "below"
                            ? "Below market"
                            : safeStr(contractorInsights?.dispute_rate_comparison?.direction) === "similar"
                            ? "Similar to market"
                            : "Not enough data yet"}
                        </div>
                        <div className="mt-1 text-xs text-slate-600">{contractorInsights?.dispute_rate_comparison?.explanation}</div>
                      </div>
                    </div>
                    {Array.isArray(contractorInsights?.suggested_adjustments) && contractorInsights.suggested_adjustments.length ? (
                      <div className="mt-3 rounded-xl border border-sky-100 bg-white px-3 py-3" data-testid="step2-contractor-insights-adjustments">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">Suggested adjustments</div>
                        <div className="mt-1 text-xs text-slate-600">
                          Optional ideas based on the same benchmark comparisons.
                        </div>
                        <ul className="mt-2 space-y-2 text-xs text-slate-700">
                          {contractorInsights.suggested_adjustments.slice(0, 3).map((item, index) => (
                            <li
                              key={`${item?.suggestion_type || "suggestion"}-${index}`}
                              className="rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2"
                              data-testid="step2-contractor-insights-adjustment-item"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                                  {safeStr(item?.suggestion_type) || "Adjustment"}
                                </span>
                                <span className="text-[11px] font-medium text-slate-500">
                                  {formatEstimateConfidence(item?.suggestion_confidence) || "Optional"}
                                </span>
                              </div>
                              <div className="mt-1">{safeStr(item?.suggestion_text)}</div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {Array.isArray(contractorInsights?.explanation_strings) && contractorInsights.explanation_strings.length ? (
                      <ul className="mt-3 space-y-1 text-xs text-slate-700">
                        {contractorInsights.explanation_strings.slice(0, 3).map((point, index) => (
                          <li key={`${point}-${index}`} className="flex gap-2">
                            <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" aria-hidden="true" />
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                {Array.isArray(suggestedPlan?.explanation_points) && suggestedPlan.explanation_points.length ? (
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-white px-3 py-3" data-testid="step2-suggested-plan-why">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Why this plan</div>
                    <ul className="mt-2 space-y-1 text-xs text-slate-700">
                      {suggestedPlan.explanation_points.slice(0, 4).map((point, index) => (
                        <li key={`${point}-${index}`} className="flex gap-2">
                          <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    applyEstimateSuggestedAmounts();
                    applyEstimateSuggestedTimeline();
                  }}
                  disabled={milestonesLocked}
                  className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                  data-testid="step2-apply-suggested-plan"
                >
                  Use Suggested Plan
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-emerald-200 bg-white px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Milestone allocation</div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {Array.isArray(suggestedPlan?.milestones) && suggestedPlan.milestones.length ? (
                  suggestedPlan.milestones.map((row) => (
                    <div key={`${row.order || row.title}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                      <div className="text-sm font-semibold text-slate-900">{row.title}</div>
                      <div className="mt-1 text-xs text-slate-600">
                        Share: <span className="font-semibold text-slate-900">{formatPercent(row.allocation_percent)}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-600">
                        Duration: <span className="font-semibold text-slate-900">{formatDurationDays(row.suggested_duration_days)}</span>
                      </div>
                      {row.note ? <div className="mt-1 text-xs text-slate-600">{row.note}</div> : null}
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-slate-600">Suggested milestone allocation will appear here when the plan is available.</div>
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {false && estimatePreview ? (
        <section
          className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-emerald-50/40 shadow-sm"
          data-testid="step2-estimate-panel"
        >
          <div className="px-4 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold text-slate-900">{step2ModeMeta.estimateTitle}</div>
                  <span
                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600"
                    data-testid="step2-estimate-mode-badge"
                  >
                    {projectClassLabel(projectClass)}
                  </span>
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {estimateSummaryMeta?.explanation || step2ModeMeta.estimateDescription}
                </div>
                {estimateBanner ? (
                  <div
                    className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
                    data-testid="step2-estimate-banner"
                  >
                    {estimateBanner}
                  </div>
                ) : null}
                {estimateSummaryMeta?.fallbackMode ? (
                  <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                    {estimateSummaryMeta.fallbackMessage}
                  </div>
                ) : null}
                {estimateSummaryMeta?.lowConfidence ? (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {estimateSummaryMeta.confidenceMessage}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleRefreshProjectEstimate({
                      successMessage: "Estimate refreshed from current project details.",
                    }).catch((err) =>
                      toast.error(err?.response?.data?.detail || err?.message || "Estimate refresh failed.")
                    );
                  }}
                  disabled={estimateRefreshing}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  data-testid="step2-refresh-estimate"
                >
                  {estimateRefreshing ? "Refreshing Estimate" : "Refresh Estimate"}
                </button>
                <button
                  type="button"
                  onClick={applyEstimateSuggestedAmounts}
                  disabled={milestonesLocked}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  data-testid="step2-apply-estimate-amounts"
                >
                  Apply Suggested Amounts
                </button>
                <button
                  type="button"
                  onClick={applyEstimateSuggestedTimeline}
                  disabled={milestonesLocked}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  data-testid="step2-apply-estimate-timeline"
                >
                  Apply Suggested Timeline
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <InsightCard
                title={step2InsightCards.milestones.title}
                body={step2InsightCards.milestones.body}
                actionLabel={step2InsightCards.milestones.actionLabel}
                onAction={handleRunAiSuggest}
                actionTestId="step2-generate-suggested-milestones"
                dataTestId={step2InsightCards.milestones.testId}
                disabled={milestonesLocked}
              />
              <InsightCard
                title={step2InsightCards.pricing.title}
                body={step2InsightCards.pricing.body}
                actionLabel={step2InsightCards.pricing.actionLabel}
                onAction={applyEstimateSuggestedAmounts}
                actionTestId="step2-apply-pricing-guidance"
                dataTestId={step2InsightCards.pricing.testId}
                disabled={milestonesLocked}
              />
              <InsightCard
                title={step2InsightCards.timeline.title}
                body={step2InsightCards.timeline.body}
                dataTestId={step2InsightCards.timeline.testId}
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cost range</div>
                <div className="mt-1 text-lg font-semibold text-slate-900" data-testid="step2-estimate-total">
                  {formatCurrency(estimatePreview.suggested_price_low)} - {formatCurrency(estimatePreview.suggested_price_high)}
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  Centered around {formatCurrency(estimatePreview.suggested_total_price)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Duration range</div>
                <div className="mt-1 text-lg font-semibold text-slate-900" data-testid="step2-estimate-duration">
                  {formatDurationDays(estimatePreview.suggested_duration_low)} - {formatDurationDays(estimatePreview.suggested_duration_high)}
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  Typical pace: {formatDurationDays(estimatePreview.suggested_duration_days)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Confidence</div>
                <div className="mt-1 text-sm font-semibold text-slate-900" data-testid="step2-estimate-confidence">
                  {formatEstimateConfidence(estimatePreview.confidence_level) || "Estimate available"}
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  {estimateSummaryMeta?.lowConfidence ? "Limited data available." : estimatePreview.confidence_reasoning}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Based on</div>
                <div className="mt-1 text-sm font-semibold text-slate-900" data-testid="step2-estimate-source">
                  {safeStr(estimatePreview.template_used) || "Project benchmark"}
                </div>
                <div className="mt-1 text-xs text-slate-600">{estimateSummaryMeta?.explanation}</div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Optional Project Budget</div>
                  <div className="mt-1 text-xs text-slate-600">
                    {step2ModeMeta.budgetDescription}
                  </div>
                </div>
                <div className="w-full max-w-xs">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Planning budget
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={projectBudgetInput}
                    onChange={(e) => setProjectBudgetInput(e.target.value)}
                    placeholder={safeStr(estimatePreview?.suggested_total_price) || "Enter budget"}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
                    data-testid="step2-project-budget-input"
                  />
                </div>
              </div>
            </div>

            <details className="mt-4 rounded-xl border border-slate-200 bg-white">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-900">
                Estimate details
              </summary>
              <div className="border-t border-slate-200 px-4 py-4">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Weighting</div>
                    <div className="mt-2 text-sm text-slate-700">
                      Template defaults: <span className="font-semibold text-slate-900">{estimateSummaryMeta?.templateWeight}</span>
                    </div>
                    <div className="mt-1 text-sm text-slate-700">
                      Learned job data: <span className="font-semibold text-slate-900">{estimateSummaryMeta?.learnedWeight}</span>
                    </div>
                    <div className="mt-2 text-xs text-slate-600">
                      {isCommercialProject
                        ? "Learned data only shifts commercial guidance when similar completed jobs are available."
                        : "Learned data influences the estimate only when matching benchmark rows are available."}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Clarification impact</div>
                    {estimateSummaryMeta?.clarificationCount ? (
                      <div className="mt-2 space-y-2 text-xs text-slate-700">
                        {Array.isArray(estimatePreview?.price_adjustments) && estimatePreview.price_adjustments.length ? (
                          <div>
                            <div className="font-semibold text-slate-900">Price guidance</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {estimatePreview.price_adjustments.map((row, idx) => (
                                <span key={`price-adjustment-${idx}`} className="rounded-full bg-white px-2 py-1 font-medium text-slate-700">
                                  {row?.label}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {Array.isArray(estimatePreview?.timeline_adjustments) && estimatePreview.timeline_adjustments.length ? (
                          <div>
                            <div className="font-semibold text-slate-900">Timeline guidance</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {estimatePreview.timeline_adjustments.map((row, idx) => (
                                <span key={`timeline-adjustment-${idx}`} className="rounded-full bg-white px-2 py-1 font-medium text-slate-700">
                                  {row?.label}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-slate-600">
                        Current clarification answers did not materially change the baseline estimate.
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Range variability</div>
                    <div className="mt-2 text-sm text-slate-700">{estimateSummaryMeta?.variabilityMessage}</div>
                    <div className="mt-2 text-xs text-slate-600">
                      {isCommercialProject
                        ? "Guidance stays advisory so you can refine the schedule of values, sequencing, and pricing freely."
                        : "Estimates remain advisory so you can adjust milestone scope, pricing, and timing freely."}
                    </div>
                  </div>
                </div>
              </div>
            </details>
          </div>
        </section>
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

      {false && aiPreview ? (
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
                <strong>{m.title}</strong>  ${Number(m.amount || 0).toFixed(2)}
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
              {aiApplying ? "Applying" : "Replace Milestones (Bulk)"}
            </button>
            <button
              type="button"
              onClick={() => handleApplyAiMilestonesBulk("append")}
              disabled={aiApplying || milestonesLocked || templateApplied}
              className="rounded border px-3 py-2 text-sm disabled:opacity-60"
            >
              {aiApplying ? "Applying" : "Append Milestones (Bulk)"}
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

      <section className="rounded-3xl border border-slate-300 bg-white p-5 shadow-md ring-1 ring-slate-100" data-testid="step2-milestone-card-list">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h4 className="text-base font-semibold text-slate-950">
              {isCommercialProject ? "Review the schedule of values" : "Review the work plan"}
            </h4>
            <p className="mt-1 text-sm text-slate-600">
              {isCommercialProject
                ? "Expand a card to edit it inline. Drag cards to reorder the schedule."
                : "Expand a card to edit it inline. Drag cards to reorder the plan."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setNewMilestoneOpen((open) => !open)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              disabled={milestonesLocked}
              data-testid="step2-add-milestone"
            >
              {newMilestoneOpen ? "Hide Add Milestone" : "+ Add Milestone"}
            </button>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-600">
          AI milestone generation coming next.
        </div>

        {newMilestoneOpen ? (
          <div
            className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 shadow-sm"
            data-testid="step2-new-milestone-card"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-950">
                  {isCommercialProject ? "New schedule item" : "New milestone"}
                </div>
                <div className="mt-1 text-xs text-slate-600">Add one card at a time so the plan stays easy to scan.</div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <input
                ref={newMilestoneTitleRef}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-4"
                placeholder="Title"
                name="title"
                value={mLocal.title}
                onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
                disabled={milestonesLocked}
                data-testid="step2-new-milestone-title"
              />
              <input
                type="date"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-3"
                name="start"
                value={mLocal.start || ""}
                onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
                disabled={milestonesLocked}
                data-testid="step2-new-milestone-start"
              />
              <input
                type="date"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-3"
                name="end"
                value={mLocal.end || ""}
                onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
                disabled={milestonesLocked}
                data-testid="step2-new-milestone-due"
              />
              <input
                type="number"
                min="0.01"
                step="0.01"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                placeholder={step2ModeMeta.amountLabel}
                name="amount"
                value={mLocal.amount}
                onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
                disabled={milestonesLocked}
                data-testid="step2-new-milestone-amount"
              />
              <div className="md:col-span-12">
                <textarea
                  className="w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  rows={3}
                  placeholder="Description (details, materials, notes)"
                  name="description"
                  value={mLocal.description}
                  onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
                  disabled={milestonesLocked}
                  data-testid="step2-new-milestone-description"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  handleManualSave().catch((e) =>
                    toast.error(e?.response?.data?.detail || e?.message || "Save failed.")
                  )
                }
                className="rounded-xl bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
                disabled={milestonesLocked}
                data-testid="step2-save-new-milestone"
              >
                {isCommercialProject ? "Add Schedule Item" : "Add Milestone"}
              </button>
              <button
                type="button"
                onClick={() => setNewMilestoneOpen(false)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {isProgressPayments || isCommercialProject ? (
          <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 text-sm text-indigo-900">
            <div className="font-semibold">
              {isProgressPayments ? step2ModeMeta.progressPanelTitle : step2ModeMeta.simplePanelTitle}
            </div>
            <div className="mt-1">
              {isProgressPayments ? step2ModeMeta.progressPanelBody : step2ModeMeta.simplePanelBody}
            </div>
          </div>
        ) : null}

        {effectiveMilestones.length ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="rounded-full bg-slate-50 px-2 py-1 font-medium">
                {effectiveMilestones.length} milestone{effectiveMilestones.length === 1 ? "" : "s"}
              </span>
              <span className="rounded-full bg-slate-50 px-2 py-1 font-medium">
                Total: {formatCurrency(total)}
              </span>
              <span className="rounded-full bg-slate-50 px-2 py-1 font-medium">
                Path: {projectContextSummary.projectFamilyLabel || projectContextSummary.projectType || projectClassLabel(projectClass)}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {normalizeCardRows(effectiveMilestones).map((m, idx) => {
                const estimate = getEstimateAssistMeta(m);
                const projectEstimateGuidance =
                  estimateGuidanceByMilestone.get(m?.id ?? `row-${idx + 1}`) || null;
                const aiHighlight = m?.id != null ? aiHighlights[`milestone:${m.id}`] : null;
                const isAiSuggested = m?.id != null && aiSuggestedMilestoneIds.includes(m.id);
                const isExpanded = expandedMilestoneId === m.id;
                const summaryStart = friendly(toDateOnly(m.start_date || m.start));
                const summaryDue = friendly(toDateOnly(m.completion_date || m.end_date || m.end));
                return (
                  <article
                    key={m.id || `${m.title}-${idx}`}
                    className={`rounded-2xl border bg-white p-4 shadow-sm transition-shadow ${
                      aiHighlight ? "border-amber-300 ring-2 ring-amber-100" : "border-slate-200"
                    } ${isExpanded ? "shadow-md" : ""}`}
                    data-testid={`step2-milestone-card-${m.id || idx + 1}`}
                    draggable={!milestonesLocked}
                    onDragStart={() => {
                      dragSourceIndexRef.current = idx;
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      const from = dragSourceIndexRef.current;
                      if (from == null || from === idx) return;
                      moveCardMilestone(from, idx);
                      dragSourceIndexRef.current = null;
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        className="mt-1 cursor-grab rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-500"
                        aria-label="Drag milestone"
                        data-testid={`step2-milestone-drag-handle-${m.id || idx + 1}`}
                        onMouseDown={() => {
                          dragSourceIndexRef.current = idx;
                        }}
                      >
                        ::
                      </button>
                      <button
                        type="button"
                        className="flex-1 text-left"
                        onClick={() => toggleCardExpanded(m.id)}
                        data-testid={`step2-milestone-summary-${m.id || idx + 1}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-base font-semibold text-slate-950">
                            {m.title || "Untitled milestone"}
                          </div>
                          {isAiSuggested ? (
                            <span
                              data-testid={`step2-milestone-ai-indicator-${m.id || idx + 1}`}
                              className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
                            >
                              AI suggested
                            </span>
                          ) : null}
                          {estimate.type ? (
                            <span
                              className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
                              data-testid={`step2-milestone-type-badge-${m.id || idx + 1}`}
                            >
                              {estimate.typeLabel}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {Number(m.amount || 0).toLocaleString(undefined, { style: "currency", currency: "USD" })}
                        </div>
                        <div className="mt-1 text-xs text-slate-600">
                          {summaryStart || "Start"} - {summaryDue || "Due"}
                        </div>
                      </button>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-xs font-medium disabled:opacity-60"
                          onClick={() => toggleCardExpanded(m.id)}
                          disabled={milestonesLocked}
                        >
                          {isExpanded ? "Collapse" : "Edit"}
                        </button>
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-xs font-medium disabled:opacity-60"
                          onClick={() => handleDelete(m.id)}
                          disabled={milestonesLocked}
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {isExpanded ? (
                      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12" data-testid={`step2-milestone-editor-${m.id || idx + 1}`}>
                        <input
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-4"
                          placeholder="Title"
                          value={m.title || ""}
                          onChange={(e) => updateCardMilestoneField(m.id, "title", e.target.value)}
                          disabled={milestonesLocked}
                          data-testid={`step2-milestone-title-${m.id || idx + 1}`}
                        />
                        <input
                          type="date"
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-3"
                          value={toDateOnly(m.start_date || m.start)}
                          onChange={(e) => updateCardMilestoneField(m.id, "start_date", e.target.value)}
                          disabled={milestonesLocked}
                          data-testid={`step2-milestone-start-${m.id || idx + 1}`}
                        />
                        <input
                          type="date"
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-3"
                          value={toDateOnly(m.completion_date || m.end_date || m.end)}
                          onChange={(e) => updateCardMilestoneField(m.id, "completion_date", e.target.value)}
                          disabled={milestonesLocked}
                          data-testid={`step2-milestone-due-${m.id || idx + 1}`}
                        />
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                          value={m.amount ?? ""}
                          onChange={(e) => updateCardMilestoneField(m.id, "amount", e.target.value)}
                          disabled={milestonesLocked}
                          data-testid={`step2-milestone-amount-${m.id || idx + 1}`}
                        />
                        <div className="md:col-span-12">
                          <textarea
                            className="w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm"
                            rows={3}
                            value={m.description || ""}
                            onChange={(e) => updateCardMilestoneField(m.id, "description", e.target.value)}
                            disabled={milestonesLocked}
                            data-testid={`step2-milestone-description-${m.id || idx + 1}`}
                          />
                        </div>
                        <div className="md:col-span-12">
                          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                            {estimate.hasAnything ? (
                              <span className="rounded-full bg-slate-50 px-2 py-1 font-medium">
                                {estimate.pricingModeLabel || "Advisory pricing"}
                              </span>
                            ) : null}
                            {estimate.hasPrimaryRange ? (
                              <span className="rounded-full bg-slate-50 px-2 py-1 font-medium">
                                {estimate.primaryLabel}: {formatCurrency(estimate.primaryLow)} - {formatCurrency(estimate.primaryHigh)}
                              </span>
                            ) : null}
                            {estimate.durationLabel ? (
                              <span className="rounded-full bg-slate-50 px-2 py-1 font-medium">
                                {estimate.durationLabel}
                              </span>
                            ) : null}
                            {projectEstimateGuidance?.share ? (
                              <span className="rounded-full bg-slate-50 px-2 py-1 font-medium">
                                {projectClass === "commercial" ? "Schedule share" : "Suggested share"}: {formatPercent(projectEstimateGuidance.share)}
                              </span>
                            ) : null}
                            {estimate.materials ? (
                              <span className="rounded-full bg-slate-50 px-2 py-1 font-medium">
                                Materials: {estimate.materials}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>
        ) : (
          <div
            className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center"
            data-testid="step2-milestone-empty-state"
          >
            <div className="text-base font-semibold text-slate-950">Start your work plan</div>
        <div className="mt-1 text-sm text-slate-600">
          Add a milestone card or let AI draft one to get moving quickly.
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => setNewMilestoneOpen(true)}
            disabled={milestonesLocked}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Add Milestone
          </button>
        </div>
        <div className="mt-3 text-xs text-slate-500">AI milestone generation coming next.</div>
      </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleOpenSaveTemplate}
            disabled={milestonesLocked || !effectiveMilestones.length}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            data-testid="step2-save-as-template"
          >
            Save as Template
          </button>
        </div>
      </section>

      {false && (
        <section className="rounded-3xl border border-slate-300 bg-white p-5 shadow-md ring-1 ring-slate-100">
      <div className="mb-4">
        <h4 className="text-base font-semibold text-slate-950">
          {isCommercialProject ? "Add or edit schedule items" : "Add or edit milestones"}
        </h4>
        <p className="mt-1 text-sm text-slate-600">
          {isCommercialProject
            ? "Keep the schedule of values and sequencing accurate here. Save staged changes only after you review pricing and dates."
            : "Keep milestone editing as the primary task here. Save staged changes only after you review pricing and dates."}
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
          placeholder={step2ModeMeta.amountLabel}
          name="amount"
          value={mLocal.amount}
          onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
          disabled={milestonesLocked}
        />
        <div className="md:col-span-12">
          <textarea
            className="w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm"
            rows={3}
            placeholder="Description (details, materials, notes)"
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
          onClick={handleRunAiSuggest}
          disabled={milestonesLocked || templateApplied}
          className="mr-2 rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-60"
          data-testid="step2-improve-with-ai"
        >
          Improve with AI
        </button>
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
          {isCommercialProject ? "+ Add Schedule Item" : "+ Add Milestone"}
        </button>
      </div>

      {isProgressPayments || isCommercialProject ? (
        <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 text-sm text-indigo-900">
          <div className="font-semibold">
            {isProgressPayments ? step2ModeMeta.progressPanelTitle : step2ModeMeta.simplePanelTitle}
          </div>
          <div className="mt-1">
            {isProgressPayments ? step2ModeMeta.progressPanelBody : step2ModeMeta.simplePanelBody}
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
              <th>{step2ModeMeta.amountLabel}</th>
              <th>
                <div className="flex items-center gap-2">
                  <span>{step2ModeMeta.pricingColumnLabel}</span>
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
              const projectEstimateGuidance =
                estimateGuidanceByMilestone.get(m?.id ?? `row-${idx + 1}`) || null;
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
                    <div>{m.title || ""}</div>
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
                        <span
                          className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
                          data-testid={`step2-milestone-type-badge-${m.id || idx + 1}`}
                        >
                          {estimate.typeLabel}
                        </span>
                      </div>
                    ) : null}
                  </td>

                  <td className="whitespace-pre-wrap px-3 py-2">{m.description || ""}</td>

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
                              Stale - refresh pricing
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
                              {formatCurrency(estimate.primaryLow)} - {formatCurrency(estimate.primaryHigh)}
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
                          <div className="text-gray-600">
                            {isCommercialProject ? "Planned duration" : "Est. duration"}: {estimate.durationLabel}
                          </div>
                        ) : null}

                        {projectEstimateGuidance?.share ? (
                          <div className="text-gray-600">
                            {isCommercialProject ? "Schedule share" : "Suggested share"}:{" "}
                            <span className="font-medium text-gray-800">
                              {formatPercent(projectEstimateGuidance.share)}
                            </span>
                          </div>
                        ) : null}

                        {estimateBudgetValue && Number.isFinite(projectEstimateGuidance?.budgetSuggestion) ? (
                          <div className="text-gray-600">
                            {isCommercialProject ? "At contract value" : "At entered budget"}:{" "}
                            <span className="font-medium text-gray-800">
                              {formatCurrency(projectEstimateGuidance.budgetSuggestion)}
                            </span>
                          </div>
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
                      <span className="text-xs text-gray-400"></span>
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
      )}

      {false && (
      <section className="rounded-3xl border border-slate-300 bg-white p-5 shadow-md ring-1 ring-slate-100">
      <div className="mb-4">
        <h4 className="text-base font-semibold text-slate-950">
          {isCommercialProject ? "Add or edit schedule items" : "Add or edit milestones"}
        </h4>
        <p className="mt-1 text-sm text-slate-600">
          {isCommercialProject
            ? "Keep the schedule of values and sequencing accurate here. Save staged changes only after you review pricing and dates."
            : "Keep milestone editing as the primary task here. Save staged changes only after you review pricing and dates."}
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
          placeholder={step2ModeMeta.amountLabel}
          name="amount"
          value={mLocal.amount}
          onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
          disabled={milestonesLocked}
        />
        <div className="md:col-span-12">
          <textarea
            className="w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm"
            rows={3}
            placeholder="Description (details, materials, notes)"
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
          onClick={handleRunAiSuggest}
          disabled={milestonesLocked || templateApplied}
          className="mr-2 rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-60"
          data-testid="step2-improve-with-ai"
        >
          Improve with AI
        </button>
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
          {isCommercialProject ? "+ Add Schedule Item" : "+ Add Milestone"}
        </button>
      </div>

      {isProgressPayments || isCommercialProject ? (
        <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 text-sm text-indigo-900">
          <div className="font-semibold">
            {isProgressPayments ? step2ModeMeta.progressPanelTitle : step2ModeMeta.simplePanelTitle}
          </div>
          <div className="mt-1">
            {isProgressPayments ? step2ModeMeta.progressPanelBody : step2ModeMeta.simplePanelBody}
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
              <th>{step2ModeMeta.amountLabel}</th>
              <th>
                <div className="flex items-center gap-2">
                  <span>{step2ModeMeta.pricingColumnLabel}</span>
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
              const projectEstimateGuidance =
                estimateGuidanceByMilestone.get(m?.id ?? `row-${idx + 1}`) || null;
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
                    <div>{m.title || ""}</div>
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
                        <span
                          className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
                          data-testid={`step2-milestone-type-badge-${m.id || idx + 1}`}
                        >
                          {estimate.typeLabel}
                        </span>
                      </div>
                    ) : null}
                  </td>

                  <td className="whitespace-pre-wrap px-3 py-2">{m.description || ""}</td>

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
                              Stale  refresh pricing
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
                              {formatCurrency(estimate.primaryLow)} - {formatCurrency(estimate.primaryHigh)}
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
                          <div className="text-gray-600">
                            {isCommercialProject ? "Planned duration" : "Est. duration"}: {estimate.durationLabel}
                          </div>
                        ) : null}

                        {projectEstimateGuidance?.share ? (
                          <div className="text-gray-600">
                            {isCommercialProject ? "Schedule share" : "Suggested share"}:{" "}
                            <span className="font-medium text-gray-800">
                              {formatPercent(projectEstimateGuidance.share)}
                            </span>
                          </div>
                        ) : null}

                        {estimateBudgetValue && Number.isFinite(projectEstimateGuidance?.budgetSuggestion) ? (
                          <div className="text-gray-600">
                            {isCommercialProject ? "At contract value" : "At entered budget"}:{" "}
                            <span className="font-medium text-gray-800">
                              {formatCurrency(projectEstimateGuidance.budgetSuggestion)}
                            </span>
                          </div>
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
                      <span className="text-xs text-gray-400"></span>
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
      )}

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
          {savingAiScope ? "Saving" : "Save & Next"}
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
                  Save this agreement's current milestone structure as a reusable template.
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
                  placeholder="Optional notes about this reusable template"
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
                {saveTemplateBusy ? "Saving" : "Save Template"}
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
                  Milestone #{editForm.order != null ? editForm.order : ""}
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
                    {editAiBusy ? "Working" : " Improve Description"}
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
                        <span
                          className="text-slate-700"
                          data-testid="step2-edit-estimate-type-label"
                        >
                          {labelForTemplateMilestoneType(editForm.normalized_milestone_type) ||
                            editForm.normalized_milestone_type}
                        </span>
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
                            ? `${formatCurrency(editForm.labor_estimate_low)}  ${formatCurrency(editForm.labor_estimate_high)}`
                            : `${formatCurrency(editForm.suggested_amount_low)}  ${formatCurrency(editForm.suggested_amount_high)}`}
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
                          {formatCurrency(editForm.materials_estimate_low)} - {formatCurrency(editForm.materials_estimate_high)}
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
                {editBusy ? "Saving" : "Save Changes"}
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
              This milestone overlaps an existing milestones schedule. Do you want to continue anyway'
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
