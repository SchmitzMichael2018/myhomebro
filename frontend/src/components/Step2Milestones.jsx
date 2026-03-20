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
import useAgreementMilestoneAI from "./ai/useAgreementMilestoneAI.jsx";

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
  const [saveTemplateBusy, setSaveTemplateBusy] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState("");
  const [saveTemplateDescription, setSaveTemplateDescription] = useState("");
  const [fallbackMilestones, setFallbackMilestones] = useState(null);
  const [pricingEstimateStale, setPricingEstimateStale] = useState(false);
  const [dismissedPricingReviewSignature, setDismissedPricingReviewSignature] = useState("");
  const pricingFreshSignatureRef = useRef("");
  const didInitPricingSignatureRef = useRef(false);

  const effectiveMilestones = useMemo(() => {
    return Array.isArray(fallbackMilestones) ? fallbackMilestones : Array.isArray(milestones) ? milestones : [];
  }, [fallbackMilestones, milestones]);
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

  useEffect(() => {
    setFallbackMilestones(null);
  }, [milestones]);

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
    aiError,
    aiPreview,
    setAiPreview,
    runAiSuggest,
    applyAiMilestones,
    refreshPricingEstimate,
  } = useAgreementMilestoneAI({
    agreementId,
    locked: milestonesLocked || templateApplied,
    refreshAgreement: refreshAgreementMeta,
    refreshMilestones: refreshMilestonesSafe,
    onMilestonesReplaced: null,
  });

  const total = effectiveMilestones.reduce((s, m) => s + money(m.amount), 0);

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

  function applySuggestedPricesToAll() {
    if (!effectiveMilestones.length) {
      toast("No milestones are available to update.");
      return;
    }

    let appliedCount = 0;
    const nextRows = effectiveMilestones.map((row, idx) => {
      const suggestedAmount = deriveSuggestedPriceAmount(row);
      if (!Number.isFinite(suggestedAmount) || suggestedAmount <= 0) {
        return { ...row };
      }
      appliedCount += 1;
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

  async function persistStagedMilestoneAmounts() {
    if (!Array.isArray(fallbackMilestones) || !fallbackMilestones.length) return 0;

    const baseById = new Map(
      (Array.isArray(milestones) ? milestones : [])
        .filter((row) => row?.id != null)
        .map((row) => [row.id, row])
    );

    const stagedAmountRows = fallbackMilestones.filter((row) => {
      if (!row?.id) return false;
      const base = baseById.get(row.id);
      if (!base) return false;
      return amountsDifferMeaningfully(base?.amount, parseAmountStrict(row?.amount));
    });

    if (!stagedAmountRows.length) return 0;

    for (const row of stagedAmountRows) {
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

    return stagedAmountRows.length;
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

  async function handleSaveAsTemplate() {
    if (!agreementId) return;

    const name = safeStr(saveTemplateName);
    if (!name) {
      toast.error("Template name is required.");
      return;
    }

    setSaveTemplateBusy(true);
    try {
      const payload = {
        name,
        description: safeStr(saveTemplateDescription),
        is_active: true,
      };

      const res = await api.post(`/projects/agreements/${agreementId}/save-as-template/`, payload);
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

    const persistedCount = await persistStagedMilestoneAmounts();
    if (persistedCount > 0) {
      toast.success(
        `Saved suggested pricing for ${persistedCount} milestone${persistedCount === 1 ? "" : "s"}.`
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

  return (
    <div className="rounded-lg border bg-white p-4">
      {milestonesLocked ? (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold">Locked</div>
          <div className="mt-1 text-xs text-amber-900/90">
            Milestones are read-only. {milestonesLockReason || "Create an amendment to change milestones."}
          </div>
        </div>
      ) : null}

      {selectedTemplateMeta ? (
        <div className="mb-3 rounded-md border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Template:</span>
            <span>{selectedTemplateMeta.name}</span>
            {selectedTemplateMeta.project_type ? (
              <span className="rounded bg-white/70 px-2 py-0.5 text-[11px]">
                {selectedTemplateMeta.project_type}
              </span>
            ) : null}
            {selectedTemplateMeta.project_subtype ? (
              <span className="rounded bg-white/70 px-2 py-0.5 text-[11px]">
                {selectedTemplateMeta.project_subtype}
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-indigo-800/90">
            These milestones were generated from a selected template. AI milestone regeneration is disabled here to avoid overwriting the template structure.
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Milestones</h3>
        <div className="text-sm text-gray-600">
          Schedule:{" "}
          {minStart && maxEnd ? (
            <span className="font-medium">
              {friendly(minStart)} → {friendly(maxEnd)} (est.)
            </span>
          ) : (
            <span className="text-gray-400">add dates to see range</span>
          )}
        </div>
      </div>

      <div className="mb-4 rounded-lg border p-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleRunAiSuggest}
              disabled={aiLoading || milestonesLocked || templateApplied}
              className="rounded border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
              title={
                milestonesLocked
                  ? "Locked"
                  : templateApplied
                  ? "Disabled when a template is already applied"
                  : ""
              }
            >
              {aiLoading ? "Thinking…" : "✨ AI Suggest Milestones"}
            </button>

            <button
              type="button"
              onClick={() => setClarOpen(true)}
              disabled={milestonesLocked}
              className="rounded border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
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

            <button
              type="button"
              onClick={handleOpenSaveTemplate}
              disabled={milestonesLocked}
              className="rounded border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
              title={milestonesLocked ? "Locked" : "Save current agreement milestones as a reusable template"}
            >
              Save as Template
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
                className="rounded border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
                title="Refresh estimate-assist guidance from current clarification answers without changing milestone amounts."
              >
                {pricingRefreshing ? "Refreshing Pricing…" : "Refresh Pricing Estimate"}
              </button>
            ) : null}

            {effectiveMilestones.length ? (
              <button
                type="button"
                onClick={applySuggestedPricesToAll}
                disabled={milestonesLocked}
                className="rounded border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
                title="Apply suggested prices to all eligible milestone amounts locally for review."
              >
                Apply Suggested Price to All
              </button>
            ) : null}

            {pricingEstimateStale ? (
              <span className="text-xs text-amber-700">
                Pricing inputs changed. Refresh estimate guidance to see updated ranges.
              </span>
            ) : null}

            {!clarReviewed ? (
              <span className="text-xs text-gray-500">
                {hasRecommendedClarifications
                  ? "You’ll review recommended clarifications before continuing."
                  : "You’ll review clarifications before continuing."}
              </span>
            ) : null}

            {templateApplied && !milestonesLocked ? (
              <span className="text-xs text-indigo-700">
                Template structure is active.
              </span>
            ) : null}

            {aiError ? <span className="text-sm text-red-600">{aiError}</span> : null}
          </div>
        </div>
      </div>

      {showPricingReviewPrompt ? (
        <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-semibold text-indigo-900">Pricing suggestions updated</div>
              <div className="text-xs text-indigo-800">
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
                className="rounded border border-indigo-300 bg-white px-3 py-2 text-sm font-medium text-indigo-900 hover:bg-indigo-100"
              >
                Review Changes
              </button>
              <button
                type="button"
                onClick={applySuggestedPricesToAll}
                disabled={milestonesLocked}
                className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                Apply Suggested Price to All
              </button>
              <button
                type="button"
                onClick={() => setDismissedPricingReviewSignature(pricingReviewState.signature)}
                className="rounded border px-3 py-2 text-sm font-medium hover:bg-white"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ClarificationsModal
        open={clarOpen}
        agreementId={agreementId}
        initialAgreement={clarificationsAgreementMeta}
        overrideQuestions={Array.isArray(aiPreview?.questions) ? aiPreview.questions : []}
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

      <div className="mb-2 grid grid-cols-1 gap-3 md:grid-cols-12">
        <input
          className="rounded border px-3 py-2 text-sm md:col-span-4"
          placeholder="Title"
          name="title"
          value={mLocal.title}
          onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
          disabled={milestonesLocked}
        />
        <input
          type="date"
          className="rounded border px-3 py-2 text-sm md:col-span-3"
          name="start"
          value={mLocal.start || ""}
          onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
          disabled={milestonesLocked}
        />
        <input
          type="date"
          className="rounded border px-3 py-2 text-sm md:col-span-3"
          name="end"
          value={mLocal.end || ""}
          onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
          disabled={milestonesLocked}
        />
        <input
          type="number"
          min="0.01"
          step="0.01"
          className="rounded border px-3 py-2 text-sm md:col-span-2"
          placeholder="Amount"
          name="amount"
          value={mLocal.amount}
          onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
          disabled={milestonesLocked}
        />
        <div className="md:col-span-12">
          <textarea
            className="w-full resize-y rounded border px-3 py-2 text-sm"
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
          className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
          disabled={milestonesLocked}
        >
          + Add Milestone
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
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

              return (
                <tr key={m.id || `${m.title}-${idx}`} className="border-t align-top">
                  <td className="px-3 py-2">{m?.order ?? idx + 1}</td>

                  <td className="px-3 py-2">
                    <div>{m.title || "—"}</div>
                    {estimate.type ? (
                      <div className="mt-1">
                        <span className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                          {estimate.type}
                        </span>
                      </div>
                    ) : null}
                  </td>

                  <td className="whitespace-pre-wrap px-3 py-2">{m.description || "—"}</td>

                  <td className="px-3 py-2">{friendly(toDateOnly(m.start_date || m.start))}</td>

                  <td className="px-3 py-2">
                    {friendly(toDateOnly(m.completion_date || m.end_date || m.end))}
                  </td>

                  <td className="px-3 py-2">
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
            <tr className="bg-gray-50 font-semibold">
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

      <div className="mt-4 flex items-center justify-between">
        <button type="button" onClick={onBack} className="rounded border px-3 py-2 text-sm">
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

      {saveTemplateOpen ? (
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
