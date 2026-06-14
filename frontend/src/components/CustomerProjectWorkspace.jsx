import React, { useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, FileText, MessageSquare, Star } from "lucide-react";
import toast from "react-hot-toast";

import api from "../api";

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "$0.00";
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentLinks({ attachments = [], testId = "" }) {
  const rows = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
  if (!rows.length) return null;
  return (
    <div data-testid={testId || undefined} className="mt-3 rounded-xl border border-slate-700 bg-slate-950/65 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Attachments ({rows.length})
      </div>
      <div className="mt-2 space-y-1">
        {rows.map((attachment, index) => {
          const label = attachment.filename || attachment.original_filename || attachment.name || `Attachment ${index + 1}`;
          const size = formatBytes(attachment.size);
          return (
            <a
              key={attachment.id || `${label}-${index}`}
              href={attachment.url || attachment.file_url || "#"}
              target="_blank"
              rel="noreferrer"
              className="block text-xs font-semibold text-sky-100 hover:text-white"
            >
              {label}
              {size ? <span className="ml-2 font-normal text-slate-400">{size}</span> : null}
            </a>
          );
        })}
      </div>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "Date pending";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return String(value);
  }
}

function materialReasonText(material = {}) {
  const name = String(material.name || material.supply_name || material.title || "").trim().toLowerCase();
  const materialDescriptions = {
    "framing lumber": "Structural framing materials.",
    "drywall sheets": "Interior wall finishing.",
    insulation: "Wall and ceiling insulation.",
    "interior paint": "Final finishing and touch-up work.",
    "roofing underlayment": "Moisture protection beneath roofing materials.",
    "starter shingles": "Starter course for roof edges.",
    flashing: "Waterproof transitions around roof penetrations.",
    "roofing nails": "Fasteners for roofing materials.",
    "drip edge": "Roof edge water-shedding trim.",
    "roof sealant": "Sealing around roof transitions.",
    "vent flashing": "Flashing for roof vents and penetrations.",
    "ice and water shield": "Extra moisture barrier in vulnerable roof areas.",
    "backer board": "Stable backing for wet-area tile.",
    "waterproofing membrane": "Moisture barrier for wet areas.",
    "tile mortar": "Tile installation adhesive.",
    grout: "Tile joint finishing material.",
    tile: "Selected wall or floor finish.",
    "fixture sealant": "Sealant around wet-area fixtures.",
    "concrete mix or ready-mix planning": "Concrete material planning for the pour.",
    "gravel base": "Compacted base layer.",
    "form boards": "Temporary forms for concrete edges.",
    "concrete sealer": "Final surface protection.",
    "rebar or wire mesh": "Concrete reinforcement.",
    "expansion joint material": "Joint spacing for concrete movement.",
    "curing supplies": "Supplies to support proper curing.",
    stakes: "Layout and form support.",
    "flooring material": "Selected finished flooring.",
    underlayment: "Layer beneath finished flooring.",
    transitions: "Flooring edge and room transitions.",
    trim: "Finish trim and edge details.",
    cabinetry: "Cabinet boxes and components.",
    countertops: "Countertop surface material.",
    sealant: "Sealing gaps and finish transitions.",
    "backsplash tile": "Kitchen wall finish material.",
    "cabinet hardware": "Pulls, knobs, and cabinet accessories.",
    "decking boards": "Finished deck surface.",
    "rail components": "Guardrail and handrail parts.",
    fasteners: "Project fasteners.",
    "post bases": "Post connection hardware.",
    "drywall sheets or patch panels": "Wall or ceiling patch material.",
    "joint compound": "Drywall seam and patch compound.",
    "drywall tape": "Drywall seam reinforcement.",
    primer: "Base coat before paint.",
    "texture material": "Wall or ceiling texture match.",
    "sanding supplies": "Surface preparation supplies.",
    "dust barriers": "Temporary dust-control protection.",
    "gutter sections": "Main gutter runs.",
    downspouts: "Vertical water drainage pieces.",
    elbows: "Downspout direction changes.",
    hangers: "Gutter mounting hardware.",
    "splash blocks": "Ground-level water diversion.",
    "end caps": "Gutter end closures.",
  };
  if (materialDescriptions[name]) return materialDescriptions[name];
  const reason = String(material.reason || "").trim();
  if (!reason || /materials?_hint|material guidance|saved milestone/i.test(reason)) {
    return "May be useful for this project based on the planned work.";
  }
  return reason;
}

function materialCategoryLabel(material = {}) {
  const category = String(material.category || "").trim();
  if (!category) return "";
  const generic = /^(project material|project materials|addition materials|closeout materials|finish supplies|installation supplies|site prep)$/i;
  if (generic.test(category)) return "";
  return category;
}

function statusTone(status = "") {
  const value = String(status).toLowerCase();
  if (value.includes("complete") || value.includes("paid") || value.includes("signed") || value.includes("released")) return "emerald";
  if (value.includes("review") || value.includes("draft") || value.includes("pending") || value.includes("submitted")) return "amber";
  if (value.includes("dispute") || value.includes("change")) return "rose";
  return "slate";
}

function Badge({ children, tone = "slate", ...props }) {
  const tones = {
    emerald: "border-emerald-300/40 bg-emerald-400/10 text-emerald-100",
    amber: "border-amber-300/40 bg-amber-400/10 text-amber-100",
    rose: "border-rose-300/40 bg-rose-400/10 text-rose-100",
    gold: "border-amber-300/50 bg-amber-300/15 text-amber-100",
    slate: "border-slate-500/40 bg-slate-800/80 text-slate-200",
  };
  return (
    <span {...props} className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  );
}

const AMENDMENT_CHANGE_TYPES = [
  ["scope_change", "Scope Change"],
  ["timeline_change", "Timeline Change"],
  ["price_change", "Price Change"],
  ["milestone_change", "Milestone Change"],
  ["descope_remove_work", "De-scope / Remove Work"],
  ["materials_change", "Materials Change"],
  ["warranty_change", "Warranty Change"],
  ["other", "Other"],
];

function amendmentChangeTypeLabel(value) {
  return AMENDMENT_CHANGE_TYPES.find(([key]) => key === value)?.[1] || "Other";
}

function Section({ title, eyebrow, children, testId }) {
  return (
    <section data-testid={testId} className="rounded-2xl border border-slate-700/80 bg-slate-950/55 p-5 shadow-xl shadow-slate-950/20">
      {eyebrow ? <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200/80">{eyebrow}</div> : null}
      <h3 className="mt-1 text-lg font-semibold text-white">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function extractMagicDrawToken(actionTarget = "") {
  const match = String(actionTarget || "").match(/\/draws\/magic\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function isInvoicePayment(payment) {
  const type = String(payment?.record_type || payment?.record_type_label || "").toLowerCase();
  return type.includes("invoice");
}

function paymentStatusText(payment) {
  return String(`${payment?.status || ""} ${payment?.status_label || ""}`).toLowerCase();
}

function paymentTypeText(payment) {
  return String(`${payment?.record_type || ""} ${payment?.record_type_label || ""} ${payment?.reference || ""}`).toLowerCase();
}

function paymentModeText(payment) {
  return String(`${payment?.payment_mode || ""} ${payment?.payment_mode_label || ""}`).toLowerCase();
}

function paymentAmountValue(payment) {
  const raw = payment?.amount ?? payment?.amount_label ?? "";
  const value = Number(String(raw || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function escrowLedgerValue(payment, key) {
  const ledger = payment?.escrow_ledger || {};
  const value = Number(String(ledger[key] || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function isEscrowFundingPayment(payment) {
  if (payment?.escrow_funding_record === true) return true;
  const status = paymentStatusText(payment);
  const type = paymentTypeText(payment);
  return (
    type === "escrow" ||
    type.includes("escrow funding") ||
    type.includes("funding") ||
    payment?.reference === "escrow_funded" ||
    (status.includes("funded") && escrowLedgerValue(payment, "funded") > 0)
  );
}

function isRefundPayment(payment) {
  const status = paymentStatusText(payment);
  const type = paymentTypeText(payment);
  return type.includes("refund") || status.includes("refund") || paymentAmountValue(payment) < 0;
}

function isEscrowReleasePayment(payment) {
  if (payment?.released_to_contractor === true) return !isEscrowFundingPayment(payment) && !isRefundPayment(payment);
  if (payment?.released_to_contractor === false) return false;
  const status = String(payment?.status || payment?.status_label || "").toLowerCase();
  const type = paymentTypeText(payment);
  const mode = paymentModeText(payment);
  if (isEscrowFundingPayment(payment) || isRefundPayment(payment)) return false;
  if (type.includes("draw") || type.includes("reimbursement")) {
    return status.includes("paid") || status.includes("released");
  }
  return isInvoicePayment(payment) && mode.includes("escrow") && (status.includes("paid") || status.includes("released"));
}

function isCustomerPaidPayment(payment) {
  if (payment?.customer_payment_recorded === true) return !isEscrowFundingPayment(payment) && !isEscrowReleasePayment(payment) && !isRefundPayment(payment);
  const status = paymentStatusText(payment);
  const mode = paymentModeText(payment);
  if (isEscrowFundingPayment(payment) || isEscrowReleasePayment(payment) || isRefundPayment(payment)) return false;
  return isInvoicePayment(payment) && !mode.includes("escrow") && status.includes("paid");
}

function isPaidPayment(payment) {
  return isEscrowReleasePayment(payment) || isCustomerPaidPayment(payment);
}

function isActionablePayment(payment) {
  if (payment?.is_actionable === false) return false;
  if (isEscrowFundingPayment(payment) || isRefundPayment(payment)) return false;
  return !isPaidPayment(payment) && paymentAmountValue(payment) > 0;
}

function isPaymentHistoryRecord(payment) {
  const status = paymentStatusText(payment);
  return (
    isEscrowReleasePayment(payment) ||
    isCustomerPaidPayment(payment) ||
    isRefundPayment(payment) ||
    status.includes("failed") ||
    status.includes("reversed")
  );
}

function isEscrowAdjustmentRecord(payment) {
  const status = paymentStatusText(payment);
  const type = paymentTypeText(payment);
  const notes = String(payment?.notes || "").toLowerCase();
  return (
    type.includes("adjustment") ||
    type.includes("chargeback") ||
    type.includes("reversal") ||
    status.includes("chargeback") ||
    status.includes("reversed") ||
    status.includes("reversal") ||
    notes.includes("adjustment") ||
    notes.includes("chargeback") ||
    notes.includes("reversal")
  );
}

function isEscrowHistoryRecord(payment) {
  return (
    isEscrowFundingPayment(payment) ||
    isEscrowReleasePayment(payment) ||
    isRefundPayment(payment) ||
    Boolean(payment?.dispute_escrow_hold_active) ||
    isEscrowAdjustmentRecord(payment)
  );
}

function paymentHistoryLabel(payment) {
  const status = paymentStatusText(payment);
  if (isRefundPayment(payment)) return "Refund Issued";
  if (status.includes("failed")) return "Payment Failed";
  if (status.includes("reversed")) return "Payment Reversed";
  if (isEscrowReleasePayment(payment)) return "Release Paid";
  if (isCustomerPaidPayment(payment)) return "Direct Payment";
  return "Adjustment";
}

function escrowHistoryLabel(payment) {
  if (isEscrowFundingPayment(payment)) return "Escrow Funded";
  if (isEscrowReleasePayment(payment)) return "Released to contractor";
  if (payment?.dispute_escrow_hold_active) return "Escrow Hold";
  if (isRefundPayment(payment)) return payment?.status === "eligible" ? "Refund Eligible" : "Refund Issued";
  if (isEscrowAdjustmentRecord(payment)) return "Escrow Adjustment";
  return "Adjustment";
}

function paymentHistoryDescription(payment) {
  if (isEscrowReleasePayment(payment)) return "Paid to contractor from escrow";
  if (isCustomerPaidPayment(payment)) return "Paid directly outside escrow";
  if (isRefundPayment(payment)) return "Returned or credited to the customer";
  return "";
}

function escrowHistoryDescription(payment) {
  if (isEscrowFundingPayment(payment)) return "Funds added to escrow";
  if (isEscrowReleasePayment(payment)) {
    const reference = payment.invoice_number || payment.reference || "this paid invoice";
    const remaining = escrowLedgerValue(payment, "available") || escrowLedgerValue(payment, "remaining") || escrowLedgerValue(payment, "balance_after");
    return [
      `Released from escrow for paid invoice ${reference}.`,
      remaining ? `Remaining escrow after release: ${money(remaining)}.` : "",
    ].filter(Boolean).join(" ");
  }
  if (payment?.dispute_escrow_hold_active) return "Escrow balance is paused while this issue is reviewed";
  if (isRefundPayment(payment)) return payment?.status === "eligible" ? "Available for homeowner refund review" : "Refund issued from escrow";
  if (isEscrowAdjustmentRecord(payment)) return "Escrow balance adjustment recorded";
  return "";
}

function paidProgressPercent(released = 0, projectValue = 0) {
  const releasedValue = Number(released || 0);
  const totalValue = Number(projectValue || 0);
  if (!Number.isFinite(releasedValue) || !Number.isFinite(totalValue) || totalValue <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((releasedValue / totalValue) * 100)));
}

function normalizeInvoiceMagicUrl(actionTarget = "") {
  const value = String(actionTarget || "");
  const invoiceMatch = value.match(/\/invoice\/([^/?#]+)/);
  if (invoiceMatch) return `/invoices/magic/${encodeURIComponent(decodeURIComponent(invoiceMatch[1]))}`;
  const magicMatch = value.match(/\/invoices\/magic\/([^/?#]+)/);
  if (magicMatch) return `/invoices/magic/${encodeURIComponent(decodeURIComponent(magicMatch[1]))}`;
  return value;
}

function isReviewablePayment(payment) {
  const status = String(payment?.status || payment?.status_label || "").toLowerCase();
  const type = String(payment?.record_type || payment?.record_type_label || "").toLowerCase();
  return type.includes("draw") && (status.includes("submitted") || status.includes("review") || status.includes("pending"));
}

function isReimbursementPayment(payment) {
  const type = String(payment?.record_type || payment?.record_type_label || "").toLowerCase();
  return type.includes("reimbursement");
}

function canReviewReimbursement(payment) {
  const status = String(payment?.status || "").toLowerCase();
  return isReimbursementPayment(payment) && (payment?.can_approve || ["submitted", "sent_to_homeowner"].includes(status));
}

function hasOpenDispute(payment) {
  const value = String(payment?.dispute_status || payment?.dispute_status_label || "").toLowerCase();
  return value && !value.includes("no dispute") && value !== "none";
}

function customerDisputeStatus(payment) {
  if (!hasOpenDispute(payment)) return null;
  const resolution = String(payment?.dispute_resolution_type || "").trim();
  if (resolution) return { label: "Resolution recorded", detail: "Review the dispute thread for the recorded outcome and next steps." };
  if (payment?.dispute_escrow_hold_active) return { label: "Escrow hold active", detail: "Funds tied to this issue remain paused while the dispute is reviewed." };
  const next = String(payment?.dispute_next_action || "").trim();
  if (next) return { label: next, detail: "Track the issue status before approving any release." };
  const label = payment.dispute_status_label || payment.dispute_status || "Dispute opened";
  return { label, detail: "Track the issue status before approving any release." };
}

function ReviewPromptCard({ project, token, onPortalUpdate }) {
  const review = project?.review || {};
  const [form, setForm] = useState({ rating: 5, title: "", review_text: "" });
  const [submitting, setSubmitting] = useState(false);
  const agreementId = review.agreement_id || project?.agreement_id;
  const existing = review.existing_review;

  const submit = async () => {
    if (!token || !agreementId) return;
    setSubmitting(true);
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/agreements/${encodeURIComponent(agreementId)}/review/`,
        form
      );
      if (data?.portal) onPortalUpdate?.(data.portal);
      toast.success("Thanks for sharing your feedback.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not submit that review.");
    } finally {
      setSubmitting(false);
    }
  };

  if (existing) {
    return (
      <Section title="Project Review" eyebrow="Feedback" testId="customer-project-review-submitted">
        <div className="rounded-2xl border border-emerald-300/35 bg-emerald-400/10 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="emerald">Feedback shared</Badge>
            <Badge>{existing.status_label || "Pending Review"}</Badge>
          </div>
          <p className="mt-3 text-sm leading-6 text-emerald-50">
            Thank you for sharing feedback about your project experience. Public display depends on moderation status.
          </p>
          <div className="mt-3 text-sm font-semibold text-white">{existing.rating}/5 {existing.title ? `· ${existing.title}` : ""}</div>
        </div>
      </Section>
    );
  }

  if (!review.eligible) {
    return null;
  }

  return (
    <Section title="Share Feedback" eyebrow="Project review" testId="customer-project-review-prompt">
      <div className="rounded-2xl border border-amber-300/40 bg-amber-300/10 p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl border border-amber-200/40 bg-amber-300/15 p-2 text-amber-100">
            <Star size={18} />
          </div>
          <div>
            <h4 className="text-base font-semibold text-white">Share feedback about your project experience.</h4>
            <p className="mt-1 text-sm leading-6 text-slate-300">
              Your review helps future customers understand completed project experiences. MyHomeBro does not guarantee contractor quality.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
          <label className="block text-sm font-semibold text-slate-200">
            Rating
            <select
              value={form.rating}
              onChange={(event) => setForm((current) => ({ ...current, rating: Number(event.target.value || 5) }))}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
            >
              {[5, 4, 3, 2, 1].map((rating) => (
                <option key={rating} value={rating}>{rating} star{rating === 1 ? "" : "s"}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-200">
            Review title
            <input
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
              placeholder="Optional short summary"
            />
          </label>
        </div>
        <label className="mt-3 block text-sm font-semibold text-slate-200">
          Written review
          <textarea
            value={form.review_text}
            onChange={(event) => setForm((current) => ({ ...current, review_text: event.target.value }))}
            rows={4}
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
            placeholder="What went well? What should future customers know?"
          />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-300 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-200 disabled:opacity-60"
        >
          {submitting ? "Submitting..." : "Submit Review"}
        </button>
      </div>
    </Section>
  );
}

function ProjectReviewCard({ payment, token, onPortalUpdate }) {
  const [acting, setActing] = useState("");
  const [showChanges, setShowChanges] = useState(false);
  const [showDispute, setShowDispute] = useState(false);
  const [note, setNote] = useState("");
  const [disputeReason, setDisputeReason] = useState("Work needs correction");
  const [disputeNote, setDisputeNote] = useState("");
  const drawToken = extractMagicDrawToken(payment?.action_target);
  const drawId = payment?.record_id || String(payment?.id || "").replace(/^draw-/, "");
  const canOpenPortalDispute = Boolean(token && drawId);
  const disputeIsOpen = hasOpenDispute(payment);
  const disputeStatus = customerDisputeStatus(payment);

  const approve = async () => {
    if (!drawToken) {
      window.open(payment?.action_target || "#", "_blank", "noopener,noreferrer");
      return;
    }
    setActing("approve");
    try {
      await api.patch(`/projects/draws/magic/${encodeURIComponent(drawToken)}/approve/`, {});
      toast.success("Milestone review approved.");
      onPortalUpdate?.();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not approve that review.");
    } finally {
      setActing("");
    }
  };

  const requestChanges = async () => {
    if (!drawToken) {
      window.open(payment?.action_target || "#", "_blank", "noopener,noreferrer");
      return;
    }
    setActing("changes");
    try {
      await api.patch(`/projects/draws/magic/${encodeURIComponent(drawToken)}/request_changes/`, { note });
      toast.success("Change request sent.");
      setShowChanges(false);
      setNote("");
      onPortalUpdate?.();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not send that change request.");
    } finally {
      setActing("");
    }
  };

  const openDispute = async () => {
    if (!canOpenPortalDispute) {
      window.open(
        `${payment?.action_target || "#"}${String(payment?.action_target || "").includes("?") ? "&" : "?"}action=dispute`,
        "_blank",
        "noopener,noreferrer"
      );
      return;
    }
    setActing("dispute");
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/draws/${encodeURIComponent(drawId)}/dispute/`,
        {
          reason: disputeReason,
          description: disputeNote,
        }
      );
      if (data?.portal) {
        onPortalUpdate?.(data.portal);
      } else {
        onPortalUpdate?.();
      }
      toast.success("Dispute opened.");
      setShowDispute(false);
      setDisputeNote("");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not open that dispute.");
    } finally {
      setActing("");
    }
  };

  return (
    <article data-testid={`customer-project-review-${payment.id}`} className="rounded-2xl border border-amber-300/45 bg-amber-300/10 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="gold">Needs review</Badge>
            <Badge>{payment.record_type_label || "Milestone release"}</Badge>
          </div>
          <h4 className="mt-3 text-base font-semibold text-white">{payment.project_title || "Milestone review"}</h4>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            Review the completed work and requested amount before funds move forward.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <Badge tone="amber">{payment.amount_label || money(payment.amount)}</Badge>
            <Badge tone={statusTone(payment.status_label)}>{payment.status_label || "Pending review"}</Badge>
            {disputeStatus ? <Badge tone="rose">{disputeStatus.label}</Badge> : null}
            {payment.reference ? <Badge>{payment.reference}</Badge> : null}
          </div>
          {disputeStatus ? (
            <div data-testid={`customer-project-review-dispute-status-${payment.id}`} className="mt-3 rounded-xl border border-rose-300/35 bg-rose-400/10 p-3 text-sm text-rose-50">
              <div className="font-semibold">{disputeStatus.label}</div>
              <p className="mt-1 leading-6 text-rose-100/85">{disputeStatus.detail}</p>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
          <button
            type="button"
            onClick={approve}
            disabled={Boolean(acting)}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-400 px-4 py-2 text-sm font-bold text-emerald-950 hover:bg-emerald-300 disabled:opacity-60"
          >
            {acting === "approve" ? "Approving..." : "Approve"}
          </button>
          <button
            type="button"
            onClick={() => setShowChanges((value) => !value)}
            disabled={Boolean(acting)}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-200/50 bg-slate-950/70 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-slate-900 disabled:opacity-60"
          >
            Request Changes
          </button>
          {payment.action_target ? (
            <a
              href={payment.action_target}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sky-300/35 bg-sky-400/10 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/20"
            >
              Open Details
              <ExternalLink size={14} />
            </a>
          ) : null}
          {disputeIsOpen && payment.dispute_url ? (
            <a
              data-testid={`customer-project-review-dispute-${payment.id}`}
              href={payment.dispute_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300/40 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/20"
            >
              Track Issue Status
              <ExternalLink size={14} />
            </a>
          ) : payment.action_target ? (
            <button
              data-testid={`customer-project-review-dispute-${payment.id}`}
              type="button"
              onClick={() => setShowDispute((value) => !value)}
              disabled={Boolean(acting)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300/40 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/20 disabled:opacity-60"
            >
              Open Dispute
            </button>
          ) : null}
        </div>
      </div>
      {showChanges ? (
        <div className="mt-4 rounded-xl border border-amber-200/35 bg-slate-950/70 p-3">
          <label className="block text-sm font-semibold text-amber-100">
            Note for your contractor
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
              placeholder="Describe what needs clarification or correction."
            />
          </label>
          <button
            type="button"
            onClick={requestChanges}
            disabled={Boolean(acting)}
            className="mt-3 rounded-xl bg-amber-300 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-200 disabled:opacity-60"
          >
            {acting === "changes" ? "Sending..." : "Send Change Request"}
          </button>
        </div>
      ) : null}
      {showDispute ? (
        <div data-testid={`customer-project-review-dispute-form-${payment.id}`} className="mt-4 rounded-xl border border-rose-200/35 bg-rose-950/30 p-3">
          <div className="text-sm font-semibold text-rose-100">Tell us what is wrong</div>
          <p className="mt-1 text-sm leading-6 text-rose-100/85">
            This opens an issue tied to this milestone review. Your contractor can respond through the existing dispute workflow.
          </p>
          <label className="mt-3 block text-sm font-semibold text-rose-100">
            Reason
            <select
              value={disputeReason}
              onChange={(event) => setDisputeReason(event.target.value)}
              className="mt-2 w-full rounded-xl border border-rose-200/25 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-rose-200"
            >
              <option>Work needs correction</option>
              <option>Amount looks incorrect</option>
              <option>Work is incomplete</option>
              <option>Materials or scope concern</option>
              <option>Other issue</option>
            </select>
          </label>
          <label className="mt-3 block text-sm font-semibold text-rose-100">
            Homeowner note
            <textarea
              value={disputeNote}
              onChange={(event) => setDisputeNote(event.target.value)}
              rows={3}
              className="mt-2 w-full rounded-xl border border-rose-200/25 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-rose-200"
              placeholder="Describe what needs to be reviewed before this payment release."
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openDispute}
              disabled={Boolean(acting)}
              className="rounded-xl bg-rose-300 px-4 py-2 text-sm font-bold text-rose-950 hover:bg-rose-200 disabled:opacity-60"
            >
              {acting === "dispute" ? "Opening..." : "Open Dispute"}
            </button>
            <button
              type="button"
              onClick={() => setShowDispute(false)}
              disabled={Boolean(acting)}
              className="rounded-xl border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default function CustomerProjectWorkspace({
  projects = [],
  agreements = [],
  payments = [],
  documents = [],
  notifications = [],
  propertyProfiles = [],
  token = "",
  onRefresh,
}) {
  const [selectedId, setSelectedId] = useState(projects[0]?.id || null);
  const [projectFilter, setProjectFilter] = useState("open");
  const [workFilter, setWorkFilter] = useState("all");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [sortBy, setSortBy] = useState("recently_updated");
  const [searchTerm, setSearchTerm] = useState("");
  const [visibleCount, setVisibleCount] = useState(10);
  const [expandedDetails, setExpandedDetails] = useState({
    needs: true,
    payments: false,
    documents: false,
    activity: false,
  });
  const [materialsExpanded, setMaterialsExpanded] = useState(false);
  const [reimbursementAction, setReimbursementAction] = useState("");
  const [denyReimbursementPayment, setDenyReimbursementPayment] = useState(null);
  const [denyReimbursementReason, setDenyReimbursementReason] = useState("");
  const [denyReimbursementError, setDenyReimbursementError] = useState("");
  const [actionModal, setActionModal] = useState("");
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [amendmentAiBusy, setAmendmentAiBusy] = useState(false);
  const [amendmentAiError, setAmendmentAiError] = useState("");
  const [amendmentSuggestion, setAmendmentSuggestion] = useState(null);
  const [actionForm, setActionForm] = useState({
    change_type: "scope_change",
    requested_change: "",
    reason: "",
    revised_project_value: "",
    affected_milestone_ids: [],
    requested_amount: "",
    desired_resolution: "",
    description: "",
    attachment_note: "",
  });

  const findAgreementForProject = (project) => {
    if (!project) return null;
    return (
      agreements.find((agreement) => String(agreement.id) === String(project.agreement_id)) ||
      agreements.find((agreement) => String(agreement.agreement_token || "") === String(project.agreement_token || "")) ||
      agreements.find((agreement) => agreement.project_title === project.title) ||
      null
    );
  };

  const paymentsForProject = (project) =>
    payments.filter((payment) => {
      if (project?.agreement_id && String(payment.agreement_id || "") === String(project.agreement_id)) return true;
      return payment.project_title === project?.title;
    });

  const documentsForProject = (project) =>
    documents.filter((document) => {
      if (project?.agreement_id && String(document.agreement_id || "") === String(project.agreement_id)) return true;
      return document.project_title === project?.title;
    });

  const buildNextAction = (project, relatedPayments, agreement) => {
    if (relatedPayments.some(isReviewablePayment)) return "Review payment";
    if (relatedPayments.some((payment) => hasOpenDispute(payment))) return "Track issue";
    if (relatedPayments.some(isActionablePayment)) return "Pay invoice";
    const status = `${project?.status || ""} ${project?.status_label || ""} ${agreement?.status || ""} ${agreement?.status_label || ""}`.toLowerCase();
    if (status.includes("signature") || status.includes("sent") || status.includes("unsigned")) return "Review agreement";
    if (status.includes("complete") || status.includes("closed") || status.includes("archived")) return "View project record";
    return "View details";
  };

  const deriveHomeownerStatus = ({ project = {}, agreement = {}, relatedPayments = [] }) => {
    const rawStatus = String(agreement?.status || project?.status || "").toLowerCase();
    const rawLabel = String(agreement?.status_label || project?.status_label || "").toLowerCase();
    const haystack = `${rawStatus} ${rawLabel} ${project?.customer_visible_reason || ""} ${agreement?.customer_visible_reason || ""}`.toLowerCase();
    const fullySigned = Boolean(
      agreement?.is_fully_signed ||
      (agreement?.signed_by_contractor && agreement?.signed_by_homeowner) ||
      project?.is_fully_signed
    );
    const homeownerSigned = Boolean(agreement?.signed_by_homeowner || project?.signed_by_homeowner);
    const contractorSigned = Boolean(agreement?.signed_by_contractor || project?.signed_by_contractor);
    const hasDispute = relatedPayments.some(hasOpenDispute) || haystack.includes("dispute");
    const hasReview = relatedPayments.some(isReviewablePayment) || haystack.includes("review");
    const hasPendingPayment = relatedPayments.some(isActionablePayment);
    const paidOrReleased = relatedPayments.some(isPaidPayment);
    const escrowFunded = relatedPayments.some((payment) => {
      const ledger = payment?.escrow_ledger || {};
      return numericValue(ledger.funded || ledger.available) > 0;
    });
    const completedMilestoneCount = (project?.milestones || []).filter((milestone) =>
      String(milestone.status || "").toLowerCase().includes("complete")
    ).length;
    const hasActiveMilestones = (project?.milestones || []).some((milestone) => {
      const value = String(milestone.status || "").toLowerCase();
      return value && !value.includes("complete") && !value.includes("cancel") && !value.includes("closed");
    });
    const paymentMode = String(agreement?.payment_mode || agreement?.payment_mode_label || project?.payment_mode || "").toLowerCase();

    if (hasDispute) return { label: "Disputed", group: "open" };
    if (hasReview) return { label: "Awaiting Review", group: "open" };
    if (hasPendingPayment) return { label: "Payment Pending", group: "open" };
    if (haystack.includes("cancel") || haystack.includes("archiv") || haystack.includes("closed")) return { label: "Closed", group: "closed" };
    if (haystack.includes("complete") || project?.completed_at || agreement?.completed_at) return { label: "Completed", group: "closed" };
    if (rawStatus.includes("funded") || rawLabel.includes("funded") || escrowFunded) {
      return hasActiveMilestones || completedMilestoneCount ? { label: "In Progress", group: "open" } : { label: "Funded", group: "open" };
    }
    if (fullySigned || rawStatus.includes("signed") || rawLabel.includes("signed")) {
      if (paymentMode.includes("escrow") && !paidOrReleased && !escrowFunded) return { label: "Escrow Needed", group: "open" };
      if (paidOrReleased || hasActiveMilestones || completedMilestoneCount) return { label: "In Progress", group: "open" };
      return { label: "Signed", group: "open" };
    }
    if (contractorSigned || homeownerSigned || haystack.includes("sent") || haystack.includes("signature")) {
      return { label: "Sent for Signature", group: "open" };
    }
    if (rawStatus.includes("draft") || rawLabel.includes("draft")) return { label: "Draft", group: "open" };
    return { label: "In Progress", group: "open" };
  };

  const workTypeForRow = (project = {}, agreement = {}) => {
    const haystack = [
      project.project_mode,
      project.mode,
      project.project_type,
      project.project_subtype,
      project.type,
      project.subtype,
      project.title,
      project.description,
      agreement.project_mode,
      agreement.project_type,
      agreement.project_subtype,
      agreement.description,
    ].join(" ").toLowerCase();
    if (haystack.includes("diy") || haystack.includes("assistance")) return "diy_assistance";
    if (haystack.includes("maintenance") || haystack.includes("service visit") || haystack.includes("recurring")) return "maintenance";
    if (haystack.includes("repair") || haystack.includes("fix")) return "repair";
    if (haystack.includes("inspection") || haystack.includes("inspect")) return "inspection";
    return "full_service";
  };

  const propertyKeyForRow = (project = {}) => {
    const explicit = project.property_id || project.property_profile_id || project.property?.id;
    if (explicit) return String(explicit);
    const address = String(project.address || project.property_address || "").toLowerCase();
    const match = propertyProfiles.find((property) => {
      const values = [
        property.id,
        property.display_name,
        property.address,
        property.address_line1,
        property.formatted_address,
      ].map((value) => String(value || "").toLowerCase()).filter(Boolean);
      return values.some((value) => address && (address.includes(value) || value.includes(address)));
    });
    return match?.id ? String(match.id) : "";
  };

  const numericValue = (value) => Number(String(value || "").replace(/[^0-9.-]/g, "") || 0);
  const dateValue = (value) => {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? time : 0;
  };
  const buildPaymentModel = (paymentRows = []) => {
    const contractorInvoices = paymentRows
      .filter((payment) => isInvoicePayment(payment) && !isEscrowFundingPayment(payment))
      .reduce((sum, payment) => sum + paymentAmountValue(payment), 0);
    const escrowFundingRowsTotal = paymentRows
      .filter(isEscrowFundingPayment)
      .reduce((sum, payment) => sum + paymentAmountValue(payment), 0);
    const escrowLedgerFunded = Math.max(0, ...paymentRows.map((payment) => escrowLedgerValue(payment, "funded")));
    const escrowLedgerAvailable = Math.max(0, ...paymentRows.map((payment) => escrowLedgerValue(payment, "available")));
    const escrowFunded = Math.max(escrowFundingRowsTotal, escrowLedgerFunded);
    const releasedToContractor = paymentRows
      .filter(isEscrowReleasePayment)
      .reduce((sum, payment) => sum + paymentAmountValue(payment), 0);
    const customerPayments = paymentRows
      .filter(isCustomerPaidPayment)
      .reduce((sum, payment) => sum + paymentAmountValue(payment), 0);
    const refunds = Math.abs(
      paymentRows
        .filter(isRefundPayment)
        .reduce((sum, payment) => sum + paymentAmountValue(payment), 0)
    );
    const pendingReview = paymentRows
      .filter(isReviewablePayment)
      .reduce((sum, payment) => sum + paymentAmountValue(payment), 0);
    const pendingPayment = paymentRows
      .filter((payment) => isActionablePayment(payment) && !isReviewablePayment(payment))
      .reduce((sum, payment) => sum + paymentAmountValue(payment), 0);
    const calculatedRemainingInEscrow = Math.max(0, escrowFunded - releasedToContractor - refunds);
    const remainingInEscrow = escrowLedgerAvailable ? Math.min(escrowLedgerAvailable, calculatedRemainingInEscrow) : calculatedRemainingInEscrow;

    return {
      contractorInvoices,
      customerPayments,
      escrowFunded,
      pendingPayment,
      pendingReview,
      refunds,
      releasedToContractor,
      remainingInEscrow,
    };
  };

  const agreementRows = useMemo(() => {
    const rows = projects.map((project) => {
      const agreement = findAgreementForProject(project);
      const relatedPayments = paymentsForProject(project);
      const relatedDocuments = documentsForProject(project);
      const paymentModel = buildPaymentModel(relatedPayments);
      const statusHaystack = `${project.status || ""} ${project.status_label || ""} ${agreement?.status || ""} ${agreement?.status_label || ""}`.toLowerCase();
      const hasAction =
        relatedPayments.some((payment) => isReviewablePayment(payment) || isActionablePayment(payment) || hasOpenDispute(payment)) ||
        statusHaystack.includes("signature") ||
        statusHaystack.includes("review") ||
        statusHaystack.includes("dispute") ||
        statusHaystack.includes("sent");
      const closedByStatus =
        statusHaystack.includes("complete") ||
        statusHaystack.includes("cancel") ||
        statusHaystack.includes("archiv") ||
        statusHaystack.includes("closed") ||
        statusHaystack.includes("expired warranty") ||
        statusHaystack.includes("fully released");
      const agreementUrl = project.agreement_url || agreement?.action_target || (agreement?.agreement_token ? `/agreements/magic/${agreement.agreement_token}` : "");
      const workType = workTypeForRow(project, agreement);
      const propertyKey = propertyKeyForRow(project);
      const value = numericValue(project.total_cost || agreement?.total_cost);
      const derivedStatus = deriveHomeownerStatus({ project, agreement, relatedPayments });
      const canonicalPaymentModel = project.payment_summary || agreement?.payment_summary || paymentModel;
      const statusLabel = project.customer_status_label || agreement?.customer_status_label || derivedStatus.label;
      const statusGroup = project.customer_status_group || agreement?.customer_status_group || derivedStatus.group;
      return {
        project,
        agreement,
        relatedPayments,
        relatedDocuments,
        paymentModel: {
          ...paymentModel,
          ...canonicalPaymentModel,
          escrowFunded: numericValue(canonicalPaymentModel.escrow_funded ?? canonicalPaymentModel.escrowFunded ?? paymentModel.escrowFunded),
          releasedToContractor: numericValue(canonicalPaymentModel.released_to_contractor ?? canonicalPaymentModel.releasedToContractor ?? paymentModel.releasedToContractor),
          remainingInEscrow: numericValue(canonicalPaymentModel.remaining_in_escrow ?? canonicalPaymentModel.remainingInEscrow ?? paymentModel.remainingInEscrow),
          pendingReview: numericValue(canonicalPaymentModel.pending_review ?? canonicalPaymentModel.pendingReview ?? paymentModel.pendingReview),
          contractorInvoices: numericValue(canonicalPaymentModel.contractor_invoices ?? canonicalPaymentModel.contractorInvoices ?? paymentModel.contractorInvoices),
          customerPayments: numericValue(canonicalPaymentModel.customer_payments ?? canonicalPaymentModel.customerPayments ?? paymentModel.customerPayments),
          refunds: numericValue(canonicalPaymentModel.refunds_adjustments ?? canonicalPaymentModel.refunds ?? paymentModel.refunds),
        },
        value,
        workType,
        propertyKey,
        statusLabel,
        statusGroup,
        isOpen: hasAction || statusGroup !== "closed",
        nextAction: buildNextAction(project, relatedPayments, agreement),
        agreementUrl,
        pdfUrl: agreement?.pdf_url || project.pdf_url || "",
        updatedAt: project.updated_at || agreement?.updated_at || project.created_at || agreement?.created_at,
        createdAt: project.created_at || agreement?.created_at,
        searchText: [
          project.title,
          project.project_number,
          project.agreement_number,
          project.address,
          project.project_type,
          project.project_subtype,
          project.contractor_name,
          agreement?.agreement_number,
          agreement?.project_title,
          agreement?.project_type,
          agreement?.project_subtype,
          agreement?.contractor_name,
        ].join(" ").toLowerCase(),
      };
    });

    const projectAgreementIds = new Set(projects.map((project) => String(project.agreement_id || "")));
    const projectTitles = new Set(projects.map((project) => String(project.title || "")));
    for (const agreement of agreements) {
      if (
        (agreement.id && projectAgreementIds.has(String(agreement.id))) ||
        (agreement.project_title && projectTitles.has(String(agreement.project_title)))
      ) {
        continue;
      }
      const project = {
        id: `agreement-${agreement.id || agreement.agreement_token}`,
        agreement_id: agreement.id,
        agreement_token: agreement.agreement_token,
        title: agreement.project_title || agreement.title || "Agreement",
        description: agreement.description,
        contractor_name: agreement.contractor_name,
        status: agreement.status,
        status_label: agreement.status_label,
        total_cost: agreement.total_cost,
        milestones: agreement.milestones || [],
        created_at: agreement.created_at,
        updated_at: agreement.updated_at,
      };
      const relatedPayments = paymentsForProject(project);
      const relatedDocuments = documentsForProject(project);
      const statusHaystack = `${project.status || ""} ${project.status_label || ""} ${agreement.status || ""} ${agreement.status_label || ""}`.toLowerCase();
      const hasAction =
        relatedPayments.some((payment) => isReviewablePayment(payment) || isActionablePayment(payment) || hasOpenDispute(payment)) ||
        statusHaystack.includes("signature") ||
        statusHaystack.includes("review") ||
        statusHaystack.includes("dispute") ||
        statusHaystack.includes("sent");
      const closedByStatus =
        statusHaystack.includes("complete") ||
        statusHaystack.includes("cancel") ||
        statusHaystack.includes("archiv") ||
        statusHaystack.includes("closed") ||
        statusHaystack.includes("expired warranty") ||
        statusHaystack.includes("fully released");
      const workType = workTypeForRow(project, agreement);
      const propertyKey = propertyKeyForRow(project);
      const value = numericValue(project.total_cost || agreement.total_cost);
      const derivedStatus = deriveHomeownerStatus({ project, agreement, relatedPayments });
      const paymentModel = buildPaymentModel(relatedPayments);
      const canonicalPaymentModel = agreement.payment_summary || paymentModel;
      const statusLabel = agreement.customer_status_label || derivedStatus.label;
      const statusGroup = agreement.customer_status_group || derivedStatus.group;
      rows.push({
        project,
        agreement,
        relatedPayments,
        relatedDocuments,
        value,
        workType,
        propertyKey,
        paymentModel: {
          ...paymentModel,
          ...canonicalPaymentModel,
          escrowFunded: numericValue(canonicalPaymentModel.escrow_funded ?? canonicalPaymentModel.escrowFunded ?? paymentModel.escrowFunded),
          releasedToContractor: numericValue(canonicalPaymentModel.released_to_contractor ?? canonicalPaymentModel.releasedToContractor ?? paymentModel.releasedToContractor),
          remainingInEscrow: numericValue(canonicalPaymentModel.remaining_in_escrow ?? canonicalPaymentModel.remainingInEscrow ?? paymentModel.remainingInEscrow),
          pendingReview: numericValue(canonicalPaymentModel.pending_review ?? canonicalPaymentModel.pendingReview ?? paymentModel.pendingReview),
          contractorInvoices: numericValue(canonicalPaymentModel.contractor_invoices ?? canonicalPaymentModel.contractorInvoices ?? paymentModel.contractorInvoices),
          customerPayments: numericValue(canonicalPaymentModel.customer_payments ?? canonicalPaymentModel.customerPayments ?? paymentModel.customerPayments),
          refunds: numericValue(canonicalPaymentModel.refunds_adjustments ?? canonicalPaymentModel.refunds ?? paymentModel.refunds),
        },
        statusLabel,
        statusGroup,
        isOpen: hasAction || statusGroup !== "closed",
        nextAction: buildNextAction(project, relatedPayments, agreement),
        agreementUrl: agreement.action_target || (agreement.agreement_token ? `/agreements/magic/${agreement.agreement_token}` : ""),
        pdfUrl: agreement.pdf_url || "",
        updatedAt: agreement.updated_at || agreement.created_at,
        createdAt: agreement.created_at,
        searchText: [
          project.title,
          project.project_number,
          project.agreement_number,
          project.address,
          project.project_type,
          project.project_subtype,
          project.contractor_name,
          agreement.agreement_number,
          agreement.project_title,
          agreement.project_type,
          agreement.project_subtype,
          agreement.contractor_name,
        ].join(" ").toLowerCase(),
      });
    }
    return rows;
  }, [agreements, documents, payments, projects, propertyProfiles]);

  const searchedRows = agreementRows.filter((row) => {
    if (projectFilter === "all") return true;
    if (projectFilter === "closed") return !row.isOpen;
    return row.isOpen;
  });
  const filteredRows = searchedRows
    .filter((row) => {
      if (workFilter !== "all" && row.workType !== workFilter) return false;
      if (propertyFilter !== "all" && String(row.propertyKey || "") !== String(propertyFilter)) return false;
      const query = searchTerm.trim().toLowerCase();
      if (!query) return true;
      return row.searchText.includes(query);
    })
    .sort((a, b) => {
      if (sortBy === "newest") return dateValue(b.createdAt) - dateValue(a.createdAt);
      if (sortBy === "oldest") return dateValue(a.createdAt) - dateValue(b.createdAt);
      if (sortBy === "value_high") return b.value - a.value;
      if (sortBy === "value_low") return a.value - b.value;
      return dateValue(b.updatedAt || b.createdAt) - dateValue(a.updatedAt || a.createdAt);
    });

  const visibleRows = filteredRows.slice(0, visibleCount);
  const rangeStart = filteredRows.length ? 1 : 0;
  const rangeEnd = Math.min(visibleCount, filteredRows.length);

  const selectedRow =
    filteredRows.find((row) => String(row.project.id) === String(selectedId)) ||
    filteredRows[0] ||
    null;
  const selected = selectedRow?.project || null;

  const selectedAgreement = useMemo(() => {
    if (!selected) return null;
    return selectedRow?.agreement || findAgreementForProject(selected);
  }, [agreements, selected, selectedRow]);

  const projectPayments = useMemo(() => {
    if (!selected) return [];
    return selectedRow?.relatedPayments || paymentsForProject(selected);
  }, [payments, selected, selectedRow]);

  const projectDocuments = useMemo(() => {
    if (!selected) return [];
    return selectedRow?.relatedDocuments || documentsForProject(selected);
  }, [documents, selected, selectedRow]);

  const projectNotifications = useMemo(() => {
    if (!selected) return [];
    const title = String(selected.title || "").toLowerCase();
    return notifications.filter((notification) => {
      const haystack = `${notification.title || ""} ${notification.message || ""} ${notification.action_url || ""}`.toLowerCase();
      return title && haystack.includes(title.toLowerCase());
    });
  }, [notifications, selected]);

  const projectUpdates = useMemo(() => {
    const rows = [];
    for (const update of selected?.updates || []) {
      rows.push({
        id: `update-${update.id}`,
        title: update.milestone_title || update.title || "Project update",
        message: update.body || update.message || "A project update is available.",
        author: update.author || "Project team",
        created_at: update.created_at,
        action_url: "",
      });
    }
    for (const notification of projectNotifications) {
      rows.push({
        ...notification,
        id: `notification-${notification.id}`,
        author: "MyHomeBro",
      });
    }
    return rows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  }, [projectNotifications, selected]);

  const reviewPayments = projectPayments.filter(isReviewablePayment);
  const projectPaymentHistory = projectPayments.filter(isPaymentHistoryRecord);
  const selectedPaymentModel = selectedRow?.paymentModel || buildPaymentModel(projectPayments);
  const selectedProjectValue = numericValue(selected?.total_cost || selectedAgreement?.total_cost);
  const selectedPaidProgress = paidProgressPercent(selectedPaymentModel.releasedToContractor, selectedProjectValue);
  const selectedSuggestedMaterials = Array.isArray(selected?.suggested_materials)
    ? selected.suggested_materials
    : Array.isArray(selected?.suggestedMaterials)
      ? selected.suggestedMaterials
      : [];
  const visibleSuggestedMaterials = materialsExpanded
    ? selectedSuggestedMaterials
    : selectedSuggestedMaterials.slice(0, 4);
  const revisedProjectValue = numericValue(actionForm.revised_project_value);
  const estimatedDescopeSurplus =
    actionForm.change_type === "descope_remove_work" && actionForm.revised_project_value
      ? Math.max((selectedPaymentModel?.escrowFunded || 0) - revisedProjectValue, 0)
      : 0;
  const completedMilestones = (selected?.milestones || []).filter((milestone) =>
    String(milestone.status || "").toLowerCase().includes("complete")
  ).length;
  const milestoneCount = (selected?.milestones || []).length;
  const homeownerActions = selected?.homeowner_actions || selectedAgreement?.homeowner_actions || {};
  const activeCases = selected?.active_cases || selectedAgreement?.active_cases || [];
  const suggestedMaterialsCard = (
    <Section title="Suggested Materials" eyebrow="Planning and supplies" testId="customer-project-suggested-materials">
      <div data-testid="customer-project-suggested-materials-notice" className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-semibold leading-5 text-amber-100">
        Materials commonly used for this type of project. Confirm size, quantity, finish, model, and compatibility with your contractor before purchasing.
      </div>
      {selectedSuggestedMaterials.length ? (
        <>
          <div className={`mt-3 grid gap-2 ${visibleSuggestedMaterials.length >= 4 ? "md:grid-cols-2" : ""}`}>
            {visibleSuggestedMaterials.map((material) => {
              const amazonLink = (material.provider_links || []).find((link) => link.provider === "amazon") || material.provider_links?.[0];
              const quantityLabel = [material.quantity, material.unit].filter(Boolean).join(" ");
              const categoryLabel = materialCategoryLabel(material);
              return (
                <div key={material.id || material.name} data-testid="customer-project-suggested-material-card" className="rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{material.name || "Project material"}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-medium text-slate-400">
                        {categoryLabel ? <span className="rounded-full bg-slate-900 px-2 py-0.5">{categoryLabel}</span> : null}
                        {material.related_milestone ? <span className="rounded-full bg-slate-900 px-2 py-0.5">{material.related_milestone}</span> : null}
                        {quantityLabel ? <span className="rounded-full bg-slate-900 px-2 py-0.5">{quantityLabel}</span> : null}
                      </div>
                    </div>
                    {amazonLink?.url ? (
                      <a
                        data-testid="customer-project-suggested-material-amazon"
                        href={amazonLink.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-amber-300/50 hover:text-white"
                      >
                        Amazon
                      </a>
                    ) : null}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-300">
                    {materialReasonText(material)}
                  </p>
                </div>
              );
            })}
          </div>
          {selectedSuggestedMaterials.length > 4 ? (
            <button
              type="button"
              data-testid="customer-project-suggested-materials-show-more"
              onClick={() => setMaterialsExpanded((value) => !value)}
              className="mt-3 rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-amber-300/50 hover:text-white"
            >
              {materialsExpanded ? "Show fewer materials" : `Show ${selectedSuggestedMaterials.length - 4} more materials`}
            </button>
          ) : null}
        </>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed border-slate-700 bg-slate-950/70 p-3 text-sm text-slate-400">
          No suggested materials available for this project yet.
        </p>
      )}
    </Section>
  );

  const runReimbursementAction = async (payment, action, providedReason = "") => {
    if (!token || !payment?.record_id) return;
    const payload = {};
    if (action === "deny") {
      const reason = String(providedReason || "").trim();
      if (!reason) return;
      payload.denial_reason = reason;
    }
    const actionKey = `${action}-${payment.record_id}`;
    setReimbursementAction(actionKey);
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${token}/reimbursements/${payment.record_id}/${action === "approve" ? "approve" : "deny"}/`,
        payload
      );
      if (data?.portal) {
        onRefresh?.(data.portal);
      } else {
        onRefresh?.();
      }
      toast.success(action === "approve" ? "Reimbursement approved" : "Reimbursement denied");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update reimbursement.");
    } finally {
      setReimbursementAction("");
    }
  };

  const openDenyReimbursementModal = (payment) => {
    setDenyReimbursementPayment(payment);
    setDenyReimbursementReason("");
    setDenyReimbursementError("");
  };

  const closeDenyReimbursementModal = () => {
    if (reimbursementAction) return;
    setDenyReimbursementPayment(null);
    setDenyReimbursementReason("");
    setDenyReimbursementError("");
  };

  const submitDenyReimbursement = async () => {
    if (!denyReimbursementPayment) return;
    if (!String(denyReimbursementReason || "").trim()) {
      setDenyReimbursementError("Add a reason before denying this reimbursement.");
      return;
    }
    await runReimbursementAction(denyReimbursementPayment, "deny", denyReimbursementReason);
    setDenyReimbursementPayment(null);
    setDenyReimbursementReason("");
    setDenyReimbursementError("");
  };

  const openHomeownerAction = (kind) => {
    setAmendmentAiBusy(false);
    setAmendmentAiError("");
    setAmendmentSuggestion(null);
    setActionForm({
      change_type: "scope_change",
      requested_change: "",
      reason: "",
      revised_project_value: "",
      affected_milestone_ids: [],
      requested_amount: "",
      desired_resolution: "",
      description: "",
      attachment_note: "",
    });
    setActionModal(kind);
  };

  const improveAmendmentRequest = async () => {
    const requestedChange = String(actionForm.requested_change || "").trim();
    if (!token || !selectedRow?.agreement?.id || !requestedChange) {
      setAmendmentAiError("Describe the change first.");
      return;
    }
    setAmendmentAiBusy(true);
    setAmendmentAiError("");
    setAmendmentSuggestion(null);
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/agreements/${encodeURIComponent(selectedRow.agreement.id)}/amendments/improve/`,
        {
          requested_change: requestedChange,
          current_change_type: actionForm.change_type,
        }
      );
      setAmendmentSuggestion({
        original_request: data?.original_request || requestedChange,
        suggested_change_type: data?.suggested_change_type || actionForm.change_type || "other",
        suggested_change_type_label: data?.suggested_change_type_label || amendmentChangeTypeLabel(data?.suggested_change_type || actionForm.change_type),
        improved_description: data?.improved_description || requestedChange,
        clarification_questions: Array.isArray(data?.clarification_questions) ? data.clarification_questions : [],
        evidence_note: data?.evidence_note || "",
      });
    } catch (error) {
      setAmendmentAiError(error?.response?.data?.detail || "Could not improve this request right now.");
    } finally {
      setAmendmentAiBusy(false);
    }
  };

  const applyAmendmentSuggestion = () => {
    if (!amendmentSuggestion) return;
    setActionForm((current) => ({
      ...current,
      change_type: amendmentSuggestion.suggested_change_type || current.change_type,
      requested_change: amendmentSuggestion.improved_description || current.requested_change,
      attachment_note: amendmentSuggestion.evidence_note || current.attachment_note,
    }));
  };

  const submitHomeownerAction = async () => {
    if (!token || !selectedRow?.agreement?.id || !actionModal) return;
    setActionSubmitting(true);
    try {
      const agreementId = selectedRow.agreement.id;
      let endpoint = "";
      let payload = {};
      if (actionModal === "amendment") {
        endpoint = `/projects/customer-portal/${encodeURIComponent(token)}/agreements/${encodeURIComponent(agreementId)}/amendments/`;
        payload = {
          change_type: actionForm.change_type,
          requested_change: actionForm.requested_change,
          reason: actionForm.reason,
          attachment_note: actionForm.attachment_note,
          ...(actionForm.change_type === "descope_remove_work" && actionForm.revised_project_value
            ? { revised_project_value: actionForm.revised_project_value }
            : {}),
          ...(actionForm.change_type === "descope_remove_work"
            ? { affected_milestone_ids: actionForm.affected_milestone_ids }
            : {}),
        };
      } else if (actionModal === "refund") {
        endpoint = `/projects/customer-portal/${encodeURIComponent(token)}/agreements/${encodeURIComponent(agreementId)}/refunds/`;
        payload = {
          reason: actionForm.reason,
          evidence_note: actionForm.attachment_note,
          ...(actionForm.requested_amount ? { requested_amount: actionForm.requested_amount } : {}),
        };
      } else if (actionModal === "dispute") {
        endpoint = `/projects/customer-portal/${encodeURIComponent(token)}/agreements/${encodeURIComponent(agreementId)}/disputes/`;
        payload = {
          reason: actionForm.reason,
          description: actionForm.description,
          desired_resolution: actionForm.desired_resolution,
          evidence_note: actionForm.attachment_note,
        };
      }
      const { data } = await api.post(endpoint, payload);
      if (data?.portal) onRefresh?.(data.portal);
      toast.success(
        actionModal === "amendment"
          ? "Amendment request submitted"
          : actionModal === "refund"
            ? "Refund request submitted"
            : "Dispute opened"
      );
      setActionModal("");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not submit that request.");
    } finally {
      setActionSubmitting(false);
    }
  };

  const openProject = (project) => {
    setSelectedId(project.id);
  };

  const resetListWindow = () => setVisibleCount(10);

  if (!projects.length && !agreements.length) {
    return (
      <div data-testid="customer-project-workspace-empty" className="rounded-2xl border border-dashed border-slate-600 bg-slate-900/60 p-6 text-sm text-slate-300">
        <div className="font-semibold text-white">No projects connected yet</div>
        <p className="mt-1 leading-6 text-slate-400">
          Active projects will appear here after an agreement, accepted bid, or contractor project record is connected to your secure customer email.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="customer-project-workspace" className="space-y-5">
      <section className="rounded-3xl border border-slate-700 bg-slate-950/70 p-5 shadow-2xl shadow-slate-950/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200/80">Projects</div>
            <h2 className="mt-1 text-2xl font-bold text-white">Agreements & Projects</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              Review open agreements, completed project records, payment status, documents, warranties, and the next action for each project.
            </p>
          </div>
          <div data-testid="customer-project-filters" className="flex rounded-2xl border border-slate-700 bg-slate-900/80 p-1">
            {[
              ["open", "Open", "No open projects right now."],
              ["closed", "Closed", "No completed projects yet."],
              ["all", "All", "No projects connected yet."],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                data-testid={`customer-project-filter-${key}`}
                onClick={() => {
                  setProjectFilter(key);
                  resetListWindow();
                }}
                className={`min-h-10 rounded-xl px-4 text-sm font-semibold transition ${
                  projectFilter === key
                    ? "bg-amber-300 text-slate-950"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(240px,1.3fr)_repeat(3,minmax(160px,0.7fr))]">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Search projects</span>
            <input
              data-testid="customer-project-search"
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value);
                resetListWindow();
              }}
              placeholder="Search title, contractor, agreement, address, type..."
              className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-amber-300 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Work type</span>
            <select
              data-testid="customer-project-work-filter"
              value={workFilter}
              onChange={(event) => {
                setWorkFilter(event.target.value);
                resetListWindow();
              }}
              className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-amber-300 focus:outline-none"
            >
              <option value="all">All work types</option>
              <option value="full_service">Full Service</option>
              <option value="diy_assistance">DIY Assistance</option>
              <option value="maintenance">Maintenance</option>
              <option value="repair">Repair</option>
              <option value="inspection">Inspection</option>
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Property</span>
            <select
              data-testid="customer-project-property-filter"
              value={propertyFilter}
              onChange={(event) => {
                setPropertyFilter(event.target.value);
                resetListWindow();
              }}
              className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-amber-300 focus:outline-none"
            >
              <option value="all">All properties</option>
              {propertyProfiles.map((property) => (
                <option key={property.id || property.address || property.display_name} value={String(property.id || "")}>
                  {property.display_name || property.address || property.address_line1 || "Property"}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Sort by</span>
            <select
              data-testid="customer-project-sort"
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value);
                resetListWindow();
              }}
              className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-amber-300 focus:outline-none"
            >
              <option value="recently_updated">Recently updated</option>
              <option value="newest">Newest created</option>
              <option value="oldest">Oldest</option>
              <option value="value_high">Project value high to low</option>
              <option value="value_low">Project value low to high</option>
            </select>
          </label>
        </div>
      </section>

      <div data-testid="customer-projects-layout" className="grid gap-4 xl:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.7fr)]">
        <section data-testid="customer-agreement-list" className="space-y-3">
          <div data-testid="customer-project-result-count" className="rounded-2xl border border-slate-700 bg-slate-950/55 px-4 py-3 text-sm text-slate-300">
            Showing {rangeStart}-{rangeEnd} of {filteredRows.length} projects
          </div>
          {visibleRows.length ? (
            visibleRows.map((row) => {
              const project = row.project;
              const selectedCard = String(selected?.id) === String(project.id);
              return (
                <button
                  key={project.id}
                  type="button"
                  data-testid={`customer-project-card-${project.id}`}
                  onClick={() => openProject(project)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    selectedCard
                      ? "border-amber-300/70 bg-amber-300/10 shadow-[inset_4px_0_0_rgba(251,191,36,0.72)]"
                      : "border-slate-700 bg-slate-950/55 hover:border-slate-500 hover:bg-slate-900"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-base font-semibold text-white">{project.title || "Project"}</div>
                      <div className="mt-1 text-sm text-slate-400">{project.contractor_name || row.agreement?.contractor_name || "Contractor pending"}</div>
                    </div>
                    <Badge data-testid={`customer-project-status-${project.id}`} tone={statusTone(row.statusLabel)}>{row.statusLabel}</Badge>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Project value</div>
                      <div className="mt-1 font-semibold text-slate-100">{project.total_cost || row.agreement?.total_cost ? money(project.total_cost || row.agreement?.total_cost) : "Pending"}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Remaining in escrow</div>
                      <div className="mt-1 font-semibold text-slate-100">{money(row.paymentModel?.remainingInEscrow)}</div>
                      {row.paymentModel?.escrowFunded > 0 ? (
                        <div className="mt-1 text-xs text-slate-400">
                          {money(row.paymentModel.escrowFunded)} funded - {money(row.paymentModel?.releasedToContractor)} released
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Next action</div>
                      <div className="mt-1 font-semibold text-amber-100">{row.nextAction}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Last updated</div>
                      <div className="mt-1 font-semibold text-slate-100">{row.updatedAt ? formatDate(row.updatedAt) : "No date"}</div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge>{(project.milestones || []).length || 0} milestones</Badge>
                    <Badge>{row.relatedDocuments.length} documents</Badge>
                    {row.relatedPayments.some(hasOpenDispute) ? <Badge tone="rose">Issue open</Badge> : null}
                  </div>
                </button>
              );
            })
          ) : (
            <div data-testid={`customer-project-${projectFilter}-empty`} className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 p-6 text-sm leading-6 text-slate-300">
              {searchTerm || workFilter !== "all" || propertyFilter !== "all"
                ? "No projects match those filters."
                : projectFilter === "closed"
                  ? "No completed projects yet."
                  : projectFilter === "all"
                    ? "No projects connected yet."
                    : "No open projects right now."}
            </div>
          )}
          {filteredRows.length > visibleRows.length ? (
            <button
              type="button"
              data-testid="customer-project-load-more"
              onClick={() => setVisibleCount((current) => current + 10)}
              className="w-full rounded-2xl border border-amber-200/40 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100 hover:bg-amber-300/20"
            >
              Load more projects
            </button>
          ) : null}
        </section>

      <div data-testid="customer-rich-project-workspace" className="space-y-4">
        {selected ? (
          <>
            <section data-testid="customer-selected-agreement-summary" className="overflow-hidden rounded-3xl border border-slate-700 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.16),transparent_30%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(12,74,110,0.42))] p-5 shadow-2xl shadow-slate-950/30 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">Selected agreement</div>
                  <h2 className="mt-2 text-2xl font-bold tracking-tight text-white">{selected.title}</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200">
                    {selected.description || selectedAgreement?.description || "Compact project summary with payments, documents, warranty, and activity available below."}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge data-testid="customer-selected-agreement-status" tone={statusTone(selectedRow?.statusLabel)}>{selectedRow?.statusLabel || "Active"}</Badge>
                    <Badge tone="gold">{selectedRow?.nextAction || "View details"}</Badge>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedRow?.agreementUrl ? (
                    <a
                      data-testid="customer-agreement-view-action"
                      href={selectedRow.agreementUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-200/45 bg-amber-300/15 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/25"
                    >
                      View Agreement
                      <ExternalLink size={14} />
                    </a>
                  ) : null}
                  {selectedRow?.pdfUrl ? (
                    <a
                      data-testid="customer-agreement-pdf-action"
                      href={selectedRow.pdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sky-300/40 bg-sky-400/10 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/20"
                    >
                      View Agreement PDF
                      <ExternalLink size={14} />
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Contractor</div>
                  <div className="mt-1 text-sm font-semibold text-white">{selected.contractor_name || "Your contractor"}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Project Value</div>
                  <div data-testid="customer-payment-summary-project-value" className="mt-1 text-sm font-semibold text-white">
                    {selectedProjectValue ? money(selectedProjectValue) : "Pending"}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Remaining in Escrow</div>
                  <div data-testid="customer-payment-summary-remaining-escrow-primary" className="mt-1 text-2xl font-black text-white">
                    {money(selectedPaymentModel.remainingInEscrow)}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Next Action</div>
                  <div className="mt-1 text-sm font-semibold text-white">{selectedRow?.nextAction || "View details"}</div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Milestone Progress</div>
                  <div className="mt-1 text-sm font-semibold text-white">
                    {milestoneCount ? `${completedMilestones} of ${milestoneCount} complete` : "Milestones pending"}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Payment Summary</div>
                  <div data-testid="customer-payment-summary-remaining-escrow" className="mt-1 text-sm font-semibold text-white">
                    {money(selectedPaymentModel.remainingInEscrow)} remaining in escrow
                  </div>
                  <div data-testid="customer-payment-summary-escrow-funded" className="mt-1 text-xs text-slate-300">
                    {money(selectedPaymentModel.escrowFunded)} escrow funded
                  </div>
                  <div data-testid="customer-payment-summary-released" className="mt-1 text-xs text-slate-300">
                    {money(selectedPaymentModel.releasedToContractor)} released to contractor
                  </div>
                  <div data-testid="customer-payment-summary-pending-review" className="mt-1 text-xs text-slate-300">
                    {money(selectedPaymentModel.pendingReview)} pending review
                  </div>
                  <div data-testid="customer-payment-summary-paid-progress" className="mt-1 text-xs text-slate-300">
                    {selectedPaidProgress}% released
                  </div>
                  <div data-testid="customer-payment-summary-customer-payments" className="mt-1 text-xs text-slate-300">
                    {money(selectedPaymentModel.customerPayments)} direct payments
                  </div>
                  {selectedPaymentModel.refunds > 0 ? (
                    <div data-testid="customer-payment-summary-refunds" className="mt-1 text-xs text-slate-300">
                      {money(selectedPaymentModel.refunds)} refunds or adjustments
                    </div>
                  ) : null}
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Documents</div>
                  <div className="mt-1 text-sm font-semibold text-white">{projectDocuments.length} files</div>
                  {projectDocuments[0]?.title ? <div className="mt-1 truncate text-xs text-slate-400">Latest: {projectDocuments[0].title}</div> : null}
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Warranty</div>
                  <div className="mt-1 line-clamp-2 text-sm font-semibold text-white">
                    {selectedAgreement?.warranty_text || "Warranty details pending"}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setExpandedDetails((current) => ({ ...current, payments: true }))}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-amber-300/50"
                >
                  View Payments
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedDetails((current) => ({ ...current, documents: true }))}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-amber-300/50"
                >
                  View Documents
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedDetails((current) => ({ ...current, activity: true }))}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-amber-300/50"
                >
                  View Activity
                </button>
              </div>
            </section>

            <div data-testid="customer-selected-action-panels" className="space-y-4">
              <Section title="Need to Change Something?" eyebrow="Homeowner action center" testId="customer-homeowner-action-center">
                <p className="text-sm leading-6 text-slate-300">
                  Request a change, ask for escrow review, or open an issue without directly changing the agreement or moving funds.
                </p>
                {activeCases.length ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {activeCases.map((caseRow) => (
                      <div key={`${caseRow.type}-${caseRow.id}`} data-testid={`customer-active-case-${caseRow.type}`} className="rounded-2xl border border-amber-200/35 bg-amber-300/10 p-4">
                        <div className="text-sm font-semibold text-white">{caseRow.label}</div>
                        <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-amber-100">{caseRow.status_label || "Open"}</div>
                        {caseRow.response_label ? (
                          <div className="mt-2 text-xs font-semibold text-amber-50">Response: {caseRow.response_label}</div>
                        ) : null}
                        {caseRow.response_note ? <p className="mt-2 text-sm leading-5 text-slate-300">{caseRow.response_note}</p> : null}
                        {caseRow.counter_proposal && Object.keys(caseRow.counter_proposal || {}).length ? (
                          <div data-testid={`customer-counter-proposal-summary-${caseRow.id}`} className="mt-3 rounded-xl bg-slate-950/65 p-3 text-xs text-slate-300">
                            <div className="font-semibold text-white">Counter proposal</div>
                            {caseRow.counter_proposal.revised_scope ? <div className="mt-1">Scope: {caseRow.counter_proposal.revised_scope}</div> : null}
                            {caseRow.counter_proposal.revised_value_change ? <div className="mt-1">Value: {caseRow.counter_proposal.revised_value_change}</div> : null}
                            {caseRow.counter_proposal.revised_timeline ? <div className="mt-1">Timeline: {caseRow.counter_proposal.revised_timeline}</div> : null}
                            {caseRow.counter_proposal.revised_milestone_changes ? <div className="mt-1">Milestones: {caseRow.counter_proposal.revised_milestone_changes}</div> : null}
                          </div>
                        ) : null}
                        <AttachmentLinks attachments={caseRow.counter_attachments || []} testId={`customer-counter-attachments-${caseRow.id}`} />
                        {caseRow.summary ? <p className="mt-2 line-clamp-3 text-sm leading-5 text-slate-300">{caseRow.summary}</p> : null}
                        {caseRow.estimated_refundable_escrow_surplus && Number(caseRow.estimated_refundable_escrow_surplus) > 0 ? (
                          <div className="mt-3 rounded-xl bg-slate-950/65 p-3 text-xs text-slate-200">
                            Estimated surplus: <span className="font-semibold text-white">{money(numericValue(caseRow.estimated_refundable_escrow_surplus))}</span>
                            <div className="mt-1 text-slate-400">{caseRow.refund_eligibility_label}</div>
                          </div>
                        ) : null}
                        {caseRow.activity_events?.length ? (
                          <div className="mt-3 space-y-1 border-t border-amber-100/15 pt-3 text-xs text-slate-300">
                            {caseRow.activity_events.slice(0, 3).map((event) => (
                              <div key={event.id}>
                                <div>{event.title || event.event_label}</div>
                                {event.metadata?.attachment_count ? (
                                  <div className="text-slate-400">
                                    {event.metadata.attachment_count} attachment{event.metadata.attachment_count === 1 ? "" : "s"} included
                                  </div>
                                ) : null}
                                <AttachmentLinks
                                  attachments={event.metadata?.attachments || []}
                                  testId={`customer-counter-activity-attachments-${caseRow.id}-${event.id}`}
                                />
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {caseRow.url ? (
                          <a
                            href={caseRow.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-amber-200/45 bg-amber-300/15 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/25"
                          >
                            View Dispute
                            <ExternalLink size={14} />
                          </a>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {[
                    ["amendment", "Request Amendment", "Ask the contractor to review a scope, timeline, price, milestone, material, or warranty change."],
                    ["dispute", "Open Dispute", "Open an issue for review when something about the agreement, milestone, or payment needs formal attention."],
                  ].map(([key, label, description]) => {
                    const action = homeownerActions[key] || {};
                    const disabled = !action.available;
                    return (
                      <button
                        key={key}
                        type="button"
                        data-testid={`customer-action-${key}`}
                        onClick={() => !disabled && openHomeownerAction(key)}
                        disabled={disabled}
                        className={`rounded-2xl border p-4 text-left transition ${
                          disabled
                            ? "border-slate-700 bg-slate-900/55 text-slate-500"
                            : "border-amber-200/40 bg-amber-300/10 text-slate-100 hover:bg-amber-300/20"
                        }`}
                      >
                        <div className="text-sm font-semibold text-white">{action.label || label}</div>
                        <p className="mt-2 text-sm leading-5 text-slate-300">{description}</p>
                        {disabled && !action.active ? <div className="mt-3 text-xs text-slate-500">Not available for the current agreement status.</div> : null}
                      </button>
                    );
                  })}
                </div>
              </Section>

              {reviewPayments.length ? (
                <Section title="Needs Attention" eyebrow="Review before funds move" testId="customer-project-needs-attention">
                  <div className="space-y-3">
                    {reviewPayments.map((payment) => (
                      <ProjectReviewCard key={payment.id} payment={payment} token={token} onPortalUpdate={onRefresh} />
                    ))}
                  </div>
                </Section>
              ) : (
                <Section title="Next Action" eyebrow="Nothing waiting right now" testId="customer-project-next-action">
                  <div className="rounded-2xl border border-emerald-300/35 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-100">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 shrink-0" size={18} />
                      <p>No milestone reviews or payment releases need your attention right now. New actions will appear here when your contractor submits work for review.</p>
                    </div>
                  </div>
                </Section>
              )}

              <ReviewPromptCard project={selected} token={token} onPortalUpdate={onRefresh} />
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-6 text-sm text-slate-300">
            Select a project to view details.
          </div>
        )}
      </div>
      </div>

        {selected ? (
            <div
              data-testid="customer-project-detail-layout"
              className="space-y-4"
            >
              <div data-testid="customer-project-detail-primary" className="space-y-4">
                <button
                  type="button"
                  data-testid="customer-project-toggle-details"
                  onClick={() => setExpandedDetails((current) => ({
                    needs: true,
                    payments: !current.payments,
                    documents: !current.documents,
                    activity: !current.activity,
                  }))}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-amber-300/50"
                >
                  Show project details
                </button>

                {expandedDetails.activity || expandedDetails.payments || expandedDetails.documents ? (
                  <div data-testid="customer-project-expanded-detail-grid" className="grid gap-4 lg:grid-cols-2">
                    {expandedDetails.activity ? (
                      <Section title="Project Updates" eyebrow="Recent activity" testId="customer-project-updates">
                        {projectUpdates.length ? (
                          <div className="space-y-3">
                            {projectUpdates.slice(0, 5).map((notification) => (
                              <a
                                key={notification.id}
                                href={notification.action_url || "#"}
                                className="flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-3 hover:border-amber-300/45"
                              >
                                <MessageSquare size={16} className="mt-1 shrink-0 text-amber-200" />
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-white">{notification.title || "Project update"}</div>
                                  <p className="mt-1 text-sm leading-5 text-slate-300">{notification.message || "A project update is available."}</p>
                                  <div className="mt-1 text-xs text-slate-500">
                                    {notification.author ? `${notification.author} - ` : ""}
                                    {notification.created_at ? new Date(notification.created_at).toLocaleString() : "No date"}
                                  </div>
                                </div>
                              </a>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm leading-6 text-slate-300">
                            <p>Project updates will appear here as work is submitted, payments are reviewed, documents are added, or action is needed.</p>
                            <a
                              href={`mailto:?subject=${encodeURIComponent(`Question about ${selected.title || "my project"}`)}`}
                              className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-200/45 bg-amber-300/15 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/25"
                            >
                              Ask a question
                            </a>
                          </div>
                        )}
                      </Section>
                    ) : null}

                    {expandedDetails.activity ? suggestedMaterialsCard : null}

                    {expandedDetails.payments ? (
                      <Section title="Invoice & Payment History" eyebrow="Contractor releases and payments" testId="customer-project-payments">
                        <p className="text-sm leading-6 text-slate-300">Review contractor releases, direct payments, refunds, and adjustments separately from escrow funding activity.</p>
                        <div className="mt-3 space-y-2">
                          {projectPaymentHistory.length ? (
                            projectPaymentHistory.slice(0, 5).map((payment) => {
                              const invoiceUrl = isInvoicePayment(payment) ? normalizeInvoiceMagicUrl(payment.action_target) : payment.action_target;
                              const primaryUrl = payment.receipt_url || invoiceUrl || "#";
                              const paid = isPaidPayment(payment);
                              const actionable = isActionablePayment(payment);
                              return (
                              <div key={payment.id} data-testid={`customer-project-payment-${payment.id}`} className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="text-sm font-semibold text-white">
                                      {paymentHistoryLabel(payment)} {payment.invoice_number || payment.reference ? `- ${payment.invoice_number || payment.reference}` : ""}
                                    </div>
                                    {paymentHistoryDescription(payment) ? (
                                      <p className="mt-1 text-xs font-medium text-slate-300">{paymentHistoryDescription(payment)}</p>
                                    ) : null}
                                    <div className="mt-1 text-xs text-slate-500">{formatDate(payment.date)}</div>
                                    <div className="mt-2 grid gap-1 text-xs text-slate-400">
                                      <span>{payment.contractor_name ? `Contractor: ${payment.contractor_name}` : `Contractor: ${selected.contractor_name || "Your contractor"}`}</span>
                                      <span>{payment.payment_mode_label ? `Method: ${payment.payment_mode_label}` : "Method: Secure payment"}</span>
                                      {payment.due_date ? <span>Due: {formatDate(payment.due_date)}</span> : null}
                                      {customerDisputeStatus(payment) ? <span className="text-rose-100">Issue: {customerDisputeStatus(payment).label}</span> : null}
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-sm font-bold text-white">{payment.amount_label || money(payment.amount)}</div>
                                    <Badge tone={statusTone(payment.status_label)}>{payment.status_label || "Pending"}</Badge>
                                  </div>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {primaryUrl && primaryUrl !== "#" ? (
                                    <a
                                      data-testid={`customer-project-payment-primary-${payment.id}`}
                                      href={primaryUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-200/45 bg-amber-300/15 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/25"
                                    >
                                      {isInvoicePayment(payment) ? (paid ? "View Receipt" : actionable ? "Pay Invoice" : "View Record") : isReviewablePayment(payment) ? "Review Release" : "View Record"}
                                      <ExternalLink size={14} />
                                    </a>
                                  ) : null}
                                  {isInvoicePayment(payment) && invoiceUrl ? (
                                    <a
                                      data-testid={`customer-project-payment-view-invoice-${payment.id}`}
                                      href={invoiceUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sky-300/35 bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/20"
                                    >
                                      View Invoice
                                      <ExternalLink size={14} />
                                    </a>
                                  ) : null}
                                  {isInvoicePayment(payment) && invoiceUrl && actionable ? (
                                    <a
                                      data-testid={`customer-project-payment-dispute-${payment.id}`}
                                      href={`${invoiceUrl}?action=dispute`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300/40 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/20"
                                    >
                                      Open Dispute
                                      <ExternalLink size={14} />
                                    </a>
                                  ) : null}
                                  {hasOpenDispute(payment) && payment.dispute_url ? (
                                    <a
                                      data-testid={`customer-project-payment-track-dispute-${payment.id}`}
                                      href={payment.dispute_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300/40 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/20"
                                    >
                                      Track Issue Status
                                      <ExternalLink size={14} />
                                    </a>
                                  ) : null}
                                  {canReviewReimbursement(payment) ? (
                                    <>
                                      <button
                                        type="button"
                                        data-testid={`customer-project-payment-approve-reimbursement-${payment.record_id}`}
                                        onClick={() => runReimbursementAction(payment, "approve")}
                                        disabled={Boolean(reimbursementAction)}
                                        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-emerald-300/40 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-60"
                                      >
                                        {reimbursementAction === `approve-${payment.record_id}` ? "Approving..." : "Approve Reimbursement"}
                                      </button>
                                      <button
                                        type="button"
                                        data-testid={`customer-project-payment-deny-reimbursement-${payment.record_id}`}
                                        onClick={() => openDenyReimbursementModal(payment)}
                                        disabled={Boolean(reimbursementAction)}
                                        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-300/40 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/20 disabled:opacity-60"
                                      >
                                        {reimbursementAction === `deny-${payment.record_id}` ? "Denying..." : "Deny"}
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                              </div>
                            );
                            })
                          ) : (
                            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-400">
                              Contractor releases, direct payments, refunds, and adjustments will appear here when connected.
                            </div>
                          )}
                        </div>
                      </Section>
                    ) : null}

                    {expandedDetails.documents ? (
                      <Section title="Documents" eyebrow="Project files" testId="customer-project-documents">
                        <p className="text-sm leading-6 text-slate-300">Keep your project documents and home records in one place.</p>
                        <div className="mt-3 space-y-2">
                          {projectDocuments.length ? (
                            projectDocuments.slice(0, 5).map((document) => (
                              <a key={document.id} href={document.url || "#"} target="_blank" rel="noreferrer" className="flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-3 hover:border-sky-300/40">
                                <FileText size={16} className="mt-1 shrink-0 text-sky-200" />
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-white">{document.title}</div>
                                  <div className="mt-1 truncate text-xs text-slate-500">{document.type_label || "Document"} - {document.filename || "File"}</div>
                                </div>
                              </a>
                            ))
                          ) : (
                            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-400">
                              Agreement PDFs, receipts, shared attachments, and property records will appear here.
                            </div>
                          )}
                        </div>
                      </Section>
                    ) : null}

                    {expandedDetails.documents ? (
                      <Section title="Agreement Summary" eyebrow="Scope and warranty" testId="customer-project-agreement-summary">
                        <div className="space-y-3 text-sm leading-6 text-slate-300">
                          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                            <div className="text-xs uppercase tracking-wide text-slate-500">Status</div>
                            <div className="mt-1 font-semibold text-white">{selectedRow?.statusLabel || "Project"}</div>
                          </div>
                          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                            <div className="text-xs uppercase tracking-wide text-slate-500">Payment Mode</div>
                            <div className="mt-1 font-semibold text-white">{selectedAgreement?.payment_mode || "Not set"}</div>
                          </div>
                          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                            <div className="text-xs uppercase tracking-wide text-slate-500">Warranty</div>
                            <div className="mt-1 whitespace-pre-wrap text-slate-300">
                              {selectedAgreement?.warranty_text || "Warranty details will appear here when added to your project."}
                            </div>
                          </div>
                        </div>
                      </Section>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
        ) : null}
      {denyReimbursementPayment ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="Deny reimbursement">
          <div className="w-full max-w-lg rounded-3xl border border-rose-300/35 bg-slate-950 p-5 shadow-2xl">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-rose-200">Reimbursement Review</div>
            <h3 className="mt-1 text-2xl font-extrabold text-white">Deny reimbursement?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Add a reason so the contractor understands what needs to change. This does not release escrow funds.
            </p>
            <label className="mt-4 block text-sm font-semibold text-slate-200">
              Reason
              <textarea
                data-testid={`customer-project-payment-deny-reason-${denyReimbursementPayment.record_id}`}
                value={denyReimbursementReason}
                onChange={(event) => {
                  setDenyReimbursementReason(event.target.value);
                  setDenyReimbursementError("");
                }}
                rows={4}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-rose-300"
                placeholder="Explain why this reimbursement should not be approved yet."
              />
            </label>
            {denyReimbursementError ? <div className="mt-3 text-sm font-semibold text-rose-100">{denyReimbursementError}</div> : null}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeDenyReimbursementModal}
                disabled={Boolean(reimbursementAction)}
                className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
              >
                Keep Review Open
              </button>
              <button
                type="button"
                data-testid={`customer-project-payment-confirm-deny-${denyReimbursementPayment.record_id}`}
                onClick={submitDenyReimbursement}
                disabled={Boolean(reimbursementAction)}
                className="rounded-xl bg-rose-300 px-4 py-2 text-sm font-extrabold text-slate-950 hover:bg-rose-200 disabled:opacity-60"
              >
                {reimbursementAction === `deny-${denyReimbursementPayment.record_id}` ? "Denying..." : "Deny Reimbursement"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {actionModal ? (
        <div data-testid="customer-action-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-700 bg-slate-950 p-5 shadow-2xl shadow-black/40">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Homeowner request</div>
                <h3 className="mt-2 text-xl font-bold text-white">
                  {actionModal === "amendment" ? "Request Amendment" : actionModal === "refund" ? "Request Refund" : "Open Dispute"}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {actionModal === "refund"
                    ? "This creates a review request only. Funds are not released or refunded automatically."
                    : actionModal === "dispute"
                      ? "This opens a formal issue for review and keeps the agreement context attached."
                      : "This asks the contractor to review a change. It does not modify the signed agreement."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActionModal("")}
                className="rounded-xl border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-slate-500"
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {actionModal === "amendment" ? (
                <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 p-4">
                  <label className="block text-sm font-semibold text-amber-50">
                    Describe the change you want to request
                    <textarea
                      data-testid="customer-action-requested-change"
                      value={actionForm.requested_change}
                      onChange={(event) => {
                        setActionForm((current) => ({ ...current, requested_change: event.target.value }));
                        setAmendmentAiError("");
                      }}
                      rows={6}
                      className="mt-2 w-full rounded-xl border border-amber-200/40 bg-slate-950 px-3 py-2 text-white outline-none placeholder:text-slate-500 focus:border-amber-200"
                      placeholder={`I want to remove the closet expansion from the project.
Can we change the tile material to porcelain?
I need to delay the start date by two weeks.
The price should be adjusted because we removed part of the work.`}
                    />
                  </label>
                  <p className="mt-3 text-sm leading-6 text-amber-50/85">
                    Describe the change in your own words. MyHomeBro can help clean it up, categorize it, and prepare it for
                    contractor review. This asks the contractor to review a proposed change and does not modify the signed
                    agreement automatically.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      data-testid="customer-action-ai-improve"
                      onClick={improveAmendmentRequest}
                      disabled={amendmentAiBusy || !String(actionForm.requested_change || "").trim()}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-300 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-200 disabled:opacity-60"
                    >
                      {amendmentAiBusy ? "Improving..." : "Improve & Categorize with AI"}
                    </button>
                    {amendmentAiError ? (
                      <span data-testid="customer-action-ai-error" className="text-sm font-semibold text-rose-200">
                        {amendmentAiError}
                      </span>
                    ) : null}
                  </div>
                  {amendmentSuggestion ? (
                    <div
                      data-testid="customer-action-ai-suggestion"
                      className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/75 p-4 text-sm text-slate-200"
                    >
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-200/80">
                        Review AI suggestion before submitting
                      </div>
                      <div className="mt-3 grid gap-3">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Original request</div>
                          <p className="mt-1 leading-6 text-slate-300">{amendmentSuggestion.original_request}</p>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suggested category</div>
                          <p className="mt-1 font-semibold text-amber-100">{amendmentSuggestion.suggested_change_type_label}</p>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Improved description</div>
                          <p className="mt-1 leading-6 text-white">{amendmentSuggestion.improved_description}</p>
                        </div>
                        {amendmentSuggestion.clarification_questions?.length ? (
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Questions to consider</div>
                            <ul className="mt-1 list-disc space-y-1 pl-5 leading-6 text-slate-300">
                              {amendmentSuggestion.clarification_questions.map((question) => (
                                <li key={question}>{question}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {amendmentSuggestion.evidence_note ? (
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence or document suggestion</div>
                            <p className="mt-1 leading-6 text-slate-300">{amendmentSuggestion.evidence_note}</p>
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          data-testid="customer-action-apply-ai-suggestion"
                          onClick={applyAmendmentSuggestion}
                          className="rounded-xl bg-amber-300 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-amber-200"
                        >
                          Apply AI suggestion
                        </button>
                        <button
                          type="button"
                          onClick={() => setAmendmentSuggestion(null)}
                          className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500"
                        >
                          Edit manually
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <label className="mt-4 block text-sm font-semibold text-slate-200">
                    Change type, optional
                    <select
                      data-testid="customer-action-change-type"
                      value={actionForm.change_type}
                      onChange={(event) => setActionForm((current) => ({ ...current, change_type: event.target.value }))}
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none focus:border-amber-300"
                    >
                      {AMENDMENT_CHANGE_TYPES.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <span className="mt-2 block text-xs font-normal leading-5 text-slate-400">
                      You can choose or change the category yourself. Contractor approval or a formal change order may still be required.
                    </span>
                  </label>
                </div>
              ) : null}

              {actionModal === "refund" ? (
                <label className="block text-sm font-semibold text-slate-200">
                  Requested amount, optional
                  <input
                    data-testid="customer-action-requested-amount"
                    value={actionForm.requested_amount}
                    onChange={(event) => setActionForm((current) => ({ ...current, requested_amount: event.target.value }))}
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none focus:border-amber-300"
                    placeholder="Leave blank if you want the reviewer to determine the amount"
                  />
                </label>
              ) : null}

              {actionModal === "amendment" && actionForm.change_type === "descope_remove_work" ? (
                <div
                  data-testid="customer-action-descope-summary"
                  className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-50"
                >
                  <div className="font-semibold text-amber-100">De-scope / Remove Work</div>
                  <p className="mt-1 leading-6 text-amber-50/90">
                    Use this when remaining work, milestones, or milestone amounts may be removed. Any escrow surplus is only
                    marked refundable after both parties approve and sign the amendment or addendum.
                  </p>
                  <label className="mt-4 block font-semibold text-amber-50">
                    Revised project value
                    <input
                      data-testid="customer-action-revised-project-value"
                      value={actionForm.revised_project_value}
                      onChange={(event) => setActionForm((current) => ({ ...current, revised_project_value: event.target.value }))}
                      className="mt-2 w-full rounded-xl border border-amber-200/40 bg-slate-950 px-3 py-2 text-white outline-none focus:border-amber-200"
                      placeholder="Enter the expected revised agreement value"
                      inputMode="decimal"
                    />
                  </label>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-slate-950/70 p-3">
                      <div className="text-xs uppercase tracking-[0.16em] text-amber-200/80">Original project value</div>
                      <div className="mt-1 text-lg font-bold text-white">{money(selectedProjectValue)}</div>
                    </div>
                    <div className="rounded-xl bg-slate-950/70 p-3">
                      <div className="text-xs uppercase tracking-[0.16em] text-amber-200/80">Revised project value</div>
                      <div className="mt-1 text-lg font-bold text-white">
                        {actionForm.revised_project_value ? money(revisedProjectValue) : "Enter value"}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-950/70 p-3">
                      <div className="text-xs uppercase tracking-[0.16em] text-amber-200/80">Escrow currently funded</div>
                      <div className="mt-1 text-lg font-bold text-white">{money(selectedPaymentModel?.escrowFunded || 0)}</div>
                    </div>
                    <div className="rounded-xl bg-slate-950/70 p-3">
                      <div className="text-xs uppercase tracking-[0.16em] text-amber-200/80">Estimated refundable escrow surplus</div>
                      <div className="mt-1 text-lg font-bold text-white">
                        {actionForm.revised_project_value ? money(estimatedDescopeSurplus) : "Enter revised value"}
                      </div>
                    </div>
                  </div>
                  {milestoneCount ? (
                    <div className="mt-4 rounded-xl border border-amber-200/20 bg-slate-950/60 p-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-200/80">
                        Affected milestones
                      </div>
                      <div className="mt-3 space-y-2">
                        {(selected?.milestones || []).map((milestone) => {
                          const id = Number(milestone.id);
                          const checked = actionForm.affected_milestone_ids.includes(id);
                          return (
                            <label key={milestone.id} className="flex items-center gap-3 rounded-lg bg-slate-900/80 p-2 text-sm text-slate-100">
                              <input
                                type="checkbox"
                                data-testid={`customer-action-affected-milestone-${milestone.id}`}
                                checked={checked}
                                onChange={(event) =>
                                  setActionForm((current) => {
                                    const currentIds = new Set(current.affected_milestone_ids || []);
                                    if (event.target.checked) currentIds.add(id);
                                    else currentIds.delete(id);
                                    return { ...current, affected_milestone_ids: Array.from(currentIds) };
                                  })
                                }
                                className="h-4 w-4 rounded border-slate-500 bg-slate-950 text-amber-300"
                              />
                              <span>
                                <span className="font-semibold">{milestone.title || "Milestone"}</span>
                                {milestone.amount ? <span className="ml-2 text-slate-400">{money(numericValue(milestone.amount))}</span> : null}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {actionModal === "dispute" ? (
                <>
                  <label className="block text-sm font-semibold text-slate-200">
                    Desired resolution
                    <input
                      data-testid="customer-action-desired-resolution"
                      value={actionForm.desired_resolution}
                      onChange={(event) => setActionForm((current) => ({ ...current, desired_resolution: event.target.value }))}
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none focus:border-amber-300"
                      placeholder="Repair, refund review, clarification, or another outcome"
                    />
                  </label>
                  <label className="block text-sm font-semibold text-slate-200">
                    Description
                    <textarea
                      data-testid="customer-action-description"
                      value={actionForm.description}
                      onChange={(event) => setActionForm((current) => ({ ...current, description: event.target.value }))}
                      rows={4}
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none focus:border-amber-300"
                      placeholder="Describe what is wrong and what needs review."
                    />
                  </label>
                </>
              ) : null}

              <label className="block text-sm font-semibold text-slate-200">
                Reason
                <textarea
                  data-testid="customer-action-reason"
                  value={actionForm.reason}
                  onChange={(event) => setActionForm((current) => ({ ...current, reason: event.target.value }))}
                  rows={actionModal === "dispute" ? 2 : 4}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none focus:border-amber-300"
                  placeholder="Tell us why this needs review."
                />
              </label>
              <label className="block text-sm font-semibold text-slate-200">
                Evidence or attachment note, optional
                <textarea
                  value={actionForm.attachment_note}
                  onChange={(event) => setActionForm((current) => ({ ...current, attachment_note: event.target.value }))}
                  rows={2}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none focus:border-amber-300"
                  placeholder="Reference photos, documents, or notes already in your records."
                />
              </label>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setActionModal("")}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-500"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="customer-action-submit"
                onClick={submitHomeownerAction}
                disabled={actionSubmitting}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-300 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-200 disabled:opacity-60"
              >
                {actionSubmitting ? "Submitting..." : actionModal === "dispute" ? "Open Dispute" : "Submit Request"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
