// src/components/MilestoneList.jsx
// v2025-12-29b — Enable Complete → Review when Agreement status is FUNDED
// - Fixes eligibility logic: funded/in_progress agreements should allow completion
// - Uses POST /projects/milestones/:id/complete-to-review/
// - Keeps evidence upload behavior
// - Keeps invoice creation flow

import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";

import MilestoneEditModal from "./MilestoneEditModal";
import MilestoneDetailModal from "./MilestoneDetailModal";

/* ---------------- Utilities ---------------- */
const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "") ?? "";

const money = (n) => {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  return Number.isFinite(v)
    ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : String(n);
};

const toDateOnly = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const getAgreementId = (m) => m.agreement_id || m.agreement || (m.agreement && m.agreement.id);
const getAgreementStatus = (a) =>
  (pick(a?.status, a?.agreement_status, a?.signature_status, a?.state) || "").toLowerCase();
const isAgreementDraft = (a) => getAgreementStatus(a) === "draft";

// ✅ FIX: include funded (and common post-sign states) as eligible for completion
const isAgreementSigned = (a) =>
  ["signed", "executed", "active", "approved", "funded", "in_progress"].includes(getAgreementStatus(a));

const isEscrowFunded = (a) => !!pick(a?.escrow_funded, a?.escrowFunded);

const getAgreementNumber = (m) => pick(m.agreement_number, m.agreement_no, m.agreement_id, m.agreement);
const getProjectTitle = (m, a) => pick(m.project_title, a?.project_title);
const getHomeownerName = (m, a) => pick(m.homeowner_name, a?.homeowner_name);

const getDueDateRaw = (m) =>
  pick(m.due_date, m.scheduled_for, m.date_due, m.date, m.end_date, m.completion_date);

const computeIsLate = (m) => {
  if (m.completed === true) return false;
  const due = toDateOnly(getDueDateRaw(m));
  if (!due) return false;
  return due < startOfToday();
};

const deriveMilestonePhaseLabel = (m) => {
  const completed = m.completed === true;
  const invoiced = m.is_invoiced === true;

  if (!completed) return "Incomplete";
  if (completed && !invoiced) return "Completed (Not Invoiced)";
  return "Invoiced";
};

/* ---------------- API base ---------------- */
const API = {
  listMilestones: "/projects/milestones/",
  listAgreements: "/projects/agreements/",
  deleteMilestone: (id) => `/projects/milestones/${id}/`,
  milestoneFiles: "/projects/milestone-files/",
  milestoneComments: (id) => `/projects/milestones/${id}/comments/`,
  createInvoice: (id) => `/projects/milestones/${id}/create-invoice/`,
  completeToReview: (id) => `/projects/milestones/${id}/complete-to-review/`,
};

export default function MilestoneList() {
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [agreementsMap, setAgreementsMap] = useState({});
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");

  const [busy, setBusy] = useState(new Set());

  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState(null);

  const markBusy = (id, on = true) =>
    setBusy((prev) => {
      const n = new Set(prev);
      on ? n.add(id) : n.delete(id);
      return n;
    });

  const updateLocal = (id, patch) =>
    setRows((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  /* ---------------- Load ---------------- */
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, aRes] = await Promise.all([
        api.get(API.listMilestones, { params: { page_size: 500, _ts: Date.now() } }),
        api.get(API.listAgreements, { params: { page_size: 500, _ts: Date.now() } }),
      ]);

      const mList = Array.isArray(mRes.data?.results)
        ? mRes.data.results
        : Array.isArray(mRes.data)
        ? mRes.data
        : [];
      const aList = Array.isArray(aRes.data?.results)
        ? aRes.data.results
        : Array.isArray(aRes.data)
        ? aRes.data
        : [];

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

  useEffect(() => {
    reload();
  }, [reload]);

  /* ---------------- Enrich + Filter ---------------- */
  const enriched = useMemo(() => {
    return rows.map((m) => {
      const ag = agreementsMap[getAgreementId(m)] || {};
      const late = computeIsLate(m);
      const phaseLabel = deriveMilestonePhaseLabel(m);

      return {
        ...m,
        _ag: ag,
        _escrowFunded: isEscrowFunded(ag),
        _agStatus: getAgreementStatus(ag),
        _agreementNumber: getAgreementNumber(m),
        _projectTitle: getProjectTitle(m, ag),
        _homeownerName: getHomeownerName(m, ag),
        _dueRaw: getDueDateRaw(m),
        _late: late,
        _phaseLabel: phaseLabel,
      };
    });
  }, [rows, agreementsMap]);

  const filtered = useMemo(() => {
    let r = enriched;

    switch (tab) {
      case "late":
        r = r.filter((m) => m._late);
        break;
      case "incomplete":
        r = r.filter((m) => m._phaseLabel === "Incomplete");
        break;
      case "complete_not_invoiced":
        r = r.filter((m) => m._phaseLabel === "Completed (Not Invoiced)");
        break;
      case "invoiced":
        r = r.filter((m) => m._phaseLabel === "Invoiced");
        break;
      default:
        break;
    }

    const s = q.trim().toLowerCase();
    if (s) {
      r = r.filter((m) =>
        [m.title, m._projectTitle, m._homeownerName, String(m._agreementNumber)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(s)
      );
    }

    return r;
  }, [enriched, tab, q]);

  /* ---------------- Rules ---------------- */
  const canEditDelete = (m) => isAgreementDraft(m._ag);

  const canComplete = (m) => {
    // ✅ Now funded agreements are eligible
    if (!(isAgreementSigned(m._ag) && m._escrowFunded === true)) return false;
    if (m.completed === true) return false;
    if (m.is_invoiced === true) return false;
    return true;
  };

  const isCompletedNotInvoiced = (m) => m.completed === true && m.is_invoiced !== true;

  /* ---------------- Actions ---------------- */
  const openView = (m) => {
    setDetailItem(m);
    setDetailOpen(true);
  };

  const openEdit = (m) => {
    if (!canEditDelete(m)) {
      toast("Editing is only available while the agreement is in Draft.");
      return;
    }
    setEditItem(m);
    setEditOpen(true);
  };

  const handleModalSaved = async (updated) => {
    if (updated?.id) updateLocal(updated.id, updated);
    await reload();
    setEditOpen(false);
    setEditItem(null);
    toast.success("Milestone updated.");
  };

  const removeItem = async (m) => {
    if (!canEditDelete(m)) {
      toast("Delete is only available while the agreement is in Draft.");
      return;
    }
    if (!window.confirm(`Delete milestone "${m.title}" (Agreement #${m._agreementNumber || "?"})?`)) return;

    markBusy(m.id, true);
    const snapshot = rows;
    setRows((list) => list.filter((x) => x.id !== m.id));

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

  const openComplete = (m) => {
    if (!canComplete(m)) {
      toast("This milestone is not eligible to complete right now.");
      return;
    }
    setDetailItem(m);
    setDetailOpen(true);
  };

  const uploadEvidenceFiles = async (milestoneId, files) => {
    if (!files?.length) return;

    for (const f of files) {
      const fd = new FormData();
      fd.append("milestone", milestoneId);
      fd.append("file", f, f.name);

      await api.post(API.milestoneFiles, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
    }
  };

  const submitComplete = async ({ id, notes, files }) => {
    if (!id) return;

    markBusy(id, true);

    try {
      await uploadEvidenceFiles(id, files || []);

      await api.post(API.completeToReview(id), {
        completion_notes: notes || "",
      });

      toast.success("Milestone submitted for review.");

      setDetailOpen(false);
      setDetailItem(null);

      await reload();
    } catch (err) {
      console.error(err);
      const msg = err?.response?.data?.detail || "Could not submit milestone for review.";
      toast.error(msg);
      await reload();
    } finally {
      markBusy(id, false);
    }
  };

  const createInvoiceAndGo = async (m) => {
    const milestoneId = m?.id;
    if (!milestoneId) return;

    markBusy(milestoneId, true);
    try {
      const { data } = await api.post(API.createInvoice(milestoneId));

      const invoiceId =
        data?.id ||
        data?.invoice_id ||
        data?.pk ||
        m?.invoice ||
        m?.invoice_id ||
        null;

      toast.success("Invoice created.");
      await reload();

      if (invoiceId) {
        navigate(`/app/invoices/${invoiceId}`);
      } else {
        toast.error("Invoice created but no invoice id returned.");
        navigate(`/app/invoices`);
      }
    } catch (e) {
      console.error(e);
      const msg = e?.response?.data?.detail || "Unable to create invoice for this milestone.";
      toast.error(msg);
    } finally {
      markBusy(milestoneId, false);
    }
  };

  /* ---------------- UI ---------------- */
  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex flex-wrap gap-2">
          {[
            { key: "all", label: "All" },
            { key: "late", label: "Late" },
            { key: "incomplete", label: "Incomplete" },
            { key: "complete_not_invoiced", label: "Completed (Not Invoiced)" },
            { key: "invoiced", label: "Invoiced" },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-1 rounded text-sm border ${
                tab === t.key
                  ? "bg-white/80 text-gray-900 border-white/60 shadow"
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
            placeholder="Search title, project, customer."
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
              <tr>
                <td className="px-4 py-6 text-center text-gray-600" colSpan={8}>
                  Loading milestones…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-gray-600" colSpan={8}>
                  No milestones found.
                </td>
              </tr>
            ) : (
              filtered.map((m) => {
                const allowED = canEditDelete(m);
                const allowComplete = canComplete(m);
                const isRowBusy = busy.has(m.id);

                const statusPill = m._late ? "Late" : m._phaseLabel;

                return (
                  <tr
                    key={m.id}
                    className={`odd:bg-white/50 even:bg-white/30 hover:bg-white cursor-pointer ${
                      isRowBusy ? "opacity-70" : ""
                    }`}
                    title="Click to view milestone details"
                    onClick={() => openView(m)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{m.title}</span>
                        {m._late && (
                          <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">late</span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3">#{m._agreementNumber || "-"}</td>
                    <td className="px-4 py-3">{m._projectTitle || "—"}</td>
                    <td className="px-4 py-3">{m._homeownerName || "—"}</td>
                    <td className="px-4 py-3">{m._dueRaw || "—"}</td>
                    <td className="px-4 py-3 text-right">{money(m.amount)}</td>

                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          statusPill === "Late"
                            ? "bg-red-100 text-red-700"
                            : statusPill === "Completed (Not Invoiced)"
                            ? "bg-emerald-100 text-emerald-700"
                            : statusPill === "Invoiced"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {statusPill}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openView(m);
                          }}
                          className="px-3 py-2 text-xs rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold"
                        >
                          View
                        </button>

                        {allowComplete ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openComplete(m);
                            }}
                            className="px-3 py-2 text-xs rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-semibold"
                            title="Complete → Review"
                          >
                            ✓ Complete
                          </button>
                        ) : isCompletedNotInvoiced(m) ? (
                          <>
                            <button
                              type="button"
                              disabled
                              className="px-3 py-2 text-xs rounded-md border border-gray-200 bg-gray-100 text-gray-500 font-semibold cursor-default"
                              title="Already completed"
                            >
                              ✓ Completed
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                createInvoiceAndGo(m);
                              }}
                              className="px-3 py-2 text-xs rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-semibold"
                              title="Create invoice for this completed milestone"
                            >
                              Invoice
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="px-3 py-2 text-xs rounded-md border border-gray-200 bg-gray-100 text-gray-400 font-semibold cursor-not-allowed"
                            title="Not eligible to complete"
                          >
                            ✓ Complete
                          </button>
                        )}

                        {allowED ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(m);
                            }}
                            className="px-3 py-2 text-xs rounded-md border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 font-semibold"
                          >
                            Edit
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400 self-center">Edit (locked)</span>
                        )}

                        {allowED ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeItem(m);
                            }}
                            className="px-3 py-2 text-xs rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 font-semibold"
                          >
                            Delete
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400 self-center">Delete (locked)</span>
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

      {editOpen && editItem && (
        <MilestoneEditModal
          open={editOpen}
          onClose={() => {
            setEditOpen(false);
            setEditItem(null);
          }}
          milestone={editItem}
          onSaved={handleModalSaved}
          onMarkComplete={async (milestoneId) => submitComplete({ id: milestoneId, notes: "", files: [] })}
        />
      )}

      {detailOpen && detailItem && (
        <MilestoneDetailModal
          open={detailOpen}
          milestone={detailItem}
          agreement={detailItem._ag}
          onClose={() => {
            setDetailOpen(false);
            setDetailItem(null);
          }}
          onSubmit={({ id, notes, files }) => submitComplete({ id, notes, files })}
        />
      )}
    </div>
  );
}
