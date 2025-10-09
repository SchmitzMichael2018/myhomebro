// src/components/MilestoneEditModal.jsx
// v2025-10-06-modal-r8 — overlap-aware save (confirm → retry with allow_overlap), diff-only PATCH,
// verified upload, Recent Attachments (Download + Delete), calendar icons.

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import api from "../api";

const dollar = (v) => {
  if (v === "" || v === null || v === undefined) return "";
  const n = Number(v);
  return Number.isNaN(n) ? v : n.toFixed(2);
};

const isLockedAgreementState = (s) => {
  if (!s) return false;
  const up = String(s).trim().toUpperCase();
  return ["SIGNED", "EXECUTED", "ACTIVE", "APPROVED", "ARCHIVED"].includes(up);
};

function CalendarBtn({ onClick, title = "Pick a date", disabled }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={title}
      title={title}
      disabled={disabled}
      style={{
        position: "absolute",
        right: 8,
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 2147483647,
        background: "transparent",
        border: 0,
        lineHeight: 0,
        color: "#6B7280",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span role="img" aria-label="calendar">📅</span>
    </button>
  );
}

// choose best download URL
const urlFor = (a) =>
  a?.file || a?.url || a?.file_url || a?.download_url || a?.download || a?.absolute_url || null;

// allowed statuses if backend validates
const ALLOWED_STATUS = new Set([
  "Incomplete", "Complete", "Pending", "Approved", "Disputed", "Scheduled",
  "INCOMPLETE", "COMPLETE", "PENDING", "APPROVED", "DISPUTED", "SCHEDULED",
]);

export default function MilestoneEditModal({
  open,
  onClose,
  milestone,
  onSaved,
  onMarkComplete,
}) {
  const [form, setForm] = useState({
    title: "",
    start_date: "",
    end_date: "",
    amount: "",
    description: "",
    status: "Incomplete",
  });
  const [saving, setSaving] = useState(false);

  const [comment, setComment] = useState("");
  const [sendingComment, setSendingComment] = useState(false);

  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const [recentAttachments, setRecentAttachments] = useState([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const startRef = useRef(null);
  const endRef = useRef(null);

  const openPicker = (ref) => {
    if (!ref?.current) return;
    if (typeof ref.current.showPicker === "function") ref.current.showPicker();
    else ref.current.focus();
  };

  useEffect(() => {
    if (open) console.log("MilestoneEditModal build:", "v2025-10-06-modal-r8");
  }, [open]);

  const readOnly = useMemo(() => {
    const s =
      milestone?.agreement_state ||
      milestone?.agreement_status ||
      milestone?.agreementState ||
      milestone?.agreementStatus ||
      milestone?.agreement?.state ||
      milestone?.agreement?.status ||
      "";
    return isLockedAgreementState(s);
  }, [milestone]);

  const agreementId =
    milestone?.agreement ??
    milestone?.agreement_id ??
    milestone?.agreement_number ??
    milestone?.agreement?.id ??
    null;

  // keep an original snapshot for diffing
  const [original, setOriginal] = useState(null);

  useEffect(() => {
    if (open && milestone) {
      const snapshot = {
        title: milestone.title || "",
        start_date: milestone.start_date || "",
        end_date: milestone.end_date || milestone.completion_date || "",
        amount: milestone.amount == null ? "" : String(milestone.amount),
        description: milestone.description || "",
        status: milestone.status || "Incomplete",
      };
      setOriginal(snapshot);
      setForm(snapshot);
      setComment("");
      setFile(null);
      setUploadError("");
      if (agreementId) reloadAttachments(agreementId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, milestone]);

  const reloadAttachments = async (agId) => {
    setLoadingAttachments(true);
    try {
      const { data } = await api.get(`/projects/agreements/${agId}/attachments/`);
      const list = Array.isArray(data) ? data : [];
      list.sort((a, b) => (b.id || 0) - (a.id || 0));
      setRecentAttachments(list.slice(0, 10));
    } catch {
      setRecentAttachments([]);
    } finally {
      setLoadingAttachments(false);
    }
  };

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  // diff-only payload builder with normalization
  const buildDiffPayload = (allowOverlap = false) => {
    const payload = {};
    const addIfChanged = (key, transform = (x) => x) => {
      const cur = form[key];
      const prev = original ? original[key] : undefined;
      const val = transform(cur);
      if (prev !== cur && val !== undefined) payload[key] = val;
    };

    // title/description (trim title)
    addIfChanged("title", (v) => (v?.trim() ? v.trim() : undefined));
    addIfChanged("description", (v) => (v !== undefined ? v : undefined));

    // amount -> number; skip if blank
    addIfChanged("amount", (v) => (v === "" ? undefined : Number(v)));

    // dates (YYYY-MM-DD); when end_date changes, also send completion_date
    const normDate = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    const endBefore = original ? original.end_date : undefined;
    const endAfter = form.end_date;

    addIfChanged("start_date", normDate);
    addIfChanged("end_date", normDate);
    if (endAfter !== endBefore && normDate(endAfter)) {
      payload["completion_date"] = normDate(endAfter);
    }

    // status only if allowed & changed
    if (form.status && ALLOWED_STATUS.has(form.status)) {
      if (!original || original.status !== form.status) payload.status = form.status;
    }

    if (allowOverlap) payload.allow_overlap = true;
    return payload;
  };

  // overlap-aware save: try normal, detect overlap error → confirm → retry with allow_overlap
  const save = useCallback(async () => {
    if (!milestone?.id) return;
    setSaving(true);

    const attempt = async (payload) => {
      return api.patch(`/projects/milestones/${milestone.id}/`, payload);
    };

    try {
      // Attempt 1 — normal diff-only
      const payload1 = buildDiffPayload(false);
      if (Object.keys(payload1).length === 0) {
        toast("No changes to save.");
        setSaving(false);
        return;
      }
      await attempt(payload1);
      toast.success("Milestone saved");
      onSaved && onSaved({ id: milestone.id });
      onClose && onClose();
    } catch (err1) {
      const resp = err1?.response;
      const body = resp?.data;
      const bodyStr =
        (typeof body === "string" ? body : JSON.stringify(body)) ||
        resp?.statusText ||
        err1?.message ||
        "";

      const isOverlap =
        body &&
        typeof body === "object" &&
        Array.isArray(body.non_field_errors) &&
        body.non_field_errors.some((t) =>
          String(t).toLowerCase().includes("overlap")
        );

      if (isOverlap) {
        // Prompt user to proceed
        const ok = window.confirm(
          "This milestone overlaps another milestone in the same agreement.\n\nDo you want to save anyway?"
        );
        if (!ok) {
          setSaving(false);
          return;
        }
        try {
          const payload2 = buildDiffPayload(true); // allow_overlap: true
          await attempt(payload2);
          toast.success("Milestone saved (overlap allowed)");
          onSaved && onSaved({ id: milestone.id });
          onClose && onClose();
        } catch (err2) {
          const r2 = err2?.response;
          const b2 =
            (r2?.data && (typeof r2.data === "string" ? r2.data : JSON.stringify(r2.data))) ||
            r2?.statusText ||
            err2?.message ||
            "Save failed";
          toast.error(`Save failed: ${b2}`);
          console.error("PATCH error payload:", r2?.data ?? b2);
        } finally {
          setSaving(false);
        }
      } else {
        // Not an overlap error → show exact backend message
        toast.error(`Save failed: ${bodyStr || "Unknown error"}`);
        console.error("PATCH error payload:", body ?? bodyStr);
        setSaving(false);
      }
    }
  }, [milestone, form, original, onSaved, onClose]);

  const sendComment = useCallback(async () => {
    if (!milestone?.id || !comment.trim()) return;
    setSendingComment(true);
    try {
      await api.post(
        `/projects/milestones/${milestone.id}/comments/`,
        { text: comment.trim() },
        { headers: { "Content-Type": "application/json" } }
      );
      toast.success("Comment added");
      setComment("");
    } catch (err) {
      console.error(err);
      toast.error("Comment failed (endpoint may be disabled)");
    } finally {
      setSendingComment(false);
    }
  }, [milestone, comment]);

  const fetchAgreementAttachments = async (agId) => {
    try {
      const { data } = await api.get(`/projects/agreements/${agId}/attachments/`);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  };

  // verified upload (nested → flat), only success after GET confirms
  const uploadFile = useCallback(async () => {
    if (!file) return;
    if (!agreementId) {
      toast.error("Missing agreement id for upload.");
      return;
    }

    setUploading(true);
    setUploadError("");

    const title = `${form.title || milestone.title || "Milestone"} — ${file.name}`;
    const postFD = (url, fd) =>
      api.post(url, fd, { headers: { "Content-Type": "multipart/form-data" } });

    const verify = async () => {
      const list = await fetchAgreementAttachments(agreementId);
      setRecentAttachments(list.slice(0, 10));
      return list.find(
        (a) => (a.title && a.title.includes(file.name)) || (a.filename && a.filename === file.name)
      );
    };

    // nested
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("agreement", String(agreementId)); // safe even when nested
      fd.append("title", title);
      fd.append("category", "OTHER");
      await postFD(`/projects/agreements/${agreementId}/attachments/`, fd);
      const found = await verify();
      if (found) {
        toast.success("File uploaded");
        setFile(null);
        setUploading(false);
        return;
      }
    } catch {
      /* try flat next */
    }

    // flat
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("agreement", String(agreementId));
      fd.append("title", title);
      fd.append("category", "OTHER");
      await postFD(`/projects/attachments/`, fd);
      const found = await verify();
      if (found) {
        toast.success("File uploaded");
        setFile(null);
        setUploading(false);
        return;
      }
    } catch (e2) {
      const resp = e2?.response;
      const body =
        (resp?.data && (typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data))) ||
        resp?.statusText ||
        e2?.message ||
        "Upload failed";
      setUploadError(`HTTP ${resp?.status || 400}: ${body}`);
      toast.error(`Upload failed: ${body}`);
      setUploading(false);
      return;
    }

    // accepted but not visible
    setUploadError("Upload accepted but attachment not visible yet.");
    toast.error("Server accepted upload, but attachment not visible yet.");
    setUploading(false);
  }, [file, agreementId, form.title, milestone.title]);

  // DELETE attachment: try several paths, then refresh
  const deleteAttachment = useCallback(
    async (attachmentId) => {
      if (!agreementId) return;
      setDeletingId(attachmentId);

      const tryDelete = async (url) => api.delete(url);

      const paths = [
        `/projects/agreements/${agreementId}/attachments/${attachmentId}/`,
        `/projects/agreements/${agreementId}/attachments/${attachmentId}`,
        `/projects/attachments/${attachmentId}/`,
        `/projects/attachments/${attachmentId}`,
      ];

      let ok = false;
      let lastErr = null;

      for (const p of paths) {
        try {
          await tryDelete(p);
          ok = true;
          break;
        } catch (e) {
          lastErr = e;
        }
      }

      if (!ok) {
        const resp = lastErr?.response;
        const body =
          (resp?.data && (typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data))) ||
          resp?.statusText ||
          lastErr?.message ||
          "Delete failed";
        toast.error(`Delete failed: ${body}`);
        setDeletingId(null);
        return;
      }

      await reloadAttachments(agreementId);
      toast.success("Attachment deleted");
      setDeletingId(null);
    },
    [agreementId]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/40 p-6 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div className="text-sm text-gray-500">
            {milestone?.agreement_number
              ? `Agreement #${milestone.agreement_number}`
              : milestone?.agreement_id
              ? `Agreement ID ${milestone.agreement_id}`
              : null}
          </div>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100"
            aria-label="Close"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 pb-5 pt-3">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Title */}
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Title</label>
              <input
                type="text"
                name="title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                readOnly={readOnly}
                className={`w-full rounded border px-3 py-2 text-sm ${readOnly ? "bg-gray-50 text-gray-600" : ""}`}
                placeholder="e.g., Install Sink and Mirror"
              />
            </div>

            {/* Amount */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Amount ($)</label>
              <input
                type="number"
                step="0.01"
                name="amount"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                readOnly={readOnly}
                className={`w-full rounded border px-3 py-2 text-sm text-right ${readOnly ? "bg-gray-50 text-gray-600" : ""}`}
              />
              <div className="mt-1 text-xs text-gray-400">Preview: ${dollar(form.amount)}</div>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Start Date</label>
                <div style={{ position: "relative", overflow: "visible" }}>
                  <input
                    ref={startRef}
                    type="date"
                    name="start_date"
                    value={form.start_date || ""}
                    onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                    readOnly={readOnly}
                    className={`w-full rounded border px-3 py-2 text-sm ${readOnly ? "bg-gray-50 text-gray-600" : ""}`}
                    style={{ paddingRight: "2.5rem" }}
                  />
                  <CalendarBtn title="Open start date" onClick={() => openPicker(startRef)} disabled={readOnly} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Completion Date</label>
                <div style={{ position: "relative", overflow: "visible" }}>
                  <input
                    ref={endRef}
                    type="date"
                    name="end_date"
                    value={form.end_date || ""}
                    onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                    readOnly={readOnly}
                    className={`w-full rounded border px-3 py-2 text-sm ${readOnly ? "bg-gray-50 text-gray-600" : ""}`}
                    style={{ paddingRight: "2.5rem" }}
                  />
                  <CalendarBtn title="Open completion date" onClick={() => openPicker(endRef)} disabled={readOnly} />
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
              <textarea
                name="description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                readOnly={readOnly}
                rows={4}
                className={`w-full rounded border px-3 py-2 text-sm ${readOnly ? "bg-gray-50 text-gray-600" : ""}`}
                placeholder="Work description…"
              />
            </div>
          </div>

          {/* Controls */}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={save}
              disabled={saving || readOnly}
              className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
            <button
              onClick={() => { save(); onClose && onClose(); }}
              disabled={saving || readOnly}
              className="rounded bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-black disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {saving ? "Saving…" : "Save & Close"}
            </button>
            <div className="flex-1" />
            <button
              onClick={async () => {
                try { await onMarkComplete?.(milestone.id); }
                catch (e) { console.error(e); toast.error("Could not mark complete"); }
              }}
              className="rounded bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
              title="Mark Complete to submit for review. Invoicing happens after approval."
            >
              ✓ Complete → Review
            </button>
          </div>

          {/* Files + Recent Attachments */}
          <div className="mt-6">
            <div className="text-sm font-medium text-gray-700">Files</div>
            <div className="mt-2 flex items-center gap-2">
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={uploading} />
              <button
                onClick={uploadFile}
                disabled={!file || uploading}
                className="rounded bg-gray-100 px-3 py-1.5 text-sm hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-gray-100"
              >
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </div>
            {!!uploadError && <div className="mt-2 text-xs text-red-600">Server response: {uploadError}</div>}

            <div className="mt-4">
              <div className="text-sm font-medium text-gray-700 mb-2">Recent Attachments</div>
              {loadingAttachments ? (
                <div className="text-xs text-gray-500">Loading…</div>
              ) : recentAttachments.length ? (
                <ul className="space-y-1 text-sm">
                  {recentAttachments.map((a) => {
                    const url = urlFor(a);
                    return (
                      <li key={a.id || `${a.title}-${a.filename}-${Math.random()}`} className="flex items-center justify-between">
                        <span className="truncate">
                          {(a.category ? `[${String(a.category).toUpperCase()}] ` : "")}
                          {a.title || a.filename || "Attachment"}
                        </span>
                        <span className="ml-3 flex items-center gap-3">
                          {url ? (
                            <a className="text-blue-600 hover:underline" href={url} target="_blank" rel="noreferrer">
                              Download
                            </a>
                          ) : (
                            <span className="text-gray-400">No link</span>
                          )}
                          <button
                            onClick={() => deleteAttachment(a.id)}
                            disabled={deletingId === a.id}
                            className="text-red-600 hover:text-red-700 disabled:text-red-300"
                            title="Delete attachment"
                          >
                            {deletingId === a.id ? "Deleting…" : "Delete"}
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="text-xs text-gray-500">No attachments yet.</div>
              )}
              <div className="mt-2">
                <button
                  onClick={() => agreementId && reloadAttachments(agreementId)}
                  className="rounded bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200"
                >
                  Refresh
                </button>
              </div>
            </div>
          </div>

          {/* Comments */}
          <div className="mt-6">
            <div className="text-sm font-medium text-gray-700">Comments</div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a comment…"
                className="flex-1 rounded border px-3 py-2 text-sm"
              />
              <button
                onClick={sendComment}
                disabled={!comment.trim() || sendingComment}
                className="rounded bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
              >
                {sendingComment ? "Sending…" : "Send"}
              </button>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Mark <strong>Complete</strong> to submit for review. Invoicing happens after approval.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
