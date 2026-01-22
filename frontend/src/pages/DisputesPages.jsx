import React, { useEffect, useMemo, useState } from "react";
import api from "../api";
import { toast } from "react-hot-toast";
import PageShell from "../components/PageShell.jsx";
import DisputesCreateModal from "../components/DisputesCreateModal.jsx";
import { useWhoAmI } from "../hooks/useWhoAmI.js";
import { useNavigate } from "react-router-dom";

// ✅ NEW: AI Advisor (read-only, evidence-context-based)
import DisputeAIAdvisor from "../components/ai/DisputeAIAdvisor.jsx";

console.log("DisputesPages.jsx v2026-01-21 (AI Advisor added to Details modal)");

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
  const status = String(d?.status || "").toLowerCase();
  return Boolean(d?.fee_paid) && (status === "open" || status === "under_review");
};

// ✅ UX refinement: cancel only if early AND nobody has responded yet
const canCancel = (d) => {
  const status = String(d?.status || "").toLowerCase();
  if (!["initiated", "open"].includes(status)) return false;
  if (hasAnyResponse(d)) return false;
  return true;
};

const canResolveAdmin = (d) => {
  const status = String(d?.status || "").toLowerCase();
  return !["resolved_contractor", "resolved_homeowner", "canceled"].includes(status);
};

const isClosed = (d) => {
  const s = String(d?.status || "").toLowerCase();
  return ["resolved_contractor", "resolved_homeowner", "canceled"].includes(s);
};

// Stage A: compute a "Next step" label for scanning
const nextStepLabel = (d, isAdmin) => {
  const s = String(d?.status || "").toLowerCase();
  if (s === "canceled") return "Closed";
  if (s === "resolved_contractor" || s === "resolved_homeowner") return "Resolved";

  if (!d?.fee_paid) return "Waiting on fee";

  const hasHome = Boolean(String(d?.homeowner_response || "").trim());
  const hasCont = Boolean(String(d?.contractor_response || "").trim());

  if (hasHome && hasCont) return isAdmin ? "Ready for decision" : "Ready for review";
  if (!hasCont) return "Waiting on contractor";
  if (!hasHome) return "Waiting on homeowner";

  if (s === "under_review") return "Under review";
  return "Open";
};

const pillToneForNext = (label) => {
  const l = String(label || "").toLowerCase();
  if (l.includes("resolved") || l === "closed") return "good";
  if (l.includes("ready")) return "info";
  if (l.includes("waiting")) return "warn";
  if (l.includes("under review")) return "info";
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
  { key: "waiting_fee", label: "Waiting on fee" },
  { key: "waiting_contractor", label: "Waiting on contractor" },
  { key: "waiting_homeowner", label: "Waiting on homeowner" },
  { key: "ready", label: "Ready" },
  { key: "under_review", label: "Under review" },
  { key: "resolved", label: "Resolved" },
  { key: "canceled", label: "Canceled" },
];

const FILTERS_ADMIN_EXTRA = [
  { key: "overdue", label: "Overdue" },
  { key: "due_soon", label: "Due soon (24h)" },
];

function getFilterKeyBase(d) {
  const status = String(d?.status || "").toLowerCase();

  if (status === "canceled") return "canceled";
  if (status === "resolved_contractor" || status === "resolved_homeowner") return "resolved";
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

function SearchBox({ value, onChange, onClear }) {
  return (
    <div className="relative w-full md:w-[360px]">
      <input
        className="w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 pr-10 text-sm font-semibold text-slate-800 outline-none focus:bg-white"
        placeholder="Search disputes… (agreement #, milestone, reason, response)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value?.trim() ? (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-extrabold text-slate-600 hover:bg-slate-100"
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

function FilterBar({ rows, selected, onChange, filters, isAdmin, now }) {
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
              "rounded-full px-3 py-1 text-xs font-extrabold border transition",
              active
                ? "bg-slate-900 text-white border-black/10"
                : "bg-white/60 text-slate-800 border-black/10 hover:bg-white hover:text-slate-900",
            ].join(" ")}
            onClick={() => onChange(f.key)}
            title={`Show: ${f.label}`}
            type="button"
          >
            {f.label}{" "}
            <span className={active ? "text-white/80" : "text-slate-500"}>({count})</span>
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
    <ModalShell title={`Propose a Resolution — Dispute #${dispute.id}`} onClose={onClose}>
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

  const attachments = Array.isArray(dispute.attachments) ? dispute.attachments : [];
  const attachmentUrl = (a) => a?.url || a?.file_url || a?.file || a?.download_url || "";

  const proposal = extractProposalFromResponse(dispute.contractor_response);

  return (
    <ModalShell title={`Dispute #${dispute.id} — Details`} onClose={onClose}>
      <div className="mhb-glass" style={{ padding: 12 }}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={toneFor(dispute.status)}>{statusText || "—"}</Badge>
          <Badge tone={pillToneForNext(next)}>{next}</Badge>
          <DeadlineBadge dispute={dispute} now={now} />
          {dispute.escrow_frozen ? (
            <Badge tone="info" className="bg-slate-900 text-white">
              🧊 Escrow Frozen
            </Badge>
          ) : null}
          {hasAnyResponse(dispute) ? <Badge tone="good">✅ Response received</Badge> : null}
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
      <DisputeAIAdvisor disputeId={dispute.id} enabled={aiEnabled} />

      {/* ✅ Rework milestone CTA */}
      <ReworkMilestoneCTA dispute={dispute} basePath={basePath} />

      {proposal ? <ProposalCard proposal={proposal} /> : null}

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

      <div className="flex flex-wrap justify-end gap-2">
        {isContractor && (
          <button
            className="mhb-btn"
            onClick={onOpenProposal}
            disabled={!dispute.fee_paid || isClosed(dispute)}
            type="button"
          >
            Propose Solution
          </button>
        )}

        <button className="mhb-btn" onClick={onOpenRespond} disabled={!canRespond(dispute)} type="button">
          Respond
        </button>

        {isAdmin && (
          <button
            className="mhb-btn primary"
            onClick={onOpenResolve}
            disabled={!canResolveAdmin(dispute)}
            type="button"
          >
            Resolve
          </button>
        )}

        <button className="mhb-btn primary" onClick={onClose} type="button">
          Close
        </button>
      </div>
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
    <ModalShell title={`Respond to Dispute #${dispute.id}`} onClose={onClose}>
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
  const [outcome, setOutcome] = useState("contractor");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setOutcome("contractor");
      setNotes("");
    }
  }, [open]);

  if (!open || !dispute) return null;

  const submit = async () => {
    if (!window.confirm("Issue a final admin decision for this dispute?")) return;

    setBusy(true);
    try {
      await api.post(`/projects/disputes/${dispute.id}/resolve/`, {
        outcome,
        admin_notes: notes,
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
    <ModalShell title={`Admin Resolve — Dispute #${dispute.id}`} onClose={onClose}>
      <div>
        <label className="block text-sm text-slate-600 mb-1">Outcome</label>
        <select
          className="w-full border rounded px-3 py-2"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          disabled={busy}
        >
          <option value="contractor">Contractor wins (release)</option>
          <option value="homeowner">Homeowner wins (refund)</option>
          <option value="canceled">Cancel dispute</option>
        </select>
      </div>

      <div>
        <label className="block text-sm text-slate-600 mb-1">Admin Notes</label>
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

  // ✅ AI toggle (safe default OFF). Enable via:
  // - Vite env var: VITE_AI_DISPUTES_ENABLED=true
  // - OR localStorage override: localStorage.setItem("mhb_ai_disputes","1")
  const [featureFlags, setFeatureFlags] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/projects/feature-flags/");
        setFeatureFlags(data);
      } catch (e) {
        console.warn("Feature flags unavailable, disabling AI.");
        setFeatureFlags({
          ai_enabled: false,
          ai_disputes_enabled: false,
        });
      }
    })();
  }, []);

  const aiDisputesEnabled =
    featureFlags?.ai_enabled === true &&
    featureFlags?.ai_disputes_enabled === true;


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
      const reqs = [
        api.get("/projects/disputes/?mine=true"),
        api.get("/projects/disputes/?initiator=homeowner"),
      ];

      if (isAdmin) reqs.push(api.get("/projects/disputes/"));

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
  }, [isAdmin]);

  const cancelDispute = async (d) => {
    if (!d?.id) return;

    if (!canCancel(d)) {
      toast.error("This dispute can’t be canceled once responses exist or after review begins.");
      return;
    }

    if (!window.confirm(`Cancel dispute #${d.id}? This will unfreeze escrow.`)) return;

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
      toast.success("Fee paid. Escrow frozen.");
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
    if (isAdmin) return allDisputes;
    return [...mine, ...customer];
  }, [isAdmin, allDisputes, mine, customer]);

  // Apply filter/search + Stage E admin urgency sort
  const mineFiltered = useMemo(
    () => applyFilterAndSearch(mine, filterKey, searchQuery, false, now),
    [mine, filterKey, searchQuery, now]
  );

  const customerFiltered = useMemo(
    () => applyFilterAndSearch(customer, filterKey, searchQuery, false, now),
    [customer, filterKey, searchQuery, now]
  );

  const allFiltered = useMemo(() => {
    const base = applyFilterAndSearch(allDisputes, filterKey, searchQuery, true, now);
    return sortAdminUrgency(base, now);
  }, [allDisputes, filterKey, searchQuery, now]);

  const RowActions = ({ d }) => {
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
          <Badge tone="info" className="bg-slate-900 text-white" title="Escrow is currently frozen">
            🧊 Frozen
          </Badge>
        ) : null}

        {!d.fee_paid ? (
          <button className="mhb-btn" onClick={() => payFee(d)} title="Pay dispute fee (freezes escrow)" type="button">
            Pay Fee
          </button>
        ) : (
          <span className="text-emerald-700 font-bold text-sm">Fee Paid</span>
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

        {hasAnyResponse(d) && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700"
            title="At least one response has been submitted"
          >
            ✅ Response received
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

        {isClosed(d) ? <span className="text-xs text-slate-500 self-center">Closed</span> : null}
      </div>
    );
  };

  const Section = ({ title, items }) => (
    <div className="mhb-glass" style={{ padding: 16 }}>
      <div className="mb-2 font-extrabold text-slate-800">{title}</div>
      {loading ? (
        <div>Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-slate-500 text-sm">No disputes found.</div>
      ) : (
        <table className="w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr className="bg-slate-50">
              <th className="text-left p-2">ID</th>
              <th className="text-left p-2">Agreement #</th>
              <th className="text-left p-2">Milestone</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Fee</th>
              <th className="text-left p-2">Created</th>
              <th className="text-left p-2">Attachments</th>
              <th className="text-left p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id} className="border-t align-top">
                <td className="p-2 font-bold">#{d.id}</td>
                <td className="p-2">{d.agreement_number || d.agreement}</td>
                <td className="p-2">{d.milestone_title || "—"}</td>
                <td className="p-2">
                  <Badge tone={toneFor(d.status)}>{(d.status || "").replaceAll("_", " ")}</Badge>
                </td>
                <td className="p-2">
                  {d.fee_paid ? (
                    <span className="text-emerald-700 font-bold">Paid</span>
                  ) : (
                    <span className="text-slate-700">{money(d.fee_amount || 0)}</span>
                  )}
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
      )}
    </div>
  );

  const Fallback = ({ rows }) => (
    <div className="mhb-glass" style={{ padding: 16 }}>
      <div className="mb-2 font-extrabold text-slate-800">Disputed Invoices</div>
      {rows.length === 0 ? (
        <div className="text-slate-500 text-sm">🎉 No disputed invoices found.</div>
      ) : (
        <table className="w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr className="bg-slate-50">
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
                <tr key={inv.id} className="border-t">
                  <td className="p-2 font-mono">#{inv.invoice_number || inv.id}</td>
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
      )}
    </div>
  );

  const pageTitle = isAdmin ? "Admin Dispute Center" : "Dispute Center";
  const pageSubtitle = isAdmin
    ? "Overdue disputes are prioritized automatically."
    : "Initiate disputes, pay fee to freeze escrow, propose resolutions, and manage evidence.";

  const showNewButton = supportsDisputesApi && !isAdmin;

  return (
    <PageShell title={pageTitle} subtitle={pageSubtitle} showLogo>
      {supportsDisputesApi ? (
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <FilterBar
              rows={filterRowsSource}
              selected={filterKey}
              onChange={setFilterKey}
              filters={filtersForRole}
              isAdmin={isAdmin}
              now={now}
            />
            <SearchBox value={searchQuery} onChange={setSearchQuery} onClear={() => setSearchQuery("")} />
          </div>

          <div className="flex gap-2">
            <button className="mhb-btn" onClick={refreshAll} disabled={loading} type="button">
              Refresh
            </button>
            {showNewButton && (
              <button
                className="mhb-btn primary"
                onClick={() => setShowWizard(true)}
                disabled={!supportsDisputesApi}
                type="button"
              >
                Start Dispute
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
          {!isAdmin && <Section title="Disputes I Started" items={mineFiltered} />}
          {!isAdmin && <Section title="Disputes Started by Customers" items={customerFiltered} />}
          {isAdmin && <Section title="All Disputes" items={allFiltered} />}
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
    </PageShell>
  );
}
