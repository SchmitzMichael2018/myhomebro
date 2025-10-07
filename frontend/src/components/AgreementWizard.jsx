// src/components/AgreementWizard.jsx
// v2025-10-06-stable-tabs-r2 — Step 1/3/4 restored; Step 2 (calendar icons) kept; resilient loading.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";

/* -------------------- Helpers -------------------- */
const TABS = [
  { step: 1, label: "1. Details" },
  { step: 2, label: "2. Milestones" },
  { step: 3, label: "3. Warranty & Attachments" },
  { step: 4, label: "4. Finalize & Review" },
];

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}
function toDateOnly(v) {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function daySpan(start, end) {
  const a = start ? new Date(start) : null;
  const b = end ? new Date(end) : null;
  if (!a || !b || isNaN(a) || isNaN(b)) return "";
  const ms = b.getTime() - a.getTime();
  return ms >= 0 ? Math.floor(ms / 86400000) + 1 : "";
}

/* Reusable inline calendar button (no external CSS) */
function CalendarBtn({ onClick, title = "Pick a date", disabled }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={title}
      title={title}
      disabled={disabled}
      style={{
        position: "absolute",
        right: 8,
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 2147483647,
        background: "transparent",
        border: 0,
        lineHeight: 0,
        color: "#6B7280",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span role="img" aria-label="calendar">📅</span>
    </button>
  );
}

/* -------------------- Root Wizard -------------------- */
export default function AgreementWizard() {
  const navigate = useNavigate();
  const { id } = useParams();
  const q = useQuery();
  const step = Number(q.get("step") || "1");

  const [loading, setLoading] = useState(false);
  const [agreement, setAgreement] = useState(null);
  const [milestones, setMilestones] = useState([]);

  // Step 2 local form (stable — avoids focus loss)
  const [mLocal, setMLocal] = useState({ title: "", description: "", amount: "", start: "", end: "" });

  // Step 1 local form
  const [dLocal, setDLocal] = useState({
    project_title: "",
    project_type: "",
    project_subtype: "",
    description: "",
    start: "",
    end: "",
  });

  // Step 3 local state: warranty + attachments
  const [useDefaultWarranty, setUseDefaultWarranty] = useState(true);
  const [customWarranty, setCustomWarranty] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [attForm, setAttForm] = useState({
    title: "",
    category: "WARRANTY",
    visible: true,
    require_ack: false,
    file: null,
  });

  useEffect(() => { console.log("AgreementWizard build:", "v2025-10-06-stable-tabs-r2"); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: ag } = await api.get(`/projects/agreements/${id}/`);
      setAgreement(ag);

      // hydrate Step 1
      setDLocal({
        project_title: ag.project_title || ag.title || "",
        project_type: ag.project_type || "",
        project_subtype: ag.project_subtype || "",
        description: ag.description || "",
        start: toDateOnly(ag.start),
        end: toDateOnly(ag.end),
      });

      // Step 3 warranty
      // tolerate either "warranty_type" or a snapshot; default to using default warranty if no custom text
      const hasCustom = !!(ag.warranty_text_snapshot && ag.warranty_text_snapshot.trim().length > 0);
      setUseDefaultWarranty(!hasCustom);
      setCustomWarranty(ag.warranty_text_snapshot || "");

      // milestones (for totals and table)
      const { data: msRaw } = await api.get(`/projects/milestones/`, { params: { agreement: id, page_size: 500 } });
      const ms = Array.isArray(msRaw?.results) ? msRaw.results : Array.isArray(msRaw) ? msRaw : [];
      setMilestones(ms);

      // attachments (safe if endpoint exists)
      try {
        const { data: atRaw } = await api.get(`/projects/agreements/${id}/attachments/`);
        setAttachments(Array.isArray(atRaw) ? atRaw : []);
      } catch {
        setAttachments([]);
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to load agreement.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const totalAmt = milestones.reduce((s, m) => s + Number(m.amount || 0), 0);
    const starts = milestones.map(m => toDateOnly(m.start_date || m.start || m.scheduled_date)).filter(Boolean);
    const ends   = milestones.map(m => toDateOnly(m.completion_date || m.end_date || m.end || m.due_date)).filter(Boolean);
    const minStart = starts.length ? [...starts].sort()[0] : "";
    const maxEnd   = ends.length ? [...ends].sort().slice(-1)[0] : "";
    const totalDays = (minStart && maxEnd) ? daySpan(minStart, maxEnd) : 0;
    return { totalAmt, minStart, maxEnd, totalDays };
  }, [milestones]);

  const goStep = (n) => navigate(`/agreements/${id}/wizard?step=${n}`);

  /* -------------------- Step 1 (Details) -------------------- */
  const saveStep1 = async () => {
    try {
      const payload = {
        title: dLocal.project_title,
        project_title: dLocal.project_title, // tolerate both
        project_type: dLocal.project_type,
        project_subtype: dLocal.project_subtype,
        description: dLocal.description,
        start: dLocal.start || null,
        end: dLocal.end || null,
      };
      await api.patch(`/projects/agreements/${id}/`, payload);
      toast.success("Details saved.");
      await load();
    } catch (e) {
      console.error(e);
      toast.error("Failed to save details.");
    }
  };

  /* -------------------- Step 2 (Milestones) -------------------- */
  const onLocalChange = (e) => {
    const { name, value } = e.target;
    setMLocal((s) => (name === "start" || name === "end" ? { ...s, [name]: toDateOnly(value) } : { ...s, [name]: value }));
  };
  const addMilestone = async () => {
    const f = mLocal;
    if (!f.title?.trim()) return toast.error("Enter a title.");
    if (!f.start || !f.end) return toast.error("Select start and end dates.");
    try {
      const payload = {
        agreement: Number(id),
        title: f.title.trim(),
        description: f.description || "",
        amount: f.amount ? Number(f.amount) : 0,
        start_date: f.start,
        end_date: f.end,
        completion_date: f.end,
      };
      const { data } = await api.post(`/projects/milestones/`, payload);
      setMilestones((ms) => [...ms, data]);
      setMLocal({ title: "", description: "", amount: "", start: "", end: "" });
      toast.success("Milestone added.");
    } catch (e) {
      const msg = e?.response?.data?.non_field_errors || e?.response?.data?.detail || "Add failed.";
      toast.error(Array.isArray(msg) ? msg.join(", ") : String(msg));
    }
  };
  const removeMilestone = async (mid) => {
    try {
      await api.delete(`/projects/milestones/${mid}/`);
      setMilestones((ms) => ms.filter((m) => m.id !== mid));
      toast.success("Milestone removed.");
    } catch {
      toast.error("Delete failed.");
    }
  };

  /* -------------------- Step 3 (Warranty & Attachments) -------------------- */
  const saveWarranty = async () => {
    try {
      const payload = {
        // normalize to your backend shape
        warranty_text_snapshot: useDefaultWarranty ? "" : (customWarranty || ""),
        warranty_type: useDefaultWarranty ? "DEFAULT" : "CUSTOM",
      };
      await api.patch(`/projects/agreements/${id}/`, payload);
      toast.success("Warranty saved.");
      await load();
    } catch (e) {
      console.error(e);
      toast.error("Failed to save warranty.");
    }
  };

  const addAttachment = async () => {
    try {
      const fd = new FormData();
      fd.append("title", attForm.title || "");
      fd.append("category", attForm.category || "OTHER");
      fd.append("visible", String(!!attForm.visible));
      fd.append("require_acknowledgement", String(!!attForm.require_ack));
      if (attForm.file) fd.append("file", attForm.file);
      const { data } = await api.post(`/projects/agreements/${id}/attachments/`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setAttachments((prev) => [...prev, data]);
      setAttForm({ title: "", category: "WARRANTY", visible: true, require_ack: false, file: null });
      toast.success("Attachment added.");
    } catch (e) {
      console.error(e);
      toast.error("Failed to add attachment.");
    }
  };
  const deleteAttachment = async (attId) => {
    try {
      await api.delete(`/projects/agreements/${id}/attachments/${attId}/`);
      setAttachments((prev) => prev.filter((a) => a.id !== attId));
      toast.success("Attachment deleted.");
    } catch {
      toast.error("Delete failed.");
    }
  };

  return (
    <div className="p-4 md:p-6">
      {/* Tabs — always visible */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.step}
            onClick={() => goStep(t.step)}
            className={`rounded px-3 py-2 text-sm ${
              step === t.step ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <div className="flex gap-2">
          <button
            onClick={() => window.open(`/projects/agreements/${id}/pdf/preview/`, "_blank")}
            className="rounded bg-indigo-50 px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-100"
          >
            Preview PDF
          </button>
          <button
            onClick={() => window.open(`/agreements/public/${id}/`, "_blank")}
            className="rounded bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200"
          >
            View Public Link
          </button>
        </div>
      </div>

      {/* Step panes */}
      {step === 1 && (
        <div className="rounded-lg border bg-white p-4">
          {!!loading && <div className="text-sm text-gray-500 mb-3">Loading…</div>}
          <div className="text-sm text-gray-600 mb-4">
            {agreement ? <>Agreement #{agreement.id} — {agreement.project_title || agreement.title || "Project"}</> : <>Agreement #{id}</>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Project Title</label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={dLocal.project_title}
                onChange={(e) => setDLocal((s) => ({ ...s, project_title: e.target.value }))}
                placeholder="e.g., Kitchen Floor and Wall"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={dLocal.project_type}
                onChange={(e) => setDLocal((s) => ({ ...s, project_type: e.target.value }))}
                placeholder="e.g., Remodel"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Subtype</label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={dLocal.project_subtype}
                onChange={(e) => setDLocal((s) => ({ ...s, project_subtype: e.target.value }))}
                placeholder="e.g., Kitchen"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea
                className="w-full rounded border px-3 py-2 text-sm"
                rows={3}
                value={dLocal.description}
                onChange={(e) => setDLocal((s) => ({ ...s, description: e.target.value }))}
                placeholder="Brief project scope…"
              />
            </div>

            {/* Dates with calendar buttons */}
            <DateWithButton
              label="Start"
              value={dLocal.start}
              onChange={(v) => setDLocal((s) => ({ ...s, start: toDateOnly(v) }))}
            />
            <DateWithButton
              label="End"
              value={dLocal.end}
              onChange={(v) => setDLocal((s) => ({ ...s, end: toDateOnly(v) }))}
            />
          </div>

          <div className="mt-4 flex gap-2">
            <button onClick={saveStep1} className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700">
              Save
            </button>
            <button onClick={() => { saveStep1(); goStep(2); }} className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700">
              Save & Next
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <Step2Milestones
          loading={loading}
          mLocal={mLocal}
          onLocalChange={onLocalChange}
          onAdd={addMilestone}
          milestones={milestones}
          onDelete={removeMilestone}
          totals={totals}
          onBack={() => goStep(1)}
          onNext={() => goStep(3)}
        />
      )}

      {step === 3 && (
        <div className="rounded-lg border bg-white p-4">
          {!!loading && <div className="text-sm text-gray-500 mb-3">Loading…</div>}

          {/* Warranty */}
          <div className="mb-4">
            <div className="text-sm font-medium mb-2">Warranty</div>
            <div className="flex items-center gap-2 mb-2">
              <input
                id="use_default_warranty"
                type="checkbox"
                checked={useDefaultWarranty}
                onChange={(e) => setUseDefaultWarranty(e.target.checked)}
              />
              <label htmlFor="use_default_warranty" className="text-sm">
                Use default 12-month workmanship warranty
              </label>
            </div>
            {!useDefaultWarranty && (
              <textarea
                className="w-full rounded border px-3 py-2 text-sm"
                rows={5}
                value={customWarranty}
                onChange={(e) => setCustomWarranty(e.target.value)}
                placeholder="Enter custom warranty terms…"
              />
            )}
            <div className="mt-2">
              <button onClick={saveWarranty} className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700">
                Save Warranty
              </button>
            </div>
          </div>

          {/* Attachments */}
          <div>
            <div className="text-sm font-medium mb-2">Attachments & Addenda</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <input
                type="text"
                className="w-full rounded border px-3 py-2 text-sm"
                placeholder="Title (e.g., Spec Sheet)"
                value={attForm.title}
                onChange={(e) => setAttForm((s) => ({ ...s, title: e.target.value }))}
              />
              <select
                className="w-full rounded border px-3 py-2 text-sm"
                value={attForm.category}
                onChange={(e) => setAttForm((s) => ({ ...s, category: e.target.value }))}
              >
                <option value="WARRANTY">WARRANTY</option>
                <option value="ADDENDUM">ADDENDUM</option>
                <option value="EXHIBIT">EXHIBIT</option>
                <option value="OTHER">OTHER</option>
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={attForm.visible}
                  onChange={(e) => setAttForm((s) => ({ ...s, visible: e.target.checked }))}
                />
                Visible to homeowner
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={attForm.require_ack}
                  onChange={(e) => setAttForm((s) => ({ ...s, require_ack: e.target.checked }))}
                />
                Require acknowledgement
              </label>
              <input
                type="file"
                onChange={(e) => setAttForm((s) => ({ ...s, file: e.target.files?.[0] || null }))}
                className="w-full text-sm"
              />
            </div>

            <button onClick={addAttachment} className="rounded bg-gray-800 px-3 py-2 text-sm text-white hover:bg-black">
              + Add Attachment
            </button>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">Visible</th>
                    <th className="px-3 py-2">Ack Required</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {attachments.map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="px-3 py-2">{(a.category || "").toUpperCase()}</td>
                      <td className="px-3 py-2">{a.title || a.filename || "—"}</td>
                      <td className="px-3 py-2">{a.visible ? "Yes" : "No"}</td>
                      <td className="px-3 py-2">{a.require_acknowledgement ? "Yes" : "No"}</td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => deleteAttachment(a.id)}
                          className="rounded bg-red-50 px-2 py-1 text-red-700 hover:bg-red-100"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!attachments.length && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                        No attachments yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex gap-2">
              <button onClick={() => goStep(2)} className="rounded bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200">
                Back
              </button>
              <button onClick={() => goStep(4)} className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700">
                Save & Next
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="rounded-lg border bg-white p-4">
          {!!loading && <div className="text-sm text-gray-500 mb-3">Loading…</div>}
          <div className="text-sm text-gray-600 mb-4">
            Agreement #{agreement?.id || id} — {agreement?.project_title || agreement?.title || "Project"}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <SummaryCard label="Total Amount" value={`$${totals.totalAmt.toFixed(2)}`} />
            <SummaryCard label="Total Days" value={String(totals.totalDays || 0)} />
            <SummaryCard label="Agreement Start" value={totals.minStart || "—"} />
            <SummaryCard label="Agreement End" value={totals.maxEnd || "—"} />
          </div>

          <div className="text-sm mb-2 font-medium">Milestones</div>
          <div className="overflow-x-auto mb-4">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {milestones.map((m, i) => {
                  const due = toDateOnly(m.completion_date || m.end_date || m.due_date || m.start_date || m.start);
                  return (
                    <tr key={m.id} className="border-t">
                      <td className="px-3 py-2">{i + 1}</td>
                      <td className="px-3 py-2">{m.title}</td>
                      <td className="px-3 py-2">{due || "—"}</td>
                      <td className="px-3 py-2">${Number(m.amount || 0).toFixed(2)}</td>
                      <td className="px-3 py-2">{m.status || "Pending"}</td>
                    </tr>
                  );
                })}
                {!milestones.length && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                      No milestones yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2">
            <button onClick={() => goStep(3)} className="rounded bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200">
              Back
            </button>
            <button
              onClick={() => window.open(`/projects/agreements/${id}/pdf/preview/`, "_blank")}
              className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
            >
              Preview PDF
            </button>
            <button
              onClick={() => window.open(`/agreements/public/${id}/`, "_blank")}
              className="rounded bg-gray-800 px-3 py-2 text-sm text-white hover:bg-black"
            >
              View Public Link
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Step 2 — Milestones (unchanged behavior, with inline calendar buttons) ---------------- */
function Step2Milestones({ loading, mLocal, onLocalChange, onAdd, milestones, onDelete, totals, onBack, onNext }) {
  const startRef = useRef(null);
  const endRef   = useRef(null);
  const openPicker = (ref) => {
    if (!ref?.current) return;
    if (typeof ref.current.showPicker === "function") ref.current.showPicker();
    else ref.current.focus();
  };

  return (
    <div className="rounded-lg border bg-white p-4">
      {!!loading && <div className="text-sm text-gray-500 mb-3">Loading…</div>}
      <div className="text-sm text-gray-600 mb-4">New Milestone</div>

      <div className="grid grid-cols-1 gap-3">
        <input
          type="text"
          name="title"
          value={mLocal.title}
          onChange={onLocalChange}
          className="w-full rounded border px-3 py-2 text-sm"
          placeholder="e.g., Install Floor Tile"
        />

        <textarea
          name="description"
          value={mLocal.description}
          onChange={onLocalChange}
          className="w-full rounded border px-3 py-2 text-sm"
          placeholder="Brief description of the milestone work…"
        />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input
            type="number"
            step="0.01"
            name="amount"
            value={mLocal.amount}
            onChange={onLocalChange}
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="Amount ($)"
          />

          <div className="grid grid-cols-2 gap-3">
            {/* Start */}
            <div style={{ position: "relative", overflow: "visible" }}>
              <input
                ref={startRef}
                type="date"
                name="start"
                value={mLocal.start || ""}
                onChange={onLocalChange}
                className="w-full rounded border px-3 py-2 text-sm"
                placeholder="Start date"
                style={{ paddingRight: "2.5rem" }}
              />
              <CalendarBtn title="Open start date" onClick={() => openPicker(startRef)} />
            </div>

            {/* End */}
            <div style={{ position: "relative", overflow: "visible" }}>
              <input
                ref={endRef}
                type="date"
                name="end"
                value={mLocal.end || ""}
                onChange={onLocalChange}
                className="w-full rounded border px-3 py-2 text-sm"
                placeholder="End date"
                style={{ paddingRight: "2.5rem" }}
              />
              <CalendarBtn title="Open end date" onClick={() => openPicker(endRef)} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[auto_1fr] gap-3 items-center">
          <div className="text-sm text-gray-600">Days (auto)</div>
          <div className="rounded border px-3 py-2 text-sm bg-gray-50">
            {mLocal.start && mLocal.end ? daySpan(mLocal.start, mLocal.end) : "—"}
          </div>
        </div>

        <div>
          <button onClick={onAdd} className="rounded bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700">
            + Add Milestone
          </button>
        </div>
      </div>

      {/* Existing milestones */}
      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Start</th>
              <th className="px-3 py-2">End</th>
              <th className="px-3 py-2">Days</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {milestones.map((m, i) => {
              const start = toDateOnly(m.start_date || m.start || m.scheduled_date);
              const end   = toDateOnly(m.completion_date || m.end_date || m.end || m.due_date);
              return (
                <tr key={m.id} className="border-t">
                  <td className="px-3 py-2">{i + 1}</td>
                  <td className="px-3 py-2">{m.title}</td>
                  <td className="px-3 py-2">{m.description}</td>
                  <td className="px-3 py-2">{start || "—"}</td>
                  <td className="px-3 py-2">{end || "—"}</td>
                  <td className="px-3 py-2">{start && end ? daySpan(start, end) : "—"}</td>
                  <td className="px-3 py-2">${Number(m.amount || 0).toFixed(2)}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => onDelete(m.id)} className="rounded bg-red-50 px-2 py-1 text-red-700 hover:bg-red-100">
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
            {!milestones.length && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-gray-500">
                  No milestones yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-4">
        <SummaryCard label="Total Amount" value={`$${totals.totalAmt.toFixed(2)}`} />
        <SummaryCard label="Total Days" value={String(totals.totalDays || 0)} />
        <SummaryCard label="Agreement Start" value={totals.minStart || "—"} />
        <SummaryCard label="Agreement End" value={totals.maxEnd || "—"} />
      </div>

      <div className="mt-6 flex gap-2">
        <button onClick={onBack} className="rounded bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200">
          Back
        </button>
        <button onClick={onNext} className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700">
          Save & Next
        </button>
      </div>
    </div>
  );
}

/* ------------- small helpers ------------- */
function DateWithButton({ label, value, onChange }) {
  const ref = useRef(null);
  const openPicker = () => {
    if (!ref.current) return;
    if (typeof ref.current.showPicker === "function") ref.current.showPicker();
    else ref.current.focus();
  };
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <div style={{ position: "relative", overflow: "visible" }}>
        <input
          ref={ref}
          type="date"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border px-3 py-2 text-sm"
          style={{ paddingRight: "2.5rem" }}
        />
        <CalendarBtn onClick={openPicker} title={`Open ${label} calendar`} />
      </div>
    </div>
  );
}
function SummaryCard({ label, value }) {
  return (
    <div className="rounded border bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
