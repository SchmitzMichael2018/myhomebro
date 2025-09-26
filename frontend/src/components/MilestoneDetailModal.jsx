// src/components/MilestoneDetailModal.jsx
// v2025-09-25 resizable + draft-only edits + complete→review + tolerant file endpoints (no "Send Invoice")

import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== "") ?? "";

/* -------- Agreement helpers (pulled via milestone.agreement or separate fetch if needed) -------- */
const getAgreementFrom = (m) => m.agreement || m._ag || null;
const getAgreementStatus = (a) => (pick(a?.status, a?.agreement_status, a?.signature_status) || "").toLowerCase();
const isAgreementDraft = (a) => getAgreementStatus(a) === "draft";
const isAgreementSigned = (a) => ["signed", "executed", "active", "approved"].includes(getAgreementStatus(a));
const isEscrowFunded = (a) => !!pick(a?.escrow_funded, a?.escrowFunded);

const toISO = (v) => {
  if (!v) return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  try { const d = new Date(s); if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10); } catch {}
  return s;
};

export default function MilestoneDetailModal({
  visible,
  milestone,
  onClose,
  // optional overrides if you already store the parent agreement separately
  agreement: agreementProp,
  // optional callbacks to refresh parent lists
  onSaved,
  onCompleted,
  // allow overriding routes if needed
  apiRoutes = {
    patch: (id) => `/projects/milestones/${id}/`,
    complete: (id) => `/projects/milestones/${id}/complete/`,
    evidence: (id) => `/projects/milestones/${id}/evidence/`,
    submit: (id) => `/projects/milestones/${id}/submit/`,
  },
}) {
  const [form, setForm] = useState({
    title: "",
    amount: "",
    start_date: "",
    end_date: "",
    description: "",
  });
  const [files, setFiles] = useState([]);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const milestoneId = milestone?.id;
  const agreement = useMemo(() => agreementProp || getAgreementFrom(milestone) || {}, [agreementProp, milestone]);

  const canEdit = useMemo(() => isAgreementDraft(agreement), [agreement]);
  const canComplete = useMemo(() => isAgreementSigned(agreement) && isEscrowFunded(agreement), [agreement]);

  /* -------- Load ancillary (files/comments) with tolerant endpoints to avoid 404/500 loops -------- */
  const tolerantGetFiles = async (id) => {
    const candidates = [
      `/projects/milestone-files/?milestone=${id}`,
      `/milestone-files/?milestone=${id}`,
      `/projects/milestones/${id}/files/`,
    ];
    for (const url of candidates) {
      try {
        const { data } = await api.get(url);
        const arr = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
        if (Array.isArray(arr)) return arr;
      } catch {/* try next */}
    }
    return [];
  };

  const tolerantPostFile = async (id, file) => {
    const form = new FormData();
    form.append("file", file);
    form.append("milestone", id);
    const candidates = [
      `/projects/milestone-files/`,
      `/milestone-files/`,
      `/projects/milestones/${id}/files/`,
    ];
    for (const url of candidates) {
      try {
        const { data } = await api.post(url, form, { headers: { "Content-Type": "multipart/form-data" } });
        return data;
      } catch {/* try next */}
    }
    throw new Error("Upload failed");
  };

  const tolerantDeleteFile = async (fileId) => {
    const candidates = [
      `/projects/milestone-files/${fileId}/`,
      `/milestone-files/${fileId}/`,
    ];
    for (const url of candidates) {
      try { await api.delete(url); return; } catch {/* try next */}
    }
    throw new Error("Delete failed");
  };

  const tolerantGetComments = async (id) => {
    const candidates = [
      `/projects/milestones/${id}/comments/`,
      `/milestones/${id}/comments/`,
    ];
    for (const url of candidates) {
      try {
        const { data } = await api.get(url);
        const arr = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
        if (Array.isArray(arr)) return arr;
      } catch {}
    }
    return [];
  };

  const tolerantPostComment = async (id, content) => {
    const candidates = [
      `/projects/milestones/${id}/comments/`,
      `/milestones/${id}/comments/`,
    ];
    for (const url of candidates) {
      try {
        const { data } = await api.post(url, { content });
        return data;
      } catch {}
    }
    throw new Error("Comment failed");
  };

  useEffect(() => {
    if (!visible || !milestoneId) return;
    (async () => {
      setLoading(true);
      try {
        setForm({
          title: milestone?.title || "",
          amount: milestone?.amount ?? "",
          start_date: toISO(milestone?.start_date || milestone?.scheduled_for),
          end_date: toISO(milestone?.end_date || milestone?.completion_date),
          description: milestone?.description || "",
        });
        const [f, c] = await Promise.all([
          tolerantGetFiles(milestoneId),
          tolerantGetComments(milestoneId),
        ]);
        setFiles(f);
        setComments(c);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [visible, milestoneId, milestone]);

  const handleFileInput = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !milestoneId) return;
    try {
      const saved = await tolerantPostFile(milestoneId, file);
      setFiles((list) => [saved, ...list]);
      toast.success("File uploaded.");
    } catch {
      toast.error("Upload failed.");
    } finally {
      try { e.target.value = ""; } catch {}
    }
  };

  const removeFile = async (fileId) => {
    if (!window.confirm("Delete this file?")) return;
    try {
      await tolerantDeleteFile(fileId);
      setFiles((list) => list.filter((f) => f.id !== fileId));
      toast.success("File deleted.");
    } catch {
      toast.error("Failed to delete file.");
    }
  };

  const addComment = async (e) => {
    e.preventDefault();
    const content = e.currentTarget.elements.comment?.value?.trim();
    if (!content) return;
    try {
      const saved = await tolerantPostComment(milestoneId, content);
      setComments((list) => [saved, ...list]);
      e.currentTarget.reset();
    } catch {
      toast.error("Could not post comment.");
    }
  };

  const saveChanges = async ({ closeAfter = false } = {}) => {
    if (!canEdit) {
      toast("Editing is locked (agreement not in Draft).");
      return;
    }
    if (!milestoneId) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title,
        amount: form.amount === "" ? 0 : Number(form.amount),
        description: form.description || "",
        start_date: form.start_date || null,
        completion_date: form.end_date || null,
      };
      await api.patch(apiRoutes.patch(milestoneId), payload);
      toast.success("Milestone saved.");
      onSaved?.();
      if (closeAfter) onClose?.();
    } catch (e) {
      console.error(e);
      toast.error("Failed to save milestone.");
    } finally {
      setSaving(false);
    }
  };

  const submitComplete = async (notes) => {
    if (!canComplete) {
      if (isAgreementDraft(agreement)) toast("Agreement must be signed first.");
      else if (!isEscrowFunded(agreement)) toast("Escrow must be funded first.");
      else toast("Cannot complete this milestone yet.");
      return;
    }
    if (!milestoneId) return;
    setSubmitting(true);
    try {
      // Prefer /complete/; fall back to evidence + submit
      try {
        const formData = new FormData();
        formData.append("notes", notes || "");
        files.forEach((f, i) => {
          if (f?.file && typeof f.file !== "string") formData.append("files", f.file, f.file.name || `evidence_${i}`);
        });
        await api.post(apiRoutes.complete(milestoneId), formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      } catch {
        const formData = new FormData();
        formData.append("notes", notes || "");
        files.forEach((f, i) => {
          if (f?.file && typeof f.file !== "string") formData.append("files", f.file, f.file.name || `evidence_${i}`);
        });
        await api.post(apiRoutes.evidence(milestoneId), formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        await api.post(apiRoutes.submit(milestoneId), {});
      }
      toast.success("Submitted for review.");
      onCompleted?.();
      onClose?.();
    } catch (e) {
      console.error(e);
      toast.error("Could not submit completion.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
      {/* Resizable container */}
      <div
        className="bg-white rounded-lg shadow-xl border w-[900px] max-w-[95vw] max-h-[90vh] p-4 overflow-auto"
        style={{ resize: "both", minWidth: 680, minHeight: 400 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">
            Milestone: <span className="font-normal">{milestone?.title || "Untitled"}</span>
          </h3>
          <button
            onClick={onClose}
            className="px-2 py-1 rounded border hover:bg-gray-50"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {!canEdit && (
            <div className="p-2 rounded bg-blue-50 border border-blue-200 text-blue-700 text-sm">
              Agreement is not in Draft — fields are read-only.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Title</label>
              <input
                disabled={!canEdit}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">Amount ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                disabled={!canEdit}
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">Start Date</label>
              <input
                type="date"
                disabled={!canEdit}
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: toISO(e.target.value) }))}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">Completion Date</label>
              <input
                type="date"
                disabled={!canEdit}
                value={form.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: toISO(e.target.value) }))}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Description</label>
              <textarea
                disabled={!canEdit}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={4}
                className="w-full border rounded px-3 py-2"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500">
              Agreement: <b>{getAgreementStatus(agreement) || "—"}</b> • Escrow funded:{" "}
              <b>{isEscrowFunded(agreement) ? "Yes" : "No"}</b>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => saveChanges({ closeAfter: false })}
                disabled={!canEdit || saving}
                className={`px-3 py-2 rounded text-white ${!canEdit || saving ? "bg-gray-400" : "bg-green-600 hover:bg-green-700"}`}
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
              <button
                type="button"
                onClick={() => saveChanges({ closeAfter: true })}
                disabled={!canEdit || saving}
                className={`px-3 py-2 rounded text-white ${!canEdit || saving ? "bg-gray-400" : "bg-blue-600 hover:bg-blue-700"}`}
              >
                {saving ? "Saving…" : "Save & Close"}
              </button>
            </div>
          </div>

          {/* Files */}
          <div className="border-t pt-3">
            <h4 className="font-semibold mb-2">Files</h4>
            <input type="file" onChange={handleFileInput} disabled={!canEdit} />
            <ul className="mt-2 text-sm space-y-1">
              {files.map((f) => (
                <li key={f.id} className="flex items-center justify-between">
                  <a href={f.file} target="_blank" rel="noreferrer" className="text-blue-600 underline break-all">
                    {String(f.file || "").split("/").pop()}
                  </a>
                  {canEdit && (
                    <button onClick={() => removeFile(f.id)} className="text-red-600 hover:underline">
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Comments */}
          <div className="border-t pt-3">
            <h4 className="font-semibold mb-2">Comments</h4>
            <form onSubmit={addComment} className="flex gap-2">
              <input name="comment" placeholder="Add a comment…" className="flex-1 border p-2 rounded" />
              <button className="bg-blue-600 text-white px-4 py-2 rounded" type="submit">
                Send
              </button>
            </form>
            <ul className="mt-2 text-sm space-y-1 max-h-40 overflow-auto pr-1">
              {comments.map((c) => (
                <li key={c.id} className="break-words">
                  <strong>{c.author_name || "User"}</strong>: {c.content}
                </li>
              ))}
            </ul>
          </div>

          {/* Complete → Review (no Send Invoice here) */}
          <div className="border-t pt-3 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Mark Complete to submit for <b>review</b>. Invoicing happens after approval.
            </div>
            <button
              type="button"
              onClick={() => submitComplete("")}
              disabled={!canComplete || submitting}
              className={`px-3 py-2 rounded text-white ${!canComplete || submitting ? "bg-gray-400" : "bg-emerald-600 hover:bg-emerald-700"}`}
              title={canComplete ? "Submit for review" : "Requires signed agreement and funded escrow"}
            >
              {submitting ? "Submitting…" : "✓ Complete → Review"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
