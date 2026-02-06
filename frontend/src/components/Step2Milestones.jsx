// frontend/src/components/Step2Milestones.jsx
// v2026-01-26-popmodal — Step 2 Milestones + AI Suggestions (bulk create + auto-spread)
// Clarifications are handled via a POPUP MODAL (no big section on the page).
//
// What you get:
// - Step2 stays compact (the page does NOT show the "Scope Clarifications" grid).
// - A "Clarifications" button opens a modal with project-type questions.
// - On "Save & Next", Step2 prompt fields are persisted into agreement.ai_scope.answers,
//   and mirrored into agreement.scope_clarifications ONLY if your API exposes it (PDF compatibility).

import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "../api";
import ClarificationsModal from "./ClarificationsModal";

// Local helpers (kept in sync with AgreementWizard)
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

function normalizeAiMilestones(list) {
  if (!Array.isArray(list)) return [];
  return list.map((m, idx) => {
    const title = String(m?.title || `Milestone ${idx + 1}`).trim();
    const description = String(m?.description || "").trim();
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

/* ───────── Step 2 ───────── */
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
}) {
  const [aiLoading, setAiLoading] = useState(false);
  const [aiApplying, setAiApplying] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiPreview, setAiPreview] = useState(null); // { scope_text, milestones }
  const [overlapConfirm, setOverlapConfirm] = useState(null); // { data }

  // Step2 prompt fields (compact)
  const [materialsWho, setMaterialsWho] = useState("Homeowner"); // Homeowner | Contractor | Split
  const [needsMeasurements, setNeedsMeasurements] = useState(true);
  const [measurementNotes, setMeasurementNotes] = useState("");
  const [allowanceNotes, setAllowanceNotes] = useState("");
  const [permitNotes, setPermitNotes] = useState("");

  // Modal
  const [clarOpen, setClarOpen] = useState(false);

  // Persist answers before moving on
  const [savingAiScope, setSavingAiScope] = useState(false);

  // NEW: hydrate Step2 prompt fields from agreement.ai_scope.answers + debounce auto-save
  const didInitFromServerRef = useRef(false);
  const debounceRef = useRef(null);

  // auto-spread
  const [spreadEnabled, setSpreadEnabled] = useState(true);
  const [spreadTotal, setSpreadTotal] = useState(""); // string dollars, optional override
  const [autoSchedule, setAutoSchedule] = useState(false); // auto-assign dates if Agreement start/end set

// NEW: load Step2 prompt fields from agreement.ai_scope.answers on open
useEffect(() => {
  if (!agreementId) return;

  let alive = true;

  (async () => {
    try {
      const res = await api.get(`/projects/agreements/${agreementId}/`);
      if (!alive) return;

      const a = res?.data || {};
      const answers = a?.ai_scope?.answers || {};

      // Materials (accept synonyms)
      const mw =
        (typeof answers.who_purchases_materials === "string" && answers.who_purchases_materials.trim()) ||
        (typeof answers.materials_purchasing === "string" && answers.materials_purchasing.trim()) ||
        (typeof answers.materials_responsibility === "string" && answers.materials_responsibility.trim()) ||
        "";

      if (mw === "Homeowner" || mw === "Contractor" || mw === "Split") {
        setMaterialsWho(mw);
      }

      // Measurements needed
      if (typeof answers.measurements_needed === "boolean") {
        setNeedsMeasurements(answers.measurements_needed);
      }

      // Notes
      if (typeof answers.measurement_notes === "string") setMeasurementNotes(answers.measurement_notes);
      else if (typeof answers.measurements_notes === "string") setMeasurementNotes(answers.measurements_notes);

      if (typeof answers.allowances_selections === "string") setAllowanceNotes(answers.allowances_selections);
      else if (typeof answers.allowance_notes === "string") setAllowanceNotes(answers.allowance_notes);

      if (typeof answers.permit_notes === "string") setPermitNotes(answers.permit_notes);
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
}, [agreementId]);

  // Build answers from Step2 prompt fields
  function buildStep2Answers() {
    const answers = {};

    if (permitNotes && String(permitNotes).trim()) {
      const v = String(permitNotes).trim();
      answers.permit_acquisition = v;
      answers.permits_inspections = v;
      answers.permits = v;
      answers.permit_notes = v;
    }

    if (materialsWho && String(materialsWho).trim()) {
      const v = String(materialsWho).trim();
      answers.who_purchases_materials = v;
      answers.materials_purchasing = v;
      answers.materials_responsibility = v;
    }

    answers.measurements_needed = !!needsMeasurements;
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

  async function persistAnswersToAgreement() {
    if (!agreementId) return;
    const step2Answers = buildStep2Answers();

    // If user didn't enter anything and doesn't care, just skip.
    if (!step2Answers || Object.keys(step2Answers).length === 0) return;

    setSavingAiScope(true);
    try {
      const current = await api.get(`/projects/agreements/${agreementId}/`);
      const data = current?.data || {};
      const ai_scope = data.ai_scope || {};
      const mergedAnswers = { ...(ai_scope.answers || {}), ...step2Answers };

      const patchPayload = {
        ai_scope: { ...ai_scope, answers: mergedAnswers },
      };

      // Mirror into scope_clarifications only if the field exists in the API response
      if (Object.prototype.hasOwnProperty.call(data, "scope_clarifications")) {
        const sc = data.scope_clarifications || {};
        patchPayload.scope_clarifications = { ...(sc || {}), ...mergedAnswers };
      }

      await api.patch(`/projects/agreements/${agreementId}/`, patchPayload);
    } catch (err) {
      console.error("Step2Milestones: failed to persist answers", err);
      // Don't block navigation
    } finally {
      setSavingAiScope(false);
    }
  }

// NEW: auto-save prompt fields (debounced) so toggles persist even if user leaves and comes back
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

  const total = milestones.reduce((s, m) => s + money(m.amount), 0);

  const minStart = useMemo(() => {
    const s = milestones
      .map((m) => toDateOnly(m.start_date || m.start))
      .filter(Boolean)
      .sort()[0];
    return s || "";
  }, [milestones]);

  const maxEnd = useMemo(() => {
    const e = milestones
      .map((m) => toDateOnly(m.completion_date || m.end_date || m.end))
      .filter(Boolean)
      .sort()
      .slice(-1)[0];
    return e || "";
  }, [milestones]);

  async function runAiSuggest() {
    if (!agreementId) return;
    setAiError("");
    setAiLoading(true);

    try {
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

      const res = await api.post(
        `/projects/agreements/${agreementId}/ai/suggest-milestones/`,
        { notes: `${mLocal.description || ""}\n\n${extraNotes}`.trim() }
      );

      setAiPreview({
        scope_text: res.data.scope_text,
        milestones: normalizeAiMilestones(res.data.milestones || []),
      });

      if (!spreadTotal) setSpreadTotal("");
    } catch (e) {
      setAiError(e?.response?.data?.detail || e?.message || "AI suggestion failed.");
    } finally {
      setAiLoading(false);
    }
  }

  async function applyAiMilestonesBulk(mode) {
    if (!agreementId) return;
    if (!aiPreview?.milestones?.length) return;

    setAiError("");
    setAiApplying(true);

    try {
      const payload = {
        agreement_id: agreementId,
        mode, // "replace" | "append"
        spread_strategy: spreadEnabled ? "equal" : "keep_existing_amounts",
        milestones: aiPreview.milestones,
        auto_schedule: autoSchedule,
      };

      const st = String(spreadTotal || "").trim();
      if (spreadEnabled && st !== "") payload.spread_total = st;

      const res = await api.post(`/projects/milestones/bulk-ai-create/`, payload);

      const created = res?.data?.created || [];
      setAiPreview(null);

      alert(
        `Created ${res?.data?.count || created.length} milestones via AI. If the table doesn't update instantly, refresh the page.`
      );
    } catch (e) {
      setAiError(e?.response?.data?.detail || e?.message || "Bulk create failed.");
    } finally {
      setAiApplying(false);
    }
  }

  function isOverlapError(err) {
    const msg = err?.response?.data?.non_field_errors?.[0];
    return !!(msg && String(msg).toLowerCase().includes("overlap"));
  }

  async function handleManualSave() {
    try {
      await saveMilestone(mLocal);
    } catch (e) {
      if (isOverlapError(e)) {
        setOverlapConfirm({ data: mLocal });
        return;
      }
      throw e;
    }
  }

  async function confirmOverlapAndSave() {
    if (!overlapConfirm?.data) return;
    try {
      await saveMilestone({ ...overlapConfirm.data, allow_overlap: true });
    } finally {
      setOverlapConfirm(null);
    }
  }

  function cancelOverlap() {
    setOverlapConfirm(null);
  }

  async function handleNext() {
    await persistAnswersToAgreement();
    if (typeof onNext === "function") onNext();
  }

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-center justify-between mb-3">
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


      {/* Scope Context (read-only) */}
      <div className="mb-3 rounded-lg border bg-gray-50 px-3 py-2 text-sm text-gray-700">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Scope context:</span>
          <span>
            Materials:
            <strong className="ml-1">{materialsWho || "—"}</strong>
          </span>
          <span className="text-gray-400">·</span>
          <span>
            Measurements:
            <strong className="ml-1">
              {needsMeasurements ? "Required" : "Not required"}
            </strong>
          </span>
          {permitNotes ? (
            <>
              <span className="text-gray-400">·</span>
              <span>
                Permits:
                <strong className="ml-1">{permitNotes}</strong>
              </span>
            </>
          ) : null}
          {allowanceNotes ? (
            <>
              <span className="text-gray-400">·</span>
              <span>
                Allowances:
                <strong className="ml-1">{allowanceNotes}</strong>
              </span>
            </>
          ) : null}

          <button
            type="button"
            onClick={() => setClarOpen(true)}
            className="ml-auto rounded border px-2 py-1 text-xs hover:bg-gray-100"
          >
            Edit
          </button>
        </div>
      </div>

      {/* AI Controls */}
      <div className="mb-4 rounded-lg border p-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={runAiSuggest}
              disabled={aiLoading}
              className="rounded border px-3 py-2 text-sm font-medium hover:bg-gray-50"
            >
              {aiLoading ? "Thinking…" : "✨ AI Suggest Milestones"}
            </button>

            {/* POPUP modal trigger */}
            <button
              type="button"
              onClick={() => setClarOpen(true)}
              className="rounded border px-3 py-2 text-sm font-medium hover:bg-gray-50"
              title="Add project-type scope clarifications to the agreement"
            >
              Clarifications
            </button>

            {aiError && <span className="text-sm text-red-600">{aiError}</span>}
          </div>

        {/* Scope fields removed from Step 2 — edit these via the Clarifications modal. */}
      </div>
    </div>


      {/* POPUP MODAL (no inline clarifications section on the page) */}
      <ClarificationsModal
        open={clarOpen}
        agreementId={agreementId}
        // Exclude keys already captured by Step2 prompts so the modal feels "unique"
        excludeKeys={[
          "permit_acquisition",
          "permits_inspections",
          "who_purchases_materials",
          "materials_purchasing",
          "materials_responsibility",
          "measurements_needed",
          "measurement_notes",
          "allowances_selections",
          "allowance_notes",
        ]}
        onClose={() => setClarOpen(false)}
        onSaved={async () => {
          // After saving modal, also mirror Step2 prompt answers (keeps everything in sync).
          await persistAnswersToAgreement();
        }}
      />

      {/* AI Preview */}
      {aiPreview && (
        <div className="mb-6 rounded-lg border bg-indigo-50 p-4">
          <h4 className="font-semibold mb-2">AI Suggested Scope</h4>
          <p className="text-sm whitespace-pre-wrap mb-3">{aiPreview.scope_text}</p>

          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-3">
            <div>
              <h4 className="font-semibold mb-2">AI Suggested Milestones</h4>
              <p className="text-xs text-gray-600">Tip: Use auto-spread if AI amounts are $0.00.</p>
            </div>

            <div className="rounded border bg-white p-3">
              <label className="text-xs text-gray-700 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={spreadEnabled}
                  onChange={(e) => setSpreadEnabled(e.target.checked)}
                />
                Auto-spread total across milestones
              </label>

              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-gray-600">Total ($)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-40 rounded border px-2 py-2 text-sm"
                  placeholder="e.g., 1250.00"
                  value={spreadTotal}
                  onChange={(e) => setSpreadTotal(e.target.value)}
                  disabled={!spreadEnabled}
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
                />
                Auto-schedule milestones (requires Agreement start/end)
              </label>
            </div>
          </div>

          <ul className="text-sm list-disc pl-5 mb-4">
            {aiPreview.milestones.map((m, i) => (
              <li key={i}>
                <strong>{m.title}</strong> — ${Number(m.amount || 0).toFixed(2)}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => applyAiMilestonesBulk("replace")}
              disabled={aiApplying}
              className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {aiApplying ? "Applying…" : "Replace Milestones (Bulk)"}
            </button>
            <button
              type="button"
              onClick={() => applyAiMilestonesBulk("append")}
              disabled={aiApplying}
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
          </div>

          <div className="mt-3 text-xs text-gray-600">
            <strong>AI prompts happen before saving milestones</strong> so scope gaps are captured
            before the agreement is finalized.
          </div>
        </div>
      )}

      {/* Inline add form */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-2">
        <input
          className="md:col-span-4 rounded border px-3 py-2 text-sm"
          placeholder="Title"
          name="title"
          value={mLocal.title}
          onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
        />
        <input
          type="date"
          className="md:col-span-3 rounded border px-3 py-2 text-sm"
          name="start"
          value={mLocal.start || ""}
          onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
        />
        <input
          type="date"
          className="md:col-span-3 rounded border px-3 py-2 text-sm"
          name="end"
          value={mLocal.end || ""}
          onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
        />
        <input
          type="number"
          min="0"
          step="0.01"
          className="md:col-span-2 rounded border px-3 py-2 text-sm"
          placeholder="Amount"
          name="amount"
          value={mLocal.amount}
          onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
        />
        <div className="md:col-span-12">
          <textarea
            className="w-full rounded border px-3 py-2 text-sm resize-y"
            rows={3}
            placeholder="Description (details, materials, notes)…"
            name="description"
            value={mLocal.description}
            onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
          />
        </div>
      </div>

      <div className="mb-6">
        <button
          type="button"
          onClick={handleManualSave}
          className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
        >
          + Add Milestone
        </button>
      </div>

      {/* Table */}
      <div className="rounded-2xl border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="[&>*]:px-3 [&>*]:py-2 text-left">
              <th>#</th>
              <th>Title</th>
              <th>Description</th>
              <th>Start</th>
              <th>Due</th>
              <th>Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {milestones.map((m, idx) => (
              <tr key={m.id || `${m.title}-${idx}`} className="border-t align-top">
                <td className="[&>*]:px-3 [&>*]:py-2">{idx + 1}</td>
                <td className="[&>*]:px-3 [&>*]:py-2">{m.title || "—"}</td>
                <td className="[&>*]:px-3 [&>*]:py-2 whitespace-pre-wrap">
                  {m.description || "—"}
                </td>
                <td className="[&>*]:px-3 [&>*]:py-2">
                  {friendly(toDateOnly(m.start_date || m.start))}
                </td>
                <td className="[&>*]:px-3 [&>*]:py-2">
                  {friendly(toDateOnly(m.completion_date || m.end_date || m.end))}
                </td>
                <td className="[&>*]:px-3 [&>*]:py-2">
                  {Number(m.amount || 0).toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                  })}
                </td>
                <td className="[&>*]:px-3 [&>*]:py-2 text-right">
                  <div className="inline-flex gap-2">
                    <button
                      type="button"
                      className="rounded border px-2 py-1"
                      onClick={() => setEditMilestone(m)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="rounded border px-2 py-1"
                      onClick={() => deleteMilestone(m.id)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!milestones.length && (
              <tr>
                <td colSpan={7} className="text-center text-gray-400 py-6">
                  No milestones yet.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-semibold [&>*]:px-3 [&>*]:py-2">
              <td colSpan={5}>Total</td>
              <td>
                {total.toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                })}
              </td>
              <td />
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
          className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
          disabled={savingAiScope}
        >
          {savingAiScope ? "Saving…" : "Save & Next"}
        </button>
      </div>

      {overlapConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Overlapping Schedule</h3>
            <p className="mt-2 text-sm text-gray-700">
              This milestone overlaps an existing milestone’s schedule. Do you want to continue anyway?
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelOverlap}
                className="rounded border px-4 py-2 text-sm"
              >
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
