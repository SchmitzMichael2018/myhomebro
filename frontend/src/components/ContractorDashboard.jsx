// src/components/ContractorDashboard.jsx
import React, { useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { toast } from "react-hot-toast";
import PageShell from "./PageShell.jsx";
import StatCard from "./StatCard.jsx";
import Modal from "react-modal";
import DashboardCard from "./dashboard/DashboardCard.jsx";
import DashboardSection from "./dashboard/DashboardSection.jsx";
import {
  Target,
  ListTodo,
  CheckCircle2,
  BadgeDollarSign,
  BadgeCheck,
  WalletMinimal,
  FilePlus2,
  ListPlus,
  Receipt,
  CalendarDays,
  AlertTriangle,
  Wrench,
  X,
  ChevronDown,
  ChevronRight,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { getDashboardNextSteps } from "../lib/workflowHints.js";

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

function pluralizeNeedsAttention(count, noun) {
  return `${count} ${noun}${count === 1 ? " is" : "s are"}`;
}

function buildNeedsAttentionRouteItem({ key, label, filterType }) {
  return {
    id: key,
    key,
    label,
    filterType,
    href: `/app/agreements?focus=needs_attention&filter=${filterType}`,
    ctaText: "Open",
  };
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
    try {
      setSub(true);
      const fd = new FormData();
      if (form.agreement) fd.append("agreement", form.agreement);
      fd.append("description", form.description.trim());
      fd.append("amount", form.amount);
      if (form.incurred_date) fd.append("incurred_date", form.incurred_date);
      if (form.notes_to_homeowner) fd.append("notes_to_homeowner", form.notes_to_homeowner);
      if (form.file) fd.append("receipt", form.file);

      const createRes = await api.post("/projects/expenses/", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const created = createRes.data;

      await api.post(`/projects/expenses/${created.id}/contractor_sign/`);
      await api.post(`/projects/expenses/${created.id}/send_to_homeowner/`);

      toast.success("Expense sent to customer.");
      onClose(true);
    } catch (e) {
      console.error(e);
      toast.error("Failed to create/send expense.");
    } finally {
      setSub(false);
    }
  };

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
            {sub ? "Sending…" : "Sign & Send to Customer"}
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
/* =============================== MAIN VIEW ================================= */
/* ========================================================================== */
export default function ContractorDashboard() {
  const [who, setWho] = useState(null);
  const [contractorProfile, setContractorProfile] = useState(null);
  const [activityFeed, setActivityFeed] = useState([]);
  const [nextBestAction, setNextBestAction] = useState(null);

  const [agreements, setAgreements] = useState([]);
  const [publicLeads, setPublicLeads] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [invoices, setInvoices] = useState([]);

  const [showExpenseModal, setShowExpenseModal] = useState(false);

  // Earned modal + paid expenses cache
  const [showEarnedModal, setShowEarnedModal] = useState(false);
  const [earnedLoading, setEarnedLoading] = useState(false);
  const [earnedExpenses, setEarnedExpenses] = useState([]);
  const [earnedExpensesLoading, setEarnedExpensesLoading] = useState(false);

  const navigate = useNavigate();

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
  }, []);

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
          return;
        }

        const [mRes, iRes, aRes, lRes] = await Promise.allSettled([
          api.get("/projects/milestones/"),
          api.get("/projects/invoices/"),
          api.get("/projects/agreements/"),
          api.get("/projects/contractor/public-leads/"),
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

        if (lRes.status === "fulfilled") {
          const list = Array.isArray(lRes.value.data)
            ? lRes.value.data
            : lRes.value.data?.results || [];
          setPublicLeads(list);
        } else {
          console.error(lRes.reason);
          setPublicLeads([]);
        }
      } catch (e) {
        console.error(e);
        toast.error("Failed to load dashboard data.");
      }
    })();

    return () => (mounted = false);
  }, [who, isEmployee]);

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
        console.error("Failed to load pricing (funding_preview)", err);
        if (!mounted) return;
        setPricing({ loading: false, rate: null, fixed_fee: 1, is_intro: null, tier_name: null, error: "" });
      }
    };

    loadPricing();
    return () => {
      mounted = false;
    };
  }, [isEmployee]);

  // Build invoice lookup map (so milestones can compute Paid)
  const invoicesById = useMemo(() => {
    const map = {};
    for (const inv of Array.isArray(invoices) ? invoices : []) {
      const id = inv?.id ?? inv?.invoice_id ?? inv?.pk ?? null;
      if (id != null && String(id).trim() !== "") map[String(id)] = inv;
    }
    return map;
  }, [invoices]);

  /* ----- milestone stats (aligned with MilestoneList filters) ----- */
  const mStats = useMemo(() => {
    const all = Array.isArray(milestones) ? milestones : [];
    const allAmt = sum(all);

    const rework = all.filter(isReworkMilestone);
    const reworkAmt = sum(rework);

    const nonRework = all.filter((m) => !isReworkMilestone(m));

    const incomp = nonRework.filter(isMilestoneIncomplete);
    const incompAmt = sum(incomp);

    const ready = nonRework.filter((m) => isMilestoneReadyToInvoice(m, invoicesById));
    const readyAmt = sum(ready);

    const paid = nonRework.filter((m) => isMilestonePaid(m, invoicesById));
    const paidAmt = sum(paid);

    return {
      totalCount: all.length,
      totalAmount: allAmt,

      incompleteCount: incomp.length,
      incompleteAmount: incompAmt,

      readyCount: ready.length,
      readyAmount: readyAmt,

      paidCount: paid.length,
      paidAmount: paidAmt,

      reworkCount: rework.length,
      reworkAmount: reworkAmt,
    };
  }, [milestones, invoicesById]);

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
  const dashboardNextSteps = useMemo(
    () =>
      getDashboardNextSteps({
        leads: publicLeads,
        agreements,
        milestones,
      }),
    [agreements, milestones, publicLeads]
  );

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

    const milestoneItems = (milestones || [])
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
  }, [invoices, invoicesById, milestones]);

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
  const goInvoices = () => navigate(`/app/invoices`);
  const goInvoicesDisputed = () => navigate(`/app/invoices?filter=disputed`);
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
  const heroAction = useMemo(() => {
    const backendLooksLikeSetupPrompt =
      typeof nextBestAction?.title === "string"
        && /finish onboarding|finish your setup|resume onboarding|complete setup/i.test(nextBestAction.title);

    if (nextBestAction?.title && !(isOnboardingComplete && backendLooksLikeSetupPrompt)) {
      return {
        title: nextBestAction.title,
        message: nextBestAction.message,
        rationale: nextBestAction.rationale,
        ctaLabel: nextBestAction.cta_label || "Open",
        navigationTarget: nextBestAction.navigation_target || "/app/dashboard",
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
  }, [goStartFirstProjectWithAi, hasProjectsStarted, isOnboardingComplete, nextBestAction]);
  const needsAttentionItems = useMemo(() => {
    const mapped = [];
    const seen = new Set();
    const addItem = (item) => {
      if (!item || seen.has(item.key)) return;
      seen.add(item.key);
      mapped.push(item);
    };

    (Array.isArray(dashboardNextSteps) ? dashboardNextSteps : []).forEach((item) => {
      const label = String(item || "").trim();
      const lower = label.toLowerCase();
      if (!label) return;

      if (lower.includes("waiting for signature")) {
        addItem(
          buildNeedsAttentionRouteItem({
            key: "awaiting_signature",
            label,
            filterType: "awaiting_signature",
          })
        );
        return;
      }

      if (lower.includes("waiting for funding")) {
        addItem(
          buildNeedsAttentionRouteItem({
            key: "awaiting_funding",
            label,
            filterType: "awaiting_funding",
          })
        );
        return;
      }

      if (lower.includes("awaiting review") || lower.includes("pending approval")) {
        addItem(
          buildNeedsAttentionRouteItem({
            key: "pending_approval",
            label,
            filterType: "pending_approval",
          })
        );
        return;
      }

      addItem({
        id: `needs-attention-${mapped.length}`,
        key: `needs-attention-${mapped.length}`,
        label,
        filterType: "",
        href: "/app/agreements",
        ctaText: "Open",
      });
    });

    if (iStats.pendingCount > 0) {
      addItem(
        buildNeedsAttentionRouteItem({
          key: "pending_approval",
          label: `${pluralizeNeedsAttention(iStats.pendingCount, "invoice")} pending approval.`,
          filterType: "pending_approval",
        })
      );
    }

    if (iStats.disputedCount > 0) {
      addItem(
        buildNeedsAttentionRouteItem({
          key: "disputed",
          label: `${pluralizeNeedsAttention(iStats.disputedCount, "invoice")} disputed.`,
          filterType: "disputed",
        })
      );
    }

    return mapped.slice(0, 3);
  }, [dashboardNextSteps, iStats.disputedCount, iStats.pendingCount]);
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
  const hasUrgentSchedule = dueSchedule.late.count > 0 || dueSchedule.today.count > 0;
  const scheduleHasItems =
    dueSchedule.late.count > 0 ||
    dueSchedule.today.count > 0 ||
    dueSchedule.tomorrow.count > 0 ||
    dueSchedule.week.count > 0;
  const workMoneyConnectorLabel =
    mStats.readyCount > 0
      ? `${mStats.readyCount} ${mStats.readyCount === 1 ? "milestone" : "milestones"} ready to invoice`
      : iStats.pendingCount > 0
      ? `${iStats.pendingCount} ${iStats.pendingCount === 1 ? "invoice" : "invoices"} awaiting customer`
      : "Completed work flows into invoices and payout";
  const heroBand = useMemo(() => {
    const hasOperationalPressure =
      needsAttentionItems.length > 0 ||
      dueSchedule.late.count > 0 ||
      dueSchedule.today.count > 0 ||
      mStats.readyCount > 0 ||
      iStats.pendingCount > 0 ||
      iStats.approvedCount > 0;

    const looksLikeSetup =
      !hasProjectsStarted ||
      !isOnboardingComplete ||
      /onboard|setup|stripe|profile|first agreement/i.test(
        `${heroAction.title || ""} ${heroAction.message || ""}`
      );

    if (!nextBestAction?.title && hasProjectsStarted && !hasOperationalPressure) {
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
      label: "NEXT ACTION",
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
    iStats.approvedCount,
    iStats.pendingCount,
    isOnboardingComplete,
    mStats.readyCount,
    needsAttentionItems.length,
    nextBestAction?.title,
  ]);
  const showActivityFeed = !isEmployee && activityFeed.length > 0;

  return (
    <PageShell
      title="Dashboard"
      subtitle={greetingName ? `Good to see you, ${greetingName}.` : null}
      showLogo={false}
      compact
      titleClassName="drop-shadow-none"
    >
      <div className="space-y-5">

      {!isEmployee ? (
        <div className="space-y-5">
          <DashboardCard
            testId="dashboard-next-best-action"
            className={`overflow-hidden border p-0 shadow-[0_20px_48px_rgba(15,23,42,0.12)] ${
              heroBand.quiet
                ? "border-[#d6e1ee] bg-white"
                : heroBand.setup
                ? "border-[#b8d1eb] bg-gradient-to-r from-[#eef5fc] via-white to-[#f7fbff]"
                : "border-[#1e558f] bg-gradient-to-r from-[#18395f] via-[#1b4d85] to-[#245b96]"
            }`}
          >
            <div className="flex flex-col gap-5 px-5 py-5 md:px-7 md:py-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div
                  className={`text-[11px] font-semibold uppercase tracking-[0.22em] ${
                    heroBand.quiet
                      ? "text-[#4f6f95]"
                      : heroBand.setup
                      ? "text-[#2b5d95]"
                      : "text-sky-100"
                  }`}
                >
                  {heroBand.label}
                </div>
                <div
                  className={`mt-3 text-2xl font-semibold tracking-tight md:text-[2rem] ${
                    heroBand.quiet ? "text-[#19395f]" : heroBand.setup ? "text-[#18395f]" : "text-white"
                  }`}
                >
                  {heroBand.title}
                </div>
                <div
                  className={`mt-2 text-sm md:text-[15px] ${
                    heroBand.quiet ? "text-slate-700" : heroBand.setup ? "text-slate-700" : "text-sky-50"
                  }`}
                >
                  {heroBand.message}
                </div>
                {heroBand.rationale ? (
                  <div className={`mt-3 text-xs font-medium ${heroBand.setup ? "text-[#526d8a]" : "text-sky-100/90"}`}>
                    {heroBand.rationale}
                  </div>
                ) : null}
              </div>
              {!heroBand.quiet && heroBand.ctaLabel ? (
                <button
                  type="button"
                  onClick={() => {
                    if (typeof heroBand.action === "function") {
                      heroBand.action();
                      return;
                    }
                    navigate(heroBand.navigationTarget || "/app/dashboard");
                  }}
                  className={`inline-flex items-center justify-center gap-2 self-start rounded-xl px-4 py-2.5 text-sm font-semibold ${
                    heroBand.setup
                      ? "bg-[#18395f] text-white hover:bg-[#15314f]"
                      : "bg-white text-[#18395f] hover:bg-sky-50"
                  }`}
                >
                  {heroBand.ctaLabel}
                  <ArrowRight className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </DashboardCard>

          {needsAttentionItems.length ? (
            <DashboardSection
              title="Needs Attention"
              subtitle="Urgent approvals, signatures, disputes, or funding issues."
            >
              <DashboardCard
                testId="dashboard-needs-attention"
                tone="subtle"
                className="border-amber-200/90 bg-amber-50/75 p-4 shadow-[0_10px_26px_rgba(245,158,11,0.08)]"
              >
                <div className="space-y-2">
                  {needsAttentionItems.map((item) => (
                    <button
                      key={item.id}
                      data-testid={item.filterType ? `dashboard-needs-attention-item-${item.filterType}` : undefined}
                      type="button"
                      onClick={() => navigate(item.href || "/app/dashboard")}
                      className="flex w-full items-center gap-3 rounded-xl border border-amber-200/80 bg-white px-3.5 py-3 text-left transition hover:border-amber-300 hover:bg-amber-50/60 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2"
                    >
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
                      <span className="min-w-0 flex-1 text-sm font-medium text-slate-800">{item.label}</span>
                      <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-amber-900">
                        {item.ctaText || "Open"}
                      </span>
                    </button>
                  ))}
                </div>
              </DashboardCard>
            </DashboardSection>
          ) : null}

          <DashboardSection
            title="Schedule"
            subtitle="Keep an eye on what needs attention first."
          >
            <DashboardCard
              tone="subtle"
              className={`border-slate-200/90 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.05)] ${
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
                        subtitle="Overdue milestones, invoices, or agreements needing follow-up."
                        count={dueSchedule.late.count}
                        amount={dueSchedule.late.amount}
                        onClick={goAgreementScheduleLate}
                      />
                    </div>
                    <div data-testid="dashboard-schedule-today">
                      <StatCard
                        icon={CalendarDays}
                        title="Due Today"
                        subtitle="Immediate actions and scheduled work."
                        count={dueSchedule.today.count}
                        amount={dueSchedule.today.amount}
                        onClick={goAgreementScheduleToday}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2.5 md:grid-cols-2">
                    <button
                      type="button"
                      data-testid="dashboard-schedule-tomorrow"
                      onClick={goAgreementScheduleTomorrow}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:border-slate-300 hover:bg-slate-100"
                    >
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Due Tomorrow</div>
                        <div className="mt-1 text-xs font-medium text-slate-600">
                          {dueSchedule.tomorrow.count} items | {currency(dueSchedule.tomorrow.amount)}
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-slate-500" />
                    </button>
                    <button
                      type="button"
                      data-testid="dashboard-schedule-week"
                      onClick={goAgreementScheduleWeek}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:border-slate-300 hover:bg-slate-100"
                    >
                      <div>
                        <div className="text-sm font-semibold text-slate-900">This Week</div>
                        <div className="mt-1 text-xs font-medium text-slate-600">
                          {dueSchedule.week.count} items | {currency(dueSchedule.week.amount)}
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-slate-500" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={goCalendar}
                  className="flex w-full items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3 text-left"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Schedule is clear</div>
                    <div className="mt-1 text-xs font-medium text-slate-600">
                      No overdue or upcoming due items are surfaced right now.
                    </div>
                  </div>
                  <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              )}
            </DashboardCard>
          </DashboardSection>

          <DashboardSection
            title="Work and Money"
            subtitle="Follow the handoff from completed work to invoice approval and payout."
          >
            <DashboardCard
              tone="subtle"
              className="border-slate-200/90 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)] md:p-5"
            >
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] xl:items-start">
                <div className="space-y-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#52749a]">
                      Active Work
                    </div>
                    <div className="mt-1 text-lg font-semibold text-[#18395f]">What is moving toward invoice</div>
                  </div>
                  <FlowMetricButton
                    icon={ListTodo}
                    label="In Progress"
                    description="Milestones that still need work or completion."
                    count={mStats.incompleteCount}
                    amount={mStats.incompleteAmount}
                    onClick={() => navigate(`/app/milestones?filter=incomplete`)}
                    testId="dashboard-work-in-progress"
                  />
                  <FlowMetricButton
                    icon={CheckCircle2}
                    label="Ready to Invoice"
                    description="Completed work ready for the payment handoff."
                    count={mStats.readyCount}
                    amount={mStats.readyAmount}
                    onClick={() => navigate(`/app/milestones?filter=complete_not_invoiced`)}
                    emphasized
                    testId="dashboard-work-ready-to-invoice"
                  />
                  <FlowMetricButton
                    icon={BadgeDollarSign}
                    label="Paid Work"
                    description="Milestones already tied to paid or released funds."
                    count={mStats.paidCount}
                    amount={mStats.paidAmount}
                    onClick={() => navigate(`/app/milestones?filter=paid`)}
                    testId="dashboard-work-paid"
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
                      Money Status
                    </div>
                    <div className="mt-1 text-lg font-semibold text-[#18395f]">Where the money is now</div>
                  </div>
                  <FlowMetricButton
                    icon={BadgeDollarSign}
                    label="Awaiting Customer"
                    description="Invoices sent and waiting on customer approval."
                    count={iStats.pendingCount}
                    amount={iStats.pendingAmount}
                    onClick={goInvoices}
                    emphasized={iStats.pendingCount > 0}
                    testId="dashboard-money-awaiting-customer"
                  />
                  <FlowMetricButton
                    icon={BadgeCheck}
                    label="Approved / Unpaid"
                    description="Approved invoices that are lined up for payout."
                    count={iStats.approvedCount}
                    amount={iStats.approvedAmount}
                    onClick={goInvoices}
                    testId="dashboard-money-approved"
                  />
                  <FlowMetricButton
                    icon={WalletMinimal}
                    label="Paid Out"
                    description="Money paid out this year across invoices and paid expenses."
                    count={iStats.earnedCount}
                    amount={earnedYtdAmount}
                    onClick={openEarnedModal}
                    testId="dashboard-money-paid-out"
                  />
                </div>
              </div>
            </DashboardCard>
          </DashboardSection>

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
                  count={mStats.incompleteCount}
                  amount={mStats.incompleteAmount}
                  onClick={() => navigate(`/app/milestones?filter=incomplete`)}
                />
                <StatCard
                  icon={CheckCircle2}
                  title="Ready to Invoice"
                  subtitle="Completed (Not Invoiced)."
                  count={mStats.readyCount}
                  amount={mStats.readyAmount}
                  onClick={() => navigate(`/app/milestones?filter=complete_not_invoiced`)}
                />
                <StatCard
                  icon={BadgeDollarSign}
                  title="Paid"
                  subtitle="Escrow released / paid."
                  count={mStats.paidCount}
                  amount={mStats.paidAmount}
                  onClick={() => navigate(`/app/milestones?filter=paid`)}
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
                  label="Send Invoice"
                  onClick={goInvoices}
                  hint="Open invoices so you can create or send the next one."
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
              count={mStats.incompleteCount}
              amount={mStats.incompleteAmount}
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
