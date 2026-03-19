// src/components/MilestoneEditModal.jsx
// v2026-03-03 — FIX: allow completing milestones even when agreement is signed/locked
// - Split "editReadOnly" (fields locked) from "actionReadOnly" (actions disabled)
// - Signed/locked agreements: fields remain read-only, but ✓ Complete → Review is available
// - Completed agreements + URL readonly (?readonly=1): still action-disabled (no Complete / Save / uploads / comments)

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";

/* ---------------- helpers ---------------- */

const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "") ?? "";

const dollar = (v) => {
  if (v === "" || v === null || v === undefined) return "";
  const n = Number(v);
  return Number.isNaN(n) ? v : n.toFixed(2);
};

const fmtMoney = (n) => {
  if (n === null || n === undefined || n === "") return "";
  const num = typeof n === "number" ? n : parseFloat(n);
  if (Number.isNaN(num)) return "";
  return num.toLocaleString(undefined, { style: "currency", currency: "USD" });
};

// Normalize various input forms (Date/string) → "YYYY-MM-DD" or ""
function toDateOnly(v) {
  if (!v) return "";
  const s = String(v).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function friendlyDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// choose best download URL
const urlFor = (a) =>
  a?.file ||
  a?.url ||
  a?.file_url ||
  a?.download_url ||
  a?.download ||
  a?.absolute_url ||
  null;

// allowed statuses if backend validates
const ALLOWED_STATUS = new Set([
  "Incomplete",
  "Complete",
  "Pending",
  "Approved",
  "Disputed",
  "Scheduled",
  "INCOMPLETE",
  "COMPLETE",
  "PENDING",
  "APPROVED",
  "DISPUTED",
  "SCHEDULED",
]);

const safeMoneyFromAny = (v) => {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return fmtMoney(n);
};

const LOCK_CODES = new Set([
  "AGREEMENT_SIGNED_LOCKED",
  "AGREEMENT_COMPLETED_LOCKED",
  "MILESTONE_EDIT_LOCKED",
]);

const CHANGE_TYPES = [
  { value: "date_change", label: "Date Change" },
  { value: "amount_change", label: "Amount Change" },
  { value: "scope_product_change", label: "Product / Scope Change" },
  { value: "other", label: "Other" },
];

const safeJsonString = (v) => {
  try {
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

const truthy = (v) => v === true || v === 1 || v === "1" || String(v || "").toLowerCase() === "true";

/**
 * Completion gate for the UI (prevents 409 spam).
 *
 * Preferred fields (from backend MilestoneSerializer):
 *   - agreement_payment_mode ("escrow"|"direct")
 *   - agreement_escrow_funded (bool)
 *   - agreement_signature_is_satisfied (bool)
 *
 * Fallbacks supported for safety.
 */
function computeCompletionGate(milestone) {
  const meta = milestone?._meta || {};

  // ✅ Prefer canonical serializer output first
  const paymentModeRaw = String(
    pick(
      milestone?.agreement_payment_mode,
      milestone?.agreement?.payment_mode,
      meta.payment_mode,
      meta.paymentMode,
      milestone?.payment_mode,
      "escrow"
    )
  )
    .trim()
    .toLowerCase();

  const paymentMode = paymentModeRaw === "direct" ? "direct" : "escrow";

  const signatureSatisfied = truthy(
    pick(
      milestone?.agreement_signature_is_satisfied,
      milestone?.agreement?.signature_is_satisfied,
      meta.signature_is_satisfied,
      meta.signatureSatisfied,
      milestone?.signature_is_satisfied,
      // last-resort fallback: agreement_is_locked often meant "fully signed" in old world
      milestone?.agreement_is_locked,
      milestone?.agreementIsLocked,
      milestone?.agreement_locked
    )
  );

  const escrowFunded = truthy(
    pick(
      milestone?.agreement_escrow_funded, // ✅ canonical for escrow mode
      milestone?.agreement?.escrow_funded,
      meta.escrow_funded,
      meta.escrowFunded,
      meta.escrowFundedBool,
      milestone?._escrowFunded
    )
  );

  if (!signatureSatisfied) {
    return {
      ok: false,
      code: "SIGNATURE_REQUIRED",
      reason:
        paymentMode === "direct"
          ? "Signature required (or waived) before completing milestones (Direct Pay)."
          : "Signature required (or waived) before completing milestones (Escrow).",
      paymentMode,
    };
  }

  if (paymentMode === "escrow" && !escrowFunded) {
    return {
      ok: false,
      code: "ESCROW_REQUIRED",
      reason: "Escrow must be funded before completing milestones.",
      paymentMode,
    };
  }

  return { ok: true, code: "", reason: "", paymentMode };
}

/* ---------------- component ---------------- */

export default function MilestoneEditModal({
  open,
  onClose,
  milestone,
  onSaved,
  onMarkComplete,

  // Optional navigation hooks for origin actions:
  onViewMilestone,
  onViewInvoice,
}) {
  const navigate = useNavigate();
  const location = useLocation();

  // ✅ URL-driven readonly override (used for Invoice → Milestone Detail)
  const readonlyFromUrl = useMemo(() => {
    try {
      const qs = new URLSearchParams(location?.search || "");
      return qs.get("readonly") === "1" || String(qs.get("readonly") || "").toLowerCase() === "true";
    } catch {
      return false;
    }
  }, [location?.search]);

  const fromInvoice = useMemo(() => {
    try {
      const qs = new URLSearchParams(location?.search || "");
      return String(qs.get("from") || "").toLowerCase() === "invoice";
    } catch {
      return false;
    }
  }, [location?.search]);

  const [currentMilestone, setCurrentMilestone] = useState(milestone || null);

  const [form, setForm] = useState({
    title: "",
    start_date: "",
    end_date: "",
    amount: "",
    description: "",
    status: "Incomplete",
  });

  const [saving, setSaving] = useState(false);

  // comment box
  const [comment, setComment] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [comments, setComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);

  // files / attachments (agreement-level, like before)
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const [recentAttachments, setRecentAttachments] = useState([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  // ✅ backend lock-driven read-only state
  const [lockCode, setLockCode] = useState(null);
  const [lockMessage, setLockMessage] = useState("");

  // ✅ Request Change panel
  const [showRequestChange, setShowRequestChange] = useState(false);
  const [changeType, setChangeType] = useState("date_change");
  const [requestedDate, setRequestedDate] = useState("");
  const [requestedAmount, setRequestedAmount] = useState("");
  const [requestedScope, setRequestedScope] = useState("");
  const [requestedOther, setRequestedOther] = useState("");
  const [justification, setJustification] = useState("");
  const [submittingChange, setSubmittingChange] = useState(false);

  // snapshot for diffing
  const [original, setOriginal] = useState(null);

  useEffect(() => {
    if (open) console.log("MilestoneEditModal build:", "v2026-03-03-signed-complete");
  }, [open]);

  useEffect(() => {
    setCurrentMilestone(milestone || null);
  }, [milestone, open]);

  const agreementId =
    currentMilestone?.agreement ??
    currentMilestone?.agreement_id ??
    currentMilestone?.agreement_number ??
    currentMilestone?.agreement?.id ??
    null;

  const lockedSigned = lockCode === "AGREEMENT_SIGNED_LOCKED";
  const lockedCompleted = lockCode === "AGREEMENT_COMPLETED_LOCKED";

  /**
   * ✅ NEW split:
   * - editReadOnly: disables editing fields (signed/completed/url-readonly)
   * - actionReadOnly: disables actions (completed/url-readonly ONLY)
   *
   * Signed/locked should still allow "Complete → Review" (workflow), but keep fields view-only.
   */
  const editReadOnly = lockedSigned || lockedCompleted || readonlyFromUrl;
  const actionReadOnly = lockedCompleted || readonlyFromUrl;

  const completionGate = useMemo(() => computeCompletionGate(currentMilestone), [currentMilestone]);

  const wizardStep4Url = agreementId ? `/app/agreements/${agreementId}/wizard?step=4` : null;

  /* ---------- init form + init lock immediately from serializer fields ---------- */
  useEffect(() => {
    if (open && currentMilestone) {
      const snapshot = {
        title: currentMilestone.title || "",
        start_date: toDateOnly(currentMilestone.start_date || currentMilestone.start || ""),
        end_date: toDateOnly(
          currentMilestone.end_date ||
            currentMilestone.completion_date ||
            currentMilestone.end ||
            currentMilestone.due_date ||
            ""
        ),
        amount: currentMilestone.amount == null ? "" : String(currentMilestone.amount),
        description: currentMilestone.description || "",
        status: currentMilestone.status || "Incomplete",
      };
      setOriginal(snapshot);
      setForm(snapshot);
      setComment("");
      setFile(null);
      setUploadError("");

      // reset request-change UI
      setShowRequestChange(false);
      setChangeType("date_change");
      setRequestedDate("");
      setRequestedAmount("");
      setRequestedScope("");
      setRequestedOther("");
      setJustification("");
      setSubmittingChange(false);

      // ✅ immediate lock from serializer-provided flags
      const isCompleted = Boolean(
        currentMilestone?.agreement_is_completed ||
          currentMilestone?.agreementIsCompleted ||
          currentMilestone?.agreement_completed
      );
      const isLocked = Boolean(
        currentMilestone?.agreement_is_locked ||
          currentMilestone?.agreementIsLocked ||
          currentMilestone?.agreement_locked
      );

      if (isCompleted) {
        setLockCode("AGREEMENT_COMPLETED_LOCKED");
        setLockMessage("Agreement is completed. View-only — no amendments allowed.");
      } else if (isLocked) {
        setLockCode("AGREEMENT_SIGNED_LOCKED");
        setLockMessage("Agreement is signed/locked. Use Request Change to route through an amendment.");
      } else {
        setLockCode(null);
        setLockMessage("");
      }

      if (agreementId) reloadAttachments(agreementId);
      if (currentMilestone.id) reloadComments(currentMilestone.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentMilestone]);

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

  const reloadComments = async (milestoneId) => {
    setLoadingComments(true);
    try {
      const { data } = await api.get(`/projects/milestones/${milestoneId}/comments/`, {
        validateStatus: (s) => s >= 200 && s < 300,
      });
      setComments(Array.isArray(data) ? data : []);
    } catch (e) {
      console.warn("Failed to load milestone comments", e);
      setComments([]);
    } finally {
      setLoadingComments(false);
    }
  };

  const onChange = (e) => {
    const { name, value } = e.target;
    if (name === "start_date" || name === "end_date") {
      setForm((f) => ({ ...f, [name]: toDateOnly(value) }));
    } else {
      setForm((f) => ({ ...f, [name]: value }));
    }
  };

  /* ---------- rework/origin helpers ---------- */
  const origin = currentMilestone?.origin_milestone || null;
  const originTitle = origin?.title || "";
  const originOrder = origin?.order || null;
  const originInvoiceId = origin?.invoice_id || null;

  const originAmountLabel = useMemo(() => {
    const a = origin?.amount;
    const label = safeMoneyFromAny(a);
    return label || "";
  }, [origin]);

  const originStatusLabel = useMemo(() => {
    if (!origin) return "";
    const bits = [];
    bits.push(origin.completed ? "Completed" : "Not completed");
    if (origin.is_invoiced) bits.push("Invoiced");
    if (origin.invoice_id) bits.push(`Invoice #${origin.invoice_id}`);
    if (origin.is_overdue) bits.push("Overdue");
    return bits.join(" • ");
  }, [origin]);

  const handleViewOriginMilestone = useCallback(() => {
    if (!origin?.id) return;
    if (typeof onViewMilestone === "function") {
      onViewMilestone(origin.id);
      return;
    }
    toast(`Original milestone id: ${origin.id}`);
  }, [origin, onViewMilestone]);

  const handleViewOriginInvoice = useCallback(() => {
    if (!originInvoiceId) return;
    if (typeof onViewInvoice === "function") {
      onViewInvoice(originInvoiceId);
      return;
    }
    toast(`Original invoice id: ${originInvoiceId}`);
  }, [originInvoiceId, onViewInvoice]);

  /* ---------- diff-only payload with normalization ---------- */
  const buildDiffPayload = (allowOverlap = false) => {
    const payload = {};
    const addIfChanged = (key, transform = (x) => x) => {
      const cur = form[key];
      const prev = original ? original[key] : undefined;
      const val = transform(cur);
      if (prev !== cur && val !== undefined) payload[key] = val;
    };

    addIfChanged("title", (v) => (v?.trim() ? v.trim() : undefined));
    addIfChanged("description", (v) => (v !== undefined ? v : undefined));
    addIfChanged("amount", (v) => (v === "" ? undefined : Number(v)));

    const normDate = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    const endBefore = original ? original.end_date : undefined;
    const endAfter = form.end_date;

    addIfChanged("start_date", (v) => normDate(toDateOnly(v)));
    addIfChanged("end_date", (v) => normDate(toDateOnly(v)));
    if (endAfter !== endBefore && normDate(toDateOnly(endAfter))) {
      payload["completion_date"] = normDate(toDateOnly(endAfter));
    }

    if (form.status && ALLOWED_STATUS.has(form.status)) {
      if (!original || original.status !== form.status) payload.status = form.status;
    }

    if (allowOverlap) payload.allow_overlap = true;
    return payload;
  };

  const detectLockFromError = (err) => {
    const resp = err?.response;
    const code = resp?.data?.code;
    const detail = resp?.data?.detail;

    if (code && LOCK_CODES.has(code)) {
      setLockCode(code);
      setLockMessage(detail || "");
      return true;
    }

    const raw = safeJsonString(resp?.data || "");
    if (raw.includes("AGREEMENT_SIGNED_LOCKED")) {
      setLockCode("AGREEMENT_SIGNED_LOCKED");
      setLockMessage(detail || "Agreement is signed/locked.");
      return true;
    }
    if (raw.includes("AGREEMENT_COMPLETED_LOCKED")) {
      setLockCode("AGREEMENT_COMPLETED_LOCKED");
      setLockMessage(detail || "Agreement is completed.");
      return true;
    }
    return false;
  };

  /* ---------- save (overlap-aware) — does NOT close modal ---------- */
  const save = useCallback(async () => {
    if (!currentMilestone?.id) return { ok: false, data: null, locked: false };

    // ✅ saving is only allowed when not editReadOnly
    if (editReadOnly) {
      if (lockedCompleted) {
        toast.error("Completed agreements are view-only.");
      } else if (lockedSigned) {
        toast.error("This agreement is signed. Use Request Change to start an amendment.");
      } else {
        toast("Read-only view (opened from invoice).");
      }
      return { ok: false, data: null, locked: true };
    }

    setSaving(true);

    const attempt = async (payload) =>
      api.patch(`/projects/milestones/${currentMilestone.id}/`, payload);

    try {
      const payload1 = buildDiffPayload(false);

      if (Object.keys(payload1).length === 0) {
        toast("No changes to save.");
        return { ok: true, data: currentMilestone, locked: false };
      }

      const { data } = await attempt(payload1);
      toast.success("Milestone saved");

      if (data && typeof data === "object") {
        setCurrentMilestone(data);

        const snapshot = {
          title: data.title || "",
          start_date: toDateOnly(data.start_date || data.start || ""),
          end_date: toDateOnly(
            data.end_date || data.completion_date || data.end || data.due_date || ""
          ),
          amount: data.amount == null ? "" : String(data.amount),
          description: data.description || "",
          status: data.status || "Incomplete",
        };
        setOriginal(snapshot);
        setForm(snapshot);
      }

      onSaved && onSaved(data || { id: currentMilestone.id });
      return { ok: true, data: data || null, locked: false };
    } catch (err1) {
      if (detectLockFromError(err1)) {
        toast.error(
          lockCode === "AGREEMENT_COMPLETED_LOCKED"
            ? "Completed agreements are view-only."
            : "Agreement is signed/locked. Use Request Change to route through an amendment."
        );
        return { ok: false, data: null, locked: true };
      }

      const resp = err1?.response;
      const body = resp?.data;

      const isOverlap =
        body &&
        typeof body === "object" &&
        Array.isArray(body.non_field_errors) &&
        body.non_field_errors.some((t) => String(t).toLowerCase().includes("overlap"));

      if (isOverlap) {
        const ok = window.confirm(
          "This milestone overlaps another milestone in the same agreement.\n\nDo you want to save anyway?"
        );
        if (!ok) {
          return { ok: false, data: null, locked: false };
        }

        try {
          const payload2 = buildDiffPayload(true);
          const { data } = await attempt(payload2);
          toast.success("Milestone saved (overlap allowed)");

          if (data && typeof data === "object") {
            setCurrentMilestone(data);

            const snapshot = {
              title: data.title || "",
              start_date: toDateOnly(data.start_date || data.start || ""),
              end_date: toDateOnly(
                data.end_date || data.completion_date || data.end || data.due_date || ""
              ),
              amount: data.amount == null ? "" : String(data.amount),
              description: data.description || "",
              status: data.status || "Incomplete",
            };
            setOriginal(snapshot);
            setForm(snapshot);
          }

          onSaved && onSaved(data || { id: currentMilestone.id });
          return { ok: true, data: data || null, locked: false };
        } catch (err2) {
          if (detectLockFromError(err2)) {
            toast.error(
              lockCode === "AGREEMENT_COMPLETED_LOCKED"
                ? "Completed agreements are view-only."
                : "Agreement is signed/locked. Use Request Change to start an amendment."
            );
            return { ok: false, data: null, locked: true };
          }

          const r2 = err2?.response;
          const b2 =
            (r2?.data && (typeof r2.data === "string" ? r2.data : safeJsonString(r2.data))) ||
            r2?.statusText ||
            err2?.message ||
            "Save failed";
          toast.error(`Save failed: ${b2}`);
          console.error("PATCH error payload:", r2?.data ?? b2);
          return { ok: false, data: null, locked: false };
        }
      }

      const bodyStr =
        (typeof body === "string" ? body : safeJsonString(body)) ||
        resp?.statusText ||
        err1?.message ||
        "Unknown error";
      toast.error(`Save failed: ${bodyStr}`);
      console.error("PATCH error payload:", body ?? bodyStr);
      return { ok: false, data: null, locked: false };
    } finally {
      setSaving(false);
    }
  }, [
    currentMilestone,
    editReadOnly,
    lockedCompleted,
    lockedSigned,
    lockCode,
    form,
    original,
    onSaved,
  ]);

  /* ---------- comments ---------- */
  const sendComment = useCallback(async () => {
    if (actionReadOnly) {
      toast("Read-only view. Comments are disabled here.");
      return;
    }
    if (!currentMilestone?.id || !comment.trim()) return;
    setSendingComment(true);
    try {
      const { data } = await api.post(
        `/projects/milestones/${currentMilestone.id}/comments/`,
        { content: comment.trim() },
        { headers: { "Content-Type": "application/json" } }
      );
      toast.success("Comment added");
      setComment("");
      setComments((prev) => [data, ...(prev || [])]);
    } catch (err) {
      console.error(err);
      toast.error("Comment failed");
    } finally {
      setSendingComment(false);
    }
  }, [currentMilestone, comment, actionReadOnly]);

  /* ---------- attachments ---------- */
  const fetchAgreementAttachments = async (agId) => {
    try {
      const { data } = await api.get(`/projects/agreements/${agId}/attachments/`);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  };

  const uploadFile = useCallback(async () => {
    if (actionReadOnly) {
      toast("Read-only view. Upload is disabled here.");
      return;
    }
    if (!file) return;
    if (!agreementId) {
      toast.error("Missing agreement id for upload.");
      return;
    }

    setUploading(true);
    setUploadError("");

    const title = `${form.title || currentMilestone?.title || "Milestone"} — ${file.name}`;
    const postFD = (url, fd) =>
      api.post(url, fd, { headers: { "Content-Type": "multipart/form-data" } });

    const verify = async () => {
      const list = await fetchAgreementAttachments(agreementId);
      setRecentAttachments(list.slice(0, 10));
      return list.find(
        (a) =>
          (a.title && a.title.includes(file.name)) ||
          (a.filename && a.filename === file.name)
      );
    };

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("agreement", String(agreementId));
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
    } catch {}

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
        (resp?.data &&
          (typeof resp.data === "string" ? resp.data : safeJsonString(resp.data))) ||
        resp?.statusText ||
        e2?.message ||
        "Upload failed";
      setUploadError(`HTTP ${resp?.status || 400}: ${body}`);
      toast.error(`Upload failed: ${body}`);
      setUploading(false);
      return;
    }

    setUploadError("Upload accepted but attachment not visible yet.");
    toast.error("Server accepted upload, but attachment not visible yet.");
    setUploading(false);
  }, [file, agreementId, form.title, currentMilestone?.title, actionReadOnly]);

  const deleteAttachment = useCallback(
    async (attachmentId) => {
      if (actionReadOnly) {
        toast("Read-only view. Delete is disabled here.");
        return;
      }
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
          (resp?.data &&
            (typeof resp.data === "string"
              ? resp.data
              : safeJsonString(resp.data))) ||
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
    [agreementId, actionReadOnly]
  );

  /* ---------- HARDENED complete ---------- */
  const completeToReview = useCallback(async () => {
    // ✅ Completion is disabled only for completed agreements and URL readonly
    if (actionReadOnly) {
      toast("Read-only view. Completion is disabled here.");
      return;
    }
    if (!currentMilestone?.id) return;

    // ✅ UI gate: prevent 409 spam
    if (!completionGate.ok) {
      toast.error(completionGate.reason);
      if (wizardStep4Url) navigate(wizardStep4Url);
      return;
    }

    if (lockedCompleted) {
      toast.error("Completed agreements are view-only.");
      return;
    }

    if (currentMilestone.is_invoiced || currentMilestone.invoice_id) {
      toast.error("This milestone is already invoiced.");
      return;
    }

    if (typeof onMarkComplete === "function") {
      try {
        const maybe = await onMarkComplete(currentMilestone.id);
        if (maybe && typeof maybe === "object") {
          setCurrentMilestone(maybe);
          onSaved && onSaved(maybe);
          toast.success("Milestone marked complete");
          return;
        }
      } catch (e) {
        console.warn("onMarkComplete failed; falling back to API complete endpoint", e);
      }
    }

    try {
      let updated = null;
      try {
        const { data } = await api.post(
          `/projects/milestones/${currentMilestone.id}/complete/`,
          {},
          { headers: { "Content-Type": "application/json" } }
        );
        updated = data;
      } catch (e1) {
        const { data } = await api.patch(
          `/projects/milestones/${currentMilestone.id}/`,
          { completed: true },
          { headers: { "Content-Type": "application/json" } }
        );
        updated = data;
      }

      if (updated && typeof updated === "object") {
        setCurrentMilestone(updated);

        const snapshot = {
          title: updated.title || "",
          start_date: toDateOnly(updated.start_date || updated.start || ""),
          end_date: toDateOnly(
            updated.end_date ||
              updated.completion_date ||
              updated.end ||
              updated.due_date ||
              ""
          ),
          amount: updated.amount == null ? "" : String(updated.amount),
          description: updated.description || "",
          status: updated.status || "Incomplete",
        };
        setOriginal(snapshot);
        setForm(snapshot);

        toast.success("Milestone marked complete");
        onSaved && onSaved(updated);
        return;
      }

      toast.success("Milestone marked complete");
      onSaved && onSaved({ id: currentMilestone.id });
    } catch (e) {
      const code = e?.response?.data?.code;
      const detail = e?.response?.data?.detail;

      if (code === "ESCROW_REQUIRED" || code === "SIGNATURE_REQUIRED") {
        toast.error(detail || "Action blocked. Please finalize agreement requirements.");
        if (wizardStep4Url) navigate(wizardStep4Url);
        return;
      }

      if (detectLockFromError(e)) {
        toast.error(
          lockCode === "AGREEMENT_COMPLETED_LOCKED"
            ? "Completed agreements are view-only."
            : "Agreement is locked."
        );
        return;
      }

      console.error(e);
      const resp = e?.response;
      const body =
        (resp?.data &&
          (typeof resp.data === "string" ? resp.data : safeJsonString(resp.data))) ||
        resp?.statusText ||
        e?.message ||
        "Could not mark complete";
      toast.error(body);
    }
  }, [
    currentMilestone,
    onMarkComplete,
    onSaved,
    lockedCompleted,
    lockCode,
    completionGate,
    wizardStep4Url,
    navigate,
    actionReadOnly,
  ]);

  /* ---------- Request Change ---------- */
  const submitRequestChange = useCallback(async () => {
    if (!currentMilestone?.id) return;
    if (!agreementId) {
      toast.error("Missing agreement id.");
      return;
    }
    if (lockedCompleted) {
      toast.error("Completed agreements cannot be amended.");
      return;
    }
    if (!justification.trim()) {
      toast.error("Please provide a justification.");
      return;
    }

    const requested_changes = {};

    if (changeType === "date_change") {
      const d = toDateOnly(requestedDate);
      if (!d) {
        toast.error("Please select a requested new date.");
        return;
      }
      requested_changes.new_due_date = d;
    } else if (changeType === "amount_change") {
      if (requestedAmount === "") {
        toast.error("Please enter the requested new amount.");
        return;
      }
      const n = Number(requestedAmount);
      if (!Number.isFinite(n) || n < 0) {
        toast.error("Enter a valid amount.");
        return;
      }
      requested_changes.new_amount = n;
    } else if (changeType === "scope_product_change") {
      if (!requestedScope.trim()) {
        toast.error("Please describe the requested product/scope change.");
        return;
      }
      requested_changes.scope_change = requestedScope.trim();
    } else {
      if (!requestedOther.trim()) {
        toast.error("Please describe the requested change.");
        return;
      }
      requested_changes.other = requestedOther.trim();
    }

    setSubmittingChange(true);
    try {
      await api.post(
        `/projects/milestones/${currentMilestone.id}/request_change/`,
        {
          change_type: changeType,
          requested_changes,
          justification: justification.trim(),
        },
        { headers: { "Content-Type": "application/json" } }
      );

      toast.success("Change request saved. Starting amendment…");
      navigate(`/app/agreements/${agreementId}/wizard?mode=amendment&step=2`);
      onClose && onClose();
    } catch (e) {
      if (detectLockFromError(e)) {
        toast.error(
          lockCode === "AGREEMENT_COMPLETED_LOCKED"
            ? "Completed agreements cannot be amended."
            : "Agreement is locked."
        );
        return;
      }
      console.error(e);
      const resp = e?.response;
      const body =
        (resp?.data &&
          (typeof resp.data === "string" ? resp.data : safeJsonString(resp.data))) ||
        resp?.statusText ||
        e?.message ||
        "Request failed";
      toast.error(body);
    } finally {
      setSubmittingChange(false);
    }
  }, [
    currentMilestone,
    agreementId,
    lockedCompleted,
    changeType,
    requestedDate,
    requestedAmount,
    requestedScope,
    requestedOther,
    justification,
    navigate,
    onClose,
    lockCode,
  ]);

  if (!open) return null;
  if (!currentMilestone) return null;

  const meta = currentMilestone?._meta || {};
  const homeowner =
    meta.homeownerName ||
    currentMilestone?.homeowner_name ||
    currentMilestone?.homeowner?.name ||
    "";
  const address =
    meta.projectAddress ||
    currentMilestone?.project_address ||
    currentMilestone?.project?.address ||
    "";
  const agreementNumber =
    meta.agreementNumber ||
    currentMilestone?.agreement_number ||
    currentMilestone?.agreement_id ||
    currentMilestone?.agreement?.id ||
    null;
  const agreementTotal =
    meta.agreementTotal ?? currentMilestone?.agreement?.total_cost ?? null;
  const links = meta.links || {};
  const previewSignedUrl = links.previewSignedUrl || null;

  const lockedBanner =
    lockedCompleted
      ? "This agreement is completed. View only — no amendments allowed."
      : lockedSigned
      ? "This agreement is signed/locked. Milestones are view-only for editing. Use Request Change to route through an amendment."
      : "";

  const gateBadge =
    completionGate.ok
      ? {
          text: completionGate.paymentMode === "direct" ? "Ready (Direct Pay)" : "Ready (Escrow)",
          cls: "bg-emerald-100 text-emerald-800 border-emerald-200",
        }
      : {
          text: completionGate.code === "ESCROW_REQUIRED" ? "Needs Escrow Funding" : "Needs Signature",
          cls: "bg-amber-100 text-amber-900 border-amber-200",
        };

  const invoiceReadonlyBanner =
    readonlyFromUrl && !lockedSigned && !lockedCompleted ? (
      <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        <div className="font-semibold">Read-only</div>
        <div className="mt-1">
          This milestone was opened from an invoice and is view-only here.
          {fromInvoice ? " (Invoice view)" : ""}
        </div>
      </div>
    ) : null;

  // ✅ show complete button even when signed/locked (but not when actionReadOnly)
  const canShowComplete = !actionReadOnly;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/40 p-6 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div className="text-sm text-gray-500">
            {agreementNumber ? `Agreement #${agreementNumber}` : null}
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

        <div className="px-5 pb-5 pt-3">
          {invoiceReadonlyBanner}

          {lockedBanner ? (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <div className="font-semibold">Locked</div>
              <div className="mt-1">
                {lockedBanner}
                {lockMessage ? (
                  <div className="mt-1 text-xs text-amber-800">{lockMessage}</div>
                ) : null}
              </div>
              {!lockedCompleted ? (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setShowRequestChange((v) => !v)}
                    className="rounded bg-amber-900 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                  >
                    {showRequestChange ? "Hide Request Change" : "Request Change"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <div>
                <span className="font-semibold">Customer</span>: {homeowner || "—"}
              </div>
              {address ? (
                <div className="truncate max-w-[420px]">
                  <span className="font-semibold">Address</span>: {address}
                </div>
              ) : null}
              {agreementTotal !== null && agreementTotal !== undefined ? (
                <div>
                  <span className="font-semibold">Agreement Total</span>:{" "}
                  {fmtMoney(agreementTotal)}
                </div>
              ) : null}

              <div className="ml-auto flex gap-2">
                {wizardStep4Url ? (
                  <button
                    type="button"
                    onClick={() => navigate(wizardStep4Url)}
                    className="px-3 py-1 rounded-md bg-gray-900 text-white hover:opacity-90"
                  >
                    View Agreement
                  </button>
                ) : null}

                {previewSignedUrl ? (
                  <button
                    type="button"
                    onClick={() =>
                      window.open(previewSignedUrl, "_blank", "noopener,noreferrer")
                    }
                    className="px-3 py-1 rounded-md bg-indigo-600 text-white hover:opacity-90"
                  >
                    Preview PDF
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-extrabold border ${gateBadge.cls}`}
              >
                {gateBadge.text}
              </span>
              {!completionGate.ok ? (
                <span className="text-xs text-gray-600">
                  {completionGate.reason}
                  {wizardStep4Url ? (
                    <>
                      {" "}
                      <button
                        type="button"
                        onClick={() => navigate(wizardStep4Url)}
                        className="font-extrabold text-blue-700 hover:underline"
                      >
                        Fix now
                      </button>
                    </>
                  ) : null}
                </span>
              ) : (
                <span className="text-xs text-gray-500">
                  You can submit completion for review now.
                </span>
              )}
            </div>
          </div>

          {showRequestChange && !lockedCompleted ? (
            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-sm">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-blue-900">Request Change</div>
                <div className="text-xs text-blue-800">
                  Creates a change request and routes into an amendment
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-blue-900">
                    Change Type
                  </label>
                  <select
                    value={changeType}
                    onChange={(e) => setChangeType(e.target.value)}
                    className="w-full rounded border px-3 py-2 text-sm"
                  >
                    {CHANGE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                {changeType === "date_change" ? (
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-blue-900">
                      Requested New Completion Date
                    </label>
                    <input
                      type="date"
                      value={requestedDate}
                      onChange={(e) => setRequestedDate(toDateOnly(e.target.value))}
                      className="w-full rounded border px-3 py-2 text-sm"
                    />
                    <div className="mt-1 text-xs text-blue-800">
                      Current: {form.end_date ? form.end_date : "—"}
                    </div>
                  </div>
                ) : null}

                {changeType === "amount_change" ? (
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-blue-900">
                      Requested New Amount
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={requestedAmount}
                      onChange={(e) => setRequestedAmount(e.target.value)}
                      className="w-full rounded border px-3 py-2 text-sm text-right"
                      placeholder="e.g. 250.00"
                    />
                    <div className="mt-1 text-xs text-blue-800">
                      Current: ${dollar(form.amount)}
                    </div>
                  </div>
                ) : null}

                {changeType === "scope_product_change" ? (
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-blue-900">
                      Product / Scope Change
                    </label>
                    <textarea
                      value={requestedScope}
                      onChange={(e) => setRequestedScope(e.target.value)}
                      rows={3}
                      className="w-full rounded border px-3 py-2 text-sm"
                      placeholder="Describe the change to products/materials/scope…"
                    />
                  </div>
                ) : null}

                {changeType === "other" ? (
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-blue-900">
                      Describe Requested Change
                    </label>
                    <textarea
                      value={requestedOther}
                      onChange={(e) => setRequestedOther(e.target.value)}
                      rows={3}
                      className="w-full rounded border px-3 py-2 text-sm"
                      placeholder="Describe what needs to change…"
                    />
                  </div>
                ) : null}

                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-blue-900">
                    Justification / Notes (required)
                  </label>
                  <textarea
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    rows={3}
                    className="w-full rounded border px-3 py-2 text-sm"
                    placeholder="Why is this needed?"
                  />
                </div>

                <div className="md:col-span-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={submitRequestChange}
                    disabled={submittingChange}
                    className="rounded bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:bg-gray-300"
                  >
                    {submittingChange ? "Submitting…" : "Submit & Start Amendment"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowRequestChange(false)}
                    className="rounded bg-white px-3 py-2 text-sm font-medium text-blue-900 border border-blue-200 hover:bg-blue-100"
                  >
                    Cancel
                  </button>

                  <div className="flex-1" />

                  <div className="text-xs text-blue-800">
                    This does not change the signed PDF. It creates a request and routes you into amendment mode.
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {Boolean(currentMilestone?.is_rework) ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-amber-800">Rework Milestone</div>
                <div className="text-xs text-amber-700">
                  Linked to original milestone for auditability
                </div>
              </div>

              {origin ? (
                <div className="mt-2 grid grid-cols-1 gap-2">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <div>
                      <span className="font-semibold">Rework for</span>:{" "}
                      {originOrder ? `${originOrder}. ` : ""}
                      {originTitle || `Milestone #${origin?.id}`}
                    </div>

                    {originAmountLabel ? (
                      <div>
                        <span className="font-semibold">Origin amount</span>:{" "}
                        {originAmountLabel}
                      </div>
                    ) : null}

                    {originStatusLabel ? (
                      <div className="text-amber-800">
                        <span className="font-semibold">Origin status</span>:{" "}
                        {originStatusLabel}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleViewOriginMilestone}
                      className="rounded bg-white px-3 py-1.5 text-sm font-medium text-amber-900 border border-amber-200 hover:bg-amber-100"
                    >
                      View Original Milestone
                    </button>

                    {originInvoiceId ? (
                      <button
                        type="button"
                        onClick={handleViewOriginInvoice}
                        className="rounded bg-white px-3 py-1.5 text-sm font-medium text-amber-900 border border-amber-200 hover:bg-amber-100"
                      >
                        View Original Invoice
                      </button>
                    ) : null}

                    <div className="flex-1" />

                    <div className="text-xs text-amber-700">
                      Origin ID: #{origin?.id}
                      {originInvoiceId ? ` • Invoice: #${originInvoiceId}` : ""}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-xs text-amber-800">
                  This milestone is marked as rework, but origin details were not returned.
                </div>
              )}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Title
              </label>
              <input
                type="text"
                name="title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                readOnly={editReadOnly}
                className={`w-full rounded border px-3 py-2 text-sm ${
                  editReadOnly ? "bg-gray-50 text-gray-600 cursor-not-allowed" : ""
                }`}
                placeholder="e.g., Install Sink and Mirror"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Amount ($)
              </label>
              <input
                type="number"
                step="0.01"
                name="amount"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                readOnly={editReadOnly}
                className={`w-full rounded border px-3 py-2 text-sm text-right ${
                  editReadOnly ? "bg-gray-50 text-gray-600 cursor-not-allowed" : ""
                }`}
              />
              <div className="mt-1 text-xs text-gray-400">
                Preview: ${dollar(form.amount)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Start Date
                </label>
                <input
                  type="date"
                  name="start_date"
                  value={form.start_date || ""}
                  onChange={onChange}
                  readOnly={editReadOnly}
                  className={`w-full rounded border px-3 py-2 text-sm ${
                    editReadOnly ? "bg-gray-50 text-gray-600 cursor-not-allowed" : ""
                  }`}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Completion Date
                </label>
                <input
                  type="date"
                  name="end_date"
                  value={form.end_date || ""}
                  onChange={onChange}
                  readOnly={editReadOnly}
                  className={`w-full rounded border px-3 py-2 text-sm ${
                    editReadOnly ? "bg-gray-50 text-gray-600 cursor-not-allowed" : ""
                  }`}
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Description
              </label>
              <textarea
                name="description"
                value={form.description}
                onChange={onChange}
                readOnly={editReadOnly}
                rows={4}
                className={`w-full rounded border px-3 py-2 text-sm ${
                  editReadOnly ? "bg-gray-50 text-gray-600 cursor-not-allowed" : ""
                }`}
                placeholder="Work description…"
              />
            </div>
          </div>

          {/* ✅ Actions */}
          {!editReadOnly ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={async () => {
                  await save();
                }}
                disabled={saving}
                className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>

              <button
                onClick={async () => {
                  const res = await save();
                  if (res?.ok) {
                    onClose && onClose();
                  }
                }}
                disabled={saving}
                className="rounded bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-black disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {saving ? "Saving…" : "Save & Close"}
              </button>

              <div className="flex-1" />

              <button
                onClick={completeToReview}
                disabled={!completionGate.ok || actionReadOnly}
                className={`rounded px-3 py-2 text-sm font-medium ${
                  completionGate.ok && !actionReadOnly
                    ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                }`}
                title={completionGate.ok ? "Submit completion for review." : completionGate.reason}
              >
                ✓ Complete → Review
              </button>
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-black"
              >
                Close
              </button>

              <div className="flex-1" />

              {canShowComplete ? (
                <button
                  onClick={completeToReview}
                  disabled={!completionGate.ok}
                  className={`rounded px-3 py-2 text-sm font-medium ${
                    completionGate.ok
                      ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      : "bg-gray-100 text-gray-400 cursor-not-allowed"
                  }`}
                  title={completionGate.ok ? "Submit completion for review." : completionGate.reason}
                >
                  ✓ Complete → Review
                </button>
              ) : (
                <div className="text-xs text-gray-500">
                  Read-only view — invoices are the financial record.
                </div>
              )}
            </div>
          )}

          <div className="mt-6">
            <div className="text-sm font-medium text-gray-700">Files</div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                disabled={uploading || actionReadOnly}
              />
              <button
                onClick={uploadFile}
                disabled={!file || uploading || actionReadOnly}
                className="rounded bg-gray-100 px-3 py-1.5 text-sm hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-gray-100"
              >
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </div>

            {!!uploadError && (
              <div className="mt-2 text-xs text-red-600">
                Server response: {uploadError}
              </div>
            )}

            <div className="mt-4">
              <div className="text-sm font-medium text-gray-700 mb-2">
                Recent Attachments
              </div>
              {loadingAttachments ? (
                <div className="text-xs text-gray-500">Loading…</div>
              ) : recentAttachments.length ? (
                <ul className="space-y-1 text-sm">
                  {recentAttachments.map((a) => {
                    const url = urlFor(a);
                    return (
                      <li
                        key={a.id || `${a.title}-${a.filename}-${Math.random()}`}
                        className="flex items-center justify-between"
                      >
                        <span className="truncate">
                          {a.category ? `[${String(a.category).toUpperCase()}] ` : ""}
                          {a.title || a.filename || "Attachment"}
                        </span>
                        <span className="ml-3 flex items-center gap-3">
                          {url ? (
                            <a
                              className="text-blue-600 hover:underline"
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Download
                            </a>
                          ) : (
                            <span className="text-gray-400">No link</span>
                          )}

                          {!actionReadOnly ? (
                            <button
                              onClick={() => deleteAttachment(a.id)}
                              disabled={deletingId === a.id}
                              className="text-red-600 hover:text-red-700 disabled:text-red-300"
                              title="Delete attachment"
                            >
                              {deletingId === a.id ? "Deleting…" : "Delete"}
                            </button>
                          ) : null}
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

          <div className="mt-6">
            <div className="text-sm font-medium text-gray-700">Comments</div>

            <div className="mt-2 max-h-40 overflow-y-auto rounded border bg-gray-50 p-2 text-xs">
              {loadingComments ? (
                <div className="text-gray-500">Loading comments…</div>
              ) : comments && comments.length > 0 ? (
                comments.map((c) => (
                  <div
                    key={c.id}
                    className="mb-2 rounded bg-white px-2 py-1 shadow-sm last:mb-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{c.author_name || "User"}</span>
                      <span className="text-[11px] text-gray-500">
                        {c.created_at ? friendlyDate(c.created_at) : ""}
                      </span>
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-[13px] text-gray-800">
                      {c.content}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-gray-500">
                  No comments yet. Be the first to add one.
                </div>
              )}
            </div>

            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={actionReadOnly ? "Read-only view — comments disabled" : "Add a comment…"}
                className={`flex-1 rounded border px-3 py-2 text-sm ${
                  actionReadOnly ? "bg-gray-50 text-gray-500 cursor-not-allowed" : ""
                }`}
                disabled={actionReadOnly}
                onKeyDown={(e) => {
                  if (actionReadOnly) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!sendingComment) sendComment();
                  }
                }}
              />
              <button
                onClick={sendComment}
                disabled={actionReadOnly || !comment.trim() || sendingComment}
                className="rounded bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
              >
                {sendingComment ? "Sending…" : "Send"}
              </button>
            </div>

            <div className="mt-2 text-xs text-gray-500">
              Complete is disabled until agreement requirements are satisfied.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}