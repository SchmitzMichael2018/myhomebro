// src/components/MilestoneDetailModal.jsx
//
// Modal with:
// - Editable fields (title, amount, dates, description, completed)
// - Debounced autosave to localStorage (no toast)
// - Inline errors + scroll-to-first-invalid
// - Save Draft, Save Changes, Save & Close
// - Files / Comments / Send Invoice preserved
//
// Draft key: milestoneDraft:<id>
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";
import { useMilestoneData } from "../hooks/useMilestoneData";
import Modal from "./Modal";
import DateField from "./DateField";

const formatDuration = (isoDuration) => {
  if (!isoDuration) return "N/A";
  const matches = isoDuration.match(/P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?/);
  if (!matches) return isoDuration;
  return `${matches[1] || 0}d ${matches[2] || 0}h ${matches[3] || 0}m`;
};

const pickForm = (m) => ({
  title: m?.title || "",
  amount: (m?.amount ?? "") === null ? "" : (m?.amount ?? ""),
  description: m?.description || "",
  start_date: m?.start_date || "",
  completion_date: m?.completion_date || "",
  completed: !!m?.completed,
});

export default function MilestoneDetailModal({ visible, milestone, onClose }) {
  const milestoneId = milestone?.id;
  const draftKey = useMemo(
    () => (milestoneId ? `milestoneDraft:${milestoneId}` : null),
    [milestoneId]
  );
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const {
    files,
    comments,
    invoice,
    loading,
    error,
    addFile,
    removeFile,
    addComment,
    sendInvoice,
    refetch,
  } = useMilestoneData(milestoneId);

  // Editable state
  const [form, setForm] = useState(pickForm(milestone));
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [loadedFromDraft, setLoadedFromDraft] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);

  // Inline errors
  const [fieldErrors, setFieldErrors] = useState({});

  // Action spinners
  const [uploading, setUploading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null); // 'comment' | 'invoice' | 'save'

  // Refs for scroll-to-first-invalid
  const titleRef = useRef(null);
  const amountRef = useRef(null);
  const startRef = useRef(null);
  const completionRef = useRef(null);
  const descriptionRef = useRef(null);

  // (Re)hydrate when opened or when milestone changes
  useEffect(() => {
    if (!visible) return;
    const base = pickForm(milestone);
    setForm(base);
    setFieldErrors({});
    setLoadedFromDraft(false);
    setLastSavedAt(null);

    if (draftKey) {
      try {
        const raw = localStorage.getItem(draftKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.form) {
            setForm({ ...base, ...parsed.form });
            setLastSavedAt(parsed.lastSavedAt || null);
            setLoadedFromDraft(true);
          }
        }
      } catch {
        /* ignore parse errors */
      }
    }
  }, [visible, milestone, draftKey]);

  // Dirtiness vs. milestone snapshot
  const isDirty = useMemo(() => {
    if (!milestone) return false;
    const base = pickForm(milestone);
    const norm = (v) => (v === "" ? "" : Number(v) || v);
    return !(
      base.title === form.title &&
      norm(base.amount) === norm(form.amount) &&
      base.description === form.description &&
      base.start_date === form.start_date &&
      base.completion_date === form.completion_date &&
      base.completed === form.completed
    );
  }, [milestone, form]);

  // Debounced autosave (silent banner only)
  useEffect(() => {
    if (!visible || !milestoneId) return;
    const t = setTimeout(() => {
      if (!isDirty || !draftKey) return;
      try {
        const ts = new Date().toISOString();
        localStorage.setItem(draftKey, JSON.stringify({ form, lastSavedAt: ts }));
        setLastSavedAt(ts);
        setLoadedFromDraft(true);
        setAutoSaving(true);
        setTimeout(() => setAutoSaving(false), 500);
      } catch {
        /* ignore write errors */
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [form, isDirty, visible, draftKey, milestoneId]);

  const handleField = (field, value) => {
    setForm((prev) => {
      let v = value;
      if (field === "amount") {
        v = value === "" ? "" : Number(value);
        if (Number.isNaN(v)) v = "";
      }
      if (field === "completed") v = !!value;
      return { ...prev, [field]: v };
    });
    setFieldErrors((prev) => ({ ...prev, [field]: "" })); // clear error as you type
  };

  const saveDraft = () => {
    if (!draftKey) return;
    try {
      const ts = new Date().toISOString();
      localStorage.setItem(draftKey, JSON.stringify({ form, lastSavedAt: ts }));
      setLastSavedAt(ts);
      setLoadedFromDraft(true);
      toast.success("Draft saved.");
    } catch {
      toast.error("Unable to save draft locally.");
    }
  };

  const discardDraft = () => {
    if (!draftKey) return;
    try {
      localStorage.removeItem(draftKey);
    } catch {}
    const base = pickForm(milestone);
    setForm(base);
    setLastSavedAt(null);
    setLoadedFromDraft(false);
    setFieldErrors({});
    toast("Draft discarded.");
  };

  const validateForm = () => {
    const errs = {};
    if (!String(form.title || "").trim()) errs.title = "Title is required";
    if (form.amount !== "" && !Number.isFinite(Number(form.amount)))
      errs.amount = "Enter a valid amount";
    if (form.start_date && form.completion_date) {
      if (new Date(form.completion_date) < new Date(form.start_date)) {
        errs.completion_date = "Completion must be on or after start";
      }
    }
    return errs;
  };

  const scrollToFirstError = (errs) => {
    const order = ["title", "amount", "start_date", "completion_date", "description"];
    const map = {
      title: titleRef,
      amount: amountRef,
      start_date: startRef,
      completion_date: completionRef,
      description: descriptionRef,
    };
    for (const key of order) {
      if (errs[key]) {
        const node = map[key]?.current;
        if (node && node.scrollIntoView) {
          node.scrollIntoView({ behavior: "smooth", block: "center" });
          if (node.focus) setTimeout(() => node.focus(), 50);
        }
        break;
      }
    }
  };

  const saveChanges = async ({ closeAfter = false } = {}) => {
    const errs = validateForm();
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      toast.error("Please fix the highlighted fields.");
      scrollToFirstError(errs);
      return;
    }

    if (!milestoneId) return;
    setActionLoading("save");
    try {
      const payload = {
        title: form.title,
        amount: form.amount === "" ? 0 : Number(form.amount),
        description: form.description,
        start_date: form.start_date || null,
        completion_date: form.completion_date || null,
        completed: !!form.completed,
      };
      const { data } = await api.patch(`/milestones/${milestoneId}/`, payload);
      // clear draft
      if (draftKey) {
        try {
          localStorage.removeItem(draftKey);
        } catch {}
      }
      setLastSavedAt(null);
      setLoadedFromDraft(false);
      setFieldErrors({});
      // refresh ancillary info
      try {
        await refetch();
      } catch {}
      toast.success("Milestone saved.");
      // update form baseline
      setForm(pickForm(data));

      if (closeAfter) onClose?.();
    } catch (err) {
      const msg = err?.response?.data
        ? Object.entries(err.response.data)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
            .join(" | ")
        : "Failed to save milestone.";
      toast.error(msg || "Failed to save milestone.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleClose = () => {
    // offer a quick autosave on close instead of losing edits
    if (isDirty && draftKey) {
      try {
        const ts = new Date().toISOString();
        localStorage.setItem(draftKey, JSON.stringify({ form, lastSavedAt: ts }));
        setLastSavedAt(ts);
        setLoadedFromDraft(true);
      } catch {}
    }
    onClose?.();
  };

  // Files
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !milestoneId) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("milestone", milestoneId);
    try {
      const { data } = await api.post("/milestone-files/", formData);
      addFile(data);
      toast.success("File uploaded successfully.");
    } catch {
      toast.error("Upload failed.");
    } finally {
      setUploading(false);
      try {
        e.target.value = "";
      } catch {}
    }
  };

  const handleFileDelete = async (fileId) => {
    if (!window.confirm("Delete this file?")) return;
    try {
      await api.delete(`/milestone-files/${fileId}/`);
      removeFile(fileId);
      toast.success("File deleted.");
    } catch {
      toast.error("Failed to delete file.");
    }
  };

  // Comments
  const [commentText, setCommentText] = useState("");
  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    if (!commentText.trim() || !milestoneId) return;
    setActionLoading("comment");
    try {
      const { data } = await api.post(`/milestones/${milestoneId}/comments/`, {
        content: commentText.trim(),
      });
      addComment(data);
      setCommentText("");
    } catch {
      toast.error("Could not post comment.");
    } finally {
      setActionLoading(null);
    }
  };

  // Invoice
  const handleSendInvoice = async () => {
    if (!window.confirm("Send this milestone as an invoice to the homeowner?")) return;
    setActionLoading("invoice");
    try {
      await sendInvoice();
      await refetch();
    } catch {
      /* sendInvoice may toast internally */
    } finally {
      setActionLoading(null);
    }
  };

  const previewAmount =
    form.amount === "" ? 0 : Number.isFinite(Number(form.amount)) ? Number(form.amount) : 0;

  return (
    <Modal visible={visible} onClose={handleClose} title={`Milestone: ${milestone?.title || "Untitled"}`}>
      <div className="space-y-6">
        {/* Draft banner */}
        {(loadedFromDraft || lastSavedAt) && (
          <div className="p-3 rounded bg-yellow-50 border border-yellow-200 text-yellow-800 flex items-center justify-between">
            <div className="text-sm">
              {loadedFromDraft ? "Loaded local draft." : "Draft available."}{" "}
              {lastSavedAt && (
                <span className="opacity-80">
                  {autoSaving ? "Auto-saved " : "Last saved "}
                  {new Date(lastSavedAt).toLocaleString()}
                </span>
              )}
            </div>
            <button onClick={discardDraft} className="text-sm underline hover:opacity-80">
              Discard draft
            </button>
          </div>
        )}

        {/* Editable Details */}
        <div className="border rounded-lg p-4">
          <h4 className="font-semibold mb-3">Details</h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Title</label>
              <input
                ref={titleRef}
                value={form.title}
                onChange={(e) => handleField("title", e.target.value)}
                placeholder="Milestone Title"
                className={`w-full border rounded px-3 py-2 ${fieldErrors.title ? "ring-1 ring-red-500" : ""}`}
                aria-invalid={!!fieldErrors.title}
              />
              {fieldErrors.title && <div className="text-xs text-red-600 mt-1">{fieldErrors.title}</div>}
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">Amount ($)</label>
              <input
                ref={amountRef}
                type="number"
                min="0"
                step="0.01"
                value={form.amount === "" ? "" : form.amount}
                onChange={(e) => handleField("amount", e.target.value)}
                className={`w-full border rounded px-3 py-2 ${fieldErrors.amount ? "ring-1 ring-red-500" : ""}`}
                placeholder="0.00"
                aria-invalid={!!fieldErrors.amount}
              />
              {fieldErrors.amount && <div className="text-xs text-red-600 mt-1">{fieldErrors.amount}</div>}
              <div className="text-xs text-gray-500 mt-1">
                Preview: {previewAmount.toLocaleString("en-US", { style: "currency", currency: "USD" })}
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">Completed</label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!form.completed}
                  onChange={(e) => handleField("completed", e.target.checked)}
                />
                Mark as Completed
              </label>
            </div>

            <div className="sm:col-span-1">
              <label className="block text-sm text-gray-600 mb-1">Start Date</label>
              <DateField
                // anchor ref for scroll—put a tiny anchor element
                value={form.start_date || ""}
                onChange={(e) => handleField("start_date", e.target.value)}
                min={today}
                className={`${fieldErrors.start_date ? "ring-1 ring-red-500" : ""}`}
              />
              {fieldErrors.start_date && <div className="text-xs text-red-600 mt-1">{fieldErrors.start_date}</div>}
              <div ref={startRef} className="sr-only" />
            </div>

            <div className="sm:col-span-1">
              <label className="block text-sm text-gray-600 mb-1">Completion Date</label>
              <DateField
                value={form.completion_date || ""}
                onChange={(e) => handleField("completion_date", e.target.value)}
                min={form.start_date || today}
                className={`${fieldErrors.completion_date ? "ring-1 ring-red-500" : ""}`}
              />
              {fieldErrors.completion_date && (
                <div className="text-xs text-red-600 mt-1">{fieldErrors.completion_date}</div>
              )}
              <div ref={completionRef} className="sr-only" />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Description</label>
              <textarea
                ref={descriptionRef}
                value={form.description}
                onChange={(e) => handleField("description", e.target.value)}
                className="w-full border rounded px-3 py-2"
                rows={4}
                placeholder="What work is included for this milestone?"
              />
            </div>
          </div>

          {/* Save actions */}
          <div className="flex items-center justify-between mt-4">
            <button
              type="button"
              onClick={saveDraft}
              className="px-3 py-2 rounded border hover:bg-gray-50"
            >
              Save Draft
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => saveChanges({ closeAfter: false })}
                disabled={actionLoading === "save" /* allow save if not dirty? we rely on validation */}
                className={`px-3 py-2 rounded text-white ${
                  actionLoading === "save" ? "bg-gray-400 cursor-wait" : "bg-green-600 hover:bg-green-700"
                }`}
              >
                {actionLoading === "save" ? "Saving…" : "Save Changes"}
              </button>
              <button
                type="button"
                onClick={() => saveChanges({ closeAfter: true })}
                disabled={actionLoading === "save"}
                className={`px-3 py-2 rounded text-white ${
                  actionLoading === "save" ? "bg-gray-400 cursor-wait" : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {actionLoading === "save" ? "Saving…" : "Save & Close"}
              </button>
            </div>
          </div>
        </div>

        {/* Server-calculated duration (read-only) */}
        <p className="text-sm text-gray-600">
          Duration (server): {formatDuration(milestone?.duration)}
        </p>

        {/* Files */}
        <div className="border-t pt-4">
          <h4 className="font-semibold mb-2">Upload Files</h4>
          <input type="file" onChange={handleFileChange} disabled={uploading} />
          <ul className="mt-2 space-y-1 text-sm">
            {files.map((file) => (
              <li key={file.id} className="flex justify-between items-center">
                <a
                  href={file.file}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 underline break-all"
                >
                  {file.file.split("/").pop()}
                </a>
                <button
                  onClick={() => handleFileDelete(file.id)}
                  className="text-red-600 hover:underline"
                  title="Delete file"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Comments */}
        <div className="border-t pt-4">
          <h4 className="font-semibold mb-2">Comments</h4>
          <form onSubmit={handleCommentSubmit} className="flex gap-2">
            <input
              type="text"
              placeholder="Add a comment…"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              className="flex-1 border p-2 rounded"
            />
            <button
              type="submit"
              disabled={actionLoading === "comment"}
              className="bg-blue-600 text-white px-4 py-2 rounded"
            >
              {actionLoading === "comment" ? "…" : "Send"}
            </button>
          </form>
          <ul className="mt-2 text-sm space-y-1 max-h-40 overflow-auto pr-1">
            {comments.map((c) => (
              <li key={c.id} className="break-words">
                <strong>{c.author_name}</strong>: {c.content}
              </li>
            ))}
          </ul>
        </div>

        {/* Invoice */}
        {invoice ? (
          <div className="text-green-700 font-bold">Invoice sent ✅</div>
        ) : (
          <button
            onClick={handleSendInvoice}
            disabled={actionLoading === "invoice"}
            className="bg-green-600 text-white px-4 py-2 rounded mt-4"
            type="button"
          >
            {actionLoading === "invoice" ? "Sending…" : "Send Invoice"}
          </button>
        )}
      </div>
    </Modal>
  );
}
