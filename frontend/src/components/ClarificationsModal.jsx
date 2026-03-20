// frontend/src/components/ClarificationsModal.jsx
// v2026-03-18-clarifications-modal-template-stable
//
// Fixes:
// - Prevents textarea/radio values from being reset while typing
// - Initializes a stable question/answer session only once per modal open
// - Still supports API fetch when agreementId is present
// - Prefers stored agreement.ai_scope questions as the primary source of truth
// - overrideQuestions only augment when present; they do not replace stored template questions
// - Preserves saved answers from agreement.ai_scope.answers
// - Saves the stable session question set back to agreement
// - Also mirrors answers into scope_clarifications when that field exists
// - Respects excludeKeys while keeping required questions visible

import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "../api";

function normStr(v) {
  return v == null ? "" : String(v).trim();
}

function titleCaseFromKey(k) {
  return String(k || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function blobFromAgreement(a) {
  if (!a) return "";
  const parts = [];

  [
    "project_title",
    "title",
    "name",
    "project_scope",
    "projectScope",
    "scope_of_work",
    "scope",
    "description",
    "work_description",
  ].forEach((k) => {
    const v = a?.[k];
    if (v) parts.push(normStr(v));
  });

  if (a?.project) {
    ["title", "name", "scope", "description", "address"].forEach((k) => {
      const v = a.project?.[k];
      if (v) parts.push(normStr(v));
    });
  }

  if (a?.ai_scope?.scope_text) parts.push(normStr(a.ai_scope.scope_text));

  const ms = a?.milestones || a?.milestone_list || [];
  if (Array.isArray(ms) && ms.length) {
    ms.slice(0, 30).forEach((m) => {
      if (m?.title) parts.push(normStr(m.title));
      if (m?.description) parts.push(normStr(m.description));
    });
  }

  return parts.join("\n").toLowerCase();
}

function guessProjectTypeKey(agreement) {
  const a = agreement || {};

  const direct =
    normStr(a.project_type) ||
    normStr(a.project_type_key) ||
    normStr(a.project_category) ||
    normStr(a.job_type) ||
    normStr(a.projectType);

  if (direct) return direct.toLowerCase();

  const blob = blobFromAgreement(a);

  if (blob.includes("bath") || blob.includes("shower") || blob.includes("tub") || blob.includes("vanity")) {
    return "bathroom_remodel";
  }
  if (blob.includes("kitchen") || blob.includes("cabinet") || blob.includes("countertop")) {
    return "kitchen_remodel";
  }
  if (blob.includes("tile") || blob.includes("grout") || blob.includes("schluter")) {
    return "tile";
  }
  if (blob.includes("floor") || blob.includes("subfloor") || blob.includes("lvp") || blob.includes("hardwood")) {
    return "flooring";
  }
  if (blob.includes("paint") || blob.includes("primer") || blob.includes("drywall")) {
    return "painting";
  }
  if (blob.includes("deck") || blob.includes("patio") || blob.includes("paver") || blob.includes("pergola")) {
    return "deck_patio";
  }
  if (blob.includes("roof") || blob.includes("shingle")) {
    return "roofing";
  }
  if (blob.includes("fence") || blob.includes("gate")) {
    return "fence";
  }
  if (blob.includes("addition") || blob.includes("room addition") || blob.includes("bedroom addition")) {
    return "general";
  }
  return "general";
}

function safeList(v) {
  return Array.isArray(v) ? v : [];
}

function safeDict(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
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
    (text.includes("purchase") || text.includes("purchasing") || text.includes("purchases") || text.includes("responsible"))
  ) {
    return "materials_responsibility";
  }

  if (text.includes("permit")) {
    return "permits_responsibility";
  }

  if (text.includes("measurement")) {
    if (text.includes("note")) return "measurement_notes";
    return "measurements_provided";
  }

  if (text.includes("allowance") || text.includes("selection allowance") || text.includes("allowances")) {
    return "allowances_selections";
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

function isInternalSemanticKey(k) {
  const s = String(k || "").trim().toLowerCase();
  return s === "clarifications_reviewed_step2" || s === "clarifications_reviewed";
}

function friendlyLabelForCanonicalKey(key, fallback = "") {
  const labels = {
    materials_responsibility: "Who will purchase materials?",
    permits_responsibility: "Who obtains necessary building permits?",
    measurements_provided: "Are detailed measurements provided?",
    measurement_notes: "Measurement notes",
    allowances_selections: "Allowances / selections",
    flooring_finishes_later: "Will finished flooring be installed later?",
    site_access_working_hours: "Site Access & Working Hours",
    waste_removal_responsibility: "Waste / Debris Removal",
    material_delivery_coordination: "Material Delivery Coordination",
    unforeseen_conditions_change_orders: "Unforeseen Conditions / Change Orders",
  };
  return labels[key] || fallback || titleCaseFromKey(key);
}

function inferQuestionInputType(q) {
  if (q?.inputType) return q.inputType;
  if (q?.response_type) return q.response_type;

  const group = semanticGroupForQuestion(q);
  const label = normalizeLabelForMatching(q?.label || "");

  if (group === "materials_responsibility") return "radio";
  if (group === "permits_responsibility") return "radio";
  if (group === "measurements_provided") return "radio";
  if (group === "flooring_finishes_later") return "radio";

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

function normalizeOption(opt) {
  if (typeof opt === "string") return { value: opt, label: opt };
  if (opt && typeof opt === "object") {
    const value = opt.value ?? opt.label ?? opt.name ?? opt.title ?? "";
    const label = opt.label ?? opt.name ?? opt.value ?? opt.title ?? "";
    return { value: String(value), label: String(label) };
  }
  return null;
}

function inferQuestionOptions(q) {
  if (Array.isArray(q?.options) && q.options.length) {
    return q.options.map(normalizeOption).filter(Boolean);
  }

  const group = semanticGroupForQuestion(q);

  if (group === "materials_responsibility") {
    return [
      { value: "Contractor", label: "Contractor" },
      { value: "Homeowner", label: "Homeowner" },
      { value: "Split", label: "Shared responsibility" },
    ];
  }

  if (group === "permits_responsibility") {
    return [
      { value: "Contractor", label: "Contractor" },
      { value: "Homeowner", label: "Homeowner" },
      { value: "Split / depends", label: "Shared / depends" },
    ];
  }

  if (group === "measurements_provided") {
    return [
      { value: "Yes", label: "Yes" },
      { value: "No", label: "No" },
      { value: "Pending", label: "Pending / not yet confirmed" },
    ];
  }

  if (group === "flooring_finishes_later") {
    return [
      { value: "Yes", label: "Yes" },
      { value: "No", label: "No" },
      { value: "Unsure", label: "Unsure" },
    ];
  }

  const label = normalizeLabelForMatching(q?.label || "");
  if (
    label.startsWith("is ") ||
    label.startsWith("are ") ||
    label.startsWith("will ") ||
    label.startsWith("does ") ||
    label.startsWith("do ")
  ) {
    return [
      { value: "Yes", label: "Yes" },
      { value: "No", label: "No" },
    ];
  }

  return [];
}

function scoreQuestion(q) {
  let score = 0;
  if (q?.required) score += 5;
  if (normStr(q?.help)) score += 2;
  if (normStr(q?.placeholder)) score += 1;
  if (Array.isArray(q?.options) && q.options.length) score += 3;
  if (q?.inputType && q.inputType !== "textarea") score += 2;
  if (normStr(q?.label)) score += 1;
  return score;
}

function enrichQuestion(q) {
  const canonicalKey = semanticGroupForQuestion(q) || normalizeKeyish(q?.key || q?.label || "");
  const inputType = inferQuestionInputType(q);
  let options = inferQuestionOptions(q);
  const source = String(q?.source || "").trim();

  if (inputType === "radio" && (!options || options.length === 0)) {
    options = [
      { value: "Yes", label: "Yes" },
      { value: "No", label: "No" },
    ];
  }

  return {
    key: canonicalKey,
    label: friendlyLabelForCanonicalKey(
      canonicalKey,
      q?.label || q?.question || titleCaseFromKey(canonicalKey)
    ),
    help: q?.help || "",
    placeholder: q?.placeholder || "",
    required: !!q?.required,
    inputType,
    options,
    ...(source ? { source } : {}),
  };
}

function templates() {
  const common = [
    {
      key: "site_access_working_hours",
      label: "Site Access & Working Hours",
      help: "Identifies possible logistical issues affecting scheduling or equipment delivery.",
      placeholder: "e.g., Mon–Fri 9a–5p; no weekends; dog in backyard",
      inputType: "textarea",
    },
    {
      key: "waste_removal_responsibility",
      label: "Waste / Debris Removal",
      help: "Who hauls away demo debris and how disposal is handled.",
      placeholder: "e.g., Contractor hauls to curb; homeowner schedules pickup",
      inputType: "textarea",
    },
    {
      key: "material_delivery_coordination",
      label: "Material Delivery Coordination",
      help: "How/when materials are delivered and who coordinates deliveries.",
      placeholder: "e.g., Homeowner orders tile; contractor confirms delivery date",
      inputType: "textarea",
    },
    {
      key: "unforeseen_conditions_change_orders",
      label: "Unforeseen Conditions / Change Orders",
      help: "Expectations for surprises, hidden damage, code issues, and approvals before extra work.",
      placeholder: "e.g., Written change order required before work continues",
      inputType: "textarea",
    },
  ];

  return {
    general: [...common],
    bathroom_remodel: [...common],
    kitchen_remodel: [...common],
    flooring: [...common],
    painting: [...common],
    tile: [...common],
  };
}

function mergeAndCanonicalizeQuestions(list = []) {
  const byKey = new Map();

  for (const raw of safeList(list)) {
    const enriched = enrichQuestion(raw);
    const k = String(enriched?.key || "");
    if (!k || isInternalSemanticKey(k)) continue;

    if (!byKey.has(k)) {
      byKey.set(k, enriched);
      continue;
    }

    const prev = byKey.get(k);
    const winner = scoreQuestion(enriched) > scoreQuestion(prev) ? enriched : prev;

    byKey.set(k, {
      ...winner,
      key: k,
      required: !!prev.required || !!enriched.required,
      help: winner.help || prev.help || enriched.help || "",
      placeholder: winner.placeholder || prev.placeholder || enriched.placeholder || "",
      label: winner.label || prev.label || enriched.label || friendlyLabelForCanonicalKey(k),
      inputType: winner.inputType || prev.inputType || enriched.inputType || "textarea",
      options:
        Array.isArray(winner.options) && winner.options.length
          ? winner.options
          : Array.isArray(prev.options) && prev.options.length
          ? prev.options
        : Array.isArray(enriched.options) && enriched.options.length
        ? enriched.options
        : [],
      source: winner.source || prev.source || enriched.source || "",
    });
  }

  return Array.from(byKey.values());
}

function normalizeAnswersForCanonicalKeys(answerMap = {}, questions = []) {
  const src = safeDict(answerMap);
  const out = {};
  const aliasKeys = new Set([
    "permit_acquisition",
    "measurements_needed",
    "who_purchases_materials",
    "materials_purchasing",
  ]);

  for (const q of questions) {
    const canonicalKey = String(q?.key || "");
    if (!canonicalKey) continue;

    if (src[canonicalKey] !== undefined) {
      out[canonicalKey] = src[canonicalKey];
      continue;
    }

    const qGroup = semanticGroupForQuestion(q);

    for (const rawKey of Object.keys(src)) {
      if (isInternalSemanticKey(rawKey)) continue;
      const rawGroup = semanticGroupForQuestion({ key: rawKey, label: rawKey });
      if (rawGroup === qGroup) {
        out[canonicalKey] = src[rawKey];
        break;
      }
    }
  }

  for (const rawKey of Object.keys(src)) {
    if (aliasKeys.has(rawKey)) continue;
    if (!Object.prototype.hasOwnProperty.call(out, rawKey)) {
      out[rawKey] = src[rawKey];
    }
  }

  return out;
}

function buildSessionQuestions({
  overrideQuestions,
  hasOverrideQuestions,
  aiScopeQuestions,
  recommendedQuestions,
  excludeKeys = [],
}) {
  const storedQuestions = mergeAndCanonicalizeQuestions(aiScopeQuestions);
  const overrideMerged = hasOverrideQuestions ? mergeAndCanonicalizeQuestions(overrideQuestions) : [];
  const recommendedMerged = mergeAndCanonicalizeQuestions(recommendedQuestions);

  const baseQuestions = storedQuestions.length
    ? mergeAndCanonicalizeQuestions([...storedQuestions, ...overrideMerged])
    : hasOverrideQuestions
    ? mergeAndCanonicalizeQuestions([...overrideMerged, ...recommendedMerged])
    : mergeAndCanonicalizeQuestions([...recommendedMerged]);

  const excluded = new Set(
    safeList(excludeKeys).map((k) => semanticGroupForQuestion({ key: String(k) }))
  );

  return baseQuestions.filter((q) => {
    const canonicalKey = String(q?.key || "");
    if (!canonicalKey) return false;
    if (isInternalSemanticKey(canonicalKey)) return false;

    if (excluded.has(canonicalKey)) {
      return !!q?.required;
    }

    return true;
  });
}

function RadioGroup({ name, value, options, onChange }) {
  return (
    <div className="space-y-2">
      {options.map((opt) => (
        <label
          key={String(opt.value)}
          className="flex cursor-pointer items-center gap-2 text-sm text-gray-800"
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={String(value || "") === String(opt.value)}
            onChange={(e) => onChange(e.target.value)}
          />
          <span>{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

export default function ClarificationsModal({
  open,
  agreementId,
  initialAgreement = null,
  overrideQuestions = [],
  excludeKeys = [],
  onClose,
  onSaved,
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [agreement, setAgreement] = useState(null);
  const [answers, setAnswers] = useState({});
  const [sessionQuestions, setSessionQuestions] = useState([]);

  const sessionInitializedRef = useRef(false);
  const fetchedThisOpenRef = useRef(false);

  const tpl = useMemo(() => templates(), []);
  const hasOverrideQuestions = Array.isArray(overrideQuestions) && overrideQuestions.length > 0;

  function initializeFromAgreement(a) {
    const aiScope = a?.ai_scope || {};
    const typeKey = guessProjectTypeKey(a || initialAgreement);
    const recommendedQuestions = tpl[typeKey] || tpl.general || [];

    const questions = buildSessionQuestions({
      overrideQuestions,
      hasOverrideQuestions,
      aiScopeQuestions: aiScope?.questions || [],
      recommendedQuestions,
      excludeKeys,
    });

    const normalizedAnswers = normalizeAnswersForCanonicalKeys(aiScope?.answers || {}, questions);

    setAgreement(a || null);
    setSessionQuestions(questions);
    setAnswers(normalizedAnswers);
  }

  useEffect(() => {
    if (!open) {
      sessionInitializedRef.current = false;
      fetchedThisOpenRef.current = false;
      setLoading(false);
      setSaving(false);
      setError("");
      return;
    }

    if (sessionInitializedRef.current) return;

    sessionInitializedRef.current = true;

    if (initialAgreement) {
      initializeFromAgreement(initialAgreement);
    } else {
      setAgreement(null);
      setSessionQuestions([]);
      setAnswers({});
    }
  }, [open]); // intentionally only tied to open

  useEffect(() => {
    if (!open || !agreementId) return;
    if (fetchedThisOpenRef.current) return;

    fetchedThisOpenRef.current = true;

    let alive = true;

    (async () => {
      setLoading(true);
      setError("");

      try {
        const res = await api.get(`/projects/agreements/${agreementId}/`);
        if (!alive) return;

        const a = res?.data || null;
        initializeFromAgreement(a);
      } catch (e) {
        console.error("ClarificationsModal: load failed", e);
        if (alive) {
          setError(e?.response?.data?.detail || e?.message || "Failed to load agreement.");
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, agreementId]); // intentionally narrow dependencies

  function setAnswer(key, value) {
    setAnswers((prev) => ({
      ...(prev || {}),
      [key]: value,
    }));
  }

  async function handleSave() {
    if (!agreementId) {
      setError("Missing agreement id — cannot save clarifications.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const current =
        agreement || initialAgreement || (await api.get(`/projects/agreements/${agreementId}/`)).data;

      const data = current || {};
      const aiScope = data.ai_scope || {};

      const typeKey = guessProjectTypeKey(data);
      const recommendedQuestions = tpl[typeKey] || tpl.general || [];

      const questionsToSave =
        sessionQuestions.length > 0
          ? sessionQuestions
          : buildSessionQuestions({
              overrideQuestions,
              hasOverrideQuestions,
              aiScopeQuestions: aiScope.questions || [],
              recommendedQuestions,
              excludeKeys,
            });

      const normalizedExistingAnswers = normalizeAnswersForCanonicalKeys(
        aiScope.answers || {},
        questionsToSave
      );

      const mergedAnswers = {
        ...normalizedExistingAnswers,
        ...(answers || {}),
      };

      const payload = {
        ai_scope: {
          ...aiScope,
          questions: questionsToSave,
          answers: mergedAnswers,
        },
      };

      if (Object.prototype.hasOwnProperty.call(data, "scope_clarifications")) {
        payload.scope_clarifications = {
          ...(safeDict(data.scope_clarifications)),
          ...mergedAnswers,
        };
      }

      await api.patch(`/projects/agreements/${agreementId}/`, payload);

      const refreshed = await api.get(`/projects/agreements/${agreementId}/`);
      const refreshedAgreement = refreshed?.data || null;

      setAgreement(refreshedAgreement);

      if (typeof onSaved === "function") onSaved(refreshedAgreement);
      if (typeof onClose === "function") onClose();
    } catch (e) {
      console.error("ClarificationsModal: save failed", e);
      setError(e?.response?.data?.detail || e?.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const typeKey = guessProjectTypeKey(agreement || initialAgreement);
  const recommendedCount = sessionQuestions.filter((q) => !!q?.required).length;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl rounded-xl border bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-gray-900">Scope Clarifications</div>
            <div className="text-xs text-gray-500">
              Recommended for:{" "}
              <span className="font-medium text-gray-700">{titleCaseFromKey(typeKey)}</span>
              {recommendedCount ? (
                <>
                  <span className="ml-2 text-gray-400">•</span>
                  <span className="ml-2 text-gray-600">{recommendedCount} recommended</span>
                </>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
          >
            Close
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {loading ? <div className="text-sm text-gray-600">Loading…</div> : null}
          {error ? <div className="mb-2 text-sm text-red-600">{error}</div> : null}

          {sessionQuestions.length === 0 ? (
            <div className="text-sm text-gray-600">No clarifications to show right now.</div>
          ) : (
            <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
              {sessionQuestions.map((q) => {
                const key = String(q.key || "");
                const label = q.label || titleCaseFromKey(key);
                const help = q.help || "";
                const recommended = !!q.required;
                const val = answers?.[key];
                const inputType = q.inputType || "textarea";
                const options = Array.isArray(q.options) ? q.options : [];

                return (
                  <div key={key} className="rounded-lg border p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold text-gray-900">{label}</div>
                      {recommended ? (
                        <span className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-800">
                          Recommended
                        </span>
                      ) : (
                        <span className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-600">
                          Optional
                        </span>
                      )}
                    </div>

                    {inputType === "radio" && options.length ? (
                      <RadioGroup
                        name={`clarification_${key}`}
                        value={val}
                        options={options}
                        onChange={(nextVal) => setAnswer(key, nextVal)}
                      />
                    ) : (
                      <textarea
                        className="w-full resize-y rounded border px-3 py-2 text-sm"
                        rows={3}
                        placeholder={q.placeholder || ""}
                        value={val == null ? "" : String(val)}
                        onChange={(e) => setAnswer(key, e.target.value)}
                      />
                    )}

                    {help ? <div className="mt-2 text-[11px] text-gray-500">{help}</div> : null}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4 text-[12px] text-gray-600">
            These clarifications are stored on the agreement and will appear in Final Review.
          </div>
        </div>

        <div className="flex items-center justify-between border-t px-5 py-4">
          <div className="text-xs text-gray-500">Tip: Keep clarifications short and concrete.</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save Clarifications"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
