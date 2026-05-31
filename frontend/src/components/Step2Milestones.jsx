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
import AssignSubcontractorInline from "./AssignSubcontractorInline.jsx";
import useAgreementMilestoneAI from "./ai/useAgreementMilestoneAI.jsx";
import useAiFieldHighlights from "../hooks/useAiFieldHighlights.js";
import { getAiPanelConfigForStep } from "../lib/agreementWizardAiPanel.js";
import { labelForTemplateMilestoneType } from "../lib/milestoneTypes.js";
import { normalizeProjectClass } from "../utils/projectClass.js";
import { buildAiContext, serializeAiContext } from "../lib/aiContext.js";
import {
  buildActionableTemplateInsightCards,
  deriveTemplateInsights,
} from "../lib/templateInsights.js";
import {
  buildClarificationAwareMilestoneDraft,
} from "../lib/milestoneDraftShaping.js";
import {
  assessMilestonePlanGuardrails,
  dedupeMilestoneRows,
  formatMilestoneGuardrailSummary,
} from "../lib/milestonePlanGuardrails.js";
import {
  summarizeMilestonePricingPlan,
  normalizeSubcontractorPlan,
  getMilestonePrimaryAction,
  getMilestoneSubcontractorSummary,
  getNextStepLabel,
  getSimpleStateLabel,
  getPricingReadinessCopy,
  milestoneHasSubcontractorLifecycleState,
} from "../lib/subcontractorPricingPlan.js";
import {
  normalizeAssistantMilestoneSuggestion,
  normalizeAssistantQuestion,
} from "../lib/assistantHandoff.js";
import { normalizeProjectFamilyContext } from "../lib/projectFamilyContext.js";
import { getMeasurementFieldConfigForProjectType, getMeasurementFieldKeysForProjectType } from "../lib/measurementFields.js";
import {
  rescheduleMilestonesFromStartDate,
  shouldPromptForDateReschedule,
} from "./step2/projectStartDateScheduling.js";

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

function formatMilestoneDateRange(startValue, endValue) {
  const start = friendly(startValue);
  const end = friendly(endValue);
  if (!start && !end) return "";
  if (start && end && start === end) return `Date: ${start}`;
  if (start && end) return `${start} → ${end}`;
  if (start) return `Date: ${start}`;
  return `Date: ${end}`;
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

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function pricingStrategyLabel(value) {
  const normalized = safeStr(value).toLowerCase();
  if (normalized === "estimate") return "Estimated pricing";
  if (normalized === "requires_sub_quote") return "Subcontractor pricing required";
  return "Fixed pricing";
}

function paymentReleaseModeLabel(value) {
  const normalized = safeStr(value).toLowerCase();
  if (normalized === "auto_after_customer_approval") return "Auto-Release After Customer Approval";
  return "Manual Release";
}

function subcontractorQuoteStatusLabel(value) {
  const normalized = safeStr(value).toLowerCase();
  if (normalized === "requested") return "Waiting for subcontractor quote";
  if (normalized === "received") return "Quote received";
  if (normalized === "declined") return "Quote declined";
  return "";
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

function getTodayIsoDate() {
  const now = new Date();
  if (Number.isNaN(now.getTime())) return "";
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function diffDays(startValue, endValue) {
  const start = toDateOnly(startValue);
  const end = toDateOnly(endValue);
  if (!start || !end) return 0;
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const startDate = new Date(sy, sm - 1, sd);
  const endDate = new Date(ey, em - 1, ed);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  return Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
}

function getDurationDaysForRow(row) {
  const recommended = Number(row?.recommended_duration_days);
  if (Number.isFinite(recommended) && recommended > 0) return Math.max(1, Math.round(recommended));

  const start = toDateOnly(row?.start_date || row?.start);
  const completion = toDateOnly(row?.completion_date || row?.end_date || row?.end);
  if (start && completion) {
    return Math.max(diffDays(start, completion) + 1, 1);
  }

  return 1;
}

function sortFallbackMilestones(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const orderA = Number.isFinite(Number(a?.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;
    const orderB = Number.isFinite(Number(b?.order)) ? Number(b.order) : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;

    const idA = Number.isFinite(Number(a?.id)) ? Number(a.id) : Number.MAX_SAFE_INTEGER;
    const idB = Number.isFinite(Number(b?.id)) ? Number(b.id) : Number.MAX_SAFE_INTEGER;
    return idA - idB;
  });
}

function shiftTimelineRowsToToday(rows, { manualDateIds = [] } = {}) {
  const normalizedRows = sortFallbackMilestones(normalizeCardRows(rows).filter(Boolean));
  if (!normalizedRows.length) return [];

  const manualSet = new Set((Array.isArray(manualDateIds) ? manualDateIds : []).map((id) => String(id)));
  const today = getTodayIsoDate();
  const firstExistingStart =
    normalizedRows.map((row) => toDateOnly(row?.start_date || row?.start)).find(Boolean) || "";
  const baseStart =
    firstExistingStart && today && firstExistingStart > today ? firstExistingStart : today || firstExistingStart;
  const shiftDays = firstExistingStart && baseStart ? diffDays(firstExistingStart, baseStart) : 0;

  if (!baseStart) return normalizedRows;

  let cursor = baseStart;
  return normalizedRows.map((row) => {
    const rowId = row?.id != null ? String(row.id) : "";
    const manualDates = manualSet.has(rowId);
    const existingStart = toDateOnly(row?.start_date || row?.start);
    const existingCompletion = toDateOnly(row?.completion_date || row?.end_date || row?.end);
    const durationDays = getDurationDaysForRow(row);

    if (manualDates && (existingStart || existingCompletion)) {
      const preservedStart = existingStart || cursor;
      const preservedCompletion = existingCompletion || addDays(preservedStart, durationDays - 1);
      cursor = addDays(preservedCompletion, 1);
      return {
        ...row,
        start_date: preservedStart,
        completion_date: preservedCompletion,
      };
    }

    if (existingStart || existingCompletion) {
      const shiftedStart = existingStart ? addDays(existingStart, shiftDays) : cursor;
      const shiftedCompletion = existingCompletion
        ? addDays(existingCompletion, shiftDays)
        : addDays(shiftedStart, durationDays - 1);
      cursor = addDays(shiftedCompletion, 1);
      return {
        ...row,
        start_date: shiftedStart,
        completion_date: shiftedCompletion,
      };
    }

    const startDate = cursor;
    const completionDate = addDays(startDate, durationDays - 1);
    cursor = addDays(completionDate, 1);
    return {
      ...row,
      start_date: startDate,
      completion_date: completionDate,
    };
  });
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
    ["measurement_exterior_square_footage", "Exterior square footage"],
    ["measurement_linear_feet", "Linear feet"],
    ["measurement_stories", "Stories"],
    ["measurement_room_count", "Rooms"],
    ["measurement_square_footage", "Square footage"],
    ["measurement_ceiling_included", "Ceiling included"],
    ["measurement_trim_included", "Trim included"],
    ["measurement_thickness", "Thickness"],
    ["measurement_cubic_yards", "Cubic yards"],
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
  "measurement_exterior_square_footage",
  "measurement_linear_feet",
  "measurement_stories",
  "measurement_room_count",
  "measurement_square_footage",
  "measurement_ceiling_included",
  "measurement_trim_included",
  "measurement_thickness",
  "measurement_cubic_yards",
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

function getPricingBaselineTotal(preview = null) {
  const directTotal = parseAmountStrict(preview?.suggested_total_price);
  if (Number.isFinite(directTotal) && directTotal > 0) {
    return roundSuggestedAmount(directTotal) ?? directTotal;
  }

  const midpoint = midpointIfValid(preview?.suggested_price_low, preview?.suggested_price_high);
  if (Number.isFinite(midpoint) && midpoint > 0) {
    return roundSuggestedAmount(midpoint) ?? midpoint;
  }

  return null;
}

function getMilestonePricingWeight(row, idx, totalRows) {
  const text = [
    safeStr(row?.title),
    safeStr(row?.description),
    safeStr(row?.normalized_milestone_type),
    safeStr(row?.pricing_source_note),
  ]
    .join(" ")
    .toLowerCase();

  if (/foundation|site prep|site preparation|prep|layout|excavation|permit|mobilization/.test(text)) {
    return 15;
  }
  if (/framing|floor|structure|rough/.test(text)) {
    return 30;
  }
  if (/roof|siding|weatherproof|shell/.test(text)) {
    return 25;
  }
  if (/door|window|trim|finish|fixture|hardware/.test(text)) {
    return 20;
  }
  if (/final|cleanup|inspection|punch|closeout/.test(text)) {
    return 10;
  }
  if (/demo|demolition/.test(text)) {
    return 18;
  }
  if (/electrical|plumbing|hvac|mechanical/.test(text)) {
    return 18;
  }

  const fallbackWeights = [18, 24, 28, 22, 14];
  if (Number.isFinite(totalRows) && totalRows > 0) {
    return fallbackWeights[Math.min(idx, fallbackWeights.length - 1)] || Math.max(8, 18 - idx * 2);
  }
  return 18;
}

function getMilestonePricingWeightLabel(row) {
  const text = [
    safeStr(row?.title),
    safeStr(row?.description),
    safeStr(row?.normalized_milestone_type),
    safeStr(row?.pricing_source_note),
  ]
    .join(" ")
    .toLowerCase();

  if (/foundation|site prep|site preparation|prep|layout|excavation|permit|mobilization/.test(text)) {
    return "Weighted for prep";
  }
  if (/framing|floor|structure|rough/.test(text)) {
    return "Weighted for framing";
  }
  if (/roof|siding|weatherproof|shell/.test(text)) {
    return "Weighted for shell work";
  }
  if (/door|window|trim|finish|fixture|hardware/.test(text)) {
    return "Weighted for finish work";
  }
  if (/final|cleanup|inspection|punch|closeout/.test(text)) {
    return "Weighted for closeout";
  }
  if (/demo|demolition/.test(text)) {
    return "Weighted for demolition";
  }
  if (/electrical|plumbing|hvac|mechanical/.test(text)) {
    return "Weighted for trades";
  }
  return "Weighted by milestone phase";
}

function buildWeightedPricingPlan(rows = [], totalAmount = 0, previewRows = [], options = {}) {
  const milestoneRows = normalizeCardRows(rows).filter(Boolean);
  const total = Number(totalAmount);
  if (!milestoneRows.length || !Number.isFinite(total) || total <= 0) return [];

  const lockAmountsById =
    options?.lockAmountsById instanceof Map
      ? options.lockAmountsById
      : new Map(Array.isArray(options?.lockAmountsById) ? options.lockAmountsById : []);

  const suggestionById = new Map(
    (Array.isArray(previewRows) ? previewRows : [])
      .filter((row) => row?.milestone_id != null)
      .map((row) => [row.milestone_id, row])
  );

  const enriched = milestoneRows.map((row, idx) => {
    const lockAmount = parseAmountStrict(
      lockAmountsById.get(row?.id) ?? lockAmountsById.get(String(row?.id)) ?? lockAmountsById.get(Number(row?.id))
    );
    const suggestion =
      suggestionById.get(row?.id) ||
      (Array.isArray(previewRows)
        ? previewRows.find((item) => Number(item?.suggested_order || 0) === idx + 1)
        : null) ||
      null;
    const baseWeight = getMilestonePricingWeight(row, idx, milestoneRows.length);
    const allocationPercent = Number(suggestion?.allocation_percent);
    const suggestedAmount = parseAmountStrict(suggestion?.suggested_amount);
    const isLocked = Number.isFinite(lockAmount) && lockAmount > 0;
    const weight =
      isLocked
        ? 0
        : Number.isFinite(allocationPercent) && allocationPercent > 0
        ? baseWeight * (0.75 + Math.min(1.2, allocationPercent))
        : baseWeight;

    return {
      row,
      idx,
      suggestion,
      weight: Number.isFinite(weight) && weight > 0 ? weight : baseWeight || 1,
      suggestedAmount: Number.isFinite(suggestedAmount) && suggestedAmount > 0 ? suggestedAmount : null,
      lockedAmount: isLocked ? lockAmount : null,
      isLocked,
    };
  });

  const lockedTotal = enriched.reduce((sum, item) => sum + Number(item.lockedAmount || 0), 0);
  const remainingTotal = Math.max(0, total - lockedTotal);
  const flexibleItems = enriched.filter((item) => !item.isLocked);
  const totalWeight =
    flexibleItems.reduce((sum, item) => sum + Number(item.weight || 0), 0) || flexibleItems.length || 1;
  let runningFlexible = 0;
  let flexibleIndex = 0;

  return enriched.map((item) => {
    if (item.isLocked) {
      const amount = Number(item.lockedAmount || 0);
      const share = total > 0 ? amount / total : 0;
      return {
        ...item.row,
        amount: amount,
        suggested_amount: Number.isFinite(item.suggestedAmount) ? item.suggestedAmount : amount,
        allocation_percent: share,
        suggested_share: share,
        pricing_manual_override: true,
        pricing_source_note: item.row?.pricing_source_note || "Manual amount",
      };
    }

    const share = Number(item.weight || 0) / totalWeight;
    const isLastFlexible = flexibleIndex === flexibleItems.length - 1;
    const rawAmount = isLastFlexible ? remainingTotal - runningFlexible : remainingTotal * share;
    const amount =
      isLastFlexible ? Math.max(0, remainingTotal - runningFlexible) : roundSuggestedAmount(rawAmount) ?? rawAmount;
    runningFlexible += Number.isFinite(amount) ? Number(amount) : 0;
    flexibleIndex += 1;

    return {
      ...item.row,
      amount: amount,
      suggested_amount: Number.isFinite(item.suggestedAmount) ? item.suggestedAmount : amount,
      allocation_percent: share,
      suggested_share: share,
      pricing_manual_override: false,
      pricing_source_note: item.row?.pricing_source_note || getMilestonePricingWeightLabel(item.row),
    };
  });
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

function comparableMilestoneRow(row) {
  return {
    id: row?.id != null ? String(row.id) : null,
    order: Number.isFinite(Number(row?.order)) ? Number(row.order) : null,
    title: safeStr(row?.title),
    description: safeStr(row?.description),
    amount: safeStr(row?.amount),
    start_date: toDateOnly(row?.start_date || row?.start),
    completion_date: toDateOnly(row?.completion_date || row?.end_date || row?.end),
    due_date: toDateOnly(row?.due_date || row?.completion_date || row?.end_date || row?.end),
    recommended_duration_days:
      Number.isFinite(Number(row?.recommended_duration_days)) && Number(row.recommended_duration_days) > 0
        ? Number(row.recommended_duration_days)
        : null,
    normalized_milestone_type: safeStr(row?.normalized_milestone_type),
    pricing_confidence: safeStr(row?.pricing_confidence),
    pricing_source_note: safeStr(row?.pricing_source_note),
    pricing_mode: safeStr(row?.pricing_mode),
    materials_hint: safeStr(row?.materials_hint),
  };
}

function milestoneRowsSignature(rows) {
  return stableSerialize(
    sortFallbackMilestones(normalizeCardRows(rows).filter(Boolean)).map((row) => comparableMilestoneRow(row))
  );
}

function milestoneRowsEqual(leftRows, rightRows) {
  return milestoneRowsSignature(leftRows) === milestoneRowsSignature(rightRows);
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
  const [measurementStatus, setMeasurementStatus] = useState("Not yet");
  const [measurementNotes, setMeasurementNotes] = useState("");
  const [allowanceNotes, setAllowanceNotes] = useState("");
  const [permitNotes, setPermitNotes] = useState("");

  const [clarOpen, setClarOpen] = useState(false);
  const [userSaveInProgress, setUserSaveInProgress] = useState(false);
  const [autosaveInProgress, setAutosaveInProgress] = useState(false);

  const didInitFromServerRef = useRef(false);
  const debounceRef = useRef(null);
  const lastPersistedStep2AnswersSignatureRef = useRef("");

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
  const [resetWorkPlanOpen, setResetWorkPlanOpen] = useState(false);
  const [resetWorkPlanBusy, setResetWorkPlanBusy] = useState(false);
  const [resetWorkPlanError, setResetWorkPlanError] = useState("");
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
  const [acceptedSubcontractors, setAcceptedSubcontractors] = useState([]);
  const [subcontractorsLoading, setSubcontractorsLoading] = useState(false);
  const [subcontractorAssignTarget, setSubcontractorAssignTarget] = useState(null);
  const [subcontractorQuoteTarget, setSubcontractorQuoteTarget] = useState(null);
  const [quoteFormSubcontractorId, setQuoteFormSubcontractorId] = useState("");
  const [quoteFormMessage, setQuoteFormMessage] = useState("");
  const [quoteReviewPaymentMode, setQuoteReviewPaymentMode] = useState("manual_release");
  const [quoteReviewOverrideReason, setQuoteReviewOverrideReason] = useState("");
  const [quoteReviewRevisionNote, setQuoteReviewRevisionNote] = useState("");
  const [quoteReviewBusy, setQuoteReviewBusy] = useState(false);
  const [quoteMessage, setQuoteMessage] = useState("");
  const [subcontractorPlan, setSubcontractorPlan] = useState("unsure");
  const [revealedSubcontractorMilestoneIds, setRevealedSubcontractorMilestoneIds] = useState([]);

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
  const [projectStartDateDraft, setProjectStartDateDraft] = useState("");
  const [projectStartDateBusy, setProjectStartDateBusy] = useState(false);
  const [projectStartDatePrompt, setProjectStartDatePrompt] = useState(null);
  const [fallbackMilestones, setFallbackMilestones] = useState(null);
  const [stagedSuggestedMilestoneIds, setStagedSuggestedMilestoneIds] = useState([]);
  const [stagedSuggestedTimelineIds, setStagedSuggestedTimelineIds] = useState([]);
  const [pricingEstimateStale, setPricingEstimateStale] = useState(false);
  const [dismissedPricingReviewSignature, setDismissedPricingReviewSignature] = useState("");
  const [estimatePreview, setEstimatePreview] = useState(null);
  const [estimateBanner, setEstimateBanner] = useState("");
  const [projectBudgetInput, setProjectBudgetInput] = useState("");
  const targetProjectTotalTouchedRef = useRef(false);
  const [rebalancePrompt, setRebalancePrompt] = useState(null);
  const [manualAmountMilestoneIds, setManualAmountMilestoneIds] = useState([]);
  const [manualDateMilestoneIds, setManualDateMilestoneIds] = useState([]);
  const [pricingHighlightMilestoneIds, setPricingHighlightMilestoneIds] = useState([]);
  const pricingHighlightTimerRef = useRef(null);
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
  const [aiMilestoneApplyPrompt, setAiMilestoneApplyPrompt] = useState(null);
  const [aiMilestonePlanWarningPrompt, setAiMilestonePlanWarningPrompt] = useState(null);
  const [aiMilestonePlanAnalysis, setAiMilestonePlanAnalysis] = useState(null);
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
  const resetWorkPlanSafety = useMemo(() => {
    const rows = Array.isArray(effectiveMilestones) ? effectiveMilestones : [];
    const blockers = [];
    const seen = new Set();

    const addBlocker = (kind, row, label) => {
      const key = `${kind}:${row?.id ?? label ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      blockers.push({
        kind,
        id: row?.id ?? null,
        label: label || safeStr(row?.title) || `Milestone ${blockers.length + 1}`,
      });
    };

    rows.forEach((row, idx) => {
      const title = safeStr(row?.title) || `Milestone ${idx + 1}`;
      const hasInvoice = !!row?.invoice_id || !!row?.is_invoiced || !!row?.completed || !!row?.invoice;
      const hasPayout =
        !!row?.payout_record ||
        !!row?.subcontractor_payout_orchestration ||
        Number(row?.subcontractor_payout_amount_cents || 0) > 0;
      const completionStatus = safeStr(row?.subcontractor_completion_status).toLowerCase();
      const hasSubcontractorActivity =
        !!row?.assigned_subcontractor_invitation ||
        !!row?.subcontractor_milestone_agreement ||
        !!row?.subcontractor_quote_request ||
        (completionStatus && completionStatus !== "not_submitted");

      if (hasInvoice) addBlocker("invoice", row, title);
      if (hasPayout) addBlocker("payout", row, title);
      if (hasSubcontractorActivity) addBlocker("subcontractor", row, title);
    });

    const hasProtectedActivity = blockers.length > 0;
    const summary = hasProtectedActivity
      ? Array.from(
          new Set(
            blockers.map((blocker) =>
              blocker.kind === "invoice"
                ? "invoice/completed work"
                : blocker.kind === "payout"
                ? "payout records"
                : "subcontractor activity"
            )
          )
        )
      : [];

    return {
      hasProtectedActivity,
      blockers,
      summary,
    };
  }, [effectiveMilestones]);
  const agreementPricingStrategy = safeStr(agreementMeta?.pricing_strategy || "fixed").toLowerCase() || "fixed";
  // Canonical Step 2 wizard state lives here; legacy milestone draft keys are kept out of this flow.
  const subcontractorPlanStorageKey = useMemo(
    () => `mhb_step2_subcontractor_plan_${agreementId || "new"}`,
    [agreementId]
  );
  const revealedSubcontractorMilestoneIdSet = useMemo(
    () => new Set((Array.isArray(revealedSubcontractorMilestoneIds) ? revealedSubcontractorMilestoneIds : []).map(String)),
    [revealedSubcontractorMilestoneIds]
  );
  const milestoneUserModifiedKey = useMemo(
    () => `mhb_step2_user_modified_${agreementId || "new"}`,
    [agreementId]
  );
  const pricingReadiness = useMemo(
    () => summarizeMilestonePricingPlan(agreementId, effectiveMilestones, agreementPricingStrategy),
    [agreementId, agreementPricingStrategy, effectiveMilestones]
  );
  const pricingReadinessCopy = useMemo(() => getPricingReadinessCopy(pricingReadiness), [pricingReadiness]);
  const activeQuoteRequest = subcontractorQuoteTarget?.subcontractor_quote_request || null;
  const activeQuoteStatus = safeStr(activeQuoteRequest?.status).toLowerCase();
  const activeQuoteAmount = Number(activeQuoteRequest?.quoted_amount || 0);
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
    if (field === "amount") {
      setManualAmountMilestoneIds((prev) => [...new Set([...(Array.isArray(prev) ? prev : []), String(milestoneId)])]);
    }
    if (field === "start_date" || field === "completion_date") {
      markMilestoneDatesManual(milestoneId);
    }
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

  function markMilestoneDatesManual(milestoneId) {
    if (milestoneId == null) return;
    setManualDateMilestoneIds((prev) => [...new Set([...(Array.isArray(prev) ? prev : []), String(milestoneId)])]);
  }

  function isPersistedMilestoneId(id) {
    const n = Number(id);
    return Number.isFinite(n) && n > 0;
  }

  function milestonesDifferForPersistence(base, next) {
    if (!base || !next) return false;

    const comparableBase = normalizeMilestoneForLocalFallback(base);
    const comparableNext = normalizeMilestoneForLocalFallback(next);

    return (
      safeStr(comparableBase.title) !== safeStr(comparableNext.title) ||
      safeStr(comparableBase.description) !== safeStr(comparableNext.description) ||
      amountsDifferMeaningfully(comparableBase.amount, parseAmountStrict(comparableNext.amount)) ||
      toDateOnly(comparableBase.start_date) !== toDateOnly(comparableNext.start_date) ||
      toDateOnly(comparableBase.completion_date) !== toDateOnly(comparableNext.completion_date) ||
      Number(comparableBase.order || 0) !== Number(comparableNext.order || 0) ||
      safeStr(comparableBase.normalized_milestone_type) !== safeStr(comparableNext.normalized_milestone_type) ||
      safeStr(comparableBase.pricing_confidence) !== safeStr(comparableNext.pricing_confidence) ||
      safeStr(comparableBase.pricing_source_note) !== safeStr(comparableNext.pricing_source_note) ||
      safeStr(comparableBase.materials_hint) !== safeStr(comparableNext.materials_hint) ||
      Number(comparableBase.recommended_duration_days || 0) !==
        Number(comparableNext.recommended_duration_days || 0) ||
      Number(comparableBase.ai_suggested_amount || 0) !== Number(comparableNext.ai_suggested_amount || 0) ||
      safeStr(comparableBase.recurrence_pattern) !== safeStr(comparableNext.recurrence_pattern) ||
      Number(comparableBase.recurrence_interval || 0) !== Number(comparableNext.recurrence_interval || 0) ||
      toDateOnly(comparableBase.recurrence_anchor_date) !== toDateOnly(comparableNext.recurrence_anchor_date) ||
      toDateOnly(comparableBase.recurrence_end_date) !== toDateOnly(comparableNext.recurrence_end_date) ||
      toDateOnly(comparableBase.next_occurrence_date) !== toDateOnly(comparableNext.next_occurrence_date) ||
      toDateOnly(comparableBase.service_period_start) !== toDateOnly(comparableNext.service_period_start) ||
      toDateOnly(comparableBase.service_period_end) !== toDateOnly(comparableNext.service_period_end) ||
      toDateOnly(comparableBase.scheduled_service_date) !== toDateOnly(comparableNext.scheduled_service_date)
    );
  }

  function buildStep2MilestoneWritePayload(row, orderOverride = null) {
    const resolvedOrder = orderOverride != null ? orderOverride : row?.order;
    const orderValue = Number.isFinite(Number(resolvedOrder)) ? Number(resolvedOrder) : null;
    const completionDate = toDateOnly(row?.completion_date || row?.end_date || row?.end || row?.due_date || "");

    const payload = {
      agreement: agreementId,
      title: safeStr(row?.title),
      description: safeStr(row?.description),
      amount: Number(row?.amount || 0),
      start_date: toDateOnly(row?.start_date || row?.start || "") || null,
      completion_date: completionDate || null,
      due_date: completionDate || null,
      normalized_milestone_type: safeStr(row?.normalized_milestone_type),
      ai_suggested_amount:
        row?.ai_suggested_amount != null && row?.ai_suggested_amount !== ""
          ? Number(row.ai_suggested_amount)
          : null,
      suggested_amount_low:
        row?.suggested_amount_low != null && row?.suggested_amount_low !== ""
          ? Number(row.suggested_amount_low)
          : null,
      suggested_amount_high:
        row?.suggested_amount_high != null && row?.suggested_amount_high !== ""
          ? Number(row.suggested_amount_high)
          : null,
      labor_estimate_low:
        row?.labor_estimate_low != null && row?.labor_estimate_low !== ""
          ? Number(row.labor_estimate_low)
          : null,
      labor_estimate_high:
        row?.labor_estimate_high != null && row?.labor_estimate_high !== ""
          ? Number(row.labor_estimate_high)
          : null,
      materials_estimate_low:
        row?.materials_estimate_low != null && row?.materials_estimate_low !== ""
          ? Number(row.materials_estimate_low)
          : null,
      materials_estimate_high:
        row?.materials_estimate_high != null && row?.materials_estimate_high !== ""
          ? Number(row.materials_estimate_high)
          : null,
      pricing_confidence: safeStr(row?.pricing_confidence),
      pricing_source_note: safeStr(row?.pricing_source_note),
      recommended_duration_days:
        row?.recommended_duration_days !== "" && row?.recommended_duration_days != null
          ? Number(row.recommended_duration_days)
          : null,
      materials_hint: safeStr(row?.materials_hint),
      is_recurring_rule: !!row?.is_recurring_rule,
      recurrence_pattern: safeStr(row?.recurrence_pattern),
      recurrence_interval:
        row?.recurrence_interval !== "" && row?.recurrence_interval != null
          ? Number(row.recurrence_interval)
          : 1,
      recurrence_anchor_date: toDateOnly(row?.recurrence_anchor_date || "") || null,
      recurrence_end_date: toDateOnly(row?.recurrence_end_date || "") || null,
      next_occurrence_date: toDateOnly(row?.next_occurrence_date || "") || null,
      occurrence_sequence_number:
        row?.occurrence_sequence_number != null ? Number(row.occurrence_sequence_number) : 0,
      generated_from_recurring_rule: !!row?.generated_from_recurring_rule,
      service_period_start: toDateOnly(row?.service_period_start || "") || null,
      service_period_end: toDateOnly(row?.service_period_end || "") || null,
      scheduled_service_date: toDateOnly(row?.scheduled_service_date || "") || null,
      allow_overlap: true,
    };

    if (orderValue != null) {
      payload.order = orderValue;
      payload.sort_order = orderValue;
    }

    return payload;
  }

  function flashPricingHighlights(milestoneIds = []) {
    const ids = (Array.isArray(milestoneIds) ? milestoneIds : [])
      .map((id) => (id == null ? "" : String(id)))
      .filter(Boolean);
    if (!ids.length) return;
    setPricingHighlightMilestoneIds(ids);
    if (pricingHighlightTimerRef.current) {
      window.clearTimeout(pricingHighlightTimerRef.current);
    }
    pricingHighlightTimerRef.current = window.setTimeout(() => {
      setPricingHighlightMilestoneIds([]);
    }, 2000);
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

  const fetchAcceptedSubcontractors = useCallback(async () => {
    if (!agreementId) return [];
    try {
      setSubcontractorsLoading(true);
      const { data } = await api.get(`/projects/agreements/${agreementId}/subcontractor-invitations/`);
      const rows = Array.isArray(data?.accepted_subcontractors) ? data.accepted_subcontractors : [];
      setAcceptedSubcontractors(rows);
      return rows;
    } catch (err) {
      console.warn("Step2Milestones: unable to load subcontractors", err);
      setAcceptedSubcontractors([]);
      return [];
    } finally {
      setSubcontractorsLoading(false);
    }
  }, [agreementId]);

  useEffect(() => {
    if (!agreementId) return;
    fetchAcceptedSubcontractors();
  }, [agreementId, fetchAcceptedSubcontractors]);

  useEffect(() => {
    setRevealedSubcontractorMilestoneIds([]);
  }, [agreementId]);

  useEffect(() => {
    if (!subcontractorPlanStorageKey) return;
    const serverPlan = normalizeSubcontractorPlan(agreementMeta?.subcontractor_plan);
    if (serverPlan !== "unsure") {
      setSubcontractorPlan(serverPlan);
      return;
    }
    try {
      const savedPlan = window.localStorage.getItem(subcontractorPlanStorageKey);
      setSubcontractorPlan(normalizeSubcontractorPlan(savedPlan));
    } catch {
      setSubcontractorPlan("unsure");
    }
  }, [agreementMeta?.subcontractor_plan, subcontractorPlanStorageKey]);

  useEffect(() => {
    if (!subcontractorPlanStorageKey) return;
    try {
      window.localStorage.setItem(subcontractorPlanStorageKey, normalizeSubcontractorPlan(subcontractorPlan));
    } catch {
      // ignore storage failures
    }
  }, [subcontractorPlan, subcontractorPlanStorageKey]);

  const getCurrentQuoteForMilestone = useCallback(
    (milestone) => milestone?.subcontractor_quote_request || null,
    []
  );

  const requestQuoteForMilestone = useCallback(
    (milestoneId) => {
      const current = Array.isArray(effectiveMilestones)
        ? effectiveMilestones.find((row) => row?.id === milestoneId)
        : null;
      if (!current) return;
      if (!Array.isArray(acceptedSubcontractors) || !acceptedSubcontractors.length) {
        toast.error("No accepted subcontractors are available to request a quote.");
        return;
      }
      setSubcontractorQuoteTarget(current);
      setQuoteFormSubcontractorId(
        String(current?.subcontractor_quote_request?.subcontractor_invitation_id || acceptedSubcontractors[0]?.id || "")
      );
      setQuoteFormMessage(current?.subcontractor_quote_request?.contractor_message || `Please quote ${current.title || "this milestone"}.`);
      setQuoteReviewPaymentMode(
        current?.subcontractor_quote_request?.linked_subcontractor_milestone_agreement?.payment_release_mode ||
          "manual_release"
      );
      setQuoteReviewOverrideReason(current?.subcontractor_quote_request?.override_reason || "");
      setQuoteReviewRevisionNote(current?.subcontractor_quote_request?.revision_note || "");
      setQuoteMessage("");
    },
    [acceptedSubcontractors, agreementId, effectiveMilestones]
  );

  const closeQuoteTarget = useCallback(() => {
    setSubcontractorQuoteTarget(null);
    setQuoteFormMessage("");
    setQuoteFormSubcontractorId("");
    setQuoteReviewOverrideReason("");
    setQuoteReviewRevisionNote("");
    setQuoteReviewPaymentMode("manual_release");
  }, []);

  const confirmQuoteRequest = useCallback(async () => {
    const current = subcontractorQuoteTarget;
    if (!current?.id) return;
    if (!quoteFormSubcontractorId) {
      toast.error("Select a subcontractor first.");
      return;
    }
    try {
      setQuoteReviewBusy(true);
      await api.post("/projects/subcontractor-quotes/", {
        agreement_id: agreementId,
        milestone_id: current.id,
        subcontractor_invitation_id: Number(quoteFormSubcontractorId),
        contractor_message: quoteFormMessage,
        scope_snapshot: {
          milestone_title: current.title || "",
          milestone_description: current.description || "",
          project_title: agreementMeta?.project?.title || agreementMeta?.project_title || agreementMeta?.title || "",
        },
      });
      setQuoteMessage("Waiting for subcontractor quote.");
      if (typeof reloadMilestones === "function") {
        await reloadMilestones();
      }
      await refreshAgreementMeta();
      closeQuoteTarget();
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Failed to request quote.");
    } finally {
      setQuoteReviewBusy(false);
    }
  }, [agreementId, agreementMeta, closeQuoteTarget, quoteFormMessage, quoteFormSubcontractorId, refreshAgreementMeta, reloadMilestones, subcontractorQuoteTarget]);

  const declineQuoteRequest = useCallback(async () => {
    const current = subcontractorQuoteTarget;
    if (!current?.id) return;
    const quote = getCurrentQuoteForMilestone(current);
    if (!quote?.id) {
      closeQuoteTarget();
      return;
    }
    try {
      setQuoteReviewBusy(true);
      await api.post(`/projects/subcontractor-quotes/${quote.id}/decline/`);
      setQuoteMessage(`Quote declined for ${current.title || "milestone"}.`);
      if (typeof reloadMilestones === "function") {
        await reloadMilestones();
      }
      await refreshAgreementMeta();
      closeQuoteTarget();
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Failed to decline quote.");
    } finally {
      setQuoteReviewBusy(false);
    }
  }, [closeQuoteTarget, getCurrentQuoteForMilestone, refreshAgreementMeta, reloadMilestones, subcontractorQuoteTarget]);

  const assignLaterForMilestone = useCallback((milestoneId) => {
    const current = Array.isArray(effectiveMilestones)
      ? effectiveMilestones.find((row) => row?.id === milestoneId)
      : null;
    setQuoteMessage(`${current?.title || "Milestone"} marked for later subcontractor assignment.`);
  }, [effectiveMilestones]);

  const assignFixedPayTarget = useCallback((milestone) => {
    setSubcontractorAssignTarget(milestone || null);
  }, []);

  const closeSubcontractorAssignTarget = useCallback(() => {
    setSubcontractorAssignTarget(null);
  }, []);

  useEffect(() => {
    if (!subcontractorQuoteTarget) return;
    const quote = subcontractorQuoteTarget?.subcontractor_quote_request || {};
    setQuoteReviewPaymentMode(
      quote?.linked_subcontractor_milestone_agreement?.payment_release_mode || "manual_release"
    );
    setQuoteReviewOverrideReason(quote?.override_reason || "");
    setQuoteReviewRevisionNote(quote?.revision_note || "");
  }, [subcontractorQuoteTarget]);

  const acceptQuoteRequestAction = useCallback(
    async (quote) => {
      if (!quote?.id) return;
      try {
        setQuoteReviewBusy(true);
        await api.post(`/projects/subcontractor-quotes/${quote.id}/accept/`, {
          payment_release_mode: quoteReviewPaymentMode,
          override_reason: quoteReviewOverrideReason,
        });
        setQuoteMessage(`Accepted quote for ${quote.milestone_title || "milestone"}.`);
        if (typeof reloadMilestones === "function") {
          await reloadMilestones();
        }
        await refreshAgreementMeta();
        closeQuoteTarget();
      } catch (err) {
        console.error(err);
        toast.error(err?.response?.data?.detail || "Failed to accept quote.");
      } finally {
        setQuoteReviewBusy(false);
      }
    },
    [closeQuoteTarget, quoteReviewOverrideReason, quoteReviewPaymentMode, refreshAgreementMeta, reloadMilestones]
  );

  const requestQuoteRevisionAction = useCallback(
    async (quote) => {
      if (!quote?.id) return;
      try {
        setQuoteReviewBusy(true);
        await api.post(`/projects/subcontractor-quotes/${quote.id}/request-revision/`, {
          revision_note: quoteReviewRevisionNote,
        });
        setQuoteMessage(`Revision requested for ${quote.milestone_title || "milestone"}.`);
        if (typeof reloadMilestones === "function") {
          await reloadMilestones();
        }
        await refreshAgreementMeta();
        closeQuoteTarget();
      } catch (err) {
        console.error(err);
        toast.error(err?.response?.data?.detail || "Failed to request revision.");
      } finally {
        setQuoteReviewBusy(false);
      }
    },
    [closeQuoteTarget, quoteReviewRevisionNote, refreshAgreementMeta, reloadMilestones]
  );

  const cancelQuoteRequestAction = useCallback(
    async (quote) => {
      if (!quote?.id) return;
      try {
        setQuoteReviewBusy(true);
        await api.post(`/projects/subcontractor-quotes/${quote.id}/cancel/`);
        setQuoteMessage(`Quote request cancelled for ${quote.milestone_title || "milestone"}.`);
        if (typeof reloadMilestones === "function") {
          await reloadMilestones();
        }
        await refreshAgreementMeta();
        closeQuoteTarget();
      } catch (err) {
        console.error(err);
        toast.error(err?.response?.data?.detail || "Failed to cancel quote request.");
      } finally {
        setQuoteReviewBusy(false);
      }
    },
    [closeQuoteTarget, refreshAgreementMeta, reloadMilestones]
  );

  const assignMilestoneSubcontractor = useCallback(
    async (milestoneId, invitationId, options = {}) => {
      const payload = { invitation_id: invitationId };
      if (options.complianceAction) payload.compliance_action = options.complianceAction;
      if (options.overrideReason) payload.override_reason = options.overrideReason;
      if (options.agreedPay !== undefined && options.agreedPay !== "") payload.agreed_pay = options.agreedPay;
      if (options.paymentReleaseMode) payload.payment_release_mode = options.paymentReleaseMode;
      if (options.sendAgreement !== undefined) payload.send_agreement = options.sendAgreement;

      const { data } = await api.post(`/projects/milestones/${milestoneId}/assign-subcontractor/`, payload);
      const milestonePayload = data?.milestone || data;
      if (milestonePayload?.id) {
        setAgreementMeta((prev) =>
          prev
            ? {
                ...prev,
                milestones: (prev.milestones || []).map((milestone) =>
                  milestone.id === milestoneId ? { ...milestone, ...milestonePayload } : milestone
                ),
              }
            : prev
        );
      }
      return data;
    },
    []
  );

  const unassignMilestoneSubcontractor = useCallback(
    async (milestoneId) => {
      const { data } = await api.patch(`/projects/milestones/${milestoneId}/`, {
        assigned_subcontractor_invitation: null,
      });
      setAgreementMeta((prev) =>
        prev
          ? {
              ...prev,
              milestones: (prev.milestones || []).map((milestone) =>
                milestone.id === milestoneId ? { ...milestone, ...data } : milestone
              ),
            }
          : prev
      );
      return data;
    },
    []
  );

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
          if (normalized === "yes") setMeasurementStatus("Yes");
          else if (normalized === "no") setMeasurementStatus("No");
          else if (normalized === "not yet" || normalized === "pending") setMeasurementStatus("Not yet");
        } else if (typeof answers.measurements_needed === "boolean") {
          setMeasurementStatus(answers.measurements_needed ? "Yes" : "No");
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

        lastPersistedStep2AnswersSignatureRef.current = stableSerialize(answers || {});
        didInitFromServerRef.current = true;
      } catch (e) {
        console.warn("Step2Milestones: could not load agreement ai_scope.answers", e);
        lastPersistedStep2AnswersSignatureRef.current = stableSerialize({});
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
  const agreementProjectStartDate = useMemo(
    () => toDateOnly(agreementMeta?.project_start_date || agreementMeta?.start || ""),
    [agreementMeta?.project_start_date, agreementMeta?.start]
  );

  useEffect(() => {
    setProjectStartDateDraft(agreementProjectStartDate || "");
  }, [agreementProjectStartDate]);

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
    const projectType = safeStr(agreementMeta?.project_type);
    const projectFamilyLabel =
      safeStr(agreementMeta?.project_family_label) ||
      safeStr(agreementMeta?.project_type) ||
      safeStr(agreementMeta?.project_subtype);
    const projectFamilyKey = safeStr(agreementMeta?.project_family_key);
    const projectSubtype = safeStr(agreementMeta?.project_subtype);
    const projectTitle = safeStr(agreementMeta?.project_title || agreementMeta?.title || agreementMeta?.project?.title);
    const materialsResponsibility = normalizeMaterialsResponsibilityValue(
      agreementAnswers?.materials_responsibility ||
      agreementAnswers?.materials_purchasing ||
      agreementAnswers?.who_purchases_materials ||
      materialsWho
    );
    const quantitySignals = projectContextQuantitySignals(agreementAnswers, measurementNotes);
    const scopeSummary = toCompactLine(
      agreementMeta?.scope_of_work ||
      agreementMeta?.description ||
      agreementMeta?.project_description ||
      agreementMeta?.project?.description ||
      agreementMeta?.ai_scope?.scope_text ||
      ""
    );

    return {
      projectType,
      projectSubtype,
      projectFamilyKey,
      projectFamilyLabel,
      projectTitle,
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
        !!projectTitle ||
        !!safeStr(selectedTemplateMeta?.name) ||
        !!materialsResponsibility ||
        quantitySignals.length > 0 ||
        !!scopeSummary,
    };
  }, [agreementMeta, materialsWho, measurementNotes, resolvedProjectFamily, selectedTemplateMeta]);
  const measurementFieldConfig = useMemo(
    () => getMeasurementFieldConfigForProjectType(projectContextSummary?.projectType || agreementMeta?.project_type || ""),
    [agreementMeta?.project_type, projectContextSummary?.projectType]
  );
  const measurementFieldKeys = useMemo(
    () => getMeasurementFieldKeysForProjectType(projectContextSummary?.projectType || agreementMeta?.project_type || ""),
    [agreementMeta?.project_type, projectContextSummary?.projectType]
  );
  const estimateContextSignature = useMemo(
    () =>
      JSON.stringify({
        agreementId,
        projectType: agreementMeta?.project_type || "",
        projectSubtype: agreementMeta?.project_subtype || "",
        projectFamilyKey: safeStr(projectContextSummary?.projectFamilyKey),
        projectFamilyLabel: safeStr(projectContextSummary?.projectFamilyLabel),
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
    [agreementId, agreementMeta, milestones, projectContextSummary?.projectFamilyKey, projectContextSummary?.projectFamilyLabel]
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
    const agreementAnswers = agreementMeta?.ai_scope?.answers || {};

    if (permitNotes && String(permitNotes).trim()) {
      const v = String(permitNotes).trim();
      answers.permits_responsibility = v;
    }

    if (materialsWho && String(materialsWho).trim()) {
      const v = normalizeMaterialsResponsibilityValue(materialsWho);
      answers.materials_responsibility = v;
    }

    answers.measurements_provided = measurementStatus || "Not yet";

    if (measurementNotes && String(measurementNotes).trim()) {
      const v = String(measurementNotes).trim();
      answers.measurement_notes = v;
      answers.measurements_notes = v;
    }

    for (const key of measurementFieldKeys) {
      const raw = agreementAnswers?.[key];
      if (typeof raw === "string" && raw.trim()) {
        answers[key] = raw.trim();
      } else if (typeof raw === "number" && Number.isFinite(raw)) {
        answers[key] = String(raw);
      }
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
    const source = options?.source === "autosave" ? "autosave" : "user";
    const step2Answers = includeStep2Answers ? buildStep2Answers() : {};
    const mergedLocal = { ...(step2Answers || {}), ...(extraAnswers || {}) };
    if (!mergedLocal || Object.keys(mergedLocal).length === 0) return;

    if (source === "autosave" && (userSaveInProgress || autosaveInProgress)) return;
    try {
      const current = await api.get(`/projects/agreements/${agreementId}/`);
      const data = current?.data || {};
      const ai_scope = data.ai_scope || {};
      const previousAnswers = ai_scope.answers || {};
      const mergedAnswers = { ...(ai_scope.answers || {}), ...mergedLocal };
      const mergedSignature = stableSerialize(mergedAnswers);

      if (mergedSignature === lastPersistedStep2AnswersSignatureRef.current) {
        return;
      }

      if (source === "autosave") setAutosaveInProgress(true);
      else setUserSaveInProgress(true);

      const patchPayload = { ai_scope: { ...ai_scope, answers: mergedAnswers } };

      if (Object.prototype.hasOwnProperty.call(data, "scope_clarifications")) {
        const sc = data.scope_clarifications || {};
        patchPayload.scope_clarifications = { ...(sc || {}), ...mergedAnswers };
      }

      await api.patch(`/projects/agreements/${agreementId}/`, patchPayload);
      if (pricingImpactAnswersChanged(previousAnswers, mergedAnswers)) {
        setPricingEstimateStale(true);
      }
      lastPersistedStep2AnswersSignatureRef.current = mergedSignature;
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
      if (source === "autosave") setAutosaveInProgress(false);
      else setUserSaveInProgress(false);
    }
  }

  useEffect(() => {
    if (!agreementId) return;
    if (!didInitFromServerRef.current) return;
    if (userSaveInProgress || autosaveInProgress) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      persistAnswersToAgreement(null, { source: "autosave" });
    }, 650);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    agreementId,
    materialsWho,
    measurementStatus,
    measurementNotes,
    allowanceNotes,
    permitNotes,
    agreementMeta,
    measurementFieldKeys,
    userSaveInProgress,
    autosaveInProgress,
  ]);

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
    projectFamilyContext: {
      project_family_key: safeStr(projectContextSummary?.projectFamilyKey),
      project_family_label: safeStr(projectContextSummary?.projectFamilyLabel) || safeStr(projectContextSummary?.projectType),
    },
    projectStartDate: projectStartDateDraft || agreementProjectStartDate || "",
    aiContextOverrides: {
      status: agreementMeta?.status || null,
      projectType: projectContextSummary?.projectType || null,
      projectSubtype: projectContextSummary?.projectSubtype || null,
      projectPath: normalizeProjectClass(agreementMeta?.project_class),
      projectAddress: (agreementMeta?.project_address_line1 || agreementMeta?.project_address_city) ? {
        street: agreementMeta?.project_address_line1 || null,
        city: agreementMeta?.project_address_city || null,
        state: agreementMeta?.project_address_state || null,
        zip: agreementMeta?.project_address_postal_code || null,
      } : null,
      milestoneCount: Array.isArray(milestones) ? milestones.length : 0,
      existingScope: agreementMeta?.description || agreementMeta?.scope_of_work || null,
      templateApplied: !!(agreementMeta?.selected_template?.id || agreementMeta?.selected_template_id),
    },
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
  const manualAmountMilestoneIdSet = useMemo(
    () => new Set((Array.isArray(manualAmountMilestoneIds) ? manualAmountMilestoneIds : []).map((id) => String(id))),
    [manualAmountMilestoneIds]
  );
  const manualDateMilestoneIdSet = useMemo(
    () => new Set((Array.isArray(manualDateMilestoneIds) ? manualDateMilestoneIds : []).map((id) => String(id))),
    [manualDateMilestoneIds]
  );
  const pricingSummaryRangeLow = parseAmountStrict(estimatePreview?.suggested_price_low);
  const pricingSummaryRangeHigh = parseAmountStrict(estimatePreview?.suggested_price_high);
  const pricingSummaryStatus = useMemo(() => {
    if (!Number.isFinite(pricingSummaryRangeLow) || !Number.isFinite(pricingSummaryRangeHigh)) return "";
    if (total < pricingSummaryRangeLow) return "Below range";
    if (total > pricingSummaryRangeHigh) return "Above range";
    return "Within range";
  }, [pricingSummaryRangeHigh, pricingSummaryRangeLow, total]);
  const pricingSummarySource = "Based on similar projects and milestone structure.";
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
  const pricingBaselineTotal = useMemo(() => getPricingBaselineTotal(estimatePreview), [estimatePreview]);
  useEffect(() => {
    if (targetProjectTotalTouchedRef.current) return;
    if (!pricingBaselineTotal || projectBudgetInput) return;
    setProjectBudgetInput(formatSuggestedAmountInput(pricingBaselineTotal));
  }, [pricingBaselineTotal, projectBudgetInput]);
  useEffect(
    () => () => {
      if (pricingHighlightTimerRef.current) {
        window.clearTimeout(pricingHighlightTimerRef.current);
      }
    },
    []
  );
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

    const weightedRows = buildWeightedPricingPlan(
      rows,
      pricingBaselineTotal || estimateBudgetValue || 0,
      estimateSuggestions
    );
    const totalWeight =
      weightedRows.reduce((sum, item) => sum + Number(item?.allocation_percent || item?.weight || 0), 0) ||
      weightedRows.length ||
      1;
    const map = new Map();
    weightedRows.forEach((item) => {
      const share = Number(item?.allocation_percent || item?.weight || 0) / totalWeight;
      const budgetSuggestion = pricingBaselineTotal ? roundSuggestedAmount(pricingBaselineTotal * share) : null;
      map.set(item.row?.id ?? `row-${item.idx + 1}`, {
        share,
        suggestedAmount: item.suggestedAmount,
        budgetSuggestion,
        durationDays: Number(item.suggestion?.suggested_duration_days || 0) || null,
        weightLabel: getMilestonePricingWeightLabel(item.row),
      });
    });
    return map;
  }, [effectiveMilestones, estimateBudgetValue, estimateSuggestions, pricingBaselineTotal]);
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

  const milestoneGenerationContextLabel = useMemo(() => {
    const type = safeStr(projectContextSummary?.projectType);
    const subtype = safeStr(projectContextSummary?.projectSubtype);
    if (type && subtype) return `${type} / ${subtype}`;
    if (type) return type;
    if (subtype) return subtype;
    if (safeStr(projectContextSummary?.projectTitle)) return safeStr(projectContextSummary.projectTitle);
    if (safeStr(projectContextSummary?.projectFamilyLabel)) return safeStr(projectContextSummary.projectFamilyLabel);
    return "Current agreement";
  }, [projectContextSummary]);
  const milestonePlanActionLabel = effectiveMilestones.length ? "Regenerate Plan" : "Generate Suggested Milestones";

  function shapeAiMilestonePreview(preview) {
    if (!preview || !Array.isArray(preview.milestones)) return preview;
    if (preview?.raw?.clarification_shaped) return preview;

    const projectType = safeStr(agreementMeta?.project_type) || safeStr(projectContextSummary?.projectType);
    const projectSubtype = safeStr(agreementMeta?.project_subtype) || safeStr(projectContextSummary?.projectSubtype);

    return {
      ...preview,
      milestones: dedupeMilestoneRows(
        buildClarificationAwareMilestoneDraft({
          projectType,
          projectSubtype,
          projectFamilyKey: "",
          projectFamilyLabel: "",
          description:
            safeStr(
              agreementMeta?.scope_of_work ||
                agreementMeta?.description ||
                agreementMeta?.project_description ||
                preview.scope_text
            ),
          clarificationAnswers: agreementMeta?.ai_scope?.answers || {},
          amountMode: "preserve_base",
          baseMilestones: preview.milestones,
        })
      ),
    };
  }

  function buildLocalMilestoneSuggestions() {
    const projectType = safeStr(projectContextSummary?.projectType);
    const projectSubtype = safeStr(projectContextSummary?.projectSubtype);
    const projectTitle = safeStr(projectContextSummary?.projectTitle);
    const projectScope = safeStr(projectContextSummary?.scopeSummary);
    const familyText = [
      projectType,
      projectSubtype,
      projectTitle,
      projectScope,
    ]
      .join(" ")
      .toLowerCase();

    if (/(shed|storage shed|backyard shed|outbuilding)/.test(familyText)) {
      return [
        {
          title: "Site Prep and Foundation",
          description: [
            "- Prepare the site and verify layout.",
            "- Pour or set the foundation/base support.",
            "- Confirm the footprint before framing begins.",
          ].join("\n"),
          recommended_duration_days: 2,
        },
        {
          title: "Floor and Framing",
          description: [
            "- Frame the floor, walls, and primary structure.",
            "- Secure structure alignment and spacing.",
            "- Prepare for roof and exterior shell installation.",
          ].join("\n"),
          recommended_duration_days: 2,
        },
        {
          title: "Roof, Siding, and Weatherproofing",
          description: [
            "- Install roof, siding, and exterior weatherproofing.",
            "- Complete trim, flashing, and sealed transitions.",
            "- Protect the structure against weather exposure.",
          ].join("\n"),
          recommended_duration_days: 3,
        },
        {
          title: "Doors, Windows, and Finish Details",
          description: [
            "- Install doors, windows, trim, and finish details.",
            "- Adjust fit, alignment, and hardware.",
            "- Complete visible finish components.",
          ].join("\n"),
          recommended_duration_days: 1,
        },
        {
          title: "Final Inspection and Cleanup",
          description: [
            "- Complete inspection and punch-list items.",
            "- Cleanup the site and remove debris.",
            "- Review handoff details with the customer.",
          ].join("\n"),
          recommended_duration_days: 1,
        },
      ];
    }

    if (/(roof|roofing)/.test(familyText)) {
      return [
        {
          title: "Site Setup and Protection",
          description: [
            "- Protect the home, staging area, and landscaping.",
            "- Stage materials and prep access points.",
            "- Confirm safety setup before roof work begins.",
          ].join("\n"),
          recommended_duration_days: 1,
        },
        {
          title: "Tear-Off and Deck Prep",
          description: [
            "- Remove existing roofing and underlayment.",
            "- Prepare the deck for repair or replacement.",
            "- Address visible substrate issues before install.",
          ].join("\n"),
          recommended_duration_days: 1,
        },
        {
          title: "Roof Installation",
          description: [
            "- Install underlayment, flashing, and roofing materials.",
            "- Secure edge, penetration, and transition details.",
            "- Complete the primary roof assembly.",
          ].join("\n"),
          recommended_duration_days: 2,
        },
        {
          title: "Cleanup and Final Inspection",
          description: [
            "- Complete cleanup and magnet sweep.",
            "- Review the roof with the customer.",
            "- Confirm punch-list items and closeout.",
          ].join("\n"),
          recommended_duration_days: 1,
        },
      ];
    }

    if (/(concrete|slab|foundation|grading)/.test(familyText)) {
      return [
        {
          title: "Site Layout and Excavation",
          description: [
            "- Lay out the work area and confirm elevations.",
            "- Complete excavation or grading.",
            "- Prepare for forming and pour work.",
          ].join("\n"),
          recommended_duration_days: 1,
        },
        {
          title: "Forming and Reinforcement",
          description: [
            "- Set forms, reinforcement, and base preparation.",
            "- Confirm thickness, slope, and support requirements.",
            "- Prep the surface for placement.",
          ].join("\n"),
          recommended_duration_days: 1,
        },
        {
          title: "Pour and Finish",
          description: [
            "- Place, finish, and cure the slab or foundation.",
            "- Maintain thickness and finish quality.",
            "- Protect the pour during initial cure.",
          ].join("\n"),
          recommended_duration_days: 1,
        },
        {
          title: "Cleanup and Closeout",
          description: [
            "- Remove forms and clean the area.",
            "- Review final details and closeout items.",
            "- Confirm the work area is ready for handoff.",
          ].join("\n"),
          recommended_duration_days: 1,
        },
      ];
    }

    const fallbackRows = buildClarificationAwareMilestoneDraft({
      projectType,
      projectSubtype,
      projectFamilyKey: "",
      projectFamilyLabel: "",
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

  function analyzeMilestonePlan(rows, { existingRows = effectiveMilestones, currentTargetTotal = null } = {}) {
    return assessMilestonePlanGuardrails(rows, {
      existingRows,
      currentTargetTotal:
        currentTargetTotal != null
          ? currentTargetTotal
          : parseAmountStrict(projectBudgetInput) || parseAmountStrict(agreementMeta?.total_cost || agreementMeta?.total),
      projectFamilyKey: safeStr(projectContextSummary?.projectFamilyKey),
      projectFamilyLabel: safeStr(projectContextSummary?.projectFamilyLabel),
      projectTitle: safeStr(projectContextSummary?.projectTitle || agreementMeta?.project_title || agreementMeta?.title || ""),
      projectScope:
        safeStr(
          projectContextSummary?.projectScope ||
            agreementMeta?.scope_of_work ||
            agreementMeta?.description ||
            agreementMeta?.project_description ||
            ""
        ),
    });
  }

  function clearAiMilestonePreview({ clearSuggestedIds = true } = {}) {
    setAiPreview(null);
    setAiMilestonePreviewMode("");
    setAiMilestoneGenerationError("");
    setAiMilestoneApplyPrompt(null);
    setAiMilestonePlanWarningPrompt(null);
    setAiMilestonePlanAnalysis(null);
    if (clearSuggestedIds) {
      setAiSuggestedMilestoneIds([]);
    }
  }

  function buildAiMilestonePreviewAnalysis(mode = "replace") {
    const source = Array.isArray(aiMilestonePreview) ? aiMilestonePreview : [];
    if (!source.length) return { rawRows: [], previewRows: [], analysis: null };

    const rawRows = normalizeCardRows(
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

    const existingRows = mode === "add_missing" ? effectiveMilestones : [];
    const previewRows = sortFallbackMilestones(
      dedupeMilestoneRows(rawRows, { existingRows }).map((row, idx) => ({
        ...row,
        order: idx + 1,
      }))
    );
    const analysis = analyzeMilestonePlan(rawRows, {
      existingRows,
      currentTargetTotal: parseAmountStrict(projectBudgetInput) || parseAmountStrict(agreementMeta?.total_cost || agreementMeta?.total),
    });

    return { rawRows, previewRows, analysis };
  }

  function materializeAiSuggestedMilestones(mode = "replace") {
    const { previewRows } = buildAiMilestonePreviewAnalysis(mode);
    if (!previewRows.length) return [];

    if (mode === "add_missing") {
      return sortFallbackMilestones(
        dedupeMilestoneRows([...effectiveMilestones, ...previewRows], { existingRows: [] }).map((row, idx) => ({
          ...row,
          order: idx + 1,
        }))
      );
    }

    return sortFallbackMilestones(previewRows.map((row, idx) => ({ ...row, order: idx + 1 })));
  }

  function applyAiSuggestedMilestones(mode = "replace", { force = false } = {}) {
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

    const { previewRows, analysis } = buildAiMilestonePreviewAnalysis(mode);
    if (!previewRows.length) {
      toast("No milestone suggestions are available to apply.");
      return;
    }
    if (analysis?.blocked) {
      toast.error(
        analysis.issues?.find((issue) => issue.code === "too_many_milestones")?.message ||
          "AI suggested too many milestones to apply safely."
      );
      setAiMilestonePlanAnalysis(analysis);
      return;
    }

    if (!force && analysis?.needsConfirmation) {
      setAiMilestonePlanAnalysis(analysis);
      setAiMilestonePlanWarningPrompt({ mode, analysis });
      return;
    }

    const nextRows = materializeAiSuggestedMilestones(mode);

    const nextIds = nextRows.map((row) => row?.id).filter(Boolean);
    setFallbackMilestones((prev) => (milestoneRowsEqual(prev, nextRows) ? prev : nextRows));
    setExpandedMilestoneId(nextRows[0]?.id || null);
    setNewMilestoneOpen(false);
    setAiChangeSummary("AI suggested milestones are ready for review.");
    onAiUpdateFeedback("AI suggested milestones are ready for review.");
    clearAiMilestonePreview({ clearSuggestedIds: false });
    setAiSuggestedMilestoneIds(nextIds);
    toast.success(
      mode === "add_missing"
        ? `Added ${nextRows.length} milestone${nextRows.length === 1 ? "" : "s"} after skipping duplicates.`
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

  function startAiMilestoneGeneration(mode = "replace") {
    setAiMilestoneGenerationBusy(true);
    setTimeout(() => {
      try {
        const anchorStart = agreementProjectStartDate || getTodayIsoDate();
        const previewRows = dedupeMilestoneRows(
          normalizeCardRows(
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
          ).filter(Boolean),
          { existingRows: mode === "add_missing" ? effectiveMilestones : [] }
        );
        const adjustedRows = anchorStart
          ? rescheduleMilestonesFromStartDate(previewRows, anchorStart)
          : previewRows;
        const analysis = analyzeMilestonePlan(adjustedRows, {
          existingRows: mode === "add_missing" ? effectiveMilestones : [],
        });

        if (!adjustedRows.length) {
          setAiPreview(null);
          setAiMilestonePlanAnalysis(analysis);
          setAiMilestoneGenerationError(
            "AI suggestions matched your existing milestones. Try replace plan or add milestones manually."
          );
          toast("AI suggestions matched your existing milestones.");
          return;
        }

        const preview = {
          scope_text:
            safeStr(
              agreementMeta?.scope_of_work ||
                agreementMeta?.description ||
                agreementMeta?.project_description
            ) ||
            safeStr(agreementMeta?.project_title || agreementMeta?.title) ||
            safeStr(projectContextSummary?.projectFamilyLabel),
          milestones: adjustedRows,
          questions: aiMilestonePreviewQuestions.length
            ? aiMilestonePreviewQuestions
            : mergedClarificationQuestions,
          raw: { clarification_shaped: true },
        };

        setAiPreview(preview);
        setAiMilestonePreviewMode(mode);
        setAiMilestonePlanAnalysis(analysis);
        setAiSuggestedMilestoneIds([]);
        setAiChangeSummary("AI suggested milestones are ready for review.");
        onAiUpdateFeedback("AI suggested milestones are ready for review.");
        setNewMilestoneOpen(false);
        toast.success(
          `Generated ${adjustedRows.length} suggested milestone${adjustedRows.length === 1 ? "" : "s"}.`
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

    if (effectiveMilestones.length) {
      setAiMilestoneApplyPrompt({
        existingCount: effectiveMilestones.length,
      });
      return;
    }

    startAiMilestoneGeneration("replace");
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

  function commitPricingUpdate({
    nextRows = [],
    message = "",
    changedIds = [],
    clearManualIds = [],
  } = {}) {
    const normalizedRows = sortFallbackMilestones(normalizeCardRows(nextRows).filter(Boolean));
    setFallbackMilestones((prev) => (milestoneRowsEqual(prev, normalizedRows) ? prev : normalizedRows));
    if (Array.isArray(clearManualIds) && clearManualIds.length) {
      const clearSet = new Set(clearManualIds.map((id) => String(id)));
      setManualAmountMilestoneIds((prev) =>
        (Array.isArray(prev) ? prev : []).filter((id) => !clearSet.has(String(id)))
      );
    }
    if (Array.isArray(changedIds) && changedIds.length) {
      setStagedSuggestedMilestoneIds((prev) => [...new Set([...(prev || []), ...changedIds.filter(Boolean)])]);
    }
    if (message) {
      setEstimateBanner(message);
      setAiChangeSummary(message);
      onAiUpdateFeedback(message);
    }
    const highlightIds = (Array.isArray(changedIds) && changedIds.length
      ? changedIds
      : normalizedRows.map((row) => row?.id).filter(Boolean)
    ).filter(Boolean);
    flashPricingHighlights(highlightIds);
  }

  async function persistProjectStartDate(nextStart, { updateTimeline = false } = {}) {
    if (!agreementId) {
      toast.error("Save the agreement first.");
      return false;
    }

    const normalizedStart = toDateOnly(nextStart);
    if (typeof import.meta !== "undefined" && import.meta?.env?.MODE !== "production") {
      console.log("Step2 project start persist", {
        normalizedStart,
        updateTimeline,
        milestoneCount: effectiveMilestones.length,
      });
    }
    setProjectStartDateBusy(true);
    try {
      const { data } = await api.patch(`/projects/agreements/${agreementId}/`, {
        project_start_date: normalizedStart || null,
      });

      if (updateTimeline && normalizedStart) {
        const previousRows = sortFallbackMilestones(normalizeCardRows(effectiveMilestones).filter(Boolean));
        const nextRows = rescheduleMilestonesFromStartDate(previousRows, normalizedStart);
        if (nextRows.length) {
          const normalizedRows = sortFallbackMilestones(nextRows);
          if (typeof import.meta !== "undefined" && import.meta?.env?.MODE !== "production") {
            console.log("Step2 project start reschedule", {
              agreementId,
              previousRows: previousRows.map((row) => ({
                id: row?.id,
                start_date: toDateOnly(row?.start_date || row?.start),
                completion_date: toDateOnly(row?.completion_date || row?.end_date || row?.end),
              })),
              nextRows: normalizedRows.map((row) => ({
                id: row?.id,
                start_date: toDateOnly(row?.start_date || row?.start),
                completion_date: toDateOnly(row?.completion_date || row?.end_date || row?.end),
              })),
            });
          }
          setFallbackMilestones((prev) => (milestoneRowsEqual(prev, normalizedRows) ? prev : normalizedRows));
          setStagedSuggestedTimelineIds((prev) => [
            ...new Set([...(Array.isArray(prev) ? prev : []), ...nextRows.map((row) => row?.id).filter(Boolean)]),
          ]);
          markMilestonesUserModified();
          const feedback = "Milestone dates updated from the new project start date.";
          setAiChangeSummary(feedback);
          onAiUpdateFeedback(feedback);
          for (const row of normalizedRows) {
            if (!isPersistedMilestoneId(row?.id)) continue;
            const payload = buildStep2MilestoneWritePayload(row, row.order);
            await api.patch(`/projects/milestones/${row.id}/`, payload);
          }
        }
      }

      setAgreementMeta((prev) => ({
        ...(prev || {}),
        ...(data || {}),
        project_start_date: data?.project_start_date || data?.start || normalizedStart || "",
      }));

      if (typeof refreshAgreement === "function") {
        await refreshAgreement();
      }
      await refreshAgreementMeta();

      toast.success(
        normalizedStart ? "Project start date saved." : "Project start date cleared."
      );
      return true;
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Unable to save project start date.");
      return false;
    } finally {
      setProjectStartDateBusy(false);
      setProjectStartDatePrompt(null);
    }
  }

  function requestProjectStartDateSave() {
    const nextStart = toDateOnly(projectStartDateDraft);
    if (nextStart === agreementProjectStartDate) {
      toast("Project start date is unchanged.");
      return;
    }

    if (!nextStart) {
      void persistProjectStartDate("", { updateTimeline: false });
      return;
    }

    if (shouldPromptForDateReschedule(agreementProjectStartDate, nextStart, effectiveMilestones)) {
      setProjectStartDatePrompt({
        nextStart,
        milestoneCount: effectiveMilestones.length,
      });
      return;
    }

    void persistProjectStartDate(nextStart, { updateTimeline: effectiveMilestones.length > 0 });
  }

  function applyEstimateSuggestedAmounts() {
    const suggestions = Array.isArray(estimatePreview?.milestone_suggestions)
      ? estimatePreview.milestone_suggestions
      : [];
    const baselineTotal = pricingBaselineTotal;
    if (!baselineTotal || baselineTotal <= 0) {
      toast("No pricing baseline is available yet.");
      return;
    }

    const shouldApply = window.confirm(
      "Apply pricing guidance to the current milestones? Existing amounts will be updated for review."
    );
    if (!shouldApply) return;

    const nextRows = buildWeightedPricingPlan(effectiveMilestones, baselineTotal, suggestions);
    if (!nextRows.length) {
      toast("No milestones are available to update.");
      return;
    }

    const stagedIds = [];
    let appliedCount = 0;
    const changedIds = [];
    const nextById = new Map(nextRows.map((row) => [row?.id, row]));
    const updatedRows = effectiveMilestones.map((row) => {
      const nextRow = nextById.get(row?.id);
      if (!nextRow) return { ...row };
      const nextAmount = parseAmountStrict(nextRow?.amount);
      if (Number.isFinite(nextAmount) && nextAmount > 0) {
        appliedCount += 1;
        if (estimateAmountDiffers(row?.amount, nextAmount)) {
          stagedIds.push(row?.id);
          changedIds.push(row?.id);
        }
        return {
          ...row,
          order: row?.order != null ? row.order : nextRow?.order,
          amount: nextAmount,
        };
      }
      return { ...row };
    });

    if (!appliedCount) {
      toast("No milestone pricing guidance was available to apply.");
      return;
    }

    commitPricingUpdate({
      nextRows: updatedRows,
      message: "Pricing guidance is staged locally. Review and save when ready.",
      changedIds: changedIds.filter(Boolean),
      clearManualIds: effectiveMilestones.map((row) => row?.id).filter(Boolean),
    });
    toast.success(
      `Applied weighted pricing guidance to ${appliedCount} milestone${appliedCount === 1 ? "" : "s"} for review.`
    );
  }

  function buildRebalancedMilestoneRows(targetTotal, keepManualAmounts) {
    const total = parseAmountStrict(targetTotal);
    if (!Number.isFinite(total) || total <= 0) return [];

    const manualIds = keepManualAmounts
      ? new Set(
          effectiveMilestones
            .filter((row) => manualAmountMilestoneIdSet.has(String(row?.id)))
            .map((row) => row?.id)
            .filter(Boolean)
        )
      : new Set();
    const lockMap = new Map();
    if (keepManualAmounts) {
      effectiveMilestones.forEach((row) => {
        if (manualIds.has(row?.id)) {
          const currentAmount = parseAmountStrict(row?.amount);
          if (Number.isFinite(currentAmount) && currentAmount > 0) {
            lockMap.set(row.id, currentAmount);
          }
        }
      });
    }
    const lockedTotal = Array.from(lockMap.values()).reduce((sum, value) => sum + Number(value || 0), 0);
    if (keepManualAmounts && lockedTotal > total) {
      toast.error("Target total is lower than the amounts you have manually edited.");
      return null;
    }
    return buildWeightedPricingPlan(effectiveMilestones, total, estimateSuggestions, {
      lockAmountsById: lockMap,
    });
  }

  function previewRebalanceMilestones() {
    if (!effectiveMilestones.length) {
      toast("Add at least one milestone before rebalancing pricing.");
      return;
    }
    const targetTotal = parseAmountStrict(projectBudgetInput);
    if (!Number.isFinite(targetTotal) || targetTotal <= 0) {
      toast("Enter a target project total before rebalancing milestones.");
      return;
    }
    const manualIds = effectiveMilestones
      .filter((row) => manualAmountMilestoneIdSet.has(String(row?.id)))
      .map((row) => row?.id)
      .filter(Boolean);
    const hasExistingAmounts = effectiveMilestones.some((row) => amountIsValidPositive(row?.amount));
    if (!hasExistingAmounts) {
      const nextRows = buildRebalancedMilestoneRows(targetTotal, false);
      if (!nextRows?.length) {
        toast("No milestones are available to rebalance.");
        return;
      }
      commitPricingUpdate({
        nextRows,
        message: "Milestone pricing updated.",
        changedIds: nextRows.map((row) => row?.id).filter(Boolean),
      });
      toast.success("Milestone pricing updated.");
      return;
    }

    setRebalancePrompt({
      targetTotal,
      manualIds,
    });
  }

  function applyRebalancedMilestones({ keepManualAmounts = false } = {}) {
    const targetTotal = rebalancePrompt?.targetTotal ?? parseAmountStrict(projectBudgetInput);
    const nextRows = buildRebalancedMilestoneRows(targetTotal, keepManualAmounts);
    if (!nextRows?.length) {
      setRebalancePrompt(null);
      return;
    }
    const changedIds = nextRows
      .filter((row) => {
        const currentRow = effectiveMilestones.find((item) => item?.id === row?.id);
        return currentRow ? estimateAmountDiffers(currentRow.amount, row.amount) : true;
      })
      .map((row) => row?.id)
      .filter(Boolean);
    commitPricingUpdate({
      nextRows,
      message: "Milestone pricing updated.",
      changedIds,
      clearManualIds: keepManualAmounts ? [] : effectiveMilestones.map((row) => row?.id).filter(Boolean),
    });
    toast.success("Milestone pricing updated.");
    setRebalancePrompt(null);
  }

  function applyEstimateSuggestedTimeline() {
    const suggestions = Array.isArray(estimatePreview?.milestone_suggestions)
      ? estimatePreview.milestone_suggestions
      : [];
    if (!suggestions.length) {
      toast("No timeline suggestions are available yet.");
      return;
    }

    const suggestionById = new Map(
      suggestions.filter((row) => row?.milestone_id != null).map((row) => [row.milestone_id, row])
    );
    const stagedIds = [];
    const dateEditedIds = manualDateMilestoneIdSet;
    const today = getTodayIsoDate();
    const currentRows = normalizeCardRows(effectiveMilestones);
    const currentStarts = currentRows.map((row) => toDateOnly(row?.start_date || row?.start)).filter(Boolean).sort();
    const firstExistingStart = currentStarts[0] || "";
    const shiftDays = firstExistingStart && today && firstExistingStart < today ? diffDays(firstExistingStart, today) : 0;
    const hasExistingTimeline = !!firstExistingStart;

    const projectStartAnchor = agreementProjectStartDate || today || "";
    let cursor = hasExistingTimeline ? firstExistingStart : projectStartAnchor;
    const nextRows = currentRows.map((row, idx) => {
      const match =
        suggestionById.get(row?.id) ||
        suggestions.find((item) => Number(item?.suggested_order || 0) === idx + 1);
      const durationDays = Math.max(
        Number(match?.suggested_duration_days || row?.recommended_duration_days || getDurationDaysForRow(row) || 0),
        1
      );
      const rowId = row?.id != null ? String(row.id) : "";
      const existingStart = toDateOnly(row?.start_date || row?.start);
      const existingCompletion = toDateOnly(row?.completion_date || row?.end_date || row?.end);
      const isManualDate = dateEditedIds.has(rowId);

      if (isManualDate && (existingStart || existingCompletion)) {
        const preservedStart = existingStart || cursor || today || "";
        const preservedCompletion = existingCompletion || addDays(preservedStart, durationDays - 1);
        cursor = addDays(preservedCompletion, 1);
        return {
          ...row,
          order: row?.order != null ? row.order : idx + 1,
          recommended_duration_days: durationDays,
          start_date: preservedStart,
          completion_date: preservedCompletion,
        };
      }

      if (existingStart || existingCompletion) {
        const shiftedStart = existingStart
          ? shiftDays > 0
            ? addDays(existingStart, shiftDays)
            : existingStart
          : cursor || today || "";
        const shiftedCompletion = existingCompletion
          ? shiftDays > 0
            ? addDays(existingCompletion, shiftDays)
            : existingCompletion
          : addDays(shiftedStart, durationDays - 1);
        cursor = addDays(shiftedCompletion, 1);
        return {
          ...row,
          order: row?.order != null ? row.order : idx + 1,
          recommended_duration_days: durationDays,
          start_date: shiftedStart,
          completion_date: shiftedCompletion,
        };
      }

      const startDate = cursor || projectStartAnchor || today || "";
      const completionDate = addDays(startDate, durationDays - 1);
      cursor = addDays(completionDate, 1);
      return {
        ...row,
        order: row?.order != null ? row.order : idx + 1,
        start_date: startDate,
        completion_date: completionDate,
        recommended_duration_days: durationDays,
      };
    });

    if (!nextRows.length) {
      toast("Unable to stage timeline suggestions.");
      return;
    }

    nextRows.forEach((row, idx) => {
      if (timelineDiffers(effectiveMilestones[idx], row?.start_date || row?.start, row?.completion_date || row?.end_date || row?.end)) {
        stagedIds.push(row?.id);
      }
    });

    const normalizedRows = sortFallbackMilestones(nextRows);
    setFallbackMilestones((prev) => (milestoneRowsEqual(prev, normalizedRows) ? prev : normalizedRows));
    setStagedSuggestedTimelineIds((prev) => [...new Set([...(prev || []), ...stagedIds.filter(Boolean)])]);
    const timelineAdjusted = hasExistingTimeline && currentStarts[0] < today;
    setEstimateBanner(
      timelineAdjusted
        ? "Timeline adjusted to start from today."
        : "Estimate timeline suggestions are staged locally. Review and save when ready."
    );
    markAiUpdated(stagedIds.filter(Boolean).map((id) => `milestone:${id}`));
    {
      const changedCount = stagedIds.filter(Boolean).length || nextRows.length;
      const feedback = timelineAdjusted
        ? "Timeline adjusted to start from today."
        : `Adjusted timeline suggestions for ${changedCount} milestone${
            changedCount === 1 ? "" : "s"
          }.`;
      setAiChangeSummary(feedback);
      onAiUpdateFeedback(feedback);
    }
    toast.success(timelineAdjusted ? "Timeline adjusted to start from today." : "Applied suggested milestone timeline for review.");
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

    const normalizedRows = sortFallbackMilestones(nextRows);
    setFallbackMilestones((prev) => (milestoneRowsEqual(prev, normalizedRows) ? prev : normalizedRows));
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

    const baseRows = normalizeCardRows(Array.isArray(milestones) ? milestones : []);
    const stagedRows = normalizeCardRows(fallbackMilestones).filter(Boolean);

    const baseById = new Map(
      baseRows.filter((row) => isPersistedMilestoneId(row?.id)).map((row) => [Number(row.id), row])
    );
    const stagedById = new Map(
      stagedRows.filter((row) => isPersistedMilestoneId(row?.id)).map((row) => [Number(row.id), row])
    );

    const rowsToDelete = baseRows.filter((row) => isPersistedMilestoneId(row?.id) && !stagedById.has(Number(row.id)));
    const rowsToCreate = stagedRows.filter((row) => !isPersistedMilestoneId(row?.id) || !baseById.has(Number(row.id)));
    const rowsToUpdate = stagedRows.filter((row) => {
      if (!isPersistedMilestoneId(row?.id)) return false;
      const base = baseById.get(Number(row.id));
      return base ? milestonesDifferForPersistence(base, row) : false;
    });
    const rowsRequiringTempOrder = rowsToUpdate.filter((row) => {
      const base = baseById.get(Number(row.id));
      return base ? Number(base.order || 0) !== Number(row.order || 0) : false;
    });

    try {
      for (const row of rowsToDelete) {
        await api.delete(`/projects/milestones/${row.id}/`);
      }

      const tempOrderStart = baseRows.length + rowsToCreate.length + 1000;
      for (const [index, row] of rowsRequiringTempOrder.entries()) {
        const tempPayload = buildStep2MilestoneWritePayload(row, tempOrderStart + index);
        await api.patch(`/projects/milestones/${row.id}/`, tempPayload);
      }

      for (const [index, row] of rowsToCreate.entries()) {
        const payload = buildStep2MilestoneWritePayload(row, row.order || index + 1);
        await api.post(`/projects/milestones/`, payload);
      }

      for (const row of rowsToUpdate) {
        const payload = buildStep2MilestoneWritePayload(row, row.order);
        await api.patch(`/projects/milestones/${row.id}/`, payload);
      }

      await refreshMilestonesSafe();
      return rowsToDelete.length + rowsToCreate.length + rowsToUpdate.length;
    } catch (err) {
      console.warn("persistStagedMilestoneChanges failed:", err);
      throw err;
    }
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
      if (toDateOnly(mLocal.start || mLocal.start_date) || toDateOnly(mLocal.end || mLocal.completion_date)) {
        markMilestoneDatesManual(result?.milestone?.id);
      }
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
        if (toDateOnly(overlapConfirm.data?.start_date) || toDateOnly(overlapConfirm.data?.completion_date)) {
          markMilestoneDatesManual(result?.milestone?.id);
        }
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
        if (toDateOnly(d.start_date) || toDateOnly(d.completion_date)) {
          markMilestoneDatesManual(d.id);
        }
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

  async function handleResetWorkPlan() {
    if (milestonesLocked) {
      lockToast();
      return;
    }
    if (!agreementId) {
      toast.error("Missing agreement id.");
      return;
    }
    if (resetWorkPlanSafety.hasProtectedActivity) {
      setResetWorkPlanError(
        "Reset is blocked because one or more milestones already have invoice, payout, or subcontractor activity."
      );
      return;
    }

    setResetWorkPlanBusy(true);
    setResetWorkPlanError("");
    try {
      await api.post("/projects/milestones/reset-work-plan/", { agreement_id: agreementId });
      toast.success("Work plan reset.");
      setResetWorkPlanOpen(false);
      setNewMilestoneOpen(false);
      setEditOpen(false);
      setEditMilestone(null);
      setEditAiPreview("");
      markMilestonesUserModified();
      await refreshMilestonesSafe();
    } catch (e) {
      const detail =
        e?.response?.data?.detail ||
        e?.response?.data?.message ||
        e?.message ||
        "Reset work plan failed.";
      setResetWorkPlanError(detail);
      toast.error(detail);
    } finally {
      setResetWorkPlanBusy(false);
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
      if (toDateOnly(editForm.start_date) || toDateOnly(editForm.completion_date)) {
        markMilestoneDatesManual(editForm.id);
      }
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
        context: serializeAiContext(buildAiContext({
          page: "agreement_wizard_step2",
          entityId: agreementId || null,
          entityType: "milestone",
          status: agreementMeta?.status || null,
          projectType: projectContextSummary?.projectType || null,
          projectSubtype: projectContextSummary?.projectSubtype || null,
          projectPath: normalizeProjectClass(agreementMeta?.project_class),
          existingScope: editForm.description || null,
        })),
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
        scope_description: safeStr(payload?.scope_description || ""),
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

    let persistedCount = 0;
    try {
      persistedCount = await persistStagedMilestoneChanges();
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Unable to save milestone changes.");
      return;
    }
    if (persistedCount > 0) {
      toast.success(
        `Saved staged estimate changes for ${persistedCount} milestone${persistedCount === 1 ? "" : "s"}.`
      );
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    await persistAnswersToAgreement(null, { source: "user" });

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

    const projectFamilyLabel = safeStr(agreementMeta?.project_family_label);
    const projectSubtype = safeStr(agreementMeta?.project_subtype) || safeStr(agreementMeta?.project_type);
    const projectType = safeStr(agreementMeta?.project_type);
    const description = safeStr(
      agreementMeta?.scope_of_work ||
        agreementMeta?.description ||
        agreementMeta?.project_description ||
        agreementMeta?.project?.description
    );
    const clarificationAnswers = agreementMeta?.ai_scope?.answers || {};
    if (!projectSubtype && !projectType && !description) return;

    autoDraftAttemptedRef.current = true;

    (async () => {
      setAutoDraftBusy(true);
      try {
        const draftRows = buildClarificationAwareMilestoneDraft({
          projectSubtype,
          projectType,
          projectFamilyKey: "",
          projectFamilyLabel,
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
    projectContextSummary?.projectFamilyLabel,
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
        project_family_key: safeStr(projectContextSummary?.projectFamilyKey),
        project_family_label: safeStr(projectContextSummary?.projectFamilyLabel),
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
      projectContextSummary?.projectFamilyKey,
      projectContextSummary?.projectFamilyLabel,
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
      const filteredSuggestions = dedupeMilestoneRows(assistantSuggestionRows, { existingRows: effectiveMilestones });
      if (!filteredSuggestions.length) {
        toast("AI suggestions matched your existing milestones, so nothing new was added.");
        setDismissedAssistantSuggestionSignature(assistantSuggestionSignature);
        return;
      }
      const createdIds = [];
      for (const row of filteredSuggestions) {
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
        const feedback = `Added ${filteredSuggestions.length} milestone suggestion${
          filteredSuggestions.length === 1 ? "" : "s"
        } from AI guidance.`;
        setAiChangeSummary(feedback);
        onAiUpdateFeedback(feedback);
      }
      toast.success(
        `Added ${filteredSuggestions.length} suggested milestone${
          filteredSuggestions.length === 1 ? "" : "s"
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

      <section
        data-testid="step2-subcontractor-plan-panel"
        className="mb-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 shadow-sm"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Subcontractor guidance
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              Will you use subcontractors for this project?
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Choose a project-level preference now. You can still decide milestone by milestone later.
            </div>
            <div className="mt-2 text-sm font-medium text-slate-700">
              {subcontractorPlan === "none"
                ? "You will handle the work yourself unless a milestone needs help later."
                : subcontractorPlan === "some"
                ? "Use subcontractors only where they add value."
                : "You can decide per milestone as the plan develops."}
            </div>
            {agreementPricingStrategy === "requires_sub_quote" ? (
              <div
                data-testid="step2-subcontractor-plan-warning"
                className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              >
                This pricing strategy requires subcontractor pricing before sending.
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="step2-subcontractor-plan-none"
              onClick={() => setSubcontractorPlan("none")}
              className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
                subcontractorPlan === "none"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              No - I'll handle all work
            </button>
            <button
              type="button"
              data-testid="step2-subcontractor-plan-some"
              onClick={() => setSubcontractorPlan("some")}
              className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
                subcontractorPlan === "some"
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              Yes - for some milestones
            </button>
            <button
              type="button"
              data-testid="step2-subcontractor-plan-unsure"
              onClick={() => setSubcontractorPlan("unsure")}
              className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
                subcontractorPlan === "unsure"
                  ? "border-amber-500 bg-amber-500 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              Not sure yet
            </button>
          </div>
        </div>
      </section>

      {milestonesLocked ? (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold">Locked</div>
          <div className="mt-1 text-xs text-amber-900/90">
            Milestones are read-only. {milestonesLockReason || "Create an amendment to change milestones."}
          </div>
        </div>
      ) : null}

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
        <div
          className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          data-testid="step2-pricing-feedback-banner"
        >
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
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-sky-200 bg-white px-3 py-3" data-testid="step2-pricing-summary-card">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">Pricing summary</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-700">
                    <span className="rounded-full bg-slate-50 px-2 py-1 font-medium">
                      Suggested range:{" "}
                      {Number.isFinite(pricingSummaryRangeLow) && Number.isFinite(pricingSummaryRangeHigh)
                        ? `${formatCurrency(pricingSummaryRangeLow)} - ${formatCurrency(pricingSummaryRangeHigh)}`
                        : "Not available"}
                    </span>
                    <span className="rounded-full bg-slate-50 px-2 py-1 font-medium">
                      Current total: {formatCurrency(total)}
                    </span>
                    <span className="rounded-full bg-slate-50 px-2 py-1 font-medium">
                      {pricingSummaryStatus || "Review pricing"}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-slate-600">{pricingSummarySource}</div>
                </div>

                <div className="rounded-xl border border-sky-200 bg-white px-3 py-3">
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-sky-700" htmlFor="step2-target-project-total">
                    Target Project Total
                  </label>
                  <input
                    id="step2-target-project-total"
                    type="number"
                    min="0"
                    step="0.01"
                    value={projectBudgetInput}
                    onChange={(e) => {
                      targetProjectTotalTouchedRef.current = true;
                      setProjectBudgetInput(e.target.value);
                    }}
                    placeholder={safeStr(estimatePreview?.suggested_total_price) || "Enter target total"}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-sky-400 focus:outline-none"
                    data-testid="step2-target-project-total"
                  />
                  <div className="mt-2 text-xs text-slate-600">
                    Change the target, then rebalance the milestone plan when you are ready.
                  </div>
                </div>
              </div>
              <details className="mt-4 rounded-xl border border-sky-200 bg-white px-3 py-3" data-testid="step2-pricing-explanation-details">
                <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900">Why these amounts?</summary>
                <div className="mt-2 text-sm text-slate-700">
                  Pricing uses the project estimate, milestone phase, and similar project guidance. You can override any amount.
                </div>
              </details>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleRunAiSuggest}
                  disabled={aiLoading || aiMilestoneGenerationBusy || milestonesLocked || templateApplied}
                  className="rounded-xl border border-sky-300 bg-white px-3 py-2 text-sm font-medium text-sky-800 hover:bg-sky-50 disabled:opacity-60"
                  data-testid="step2-generate-suggested-milestones"
                >
                  {aiLoading || aiMilestoneGenerationBusy ? "Generating milestones..." : milestonePlanActionLabel}
                </button>
                <button
                  type="button"
                  onClick={applyEstimateSuggestedAmounts}
                  disabled={milestonesLocked || aiLoading || !pricingBaselineTotal}
                  className="rounded-xl border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
                  data-testid="step2-suggest-milestone-pricing"
                >
                  Suggest Milestone Pricing
                </button>
                <button
                  type="button"
                  onClick={previewRebalanceMilestones}
                  disabled={milestonesLocked || aiLoading || aiMilestoneGenerationBusy || !estimateBudgetValue}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  data-testid="step2-rebalance-milestones"
                >
                  Rebalance Milestones
                </button>
                <button
                  type="button"
                  onClick={applyEstimateSuggestedTimeline}
                  disabled={milestonesLocked || aiLoading || aiMilestoneGenerationBusy}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  data-testid="step2-apply-suggested-timeline"
                >
                  Apply Suggested Timeline
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
                <span>Suggest Milestone Pricing: Create initial pricing for each phase.</span>
                <span>Rebalance Milestones: Redistribute your current total across milestones.</span>
              </div>
              <div className="mt-2 text-xs text-slate-500">
                AI suggestions are advisory. Review before applying. MyHomeBro will avoid adding duplicate phases.
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

      {rebalancePrompt ? (
        <section
          className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-4 shadow-sm"
          data-testid="step2-pricing-rebalance-confirmation"
          aria-live="polite"
        >
          <div className="text-sm font-semibold text-amber-950">
            This will overwrite your current milestone plan.
          </div>
          <div className="mt-1 text-sm text-amber-900">
            {rebalancePrompt.manualIds.length
              ? "Keep manually edited amounts?"
              : "Rebalance milestone amounts to the new target total?"}
          </div>
          <div className="mt-2 text-xs text-amber-900/80">
            Target total: {formatCurrency(rebalancePrompt.targetTotal)}
            {rebalancePrompt.manualIds.length ? ` â€¢ ${rebalancePrompt.manualIds.length} manual milestone${rebalancePrompt.manualIds.length === 1 ? "" : "s"} detected` : ""}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {rebalancePrompt.manualIds.length ? (
              <>
                <button
                  type="button"
                  onClick={() => applyRebalancedMilestones({ keepManualAmounts: true })}
                  className="rounded-xl bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
                >
                  Keep manual amounts and rebalance the rest
                </button>
                <button
                  type="button"
                  onClick={() => applyRebalancedMilestones({ keepManualAmounts: false })}
                  className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50"
                >
                  Rebalance all
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => applyRebalancedMilestones({ keepManualAmounts: false })}
                className="rounded-xl bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
              >
                Rebalance Milestones
              </button>
            )}
            <button
              type="button"
              onClick={() => setRebalancePrompt(null)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

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
          <div className="mt-1 text-xs font-medium text-amber-900">
            AI suggestions are advisory. Review before applying. MyHomeBro will avoid adding duplicate phases.
          </div>
          {aiMilestonePlanAnalysis?.issues?.length ? (
            <div className="mt-3 rounded-xl border border-amber-300 bg-white px-3 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                Plan quality warnings
              </div>
              <ul className="mt-2 space-y-1 text-sm text-amber-950">
                {aiMilestonePlanAnalysis.issues.map((issue) => (
                  <li key={issue.code}>{issue.message}</li>
                ))}
              </ul>
              {formatMilestoneGuardrailSummary(aiMilestonePlanAnalysis).length ? (
                <div className="mt-2 text-xs text-amber-900/90">
                  {formatMilestoneGuardrailSummary(aiMilestonePlanAnalysis)[0]}
                </div>
              ) : null}
            </div>
          ) : null}
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
            <button
              type="button"
              onClick={() => applyAiSuggestedMilestones(aiMilestonePreviewMode || "replace")}
              disabled={
                aiLoading ||
                milestonesLocked ||
                templateApplied ||
                aiMilestonePlanAnalysis?.blocked
              }
              className="rounded-xl bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
              data-testid="step2-apply-suggested-milestones"
            >
              {aiMilestonePreviewMode === "add_missing"
                ? "Add Missing Only"
                : effectiveMilestones.length
                ? "Replace Plan"
                : "Apply Suggested Milestones"}
            </button>
            <button
              type="button"
              onClick={clearAiMilestonePreview}
              disabled={aiLoading}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {aiMilestoneApplyPrompt ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          data-testid="step2-ai-milestone-apply-prompt"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="text-lg font-semibold text-slate-900">Replace existing milestones or add missing phases?</div>
            <div className="mt-2 text-sm text-slate-700">
              You already have {aiMilestoneApplyPrompt.existingCount || 0} milestone
              {aiMilestoneApplyPrompt.existingCount === 1 ? "" : "s"} on this agreement.
              Choose how AI should handle the new draft.
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setAiMilestoneApplyPrompt(null);
                  startAiMilestoneGeneration("replace");
                }}
                className="rounded-xl bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
              >
                Replace Plan
              </button>
              <button
                type="button"
                onClick={() => {
                  setAiMilestoneApplyPrompt(null);
                  startAiMilestoneGeneration("add_missing");
                }}
                className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50"
              >
                Add Missing Only
              </button>
              <button
                type="button"
                onClick={() => setAiMilestoneApplyPrompt(null)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {aiMilestonePlanWarningPrompt ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          data-testid="step2-ai-plan-warning-prompt"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="text-lg font-semibold text-slate-900">Review plan quality warnings</div>
            <div className="mt-2 text-sm text-slate-700">
              This AI draft still needs a quick confirmation before it is applied.
            </div>
            {aiMilestonePlanWarningPrompt.analysis?.issues?.length ? (
              <ul className="mt-3 space-y-1 text-sm text-slate-700">
                {aiMilestonePlanWarningPrompt.analysis.issues.map((issue) => (
                  <li key={issue.code}>- {issue.message}</li>
                ))}
              </ul>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const mode = aiMilestonePlanWarningPrompt.mode || "replace";
                  setAiMilestonePlanWarningPrompt(null);
                  applyAiSuggestedMilestones(mode, { force: true });
                }}
                className="rounded-xl bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
              >
                Apply Anyway
              </button>
              <button
                type="button"
                onClick={() => setAiMilestonePlanWarningPrompt(null)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {projectStartDatePrompt ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          data-testid="step2-project-start-date-prompt"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="text-lg font-semibold text-slate-900">Update milestone dates from new start date?</div>
            <div className="mt-2 text-sm text-slate-700">
              The agreement already has {projectStartDatePrompt.milestoneCount || 0} milestone
              {projectStartDatePrompt.milestoneCount === 1 ? "" : "s"} on it.
              Choose whether to shift the current milestone dates or keep them as they are.
            </div>
            <div className="mt-2 text-sm text-slate-700">
              New start date: <span className="font-semibold">{friendly(projectStartDatePrompt.nextStart)}</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => persistProjectStartDate(projectStartDatePrompt.nextStart, { updateTimeline: true })}
                className="rounded-xl bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
              >
                Update dates
              </button>
              <button
                type="button"
                onClick={() => persistProjectStartDate(projectStartDatePrompt.nextStart, { updateTimeline: false })}
                className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50"
              >
                Keep existing dates
              </button>
              <button
                type="button"
                onClick={() => setProjectStartDatePrompt(null)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {false && estimatePreview ? (
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
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Target project total</div>
              <div className="mt-2 text-sm text-slate-700">
                {projectBudgetInput
                  ? `Rebalance will use ${formatCurrency(projectBudgetInput)} as the target total.`
                  : "Set a target total above to rebalance milestone pricing."}
              </div>
              <div className="mt-1 text-xs text-slate-600">{step2ModeMeta.budgetDescription}</div>
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
                dataTestId={step2InsightCards.pricing.testId}
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
              <div className="text-sm font-semibold text-slate-900">Target project total</div>
              <div className="mt-1 text-xs text-slate-600">
                {projectBudgetInput
                  ? `Current target: ${formatCurrency(projectBudgetInput)}`
                  : "Set the target total above to rebalance milestone pricing."}
              </div>
              {projectBudgetInput &&
              Number.isFinite(Number(estimatePreview?.suggested_total_price)) &&
              Number(estimatePreview?.suggested_total_price || 0) > Number(projectBudgetInput || 0) ? (
                <div className="mt-1 text-xs text-amber-700">
                  Similar projects may range higher, but your current total remains{" "}
                  {formatCurrency(projectBudgetInput)} unless you apply changes.
                </div>
              ) : null}
              <div className="mt-1 text-xs text-slate-600">{step2ModeMeta.budgetDescription}</div>
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
              {aiApplying ? "Applying" : "Add Missing Milestones (Bulk)"}
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
            {effectiveMilestones.length ? (
              <button
                type="button"
                onClick={() => {
                  setResetWorkPlanError("");
                  setResetWorkPlanOpen(true);
                }}
                className="rounded-xl border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                disabled={milestonesLocked}
                data-testid="step2-reset-work-plan"
              >
                Reset Work Plan
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-600">
          AI milestone generation coming next.
        </div>

        <div
          className="mt-4 rounded-2xl border border-sky-300/25 bg-slate-950/45 p-4 shadow-sm shadow-slate-950/20 ring-1 ring-white/5"
          data-testid="step2-project-start-date-card"
        >
          <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-sm font-semibold text-sky-50">Project Start Date</div>
              <div className="mt-1 text-xs text-sky-100/75">
                Used to schedule milestone dates. You can adjust dates later.
              </div>
            </div>
            <div className="text-xs font-medium text-sky-100/80">
              {agreementProjectStartDate
                ? `Current saved date: ${friendly(agreementProjectStartDate)}`
                : "No saved start date yet"}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sky-100/75">
                Project Start Date
              </label>
              <input
                type="date"
                value={projectStartDateDraft || ""}
                onChange={(e) => setProjectStartDateDraft(e.target.value)}
                disabled={projectStartDateBusy || milestonesLocked}
                className="w-full rounded-xl border border-sky-300/25 bg-slate-950/60 px-3 py-2 text-sm text-sky-50 shadow-inner shadow-slate-950/20 outline-none transition [color-scheme:dark] placeholder:text-sky-100/40 focus:border-amber-300/60 focus:ring-2 focus:ring-amber-300/20 disabled:bg-slate-900/60 disabled:text-sky-100/40"
                data-testid="step2-project-start-date-input"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={requestProjectStartDateSave}
                disabled={projectStartDateBusy || milestonesLocked}
                className="rounded-xl border border-amber-300/45 bg-gradient-to-r from-blue-700 via-indigo-700 to-violet-700 px-3 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-950/25 transition hover:border-amber-200 hover:from-blue-600 hover:to-violet-600 hover:shadow-blue-500/20 focus:outline-none focus:ring-2 focus:ring-amber-300/60 disabled:cursor-not-allowed disabled:border-slate-500/30 disabled:from-slate-700 disabled:via-slate-700 disabled:to-slate-700 disabled:text-slate-300 disabled:shadow-none"
                data-testid="step2-project-start-date-save"
              >
                {projectStartDateBusy ? "Saving..." : "Save Start Date"}
              </button>
              <button
                type="button"
                onClick={() => setProjectStartDateDraft(agreementProjectStartDate || "")}
                disabled={projectStartDateBusy || milestonesLocked}
                className="rounded-xl border border-sky-300/25 bg-white/10 px-3 py-2 text-sm font-semibold text-sky-100 transition hover:border-sky-200/50 hover:bg-sky-400/15 focus:outline-none focus:ring-2 focus:ring-sky-300/30 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="step2-project-start-date-reset"
              >
                Reset
              </button>
            </div>
          </div>
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

        <section
          data-testid="step2-pricing-readiness-panel"
          className={`mb-4 rounded-2xl border px-4 py-4 text-sm ${
            pricingReadinessCopy.tone === "danger"
              ? "border-rose-200 bg-rose-50 text-rose-900"
              : pricingReadinessCopy.tone === "warning"
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide opacity-80">Next Step</div>
              <div className="mt-1 font-semibold">{pricingReadinessCopy.title}</div>
              <div className="mt-1 text-xs opacity-80">{pricingReadinessCopy.body}</div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
              <span className="rounded-full bg-white/80 px-2.5 py-1 text-slate-700">
                Fixed: {pricingReadiness.fixedCount}
              </span>
              <span className="rounded-full bg-white/80 px-2.5 py-1 text-slate-700">
                Estimated: {pricingReadiness.estimatedCount}
              </span>
              <span className="rounded-full bg-white/80 px-2.5 py-1 text-slate-700">
                Pending quotes: {pricingReadiness.pendingQuoteCount}
              </span>
            </div>
          </div>
        </section>

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
                Path: {projectContextSummary.projectType || projectContextSummary.projectSubtype || projectContextSummary.projectTitle || projectContextSummary.projectFamilyLabel || projectClassLabel(projectClass)}
              </span>
            </div>
            <div
              className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-900"
              data-testid="step2-milestone-generation-context"
            >
              Milestones generated for: {milestoneGenerationContextLabel}
            </div>
            <div className="text-xs text-slate-500">Drag to reorder. Click edit to customize.</div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {normalizeCardRows(effectiveMilestones).map((m, idx) => {
                const estimate = getEstimateAssistMeta(m);
                const projectEstimateGuidance =
                  estimateGuidanceByMilestone.get(m?.id ?? `row-${idx + 1}`) || null;
                const aiHighlight = m?.id != null ? aiHighlights[`milestone:${m.id}`] : null;
                const pricingHighlight =
                  m?.id != null && pricingHighlightMilestoneIds.includes(String(m.id));
                const isAiSuggested = m?.id != null && aiSuggestedMilestoneIds.includes(m.id);
                const isManualAmount = m?.id != null && manualAmountMilestoneIdSet.has(String(m.id));
                const isExpanded = expandedMilestoneId === m.id;
                const quoteRequest = m?.subcontractor_quote_request || null;
                const quoteStatus = safeStr(quoteRequest?.status).toLowerCase();
                const quoteAmount = quoteRequest?.quoted_amount || "";
                const subcontractorAgreement = m?.subcontractor_milestone_agreement || null;
                const payoutState = m?.subcontractor_payout_orchestration || null;
                const subcontractorPlanState = normalizeSubcontractorPlan(subcontractorPlan);
                const hasMilestoneLifecycleState = milestoneHasSubcontractorLifecycleState(m);
                const revealSubcontractorActions =
                  subcontractorPlanState === "some" ||
                  subcontractorPlanState === "unsure" ||
                  hasMilestoneLifecycleState ||
                  revealedSubcontractorMilestoneIdSet.has(String(m.id));
                const shouldShowQuoteAction =
                  agreementPricingStrategy === "requires_sub_quote" || revealSubcontractorActions;
                const shouldShowFixedPayAction =
                  revealSubcontractorActions || hasMilestoneLifecycleState;
                const shouldShowAssignLaterAction =
                  revealSubcontractorActions || hasMilestoneLifecycleState || subcontractorPlanState !== "none";
                const assignedSubcontractorName =
                  m?.assigned_subcontractor?.display_name ||
                  m?.assigned_subcontractor?.email ||
                  m?.assigned_worker?.display_name ||
                  m?.assigned_worker?.email ||
                  subcontractorAgreement?.subcontractor_display_name ||
                  subcontractorAgreement?.subcontractor_email ||
                  "";
                const subcontractorSummary = getMilestoneSubcontractorSummary(
                  m,
                  agreementPricingStrategy,
                  subcontractorPlanState
                );
                const nextStepLabel = getNextStepLabel(
                  m,
                  agreementMeta || {},
                  quoteRequest,
                  subcontractorAgreement,
                  payoutState,
                  subcontractorPlanState
                );
                const primaryAction = getMilestonePrimaryAction(
                  m,
                  agreementMeta || {},
                  quoteRequest,
                  subcontractorAgreement,
                  payoutState,
                  subcontractorPlanState
                );
                const hasRealNextStep = Boolean(primaryAction.key && primaryAction.key !== "none" && primaryAction.label);
                const dateRangeLabel = formatMilestoneDateRange(m.start_date || m.start, m.completion_date || m.end_date || m.end);
                const isPlanDetailsOpen = expandedMilestoneId === m.id;
                const currentAgreementStatus = safeStr(subcontractorAgreement?.agreement_acceptance_status).toLowerCase();
                const currentAgreementStatusLabel = currentAgreementStatus
                  ? currentAgreementStatus === "accepted"
                    ? "Approved"
                    : currentAgreementStatus === "pending" || currentAgreementStatus === "not_sent"
                    ? "Waiting"
                    : currentAgreementStatus === "declined"
                    ? "Declined"
                    : currentAgreementStatus.charAt(0).toUpperCase() + currentAgreementStatus.slice(1)
                  : "";
                const currentPayoutState = safeStr(
                  payoutState?.payout_state || payoutState?.next_status || payoutState?.payout_status
                ).toLowerCase();
                return (
                  <article
                    key={m.id || `${m.title}-${idx}`}
                    className={`rounded-2xl border bg-white p-4 shadow-sm transition-shadow ${
                      aiHighlight || pricingHighlight ? "border-amber-300 ring-2 ring-amber-100" : "border-slate-200"
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
                      <div className="flex-1">
                        <button
                          type="button"
                          className="block w-full text-left"
                          onClick={() => toggleCardExpanded(m.id)}
                          data-testid={`step2-milestone-summary-${m.id || idx + 1}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              data-testid={`step2-milestone-number-${m.id || idx + 1}`}
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-900 bg-slate-900 text-sm font-bold leading-none text-white shadow-sm"
                            >
                              {idx + 1}
                            </span>
                            <div className="text-base font-semibold text-slate-950">
                              {m.title || "Untitled milestone"}
                            </div>
                          </div>
                          <div className="mt-3 space-y-2">
                            <div>
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                Customer Price
                              </div>
                              <div className="text-sm font-semibold text-slate-900">
                                {Number(m.amount || 0).toLocaleString(undefined, {
                                  style: "currency",
                                  currency: "USD",
                                })}
                              </div>
                            </div>
                            {dateRangeLabel ? (
                              <div
                                data-testid={`step2-milestone-date-range-${m.id || idx + 1}`}
                                className="text-sm text-slate-700"
                              >
                                <span className="font-semibold text-slate-900">Date:</span>{" "}
                                {dateRangeLabel.replace(/^Date:\s*/, "")}
                              </div>
                            ) : null}
                            <div
                              data-testid={`step2-milestone-subcontractor-summary-${m.id || idx + 1}`}
                              className="text-sm text-slate-700"
                            >
                              <span className="font-semibold text-slate-900">Subcontractor:</span>{" "}
                              {subcontractorSummary}
                            </div>
                            {hasRealNextStep ? (
                              <div
                                data-testid={`step2-milestone-next-step-${m.id || idx + 1}`}
                                className="text-sm text-slate-700"
                              >
                                <span className="font-semibold text-slate-900">Next Step:</span> {nextStepLabel}
                              </div>
                            ) : (
                              <div
                                data-testid={`step2-milestone-status-${m.id || idx + 1}`}
                                className="text-sm text-slate-700"
                              >
                                <span className="font-semibold text-slate-900">Status:</span> Good to go
                              </div>
                            )}
                          </div>
                        </button>
                        {hasRealNextStep ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              data-testid={`step2-milestone-primary-action-${m.id || idx + 1}`}
                              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                              onClick={() => {
                                if (primaryAction.key === "assign_subcontractor") {
                                  assignFixedPayTarget(m);
                                  return;
                                }
                                if (primaryAction.key === "assign_later") {
                                  assignLaterForMilestone(m.id);
                                  return;
                                }
                                if (
                                  primaryAction.key === "request_quote" ||
                                  primaryAction.key === "view_quote" ||
                                  primaryAction.key === "review_quote"
                                ) {
                                  requestQuoteForMilestone(m.id);
                                  return;
                                }
                                if (primaryAction.key === "send_agreement") {
                                  assignFixedPayTarget(m);
                                  return;
                                }
                              }}
                              disabled={milestonesLocked}
                            >
                              {primaryAction.label}
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-xs font-medium disabled:opacity-60"
                          onClick={() => handleEditClick(m, idx)}
                          disabled={milestonesLocked}
                        >
                          Edit
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

                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2">
                      <button
                        type="button"
                        className="flex w-full items-start justify-between gap-3 text-left"
                        onClick={() => toggleCardExpanded(m.id)}
                        aria-expanded={isPlanDetailsOpen}
                        data-testid={`step2-plan-details-toggle-${m.id || idx + 1}`}
                      >
                        <div>
                          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                            <span
                              className={`inline-block transition-transform duration-200 ${isPlanDetailsOpen ? "rotate-90" : ""}`}
                              aria-hidden="true"
                            >
                              {isPlanDetailsOpen ? "▼" : "▶"}
                            </span>
                            <span>Plan Details</span>
                          </div>
                          {!isPlanDetailsOpen ? (
                            <div className="mt-1 text-xs text-slate-500">
                              View scope, subcontractor plan, and financial details
                            </div>
                          ) : null}
                        </div>
                      </button>

                      {isPlanDetailsOpen ? (
                        <div className="mt-3 space-y-4 text-sm text-slate-700">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scope</div>
                            <div className="mt-1 whitespace-pre-wrap text-slate-700">
                              {safeStr(m.description) || "No scope summary yet."}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subcontractor Plan</div>
                            <div className="mt-1 space-y-1 text-slate-700">
                              <div>
                                <span className="font-medium text-slate-900">Status:</span> {subcontractorSummary}
                              </div>
                              {assignedSubcontractorName ? (
                                <div>
                                  <span className="font-medium text-slate-900">Assigned:</span> {assignedSubcontractorName}
                                </div>
                              ) : null}
                              {quoteStatus ? (
                                <div>
                                  <span className="font-medium text-slate-900">Quote:</span> {getSimpleStateLabel(quoteStatus)}
                                  {quoteAmount ? ` — ${formatCurrency(quoteAmount)}` : ""}
                                </div>
                              ) : null}
                              {subcontractorAgreement?.agreed_pay ? (
                                <div>
                                  <span className="font-medium text-slate-900">Agreed pay:</span> {formatCurrency(subcontractorAgreement.agreed_pay)}
                                </div>
                              ) : null}
                            </div>
                            {agreementPricingStrategy === "requires_sub_quote" && !quoteStatus ? (
                              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                                This milestone needs subcontractor pricing before sending.
                              </div>
                            ) : null}

                            {subcontractorPlanState === "none" &&
                            !hasMilestoneLifecycleState &&
                            !revealedSubcontractorMilestoneIdSet.has(String(m.id)) ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setRevealedSubcontractorMilestoneIds((current) =>
                                    [...new Set([...(Array.isArray(current) ? current : []), String(m.id)])]
                                  )
                                }
                                disabled={milestonesLocked}
                                className="mt-3 text-xs font-semibold text-indigo-700 hover:text-indigo-800 disabled:opacity-60"
                              >
                                Need one after all?
                              </button>
                            ) : null}

                            {shouldShowAssignLaterAction || shouldShowFixedPayAction || shouldShowQuoteAction ? (
                              <div
                                className={`mt-3 flex flex-wrap gap-2 ${
                                  subcontractorPlanState === "unsure" ? "opacity-90" : ""
                                }`}
                              >
                                {shouldShowAssignLaterAction ? (
                                  <button
                                    type="button"
                                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${
                                      subcontractorPlanState === "some"
                                        ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                                        : subcontractorPlanState === "unsure"
                                        ? "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                                        : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                                    }`}
                                    onClick={() => assignLaterForMilestone(m.id)}
                                    disabled={milestonesLocked}
                                  >
                                    Assign later
                                  </button>
                                ) : null}
                                {shouldShowFixedPayAction ? (
                                  <button
                                    type="button"
                                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${
                                      subcontractorPlanState === "some"
                                        ? "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                                        : subcontractorPlanState === "unsure"
                                        ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                        : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                                    }`}
                                    onClick={() => assignFixedPayTarget(m)}
                                    disabled={milestonesLocked}
                                  >
                                    Assign with fixed pay
                                  </button>
                                ) : null}
                                {shouldShowQuoteAction ? (
                                  <button
                                    type="button"
                                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${
                                      agreementPricingStrategy === "requires_sub_quote"
                                        ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                                        : subcontractorPlanState === "some"
                                        ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                    }`}
                                    onClick={() => requestQuoteForMilestone(m.id)}
                                    disabled={milestonesLocked || subcontractorsLoading}
                                  >
                                    Request quote
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>

                          {subcontractorAgreement?.agreement_acceptance_status ? (
                            <div>
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Agreement Status
                              </div>
                              <div className="mt-1 text-slate-700">
                                {currentAgreementStatusLabel || "Waiting"}
                              </div>
                            </div>
                          ) : null}

                          {subcontractorAgreement || payoutState ? (
                            <div>
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment</div>
                              <div className="mt-1 space-y-1 text-slate-700">
                                {subcontractorAgreement?.payment_release_mode ? (
                                  <div>
                                    <span className="font-medium text-slate-900">Release mode:</span> {paymentReleaseModeLabel(subcontractorAgreement.payment_release_mode)}
                                  </div>
                                ) : null}
                                {currentPayoutState ? (
                                  <div>
                                    <span className="font-medium text-slate-900">Payout:</span> {getSimpleStateLabel(currentPayoutState)}
                                  </div>
                                ) : null}
                                {payoutState?.safe_summary ? <div>{payoutState.safe_summary}</div> : null}
                              </div>
                            </div>
                          ) : null}

                          <details className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-slate-600">
                              Show financial details
                            </summary>
                            <div className="mt-3 grid gap-2 md:grid-cols-3">
                              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Customer Price</div>
                                <div className="mt-1 font-semibold text-slate-900">{formatCurrency(m.amount) || "—"}</div>
                              </div>
                              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Subcontractor Pay</div>
                                <div className="mt-1 font-semibold text-slate-900">{formatCurrency(subcontractorAgreement?.agreed_pay) || "—"}</div>
                              </div>
                              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Your Earnings</div>
                                <div className="mt-1 font-semibold text-slate-900">
                                  {Number.isFinite(Number(m.amount)) && Number.isFinite(Number(subcontractorAgreement?.agreed_pay))
                                    ? formatCurrency(Math.max(Number(m.amount) - Number(subcontractorAgreement.agreed_pay), 0))
                                    : formatCurrency(m.amount) || "—"}
                                </div>
                              </div>
                            </div>
                          </details>
                        </div>
                      ) : null}
                    </div>

                    {editOpen && editMilestone?.id === m.id ? (
                      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-700">
                        <div className="font-semibold text-slate-900">Editing in modal</div>
                        <div className="mt-1">
                          Use the Edit button to open the milestone editor and save or cancel your changes explicitly.
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
              No milestones yet.
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={handleRunAiSuggest}
                disabled={milestonesLocked || aiLoading || aiMilestoneGenerationBusy || templateApplied}
                className="rounded-xl border border-sky-300 bg-white px-3 py-2 text-sm font-medium text-sky-800 hover:bg-sky-50 disabled:opacity-60"
                data-testid="step2-empty-generate-milestones"
              >
                {aiLoading || aiMilestoneGenerationBusy ? "Generating milestones..." : "Generate Suggested Milestones"}
              </button>
              <button
                type="button"
                onClick={() => setNewMilestoneOpen(true)}
                disabled={milestonesLocked}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                data-testid="step2-empty-add-milestone"
              >
                Add Milestone Manually
              </button>
            </div>
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
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              {estimate.primaryLabel === "Total" ? "Est." : estimate.primaryLabel}
                            </span>{" "}
                            <span className="font-medium">
                              {formatCurrency(estimate.primaryLow)} – {formatCurrency(estimate.primaryHigh)}
                            </span>
                          </div>
                        ) : null}

                        {m?.retainage_pct != null && Number(m.retainage_pct) > 0 ? (
                          <div className="text-[10px] text-slate-500">
                            Retainage: {Number(m.retainage_pct)}%
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
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              {estimate.primaryLabel === "Total" ? "Est." : estimate.primaryLabel}
                            </span>{" "}
                            <span className="font-medium">
                              {formatCurrency(estimate.primaryLow)} – {formatCurrency(estimate.primaryHigh)}
                            </span>
                          </div>
                        ) : null}

                        {m?.retainage_pct != null && Number(m.retainage_pct) > 0 ? (
                          <div className="text-[10px] text-slate-500">
                            Retainage: {Number(m.retainage_pct)}%
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

      {resetWorkPlanOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div
            className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl"
            data-testid="step2-reset-work-plan-confirmation"
            role="dialog"
            aria-modal="true"
            aria-labelledby="step2-reset-work-plan-title"
          >
            <div className="text-lg font-semibold text-slate-950" id="step2-reset-work-plan-title">
              Reset work plan?
            </div>
            <div className="mt-2 text-sm text-slate-700">
              This will remove all current milestones for this agreement. Your project details, customer info, and pricing strategy will stay the same.
            </div>
            {resetWorkPlanSafety.hasProtectedActivity ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                Reset is blocked because this agreement already has {resetWorkPlanSafety.summary.join(", ")}.
                Remove or resolve those records first.
              </div>
            ) : null}
            {resetWorkPlanError ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {resetWorkPlanError}
              </div>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (resetWorkPlanBusy) return;
                  setResetWorkPlanOpen(false);
                  setResetWorkPlanError("");
                }}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                disabled={resetWorkPlanBusy}
                data-testid="step2-reset-work-plan-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetWorkPlan}
                disabled={resetWorkPlanBusy || resetWorkPlanSafety.hasProtectedActivity}
                className="rounded-xl border border-rose-300 bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                data-testid="step2-reset-work-plan-confirm"
              >
                {resetWorkPlanBusy ? "Resetting..." : "Reset Plan"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between">
        <button type="button" onClick={handleBackClick} className="rounded border px-3 py-2 text-sm">
          Back
        </button>
        <button
          type="button"
          onClick={handleNext}
          className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
          disabled={userSaveInProgress}
        >
          {userSaveInProgress ? "Saving" : "Save & Next"}
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
          safeStr(agreementMeta?.ai_scope?.scope_text) ||
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

      {subcontractorAssignTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-slate-900">Assign Subcontractor</div>
                <div className="text-sm text-slate-600">
                  {subcontractorAssignTarget.title || "Milestone"} - Customer price {formatCurrency(subcontractorAssignTarget.amount)}
                </div>
              </div>
              <button
                type="button"
                onClick={closeSubcontractorAssignTarget}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              >
                Close
              </button>
            </div>

            <div className="mt-4">
              <AssignSubcontractorInline
                acceptedSubcontractors={acceptedSubcontractors}
                currentAssignment={
                  subcontractorAssignTarget.assigned_subcontractor ||
                  subcontractorAssignTarget.assigned_worker ||
                  null
                }
                currentAgreement={
                  subcontractorAssignTarget.subcontractor_milestone_agreement ||
                  subcontractorAssignTarget
                }
                milestoneAmount={subcontractorAssignTarget.amount}
                onAssign={async (invitationId, options) => {
                  await assignMilestoneSubcontractor(subcontractorAssignTarget.id, invitationId, options);
                  if (typeof reloadMilestones === "function") {
                    await reloadMilestones();
                  }
                  await refreshAgreementMeta();
                  setQuoteMessage(`Assigned ${subcontractorAssignTarget.title || "milestone"} to subcontractor.`);
                  closeSubcontractorAssignTarget();
                }}
                onUnassign={async () => {
                  await unassignMilestoneSubcontractor(subcontractorAssignTarget.id);
                  if (typeof reloadMilestones === "function") {
                    await reloadMilestones();
                  }
                  await refreshAgreementMeta();
                  setQuoteMessage(
                    `Removed subcontractor assignment from ${subcontractorAssignTarget.title || "milestone"}.`
                  );
                  closeSubcontractorAssignTarget();
                }}
                disabled={milestonesLocked}
              />
            </div>
          </div>
        </div>
      ) : null}

      {subcontractorQuoteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-slate-900">Request Quote</div>
                <div className="text-sm text-slate-600">
                  {subcontractorQuoteTarget.title || "Milestone"} - Scope from the milestone card
                </div>
              </div>
              <button
                type="button"
                onClick={closeQuoteTarget}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Subcontractor
                </label>
                <select
                  data-testid="step2-quote-subcontractor-select"
                  value={quoteFormSubcontractorId}
                  onChange={(e) => setQuoteFormSubcontractorId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Select subcontractor</option>
                  {acceptedSubcontractors.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.accepted_name || row.invite_name || row.invite_email || "Subcontractor"}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Scope
                </label>
                <textarea
                  value={subcontractorQuoteTarget.description || ""}
                  readOnly
                  rows={4}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Optional message
                </label>
                <textarea
                  data-testid="step2-quote-message-input"
                  value={quoteFormMessage}
                  onChange={(e) => setQuoteFormMessage(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Add a short note for the subcontractor."
                />
              </div>

              {quoteMessage ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {quoteMessage}
                </div>
              ) : null}

              {!activeQuoteRequest || activeQuoteStatus === "declined" || activeQuoteStatus === "cancelled" ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="step2-request-quote-button"
                    className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
                    onClick={confirmQuoteRequest}
                    disabled={subcontractorsLoading || !quoteFormSubcontractorId || quoteReviewBusy}
                  >
                    {quoteReviewBusy ? "Working..." : "Request Quote"}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={closeQuoteTarget}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                  <div className="font-semibold text-slate-900">
                    {activeQuoteStatus === "responded"
                      ? `Quote received${activeQuoteAmount > 0 ? ` - ${formatCurrency(activeQuoteAmount)}` : ""}`
                      : activeQuoteStatus === "accepted"
                      ? `Quote accepted${activeQuoteAmount > 0 ? ` - ${formatCurrency(activeQuoteAmount)}` : ""}`
                      : activeQuoteStatus === "revision_requested"
                      ? "Revision requested"
                      : "Waiting for subcontractor quote"}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-slate-600">
                    {activeQuoteRequest.contractor_message || "No contractor note provided."}
                  </div>

                  {activeQuoteStatus === "sent" || activeQuoteStatus === "revision_requested" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => cancelQuoteRequestAction(activeQuoteRequest)}
                        disabled={quoteReviewBusy}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                      >
                        Cancel Request
                      </button>
                      <button
                        type="button"
                        onClick={() => declineQuoteRequest()}
                        disabled={quoteReviewBusy}
                        className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                      >
                        Decline
                      </button>
                    </div>
                  ) : null}

                  {activeQuoteStatus === "responded" ? (
                    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                      <div className="grid gap-2 md:grid-cols-2">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Quote Amount
                          </div>
                          <div className="font-semibold text-slate-900">
                            {formatCurrency(activeQuoteAmount)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Payment Release
                          </div>
                          <select
                            value={quoteReviewPaymentMode}
                            onChange={(e) => setQuoteReviewPaymentMode(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          >
                            <option value="manual_release">Manual Release</option>
                            <option value="auto_after_customer_approval">Auto-Release After Customer Approval</option>
                          </select>
                        </div>
                      </div>

                      {activeQuoteAmount > Number(subcontractorQuoteTarget?.amount || 0) ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          This quote exceeds the customer milestone amount. Add an override reason before accepting.
                        </div>
                      ) : null}

                      {activeQuoteAmount > Number(subcontractorQuoteTarget?.amount || 0) ? (
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Override Reason
                          </label>
                          <textarea
                            value={quoteReviewOverrideReason}
                            onChange={(e) => setQuoteReviewOverrideReason(e.target.value)}
                            rows={2}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            placeholder="Explain why this quote should exceed the milestone amount."
                          />
                        </div>
                      ) : null}

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Revision Note
                        </label>
                        <textarea
                          value={quoteReviewRevisionNote}
                          onChange={(e) => setQuoteReviewRevisionNote(e.target.value)}
                          rows={2}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          placeholder="Optional note for revision requests."
                        />
                      </div>

                      {quoteReviewBusy ? (
                        <div className="text-xs text-slate-500">Working...</div>
                      ) : null}

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => acceptQuoteRequestAction(activeQuoteRequest)}
                          disabled={
                            quoteReviewBusy ||
                            (activeQuoteAmount > Number(subcontractorQuoteTarget?.amount || 0) &&
                              !quoteReviewOverrideReason.trim())
                          }
                          className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                        >
                          Accept Quote
                        </button>
                        <button
                          type="button"
                          onClick={() => requestQuoteRevisionAction(activeQuoteRequest)}
                          disabled={quoteReviewBusy}
                          className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-60"
                        >
                          Request Revision
                        </button>
                        <button
                          type="button"
                          onClick={() => declineQuoteRequest()}
                          disabled={quoteReviewBusy}
                          className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                        >
                          Decline
                        </button>
                        <button
                          type="button"
                          onClick={() => cancelQuoteRequestAction(activeQuoteRequest)}
                          disabled={quoteReviewBusy}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                        >
                          Cancel Request
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {activeQuoteStatus === "accepted" ? (
                    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                      Quote accepted and subcontractor agreement prepared.
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {editOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="step2-edit-milestone-modal">
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
                  data-testid="step2-edit-milestone-title"
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
                  data-testid="step2-edit-milestone-description"
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
                    data-testid="step2-edit-milestone-start"
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
                    data-testid="step2-edit-milestone-due"
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
                    data-testid="step2-edit-milestone-amount"
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


