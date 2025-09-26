// src/components/AgreementEdit.jsx
// v2025-09-23-draft-guardrails — keeps your design; adds draft/amendment locking for edits, deletes & save

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";
import AttachmentSection from "./AttachmentSection";
import DateField from "../components/DateField";

console.log("AgreementEdit.jsx v2025-09-23 single PATCH sends project fields + draft guardrails");

const DEFAULT_WARRANTY_TEXT =
  "Contractor warrants workmanship for one (1) year from substantial completion. Materials are covered by manufacturer warranties where applicable. Warranty excludes damage caused by misuse, neglect, unauthorized modifications, or normal wear. Remedy is limited to repair or replacement at Contractor’s discretion.";

const toISO = (v) => {
  if (!v) return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const mdy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1]}-${mdy[2]}`;
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {}
  return s;
};

const deepClone = (obj) => JSON.parse(JSON.stringify(obj));
const statusFromBooleans = (m) =>
  (m.is_invoiced ? "invoiced" : m.completed ? "complete" : "incomplete");
const booleansFromStatus = (status) => {
  switch ((status || "").toLowerCase()) {
    case "complete":
      return { completed: true, is_invoiced: false };
    case "invoiced":
      return { completed: true, is_invoiced: true };
    default:
      return { completed: false, is_invoiced: false };
  }
};

/* ---------------- Milestone Edit Modal (unchanged layout; locked if not draft) ---------------- */
function MilestoneModal({ open, onClose, value, onSave, locked }) {
  const [form, setForm] = useState({ ...value });
  useEffect(() => {
    setForm({ ...value });
  }, [value]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[680px] max-w-[92vw] rounded-xl bg-white shadow-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold mb-3">
          {locked ? "Milestone (Locked — Signed)" : "Edit Milestone"}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 opacity-100">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
            <input
              className="w-full rounded-md border border-slate-300 px-2 py-1"
              value={form.title || ""}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              disabled={locked}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Start</label>
            <DateField
              id={`modal-ms-${form.id || "new"}-start`}
              name="start_date"
              value={form.start_date ? String(form.start_date).slice(0, 10) : ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, start_date: toISO(e.target.value) }))
              }
              disabled={locked}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">End</label>
            <DateField
              id={`modal-ms-${form.id || "new"}-end`}
              name="completion_date"
              value={form.end_date ? String(form.end_date).slice(0, 10) : ""}
              onChange={(e) => setForm((f) => ({ ...f, end_date: toISO(e.target.value) }))}
              disabled={locked}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Amount ($)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="w-full rounded-md border border-slate-300 px-2 py-1"
              value={form.amount ?? 0}
              onChange={(e) =>
                setForm((f) => ({ ...f, amount: Number(e.target.value || 0) }))
              }
              disabled={locked}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
            <select
              className="w-full rounded-md border border-slate-300 px-2 py-1"
              value={form.status || "incomplete"}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              disabled={locked}
            >
              <option value="incomplete">Incomplete</option>
              <option value="complete">Completed</option>
              <option value="invoiced">Invoiced</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Description of Work
            </label>
            <textarea
              rows={4}
              className="w-full rounded-md border border-slate-300 px-2 py-1"
              value={form.description || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              disabled={locked}
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            className="px-3 py-2 text-xs rounded-md border border-slate-300"
            onClick={onClose}
          >
            Close
          </button>
          {!locked && (
            <button
              className="px-3 py-2 text-xs rounded-md bg-blue-600 text-white"
              onClick={() => onSave(form)}
            >
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ======================== Agreement Edit ======================== */
export default function AgreementEdit() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    title: "",
    description: "",
    project_type: "",
    project_subtype: "",
    warranty_mode: "default",
    warranty_text: "",
  });

  // New: status flags to enforce draft-only edits/deletes
  const [agreementStatus, setAgreementStatus] = useState("draft");
  const [isAmendment, setIsAmendment] = useState(false);
  const [amendmentStatus, setAmendmentStatus] = useState(null);

  const originalAgreementRef = useRef(null);
  const projectIdRef = useRef(null);

  const [milestones, setMilestones] = useState([]);
  const originalMilestonesRef = useRef([]);

  // modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalIndex, setModalIndex] = useState(-1);

  const typeOptions = ["Bathroom", "Kitchen", "Exterior", "General"];
  const subtypeOptions = ["Remodel", "Repair", "Install", "Other"];
  const defaultWarrantyPreview = useMemo(() => DEFAULT_WARRANTY_TEXT, []);

  // derived lock rule: draft (or amendment draft) can edit; else locked
  const canEditAgreement = useMemo(() => {
    const st = String(agreementStatus || "draft").toLowerCase();
    if (isAmendment) {
      const am = String(amendmentStatus || "").toLowerCase();
      return am === "draft";
    }
    return st === "draft";
  }, [agreementStatus, isAmendment, amendmentStatus]);

  useEffect(() => {
    let mounted = true;
    async function loadAll() {
      setLoading(true);
      try {
        // Your existing load — keep structure
        const [aRes, mRes] = await Promise.all([
          api.get(`/projects/agreements/${id}/`),
          api.get(`/projects/agreements/${id}/milestones/`),
        ]);

        const a = aRes.data || {};
        projectIdRef.current = a.project || a.project_id || a.project?.id || null;

        // New: status flags detected from payload
        setAgreementStatus(a.status || a.agreement_status || "draft");
        setIsAmendment(!!(a.is_amendment || a.amendment_id));
        setAmendmentStatus(a.amendment_status || null);

        const msRaw = Array.isArray(mRes.data) ? mRes.data : (mRes.data?.results || []);

        // Warranty mode (unchanged)
        const warrantyMode =
          (a.warranty_type || "").toLowerCase() === "custom" ||
          (a.warranty_text_snapshot && a.warranty_text_snapshot.trim().length > 0)
            ? "custom"
            : "default";

        const nextForm = {
          title: a.project_title || a.title || "",
          description: a.description ?? "",
          project_type: a.project_type ?? a.type ?? "",
          project_subtype: a.project_subtype ?? a.subtype ?? "",
          warranty_mode: warrantyMode,
          warranty_text: a.warranty_text_snapshot ?? "",
        };

        const nextMilestones = (msRaw || []).map((m, idx) => {
          const s = m.start_date || m.scheduled_date || "";
          const e = m.completion_date || m.end_date || "";
          return {
            id: m.id,
            title: m.title ?? "",
            start_date: toISO(s),
            end_date: toISO(e),
            amount: Number(m.amount ?? 0),
            description: m.description ?? "",
            status: statusFromBooleans(m),
            order: m.order ?? idx + 1,
          };
        });

        if (!mounted) return;
        setForm(nextForm);
        setMilestones(nextMilestones);
        originalAgreementRef.current = deepClone(nextForm);
        originalMilestonesRef.current = deepClone(nextMilestones);
      } catch (err) {
        console.error(err);
        toast.error("Failed to load agreement.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadAll();
    return () => {
      mounted = false;
    };
  }, [id]);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };
  const onWarrantyModeChange = (mode) =>
    setForm((f) => ({ ...f, warranty_mode: mode }));

  const addMilestone = () => {
    if (!canEditAgreement) {
      toast("Add is locked. Agreement is not in Draft.");
      return;
    }
    setMilestones((rows) => [
      ...rows,
      {
        title: "",
        start_date: toISO(new Date().toISOString().slice(0, 10)),
        end_date: toISO(new Date().toISOString().slice(0, 10)),
        amount: 0,
        description: "",
        status: "incomplete",
        order: (rows[rows.length - 1]?.order || rows.length) + 1,
      },
    ]);
  };

  const updateMilestone = (i, field, value) => {
    if (!canEditAgreement) {
      return; // silently ignore while locked; inputs are disabled anyway
    }
    setMilestones((rows) => {
      const next = deepClone(rows);
      next[i][field] = field === "amount" ? Number(value || 0) : value;
      return next;
    });
  };

  const removeMilestone = (i) => {
    if (!canEditAgreement) {
      toast("Delete is locked. Agreement is not in Draft.");
      return;
    }
    setMilestones((rows) => rows.filter((_, idx) => idx !== i));
  };

  // ---------- Agreement PATCH body (includes project fields so backend updates Project) ----------
  function buildAgreementPatchBody() {
    const orig = originalAgreementRef.current || {};
    const changed = {};

    // Always send current status context so backend can choose to enforce too (optional):
    changed._client_edit_intent = isAmendment ? "amendment" : "agreement";
    changed._client_status = isAmendment ? amendmentStatus : agreementStatus;

    // Project fields (safe to send even if unchanged)  — your existing approach
    if ((form.title ?? "") !== (orig.title ?? "") || form.title) {
      changed.title = form.title || "";
      changed.project_title = form.title || "";
    }
    if ((form.project_type ?? "") !== (orig.project_type ?? "") || form.project_type) {
      changed.project_type = form.project_type || "";
      changed.type = form.project_type || "";
    }
    if (
      (form.project_subtype ?? "") !== (orig.project_subtype ?? "") ||
      form.project_subtype
    ) {
      changed.project_subtype = form.project_subtype || "";
      changed.subtype = form.project_subtype || "";
    }

    // Agreement description (+ legacy alias)
    if ((form.description ?? "") !== (orig.description ?? "") || form.description) {
      changed.description = form.description || "";
      changed.job_description = form.description || "";
    }

    // Warranty
    if (form.warranty_mode === "default") {
      changed.warranty_type = "default";
      changed.warranty_text_snapshot = "";
      changed.use_default_warranty = true;
      changed.custom_warranty_text = "";
    } else {
      const txt = form.warranty_text || DEFAULT_WARRANTY_TEXT;
      changed.warranty_type = "custom";
      changed.warranty_text_snapshot = txt;
      changed.use_default_warranty = false;
      changed.custom_warranty_text = txt;
    }

    return changed;
  }

  function buildMilestonesPayload(list) {
    return {
      items: list.map((m) => {
        const start = toISO(m.start_date) || null;
        const end = toISO(m.end_date) || null;
        const booleans = booleansFromStatus(m.status);
        const payload = {
          id: m.id || undefined,
          agreement: Number(id),
          title: m.title,
          description: m.description || "",
          start_date: start,
          amount: Number(m.amount || 0),
          order: m.order ?? null,
          completed: !!booleans.completed,
          is_invoiced: !!booleans.is_invoiced,
        };
        if (end) {
          payload.completion_date = end; // new
          payload.end_date = end; // legacy alias
        }
        return payload;
      }),
      prune_missing: true,
    };
  }

  async function saveAgreementAndMilestones() {
    if (!canEditAgreement) {
      toast("Saving is locked. Agreement (or amendment) is not in Draft.");
      return;
    }
    setSaving(true);
    try {
      // 1) Single PATCH to Agreement: includes project fields + description + warranty
      const patchBody = buildAgreementPatchBody();
      await api.patch(`/projects/agreements/${id}/`, patchBody, {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      // 2) Milestones upsert
      const payload = buildMilestonesPayload(milestones);
      const r = await api.post(
        `/projects/agreements/${id}/milestones_bulk_update/`,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        }
      );

      // 3) Refresh local milestones
      const ms = Array.isArray(r.data) ? r.data : r.data?.results || [];
      const next = (ms || []).map((m, idx) => {
        const s = m.start_date || m.scheduled_date || "";
        const e = m.completion_date || m.end_date || "";
        return {
          id: m.id,
          title: m.title ?? "",
          start_date: toISO(s),
          end_date: toISO(e),
          amount: Number(m.amount ?? 0),
          description: m.description ?? "",
          status: statusFromBooleans(m),
          order: m.order ?? idx + 1,
        };
      });
      setMilestones(next);
      originalMilestonesRef.current = deepClone(next);

      // Update local originals so form doesn’t “reset”
      originalAgreementRef.current = deepClone({
        ...originalAgreementRef.current,
        ...patchBody,
      });

      toast.success("Agreement, project info, and milestones saved.");
    } catch (err) {
      console.error("Save failed:", err?.response?.data || err);
      const detail =
        err?.response?.data?.detail ||
        (typeof err?.response?.data === "string" ? err.response.data : null) ||
        "Save failed. Check console/network.";
      toast.error(String(detail));
    } finally {
      setSaving(false);
    }
  }

  // modal handlers (respect lock)
  const openModal = (i) => {
    if (!canEditAgreement) {
      toast("Editing is locked. Agreement (or amendment) is not in Draft.");
      return;
    }
    setModalIndex(i);
    setModalOpen(true);
  };
  const closeModal = () => setModalOpen(false);
  const saveModal = (updated) => {
    if (modalIndex < 0) return closeModal();
    ["title", "start_date", "end_date", "amount", "status", "description"].forEach(
      (k) => updateMilestone(modalIndex, k, k.includes("date") ? toISO(updated[k]) : updated[k])
    );
    setModalOpen(false);
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse text-sm text-slate-500">Loading agreement…</div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 md:px-10 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">
            Edit {isAmendment ? "Amendment" : "Agreement"}
          </h1>
          <p className="text-xs text-slate-500">
            #{id} •{" "}
            <span className="inline-flex items-center gap-1">
              Status:{" "}
              <span
                className={`px-2 py-0.5 rounded text-[11px] ${
                  canEditAgreement ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                }`}
              >
                {isAmendment ? (amendmentStatus || "—") : (agreementStatus || "—")}
              </span>
              {!canEditAgreement && (
                <em className="text-[11px] text-slate-500">(locked)</em>
              )}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={saving || !canEditAgreement}
            onClick={saveAgreementAndMilestones}
            className={`px-4 py-2 text-xs rounded-md ${
              canEditAgreement
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-slate-300 text-slate-600 cursor-not-allowed"
            } disabled:opacity-60`}
            title={canEditAgreement ? "Save Changes" : "Locked after signing"}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Agreement Details */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
        <h2 className="text-sm font-semibold mb-4">Agreement Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Title (Project Name)
            </label>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              name="title"
              value={form.title}
              onChange={onChange}
              placeholder="e.g., Kitchen Remodel"
              disabled={!canEditAgreement}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Project Type
            </label>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              name="project_type"
              value={form.project_type}
              onChange={onChange}
              disabled={!canEditAgreement}
            >
              <option value="">Select a type…</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Job Description
            </label>
            <textarea
              rows={4}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              name="description"
              value={form.description}
              onChange={onChange}
              placeholder="Scope of work, materials, exclusions…"
              disabled={!canEditAgreement}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Project Subtype
            </label>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              name="project_subtype"
              value={form.project_subtype}
              onChange={onChange}
              disabled={!canEditAgreement}
            >
              <option value="">Select a subtype…</option>
              {subtypeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Warranty */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
        <h2 className="text-sm font-semibold mb-3">Warranty</h2>
        <div className="flex items-center gap-6 mb-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              className="accent-blue-600"
              checked={form.warranty_mode === "default"}
              onChange={() => onWarrantyModeChange("default")}
              disabled={!canEditAgreement}
            />
            Use default warranty
          </label>
        </div>
        <div className="flex items-center gap-6 mb-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              className="accent-blue-600"
              checked={form.warranty_mode === "custom"}
              onChange={() => onWarrantyModeChange("custom")}
              disabled={!canEditAgreement}
            />
            Provide custom warranty
          </label>
        </div>
        {form.warranty_mode === "default" ? (
          <>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Default Warranty (read-only preview)
            </label>
            <textarea
              value={defaultWarrantyPreview}
              readOnly
              rows={4}
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
            />
          </>
        ) : (
          <>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Custom Warranty
            </label>
            <textarea
              rows={5}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              name="warranty_text"
              value={form.warranty_text || DEFAULT_WARRANTY_TEXT}
              onChange={onChange}
              disabled={!canEditAgreement}
            />
          </>
        )}
      </div>

      {/* Attachments */}
      <AttachmentSection agreementId={id} />

      {/* Milestones */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Milestones</h2>
          <button
            type="button"
            onClick={addMilestone}
            className={`px-3 py-2 text-xs rounded-md border ${
              canEditAgreement
                ? "border-slate-300 hover:bg-slate-50"
                : "border-slate-200 text-slate-400 cursor-not-allowed"
            }`}
            disabled={!canEditAgreement}
            title={canEditAgreement ? "Add Milestone" : "Locked after signing"}
          >
            + Add Milestone
          </button>
        </div>

        {milestones.length === 0 ? (
          <div className="text-sm text-slate-500">No milestones yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500 border-b">
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 pr-3">Title</th>
                  <th className="py-2 pr-3">Start</th>
                  <th className="py-2 pr-3">End</th>
                  <th className="py-2 pr-3">Amount ($)</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {milestones.map((m, idx) => (
                  <tr key={m.id ?? `new-${idx}`} className="border-b last:border-0">
                    <td className="py-2 pr-3 align-top w-10">{idx + 1}</td>

                    <td className="py-2 pr-3 align-top min-w-[220px]">
                      <input
                        className="w-full rounded-md border border-slate-300 px-2 py-1"
                        value={m.title}
                        onChange={(e) => updateMilestone(idx, "title", e.target.value)}
                        disabled={!canEditAgreement}
                      />
                    </td>

                    <td className="py-2 pr-3 align-top min-w-[170px]">
                      <DateField
                        id={`ms-${m.id || idx}-start`}
                        name="start_date"
                        value={
                          m.start_date ? String(m.start_date).slice(0, 10) : ""
                        }
                        onChange={(e) =>
                          updateMilestone(idx, "start_date", toISO(e.target.value))
                        }
                        disabled={!canEditAgreement}
                      />
                    </td>

                    <td className="py-2 pr-3 align-top min-w-[170px]">
                      <DateField
                        id={`ms-${m.id || idx}-end`}
                        name="completion_date"
                        value={m.end_date ? String(m.end_date).slice(0, 10) : ""}
                        onChange={(e) =>
                          updateMilestone(idx, "end_date", toISO(e.target.value))
                        }
                        disabled={!canEditAgreement}
                      />
                    </td>

                    <td className="py-2 pr-3 align-top w-32">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="w-full rounded-md border border-slate-300 px-2 py-1"
                        value={m.amount}
                        onChange={(e) =>
                          updateMilestone(idx, "amount", e.target.value)
                        }
                        disabled={!canEditAgreement}
                      />
                    </td>

                    <td className="py-2 pr-3 align-top w-48">
                      <select
                        className="w-full rounded-md border border-slate-300 px-2 py-1"
                        value={m.status}
                        onChange={(e) =>
                          updateMilestone(idx, "status", e.target.value)
                        }
                        disabled={!canEditAgreement}
                      >
                        <option value="incomplete">Incomplete</option>
                        <option value="complete">Completed</option>
                        <option value="invoiced">Invoiced</option>
                      </select>
                    </td>

                    <td className="py-2 pr-3 align-top text-right">
                      <div className="flex gap-2 justify-end">
                        {canEditAgreement ? (
                          <>
                            <button
                              className="px-2 py-1 text-xs rounded-md border border-slate-300"
                              onClick={() => {
                                setModalIndex(idx);
                                setModalOpen(true);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              className="px-2 py-1 text-xs rounded-md border border-rose-200 text-rose-600"
                              onClick={() => removeMilestone(idx)}
                            >
                              Remove
                            </button>
                          </>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            (locked)
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={saving || !canEditAgreement}
            onClick={saveAgreementAndMilestones}
            className={`px-4 py-2 text-xs rounded-md ${
              canEditAgreement
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-slate-300 text-slate-600 cursor-not-allowed"
            } disabled:opacity-60`}
            title={canEditAgreement ? "Save Changes" : "Locked after signing"}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Review & Sign (UI text untouched) */}
      <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <h2 className="text-sm font-semibold mb-3">Review &amp; Sign</h2>
        <p className="text-xs text-slate-600 mb-2">
          Generate a preview, send to the homeowner for review, or sign as the contractor.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            className="px-3 py-2 text-xs rounded-md border border-slate-300"
            onClick={async () => {
              try {
                await api.get(`/projects/signing/agreements/${id}/preview/`);
                toast.success("Preview queued.");
              } catch (e) {
                toast.error("Preview failed.");
              }
            }}
          >
            Generate Preview
          </button>

          <button
            className="px-3 py-2 text-xs rounded-md border border-slate-300"
            onClick={() => toast("Open your signature flow (homeowner).")}
          >
            Send to Homeowner for Review/Signature
          </button>

          <button
            className="px-3 py-2 text-xs rounded-md bg-emerald-600 text-white"
            onClick={() => toast("Open your signature flow (contractor).")}
          >
            Sign as Contractor
          </button>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between text-xs text-slate-500">
        <Link className="hover:underline" to="/agreements">
          ← Back to Agreements
        </Link>
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="hover:underline"
        >
          Go to Dashboard →
        </button>
      </div>

      <MilestoneModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        value={milestones[modalIndex] || {}}
        onSave={saveModal}
        locked={!canEditAgreement}
      />
    </div>
  );
}
