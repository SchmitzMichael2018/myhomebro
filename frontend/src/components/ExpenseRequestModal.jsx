// frontend/src/components/ExpenseRequestModal.jsx
// v2026-02-19 — Expense modal upgrade:
// - Supports MULTIPLE attachments (PDF/images) instead of single file
// - Best-effort backend compatibility:
//    • Sends FIRST file via existing createExpense({ file }) for legacy support
//    • Uploads remaining files via /attachments/ endpoints (projects/expenses or legacy fallbacks)
// - Adds "Send email now" toggle
// - Adds optional "Save Draft" (create only) action
// - Keeps existing flow: create -> contractor sign -> send to homeowner (email)
// - Keeps react-modal + your api/expenses functions

import React, { useEffect, useMemo, useRef, useState } from "react";
import Modal from "react-modal";
import toast from "react-hot-toast";
import {
  createExpense,
  contractorSignExpense,
  sendExpenseToHomeowner,
} from "../api/expenses";
import api from "../api";

Modal.setAppElement("#root");

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

async function tryGet(urls, config) {
  let lastErr = null;
  for (const u of urls) {
    try {
      const res = await api.get(u, config);
      return { ok: true, url: u, data: res.data };
    } catch (e) {
      lastErr = e;
    }
  }
  return { ok: false, err: lastErr };
}

async function uploadExpenseAttachments(expenseId, files) {
  if (!expenseId || !files || !files.length) return { ok: true };

  const fd = new FormData();
  // support both `files` (multi) and repeated `file`
  files.forEach((f) => fd.append("files", f));
  files.forEach((f) => fd.append("file", f));

  const res = await tryPost(
    [
      `/projects/expenses/${expenseId}/attachments/`,
      `/expenses/${expenseId}/attachments/`,
      `/projects/expense-requests/${expenseId}/attachments/`,
    ],
    fd,
    { headers: { "Content-Type": "multipart/form-data" } }
  );

  return res;
}

async function fetchAgreementsSafe() {
  // Your current path is /projects/agreements/ but we keep a fallback
  const res = await tryGet(
    ["/projects/agreements/", "/agreements/"],
    { params: { page_size: 200 } }
  );

  if (!res.ok) throw res.err;
  const data = res.data;
  return Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
}

export default function ExpenseRequestModal({ isOpen, onClose, defaultAgreementId = null }) {
  const [agreements, setAgreements] = useState([]);
  const [sub, setSub] = useState(false);

  const fileInputRef = useRef(null);

  const [form, setForm] = useState({
    agreement: defaultAgreementId || "",
    description: "",
    amount: "",
    incurred_date: new Date().toISOString().slice(0, 10),
    notes_to_homeowner: "",
    files: [], // <-- MULTI
    send_now: true, // <-- toggle
  });

  useEffect(() => {
    const loadAgreements = async () => {
      try {
        const list = await fetchAgreementsSafe();
        setAgreements(list);
      } catch (e) {
        console.error(e);
        setAgreements([]);
      }
    };

    if (isOpen) {
      loadAgreements();
      setForm((f) => ({
        ...f,
        agreement: defaultAgreementId || "",
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaultAgreementId]);

  const canSubmit = useMemo(() => {
    if (!String(form.description || "").trim()) return false;
    const amt = Number(form.amount);
    if (!form.amount || Number.isNaN(amt) || amt <= 0) return false;
    return true;
  }, [form.amount, form.description]);

  const onChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  };

  const onFiles = (e) => {
    const picked = Array.from(e.target.files || []);
    setForm((f) => ({ ...f, files: picked }));
  };

  const clearFiles = () => {
    setForm((f) => ({ ...f, files: [] }));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFileAt = (idx) => {
    setForm((f) => {
      const next = [...(f.files || [])];
      next.splice(idx, 1);
      return { ...f, files: next };
    });
    // Note: browser file inputs can't be partially edited; leaving input as-is is fine.
  };

  const doCreateOnly = async () => {
    if (!canSubmit) {
      toast.error("Description and amount are required.");
      return;
    }

    try {
      setSub(true);

      const files = form.files || [];
      const firstFile = files.length ? files[0] : null;
      const remaining = files.length > 1 ? files.slice(1) : [];

      const created = await createExpense({
        agreement: form.agreement || null,
        description: String(form.description || "").trim(),
        amount: form.amount,
        incurred_date: form.incurred_date || null,
        notes_to_homeowner: form.notes_to_homeowner || "",
        // Legacy support: createExpense probably sends this as multipart with `file`
        file: firstFile || null,
      });

      // Upload remaining attachments (best-effort)
      if (remaining.length) {
        const up = await uploadExpenseAttachments(created.id, remaining);
        if (!up.ok) {
          console.warn(up.err);
          toast.error("Expense created, but some attachments failed to upload.");
        }
      }

      toast.success("Expense saved.");
      onClose(true);
    } catch (e) {
      console.error(e);
      toast.error("Failed to create expense.");
    } finally {
      setSub(false);
    }
  };

  const doSignAndSend = async () => {
    if (!canSubmit) {
      toast.error("Description and amount are required.");
      return;
    }

    try {
      setSub(true);

      const files = form.files || [];
      const firstFile = files.length ? files[0] : null;
      const remaining = files.length > 1 ? files.slice(1) : [];

      const created = await createExpense({
        agreement: form.agreement || null,
        description: String(form.description || "").trim(),
        amount: form.amount,
        incurred_date: form.incurred_date || null,
        notes_to_homeowner: form.notes_to_homeowner || "",
        file: firstFile || null,
      });

      // Upload remaining attachments (best-effort)
      if (remaining.length) {
        const up = await uploadExpenseAttachments(created.id, remaining);
        if (!up.ok) {
          console.warn(up.err);
          toast.error("Expense created, but some attachments failed to upload.");
        }
      }

      // Contractor signs
      await contractorSignExpense(created.id);

      // Email send toggle
      if (form.send_now) {
        await sendExpenseToHomeowner(created.id);
        toast.success("Expense sent to homeowner.");
      } else {
        toast.success("Expense created (not sent).");
      }

      onClose(true);
    } catch (e) {
      console.error(e);
      toast.error("Failed to create/send expense.");
    } finally {
      setSub(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={() => onClose(false)}
      className="max-w-2xl w-[90vw] bg-white rounded-xl shadow-2xl p-6 mx-auto mt-24 outline-none"
      overlayClassName="fixed inset-0 bg-black/50 flex items-start justify-center"
    >
      <div className="flex items-start justify-between mb-4">
        <h2 className="text-xl font-semibold">New Expense</h2>
        <button onClick={() => onClose(false)} className="px-3 py-1.5 rounded-lg border">
          Close
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          doSignAndSend();
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-700 mb-1">Agreement (optional)</label>
            <select
              name="agreement"
              value={form.agreement}
              onChange={onChange}
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="">— None —</option>
              {agreements.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.project_title || a.title || `Agreement #${a.id}`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">Incurred Date</label>
            <input
              type="date"
              name="incurred_date"
              value={form.incurred_date}
              onChange={onChange}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm text-gray-700 mb-1">Description</label>
            <input
              name="description"
              value={form.description}
              onChange={onChange}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="e.g., Dump fee, rental, small materials"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">Amount</label>
            <input
              type="number"
              step="0.01"
              name="amount"
              value={form.amount}
              onChange={onChange}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">Attachments (PDF or Images)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              multiple
              onChange={onFiles}
              className="w-full"
            />

            {form.files?.length ? (
              <div className="mt-2 rounded-lg border bg-gray-50 p-2">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs font-semibold text-gray-700">
                    Selected ({form.files.length})
                  </div>
                  <button
                    type="button"
                    onClick={clearFiles}
                    className="text-xs text-red-700 hover:underline"
                  >
                    Clear
                  </button>
                </div>

                <div className="space-y-1">
                  {form.files.map((f, idx) => (
                    <div
                      key={`${f.name}-${idx}`}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="text-xs text-gray-700 truncate">
                        {f.name}{" "}
                        <span className="text-gray-500">
                          ({Math.round((f.size || 0) / 1024)} KB)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFileAt(idx)}
                        className="text-xs text-gray-700 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-2 text-[11px] text-gray-500">
                  Note: The first file is attached during creation for legacy support. Any
                  additional files are uploaded right after creation.
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-1">Notes to Homeowner (optional)</label>
          <textarea
            name="notes_to_homeowner"
            value={form.notes_to_homeowner}
            onChange={onChange}
            className="w-full border rounded-lg px-3 py-2 min-h-[90px]"
            placeholder="Explain why this expense is needed."
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              name="send_now"
              checked={!!form.send_now}
              onChange={onChange}
            />
            Send email now
          </label>

          {!canSubmit ? (
            <div className="text-xs text-gray-500">
              Enter a description and a positive amount to continue.
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onClose(false)}
            className="px-4 py-2 rounded-lg border"
            disabled={sub}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={doCreateOnly}
            disabled={sub || !canSubmit}
            className={`px-4 py-2 rounded-lg font-semibold border ${
              sub || !canSubmit
                ? "bg-gray-100 text-gray-500 border-gray-200"
                : "bg-white hover:bg-gray-50 text-gray-800 border-gray-300"
            }`}
            title="Create the expense without signing/sending"
          >
            {sub ? "Working…" : "Save Draft"}
          </button>

          <button
            type="submit"
            disabled={sub || !canSubmit}
            className={`px-4 py-2 rounded-lg text-white font-semibold ${
              sub || !canSubmit ? "bg-gray-500" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {sub ? "Sending…" : form.send_now ? "Sign & Send Email" : "Sign (Don’t Send)"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
