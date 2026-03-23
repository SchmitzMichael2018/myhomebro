// src/components/ContractorDashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { toast } from "react-hot-toast";
import PageShell from "./PageShell.jsx";
import StatCard from "./StatCard.jsx";
import Modal from "react-modal";
import useNotifications from "../hooks/useNotifications";
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
} from "lucide-react";

console.log(
  "ContractorDashboard.jsx v2026-03-10 — added + New Intake quick action"
);

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
function inRange(dateObj, from, to) {
  if (!dateObj) return false;
  const t = dateObj.getTime();
  if (from && t < from.getTime()) return false;
  if (to && t > to.getTime()) return false;
  return true;
}
const currency = (n) =>
  Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

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

/* ---------- quick action button ---------- */
function ActionButton({ icon: Icon, label, onClick, primary }) {
  return (
    <button
      className={`mhb-btn${primary ? " primary" : ""}`}
      onClick={onClick}
      type="button"
      title={label}
      style={{
        padding: "12px 16px",
        fontSize: 14,
        display: "flex",
        alignItems: "center",
      }}
    >
      {Icon ? <Icon size={18} /> : null}
      <span style={{ marginLeft: 8, fontWeight: 900 }}>{label}</span>
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

  const [milestones, setMilestones] = useState([]);
  const [invoices, setInvoices] = useState([]);

  const [showExpenseModal, setShowExpenseModal] = useState(false);

  // Earned modal + paid expenses cache
  const [showEarnedModal, setShowEarnedModal] = useState(false);
  const [earnedLoading, setEarnedLoading] = useState(false);
  const [earnedExpenses, setEarnedExpenses] = useState([]);
  const [earnedExpensesLoading, setEarnedExpensesLoading] = useState(false);

  const navigate = useNavigate();
  const { notifications, loading: notificationsLoading } = useNotifications();

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

        const [mRes, iRes] = await Promise.allSettled([
          api.get("/projects/milestones/"),
          api.get("/projects/invoices/"),
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

  /* ----- navigation handlers ----- */
  const goNewAgreement = () => navigate(`/app/agreements`);
  const goNewIntake = () => navigate(`/app/intake/new`);
  const goNewMilestone = () => navigate(`/app/milestones?new=1`);
  const goInvoices = () => navigate(`/app/invoices`);
  const goInvoicesDisputed = () => navigate(`/app/invoices?filter=disputed`);
  const goCalendar = () => navigate(`/app/calendar`);
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

  const headerSubtitle = isEmployee ? "Here are the milestones assigned to you." : "Milestones and invoices at a glance.";

  return (
    <PageShell title="Dashboard" subtitle={headerSubtitle} showLogo>
      {!isEmployee ? (
        <>
          <div className="mhb-kicker">MyHomeBro Pricing</div>
          <div className="mhb-grid" style={{ marginBottom: 6 }}>
            <StatCard icon={BadgeDollarSign} title={currentRateTitle} subtitle={pricingSubtitle} count={null} amount={null} onClick={null} />
          </div>
        </>
      ) : null}

      <div className="mhb-kicker">Milestones</div>
      <div className="mhb-grid" style={{ marginBottom: 6 }}>
        <StatCard
          icon={Target}
          title={isEmployee ? "My Assigned Milestones" : "All Milestones"}
          subtitle={isEmployee ? "Only milestones assigned to you." : "Across your active agreements."}
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

        {!isEmployee ? (
          <>
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
          </>
        ) : (
          <StatCard
            icon={CheckCircle2}
            title="Completed"
            subtitle="Completed by you."
            count={0}
            amount={0}
            onClick={() => navigate(`/app/milestones`)}
          />
        )}

        <StatCard
          icon={Wrench}
          title="Rework Work Orders"
          subtitle="Milestones created from disputes."
          count={mStats.reworkCount}
          amount={mStats.reworkAmount}
          onClick={goReworkMilestones}
        />
      </div>

      {!isEmployee ? (
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

      <div className="mhb-kicker" style={{ marginTop: 18 }}>
        Quick Actions
      </div>
      <div className="mhb-glass" style={{ padding: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {!isEmployee ? (
            <>
              <ActionButton icon={FilePlus2} label="+ New Agreement" primary onClick={goNewAgreement} />
              <ActionButton icon={ListPlus} label="+ New Intake" onClick={goNewIntake} />
              <ActionButton icon={ListPlus} label="+ New Milestone" onClick={goNewMilestone} />
              <ActionButton icon={Receipt} label="+ New Expense" onClick={openNewExpense} />
              <ActionButton icon={Receipt} label="Expenses" onClick={goExpenses} />
              <ActionButton icon={Receipt} label="Invoices" onClick={goInvoices} />
              <ActionButton icon={AlertTriangle} label="Disputes" onClick={goDisputes} />
            </>
          ) : null}

          <ActionButton icon={CalendarDays} label="Calendar" onClick={goCalendar} />
        </div>
      </div>

      {!isEmployee ? <ExpenseRequestModal isOpen={showExpenseModal} onClose={onExpenseModalClose} /> : null}

      {!isEmployee ? (
        <div className="mhb-kicker" style={{ marginTop: 18 }}>
          Recent Subcontractor Activity
        </div>
      ) : null}

      {!isEmployee ? (
        <div
          className="mhb-glass"
          data-testid="contractor-notifications-panel"
          style={{ padding: 12 }}
        >
          {notificationsLoading ? (
            <div className="text-sm text-gray-500">Loading activity...</div>
          ) : notifications.length === 0 ? (
            <div
              data-testid="contractor-notifications-empty"
              className="text-sm text-gray-500"
            >
              No subcontractor activity notifications yet.
            </div>
          ) : (
            <div className="space-y-3">
              {notifications.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`contractor-notification-${item.id}`}
                  onClick={() =>
                    item.agreement_id
                      ? navigate(`/app/agreements/${item.agreement_id}`)
                      : undefined
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50"
                >
                  <div className="text-sm font-semibold text-slate-900">
                    {item.title}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {item.message}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {item.project_title || `Agreement #${item.agreement_id || "-"}`}
                    {item.milestone_id ? ` • Milestone #${item.milestone_id}` : ""}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {item.created_at ? new Date(item.created_at).toLocaleString() : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
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
    </PageShell>
  );
}
