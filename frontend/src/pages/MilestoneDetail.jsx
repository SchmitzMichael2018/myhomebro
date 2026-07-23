// src/pages/MilestoneDetail.jsx
// v2026-02-25 — Read-only mode support (?readonly=1&from=invoice)
// - When readonly=1 is present, disables edits, hides Save buttons, disables draft/autosave, blocks PATCH.
// - Keeps normal editable behavior when opened from Milestones section.

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, Link, useLocation } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import DateField from "../components/DateField"; // reliable calendar button
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import { Button, Card, InlineAlert, LoadingSkeleton } from "../components/ui";

// --- Helpers ---------------------------------------------------------------

const formatCurrency = (amount) => {
  const n = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
};

const shallowEqual = (a, b) => {
  const ak = Object.keys(a || {});
  const bk = Object.keys(b || {});
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (a[k] !== b[k]) return false;
  }
  return true;
};

const pickForm = (m) => ({
  title: m?.title || "",
  amount: (m?.amount ?? "") === null ? "" : m?.amount ?? "",
  description: m?.description || "",
  start_date: m?.start_date || "",
  completion_date: m?.completion_date || "",
  completed: !!m?.completed,
});

// --- Component -------------------------------------------------------------

export default function MilestoneDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // ✅ read-only query support
  const query = useMemo(() => new URLSearchParams(location.search || ""), [location.search]);
  const readOnly = useMemo(() => {
    const v = query.get("readonly");
    return v === "1" || String(v || "").toLowerCase() === "true";
  }, [query]);
  const from = useMemo(() => String(query.get("from") || "").toLowerCase(), [query]);
  const fromInvoice = from === "invoice";

  const draftKey = useMemo(() => `milestoneDraft:${id}`, [id]);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [loading, setLoading] = useState(true);
  const [milestone, setMilestone] = useState(null); // server snapshot
  const [form, setForm] = useState(pickForm(null)); // editable state
  const [error, setError] = useState("");

  const [lastSavedAt, setLastSavedAt] = useState(null); // Draft timestamp
  const [draftLoaded, setDraftLoaded] = useState(false); // Banner indicator
  const [autoSaving, setAutoSaving] = useState(false);

  const [fieldErrors, setFieldErrors] = useState({}); // inline validation errors

  const titleRef = useRef(null);
  const amountRef = useRef(null);
  const startRef = useRef(null);
  const completionRef = useRef(null);
  const descriptionRef = useRef(null);

  const initialMounted = useRef(true);

  // Determine dirtiness vs server snapshot
  const isDirty = useCallback(() => {
    if (!milestone) return false;
    const serverForm = pickForm(milestone);
    return !shallowEqual(
      { ...serverForm, amount: Number(serverForm.amount) || serverForm.amount },
      { ...form, amount: Number(form.amount) || form.amount }
    );
  }, [milestone, form]);

  // Fetch from server
  const fetchMilestone = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(`/milestones/${id}/`);
      setMilestone(data);

      // ✅ In read-only mode, always load from server snapshot (ignore drafts)
      if (readOnly) {
        setForm(pickForm(data));
        setLastSavedAt(null);
        setDraftLoaded(false);
        setFieldErrors({});
        try {
          // optional: do not delete drafts automatically, but do not show them either
        } catch {}
        return;
      }

      // If a draft exists, prefer it; otherwise load server as form
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.form) {
            setForm({ ...pickForm(data), ...parsed.form });
            setLastSavedAt(parsed.lastSavedAt || null);
            setDraftLoaded(true);
          } else {
            setForm(pickForm(data));
          }
        } catch {
          setForm(pickForm(data));
        }
      } else {
        setForm(pickForm(data));
      }
    } catch (err) {
      setError("Could not load milestone details.");
      toast.error("Could not load milestone details.");
      navigate("/agreements");
    } finally {
      setLoading(false);
    }
  }, [id, draftKey, navigate, readOnly]);

  useEffect(() => {
    fetchMilestone();

    // ✅ In read-only mode, no beforeunload dirty warning
    if (readOnly) return;

    const beforeUnload = (e) => {
      if (isDirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchMilestone, readOnly]);

  // Debounced autosave (silent)
  useEffect(() => {
    if (readOnly) return; // ✅ disable autosave in readonly mode
    if (loading || !milestone) return;

    const t = setTimeout(() => {
      if (!isDirty()) return;
      try {
        const ts = new Date().toISOString();
        localStorage.setItem(draftKey, JSON.stringify({ form, lastSavedAt: ts }));
        setLastSavedAt(ts);
        setDraftLoaded(true);
        setAutoSaving(true);
        setTimeout(() => setAutoSaving(false), 500);
      } catch {
        // ignore write errors
      }
    }, 1000);

    return () => clearTimeout(t);
  }, [form, isDirty, loading, milestone, draftKey, readOnly]);

  // Handlers
  const handleField = (field, value) => {
    if (readOnly) return;

    setForm((prev) => {
      let v = value;
      if (field === "amount") {
        v = value === "" ? "" : Number(value);
        if (Number.isNaN(v)) v = "";
      }
      if (field === "completed") v = !!value;
      return { ...prev, [field]: v };
    });
    setFieldErrors((prev) => ({ ...prev, [field]: "" })); // clear field error on change
  };

  const saveDraft = () => {
    if (readOnly) {
      toast("Read-only view.");
      return;
    }
    try {
      const ts = new Date().toISOString();
      localStorage.setItem(draftKey, JSON.stringify({ form, lastSavedAt: ts }));
      setLastSavedAt(ts);
      setDraftLoaded(true);
      toast.success("Draft saved.");
    } catch {
      toast.error("Unable to save draft locally.");
    }
  };

  const discardDraft = () => {
    if (readOnly) return;
    try {
      localStorage.removeItem(draftKey);
    } catch {}
    if (milestone) {
      setForm(pickForm(milestone));
      setLastSavedAt(null);
      setDraftLoaded(false);
      setFieldErrors({});
      toast("Draft discarded.");
    }
  };

  const validateForm = () => {
    const errs = {};
    if (!String(form.title || "").trim()) errs.title = "Title is required";
    if (form.amount !== "" && !Number.isFinite(Number(form.amount))) errs.amount = "Enter a valid amount";
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

  const saveChanges = async () => {
    if (readOnly) {
      toast("Read-only view.");
      return;
    }

    const errs = validateForm();
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      toast.error("Please fix the highlighted fields.");
      scrollToFirstError(errs);
      return;
    }

    try {
      const payload = {
        title: form.title,
        amount: form.amount === "" ? 0 : Number(form.amount),
        description: form.description,
        start_date: form.start_date || null,
        completion_date: form.completion_date || null,
        completed: !!form.completed,
      };
      const { data } = await api.patch(`/milestones/${id}/`, payload);
      setMilestone(data);
      setForm(pickForm(data));
      try {
        localStorage.removeItem(draftKey);
      } catch {}
      setLastSavedAt(null);
      setDraftLoaded(false);
      setFieldErrors({});
      toast.success("Milestone saved.");
    } catch (err) {
      const msg = err?.response?.data
        ? Object.entries(err.response.data)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
            .join(" | ")
        : "Failed to save milestone.";
      toast.error(msg || "Failed to save milestone.");
    }
  };

  const goBack = () => {
    // ✅ In readonly mode: no autosave on back
    if (!readOnly && isDirty()) {
      try {
        const ts = new Date().toISOString();
        localStorage.setItem(draftKey, JSON.stringify({ form, lastSavedAt: ts }));
        setLastSavedAt(ts);
        setDraftLoaded(true);
      } catch {}
    }
    navigate(-1);
  };

  // On first mount after data load: if no draft loaded and form equals server, hide draft banner
  useEffect(() => {
    if (!loading && initialMounted.current) {
      initialMounted.current = false;
      if (!draftLoaded) setLastSavedAt(null);
    }
  }, [loading, draftLoaded]);

  if (loading) {
    return (
      <ContractorPageSurface eyebrow="Work" title="Milestone" subtitle="Loading milestone details..." variant="operational" className="max-w-3xl">
        <LoadingSkeleton theme="operational" variant="form" label="Loading milestone" />
      </ContractorPageSurface>
    );
  }
  if (error || !milestone) {
    return (
      <ContractorPageSurface eyebrow="Work" title="Milestone" subtitle="Review milestone scope, dates, amount, and completion state." variant="operational" className="max-w-3xl">
        <InlineAlert theme="operational" tone="danger" title="Milestone could not be loaded">{error || "The milestone is unavailable."}</InlineAlert>
      </ContractorPageSurface>
    );
  }

  const serverAmount = milestone?.amount ?? 0;
  const formAmount = form?.amount === "" ? 0 : Number(form?.amount);

  return (
    <ContractorPageSurface
      eyebrow="Work"
      title={milestone.title || "Untitled Milestone"}
      subtitle={`Part of Agreement: ${milestone.agreement_title || `Agreement #${milestone.agreement}`}`}
      variant="operational"
      className="max-w-3xl"
    >
      {/* ✅ Read-only banner */}
      {readOnly && (
        <div className="mb-4 rounded-xl border border-[var(--mhb-border-selected)] bg-[var(--mhb-surface-selected)] p-3 text-[var(--mhb-text-primary)]">
          <div className="text-sm font-semibold">Read-only</div>
          <div className="text-sm mt-1">
            This milestone is view-only because it was opened from an invoice.
            {fromInvoice ? " (Invoice view)" : ""}
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="mb-4 flex items-center justify-between">
        <button onClick={goBack} className="text-sm font-bold text-[var(--mhb-text-link)] hover:underline">
          ← Back
        </button>

        {/* ✅ Hide save controls in read-only */}
        {!readOnly ? (
          <div className="flex items-center gap-2">
            <Button theme="operational" variant="secondary" size="sm" onClick={saveDraft}>
              Save Draft
            </Button>
            <Button
              theme="operational"
              size="sm"
              onClick={saveChanges}
              disabled={!isDirty()}
            >
              Save Changes
            </Button>
          </div>
        ) : (
          <div className="text-xs text-[var(--mhb-text-muted)]">Editing disabled</div>
        )}
      </div>

      {/* Draft banner (disabled in readonly) */}
      {!readOnly && (draftLoaded || lastSavedAt) && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-[var(--mhb-status-pending-border)] bg-[var(--mhb-status-pending-bg)] p-3 text-[var(--mhb-status-pending-text)]">
          <div className="text-sm">
            {draftLoaded ? "Loaded local draft." : "Draft available."}{" "}
            {lastSavedAt && (
              <span className="opacity-80">
                {autoSaving ? "Auto-saved " : "Last saved "} {new Date(lastSavedAt).toLocaleString()}
              </span>
            )}
          </div>
          <button onClick={discardDraft} className="text-sm underline hover:opacity-80">
            Discard draft
          </button>
        </div>
      )}

      <div className="mb-2 text-sm text-[var(--mhb-text-muted)]">
          Part of Agreement:{" "}
          <Link to={`/agreements/${milestone.agreement}`} className="font-semibold text-[var(--mhb-text-link)] hover:underline">
            {milestone.agreement_title || `Agreement #${milestone.agreement}`}
          </Link>
      </div>

      {/* Card */}
      <Card theme="operational" className="space-y-6">
        {/* Amount + Status */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
          <div>
            <h3 className="text-sm font-semibold text-[var(--mhb-text-secondary)]">Server Amount</h3>
            <p className="text-lg font-bold text-[var(--mhb-text-primary)]">{formatCurrency(serverAmount)}</p>
            <div className="mt-3">
              <label className="mb-1 block text-sm text-[var(--mhb-text-secondary)]">Edit Amount ($)</label>
              <input
                ref={amountRef}
                type="number"
                min="0"
                step="0.01"
                value={form.amount === "" ? "" : form.amount}
                onChange={(e) => handleField("amount", e.target.value)}
                disabled={readOnly}
                className={`w-full rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-3 py-2 text-[var(--mhb-text-primary)] ${readOnly ? "cursor-not-allowed opacity-65" : ""} ${fieldErrors.amount ? "ring-2 ring-[var(--mhb-status-blocked-border)]" : ""}`}
                placeholder="0.00"
                aria-invalid={!!fieldErrors.amount}
              />
              {fieldErrors.amount && <div role="alert" className="mt-1 text-xs text-[var(--mhb-status-blocked-text)]">{fieldErrors.amount}</div>}
              <div className="mt-1 text-xs text-[var(--mhb-text-muted)]">Preview: {formatCurrency(formAmount)}</div>
            </div>
          </div>

          <div className="text-left sm:text-right">
            <h3 className="text-sm font-semibold text-[var(--mhb-text-secondary)]">Server Status</h3>
            <p className={`font-bold ${milestone.completed ? "text-green-600" : "text-yellow-600"}`}>
              {milestone.completed ? "✅ Completed" : "⌛ Incomplete"}
            </p>

            <div className="mt-3 sm:inline-block">
              <label className={`inline-flex items-center gap-2 text-sm text-[var(--mhb-text-secondary)] ${readOnly ? "opacity-65" : ""}`}>
                <input
                  type="checkbox"
                  checked={!!form.completed}
                  onChange={(e) => handleField("completed", e.target.checked)}
                  disabled={readOnly}
                />
                Mark as Completed
              </label>
            </div>
          </div>
        </div>

        {/* Title & Description */}
        <div className="grid grid-cols-1 gap-4 border-t border-[var(--mhb-border-divider)] pt-4">
          <div>
            <label className="mb-1 block text-sm text-[var(--mhb-text-secondary)]">Title</label>
            <input
              ref={titleRef}
              value={form.title}
              onChange={(e) => handleField("title", e.target.value)}
              disabled={readOnly}
              className={`w-full rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-3 py-2 text-[var(--mhb-text-primary)] ${readOnly ? "cursor-not-allowed opacity-65" : ""} ${fieldErrors.title ? "ring-2 ring-[var(--mhb-status-blocked-border)]" : ""}`}
              placeholder="Milestone title"
              aria-invalid={!!fieldErrors.title}
            />
            {fieldErrors.title && <div role="alert" className="mt-1 text-xs text-[var(--mhb-status-blocked-text)]">{fieldErrors.title}</div>}
          </div>

          <div>
            <label className="mb-1 block text-sm text-[var(--mhb-text-secondary)]">Description</label>
            <textarea
              ref={descriptionRef}
              value={form.description}
              onChange={(e) => handleField("description", e.target.value)}
              disabled={readOnly}
              className={`w-full rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-3 py-2 text-[var(--mhb-text-primary)] ${readOnly ? "cursor-not-allowed opacity-65" : ""}`}
              rows={4}
              placeholder="What work is included for this milestone?"
            />
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t pt-4">
          <div>
            <h3 className="font-semibold text-gray-600 text-sm mb-1">Start Date</h3>
            <DateField
              value={form.start_date || ""}
              onChange={(e) => handleField("start_date", e.target.value)}
              min={today}
              disabled={readOnly}
              className={`w-full ${fieldErrors.start_date ? "ring-1 ring-red-500" : ""} ${
                readOnly ? "bg-gray-50 text-gray-600 cursor-not-allowed" : ""
              }`}
            />
            {fieldErrors.start_date && <div className="text-xs text-red-600 mt-1">{fieldErrors.start_date}</div>}
            <div ref={startRef} className="sr-only" />
          </div>

          <div>
            <h3 className="font-semibold text-gray-600 text-sm mb-1">Completion Date</h3>
            <DateField
              value={form.completion_date || ""}
              onChange={(e) => handleField("completion_date", e.target.value)}
              min={form.start_date || today}
              disabled={readOnly}
              className={`w-full ${fieldErrors.completion_date ? "ring-1 ring-red-500" : ""} ${
                readOnly ? "bg-gray-50 text-gray-600 cursor-not-allowed" : ""
              }`}
            />
            {fieldErrors.completion_date && (
              <div className="text-xs text-red-600 mt-1">{fieldErrors.completion_date}</div>
            )}
            <div ref={completionRef} className="sr-only" />
          </div>
        </div>

        {/* Bottom actions */}
        <div className="flex items-center justify-between border-t border-[var(--mhb-border-divider)] pt-4">
          {!readOnly ? (
            <Button theme="operational" variant="secondary" size="sm" onClick={saveDraft}>Save Draft</Button>
          ) : (
            <div className="text-xs text-[var(--mhb-text-muted)]">Read-only</div>
          )}

          <div className="flex gap-2">
            <Button theme="operational" variant="secondary" size="sm" onClick={goBack}>Back</Button>

            {!readOnly ? (
              <Button
                theme="operational"
                size="sm"
                onClick={saveChanges}
                disabled={!isDirty()}
              >
                Save Changes
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
    </ContractorPageSurface>
  );
}
