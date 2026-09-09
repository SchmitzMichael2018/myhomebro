// frontend/src/pages/EmployeeMilestoneModal.jsx
// v2026-01-07b — Require evidence (>=1 note OR >=1 file) before completion + confirmation

import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  fetchEmployeeMilestoneDetail,
  addEmployeeMilestoneComment,
  updateEmployeeMilestoneComment,
  uploadEmployeeMilestoneFile,
  deleteEmployeeMilestoneFile,
  submitEmployeeMilestoneForReview,
} from "../api/employeeMilestones";

function dateOnly(v) {
  if (!v) return "—";
  return String(v).slice(0, 10);
}

function Badge({ label, tone = "base" }) {
  const cls =
    tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "danger"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-gray-200 bg-gray-50 text-gray-800";

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

export default function EmployeeMilestoneModal({ milestoneId, onClose, onUpdated }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [canWork, setCanWork] = useState(false);
  const [milestone, setMilestone] = useState(null);
  const [comments, setComments] = useState([]);
  const [files, setFiles] = useState([]);

  const [commentText, setCommentText] = useState("");
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadSucceeded, setUploadSucceeded] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [fileToDelete, setFileToDelete] = useState(null);
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const title = useMemo(() => milestone?.title || `Milestone #${milestoneId}`, [milestone, milestoneId]);

  const hasEvidence = useMemo(
    () => (comments?.length || 0) > 0 || (files?.length || 0) > 0,
    [comments, files]
  );

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const data = await fetchEmployeeMilestoneDetail(milestoneId);
      setCanWork(Boolean(data?.can_work));
      setMilestone(data?.milestone || null);
      setComments(Array.isArray(data?.comments) ? data.comments : []);
      setFiles(Array.isArray(data?.files) ? data.files : []);
    } catch (e) {
      console.error(e);
      setErr(e?.response?.data?.detail || e?.message || "Could not load milestone.");
      setCanWork(false);
      setMilestone(null);
      setComments([]);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!milestoneId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [milestoneId]);

  async function handleAddComment() {
    const text = (commentText || "").trim();
    if (!text) return;

    setBusy(true);
    setErr("");
    try {
      await addEmployeeMilestoneComment(milestoneId, text);
      setCommentText("");
      await load();
      onUpdated?.();
    } catch (e) {
      console.error(e);
      setErr(e?.response?.data?.detail || e?.message || "Failed to add note.");
    } finally {
      setBusy(false);
    }
  }

  function startEditingComment(comment) {
    setEditingCommentId(comment.id);
    setEditingCommentText(comment.content || "");
    setErr("");
  }

  function cancelEditingComment() {
    setEditingCommentId(null);
    setEditingCommentText("");
  }

  async function saveEditedComment() {
    const text = editingCommentText.trim();
    if (!editingCommentId || !text || busy) return;

    setBusy(true);
    setErr("");
    try {
      await updateEmployeeMilestoneComment(milestoneId, editingCommentId, text);
      cancelEditingComment();
      await load();
      onUpdated?.();
    } catch (e) {
      console.error(e);
      setErr(e?.response?.data?.detail || e?.message || "Failed to update note.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(e) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    // Reset immediately so taking another photo with the same generated name
    // still triggers a change event on iOS/Android installed apps.
    input.value = "";

    setBusy(true);
    setErr("");
    setUploadSucceeded(false);
    setUploadMessage(`Uploading ${file.name || "photo"}…`);
    try {
      await uploadEmployeeMilestoneFile(milestoneId, file);
      await load();
      setUploadSucceeded(true);
      setUploadMessage("Photo saved to this milestone.");
      onUpdated?.();
    } catch (e2) {
      console.error(e2);
      const detail = e2?.response?.data?.detail || e2?.message || "Upload failed.";
      setUploadMessage(`Photo was not saved. ${detail}`);
      setErr(detail);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteFile() {
    if (!fileToDelete?.id || busy) return;
    setBusy(true);
    setErr("");
    try {
      await deleteEmployeeMilestoneFile(milestoneId, fileToDelete.id);
      if (previewFile?.id === fileToDelete.id) setPreviewFile(null);
      setFileToDelete(null);
      setUploadSucceeded(true);
      setUploadMessage("Photo deleted from this milestone.");
      await load();
      onUpdated?.();
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || "Delete failed.";
      setErr(detail);
      setUploadSucceeded(false);
      setUploadMessage(`Photo was not deleted. ${detail}`);
    } finally {
      setBusy(false);
    }
  }

  function requestComplete() {
    if (!canWork || busy || milestone?.completed) return;

    // ✅ enforce in UI too
    if (!hasEvidence) {
      setErr("Evidence required: add at least one note or upload at least one file before completing.");
      return;
    }

    setConfirmOpen(true);
  }

  async function confirmComplete() {
    setConfirmOpen(false);
    setBusy(true);
    setErr("");
    try {
      await submitEmployeeMilestoneForReview(milestoneId, commentText);
      await load();
      onUpdated?.();
      onClose?.();
    } catch (e) {
      console.error(e);
      setErr(e?.response?.data?.detail || e?.message || "Could not mark complete.");
    } finally {
      setBusy(false);
    }
  }

  const due = useMemo(() => dateOnly(milestone?.completion_date || milestone?.due_date || milestone?.start_date), [milestone]);

  const statusLabel = useMemo(() => {
    if (!milestone) return "";
    if (milestone.completed) return "Completed";
    if (milestone.work_submission_status === "submitted_for_review") return "Submitted for review";
    if (milestone.work_submission_status === "needs_changes") return "Changes requested";
    if (milestone.is_late) return "Late";
    return "Assigned";
  }, [milestone]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") {
        if (fileToDelete) setFileToDelete(null);
        else if (previewFile) setPreviewFile(null);
        else if (confirmOpen) setConfirmOpen(false);
        else onClose?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirmOpen, fileToDelete, previewFile]);

  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-2 sm:p-6">
      <div className="mhb-operational-inner w-full max-w-4xl max-h-[94vh] overflow-y-auto rounded-2xl border shadow-2xl relative text-[var(--mhb-text-primary)]">
        <div className="px-5 py-4 border-b flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xl font-bold text-[var(--mhb-text-primary)] truncate">{title}</div>
            <div className="text-sm text-[var(--mhb-text-secondary)] mt-1">
              Agreement <span className="font-semibold">#{milestone?.agreement_id ?? "—"}</span> • Due{" "}
              <span className="font-semibold">{due}</span> •{" "}
              <span className="font-semibold">Milestone {milestone?.order || "—"}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="mhb-btn min-h-11 px-4 py-2 font-semibold"
          >
            Close
          </button>
        </div>

        <div className="p-5 space-y-4">
          {err ? (
            <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
              {err}
            </div>
          ) : null}

          {loading ? (
            <div className="text-sm text-slate-600">Loading…</div>
          ) : !milestone ? (
            <div className="text-sm text-slate-600">Milestone not found.</div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge label={statusLabel} tone={milestone.completed ? "ok" : milestone.is_late ? "danger" : "base"} />
                <Badge label={canWork ? "Work enabled" : "Read-only"} tone={canWork ? "ok" : "warn"} />
                {!hasEvidence && !milestone.completed ? <Badge label="Evidence required" tone="warn" /> : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="mhb-operational-card rounded-xl border p-4">
                  <div className="text-xs font-semibold uppercase text-[var(--mhb-text-secondary)]">Project</div>
                  <div className="mt-1 font-semibold text-[var(--mhb-text-primary)]">{milestone.project_title || `Agreement #${milestone.agreement_id}`}</div>
                  {milestone.project_address ? <div className="mt-1 text-sm text-[var(--mhb-text-secondary)]">{milestone.project_address}</div> : null}
                </div>
                <div className="mhb-operational-card rounded-xl border p-4">
                  <div className="text-xs font-semibold uppercase text-[var(--mhb-text-secondary)]">Review</div>
                  <div className="mt-1 font-semibold text-[var(--mhb-text-primary)]">{milestone.reviewer_display || "Lead contractor"}</div>
                  <div className="mt-1 text-sm text-[var(--mhb-text-secondary)]">Your submission must be approved before this milestone is completed.</div>
                </div>
              </div>
              {milestone.work_review_response_note ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  <strong>Changes requested:</strong> {milestone.work_review_response_note}
                </div>
              ) : null}

              {milestone.description ? (
                <div className="mhb-operational-card rounded-xl border p-4">
                  <div className="text-xs font-semibold text-[var(--mhb-text-secondary)]">Description</div>
                  <div className="mt-1 text-[var(--mhb-text-primary)] whitespace-pre-wrap">{milestone.description}</div>
                </div>
              ) : null}

              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="text-sm text-[var(--mhb-text-secondary)]">
                  Add a progress note or supporting photo before submitting for review.
                </div>

                <button
                  type="button"
                  onClick={requestComplete}
                  disabled={!canWork || busy || milestone.completed || !hasEvidence || milestone.work_submission_status === "submitted_for_review"}
                  className={[
                    "min-h-11 rounded-lg border px-4 py-2 text-sm font-semibold",
                    !canWork || busy || milestone.completed || !hasEvidence || milestone.work_submission_status === "submitted_for_review"
                      ? "!border-slate-500 !bg-slate-700 !text-slate-100 !opacity-100 cursor-not-allowed"
                      : "border-blue-600 bg-blue-600 hover:bg-blue-700 text-white",
                  ].join(" ")}
                  title={!hasEvidence ? "Add a note or upload a file first" : "Submit for lead-contractor review"}
                >
                  {milestone.completed ? "Completed" : milestone.work_submission_status === "submitted_for_review" ? "Awaiting Review" : busy ? "Submitting…" : "Submit for Review"}
                </button>
              </div>

              {/* Notes */}
              <div className="mhb-operational-card rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-[var(--mhb-text-primary)]">Notes</div>
                  <div className="text-sm text-[var(--mhb-text-secondary)]">{comments.length} note(s)</div>
                </div>

                <div className="mt-3 flex gap-2">
                  <input
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    disabled={!canWork || busy}
                    placeholder={canWork ? "Add a note…" : "Read-only"}
                    className="mhb-input min-h-11 flex-1 rounded-lg border px-3 py-2"
                  />
                  <button
                    type="button"
                    onClick={handleAddComment}
                    disabled={!canWork || busy || !commentText.trim()}
                    className={[
                      "min-h-11 rounded-lg border px-4 py-2 text-sm font-semibold",
                      !canWork || busy || !commentText.trim()
                        ? "!border-slate-500 !bg-slate-700 !text-slate-100 !opacity-100 cursor-not-allowed"
                        : "border-blue-600 bg-blue-600 hover:bg-blue-700 text-white",
                    ].join(" ")}
                  >
                    {busy ? "Posting…" : "Post"}
                  </button>
                </div>

                <div className="mt-3 space-y-2">
                  {comments.length === 0 ? (
                    <div className="text-sm text-[var(--mhb-text-secondary)]">No notes yet.</div>
                  ) : (
                    comments.map((c) => (
                      <div key={c.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-xs text-slate-500">
                            {c.author_email || "—"} •{" "}
                            {c.created_at ? String(c.created_at).slice(0, 19).replace("T", " ") : ""}
                          </div>
                          {c.can_edit && editingCommentId !== c.id ? (
                            <button
                              type="button"
                              className="mhb-btn min-h-10 shrink-0 px-3 py-1.5 text-sm font-semibold"
                              onClick={() => startEditingComment(c)}
                              disabled={busy}
                              data-testid={`employee-milestone-note-edit-${c.id}`}
                            >
                              Edit
                            </button>
                          ) : null}
                        </div>
                        {editingCommentId === c.id ? (
                          <div className="mt-2 space-y-2">
                            <textarea
                              value={editingCommentText}
                              onChange={(e) => setEditingCommentText(e.target.value)}
                              className="mhb-input min-h-24 w-full rounded-lg border px-3 py-2"
                              disabled={busy}
                              aria-label="Edit milestone note"
                            />
                            <div className="flex flex-wrap justify-end gap-2">
                              <button
                                type="button"
                                className="mhb-btn min-h-10 px-3 py-1.5 text-sm font-semibold"
                                onClick={cancelEditingComment}
                                disabled={busy}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="mhb-btn primary min-h-10 px-3 py-1.5 text-sm font-semibold"
                                onClick={saveEditedComment}
                                disabled={busy || !editingCommentText.trim()}
                                data-testid={`employee-milestone-note-save-${c.id}`}
                              >
                                {busy ? "Saving…" : "Save note"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-1 text-sm text-slate-900 whitespace-pre-wrap">{c.content}</div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Files */}
              <div className="mhb-operational-card rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-[var(--mhb-text-primary)]">Images / Files</div>
                  <div className="text-sm text-[var(--mhb-text-secondary)]">{files.length} file(s)</div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <input
                    ref={cameraInputRef}
                    type="file"
                    className="sr-only"
                    onChange={handleUpload}
                    disabled={!canWork || busy}
                    accept="image/*"
                    capture="environment"
                    aria-label="Take a photo"
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="sr-only"
                    onChange={handleUpload}
                    disabled={!canWork || busy}
                    accept="image/*,application/pdf"
                    aria-label="Choose an existing photo or PDF"
                  />
                  <button
                    type="button"
                    className="mhb-btn primary min-h-11 px-4 py-2 text-sm font-semibold"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={!canWork || busy}
                  >
                    Take Photo
                  </button>
                  <button
                    type="button"
                    className="mhb-btn min-h-11 px-4 py-2 text-sm font-semibold"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!canWork || busy}
                  >
                    Upload Photo or PDF
                  </button>
                  <div className="w-full text-sm text-[var(--mhb-text-secondary)]">
                    Take a new jobsite photo or attach an existing photo or PDF as proof of work.
                  </div>
                  {uploadMessage ? (
                    <div
                      role="status"
                      className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold ${
                        uploadSucceeded
                          ? "border-emerald-400/50 bg-emerald-500/15 text-[var(--mhb-text-primary)]"
                          : busy
                            ? "border-blue-400/50 bg-blue-500/15 text-[var(--mhb-text-primary)]"
                            : "border-red-400/50 bg-red-500/15 text-[var(--mhb-text-primary)]"
                      }`}
                    >
                      {uploadMessage}
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 space-y-2">
                  {files.length === 0 ? (
                    <div className="text-sm text-[var(--mhb-text-secondary)]">No files uploaded yet.</div>
                  ) : (
                    files.map((f) => (
                      <div key={f.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="min-w-0">
                          <div className="text-xs text-slate-500">
                            {f.uploaded_by_email || "—"} •{" "}
                            {f.uploaded_at ? String(f.uploaded_at).slice(0, 19).replace("T", " ") : ""}
                          </div>
                          <div className="text-sm text-slate-900 truncate">
                            {f.file_url ? f.file_url.split("/").slice(-1)[0] : "file"}
                          </div>
                        </div>
                        {f.file_url ? (
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              className="mhb-btn min-h-10 px-3 py-1.5 text-sm font-semibold"
                              onClick={() => setPreviewFile(f)}
                            >
                              View
                            </button>
                            {f.can_delete ? (
                              <button
                                type="button"
                                className="min-h-10 rounded-lg border border-red-400/60 bg-red-500/15 px-3 py-1.5 text-sm font-semibold text-red-200 hover:bg-red-500/25"
                                onClick={() => setFileToDelete(f)}
                                disabled={busy}
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-sm">—</span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {confirmOpen && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 border">
              <div className="text-lg font-bold text-slate-900">Submit completed work for review?</div>
              <div className="mt-2 text-sm text-slate-700">
                The lead contractor will review <b>{milestone?.title}</b>. They may approve it or return it with a request for more information or photos.
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmComplete}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                >
                  Submit for Review
                </button>
              </div>
            </div>
          </div>
        )}

        {previewFile?.file_url ? (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/90 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Evidence preview">
            <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-slate-950 shadow-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-white/15 px-4 py-3 text-white">
                <div className="min-w-0 truncate font-semibold">Milestone evidence</div>
                <button type="button" className="min-h-11 rounded-lg border border-white/30 bg-white/10 px-4 font-semibold hover:bg-white/20" onClick={() => setPreviewFile(null)}>
                  Close
                </button>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
                {/\.(?:jpe?g|png|gif|webp|heic|heif)(?:\?.*)?$/i.test(previewFile.file_url) ? (
                  <img src={previewFile.file_url} alt="Milestone evidence" className="max-h-[78vh] max-w-full object-contain" />
                ) : (
                  <iframe src={previewFile.file_url} title="Milestone evidence" className="h-[78vh] w-full rounded-lg bg-white" />
                )}
              </div>
            </div>
          </div>
        ) : null}

        {fileToDelete ? (
          <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-evidence-title">
            <div className="w-full max-w-md rounded-2xl border border-white/20 bg-slate-900 p-5 text-white shadow-2xl">
              <h2 id="delete-evidence-title" className="text-xl font-bold">Delete this photo?</h2>
              <p className="mt-2 text-sm leading-6 text-slate-200">It will be permanently removed from this milestone’s evidence.</p>
              <div className="mt-5 flex justify-end gap-3">
                <button type="button" className="min-h-11 rounded-lg border border-white/25 px-4 font-semibold" onClick={() => setFileToDelete(null)} disabled={busy}>Cancel</button>
                <button type="button" className="min-h-11 rounded-lg bg-red-600 px-4 font-semibold text-white hover:bg-red-700" onClick={confirmDeleteFile} disabled={busy}>{busy ? "Deleting…" : "Delete Photo"}</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
