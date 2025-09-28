// src/components/MilestoneList.jsx
// v2025-09-25-a (edit wiring fixed; style unchanged)
// - Edit now opens the shared MilestoneEditModal and saves correctly
// - We enrich the modal's milestone with agreement_state/number/escrow
// - Complete flow remains as-is (photos + notes → Review)

import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";

// Use the SAME editor as Agreement Edit/List
import MilestoneEditModal from "./MilestoneEditModal";
// Keep the completion flow modal (files + comments → review)
import MilestoneDetailModal from "./MilestoneDetailModal";

/* ---------------- Utilities ---------------- */
const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== "") ?? "";

const money = (n) => {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  return Number.isFinite(v)
    ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : String(n);
};

const getAgreementId = (m) => m.agreement_id || m.agreement || (m.agreement && m.agreement.id);
const getAgreementStatus = (a) => (pick(a?.status, a?.agreement_status, a?.signature_status, a?.state) || "").toLowerCase();
const isAgreementDraft = (a) => getAgreementStatus(a) === "draft";
const isAgreementSigned = (a) => ["signed", "executed", "active", "approved"].includes(getAgreementStatus(a));
const isEscrowFunded = (a) => !!pick(a?.escrow_funded, a?.escrowFunded);

const getAgreementNumber = (m) => pick(m.agreement_number, m.agreement_no, m.agreement_id, m.agreement);
const getProjectTitle  = (m,a) => pick(m.project_title, a?.project_title);
const getHomeownerName = (m,a) => pick(m.homeowner_name, a?.homeowner_name);
const getDueDate       = (m)   => pick(m.due_date, m.scheduled_for, m.date_due, m.date, m.end_date, m.completion_date);
const getStatus        = (m)   => (pick(m.status_label, m.status, m.state, m.phase) || "").toLowerCase();
const getIsLate        = (m)   => !!pick(m.is_late, m.late, m.overdue);

const deriveRowStatus = (m,a) => {
  const ms = getStatus(m);
  if (ms === "approved" || ms === "completed") return "Complete";
  if (isAgreementDraft(a)) return "Draft";
  if (!isEscrowFunded(a)) return "Awaiting Funding";
  if (getIsLate(m)) return "Late";
  return "Scheduled/On-time";
};

/* ---------------- API endpoints (adjust if needed) ---------------- */
const API = {
  listMilestones: "/projects/milestones/",                         // GET
  listAgreements: "/projects/agreements/",                         // GET
  patchMilestone: (id) => `/projects/milestones/${id}/`,           // PATCH
  deleteMilestone: (id) => `/projects/milestones/${id}/`,          // DELETE
  completeAction: (id) => `/projects/milestones/${id}/complete/`,  // POST (multipart)
  uploadEvidence: (id) => `/projects/milestones/${id}/evidence/`,  // POST (multipart)
  toPendingApproval: (id) => `/projects/milestones/${id}/submit/`, // POST
};

export default function MilestoneList() {
  const [rows, setRows] = useState([]);
  const [agreementsMap, setAgreementsMap] = useState({});
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");

  const [busy, setBusy] = useState(new Set());

  // EDIT (Agreement-style) modal
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);

  // COMPLETE modal (photos + notes → review)
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeItem, setCompleteItem] = useState(null);

  const markBusy = (id, on = true) =>
    setBusy(prev => { const n = new Set(prev); on ? n.add(id) : n.delete(id); return n; });

  const updateLocal = (id, patch) =>
    setRows(list => list.map(m => (m.id === id ? { ...m, ...patch } : m)));

  /* ---------------- Load ---------------- */
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, aRes] = await Promise.all([
        api.get(API.listMilestones, { params: { page_size: 500, _ts: Date.now() } }),
        api.get(API.listAgreements, { params: { page_size: 500, _ts: Date.now() } }),
      ]);
      const mList = Array.isArray(mRes.data?.results) ? mRes.data.results : Array.isArray(mRes.data) ? mRes.data : [];
      const aList = Array.isArray(aRes.data?.results) ? aRes.data.results : Array.isArray(aRes.data) ? aRes.data : [];
      const map = {};
      for (const a of aList) {
        const id = a.id || a.agreement_id;
        if (id) map[id] = a;
      }
      setRows(mList);
      setAgreementsMap(map);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load milestones.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  /* ---------------- Filtering ---------------- */
  const tabs = [
    { key: "all", label: "All" },
    { key: "late", label: "Late" },
    { key: "incomplete", label: "Incomplete" },
    { key: "complete_not_invoiced", label: "Completed (Not Invoiced)" },
    { key: "invoiced", label: "Invoiced" },
    { key: "pending_approval", label: "Pending Approval" },
    { key: "approved", label: "Approved" },
    { key: "disputed", label: "Disputed" },
  ];

  const enriched = useMemo(() => rows.map(m => {
    const ag = agreementsMap[getAgreementId(m)] || {};
    return {
      ...m,
      _ag: ag,
      _escrowFunded: isEscrowFunded(ag),
      _agStatus: getAgreementStatus(ag),
      _derived: deriveRowStatus(m, ag),
      _agreementNumber: getAgreementNumber(m),
      _projectTitle: getProjectTitle(m, ag),
      _homeownerName: getHomeownerName(m, ag),
    };
  }), [rows, agreementsMap]);

  const filtered = useMemo(() => {
    let r = enriched;
    switch (tab) {
      case "late":               r = r.filter(m => getIsLate(m)); break;
      case "incomplete":         r = r.filter(m => getStatus(m) === "incomplete"); break;
      case "complete_not_invoiced": r = r.filter(m => getStatus(m) === "completed" && !m.invoiced); break;
      case "invoiced":           r = r.filter(m => !!m.invoiced); break;
      case "pending_approval":   r = r.filter(m => getStatus(m) === "pending_approval"); break;
      case "approved":           r = r.filter(m => getStatus(m) === "approved"); break;
      case "disputed":           r = r.filter(m => getStatus(m) === "disputed"); break;
      default: break;
    }
    const s = q.trim().toLowerCase();
    if (s) {
      r = r.filter(m =>
        [m.title, m._projectTitle, m._homeownerName, String(m._agreementNumber)]
          .filter(Boolean).join(" ").toLowerCase().includes(s)
      );
    }
    return r;
  }, [enriched, tab, q]);

  /* ---------------- Rules ---------------- */
  const canEditDelete = (m) => isAgreementDraft(m._ag);
  const canComplete   = (m) => isAgreementSigned(m._ag) && m._escrowFunded === true;

  /* ---------------- Actions: EDIT (agreement-style modal) ---------------- */
  const openEdit = (m) => {
    if (!canEditDelete(m)) { toast("Editing is only available while the agreement is in Draft."); return; }
    // Enrich with fields the shared modal expects for read-only banner + header
    const modalItem = {
      ...m,
      agreement_state: (m._ag?.state || m._ag?.status || "").toString(), // modal normalizes case internally
      agreement_status: (m._ag?.status || m._ag?.state || "").toString(),
      agreement_number: m._agreementNumber || m.agreement_number || m.agreement_id || m.agreement,
      escrow_funded: !!m._escrowFunded,
      escrowFunded: !!m._escrowFunded,
    };
    setEditItem(modalItem);
    setEditOpen(true);
  };

  // When the modal finishes saving on its side, reflect the change here
  const handleModalSaved = async (updated) => {
    if (updated?.id) updateLocal(updated.id, updated);
    await reload(); // ensure fresh derived flags/status
    setEditOpen(false);
    setEditItem(null);
    toast.success("Milestone updated.");
  };

  /* ---------------- Actions: DELETE ---------------- */
  const removeItem = async (m) => {
    if (!canEditDelete(m)) { toast("Delete is only available while the agreement is in Draft."); return; }
    if (!window.confirm(`Delete milestone "${m.title}" (Agreement #${m._agreementNumber || "?"})?`)) return;
    markBusy(m.id, true);
    const snapshot = rows;
    setRows(list => list.filter(x => x.id !== m.id)); // optimistic
    try {
      await api.delete(API.deleteMilestone(m.id));
      toast.success("Milestone deleted.");
    } catch (err) {
      console.error(err);
      setRows(snapshot);
      toast.error("Failed to delete milestone.");
    } finally {
      markBusy(m.id, false);
    }
  };

  /* ---------------- Actions: COMPLETE → open detail modal ---------------- */
  const openComplete = (m) => {
    if (!canComplete(m)) {
      if (isAgreementDraft(m._ag))      toast("You can’t complete a milestone until the agreement is signed.");
      else if (!m._escrowFunded)        toast("You can’t complete a milestone until escrow is funded.");
      else                               toast("Milestone cannot be completed right now.");
      return;
    }
    setCompleteItem(m);
    setCompleteOpen(true);
  };

  const submitComplete = async ({ id, notes, files }) => {
    markBusy(id, true);
    const prev = rows.find(r => r.id === id);
    updateLocal(id, { status: "completed" }); // optimistic
    try {
      // Prefer the dedicated action; fallback to evidence + submit
      try {
        const fd = new FormData();
        fd.append("notes", notes || "");
        (files || []).forEach((f, i) => fd.append("files", f, f.name || `evidence_${i}`));
        await api.post(API.completeAction(id), fd, { headers: { "Content-Type": "multipart/form-data" } });
      } catch {
        const fd = new FormData();
        fd.append("notes", notes || "");
        (files || []).forEach((f, i) => fd.append("files", f, f.name || `evidence_${i}`));
        await api.post(API.uploadEvidence(id), fd, { headers: { "Content-Type": "multipart/form-data" } });
        await api.post(API.toPendingApproval(id), {});
      }
      updateLocal(id, { status: "pending_approval" });
      toast.success("Submitted for review.");
      setCompleteOpen(false);
      setCompleteItem(null);
      await reload();
    } catch (err) {
      console.error(err);
      if (prev) updateLocal(id, { status: prev.status });
      toast.error("Could not submit completion.");
    } finally {
      markBusy(id, false);
    }
  };

  /* ---------------- UI ---------------- */
  return (
    <div className="p-4 md:p-6">
      {/* Tabs + Search */}
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex flex-wrap gap-2">
          {[
            { key: "all", label: "All" },
            { key: "late", label: "Late" },
            { key: "incomplete", label: "Incomplete" },
            { key: "complete_not_invoiced", label: "Completed (Not Invoiced)" },
            { key: "invoiced", label: "Invoiced" },
            { key: "pending_approval", label: "Pending Approval" },
            { key: "approved", label: "Approved" },
            { key: "disputed", label: "Disputed" },
          ].map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-1 rounded text-sm border ${
                tab === t.key ? "bg-white/80 text-gray-900 border-white/60 shadow"
                               : "bg-white/10 text-white/90 border-white/20 hover:bg-white/20"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, project, customer..."
            className="px-3 py-2 rounded border border-white/30 bg-white/90 text-gray-900 w-72"
          />
          <button
            type="button"
            onClick={() => reload()}
            className="px-3 py-2 rounded bg-white/80 text-gray-900 border border-white/60"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg overflow-hidden shadow border border-white/20 bg-white/70">
        <table className="min-w-full text-sm">
          <thead className="bg-white/60">
            <tr>
              <th className="text-left px-4 py-3">Title</th>
              <th className="text-left px-4 py-3">Agreement #</th>
              <th className="text-left px-4 py-3">Project</th>
              <th className="text-left px-4 py-3">Customer</th>
              <th className="text-left px-4 py-3">Due / Date</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-6 text-center text-gray-600" colSpan={8}>Loading milestones…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td className="px-4 py-6 text-center text-gray-600" colSpan={8}>No milestones found.</td></tr>
            ) : (
              filtered.map(m => {
                const label = m._derived;
                const raw   = getStatus(m);
                const allowED = canEditDelete(m);
                const allowComplete = canComplete(m);

                return (
                  <tr key={m.id} className="odd:bg-white/50 even:bg-white/30 hover:bg-white">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{m.title}</span>
                        {getIsLate(m) && <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">late</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">#{m._agreementNumber || "-"}</td>
                    <td className="px-4 py-3">{m._projectTitle || "—"}</td>
                    <td className="px-4 py-3">{m._homeownerName || "—"}</td>
                    <td className="px-4 py-3">{getDueDate(m) || "—"}</td>
                    <td className="px-4 py-3 text-right">{money(m.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        label==="Complete" ? "bg-green-100 text-green-700" :
                        label==="Awaiting Funding" ? "bg-yellow-100 text-yellow-700" :
                        label==="Draft" ? "bg-blue-100 text-blue-700" :
                        label==="Late" ? "bg-red-100 text-red-700" :
                        "bg-gray-100 text-gray-700"
                      }`}>{label}</span>
                      <span className="text-[11px] text-gray-500 ml-2">/ {raw || "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {/* COMPLETE */}
                        <button
                          type="button"
                          disabled={!allowComplete}
                          onClick={() => openComplete(m)}
                          className={`px-2 py-1 text-xs rounded-md border ${allowComplete ? "hover:bg-gray-100" : "opacity-50 cursor-not-allowed"}`}
                          title={allowComplete ? "Complete → Review" : "Requires signed agreement and funded escrow"}
                        >
                          ✓ Complete
                        </button>

                        {/* EDIT — Agreement-style modal */}
                        {allowED ? (
                          <button
                            type="button"
                            onClick={() => openEdit(m)}
                            className="px-2 py-1 text-xs rounded-md border hover:bg-gray-100"
                            title="Edit (Draft only)"
                          >
                            Edit
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">Edit (locked)</span>
                        )}

                        {/* DELETE */}
                        {allowED ? (
                          <button
                            type="button"
                            onClick={() => removeItem(m)}
                            className="px-2 py-1 text-xs rounded-md border border-rose-200 text-rose-600 hover:bg-rose-50"
                            title="Delete (Draft only)"
                          >
                            Delete
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">Delete (locked)</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* EDIT — SAME modal used by Agreement Edit/List */}
      {editOpen && editItem && (
        <MilestoneEditModal
          open={editOpen}
          onClose={() => { setEditOpen(false); setEditItem(null); }}
          milestone={editItem}
          // IMPORTANT: the shared modal calls `onSaved` (not `onSave`)
          onSaved={handleModalSaved}
          // optional: allow modal's "✓ Complete → Review" button to no-op here
          onMarkComplete={async () => {}}
        />
      )}

      {/* COMPLETE — photos + notes → review (no invoice here) */}
      {completeOpen && completeItem && (
        <MilestoneDetailModal
          open={completeOpen}
          milestone={completeItem}
          agreement={completeItem._ag}
          onClose={() => { setCompleteOpen(false); setCompleteItem(null); }}
          onSubmit={({ id, notes, files }) => submitComplete({ id, notes, files })}
        />
      )}
    </div>
  );
}
