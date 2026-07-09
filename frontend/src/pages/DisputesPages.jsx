import React, { useEffect, useMemo, useState } from "react";
import api from "../api";
import { toast } from "react-hot-toast";
import PageShell from "../components/PageShell.jsx";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import DisputesCreateModal from "../components/DisputesCreateModal.jsx";
import { useWhoAmI } from "../hooks/useWhoAmI.js";
import { useNavigate } from "react-router-dom";
import {
  isDisputeTerminal,
  canRespondToDispute,
  canCancelDispute,
  canUploadToDispute,
  canResolveDispute,
  isDisputeArchived,
  getDisputeReadOnlyLabel,
} from "../lib/disputeStatus.js";

// ✅ NEW: AI Advisor (read-only, evidence-context-based)
import DisputeAIAdvisor from "../components/ai/DisputeAIAdvisor.jsx";
import DisputeAIRecommendationPanel from "../components/ai/DisputeAIRecommendationPanel.jsx";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const money = (n) =>
  Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

const PROPOSAL_PREFIX = "MHB_PROPOSAL_V1:";

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function extractProposalFromResponse(responseText) {
  const raw = String(responseText || "").trim();
  if (!raw.startsWith(PROPOSAL_PREFIX)) return null;
  const json = raw.slice(PROPOSAL_PREFIX.length).trim();
  return safeJsonParse(json);
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

// Returns { seconds, isOverdue, labelShort, labelLong }
function timeRemainingLabel(dueAt, now = new Date()) {
  const due = parseDate(dueAt);
  if (!due) return null;

  const diffMs = due.getTime() - now.getTime();
  const isOverdue = diffMs < 0;
  const absMs = Math.abs(diffMs);

  const totalSeconds = Math.floor(absMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  const labelShort = (days > 0 ? `${days}d ` : "") + `${hours}h ${minutes}m`;
  const labelLong = isOverdue ? `Overdue by ${labelShort}` : `Due in ${labelShort}`;

  return {
    seconds: isOverdue ? -totalSeconds : totalSeconds,
    isOverdue,
    labelShort,
    labelLong,
  };
}

const toneFor = (s) => {
  switch ((s || "").toLowerCase()) {
    case "initiated":
      return "info";
    case "open":
    case "under_review":
      return "warn";
    case "resolved_contractor":
    case "resolved_homeowner":
    case "resolved_customer":
      return "good";
    case "canceled":
      return "default";
    default:
      return "default";
  }
};

const hasAnyResponse = (d) => {
  const hr = String(d?.homeowner_response || "").trim();
  const cr = String(d?.contractor_response || "").trim();
  return Boolean(hr || cr);
};

const canRespond = (d) => {
  return Boolean(d?.fee_paid) && canRespondToDispute(d?.status);
};

// ✅ UX refinement: cancel only if early AND nobody has responded yet
const canCancel = (d) => {
  return canCancelDispute(d?.status) && !hasAnyResponse(d);
};

const canResolveAdmin = (d) => {
  return canResolveDispute(d?.status);
};

const isClosed = (d) => {
  return isDisputeTerminal(d?.status);
};

// Stage A: compute a "Next step" label for scanning
const nextStepLabel = (d, isAdmin) => {
  const s = String(d?.status || "").toLowerCase();
  const resolution = String(d?.resolution_type || "").toLowerCase();
  if (resolution === "rework_required") return "Rework required";
  if (isDisputeTerminal(s)) return "Resolved";

  if (!d?.fee_paid) return "Waiting on fee";

  const hasHome = Boolean(String(d?.homeowner_response || "").trim());
  const hasCont = Boolean(String(d?.contractor_response || "").trim());

  if (!hasEvidence(d)) return "Awaiting evidence";
  if (hasHome && hasCont) return isAdmin ? "Ready for decision" : "Ready for review";
  if (!hasCont) return "Waiting on contractor";
  if (!hasHome) return "Waiting on homeowner";

  if (s === "under_review") return "Under review";
  return "Open";
};

const pillToneForNext = (label) => {
  const l = String(label || "").toLowerCase();
  if (l.includes("resolved") || l === "closed") return "good";
  if (l.includes("rework")) return "warn";
  if (l.includes("evidence")) return "warn";
  if (l.includes("ready")) return "info";
  if (l.includes("waiting")) return "warn";
  if (l.includes("under review")) return "info";
  return "default";
};

const financialTone = (value) => {
  const v = String(value || "").toLowerCase();
  if (v.includes("release")) return "good";
  if (v.includes("refund")) return "danger";
  if (v.includes("manual")) return "warn";
  if (v.includes("no_financial")) return "default";
  return "default";
};

const Badge = ({ tone = "default", children, className = "" }) => {
  const t = {
    default: ["bg-slate-200", "text-slate-800"],
    warn: ["bg-amber-100", "text-amber-800"],
    good: ["bg-emerald-100", "text-emerald-800"],
    info: ["bg-blue-100", "text-blue-800"],
    danger: ["bg-rose-100", "text-rose-800"],
  }[tone];

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${t[0]} ${t[1]} ${className}`}
    >
      {children}
    </span>
  );
};

function ModalShell({ title, onClose, children, width = "min(920px, 96vw)" }) {
  return (
    <div className="mhb-modal-overlay" role="dialog" aria-modal="true">
      <div className="mhb-modal-card" style={{ width }}>
        <div className="mhb-modal-header">
          <h2>{title}</h2>
          <button className="mhb-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="mhb-modal-body" style={{ display: "grid", gap: 12 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Stage A.2: Filters + Search  (Stage E extends with Overdue/Due Soon for Admin)
// ─────────────────────────────────────────────

const FILTERS_BASE = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "awaiting_response", label: "Awaiting response" },
  { key: "awaiting_evidence", label: "Awaiting evidence" },
  { key: "rework_required", label: "Rework required" },
  { key: "waiting_fee", label: "Waiting on fee" },
  { key: "waiting_contractor", label: "Waiting on contractor" },
  { key: "waiting_homeowner", label: "Waiting on homeowner" },
  { key: "ready", label: "Ready" },
  { key: "under_review", label: "Under review" },
  { key: "resolved", label: "Resolved" },
  { key: "canceled", label: "Canceled" },
  { key: "archived", label: "Archived" },
];

const FILTERS_ADMIN_EXTRA = [
  { key: "overdue", label: "Overdue" },
  { key: "due_soon", label: "Due soon (24h)" },
  { key: "awaiting_admin_review", label: "Awaiting admin review" },
];

const RESOLUTION_LABELS = {
  contractor_prevails: "Contractor Prevails",
  customer_prevails: "Customer Prevails",
  partial_resolution: "Partial Resolution",
  rework_required: "Rework Required",
  administrative_closure: "Administrative Closure",
};

const FINANCIAL_LABELS = {
  eligible_for_release: "Eligible for Release",
  eligible_for_refund: "Eligible for Refund",
  partial_manual_review: "Partial Manual Review",
  manual_review_required: "Manual Review Required",
  no_financial_action: "No Financial Action",
};

const labelFor = (value, labels) => labels[String(value || "").toLowerCase()] || String(value || "").replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());

function hasEvidence(d) {
  return Boolean(
    (Array.isArray(d?.attachments) && d.attachments.length) ||
      String(d?.homeowner_response || "").trim() ||
      String(d?.contractor_response || "").trim()
  );
}

function disputeBoardKey(d, isAdmin = false) {
  const status = String(d?.status || "").toLowerCase();
  const resolution = String(d?.resolution_type || "").toLowerCase();
  const hasHome = Boolean(String(d?.homeowner_response || "").trim());
  const hasCont = Boolean(String(d?.contractor_response || "").trim());

  if (isDisputeArchived(d)) return "archived";
  if (resolution === "rework_required") return "rework_required";
  if (status === "canceled") return "canceled";
  if (isDisputeTerminal(status)) return "resolved";
  if (!d?.fee_paid) return "waiting_fee";
  if (!hasEvidence(d)) return "awaiting_evidence";
  if (isAdmin && (status === "under_review" || (hasHome && hasCont))) return "awaiting_admin_review";
  if (!hasCont) return "waiting_contractor";
  if (!hasHome) return "waiting_homeowner";
  if (status === "under_review") return "under_review";
  if (status === "open" || status === "initiated") return "open";
  if (!hasHome || !hasCont) return "awaiting_response";
  return "ready";
}

function getFilterKeyBase(d) {
  const boardKey = disputeBoardKey(d);
  if (["open", "awaiting_response", "awaiting_evidence", "rework_required", "archived"].includes(boardKey)) {
    return boardKey;
  }
  const status = String(d?.status || "").toLowerCase();

  if (status === "canceled") return "canceled";
  if (status === "resolved_contractor" || status === "resolved_homeowner" || status === "resolved_partial") return "resolved";
  if (status === "under_review") return "under_review";

  if (!d?.fee_paid) return "waiting_fee";

  const hasHome = Boolean(String(d?.homeowner_response || "").trim());
  const hasCont = Boolean(String(d?.contractor_response || "").trim());

  if (hasHome && hasCont) return "ready";
  if (!hasCont) return "waiting_contractor";
  if (!hasHome) return "waiting_homeowner";

  return "all";
}

function filterRowsBase(rows, selectedKey) {
  if (!selectedKey || selectedKey === "all") return rows;
  if (
    [
      "open",
      "awaiting_response",
      "awaiting_evidence",
      "awaiting_admin_review",
      "rework_required",
      "archived",
    ].includes(selectedKey)
  ) {
    return rows.filter((d) => disputeBoardKey(d, selectedKey === "awaiting_admin_review") === selectedKey);
  }
  return rows.filter((d) => getFilterKeyBase(d) === selectedKey);
}

function normalizeText(s) {
  return String(s || "").toLowerCase();
}

function matchesSearch(d, q) {
  const query = normalizeText(q).trim();
  if (!query) return true;

  const parts = query.split(/\s+/).filter(Boolean);

  const hay = normalizeText(
    [
      d?.id,
      d?.agreement_number,
      d?.agreement,
      d?.milestone_title,
      d?.milestone,
      d?.reason,
      d?.description,
      d?.homeowner_response,
      d?.contractor_response,
      d?.status,
      d?.initiator,
    ].join(" ")
  );

  return parts.every((p) => hay.includes(p));
}

function SearchBox({ value, onChange, onClear, operational = false }) {
  const inputClass = operational
    ? "w-full rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 pr-10 text-sm font-semibold text-sky-50 outline-none placeholder:text-sky-100/50 focus:border-sky-300/60 focus:bg-slate-950/80"
    : "w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 pr-10 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 focus:bg-white";
  const clearClass = operational
    ? "absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-extrabold text-sky-100/75 hover:bg-white/10 hover:text-white"
    : "absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-extrabold text-slate-500 hover:bg-slate-100";

  return (
    <div className="relative w-full md:w-[360px]">
      <input
        className={inputClass}
        placeholder="Search disputes… (agreement #, milestone, reason, response)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value?.trim() ? (
        <button
          type="button"
          onClick={onClear}
          className={clearClass}
          title="Clear search"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────
// Stage C UI: Deadlines (countdown/overdue) + Stage E filters use these
// ─────────────────────────────────────────────

function getActiveDeadline(dispute) {
  if (!dispute || isClosed(dispute)) return null;

  const status = String(dispute?.status || "").toLowerCase();
  const hasProposal = Boolean(dispute?.proposal) || Boolean(dispute?.proposal_sent_at);

  if (hasProposal && dispute?.proposal_due_at) {
    return { type: "proposal", due_at: dispute.proposal_due_at };
  }

  if (status === "open" && dispute?.fee_paid && dispute?.response_due_at) {
    return { type: "response", due_at: dispute.response_due_at };
  }

  if (status === "under_review") {
    if (hasProposal && dispute?.proposal_due_at) return { type: "proposal", due_at: dispute.proposal_due_at };
    if (dispute?.response_due_at) return { type: "response", due_at: dispute.response_due_at };
  }

  return null;
}

function isOverdueDispute(d, now) {
  const active = getActiveDeadline(d);
  if (!active) return false;
  const t = timeRemainingLabel(active.due_at, now);
  return Boolean(t?.isOverdue);
}

function isDueSoonDispute(d, now) {
  const active = getActiveDeadline(d);
  if (!active) return false;
  const t = timeRemainingLabel(active.due_at, now);
  if (!t || t.isOverdue) return false;
  return t.seconds <= 24 * 3600;
}

function DeadlineBadge({ dispute, now }) {
  const active = getActiveDeadline(dispute);
  if (!active) return null;

  const t = timeRemainingLabel(active.due_at, now);
  if (!t) return null;

  const label = active.type === "proposal" ? "Decision" : "Response";

  if (t.isOverdue) {
    return (
      <Badge tone="danger" title={`${label} deadline overdue`}>
        ⚠️ Overdue
      </Badge>
    );
  }

  const warnSoon = t.seconds <= 12 * 3600;
  return (
    <Badge tone={warnSoon ? "warn" : "info"} title={`${label} ${t.labelLong}`}>
      ⏳ {t.labelShort}
    </Badge>
  );
}

function DeadlineLine({ dispute, now }) {
  const active = getActiveDeadline(dispute);
  if (!active) return null;

  const t = timeRemainingLabel(active.due_at, now);
  if (!t) return null;

  const label = active.type === "proposal" ? "Proposal decision due" : "Response due";
  return (
    <div className="text-sm text-slate-700">
      <span className="font-extrabold">{label}:</span>{" "}
      <span className={t.isOverdue ? "text-rose-700 font-extrabold" : "text-slate-900 font-bold"}>
        {t.labelLong}
      </span>
    </div>
  );
}

/* Stage E: filter + search with admin-only keys */
function applyFilterAndSearch(rows, filterKey, searchQuery, isAdmin, now) {
  let filtered = rows;

  if (isAdmin && filterKey === "overdue") {
    filtered = rows.filter((d) => isOverdueDispute(d, now));
  } else if (isAdmin && filterKey === "due_soon") {
    filtered = rows.filter((d) => isDueSoonDispute(d, now));
  } else if (isAdmin && filterKey === "awaiting_admin_review") {
    filtered = rows.filter((d) => disputeBoardKey(d, true) === "awaiting_admin_review");
  } else {
    filtered = filterRowsBase(rows, filterKey);
  }

  if (!searchQuery?.trim()) return filtered;
  return filtered.filter((d) => matchesSearch(d, searchQuery));
}

/* Stage E: admin default sort — Overdue first, then Due Soon, then newest */
function sortAdminUrgency(rows, now) {
  return [...rows].sort((a, b) => {
    const ao = isOverdueDispute(a, now) ? 1 : 0;
    const bo = isOverdueDispute(b, now) ? 1 : 0;
    if (ao !== bo) return bo - ao;

    const as = isDueSoonDispute(a, now) ? 1 : 0;
    const bs = isDueSoonDispute(b, now) ? 1 : 0;
    if (as !== bs) return bs - as;

    const ad = parseDate(a?.created_at)?.getTime() || 0;
    const bd = parseDate(b?.created_at)?.getTime() || 0;
    return bd - ad;
  });
}

function FilterBar({ rows, selected, onChange, filters, isAdmin, now, operational = false }) {
  const counts = useMemo(() => {
    const c = Object.fromEntries(filters.map((f) => [f.key, 0]));
    c.all = rows.length;

    for (const d of rows) {
      // Count base buckets
      const baseKey = getFilterKeyBase(d);
      if (c[baseKey] != null) c[baseKey] += 1;

      // Count admin-only buckets
      if (isAdmin) {
        if (isOverdueDispute(d, now)) c.overdue = (c.overdue || 0) + 1;
        if (isDueSoonDispute(d, now)) c.due_soon = (c.due_soon || 0) + 1;
        if (disputeBoardKey(d, true) === "awaiting_admin_review") c.awaiting_admin_review = (c.awaiting_admin_review || 0) + 1;
      }
    }

    // Ensure keys exist
    for (const f of filters) if (c[f.key] == null) c[f.key] = 0;

    // Overwrite "all" accurately
    c.all = rows.length;

    return c;
  }, [rows, filters, isAdmin, now]);

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {filters.map((f) => {
        const active = selected === f.key;
        const count = counts[f.key] ?? 0;
        return (
          <button
            key={f.key}
            className={[
              "rounded-full border px-3 py-1.5 text-xs font-extrabold transition",
              active
                ? operational
                  ? "border-sky-300/50 bg-sky-500/25 text-white shadow-sm"
                  : "border-slate-900 bg-slate-900 text-white shadow-sm"
                : operational
                  ? "border-white/12 bg-slate-900/45 text-sky-100/78 hover:border-sky-300/35 hover:bg-sky-500/15 hover:text-white"
                  : "border-black/10 bg-white/60 text-slate-800 hover:bg-white",
            ].join(" ")}
            onClick={() => onChange(f.key)}
            title={`Show: ${f.label}`}
            type="button"
          >
            {f.label}{" "}
            <span className={active ? "text-white/80" : operational ? "text-sky-100/55" : "text-slate-500"}>
              ({count})
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// Stage B1: Proposal Modal + Proposal Rendering
// ─────────────────────────────────────────────

const PROPOSAL_TYPES = [
  { key: "rework", label: "Rework by date" },
  { key: "partial_refund", label: "Partial refund" },
  { key: "full_refund", label: "Full refund" },
  { key: "credit", label: "Credit / discount" },
  { key: "split_release", label: "Split release" },
  { key: "other", label: "Other" },
];

function ProposalModal({ open, dispute, onClose, onProposed }) {
  const [ptype, setPtype] = useState("rework");
  const [refund, setRefund] = useState(""); // dollars
  const [release, setRelease] = useState(""); // dollars
  const [reworkBy, setReworkBy] = useState(""); // yyyy-mm-dd
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPtype("rework");
    setRefund("");
    setRelease("");
    setReworkBy("");
    setNotes("");
    setBusy(false);
  }, [open]);

  if (!open || !dispute) return null;

  const submit = async () => {
    if (!dispute?.fee_paid) {
      toast.error("Fee must be paid before proposing a resolution.");
      return;
    }

    const payload = {
      version: 1,
      proposed_at: new Date().toISOString(),
      proposal_type: ptype,
      refund_amount: refund === "" ? null : Number(refund),
      release_amount: release === "" ? null : Number(release),
      rework_by: reworkBy || null,
      notes: String(notes || "").trim() || null,
    };

    if (ptype === "rework" && !payload.rework_by) {
      toast.error("Please select a rework-by date.");
      return;
    }
    if (ptype === "partial_refund" && (payload.refund_amount == null || Number.isNaN(payload.refund_amount))) {
      toast.error("Enter a partial refund amount.");
      return;
    }
    if (ptype === "split_release" && (payload.release_amount == null || payload.refund_amount == null)) {
      toast.error("Enter both release and refund amounts.");
      return;
    }

    setBusy(true);
    try {
      await api.patch(`/projects/disputes/${dispute.id}/respond/`, {
        response: `${PROPOSAL_PREFIX}${JSON.stringify(payload)}`,
      });

      toast.success("Proposal sent.");
      onProposed?.();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to send proposal.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title={`Propose a Resolution - Case #${dispute.id}`} onClose={onClose}>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        This creates a <b>structured proposal</b> and stores it using the existing response system.
      </div>

      <div>
        <label className="block text-sm text-slate-600 mb-1">Proposal type</label>
        <select
          className="w-full border rounded px-3 py-2"
          value={ptype}
          onChange={(e) => setPtype(e.target.value)}
          disabled={busy}
        >
          {PROPOSAL_TYPES.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {(ptype === "partial_refund" || ptype === "full_refund" || ptype === "split_release") && (
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-slate-600 mb-1">Refund amount (USD)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="w-full border rounded px-3 py-2"
              value={refund}
              onChange={(e) => setRefund(e.target.value)}
              disabled={busy || ptype === "full_refund"}
              placeholder={ptype === "full_refund" ? "Full refund (handled by admin resolve)" : "e.g. 50.00"}
            />
            {ptype === "full_refund" ? (
              <div className="text-xs text-slate-500 mt-1">
                Full refund is typically executed by admin resolve today.
              </div>
            ) : null}
          </div>

          {ptype === "split_release" ? (
            <div>
              <label className="block text-sm text-slate-600 mb-1">Release amount (USD)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-full border rounded px-3 py-2"
                value={release}
                onChange={(e) => setRelease(e.target.value)}
                disabled={busy}
                placeholder="e.g. 150.00"
              />
            </div>
          ) : (
            <div className="hidden md:block" />
          )}
        </div>
      )}

      {ptype === "rework" && (
        <div>
          <label className="block text-sm text-slate-600 mb-1">Rework by</label>
          <input
            type="date"
            className="w-full border rounded px-3 py-2"
            value={reworkBy}
            onChange={(e) => setReworkBy(e.target.value)}
            disabled={busy}
          />
        </div>
      )}

      <div>
        <label className="block text-sm text-slate-600 mb-1">Notes (optional)</label>
        <textarea
          className="w-full border rounded px-3 py-2"
          rows={5}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={busy}
          placeholder="Explain the proposal clearly. Include expectations, dates, and what ‘done’ means."
        />
      </div>

      <div className="flex justify-end gap-3">
        <button className="mhb-btn" onClick={onClose} disabled={busy}>
          Close
        </button>
        <button className="mhb-btn primary" onClick={submit} disabled={busy}>
          {busy ? "Sending…" : "Send Proposal"}
        </button>
      </div>
    </ModalShell>
  );
}

function ProposalCard({ proposal }) {
  if (!proposal) return null;

  const ptype = proposal?.proposal_type || "—";
  const label = PROPOSAL_TYPES.find((p) => p.key === ptype)?.label || ptype;

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-extrabold text-emerald-900">Proposal</div>
        <div className="text-xs font-bold text-emerald-800">
          {proposal?.proposed_at ? new Date(proposal.proposed_at).toLocaleString() : ""}
        </div>
      </div>

      <div className="mt-2 text-sm text-emerald-900">
        <b>Type:</b> {label}
      </div>

      {proposal?.rework_by ? (
        <div className="mt-1 text-sm text-emerald-900">
          <b>Rework by:</b> {proposal.rework_by}
        </div>
      ) : null}

      {proposal?.refund_amount != null ? (
        <div className="mt-1 text-sm text-emerald-900">
          <b>Refund:</b> {money(proposal.refund_amount)}
        </div>
      ) : null}

      {proposal?.release_amount != null ? (
        <div className="mt-1 text-sm text-emerald-900">
          <b>Release:</b> {money(proposal.release_amount)}
        </div>
      ) : null}

      {proposal?.notes ? (
        <div className="mt-2 whitespace-pre-wrap text-sm text-emerald-900">{proposal.notes}</div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────
// ✅ NEW: Rework milestone CTA (shown in Details modal)
// ─────────────────────────────────────────────

function ReworkMilestoneCTA({ dispute, basePath = "/app" }) {
  const navigate = useNavigate();

  const workOrders = Array.isArray(dispute?.work_orders) ? dispute.work_orders : [];
  const items = workOrders.filter((wo) => wo?.rework_milestone_id);

  if (!items.length) return null;

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
      {items.map((wo) => (
        <div key={wo?.id || wo?.rework_milestone_id} className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-extrabold text-emerald-900">
            ✅ Rework milestone created: Milestone #{wo.rework_milestone_id}
            {wo?.due_date ? (
              <span className="ml-2 text-xs font-bold text-emerald-800">(due {wo.due_date})</span>
            ) : null}
          </div>

          <button
            className="mhb-btn primary"
            style={{ padding: "6px 10px", fontSize: 12 }}
            onClick={() => navigate(`${basePath}/milestones?focus=${wo.rework_milestone_id}`)}
            title="View the rework milestone"
            type="button"
          >
            View
          </button>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Details / Respond / Resolve Modals
// ─────────────────────────────────────────────

function WorkspaceSection({ title, eyebrow = "", children, testId, tone = "default" }) {
  const toneClass =
    tone === "warning"
      ? "border-amber-200 bg-amber-50"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50"
        : "border-slate-200 bg-white";
  return (
    <section data-testid={testId} className={`rounded-2xl border ${toneClass} p-4`}>
      {eyebrow ? (
        <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-500">{eyebrow}</div>
      ) : null}
      <h3 className="mt-1 text-lg font-extrabold text-slate-950">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function InfoTile({ label, value, tone = "default" }) {
  const toneClass =
    tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-950"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-950"
        : "border-slate-200 bg-slate-50 text-slate-900";
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-extrabold">{value || "Not linked"}</div>
    </div>
  );
}

function resolutionSourceLabel(dispute) {
  if (dispute?.source_type) return labelFor(dispute.source_type, {});
  if (dispute?.payment_request || dispute?.invoice || dispute?.invoice_id) return "Payment Request";
  if (dispute?.expense || dispute?.expense_id) return "Expense";
  if (dispute?.amendment || dispute?.amendment_id) return "Amendment";
  if (dispute?.warranty_claim || dispute?.warranty_claim_id) return "Warranty";
  if (dispute?.milestone || dispute?.milestone_title) return "Milestone";
  if (dispute?.agreement || dispute?.agreement_number) return "Agreement";
  return "General Project Issue";
}

function buildResolutionTimeline(dispute, proposal, attachments) {
  if (Array.isArray(dispute?.timeline_events) && dispute.timeline_events.length) {
    return dispute.timeline_events.map((event) => ({
      at: event.occurred_at,
      title: event.title || labelFor(event.event_type, {}),
      detail: event.description,
      source: event.event_type ? labelFor(event.event_type, {}) : "Timeline",
    }));
  }
  const rows = [];
  const add = (at, title, detail, source = "System") => {
    if (!title) return;
    rows.push({ at, title, detail, source });
  };
  add(dispute?.created_at, "Resolution case opened", dispute?.description || dispute?.reason, "Case record");
  if (dispute?.fee_paid_at || dispute?.fee_paid) {
    add(dispute?.fee_paid_at || dispute?.updated_at, "Dispute fee paid and hold reviewed", dispute?.escrow_frozen ? "Escrow hold active where applicable." : "No active escrow hold recorded.", "Payment hold");
  }
  if (dispute?.homeowner_response) add(dispute?.responded_at || dispute?.updated_at, "Customer statement submitted", dispute.homeowner_response, "Party statement");
  if (dispute?.contractor_response && !proposal) add(dispute?.responded_at || dispute?.updated_at, "Contractor statement submitted", dispute.contractor_response, "Party statement");
  if (proposal) add(proposal.proposed_at || dispute?.updated_at, "Resolution proposal submitted", proposal.notes || proposal.proposal_type, "Proposal");
  for (const att of attachments) {
    add(att?.created_at || att?.uploaded_at, `Evidence uploaded: ${att?.kind || "file"}`, att?.name || att?.filename || att?.file || `Attachment #${att?.id || ""}`, "Evidence");
  }
  if (dispute?.resolved_at) add(dispute.resolved_at, "Human resolution recorded", dispute.resolution_notes || dispute.admin_notes, "Admin decision");
  return rows.sort((left, right) => {
    const leftTime = left.at ? new Date(left.at).getTime() : 0;
    const rightTime = right.at ? new Date(right.at).getTime() : 0;
    return leftTime - rightTime;
  });
}

function ResolutionOverview({ dispute, proposal, isAdmin }) {
  const next = nextStepLabel(dispute, isAdmin);
  const agreement = Array.isArray(dispute.resolution_agreements) ? dispute.resolution_agreements[0] : null;
  const documentCount = Array.isArray(dispute.resolution_documents) ? dispute.resolution_documents.length : 0;
  return (
    <WorkspaceSection title="Overview" eyebrow="Resolution Workspace" testId="resolution-workspace-overview">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={toneFor(dispute.status)}>{String(dispute.status || "").replaceAll("_", " ") || "Open"}</Badge>
        <Badge tone={pillToneForNext(next)}>{next}</Badge>
        {dispute.escrow_frozen ? <Badge tone="info" className="bg-slate-900 text-white">Escrow Hold Active</Badge> : <Badge>No active hold</Badge>}
        {proposal ? <Badge tone="good">Proposal on file</Badge> : null}
        {agreement ? <Badge tone="good">Resolution agreement {String(agreement.status || "").replaceAll("_", " ")}</Badge> : null}
        {documentCount ? <Badge tone="info">{documentCount} document package{documentCount === 1 ? "" : "s"}</Badge> : null}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <InfoTile label="Case origin" value={resolutionSourceLabel(dispute)} />
        <InfoTile label="Agreement" value={dispute.agreement_number ? `#${dispute.agreement_number}` : dispute.agreement ? `#${dispute.agreement}` : ""} />
        <InfoTile label="Milestone" value={dispute.milestone_title || (dispute.milestone ? `#${dispute.milestone}` : "")} />
        <InfoTile label="Current recommendation" value={proposal ? (proposal.proposed_solution || proposal.notes || labelFor(proposal.proposal_type, {})) : "Generate AI analysis or propose resolution"} />
      </div>
      <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-950">
        <b>Project Assistant summary:</b> This case is organized as a guided resolution record. Review the evidence,
        compare party statements, check payment impact, and use AI analysis as advisory decision-support only.
      </div>
    </WorkspaceSection>
  );
}

function ResolutionTimeline({ dispute, proposal, attachments }) {
  const rows = buildResolutionTimeline(dispute, proposal, attachments);
  return (
    <WorkspaceSection title="Timeline" eyebrow="Chronological Case History" testId="resolution-workspace-timeline">
      {rows.length ? (
        <div className="grid gap-2">
          {rows.map((row, idx) => (
            <div key={`${row.title}-${idx}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-extrabold text-slate-950">{row.title}</div>
                <div className="text-xs font-bold text-slate-500">{row.at ? new Date(row.at).toLocaleString() : "Date not recorded"}</div>
              </div>
              <div className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">{row.source}</div>
              {row.detail ? <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{String(row.detail).slice(0, 320)}</div> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-slate-600">Timeline entries appear as evidence, statements, proposals, and decisions are recorded.</div>
      )}
      <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-600">
        Timeline entries are persisted for case creation, statements, evidence, proposals, human decisions, signatures, and PDF package generation.
      </div>
    </WorkspaceSection>
  );
}

function ResolutionEvidence({ dispute, attachments, attachmentUrl }) {
  const durableEvidence = Array.isArray(dispute?.evidence_index) ? dispute.evidence_index : [];
  const evidenceRows = durableEvidence.length
    ? durableEvidence
    : attachments.map((attachment) => ({
        id: attachment?.id,
        attachment,
        category: attachment?.kind || "other",
        description: attachment?.name || attachment?.filename || attachment?.file,
        uploaded_at: attachment?.created_at || attachment?.uploaded_at,
        attachment_file_url: attachmentUrl(attachment),
      }));
  const categories = ["photo", "video", "document", "receipt", "invoice", "message", "agreement", "amendment", "inspection_report", "warranty_document", "other"];
  return (
    <WorkspaceSection title={`Evidence (${evidenceRows.length})`} eyebrow="Photos, Documents, Receipts, Messages" testId="resolution-workspace-evidence">
      <div className="mb-3 flex flex-wrap gap-2">
        {categories.map((category) => (
          <span key={category} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold capitalize text-slate-700">{category.replaceAll("_", " ")}</span>
        ))}
      </div>
      {evidenceRows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          No uploaded evidence yet. Add photos, documents, receipts, invoices, messages, inspection reports, or warranty documents.
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {evidenceRows.map((evidence) => {
            const a = evidence?.attachment || evidence;
            const name = evidence?.description || a?.name || a?.filename || `Evidence #${evidence?.id || a?.id || ""}`;
            const url = evidence?.attachment_file_url || attachmentUrl(a);
            return (
              <div key={evidence?.id || a?.id || name} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">{String(evidence?.category || a?.kind || "other").replaceAll("_", " ")}</div>
                    <div className="truncate text-sm font-extrabold text-slate-950">{name}</div>
                    <div className="text-xs text-slate-500">{evidence?.uploaded_at ? new Date(evidence.uploaded_at).toLocaleString() : ""}</div>
                    {evidence?.ai_summary ? <div className="mt-1 text-xs text-slate-600">{evidence.ai_summary}</div> : null}
                  </div>
                  {url ? <a className="mhb-btn" href={url} target="_blank" rel="noreferrer" style={{ padding: "6px 10px", fontSize: 12 }}>Open</a> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </WorkspaceSection>
  );
}

function PartyStatements({ dispute }) {
  const statements = Array.isArray(dispute.party_statements) ? dispute.party_statements : [];
  const current = (role) => statements.find((statement) => statement.party_role === role && statement.is_current) || statements.find((statement) => statement.party_role === role);
  const customer = current("customer");
  const contractor = current("contractor");
  const admin = current("admin");
  return (
    <WorkspaceSection title="Party Statements" eyebrow="Separate Records" testId="resolution-workspace-statements">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-sm font-extrabold text-slate-950">Customer</div>
          <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{String(customer?.text || dispute.homeowner_response || "").trim() || "No customer statement submitted yet."}</div>
          {customer ? <div className="mt-2 text-xs font-bold text-slate-500">Version {customer.version} - {customer.created_at ? new Date(customer.created_at).toLocaleString() : ""}</div> : null}
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-sm font-extrabold text-slate-950">Contractor</div>
          <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{String(contractor?.text || dispute.contractor_response || "").trim() || "No contractor statement submitted yet."}</div>
          {contractor ? <div className="mt-2 text-xs font-bold text-slate-500">Version {contractor.version} - {contractor.created_at ? new Date(contractor.created_at).toLocaleString() : ""}</div> : null}
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-sm font-extrabold text-slate-950">Administrator</div>
          <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{String(admin?.text || "").trim() || "No admin/internal statement submitted yet."}</div>
          {admin ? <div className="mt-2 text-xs font-bold text-slate-500">Version {admin.version} - {admin.created_at ? new Date(admin.created_at).toLocaleString() : ""}</div> : null}
        </div>
      </div>
      <div className="mt-3 text-sm text-slate-600">New statements are stored as immutable versions; legacy response fields remain visible for older cases.</div>
    </WorkspaceSection>
  );
}

function AgreementReview({ dispute }) {
  return (
    <WorkspaceSection title="Agreement Review" eyebrow="Contract Context" testId="resolution-workspace-agreement-review">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <InfoTile label="Agreement" value={dispute.agreement_number ? `#${dispute.agreement_number}` : dispute.agreement ? `#${dispute.agreement}` : ""} />
        <InfoTile label="Milestone scope" value={dispute.milestone_title || "General project issue"} />
        <InfoTile label="Change orders" value={dispute.amendment || dispute.amendment_id ? "Linked" : "Not linked yet"} />
        <InfoTile label="Warranty" value={dispute.warranty_claim || dispute.warranty_claim_id ? "Linked" : "Not linked yet"} />
        <InfoTile label="Payment schedule" value={dispute.invoice || dispute.invoice_id ? "Payment request linked" : "Use payment impact below"} />
      </div>
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        Project Assistant should reference applicable agreement sections neutrally. Full clause extraction is a future enhancement; this workspace currently uses existing agreement and milestone references.
      </div>
    </WorkspaceSection>
  );
}

function PaymentImpact({ dispute }) {
  return (
    <WorkspaceSection title="Payment Impact" eyebrow="No Automatic Money Movement" testId="resolution-workspace-payment-impact">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <InfoTile label="Escrow/payment status" value={dispute.escrow_frozen ? "Held or frozen where applicable" : "No active hold"} tone={dispute.escrow_frozen ? "warning" : "default"} />
        <InfoTile label="Fee" value={dispute.fee_paid ? "Paid" : money(dispute.fee_amount || 0)} />
        <InfoTile label="Approved amount" value={dispute.approved_amount != null ? money(dispute.approved_amount) : "Not decided"} />
        <InfoTile label="Disputed remainder" value={dispute.disputed_remainder != null ? money(dispute.disputed_remainder) : "Not decided"} />
        <InfoTile label="Financial outcome" value={dispute.financial_disposition ? labelFor(dispute.financial_disposition, FINANCIAL_LABELS) : "Manual review pending"} />
      </div>
      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-950">
        No payment changes occur automatically. Release, refund, split, reimbursement, or transfer actions require separate authorized human steps.
      </div>
    </WorkspaceSection>
  );
}

function HumanDecisionPanel({ dispute, isAdmin, isContractor, isClosedCase, onOpenProposal, onOpenRespond, onOpenResolve, onClose }) {
  const proposals = Array.isArray(dispute.resolution_proposals) ? dispute.resolution_proposals : [];
  const agreements = Array.isArray(dispute.resolution_agreements) ? dispute.resolution_agreements : [];
  const documents = Array.isArray(dispute.resolution_documents) ? dispute.resolution_documents : [];
  return (
    <WorkspaceSection title="Human Decision" eyebrow="Approval Required" testId="resolution-workspace-human-decision" tone="warning">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <InfoTile label="Accept / approve" value={isAdmin ? "Available through admin resolve" : "Use proposal or response workflow"} />
        <InfoTile label="Reject / counter" value="Submit a party statement or proposal" />
        <InfoTile label="Request evidence" value="Upload evidence and document the request in response notes" />
        <InfoTile label="Request inspection" value="Record in proposal or admin notes" />
        <InfoTile label="Request mediation" value="Escalate to admin review" />
        <InfoTile label="Modify resolution" value="Human users edit proposal/admin resolution before saving" />
      </div>
      {(proposals.length || agreements.length || documents.length) ? (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-amber-200 bg-white p-3">
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Proposals</div>
            <div className="mt-1 text-sm text-slate-700">{proposals.length ? proposals.map((p) => String(p.status || "draft").replaceAll("_", " ")).join(", ") : "None yet"}</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-white p-3">
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Resolution Agreements</div>
            <div className="mt-1 text-sm text-slate-700">{agreements.length ? agreements.map((a) => String(a.status || "draft").replaceAll("_", " ")).join(", ") : "None yet"}</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-white p-3">
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">PDF Packages</div>
            <div className="mt-1 grid gap-1 text-sm text-slate-700">
              {documents.length ? documents.map((doc) => (
                doc.file_url ? <a key={doc.id} className="font-bold text-blue-700" href={doc.file_url} target="_blank" rel="noreferrer">{doc.title || "Resolution package"}</a> : <span key={doc.id}>{doc.title || "Resolution package"}</span>
              )) : "None yet"}
            </div>
          </div>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {isContractor && !isClosedCase ? <button className="mhb-btn" onClick={onOpenProposal} disabled={!dispute.fee_paid} type="button">Propose Resolution</button> : null}
        {!isClosedCase ? <button className="mhb-btn" onClick={onOpenRespond} disabled={!canRespond(dispute)} type="button">Add Statement</button> : null}
        {isAdmin && !isClosedCase ? <button className="mhb-btn primary" onClick={onOpenResolve} disabled={!canResolveAdmin(dispute)} type="button">Record Human Resolution</button> : null}
        <button className="mhb-btn primary" onClick={onClose} type="button">Close Workspace</button>
      </div>
    </WorkspaceSection>
  );
}

function DetailsModal({
  open,
  dispute,
  isAdmin,
  isContractor,
  basePath,
  onClose,
  onOpenRespond,
  onOpenResolve,
  onOpenProposal,
  now,
  aiEnabled,
}) {
  if (!open || !dispute) return null;

  const statusText = String(dispute.status || "").replaceAll("_", " ");
  const next = nextStepLabel(dispute, isAdmin);
  const readOnlyLabel = getDisputeReadOnlyLabel(dispute.status);

  const attachments = Array.isArray(dispute.attachments) ? dispute.attachments : [];
  const attachmentUrl = (a) => a?.url || a?.file_url || a?.file || a?.download_url || "";

  const structuredProposals = Array.isArray(dispute.resolution_proposals) ? dispute.resolution_proposals : [];
  const proposal = structuredProposals[0] || extractProposalFromResponse(dispute.contractor_response);

  return (
    <ModalShell title={`Resolution Case #${dispute.id} - Workspace`} onClose={onClose} width="min(1120px, 96vw)">
      <div data-testid="resolution-workspace-title" className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-500">Resolution Workspace</div>
        <h2 className="mt-1 text-2xl font-extrabold text-slate-950">Resolution Case #{dispute.id}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          A guided investigation and settlement workspace. Project Assistant is neutral and advisory; human users make the final decision.
        </p>
      </div>
      <ResolutionOverview dispute={dispute} proposal={proposal} isAdmin={isAdmin} />
      <ResolutionTimeline dispute={dispute} proposal={proposal} attachments={attachments} />
      <ResolutionEvidence dispute={dispute} attachments={attachments} attachmentUrl={attachmentUrl} />
      <PartyStatements dispute={dispute} />
      <AgreementReview dispute={dispute} />
      <PaymentImpact dispute={dispute} />
      <div className="mhb-glass" style={{ padding: 12 }}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={toneFor(dispute.status)}>{statusText || "—"}</Badge>
          {readOnlyLabel ? <Badge tone="default">{readOnlyLabel}</Badge> : null}
          <Badge tone={pillToneForNext(next)}>{next}</Badge>
          <DeadlineBadge dispute={dispute} now={now} />
          {dispute.escrow_frozen ? (
            <Badge tone="info" className="bg-slate-900 text-white">
              Escrow Hold Active
            </Badge>
          ) : null}
          {hasAnyResponse(dispute) && !isClosed(dispute) ? <Badge tone="good">Response received</Badge> : null}
          {dispute.resolution_type ? <Badge tone="info">{labelFor(dispute.resolution_type, RESOLUTION_LABELS)}</Badge> : null}
          {dispute.financial_disposition ? (
            <Badge tone={financialTone(dispute.financial_disposition)}>{labelFor(dispute.financial_disposition, FINANCIAL_LABELS)}</Badge>
          ) : null}
        </div>

        <div className="mt-3">
          <DeadlineLine dispute={dispute} now={now} />
          {dispute.deadline_tier ? (
            <div className="text-xs text-slate-500">
              Deadline tier: <b>{dispute.deadline_tier}</b> ({dispute.deadline_hours || "?"}h)
            </div>
          ) : null}
          {dispute.deadline_missed_by ? (
            <div className="text-xs text-rose-700 font-bold">
              Deadline missed by: {String(dispute.deadline_missed_by).replaceAll("_", " ")}
            </div>
          ) : null}
        </div>
      </div>

      {/* ✅ AI Advisor panel (read-only, evidence-context only) */}
      <WorkspaceSection title="Project Assistant Resolution Analysis" eyebrow="Advisory Only" testId="resolution-workspace-ai-analysis">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-950">
          Project Assistant may summarize evidence, identify disputed facts, list missing evidence,
          compare courses of action, and recommend a COA. It cannot close the case or move money.
        </div>
        <DisputeAIAdvisor disputeId={dispute.id} enabled={aiEnabled} />
        {aiEnabled ? <DisputeAIRecommendationPanel disputeId={dispute.id} /> : null}
      </WorkspaceSection>

      {/* ✅ Rework milestone CTA */}
      <ReworkMilestoneCTA dispute={dispute} basePath={basePath} />

      {proposal ? <ProposalCard proposal={proposal} /> : null}

      <div className="mhb-glass" style={{ padding: 12 }}>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Resolution Type</div>
            <div className="mt-1 font-extrabold text-slate-900">{dispute.resolution_type ? labelFor(dispute.resolution_type, RESOLUTION_LABELS) : "Not recorded"}</div>
          </div>
          <div>
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Financial Disposition</div>
            <div className="mt-1 font-extrabold text-slate-900">{dispute.financial_disposition ? labelFor(dispute.financial_disposition, FINANCIAL_LABELS) : "Pending review"}</div>
          </div>
          <div>
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Escrow Hold</div>
            <div className="mt-1 font-extrabold text-slate-900">{dispute.escrow_frozen ? "Escrow hold active" : "No active hold"}</div>
          </div>
        </div>
        {(dispute.resolution_notes || dispute.admin_notes) ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="font-extrabold">Resolution notes are advisory and administrative. They do not determine legal liability or move funds automatically.</div>
            <div className="mt-2 whitespace-pre-wrap">{dispute.resolution_notes || dispute.admin_notes}</div>
          </div>
        ) : null}
      </div>

      <div className="mhb-glass" style={{ padding: 12 }}>
        <div className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Reason</div>
        <div className="mt-1 font-extrabold text-slate-900">{dispute.reason || "—"}</div>

        <div className="mt-4 text-xs font-extrabold uppercase tracking-wide text-slate-600">Description</div>
        <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{String(dispute.description || "").trim() || "—"}</div>
      </div>

      <div className="mhb-glass" style={{ padding: 12 }}>
        <div className="text-xs font-extrabold uppercase tracking-wide text-slate-600">
          Attachments ({attachments.length})
        </div>
        {attachments.length === 0 ? (
          <div className="mt-2 text-sm text-slate-500">—</div>
        ) : (
          <div className="mt-3 grid md:grid-cols-2 gap-2">
            {attachments.map((a) => {
              const name = a?.name || a?.filename || `Attachment #${a?.id || ""}`;
              const url = attachmentUrl(a);
              return (
                <div key={a?.id || name} className="rounded-xl border border-black/10 bg-white/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-extrabold text-slate-900">{name}</div>
                      <div className="text-xs text-slate-500">
                        {a?.created_at ? new Date(a.created_at).toLocaleString() : ""}
                      </div>
                    </div>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="mhb-btn"
                        style={{ padding: "6px 10px", fontSize: 12 }}
                      >
                        Open
                      </a>
                    ) : (
                      <span className="text-xs text-slate-400">No URL</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <HumanDecisionPanel
        dispute={dispute}
        isAdmin={isAdmin}
        isContractor={isContractor}
        isClosedCase={isClosed(dispute)}
        onOpenProposal={onOpenProposal}
        onOpenRespond={onOpenRespond}
        onOpenResolve={onOpenResolve}
        onClose={onClose}
      />
    </ModalShell>
  );
}

function RespondModal({ open, dispute, onClose, onSubmitted }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setText("");
  }, [open]);

  if (!open || !dispute) return null;

  const submit = async () => {
    const msg = (text || "").trim();
    if (!msg) {
      toast.error("Response is required.");
      return;
    }

    setBusy(true);
    try {
      await api.patch(`/projects/disputes/${dispute.id}/respond/`, { response: msg });
      toast.success("Response submitted.");
      onSubmitted?.();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to submit response.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title={`Respond to Resolution Case #${dispute.id}`} onClose={onClose}>
      <textarea
        className="w-full border rounded px-3 py-2"
        rows={6}
        placeholder="Write your rebuttal or proposed solution…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      <div className="flex justify-end gap-3">
        <button className="mhb-btn" onClick={onClose} disabled={busy} type="button">
          Close
        </button>
        <button className="mhb-btn primary" onClick={submit} disabled={busy || !text.trim()} type="button">
          {busy ? "Submitting…" : "Submit Response"}
        </button>
      </div>
    </ModalShell>
  );
}

function ResolveModal({ open, dispute, onClose, onResolved }) {
  const [resolutionType, setResolutionType] = useState("contractor_prevails");
  const [approvedAmount, setApprovedAmount] = useState("");
  const [disputedRemainder, setDisputedRemainder] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setResolutionType("contractor_prevails");
      setApprovedAmount("");
      setDisputedRemainder("");
      setNotes("");
    }
  }, [open]);

  if (!open || !dispute) return null;

  const submit = async () => {
    if (!window.confirm("Issue a final admin decision for this dispute?")) return;

    setBusy(true);
    try {
      await api.post(`/projects/disputes/${dispute.id}/resolve/`, {
        resolution_type: resolutionType,
        resolution_notes: notes,
        admin_notes: notes,
        ...(resolutionType === "partial_resolution"
          ? {
              approved_amount: approvedAmount,
              disputed_remainder: disputedRemainder,
            }
          : {}),
      });
      toast.success("Dispute resolved.");
      onResolved?.();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Resolve failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title={`Record Human Resolution - Case #${dispute.id}`} onClose={onClose}>
      <div>
        <label className="block text-sm text-slate-600 mb-1">Resolution Option</label>
        <select
          className="w-full border rounded px-3 py-2"
          value={resolutionType}
          onChange={(e) => setResolutionType(e.target.value)}
          disabled={busy}
        >
          <option value="contractor_prevails">Contractor Prevails - eligible for release review</option>
          <option value="customer_prevails">Customer Prevails - eligible for refund review</option>
          <option value="partial_resolution">Partial Resolution - manual financial review</option>
          <option value="rework_required">Rework Required - keep escrow held</option>
          <option value="administrative_closure">Administrative Closure - no financial action</option>
        </select>
      </div>

      {resolutionType === "partial_resolution" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="block text-sm text-slate-600 mb-1">Approved Amount</label>
            <input
              className="w-full border rounded px-3 py-2"
              value={approvedAmount}
              onChange={(e) => setApprovedAmount(e.target.value)}
              disabled={busy}
              placeholder="125.00"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">Disputed Remainder</label>
            <input
              className="w-full border rounded px-3 py-2"
              value={disputedRemainder}
              onChange={(e) => setDisputedRemainder(e.target.value)}
              disabled={busy}
              placeholder="75.00"
            />
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
        This records a human admin resolution and financial disposition only. It does not release, refund, split, or transfer funds.
      </div>

      <div>
        <label className="block text-sm text-slate-600 mb-1">Resolution Notes</label>
        <textarea
          className="w-full border rounded px-3 py-2"
          rows={5}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="flex justify-end gap-3">
        <button className="mhb-btn" onClick={onClose} disabled={busy} type="button">
          Close
        </button>
        <button className="mhb-btn primary" onClick={submit} disabled={busy} type="button">
          {busy ? "Resolving…" : "Resolve"}
        </button>
      </div>
    </ModalShell>
  );
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

export default function DisputesPages() {
  const { data: who } = useWhoAmI();
  const role = String(who?.type || who?.role || "").toLowerCase();
  const isAdmin = role === "admin";
  const isContractor = role === "contractor" || role === "contractor_owner";

  // Base path routing (future-proof if employees ever get a disputes view)
  const isEmployee = role.startsWith("employee");
  const basePath = isEmployee ? "/app/employee" : "/app";

  const aiDisputesEnabled = true;


  const [loading, setLoading] = useState(true);
  const [supportsDisputesApi, setSupportsDisputesApi] = useState(true);

  const [mine, setMine] = useState([]);
  const [customer, setCustomer] = useState([]);
  const [allDisputes, setAllDisputes] = useState([]);

  const [fallbackRows, setFallbackRows] = useState([]);

  const [showWizard, setShowWizard] = useState(false);

  const [respondOpen, setRespondOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);

  const [activeDispute, setActiveDispute] = useState(null);

  // Filters + Search
  const [filterKey, setFilterKey] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  // "now" ticker so countdown updates
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const filtersForRole = useMemo(
    () => (isAdmin ? [...FILTERS_ADMIN_EXTRA, ...FILTERS_BASE] : FILTERS_BASE),
    [isAdmin]
  );

  const asList = (r) => (Array.isArray(r.data) ? r.data : r.data?.results || []);

  const fetchNewApi = async () => {
    try {
      setLoading(true);
      const archivedParam = showArchived ? "&include_archived=1" : "";
      const reqs = [
        api.get(`/projects/disputes/?mine=true${archivedParam}`),
        api.get(`/projects/disputes/?initiator=homeowner${archivedParam}`),
      ];

      if (isAdmin) reqs.push(api.get(`/projects/disputes/?include_archived=${showArchived ? 1 : 0}`));

      const res = await Promise.all(reqs);

      setMine(asList(res[0]));
      setCustomer(asList(res[1]));
      if (isAdmin) setAllDisputes(asList(res[2]));

      setSupportsDisputesApi(true);
    } catch {
      setSupportsDisputesApi(false);
    } finally {
      setLoading(false);
    }
  };

  const fetchFallback = async () => {
    try {
      setLoading(true);
      const { data } = await api.get("/invoices/", { params: { status: "disputed" } });
      const rows = Array.isArray(data) ? data : data?.results || [];
      setFallbackRows(rows);
    } catch {
      toast.error("Failed to load disputed invoices.");
    } finally {
      setLoading(false);
    }
  };

  const refreshAll = async () => {
    await fetchNewApi();
    if (!supportsDisputesApi) await fetchFallback();
  };

  useEffect(() => {
    (async () => {
      await fetchNewApi();
      if (!supportsDisputesApi) await fetchFallback();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, showArchived]);

  const cancelDispute = async (d) => {
    if (!d?.id) return;

    if (!canCancel(d)) {
      toast.error("This dispute can’t be canceled once responses exist or after review begins.");
      return;
    }

    if (!window.confirm(`Cancel dispute #${d.id}? This will remove the escrow hold if one is active.`)) return;

    try {
      await api.patch(`/projects/disputes/${d.id}/cancel/`, {});
      toast.success("Dispute canceled.");
      refreshAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Cancel failed.");
    }
  };

  const payFee = async (d) => {
    try {
      await api.post(`/projects/disputes/${d.id}/pay-fee/`);
      toast.success("Fee paid. Escrow hold active.");
      refreshAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Payment failed.");
    }
  };

  const uploadAttachment = async (d, file, kind = "photo") => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    try {
      await api.post(`/projects/disputes/${d.id}/attachments/`, form);
      toast.success("Uploaded.");
      refreshAll();
    } catch {
      toast.error("Upload failed.");
    }
  };

  // Counts source for filter pills
  const filterRowsSource = useMemo(() => {
    const rows = isAdmin ? allDisputes : [...mine, ...customer];
    return showArchived ? rows : rows.filter((d) => !isDisputeArchived(d));
  }, [isAdmin, allDisputes, mine, customer, showArchived]);

  // Apply filter/search + Stage E admin urgency sort
  const mineFiltered = useMemo(
    () => applyFilterAndSearch(showArchived ? mine : mine.filter((d) => !isDisputeArchived(d)), filterKey, searchQuery, false, now),
    [mine, filterKey, searchQuery, now, showArchived]
  );

  const customerFiltered = useMemo(
    () => applyFilterAndSearch(showArchived ? customer : customer.filter((d) => !isDisputeArchived(d)), filterKey, searchQuery, false, now),
    [customer, filterKey, searchQuery, now, showArchived]
  );

  const allFiltered = useMemo(() => {
    const visible = showArchived ? allDisputes : allDisputes.filter((d) => !isDisputeArchived(d));
    const base = applyFilterAndSearch(visible, filterKey, searchQuery, true, now);
    return sortAdminUrgency(base, now);
  }, [allDisputes, filterKey, searchQuery, now, showArchived]);

  const RowActions = ({ d }) => {
    const archived = isDisputeArchived(d);

    if (archived) {
      return (
        <div className="flex flex-wrap gap-2 items-center opacity-85">
          <Badge tone="warn">Archived</Badge>
          <button
            className="mhb-btn"
            onClick={() => {
              setActiveDispute(d);
              setDetailsOpen(true);
            }}
            title="View details"
            type="button"
          >
            View
          </button>
        </div>
      );
    }

    if (isClosed(d)) {
      return (
        <div className="flex flex-wrap gap-2 items-center opacity-85">
          <Badge tone="default">{getDisputeReadOnlyLabel(d.status) || "Read only"}</Badge>
          <button
            className="mhb-btn"
            onClick={() => {
              setActiveDispute(d);
              setDetailsOpen(true);
            }}
            title="View details"
            type="button"
          >
            View
          </button>
          {!archived ? (
            <button
              className="mhb-btn"
              onClick={async () => {
                try {
                  await api.post(`/projects/disputes/${d.id}/archive/`, {});
                  toast.success("Dispute archived.");
                  refreshAll();
                } catch (e) {
                  toast.error(e?.response?.data?.detail || "Archive failed.");
                }
              }}
              title="Archive dispute"
              type="button"
            >
              Archive
            </button>
          ) : (
            <span
              className={
                operationalDisputes
                  ? "rounded-full border border-white/12 bg-white/10 px-2 py-0.5 text-[10px] font-extrabold text-sky-100/75"
                  : "rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-slate-700"
              }
            >
              Archived
            </span>
          )}
        </div>
      );
    }

    const cancelAllowed = canCancel(d);
    const cancelTooltip = (() => {
      const status = String(d?.status || "").toLowerCase();
      if (!["initiated", "open"].includes(status)) return "Cancel is only available before review begins.";
      if (hasAnyResponse(d)) return "Cancel is disabled after either party responds.";
      return "Cancel dispute (unfreezes escrow)";
    })();

    const next = nextStepLabel(d, isAdmin);

    return (
      <div className="flex flex-wrap gap-2 items-center">
        <Badge tone={pillToneForNext(next)} title="Next step">
          {next}
        </Badge>
        <DeadlineBadge dispute={d} now={now} />

        {d.escrow_frozen ? (
          <Badge tone="info" className="bg-slate-900 text-white" title="Escrow hold is currently active">
            Escrow Hold
          </Badge>
        ) : null}

        {!isClosed(d) ? (
          !d.fee_paid ? (
            <button className="mhb-btn" onClick={() => payFee(d)} title="Pay dispute fee and place an escrow hold where applicable" type="button">
              Pay Fee
            </button>
          ) : (
            <span className={`font-bold text-sm ${operationalDisputes ? "text-emerald-300" : "text-emerald-700"}`}>Fee Paid</span>
          )
        ) : (
          <span className={`font-bold text-sm ${operationalDisputes ? "text-sky-100/55" : "text-slate-500"}`}>Read only</span>
        )}

        <button
          className="mhb-btn"
          onClick={() => {
            setActiveDispute(d);
            setDetailsOpen(true);
          }}
          title="View details"
          type="button"
        >
          View
        </button>

        <button
          className="mhb-btn"
          onClick={() => {
            setActiveDispute(d);
            setRespondOpen(true);
          }}
          disabled={!canRespond(d)}
          type="button"
        >
          Respond
        </button>

        {isContractor && (
          <button
            className="mhb-btn"
            onClick={() => {
              setActiveDispute(d);
              setProposalOpen(true);
            }}
            disabled={!d.fee_paid || isClosed(d)}
            type="button"
          >
            Propose
          </button>
        )}

        <button
          className="mhb-btn"
          onClick={() => cancelDispute(d)}
          disabled={!cancelAllowed}
          title={cancelTooltip}
          type="button"
        >
          Cancel
        </button>

        {canUploadToDispute(d?.status) ? (
          <label className="mhb-btn" title="Upload evidence">
            Upload
            <input
              type="file"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                await uploadAttachment(d, file, "photo");
                e.target.value = "";
              }}
            />
          </label>
        ) : null}

        {hasAnyResponse(d) && !isClosed(d) && (
          <span
            className={
              operationalDisputes
                ? "inline-flex items-center gap-1 rounded-full border border-emerald-300/25 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-200"
                : "inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700"
            }
            title="At least one response has been submitted"
          >
            Response received
          </span>
        )}

        {isAdmin && (
          <button
            className="mhb-btn primary"
            onClick={() => {
              setActiveDispute(d);
              setResolveOpen(true);
            }}
            disabled={!canResolveAdmin(d)}
            type="button"
          >
            Resolve
          </button>
        )}

        {isClosed(d) ? (
          <span className={`self-center text-xs ${operationalDisputes ? "text-sky-100/55" : "text-slate-500"}`}>
            Read only
          </span>
        ) : null}
      </div>
    );
  };

  const operationalDisputes = !isAdmin;

  const Section = ({ title, items }) => (
    <section
      className={operationalDisputes ? "mhb-glass overflow-hidden rounded-2xl p-4 md:p-5" : "mhb-glass"}
      style={operationalDisputes ? undefined : { padding: 16 }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className={`text-lg font-extrabold ${operationalDisputes ? "text-white" : "text-slate-900"}`}>{title}</h2>
        <span
          className={
            operationalDisputes
              ? "rounded-full border border-white/12 bg-white/10 px-2.5 py-1 text-xs font-bold text-sky-100/75"
              : "rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600"
          }
        >
          {items.length} total
        </span>
      </div>
      {loading ? (
        <div>Loading…</div>
      ) : items.length === 0 ? (
        <div
          className={
            operationalDisputes
              ? "rounded-2xl border border-dashed border-white/14 bg-slate-950/35 px-4 py-6 text-sm text-sky-100/75"
              : "text-slate-500 text-sm"
          }
        >
          <div className={operationalDisputes ? "font-semibold text-sky-50" : "font-semibold text-slate-700"}>No resolution cases found.</div>
          <div className="mt-1">
            Resolution cases will appear here when escrow or project issues are opened.
          </div>
        </div>
      ) : (
        <div className={operationalDisputes ? "overflow-x-auto rounded-2xl border border-white/10" : "overflow-x-auto"}>
        <table className="w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead className={operationalDisputes ? "bg-white/8 text-sky-100/75" : "text-slate-500"}>
            <tr>
              <th className="text-left p-2">ID</th>
              <th className="text-left p-2">Agreement #</th>
              <th className="text-left p-2">Milestone</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Hold</th>
              <th className="text-left p-2">Disposition</th>
              <th className="text-left p-2">Next Action</th>
              <th className="text-left p-2">Created</th>
              <th className="text-left p-2">Attachments</th>
              <th className="text-left p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr
                key={d.id}
                className={`${operationalDisputes ? "border-t border-white/10 text-sky-100/80" : "border-t border-black/10"} align-top ${isClosed(d) ? "opacity-85" : ""}`}
              >
                <td className={`p-2 font-bold ${operationalDisputes ? "text-white" : "text-slate-900"}`}>#{d.id}</td>
                <td className={`p-2 ${operationalDisputes ? "text-sky-100/80" : ""}`}>{d.agreement_number || d.agreement}</td>
                <td className="p-2">{d.milestone_title || "—"}</td>
                <td className="p-2">
                  <Badge tone={isClosed(d) ? "danger" : toneFor(d.status)}>
                    {isClosed(d) ? "Resolved" : (d.status || "").replaceAll("_", " ")}
                  </Badge>
                  {d.resolution_type ? (
                    <div className="mt-1">
                      <Badge tone="info">{labelFor(d.resolution_type, RESOLUTION_LABELS)}</Badge>
                    </div>
                  ) : null}
                </td>
                <td className="p-2">
                  {d.escrow_frozen ? (
                    <Badge tone="info" className="bg-slate-900 text-white">Escrow Hold Active</Badge>
                  ) : (
                    <span className={operationalDisputes ? "text-sky-100/55" : "text-slate-500"}>No active hold</span>
                  )}
                </td>
                <td className="p-2">
                  {d.financial_disposition ? (
                    <Badge tone={financialTone(d.financial_disposition)}>{labelFor(d.financial_disposition, FINANCIAL_LABELS)}</Badge>
                  ) : (
                    <span className={operationalDisputes ? "text-sky-100/55" : "text-slate-500"}>Pending review</span>
                  )}
                  {!isClosed(d) ? (
                    <div className={`mt-1 text-xs font-bold ${d.fee_paid ? "text-emerald-300" : operationalDisputes ? "text-sky-100/70" : "text-slate-600"}`}>
                      {d.fee_paid ? "Fee paid" : `Fee ${money(d.fee_amount || 0)}`}
                    </div>
                  ) : null}
                </td>
                <td className="p-2">
                  <Badge tone={pillToneForNext(nextStepLabel(d, isAdmin))}>{nextStepLabel(d, isAdmin)}</Badge>
                  <DeadlineLine dispute={d} now={now} />
                </td>
                <td className="p-2">{d.created_at ? new Date(d.created_at).toLocaleDateString() : "—"}</td>
                <td className="p-2">{(d.attachments || []).length}</td>
                <td className="p-2">
                  <RowActions d={d} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );

  const Fallback = ({ rows }) => (
    <section
      className={operationalDisputes ? "mhb-glass overflow-hidden rounded-2xl p-4 md:p-5" : "mhb-glass"}
      style={operationalDisputes ? undefined : { padding: 16 }}
    >
      <h2 className={`mb-3 text-lg font-extrabold ${operationalDisputes ? "text-white" : "text-slate-900"}`}>
        Disputed Invoices
      </h2>
      {rows.length === 0 ? (
        <div
          className={
            operationalDisputes
              ? "rounded-2xl border border-dashed border-white/14 bg-slate-950/35 px-4 py-6 text-sm text-sky-100/75"
              : "text-slate-500 text-sm"
          }
        >
          No disputed invoices found.
        </div>
      ) : (
        <div className={operationalDisputes ? "overflow-x-auto rounded-2xl border border-white/10" : "overflow-x-auto"}>
        <table className="w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead className={operationalDisputes ? "bg-white/8 text-sky-100/75" : "text-slate-500"}>
            <tr>
              <th className="text-left p-2">Invoice #</th>
              <th className="text-left p-2">Project</th>
              <th className="text-left p-2">Homeowner</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Amount</th>
              <th className="text-left p-2">Disputed On</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inv) => {
              const disputedAt = inv.disputed_at || inv.updated_at || inv.created_at || null;
              return (
                <tr
                  key={inv.id}
                  className={operationalDisputes ? "border-t border-white/10 text-sky-100/80" : "border-t border-black/10"}
                >
                  <td className={`p-2 font-mono ${operationalDisputes ? "text-white" : "text-slate-900"}`}>
                    #{inv.invoice_number || inv.id}
                  </td>
                  <td className="p-2">{inv.project_title || inv.agreement_title || "-"}</td>
                  <td className="p-2">{inv.homeowner_name || "-"}</td>
                  <td className="p-2">{String(inv.status || "-").replace("_", " ")}</td>
                  <td className="p-2">{money(inv.amount_due ?? inv.amount)}</td>
                  <td className="p-2">{disputedAt ? new Date(disputedAt).toLocaleDateString() : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );

  const pageTitle = isAdmin ? "Admin Resolution Workspace" : "Resolution Workspace";
  const pageSubtitle = isAdmin
    ? "Review resolution cases, evidence, payment holds, and human decisions."
    : "Create resolution cases, organize evidence, compare party statements, and document human-approved outcomes.";

  const showNewButton = supportsDisputesApi && !isAdmin;
  const ShellComponent = isAdmin ? PageShell : ContractorPageSurface;
  const shellProps = isAdmin
    ? { title: pageTitle, subtitle: pageSubtitle, showLogo: true }
    : { eyebrow: "Operations", title: pageTitle, subtitle: pageSubtitle, variant: "operational" };

  return (
    <ShellComponent {...shellProps}>
      {supportsDisputesApi ? (
        <div
          className={
            operationalDisputes
              ? "mb-4 flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/35 p-3 shadow-sm md:flex-row md:items-center md:justify-between"
              : "mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
          }
        >
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <FilterBar
              rows={filterRowsSource}
              selected={filterKey}
              onChange={setFilterKey}
              filters={filtersForRole}
              isAdmin={isAdmin}
              now={now}
              operational={operationalDisputes}
            />
            <SearchBox
              value={searchQuery}
              onChange={setSearchQuery}
              onClear={() => setSearchQuery("")}
              operational={operationalDisputes}
            />
            <button
              type="button"
              className={`mhb-btn ${showArchived ? "primary" : ""}`}
              onClick={() => setShowArchived((prev) => !prev)}
            >
              {showArchived ? "Showing archived" : "Show archived"}
            </button>
          </div>

          <div className="flex gap-2">
            <button className="mhb-btn" onClick={refreshAll} disabled={loading} type="button">
              Refresh
            </button>
            {showNewButton && (
              <button
                data-testid="start-dispute-button"
                className="mhb-btn primary"
                onClick={() => setShowWizard(true)}
                disabled={!supportsDisputesApi}
                type="button"
              >
                Start Resolution Case
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex justify-end items-center mb-3">
          <button className="mhb-btn" onClick={refreshAll} disabled={loading} type="button">
            Refresh
          </button>
        </div>
      )}

      {supportsDisputesApi ? (
        <div className="grid gap-12">
          {!isAdmin && <Section title="Resolution Cases I Started" items={mineFiltered} />}
          {!isAdmin && <Section title="Resolution Cases Started by Customers" items={customerFiltered} />}
          {isAdmin && <Section title="All Resolution Cases" items={allFiltered} />}
        </div>
      ) : (
        <Fallback rows={fallbackRows} />
      )}

      {!isAdmin && (
        <DisputesCreateModal
          open={showWizard}
          onClose={() => {
            setShowWizard(false);
            refreshAll();
          }}
        />
      )}

      <DetailsModal
        open={detailsOpen}
        dispute={activeDispute}
        isAdmin={isAdmin}
        isContractor={isContractor}
        basePath={basePath}
        onClose={() => setDetailsOpen(false)}
        onOpenRespond={() => setRespondOpen(true)}
        onOpenResolve={() => setResolveOpen(true)}
        onOpenProposal={() => setProposalOpen(true)}
        now={now}
        aiEnabled={aiDisputesEnabled}
      />

      <ProposalModal open={proposalOpen} dispute={activeDispute} onClose={() => setProposalOpen(false)} onProposed={refreshAll} />

      <RespondModal open={respondOpen} dispute={activeDispute} onClose={() => setRespondOpen(false)} onSubmitted={refreshAll} />

      <ResolveModal open={resolveOpen} dispute={activeDispute} onClose={() => setResolveOpen(false)} onResolved={refreshAll} />
    </ShellComponent>
  );
}
