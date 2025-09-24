// src/components/AgreementEdit.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";
import AttachmentSection from "./AttachmentSection";

console.log("AgreementEdit.jsx v2025-09-21-one-file-fix");

const DEFAULT_WARRANTY_TEXT =
  "Contractor warrants workmanship for one (1) year from substantial completion. Materials are covered by manufacturer warranties where applicable. Warranty excludes damage caused by misuse, neglect, unauthorized modifications, or normal wear. Remedy is limited to repair or replacement at Contractor’s discretion.";

const toISO = (v) => {
  if (!v) return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const mdy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return mdy ? `${mdy[3]}-${mdy[1]}-${mdy[2]}` : s;
};

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
function statusFromBooleans(m) {
  if (m.is_invoiced) return "invoiced";
  if (m.completed) return "complete";
  return "incomplete";
}
function booleansFromStatus(status) {
  switch ((status || "").toLowerCase()) {
    case "complete": return { completed: true,  is_invoiced: false };
    case "invoiced": return { completed: true,  is_invoiced: true  };
    default:         return { completed: false, is_invoiced: false };
  }
}

/* ---------------- Milestone Edit Modal ---------------- */
function MilestoneModal({ open, onClose, value, onSave }) {
  const [form, setForm] = useState({ ...value });
  useEffect(() => { setForm({ ...value }); }, [value]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[680px] max-w-[92vw] rounded-xl bg-white shadow-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold mb-3">Edit Milestone</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
            <input className="w-full rounded-md border border-slate-300 px-2 py-1"
              value={form.title || ""} onChange={(e)=>setForm(f=>({...f,title:e.target.value}))}/>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Start</label>
            <input type="date" className="w-full rounded-md border border-slate-300 px-2 py-1"
              value={form.start_date ? String(form.start_date).slice(0,10) : ""}
              onChange={(e)=>setForm(f=>({...f,start_date:e.target.value}))}/>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">End</label>
            <input type="date" className="w-full rounded-md border border-slate-300 px-2 py-1"
              value={form.end_date ? String(form.end_date).slice(0,10) : ""}
              onChange={(e)=>setForm(f=>({...f,end_date:e.target.value}))}/>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Amount ($)</label>
            <input type="number" min="0" step="0.01"
              className="w-full rounded-md border border-slate-300 px-2 py-1"
              value={form.amount ?? 0}
              onChange={(e)=>setForm(f=>({...f,amount:Number(e.target.value||0)}))}/>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
            <select className="w-full rounded-md border border-slate-300 px-2 py-1"
              value={form.status || "incomplete"}
              onChange={(e)=>setForm(f=>({...f,status:e.target.value}))}>
              <option value="incomplete">Incomplete</option>
              <option value="complete">Completed</option>
              <option value="invoiced">Invoiced</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Description of Work</label>
            <textarea rows={4} className="w-full rounded-md border border-slate-300 px-2 py-1"
              value={form.description || ""} onChange={(e)=>setForm(f=>({...f,description:e.target.value}))}/>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="px-3 py-2 text-xs rounded-md border border-slate-300" onClick={onClose}>Cancel</button>
          <button className="px-3 py-2 text-xs rounded-md bg-blue-600 text-white"
            onClick={()=>onSave(form)}>Save</button>
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
  const originalAgreementRef = useRef(null);

  const [milestones, setMilestones] = useState([]);
  const originalMilestonesRef = useRef([]);

  // modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalIndex, setModalIndex] = useState(-1);

  const typeOptions = ["Bathroom", "Kitchen", "Exterior", "General"];
  const subtypeOptions = ["Remodel", "Repair", "Install", "Other"];
  const defaultWarrantyPreview = useMemo(() => DEFAULT_WARRANTY_TEXT, []);

  useEffect(() => {
    let mounted = true;
    async function loadAll() {
      setLoading(true);
      try {
        const [aRes, mRes] = await Promise.all([
          api.get(`/projects/agreements/${id}/`),
          api.get(`/projects/agreements/${id}/milestones/`),
        ]);

        const a = aRes.data || {};
        const msRaw = Array.isArray(mRes.data) ? mRes.data : (mRes.data?.results || []);

        const warrantyMode = (a.warranty_type || "").toLowerCase() === "custom" ||
                             (a.warranty_text_snapshot && a.warranty_text_snapshot.trim().length > 0)
                               ? "custom" : "default";

        const nextForm = {
          title: a.title ?? a.project_title ?? "",
          description: a.description ?? "",
          project_type: a.project_type ?? "",
          project_subtype: a.project_subtype ?? "",
          warranty_mode: warrantyMode,
          warranty_text: a.warranty_text_snapshot ?? "",
        };

        const nextMilestones = (msRaw || []).map((m, idx) => {
          const s = m.start_date || m.scheduled_date || "";
          // accept either completion_date or end_date from API
          const e = m.completion_date || m.end_date || "";
          return {
            id: m.id,
            title: m.title ?? "",
            start_date: toISO(s),
            end_date:   toISO(e),
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
    return () => { mounted = false; };
  }, [id]);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };
  const onWarrantyModeChange = (mode) => setForm((f) => ({ ...f, warranty_mode: mode }));

  const addMilestone = () => setMilestones(rows => [
    ...rows, {
      title: "",
      start_date: toISO(new Date().toISOString().slice(0,10)),
      end_date:   toISO(new Date().toISOString().slice(0,10)),
      amount: 0,
      description: "",
      status: "incomplete",
      order: (rows[rows.length - 1]?.order || rows.length) + 1,
    }
  ]);
  const updateMilestone = (i, field, value) => {
    setMilestones(rows => {
      const next = deepClone(rows);
      next[i][field] = field === "amount" ? Number(value || 0) : value;
      return next;
    });
  };
  const removeMilestone = (i) => setMilestones(rows => rows.filter((_, idx) => idx !== i));

  function buildMilestonesPayload(list) {
    return {
      items: list.map((m) => {
        const start = toISO(m.start_date) || null;
        const end   = toISO(m.end_date) || null;
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
        // send BOTH keys so backend (old/new) accepts it
        if (end) {
          payload.completion_date = end; // new
          payload.end_date = end;        // legacy alias
        }
        return payload;
      }),
      prune_missing: true,
    };
  }

  async function saveAgreementAndMilestones() {
    setSaving(true);
    try {
      const orig = originalAgreementRef.current || {};
      const changed = {};
      if ((form.title ?? "") !== (orig.title ?? "")) changed.title = form.title;

      // send BOTH description and job_description so backend accepts either
      if ((form.description ?? "") !== (orig.description ?? "")) {
        changed.description = form.description;
        changed.job_description = form.description; // legacy alias
      }

      if ((form.project_type ?? "") !== (orig.project_type ?? "")) changed.project_type = form.project_type;
      if ((form.project_subtype ?? "") !== (orig.project_subtype ?? "")) changed.project_subtype = form.project_subtype;

      // warranty: send both the new fields AND the legacy flags
      if (form.warranty_mode === "default") {
        changed.warranty_type = "default";
        changed.warranty_text_snapshot = "";
        changed.use_default_warranty = true;       // legacy alias
        changed.custom_warranty_text = "";         // legacy alias
      } else {
        changed.warranty_type = "custom";
        changed.warranty_text_snapshot = form.warranty_text || DEFAULT_WARRANTY_TEXT;
        changed.use_default_warranty = false;      // legacy alias
        changed.custom_warranty_text = changed.warranty_text_snapshot;
      }

      if (Object.keys(changed).length > 0) {
        await api.patch(
          `/projects/agreements/${id}/`,
          changed,
          { headers: { "Content-Type": "application/json", "Accept": "application/json" } }
        );
      }

      const payload = buildMilestonesPayload(milestones);
      const r = await api.post(
        `/projects/agreements/${id}/milestones_bulk_update/`,
        payload,
        { headers: { "Content-Type": "application/json", "Accept": "application/json" } }
      );

      const ms = Array.isArray(r.data) ? r.data : (r.data?.results || []);
      const next = (ms || []).map((m, idx) => {
        const s = m.start_date || m.scheduled_date || "";
        const e = m.completion_date || m.end_date || "";
        return {
          id: m.id,
          title: m.title ?? "",
          start_date: toISO(s),
          end_date:   toISO(e),
          amount: Number(m.amount ?? 0),
          description: m.description ?? "",
          status: statusFromBooleans(m),
          order: m.order ?? idx + 1,
        };
      });
      setMilestones(next);
      originalMilestonesRef.current = deepClone(next);

      toast.success("Agreement & milestones saved.");
    } catch (err) {
      console.error(err);
      toast.error("Save failed. Check console/network.");
    } finally {
      setSaving(false);
    }
  }

  const [modalOpenS, setModalOpenS] = useState(false);
  const [modalIdx, setModalIdx] = useState(-1);
  const openModal = (i) => { setModalIdx(i); setModalOpenS(true); };
  const closeModal = () => setModalOpenS(false);
  const saveModal = (updated) => {
    if (modalIdx < 0) return closeModal();
    ["title","start_date","end_date","amount","status","description"].forEach(k =>
      updateMilestone(modalIdx, k, k.includes("date") ? toISO(updated[k]) : updated[k])
    );
    setModalOpenS(false);
  };

  if (loading) {
    return <div className="p-6"><div className="animate-pulse text-sm text-slate-500">Loading agreement…</div></div>;
  }

  return (
    <div className="px-4 sm:px-6 md:px-10 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Edit Agreement</h1>
          <p className="text-xs text-slate-500">Agreement #{id}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={saving} onClick={saveAgreementAndMilestones}
            className="px-4 py-2 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Agreement Details */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
        <h2 className="text-sm font-semibold mb-4">Agreement Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
            <input className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              name="title" value={form.title} onChange={onChange} placeholder="e.g., Bathroom Remodel"/>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Project Type</label>
            <select className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              name="project_type" value={form.project_type} onChange={onChange}>
              <option value="">Select a type…</option>
              {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Job Description</label>
            <textarea rows={4} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              name="description" value={form.description} onChange={onChange}
              placeholder="Scope of work, materials, exclusions…"/>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Project Subtype</label>
            <select className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              name="project_subtype" value={form.project_subtype} onChange={onChange}>
              <option value="">Select a subtype…</option>
              {subtypeOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Warranty */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
        <h2 className="text-sm font-semibold mb-3">Warranty</h2>
        <div className="flex items-center gap-6 mb-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" className="accent-blue-600"
              checked={form.warranty_mode==="default"} onChange={()=>onWarrantyModeChange("default")}/>
            Use default warranty
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" className="accent-blue-600"
              checked={form.warranty_mode==="custom"} onChange={()=>onWarrantyModeChange("custom")}/>
            Provide custom warranty
          </label>
        </div>
        {form.warranty_mode==="default" ? (
          <>
            <label className="block text-xs font-medium text-slate-600 mb-1">Default Warranty (read-only preview)</label>
            <textarea value={defaultWarrantyPreview} readOnly rows={4}
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"/>
          </>
        ) : (
          <>
            <label className="block text-xs font-medium text-slate-600 mb-1">Custom Warranty</label>
            <textarea rows={5} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              name="warranty_text" value={form.warranty_text || DEFAULT_WARRANTY_TEXT} onChange={onChange}/>
          </>
        )}
      </div>

      {/* Attachments */}
      <AttachmentSection agreementId={id} />

      {/* Milestones */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Milestones</h2>
          <button type="button" onClick={addMilestone}
            className="px-3 py-2 text-xs rounded-md border border-slate-300 hover:bg-slate-50">
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
                      <input className="w-full rounded-md border border-slate-300 px-2 py-1"
                        value={m.title} onChange={(e)=>updateMilestone(idx,"title",e.target.value)} />
                    </td>
                    <td className="py-2 pr-3 align-top">
                      <input type="date" className="rounded-md border border-slate-300 px-2 py-1"
                        value={m.start_date ? String(m.start_date).slice(0,10) : ""}
                        onChange={(e)=>updateMilestone(idx,"start_date",toISO(e.target.value))} />
                    </td>
                    <td className="py-2 pr-3 align-top">
                      <input type="date" className="rounded-md border border-slate-300 px-2 py-1"
                        value={m.end_date ? String(m.end_date).slice(0,10) : ""}
                        onChange={(e)=>updateMilestone(idx,"end_date",toISO(e.target.value))} />
                    </td>
                    <td className="py-2 pr-3 align-top w-32">
                      <input type="number" min="0" step="0.01"
                        className="w-full rounded-md border border-slate-300 px-2 py-1"
                        value={m.amount} onChange={(e)=>updateMilestone(idx,"amount",e.target.value)} />
                    </td>
                    <td className="py-2 pr-3 align-top w-48">
                      <select className="w-full rounded-md border border-slate-300 px-2 py-1"
                        value={m.status} onChange={(e)=>updateMilestone(idx,"status",e.target.value)}>
                        <option value="incomplete">Incomplete</option>
                        <option value="complete">Completed</option>
                        <option value="invoiced">Invoiced</option>
                      </select>
                    </td>
                    <td className="py-2 pr-3 align-top text-right">
                      <div className="flex gap-2 justify-end">
                        <button className="px-2 py-1 text-xs rounded-md border border-slate-300"
                          onClick={()=>{ setModalIndex(idx); setModalOpen(true); }}>
                          Edit
                        </button>
                        <button className="px-2 py-1 text-xs rounded-md border border-rose-200 text-rose-600"
                          onClick={()=>removeMilestone(idx)}>
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button type="button" disabled={saving} onClick={saveAgreementAndMilestones}
            className="px-4 py-2 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Review & Sign */}
      <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <h2 className="text-sm font-semibold mb-3">Review &amp; Sign</h2>
        <p className="text-xs text-slate-600 mb-2">
          Generate a preview, send to the homeowner for review, or sign as the contractor.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="px-3 py-2 text-xs rounded-md border border-slate-300"
            onClick={async ()=>{
              try { await api.get(`/projects/signing/agreements/${id}/preview/`); toast.success("Preview queued."); }
              catch(e){ toast.error("Preview failed."); }
            }}>
            Generate Preview
          </button>
          <button className="px-3 py-2 text-xs rounded-md border border-slate-300"
            onClick={()=>toast("Open your signature flow (homeowner).")}>
            Send to Homeowner for Review/Signature
          </button>
          <button className="px-3 py-2 text-xs rounded-md bg-emerald-600 text-white"
            onClick={()=>toast("Open your signature flow (contractor).")}>
            Sign as Contractor
          </button>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between text-xs text-slate-500">
        <Link className="hover:underline" to="/agreements">← Back to Agreements</Link>
        <button type="button" onClick={() => navigate("/dashboard")} className="hover:underline">Go to Dashboard →</button>
      </div>

      <MilestoneModal
        open={modalOpen}
        onClose={()=>setModalOpen(false)}
        value={milestones[modalIndex] || {}}
        onSave={saveModal}
      />
    </div>
  );
}
