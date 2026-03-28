// frontend/src/components/ai/useAgreementMilestoneAI.jsx
// v2026-03-18-template-aware-shared-hook
//
// Purpose:
// - Run agreement-level milestone AI from scope/context
// - Normalize milestone + clarification payloads
// - Replace stale AI clarification questions with the fresh stored set when AI is used
// - Preserve existing answers when possible
// - Apply AI milestones via bulk create (replace or append)
// - Immediately sync created milestones back to parent state after replace/append
// - Respect template-applied agreements by blocking AI milestone structure regeneration
// - Expose reusable loading/error/preview state

import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import api from "../../api";

function safeStr(v) {
  return v == null ? "" : String(v).trim();
}

function normalizePricingMode(v) {
  const raw = safeStr(v).toLowerCase();
  if (raw === "labor_only" || raw === "hybrid" || raw === "full_service") {
    return raw;
  }
  return "full_service";
}

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

function normalizeCreatedMilestones(list) {
  if (!Array.isArray(list)) return [];
  return list.map((m, idx) => ({
    id: m?.id ?? null,
    order: m?.order ?? idx + 1,
    title: safeStr(m?.title),
    description: safeStr(m?.description),
    amount: m?.amount != null ? Number(m.amount) : 0,
    start_date: toDateOnly(m?.start_date || m?.start || ""),
    completion_date: toDateOnly(m?.completion_date || m?.end_date || m?.end || ""),
    due_date: toDateOnly(m?.due_date || ""),
    status: m?.status,
    status_display: m?.status_display,
    normalized_milestone_type: safeStr(m?.normalized_milestone_type),
    suggested_amount_low: m?.suggested_amount_low ?? "",
    suggested_amount_high: m?.suggested_amount_high ?? "",
    labor_estimate_low: m?.labor_estimate_low ?? "",
    labor_estimate_high: m?.labor_estimate_high ?? "",
    materials_estimate_low: m?.materials_estimate_low ?? "",
    materials_estimate_high: m?.materials_estimate_high ?? "",
    pricing_confidence: safeStr(m?.pricing_confidence),
    pricing_mode: normalizePricingMode(m?.pricing_mode),
    pricing_source_note: safeStr(m?.pricing_source_note),
    recommended_duration_days: m?.recommended_duration_days ?? "",
    materials_hint: safeStr(m?.materials_hint),
  }));
}

function normalizeAiMilestones(list) {
  if (!Array.isArray(list)) return [];
  return list.map((m, idx) => {
    const title = safeStr(m?.title) || `Milestone ${idx + 1}`;
    const description = safeStr(m?.description);
    const start_date = m?.start_date ?? null;
    const completion_date = m?.completion_date ?? m?.end_date ?? null;
    const amount = m?.amount ?? 0;

    return {
      title,
      description,
      start_date,
      completion_date,
      amount,
    };
  });
}

function normalizeKeyish(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[()/,:.-]/g, " ")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeLabelForMatching(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\(e\.g\.[^)]+\)/g, " ")
    .replace(/[()/,:.-]/g, " ")
    .replace(/\bwho\s+is\s+responsible\s+for\b/g, "who")
    .replace(/\bwho\s+will\b/g, "who")
    .replace(/\bwho\s+obtains?\b/g, "who obtains")
    .replace(/\band\s+pays\s+for\b/g, " ")
    .replace(/\ball\s+required\b/g, "required")
    .replace(/\bnecessary\b/g, "required")
    .replace(/\bmajor\b/g, " ")
    .replace(/\bconstruction\b/g, " ")
    .replace(/\bcomponents?\b/g, " ")
    .replace(/\bmaterials?\b/g, "materials")
    .replace(/\bbuilding\s+permits?\b/g, "permits")
    .replace(/\bpermits?\b/g, "permits")
    .replace(/\s+/g, " ")
    .trim();
}

function semanticGroupForQuestion(q) {
  const rawKey = normalizeKeyish(q?.key || "");
  const rawLabel = normalizeLabelForMatching(q?.label || q?.question || "");
  const text = `${rawKey} ${rawLabel}`;

  if (
    text.includes("materials") &&
    (text.includes("purchase") ||
      text.includes("purchasing") ||
      text.includes("purchases") ||
      text.includes("responsible"))
  ) {
    return "materials_responsibility";
  }

  if (text.includes("permit")) {
    return "permits_responsibility";
  }

  if (text.includes("measurement")) {
    return "measurements_provided";
  }

  if (text.includes("floor") && text.includes("later")) {
    return "flooring_finishes_later";
  }

  if (text.includes("access") || text.includes("working hours")) {
    return "site_access_working_hours";
  }

  if (text.includes("debris") || text.includes("waste")) {
    return "waste_removal_responsibility";
  }

  if (text.includes("delivery")) {
    return "material_delivery_coordination";
  }

  if (text.includes("change order") || text.includes("unforeseen")) {
    return "unforeseen_conditions_change_orders";
  }

  return rawKey || normalizeKeyish(rawLabel);
}

function inferQuestionInputType(q) {
  const qType = safeStr(q?.inputType || q?.response_type || q?.type).toLowerCase();
  const group = semanticGroupForQuestion(q);
  const label = normalizeLabelForMatching(q?.label || q?.question || "");

  if (
    qType === "boolean" ||
    qType === "select" ||
    qType === "radio" ||
    qType === "single_choice"
  ) {
    return "radio";
  }

  if (
    group === "materials_responsibility" ||
    group === "permits_responsibility" ||
    group === "measurements_provided" ||
    group === "flooring_finishes_later"
  ) {
    return "radio";
  }

  if (
    label.startsWith("is ") ||
    label.startsWith("are ") ||
    label.startsWith("will ") ||
    label.startsWith("does ") ||
    label.startsWith("do ")
  ) {
    return "radio";
  }

  return "textarea";
}

function inferQuestionOptions(q, canonicalKey) {
  const rawOptions = Array.isArray(q?.options)
    ? q.options
        .map((o) => {
          if (typeof o === "string") return safeStr(o);
          return safeStr(o?.label || o?.value);
        })
        .filter(Boolean)
    : [];

  if (rawOptions.length) return rawOptions;

  if (canonicalKey === "materials_responsibility") {
    return ["Contractor", "Homeowner", "Split"];
  }

  if (canonicalKey === "permits_responsibility") {
    return ["Contractor", "Homeowner", "Split / depends"];
  }

  if (canonicalKey === "measurements_provided") {
    return ["Yes", "No", "Pending"];
  }

  if (canonicalKey === "flooring_finishes_later") {
    return ["Yes", "No", "Unsure"];
  }

  const qType = safeStr(q?.type).toLowerCase();
  if (qType === "boolean" || qType === "single_choice") {
    return ["Yes", "No"];
  }

  return [];
}

function scoreQuestion(q) {
  let score = 0;
  if (q?.required) score += 5;
  if (q?.help) score += 2;
  if (q?.placeholder) score += 1;
  if (Array.isArray(q?.options) && q.options.length) score += 3;
  if (q?.inputType && q.inputType !== "textarea") score += 2;
  if (q?.label) score += 1;
  return score;
}

function canonicalizeQuestions(list) {
  if (!Array.isArray(list)) return [];
  const byKey = new Map();

  for (const q of list) {
    if (!q || typeof q !== "object") continue;

    const canonicalKey =
      semanticGroupForQuestion(q) || normalizeKeyish(q?.key || q?.label || q?.question);
    if (!canonicalKey) continue;

    const inputType = inferQuestionInputType(q);
    const options = inferQuestionOptions(q, canonicalKey);

    const normalized = {
      key: canonicalKey,
      label: safeStr(q?.label) || safeStr(q?.question) || canonicalKey.replace(/_/g, " "),
      type: safeStr(q?.type) || (inputType === "radio" ? "select" : "text"),
      inputType,
      required: !!q?.required,
      options,
      help: safeStr(q?.help),
      question: safeStr(q?.question) || safeStr(q?.label),
      placeholder: safeStr(q?.placeholder),
      source: safeStr(q?.source) || "ai",
    };

    if (!byKey.has(canonicalKey)) {
      byKey.set(canonicalKey, normalized);
      continue;
    }

    const prev = byKey.get(canonicalKey);
    byKey.set(canonicalKey, scoreQuestion(normalized) > scoreQuestion(prev) ? normalized : prev);
  }

  return Array.from(byKey.values());
}

function normalizeAiQuestions(list) {
  return canonicalizeQuestions(list);
}

function normalizeAnswersForCanonicalQuestions(existingAnswers, questions) {
  const src =
    existingAnswers && typeof existingAnswers === "object" && !Array.isArray(existingAnswers)
      ? existingAnswers
      : {};

  const out = {};

  for (const q of Array.isArray(questions) ? questions : []) {
    const key = safeStr(q?.key);
    if (!key) continue;

    if (Object.prototype.hasOwnProperty.call(src, key)) {
      out[key] = src[key];
      continue;
    }

    const group = semanticGroupForQuestion(q);

    for (const rawKey of Object.keys(src)) {
      const rawGroup = semanticGroupForQuestion({ key: rawKey, label: rawKey });
      if (rawGroup === group) {
        out[key] = src[rawKey];
        break;
      }
    }
  }

  for (const rawKey of Object.keys(src)) {
    if (!Object.prototype.hasOwnProperty.call(out, rawKey)) {
      out[rawKey] = src[rawKey];
    }
  }

  return out;
}

function deriveSelectedTemplateId(agreementData) {
  return (
    agreementData?.selected_template?.id ??
    agreementData?.selected_template_id ??
    agreementData?.project_template_id ??
    agreementData?.template_id ??
    null
  );
}

function normalizePricingEstimates(list) {
  if (!Array.isArray(list)) return [];
  return list.map((m, idx) => ({
    milestone_id: m?.milestone_id ?? null,
    order: m?.order ?? idx + 1,
    title: safeStr(m?.title) || `Milestone ${idx + 1}`,
    suggested_amount_low: m?.suggested_amount_low ?? "",
    suggested_amount_high: m?.suggested_amount_high ?? "",
    labor_estimate_low: m?.labor_estimate_low ?? "",
    labor_estimate_high: m?.labor_estimate_high ?? "",
    materials_estimate_low: m?.materials_estimate_low ?? "",
    materials_estimate_high: m?.materials_estimate_high ?? "",
    pricing_confidence: safeStr(m?.pricing_confidence),
    pricing_mode: normalizePricingMode(m?.pricing_mode),
    pricing_source_note: safeStr(m?.pricing_source_note),
    recommended_duration_days: m?.recommended_duration_days ?? "",
    materials_hint: safeStr(m?.materials_hint),
  }));
}

function normalizeEstimatePreview(data) {
  const source = data && typeof data === "object" ? data : {};
  return {
    suggested_total_price: source?.suggested_total_price ?? "0.00",
    suggested_price_low: source?.suggested_price_low ?? "0.00",
    suggested_price_high: source?.suggested_price_high ?? "0.00",
    suggested_duration_days: Number(source?.suggested_duration_days || 0),
    suggested_duration_low: Number(source?.suggested_duration_low || 0),
    suggested_duration_high: Number(source?.suggested_duration_high || 0),
    suggested_milestones: Array.isArray(source?.suggested_milestones)
      ? source.suggested_milestones
      : Array.isArray(source?.milestone_suggestions)
      ? source.milestone_suggestions
      : [],
    milestone_suggestions: Array.isArray(source?.milestone_suggestions)
      ? source.milestone_suggestions
      : Array.isArray(source?.suggested_milestones)
      ? source.suggested_milestones
      : [],
    price_adjustments: Array.isArray(source?.price_adjustments) ? source.price_adjustments : [],
    timeline_adjustments: Array.isArray(source?.timeline_adjustments) ? source.timeline_adjustments : [],
    explanation_lines: Array.isArray(source?.explanation_lines) ? source.explanation_lines : [],
    benchmark_source: safeStr(source?.benchmark_source),
    benchmark_match_scope: safeStr(source?.benchmark_match_scope),
    learned_benchmark_used: !!source?.learned_benchmark_used,
    seeded_benchmark_used: !!source?.seeded_benchmark_used,
    template_used: safeStr(source?.template_used),
    confidence_level: safeStr(source?.confidence_level),
    confidence_reasoning: safeStr(source?.confidence_reasoning),
    structured_result_version: safeStr(source?.structured_result_version),
    source_metadata:
      source?.source_metadata && typeof source.source_metadata === "object"
        ? source.source_metadata
        : {},
  };
}

function hasTemplateDerivedQuestions(agreementData) {
  const questions = Array.isArray(agreementData?.ai_scope?.questions)
    ? agreementData.ai_scope.questions
    : [];

  return questions.some(
    (q) => safeStr(q?.source).toLowerCase() === "template"
  );
}

function hasTemplateDerivedState(agreementData) {
  if (!agreementData || typeof agreementData !== "object") return false;

  if (deriveSelectedTemplateId(agreementData)) return true;

  if (
    safeStr(
      agreementData?.selected_template_name_snapshot ??
        agreementData?.selected_template_name
    )
  ) {
    return true;
  }

  if (hasTemplateDerivedQuestions(agreementData)) {
    return true;
  }

  return false;
}

function friendlyAiMilestoneError(e) {
  const code = safeStr(e?.response?.data?.code || e?.code).toUpperCase();
  const duplicateTitles = Array.isArray(e?.response?.data?.duplicate_titles)
    ? e.response.data.duplicate_titles.filter(Boolean).slice(0, 3)
    : [];

  if (code === "TEMPLATE_APPLIED") {
    return "This agreement is template-driven. AI milestone apply is disabled here to avoid overwriting the template structure.";
  }

  if (code === "AI_APPEND_DUPLICATE") {
    const suffix = duplicateTitles.length
      ? ` Matching milestone(s): ${duplicateTitles.join(", ")}.`
      : "";
    return (
      "AI append was blocked because the suggested milestones appear to duplicate milestones already on this agreement." +
      suffix +
      " Review the current milestones first, or use replace only after manual review."
    );
  }

  if (code === "AI_REPLACE_UNSAFE_EXISTING") {
    return "AI replace was blocked because the current milestones appear manually edited or otherwise unsafe to wipe. Review or clean up the existing milestones before retrying replace.";
  }

  return (
    e?.response?.data?.detail ||
    e?.message ||
    "AI request failed."
  );
}

function actionGuidanceForAiApplyError(e) {
  const code = safeStr(e?.response?.data?.code || e?.code).toUpperCase();

  if (code === "AI_APPEND_DUPLICATE") {
    return "Review the current milestones first and avoid appending near-duplicates. Use append only for clearly new milestone groups.";
  }

  if (code === "AI_REPLACE_UNSAFE_EXISTING") {
    return "Review or clean up the existing milestones manually before retrying AI replace. Replace is blocked while the current set looks unsafe to wipe.";
  }

  if (code === "TEMPLATE_APPLIED") {
    return "This agreement is template-driven. Edit the milestone structure through the template/manual workflow instead of AI apply.";
  }

  return "";
}

export default function useAgreementMilestoneAI({
  agreementId,
  locked = false,
  refreshAgreement,
  refreshMilestones,
  onCreditsUpdate,
  onMilestonesReplaced,
}) {
  const [aiLoading, setAiLoading] = useState(false);
  const [aiApplying, setAiApplying] = useState(false);
  const [pricingRefreshing, setPricingRefreshing] = useState(false);
  const [estimateRefreshing, setEstimateRefreshing] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiPreview, setAiPreview] = useState(null);

  const getAgreementSnapshot = useCallback(async () => {
    if (!agreementId) return null;
    const current = await api.get(`/projects/agreements/${agreementId}/`);
    return current?.data || null;
  }, [agreementId]);

  const ensureNoTemplateApplied = useCallback(async () => {
    const agreementData = await getAgreementSnapshot();
    if (hasTemplateDerivedState(agreementData)) {
      const err = new Error(
        "A template is already applied to this agreement. AI milestone regeneration is disabled to avoid overwriting the template structure."
      );
      err.code = "TEMPLATE_APPLIED";
      throw err;
    }
    return agreementData;
  }, [getAgreementSnapshot]);

  const replaceAiQuestionsOnAgreement = useCallback(
    async (questions) => {
      if (!agreementId) return null;
      if (!Array.isArray(questions) || !questions.length) return null;

      const canonicalQuestions = canonicalizeQuestions(questions);

      const data = await getAgreementSnapshot();
      const ai_scope = data?.ai_scope || {};
      const normalizedAnswers = normalizeAnswersForCanonicalQuestions(
        ai_scope.answers || {},
        canonicalQuestions
      );

      const patchPayload = {
        ai_scope: {
          ...ai_scope,
          questions: canonicalQuestions,
          answers: normalizedAnswers,
        },
      };

      await api.patch(`/projects/agreements/${agreementId}/`, patchPayload);

      return {
        ...(data || {}),
        ai_scope: {
          ...(ai_scope || {}),
          questions: canonicalQuestions,
          answers: normalizedAnswers,
        },
      };
    },
    [agreementId, getAgreementSnapshot]
  );

  const runAiSuggest = useCallback(
    async ({ notes = "" } = {}) => {
      if (locked) return null;
      if (!agreementId) {
        throw new Error("Save draft first to use AI.");
      }

      setAiError("");
      setAiPreview(null);
      setAiLoading(true);

      try {
        await ensureNoTemplateApplied();

        const res = await api.post(`/projects/agreements/${agreementId}/ai/suggest-milestones/`, {
          notes: safeStr(notes),
        });

        const nextPreview = {
          scope_text: safeStr(res?.data?.scope_text),
          milestones: normalizeAiMilestones(res?.data?.milestones || []),
          questions: normalizeAiQuestions(res?.data?.questions || []),
          raw: res?.data || {},
        };

        setAiPreview(nextPreview);

        if (nextPreview.questions.length) {
          await replaceAiQuestionsOnAgreement(nextPreview.questions);
        }

        if (typeof onCreditsUpdate === "function") {
          onCreditsUpdate({
            access: res?.data?.ai_access || "included",
            enabled: true,
            unlimited: true,
            loading: false,
          });
        }

        return nextPreview;
      } catch (e) {
        const msg = friendlyAiMilestoneError(e) || "AI suggestion failed.";
        setAiError(msg);
        throw e;
      } finally {
        setAiLoading(false);
      }
    },
    [agreementId, locked, replaceAiQuestionsOnAgreement, onCreditsUpdate, ensureNoTemplateApplied]
  );

  const applyAiMilestones = useCallback(
    async ({
      mode = "replace",
      spreadEnabled = true,
      spreadTotal = "",
      autoSchedule = false,
    } = {}) => {
      if (locked) return null;
      if (!agreementId) {
        throw new Error("Save draft first.");
      }
      if (!aiPreview?.milestones?.length) {
        throw new Error("No AI milestone preview to apply.");
      }

      setAiError("");
      setAiApplying(true);

      try {
        await ensureNoTemplateApplied();

        const payload = {
          agreement_id: agreementId,
          mode,
          spread_strategy: spreadEnabled ? "equal" : "keep_existing_amounts",
          milestones: aiPreview.milestones,
          auto_schedule: !!autoSchedule,
        };

        const spreadValue = safeStr(spreadTotal);
        if (spreadEnabled && spreadValue) {
          payload.spread_total = spreadValue;
        }

        const res = await api.post(`/projects/milestones/bulk-ai-create/`, payload);

        if (Array.isArray(aiPreview.questions) && aiPreview.questions.length) {
          await replaceAiQuestionsOnAgreement(aiPreview.questions);
        }

        const created = normalizeCreatedMilestones(res?.data?.created || []);

        if (typeof onMilestonesReplaced === "function" && created.length) {
          onMilestonesReplaced(created, mode);
        }

        if (typeof refreshMilestones === "function") {
          await refreshMilestones();
        }

        if (typeof refreshAgreement === "function") {
          await refreshAgreement();
        }

        const count = Number(res?.data?.count || created.length || 0);

        setAiPreview(null);

        return {
          count,
          created,
          raw: res?.data || {},
        };
      } catch (e) {
        const msg = friendlyAiMilestoneError(e) || "Bulk create failed.";
        setAiError(msg);
        const guidance = actionGuidanceForAiApplyError(e);
        if (guidance) {
          toast(guidance, { icon: "ℹ️" });
        }
        throw e;
      } finally {
        setAiApplying(false);
      }
    },
    [
      agreementId,
      aiPreview,
      locked,
      replaceAiQuestionsOnAgreement,
      refreshAgreement,
      refreshMilestones,
      onMilestonesReplaced,
      ensureNoTemplateApplied,
    ]
  );

  const refreshPricingEstimate = useCallback(async () => {
    if (locked) return null;
    if (!agreementId) {
      throw new Error("Save draft first.");
    }

    setAiError("");
    setPricingRefreshing(true);

    try {
      const res = await api.post(`/projects/agreements/${agreementId}/ai/refresh-pricing-estimate/`, {});

      const pricingEstimates = normalizePricingEstimates(res?.data?.pricing_estimates || []);

      if (typeof onCreditsUpdate === "function") {
        onCreditsUpdate({
          access: res?.data?.ai_access || "included",
          enabled: true,
          unlimited: true,
          loading: false,
        });
      }

      return {
        pricing_estimates: pricingEstimates,
        raw: res?.data || {},
      };
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        e?.message ||
        "Pricing refresh failed.";
      setAiError(msg);
      throw e;
    } finally {
      setPricingRefreshing(false);
    }
  }, [agreementId, locked, onCreditsUpdate]);

  const estimateProject = useCallback(async () => {
    if (!agreementId) {
      throw new Error("Save draft first.");
    }

    setAiError("");
    setEstimateRefreshing(true);

    try {
      const res = await api.post(`/projects/agreements/${agreementId}/estimate-preview/`, {});

      if (typeof onCreditsUpdate === "function") {
        onCreditsUpdate({
          access: res?.data?.ai_access || "included",
          enabled: true,
          unlimited: true,
          loading: false,
        });
      }

      return {
        estimate: normalizeEstimatePreview(res?.data || {}),
        raw: res?.data || {},
      };
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message || "Estimate preview failed.";
      setAiError(msg);
      throw e;
    } finally {
      setEstimateRefreshing(false);
    }
  }, [agreementId, onCreditsUpdate]);

  return {
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
    replaceAiQuestionsOnAgreement,

    helpers: {
      safeStr,
      normalizeAiMilestones,
      normalizeAiQuestions,
      normalizePricingEstimates,
      normalizeEstimatePreview,
      canonicalizeQuestions,
      normalizeAnswersForCanonicalQuestions,
      normalizeCreatedMilestones,
      normalizePricingMode,
      deriveSelectedTemplateId,
    },
  };
}
