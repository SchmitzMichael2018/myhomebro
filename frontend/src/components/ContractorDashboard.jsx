// src/components/ContractorDashboard.jsx
import React, { useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "react-modal";
import { toast } from "react-hot-toast";
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
  Clock3,
  CalendarClock,
} from "lucide-react";

import api from "../api";
import PageShell from "./PageShell.jsx";
import DashboardCard from "./dashboard/DashboardCard.jsx";
import DashboardSection from "./dashboard/DashboardSection.jsx";
import { getDashboardNextSteps } from "../lib/workflowHints.js";

Modal.setAppElement("#root");

/* ------------------------------ helpers ------------------------------ */
const money = (n) => Number(n || 0);
const sum = (arr, key = "amount") => arr.reduce((a, x) => a + money(x?.[key]), 0);
const norm = (s) => (s || "").toString().toLowerCase();

function parseDateAny(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfYear(d) {
  return new Date(d.getFullYear(), 0, 1);
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
  if (severity === "critical") {
    return "border-rose-200 bg-rose-50 text-rose-900";
  }
  if (severity === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  if (severity === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  return "border-slate-200 bg-slate-50 text-slate-900";
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

function getMilestoneDueDate(m) {
  return (
    parseDateAny(m?.due_date) ||
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
    parseDateAny(inv?.approval_due_date) ||
    parseDateAny(inv?.scheduled_release_date) ||
    parseDateAny(inv?.created_at) ||
    null
  );
}

function normalizeNeedsAttentionItem(item, index = 0) {
  if (typeof item === "string") {
    return {
      id: `needs-attention-${index}`,
      label: item,
      ctaText: "Open",
      href: "/app/agreements",
      action: null,
    };
  }

  const label =
    item?.label ||
    item?.title ||
    item?.message ||
    item?.summary ||
    item?.text ||
    item?.description ||
    "";

  const ctaText =
    item?.ctaText ||
    item?.cta_label ||
    item?.cta ||
    item?.actionLabel ||
    item?.buttonLabel ||
    item?.action?.label ||
    "Open";

  const href =
    item?.href ||
    item?.navigation_target ||
    item?.target ||
    item?.action?.target ||
    "/app/agreements";

  return {
    ...item,
    id: item?.id || item?.key || `needs-attention-${index}`,
    label,
    ctaText,
    href,
    action: typeof item?.action === "function" ? item.action : null,
  };
}

/* --------------------------- milestone helpers --------------------------- */
const getInvoiceIdFromMilestone = (m) => {
  const inv = m?.invoice;
  if (inv && typeof inv === "object") return inv?.id ?? inv?.invoice_id ?? inv?.pk ?? null;
  return m?.invoice_id ?? m?.invoiceId ?? m?.invoice ?? null;
};

const milestoneStatus = (m) => norm(m?.status || m?.milestone_status || m?.state || "");

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

const isMilestoneReadyToInvoice = (m, invoicesById) => {
  if (!isMilestoneCompleted(m)) return false;
  if (isMilestonePaid(m, invoicesById)) return false;

  const hasInv = m?.is_invoiced === true || !!getInvoiceIdFromMilestone(m);
  return !hasInv;
};

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

  if (["pending", "pending_approval", "sent", "awaiting_approval"].includes(s)) return "pending";
  if (["approved", "ready_to_pay"].includes(s)) return "approved";

  return "pending";
};

/* ------------------------------ UI bits ------------------------------ */
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
        padding: primary ? "12px 14px" : "11px 14px",
        fontSize: 14,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 0,
      }}
    >
      {Icon ? <Icon size={16} /> : null}
      <span style={{ marginLeft: 8, fontWeight: 900, whiteSpace: "nowrap" }}>{label}</span>
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

function CompactStatCard({ icon: Icon, title, subtitle, count, amount, onClick }) {
  const content = (
    <div className="h-full min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-md transition hover:-translate-y-[1px] hover:shadow-lg">
      <div className="flex h-full flex-col justify-between gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-3">
              {Icon ? (
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                  <Icon className="h-4 w-4" />
                </span>
              ) : null}

              <div className="min-w-0 flex-1">
                <div
                  className="text-[16px] font-semibold leading-6 text-slate-950"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {title}
                </div>
              </div>
            </div>

            {subtitle ? (
              <div className="mt-3 text-[14px] leading-6 text-slate-700">
                {subtitle}
              </div>
            ) : null}
          </div>

          <div className="shrink-0 text-right">
            <div className="text-[22px] font-bold tracking-tight text-slate-950">
              {currency(amount || 0)}
            </div>
          </div>
        </div>

        {count !== null && count !== undefined ? (
          <div className="text-sm font-medium text-slate-600">
            {count} {count === 1 ? "item" : "items"}
          </div>
        ) : (
          <div />
        )}
      </div>
    </div>
  );

  if (!onClick) return <div className="h-full">{content}</div>;

  return (
    <button type="button" onClick={onClick} className="block h-full min-w-0 text-left">
      {content}
    </button>
  );
}

function DueStatCard({ icon: Icon, title, subtitle, count, amount, onClick }) {
  return (
    <button type="button" onClick={onClick} className="block h-full min-w-0 text-left">
      <DashboardCard className="h-full border-slate-200 bg-white p-5 shadow-md transition hover:-translate-y-[1px] hover:shadow-lg">
        <div className="flex h-full flex-col justify-between gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                {Icon ? (
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                    <Icon className="h-4 w-4" />
                  </span>
                ) : null}
                <div className="truncate text-[16px] font-semibold text-slate-950">{title}</div>
              </div>
              <div className="mt-3 text-[14px] leading-6 text-slate-700">{subtitle}</div>
            </div>

            <div className="shrink-0 text-right">
              <div className="text-[22px] font-bold tracking-tight text-slate-950">
                {currency(amount || 0)}
              </div>
            </div>
          </div>

          <div className="text-sm font-medium text-slate-600">
            {count} {count === 1 ? "item" : "items"}
          </div>
        </div>
      </DashboardCard>
    </button>
  );
}

/* --------------------------- Expense modal --------------------------- */
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
      className="mx-auto mt-24 w-[90vw] max-w-2xl rounded-xl bg-white p-6 shadow-2xl outline-none"
      overlayClassName="fixed inset-0 bg-black/50 flex items-start justify-center"
    >
      <div className="mb-4 flex items-start justify-between">
        <h2 className="text-xl font-semibold text-slate-950">New Expense</h2>
        <button onClick={() => onClose(false)} className="rounded-lg border px-3 py-1.5" type="button">
          Close
        </button>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-800">Agreement (optional)</label>
            <select
              name="agreement"
              value={form.agreement}
              onChange={onChange}
              className="w-full rounded-lg border px-3 py-2"
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
            <label className="mb-1 block text-sm font-medium text-slate-800">Incurred Date</label>
            <input
              type="date"
              name="incurred_date"
              value={form.incurred_date}
              onChange={onChange}
              className="w-full rounded-lg border px-3 py-2"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-800">Description</label>
            <input
              name="description"
              value={form.description}
              onChange={onChange}
              className="w-full rounded-lg border px-3 py-2"
              placeholder="e.g. Dump fee, rental, small materials"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-800">Amount</label>
            <input
              type="number"
              step="0.01"
              name="amount"
              value={form.amount}
              onChange={onChange}
              className="w-full rounded-lg border px-3 py-2"
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-800">Receipt (PDF or Image)</label>
            <input type="file" accept="image/*,pdf" onChange={onFile} className="w-full" />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-800">Notes to Customer (optional)</label>
          <textarea
            name="notes_to_homeowner"
            value={form.notes_to_homeowner}
            onChange={onChange}
            className="min-h-[90px] w-full rounded-lg border px-3 py-2"
            placeholder="Explain why this expense is needed."
          />
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onClose(false)} className="rounded-lg border px-4 py-2">
            Cancel
          </button>
          <button
            type="submit"
            disabled={sub}
            className={`rounded-lg px-4 py-2 font-semibold text-white ${
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

/* ----------------------- Earned breakdown modal ----------------------- */
function agreementKeyFromItem(item, fallbackPrefix) {
  const agId =
    item?.agreement_id ?? item?.agreement ?? item?.agreement?.id ?? item?.agreementId ?? null;
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
    item?.agreement_id ?? item?.agreement ?? item?.agreement?.id ?? item?.agreementId ?? null;

  if (t && String(t).trim()) return String(t);
  if (agId != null && String(agId).trim() !== "") return `Agreement #${agId}`;
  return fallbackTitle;
}

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
  const [range, setRange] = useState("30d");
  const [openAgreements, setOpenAgreements] = useState({});

  useEffect(() => {
    if (!isOpen) return;
    setOpenAgreements({});
    setRange("30d");
  }, [isOpen]);

  const { fromDate, toDate, rangeLabel } = useMemo(() => {
    const now = new Date();
    if (range === "year") return { fromDate: startOfYear(now), toDate: null, rangeLabel: "This Year" };
    if (range === "all") return { fromDate: null, toDate: null, rangeLabel: "All Time" };
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return { fromDate: d, toDate: null, rangeLabel: "Last 30 Days" };
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
      ensureGroup(k, agreementTitleFromItem(inv)).escrow.push(inv);
    }
    for (const inv of filtered.directPay) {
      const k = agreementKeyFromItem(inv, "inv");
      ensureGroup(k, agreementTitleFromItem(inv)).directPay.push(inv);
    }
    for (const ex of filtered.expenses) {
      const k = agreementKeyFromItem(ex, "exp");
      ensureGroup(k, agreementTitleFromItem(ex, "Other (No Agreement)")).expenses.push(ex);
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
            <div
              style={{
                color: "#475569",
                fontSize: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
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
            <div
              style={{
                color: "#475569",
                fontSize: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
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
      className="mx-auto mt-16 w-[94vw] max-w-4xl rounded-xl bg-white p-6 shadow-2xl outline-none"
      overlayClassName="fixed inset-0 flex items-start justify-center bg-black/50"
    >
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="text-xl font-semibold text-slate-950">Earned Breakdown</div>
          <div className="text-sm text-slate-700">
            {rangeLabel} • Total: {currency(totals.totalAmt)}
          </div>
        </div>

        <button onClick={() => onClose()} type="button" className="flex items-center gap-2 rounded-lg border px-3 py-2">
          <X size={16} />
          Close
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold text-slate-800">Range:</div>
        <select value={range} onChange={(e) => setRange(e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
          <option value="30d">Last 30 Days</option>
          <option value="year">This Year</option>
          <option value="all">All Time</option>
        </select>

        <div className="ml-2 text-xs text-slate-600">
          Escrow: {totals.escrowCount} • {currency(totals.escrowAmt)} &nbsp;|&nbsp;
          Direct Pay: {totals.directCount} • {currency(totals.directAmt)} &nbsp;|&nbsp;
          Expenses: {totals.expCount} • {currency(totals.expAmt)}
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-700">Loading earned items…</div>
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
                      <div
                        style={{
                          fontWeight: 900,
                          color: "#0f172a",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {g.title}
                      </div>
                      <div style={{ color: "#475569", fontSize: 12 }}>
                        {totalCount} item{totalCount === 1 ? "" : "s"} • Total {currency(g.totalAmt)}
                      </div>
                    </div>
                  </div>

                  <div style={{ fontWeight: 900, color: "#111827" }}>{currency(g.totalAmt)}</div>
                </button>

                {open ? (
                  <div style={{ marginTop: 10 }}>
                    {g.escrow?.length ? (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 900, color: "#0f172a" }}>
                          Escrow Releases • {g.escrow.length} • {currency(g.escrowAmt)}
                        </div>
                        <div style={{ borderTop: "1px solid #f1f5f9" }}>{g.escrow.map((inv) => renderInvoiceRow(inv))}</div>
                      </div>
                    ) : null}

                    {g.directPay?.length ? (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 900, color: "#0f172a" }}>
                          Direct Pay • {g.directPay.length} • {currency(g.directAmt)}
                        </div>
                        <div style={{ borderTop: "1px solid #f1f5f9" }}>
                          {g.directPay.map((inv) => renderInvoiceRow(inv))}
                        </div>
                      </div>
                    ) : null}

                    {g.expenses?.length ? (
                      <div style={{ marginBottom: 2 }}>
                        <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 900, color: "#0f172a" }}>
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
        <div className="text-sm text-slate-700">No earned items in this range.</div>
      )}
    </Modal>
  );
}

/* ---------------------------- main component ---------------------------- */
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
  const [showEarnedModal, setShowEarnedModal] = useState(false);
  const [earnedLoading, setEarnedLoading] = useState(false);
  const [earnedExpenses, setEarnedExpenses] = useState([]);
  const [earnedExpensesLoading, setEarnedExpensesLoading] = useState(false);

  const navigate = useNavigate();

  const role = who?.role || "";
  const isEmployee = role && String(role).startsWith("employee_");

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
    return () => {
      mounted = false;
    };
  }, []);

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
          const list = Array.isArray(aRes.value.data) ? aRes.value.data : aRes.value.data?.results || [];
          setAgreements(list);
        } else {
          console.error(aRes.reason);
          setAgreements([]);
        }

        if (lRes.status === "fulfilled") {
          const list = Array.isArray(lRes.value.data) ? lRes.value.data : lRes.value.data?.results || [];
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

    return () => {
      mounted = false;
    };
  }, [who, isEmployee]);

  useEffect(() => {
    let mounted = true;

    const loadPaidExpenses = async () => {
      if (!who || isEmployee) return;

      setEarnedExpensesLoading(true);
      try {
        const res = await api.get("/projects/expense-requests/", { params: { include_archived: 1 } });
        const list = Array.isArray(res.data) ? res.data : res.data?.results || [];
        const paidOnly = (list || []).filter((x) => norm(x?.status) === "paid" || !!x?.paid_at);

        if (!mounted) return;
        setEarnedExpenses(paidOnly);
      } catch (e) {
        console.error(e);
        try {
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

  useEffect(() => {
    let mounted = true;
    const loadActivityFeed = async () => {
      if (!who || isEmployee) return;
      try {
        const { data } = await api.get("/projects/activity-feed/", { params: { limit: 8 } });
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

  useEffect(() => {
    const fetchContractorProfile = async () => {
      if (isEmployee) return;
      try {
        const { data } = await api.get("/projects/contractors/me/");
        setContractorProfile(data || null);
      } catch (err) {
        console.error("Failed to load contractor profile", err);
      }
    };
    fetchContractorProfile();
  }, [isEmployee]);

  const invoicesById = useMemo(() => {
    const map = {};
    for (const inv of Array.isArray(invoices) ? invoices : []) {
      const id = inv?.id ?? inv?.invoice_id ?? inv?.pk ?? null;
      if (id != null && String(id).trim() !== "") map[String(id)] = inv;
    }
    return map;
  }, [invoices]);

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

  const earnedYtdAmount = useMemo(() => {
    const from = startOfYear(new Date());
    const to = new Date();

    const invList = Array.isArray(invoices) ? invoices : [];
    const expList = Array.isArray(earnedExpenses) ? earnedExpenses : [];

    const escrowInv = invList.filter(
      (inv) => inv?.escrow_released === true || inv?.escrow_released === 1 || inv?.escrow_released === "true"
    );

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

    const today = items.filter((item) => inRange(item.date, todayStart, todayEnd));
    const tomorrow = items.filter((item) => inRange(item.date, tomorrowStart, tomorrowEnd));
    const week = items.filter((item) => inRange(item.date, tomorrowStart, weekEnd));

    return {
      todayCount: today.length,
      todayAmount: sum(today),
      tomorrowCount: tomorrow.length,
      tomorrowAmount: sum(tomorrow),
      weekCount: week.length,
      weekAmount: sum(week),
    };
  }, [milestones, invoices, invoicesById]);

  const goNewAgreement = () => navigate("/app/agreements");
  const goStartWithAi = () => navigate("/app/assistant");
  const goNewIntake = () => navigate("/app/intake/new");
  const goNewMilestone = () => navigate("/app/milestones?new=1");
  const goInvoices = () => navigate("/app/invoices");
  const goInvoicesDisputed = () => navigate("/app/invoices?filter=disputed");
  const goCalendar = () => navigate("/app/calendar");
  const goDisputes = () => navigate("/app/disputes");
  const goReworkMilestones = () => navigate("/app/milestones?filter=rework");
  const goExpenses = () => navigate("/app/expenses");

  const openNewExpense = () => setShowExpenseModal(true);
  const onExpenseModalClose = () => setShowExpenseModal(false);

  const openEarnedModal = async () => {
    setShowEarnedModal(true);
    setEarnedLoading(earnedExpensesLoading);
  };
  const closeEarnedModal = () => setShowEarnedModal(false);

  const headerSubtitle = isEmployee
    ? "Here are the milestones currently assigned to you."
    : "Track milestones, invoices, leads, and next actions in one place.";

  const needsAttentionItems = useMemo(
    () =>
      (Array.isArray(dashboardNextSteps) ? dashboardNextSteps : [])
        .slice(0, 3)
        .map((item, index) => normalizeNeedsAttentionItem(item, index))
        .filter((item) => item.label),
    [dashboardNextSteps]
  );
  const showActivityFeed = !isEmployee && activityFeed.length > 0;

  const heroTitle =
    nextBestAction?.title ||
    (contractorProfile?.onboarding?.status !== "complete" ? "Finish onboarding" : "Create your next agreement");

  const heroMessage =
    nextBestAction?.message ||
    (contractorProfile?.onboarding?.status !== "complete"
      ? "Complete your setup so MyHomeBro can tailor templates, pricing, and payment guidance."
      : "Keep momentum by creating the next agreement or opening the AI assistant.");

  const heroButtonLabel =
    nextBestAction?.cta_label ||
    (contractorProfile?.onboarding?.status !== "complete" ? "Resume onboarding" : "Open agreements");

  const heroTarget =
    nextBestAction?.navigation_target ||
    (contractorProfile?.onboarding?.status !== "complete" ? "/app/onboarding" : "/app/agreements");

  return (
    <PageShell title="Dashboard" subtitle={headerSubtitle} showLogo>
      <div className="space-y-5">
        {!isEmployee ? (
          <>
            <DashboardSection
              title="Focus"
              subtitle="What needs your attention right now and the single highest-value next move."
            >
              <DashboardCard className="border-slate-200 bg-white/85 p-4 shadow-md">
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                  <div className="xl:col-span-2">
                    <DashboardCard
                      testId="dashboard-next-best-action"
                      className="h-full border-slate-200 bg-white p-6 shadow-md"
                    >
                      <div className="text-[12px] font-semibold uppercase tracking-[0.2em] text-slate-600">
                        Next Big Action
                      </div>

                      <div className="mt-3 text-[30px] font-bold leading-tight text-slate-950">
                        {heroTitle}
                      </div>

                      <div className="mt-3 text-[16px] leading-7 text-slate-800">{heroMessage}</div>

                      {nextBestAction?.rationale ? (
                        <div className="mt-3 text-sm leading-6 text-slate-700">
                          {nextBestAction.rationale}
                        </div>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => navigate(heroTarget)}
                        className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600"
                      >
                        {heroButtonLabel}
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </DashboardCard>
                  </div>

                  <div>
                    <DashboardCard
                      testId="dashboard-needs-attention"
                      tone="subtle"
                      className="h-full border-amber-300 bg-amber-100/90 p-4 shadow-md"
                    >
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-900">
                        Needs Attention
                      </div>

                      {needsAttentionItems.length ? (
                        <div className="mt-3 space-y-2.5">
                          {needsAttentionItems.map((item) => {
                            const handleClick = () => {
                              if (typeof item.action === "function") {
                                item.action();
                                return;
                              }
                              if (item.href) {
                                navigate(item.href);
                              }
                            };

                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={handleClick}
                                className="w-full rounded-xl border border-amber-300 bg-white px-4 py-3.5 text-left transition hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-[15px] font-medium leading-6 text-slate-950">
                                      {item.label}
                                    </div>
                                    <div className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-amber-900">
                                      {item.ctaText}
                                    </div>
                                  </div>

                                  <ArrowRight className="h-4 w-4 shrink-0 text-amber-900" />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mt-3 text-[15px] font-medium leading-6 text-slate-900">
                          No urgent items right now.
                        </div>
                      )}
                    </DashboardCard>
                  </div>
                </div>
              </DashboardCard>
            </DashboardSection>

            <DashboardSection
              title="Due Today, Tomorrow, This Week"
              subtitle="Time-based work that should stay visible without crowding the alert area."
            >
              <DashboardCard className="border-slate-200 bg-white/85 p-4 shadow-md">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3 items-stretch">
                  <DueStatCard
                    icon={Clock3}
                    title="Due Today"
                    subtitle="Immediate actions and scheduled work."
                    count={dueSchedule.todayCount}
                    amount={dueSchedule.todayAmount}
                    onClick={() => navigate("/app/calendar?range=today")}
                  />

                  <DueStatCard
                    icon={CalendarClock}
                    title="Due Tomorrow"
                    subtitle="What is coming up next."
                    count={dueSchedule.tomorrowCount}
                    amount={dueSchedule.tomorrowAmount}
                    onClick={() => navigate("/app/calendar?range=tomorrow")}
                  />

                  <DueStatCard
                    icon={CalendarDays}
                    title="This Week"
                    subtitle="Upcoming work and payment activity."
                    count={dueSchedule.weekCount}
                    amount={dueSchedule.weekAmount}
                    onClick={() => navigate("/app/calendar?range=week")}
                  />
                </div>
              </DashboardCard>
            </DashboardSection>

            <DashboardSection
              title="Milestones"
              subtitle="Current work status across your active agreements."
              className="!space-y-3"
            >
              <DashboardCard className="border-slate-200 bg-white/85 p-4 shadow-md">
                <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5 items-stretch">
                  <CompactStatCard
                    icon={Target}
                    title="All Milestones"
                    subtitle="Across your active agreements."
                    count={mStats.totalCount}
                    amount={mStats.totalAmount}
                    onClick={() => navigate("/app/milestones")}
                  />
                  <CompactStatCard
                    icon={ListTodo}
                    title="Incomplete"
                    subtitle="Not yet completed."
                    count={mStats.incompleteCount}
                    amount={mStats.incompleteAmount}
                    onClick={() => navigate("/app/milestones?filter=incomplete")}
                  />
                  <CompactStatCard
                    icon={CheckCircle2}
                    title="Ready to Invoice"
                    subtitle="Completed (not invoiced)."
                    count={mStats.readyCount}
                    amount={mStats.readyAmount}
                    onClick={() => navigate("/app/milestones?filter=complete_not_invoiced")}
                  />
                  <CompactStatCard
                    icon={BadgeDollarSign}
                    title="Paid"
                    subtitle="Escrow released / paid."
                    count={mStats.paidCount}
                    amount={mStats.paidAmount}
                    onClick={() => navigate("/app/milestones?filter=paid")}
                  />
                  <CompactStatCard
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
              subtitle="Approval, payout, dispute, and earned status."
              className="!space-y-3"
            >
              <DashboardCard className="border-slate-200 bg-white/85 p-4 shadow-md">
                <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 items-stretch">
                  <CompactStatCard
                    icon={BadgeDollarSign}
                    title="Pending Approval"
                    subtitle="Sent to homeowner — awaiting approval."
                    count={iStats.pendingCount}
                    amount={iStats.pendingAmount}
                    onClick={goInvoices}
                  />
                  <CompactStatCard
                    icon={BadgeCheck}
                    title="Approved"
                    subtitle="Approved — ready for payout."
                    count={iStats.approvedCount}
                    amount={iStats.approvedAmount}
                    onClick={goInvoices}
                  />
                  <CompactStatCard
                    icon={AlertTriangle}
                    title="Disputed"
                    subtitle="Frozen until resolved."
                    count={iStats.disputedCount}
                    amount={iStats.disputedAmount}
                    onClick={goInvoicesDisputed}
                  />
                  <CompactStatCard
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

            <DashboardSection
              title="Quick Actions"
              subtitle="Jump straight into the next contractor task."
              className="!space-y-3"
            >
              <DashboardCard className="border-slate-200 bg-white/90 p-4 shadow-md">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  <ActionButton
                    icon={Sparkles}
                    label="Start with AI"
                    primary
                    onClick={goStartWithAi}
                    hint="Use AI to plan the next job, agreement, or milestone."
                  />
                  <ActionButton
                    icon={FilePlus2}
                    label="New Agreement"
                    primary
                    onClick={goNewAgreement}
                    hint="Start a new agreement and move it toward signature."
                  />
                  <ActionButton
                    icon={ListPlus}
                    label="New Intake"
                    onClick={goNewIntake}
                    hint="Capture a new project lead before turning it into work."
                  />
                  <ActionButton
                    icon={ListPlus}
                    label="New Milestone"
                    onClick={goNewMilestone}
                    hint="Add a milestone so work, approval, and payment can move forward."
                  />
                  <ActionButton
                    icon={Receipt}
                    label="New Expense"
                    onClick={openNewExpense}
                    hint="Log an expense and send it to the customer when needed."
                  />
                  <ActionButton
                    icon={Receipt}
                    label="Expenses"
                    onClick={goExpenses}
                    hint="Review expense requests, receipts, and customer-facing charges."
                  />
                  <ActionButton
                    icon={Receipt}
                    label="Invoices"
                    onClick={goInvoices}
                    hint="Review invoices, approvals, payouts, and payment status."
                  />
                  <ActionButton
                    icon={AlertTriangle}
                    label="Disputes"
                    onClick={goDisputes}
                    hint="Open disputes that need a response or resolution."
                  />
                  <ActionButton
                    icon={CalendarDays}
                    label="Calendar"
                    onClick={goCalendar}
                    hint="See scheduled work and upcoming project dates."
                  />
                </div>
              </DashboardCard>
            </DashboardSection>

            {showActivityFeed ? (
              <DashboardSection
                title="Recent Activity"
                subtitle="Recent project signals and workflow updates."
              >
                <DashboardCard className="border-slate-200 bg-white/85 p-4 shadow-md">
                  <div className="space-y-3" data-testid="dashboard-activity-feed">
                    {activityFeed.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigate(item.navigation_target || "/app/dashboard")}
                        className={`w-full rounded-2xl border px-4 py-4 text-left shadow-sm ${activityAccent(item.severity)}`}
                        data-testid={`dashboard-activity-item-${item.id}`}
                      >
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="text-[16px] font-semibold leading-6">{item.title}</div>
                            <div className="mt-2 text-[15px] leading-6 text-current/95">{item.summary}</div>
                            {item.related_label ? (
                              <div className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] opacity-75">
                                {item.related_label}
                              </div>
                            ) : null}
                          </div>
                          <div className="text-xs font-semibold opacity-75">
                            {formatActivityTimestamp(item.created_at)}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </DashboardCard>
              </DashboardSection>
            ) : null}
          </>
        ) : (
          <DashboardSection
            title="Milestones"
            subtitle="Only milestones assigned to you."
          >
            <DashboardCard className="border-slate-200 bg-white/85 p-4 shadow-md">
              <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 items-stretch">
                <CompactStatCard
                  icon={Target}
                  title="My Assigned Milestones"
                  subtitle="Only milestones assigned to you."
                  count={mStats.totalCount}
                  amount={mStats.totalAmount}
                  onClick={() => navigate("/app/milestones")}
                />
                <CompactStatCard
                  icon={ListTodo}
                  title="Incomplete"
                  subtitle="Not yet completed."
                  count={mStats.incompleteCount}
                  amount={mStats.incompleteAmount}
                  onClick={() => navigate("/app/milestones?filter=incomplete")}
                />
                <CompactStatCard
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
        )}

        {!isEmployee ? (
          <ExpenseRequestModal isOpen={showExpenseModal} onClose={onExpenseModalClose} />
        ) : null}

        {!isEmployee ? (
          <EarnedBreakdownModal
            isOpen={showEarnedModal}
            onClose={closeEarnedModal}
            invoices={invoices}
            expenses={earnedExpenses}
            loading={earnedLoading}
          />
        ) : null}
      </div>
    </PageShell>
  );
}
