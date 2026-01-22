// frontend/src/pages/EmployeeMilestoneModal.jsx
// v2026-01-07b — Require evidence (>=1 note OR >=1 file) before completion + confirmation

import React, { useEffect, useMemo, useState } from "react";

import {
  fetchEmployeeMilestoneDetail,
  addEmployeeMilestoneComment,
  uploadEmployeeMilestoneFile,
  markEmployeeMilestoneComplete,
} from "../api/employeeMilestones";

function dateOnly(v) {
  if (!v) return "—";
  return String(v).slice(0, 10);
}

function moneyFmt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0.00";
  return `$${v.toFixed(2)}`;
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
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setErr("");
    try {
      await uploadEmployeeMilestoneFile(milestoneId, file);
      e.target.value = "";
      await load();
      onUpdated?.();
    } catch (e2) {
      console.error(e2);
      setErr(e2?.response?.data?.detail || e2?.message || "Upload failed.");
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
      await markEmployeeMilestoneComplete(milestoneId);
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
    if (milestone.is_late) return "Late";
    return "Assigned";
  }, [milestone]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") {
        if (confirmOpen) setConfirmOpen(false);
        else onClose?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirmOpen]);

  return (
    <div className="fixed inset-0 z-[9999] bg-black/50 flex items-start justify-center">
      <div className="mt-10 w-[92vw] max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden relative">
        <div className="px-5 py-4 border-b flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-bold text-slate-900 truncate">{title}</div>
            <div className="text-sm text-slate-600 mt-1">
              Agreement <span className="font-semibold">#{milestone?.agreement_id ?? "—"}</span> • Due{" "}
              <span className="font-semibold">{due}</span> • Amount{" "}
              <span className="font-semibold">{moneyFmt(milestone?.amount)}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold"
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

              {milestone.description ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold text-slate-500">Description</div>
                  <div className="mt-1 text-slate-800 whitespace-pre-wrap">{milestone.description}</div>
                </div>
              ) : null}

              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="text-xs text-slate-500">
                  Add at least one note or upload a file before completing.
                </div>

                <button
                  type="button"
                  onClick={requestComplete}
                  disabled={!canWork || busy || milestone.completed || !hasEvidence}
                  className={[
                    "px-4 py-2 rounded-lg text-sm font-semibold",
                    !canWork || milestone.completed || !hasEvidence
                      ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                      : "bg-blue-600 hover:bg-blue-700 text-white",
                  ].join(" ")}
                  title={!hasEvidence ? "Add a note or upload a file first" : "Mark complete"}
                >
                  {milestone.completed ? "Completed" : busy ? "Working…" : "Mark Complete"}
                </button>
              </div>

              {/* Notes */}
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-slate-900">Notes</div>
                  <div className="text-xs text-slate-500">{comments.length} note(s)</div>
                </div>

                <div className="mt-3 flex gap-2">
                  <input
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    disabled={!canWork || busy}
                    placeholder={canWork ? "Add a note…" : "Read-only"}
                    className="flex-1 border rounded-lg px-3 py-2"
                  />
                  <button
                    type="button"
                    onClick={handleAddComment}
                    disabled={!canWork || busy || !commentText.trim()}
                    className={[
                      "px-4 py-2 rounded-lg text-sm font-semibold",
                      !canWork || !commentText.trim()
                        ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                        : "bg-slate-900 hover:bg-slate-800 text-white",
                    ].join(" ")}
                  >
                    {busy ? "Posting…" : "Post"}
                  </button>
                </div>

                <div className="mt-3 space-y-2">
                  {comments.length === 0 ? (
                    <div className="text-sm text-slate-600">No notes yet.</div>
                  ) : (
                    comments.map((c) => (
                      <div key={c.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="text-xs text-slate-500">
                          {c.author_email || "—"} •{" "}
                          {c.created_at ? String(c.created_at).slice(0, 19).replace("T", " ") : ""}
                        </div>
                        <div className="mt-1 text-sm text-slate-900 whitespace-pre-wrap">{c.content}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Files */}
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-slate-900">Images / Files</div>
                  <div className="text-xs text-slate-500">{files.length} file(s)</div>
                </div>

                <div className="mt-3 flex items-center gap-3 flex-wrap">
                  <input type="file" onChange={handleUpload} disabled={!canWork || busy} accept="image/*,application/pdf" />
                  <div className="text-xs text-slate-500">Upload photos or PDFs as proof of work.</div>
                </div>

                <div className="mt-3 space-y-2">
                  {files.length === 0 ? (
                    <div className="text-sm text-slate-600">No files uploaded yet.</div>
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
                          <a href={f.file_url} target="_blank" rel="noreferrer" className="text-blue-700 font-semibold underline">
                            Open
                          </a>
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
              <div className="text-lg font-bold text-slate-900">Mark milestone complete?</div>
              <div className="mt-2 text-sm text-slate-700">
                You are about to mark <b>{milestone?.title}</b> as complete.
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
                  Yes, Complete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
