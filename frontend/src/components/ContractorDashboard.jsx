// src/components/ContractorDashboard.jsx
import React, { useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { getContractorDrawRequests, releaseDrawRequest, resendDrawReview } from "../api";
import { toast } from "react-hot-toast";
import { useAuth } from "../context/AuthContext";
import PageShell from "./PageShell.jsx";
import StatCard from "./StatCard.jsx";
import Modal from "react-modal";
import DashboardCard from "./dashboard/DashboardCard.jsx";
import DashboardSection from "./dashboard/DashboardSection.jsx";
import ContractorContextualGuideModal, { pickContextualGuide } from "./ContractorContextualGuideModal.jsx";
import { ProjectModeBadge, normalizeProjectMode } from "./projectMode.jsx";
import { deriveMilestoneRoleLabel, normalizeMilestoneRole } from "./milestoneRole.jsx";
import { contractorMatchTierClass, contractorMatchTierLabel } from "../lib/contractorMatching.js";
import {
  Target,
  ListTodo,
  CheckCircle2,
  Circle,
  BadgeDollarSign,
  BadgeCheck,
  WalletMinimal,
  FilePlus2,
  ListPlus,
  HandCoins,
  Receipt,
  ClipboardCheck,
  FileText,
  Flag,
  CalendarDays,
  AlertTriangle,
  Wrench,
  X,
  ChevronDown,
  ChevronRight,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import {
  buildUnifiedPaymentRecords,
  moneyStatusLabel,
  projectClassLabel,
  summarizePaymentRecords,
} from "../utils/paymentRecords.js";
import { getContractorNextActions } from "../lib/contractorNextActions.js";
import { calculateProfileCompleteness } from "../lib/profileCompleteness.js";
import OnboardingConversation from "./OnboardingConversation.jsx";
import { useAssistantDock } from "./AssistantDock.jsx";
import {
  detectLoginExperience,
  getDaysSinceLastLogin,
  recordLoginTimestamp,
} from "../lib/onboardingState.js";

/* Ensure react-modal knows the root */
Modal.setAppElement("#root");

/* ---------- small helpers ---------- */
const money = (n) => Number(n || 0);
const sum = (arr, key = "amount") => arr.reduce((a, x) => a + money(x?.[key]), 0);
const norm = (s) => (s || "").toString().toLowerCase();

function parseDateAny(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function getMilestoneLifecycleState(m) {
  return norm(m?.milestone_lifecycle_state || m?.lifecycle_state || m?.calendar_status || m?.status || "");
}
function isPlannedMilestoneEntry(m) {
  const state = getMilestoneLifecycleState(m);
  return [
    "planned",
    "draft",
    "pending_signature",
    "signature_pending",
    "awaiting_signature",
    "sent",
    "review",
  ].includes(state);
}
function normalizeProjectClassMaybe(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes("commercial")) return "commercial";
  if (raw.includes("residential")) return "residential";
  return null;
}
function normalizePaymentProtectionLevel(value) {
  const raw = norm(value);
  if (raw.includes("required")) return "required";
  if (raw.includes("recommended")) return "recommended";
  return "preferred";
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfYear(d) {
  return new Date(d.getFullYear(), 0, 1);
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
function startOfTomorrow() {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  return d;
}
function endOfTomorrow() {
  const d = endOfToday();
  d.setDate(d.getDate() + 1);
  return d;
}
function endOfWeek() {
  const d = endOfToday();
  d.setDate(d.getDate() + 6);
  return d;
}
function inRange(dateObj, from, to) {
  if (!dateObj) return false;
  const t = dateObj.getTime();
  if (from && t < from.getTime()) return false;
  if (to && t > to.getTime()) return false;
  return true;
}
const currency = (n) =>
  Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

function activationValue(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return String(value);
    if (value === true) return "true";
  }
  return "";
}

function hasContractorTradeInfo(profile = {}) {
  if (Array.isArray(profile?.skills)) return profile.skills.length > 0;
  return Boolean(
    activationValue(
      profile?.trade,
      profile?.trade_name,
      profile?.specialty,
      profile?.project_type,
      profile?.primary_trade
    )
  );
}

function hasContractorServiceArea(profile = {}) {
  return Boolean(
    activationValue(
      profile?.city,
      profile?.state,
      profile?.zip,
      profile?.postal_code,
      profile?.address,
      profile?.service_area,
      profile?.service_area_text
    )
  );
}

function isStripeReadyForActivation(profile = {}, stripe = {}) {
  const onboarding = profile?.onboarding || {};
  return Boolean(
    stripe?.connected ||
      stripe?.stripe_ready ||
      stripe?.onboarding?.stripe_ready ||
      onboarding?.stripe_ready ||
      profile?.stripe_ready ||
      (profile?.stripe_connected && profile?.charges_enabled && profile?.payouts_enabled) ||
      (profile?.stripe_status?.connected &&
        profile?.stripe_status?.charges_enabled &&
        profile?.stripe_status?.payouts_enabled)
  );
}

function marketplaceStatusFromProfile(profile = {}, stripe = {}) {
  const raw = String(profile?.marketplace_verification_status || profile?.verification_status || "").toLowerCase();
  const stripeReady = isStripeReadyForActivation(profile, stripe);
  const hasServiceArea = hasContractorServiceArea(profile);
  const hasTrade = hasContractorTradeInfo(profile);
  if (raw === "suspended") {
    return {
      key: "suspended",
      label: "Suspended",
      tone: "danger",
      reason: "Marketplace access is suspended. Contact support before accepting new marketplace work.",
    };
  }
  if (!stripeReady) {
    return {
      key: "stripe",
      label: "Stripe action needed",
      tone: "warning",
      reason: "Connect Stripe before marketplace-funded projects can move forward.",
    };
  }
  if (!hasServiceArea) {
    return {
      key: "service_area",
      label: "Missing service area",
      tone: "warning",
      reason: "Add your service city, state, or ZIP so marketplace requests can be matched locally.",
    };
  }
  if (!hasTrade) {
    return {
      key: "trade",
      label: "Missing trade/category",
      tone: "warning",
      reason: "Select at least one trade category so relevant requests can find you.",
    };
  }
  if (raw === "verified" && profile?.marketplace_preferred) {
    return {
      key: "preferred",
      label: "Preferred",
      tone: "success",
      reason: "You are verified and marked preferred for marketplace opportunities.",
    };
  }
  if (raw === "verified") {
    return {
      key: "verified",
      label: "Verified",
      tone: "success",
      reason: "You are eligible for marketplace opportunities in enabled locations.",
    };
  }
  if (raw === "pending_review") {
    return {
      key: "pending",
      label: "Pending review",
      tone: "info",
      reason: "Your marketplace verification is waiting for review.",
    };
  }
  if (raw === "rejected") {
    return {
      key: "rejected",
      label: "Not eligible",
      tone: "danger",
      reason: profile?.marketplace_verification_rejected_reason || "Verification needs attention before marketplace eligibility.",
    };
  }
  return {
    key: "not_eligible",
    label: "Not eligible",
    tone: "warning",
    reason: "Complete the required setup steps to become marketplace eligible.",
  };
}

function activationToneClasses(tone = "slate") {
  const map = {
    success: "border-emerald-300/35 bg-emerald-400/10 text-emerald-100",
    warning: "border-amber-300/35 bg-amber-300/10 text-amber-100",
    danger: "border-rose-300/35 bg-rose-400/10 text-rose-100",
    info: "border-sky-300/35 bg-sky-400/10 text-sky-100",
    slate: "border-slate-600 bg-slate-900/70 text-slate-200",
  };
  return map[tone] || map.slate;
}

function getMilestoneDueDate(m) {
  return (
    parseDateAny(m?.due_date) ||
    parseDateAny(m?.dueDate) ||
    parseDateAny(m?.milestone_due_date) ||
    parseDateAny(m?.scheduled_date) ||
    parseDateAny(m?.target_date) ||
    parseDateAny(m?.date) ||
    parseDateAny(m?.end_date) ||
    null
  );
}

function getInvoiceDueDate(inv) {
  return (
    parseDateAny(inv?.due_date) ||
    parseDateAny(inv?.dueDate) ||
    parseDateAny(inv?.approval_due_date) ||
    parseDateAny(inv?.scheduled_release_date) ||
    parseDateAny(inv?.created_at) ||
    null
  );
}

/* ========================================================================== */
/* ============================ Milestone helpers ============================ */
/* ========================================================================== */

const getInvoiceIdFromMilestone = (m) => {
  const inv = m?.invoice;
  if (inv && typeof inv === "object") return inv?.id ?? inv?.invoice_id ?? inv?.pk ?? null;
  return m?.invoice_id ?? m?.invoiceId ?? m?.invoice ?? null;
};

const milestoneStatus = (m) => norm(m?.status || m?.milestone_status || m?.state || "");

// robust “completed” detection (matches your newer MilestoneList behavior)
const isMilestoneCompleted = (m) => {
  if (!m) return false;

  if (m.completed === true) return true;
  if (m.is_completed === true) return true;

  if (!!m.completed_at || !!m.completed_on || !!m.completed_date) return true;
  if (!!m.submitted_at || !!m.submitted_on || !!m.completion_submitted_at) return true;

  const st = milestoneStatus(m);

  if (["completed", "complete", "done", "finished"].includes(st)) return true;

  if (
    [
      "review",
      "in_review",
      "pending_review",
      "submitted",
      "pending_approval",
      "awaiting_approval",
      "approval_pending",
    ].includes(st)
  ) {
    return true;
  }

  return false;
};

const isMilestoneIncomplete = (m) => !isMilestoneCompleted(m);

const hasMilestoneInvoice = (m) =>
  m?.is_invoiced === true || !!getInvoiceIdFromMilestone(m);

const milestonePercentComplete = (m) => {
  const candidates = [
    m?.percent_complete,
    m?.progress_percent,
    m?.completion_percent,
    m?.progress,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
};

const isMilestoneReviewedStage = (m) => {
  if (!m) return false;
  const st = milestoneStatus(m);
  if (
    [
      "review",
      "in_review",
      "pending_review",
      "submitted",
      "pending_approval",
      "awaiting_approval",
      "approval_pending",
    ].includes(st)
  ) {
    return true;
  }
  return !!m?.submitted_at || !!m?.submitted_on || !!m?.completion_submitted_at;
};

const isMilestoneCompletedStage = (m, invoicesById) => {
  if (!isMilestoneCompleted(m)) return false;
  if (isMilestonePaid(m, invoicesById)) return false;
  if (hasMilestoneInvoice(m)) return false;
  if (isMilestoneReviewedStage(m)) return false;
  return true;
};

const isMilestoneInvoicedStage = (m, invoicesById) => {
  if (isMilestonePaid(m, invoicesById)) return false;
  return hasMilestoneInvoice(m);
};

const isMilestoneNotStarted = (m, invoicesById) => {
  if (!m) return false;
  if (isMilestonePaid(m, invoicesById)) return false;
  if (hasMilestoneInvoice(m)) return false;
  if (isMilestoneCompleted(m)) return false;
  const st = milestoneStatus(m);
  if (["not_started", "not started", "todo", "planned", "draft"].includes(st)) {
    return true;
  }
  return milestonePercentComplete(m) <= 0;
};

const isMilestoneInProgressStage = (m, invoicesById) => {
  if (!m) return false;
  if (isMilestonePaid(m, invoicesById)) return false;
  if (hasMilestoneInvoice(m)) return false;
  if (isMilestoneCompleted(m)) return false;
  return !isMilestoneNotStarted(m, invoicesById);
};

// Paid milestone = invoice is paid OR escrow released (via invoices list or embedded invoice object)
const isMilestonePaid = (m, invoicesById) => {
  if (!m) return false;

  const invObj = m?.invoice && typeof m.invoice === "object" ? m.invoice : null;
  const invoiceId = getInvoiceIdFromMilestone(m);
  const inv = invObj || (invoiceId ? invoicesById[String(invoiceId)] : null);
  if (!inv) return false;

  const s = norm(inv?.status || inv?.invoice_status || inv?.state || "");
  const display = norm(inv?.display_status || "");

  const escrowReleased =
    inv?.escrow_released === true ||
    inv?.escrow_released === 1 ||
    inv?.escrow_released === "true" ||
    !!inv?.escrow_released_at;

  if (escrowReleased) return true;
  if (display === "paid") return true;
  if (s === "paid" || s === "earned" || s === "released") return true;
  if (s.includes("paid")) return true;

  return false;
};

// Ready to invoice = completed AND NOT invoiced AND NOT paid
const isMilestoneReadyToInvoice = (m, invoicesById) => {
  if (!isMilestoneCompleted(m)) return false;
  if (isMilestonePaid(m, invoicesById)) return false;

  const hasInv =
    m?.is_invoiced === true ||
    !!getInvoiceIdFromMilestone(m);

  return !hasInv;
};

// ✅ Rework milestone detection (best-effort)
const isReworkMilestone = (m) => {
  if (!m) return false;

  if (m.is_rework === true || m.rework === true) return true;
  if (m.rework_of_dispute || m.rework_of_dispute_id) return true;
  if (m.dispute_id && norm(m.title).includes("rework")) return true;

  const t = norm(m.title);
  if (!t) return false;
  if (t.startsWith("rework")) return true;
  if (t.includes("rework — dispute") || t.includes("rework - dispute")) return true;
  if (t.includes("rework") && t.includes("dispute")) return true;

  return false;
};

// ✅ Invoice disputed detection (best-effort, tries to ignore resolved/closed disputes)
const isDisputedInvoice = (inv) => {
  const s = norm(inv?.status);
  const display = norm(inv?.display_status);

  const disputeStatus = norm(
    inv?.dispute_status ||
      inv?.dispute_state ||
      inv?.latest_dispute_status ||
      inv?.open_dispute_status ||
      inv?.dispute?.status ||
      inv?.dispute?.state ||
      ""
  );

  const openFlag = inv?.dispute_is_open ?? inv?.has_open_dispute ?? inv?.dispute_open ?? null;
  if (openFlag === false) return false;

  if (
    disputeStatus.includes("resolved") ||
    disputeStatus.includes("closed") ||
    disputeStatus.includes("dismiss")
  ) {
    return false;
  }

  return s.includes("dispute") || display.includes("dispute");
};

/**
 * ✅ Invoice bucketing rules (escrow-aware + disputed)
 */
const invBucket = (inv) => {
  if (isDisputedInvoice(inv)) return "disputed";

  const s = norm(inv?.status);
  const display = norm(inv?.display_status);

  const escrowReleased =
    inv?.escrow_released === true ||
    inv?.escrow_released === 1 ||
    inv?.escrow_released === "true";

  if (escrowReleased || display === "paid") return "earned";
  if (["paid", "earned", "released"].includes(s)) return "earned";

  if (["pending", "pending_approval", "sent", "awaiting_approval"].includes(s))
    return "pending";

  if (["approved", "ready_to_pay"].includes(s)) return "approved";

  return "pending";
};

const drawWorkflowStatus = (draw) => norm(draw?.workflow_status || draw?.status || "");

const drawWorkflowLabel = (draw) =>
  draw?.workflow_status_label || String(draw?.workflow_status || draw?.status || "draft").replaceAll("_", " ");

const drawAmount = (draw) => money(draw?.net_amount ?? draw?.current_requested_amount ?? draw?.gross_amount);

const drawPrimaryMilestoneLabel = (draw) => {
  const items = Array.isArray(draw?.line_items) ? draw.line_items : [];
  if (!items.length) return draw?.title || `Draw ${draw?.draw_number || ""}`.trim();
  const first = items[0];
  const base = first?.milestone_title || first?.description || draw?.title || "Draw stage";
  return items.length > 1 ? `${base} +${items.length - 1} more` : base;
};

function drawStatusTone(workflowStatus) {
  const status = norm(workflowStatus);
  if (status === "paid") return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (status === "payment_pending" || status === "approved") return "text-indigo-700 bg-indigo-50 border-indigo-200";
  if (status === "submitted") return "text-slate-700 bg-slate-50 border-slate-200";
  if (status === "changes_requested") return "text-amber-800 bg-amber-50 border-amber-200";
  if (status === "rejected" || status === "disputed") return "text-rose-700 bg-rose-50 border-rose-200";
  return "text-slate-700 bg-slate-50 border-slate-200";
}

const fmtRate = (rateDecimal) => {
  const r = Number(rateDecimal);
  if (!Number.isFinite(r)) return null;
  return `${(r * 100).toFixed(2)}%`;
};

// ✅ pricing labels (keep in sync with backend/backend/payments/fees.py)
const INTRO_RATE_LABEL = "3.00%";
const STANDARD_START_RATE_LABEL = "4.50%";

// ✅ Direct Pay pricing (LOCKED)
const DIRECT_PAY_LABEL = "1% + $1";

function planLabel() {
  return "Included";
}

function directPayLabel() {
  return DIRECT_PAY_LABEL;
}

function formatActivityTimestamp(value) {
  const dt = parseDateAny(value);
  if (!dt) return "";
  return dt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function activityAccent(severity) {
  if (severity === "critical") return "border-rose-200 bg-rose-50 text-rose-900";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-900";
  if (severity === "success") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  return "border-slate-200 bg-slate-50 text-slate-900";
}

/* ---------- quick action button ---------- */
function ActionButton({ icon: Icon, label, onClick, primary, hint }) {
  const tooltipId = useId();
  const button = (
    <button
      className={`mhb-btn${primary ? " primary" : ""}`}
      onClick={onClick}
      type="button"
      title={label}
      aria-describedby={hint ? tooltipId : undefined}
      style={{
        padding: primary ? "13px 16px" : "12px 16px",
        fontSize: 14,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        width: "100%",
      }}
    >
      {Icon ? <Icon size={18} /> : null}
      <span style={{ marginLeft: 8, fontWeight: 900 }}>{label}</span>
    </button>
  );

  if (!hint) return button;

  return (
    <div className="group relative flex">
      {button}
      <div
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium leading-5 text-slate-700 opacity-0 shadow-lg transition duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {hint}
      </div>
    </div>
  );
}

function FlowMetricButton({
  icon: Icon,
  label,
  description,
  count,
  amount,
  onClick,
  emphasized = false,
  testId,
}) {
  const countText =
    typeof count === "number" && Number.isFinite(count) ? `${count} ${count === 1 ? "item" : "items"}` : null;
  const amountText =
    typeof amount === "number" && Number.isFinite(amount) ? currency(amount) : null;

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 ${
        emphasized
          ? "border-[#1f5fa8] bg-[#1d4f8f] text-white shadow-[0_14px_34px_rgba(29,78,141,0.2)] hover:bg-[#19457d]"
          : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <div
        className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
          emphasized
            ? "border-white/20 bg-white/12 text-white"
            : "border-slate-200 bg-slate-50 text-[#355d8c]"
        }`}
      >
        {Icon ? <Icon size={18} /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className={`text-sm font-semibold ${emphasized ? "text-white" : "text-[#18395f]"}`}>
            {label}
          </div>
          <div className={`text-xs font-semibold ${emphasized ? "text-sky-100" : "text-slate-600"}`}>
            {[countText, amountText].filter(Boolean).join(" • ")}
          </div>
        </div>
        {description ? (
          <div className={`mt-1 text-sm ${emphasized ? "text-sky-50" : "text-slate-700"}`}>
            {description}
          </div>
        ) : null}
      </div>
      <div className={`shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-[0.16em] ${emphasized ? "text-sky-100" : "text-[#5a7290]"}`}>
        Open
      </div>
    </button>
  );
}

function PipelineRow({ title, count, amount, description, onClick, tone = "neutral", testId, icon: Icon }) {
  const toneClass =
    tone === "good"
      ? "border-emerald-300/30 bg-emerald-400/10"
    : tone === "warn"
      ? "border-amber-300/30 bg-amber-400/10"
    : tone === "bad"
      ? "border-rose-300/30 bg-rose-400/10"
    : tone === "active"
      ? "border-sky-300/30 bg-sky-400/10"
    : tone === "purple"
      ? "border-violet-300/30 bg-violet-400/10"
      : "border-white/10 bg-white/8";

  const titleClass =
    tone === "good"
      ? "text-emerald-100"
    : tone === "warn"
      ? "text-amber-100"
    : tone === "bad"
      ? "text-rose-100"
    : tone === "active"
      ? "text-sky-100"
    : tone === "purple"
      ? "text-violet-100"
      : "text-white";

  const descriptionClass =
    tone === "good"
      ? "text-emerald-50/75"
    : tone === "warn"
      ? "text-amber-50/75"
    : tone === "bad"
      ? "text-rose-50/75"
    : tone === "active"
      ? "text-sky-50/75"
    : tone === "purple"
      ? "text-violet-50/75"
      : "text-sky-100/70";

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`group flex min-h-[76px] w-full items-start justify-between gap-3 rounded-xl border p-3 text-left shadow-[0_12px_30px_rgba(2,8,23,0.18)] transition hover:-translate-y-px hover:border-white/30 hover:bg-white/12 hover:shadow-[0_18px_38px_rgba(2,8,23,0.24)] ${toneClass}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          {Icon ? (
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${toneClass}`}>
              <Icon className={`h-4 w-4 ${titleClass}`} aria-hidden="true" />
            </div>
          ) : null}
          <div className={`text-xs font-semibold uppercase tracking-[0.14em] ${titleClass}`}>{title}</div>
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <div className={`text-xl font-bold leading-none ${titleClass}`}>
            {typeof count === "number" ? Number(count).toLocaleString() : "0"}
          </div>
          <div className={`pb-0.5 text-sm font-medium leading-5 ${descriptionClass}`}>
            items
          </div>
          <div className={`ml-auto text-lg font-semibold leading-none ${titleClass}`}>
            {currency(amount)}
          </div>
        </div>
        <div className={`mt-1 text-xs leading-5 ${descriptionClass}`}>{description}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-100/70 opacity-0 transition group-hover:opacity-100">
          View
        </div>
        <ChevronRight className="h-4 w-4 text-sky-100/60 transition group-hover:text-white" />
      </div>
    </button>
  );
}


/* ========================================================================== */
/* =================  INLINE: ExpenseRequestModal (no import)  ============== */
/* ========================================================================== */
function ExpenseRequestModal({ isOpen, onClose, defaultAgreementId = null }) {
  const [agreements, setAgreements] = useState([]);
  const [sub, setSub] = useState(false);

  const [form, setForm] = useState({
    agreement: defaultAgreementId || "",
    description: "",
    amount: "",
    incurred_date: new Date().toISOString().slice(0, 10),
    notes_to_homeowner: "",
    request_kind: "direct_expense",
    category: "materials",
    file: null,
  });

  useEffect(() => {
    const loadAgreements = async () => {
      try {
        const { data } = await api.get("/projects/agreements/");
        const list = Array.isArray(data?.results) ? data.results : data || [];
        setAgreements(list);
      } catch (e) {
        console.error(e);
      }
    };
    if (isOpen) {
      loadAgreements();
      setForm((f) => ({ ...f, agreement: defaultAgreementId || "" }));
    }
  }, [isOpen, defaultAgreementId]);

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  const onFile = (e) => setForm({ ...form, file: e.target.files?.[0] || null });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.description.trim() || !form.amount) {
      toast.error("Description and amount are required.");
      return;
    }
    if (form.request_kind === "escrow_reimbursement" && (!form.agreement || !form.file)) {
      toast.error("Escrow reimbursements require an agreement and receipt or proof.");
      return;
    }
    try {
      setSub(true);
      const fd = new FormData();
      if (form.agreement) fd.append("agreement", form.agreement);
      fd.append("description", form.description.trim());
      fd.append("amount", form.amount);
      if (form.incurred_date) fd.append("incurred_date", form.incurred_date);
      if (form.notes_to_homeowner) fd.append("notes_to_homeowner", form.notes_to_homeowner);
      fd.append("request_kind", form.request_kind);
      fd.append("category", form.category);
      if (form.file) fd.append("receipt", form.file);

      const createRes = await api.post("/projects/expense-requests/", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const created = createRes.data;

      if (form.request_kind === "escrow_reimbursement") {
        toast.success("Reimbursement submitted for customer approval.");
        onClose(true);
        return;
      }

      await api.post(`/projects/expense-requests/${created.id}/contractor_sign/`);
      await api.post(`/projects/expense-requests/${created.id}/send_to_homeowner/`);

      toast.success("Expense sent to customer.");
      onClose(true);
    } catch (e) {
      console.error(e);
      toast.error("Failed to create/send expense.");
    } finally {
      setSub(false);
    }
  };

  const primaryExpenseActionLabel =
    form.request_kind === "escrow_reimbursement"
      ? "Submit for Approval"
      : "Sign & Send to Customer";

  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={() => onClose(false)}
      className="max-w-2xl w-[90vw] bg-white rounded-xl shadow-2xl p-6 mx-auto mt-24 outline-none"
      overlayClassName="fixed inset-0 bg-black/50 flex items-start justify-center"
    >
      <div className="flex items-start justify-between mb-4">
        <h2 className="text-xl font-semibold">New Expense</h2>
        <button onClick={() => onClose(false)} className="px-3 py-1.5 rounded-lg border" type="button">
          Close
        </button>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-700 mb-1">Agreement (optional)</label>
            <select
              name="agreement"
              value={form.agreement}
              onChange={onChange}
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="">— None —</option>
              {agreements.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title || `Agreement #${a.id}`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">Incurred Date</label>
            <input
              type="date"
              name="incurred_date"
              value={form.incurred_date}
              onChange={onChange}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">Request Type</label>
            <select
              name="request_kind"
              value={form.request_kind}
              onChange={onChange}
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="direct_expense">Customer Direct Pay</option>
              <option value="escrow_reimbursement">Escrow Reimbursement</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">Category</label>
            <select
              name="category"
              value={form.category}
              onChange={onChange}
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="materials">Materials</option>
              <option value="permit">Permit</option>
              <option value="rental">Rental</option>
              <option value="delivery">Delivery</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm text-gray-700 mb-1">Description</label>
            <input
              name="description"
              value={form.description}
              onChange={onChange}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="e.g. Dump fee, rental, small materials"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">Amount</label>
            <input
              type="number"
              step="0.01"
              name="amount"
              value={form.amount}
              onChange={onChange}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">Receipt (PDF or Image)</label>
            <input type="file" accept="image/*,pdf" onChange={onFile} className="w-full" />
          </div>
        </div>

        {form.request_kind === "escrow_reimbursement" ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Escrow reimbursements require a signed, funded escrow agreement and receipt or
            proof. The customer must approve before any escrow release is recorded.
          </div>
        ) : null}

        <div>
          <label className="block text-sm text-gray-700 mb-1">Notes to Customer (optional)</label>
          <textarea
            name="notes_to_homeowner"
            value={form.notes_to_homeowner}
            onChange={onChange}
            className="w-full border rounded-lg px-3 py-2 min-h-[90px]"
            placeholder="Explain why this expense is needed."
          />
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onClose(false)} className="px-4 py-2 rounded-lg border">
            Cancel
          </button>
          <button
            type="submit"
            disabled={sub}
            className={`px-4 py-2 rounded-lg text-white font-semibold ${
              sub ? "bg-gray-500" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {sub ? "Sending…" : primaryExpenseActionLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ========================================================================== */
/* ======================= Earned Drilldown Modal =========================== */
/* ========================================================================== */

function agreementKeyFromItem(item, fallbackPrefix) {
  const agId =
    item?.agreement_id ??
    item?.agreement ??
    item?.agreement?.id ??
    item?.agreementId ??
    null;

  if (agId != null && String(agId).trim() !== "") return `ag-${agId}`;
  return `${fallbackPrefix}-no-agreement`;
}

function agreementTitleFromItem(item, fallbackTitle = "Other (No Agreement)") {
  const t =
    item?.agreement_title ||
    item?.agreementTitle ||
    item?.agreement?.title ||
    item?.agreement?.project_title ||
    item?.project_title ||
    item?.projectTitle ||
    "";

  const agId =
    item?.agreement_id ??
    item?.agreement ??
    item?.agreement?.id ??
    item?.agreementId ??
    null;

  if (t && String(t).trim()) return String(t);
  if (agId != null && String(agId).trim() !== "") return `Agreement #${agId}`;
  return fallbackTitle;
}

// Best-effort "earned timestamp"
function dateForInvoice(inv) {
  return (
    parseDateAny(inv?.escrow_released_at) ||
    parseDateAny(inv?.paid_at) ||
    parseDateAny(inv?.direct_pay_paid_at) ||
    parseDateAny(inv?.updated_at) ||
    parseDateAny(inv?.created_at) ||
    null
  );
}
function dateForExpense(ex) {
  return (
    parseDateAny(ex?.paid_at) ||
    parseDateAny(ex?.updated_at) ||
    parseDateAny(ex?.created_at) ||
    null
  );
}

function EarnedBreakdownModal({ isOpen, onClose, invoices, expenses, loading }) {
  const [range, setRange] = useState("30d"); // 30d | month | year | all
  const [openAgreements, setOpenAgreements] = useState({});

  useEffect(() => {
    if (!isOpen) return;
    setOpenAgreements({});
    setRange("30d");
  }, [isOpen]);

  const { fromDate, toDate, rangeLabel } = useMemo(() => {
    const now = new Date();
    if (range === "month") return { fromDate: startOfMonth(now), toDate: null, rangeLabel: "This Month" };
    if (range === "year") return { fromDate: startOfYear(now), toDate: null, rangeLabel: "This Year" };
    if (range === "all") return { fromDate: null, toDate: null, rangeLabel: "All Time" };
    return { fromDate: daysAgo(30), toDate: null, rangeLabel: "Last 30 Days" };
  }, [range]);

  const filtered = useMemo(() => {
    const invList = Array.isArray(invoices) ? invoices : [];
    const expList = Array.isArray(expenses) ? expenses : [];

    const escrow = invList.filter(
      (inv) => inv?.escrow_released === true || inv?.escrow_released === 1 || inv?.escrow_released === "true"
    );

    const directPay = invList.filter((inv) => {
      const st = norm(inv?.status);
      const hasDirectPayStamp =
        !!inv?.direct_pay_paid_at ||
        !!inv?.direct_pay_payment_intent_id ||
        !!inv?.direct_pay_checkout_session_id ||
        !!inv?.direct_pay_checkout_url;
      const looksPaid = st === "paid" || st.includes("paid") || norm(inv?.display_status) === "paid";
      return hasDirectPayStamp && looksPaid;
    });

    const escrowR = escrow.filter((inv) => inRange(dateForInvoice(inv), fromDate, toDate));
    const directR = directPay.filter((inv) => inRange(dateForInvoice(inv), fromDate, toDate));
    const expR = expList.filter(
      (ex) => (norm(ex?.status) === "paid" || !!ex?.paid_at) && inRange(dateForExpense(ex), fromDate, toDate)
    );

    return { escrow: escrowR, directPay: directR, expenses: expR };
  }, [invoices, expenses, fromDate, toDate]);

  const grouped = useMemo(() => {
    const map = new Map();

    function ensureGroup(key, title) {
      if (!map.has(key)) {
        map.set(key, { key, title, escrow: [], directPay: [], expenses: [] });
      }
      return map.get(key);
    }

    for (const inv of filtered.escrow) {
      const k = agreementKeyFromItem(inv, "inv");
      const title = agreementTitleFromItem(inv);
      ensureGroup(k, title).escrow.push(inv);
    }
    for (const inv of filtered.directPay) {
      const k = agreementKeyFromItem(inv, "inv");
      const title = agreementTitleFromItem(inv);
      ensureGroup(k, title).directPay.push(inv);
    }
    for (const ex of filtered.expenses) {
      const k = agreementKeyFromItem(ex, "exp");
      const title = agreementTitleFromItem(ex, "Other (No Agreement)");
      ensureGroup(k, title).expenses.push(ex);
    }

    const arr = Array.from(map.values()).map((g) => {
      const escrowAmt = sum(g.escrow);
      const directAmt = sum(g.directPay);
      const expAmt = sum(g.expenses);
      return { ...g, escrowAmt, directAmt, expAmt, totalAmt: escrowAmt + directAmt + expAmt };
    });

    arr.sort((a, b) => (b.totalAmt || 0) - (a.totalAmt || 0));
    return arr;
  }, [filtered]);

  const totals = useMemo(() => {
    const escrowAmt = sum(filtered.escrow);
    const directAmt = sum(filtered.directPay);
    const expAmt = sum(filtered.expenses);
    return {
      escrowAmt,
      directAmt,
      expAmt,
      totalAmt: escrowAmt + directAmt + expAmt,
      escrowCount: filtered.escrow.length,
      directCount: filtered.directPay.length,
      expCount: filtered.expenses.length,
    };
  }, [filtered]);

  const toggleAgreement = (key) => setOpenAgreements((prev) => ({ ...prev, [key]: !prev[key] }));

  const rowStyle = {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "8px 0",
    borderBottom: "1px solid #f1f5f9",
    fontSize: 13,
  };

  const renderInvoiceRow = (inv) => {
    const label = inv?.invoice_number ? `Invoice ${inv.invoice_number}` : inv?.id ? `Invoice #${inv.id}` : "Invoice";
    const sub = inv?.title || inv?.milestone_title || inv?.description || "";
    return (
      <div key={`inv-${inv.id || Math.random()}`} style={rowStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, color: "#0f172a" }}>{label}</div>
          {sub ? (
            <div style={{ color: "#64748b", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {sub}
            </div>
          ) : null}
        </div>
        <div style={{ fontWeight: 900 }}>{currency(inv?.amount || 0)}</div>
      </div>
    );
  };

  const renderExpenseRow = (ex) => {
    const label = ex?.id ? `Expense #${ex.id}` : "Expense";
    const sub = ex?.description || "";
    return (
      <div key={`ex-${ex.id || Math.random()}`} style={rowStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, color: "#0f172a" }}>{label}</div>
          {sub ? (
            <div style={{ color: "#64748b", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {sub}
            </div>
          ) : null}
        </div>
        <div style={{ fontWeight: 900 }}>{currency(ex?.amount || 0)}</div>
      </div>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={() => onClose()}
      className="max-w-4xl w-[94vw] bg-white rounded-xl shadow-2xl p-6 mx-auto mt-16 outline-none"
      overlayClassName="fixed inset-0 bg-black/50 flex items-start justify-center"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-xl font-semibold">Earned Breakdown</div>
          <div className="text-sm text-slate-600">
            {rangeLabel} • Total: {currency(totals.totalAmt)}
          </div>
        </div>

        <button onClick={() => onClose()} type="button" className="px-3 py-2 rounded-lg border flex items-center gap-2">
          <X size={16} />
          Close
        </button>
      </div>

      <div className="flex flex-wrap gap-2 items-center mb-4">
        <div className="text-sm text-slate-700 font-semibold">Range:</div>
        <select value={range} onChange={(e) => setRange(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
          <option value="30d">Last 30 Days</option>
          <option value="month">This Month</option>
          <option value="year">This Year</option>
          <option value="all">All Time</option>
        </select>

        <div className="text-xs text-slate-500" style={{ marginLeft: 8 }}>
          Escrow: {totals.escrowCount} • {currency(totals.escrowAmt)} &nbsp;|&nbsp;
          Direct Pay: {totals.directCount} • {currency(totals.directAmt)} &nbsp;|&nbsp;
          Expenses: {totals.expCount} • {currency(totals.expAmt)}
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-600">Loading earned items…</div>
      ) : grouped.length ? (
        <div style={{ maxHeight: "70vh", overflow: "auto", paddingRight: 4 }}>
          {grouped.map((g) => {
            const open = !!openAgreements[g.key];
            const totalCount = (g.escrow?.length || 0) + (g.directPay?.length || 0) + (g.expenses?.length || 0);

            return (
              <div
                key={g.key}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 14,
                  padding: 12,
                  marginBottom: 12,
                  background: "#fff",
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleAgreement(g.key)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {g.title}
                      </div>
                      <div style={{ color: "#64748b", fontSize: 12 }}>
                        {totalCount} item{totalCount === 1 ? "" : "s"} • Total {currency(g.totalAmt)}
                        {g.escrow?.length ? ` • Escrow ${g.escrow.length} (${currency(g.escrowAmt)})` : ""}
                        {g.directPay?.length ? ` • Direct ${g.directPay.length} (${currency(g.directAmt)})` : ""}
                        {g.expenses?.length ? ` • Expenses ${g.expenses.length} (${currency(g.expAmt)})` : ""}
                      </div>
                    </div>
                  </div>

                  <div style={{ fontWeight: 900, color: "#111827" }}>{currency(g.totalAmt)}</div>
                </button>

                {open ? (
                  <div style={{ marginTop: 10 }}>
                    {g.escrow?.length ? (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontWeight: 900, fontSize: 13, color: "#0f172a", marginBottom: 4 }}>
                          Escrow Releases • {g.escrow.length} • {currency(g.escrowAmt)}
                        </div>
                        <div style={{ borderTop: "1px solid #f1f5f9" }}>{g.escrow.map((inv) => renderInvoiceRow(inv))}</div>
                      </div>
                    ) : null}

                    {g.directPay?.length ? (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontWeight: 900, fontSize: 13, color: "#0f172a", marginBottom: 4 }}>
                          Direct Pay • {g.directPay.length} • {currency(g.directAmt)}
                        </div>
                        <div style={{ borderTop: "1px solid #f1f5f9" }}>{g.directPay.map((inv) => renderInvoiceRow(inv))}</div>
                      </div>
                    ) : null}

                    {g.expenses?.length ? (
                      <div style={{ marginBottom: 2 }}>
                        <div style={{ fontWeight: 900, fontSize: 13, color: "#0f172a", marginBottom: 4 }}>
                          Expenses Paid • {g.expenses.length} • {currency(g.expAmt)}
                        </div>
                        <div style={{ borderTop: "1px solid #f1f5f9" }}>{g.expenses.map((ex) => renderExpenseRow(ex))}</div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-sm text-slate-500">No earned items in this range.</div>
      )}
    </Modal>
  );
}

/* ========================================================================== */
/* ========================= GREETING BAND ================================== */
/* ========================================================================== */

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// Extract a leading number from an action's description, e.g. "3 agreements are…" → 3.
function extractDescriptionCount(action) {
  const m = String(action?.description || "").match(/^(\d+)/);
  return m ? Number(m[1]) : 1;
}

// Build a natural one-sentence summary from the prioritised next actions.
// Max 2 noun phrases, overdue/signatures lead. Empty list → clear message.
// profileScore: 0-100 numeric; phrase added only when score < 85 (not at 89% or 95%).
function buildSummaryLine(actions, isWelcomeBack, profileScore) {
  const profileLow = typeof profileScore === "number" && profileScore > 0 && profileScore < 85;

  if (!actions.length) {
    if (profileLow) return `Your profile needs attention — score is ${profileScore}%.`;
    return isWelcomeBack
      ? "Your queue looks clear since your last visit."
      : "Everything looks clear — no urgent items right now.";
  }

  const find = (keyTest) => actions.find((a) => keyTest(String(a.key || "")));

  const sigItem     = find((k) => k === "agreements-awaiting-signature");
  const draftItem   = find((k) => k.startsWith("agreement-draft:"));
  const payItem     = find((k) => k === "invoices-pending-approval");
  const approvedItem= find((k) => k.startsWith("invoice-approved:"));
  const submitted   = find((k) => k === "milestone-submitted-review");
  const disputed    = find((k) => k === "invoices-disputed");

  const phrases = [];

  if (sigItem) {
    const n = extractDescriptionCount(sigItem);
    phrases.push(
      n === 1 ? "1 agreement waiting on a signature" : `${n} agreements waiting on signatures`
    );
  }

  if (draftItem && phrases.length < 2) {
    phrases.push("a draft ready to send");
  }

  if (payItem && phrases.length < 2) {
    const n = extractDescriptionCount(payItem);
    phrases.push(
      n === 1 ? "1 payment request pending approval" : `${n} payment requests pending`
    );
  }

  if (submitted && phrases.length < 2) {
    const n = extractDescriptionCount(submitted);
    phrases.push(
      n === 1 ? "submitted work awaiting review" : `${n} milestones awaiting review`
    );
  }

  if (disputed && phrases.length < 2) {
    const n = extractDescriptionCount(disputed);
    phrases.push(n === 1 ? "1 payment dispute to resolve" : `${n} payment disputes to resolve`);
  }

  if (approvedItem && phrases.length < 2) {
    phrases.push("an approved payment ready to release");
  }

  // Profile phrase always goes last and only when score is notably low.
  if (profileLow && phrases.length < 2) {
    phrases.push("your profile needs attention");
  }

  if (!phrases.length) {
    const total = actions.length;
    return isWelcomeBack
      ? "A few things need your attention since your last visit."
      : `You have ${total} item${total !== 1 ? "s" : ""} needing attention.`;
  }

  const body =
    phrases.length === 1
      ? `You have ${phrases[0]}.`
      : phrases.length === 2
      ? `You have ${phrases[0]} and ${phrases[1]}.`
      : `You have ${phrases[0]}, ${phrases[1]}, and ${phrases[2]}.`;

  // The welcome-back prefix lives on the greeting line — keep sentence neutral.
  return body;
}

function DashboardGreeting({ firstName, daysSince, briefingItems, profileScore, onOpenCopilot }) {
  const isWelcomeBack = Number(daysSince) >= 7;
  const greeting = getTimeGreeting();
  const summary = buildSummaryLine(briefingItems, isWelcomeBack, profileScore);

  return (
    <div
      data-testid="dashboard-greeting-band"
      className="rounded-[28px] border border-sky-200/20 bg-[linear-gradient(145deg,#020b1f_0%,#0e2d5b_54%,#155ea8_100%)] p-5 shadow-[0_22px_50px_rgba(2,8,23,0.34)]"
    >
      <div className="text-sm font-semibold text-sky-100/90">
        {isWelcomeBack ? "Welcome back — " : ""}
        {greeting}{firstName ? `, ${firstName}` : ""}.
      </div>

      <div className="mt-1.5 text-sm text-sky-100/75">{summary}</div>

      <div className="mt-4">
        <button
          type="button"
          data-testid="dashboard-greeting-open-copilot"
          onClick={onOpenCopilot}
          className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-[#0a2550] shadow-sm hover:bg-sky-50 transition"
        >
          Open Assistant →
        </button>
      </div>
    </div>
  );
}

function ActivationChecklistItem({ item, onNavigate }) {
  const complete = Boolean(item.complete);
  return (
    <article
      data-testid={`contractor-activation-check-${item.key}`}
      className={`rounded-2xl border p-4 ${
        complete
          ? "border-emerald-300/25 bg-emerald-400/10"
          : item.required
          ? "border-amber-300/25 bg-slate-950/55"
          : "border-slate-700 bg-slate-950/40"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 ${complete ? "text-emerald-300" : "text-slate-500"}`}>
          {complete ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : <Circle className="h-5 w-5" aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-bold text-white">{item.title}</h4>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${complete ? "border-emerald-300/35 bg-emerald-400/10 text-emerald-100" : "border-slate-600 bg-slate-900 text-slate-300"}`}>
              {complete ? "Complete" : item.required ? "Required" : "Optional"}
            </span>
          </div>
          <p className="mt-1 text-sm leading-5 text-sky-100/70">
            {complete ? item.completeText || "Done." : item.description}
          </p>
          {!complete && item.blockedReason ? (
            <p className="mt-2 text-xs font-semibold text-amber-100">{item.blockedReason}</p>
          ) : null}
          {!complete && item.href ? (
            <button
              type="button"
              onClick={() => onNavigate?.(item.href)}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold text-white transition hover:border-amber-300/50 hover:bg-white/15"
              data-testid={`contractor-activation-action-${item.key}`}
            >
              {item.actionLabel || "Complete step"}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ContractorActivationChecklist({
  contractorProfile,
  stripeStatus,
  agreements = [],
  publicLeads = [],
  onNavigate,
}) {
  if (!contractorProfile) return null;

  const stripeReady = isStripeReadyForActivation(contractorProfile, stripeStatus);
  const hasBusiness = Boolean(
    activationValue(
      contractorProfile.business_name,
      contractorProfile.company_name,
      contractorProfile.display_name,
      contractorProfile.name
    )
  );
  const hasServiceArea = hasContractorServiceArea(contractorProfile);
  const hasTrade = hasContractorTradeInfo(contractorProfile);
  const verificationStatus = String(
    contractorProfile.marketplace_verification_status || contractorProfile.verification_status || "unverified"
  ).toLowerCase();
  const verificationComplete = ["verified", "pending_review"].includes(verificationStatus);
  const hasLogo = Boolean(
    activationValue(contractorProfile.logo, contractorProfile.logo_url, contractorProfile.public_profile?.logo_url)
  );
  const hasCompliance = Boolean(
    activationValue(
      contractorProfile.license_number,
      contractorProfile.license_file,
      contractorProfile.insurance_file,
      contractorProfile.insurance_status?.has_insurance
    )
  );
  const hasFirstTemplateOrAgreement = Number(agreements.length || 0) > 0;
  const hasOpportunity = Number(publicLeads.length || 0) > 0;
  const status = marketplaceStatusFromProfile(contractorProfile, stripeStatus);
  const requiredItems = [
    {
      key: "business-profile",
      title: "Complete business profile",
      description: "Add the business name and contact details customers will see on agreements and invoices.",
      completeText: "Business identity is ready for customer-facing records.",
      complete: hasBusiness,
      required: true,
      href: "/app/profile",
      actionLabel: "Open Profile",
    },
    {
      key: "service-area",
      title: "Add service area",
      description: "Set your city, state, ZIP, and service radius for local marketplace matching.",
      completeText: "Service area is available for local matching.",
      complete: hasServiceArea,
      required: true,
      href: "/app/profile",
      actionLabel: "Add Service Area",
    },
    {
      key: "trade-category",
      title: "Add trade/category",
      description: "Select the trades you offer so requests, templates, and compliance guidance stay relevant.",
      completeText: "Trade profile is ready.",
      complete: hasTrade,
      required: true,
      href: "/app/profile",
      actionLabel: "Choose Trades",
    },
    {
      key: "stripe",
      title: "Connect Stripe",
      description: "Connect Stripe before escrow, invoice, and payout workflows can fully activate.",
      completeText: "Stripe is connected for payment workflows.",
      complete: stripeReady,
      required: true,
      href: "/app/onboarding/stripe",
      actionLabel: "Connect Stripe",
    },
    {
      key: "verification",
      title: "Submit/complete verification",
      description: "Submit marketplace verification so customers can compare and award bids confidently.",
      completeText:
        verificationStatus === "verified" ? "Marketplace verification is approved." : "Marketplace verification is in review.",
      complete: verificationComplete,
      required: true,
      href: "/app/public-presence",
      actionLabel: "Open Marketplace Profile",
      blockedReason: !stripeReady ? "Stripe setup may be required before marketplace eligibility is complete." : "",
    },
  ];
  const optionalItems = [
    {
      key: "logo",
      title: "Add logo/profile photo",
      description: "Add a brand image for customer-facing agreements, invoices, and profile pages.",
      complete: hasLogo,
      href: "/app/profile",
      actionLabel: "Add Logo",
    },
    {
      key: "license-insurance",
      title: "Add insurance/license details",
      description: "Upload license or insurance details where they apply to your trade and state.",
      complete: hasCompliance,
      href: "/app/profile",
      actionLabel: "Add Compliance Details",
    },
    {
      key: "first-template",
      title: "Create first template",
      description: "Save a reusable scope and milestone plan so future agreements start faster.",
      complete: hasFirstTemplateOrAgreement,
      href: "/app/templates",
      actionLabel: "Open Templates",
    },
    {
      key: "first-opportunity",
      title: "Review first opportunity",
      description: "Marketplace leads and customer opportunities will appear here once you are eligible.",
      complete: hasOpportunity,
      href: "/app/bids",
      actionLabel: "Open Opportunities",
    },
  ];

  return (
    <DashboardCard
      testId="contractor-activation-checklist"
      tone="premium"
      className="p-5 shadow-[0_24px_55px_rgba(2,8,23,0.34)]"
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-amber-300/35 bg-amber-300/15 text-amber-100">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.22em] text-amber-200">Activation</div>
              <h2 className="mt-1 text-2xl font-black text-white">Get marketplace ready</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-sky-100/72">
                Finish the essentials that let customers find you, compare bids, sign agreements, and pay through MyHomeBro.
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {requiredItems.map((item) => (
              <ActivationChecklistItem key={item.key} item={item} onNavigate={onNavigate} />
            ))}
          </div>
          <div className="mt-5">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-sky-100/55">Optional next steps</div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {optionalItems.map((item) => (
                <ActivationChecklistItem key={item.key} item={item} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        </div>
        <aside
          data-testid="contractor-marketplace-eligibility-panel"
          className="rounded-3xl border border-white/10 bg-slate-950/55 p-5"
        >
          <div className="flex items-start gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${activationToneClasses(status.tone)}`}>
              {status.tone === "danger" ? <ShieldAlert className="h-5 w-5" /> : <BadgeCheck className="h-5 w-5" />}
            </span>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.2em] text-sky-100/55">Marketplace eligibility</div>
              <div className="mt-1 text-xl font-black text-white">{status.label}</div>
              <p className="mt-2 text-sm leading-6 text-sky-100/72">{status.reason}</p>
            </div>
          </div>
          <div className="mt-5 space-y-2 text-sm">
            {[
              ["Business profile", hasBusiness],
              ["Service area", hasServiceArea],
              ["Trade/category", hasTrade],
              ["Stripe ready", stripeReady],
              ["Verification", verificationComplete],
            ].map(([label, complete]) => (
              <div key={label} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                <span className="text-sky-100/75">{label}</span>
                <span className={complete ? "font-bold text-emerald-200" : "font-bold text-amber-100"}>
                  {complete ? "Ready" : "Needed"}
                </span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </DashboardCard>
  );
}

/* ========================================================================== */
/* =============================== MAIN VIEW ================================= */
/* ========================================================================== */
export default function ContractorDashboard() {
  const { ready: authReady, isAuthed } = useAuth();
  const [who, setWho] = useState(null);
  const [contractorProfile, setContractorProfile] = useState(null);

  // Onboarding detection — shown on Dashboard, never on AI Workspace
  const [loginExperience, setLoginExperience] = useState(null); // null = still loading
  const [onboardingProfile, setOnboardingProfile] = useState(null);
  const [onboardingStripe, setOnboardingStripe] = useState(null);
  const [daysSinceLogin, setDaysSinceLogin] = useState(0);
  const [activityFeed, setActivityFeed] = useState([]);
  const [nextBestAction, setNextBestAction] = useState(null);
  const [activationSummary, setActivationSummary] = useState(null);
  const [dismissedContextualGuides, setDismissedContextualGuides] = useState(new Set());
  const [contextualGuideSuppressed, setContextualGuideSuppressed] = useState(false);

  const [agreements, setAgreements] = useState([]);
  const [publicLeads, setPublicLeads] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [drawRequests, setDrawRequests] = useState([]);
  const [payoutHistoryLoading, setPayoutHistoryLoading] = useState(true);
  const [payoutHistorySummary, setPayoutHistorySummary] = useState(null);
  const [payoutHistoryRecent, setPayoutHistoryRecent] = useState([]);
  const [bidsSnapshotLoading, setBidsSnapshotLoading] = useState(true);
  const [bidsSnapshotSummary, setBidsSnapshotSummary] = useState(null);
  const [bidsSnapshotRecent, setBidsSnapshotRecent] = useState([]);

  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showAllNextActions, setShowAllNextActions] = useState(false);

  // Earned modal + paid expenses cache
  const [showEarnedModal, setShowEarnedModal] = useState(false);
  const [earnedLoading, setEarnedLoading] = useState(false);
  const [earnedExpenses, setEarnedExpenses] = useState([]);
  const [earnedExpensesLoading, setEarnedExpensesLoading] = useState(false);

  const navigate = useNavigate();
  const { openAssistant } = useAssistantDock();

  // Intro pricing countdown state (60-day intro) — contractor only
  const [introDaysRemaining, setIntroDaysRemaining] = useState(null);
  const [introActive, setIntroActive] = useState(false);

  // Pricing card — contractor only
  const [pricing, setPricing] = useState({
    loading: true,
    rate: null,
    fixed_fee: 1,
    is_intro: null,
    tier_name: null,
    error: "",
  });

  // plan/billing snapshot
  const [planInfo, setPlanInfo] = useState({
    loading: true,
    planLabel: "Included",
    directPayLabel: DIRECT_PAY_LABEL,
  });

  const role = who?.role || "";
  const isEmployee = role && String(role).startsWith("employee_");

  // Route bases
  const APP_BASE = "/app";
  const EMP_BASE = "/app/employee";
  const BASE = isEmployee ? EMP_BASE : APP_BASE;

  /* ----- whoami ----- */
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!authReady || !isAuthed) return;
      try {
        const { data } = await api.get("/projects/whoami/");
        if (!mounted) return;
        setWho(data || null);
      } catch (e) {
        console.error(e);
        if (!mounted) return;
        setWho(null);
      }
    })();
    return () => (mounted = false);
  }, [authReady, isAuthed]);

  /* ----- onboarding / login experience detection ----- */
  useEffect(() => {
    const days = getDaysSinceLastLogin();
    setDaysSinceLogin(days);
    recordLoginTimestamp();

    async function detectExperience() {
      try {
        const [profileRes, stripeRes, agreementsRes] = await Promise.allSettled([
          api.get("/projects/contractors/me/"),
          api.get("/payments/onboarding/status/"),
          api.get("/projects/agreements/"),
        ]);
        const profile = profileRes.status === "fulfilled" ? (profileRes.value?.data || {}) : {};
        const stripe = stripeRes.status === "fulfilled" ? (stripeRes.value?.data || {}) : {};
        const agreementsData = agreementsRes.status === "fulfilled"
          ? (agreementsRes.value?.data?.results ?? agreementsRes.value?.data ?? [])
          : [];
        const jobCount = Array.isArray(agreementsData) ? agreementsData.length : 0;
        setOnboardingProfile(profile);
        setOnboardingStripe(stripe);
        setLoginExperience(detectLoginExperience(profile, jobCount, days));
      } catch {
        setLoginExperience("daily_briefing");
      }
    }
    detectExperience();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ----- load dashboard data ----- */
  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!who) return;

      try {
        if (isEmployee) {
          const mRes = await api.get("/projects/employee/milestones/");
          if (!mounted) return;
          const list = Array.isArray(mRes.data?.milestones) ? mRes.data.milestones : [];
          setMilestones(list);
          setInvoices([]);
          setDrawRequests([]);
          return;
        }

        const [mRes, iRes, aRes, lRes, oRes, dRes, actRes] = await Promise.allSettled([
          api.get("/projects/milestones/"),
          api.get("/projects/invoices/"),
          api.get("/projects/agreements/"),
          api.get("/projects/contractor/public-leads/"),
          api.get("/projects/contractor-opportunities/"),
          getContractorDrawRequests(),
          api.get("/projects/contractor-activation-summary/"),
        ]);

        if (!mounted) return;

        if (mRes.status === "fulfilled") {
          const list = Array.isArray(mRes.value.data) ? mRes.value.data : mRes.value.data?.results || [];
          setMilestones(list);
        } else {
          console.error(mRes.reason);
          toast.error("Failed to load milestones.");
        }

        if (iRes.status === "fulfilled") {
          const list = Array.isArray(iRes.value.data) ? iRes.value.data : iRes.value.data?.results || [];
          setInvoices(list);
        } else {
          console.error(iRes.reason);
          toast.error("Failed to load invoices.");
        }

        if (aRes.status === "fulfilled") {
          const list = Array.isArray(aRes.value.data)
            ? aRes.value.data
            : aRes.value.data?.results || [];
          setAgreements(list);
        } else {
          console.error(aRes.reason);
          setAgreements([]);
        }

        if (lRes.status === "fulfilled" || oRes.status === "fulfilled") {
          const list = lRes.status === "fulfilled"
            ? Array.isArray(lRes.value.data)
              ? lRes.value.data
              : lRes.value.data?.results || []
            : [];
          const opportunityList = oRes.status === "fulfilled"
            ? Array.isArray(oRes.value.data)
              ? oRes.value.data
              : oRes.value.data?.results || []
            : [];
          setPublicLeads([...list, ...opportunityList]);
        } else {
          console.error(lRes.reason);
          setPublicLeads([]);
        }

        if (dRes.status === "fulfilled") {
          const list = Array.isArray(dRes.value?.results)
            ? dRes.value.results
            : Array.isArray(dRes.value?.data)
            ? dRes.value.data
            : dRes.value?.data?.results || [];
          setDrawRequests(list);
        } else {
          console.error(dRes.reason);
          setDrawRequests([]);
        }

        if (actRes.status === "fulfilled") {
          setActivationSummary(actRes.value.data || null);
        } else {
          console.error(actRes.reason);
          setActivationSummary(null);
        }
      } catch (e) {
        console.error(e);
        toast.error("Failed to load dashboard data.");
      }
    })();

    return () => (mounted = false);
  }, [who, isEmployee]);

  async function dismissActivationSection(section) {
    setContextualGuideSuppressed(true);
    setDismissedContextualGuides((current) => new Set([...current, section]));
    try {
      const { data } = await api.post("/projects/contractor-activation-summary/dismiss/", { section });
      setActivationSummary(data || null);
    } catch (err) {
      console.error(err);
      toast.error("Could not dismiss activation guidance.");
    }
  }

  useEffect(() => {
    let mounted = true;

    const loadPayoutHistory = async () => {
      if (!authReady || !isAuthed || !who || isEmployee) return;
      setPayoutHistoryLoading(true);
      try {
        const { data } = await api.get("/projects/contractor/payout-history/");
        if (!mounted) return;
        const rows = Array.isArray(data?.results) ? data.results : [];
        setPayoutHistorySummary(data?.summary || null);
        setPayoutHistoryRecent(rows.slice(0, 4));
      } catch (err) {
        if (!mounted) return;
        console.error("Failed to load payout history summary:", err);
        setPayoutHistorySummary(null);
        setPayoutHistoryRecent([]);
      } finally {
        if (mounted) setPayoutHistoryLoading(false);
      }
    };

    loadPayoutHistory();
    return () => {
      mounted = false;
    };
  }, [authReady, isAuthed, who, isEmployee]);

  useEffect(() => {
    let mounted = true;

    const loadBidsSnapshot = async () => {
      if (!authReady || !isAuthed || !who || isEmployee) return;
      setBidsSnapshotLoading(true);
      try {
        const { data } = await api.get("/projects/contractor/bids/");
        if (!mounted) return;
        const rows = Array.isArray(data?.results) ? data.results : [];
        setBidsSnapshotSummary(data?.summary || null);
        setBidsSnapshotRecent(rows.slice(0, 4));
      } catch (err) {
        if (!mounted) return;
        console.error("Failed to load bids snapshot:", err);
        setBidsSnapshotSummary(null);
        setBidsSnapshotRecent([]);
      } finally {
        if (mounted) setBidsSnapshotLoading(false);
      }
    };

    loadBidsSnapshot();
    return () => {
      mounted = false;
    };
  }, [authReady, isAuthed, who, isEmployee]);

  // ✅ Load PAID expenses in background so Earned card can show YTD total
  useEffect(() => {
    let mounted = true;

    const loadPaidExpenses = async () => {
      if (!who || isEmployee) return;

      setEarnedExpensesLoading(true);
      try {
        // Preferred endpoint
        const res = await api.get("/projects/expense-requests/", { params: { include_archived: 1 } });
        const list = Array.isArray(res.data) ? res.data : res.data?.results || [];
        const paidOnly = (list || []).filter((x) => norm(x?.status) === "paid" || !!x?.paid_at);

        if (!mounted) return;
        setEarnedExpenses(paidOnly);
      } catch (e) {
        console.error(e);
        try {
          // Fallback endpoint
          const res2 = await api.get("/projects/expenses/", { params: { include_archived: 1 } });
          const list2 = Array.isArray(res2.data) ? res2.data : res2.data?.results || [];
          const paidOnly2 = (list2 || []).filter((x) => norm(x?.status) === "paid" || !!x?.paid_at);

          if (!mounted) return;
          setEarnedExpenses(paidOnly2);
        } catch (e2) {
          console.error(e2);
          if (!mounted) return;
          setEarnedExpenses([]);
        }
      } finally {
        if (mounted) setEarnedExpensesLoading(false);
      }
    };

    loadPaidExpenses();
    return () => {
      mounted = false;
    };
  }, [who, isEmployee]);

  // Intro pricing + plan
  useEffect(() => {
    const fetchIntroCountdown = async () => {
      if (isEmployee) return;

      try {
        const { data } = await api.get("/projects/contractors/me/");
        setContractorProfile(data || null);

        setPlanInfo({
          loading: false,
          planLabel: planLabel(data),
          directPayLabel: directPayLabel(data),
        });

        const createdRaw =
          data.created_at ||
          data.contractor_created_at ||
          data.contractor?.created_at ||
          data.user_created_at ||
          data.user?.date_joined;

        if (!createdRaw) {
          setIntroActive(false);
          setIntroDaysRemaining(null);
          return;
        }

        const createdDate = new Date(createdRaw);
        if (Number.isNaN(createdDate.getTime())) {
          setIntroActive(false);
          setIntroDaysRemaining(null);
          return;
        }

        const INTRO_DAYS = 60;
        const nowDt = new Date();
        const msPerDay = 1000 * 60 * 60 * 24;
        const daysActive = Math.floor((nowDt.getTime() - createdDate.getTime()) / msPerDay);
        const remainingDays = INTRO_DAYS - daysActive;

        setIntroActive(remainingDays > 0);
        setIntroDaysRemaining(Math.max(0, remainingDays));
      } catch (err) {
        console.error("Failed to load contractor profile for intro countdown", err);
        setIntroActive(false);
        setIntroDaysRemaining(null);
        setPlanInfo((p) => ({ ...p, loading: false }));
      }
    };

    fetchIntroCountdown();
  }, [isEmployee]);

  useEffect(() => {
    let mounted = true;
    const loadActivityFeed = async () => {
      if (!who || isEmployee) return;
      try {
        const { data } = await api.get("/projects/activity-feed/", {
          params: { limit: 8 },
        });
        if (!mounted) return;
        setActivityFeed(Array.isArray(data?.results) ? data.results : []);
        setNextBestAction(data?.next_best_action || null);
      } catch (err) {
        console.error("Failed to load activity feed", err);
        if (!mounted) return;
        setActivityFeed([]);
        setNextBestAction(null);
      }
    };
    loadActivityFeed();
    return () => {
      mounted = false;
    };
  }, [who, isEmployee]);

  // Pricing via funding_preview (contractor-only)
  useEffect(() => {
    let mounted = true;

    const loadPricing = async () => {
      if (!authReady || !isAuthed || !who) return;
      if (isEmployee) {
        setPricing({ loading: false, rate: null, fixed_fee: 1, is_intro: null, tier_name: null, error: "" });
        return;
      }

      try {
        setPricing((p) => ({ ...p, loading: true, error: "" }));

        const { data } = await api.get("/projects/agreements/");
        const list = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];

        if (!list.length) {
          if (!mounted) return;
          setPricing({ loading: false, rate: null, fixed_fee: 1, is_intro: null, tier_name: null, error: "" });
          return;
        }

        const latest = [...list].sort((a, b) => (b?.id || 0) - (a?.id || 0))[0];
        const agreementId = latest?.id;

        if (!agreementId) {
          if (!mounted) return;
          setPricing({ loading: false, rate: null, fixed_fee: 1, is_intro: null, tier_name: null, error: "" });
          return;
        }

        const { data: fp } = await api.get(`/projects/agreements/${agreementId}/funding_preview/`);
        if (!mounted) return;

        setPricing({
          loading: false,
          rate: fp?.rate ?? null,
          fixed_fee: fp?.fixed_fee ?? 1,
          is_intro: fp?.is_intro ?? null,
          tier_name: fp?.tier_name ?? (fp?.is_intro ? "INTRO" : null),
          error: "",
        });
      } catch (err) {
        if (!mounted) return;
        setPricing({ loading: false, rate: null, fixed_fee: 1, is_intro: null, tier_name: null, error: "" });
      }
    };

    loadPricing();
    return () => {
      mounted = false;
    };
  }, [authReady, isAuthed, who, isEmployee]);

  // Build invoice lookup map (so milestones can compute Paid)
  const invoicesById = useMemo(() => {
    const map = {};
    for (const inv of Array.isArray(invoices) ? invoices : []) {
      const id = inv?.id ?? inv?.invoice_id ?? inv?.pk ?? null;
      if (id != null && String(id).trim() !== "") map[String(id)] = inv;
    }
    return map;
  }, [invoices]);
  const activeMilestonesForDashboard = useMemo(
    () => (Array.isArray(milestones) ? milestones : []).filter((m) => !isPlannedMilestoneEntry(m)),
    [milestones]
  );

  /* ----- milestone stats (aligned with MilestoneList filters) ----- */
  const mStats = useMemo(() => {
    const all = activeMilestonesForDashboard;
    const allAmt = sum(all);

    const rework = all.filter(isReworkMilestone);
    const reworkAmt = sum(rework);

    const nonRework = all.filter((m) => !isReworkMilestone(m));

    const notStarted = nonRework.filter((m) => isMilestoneNotStarted(m, invoicesById));
    const notStartedAmt = sum(notStarted);

    const inProgress = nonRework.filter((m) => isMilestoneInProgressStage(m, invoicesById));
    const inProgressAmt = sum(inProgress);

    const completed = nonRework.filter((m) => isMilestoneCompletedStage(m, invoicesById));
    const completedAmt = sum(completed);

    const reviewed = nonRework.filter((m) => isMilestoneReviewedStage(m) && !isMilestoneInvoicedStage(m, invoicesById) && !isMilestonePaid(m, invoicesById));
    const reviewedAmt = sum(reviewed);

    const invoiced = nonRework.filter((m) => isMilestoneInvoicedStage(m, invoicesById));
    const invoicedAmt = sum(invoiced);

    return {
      totalCount: all.length,
      totalAmount: allAmt,

      notStartedCount: notStarted.length,
      notStartedAmount: notStartedAmt,
      inProgressCount: inProgress.length,
      inProgressAmount: inProgressAmt,
      completedCount: completed.length,
      completedAmount: completedAmt,
      reviewedCount: reviewed.length,
      reviewedAmount: reviewedAmt,
      invoicedCount: invoiced.length,
      invoicedAmount: invoicedAmt,

      reworkCount: rework.length,
      reworkAmount: reworkAmt,
    };
  }, [activeMilestonesForDashboard, invoicesById]);

  /* ----- invoice stats ----- */
  const iStats = useMemo(() => {
    const buckets = { pending: [], approved: [], earned: [], disputed: [] };
    for (const inv of invoices) {
      const b = invBucket(inv);
      if (!buckets[b]) buckets[b] = [];
      buckets[b].push(inv);
    }
    return {
      pendingCount: buckets.pending.length,
      pendingAmount: sum(buckets.pending),
      approvedCount: buckets.approved.length,
      approvedAmount: sum(buckets.approved),
      disputedCount: buckets.disputed.length,
      disputedAmount: sum(buckets.disputed),
      earnedCount: buckets.earned.length,
      earnedAmount: sum(buckets.earned),
    };
  }, [invoices]);
  const dStats = useMemo(() => {
    const buckets = {
      awaitingApproval: [],
      paymentPending: [],
      paid: [],
      issues: [],
    };
    for (const draw of Array.isArray(drawRequests) ? drawRequests : []) {
      const workflowStatus = drawWorkflowStatus(draw);
      if (workflowStatus === "submitted") buckets.awaitingApproval.push(draw);
      else if (workflowStatus === "payment_pending" || workflowStatus === "approved") buckets.paymentPending.push(draw);
      else if (workflowStatus === "paid") buckets.paid.push(draw);
      else if (["changes_requested", "rejected", "disputed"].includes(workflowStatus)) buckets.issues.push(draw);
    }
    return {
      awaitingApprovalCount: buckets.awaitingApproval.length,
      awaitingApprovalAmount: sum(buckets.awaitingApproval, "net_amount"),
      paymentPendingCount: buckets.paymentPending.length,
      paymentPendingAmount: sum(buckets.paymentPending, "net_amount"),
      paidCount: buckets.paid.length,
      paidAmount: sum(buckets.paid, "net_amount"),
      issuesCount: buckets.issues.length,
      issuesAmount: sum(buckets.issues, "net_amount"),
      requestedChangesCount: buckets.issues.filter((draw) => drawWorkflowStatus(draw) === "changes_requested").length,
    };
  }, [drawRequests]);
  const paymentRecords = useMemo(
    () => buildUnifiedPaymentRecords({ invoices, drawRequests }),
    [invoices, drawRequests]
  );
  const paymentSummary = useMemo(() => summarizePaymentRecords(paymentRecords), [paymentRecords]);
  // ✅ Earned YTD (Jan 1 -> today) for the stat card
  const earnedYtdAmount = useMemo(() => {
    const from = startOfYear(new Date());
    const to = new Date();

    const invList = Array.isArray(invoices) ? invoices : [];
    const expList = Array.isArray(earnedExpenses) ? earnedExpenses : [];

    // escrow released invoices
    const escrowInv = invList.filter(
      (inv) => inv?.escrow_released === true || inv?.escrow_released === 1 || inv?.escrow_released === "true"
    );

    // direct pay invoices
    const directInv = invList.filter((inv) => {
      const st = norm(inv?.status);
      const hasDirectPayStamp =
        !!inv?.direct_pay_paid_at ||
        !!inv?.direct_pay_payment_intent_id ||
        !!inv?.direct_pay_checkout_session_id ||
        !!inv?.direct_pay_checkout_url;
      const looksPaid = st === "paid" || st.includes("paid") || norm(inv?.display_status) === "paid";
      return hasDirectPayStamp && looksPaid;
    });

    const escrowYtd = escrowInv.filter((inv) => inRange(dateForInvoice(inv), from, to));
    const directYtd = directInv.filter((inv) => inRange(dateForInvoice(inv), from, to));
    const expYtd = expList.filter((ex) => inRange(dateForExpense(ex), from, to));

    return sum(escrowYtd) + sum(directYtd) + sum(expYtd);
  }, [invoices, earnedExpenses]);

  const dueSchedule = useMemo(() => {
    const todayStart = startOfToday();
    const todayEnd = endOfToday();
    const tomorrowStart = startOfTomorrow();
    const tomorrowEnd = endOfTomorrow();
    const weekEnd = endOfWeek();

    const milestoneItems = activeMilestonesForDashboard
      .filter((m) => !isMilestonePaid(m, invoicesById))
      .map((m) => ({
        type: "milestone",
        amount: money(m?.amount),
        date: getMilestoneDueDate(m),
      }))
      .filter((item) => item.date);

    const invoiceItems = (invoices || [])
      .filter((inv) => {
        const bucket = invBucket(inv);
        return bucket === "pending" || bucket === "approved" || bucket === "disputed";
      })
      .map((inv) => ({
        type: "invoice",
        amount: money(inv?.amount),
        date: getInvoiceDueDate(inv),
      }))
      .filter((item) => item.date);

    const items = [...milestoneItems, ...invoiceItems];
    const summarize = (entries) => ({
      count: entries.length,
      amount: sum(entries),
    });

    return {
      late: summarize(items.filter((item) => item.date.getTime() < todayStart.getTime())),
      today: summarize(items.filter((item) => inRange(item.date, todayStart, todayEnd))),
      tomorrow: summarize(items.filter((item) => inRange(item.date, tomorrowStart, tomorrowEnd))),
      week: summarize(items.filter((item) => inRange(item.date, todayStart, weekEnd))),
    };
  }, [activeMilestonesForDashboard, invoices, invoicesById]);
  const failedPaymentItems = useMemo(
    () =>
      (Array.isArray(activityFeed) ? activityFeed : []).filter((item) => {
        const eventType = norm(item?.event_type);
        const title = norm(item?.title);
        const summary = norm(item?.summary);
        return eventType.includes("payment_failed") || title.includes("failed payment") || summary.includes("failed payment");
      }),
    [activityFeed]
  );
  const drawTableRows = useMemo(
    () =>
      (Array.isArray(drawRequests) ? drawRequests : [])
        .slice()
        .sort((a, b) => {
          const aTime =
            parseDateAny(a?.updated_at || a?.released_at || a?.paid_at || a?.submitted_at || a?.created_at)?.getTime() || 0;
          const bTime =
            parseDateAny(b?.updated_at || b?.released_at || b?.paid_at || b?.submitted_at || b?.created_at)?.getTime() || 0;
          return bTime - aTime;
        })
        .slice(0, 6),
    [drawRequests]
  );
  const paymentTableRows = useMemo(
    () =>
      [...paymentRecords]
        .sort((a, b) => {
          const aTime = parseDateAny(a?.sortDate)?.getTime() || 0;
          const bTime = parseDateAny(b?.sortDate)?.getTime() || 0;
          return bTime - aTime;
        })
        .slice(0, 8),
    [paymentRecords]
  );

  /* ----- navigation handlers ----- */
  const goNewAgreement = () => navigate(`/app/agreements`);
  const goStartWithAi = () => navigate(`/app/assistant`);
  const goStartFirstProjectWithAi = () =>
    navigate(`/app/assistant`, {
      state: {
        assistantPrompt: "Help me create my first agreement and start my first project",
        assistantContext: {
          current_route: "/app/dashboard",
          onboarding_mode: true,
          onboarding_step: "first_job",
        },
      },
    });
  const goNewIntake = () => navigate(`/app/intake/new`);
  const goNewMilestone = () => navigate(`/app/milestones?new=1`);
  const goPayments = ({ moneyStatus = "all", projectClass = "all", recordType = "all" } = {}) => {
    const params = new URLSearchParams();
    if (moneyStatus && moneyStatus !== "all") params.set("money_status", moneyStatus);
    if (projectClass && projectClass !== "all") params.set("project_class", projectClass);
    if (recordType && recordType !== "all") params.set("record_type", recordType);
    const query = params.toString();
    navigate(`/app/invoices${query ? `?${query}` : ""}`);
  };
  const goInvoices = () => goPayments();
  const goInvoicesDisputed = () => goPayments({ moneyStatus: "issues", recordType: "invoice" });
  const goCalendar = () => navigate(`/app/calendar`);
  const goAgreementScheduleLate = () => navigate(`/app/agreements?focus=schedule&range=late`);
  const goAgreementScheduleToday = () => navigate(`/app/agreements?focus=schedule&range=today`);
  const goAgreementScheduleTomorrow = () => navigate(`/app/agreements?focus=schedule&range=tomorrow`);
  const goAgreementScheduleWeek = () => navigate(`/app/agreements?focus=schedule&range=week`);
  const goDisputes = () => navigate(`/app/disputes`);
  const goReworkMilestones = () => navigate(`/app/milestones?filter=rework`);
  const goExpenses = () => navigate(`/app/expenses`);

  const openNewExpense = () => setShowExpenseModal(true);
  const onExpenseModalClose = () => setShowExpenseModal(false);
  const goDrawRequests = () => goPayments({ recordType: "draw_request" });

  const openDrawOwnerView = (draw) => {
    const url = String(draw?.public_review_url || "").trim();
    if (!url) {
      toast.error("Owner review link is not available yet.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const openDrawEditor = (draw) => {
    if (!draw?.agreement_id) {
      toast.error("Agreement details are unavailable for this draw.");
      return;
    }
    navigate(`/app/agreements/${draw.agreement_id}`);
  };

  const resendDrawLink = async (draw) => {
    if (!draw?.id) return;
    try {
      const data = await resendDrawReview(draw.id);
      setDrawRequests((current) =>
        (Array.isArray(current) ? current : []).map((item) => (item.id === draw.id ? { ...item, ...data } : item))
      );
      toast.success(data?.email_delivery?.message || "Payment request link resent.");
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.detail || "Unable to resend the payment request link.");
    }
  };

  const releaseEscrowFunds = async (draw) => {
    if (!draw?.id) return;
    try {
      const data = await releaseDrawRequest(draw.id);
      setDrawRequests((current) =>
        (Array.isArray(current) ? current : []).map((item) => (item.id === draw.id ? { ...item, ...data } : item))
      );
      toast.success("Escrow funds marked as released.");
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.detail || "Unable to release escrow funds for this draw.");
    }
  };

  const openEarnedModal = async () => {
    setShowEarnedModal(true);
    // We already loaded paid expenses in background; keep UX snappy.
    setEarnedLoading(earnedExpensesLoading);
  };

  const closeEarnedModal = () => setShowEarnedModal(false);

  /* =======================================================================
   * Pricing Card
   * ======================================================================= */
  const fixedFeeLabel = `+ $${Number(pricing.fixed_fee || 1).toFixed(0)}`;
  const ratePercentFromBackend = pricing.rate != null ? fmtRate(pricing.rate) : null;
  const isIntroTierBackend = pricing.is_intro === true || String(pricing.tier_name || "").toUpperCase() === "INTRO";

  const currentRatePercent = ratePercentFromBackend
    ? ratePercentFromBackend
    : introActive
    ? INTRO_RATE_LABEL
    : STANDARD_START_RATE_LABEL;

  const currentRateTitle = pricing.loading ? "Checking your rate…" : `Current Rate: ${currentRatePercent} ${fixedFeeLabel}`;

  const daysLeftText =
    introDaysRemaining !== null
      ? `${introDaysRemaining} day${introDaysRemaining === 1 ? "" : "s"} remaining`
      : null;

  const subtitleParts = [];
  if (!planInfo.loading) {
    subtitleParts.push(`AI: ${planInfo.planLabel}. Direct Pay: ${planInfo.directPayLabel}.`);
    subtitleParts.push("AI tools are included with your account.");
  }

  if (pricing.loading) {
    subtitleParts.push("Loading pricing…");
  } else {
    if (introActive) {
      subtitleParts.push(`Intro pricing is active (${daysLeftText || "days remaining"}).`);
      subtitleParts.push("Intro (first 60 days): 3.00% + $1.");
    } else {
      subtitleParts.push("Intro pricing window has ended.");
      subtitleParts.push("Standard escrow pricing is tiered by monthly volume.");
    }

    if (ratePercentFromBackend) {
      subtitleParts.push(isIntroTierBackend ? "This rate is based on your current intro tier." : "This rate is based on your current tier.");
    } else {
      subtitleParts.push("Create your first agreement to lock in tier calculations and previews.");
    }
  }

  const pricingSubtitle = subtitleParts.join(" ");

  const headerSubtitle = isEmployee
    ? "Here are the milestones currently assigned to you."
    : "Track milestones, invoices, leads, and next actions in one place.";
  const onboarding = contractorProfile?.onboarding || {};
  const isOnboardingComplete = useMemo(() => {
    const stripeSignals = [
      onboarding?.stripe_ready,
      contractorProfile?.stripe_ready,
      contractorProfile?.stripe_connected,
      contractorProfile?.payouts_enabled,
      contractorProfile?.charges_enabled,
      contractorProfile?.can_receive_payouts,
      contractorProfile?.stripe_status?.connected,
      contractorProfile?.stripe_status?.payouts_enabled,
      contractorProfile?.stripe_status?.charges_enabled,
      contractorProfile?.payments?.connected,
      contractorProfile?.payments?.payouts_enabled,
    ];

    const hasStripeReady =
      onboarding?.status === "complete" || stripeSignals.some((value) => value === true);

    const hasName = Boolean(
      contractorProfile?.business_name
        || contractorProfile?.company_name
        || contractorProfile?.display_name
        || contractorProfile?.name
        || contractorProfile?.full_name
    );

    const hasLocation = Boolean(
      contractorProfile?.city
        || contractorProfile?.state
        || contractorProfile?.zip
        || contractorProfile?.postal_code
        || contractorProfile?.address
        || contractorProfile?.service_area
    );

    const hasTradeInfo = Array.isArray(contractorProfile?.skills)
      ? contractorProfile.skills.length > 0
      : Boolean(
          contractorProfile?.trade
            || contractorProfile?.trade_name
            || contractorProfile?.specialty
            || contractorProfile?.project_type
        );

    return hasStripeReady && hasName && (hasLocation || hasTradeInfo);
  }, [contractorProfile, onboarding]);
  const hasProjectsStarted = useMemo(
    () => (agreements || []).length > 0 || (milestones || []).length > 0 || (invoices || []).length > 0,
    [agreements, invoices, milestones]
  );
  const sanitizedNextBestAction = useMemo(() => {
    const backendLooksLikeSetupPrompt =
      typeof nextBestAction?.title === "string"
        && /finish onboarding|finish your setup|resume onboarding|complete setup/i.test(nextBestAction.title);

    if (nextBestAction?.title && !(isOnboardingComplete && backendLooksLikeSetupPrompt)) {
      return nextBestAction;
    }

    return null;
  }, [isOnboardingComplete, nextBestAction]);
  const contractorNextActions = useMemo(
    () =>
      getContractorNextActions({
        nextBestAction: sanitizedNextBestAction,
        agreements,
        milestones,
        invoices,
        drawRequests,
        payoutHistorySummary,
        payoutHistoryRecent,
        activityFeed,
      }),
    [
      agreements,
      activityFeed,
      drawRequests,
      invoices,
      milestones,
      payoutHistoryRecent,
      payoutHistorySummary,
      sanitizedNextBestAction,
    ]
  );
  const heroAction = useMemo(() => {
    const topAction = contractorNextActions[0];
    if (topAction) {
      return {
        title: topAction.title,
        message: topAction.description,
        rationale: "",
        ctaLabel: topAction.buttonLabel,
        navigationTarget: topAction.navigationTarget,
        action: null,
      };
    }

    if (isOnboardingComplete && !hasProjectsStarted) {
      return {
        title: "Complete your next agreement with AI",
        message: "Use AI to create your next agreement and project plan. It will guide you step by step.",
        rationale: "",
        ctaLabel: "AI Workspace",
        navigationTarget: "/app/assistant",
        action: goStartFirstProjectWithAi,
      };
    }

    return {
      title: "Start your next agreement",
      message: "Use AI to quickly create your next project agreement.",
      rationale: "",
      ctaLabel: "AI Workspace",
      navigationTarget: "/app/assistant",
      action: goStartFirstProjectWithAi,
    };
  }, [contractorNextActions, goStartFirstProjectWithAi, hasProjectsStarted, isOnboardingComplete]);
  const greetingName = useMemo(() => {
    const raw =
      who?.first_name ||
      contractorProfile?.first_name ||
      contractorProfile?.display_name ||
      contractorProfile?.business_name ||
      who?.name ||
      "";
    return String(raw).trim().split(" ")[0] || "";
  }, [contractorProfile, who]);

  const profileScore = useMemo(() => {
    if (!onboardingProfile) return null;
    const { score } = calculateProfileCompleteness(onboardingProfile, {
      stripeConnected: Boolean(onboardingStripe?.connected),
      jobCount: agreements.length,
      templateCount: 0,
    });
    return score;
  }, [onboardingProfile, onboardingStripe, agreements]);

  const hasUrgentSchedule = dueSchedule.late.count > 0 || dueSchedule.today.count > 0;
  const scheduleHasItems =
    dueSchedule.late.count > 0 ||
    dueSchedule.today.count > 0 ||
    dueSchedule.tomorrow.count > 0 ||
    dueSchedule.week.count > 0;
  const workMoneyConnectorLabel =
    mStats.reviewedCount > 0
      ? `${mStats.reviewedCount} ${mStats.reviewedCount === 1 ? "milestone" : "milestones"} in review`
      : mStats.completedCount > 0
      ? `${mStats.completedCount} ${mStats.completedCount === 1 ? "milestone" : "milestones"} completed`
      : mStats.invoicedCount > 0
      ? `${mStats.invoicedCount} ${mStats.invoicedCount === 1 ? "milestone" : "milestones"} invoiced`
      : dStats.paymentPendingCount > 0
      ? `${dStats.paymentPendingCount} ${dStats.paymentPendingCount === 1 ? "request" : "requests"} awaiting payment`
      : "Completed work flows into payment requests and payout";
  const heroBand = useMemo(() => {
    const hasOperationalPressure =
      contractorNextActions.some((item) => item.category === "attention") ||
      dueSchedule.late.count > 0 ||
      dueSchedule.today.count > 0 ||
      mStats.reviewedCount > 0 ||
      mStats.completedCount > 0 ||
      dStats.awaitingApprovalCount > 0 ||
      dStats.paymentPendingCount > 0;

    const looksLikeSetup =
      !hasProjectsStarted ||
      !isOnboardingComplete ||
      /onboard|setup|stripe|profile|first agreement/i.test(
        `${heroAction.title || ""} ${heroAction.message || ""}`
      );

    if (!contractorNextActions.length && hasProjectsStarted && !hasOperationalPressure) {
      return {
        label: "ALL CAUGHT UP",
        title: "Nothing urgent is blocking work or payment right now.",
        message: "Your active work and invoices look clear. Check recent activity if you want a quick status sweep.",
        ctaLabel: "",
        quiet: true,
        setup: false,
      };
    }

    return {
      label: "NEXT ACTIONS",
      title: heroAction.title,
      message: heroAction.message,
      rationale: heroAction.rationale,
      ctaLabel: heroAction.ctaLabel,
      navigationTarget: heroAction.navigationTarget,
      action: heroAction.action,
      quiet: false,
      setup: looksLikeSetup,
    };
  }, [
    dueSchedule.late.count,
    dueSchedule.today.count,
    hasProjectsStarted,
    heroAction,
    contractorNextActions.length,
    dStats.awaitingApprovalCount,
    dStats.paymentPendingCount,
    isOnboardingComplete,
    mStats.reviewedCount,
    mStats.completedCount,
    contractorNextActions,
  ]);
  const nextActionCards = useMemo(() => {
    if (contractorNextActions.length) return contractorNextActions.slice(0, 10);
    const traditionalSection = activationSummary?.guide_sections?.traditional_onboarding;
    if (traditionalSection?.visible && !traditionalSection.completed && !traditionalSection.dismissed) {
      return [
        {
          key: "dashboard-traditional-onboarding",
          title: traditionalSection.title || "Finish onboarding",
          description: traditionalSection.description || "Complete your setup to start working in MyHomeBro.",
          buttonLabel: traditionalSection.action_label || "Open",
          navigationTarget: traditionalSection.action_url || "/app/profile",
        },
      ];
    }
    if (heroBand.quiet) return [];
    return [
      {
        key: "dashboard-fallback-next-action",
        title: heroBand.title,
        description: heroBand.message,
        buttonLabel: heroBand.ctaLabel || "Open",
        navigationTarget: heroBand.navigationTarget,
        action: heroBand.action,
      },
    ];
  }, [activationSummary, contractorNextActions, heroBand]);
  const visibleNextActionCards = useMemo(
    () => nextActionCards.slice(0, showAllNextActions ? 10 : 5),
    [nextActionCards, showAllNextActions]
  );
  const contextualGuide = useMemo(() => {
    if (contextualGuideSuppressed) return null;
    const picked = pickContextualGuide(activationSummary, ["prefilled_profile", "public_leads"]);
    if (!picked || dismissedContextualGuides.has(picked.sectionKey)) return null;
    return picked;
  }, [activationSummary, contextualGuideSuppressed, dismissedContextualGuides]);
  const projectModeStats = useMemo(() => {
    const list = Array.isArray(agreements) ? agreements : [];
    const counts = {
      full_service: 0,
      assisted_diy: 0,
      consultation: 0,
      inspection_only: 0,
    };
    for (const item of list) {
      const mode = normalizeProjectMode(item?.project_mode);
      counts[mode] = (counts[mode] || 0) + 1;
    }
    return counts;
  }, [agreements]);
  const projectClassStats = useMemo(() => {
    const list = Array.isArray(agreements) ? agreements : [];
    const counts = {
      residential: 0,
      commercial: 0,
    };
    for (const item of list) {
      const classValue = normalizeProjectClassMaybe(item?.project_class || item?.project_class_label || item?.project?.project_class);
      if (classValue) counts[classValue] += 1;
    }
    return counts;
  }, [agreements]);
  const paymentProtectionStats = useMemo(() => {
    const list = Array.isArray(agreements) ? agreements : [];
    const counts = {
      direct: 0,
      preferred: 0,
      recommended: 0,
      required: 0,
    };
    for (const item of list) {
      const mode = norm(item?.payment_mode || item?.paymentMode || item?.payment_mode_label || "");
      if (mode === "direct") {
        counts.direct += 1;
        continue;
      }
      const level = normalizePaymentProtectionLevel(item?.payment_protection?.level || item?.payment_protection?.label || "");
      if (level === "required") counts.required += 1;
      else if (level === "recommended") counts.recommended += 1;
      else counts.preferred += 1;
    }
    return counts;
  }, [agreements]);
  const safetySignalStats = useMemo(() => {
    const list = Array.isArray(milestones) ? milestones : [];
    const counts = {
      licensed_trade_work: 0,
      contractor_required: 0,
      inspection_recommended: 0,
    };
    for (const item of list) {
      const labels = Array.isArray(item?.milestone_safety_labels) ? item.milestone_safety_labels : [];
      if (labels.includes("Licensed Trade Work")) counts.licensed_trade_work += 1;
      if (labels.includes("Contractor Required")) counts.contractor_required += 1;
      if (labels.includes("Inspection Recommended")) counts.inspection_recommended += 1;
    }
    return counts;
  }, [milestones]);
  const contractorMatchOpportunities = useMemo(() => {
    const rows = Array.isArray(publicLeads) ? publicLeads : [];
    const normalizedRows = rows
      .map((lead) => {
        const matching = lead?.matching || lead?.ai_analysis?.contractor_match || {};
        return {
          ...lead,
          matching,
          score: Number(matching?.score || (lead?.source === "contractor_opportunity" ? 60 : 0)),
          tier: String(matching?.tier || "").trim(),
          requirements: matching?.project_requirements || {},
        };
      })
      .filter((row) => row.score >= 45)
      .sort((left, right) => right.score - left.score || String(left.full_name || "").localeCompare(String(right.full_name || "")));

    const counts = {
      strong: 0,
      good: 0,
      pending: 0,
      assisted_diy: 0,
      rescue: 0,
      escrow: 0,
    };
    for (const row of normalizedRows) {
      if (String(row.tier).toLowerCase() === "strong match") counts.strong += 1;
      else counts.good += 1;
      if (row.source === "contractor_opportunity" && row.status === "pending") counts.pending += 1;
      if (normalizeProjectMode(row.requirements?.project_mode || row.project_mode) === "assisted_diy") counts.assisted_diy += 1;
      if (row.requirements?.rescue_project) counts.rescue += 1;
      if (String(row.requirements?.payment_preference || "").toLowerCase() !== "direct") counts.escrow += 1;
    }

    return {
      rows: normalizedRows.slice(0, 4),
      counts,
    };
  }, [publicLeads]);
  const showActivityFeed = !isEmployee && activityFeed.length > 0;
  const workPipelineRows = [
    {
      key: "not-started",
      title: "Not Started",
      icon: Target,
      count: mStats.notStartedCount,
      amount: mStats.notStartedAmount,
      description: "Milestones with no recorded progress.",
      tone: "neutral",
      onClick: () => navigate(`/app/milestones?filter=incomplete`),
    },
    {
      key: "in-progress",
      title: "In Progress",
      icon: ListTodo,
      count: mStats.inProgressCount,
      amount: mStats.inProgressAmount,
      description: "Milestones underway but not yet complete.",
      tone: "active",
      onClick: () => navigate(`/app/milestones?filter=incomplete`),
    },
    {
      key: "completed",
      title: "Completed",
      icon: CheckCircle2,
      count: mStats.completedCount,
      amount: mStats.completedAmount,
      description: "Finished milestones waiting to move forward.",
      tone: "good",
      onClick: () => navigate(`/app/milestones?filter=complete_not_invoiced`),
    },
    {
      key: "awaiting-review",
      title: "Awaiting Review",
      icon: ClipboardCheck,
      count: mStats.reviewedCount,
      amount: mStats.reviewedAmount,
      description: "Completed milestones waiting on review or approval.",
      tone: "warn",
      onClick: () => navigate(`/app/milestones?filter=reviewed`),
    },
    {
      key: "invoiced",
      title: "Invoiced",
      icon: FileText,
      count: mStats.invoicedCount,
      amount: mStats.invoicedAmount,
      description: "Milestones already tied to an invoice or payment request.",
      tone: "purple",
      onClick: () => navigate(`/app/milestones?filter=invoiced`),
    },
  ];
  const moneyPipelineRows = [
    {
      key: "awaiting-customer",
      title: "Awaiting Customer Approval",
      icon: Receipt,
      count: paymentSummary.awaiting_customer_approval.count,
      amount: paymentSummary.awaiting_customer_approval.amount,
      description: "Invoices or draw requests waiting on owner or customer review.",
      tone: "warn",
      onClick: () => goPayments({ moneyStatus: "awaiting_customer_approval" }),
    },
    {
      key: "payment-pending",
      title: "Payment Pending",
      icon: WalletMinimal,
      count: paymentSummary.payment_pending.count,
      amount: paymentSummary.payment_pending.amount,
      description: "Approved work awaiting payment or release.",
      tone: "active",
      onClick: () => goPayments({ moneyStatus: "payment_pending" }),
    },
    {
      key: "paid",
      title: "Paid",
      icon: BadgeCheck,
      count: paymentSummary.paid.count,
      amount: paymentSummary.paid.amount,
      description: "Invoices or draw requests fully paid or released.",
      tone: "good",
      onClick: () => goPayments({ moneyStatus: "paid" }),
    },
    {
      key: "issues",
      title: "Disputes / Issues",
      icon: Flag,
      count: paymentSummary.issues.count,
      amount: paymentSummary.issues.amount,
      description: "Records with disputes, requested changes, or rejection issues.",
      tone: "bad",
      onClick: () => goPayments({ moneyStatus: "issues" }),
    },
  ];
  const dashboardKpis = useMemo(() => {
    const activeAgreementCount = (Array.isArray(agreements) ? agreements : []).filter((agreement) => {
      const status = norm(agreement?.status || agreement?.agreement_status || agreement?.state);
      return !["archived", "cancelled", "canceled", "void", "deleted"].includes(status);
    }).length;
    const awaitingSignatureCount = (Array.isArray(agreements) ? agreements : []).filter((agreement) => {
      const status = norm(agreement?.status || agreement?.agreement_status || agreement?.signature_status || agreement?.state);
      return (
        status.includes("signature") ||
        agreement?.signed_by_contractor === false ||
        agreement?.signed_by_homeowner === false ||
        agreement?.requires_signature === true
      );
    }).length;
    const pendingPaymentAmount =
      money(paymentSummary.awaiting_customer_approval.amount) +
      money(paymentSummary.payment_pending.amount);
    const pendingPaymentCount =
      Number(paymentSummary.awaiting_customer_approval.count || 0) +
      Number(paymentSummary.payment_pending.count || 0);
    const escrowProtectedAmount =
      money(paymentSummary.awaiting_customer_approval.amount) +
      money(paymentSummary.payment_pending.amount) +
      money(paymentSummary.paid.amount);
    const upcomingMilestoneCount = Number(dueSchedule.week.count || 0);

    return [
      {
        key: "active-projects",
        label: "Active Projects",
        value: Number(activeAgreementCount || mStats.totalCount || 0).toLocaleString(),
        helper: mStats.inProgressCount > 0 ? `${mStats.inProgressCount} in progress` : "Across active work",
        icon: ClipboardCheck,
        tone: "blue",
      },
      {
        key: "pending-payments",
        label: "Pending Payments",
        value: currency(pendingPaymentAmount),
        helper: `${pendingPaymentCount} ${pendingPaymentCount === 1 ? "payment" : "payments"} pending`,
        icon: BadgeDollarSign,
        tone: "amber",
      },
      {
        key: "awaiting-signatures",
        label: "Awaiting Signatures",
        value: Number(awaitingSignatureCount).toLocaleString(),
        helper: awaitingSignatureCount > 0 ? "Needs your attention" : "No signatures waiting",
        icon: FileText,
        tone: "violet",
      },
      {
        key: "escrow-protected",
        label: "Escrow Protected",
        value: currency(escrowProtectedAmount),
        helper: "Across payment records",
        icon: WalletMinimal,
        tone: "emerald",
      },
      {
        key: "upcoming-milestones",
        label: "Upcoming Milestones",
        value: Number(upcomingMilestoneCount).toLocaleString(),
        helper: "Next 7 days",
        icon: CalendarDays,
        tone: "blue",
      },
    ];
  }, [agreements, dueSchedule.week.count, mStats.inProgressCount, mStats.totalCount, paymentSummary]);

  // Show onboarding conversation on Dashboard until the contractor is fully set up
  if (loginExperience === "first_login" || loginExperience === "resume_onboarding") {
    return (
      <PageShell
        title={loginExperience === "resume_onboarding" ? "Finish your setup" : "Welcome to MyHomeBro"}
        subtitle=""
        showLogo={false}
        compact
        className="mhb-dashboard-shell"
        titleClassName="drop-shadow-none"
      >
        <div className="mx-auto max-w-3xl py-4">
          <OnboardingConversation
            contractorProfile={onboardingProfile}
            stripeStatus={onboardingStripe}
            mode={loginExperience}
            onComplete={() => setLoginExperience("daily_briefing")}
          />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Dashboard"
      subtitle={greetingName ? `Good to see you, ${greetingName}.` : null}
      showLogo={false}
      compact
      className="mhb-dashboard-shell"
      titleClassName="drop-shadow-none"
    >
      <div
        className="mhb-contractor-dashboard -mx-4 -mb-6 min-h-screen space-y-5 px-4 pb-8 pt-1 md:-mx-6 md:px-6"
      >
      {!isEmployee ? (
        <ContractorContextualGuideModal
          guide={contextualGuide}
          onDismiss={dismissActivationSection}
        />
      ) : null}

      {!isEmployee ? (
        <div className="space-y-5">
          <DashboardGreeting
            firstName={greetingName}
            daysSince={daysSinceLogin}
            briefingItems={contractorNextActions.slice(0, 3)}
            profileScore={profileScore}
            onOpenCopilot={() =>
              openAssistant({
                context: {
                  workspace_mode: "dashboard",
                  page: "dashboard",
                  briefingItems: contractorNextActions.slice(0, 3),
                },
              })
            }
          />

          <ContractorActivationChecklist
            contractorProfile={contractorProfile}
            stripeStatus={onboardingStripe}
            agreements={agreements}
            publicLeads={publicLeads}
            onNavigate={navigate}
          />

          <DashboardCard
            testId="dashboard-kpi-strip"
            tone="premium"
            className="mhb-dashboard-kpi-strip p-0"
          >
            <div className="grid gap-0 md:grid-cols-2 xl:grid-cols-5">
              {dashboardKpis.map(({ key, label, value, helper, icon: Icon, tone }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    if (key === "active-projects") navigate("/app/agreements");
                    else if (key === "pending-payments") goPayments({ moneyStatus: "payment_pending" });
                    else if (key === "awaiting-signatures") navigate("/app/agreements");
                    else if (key === "escrow-protected") goPayments();
                    else navigate("/app/milestones");
                  }}
                  className="mhb-dashboard-kpi-button group flex min-h-[112px] items-center gap-4 border-white/10 px-4 py-4 text-left transition focus:outline-none focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-[#061d42] xl:border-r xl:last:border-r-0"
                  data-tone={tone}
                >
                  <span className="mhb-dashboard-kpi-icon flex h-14 w-14 shrink-0 items-center justify-center rounded-full border">
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-sky-100/80">{label}</span>
                    <span className="mt-1 block text-2xl font-black text-white md:text-3xl">
                      {value}
                    </span>
                    <span className="mt-1 block text-xs font-semibold text-sky-100/62">{helper}</span>
                  </span>
                </button>
              ))}
            </div>
          </DashboardCard>

          <DashboardSection variant="premium">
            <DashboardCard
              testId="dashboard-quick-actions-row"
              tone="premium"
              className="mhb-dashboard-quick-actions p-4 shadow-[0_22px_50px_rgba(2,8,23,0.34)]"
            >
              <div className="grid gap-4 xl:grid-cols-[minmax(14rem,0.7fr)_minmax(0,2fr)] xl:items-center">
                <div className="flex items-start gap-3">
                  <Sparkles className="mt-1 h-6 w-6 text-amber-300" aria-hidden="true" />
                  <span>
                    <span className="block text-2xl font-black text-white">Quick Actions</span>
                    <span className="mt-1 block text-sm font-medium text-sky-100/76">Create and navigate faster</span>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                  <button
                    type="button"
                    onClick={goNewAgreement}
                    className="inline-flex h-14 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:-translate-y-px hover:border-white/30 hover:bg-white/15"
                  >
                    <FilePlus2 className="h-4 w-4" />
                    <span>New Agreement</span>
                  </button>
                  <button
                    type="button"
                    onClick={goNewMilestone}
                    className="inline-flex h-14 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:-translate-y-px hover:border-white/30 hover:bg-white/15"
                  >
                    <ListPlus className="h-4 w-4" />
                    <span>New Milestone</span>
                  </button>
                  <button
                    type="button"
                    onClick={goInvoices}
                    className="inline-flex h-14 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:-translate-y-px hover:border-white/30 hover:bg-white/15"
                  >
                    <BadgeDollarSign className="h-4 w-4" />
                    <span>Payment</span>
                  </button>
                  <button
                    type="button"
                    onClick={openNewExpense}
                    className="inline-flex h-14 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:-translate-y-px hover:border-white/30 hover:bg-white/15"
                  >
                    <HandCoins className="h-4 w-4" />
                    <span>Expense</span>
                  </button>
                </div>
              </div>
            </DashboardCard>
          </DashboardSection>

          <div
            data-testid="dashboard-priority-schedule-grid"
            className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)] xl:items-start"
          >
            <DashboardCard
              testId="dashboard-next-actions"
              tone="premium"
              className="p-4 shadow-[0_22px_50px_rgba(2,8,23,0.34)]"
            >
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <div className="text-2xl font-bold text-white">
                  Next Actions
                </div>
                <div className="mt-1 text-sm text-sky-100/85">
                  Top priorities from agreements, milestones, quotes, approvals, and payouts.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold text-white shadow-sm">
                  {nextActionCards.length} total
                </span>
                {nextActionCards.length > 5 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllNextActions((current) => !current)}
                    className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15"
                  >
                    {showAllNextActions ? "Show fewer" : "View all actions"}
                  </button>
                ) : null}
              </div>
            </div>
            {visibleNextActionCards.length ? (
              <div className="space-y-2.5">
                {visibleNextActionCards.map((item) => (
                  <button
                    key={item.key}
                    data-testid={`dashboard-next-action-item-${item.key}`}
                    type="button"
                    onClick={() => {
                      if (typeof item.action === "function") {
                        item.action();
                        return;
                      }
                      navigate(item.navigationTarget || "/app/dashboard");
                    }}
                    className="flex w-full items-start justify-between gap-4 rounded-xl border border-white/15 bg-white/8 px-4 py-3 text-left transition hover:-translate-y-px hover:border-white/30 hover:bg-white/12 focus:outline-none focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-[#061d42]"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white">{item.title}</div>
                      <div className="mt-1 text-sm leading-6 text-sky-100/75">{item.description}</div>
                    </div>
                    <span
                      data-testid={`dashboard-next-action-button-${item.key}`}
                      className="shrink-0 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-[#0a2550]"
                    >
                      {item.buttonLabel || "Open"}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/20 bg-white/8 px-4 py-3 text-sm text-sky-100/80">
                No next actions surfaced yet.
              </div>
            )}
            </DashboardCard>

          {false ? (
          <DashboardSection
            title="Project Context"
            subtitle="Compact mode, payment, and workflow filters for the jobs you are already managing."
          >
            <DashboardCard
              tone="subtle"
              className="border-slate-200/90 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)]"
              testId="dashboard-project-context"
            >
              <div className="space-y-3.5">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                    Project Type
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[
                      {
                        label: "Residential",
                        value: "residential",
                        count: projectClassStats.residential,
                        tone: "border-sky-200 bg-sky-50 text-sky-700",
                        dataTestId: "dashboard-project-class-residential",
                      },
                      {
                        label: "Commercial",
                        value: "commercial",
                        count: projectClassStats.commercial,
                        tone: "border-indigo-200 bg-indigo-50 text-indigo-700",
                        dataTestId: "dashboard-project-class-commercial",
                      },
                    ]
                      .filter((item) => Number(item.count || 0) > 0)
                      .map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          data-testid={item.dataTestId}
                          onClick={() => navigate(`/app/agreements?project_class=${item.value}`)}
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold leading-none transition hover:-translate-y-px hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 ${item.tone}`}
                        >
                          <span>{item.label}</span>
                          <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-bold text-slate-900">
                            {Number(item.count || 0).toLocaleString()}
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                    Mode Filters
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[
                      {
                        label: "Full Service",
                        value: "full_service",
                        count: projectModeStats.full_service,
                        tone: "border-blue-200 bg-blue-50 text-blue-700",
                        dataTestId: "dashboard-project-mode-full-service",
                      },
                      {
                        label: "Assisted DIY",
                        value: "assisted_diy",
                        count: projectModeStats.assisted_diy,
                        tone: "border-amber-200 bg-amber-50 text-amber-800",
                        dataTestId: "dashboard-project-mode-assisted-diy",
                      },
                      {
                        label: "Consultation",
                        value: "consultation",
                        count: projectModeStats.consultation,
                        tone: "border-violet-200 bg-violet-50 text-violet-700",
                        dataTestId: "dashboard-project-mode-consultation",
                      },
                      {
                        label: "Inspection Only",
                        value: "inspection_only",
                        count: projectModeStats.inspection_only,
                        tone: "border-slate-200 bg-slate-100 text-slate-700",
                        dataTestId: "dashboard-project-mode-inspection",
                      },
                    ].map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        data-testid={item.dataTestId}
                        onClick={() => navigate(`/app/milestones?project_mode=${item.value}&filter=incomplete`)}
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold leading-none transition hover:-translate-y-px hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 ${item.tone}`}
                      >
                        <ProjectModeBadge mode={item.value} className="scale-90" />
                        <span>{item.label}</span>
                        <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-bold text-slate-900">
                          {Number(item.count || 0).toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                    Payment Method / Protection
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[
                      {
                        label: "Direct Payment",
                        count: paymentProtectionStats.direct,
                        tone: "border-slate-200 bg-slate-100 text-slate-700",
                        dataTestId: "dashboard-payment-direct",
                        navigationTarget: "/app/agreements?payment_mode=direct",
                      },
                      {
                        label: "Escrow Preferred",
                        count: paymentProtectionStats.preferred,
                        tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
                        dataTestId: "dashboard-guardrail-escrow-preferred",
                        navigationTarget: "/app/agreements?payment_mode=escrow&payment_protection=preferred",
                      },
                      {
                        label: "Escrow Recommended",
                        count: paymentProtectionStats.recommended,
                        tone: "border-amber-200 bg-amber-50 text-amber-800",
                        dataTestId: "dashboard-guardrail-escrow-recommended",
                        navigationTarget: "/app/agreements?payment_mode=escrow&payment_protection=recommended",
                      },
                      {
                        label: "Escrow Required",
                        count: paymentProtectionStats.required,
                        tone: "border-rose-200 bg-rose-50 text-rose-800",
                        dataTestId: "dashboard-guardrail-escrow-required",
                        navigationTarget: "/app/agreements?payment_mode=escrow&payment_protection=required",
                      },
                    ]
                      .filter((item) => Number(item.count || 0) > 0)
                      .map((item) => (
                        <button
                          type="button"
                          key={item.label}
                          data-testid={item.dataTestId}
                          onClick={() => navigate(item.navigationTarget || "/app/agreements")}
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold leading-none ${item.tone}`}
                        >
                          <span>{item.label}</span>
                          <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-extrabold text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.08)]">
                            {Number(item.count || 0).toLocaleString()}
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            </DashboardCard>
          </DashboardSection>

          ) : null}

          <DashboardSection
            title="Schedule"
            subtitle="Active due work only. Planned timelines stay in agreement previews until activated."
            variant="premium"
            testId="dashboard-schedule-wrapper"
          >
            <DashboardCard
              testId="dashboard-schedule-section"
              tone="premium"
              className={`min-h-[210px] shadow-[0_22px_50px_rgba(2,8,23,0.34)] ${
                scheduleHasItems ? "p-4" : "p-3.5"
              }`}
            >
              {scheduleHasItems ? (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div data-testid="dashboard-schedule-late">
                    <StatCard
                      icon={AlertTriangle}
                      title="Past Due / Late"
                      subtitle="Overdue active milestones, invoices, or agreements needing follow-up."
                      count={dueSchedule.late.count}
                      amount={dueSchedule.late.amount}
                      onClick={goAgreementScheduleLate}
                      />
                    </div>
                    <div data-testid="dashboard-schedule-today">
                    <StatCard
                      icon={CalendarDays}
                      title="Due Today"
                      subtitle="Immediate actions and active scheduled work."
                      count={dueSchedule.today.count}
                      amount={dueSchedule.today.amount}
                      onClick={goAgreementScheduleToday}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2.5 md:grid-cols-2">
                    <div data-testid="dashboard-schedule-tomorrow">
                      <button
                        type="button"
                        role="button"
                        onClick={goAgreementScheduleTomorrow}
                        className="flex w-full items-center justify-between rounded-xl border border-white/15 bg-white/8 px-4 py-3 text-left text-white hover:border-white/30 hover:bg-white/12"
                      >
                        <div>
                          <div className="text-sm font-semibold text-white">Due Tomorrow</div>
                          <div className="mt-1 text-xs font-medium text-sky-100/75">
                            {dueSchedule.tomorrow.count} items | {currency(dueSchedule.tomorrow.amount)}
                          </div>
                        </div>
                        <ArrowRight className="h-4 w-4 text-sky-100/70" />
                      </button>
                    </div>
                    <div data-testid="dashboard-schedule-week">
                      <button
                        type="button"
                        role="button"
                        onClick={goAgreementScheduleWeek}
                        className="flex w-full items-center justify-between rounded-xl border border-white/15 bg-white/8 px-4 py-3 text-left text-white hover:border-white/30 hover:bg-white/12"
                      >
                        <div>
                          <div className="text-sm font-semibold text-white">This Week</div>
                          <div className="mt-1 text-xs font-medium text-sky-100/75">
                            {dueSchedule.week.count} items | {currency(dueSchedule.week.amount)}
                          </div>
                        </div>
                        <ArrowRight className="h-4 w-4 text-sky-100/70" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={goCalendar}
                  className="flex min-h-[132px] w-full flex-col items-center justify-center gap-3 rounded-xl border border-white/15 bg-white/8 px-4 py-6 text-center hover:border-white/30 hover:bg-white/12"
                >
                  <CalendarDays className="h-8 w-8 shrink-0 rounded-2xl border border-sky-300/30 bg-sky-400/10 p-1.5 text-sky-100" />
                  <div>
                    <div className="text-sm font-semibold text-white">Schedule is clear</div>
                    <div className="mt-1 text-xs font-medium text-sky-100/75">
                      No overdue or upcoming due items are surfaced right now.
                    </div>
                  </div>
                </button>
              )}
            </DashboardCard>
          </DashboardSection>
          </div>{/* end dashboard-priority-schedule-grid */}

          {false ? (
          <DashboardSection
            title="Project Context"
            subtitle="Operational filters for the jobs you are already managing."
          >
            <DashboardCard
              tone="subtle"
              className="border-slate-200/90 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)]"
              testId="dashboard-project-context"
            >
              <div className="flex flex-wrap gap-2.5">
                {[
                  { label: "Residential", count: projectClassStats.residential, href: "/app/agreements?project_class=residential", tone: "border-sky-200 bg-sky-50 text-sky-800" },
                  { label: "Commercial", count: projectClassStats.commercial, href: "/app/agreements?project_class=commercial", tone: "border-indigo-200 bg-indigo-50 text-indigo-800" },
                  { label: "Full Service", count: projectModeStats.full_service, href: "/app/milestones?project_mode=full_service&filter=incomplete", tone: "border-blue-200 bg-blue-50 text-blue-800" },
                  { label: "Assisted DIY", count: projectModeStats.assisted_diy, href: "/app/milestones?project_mode=assisted_diy&filter=incomplete", tone: "border-amber-200 bg-amber-50 text-amber-900" },
                  { label: "Consultation", count: projectModeStats.consultation, href: "/app/milestones?project_mode=consultation&filter=incomplete", tone: "border-violet-200 bg-violet-50 text-violet-800" },
                  { label: "Inspection Only", count: projectModeStats.inspection_only, href: "/app/milestones?project_mode=inspection_only&filter=incomplete", tone: "border-slate-200 bg-slate-100 text-slate-800" },
                  { label: "Direct Payment", count: paymentProtectionStats.direct, href: "/app/agreements?payment_mode=direct", tone: "border-slate-200 bg-slate-100 text-slate-800" },
                  { label: "Escrow Preferred", count: paymentProtectionStats.preferred, href: "/app/agreements?payment_mode=escrow&payment_protection=preferred", tone: "border-emerald-200 bg-emerald-50 text-emerald-900" },
                  { label: "Escrow Recommended", count: paymentProtectionStats.recommended, href: "/app/agreements?payment_mode=escrow&payment_protection=recommended", tone: "border-amber-200 bg-amber-50 text-amber-900" },
                  { label: "Escrow Required", count: paymentProtectionStats.required, href: "/app/agreements?payment_mode=escrow&payment_protection=required", tone: "border-rose-200 bg-rose-50 text-rose-900" },
                ]
                  .filter((item) => Number(item.count || 0) > 0)
                  .map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => navigate(item.href)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold leading-none transition hover:-translate-y-px hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 ${item.tone}`}
                    >
                      <span>{item.label}</span>
                      <span className="rounded-full bg-white/90 px-2 py-0.5 text-xs font-extrabold text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.08)]">
                        {Number(item.count || 0).toLocaleString()}
                      </span>
                    </button>
                  ))}
                {projectClassStats.residential + projectClassStats.commercial === 0 &&
                Object.values(projectModeStats).every((count) => Number(count || 0) === 0) &&
                Object.values(paymentProtectionStats).every((count) => Number(count || 0) === 0) ? (
                  <div className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">
                    Project context appears here once agreements are active.
                  </div>
                ) : null}
              </div>
            </DashboardCard>
          </DashboardSection>
          ) : null}

          <div
            data-testid="dashboard-work-bids-grid"
            className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)] xl:items-start"
          >
          <DashboardSection
            title="Work and Money"
            subtitle="Track job progress on the left and payment handoffs on the right."
            variant="premium"
            testId="dashboard-work-money-wrapper"
          >
            <DashboardCard
              testId="dashboard-work-money"
              tone="premium"
              className="p-4 shadow-[0_22px_50px_rgba(2,8,23,0.34)] md:p-5"
            >
              <div id="layout" className="grid gap-4 xl:grid-cols-2 xl:items-start">
                <div className="space-y-3">
                  <div className="mb-4">
                    <div className="flex items-center gap-2">
                      <ListTodo className="h-4 w-4 text-sky-100/70" aria-hidden="true" />
                      <h2 className="text-xl font-semibold text-white">Work Pipeline</h2>
                    </div>
                    <p className="mt-1 text-sm text-sky-100/75">
                      Track job progress across milestones
                    </p>
                  </div>
                  <div className="space-y-3">
                    {workPipelineRows.map((row) => (
                      <PipelineRow
                        key={row.key}
                        testId={`dashboard-work-${row.key}`}
                        icon={row.icon}
                        title={row.title}
                        count={row.count}
                        amount={row.amount}
                        description={row.description}
                        tone={row.tone}
                        onClick={row.onClick}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="mb-4 mt-6 xl:mt-0">
                    <div className="flex items-center gap-2">
                      <WalletMinimal className="h-4 w-4 text-sky-100/70" aria-hidden="true" />
                      <h2 className="text-xl font-semibold text-white">Money Pipeline</h2>
                    </div>
                    <p className="mt-1 text-sm text-sky-100/75">
                      Track payments from approval to payout
                    </p>
                  </div>
                  <div className="space-y-3">
                    {moneyPipelineRows.map((row) => (
                      <PipelineRow
                        key={row.key}
                        testId={`dashboard-money-${row.key}`}
                        icon={row.icon}
                        title={row.title}
                        count={row.count}
                        amount={row.amount}
                        description={row.description}
                        tone={row.tone}
                        onClick={row.onClick}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </DashboardCard>
          </DashboardSection>

          {false ? (<>
          <DashboardSection
            title="Work and Money"
            subtitle="Follow the handoff from completed work to payment requests, approval, and payout."
          >
            <DashboardCard
              tone="subtle"
              className="border-slate-200/90 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)] md:p-5"
            >
              <div className="mb-5 grid gap-3 md:grid-cols-3">
                <StatCard
                  icon={WalletMinimal}
                  title="Total Earned"
                  subtitle="Paid invoices and paid or released draw requests recorded in MyHomeBro."
                  count={paymentSummary.paid.count}
                  amount={paymentSummary.paid.amount}
                  onClick={() => goPayments({ moneyStatus: "paid" })}
                />
                <StatCard
                  icon={BadgeCheck}
                  title="Payment Pending"
                  subtitle="Approved invoices or draw requests still moving through the next payment step."
                  count={paymentSummary.payment_pending.count}
                  amount={paymentSummary.payment_pending.amount}
                  onClick={() => goPayments({ moneyStatus: "payment_pending" })}
                />
                <StatCard
                  icon={AlertTriangle}
                  title="Issues / Disputes"
                  subtitle="Invoices or draw requests needing attention, dispute follow-up, or changes."
                  count={paymentSummary.issues.count}
                  amount={paymentSummary.issues.amount}
                  onClick={() => goPayments({ moneyStatus: "issues" })}
                />
              </div>
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] xl:items-start">
                <div className="space-y-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#52749a]">
                      Active Work
                    </div>
                    <div className="mt-1 text-lg font-semibold text-[#18395f]">Track current work stage across active milestones</div>
                  </div>
                  <FlowMetricButton
                    icon={ListTodo}
                    label="Not Started"
                    description="Milestones with no recorded progress yet."
                    count={mStats.notStartedCount}
                    amount={mStats.notStartedAmount}
                    onClick={() => navigate(`/app/milestones?filter=incomplete`)}
                    testId="dashboard-work-not-started"
                  />
                  <FlowMetricButton
                    icon={Target}
                    label="In Progress"
                    description="Milestones underway but not yet complete."
                    count={mStats.inProgressCount}
                    amount={mStats.inProgressAmount}
                    onClick={() => navigate(`/app/milestones?filter=incomplete`)}
                    testId="dashboard-work-in-progress"
                  />
                  <FlowMetricButton
                    icon={CheckCircle2}
                    label="Completed"
                    description="Finished milestones that have not yet moved into review."
                    count={mStats.completedCount}
                    amount={mStats.completedAmount}
                    onClick={() => navigate(`/app/milestones?filter=complete_not_invoiced`)}
                    emphasized
                    testId="dashboard-work-completed"
                  />
                  <FlowMetricButton
                    icon={BadgeCheck}
                    label="Reviewed"
                    description="Completed milestones currently in review or approval."
                    count={mStats.reviewedCount}
                    amount={mStats.reviewedAmount}
                    onClick={() => navigate(`/app/milestones`)}
                    testId="dashboard-work-reviewed"
                  />
                  <FlowMetricButton
                    icon={Receipt}
                    label="Invoiced"
                    description="Milestones already tied to an invoice or payment request."
                    count={mStats.invoicedCount}
                    amount={mStats.invoicedAmount}
                    onClick={goInvoices}
                    testId="dashboard-work-invoiced"
                  />
                  {mStats.reworkCount > 0 ? (
                    <FlowMetricButton
                      icon={Wrench}
                      label="Rework Orders"
                      description="Dispute-driven work orders that still need attention."
                      count={mStats.reworkCount}
                      amount={mStats.reworkAmount}
                      onClick={goReworkMilestones}
                      testId="dashboard-work-rework"
                    />
                  ) : null}
                </div>

                <div className="flex items-center justify-center">
                  <div className="flex items-center gap-2 rounded-full border border-[#c9d8e8] bg-[#f2f7fc] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#355d8c] shadow-sm">
                    <span>Work</span>
                    <ArrowRight className="h-3.5 w-3.5 text-[#2d5a8f]" />
                    <span>Invoice</span>
                    <span className="hidden text-[#89a6c6] xl:inline">|</span>
                    <span className="hidden normal-case tracking-normal font-medium text-[#58779b] xl:inline">
                      {workMoneyConnectorLabel}
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#52749a]">
                      Payment Pipeline
                    </div>
                    <div className="mt-1 text-lg font-semibold text-[#18395f]">Track each payment request through approval and payout</div>
                  </div>
                  <FlowMetricButton
                    icon={BadgeDollarSign}
                    label="Awaiting Customer Approval"
                    description="Invoices or draw requests waiting on owner or customer review."
                    count={paymentSummary.awaiting_customer_approval.count}
                    amount={paymentSummary.awaiting_customer_approval.amount}
                    onClick={() => goPayments({ moneyStatus: "awaiting_customer_approval" })}
                    emphasized={paymentSummary.awaiting_customer_approval.count > 0}
                    testId="dashboard-money-awaiting-customer"
                  />
                  <FlowMetricButton
                    icon={BadgeCheck}
                    label="Payment Pending"
                    description="Approved invoices or draw requests still moving through payment."
                    count={paymentSummary.payment_pending.count}
                    amount={paymentSummary.payment_pending.amount}
                    onClick={() => goPayments({ moneyStatus: "payment_pending" })}
                    testId="dashboard-money-approved"
                  />
                  <FlowMetricButton
                    icon={WalletMinimal}
                    label="Paid"
                    description="Invoices or draw requests that have been fully paid or released."
                    count={paymentSummary.paid.count}
                    amount={paymentSummary.paid.amount}
                    onClick={() => goPayments({ moneyStatus: "paid" })}
                    testId="dashboard-money-paid-out"
                  />
                  <FlowMetricButton
                    icon={AlertTriangle}
                    label="Issues / Disputes"
                    description="Invoices or draw requests with disputes, requested changes, or rejection issues."
                    count={paymentSummary.issues.count}
                    amount={paymentSummary.issues.amount}
                    onClick={() => goPayments({ moneyStatus: "issues" })}
                    testId="dashboard-money-issues"
                  />
                </div>
              </div>
            </DashboardCard>
          </DashboardSection>

          <DashboardSection
            title="Payment Records"
            subtitle="Recent invoices and draw requests, with record type and project class kept visible."
          >
            <DashboardCard
              tone="subtle"
              className="border-slate-200/90 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)] md:p-5"
            >
              {paymentTableRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">
                  No payment records are active right now.
                </div>
              ) : (
                <div className="overflow-x-auto" data-testid="dashboard-payment-records-table">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <th className="py-3 pr-3">Record</th>
                        <th className="py-3 pr-3">Type</th>
                        <th className="py-3 pr-3">Project</th>
                        <th className="py-3 pr-3">Amount</th>
                        <th className="py-3 pr-3">Status</th>
                        <th className="py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentTableRows.map((record) => (
                        <tr key={`${record.recordType}-${record.id}`} className="border-b border-slate-100 align-top">
                          <td className="py-3 pr-3">
                            <div className="font-semibold text-slate-900">{record.title}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {record.subtitle}
                              {record.agreementTitle ? ` • ${record.agreementTitle}` : ""}
                            </div>
                          </td>
                          <td className="py-3 pr-3">
                            <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                              {record.recordTypeLabel}
                            </span>
                          </td>
                          <td className="py-3 pr-3">
                            <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800">
                              {projectClassLabel(record.projectClass)}
                            </span>
                          </td>
                          <td className="py-3 pr-3 font-semibold text-slate-900">{currency(record.amount)}</td>
                          <td className="py-3 pr-3">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${drawStatusTone(
                                record.moneyStatus
                              )}`}
                            >
                              {moneyStatusLabel(record.moneyStatus)}
                            </span>
                          </td>
                          <td className="py-3">
                            <div className="flex flex-wrap gap-2">
                              {record.recordType === "draw_request" ? (
                                <>
                                  {["submitted", "payment_pending"].includes(drawWorkflowStatus(record.raw)) ? (
                                    <button
                                      type="button"
                                      onClick={() => resendDrawLink(record.raw)}
                                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                    >
                                      Resend Link
                                    </button>
                                  ) : null}
                                  {record.raw?.is_awaiting_release && norm(record.raw?.payment_mode) === "escrow" ? (
                                    <button
                                      type="button"
                                      onClick={() => releaseEscrowFunds(record.raw)}
                                      className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                                    >
                                      Release Funds
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => openDrawEditor(record.raw)}
                                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openDrawOwnerView(record.raw)}
                                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                  >
                                    View
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => navigate(`/app/invoices/${record.id}`)}
                                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                  >
                                    View
                                  </button>
                                  {record.agreementId ? (
                                    <button
                                      type="button"
                                      onClick={() => navigate(`/app/agreements/${record.agreementId}`)}
                                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                    >
                                      Agreement
                                    </button>
                                  ) : null}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DashboardCard>
          </DashboardSection>

          <DashboardSection
            title="Payout Snapshot"
            subtitle="A quick view of completed payouts and retained platform fees."
          >
            <DashboardCard
              testId="dashboard-payout-summary"
              tone="subtle"
              className="border-slate-200/90 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)] md:p-5"
            >
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Total Paid Out</div>
                  <div className="mt-2 text-2xl font-extrabold text-slate-900">
                    {currency(payoutHistorySummary?.total_paid_out)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Platform Fees Retained
                  </div>
                  <div className="mt-2 text-2xl font-extrabold text-slate-900">
                    {currency(payoutHistorySummary?.total_platform_fees_retained)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Payout Count</div>
                  <div className="mt-2 text-2xl font-extrabold text-slate-900">
                    {Number(payoutHistorySummary?.payout_count || 0).toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Recent Payouts</div>
                  <div className="mt-1 text-sm text-slate-600">
                    {payoutHistoryLoading
                      ? "Loading payout snapshot..."
                      : payoutHistoryRecent.length
                        ? `${payoutHistoryRecent.length} recent payout${payoutHistoryRecent.length === 1 ? "" : "s"}`
                        : "No completed payouts yet."}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/app/payout-history")}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  View full payout history
                </button>
              </div>

              {payoutHistoryRecent.length > 0 ? (
                <div className="mt-4 overflow-x-auto" data-testid="dashboard-payout-history-table">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <th className="py-3 pr-3">Date</th>
                        <th className="py-3 pr-3">Project</th>
                        <th className="py-3 pr-3">Type</th>
                        <th className="py-3">Net Payout</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payoutHistoryRecent.map((row) => (
                        <tr key={row.id} data-testid={`dashboard-payout-row-${row.record_id || row.id}`} className="border-b border-slate-100 last:border-b-0">
                          <td className="py-3 pr-3 text-slate-700">{row.payout_date ? new Date(row.payout_date).toLocaleDateString() : "—"}</td>
                          <td className="py-3 pr-3">
                            <div className="font-semibold text-slate-900">{row.agreement_label}</div>
                            <div className="mt-1 text-xs text-slate-500">{row.source_label}</div>
                          </td>
                          <td className="py-3 pr-3 text-slate-700">{row.record_type_label}</td>
                          <td className="py-3 font-semibold text-slate-900">{currency(row.net_payout)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </DashboardCard>
          </DashboardSection>
          </>
          ) : null}

          <DashboardSection
            title="Bids Snapshot"
            subtitle="A compact look at bid activity before it becomes an agreement."
            variant="premium"
            testId="dashboard-bids-wrapper"
          >
            <DashboardCard
              testId="dashboard-bids-summary"
              tone="premium"
              className="p-4 shadow-[0_22px_50px_rgba(2,8,23,0.34)] md:p-5"
            >
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-white/10 bg-white/10 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-100/75">Open Bids</div>
                  <div className="mt-2 text-2xl font-extrabold text-white">
                    {Number(bidsSnapshotSummary?.open_bids || 0).toLocaleString()}
                  </div>
                  <div className="mt-1 text-xs text-sky-100/70">Draft + Submitted</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/10 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-100/75">
                    Under Review
                  </div>
                  <div className="mt-2 text-2xl font-extrabold text-white">
                    {Number(bidsSnapshotSummary?.under_review_bids || 0).toLocaleString()}
                  </div>
                  <div className="mt-1 text-xs text-sky-100/70">Active bid conversations</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/10 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-100/75">Awarded</div>
                  <div className="mt-2 text-2xl font-extrabold text-white">
                    {Number(bidsSnapshotSummary?.awarded_bids || 0).toLocaleString()}
                  </div>
                  <div className="mt-1 text-xs text-sky-100/70">Ready to convert</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/10 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-100/75">
                    Not Selected / Declined
                  </div>
                  <div className="mt-2 text-2xl font-extrabold text-white">
                    {Number(bidsSnapshotSummary?.declined_expired_bids || 0).toLocaleString()}
                  </div>
                  <div className="mt-1 text-xs text-sky-100/70">Closed opportunities</div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">Recent Bids</div>
                  <div className="mt-1 text-sm text-sky-100/75">
                    {bidsSnapshotLoading
                      ? "Loading bids snapshot..."
                      : bidsSnapshotRecent.length
                        ? `${bidsSnapshotRecent.length} recent bid${bidsSnapshotRecent.length === 1 ? "" : "s"}`
                        : "No bids yet. New bid activity will appear here once it lands."}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/app/bids")}
                  className="rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/15"
                  data-testid="dashboard-bids-view-all"
                >
                  View all bids
                </button>
              </div>

              {bidsSnapshotRecent.length > 0 ? (
                <div className="mt-4 overflow-x-auto" data-testid="dashboard-bids-recent-table">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-left text-xs font-semibold uppercase tracking-wide text-sky-100/65">
                        <th className="py-3 pr-3">Project</th>
                        <th className="py-3 pr-3">Class</th>
                        <th className="py-3 pr-3">Status</th>
                        <th className="py-3">Next Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bidsSnapshotRecent.map((row) => (
                        <tr
                          key={row.bid_id || row.id}
                          data-testid={`dashboard-bids-row-${row.bid_id || row.id}`}
                          className="border-b border-white/10 last:border-b-0"
                        >
                          <td className="py-3 pr-3">
                            <div className="font-semibold text-white">{row.project_title || row.project_name || "Untitled Bid"}</div>
                            <div className="mt-1 text-xs text-sky-100/65">{row.customer_name || "Unknown Customer"}</div>
                            <div className="mt-2">
                              <ProjectModeBadge
                                mode={row.project_mode}
                                dataTestId={`dashboard-bid-project-mode-${row.bid_id || row.id}`}
                              />
                            </div>
                          </td>
                          <td className="py-3 pr-3 text-sky-100/75">{row.project_class_label || row.project_class || "Residential"}</td>
                          <td className="py-3 pr-3 text-sky-100/75">{row.status_label || row.status || "Submitted"}</td>
                          <td className="py-3 text-sky-100/75">{row.next_action?.label || "View details"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </DashboardCard>
          </DashboardSection>
          </div>

          {false ? (
          <DashboardSection
            title="Recommended Project Matches"
            subtitle="Projects that fit your collaboration style, payment preferences, and service capabilities."
          >
            <DashboardCard
              testId="dashboard-recommended-project-matches"
              tone="subtle"
              className="border-slate-200/90 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)]"
            >
              <div className="grid gap-3 md:grid-cols-4">
                {[
                  {
                    label: "New Opportunities",
                    value: contractorMatchOpportunities.counts.pending,
                    tone: "border-blue-200 bg-blue-50 text-blue-800",
                    description: "Homeowners selected you for review.",
                  },
                  {
                    label: "Strong Matches",
                    value: contractorMatchOpportunities.counts.strong,
                    tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
                    description: "Top-fit leads for your current profile.",
                  },
                  {
                    label: "Assisted DIY",
                    value: contractorMatchOpportunities.counts.assisted_diy,
                    tone: "border-amber-200 bg-amber-50 text-amber-800",
                    description: "Collaborative projects that welcome homeowner participation.",
                  },
                  {
                    label: "Rescue Projects",
                    value: contractorMatchOpportunities.counts.rescue,
                    tone: "border-violet-200 bg-violet-50 text-violet-700",
                    description: "Partial-completion and finish-my-project opportunities.",
                  },
                  {
                    label: "Escrow Compatible",
                    value: contractorMatchOpportunities.counts.escrow,
                    tone: "border-sky-200 bg-sky-50 text-sky-700",
                    description: "Projects aligned with milestone payment protection.",
                  },
                ].map((item) => (
                  <div key={item.label} className={`rounded-xl border p-4 ${item.tone}`}>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] opacity-80">
                      {item.label}
                    </div>
                    <div className="mt-2 text-2xl font-extrabold text-slate-900">
                      {Number(item.value || 0).toLocaleString()}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">{item.description}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Why this project matches you</div>
                  <div className="mt-1 text-sm text-slate-600">
                    These leads look like a fit for your service modes, payment preferences, and project style.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/app/public-presence?tab=leads")}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Open lead inbox
                </button>
              </div>

              {contractorMatchOpportunities.rows.length ? (
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {contractorMatchOpportunities.rows.map((row) => (
                    <div key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{row.full_name || row.project_type || "Untitled Lead"}</div>
                          <div className="mt-1 text-xs text-slate-500">{row.project_type || "Project request"}</div>
                        </div>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${contractorMatchTierClass(row.tier)}`}>
                          {contractorMatchTierLabel(row.tier)}
                        </span>
                      </div>
                      <div className="mt-2">
                        <ProjectModeBadge mode={row.requirements?.project_mode || row.project_mode} dataTestId={`dashboard-match-project-mode-${row.id}`} />
                      </div>
                      <div className="mt-3 text-sm font-semibold text-slate-900">
                        {row.matching?.summary || "This opportunity appears aligned with your service profile."}
                      </div>
                      {Array.isArray(row.matching?.badges) && row.matching.badges.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {row.matching.badges.slice(0, 3).map((badge) => (
                            <span key={badge} className="rounded-full border border-white bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm">
                              {badge}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {Array.isArray(row.matching?.reasons) && row.matching.reasons.length ? (
                        <ul className="mt-3 space-y-1 text-xs text-slate-600">
                          {row.matching.reasons.slice(0, 3).map((reason, index) => (
                            <li key={`${row.id}-${index}`}>• {reason}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  No strong project matches yet. Add more profile details or review more leads to sharpen this section.
                </div>
              )}
            </DashboardCard>
          </DashboardSection>
          ) : null}

          {false ? (
          <>
          <DashboardSection
            title="Milestones"
            subtitle="Current work status across your active agreements."
          >
            <DashboardCard
              tone="subtle"
              className="border-slate-200/90 bg-white/92 p-3.5 shadow-[0_12px_30px_rgba(15,23,42,0.05)]"
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <StatCard
                  icon={Target}
                  title="All Milestones"
                  subtitle="Across your active agreements."
                  count={mStats.totalCount}
                  amount={mStats.totalAmount}
                  onClick={() => navigate(`/app/milestones`)}
                />
                <StatCard
                  icon={ListTodo}
                  title="Incomplete"
                  subtitle="Not yet completed."
                  count={mStats.notStartedCount + mStats.inProgressCount}
                  amount={mStats.notStartedAmount + mStats.inProgressAmount}
                  onClick={() => navigate(`/app/milestones?filter=incomplete`)}
                />
                <StatCard
                  icon={CheckCircle2}
                  title="Completed"
                  subtitle="Completed but not yet invoiced."
                  count={mStats.completedCount}
                  amount={mStats.completedAmount}
                  onClick={() => navigate(`/app/milestones?filter=complete_not_invoiced`)}
                />
                <StatCard
                  icon={BadgeDollarSign}
                  title="Invoiced"
                  subtitle="Already tied to an invoice or request."
                  count={mStats.invoicedCount}
                  amount={mStats.invoicedAmount}
                  onClick={goInvoices}
                />
                <StatCard
                  icon={Wrench}
                  title="Rework Work Orders"
                  subtitle="Milestones created from disputes."
                  count={mStats.reworkCount}
                  amount={mStats.reworkAmount}
                  onClick={goReworkMilestones}
                />
              </div>
            </DashboardCard>
          </DashboardSection>

          <DashboardSection
            title="Invoices"
            subtitle="Approvals, disputes, and payout status."
          >
            <DashboardCard
              tone="subtle"
              className="border-slate-200/90 bg-white/92 p-3.5 shadow-[0_12px_30px_rgba(15,23,42,0.05)]"
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  icon={BadgeDollarSign}
                  title="Pending Approval"
                  subtitle="Sent to homeowner — awaiting approval."
                  count={iStats.pendingCount}
                  amount={iStats.pendingAmount}
                  onClick={goInvoices}
                />
                <StatCard
                  icon={BadgeCheck}
                  title="Approved"
                  subtitle="Approved — ready for payout."
                  count={iStats.approvedCount}
                  amount={iStats.approvedAmount}
                  onClick={goInvoices}
                />
                <StatCard
                  icon={AlertTriangle}
                  title="Disputed"
                  subtitle="Frozen until resolved."
                  count={iStats.disputedCount}
                  amount={iStats.disputedAmount}
                  onClick={goInvoicesDisputed}
                />
                <StatCard
                  icon={WalletMinimal}
                  title="Earned (YTD)"
                  subtitle="Jan 1 → today. Click for breakdown."
                  count={null}
                  amount={earnedYtdAmount}
                  onClick={openEarnedModal}
                />
              </div>
            </DashboardCard>
          </DashboardSection>
          </>
          ) : null}

          {false ? (
          <DashboardSection
            title="Quick Actions"
            subtitle="Only the actions that move work and money forward."
          >
            <DashboardCard
              testId="dashboard-quick-actions-row"
              tone="subtle"
              className="border-slate-200/90 bg-white p-3.5 shadow-[0_14px_32px_rgba(15,23,42,0.06)]"
            >
              <div className="grid gap-2.5 md:grid-cols-2">
                <ActionButton
                  icon={FilePlus2}
                  label="New Agreement"
                  primary
                  onClick={goNewAgreement}
                  hint="Start a new agreement and move it toward signature."
                />
                <ActionButton
                  icon={ListPlus}
                  label="New Milestone"
                  onClick={goNewMilestone}
                  hint="Add a milestone so work, approval, and payment can move forward."
                />
                <ActionButton
                  icon={Receipt}
                  label="Send Payment Request"
                  onClick={goInvoices}
                  hint="Open payment tools so you can create or send the next request."
                />
                <ActionButton
                  icon={Receipt}
                  label="Log Expense"
                  onClick={openNewExpense}
                  hint="Log an expense and send it to the customer when needed."
                />
              </div>
            </DashboardCard>
          </DashboardSection>
          ) : null}

          {showActivityFeed ? (
            <DashboardSection
              title="Recent Activity"
              subtitle="A quieter view of recent workflow changes."
            >
              <div className="space-y-2.5" data-testid="dashboard-activity-feed">
                {activityFeed.slice(0, 5).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(item.navigation_target || "/app/dashboard")}
                    className={`w-full rounded-2xl border px-4 py-3 text-left shadow-sm ${activityAccent(item.severity)}`}
                    data-testid={`dashboard-activity-item-${item.id}`}
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{item.title}</div>
                        <div className="mt-1 line-clamp-2 text-sm text-current/90">{item.summary}</div>
                      </div>
                      <div className="shrink-0 text-xs font-semibold opacity-80">
                        {formatActivityTimestamp(item.created_at)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </DashboardSection>
          ) : null}
        </div>
      ) : null}

      {false ? (
        <div
          className="mb-4 rounded-2xl border border-white/28 bg-white/58 p-4 shadow-[0_8px_22px_rgba(15,23,42,0.05)] backdrop-blur-sm"
          data-testid="dashboard-sms-automation"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            SMS Automation
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <div className="rounded-xl bg-slate-50/90 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Status
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {contractorProfile?.sms_automation_enabled ? "Enabled" : "Off"}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50/90 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Sent 7d
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {contractorProfile?.sent_sms_count_7d || 0}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50/90 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Suppressed 7d
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {contractorProfile?.suppressed_sms_count_7d || 0}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50/90 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Deferred 7d
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {contractorProfile?.deferred_sms_count_7d || 0}
              </div>
            </div>
          </div>
          {contractorProfile?.last_sms_automation_decision ? (
            <div className="mt-3 text-xs text-slate-500">
              Last decision:{" "}
              <span className="font-semibold text-slate-700">
                {contractorProfile.last_sms_automation_decision.reason_code}
              </span>
              {" · "}
              {contractorProfile.last_sms_automation_decision.message_preview || "No preview available."}
            </div>
          ) : (
            <div className="mt-3 text-xs text-slate-500">
              No automation decisions yet.
            </div>
          )}
        </div>
      ) : null}

      {false ? (
        <div className="mb-4 rounded-2xl border border-white/26 bg-white/56 p-3.5 shadow-[0_8px_24px_rgba(15,23,42,0.05)] backdrop-blur-sm">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            MyHomeBro Pricing
          </div>
          <div className="mhb-grid" style={{ marginBottom: 0 }}>
            <StatCard icon={BadgeDollarSign} title={currentRateTitle} subtitle={pricingSubtitle} count={null} amount={null} onClick={null} />
          </div>
        </div>
      ) : null}

      {isEmployee ? (
        <>
          <div className="mhb-kicker">Milestones</div>
          <div className="mhb-grid" style={{ marginBottom: 6 }}>
            <StatCard
              icon={Target}
              title="My Assigned Milestones"
              subtitle="Only milestones assigned to you."
              count={mStats.totalCount}
              amount={mStats.totalAmount}
              onClick={() => navigate(`/app/milestones`)}
            />

            <StatCard
              icon={ListTodo}
              title="Incomplete"
              subtitle="Not yet completed."
              count={mStats.notStartedCount + mStats.inProgressCount}
              amount={mStats.notStartedAmount + mStats.inProgressAmount}
              onClick={() => navigate(`/app/milestones?filter=incomplete`)}
            />

            <StatCard
              icon={CheckCircle2}
              title="Completed"
              subtitle="Completed by you."
              count={0}
              amount={0}
              onClick={() => navigate(`/app/milestones`)}
            />

            <StatCard
              icon={Wrench}
              title="Rework Work Orders"
              subtitle="Milestones created from disputes."
              count={mStats.reworkCount}
              amount={mStats.reworkAmount}
              onClick={goReworkMilestones}
            />
          </div>
        </>
      ) : null}

      {false ? (
        <>
          <div className="mhb-kicker" style={{ marginTop: 14 }}>
            Invoices
          </div>
          <div className="mhb-grid">
            <StatCard
              icon={BadgeDollarSign}
              title="Pending Approval"
              subtitle="Sent to homeowner — awaiting approval."
              count={iStats.pendingCount}
              amount={iStats.pendingAmount}
              onClick={goInvoices}
            />
            <StatCard
              icon={BadgeCheck}
              title="Approved"
              subtitle="Approved — ready for payout."
              count={iStats.approvedCount}
              amount={iStats.approvedAmount}
              onClick={goInvoices}
            />
            <StatCard
              icon={AlertTriangle}
              title="Disputed"
              subtitle="Frozen until resolved."
              count={iStats.disputedCount}
              amount={iStats.disputedAmount}
              onClick={goInvoicesDisputed}
            />
            <StatCard
              icon={WalletMinimal}
              title="Earned (YTD)"
              subtitle="Jan 1 → today. Click for breakdown."
              count={null}
              amount={earnedYtdAmount}
              onClick={openEarnedModal}
            />
          </div>
        </>
      ) : null}

      </div>


      {!isEmployee ? <ExpenseRequestModal isOpen={showExpenseModal} onClose={onExpenseModalClose} /> : null}

      {!isEmployee ? (
        <EarnedBreakdownModal
          isOpen={showEarnedModal}
          onClose={closeEarnedModal}
          invoices={invoices}
          expenses={earnedExpenses}
          loading={earnedLoading}
        />
      ) : null}
    </PageShell>
  );
}
