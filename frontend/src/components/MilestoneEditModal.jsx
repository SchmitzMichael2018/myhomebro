// src/components/MilestoneEditModal.jsx
// v2025-10-06-calendar-wrap — wraps both date inputs with .calendar-date-wrap + button.

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import api from "../api";

const dollar = (v) => {
  if (v === "" || v === null || v === undefined) return "";
  const num = Number(v);
  if (Number.isNaN(num)) return v;
  return num.toFixed(2);
};

const isLockedAgreementState = (s) => {
  if (!s) return false;
  const up = String(s).trim().toUpperCase();
  return ["SIGNED", "EXECUTED", "ACTIVE", "APPROVED", "ARCHIVED"].includes(up);
};

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

  const startRef = useRef(null);
  const endRef = useRef(null);
  const openPicker = (ref) => {
    if (!ref?.current) return;
    if (typeof ref.current.showPicker === "function") ref.current.showPicker();
    else ref.current.focus();
  };

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

  useEffect(() => {
    if (open && milestone) {
      setForm({
        title: milestone.title || "",
        start_date: milestone.start_date || "",
        end_date: milestone.end_date || milestone.completion_date || "",
        amount:
          milestone.amount === null || milestone.amount === undefined
            ? ""
            : String(milestone.amount),
        description: milestone.description || "",
        status: milestone.status || "Incomplete",
      });
      setComment("");
      setFile(null);
    }
  }, [open, milestone]);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const save = useCallback(async () => {
    if (!milestone?.id) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        completion_date: form.end_date || null,
        amount:
          form.amount === "" || form.amount === null
            ? null
            : Number(form.amount),
        description: form.description,
        status: form.status,
      };
      const { data } = await api.patch(
        `/projects/milestones/${milestone.id}/`,
        payload
      );
      toast.success("Milestone saved");
      onSaved && onSaved(data);
      onClose && onClose();
    } catch (err) {
      console.error(err);
      toast.error("Unable to save milestone");
    } finally {
      setSaving(false);
    }
  }, [milestone, form, onSaved, onClose]);

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

  const uploadFile = useCallback(async () => {
    if (!milestone?.id || !file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await api.post(
        `/projects/milestones/${milestone.id}/files/`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      toast.success("File uploaded");
      setFile(null);
    } catch (err) {
      console.error(err);
      toast.error("Upload failed (endpoint may be disabled)");
    } finally {
      setUploading(false);
    }
  }, [milestone, file]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/40 p-6 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div className="text-sm text-gray-500">
            {milestone?.agreement_number
              ? `Agreement #${milestone.agreement_number} `
              : milestone?.agreement_id
              ? `Agreement ID ${milestone.agreement_id} `
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

        {/* Read-only banner */}
        {readOnly && (
          <div className="mx-5 mt-4 rounded-md bg-indigo-50 px-4 py-2 text-xs text-indigo-700">
            Agreement has been executed — milestone fields are read-only.
          </div>
        )}

        {/* Body */}
        <div className="px-5 pb-5 pt-3">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Title */}
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Title
              </label>
              <input
                type="text"
                name="title"
                value={form.title}
                onChange={onChange}
                readOnly={readOnly}
                className={`w-full rounded border px-3 py-2 text-sm ${
                  readOnly ? "bg-gray-50 text-gray-600" : ""
                }`}
                placeholder="e.g., Install Sink and Mirror"
              />
            </div>

            {/* Amount */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Amount ($)
              </label>
              <input
                type="number"
                step="0.01"
                name="amount"
                value={form.amount}
                onChange={onChange}
                readOnly={readOnly}
                className={`w-full rounded border px-3 py-2 text-sm text-right ${
                  readOnly ? "bg-gray-50 text-gray-600" : ""
                }`}
              />
              <div className="mt-1 text-xs text-gray-400">
                Preview: ${dollar(form.amount)}
              </div>
            </div>

            {/* Dates with calendar buttons */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Start Date
                </label>
                <div className="calendar-date-wrap">
                  <input
                    ref={startRef}
                    type="date"
                    name="start_date"
                    value={form.start_date || ""}
                    onChange={onChange}
                    readOnly={readOnly}
                    className={`w-full rounded border px-3 py-2 text-sm ${
                      readOnly ? "bg-gray-50 text-gray-600" : ""
                    }`}
                  />
                  <button
                    type="button"
                    className="calendar-date-button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => openPicker(startRef)}
                    aria-label="Open start date calendar"
                    title="Pick a date"
                    disabled={readOnly}
                  >
                    <span role="img" aria-label="calendar">📅</span>
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Completion Date
                </label>
                <div className="calendar-date-wrap">
                  <input
                    ref={endRef}
                    type="date"
                    name="end_date"
                    value={form.end_date || ""}
                    onChange={onChange}
                    readOnly={readOnly}
                    className={`w-full rounded border px-3 py-2 text-sm ${
                      readOnly ? "bg-gray-50 text-gray-600" : ""
                    }`}
                  />
                  <button
                    type="button"
                    className="calendar-date-button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => openPicker(endRef)}
                    aria-label="Open completion date calendar"
                    title="Pick a date"
                    disabled={readOnly}
                  >
                    <span role="img" aria-label="calendar">📅</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Description
              </label>
              <textarea
                name="description"
                value={form.description}
                onChange={onChange}
                readOnly={readOnly}
                rows={4}
                className={`w-full rounded border px-3 py-2 text-sm ${
                  readOnly ? "bg-gray-50 text-gray-600" : ""
                }`}
                placeholder="Work description…"
              />
            </div>
          </div>

          {/* Agreement meta */}
          <div className="mt-3 text-xs text-gray-500">
            <span className="mr-3">Agreement: —</span>
            <span className="mr-3">
              Escrow funded:{" "}
              <strong>{milestone?.escrow_funded ? "Yes" : "No"}</strong>
            </span>
          </div>

          {/* Controls */}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={save}
              disabled={saving || readOnly}
              className={`rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300`}
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
            <button
              onClick={() => {
                save();
                onClose && onClose();
              }}
              disabled={saving || readOnly}
              className="rounded bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-black disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {saving ? "Saving…" : "Save & Close"}
            </button>
            <div className="flex-1" />
            <button
              onClick={async () => {
                try {
                  await onMarkComplete?.(milestone.id);
                } catch (e) {
                  console.error(e);
                  toast.error("Could not mark complete");
                }
              }}
              className="rounded bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
              title="Mark Complete to submit for review. Invoicing happens after approval."
            >
              ✓ Complete → Review
            </button>
          </div>

          {/* Files */}
          <div className="mt-6">
            <div className="text-sm font-medium text-gray-700">Files</div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                disabled={uploading}
              />
              <button
                onClick={uploadFile}
                disabled={!file || uploading}
                className="rounded bg-gray-100 px-3 py-1.5 text-sm hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-gray-100"
              >
                {uploading ? "Uploading…" : "Upload"}
              </button>
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
              Mark <strong>Complete</strong> to submit for review. Invoicing
              happens after approval.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
