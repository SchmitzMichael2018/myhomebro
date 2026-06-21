import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CheckCircle2, Circle, CreditCard, ExternalLink, FileText, FolderKanban, Home, Inbox, LayoutDashboard, LogOut, Pencil, UserRound, Users, Wrench } from "lucide-react";
import toast from "react-hot-toast";

import api, { clearAuth } from "../api";
import logo from "../assets/myhomebro_logo.png";
import AddressAutocomplete from "./AddressAutocomplete.jsx";
import CustomerDocuments from "./CustomerDocuments.jsx";
import CustomerProjectWorkspace from "./CustomerProjectWorkspace.jsx";
import CustomerPropertyProfile from "./CustomerPropertyProfile.jsx";
import CustomerRequests from "./CustomerRequests.jsx";

const BASE_TABS = [
  ["overview", "Overview", LayoutDashboard],
  ["requests", "Requests", Inbox],
  ["projects", "Projects", FolderKanban],
  ["property", "Property", Home],
  ["payments", "Payments", CreditCard],
  ["documents", "Documents", FileText],
  ["notifications", "Notifications", Bell],
  ["account", "Account", UserRound],
];

const MAINTENANCE_TAB = ["maintenance", "Maintenance", Wrench];
const SEARCH_RADIUS_OPTIONS = [5, 10, 25, 50, 100];

function customerPortalTabs(showMaintenanceTab) {
  if (!showMaintenanceTab) return BASE_TABS;
  return [BASE_TABS[0], MAINTENANCE_TAB, ...BASE_TABS.slice(1)];
}

const PORTAL_ADDRESS_AUTOCOMPLETE_CLASSES = {
  inputClassName:
    "w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 pr-10 text-sm text-white placeholder:text-slate-400 outline-none focus:border-sky-400 disabled:bg-slate-800 disabled:text-slate-400",
  suggestionsClassName:
    "absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-600 bg-slate-950 text-sm text-slate-100 shadow-xl",
  suggestionButtonClassName:
    "block w-full px-3 py-2 text-left text-slate-100 hover:bg-slate-800 hover:text-white focus:bg-sky-900 focus:text-white focus:outline-none active:bg-sky-800 disabled:bg-slate-900 disabled:text-slate-500",
  helperClassName: "mt-1 text-xs text-slate-300",
};

function StatCard({ label, value, testId, onClick }) {
  const Component = onClick ? "button" : "div";
  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-testid={testId}
      className={`rounded-2xl border border-slate-700 bg-slate-950/60 p-4 text-left ${
        onClick ? "transition hover:border-amber-300/55 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-300/45" : ""
      }`}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
    </Component>
  );
}
function InfoCard({ eyebrow, title, body, actionLabel, onClick, testId, children }) {
  const Component = onClick ? "button" : "article";
  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-testid={testId}
      className={`rounded-2xl border border-slate-700 bg-slate-950/60 p-4 text-left ${
        onClick ? "transition hover:border-amber-300/55 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-300/45" : ""
      }`}
    >
      {eyebrow ? <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{eyebrow}</div> : null}
      {title ? <div className="mt-1 text-sm font-semibold text-white">{title}</div> : null}
      {body ? <p className="mt-1 text-sm leading-5 text-slate-300">{body}</p> : null}
      {children}
      {actionLabel ? <div className="mt-3 text-xs font-semibold text-amber-100">{actionLabel}</div> : null}
    </Component>
  );
}

function Badge({ children, tone = "slate" }) {
  const tones = {
    gold: "border-amber-300/50 bg-amber-300/15 text-amber-100",
    slate: "border-slate-600 bg-slate-900 text-slate-200",
  };
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  );
}

function EmptyState({ title, children, testId }) {
  return (
    <div data-testid={testId} className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-5 text-sm text-slate-300">
      <div className="font-semibold text-white">{title}</div>
      <p className="mt-1 leading-6 text-slate-400">{children}</p>
    </div>
  );
}

function recommendationTheme(recommendation = {}) {
  const text = [
    recommendation.title,
    recommendation.summary,
    recommendation.reason,
    recommendation.category,
    recommendation.type,
    recommendation.id,
  ].join(" ").toLowerCase();
  if (text.includes("hvac") || text.includes("cooling") || text.includes("filter")) return "hvac";
  if (text.includes("water heater")) return "water_heater";
  if (text.includes("roof")) return "roof";
  if (text.includes("warranty")) return "warranty";
  return String(recommendation.category || recommendation.type || recommendation.key || recommendation.id || recommendation.title || "recommendation")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
}

function themeTitle(theme, fallback = "Property recommendation") {
  const titles = {
    hvac: "HVAC Maintenance",
    water_heater: "Water Heater Records",
    roof: "Roof Records",
    warranty: "Warranty Review",
  };
  return titles[theme] || fallback;
}

function severityRank(value = "") {
  const ranks = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  return ranks[String(value || "").toLowerCase()] || 0;
}

function normalizeInsightRecommendation(insight = {}) {
  return {
    id: insight.id,
    key: insight.id,
    title: insight.title,
    summary: insight.reason,
    explanation: insight.reason,
    category: insight.category,
    severity: insight.severity,
    confidence: insight.confidence,
    action_label: insight.suggested_action?.label,
    action_target: insight.suggested_action?.target ? `portal:${insight.suggested_action.target}` : "",
  };
}

function mergeRecommendations(recommendations = []) {
  const grouped = new Map();
  recommendations.filter(Boolean).forEach((recommendation) => {
    const theme = recommendationTheme(recommendation);
    const current = grouped.get(theme);
    const normalized = {
      ...recommendation,
      title: recommendation.title || "Property recommendation",
      summary: recommendation.summary || recommendation.reason || "",
      explanation: recommendation.explanation || recommendation.reason || "",
    };
    if (!current) {
      grouped.set(theme, {
        ...normalized,
        id: `merged-${theme}`,
        theme,
        title: themeTitle(theme, normalized.title),
        reasons: [normalized.summary, normalized.explanation].filter(Boolean),
      });
      return;
    }
    current.reasons.push(...[normalized.summary, normalized.explanation].filter(Boolean));
    if (severityRank(normalized.severity) > severityRank(current.severity)) current.severity = normalized.severity;
    if (!current.action_label && normalized.action_label) current.action_label = normalized.action_label;
    if (!current.action_target && normalized.action_target) current.action_target = normalized.action_target;
  });
  return Array.from(grouped.values()).map((recommendation) => {
    const reasons = Array.from(new Set(recommendation.reasons.filter(Boolean)));
    return {
      ...recommendation,
      summary: reasons[0] || recommendation.summary,
      explanation: reasons.slice(1, 3).join(" "),
    };
  });
}

function CustomerRecommendationsPanel({ recommendations = [], onOpenTab }) {
  const rows = mergeRecommendations(Array.isArray(recommendations) ? recommendations : []).slice(0, 5);
  const targetTab = (target = "") => {
    const value = String(target || "");
    if (value.startsWith("portal:")) return value.replace("portal:", "") || "overview";
    if (value.includes("requests")) return "requests";
    if (value.includes("property")) return "property";
    if (value.includes("payments")) return "payments";
    if (value.includes("documents")) return "documents";
    return "";
  };
  return (
    <section
      data-testid="customer-unified-recommendations"
      className="rounded-2xl border border-amber-300/25 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.13),transparent_34%),rgba(15,23,42,0.72)] p-5"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">Recommendations</div>
          <h2 className="mt-1 text-xl font-semibold text-white">Recommended for you</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">
            Advisory suggestions from your property records, documents, warranties, and service history.
          </p>
        </div>
        <Badge tone={rows.length ? "gold" : "slate"}>{rows.length || "No"} advisory</Badge>
      </div>
      {rows.length ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {rows.map((recommendation) => {
          const tab = targetTab(recommendation.action_target);
          return (
            <article
              key={recommendation.id || recommendation.key || recommendation.title}
              data-testid="customer-unified-recommendation-card"
              className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-white" data-testid="recommendation-title">
                  {recommendation.title}
                </h3>
                <span className="rounded-full border border-slate-600 bg-slate-900 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-300">
                  {recommendation.severity || "info"}
                </span>
              </div>
              <p className="mt-2 text-sm leading-5 text-slate-300">{recommendation.summary}</p>
              {recommendation.explanation ? (
                <p className="mt-1 text-xs leading-5 text-slate-500">{recommendation.explanation}</p>
              ) : null}
              {recommendation.action_label && tab ? (
                <button
                  type="button"
                  data-testid="recommendation-action"
                  onClick={() => onOpenTab?.(tab)}
                  className="mt-3 inline-flex min-h-10 items-center justify-center rounded-xl border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-300/20"
                >
                  {recommendation.action_label}
                </button>
              ) : null}
            </article>
          );
          })}
        </div>
      ) : (
        <div className="mt-4">
          <EmptyState title="No property recommendations right now" testId="customer-recommendations-empty">
            As projects, service visits, warranties, and documents are added, helpful property suggestions will appear here.
          </EmptyState>
        </div>
      )}
    </section>
  );
}

function paymentActionLabel(payment) {
  if (payment?.is_actionable === false || paymentAmountValue(payment) <= 0) return "View Record";
  const status = String(payment?.status || payment?.status_label || "").toLowerCase();
  const type = String(payment?.record_type || payment?.record_type_label || "").toLowerCase();
  if (status.includes("paid") || status.includes("released")) return payment?.receipt_url ? "View Receipt" : "View Record";
  if (type.includes("draw")) return "Review Release";
  if (type.includes("invoice")) return "Pay Invoice";
  return "Open";
}

function isInvoicePayment(payment) {
  const type = String(payment?.record_type || payment?.record_type_label || "").toLowerCase();
  return type.includes("invoice");
}

function isPaidPayment(payment) {
  return isEscrowReleasePayment(payment) || isCustomerPaidPayment(payment);
}

function paymentAmountValue(payment) {
  const raw = payment?.amount ?? payment?.amount_label ?? "";
  const value = Number(String(raw || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(value) ? value : 0;
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
  const status = paymentStatusText(payment);
  const type = paymentTypeText(payment);
  const mode = paymentModeText(payment);
  if (isEscrowFundingPayment(payment) || isRefundPayment(payment)) return false;
  if (type.includes("draw") || type.includes("reimbursement")) return status.includes("paid") || status.includes("released");
  return isInvoicePayment(payment) && mode.includes("escrow") && (status.includes("paid") || status.includes("released"));
}

function isCustomerPaidPayment(payment) {
  if (payment?.customer_payment_recorded === true) return !isEscrowFundingPayment(payment) && !isEscrowReleasePayment(payment) && !isRefundPayment(payment);
  const status = paymentStatusText(payment);
  const mode = paymentModeText(payment);
  if (isEscrowFundingPayment(payment) || isEscrowReleasePayment(payment) || isRefundPayment(payment)) return false;
  return isInvoicePayment(payment) && !mode.includes("escrow") && status.includes("paid");
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
      remaining ? `Remaining escrow after release: ${moneyLabel(remaining)}.` : "",
    ].filter(Boolean).join(" ");
  }
  if (payment?.dispute_escrow_hold_active) return "Escrow balance is paused while this issue is reviewed";
  if (isRefundPayment(payment)) return payment?.status === "eligible" ? "Available for homeowner refund review" : "Refund issued from escrow";
  if (isEscrowAdjustmentRecord(payment)) return "Escrow balance adjustment recorded";
  return "";
}

function moneyLabel(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function projectValueForSummary(summary = {}, agreement = {}) {
  return Number(summary.project_value || agreement.total_cost || 0);
}

function paidToContractorForSummary(summary = {}) {
  return Number(summary.released_to_contractor || summary.released || 0);
}

function remainingProjectValue(summary = {}, agreement = {}) {
  return Math.max(0, projectValueForSummary(summary, agreement) - paidToContractorForSummary(summary));
}

function paymentHistoryWithRunningTotals(rows = [], agreement = {}) {
  const projectValue = projectValueForSummary(agreement.payment_summary || {}, agreement);
  let totalPaid = 0;
  return [...(rows || [])]
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .map((payment) => {
      if (isEscrowReleasePayment(payment) || isCustomerPaidPayment(payment)) {
        totalPaid += Math.max(0, paymentAmountValue(payment));
      }
      const percentPaid = projectValue > 0 ? Math.max(0, Math.min(100, Math.round((totalPaid / projectValue) * 100))) : 0;
      return { payment, totalPaid, percentPaid };
    });
}

function escrowSignedAmount(payment) {
  const amount = Math.abs(paymentAmountValue(payment));
  if (isEscrowFundingPayment(payment)) return amount;
  if (isRefundPayment(payment) || isEscrowReleasePayment(payment)) return -amount;
  if (isEscrowAdjustmentRecord(payment)) return paymentAmountValue(payment);
  return 0;
}

function escrowHistoryWithRunningBalances(rows = []) {
  let balance = 0;
  return [...(rows || [])]
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .map((payment) => {
      const ledgerBalance =
        escrowLedgerValue(payment, "available") ||
        escrowLedgerValue(payment, "remaining") ||
        escrowLedgerValue(payment, "balance_after");
      const signedAmount = escrowSignedAmount(payment);
      balance = ledgerBalance || Math.max(0, balance + signedAmount);
      return { payment, signedAmount, balance };
    });
}

function paymentSummary(payments = []) {
  return payments.reduce(
    (acc, payment) => {
      const amount = paymentAmountValue(payment);
      const notes = String(payment?.notes || "").toLowerCase();
      const status = String(payment?.status || payment?.status_label || "").toLowerCase();
      if (isCustomerPaidPayment(payment)) acc.paid += amount;
      if (isActionablePayment(payment)) acc.pending += amount;
      if (isEscrowReleasePayment(payment)) acc.released += amount;
      if (isRefundPayment(payment) || amount <= 0 || notes.includes("correction") || notes.includes("adjustment")) acc.adjustments += Math.abs(amount);
      return acc;
    },
    { paid: 0, pending: 0, released: 0, adjustments: 0 }
  );
}

function escrowSummaryFromAgreements(agreements = [], payments = []) {
  const agreementRows = Array.isArray(agreements) ? agreements : [];
  if (agreementRows.length) {
    return agreementRows.reduce(
      (acc, agreement) => {
        const summary = agreement.payment_summary || {};
        acc.funded += Number(summary.escrow_funded || 0);
        acc.released += Number(summary.released_to_contractor || 0);
        acc.remaining += Number(summary.remaining_in_escrow || 0);
        acc.refunds += Number(summary.refunds || summary.refund_eligible || 0);
        return acc;
      },
      { funded: 0, released: 0, remaining: 0, refunds: 0 }
    );
  }
  return (Array.isArray(payments) ? payments : []).reduce(
    (acc, payment) => {
      const ledger = payment?.escrow_ledger || {};
      acc.funded += Number(ledger.funded || 0);
      if (isEscrowReleasePayment(payment)) acc.released += paymentAmountValue(payment);
      if (isRefundPayment(payment)) acc.refunds += Math.abs(paymentAmountValue(payment));
      return acc;
    },
    { funded: 0, released: 0, remaining: 0, refunds: 0 }
  );
}

function paidProgress(summary = {}, agreement = {}) {
  const released = Number(summary.released_to_contractor || summary.released || 0);
  const value = Number(summary.project_value || agreement.total_cost || 0);
  if (!Number.isFinite(released) || !Number.isFinite(value) || value <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((released / value) * 100)));
}

function isUnreadNotification(notification) {
  return !isArchivedNotification(notification) && notification?.status !== "read";
}

function isArchivedNotification(notification) {
  return Boolean(notification?.is_archived || notification?.archived_at || notification?.status === "dismissed" || notification?.status === "archived");
}

const ACTIONABLE_NOTIFICATION_EVENTS = new Set([
  "agreement_needs_signature",
  "escrow_needs_funding",
  "milestone_needs_approval",
  "reimbursement_submitted",
  "customer_bid_received",
  "request_marketplace_ready",
]);

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

function isReimbursementPayment(payment) {
  const type = String(payment?.record_type || payment?.record_type_label || "").toLowerCase();
  return type.includes("reimbursement");
}

function canReviewReimbursement(payment) {
  const status = String(payment?.status || "").toLowerCase();
  return isReimbursementPayment(payment) && (payment?.can_approve || ["submitted", "sent_to_homeowner"].includes(status));
}

function normalizeInvoiceMagicUrl(actionTarget = "") {
  const value = String(actionTarget || "");
  const invoiceMatch = value.match(/\/invoice\/([^/?#]+)/);
  if (invoiceMatch) return `/invoices/magic/${encodeURIComponent(decodeURIComponent(invoiceMatch[1]))}`;
  const magicMatch = value.match(/\/invoices\/magic\/([^/?#]+)/);
  if (magicMatch) return `/invoices/magic/${encodeURIComponent(decodeURIComponent(magicMatch[1]))}`;
  return value;
}

function PaymentsPanel({ payments = [], agreements = [], token = "", onPortalUpdate }) {
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [escrowHistoryExpanded, setEscrowHistoryExpanded] = useState(false);
  const [selectedAgreementId, setSelectedAgreementId] = useState("");
  const attention = payments.filter((payment) => {
    return isActionablePayment(payment);
  });
  const paymentHistory = payments.filter(isPaymentHistoryRecord);
  const escrowHistory = payments.filter(isEscrowHistoryRecord);
  const totals = paymentSummary(payments);
  const escrowTotals = escrowSummaryFromAgreements(agreements, payments);
  if (!escrowTotals.remaining && escrowTotals.funded) {
    escrowTotals.remaining = Math.max(0, escrowTotals.funded - escrowTotals.released - escrowTotals.refunds);
  }
  const historyDefaultCount = 5;
  const visiblePaymentHistory = historyExpanded ? paymentHistory : paymentHistory.slice(0, historyDefaultCount);
  const visibleEscrowHistory = escrowHistoryExpanded ? escrowHistory : escrowHistory.slice(0, historyDefaultCount);
  const agreementRows = (agreements || []).map((agreement) => {
    const agreementTitle = String(agreement.project_title || agreement.title || "").trim().toLowerCase();
    const related = payments.filter((payment) => {
      if (String(payment.agreement_id || "") === String(agreement.id || "")) return true;
      const paymentTitle = String(payment.project_title || "").trim().toLowerCase();
      return Boolean(agreementTitle && paymentTitle && paymentTitle === agreementTitle);
    });
    const summary = agreement.payment_summary || paymentSummary(related);
    const milestones = agreement.milestones || [];
    const completed = milestones.filter((milestone) => String(milestone.status || "").toLowerCase().includes("complete") || milestone.completed).length;
    const milestoneLabel = milestones.length ? `${completed} of ${milestones.length} complete` : "Milestones pending";
    const paidPercent = paidProgress(summary, agreement);
    return { agreement, related, summary, milestoneLabel, paidPercent };
  });
  const selectedAgreement = agreementRows.find((row) => String(row.agreement.id) === String(selectedAgreementId)) || agreementRows[0] || null;
  const selectedPaymentHistory = selectedAgreement?.related?.filter(isPaymentHistoryRecord) || [];
  const selectedEscrowHistory = selectedAgreement?.related?.filter(isEscrowHistoryRecord) || [];
  const selectedPaymentHistoryRows = selectedAgreement ? paymentHistoryWithRunningTotals(selectedPaymentHistory, selectedAgreement.agreement) : [];
  const selectedEscrowHistoryRows = escrowHistoryWithRunningBalances(selectedEscrowHistory);
  const selectedProjectValue = selectedAgreement ? projectValueForSummary(selectedAgreement.summary, selectedAgreement.agreement) : 0;
  const selectedPaidToContractor = selectedAgreement ? paidToContractorForSummary(selectedAgreement.summary) : 0;
  const selectedRemainingProjectValue = selectedAgreement ? remainingProjectValue(selectedAgreement.summary, selectedAgreement.agreement) : 0;
  const selectedRemainingEscrow = Number(selectedAgreement?.summary?.remaining_in_escrow || 0);

  return (
    <div data-testid="customer-portal-payments" className="space-y-5">
      <section className="rounded-2xl border border-amber-300/35 bg-amber-300/10 p-5">
        <h2 className="text-xl font-semibold text-white">Project Payment Center</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-amber-100">
          Start with the project, then review escrow funded, releases, invoices, refunds, and the milestone progress behind each payment.
        </p>
      </section>

      <section data-testid="customer-payments-summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Direct Payments" value={moneyLabel(totals.paid)} testId="customer-payments-summary-paid" />
        <StatCard label="Pending Review" value={moneyLabel(totals.pending)} testId="customer-payments-summary-pending" />
        <StatCard label="Released to Contractor" value={moneyLabel(totals.released)} testId="customer-payments-summary-released" />
        <StatCard label="Refunds / Adjustments" value={moneyLabel(totals.adjustments)} testId="customer-payments-summary-adjustments" />
      </section>

      <section data-testid="customer-payments-escrow-summary" className="rounded-2xl border border-sky-300/25 bg-sky-400/10 p-5">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-200">Escrow Summary</div>
          <h3 className="mt-1 text-lg font-semibold text-white">Money held and released through MyHomeBro</h3>
          <p className="mt-1 text-sm leading-6 text-sky-100/85">
            Invoice & Payment History answers which invoice was paid. Escrow History shows how the escrow balance changed after deposits, releases, holds, refunds, and adjustments.
          </p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <StatCard label="Escrow Funded" value={moneyLabel(escrowTotals.funded)} testId="customer-payments-escrow-funded" />
          <StatCard label="Released to Contractor" value={moneyLabel(escrowTotals.released)} testId="customer-payments-escrow-released" />
          <StatCard label="Remaining in Escrow" value={moneyLabel(escrowTotals.remaining)} testId="customer-payments-escrow-remaining" />
        </div>
      </section>

      <section data-testid="customer-payments-agreement-list" className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold text-white">Payments by project</h3>
          <Badge>{agreementRows.length} projects</Badge>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <div className="space-y-3">
            {agreementRows.length ? agreementRows.map(({ agreement, summary, milestoneLabel, paidPercent }) => (
              <button
                key={agreement.id}
                type="button"
                data-testid={`customer-payment-agreement-${agreement.id}`}
                onClick={() => setSelectedAgreementId(agreement.id)}
                className={`w-full rounded-2xl border p-4 text-left transition ${
                  String(selectedAgreement?.agreement?.id) === String(agreement.id)
                    ? "border-amber-300/55 bg-amber-300/10"
                    : "border-slate-700 bg-slate-900/60 hover:border-slate-500"
                }`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-white">{agreement.project_title || agreement.title || "Project"}</div>
                    <div className="mt-1 text-xs text-slate-400">{agreement.contractor_name || "Contractor"} - {agreement.customer_status_label || agreement.status_label || "Project"}</div>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <Badge>{milestoneLabel}</Badge>
                    <Badge tone={paidPercent > 0 ? "gold" : "slate"}>{paidPercent}% released</Badge>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
                  <span>Project value: <strong className="text-white">{moneyLabel(Number(summary.project_value || agreement.total_cost || 0))}</strong></span>
                  <span>Escrow funded: <strong className="text-white">{moneyLabel(Number(summary.escrow_funded || 0))}</strong></span>
                  <span>Released: <strong className="text-white">{moneyLabel(Number(summary.released_to_contractor || 0))}</strong></span>
                  <span>Remaining: <strong className="text-white">{moneyLabel(Number(summary.remaining_in_escrow || 0))}</strong></span>
                </div>
              </button>
            )) : (
              <EmptyState title="No project payments yet" testId="customer-payments-agreement-empty">
                Project-level payment summaries appear here once agreements or payments are connected.
              </EmptyState>
            )}
          </div>
          <div data-testid="customer-payment-agreement-detail" className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
            {selectedAgreement ? (
              <>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected project</div>
                <h4 className="mt-1 text-lg font-semibold text-white">{selectedAgreement.agreement.project_title || selectedAgreement.agreement.title || "Project"}</h4>
                <div data-testid="customer-selected-project-financial-summary" className="mt-3 rounded-2xl border border-slate-700 bg-slate-950/45 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Project Financial Summary</div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-300">
                    <div>Project Value: <strong className="text-white">{moneyLabel(selectedProjectValue)}</strong></div>
                    <div>Paid to Contractor: <strong className="text-white">{moneyLabel(selectedPaidToContractor)}</strong></div>
                    <div>Remaining Project Value: <strong className="text-white">{moneyLabel(selectedRemainingProjectValue)}</strong></div>
                    <div>Escrow Funded: <strong className="text-white">{moneyLabel(Number(selectedAgreement.summary.escrow_funded || 0))}</strong></div>
                    <div>Remaining Escrow: <strong className="text-white">{moneyLabel(selectedRemainingEscrow)}</strong></div>
                    <div>Milestone Progress: <strong className="text-white">{selectedAgreement.milestoneLabel}</strong></div>
                    <div>Paid Progress: <strong className="text-white">{selectedAgreement.paidPercent}% of project value paid</strong></div>
                  </div>
                </div>
                <div className="mt-4 space-y-4">
                  <div data-testid="customer-selected-payment-history">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Invoice & Payment History</div>
                    <p className="mt-1 text-xs leading-5 text-slate-400">What work has been paid for.</p>
                    <div className="mt-2 space-y-2">
                      {selectedPaymentHistoryRows.length ? selectedPaymentHistoryRows.slice(0, 4).map(({ payment, totalPaid, percentPaid }) => (
                        <div key={payment.id} data-testid={`customer-selected-payment-running-${payment.id}`} className="space-y-2">
                          <PaymentActionCard payment={payment} compact token={token} onPortalUpdate={onPortalUpdate} displayLabel={paymentHistoryLabel(payment)} displayDescription={paymentHistoryDescription(payment)} />
                          <div className="rounded-xl border border-slate-700 bg-slate-950/45 px-3 py-2 text-xs text-slate-300">
                            <div>Amount Paid: <strong className="text-white">{moneyLabel(paymentAmountValue(payment))}</strong></div>
                            <div>Total Paid To Date: <strong className="text-white">{moneyLabel(totalPaid)}</strong></div>
                            <div>{percentPaid}% of Project Value Paid</div>
                          </div>
                        </div>
                      )) : (
                        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/45 p-3 text-sm text-slate-400">No contractor releases, direct payments, refunds, or adjustments are connected yet.</div>
                      )}
                    </div>
                  </div>
                  <div data-testid="customer-selected-escrow-history">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Escrow History</div>
                    <p className="mt-1 text-xs leading-5 text-slate-400">
                      How your escrow balance changed after deposits, releases, holds, refunds, and adjustments.
                    </p>
                    <div className="mt-2 space-y-2">
                      {selectedEscrowHistoryRows.length ? selectedEscrowHistoryRows.slice(0, 4).map(({ payment, signedAmount, balance }) => (
                        <div key={payment.id} data-testid={`customer-selected-escrow-running-${payment.id}`} className="space-y-2">
                          <PaymentActionCard payment={payment} compact token={token} onPortalUpdate={onPortalUpdate} displayLabel={escrowHistoryLabel(payment)} displayDescription={escrowHistoryDescription(payment)} cardTestId={`customer-selected-escrow-action-${payment.id}`} />
                          <div className="rounded-xl border border-slate-700 bg-slate-950/45 px-3 py-2 text-xs text-slate-300">
                            <div>Amount: <strong className="text-white">{signedAmount >= 0 ? "+" : "-"}{moneyLabel(Math.abs(signedAmount))}</strong></div>
                            <div>Balance: <strong className="text-white">{moneyLabel(balance)}</strong></div>
                          </div>
                        </div>
                      )) : (
                        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/45 p-3 text-sm text-slate-400">No escrow deposits, holds, refunds, or balance adjustments are connected yet.</div>
                      )}
                    </div>
                    <div data-testid="customer-selected-current-escrow-balance" className="mt-3 rounded-xl border border-sky-300/30 bg-sky-400/10 p-3 text-sm text-sky-100">
                      Current Escrow Balance: <strong>{moneyLabel(selectedRemainingEscrow)}</strong>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <EmptyState title="Select a project" testId="customer-payments-select-empty">
                Choose a project to see escrow, releases, invoices, refunds, and milestone support.
              </EmptyState>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold text-white">Needs attention</h3>
          <Badge>{attention.length} open</Badge>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {attention.length ? (
            attention.map((payment) => (
              <PaymentActionCard key={payment.id} payment={payment} token={token} onPortalUpdate={onPortalUpdate} />
            ))
          ) : (
            <div className="lg:col-span-2">
              <EmptyState title="No payments need review" testId="customer-payments-attention-empty">
                When an invoice needs payment or a milestone release needs review, it will appear here with a clear action.
              </EmptyState>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold text-white">Invoice & Payment History</h3>
          <Badge>{paymentHistory.length} records</Badge>
        </div>
        <div data-testid="customer-payment-history" className="mt-4 space-y-3">
          {paymentHistory.length ? (
            visiblePaymentHistory.map((payment) => (
              <PaymentActionCard key={payment.id} payment={payment} compact token={token} onPortalUpdate={onPortalUpdate} displayLabel={paymentHistoryLabel(payment)} displayDescription={paymentHistoryDescription(payment)} />
            ))
          ) : payments.length ? null : (
            <EmptyState title="No payment records yet" testId="customer-payments-empty">
              Contractor releases, direct payments, refunds, and adjustments will appear here when they are connected to this secure customer record.
            </EmptyState>
          )}
        </div>
        {paymentHistory.length > historyDefaultCount ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs font-semibold text-slate-400">
              Showing {historyExpanded ? paymentHistory.length : historyDefaultCount} of {paymentHistory.length} payment records
            </div>
            <button
              type="button"
              data-testid="customer-payments-history-show-more"
              onClick={() => setHistoryExpanded((value) => !value)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-amber-300/50 hover:text-white"
            >
              {historyExpanded ? "Show less" : "Show more"}
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold text-white">Escrow history</h3>
          <Badge>{escrowHistory.length} records</Badge>
        </div>
        <p className="mt-1 text-sm leading-6 text-slate-400">
          This ledger shows escrow balance movement. Invoice & Payment History shows which invoice or contractor payout was paid.
        </p>
        <div data-testid="customer-escrow-history" className="mt-4 space-y-3">
          {escrowHistory.length ? (
            visibleEscrowHistory.map((payment) => (
              <PaymentActionCard key={payment.id} payment={payment} compact token={token} onPortalUpdate={onPortalUpdate} displayLabel={escrowHistoryLabel(payment)} displayDescription={escrowHistoryDescription(payment)} cardTestId={`customer-escrow-action-${payment.id}`} />
            ))
          ) : (
            <EmptyState title="No escrow records yet" testId="customer-escrow-history-empty">
              Escrow deposits, holds, refunds, reversals, and adjustments will appear here when this project uses milestone holds.
            </EmptyState>
          )}
        </div>
        <div data-testid="customer-current-escrow-balance" className="mt-4 rounded-xl border border-sky-300/30 bg-sky-400/10 p-3 text-sm text-sky-100">
          Current Escrow Balance: <strong>{moneyLabel(escrowTotals.remaining)}</strong>
        </div>
        {escrowHistory.length > historyDefaultCount ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs font-semibold text-slate-400">
              Showing {escrowHistoryExpanded ? escrowHistory.length : historyDefaultCount} of {escrowHistory.length} escrow records
            </div>
            <button
              type="button"
              data-testid="customer-escrow-history-show-more"
              onClick={() => setEscrowHistoryExpanded((value) => !value)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-amber-300/50 hover:text-white"
            >
              {escrowHistoryExpanded ? "Show less" : "Show more"}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function PaymentActionCard({ payment, compact = false, token = "", onPortalUpdate, displayLabel = "", displayDescription = "", cardTestId = "" }) {
  const [busyAction, setBusyAction] = useState("");
  const [denyModalOpen, setDenyModalOpen] = useState(false);
  const [denyReason, setDenyReason] = useState("");
  const [denyError, setDenyError] = useState("");
  const invoiceUrl = isInvoicePayment(payment) ? normalizeInvoiceMagicUrl(payment.action_target) : payment.action_target;
  const target = payment.receipt_url || invoiceUrl || "#";
  const disputeUrl = isInvoicePayment(payment) && invoiceUrl ? `${invoiceUrl}?action=dispute` : "";
  const actionable = isActionablePayment(payment);
  const disputeStatus = customerDisputeStatus(payment);

  async function runReimbursementAction(action, providedReason = "") {
    if (!token || !payment?.record_id) return;
    const payload = {};
    if (action === "deny") {
      const reason = String(providedReason || "").trim();
      if (!reason) return;
      payload.denial_reason = reason;
    }
    setBusyAction(action);
    try {
      const { data } = await api.post(`/projects/customer-portal/${token}/reimbursements/${payment.record_id}/${action === "approve" ? "approve" : "deny"}/`, payload);
      if (data?.portal && typeof onPortalUpdate === "function") {
        onPortalUpdate(data.portal);
      }
      toast.success(action === "approve" ? "Reimbursement approved" : "Reimbursement denied");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update reimbursement.");
    } finally {
      setBusyAction("");
    }
  }

  return (
    <>
    <article data-testid={cardTestId || `customer-payment-action-${payment.id}`} className={`rounded-2xl border border-slate-700 bg-slate-900/70 p-4 ${compact ? "" : "shadow-xl shadow-slate-950/20"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Badge>{displayLabel || payment.record_type_label || "Payment"}</Badge>
            <Badge>{payment.status_label || "Pending"}</Badge>
          </div>
          <div className="mt-3 text-sm font-semibold text-white">{payment.project_title}</div>
          {displayDescription ? <p className="mt-1 text-xs font-medium text-slate-300">{displayDescription}</p> : null}
          <div className="mt-1 text-xs text-slate-500">
            {payment.date ? new Date(payment.date).toLocaleDateString() : "No date"}
            {payment.reference ? ` - ${payment.reference}` : ""}
          </div>
          <div className="mt-2 grid gap-1 text-xs text-slate-400 sm:grid-cols-2">
            <span>{payment.contractor_name ? `Contractor: ${payment.contractor_name}` : "Contractor: Your contractor"}</span>
            <span>{payment.payment_mode_label ? `Method: ${payment.payment_mode_label}` : "Method: Secure payment"}</span>
            {payment.due_date ? <span>Due: {new Date(payment.due_date).toLocaleDateString()}</span> : null}
            {payment.invoice_number ? <span>Invoice: {payment.invoice_number}</span> : null}
            {disputeStatus ? <span className="text-rose-100">Issue: {disputeStatus.label}</span> : null}
          </div>
          {disputeStatus ? (
            <div data-testid={`customer-payment-dispute-status-${payment.id}`} className="mt-3 rounded-xl border border-rose-300/35 bg-rose-400/10 p-3 text-sm text-rose-50">
              <div className="font-semibold">{disputeStatus.label}</div>
              <p className="mt-1 leading-6 text-rose-100/85">{disputeStatus.detail}</p>
            </div>
          ) : null}
          {payment.notes ? <p className="mt-2 text-sm text-slate-300">{payment.notes}</p> : null}
          {isReimbursementPayment(payment) && payment.escrow_ledger?.available ? (
            <p className="mt-2 text-xs text-amber-100">
              Available escrow before this request: ${payment.escrow_ledger.available}. Approval queues release from escrow and reduces funds available for later milestone releases.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <div className="text-lg font-bold text-white">{payment.amount_label || "$0.00"}</div>
          <div className="flex w-full flex-col gap-2 sm:w-auto">
            {target && target !== "#" ? (
              <a
                data-testid={`customer-payment-primary-${payment.id}`}
                href={target}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-200/45 bg-amber-300/15 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/25"
              >
                {paymentActionLabel(payment)}
                <ExternalLink size={14} />
              </a>
            ) : null}
            {isInvoicePayment(payment) && invoiceUrl && actionable ? (
              <>
                <a
                  data-testid={`customer-payment-view-invoice-${payment.id}`}
                  href={invoiceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sky-300/35 bg-sky-400/10 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/20"
                >
                  View Invoice
                  <ExternalLink size={14} />
                </a>
                <a
                  data-testid={`customer-payment-open-dispute-${payment.id}`}
                  href={disputeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300/40 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/20"
                >
                  Open Dispute
                  <ExternalLink size={14} />
                </a>
              </>
            ) : null}
            {hasOpenDispute(payment) && payment.dispute_url ? (
              <a
                data-testid={`customer-payment-track-dispute-${payment.id}`}
                href={payment.dispute_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300/40 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/20"
              >
                Track Issue Status
                <ExternalLink size={14} />
              </a>
            ) : null}
            {canReviewReimbursement(payment) ? (
              <>
                <button
                  type="button"
                  data-testid={`customer-payment-approve-reimbursement-${payment.record_id}`}
                  onClick={() => runReimbursementAction("approve")}
                  disabled={Boolean(busyAction)}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-emerald-300/40 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-60"
                >
                  {busyAction === "approve" ? "Approving..." : "Approve Reimbursement"}
                </button>
                <button
                  type="button"
                  data-testid={`customer-payment-deny-reimbursement-${payment.record_id}`}
                  onClick={() => {
                    setDenyReason("");
                    setDenyError("");
                    setDenyModalOpen(true);
                  }}
                  disabled={Boolean(busyAction)}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-300/40 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/20 disabled:opacity-60"
                >
                  {busyAction === "deny" ? "Denying..." : "Deny"}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </article>
    {denyModalOpen ? (
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
              data-testid={`customer-payment-deny-reason-${payment.record_id}`}
              value={denyReason}
              onChange={(event) => {
                setDenyReason(event.target.value);
                setDenyError("");
              }}
              rows={4}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-rose-300"
              placeholder="Explain why this reimbursement should not be approved yet."
            />
          </label>
          {denyError ? <div className="mt-3 text-sm font-semibold text-rose-100">{denyError}</div> : null}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setDenyModalOpen(false)}
              disabled={Boolean(busyAction)}
              className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
            >
              Keep Review Open
            </button>
            <button
              type="button"
              data-testid={`customer-payment-confirm-deny-${payment.record_id}`}
              onClick={async () => {
                if (!String(denyReason || "").trim()) {
                  setDenyError("Add a reason before denying this reimbursement.");
                  return;
                }
                await runReimbursementAction("deny", denyReason);
                setDenyModalOpen(false);
                setDenyReason("");
              }}
              disabled={Boolean(busyAction)}
              className="rounded-xl bg-rose-300 px-4 py-2 text-sm font-extrabold text-slate-950 hover:bg-rose-200 disabled:opacity-60"
            >
              {busyAction === "deny" ? "Denying..." : "Deny Reimbursement"}
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}

function propertyHasAddress(profile = {}) {
  return Boolean(
    String(profile.address_line1 || "").trim() &&
      String(profile.city || "").trim() &&
      String(profile.state || "").trim()
  );
}

function propertyHasDetails(profile = {}) {
  return Boolean(
    String(profile.display_name || "").trim() ||
      String(profile.property_type || "").trim() ||
      Number(profile.year_built || 0) > 0 ||
      Number(profile.square_feet || 0) > 0 ||
      String(profile.notes || "").trim()
  );
}

function customerHasDocuments(portal = {}) {
  const documents = Array.isArray(portal.documents) ? portal.documents : [];
  const profiles = Array.isArray(portal.property_profiles) ? portal.property_profiles : [];
  return (
    documents.length > 0 ||
    profiles.some((profile) => {
      const docs = Array.isArray(profile.documents) ? profile.documents : [];
      const photos = Array.isArray(profile.photos) ? profile.photos : [];
      return docs.length > 0 || photos.length > 0;
    })
  );
}

function agreementNeedsCustomerAction(agreement = {}) {
  const status = String(
    agreement.status || agreement.signature_status || agreement.agreement_status || agreement.state || ""
  ).toLowerCase();
  return (
    status.includes("signature") ||
    status.includes("sent") ||
    agreement.requires_signature === true ||
    agreement.signed_by_homeowner === false ||
    agreement.customer_action_required === true
  );
}

function systemNeedsHomeownerAttention(system = {}) {
  const status = String(system.maintenance_status || system.maintenanceStatus || "").toLowerCase();
  const priority = String(system.priority || "").toLowerCase();
  return (
    status.includes("overdue") ||
    status.includes("due_soon") ||
    status.includes("warranty_expir") ||
    status.includes("lifespan") ||
    priority === "high" ||
    priority === "critical"
  );
}

function homeSystemAttentionItems(portal = {}) {
  const profiles = Array.isArray(portal.property_profiles)
    ? portal.property_profiles
    : portal.property_profile?.id
      ? [portal.property_profile]
      : [];
  const rows = [];
  for (const profile of profiles) {
    for (const system of profile.home_systems || []) {
      if (!systemNeedsHomeownerAttention(system)) continue;
      const label = system.display_name || system.custom_name || system.system_type_label || "Home system";
      const reason = system.reminder_reason || system.recommended_action || "Maintenance may need attention.";
      rows.push({
        id: `system-${profile.id || "property"}-${system.id || label}`,
        title: `${label} may need attention`,
        body: `${profile.display_name || profile.address || "Your property"} - ${reason}`,
        action: "Open Property",
        tab: "property",
      });
    }
  }
  return rows;
}

function CustomerActivationChecklist({ portal, onOpenTab }) {
  const [expanded, setExpanded] = useState(false);
  const property = portal?.property_profile || {};
  const properties = Array.isArray(portal?.property_profiles) ? portal.property_profiles : [];
  const requests = Array.isArray(portal?.requests) ? portal.requests : [];
  const payments = Array.isArray(portal?.payments) ? portal.payments : [];
  const agreements = Array.isArray(portal?.agreements) ? portal.agreements : [];
  const openPayments = payments.filter(isActionablePayment);
  const hasProperty = propertyHasAddress(property) || properties.some(propertyHasAddress);
  const hasDetails = propertyHasDetails(property) || properties.some(propertyHasDetails);
  const hasDocs = customerHasDocuments(portal);
  const hasRequest = requests.length > 0;
  const hasAgreementAction = agreements.some(agreementNeedsCustomerAction);
  const hasEscrowAction = openPayments.length > 0;
  const items = [
    {
      key: "property-profile",
      title: "Confirm property profile",
      description: "Add the property address so requests, documents, warranties, and project records stay organized.",
      completeText: "Property address is connected.",
      complete: hasProperty,
      tab: "property",
      actionLabel: "Open Property",
    },
    {
      key: "property-details",
      title: "Add property details",
      description: "Add property type, year built, square footage, and notes when helpful.",
      completeText: "Property details have a useful starting point.",
      complete: hasDetails,
      tab: "property",
      actionLabel: "Edit Details",
    },
    {
      key: "documents",
      title: "Upload home documents/photos",
      description: "Store photos, receipts, permits, warranties, and documents for future project planning.",
      completeText: "Home records include documents or photos.",
      complete: hasDocs,
      tab: "documents",
      actionLabel: "Upload Records",
    },
    {
      key: "first-request",
      title: "Create first project/service request",
      description: "Save a repair, maintenance, inspection, or new project request when you are ready.",
      completeText: "At least one request is saved.",
      complete: hasRequest,
      tab: "requests",
      actionLabel: "Create Request",
    },
    {
      key: "agreements",
      title: "Review agreements needing action",
      description: "Sent agreements and signature requests appear in Projects when they need your review.",
      completeText: hasAgreementAction ? "Agreement action is available." : "No agreement action is waiting.",
      complete: !hasAgreementAction,
      tab: "projects",
      actionLabel: "Open Projects",
      actionActive: hasAgreementAction,
    },
    {
      key: "payments",
      title: "Fund escrow or review payments",
      description: "Invoices, escrow funding, and milestone releases appear in Payments when action is needed.",
      completeText: hasEscrowAction ? "Payment action is available." : "No payment action is waiting.",
      complete: !hasEscrowAction,
      tab: "payments",
      actionLabel: "Open Payments",
      actionActive: hasEscrowAction,
    },
  ];

  const completeCount = items.filter((item) => item.complete).length;
  const activeTasks = items.filter((item) => item.actionActive);
  const setupItems = items.filter((item) => !item.actionActive);
  const remainingSetupItems = setupItems.filter((item) => !item.complete);
  const mostlyComplete = completeCount >= items.length - 1;
  const allSetupDone = remainingSetupItems.length === 0;

  if (completeCount === items.length) {
    return (
      <section
        data-testid="customer-activation-checklist"
        className="rounded-2xl border border-emerald-300/25 bg-emerald-400/10 p-4"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-white">Home Profile Setup complete</div>
            <p className="mt-1 text-sm text-emerald-100">Your basic Customer Portal setup is ready.</p>
          </div>
          <Badge tone="gold">{completeCount} of {items.length} complete</Badge>
        </div>
      </section>
    );
  }

  if (mostlyComplete && !expanded) {
    return (
      <section
        data-testid="customer-activation-checklist"
        className="rounded-2xl border border-sky-300/25 bg-slate-950/60 p-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-white">Home Profile Setup: {completeCount} of {items.length} complete</div>
            <p className="mt-1 text-sm text-slate-300">
              {allSetupDone
                ? "Any remaining active tasks are shown above in Needs Attention."
                : `${remainingSetupItems[0]?.title || "One setup item"} is the only setup item left.`}
            </p>
          </div>
          <button
            type="button"
            data-testid="customer-activation-expand"
            onClick={() => setExpanded(true)}
            className="rounded-xl border border-sky-300/35 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-100 hover:bg-sky-400/20"
          >
            Expand setup
          </button>
        </div>
        {activeTasks.length ? (
          <p className="mt-3 text-xs leading-5 text-amber-100">
            {activeTasks.length} active task{activeTasks.length === 1 ? "" : "s"} moved to Needs Attention.
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section
      data-testid="customer-activation-checklist"
      className="rounded-2xl border border-sky-300/25 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.14),transparent_34%),rgba(15,23,42,0.72)] p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-200">Setup checklist</div>
          <h2 className="mt-1 text-xl font-semibold text-white">Get your customer workspace ready</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">
            Confirm your property record, upload important documents, and create a request when you are ready for the next project.
          </p>
        </div>
        <Badge tone="gold">{completeCount} of {items.length} complete</Badge>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {setupItems.map((item) => {
          const complete = Boolean(item.complete);
          return (
            <article
              key={item.key}
              data-testid={`customer-activation-check-${item.key}`}
              className={`rounded-2xl border p-4 ${complete ? "border-emerald-300/25 bg-emerald-400/10" : "border-slate-700 bg-slate-950/55"}`}
            >
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 ${complete ? "text-emerald-300" : "text-slate-500"}`}>
                  {complete ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : <Circle className="h-5 w-5" aria-hidden="true" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${complete ? "border-emerald-300/35 bg-emerald-400/10 text-emerald-100" : "border-amber-300/35 bg-amber-300/10 text-amber-100"}`}>
                      {complete ? "Complete" : "Recommended"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-5 text-slate-300">
                    {complete ? item.completeText : item.description}
                  </p>
                  <button
                    type="button"
                    data-testid={`customer-activation-action-${item.key}`}
                    onClick={() => onOpenTab?.(item.tab)}
                    className="mt-3 inline-flex min-h-10 items-center justify-center rounded-xl border border-sky-300/35 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-100 hover:bg-sky-400/20"
                  >
                    {item.actionLabel}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function OverviewPanel({ portal, onOpenTab, tenantMaintenanceTab = "requests", markingId = "", bulkMarking = false, onMarkRead, onMarkAllRead }) {
  const summary = portal?.summary || {};
  const latestRequests = (portal?.requests || []).slice(0, 3);
  const latestProjects = (portal?.projects || []).slice(0, 3);
  const notifications = portal?.notifications || [];
  const unreadNotifications = notifications.filter(isUnreadNotification);
  const overviewRecommendations = [
    ...(Array.isArray(portal?.recommendations) ? portal.recommendations : []),
    ...(Array.isArray(portal?.property_intelligence?.insights)
      ? portal.property_intelligence.insights.map(normalizeInsightRecommendation)
      : []),
  ];
  const property = portal?.property_profile || {};
  const documents = Array.isArray(portal?.documents) ? portal.documents : [];
  const propertyDocs = [
    ...(Array.isArray(property?.documents) ? property.documents : []),
    ...(Array.isArray(property?.photos) ? property.photos : []),
  ];
  const openPayments = (portal?.payments || []).filter((payment) => {
    return isActionablePayment(payment);
  });
  const openDisputes = (portal?.payments || []).filter(hasOpenDispute);
  const actionableNotifications = notifications.filter((notification) => (
    notification.status !== "read" && ACTIONABLE_NOTIFICATION_EVENTS.has(String(notification.event_type || ""))
  ));
  const tenantMaintenanceNeedsAttention = (portal?.tenant_maintenance_requests || []).filter((request) =>
    ["submitted", "under_review", "more_info_requested", "approved"].includes(String(request?.status || "").toLowerCase())
  );
  const needsAttention = [
    ...tenantMaintenanceNeedsAttention.slice(0, 3).map((request) => ({
      id: `tenant-maintenance-${request.id}`,
      title: request.title || "Maintenance request submitted",
      body: `${request.status_label || "Submitted"}${request.property_name ? ` - ${request.property_name}` : ""}${request.unit_label ? ` - ${request.unit_label}` : ""}`,
      action: "Review maintenance request",
      tab: tenantMaintenanceTab,
    })),
    ...openDisputes.slice(0, 2).map((payment) => ({
      id: `dispute-${payment.id}`,
      title: `Open issue for ${payment.project_title || "your project"}`,
      body: `${payment.dispute_status_label || payment.dispute_status} - ${payment.amount_label || "$0.00"}`,
      action: "Track Issue Status",
      tab: "payments",
    })),
    ...homeSystemAttentionItems(portal).slice(0, 2),
    ...actionableNotifications.slice(0, 3).map((notification) => ({
      id: `notification-${notification.id}`,
      title: notification.title || "Workspace update",
      body: notification.message || "A project update is available.",
      action: "Open Notifications",
      tab: "notifications",
    })),
    ...openPayments.slice(0, 2).map((payment) => ({
      id: `payment-${payment.id}`,
      title: `${payment.record_type_label || "Payment"} for ${payment.project_title || "your project"}`,
      body: `${payment.amount_label || "$0.00"} - ${payment.status_label || "Pending"}`,
      action: "Open Payments",
      tab: "payments",
    })),
  ];

  return (
    <div data-testid="customer-dashboard-overview" className="space-y-5">
      <section data-testid="customer-overview-needs-attention" className="rounded-2xl border border-amber-300/35 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.16),transparent_34%),rgba(15,23,42,0.86)] p-5 shadow-xl shadow-slate-950/25">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">Needs Attention</div>
            <h2 className="mt-1 text-2xl font-semibold text-white">What needs my attention?</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">
              Homeowner-resolvable actions only: signatures, escrow funding, payment reviews, contractor responses, disputes, and maintenance due.
            </p>
          </div>
          <Badge tone={needsAttention.length ? "gold" : "slate"}>{needsAttention.length || "No"} open</Badge>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {needsAttention.length ? (
            needsAttention.slice(0, 5).map((item) => (
              <InfoCard
                key={item.id}
                title={item.title}
                body={item.body}
                actionLabel={item.action}
                onClick={() => onOpenTab?.(item.tab)}
              />
            ))
          ) : (
            <div className="lg:col-span-2 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-4 text-sm text-emerald-100">
              Nothing needs your attention right now. New signatures, payment reviews, contractor responses, disputes, and maintenance reminders will appear here.
            </div>
          )}
        </div>
      </section>

      <section data-testid="customer-overview-active-projects" className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">Projects</div>
            <h2 className="mt-1 text-xl font-semibold text-white">Active Projects</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">
              Review milestones, payments, documents, warranties, and updates for work connected to this customer portal.
            </p>
          </div>
          <button type="button" onClick={() => onOpenTab?.("projects")} className="rounded-xl border border-amber-300/45 bg-amber-300/15 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/25">
            Open Projects
          </button>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {latestProjects.length ? latestProjects.map((project) => (
            <InfoCard
              key={project.id}
              title={project.title}
              eyebrow={project.customer_status_label || project.status_label || "Project"}
              body={`${project.contractor_name || "Contractor pending"}${project.total_cost ? ` - ${moneyLabel(project.total_cost)}` : ""}`}
              actionLabel="View project workspace"
              onClick={() => onOpenTab?.("projects")}
            />
          )) : (
            <div className="lg:col-span-3">
              <EmptyState title="No active projects yet" testId="customer-overview-projects-empty">
                Projects will appear here after a request becomes an agreement or a contractor connects project records to your email.
              </EmptyState>
            </div>
          )}
        </div>
      </section>

      <NotificationPanel
        notifications={unreadNotifications}
        unreadCount={unreadNotifications.length}
        markingId={markingId}
        bulkMarking={bulkMarking}
        onMarkRead={onMarkRead}
        onMarkAllRead={onMarkAllRead}
        onOpenHistory={() => onOpenTab?.("notifications")}
      />

      <CustomerRecommendationsPanel recommendations={overviewRecommendations} onOpenTab={onOpenTab} />

      <section data-testid="customer-overview-property-records" className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-200">Property Records</div>
            <h2 className="mt-1 text-xl font-semibold text-white">Your home history, organized</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">
              Keep documents, photos, warranties, project records, and maintenance history connected to the right property.
            </p>
          </div>
          <button type="button" onClick={() => onOpenTab?.("property")} className="rounded-xl border border-sky-300/40 bg-sky-400/10 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/20">
            Open Property Records
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Properties" value={(portal?.property_profiles || []).length || (property?.id ? 1 : 0)} onClick={() => onOpenTab?.("property")} />
          <StatCard label="Documents" value={(summary.documents ?? documents.length) || 0} testId="customer-portal-summary-documents" onClick={() => onOpenTab?.("documents")} />
          <StatCard label="Property Files" value={propertyDocs.length} onClick={() => onOpenTab?.("property")} />
          <StatCard label="Requests" value={summary.active_requests ?? latestRequests.length} testId="customer-portal-summary-active-requests" onClick={() => onOpenTab?.("requests")} />
        </div>
        {!latestRequests.length ? (
          <div className="mt-4">
            <EmptyState title="No requests yet" testId="customer-overview-requests-empty">
              Save repair, maintenance, inspection, DIY help, emergency, or new project needs here when you are ready.
            </EmptyState>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-700 bg-slate-950/45 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-white">Home Profile Setup</div>
            <p className="mt-1 text-sm text-slate-400">Your setup checklist is tucked here so projects and actions stay first.</p>
          </div>
          <div data-testid="customer-portal-summary" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label="Projects" value={summary.active_projects ?? 0} testId="customer-portal-summary-projects" onClick={() => onOpenTab?.("projects")} />
            <StatCard label="Agreements" value={summary.active_agreements ?? 0} testId="customer-portal-summary-agreements" onClick={() => onOpenTab?.("projects")} />
            <StatCard label="Payments" value={summary.payments ?? 0} testId="customer-portal-summary-payments" onClick={() => onOpenTab?.("payments")} />
            <StatCard label="Requests" value={summary.active_requests ?? 0} onClick={() => onOpenTab?.("requests")} />
          </div>
        </div>
        <div className="mt-4">
          <CustomerActivationChecklist portal={portal} onOpenTab={onOpenTab} />
        </div>
      </section>
    </div>
  );
}

function NotificationsCenter({
  notifications = [],
  unreadCount = 0,
  preferences = {},
  markingId = "",
  archivingId = "",
  restoringId = "",
  savingPreferences = false,
  preferenceError = "",
  bulkMarking = false,
  onMarkRead,
  onMarkAllRead,
  onArchive,
  onRestore,
  onSavePreferences,
}) {
  const [filter, setFilter] = useState("recent");
  const [settings, setSettings] = useState({
    auto_archive_enabled: true,
    auto_archive_frequency: "daily",
    auto_archive_read_after_days: 30,
    auto_archive_maintenance_after_days: 60,
    auto_archive_completed_work_after_days: 90,
  });
  useEffect(() => {
    setSettings({
      auto_archive_enabled: preferences?.auto_archive_enabled !== false,
      auto_archive_frequency: preferences?.auto_archive_frequency || "daily",
      auto_archive_read_after_days: preferences?.auto_archive_read_after_days || 30,
      auto_archive_maintenance_after_days: preferences?.auto_archive_maintenance_after_days || 60,
      auto_archive_completed_work_after_days: preferences?.auto_archive_completed_work_after_days || 90,
    });
  }, [preferences]);
  const filtered = filter === "unread"
    ? notifications.filter(isUnreadNotification)
    : filter === "archived"
      ? notifications.filter(isArchivedNotification)
      : notifications.filter((notification) => !isArchivedNotification(notification));

  return (
    <section data-testid="customer-notifications-center" className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Notifications Center</h2>
          <p className="mt-1 text-sm leading-6 text-slate-300">Your notification history, with archived updates kept separately for reference.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{unreadCount} unread</Badge>
          {unreadCount > 0 ? (
            <button
              type="button"
              data-testid="customer-notifications-center-mark-all-read"
              disabled={bulkMarking}
              onClick={() => onMarkAllRead?.()}
              className="rounded-xl border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-300/20 disabled:opacity-50"
            >
              {bulkMarking ? "Saving..." : "Mark all as read"}
            </button>
          ) : null}
        </div>
      </div>
      <div data-testid="customer-notification-cleanup-settings" className="mt-5 rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-sm font-bold text-white">Notification cleanup</h3>
            <p className="mt-1 text-sm leading-6 text-slate-300">
              Unread and action-required notifications are never auto-archived.
            </p>
            <div className="mt-2 text-xs text-slate-400">
              Last cleanup: {preferences?.last_auto_archive_run_at ? new Date(preferences.last_auto_archive_run_at).toLocaleString() : "Not run yet"}
              <span className="mx-2 text-slate-600">|</span>
              Next scheduled: {preferences?.next_auto_archive_run_at ? new Date(preferences.next_auto_archive_run_at).toLocaleString() : "Not scheduled yet"}
            </div>
          </div>
          <label className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-200">
            <input
              type="checkbox"
              data-testid="notification-cleanup-enabled"
              checked={settings.auto_archive_enabled}
              onChange={(event) => setSettings((prev) => ({ ...prev, auto_archive_enabled: event.target.checked }))}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-amber-300"
            />
            Enable auto-archive old read notifications
          </label>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm font-medium text-slate-200">
            Frequency
            <select
              data-testid="notification-cleanup-frequency"
              value={settings.auto_archive_frequency}
              onChange={(event) => setSettings((prev) => ({ ...prev, auto_archive_frequency: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label className="text-sm font-medium text-slate-200">
            Read informational after
            <input
              type="number"
              min="7"
              data-testid="notification-cleanup-read-days"
              value={settings.auto_archive_read_after_days}
              onChange={(event) => setSettings((prev) => ({ ...prev, auto_archive_read_after_days: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-sm font-medium text-slate-200">
            Resolved maintenance after
            <input
              type="number"
              min="14"
              data-testid="notification-cleanup-maintenance-days"
              value={settings.auto_archive_maintenance_after_days}
              onChange={(event) => setSettings((prev) => ({ ...prev, auto_archive_maintenance_after_days: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-sm font-medium text-slate-200">
            Completed work after
            <input
              type="number"
              min="30"
              data-testid="notification-cleanup-completed-days"
              value={settings.auto_archive_completed_work_after_days}
              onChange={(event) => setSettings((prev) => ({ ...prev, auto_archive_completed_work_after_days: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </label>
        </div>
        {preferenceError ? <p data-testid="notification-cleanup-error" className="mt-3 text-sm font-semibold text-rose-200">{preferenceError}</p> : null}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            data-testid="notification-cleanup-save"
            disabled={savingPreferences}
            onClick={() => onSavePreferences?.(settings)}
            className="rounded-xl border border-amber-300/45 bg-amber-300/15 px-4 py-2 text-sm font-bold text-amber-100 hover:bg-amber-300/25 disabled:opacity-50"
          >
            {savingPreferences ? "Saving..." : "Save cleanup settings"}
          </button>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {["unread", "recent", "archived"].map((value) => (
          <button
            key={value}
            type="button"
            data-testid={`customer-notifications-filter-${value}`}
            onClick={() => setFilter(value)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${
              filter === value
                ? "border-amber-300/55 bg-amber-300/15 text-amber-100"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
            }`}
          >
            {value === "unread" ? "Unread" : value === "archived" ? "Archived" : "Recent"}
          </button>
        ))}
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {filtered.length ? (
          filtered.map((notification) => {
            const isArchived = isArchivedNotification(notification);
            const isUnread = isUnreadNotification(notification);
            return (
              <article key={notification.id} data-testid={`customer-notifications-center-item-${notification.id}`} className={`rounded-2xl border p-4 ${isUnread ? "border-amber-300/45 bg-amber-300/10" : isArchived ? "border-slate-800 bg-slate-950/70 opacity-85" : "border-slate-700 bg-slate-900/70"}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">{notification.title || "Update"}</h3>
                      <Badge>{eventLabel(notification.event_type)}</Badge>
                      {isUnread ? <Badge tone="gold">Unread</Badge> : null}
                      {isArchived ? <Badge>Archived</Badge> : null}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{notification.message || "A workspace update is available."}</p>
                    <div className="mt-2 text-xs text-slate-500">{notification.created_at ? new Date(notification.created_at).toLocaleString() : "No date"}</div>
                    {notification.action_url ? (
                      <a
                        href={notification.action_url}
                        onClick={() => {
                          if (isUnread) onMarkRead?.(notification);
                        }}
                        className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-amber-100 hover:text-amber-50"
                      >
                        Open related item
                        <ExternalLink size={14} />
                      </a>
                    ) : null}
                  </div>
                  {isUnread ? (
                    <button
                      type="button"
                      data-testid={`customer-notifications-center-mark-read-${notification.id}`}
                      disabled={markingId === String(notification.id)}
                      onClick={() => onMarkRead?.(notification)}
                      className="shrink-0 rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-amber-300/50 hover:text-white disabled:opacity-50"
                    >
                      {markingId === String(notification.id) ? "Saving..." : "Mark as read"}
                    </button>
                  ) : null}
                  {isArchived ? (
                    <button
                      type="button"
                      data-testid={`customer-notifications-center-restore-${notification.id}`}
                      disabled={restoringId === String(notification.id)}
                      onClick={() => onRestore?.(notification)}
                      className="shrink-0 rounded-xl border border-sky-300/35 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-100 hover:bg-sky-400/20 disabled:opacity-50"
                    >
                      {restoringId === String(notification.id) ? "Saving..." : "Move to recent"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid={`customer-notifications-center-archive-${notification.id}`}
                      disabled={archivingId === String(notification.id)}
                      onClick={() => onArchive?.(notification)}
                      className="shrink-0 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-50"
                    >
                      {archivingId === String(notification.id) ? "Saving..." : "Archive"}
                    </button>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <EmptyState title={filter === "unread" ? "No unread notifications" : filter === "archived" ? "No archived notifications" : "No recent notifications"} testId="customer-notifications-center-empty">
            Project activity, payment reviews, signing reminders, document updates, and request history will appear here.
          </EmptyState>
        )}
      </div>
    </section>
  );
}

function eventLabel(eventType = "") {
  return String(eventType || "notification").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function notificationDedupeKey(notification) {
  const createdAt = notification?.created_at ? new Date(notification.created_at).getTime() : 0;
  const bucket = Number.isFinite(createdAt) ? Math.floor(createdAt / (10 * 60 * 1000)) : 0;
  return [
    notification?.event_type || "",
    notification?.action_url || "",
    String(notification?.title || "").toLowerCase(),
    String(notification?.message || "").toLowerCase(),
    bucket,
  ].join("|");
}

function normalizePortalNotifications(rows = []) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter((notification) => {
    if (notification?.channel && notification.channel !== "in_app") return false;
    const key = notificationDedupeKey(notification);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function NotificationPanel({ notifications = [], unreadCount = 0, markingId = "", bulkMarking = false, onMarkRead, onMarkAllRead, onOpenHistory }) {
  const unreadNotifications = notifications
    .filter(isUnreadNotification)
    .sort((a, b) => {
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    })
    .slice(0, 4);

  return (
    <section data-testid="customer-notifications-panel" className="mt-5 rounded-2xl border border-slate-700 bg-slate-950/70 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bell size={18} className="text-sky-200" />
            <h2 className="text-lg font-semibold text-white">Recent Updates</h2>
          </div>
          <p className="mt-1 text-sm text-slate-300">New notifications that may need your attention.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span data-testid="customer-notifications-unread-count" className="inline-flex w-fit rounded-full border border-sky-300/35 bg-sky-400/10 px-3 py-1 text-xs font-semibold text-sky-100 shadow-[0_0_16px_rgba(56,189,248,0.12)]">
            {unreadCount > 0 ? `${unreadCount} unread` : "No new notifications"}
          </span>
          {unreadCount > 0 ? (
            <button
              type="button"
              data-testid="customer-notifications-mark-all-read"
              disabled={bulkMarking}
              onClick={() => onMarkAllRead?.()}
              className="rounded-xl border border-sky-300/35 bg-sky-400/10 px-3 py-1.5 text-xs font-semibold text-sky-100 hover:bg-sky-400/20"
            >
              {bulkMarking ? "Saving..." : "Mark all as read"}
            </button>
          ) : null}
          <button
            type="button"
            data-testid="customer-notifications-open-history"
            onClick={() => onOpenHistory?.()}
            className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-sky-300/50 hover:text-white"
          >
            View all
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {unreadNotifications.length ? (
          unreadNotifications.map((notification) => {
            return (
              <article
                key={notification.id}
                data-testid={`customer-notification-${notification.id}`}
                className="rounded-xl border border-sky-300/45 bg-sky-400/10 p-4 shadow-[inset_3px_0_0_rgba(56,189,248,0.55)]"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">{notification.title || "Update"}</h3>
                      <span className="rounded-full border border-slate-600 bg-slate-950/70 px-2 py-0.5 text-[11px] font-semibold text-slate-300">
                        {eventLabel(notification.event_type)}
                      </span>
                      <span className="rounded-full border border-sky-300/40 bg-sky-400/15 px-2 py-0.5 text-[11px] font-semibold text-sky-100">
                        Unread
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-5 text-slate-300">{notification.message || "A workspace update is available."}</p>
                    <div className="mt-2 text-xs text-slate-500">
                      {notification.created_at ? new Date(notification.created_at).toLocaleString() : "No date"}
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid={`customer-notification-mark-read-${notification.id}`}
                    disabled={markingId === String(notification.id)}
                    onClick={() => onMarkRead?.(notification)}
                    className="shrink-0 rounded-lg border border-slate-600 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-sky-300/50 hover:text-white disabled:opacity-50"
                  >
                    {markingId === String(notification.id) ? "Saving..." : "Mark as read"}
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <div className="lg:col-span-2">
            <EmptyState title="No new notifications" testId="customer-notifications-empty">
              Open Notifications for the full activity history whenever you need it.
            </EmptyState>
          </div>
        )}
      </div>
    </section>
  );
}

const PM_TEAM_ROLES = [
  ["admin", "Admin"],
  ["manager", "Manager"],
  ["maintenance_coordinator", "Maintenance Coordinator"],
  ["accounting", "Accounting"],
  ["viewer", "Viewer"],
];

const PM_TEAM_STATUSES = [
  ["invited", "Invited"],
  ["active", "Active"],
  ["disabled", "Disabled"],
];

const PM_VENDOR_STATUSES = [
  ["active", "Active"],
  ["inactive", "Inactive"],
];

const emptyTeamMemberForm = {
  name: "",
  email: "",
  phone: "",
  role: "viewer",
  status: "invited",
};

const emptyVendorForm = {
  name: "",
  trade_category: "",
  email: "",
  phone: "",
  website: "",
  notes: "",
  status: "active",
};

function roleLabel(value) {
  return PM_TEAM_ROLES.find(([key]) => key === value)?.[1] || value || "Viewer";
}

function statusLabel(value) {
  return PM_TEAM_STATUSES.find(([key]) => key === value)?.[1] || value || "Invited";
}

function vendorStatusLabel(value) {
  return PM_VENDOR_STATUSES.find(([key]) => key === value)?.[1] || value || "Active";
}

function TeamMemberModal({ mode = "add", member = null, saving = false, onClose, onSubmit }) {
  const [form, setForm] = useState(() => ({
    ...emptyTeamMemberForm,
    ...(member || {}),
    role: member?.role || "viewer",
    status: member?.status || "invited",
  }));

  useEffect(() => {
    setForm({
      ...emptyTeamMemberForm,
      ...(member || {}),
      role: member?.role || "viewer",
      status: member?.status || "invited",
    });
  }, [member]);

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const isEdit = mode === "edit";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6">
      <form
        data-testid={isEdit ? "pm-team-edit-modal" : "pm-team-add-modal"}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.(form);
        }}
        className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Team Members</div>
            <h3 className="mt-1 text-lg font-semibold text-white">{isEdit ? "Edit Team Member" : "Add Team Member"}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500"
          >
            Close
          </button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-200">
            Name
            <input
              data-testid="pm-team-member-name"
              value={form.name || ""}
              onChange={(event) => update("name", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Email
            <input
              data-testid="pm-team-member-email"
              type="email"
              required={!isEdit}
              readOnly={isEdit}
              value={form.email || ""}
              onChange={(event) => update("email", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400 read-only:bg-slate-900/60 read-only:text-slate-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Phone
            <input
              data-testid="pm-team-member-phone"
              value={form.phone || ""}
              onChange={(event) => update("phone", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Role
            <select
              data-testid="pm-team-member-role"
              value={form.role || "viewer"}
              onChange={(event) => update("role", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            >
              {PM_TEAM_ROLES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          {isEdit ? (
            <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
              Status
              <select
                data-testid="pm-team-member-status"
                value={form.status || "invited"}
                onChange={(event) => update("status", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
              >
                {PM_TEAM_STATUSES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-500"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            data-testid={isEdit ? "pm-team-save-edit" : "pm-team-save-add"}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
          >
            {saving ? "Saving..." : isEdit ? "Save changes" : "Add Team Member"}
          </button>
        </div>
      </form>
    </div>
  );
}

function VendorModal({ mode = "add", vendor = null, saving = false, token = "", onClose, onSubmit, onImportVendor }) {
  const [form, setForm] = useState(() => ({
    ...emptyVendorForm,
    ...(vendor || {}),
    status: vendor?.status || "active",
  }));
  const [activeSource, setActiveSource] = useState("myhomebro_contractor");
  const [searchForm, setSearchForm] = useState({ trade_category: "", location: "", search: "", radius_miles: "25" });
  const [contractorResults, setContractorResults] = useState([]);
  const [businessResults, setBusinessResults] = useState([]);
  const [searchMeta, setSearchMeta] = useState({});
  const [searching, setSearching] = useState(false);
  const [importingKey, setImportingKey] = useState("");

  useEffect(() => {
    setForm({
      ...emptyVendorForm,
      ...(vendor || {}),
      status: vendor?.status || "active",
    });
  }, [vendor]);

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const updateSearch = (field, value) => setSearchForm((prev) => ({ ...prev, [field]: value }));
  const isEdit = mode === "edit";
  const isManual = isEdit || activeSource === "manual";

  async function runVendorSearch(source = activeSource) {
    if (!token || source === "manual") return;
    setSearching(true);
    try {
      const params = new URLSearchParams();
      Object.entries(searchForm).forEach(([key, value]) => {
        if (String(value || "").trim()) params.set(key, value);
      });
      const path =
        source === "local_business"
          ? `/projects/customer-portal/${encodeURIComponent(token)}/vendor-search/businesses/`
          : `/projects/customer-portal/${encodeURIComponent(token)}/vendor-search/contractors/`;
      const { data } = await api.get(`${path}?${params.toString()}`);
      if (source === "local_business") {
        setBusinessResults(Array.isArray(data?.results) ? data.results : []);
      } else {
        setContractorResults(Array.isArray(data?.results) ? data.results : []);
      }
      setSearchMeta((prev) => ({ ...prev, [source]: data || {} }));
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not search vendors.");
    } finally {
      setSearching(false);
    }
  }

  async function importVendor(payload, key) {
    setImportingKey(key);
    try {
      await onImportVendor?.(payload);
      onClose?.();
    } finally {
      setImportingKey("");
    }
  }

  const manualForm = (
    <>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-200">
          Vendor Name
          <input
            data-testid="pm-vendor-name"
            required
            value={form.name || ""}
            onChange={(event) => update("name", event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
          />
        </label>
        <label className="block text-sm font-medium text-slate-200">
          Trade
          <input
            data-testid="pm-vendor-trade"
            value={form.trade_category || ""}
            onChange={(event) => update("trade_category", event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
          />
        </label>
        <label className="block text-sm font-medium text-slate-200">
          Email
          <input
            data-testid="pm-vendor-email"
            type="email"
            value={form.email || ""}
            onChange={(event) => update("email", event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
          />
        </label>
        <label className="block text-sm font-medium text-slate-200">
          Phone
          <input
            data-testid="pm-vendor-phone"
            value={form.phone || ""}
            onChange={(event) => update("phone", event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
          />
        </label>
        <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
          Website
          <input
            data-testid="pm-vendor-website"
            value={form.website || ""}
            onChange={(event) => update("website", event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
          />
        </label>
        <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
          Notes
          <textarea
            data-testid="pm-vendor-notes"
            rows={3}
            value={form.notes || ""}
            onChange={(event) => update("notes", event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
          />
        </label>
        {isEdit ? (
          <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
            Status
            <select
              data-testid="pm-vendor-status"
              value={form.status || "active"}
              onChange={(event) => update("status", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            >
              {PM_VENDOR_STATUSES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-500"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !form.name?.trim()}
          data-testid={isEdit ? "pm-vendor-save-edit" : "pm-vendor-save-add"}
          className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
        >
          {saving ? "Saving..." : isEdit ? "Save changes" : "Add Vendor"}
        </button>
      </div>
    </>
  );

  const results = activeSource === "local_business" ? businessResults : contractorResults;
  const activeSearchMeta = searchMeta[activeSource] || {};
  const searchDisplayLocation = activeSearchMeta.display_location || searchForm.location || "the selected area";
  const searchRadius = activeSearchMeta.radius_miles || searchForm.radius_miles || 25;
  const localBusinessGeocodeFailed = Boolean(
    activeSource === "local_business" &&
      activeSearchMeta?.diagnostics?.geocode_error &&
      activeSearchMeta?.diagnostics?.geocode_error !== "google_geocode_api_key_missing" &&
      !activeSearchMeta?.diagnostics?.geocoded
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6">
      <form
        data-testid={isEdit ? "pm-vendor-edit-modal" : "pm-vendor-add-modal"}
        onSubmit={(event) => {
          event.preventDefault();
          if (isManual) onSubmit?.(form);
        }}
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Vendors</div>
            <h3 className="mt-1 text-lg font-semibold text-white">{isEdit ? "Edit Vendor" : "Add Vendor"}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500"
          >
            Close
          </button>
        </div>
        {!isEdit ? (
          <div className="mt-5 grid gap-2 sm:grid-cols-3" role="tablist" aria-label="Vendor add options">
            {[
              ["myhomebro_contractor", "MyHomeBro Contractors"],
              ["local_business", "Local Businesses"],
              ["manual", "Manual Entry"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                data-testid={`pm-vendor-source-${value}`}
                onClick={() => setActiveSource(value)}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
                  activeSource === value
                    ? "border-amber-300/60 bg-amber-300/15 text-amber-100"
                    : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {isManual ? manualForm : (
          <div className="mt-5 space-y-4" data-testid={`pm-vendor-search-${activeSource}`}>
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="block text-sm font-medium text-slate-200">
                Trade
                <input
                  data-testid="pm-vendor-search-trade"
                  value={searchForm.trade_category}
                  onChange={(event) => updateSearch("trade_category", event.target.value)}
                  placeholder="Plumbing"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Location
                <input
                  data-testid="pm-vendor-search-location"
                  value={searchForm.location}
                  onChange={(event) => updateSearch("location", event.target.value)}
                  placeholder="San Antonio, TX"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Search
                <input
                  data-testid="pm-vendor-search-text"
                  value={searchForm.search}
                  onChange={(event) => updateSearch("search", event.target.value)}
                  placeholder="Company name"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Radius
                <select
                  data-testid="pm-vendor-search-radius"
                  value={searchForm.radius_miles}
                  onChange={(event) => updateSearch("radius_miles", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                >
                  {SEARCH_RADIUS_OPTIONS.map((radius) => (
                    <option key={radius} value={String(radius)}>{radius} miles</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-slate-400">
                {activeSource === "local_business"
                  ? "Search local businesses and import them as preferred vendors without creating contractor accounts."
                  : "Search existing MyHomeBro contractor profiles and import them as preferred vendors."}
              </p>
              <button
                type="button"
                data-testid={`pm-vendor-run-search-${activeSource}`}
                onClick={() => runVendorSearch(activeSource)}
                disabled={searching}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
              >
                {searching ? "Searching..." : "Search"}
              </button>
            </div>
            <div className="space-y-2" data-testid={`pm-vendor-results-${activeSource}`}>
              <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-3 text-xs font-semibold text-slate-300">
                {results.length} {activeSource === "local_business" ? "local business" : "MyHomeBro contractor"}{results.length === 1 ? "" : activeSource === "local_business" ? "es" : "s"} within {searchRadius} miles{activeSource === "local_business" ? ` of ${searchDisplayLocation}` : ""}
                {results.length <= 1 ? <span className="ml-2 font-normal text-slate-400">Try increasing the radius to 50 or 100 miles.</span> : null}
                {localBusinessGeocodeFailed ? (
                  <div className="mt-1 font-semibold text-amber-100">
                    We could not verify that location. Try city/state or a ZIP code.
                  </div>
                ) : null}
              </div>
              {results.length ? results.map((row) => {
                const key = activeSource === "local_business" ? row.business_id : row.contractor_id;
                const name = row.business_name || row.name || "Vendor";
                return (
                  <article key={`${activeSource}-${key}-${name}`} className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-white">{name}</div>
                          {activeSource === "local_business" ? (
                            <span className="rounded-full border border-slate-600 bg-slate-950 px-2 py-0.5 text-[11px] font-semibold text-slate-200">Local Business</span>
                          ) : (
                            <span className="rounded-full border border-emerald-300/40 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                              {row.verification_status_label || "MyHomeBro Contractor"}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 grid gap-1 text-xs text-slate-400 sm:grid-cols-2">
                          <div>{row.primary_trade || row.trade_category || row.trade_categories?.join?.(", ") || "General"}</div>
                          <div>{row.location || "No location"}</div>
                          <div>{row.phone || "No phone"}</div>
                          <div>{row.website || "No website"}</div>
                          {row.rating ? <div>Rating: {row.rating}</div> : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid={`pm-vendor-import-${activeSource}-${key}`}
                        disabled={saving || importingKey === String(key)}
                        onClick={() =>
                          importVendor(
                            activeSource === "local_business"
                              ? {
                                  import_type: "local_business",
                                  business_id: row.business_id,
                                  name,
                                  trade_category: row.trade_category || row.primary_trade || "",
                                  phone: row.phone || "",
                                  website: row.website || "",
                                  address: row.address || "",
                                  city: row.city || "",
                                  state: row.state || "",
                                  rating: row.rating || undefined,
                                  source_metadata: row.source_metadata || row,
                                }
                              : {
                                  import_type: "myhomebro_contractor",
                                  contractor_id: row.contractor_id,
                                  name,
                                  trade_category: row.primary_trade || row.trade_categories?.[0] || "",
                                  phone: row.phone || "",
                                  website: row.website || "",
                                  source_metadata: row,
                                },
                            String(key)
                          )
                        }
                        className="rounded-xl bg-amber-300 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-200 disabled:opacity-50"
                      >
                        {importingKey === String(key) ? "Importing..." : "Import Vendor"}
                      </button>
                    </div>
                  </article>
                );
              }) : (
                <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-3 text-sm text-slate-400">
                  Search for vendors to import, or use Manual Entry as a fallback.
                </div>
              )}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}

function AccountPanel({ portal, token = "", saving = false, teamSaving = false, vendorSaving = false, onSave, onAddTeamMember, onEditTeamMember, onDisableTeamMember, onAddVendor, onImportVendor, onEditVendor, onDisableVendor }) {
  const customer = portal?.customer || {};
  const account = portal?.account || {};
  const accountType = customer.account_type || account.account_type || "individual";
  const linkedProperties = Array.isArray(portal?.property_profiles)
    ? portal.property_profiles
    : portal?.property_profile?.id
      ? [portal.property_profile]
      : [];
  const profileForm = {
    full_name: customer.full_name || customer.name || "",
    phone_number: customer.phone_number || "",
    account_type: accountType,
    address_line1: customer.address_line1 || "",
    address_line2: customer.address_line2 || "",
    city: customer.city || "",
    state: customer.state || "",
    postal_code: customer.postal_code || "",
    company_name: customer.company_name || account.company_name || "",
    company_phone: customer.company_phone || account.company_phone || "",
    company_email: customer.company_email || account.company_email || "",
    company_website: customer.company_website || account.company_website || "",
    company_street: customer.company_street || account.company_street || "",
    company_unit: customer.company_unit || account.company_unit || "",
    company_city: customer.company_city || account.company_city || "",
    company_state: customer.company_state || account.company_state || "",
    company_zip: customer.company_zip || account.company_zip || "",
    company_license_number: customer.company_license_number || account.company_license_number || "",
    company_notes: customer.company_notes || account.company_notes || "",
  };
  const [form, setForm] = useState(profileForm);
  const [teamModalMode, setTeamModalMode] = useState("");
  const [editingTeamMember, setEditingTeamMember] = useState(null);
  const [vendorModalMode, setVendorModalMode] = useState("");
  const [editingVendor, setEditingVendor] = useState(null);

  useEffect(() => {
    setForm(profileForm);
  }, [
    customer.full_name,
    customer.name,
    customer.phone_number,
    customer.account_type,
    customer.address_line1,
    customer.address_line2,
    customer.city,
    customer.state,
    customer.postal_code,
    customer.company_name,
    customer.company_phone,
    customer.company_email,
    customer.company_website,
    customer.company_street,
    customer.company_unit,
    customer.company_city,
    customer.company_state,
    customer.company_zip,
    customer.company_license_number,
    customer.company_notes,
    account.account_type,
    account.company_name,
    account.company_phone,
    account.company_email,
    account.company_website,
    account.company_street,
    account.company_unit,
    account.company_city,
    account.company_state,
    account.company_zip,
    account.company_license_number,
    account.company_notes,
  ]);

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const isCompanyAccount = form.account_type === "property_management_company";
  const canManageVendors = Boolean(
    isCompanyAccount ||
      account.has_rental_properties ||
      linkedProperties.some((property) => property?.is_rental_property)
  );
  const teamMembers = Array.isArray(account.team_members) ? account.team_members : [];
  const vendors = Array.isArray(account.vendors) ? account.vendors : [];

  return (
    <section data-testid="customer-account-panel" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      {teamModalMode ? (
        <TeamMemberModal
          mode={teamModalMode}
          member={editingTeamMember}
          saving={teamSaving}
          onClose={() => {
            setTeamModalMode("");
            setEditingTeamMember(null);
          }}
          onSubmit={async (payload) => {
            if (teamModalMode === "edit" && editingTeamMember) {
              await onEditTeamMember?.(editingTeamMember, payload);
            } else {
              await onAddTeamMember?.(payload);
            }
            setTeamModalMode("");
            setEditingTeamMember(null);
          }}
        />
      ) : null}
      {vendorModalMode ? (
        <VendorModal
          mode={vendorModalMode}
          vendor={editingVendor}
          saving={vendorSaving}
          token={token}
          onClose={() => {
            setVendorModalMode("");
            setEditingVendor(null);
          }}
          onSubmit={async (payload) => {
            if (vendorModalMode === "edit" && editingVendor) {
              await onEditVendor?.(editingVendor, payload);
            } else {
              await onAddVendor?.(payload);
            }
            setVendorModalMode("");
            setEditingVendor(null);
          }}
          onImportVendor={onImportVendor}
        />
      ) : null}
      <form
        data-testid="customer-profile-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave?.(form);
        }}
        className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5"
      >
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Account</div>
        <h2 className="mt-1 text-xl font-semibold text-white">My Profile</h2>
        <p className="mt-1 text-sm leading-6 text-slate-300">
          Keep your contact details current so project updates, payment notices, and property records stay connected to you.
        </p>

        <div className="mt-5 rounded-xl border border-slate-700 bg-slate-900/70 p-3" data-testid="customer-account-type-section">
          <div className="text-sm font-semibold text-white">Account Type</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Account Type">
            {[
              ["individual", "Individual / Homeowner"],
              ["property_management_company", "Property Management Company"],
            ].map(([value, label]) => (
              <label
                key={value}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${
                  form.account_type === value
                    ? "border-amber-300/60 bg-amber-300/15 text-amber-100"
                    : "border-slate-700 bg-slate-950/70 text-slate-300 hover:border-slate-500"
                }`}
              >
                <input
                  type="radio"
                  name="customer-account-type"
                  value={value}
                  checked={form.account_type === value}
                  onChange={(event) => update("account_type", event.target.value)}
                  className="h-4 w-4 border-slate-600 bg-slate-950"
                  data-testid={`customer-account-type-${value}`}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-200">
            Name
            <input
              data-testid="customer-profile-name"
              value={form.full_name}
              onChange={(event) => update("full_name", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Email
            <input
              data-testid="customer-profile-email"
              value={customer.email || account.email || ""}
              readOnly
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-300 outline-none"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Phone number
            <input
              data-testid="customer-profile-phone"
              value={form.phone_number}
              onChange={(event) => update("phone_number", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
            Mailing address search
            <div className="mt-1">
              <AddressAutocomplete
                value={form.address_line1}
                onChangeText={(value) => update("address_line1", value)}
                onSelect={(address) => {
                  setForm((prev) => ({
                    ...prev,
                    address_line1: address.line1 || prev.address_line1,
                    address_line2: address.line2 || "",
                    city: address.city || prev.city,
                    state: address.state || prev.state,
                    postal_code: address.postal_code || prev.postal_code,
                  }));
                }}
                placeholder="Search your mailing address..."
                testId="customer-profile-address-autocomplete"
                {...PORTAL_ADDRESS_AUTOCOMPLETE_CLASSES}
              />
            </div>
          </label>
          <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
            Mailing street
            <input
              data-testid="customer-profile-address-line1"
              value={form.address_line1}
              onChange={(event) => update("address_line1", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
            Unit / suite
            <input
              value={form.address_line2}
              onChange={(event) => update("address_line2", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            City
            <input
              value={form.city}
              onChange={(event) => update("city", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            State
            <input
              value={form.state}
              onChange={(event) => update("state", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            ZIP
            <input
              value={form.postal_code}
              onChange={(event) => update("postal_code", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
        </div>

        {canManageVendors ? (
          <div className="mt-4 space-y-4">
            {isCompanyAccount ? (
              <>
            <div data-testid="customer-company-profile-section" className="rounded-xl border border-amber-300/25 bg-slate-900/55 p-4">
              <h3 className="text-base font-semibold text-white">Company Profile</h3>
              <p className="mt-1 text-xs leading-5 text-slate-300">
                Use this for property management companies that manage multiple properties, owners, tenants, and maintenance requests.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-200">
                Company name
                <input
                  data-testid="customer-company-name"
                  value={form.company_name}
                  onChange={(event) => update("company_name", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Company phone
                <input
                  data-testid="customer-company-phone"
                  value={form.company_phone}
                  onChange={(event) => update("company_phone", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Company email
                <input
                  data-testid="customer-company-email"
                  value={form.company_email}
                  onChange={(event) => update("company_email", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Website
                <input
                  data-testid="customer-company-website"
                  value={form.company_website}
                  onChange={(event) => update("company_website", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
              <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
                Company mailing address search
                <div className="mt-1">
                  <AddressAutocomplete
                    value={form.company_street}
                    onChangeText={(value) => update("company_street", value)}
                    onSelect={(address) => {
                      setForm((prev) => ({
                        ...prev,
                        company_street: address.line1 || prev.company_street,
                        company_unit: address.line2 || "",
                        company_city: address.city || prev.company_city,
                        company_state: address.state || prev.company_state,
                        company_zip: address.postal_code || prev.company_zip,
                      }));
                    }}
                    placeholder="Search company mailing address..."
                    testId="customer-company-address-autocomplete"
                    {...PORTAL_ADDRESS_AUTOCOMPLETE_CLASSES}
                  />
                </div>
              </label>
              <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
                Street
                <input
                  data-testid="customer-company-street"
                  value={form.company_street}
                  onChange={(event) => update("company_street", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Unit / suite
                <input
                  value={form.company_unit}
                  onChange={(event) => update("company_unit", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                City
                <input
                  value={form.company_city}
                  onChange={(event) => update("company_city", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                State
                <input
                  value={form.company_state}
                  onChange={(event) => update("company_state", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                ZIP
                <input
                  value={form.company_zip}
                  onChange={(event) => update("company_zip", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                License number
                <input
                  data-testid="customer-company-license-number"
                  value={form.company_license_number}
                  onChange={(event) => update("company_license_number", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
              <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
                Notes
                <textarea
                  rows={3}
                  data-testid="customer-company-notes"
                  value={form.company_notes}
                  onChange={(event) => update("company_notes", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
              </div>
            </div>

            <div data-testid="pm-team-members-section" className="rounded-xl border border-sky-300/25 bg-slate-900/55 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white">Team Members</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-300">
                    Team members help manage properties, maintenance requests, tenants, vendors, and operations.
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="pm-team-add-button"
                  onClick={() => {
                    setEditingTeamMember(null);
                    setTeamModalMode("add");
                  }}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-sky-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
                >
                  <Users size={16} />
                  Add Team Member
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {teamMembers.length ? teamMembers.map((member) => (
                  <article
                    key={member.id || member.email}
                    data-testid={`pm-team-member-${member.id}`}
                    className="rounded-xl border border-slate-700 bg-slate-950/70 p-3"
                  >
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-white">{member.name || member.email || "Team Member"}</div>
                          <span className="rounded-full border border-slate-600 bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-slate-200">
                            {member.role_label || roleLabel(member.role)}
                          </span>
                          <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
                            {member.status_label || statusLabel(member.status)}
                          </span>
                        </div>
                        <div className="mt-2 grid gap-1 text-xs text-slate-400 sm:grid-cols-2">
                          <div>{member.email || "No email"}</div>
                          <div>{member.phone || "No phone"}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          data-testid={`pm-team-edit-${member.id}`}
                          onClick={() => {
                            setEditingTeamMember(member);
                            setTeamModalMode("edit");
                          }}
                          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-sky-300/50 hover:text-white"
                        >
                          <Pencil size={13} />
                          Edit
                        </button>
                        {member.status !== "disabled" ? (
                          <button
                            type="button"
                            data-testid={`pm-team-disable-${member.id}`}
                            onClick={() => onDisableTeamMember?.(member)}
                            className="min-h-9 rounded-lg border border-rose-300/40 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-400/10"
                          >
                            Disable
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </article>
                )) : (
                  <div data-testid="pm-team-members-empty" className="rounded-xl border border-dashed border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-400">
                    Add team members who help manage company operations.
                  </div>
                )}
              </div>
            </div>
              </>
            ) : null}

            <div data-testid="pm-vendors-section" className="rounded-xl border border-amber-300/25 bg-slate-900/55 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white">Vendors</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-300">
                    Track preferred vendors for maintenance work without requiring a MyHomeBro contractor account.
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="pm-vendor-add-button"
                  onClick={() => {
                    setEditingVendor(null);
                    setVendorModalMode("add");
                  }}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-amber-300 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-200"
                >
                  <Users size={16} />
                  Add Vendor
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {vendors.length ? vendors.map((vendor) => (
                  <article
                    key={vendor.id || vendor.name}
                    data-testid={`pm-vendor-${vendor.id}`}
                    className="rounded-xl border border-slate-700 bg-slate-950/70 p-3"
                  >
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-white">{vendor.name || "Vendor"}</div>
                          <span className="rounded-full border border-slate-600 bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-slate-200">
                            {vendor.trade_category || "General"}
                          </span>
                          <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
                            {vendor.status_label || vendorStatusLabel(vendor.status)}
                          </span>
                          <span className="rounded-full border border-sky-300/35 bg-sky-400/10 px-2 py-0.5 text-[11px] font-semibold text-sky-100">
                            {vendor.vendor_source_label || "Manual Vendor"}
                          </span>
                        </div>
                        <div className="mt-2 grid gap-1 text-xs text-slate-400 sm:grid-cols-2">
                          <div>{vendor.email || "No email"}</div>
                          <div>{vendor.phone || "No phone"}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          data-testid={`pm-vendor-edit-${vendor.id}`}
                          onClick={() => {
                            setEditingVendor(vendor);
                            setVendorModalMode("edit");
                          }}
                          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-sky-300/50 hover:text-white"
                        >
                          <Pencil size={13} />
                          Edit
                        </button>
                        {vendor.status !== "inactive" ? (
                          <button
                            type="button"
                            data-testid={`pm-vendor-disable-${vendor.id}`}
                            onClick={() => onDisableVendor?.(vendor)}
                            className="min-h-9 rounded-lg border border-rose-300/40 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-400/10"
                          >
                            Disable
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </article>
                )) : (
                  <div data-testid="pm-vendors-empty" className="rounded-xl border border-dashed border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-400">
                    Add preferred vendors for recurring maintenance and repairs.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={saving}
          className="mt-5 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save profile"}
        </button>
      </form>

      <aside className="space-y-4">
        <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
          <h3 className="text-lg font-semibold text-white">Linked Properties</h3>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            These properties are connected to this Customer Portal and can be used for requests, records, and project history.
          </p>
          <div className="mt-4 space-y-2" data-testid="customer-account-linked-properties">
            {linkedProperties.length ? linkedProperties.slice(0, 4).map((property) => (
              <div key={property.id || property.address || property.display_name} className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
                <div className="text-sm font-semibold text-white">{property.display_name || property.address || "Property"}</div>
                {property.address ? <div className="mt-1 text-xs text-slate-400">{property.address}</div> : null}
                {property.is_primary ? <div className="mt-2 text-xs font-semibold text-amber-100">Primary Property</div> : null}
              </div>
            )) : (
              <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-3 text-sm text-slate-400">
                Add property details in the Property tab to connect records and future requests.
              </div>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
          <h3 className="text-lg font-semibold text-white">Password</h3>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {account.has_usable_password
              ? "Use password reset if you need to change your Customer Portal password."
              : "Create a password from your secure portal link for faster access next time."}
          </p>
          <a
            href="/portal"
            className="mt-4 inline-flex min-h-10 items-center justify-center rounded-xl border border-amber-300/45 bg-amber-300/15 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/25"
          >
            Password help
          </a>
        </div>
        <button
          type="button"
          data-testid="customer-account-logout"
          onClick={() => {
            clearAuth(false);
            window.location.assign("/portal");
          }}
          className="inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300/40 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/20"
        >
          <LogOut size={16} />
          Log out
        </button>
      </aside>
    </section>
  );
}

export default function CustomerDashboard({ portal, token, onPortalUpdate }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [creatingRequest, setCreatingRequest] = useState(false);
  const [savingProperty, setSavingProperty] = useState(false);
  const [savingUnit, setSavingUnit] = useState(false);
  const [savingTenant, setSavingTenant] = useState(false);
  const [savingHomeSystem, setSavingHomeSystem] = useState(false);
  const [uploadingPropertyFile, setUploadingPropertyFile] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [acceptingBidId, setAcceptingBidId] = useState("");
  const [markingNotificationId, setMarkingNotificationId] = useState("");
  const [markingAllNotifications, setMarkingAllNotifications] = useState(false);
  const [archivingNotificationId, setArchivingNotificationId] = useState("");
  const [restoringNotificationId, setRestoringNotificationId] = useState("");
  const [savingNotificationPreferences, setSavingNotificationPreferences] = useState(false);
  const [notificationPreferenceError, setNotificationPreferenceError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingTeamMember, setSavingTeamMember] = useState(false);
  const [savingVendor, setSavingVendor] = useState(false);
  const [focusedRequestId, setFocusedRequestId] = useState("");
  const [requestDraft, setRequestDraft] = useState(null);

  const customerName = portal?.customer?.name || "Customer";
  const notifications = normalizePortalNotifications(portal?.notifications || []);
  const unreadCount = notifications.filter(isUnreadNotification).length;
  const isPropertyManagementAccount = Boolean(
    portal?.account?.is_property_management_company ||
      portal?.account?.account_type === "property_management_company" ||
      portal?.customer?.account_type === "property_management_company"
  );
  const selectedPropertySupportsRentalMaintenance = Boolean(
    portal?.property_profile?.rental_tools_enabled || portal?.property_profile?.is_rental_property
  );
  const showMaintenanceTab = Boolean(isPropertyManagementAccount || selectedPropertySupportsRentalMaintenance);
  const visibleTabs = useMemo(() => customerPortalTabs(showMaintenanceTab), [showMaintenanceTab]);
  useEffect(() => {
    if (!visibleTabs.some(([key]) => key === activeTab)) {
      setActiveTab("overview");
    }
  }, [activeTab, visibleTabs]);
  const openRequestFromPropertyTimeline = useCallback((requestId) => {
    if (!requestId) return;
    setFocusedRequestId(String(requestId));
    setActiveTab("requests");
  }, []);

  const refreshPortal = async () => {
    if (!token) return;
    try {
      const { data } = await api.get(`/projects/customer-portal/${encodeURIComponent(token)}/`);
      onPortalUpdate?.(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not refresh your workspace.");
    }
  };

  const markNotificationRead = async (notification) => {
    if (!notification?.id) return;
    if (notification.status === "read") return;
    setMarkingNotificationId(String(notification.id));
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/notifications/${notification.id}/read/`
      );
      onPortalUpdate?.(data);
      toast.success("Update marked as read.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update that notification.");
    } finally {
      setMarkingNotificationId("");
    }
  };

  const markAllNotificationsRead = async () => {
    if (!token || unreadCount <= 0) return;
    setMarkingAllNotifications(true);
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/notifications/mark-all-read/`
      );
      onPortalUpdate?.(data);
      toast.success("Notifications marked as read.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update notifications.");
    } finally {
      setMarkingAllNotifications(false);
    }
  };

  const archiveNotification = async (notification) => {
    if (!notification?.id) return;
    setArchivingNotificationId(String(notification.id));
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/notifications/${notification.id}/archive/`
      );
      onPortalUpdate?.(data);
      toast.success("Notification archived.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not archive that notification.");
    } finally {
      setArchivingNotificationId("");
    }
  };

  const addTeamMember = async (payload) => {
    setSavingTeamMember(true);
    try {
      const { data } = await api.post(`/projects/customer-portal/${encodeURIComponent(token)}/team-members/`, payload);
      onPortalUpdate?.(data);
      toast.success("Team member added.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || error?.response?.data?.email?.[0] || "Could not add that team member.");
      throw error;
    } finally {
      setSavingTeamMember(false);
    }
  };

  const editTeamMember = async (member, payload) => {
    if (!member?.id) return;
    setSavingTeamMember(true);
    try {
      const { data } = await api.patch(`/projects/customer-portal/${encodeURIComponent(token)}/team-members/${member.id}/`, {
        name: payload.name,
        phone: payload.phone,
        role: payload.role,
        status: payload.status,
      });
      onPortalUpdate?.(data);
      toast.success("Team member updated.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update that team member.");
      throw error;
    } finally {
      setSavingTeamMember(false);
    }
  };

  const disableTeamMember = async (member) => {
    if (!member?.id) return;
    setSavingTeamMember(true);
    try {
      const { data } = await api.delete(`/projects/customer-portal/${encodeURIComponent(token)}/team-members/${member.id}/`);
      onPortalUpdate?.(data);
      toast.success("Team member disabled.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not disable that team member.");
    } finally {
      setSavingTeamMember(false);
    }
  };

  const addVendor = async (payload) => {
    setSavingVendor(true);
    try {
      const { data } = await api.post(`/projects/customer-portal/${encodeURIComponent(token)}/vendors/`, payload);
      onPortalUpdate?.(data);
      toast.success("Vendor added.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || error?.response?.data?.name?.[0] || "Could not add that vendor.");
      throw error;
    } finally {
      setSavingVendor(false);
    }
  };

  const importVendor = async (payload) => {
    setSavingVendor(true);
    try {
      const { data } = await api.post(`/projects/customer-portal/${encodeURIComponent(token)}/vendors/import/`, payload);
      onPortalUpdate?.(data);
      toast.success("Vendor imported.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || error?.response?.data?.name?.[0] || "Could not import that vendor.");
      throw error;
    } finally {
      setSavingVendor(false);
    }
  };

  const editVendor = async (vendor, payload) => {
    if (!vendor?.id) return;
    setSavingVendor(true);
    try {
      const { data } = await api.patch(`/projects/customer-portal/${encodeURIComponent(token)}/vendors/${vendor.id}/`, {
        name: payload.name,
        trade_category: payload.trade_category,
        email: payload.email,
        phone: payload.phone,
        website: payload.website,
        notes: payload.notes,
        status: payload.status,
      });
      onPortalUpdate?.(data);
      toast.success("Vendor updated.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update that vendor.");
      throw error;
    } finally {
      setSavingVendor(false);
    }
  };

  const disableVendor = async (vendor) => {
    if (!vendor?.id) return;
    setSavingVendor(true);
    try {
      const { data } = await api.delete(`/projects/customer-portal/${encodeURIComponent(token)}/vendors/${vendor.id}/`);
      onPortalUpdate?.(data);
      toast.success("Vendor disabled.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not disable that vendor.");
    } finally {
      setSavingVendor(false);
    }
  };

  const restoreNotification = async (notification) => {
    if (!notification?.id) return;
    setRestoringNotificationId(String(notification.id));
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/notifications/${notification.id}/restore/`
      );
      onPortalUpdate?.(data);
      toast.success("Notification moved to recent.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not restore that notification.");
    } finally {
      setRestoringNotificationId("");
    }
  };

  const saveNotificationCleanupPreferences = async (preferences) => {
    setNotificationPreferenceError("");
    const payload = {
      ...preferences,
      auto_archive_read_after_days: Number(preferences?.auto_archive_read_after_days || 0),
      auto_archive_maintenance_after_days: Number(preferences?.auto_archive_maintenance_after_days || 0),
      auto_archive_completed_work_after_days: Number(preferences?.auto_archive_completed_work_after_days || 0),
    };
    if (payload.auto_archive_read_after_days < 7) {
      setNotificationPreferenceError("Read informational notifications must be at least 7 days.");
      return;
    }
    if (payload.auto_archive_maintenance_after_days < 14) {
      setNotificationPreferenceError("Resolved maintenance reminders must be at least 14 days.");
      return;
    }
    if (payload.auto_archive_completed_work_after_days < 30) {
      setNotificationPreferenceError("Completed work notifications must be at least 30 days.");
      return;
    }

    setSavingNotificationPreferences(true);
    try {
      const { data } = await api.patch(
        `/projects/customer-portal/${encodeURIComponent(token)}/notifications/cleanup-preferences/`,
        payload
      );
      onPortalUpdate?.(data);
      toast.success("Notification cleanup settings saved.");
    } catch (error) {
      const detail = error?.response?.data?.detail;
      const message = typeof detail === "string" ? detail : "Could not save notification cleanup settings.";
      setNotificationPreferenceError(message);
      toast.error(message);
    } finally {
      setSavingNotificationPreferences(false);
    }
  };

  const uploadPropertyFile = async ({ file, title, documentType, kind }) => {
    if (!file) return false;
    setUploadError("");
    setUploadingPropertyFile(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title || file.name || "Property file");
      if (documentType) formData.append("document_type", documentType);
      const uploadKind = kind === "photo" ? "photos" : "documents";
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/property/${uploadKind}/`,
        formData
      );
      onPortalUpdate?.(data);
      toast.success(uploadKind === "photos" ? "Photo uploaded." : "Document uploaded.");
      return true;
    } catch (error) {
      const message = error?.response?.data?.detail || "Could not upload that file.";
      setUploadError(message);
      toast.error(message);
      return false;
    } finally {
      setUploadingPropertyFile(false);
    }
  };

  const createPropertyUnit = async (propertyId, payload) => {
    if (!propertyId) return false;
    setSavingUnit(true);
    try {
      const { data } = await api.post(`/projects/customer-portal/${encodeURIComponent(token)}/properties/${propertyId}/units/`, payload);
      onPortalUpdate?.(data);
      toast.success("Unit added.");
      return true;
    } catch (error) {
      toast.error(error?.response?.data?.detail || error?.response?.data?.unit_label?.[0] || "Could not add that unit.");
      throw error;
    } finally {
      setSavingUnit(false);
    }
  };

  const bulkCreatePropertyUnits = async (propertyId, payload) => {
    if (!propertyId) return false;
    setSavingUnit(true);
    try {
      const { data } = await api.post(`/projects/customer-portal/${encodeURIComponent(token)}/properties/${propertyId}/units/bulk/`, payload);
      if (data?.portal) onPortalUpdate?.(data.portal);
      const createdCount = Number(data?.created_count || 0);
      const skippedCount = Number(data?.skipped_count || 0);
      toast.success(
        skippedCount
          ? `${createdCount} unit${createdCount === 1 ? "" : "s"} added; ${skippedCount} duplicate${skippedCount === 1 ? "" : "s"} skipped.`
          : `${createdCount} unit${createdCount === 1 ? "" : "s"} added.`
      );
      return true;
    } catch (error) {
      toast.error(error?.response?.data?.detail || error?.response?.data?.unit_labels?.[0] || "Could not bulk add units.");
      throw error;
    } finally {
      setSavingUnit(false);
    }
  };

  const updatePropertyUnit = async (propertyId, unitId, payload) => {
    if (!propertyId || !unitId) return false;
    setSavingUnit(true);
    try {
      const { data } = await api.patch(`/projects/customer-portal/${encodeURIComponent(token)}/properties/${propertyId}/units/${unitId}/`, payload);
      onPortalUpdate?.(data);
      toast.success("Unit updated.");
      return true;
    } catch (error) {
      toast.error(error?.response?.data?.detail || error?.response?.data?.unit_label?.[0] || "Could not update that unit.");
      throw error;
    } finally {
      setSavingUnit(false);
    }
  };

  const disablePropertyUnit = async (propertyId, unitId) => {
    if (!propertyId || !unitId) return false;
    setSavingUnit(true);
    try {
      const { data } = await api.delete(`/projects/customer-portal/${encodeURIComponent(token)}/properties/${propertyId}/units/${unitId}/`);
      onPortalUpdate?.(data);
      toast.success("Unit marked inactive.");
      return true;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update that unit.");
      return false;
    } finally {
      setSavingUnit(false);
    }
  };

  const createTenant = async (propertyId, payload) => {
    if (!propertyId) return false;
    setSavingTenant(true);
    try {
      const { data } = await api.post(`/projects/customer-portal/${encodeURIComponent(token)}/properties/${propertyId}/tenants/`, payload);
      onPortalUpdate?.(data);
      toast.success("Tenant added.");
      return true;
    } catch (error) {
      toast.error(error?.response?.data?.detail || error?.response?.data?.email?.[0] || "Could not add that tenant.");
      throw error;
    } finally {
      setSavingTenant(false);
    }
  };

  const updateTenant = async (propertyId, tenancyId, payload) => {
    if (!propertyId || !tenancyId) return false;
    setSavingTenant(true);
    try {
      const { data } = await api.patch(`/projects/customer-portal/${encodeURIComponent(token)}/properties/${propertyId}/tenants/${tenancyId}/`, payload);
      onPortalUpdate?.(data);
      toast.success("Tenant updated.");
      return true;
    } catch (error) {
      toast.error(error?.response?.data?.detail || error?.response?.data?.email?.[0] || "Could not update that tenant.");
      throw error;
    } finally {
      setSavingTenant(false);
    }
  };

  const markTenantFormer = async (propertyId, tenancyId) => {
    if (!propertyId || !tenancyId) return false;
    setSavingTenant(true);
    try {
      const { data } = await api.delete(`/projects/customer-portal/${encodeURIComponent(token)}/properties/${propertyId}/tenants/${tenancyId}/`);
      onPortalUpdate?.(data);
      toast.success("Tenant marked former.");
      return true;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update that tenant.");
      return false;
    } finally {
      setSavingTenant(false);
    }
  };

  const uploadHomeSystemDocument = async ({ file, title, documentType, propertyProfileId, homeSystemId, uploadSource }) => {
    if (!file) return null;
    setUploadError("");
    setSavingHomeSystem(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title || file.name || "Home system document");
      formData.append("document_type", documentType || "Equipment Label");
      formData.append("upload_source", uploadSource || "portal_desktop");
      formData.append("run_extraction", "true");
      if (propertyProfileId) formData.append("property_profile_id", propertyProfileId);
      if (homeSystemId) formData.append("home_system_id", homeSystemId);
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/property/documents/`,
        formData
      );
      onPortalUpdate?.(data.portal || data);
      toast.success(data?.detail || "File saved.");
      return data;
    } catch (error) {
      const message = error?.response?.data?.detail || "Could not upload that file.";
      setUploadError(message);
      toast.error(message);
      return null;
    } finally {
      setSavingHomeSystem(false);
    }
  };

  const createHomeSystemUploadSession = async (payload) => {
    setSavingHomeSystem(true);
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/property/upload-sessions/`,
        payload
      );
      toast.success("Phone scan link created.");
      return data;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not create a phone scan link.");
      return null;
    } finally {
      setSavingHomeSystem(false);
    }
  };

  const applyHomeSystemDocumentExtraction = async (documentId, selectedFields) => {
    if (!documentId) return false;
    setSavingHomeSystem(true);
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/property/documents/${documentId}/apply-extraction/`,
        { selected_fields: selectedFields }
      );
      onPortalUpdate?.(data);
      toast.success("Home System updated.");
      return true;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not apply those suggestions.");
      return false;
    } finally {
      setSavingHomeSystem(false);
    }
  };
  const createHomeSystem = async (payload) => {
    setSavingHomeSystem(true);
    try {
      const { data } = await api.post(`/projects/customer-portal/${encodeURIComponent(token)}/property/systems/`, payload);
      onPortalUpdate?.(data);
      toast.success("Home system saved.");
      return true;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not save that home system.");
      return false;
    } finally {
      setSavingHomeSystem(false);
    }
  };
  const updateHomeSystem = async (systemId, payload) => {
    if (!systemId) return false;
    setSavingHomeSystem(true);
    try {
      const { data } = await api.patch(`/projects/customer-portal/${encodeURIComponent(token)}/property/systems/${systemId}/`, payload);
      onPortalUpdate?.(data);
      toast.success("Home system updated.");
      return true;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update that home system.");
      return false;
    } finally {
      setSavingHomeSystem(false);
    }
  };
  const archiveHomeSystem = async (systemId) => {
    if (!systemId) return false;
    setSavingHomeSystem(true);
    try {
      const { data } = await api.delete(`/projects/customer-portal/${encodeURIComponent(token)}/property/systems/${systemId}/`);
      onPortalUpdate?.(data);
      toast.success("Home system archived.");
      return true;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not archive that home system.");
      return false;
    } finally {
      setSavingHomeSystem(false);
    }
  };
  const markHomeSystemServiced = async (systemId, payload) => {
    if (!systemId) return false;
    setSavingHomeSystem(true);
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/property/systems/${systemId}/mark-serviced/`,
        payload
      );
      onPortalUpdate?.(data);
      toast.success("Service record updated.");
      return true;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update that service record.");
      return false;
    } finally {
      setSavingHomeSystem(false);
    }
  };
  const createHomeSystemServiceRequest = async (systemId) => {
    if (!systemId) return false;
    setSavingHomeSystem(true);
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/property/systems/${systemId}/service-request/`
      );
      onPortalUpdate?.(data);
      toast.success("Service request created.");
      setActiveTab("requests");
      return true;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not create that service request.");
      return false;
    } finally {
      setSavingHomeSystem(false);
    }
  };
  const updateHomeSystemRecommendationPreference = async (systemId, recommendationKey, action) => {
    if (!systemId || !recommendationKey) return false;
    setSavingHomeSystem(true);
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/property/systems/recommendations/${encodeURIComponent(recommendationKey)}/${action}/`,
        { system_id: systemId }
      );
      if (data?.portal) onPortalUpdate?.(data.portal);
      toast.success(data?.detail || (action === "ignore" ? "Recommendation ignored." : "Recommendation restored."));
      return true;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update that recommendation.");
      return false;
    } finally {
      setSavingHomeSystem(false);
    }
  };
  const reviewTenantMaintenanceRequest = async (propertyId, requestId, payload) => {
    if (!propertyId || !requestId) return false;
    try {
      const { data } = await api.patch(
        `/projects/customer-portal/${encodeURIComponent(token)}/properties/${propertyId}/tenant-maintenance-requests/${requestId}/`,
        payload
      );
      if (data?.portal) onPortalUpdate?.(data.portal);
      toast.success("Maintenance request updated.");
      return true;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update that maintenance request.");
      throw error;
    }
  };
  const createPropertyWorkOrder = async (propertyId, payload) => {
    if (!propertyId) return false;
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/properties/${propertyId}/work-orders/`,
        payload
      );
      if (data?.portal) onPortalUpdate?.(data.portal);
      toast.success("Work order created.");
      return data;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not create that work order.");
      throw error;
    }
  };
  const updatePropertyWorkOrder = async (propertyId, workOrderId, payload) => {
    if (!propertyId || !workOrderId) return false;
    try {
      const { data } = await api.patch(
        `/projects/customer-portal/${encodeURIComponent(token)}/properties/${propertyId}/work-orders/${workOrderId}/`,
        payload
      );
      if (data?.portal) onPortalUpdate?.(data.portal);
      toast.success("Work order updated.");
      return data;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update that work order.");
      throw error;
    }
  };
  const sendPropertyWorkOrderToMarketplace = async (propertyId, workOrderId, payload = {}) => {
    if (!propertyId || !workOrderId) return false;
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/properties/${propertyId}/work-orders/${workOrderId}/send-to-marketplace/`,
        payload
      );
      if (data?.portal) onPortalUpdate?.(data.portal);
      toast.success("Work order sent to marketplace contractors.");
      return data;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not send that work order to the marketplace.");
      throw error;
    }
  };
  const withdrawPropertyWorkOrderMarketplace = async (propertyId, workOrderId) => {
    if (!propertyId || !workOrderId) return false;
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/properties/${propertyId}/work-orders/${workOrderId}/withdraw-marketplace/`
      );
      if (data?.portal) onPortalUpdate?.(data.portal);
      toast.success("Marketplace work order withdrawn.");
      return data;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not withdraw that marketplace work order.");
      throw error;
    }
  };
  const createPropertyWorkOrderAgreementDraft = async (propertyId, workOrderId) => {
    if (!propertyId || !workOrderId) return false;
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/properties/${propertyId}/work-orders/${workOrderId}/create-agreement-draft/`
      );
      if (data?.portal) onPortalUpdate?.(data.portal);
      toast.success(data?.created ? "Agreement draft created." : "Agreement draft already exists.");
      return data;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not create that agreement draft.");
      throw error;
    }
  };
  const createWorkOrderFromTenantRequest = async (propertyId, requestId) => {
    if (!propertyId || !requestId) return false;
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/properties/${propertyId}/tenant-maintenance-requests/${requestId}/create-work-order/`
      );
      if (data?.portal) onPortalUpdate?.(data.portal);
      toast.success("Work order created from request.");
      return data;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not create a work order from that request.");
      throw error;
    }
  };
  const tabContent = useMemo(() => {
    if (activeTab === "overview") {
      return (
        <OverviewPanel
          portal={{ ...portal, notifications }}
          onOpenTab={setActiveTab}
          tenantMaintenanceTab={showMaintenanceTab ? "maintenance" : "requests"}
          markingId={markingNotificationId}
          bulkMarking={markingAllNotifications}
          onMarkRead={markNotificationRead}
          onMarkAllRead={markAllNotificationsRead}
        />
      );
    }
    if (activeTab === "projects") {
      return (
        <CustomerProjectWorkspace
          projects={portal?.projects || []}
          agreements={portal?.agreements || []}
          payments={portal?.payments || []}
          documents={portal?.documents || []}
          notifications={portal?.notifications || []}
          propertyProfiles={portal?.property_profiles || []}
          token={token}
          onRefresh={(nextPortal) => {
            if (nextPortal) {
              onPortalUpdate?.(nextPortal);
              return;
            }
            refreshPortal();
          }}
        />
      );
    }
    if (activeTab === "requests" || activeTab === "maintenance") {
      return (
        <CustomerRequests
          requests={portal?.requests || []}
          bids={portal?.bids || []}
          tenantMaintenanceRequests={portal?.tenant_maintenance_requests || []}
          propertyWorkOrders={portal?.property_work_orders || []}
          teamMembers={portal?.account?.team_members || []}
          vendors={portal?.account?.vendors || []}
          propertyProfile={portal?.property_profile || {}}
          propertyProfiles={portal?.property_profiles || []}
          isPropertyManagementCompany={showMaintenanceTab}
          mode={activeTab === "maintenance" ? "maintenance" : "requests"}
          creating={creatingRequest}
          acceptingBidId={acceptingBidId}
          focusedRequestId={focusedRequestId}
          onFocusedRequestHandled={() => setFocusedRequestId("")}
          initialDraft={requestDraft}
          onInitialDraftHandled={() => setRequestDraft(null)}
          onAcceptBid={async (bid) => {
            const bidKey = bid?.id || "";
            if (!bidKey) return;
            setAcceptingBidId(bidKey);
            try {
              const { data } = await api.post(
                `/projects/customer-portal/${encodeURIComponent(token)}/bids/${encodeURIComponent(bidKey)}/accept/`
              );
              if (data?.portal) onPortalUpdate?.(data.portal);
              toast.success(data?.created ? "Agreement draft created from awarded marketplace bid." : "Agreement draft already exists for this awarded bid.");
            } catch (error) {
              toast.error(error?.response?.data?.detail || "Could not award that bid.");
            } finally {
              setAcceptingBidId("");
            }
          }}
          onCreateRequest={async (payload) => {
            setCreatingRequest(true);
            try {
              const { data } = await api.post(`/projects/customer-portal/${encodeURIComponent(token)}/requests/`, payload);
              onPortalUpdate?.(data);
              toast.success("Request saved.");
            } catch (error) {
              toast.error(error?.response?.data?.detail || "Could not save that request.");
            } finally {
              setCreatingRequest(false);
            }
          }}
          onUpdateRequest={async (requestId, payload) => {
            setCreatingRequest(true);
            try {
              const { data } = await api.patch(`/projects/customer-portal/${encodeURIComponent(token)}/requests/${requestId}/`, payload);
              onPortalUpdate?.(data);
              toast.success("Request updated.");
            } catch (error) {
              toast.error(error?.response?.data?.detail || "Could not update that request.");
              throw error;
            } finally {
              setCreatingRequest(false);
            }
          }}
          onReviewTenantMaintenanceRequest={reviewTenantMaintenanceRequest}
          onCreatePropertyWorkOrder={createPropertyWorkOrder}
          onUpdatePropertyWorkOrder={updatePropertyWorkOrder}
          onSendPropertyWorkOrderToMarketplace={sendPropertyWorkOrderToMarketplace}
          onWithdrawPropertyWorkOrderMarketplace={withdrawPropertyWorkOrderMarketplace}
          onCreatePropertyWorkOrderAgreementDraft={createPropertyWorkOrderAgreementDraft}
          onPreviewPropertyWorkOrderContractorMatches={async (propertyId, workOrderId, params = {}) => {
            const search = new URLSearchParams();
            if (String(params.location || "").trim()) search.set("location", params.location);
            if (String(params.search || "").trim()) search.set("search", params.search);
            if (String(params.radius_miles || "").trim()) search.set("radius_miles", params.radius_miles);
            const { data } = await api.get(
              `/projects/customer-portal/${encodeURIComponent(token)}/properties/${propertyId}/work-orders/${workOrderId}/contractor-matches/${search.toString() ? `?${search.toString()}` : ""}`
            );
            return data;
          }}
          onImportVendor={importVendor}
          onCreateWorkOrderFromTenantRequest={createWorkOrderFromTenantRequest}
          onImproveRequest={async (payload) => {
            const { data } = await api.post(
              `/projects/customer-portal/${encodeURIComponent(token)}/requests/improve/`,
              payload
            );
            return data;
          }}
          onStartContractorSearch={async (requestId) => {
            try {
              const { data } = await api.post(`/projects/customer-portal/${encodeURIComponent(token)}/requests/${requestId}/contractor-search/`);
              if (data?.portal) onPortalUpdate?.(data.portal);
              return data;
            } catch (error) {
              toast.error(error?.response?.data?.detail || "Could not start contractor matching.");
              throw error;
            }
          }}
          onRouteRequestContractors={async (requestId, selectedContractors) => {
            try {
              const { data } = await api.post(
                `/projects/customer-portal/${encodeURIComponent(token)}/requests/${requestId}/contractors/select/`,
                { selected_contractors: selectedContractors }
              );
              if (data?.portal) onPortalUpdate?.(data.portal);
              toast.success(data?.detail || "Request sent to selected contractors.");
              return data;
            } catch (error) {
              toast.error(error?.response?.data?.detail || "Could not send this request to contractors.");
              throw error;
            }
          }}
          onCancelRequest={async (requestId, reason) => {
            try {
              const { data } = await api.post(
                `/projects/customer-portal/${encodeURIComponent(token)}/requests/${requestId}/cancel/`,
                { reason }
              );
              if (data?.portal) onPortalUpdate?.(data.portal);
              toast.success(data?.detail || "Request cancelled.");
              return data;
            } catch (error) {
              toast.error(error?.response?.data?.detail || "Could not cancel this request.");
              throw error;
            }
          }}
          onDeleteRequest={async (requestId) => {
            try {
              const { data } = await api.delete(`/projects/customer-portal/${encodeURIComponent(token)}/requests/${requestId}/`);
              if (data?.portal) onPortalUpdate?.(data.portal);
              toast.success(data?.detail || "Request deleted.");
              return data;
            } catch (error) {
              toast.error(error?.response?.data?.detail || "Could not delete this request.");
              throw error;
            }
          }}
        />
      );
    }
    if (activeTab === "property") {
      return (
        <CustomerPropertyProfile
          profile={portal?.property_profile || {}}
          profiles={portal?.property_profiles || []}
          projects={portal?.projects || []}
          agreements={portal?.agreements || []}
          documents={portal?.documents || []}
          requests={portal?.requests || []}
          payments={portal?.payments || []}
          maintenanceWorkOrders={portal?.maintenance_work_orders || []}
          propertyIntelligence={portal?.property_intelligence || {}}
          isPropertyManagementCompany={isPropertyManagementAccount}
          onOpenRequest={openRequestFromPropertyTimeline}
          onReviewTenantMaintenanceRequest={() => setActiveTab(showMaintenanceTab ? "maintenance" : "requests")}
          saving={savingProperty}
          unitSaving={savingUnit}
          tenantSaving={savingTenant}
          uploading={uploadingPropertyFile}
          systemSaving={savingHomeSystem}
          uploadError={uploadError}
          onSave={async (payload) => {
            setSavingProperty(true);
            try {
              const { data } = await api.patch(`/projects/customer-portal/${encodeURIComponent(token)}/property/`, payload);
              onPortalUpdate?.(data);
              toast.success("Property profile saved.");
            } catch (error) {
              toast.error(error?.response?.data?.detail || "Could not save the property profile.");
            } finally {
              setSavingProperty(false);
            }
          }}
          onAdd={async (payload) => {
            setSavingProperty(true);
            try {
              const { data } = await api.post(`/projects/customer-portal/${encodeURIComponent(token)}/property/`, payload);
              onPortalUpdate?.(data);
              toast.success("Property added.");
            } catch (error) {
              toast.error(error?.response?.data?.detail || "Could not add that property.");
            } finally {
              setSavingProperty(false);
            }
          }}
          onUpload={uploadPropertyFile}
          onCreateUnit={createPropertyUnit}
          onBulkCreateUnits={bulkCreatePropertyUnits}
          onUpdateUnit={updatePropertyUnit}
          onDisableUnit={disablePropertyUnit}
          onCreateTenant={createTenant}
          onUpdateTenant={updateTenant}
          onMarkTenantFormer={markTenantFormer}
          onCreateSystem={createHomeSystem}
          onUpdateSystem={updateHomeSystem}
          onArchiveSystem={archiveHomeSystem}
          onMarkSystemServiced={markHomeSystemServiced}
          onCreateSystemServiceRequest={createHomeSystemServiceRequest}
          onUploadSystemDocument={uploadHomeSystemDocument}
          onCreateSystemUploadSession={createHomeSystemUploadSession}
          onApplySystemDocumentExtraction={applyHomeSystemDocumentExtraction}
          onCreateRequestDraft={(draft) => {
            setRequestDraft(draft);
            setActiveTab("requests");
          }}
          onIgnoreSystemRecommendation={(systemId, recommendationKey) => updateHomeSystemRecommendationPreference(systemId, recommendationKey, "ignore")}
          onRestoreSystemRecommendation={(systemId, recommendationKey) => updateHomeSystemRecommendationPreference(systemId, recommendationKey, "restore")}
        />
      );
    }
    if (activeTab === "payments") return <PaymentsPanel payments={portal?.payments || []} agreements={portal?.agreements || []} token={token} onPortalUpdate={onPortalUpdate} />;
    if (activeTab === "notifications") {
      return (
        <NotificationsCenter
          notifications={notifications}
          unreadCount={unreadCount}
          preferences={portal?.notification_cleanup_preferences || {}}
          markingId={markingNotificationId}
          archivingId={archivingNotificationId}
          restoringId={restoringNotificationId}
          savingPreferences={savingNotificationPreferences}
          preferenceError={notificationPreferenceError}
          bulkMarking={markingAllNotifications}
          onMarkRead={markNotificationRead}
          onMarkAllRead={markAllNotificationsRead}
          onArchive={archiveNotification}
          onRestore={restoreNotification}
          onSavePreferences={saveNotificationCleanupPreferences}
        />
      );
    }
    if (activeTab === "account") {
      return (
        <AccountPanel
          portal={portal}
          token={token}
          saving={savingProfile}
          teamSaving={savingTeamMember}
          vendorSaving={savingVendor}
          onSave={async (payload) => {
            setSavingProfile(true);
            try {
              const { data } = await api.patch(`/projects/customer-portal/${encodeURIComponent(token)}/profile/`, payload);
              onPortalUpdate?.(data);
              toast.success("Profile saved.");
            } catch (error) {
              toast.error(error?.response?.data?.detail || "Could not save your profile.");
            } finally {
              setSavingProfile(false);
            }
          }}
          onAddTeamMember={addTeamMember}
          onEditTeamMember={editTeamMember}
          onDisableTeamMember={disableTeamMember}
          onAddVendor={addVendor}
          onImportVendor={importVendor}
          onEditVendor={editVendor}
          onDisableVendor={disableVendor}
        />
      );
    }
    return (
      <CustomerDocuments
        documents={portal?.documents || []}
        propertyProfile={portal?.property_profile || {}}
        uploading={uploadingPropertyFile}
        uploadError={uploadError}
        onUpload={uploadPropertyFile}
      />
    );
  }, [activeTab, portal, creatingRequest, savingProperty, savingUnit, savingTenant, savingHomeSystem, uploadingPropertyFile, uploadError, token, onPortalUpdate, notifications, unreadCount, markingNotificationId, markingAllNotifications, archivingNotificationId, restoringNotificationId, savingNotificationPreferences, notificationPreferenceError, savingProfile, savingTeamMember, savingVendor, focusedRequestId, requestDraft, openRequestFromPropertyTimeline, isPropertyManagementAccount, showMaintenanceTab]);

  return (
    <div data-testid="customer-dashboard" className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.16),transparent_28%),linear-gradient(135deg,#020617,#082f49_52%,#020617)] px-4 py-6 text-slate-100">
      <div className="mx-auto w-full max-w-[1800px]">
        <header className="rounded-3xl border border-amber-200/20 bg-slate-900/80 p-5 shadow-2xl shadow-slate-950/40 sm:p-6 md:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <img
                  src={logo}
                  alt="MyHomeBro"
                  data-testid="customer-dashboard-logo"
                  className="h-12 w-12 rounded-2xl object-cover shadow-lg shadow-blue-950/30"
                />
                <div>
                  <div className="text-xl font-bold tracking-tight text-white">
                    MyHome<span className="text-amber-300">Bro</span>
                  </div>
                  <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">
                    Customer Portal
                  </div>
                </div>
              </div>
              <h1 className="mt-5 text-2xl font-bold tracking-tight text-white sm:text-3xl">Customer Portal</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                {customerName ? `${customerName}, ` : ""}track projects, payments, documents, warranties, and property records in one place.
              </p>
            </div>
            <div className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-300 lg:w-auto">
              <div>Secure access verified for <span className="font-semibold text-white">{portal?.customer?.email}</span></div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-300/35 bg-sky-400/10 px-2.5 py-1 text-xs font-semibold text-sky-100">
                  <Bell size={13} />
                  {unreadCount} unread updates
                </div>
                <button
                  type="button"
                  data-testid="customer-dashboard-header-logout"
                  onClick={() => {
                    clearAuth(false);
                    window.location.assign("/portal");
                  }}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-rose-300/35 bg-rose-400/10 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-400/20"
                >
                  <LogOut size={13} />
                  Log out
                </button>
              </div>
            </div>
          </div>

          <nav className="mt-6 flex gap-2 overflow-x-auto pb-1" aria-label="Customer workspace tabs">
            {visibleTabs.map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                data-testid={`customer-dashboard-tab-${key}`}
                onClick={() => setActiveTab(key)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                  activeTab === key
                    ? "border-amber-300/60 bg-amber-300/15 text-amber-100"
                    : "border-slate-700 bg-slate-950/40 text-slate-300 hover:border-slate-500 hover:bg-slate-900"
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>
        </header>

        <main className="mt-5">
          {tabContent}
        </main>
      </div>
    </div>
  );
}
