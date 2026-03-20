// frontend/src/components/ExpenseRequestsPanel.jsx
// v2026-02-19 — Dashboard panel upgrade:
// - Filter by Agreement
// - Attachments (upload + view)
// - Send/Resend Email action buttons
// - Keeps using listExpenses() so it matches your existing API module
// NOTE: This is for the Dashboard panel. You can later remove it from ContractorDashboard
// once you're happy with the full Expenses sidebar page.

import React, { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";
import { listExpenses } from "../api/expenses";

export default function ExpenseRequestsPanel() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [agreementFilter, setAgreementFilter] = useState("");

  // Attachments modal state
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentsExpense, setAttachmentsExpense] = useState(null);
  const [attachmentsList, setAttachmentsList] = useState([]);

  const load = async () => {
    try {
      setLoading(true);
      const data = await listExpenses();
      const list = Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data)
        ? data
        : [];
      setRows(list);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load expenses.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agreementsInRows = useMemo(() => {
    const set = new Set();
    (rows || []).forEach((r) => {
      const a = r.agreement || r.agreement_id;
      if (a !== null && a !== undefined && String(a).trim() !== "") set.add(String(a));
    });
    return Array.from(set).sort((a, b) => Number(a) - Number(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const sel = String(agreementFilter || "");
    if (!sel) return rows || [];
    return (rows || []).filter((r) => String(r.agreement || r.agreement_id || "") === sel);
  }, [rows, agreementFilter]);

  const money = (n) => {
    const v = Number(n);
    return Number.isFinite(v) ? `$${v.toFixed(2)}` : n ?? "—";
  };

  const statusBadge = (s) => {
    const base = "px-2 py-0.5 rounded text-xs font-semibold border";
    const val = String(s || "").toLowerCase();

    // your prior mappings + "sent" support
    if (val === "draft") return <span className={`${base} bg-gray-100 text-gray-800 border-gray-200`}>Draft</span>;
    if (val === "contractor_signed") return <span className={`${base} bg-indigo-50 text-indigo-800 border-indigo-200`}>Signed</span>;
    if (val === "pending") return <span className={`${base} bg-amber-50 text-amber-800 border-amber-200`}>Sent</span>;
    if (val === "sent") return <span className={`${base} bg-amber-50 text-amber-800 border-amber-200`}>Sent</span>;
    if (val === "approved") return <span className={`${base} bg-green-50 text-green-800 border-green-200`}>Accepted</span>;
    if (val === "rejected") return <span className={`${base} bg-red-50 text-red-800 border-red-200`}>Rejected</span>;
    if (val === "paid") return <span className={`${base} bg-emerald-50 text-emerald-900 border-emerald-200`}>Paid</span>;
    if (val === "disputed") return <span className={`${base} bg-red-50 text-red-800 border-red-200`}>Disputed</span>;

    return <span className={`${base} bg-gray-50 text-gray-800 border-gray-200`}>{s || "—"}</span>;
  };

  async function tryGet(urls) {
    let lastErr = null;
    for (const u of urls) {
      try {
        const res = await api.get(u);
        return { ok: true, url: u, data: res.data };
      } catch (e) {
        lastErr = e;
      }
    }
    return { ok: false, err: lastErr };
  }

  async function tryPost(urls, payload, config) {
    let lastErr = null;
    for (const u of urls) {
      try {
        const res = await api.post(u, payload, config);
        return { ok: true, url: u, data: res.data };
      } catch (e) {
        lastErr = e;
      }
    }
    return { ok: false, err: lastErr };
  }

  // --- attachments + email ---
  const fetchAttachments = async (expenseId) => {
    const res = await tryGet([
      `/projects/expenses/${expenseId}/attachments/`,
      `/expenses/${expenseId}/attachments/`,
      `/projects/expense-requests/${expenseId}/attachments/`,
    ]);
    if (!res.ok) throw res.err;

    const arr = Array.isArray(res.data)
      ? res.data
      : res.data?.results || res.data?.attachments || [];
    return arr;
  };

  const uploadAttachments = async (expenseId, files) => {
    if (!files || !files.length) return;
    const fd = new FormData();
    // support multiple backends:
    for (const f of files) fd.append("files", f);
    for (const f of files) fd.append("file", f);

    const res = await tryPost(
      [
        `/projects/expenses/${expenseId}/attachments/`,
        `/expenses/${expenseId}/attachments/`,
        `/projects/expense-requests/${expenseId}/attachments/`,
      ],
      fd,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
    if (!res.ok) throw res.err;
  };

  const sendExpenseEmail = async (expenseId, message) => {
    const res = await tryPost(
      [
        `/projects/expenses/${expenseId}/send_email/`,
        `/expenses/${expenseId}/send_email/`,
        `/projects/expense-requests/${expenseId}/send_email/`,
      ],
      { message: message || "" }
    );
    if (!res.ok) throw res.err;
  };

  const openAttachmentsModal = async (expense) => {
    setAttachmentsExpense(expense);
    setAttachmentsList([]);
    setAttachmentsOpen(true);
    setAttachmentsLoading(true);
    try {
      const arr = await fetchAttachments(expense.id);
      setAttachmentsList(arr);
    } catch (e) {
      console.error(e);
      toast.error("Could not load attachments.");
      setAttachmentsList([]);
    } finally {
      setAttachmentsLoading(false);
    }
  };

  const closeAttachmentsModal = () => {
    setAttachmentsOpen(false);
    setAttachmentsExpense(null);
    setAttachmentsList([]);
    setAttachmentsLoading(false);
  };

  const handleRowUpload = async (expenseId, event) => {
    const picked = Array.from(event.target.files || []);
    if (!picked.length) return;

    try {
      await uploadAttachments(expenseId, picked);
      toast.success("Attachment(s) uploaded.");
      await load();
      // If modal is open for this expense, refresh modal list too
      if (attachmentsOpen && attachmentsExpense?.id === expenseId) {
        setAttachmentsLoading(true);
        const arr = await fetchAttachments(expenseId);
        setAttachmentsList(arr);
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to upload attachments.");
    } finally {
      setAttachmentsLoading(false);
      event.target.value = "";
    }
  };

  const handleSendEmail = async (expense) => {
    try {
      const msg = expense?.note || expense?.message || "";
      await sendExpenseEmail(expense.id, msg);
      toast.success("Email sent.");
      await load();
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Failed to send email.");
    }
  };

  // ---------- tiny modal (no extra file needed) ----------
  const SimpleModal = ({ open, title, onClose, children, maxWidthClass = "max-w-2xl" }) => {
    if (!open) return null;
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center">
        <div
          className="absolute inset-0 bg-black/40"
          onClick={onClose}
          role="button"
          tabIndex={-1}
        />
        <div className={`relative w-[92vw] ${maxWidthClass} bg-white rounded-2xl shadow-xl`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <div className="font-semibold text-gray-900">{title}</div>
            <button
              className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700"
              onClick={onClose}
              type="button"
            >
              Close
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    );
  };

  const total = useMemo(() => {
    return (filteredRows || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  }, [filteredRows]);

  return (
    <div className="rounded-xl border bg-white shadow-sm">
      <div className="px-5 py-4 border-b bg-gradient-to-r from-blue-50 to-white rounded-t-xl">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold">Expense Requests</h3>
            <p className="text-sm text-gray-600 mt-1">
              Track expenses you’ve sent to customers. Upload receipts and send emails.
            </p>
          </div>

          <div className="text-sm text-gray-700">
            Total:&nbsp;<span className="font-semibold">{money(total)}</span>
          </div>
        </div>

        {/* Filter */}
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
          <label className="text-sm text-gray-600">Filter by agreement:</label>
          <select
            value={agreementFilter}
            onChange={(e) => setAgreementFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 w-full sm:w-auto"
          >
            <option value="">All agreements</option>
            {agreementsInRows.map((id) => (
              <option key={id} value={id}>
                Agreement #{id}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={load}
            className="px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 w-full sm:w-auto"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="p-5">
        {loading ? (
          <div className="text-gray-600">Loading…</div>
        ) : filteredRows.length === 0 ? (
          <div className="text-gray-500 text-sm">No expenses yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-sm border rounded">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left border">Created</th>
                  <th className="p-2 text-left border">Agreement</th>
                  <th className="p-2 text-left border">Description</th>
                  <th className="p-2 text-right border">Amount</th>
                  <th className="p-2 text-left border">Status</th>
                  <th className="p-2 text-left border">Attachments</th>
                  <th className="p-2 text-right border">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const created = r.created_at || r.created || null;
                  const status = r.status || r.email_status || "";
                  const attachCount = Array.isArray(r.attachments)
                    ? r.attachments.length
                    : Number(r.attachment_count || r.attachments_count || 0);

                  return (
                    <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                      <td className="p-2 border whitespace-nowrap">
                        {created ? new Date(created).toLocaleString() : "—"}
                      </td>
                      <td className="p-2 border">{r.agreement || r.agreement_id || "—"}</td>
                      <td className="p-2 border">
                        <div className="font-medium text-gray-900">{r.description || "—"}</div>
                        {(r.note || r.message) ? (
                          <div className="text-xs text-gray-600 mt-0.5 line-clamp-1">
                            {r.note || r.message}
                          </div>
                        ) : null}
                      </td>
                      <td className="p-2 border text-right font-semibold">{money(r.amount)}</td>
                      <td className="p-2 border">{statusBadge(status)}</td>

                      <td className="p-2 border whitespace-nowrap">
                        {r.receipt_url ? (
                          <a
                            className="text-blue-700 underline"
                            href={r.receipt_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open receipt
                          </a>
                        ) : attachCount ? (
                          <button
                            type="button"
                            className="text-blue-700 underline font-medium"
                            onClick={() => openAttachmentsModal(r)}
                          >
                            View ({attachCount})
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td className="p-2 border">
                        <div className="flex flex-wrap gap-2 justify-end">
                          {/* Upload */}
                          <label className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 cursor-pointer">
                            Upload
                            <input
                              type="file"
                              multiple
                              className="hidden"
                              onChange={(evt) => handleRowUpload(r.id, evt)}
                            />
                          </label>

                          {/* Send / Resend Email */}
                          <button
                            type="button"
                            onClick={() => handleSendEmail(r)}
                            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                          >
                            {String(status).toLowerCase().includes("sent") || String(status).toLowerCase() === "pending"
                              ? "Resend Email"
                              : "Send Email"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Attachments Modal */}
      <SimpleModal
        open={attachmentsOpen}
        title={
          attachmentsExpense
            ? `Attachments — Expense #${attachmentsExpense.id}`
            : "Attachments"
        }
        onClose={closeAttachmentsModal}
        maxWidthClass="max-w-3xl"
      >
        {!attachmentsExpense ? (
          <div className="text-sm text-gray-600">No expense selected.</div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="text-sm font-semibold text-gray-900">
                {attachmentsExpense.description || "—"}
              </div>
              <div className="text-xs text-gray-600 mt-1">
                Amount: <span className="font-semibold">{money(attachmentsExpense.amount)}</span>
                <span className="mx-2">•</span>
                Agreement:{" "}
                <span className="font-semibold">
                  {String(attachmentsExpense.agreement || attachmentsExpense.agreement_id || "—")}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-gray-900">Files</div>

              <label className="px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 cursor-pointer">
                Upload more
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={async (evt) => {
                    const picked = Array.from(evt.target.files || []);
                    if (!picked.length) return;
                    try {
                      setAttachmentsLoading(true);
                      await uploadAttachments(attachmentsExpense.id, picked);
                      toast.success("Attachment(s) uploaded.");

                      const arr = await fetchAttachments(attachmentsExpense.id);
                      setAttachmentsList(arr);

                      await load();
                    } catch (e) {
                      console.error(e);
                      toast.error("Failed to upload attachments.");
                    } finally {
                      setAttachmentsLoading(false);
                      evt.target.value = "";
                    }
                  }}
                />
              </label>
            </div>

            {attachmentsLoading ? (
              <div className="text-sm text-gray-600">Loading attachments…</div>
            ) : attachmentsList.length ? (
              <div className="space-y-2">
                {attachmentsList.map((a, i) => {
                  const name = a.original_name || a.filename || a.name || `Attachment ${i + 1}`;
                  const url = a.url || a.file_url || a.download_url || a.file || null;
                  const size = a.size ? `${Math.round(a.size / 1024)} KB` : "";

                  return (
                    <div
                      key={a.id || `${name}-${i}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 p-3 bg-white"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{name}</div>
                        <div className="text-xs text-gray-600">
                          {size ? size : <span className="italic">No size</span>}
                        </div>
                      </div>

                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm whitespace-nowrap"
                        >
                          Open
                        </a>
                      ) : (
                        <span className="text-xs text-gray-500">No URL</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-gray-600">
                No attachments found for this expense yet.
              </div>
            )}
          </div>
        )}
      </SimpleModal>
    </div>
  );
}
