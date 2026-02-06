// frontend/src/components/ClarificationsModal.jsx
// v2026-02-04-required-visible — Project-type Scope Clarifications POPUP modal
//
// Fixes:
// 1) Shows ALL existing agreement.ai_scope.questions (including required ones),
//    not just the template recommendations.
// 2) Merges template recommendations (project-type) without duplicating keys.
// 3) Respects excludeKeys BUT never hides a REQUIRED + UNANSWERED question.
// 4) Adds minimal structured inputs for common keys (materials dropdown, measurements boolean).
//
// REQUIRED BACKEND:
// - Agreement PATCH must persist ai_scope into AgreementAIScope (your serializer already does this).
//
// Props:
// - open: boolean
// - agreementId: number|string (required for fetch/save)
// - initialAgreement: optional agreement object (used for instant prefill & type detection)
// - excludeKeys: keys not to show in the modal (unless required+unanswered)
// - onClose: function
// - onSaved: function(updatedAgreement)

import React, { useEffect, useMemo, useState } from "react";
import api from "../api";

function normStr(v) {
  return (v == null ? "" : String(v)).trim();
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

  if (
    blob.includes("bath") ||
    blob.includes("shower") ||
    blob.includes("tub") ||
    blob.includes("vanity")
  ) {
    return "bathroom_remodel";
  }
  if (
    blob.includes("kitchen") ||
    blob.includes("cabinet") ||
    blob.includes("countertop")
  ) {
    return "kitchen_remodel";
  }
  if (blob.includes("tile") || blob.includes("grout") || blob.includes("schluter")) {
    return "tile";
  }
  if (
    blob.includes("floor") ||
    blob.includes("subfloor") ||
    blob.includes("lvp") ||
    blob.includes("hardwood")
  ) {
    return "flooring";
  }
  if (blob.includes("paint") || blob.includes("primer") || blob.includes("drywall")) {
    return "painting";
  }
  if (
    blob.includes("deck") ||
    blob.includes("patio") ||
    blob.includes("paver") ||
    blob.includes("pergola")
  ) {
    return "deck_patio";
  }
  if (blob.includes("roof") || blob.includes("shingle")) {
    return "roofing";
  }
  if (blob.includes("fence") || blob.includes("gate")) {
    return "fence";
  }
  return "general";
}

function templates() {
  const common = [
    {
      key: "site_access_working_hours",
      label: "Site Access & Working Hours",
      help: "Clarify access restrictions, days/hours, lockbox, pets, etc.",
      placeholder: "e.g., Mon–Fri 9a–5p; no weekends; dog in backyard",
    },
    {
      key: "waste_removal_responsibility",
      label: "Waste / Debris Removal",
      help: "Who hauls away demo debris and how disposal is handled.",
      placeholder: "e.g., Contractor hauls to curb; homeowner schedules pickup",
    },
    {
      key: "material_delivery_coordination",
      label: "Material Delivery Coordination",
      help: "How/when materials are delivered and who coordinates deliveries.",
      placeholder: "e.g., Homeowner orders tile; contractor confirms delivery date",
    },
    {
      key: "unforeseen_conditions_change_orders",
      label: "Unforeseen Conditions / Change Orders",
      help: "Expectations for surprises (hidden damage, code issues) and approvals before extra work.",
      placeholder: "e.g., Written change order required before work continues",
    },
  ];

  return {
    general: [...common],
    bathroom_remodel: [
      ...common,
      {
        key: "plumbing_electrical_scope_boundary",
        label: "Plumbing / Electrical Scope Boundaries",
        help: "Clarify included vs excluded plumbing/electrical scope.",
        placeholder:
          "e.g., Replacing fixtures included; relocating lines requires change order",
      },
      {
        key: "water_shutoff_and_bathroom_access",
        label: "Water Shutoff / Bathroom Access",
        help: "Clarify water shutoff times and whether the bathroom is usable during the project.",
        placeholder:
          "e.g., Water off 9a–12p on demo day; shower unusable until tile cure complete",
      },
    ],
    kitchen_remodel: [
      ...common,
      {
        key: "appliance_install_and_delivery",
        label: "Appliance Delivery / Install",
        help: "Who coordinates appliance delivery and whether install is included.",
        placeholder:
          "e.g., Homeowner schedules delivery; contractor installs after cabinets",
      },
    ],
    flooring: [
      ...common,
      {
        key: "subfloor_condition_and_repairs",
        label: "Subfloor Condition / Repairs",
        help: "What happens if subfloor is damaged/out of level.",
        placeholder: "e.g., Repairs billed as change order if rot is found",
      },
      {
        key: "furniture_moving_responsibility",
        label: "Furniture Moving",
        help: "Who moves furniture and when areas must be cleared.",
        placeholder:
          "e.g., Homeowner clears rooms; contractor moves heavy appliances with fee",
      },
    ],
    painting: [
      ...common,
      {
        key: "prep_and_protection",
        label: "Prep & Protection",
        help: "Prep level (patching/sanding) and protection of floors/furniture.",
        placeholder:
          "e.g., Includes minor patching; floors covered; furniture moved by homeowner",
      },
      {
        key: "paint_selection_and_finish",
        label: "Paint Selection / Finish",
        help: "Who selects paint colors/finish and by what date.",
        placeholder:
          "e.g., Homeowner provides color codes 48h before start; satin finish throughout",
      },
    ],
    tile: [
      ...common,
      {
        key: "tile_selection_and_layout",
        label: "Tile Selection / Layout",
        help: "Clarify layout/pattern, grout color, and approval process.",
        placeholder:
          "e.g., Herringbone layout; grout warm gray; homeowner approves mock layout",
      },
    ],
  };
}

function safeList(v) {
  return Array.isArray(v) ? v : [];
}

function safeDict(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function mergeQuestionsPreserve(existingQuestions, templateQuestions) {
  const existing = safeList(existingQuestions);
  const tmpl = safeList(templateQuestions);

  const out = [];
  const seen = new Set();

  // Keep existing FIRST (so required + prior wording is preserved)
  for (const q of existing) {
    const k = String(q?.key || "");
    if (!k || seen.has(k)) continue;
    out.push({
      key: k,
      label: q?.label || titleCaseFromKey(k),
      help: q?.help || "",
      placeholder: q?.placeholder || "",
      required: !!q?.required,
    });
    seen.add(k);
  }

  // Add template ones only if missing
  for (const q of tmpl) {
    const k = String(q?.key || "");
    if (!k || seen.has(k)) continue;
    out.push({
      key: k,
      label: q?.label || titleCaseFromKey(k),
      help: q?.help || "",
      placeholder: q?.placeholder || "",
      required: !!q?.required,
    });
    seen.add(k);
  }

  return out;
}

function isAnswered(value) {
  if (value === false) return true;
  if (value === 0) return true;
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "object") return true;
  return true;
}

function isMaterialsKey(key) {
  const k = String(key || "");
  return (
    k === "who_purchases_materials" ||
    k === "materials_responsibility" ||
    k === "materials_purchasing"
  );
}

function isMeasurementsKey(key) {
  return String(key || "") === "measurements_needed";
}

export default function ClarificationsModal({
  open,
  agreementId,
  initialAgreement = null,
  excludeKeys = [],
  onClose,
  onSaved,
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [agreement, setAgreement] = useState(null);
  const [answers, setAnswers] = useState({});

  const tpl = useMemo(() => templates(), []);
  const typeKey = useMemo(
    () => guessProjectTypeKey(agreement || initialAgreement),
    [agreement, initialAgreement]
  );

  const recommendedQuestions = useMemo(() => {
    const list = tpl[typeKey] || tpl.general || [];
    return list;
  }, [tpl, typeKey]);

  // Prefill instantly from initialAgreement whenever modal opens
  useEffect(() => {
    if (!open) return;

    const a = initialAgreement || null;
    if (a) {
      const ai_scope = a?.ai_scope || {};
      const existingAnswers = ai_scope?.answers || {};
      setAgreement(a);
      setAnswers({ ...(existingAnswers || {}) });
    } else {
      setAgreement(null);
      setAnswers({});
    }
  }, [open, initialAgreement]);

  // Fetch fresh agreement on open (if agreementId present)
  useEffect(() => {
    if (!open) return;
    if (!agreementId) return;

    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.get(`/projects/agreements/${agreementId}/`);
        if (!alive) return;

        const a = res?.data || null;
        setAgreement(a);

        const ai_scope = a?.ai_scope || {};
        setAnswers({ ...(ai_scope.answers || {}) });
      } catch (e) {
        console.error("ClarificationsModal: load failed", e);
        setError(
          e?.response?.data?.detail || e?.message || "Failed to load agreement."
        );
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, agreementId]);

  function setAnswer(key, value) {
    setAnswers((prev) => ({ ...(prev || {}), [key]: value }));
  }

  const combinedQuestions = useMemo(() => {
    const existing =
      agreement?.ai_scope?.questions || initialAgreement?.ai_scope?.questions || [];
    return mergeQuestionsPreserve(existing, recommendedQuestions);
  }, [agreement, initialAgreement, recommendedQuestions]);

  const visibleQuestions = useMemo(() => {
    const ex = new Set((excludeKeys || []).map((k) => String(k)));
    const currentAnswers = safeDict(answers);

    return combinedQuestions.filter((q) => {
      const k = String(q?.key || "");
      if (!k) return false;

      const required = !!q?.required;
      const answered = isAnswered(currentAnswers?.[k]);

      // If excluded:
      // - hide if optional OR already answered
      // - BUT show if required AND not answered (critical fix)
      if (ex.has(k)) {
        return required && !answered;
      }

      return true;
    });
  }, [combinedQuestions, excludeKeys, answers]);

  async function handleSave() {
    if (!agreementId) {
      setError("Missing agreement id — cannot save clarifications.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const current =
        agreement ||
        initialAgreement ||
        (await api.get(`/projects/agreements/${agreementId}/`)).data;

      const data = current || {};
      const ai_scope = data.ai_scope || {};

      const mergedQuestions = mergeQuestionsPreserve(
        ai_scope.questions,
        recommendedQuestions
      );
      const mergedAnswers = { ...(ai_scope.answers || {}), ...(answers || {}) };

      await api.patch(`/projects/agreements/${agreementId}/`, {
        ai_scope: { ...ai_scope, questions: mergedQuestions, answers: mergedAnswers },
      });

      const refreshed = await api.get(`/projects/agreements/${agreementId}/`);
      setAgreement(refreshed?.data || null);

      if (typeof onSaved === "function") onSaved(refreshed?.data || null);
      if (typeof onClose === "function") onClose();
    } catch (e) {
      console.error("ClarificationsModal: save failed", e);
      setError(e?.response?.data?.detail || e?.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl border">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold text-gray-900">
              Scope Clarifications
            </div>
            <div className="text-xs text-gray-500">
              Recommended for:{" "}
              <span className="font-medium text-gray-700">
                {titleCaseFromKey(typeKey)}
              </span>
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

        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">
          {loading ? <div className="text-sm text-gray-600">Loading…</div> : null}
          {error ? <div className="text-sm text-red-600 mb-2">{error}</div> : null}

          {visibleQuestions.length === 0 ? (
            <div className="text-sm text-gray-600">
              No clarifications to show right now.
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
              {visibleQuestions.map((q) => {
                const key = String(q.key || "");
                const label = q.label || titleCaseFromKey(key);
                const help = q.help || "";
                const required = !!q.required;
                const val = answers?.[key];

                return (
                  <div key={key} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="text-sm font-semibold text-gray-900">{label}</div>
                      {required ? (
                        <span className="text-[11px] px-2 py-1 rounded bg-amber-100 text-amber-800 border border-amber-200">
                          Required
                        </span>
                      ) : null}
                    </div>

                    {isMaterialsKey(key) ? (
                      <select
                        className="w-full rounded border px-3 py-2 text-sm"
                        value={typeof val === "string" ? val : ""}
                        onChange={(e) => setAnswer(key, e.target.value)}
                      >
                        <option value="">Select…</option>
                        <option value="Homeowner">Homeowner</option>
                        <option value="Contractor">Contractor</option>
                        <option value="Split">Split</option>
                      </select>
                    ) : isMeasurementsKey(key) ? (
                      <label className="text-sm text-gray-800 flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!val}
                          onChange={(e) => setAnswer(key, e.target.checked)}
                        />
                        Measurements needed
                      </label>
                    ) : (
                      <textarea
                        className="w-full rounded border px-3 py-2 text-sm resize-y"
                        rows={3}
                        placeholder={q.placeholder || ""}
                        value={val == null ? "" : String(val)}
                        onChange={(e) => setAnswer(key, e.target.value)}
                      />
                    )}

                    {help ? (
                      <div className="mt-2 text-[11px] text-gray-500">{help}</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4 text-[12px] text-gray-600">
            These clarifications are stored on the agreement and will appear in Final Review.
          </div>
        </div>

        <div className="px-5 py-4 border-t flex items-center justify-between">
          <div className="text-xs text-gray-500">
            Tip: Keep clarifications short and concrete.
          </div>
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
