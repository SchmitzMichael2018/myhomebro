// src/components/MilestoneDetailModal.jsx
// v2025-12-14-submit-lock+notes+evidence
// - Completion button calls parent onSubmit({id, notes, files})
// - Keeps draft-only edit/file upload behavior

import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "") ?? "";

/* Agreement helpers */
const getAgreementFrom = (m) => m.agreement || m._ag || null;
const getAgreementStatus = (a) => (pick(a?.status, a?.agreement_status, a?.signature_status) || "").toLowerCase();
const isAgreementDraft = (a) => getAgreementStatus(a) === "draft";
const isAgreementSigned = (a) => ["signed", "executed", "active", "approved"].includes(getAgreementStatus(a));
const isEscrowFunded = (a) => !!pick(a?.escrow_funded, a?.escrowFunded);

const toISO = (v) => {
  if (!v) return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {}
  return s;
};

export default function MilestoneDetailModal({
  open,
  visible, // legacy support
  milestone,
  onClose,
  agreement: agreementProp,
  onSaved,
  onCompleted,
  onSubmit,
}) {
  const isOpen = typeof open === "boolean" ? open : !!visible;

  const [form, setForm] = useState({
    title: "",
    amount: "",
    start_date: "",
    end_date: "",
    description: "",
  });

  const [files, setFiles] = useState([]);
  const [comments, setComments] = useState([]);

  const [evidenceFiles, setEvidenceFiles] = useState([]);
  const [completeNotes, setCompleteNotes] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const milestoneId = milestone?.id;
  const agreement = useMemo(() => agreementProp || getAgreementFrom(milestone) || {}, [agreementProp, milestone]);

  const canEdit = useMemo(() => isAgreementDraft(agreement), [agreement]);
  const canComplete = useMemo(() => isAgreementSigned(agreement) && isEscrowFunded(agreement), [agreement]);

  /* -------- Tolerant endpoints for files/comments -------- */
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
      } catch {}
    }
    return [];
  };

  const tolerantPostFile = async (id, file) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("milestone", id);
    const candidates = [
      `/projects/milestone-files/`,
      `/milestone-files/`,
      `/projects/milestones/${id}/files/`,
    ];
    for (const url of candidates) {
      try {
        const { data } = await api.post(url, formData, { headers: { "Content-Type": "multipart/form-data" } });
        return data;
      } catch {}
    }
    throw new Error("Upload failed");
  };

  const tolerantDeleteFile = async (fileId) => {
    const candidates = [
      `/projects/milestone-files/${fileId}/`,
      `/milestone-files/${fileId}/`,
    ];
    for (const url of candidates) {
      try {
        await api.delete(url);
        return;
      } catch {}
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
    if (!isOpen || !milestoneId) return;

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

        setEvidenceFiles([]);
        setCompleteNotes("");

        const [f, c] = await Promise.all([tolerantGetFiles(milestoneId), tolerantGetComments(milestoneId)]);
        setFiles(f);
        setComments(c);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen, milestoneId, milestone]);

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
      try {
        e.target.value = "";
      } catch {}
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
      await api.patch(`/projects/milestones/${milestoneId}/`, payload);
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

  const handleEvidencePick = (e) => {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    setEvidenceFiles((prev) => [...prev, ...picked]);
    try {
      e.target.value = "";
    } catch {}
  };

  const removeEvidence = (idx) => {
    setEvidenceFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const submitComplete = async () => {
    if (!canComplete) {
      toast("Cannot complete this milestone yet.");
      return;
    }
    if (!milestoneId) return;
    if (typeof onSubmit !== "function") {
      toast.error("Completion is not wired (missing onSubmit).");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({ id: milestoneId, notes: completeNotes || "", files: evidenceFiles });
      onCompleted?.();
      onClose?.();
    } catch (e) {
      console.error(e);
      toast.error("Could not submit completion.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
      <div
        className="bg-white rounded-lg shadow-xl border w-[900px] max-w-[95vw] max-h-[90vh] p-4 overflow-auto"
        style={{ resize: "both", minWidth: 680, minHeight: 420 }}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">
            Milestone Details: <span className="font-normal">{milestone?.title || "Untitled"}</span>
          </h3>
          <button onClick={onClose} className="px-2 py-1 rounded border hover:bg-gray-50" aria-label="Close">
            ✕
          </button>
        </div>

        {loading ? (
          <div className="px-2 py-6 text-gray-600">Loading…</div>
        ) : (
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

            <div className="border-t pt-3">
              <h4 className="font-semibold mb-2">Files</h4>
              <div className="flex items-center gap-3 flex-wrap">
                <input type="file" onChange={handleFileInput} disabled={!canEdit} />
                {!canEdit && <span className="text-xs text-gray-500">(Upload locked — Draft only)</span>}
              </div>

              <ul className="mt-2 text-sm space-y-1">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3">
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
                {files.length === 0 && <li className="text-gray-500">No files.</li>}
              </ul>
            </div>

            <div className="border-t pt-3">
              <h4 className="font-semibold mb-2">Completion Notes & Evidence</h4>

              <label className="block text-sm text-gray-600 mb-1">Notes (optional)</label>
              <textarea
                value={completeNotes}
                onChange={(e) => setCompleteNotes(e.target.value)}
                rows={3}
                className="w-full border rounded px-3 py-2"
                placeholder="Add notes for the homeowner / approval record…"
              />

              <div className="mt-2 flex items-center gap-3 flex-wrap">
                <input type="file" multiple onChange={handleEvidencePick} />
                <span className="text-xs text-gray-500">(These files attach when you click “Complete → Review”)</span>
              </div>

              {evidenceFiles.length > 0 && (
                <ul className="mt-2 text-sm space-y-1">
                  {evidenceFiles.map((f, idx) => (
                    <li key={`${f.name}-${idx}`} className="flex items-center justify-between gap-3">
                      <span className="break-all">{f.name}</span>
                      <button type="button" onClick={() => removeEvidence(idx)} className="text-rose-600 hover:underline">
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

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
                {comments.length === 0 && <li className="text-gray-500">No comments.</li>}
              </ul>
            </div>

            <div className="border-t pt-3 flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Mark Complete to submit for <b>review</b>. Invoicing happens after approval.
              </div>

              <button
                type="button"
                onClick={submitComplete}
                disabled={!canComplete || submitting}
                className={`px-3 py-2 rounded text-white ${!canComplete || submitting ? "bg-gray-400" : "bg-emerald-600 hover:bg-emerald-700"}`}
              >
                {submitting ? "Submitting…" : "✓ Complete → Review"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
