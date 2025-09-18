// src/components/MilestoneList.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";
import MilestoneEditModal from "./MilestoneEditModal.jsx";
import { Check, Pencil, Trash2 } from "lucide-react";

console.log("MilestoneList.jsx v2025-09-17-edit-delete-fix");

const TABS = [
  { key: "all", label: "All" },
  { key: "incomplete", label: "Incomplete" },
  { key: "completed_not_invoiced", label: "Completed (Not Invoiced)" },
  { key: "invoiced", label: "Invoiced" },
  { key: "pending", label: "Pending Approval" },
  { key: "approved", label: "Approved" },
  { key: "disputed", label: "Disputed" },
];

export default function MilestoneList() {
  const [milestones, setMilestones] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null);

  // cache for on-demand agreement status lookups
  const statusCache = useRef(new Map());

  const load = async () => {
    try {
      setLoading(true);
      const [mRes, aRes] = await Promise.all([
        api.get("/projects/milestones/", { params: { page_size: 500 } }),
        api.get("/projects/agreements/", { params: { page_size: 500 } }),
      ]);

      const m = Array.isArray(mRes.data?.results)
        ? mRes.data.results
        : Array.isArray(mRes.data)
        ? mRes.data
        : [];

      const a = Array.isArray(aRes.data?.results)
        ? aRes.data.results
        : Array.isArray(aRes.data)
        ? aRes.data
        : [];

      setMilestones(m);
      setAgreements(a);

      // prime cache
      const map = statusCache.current;
      a.forEach((ag) => map.set(ag.id, String(ag.status || "").toLowerCase()));
    } catch (e) {
      console.error(e);
      toast.error("Failed to load milestones.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const agStatusById = useMemo(() => {
    const map = new Map(statusCache.current);
    agreements.forEach((a) => map.set(a.id, String(a.status || "").toLowerCase()));
    return map;
  }, [agreements]);

  // returns agreement status; if missing, fetch once and cache
  const getAgStatus = async (agreementId) => {
    const cached = statusCache.current.get(agreementId);
    if (cached) return cached;
    try {
      const { data } = await api.get(`/projects/agreements/${agreementId}/`);
      const status = String(data?.status || "").toLowerCase() || "draft";
      statusCache.current.set(agreementId, status);
      return status;
    } catch {
      // default to draft so UI remains usable if lookup fails
      statusCache.current.set(agreementId, "draft");
      return "draft";
    }
  };

  const canEditDeleteSync = (ms) => {
    // Prefer cached/preloaded status; if unknown, allow edit (assume draft).
    const agId = ms.agreement ?? ms.agreement_id;
    const s = agStatusById.get(agId);
    return s ? s === "draft" : true;
  };

  const filtered = useMemo(() => {
    const list = milestones
      .slice()
      .sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
    if (filter === "all") return list;
    if (filter === "incomplete") return list.filter((m) => !m.completed);
    if (filter === "completed_not_invoiced")
      return list.filter((m) => m.completed && !m.is_invoiced);
    if (filter === "invoiced") return list.filter((m) => m.is_invoiced);
    if (filter === "pending")
      return list.filter((m) =>
        String(m.status || "").toLowerCase().includes("pending")
      );
    if (filter === "approved")
      return list.filter((m) =>
        String(m.status || "").toLowerCase().includes("approved")
      );
    if (filter === "disputed")
      return list.filter((m) =>
        String(m.status || "").toLowerCase().includes("disputed")
      );
    return list;
  }, [milestones, filter]);

  const markComplete = async (ms) => {
    try {
      setBusy(ms.id);
      await api.patch(`/projects/milestones/${ms.id}/`, { completed: true });
      toast.success("Milestone marked complete.");
      await load();
    } catch (e) {
      console.error(e);
      toast.error("Could not mark complete.");
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async (ms) => {
    const agId = ms.agreement ?? ms.agreement_id;
    const status = await getAgStatus(agId);
    if (status !== "draft")
      return toast.error("You can only delete milestones while the agreement is in draft.");
    if (!confirm(`Delete milestone "${ms.title}"? This cannot be undone.`)) return;
    try {
      setBusy(ms.id);
      await api.delete(`/projects/milestones/${ms.id}/`);
      toast.success("Milestone deleted.");
      await load();
    } catch (e) {
      console.error(e);
      toast.error("Delete failed.");
    } finally {
      setBusy(null);
    }
  };

  const openEdit = async (ms) => {
    const agId = ms.agreement ?? ms.agreement_id;
    const status = await getAgStatus(agId);
    if (status !== "draft")
      return toast.error("You can only edit milestones while the agreement is in draft.");
    setEditing(ms);
    setEditOpen(true);
  };

  return (
    <div className="p-6 space-y-4">
      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`px-3 py-1.5 rounded-lg border ${
              filter === t.key ? "bg-blue-600 text-white" : "hover:bg-blue-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white shadow-sm overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-left border">Title</th>
              <th className="p-2 text-left border">Agreement #</th>
              <th className="p-2 text-left border">Customer</th>
              <th className="p-2 text-left border">Due / Date</th>
              <th className="p-2 text-right border">Amount</th>
              <th className="p-2 text-left border">Status</th>
              <th className="p-2 text-left border">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="p-3 border" colSpan={7}>
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td className="p-3 border text-gray-500" colSpan={7}>
                  No milestones found.
                </td>
              </tr>
            ) : (
              filtered.map((m) => {
                const agId = m.agreement ?? m.agreement_id;
                const draftNow = canEditDeleteSync(m);
                return (
                  <tr key={m.id} className="odd:bg-white even:bg-gray-50">
                    <td className="p-2 border">{m.title || "—"}</td>
                    <td className="p-2 border">{agId ?? "—"}</td>
                    <td className="p-2 border">
                      {m.customer_name || m.homeowner_name || "—"}
                    </td>
                    <td className="p-2 border">
                      {m.start_date || m.start || m.scheduled || "—"}
                    </td>
                    <td className="p-2 border text-right">
                      {typeof m.amount === "number"
                        ? `$${m.amount.toFixed(2)}`
                        : m.amount || "—"}
                    </td>
                    <td className="p-2 border">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          m.completed
                            ? "bg-green-100 text-green-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {m.completed ? "complete" : "incomplete"}
                      </span>
                    </td>
                    <td className="p-2 border">
                      <div className="flex flex-wrap items-center gap-2">
                        {!m.completed && (
                          <button
                            onClick={() => markComplete(m)}
                            disabled={busy === m.id}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border hover:bg-gray-50"
                            title="Mark Complete"
                          >
                            <Check size={14} />{" "}
                            {busy === m.id ? "Working…" : "Complete"}
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(m)}
                          disabled={!draftNow}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border ${
                            draftNow
                              ? "hover:bg-gray-50"
                              : "text-gray-400 cursor-not-allowed"
                          }`}
                          title="Edit (draft only)"
                        >
                          <Pencil size={14} /> Edit
                        </button>
                        <button
                          onClick={() => doDelete(m)}
                          disabled={!draftNow || busy === m.id}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg ${
                            draftNow
                              ? "border border-red-300 text-red-700 hover:bg-red-50"
                              : "border border-gray-300 text-gray-400 cursor-not-allowed"
                          }`}
                          title="Delete (draft only)"
                        >
                          <Trash2 size={14} />{" "}
                          {busy === m.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      <MilestoneEditModal
        milestone={editing}
        isOpen={editOpen}
        onClose={(changed) => {
          setEditOpen(false);
          setEditing(null);
          if (changed) load();
        }}
      />
    </div>
  );
}
