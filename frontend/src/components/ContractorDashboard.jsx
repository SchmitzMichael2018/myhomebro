// src/components/ContractorDashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { toast } from "react-hot-toast";
import PageShell from "./PageShell.jsx";
import StatCard from "./StatCard.jsx";
import Modal from "react-modal";
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
} from "lucide-react";

console.log("ContractorDashboard.jsx v2025-09-17-invoices-path");

// Ensure react-modal knows the root
Modal.setAppElement("#root");

/* ---------- small helpers ---------- */
const money = (n) => Number(n || 0);
const sum = (arr, key = "amount") => arr.reduce((a, x) => a + money(x[key]), 0);

const norm = (s) => (s || "").toString().toLowerCase();
const isIncomplete = (m) =>
  norm(m.status || (m.completed ? "completed" : "incomplete")) === "incomplete";
const isCompleted = (m) =>
  ["completed", "complete"].includes(
    norm(m.status || (m.completed ? "completed" : ""))
  );

const invBucket = (inv) => {
  const s = norm(inv.status);
  if (
    ["pending", "pending_approval", "sent", "awaiting_approval"].includes(s)
  )
    return "pending";
  if (["approved", "ready_to_pay"].includes(s)) return "approved";
  if (["paid", "earned", "released"].includes(s)) return "earned";
  return "pending";
};

/* ---------- quick action button ---------- */
function ActionButton({ icon: Icon, label, onClick, primary }) {
  return (
    <button
      className={`mhb-btn${primary ? " primary" : ""}`}
      onClick={onClick}
      type="button"
      title={label}
      style={{ padding: "12px 16px", fontSize: 14, display: "flex", alignItems: "center" }}
    >
      {Icon ? <Icon size={18} /> : null}
      <span style={{ marginLeft: 8, fontWeight: 900 }}>{label}</span>
    </button>
  );
}

/* ========================================================================== */
/* ================  INLINE: ExpenseRequestsPanel (no import)  ============== */
/* ========================================================================== */
function ExpenseRequestsPanel() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

  const load = async () => {
    try {
      setLoading(true);
      const { data } = await api.get("/projects/expenses/");
      const list = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
      setRows(list);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load expenses.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const statusBadge = (s) => {
    const base = "px-2 py-0.5 rounded text-xs font-semibold";
    switch (String(s || "").toLowerCase()) {
      case "draft":
        return <span className={`${base} bg-gray-200 text-gray-800`}>Draft</span>;
      case "contractor_signed":
        return <span className={`${base} bg-indigo-100 text-indigo-800`}>Signed</span>;
      case "pending":
        return <span className={`${base} bg-amber-100 text-amber-800`}>Sent</span>;
      case "approved":
        return <span className={`${base} bg-green-100 text-green-800`}>Accepted</span>;
      case "rejected":
        return <span className={`${base} bg-red-100 text-red-800`}>Rejected</span>;
      case "paid":
        return <span className={`${base} bg-emerald-200 text-emerald-900`}>Paid</span>;
      case "disputed":
        return <span className={`${base} bg-red-100 text-red-800`}>Disputed</span>;
      default:
        return <span className={`${base} bg-gray-100 text-gray-800`}>{s}</span>;
    }
  };

  const moneyFmt = (n) => {
    const v = Number(n);
    return Number.isFinite(v) ? `$${v.toFixed(2)}` : n ?? "—";
  };

  return (
    <div className="rounded-xl border bg-white shadow-sm">
      <div className="px-5 py-4 border-b bg-gradient-to-r from-blue-50 to-white rounded-t-xl">
        <h3 className="text-lg font-semibold">Expense Requests</h3>
        <p className="text-sm text-gray-600 mt-1">Track expenses you’ve sent to homeowners.</p>
      </div>

      <div className="p-5">
        {loading ? (
          <div className="text-gray-600">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-gray-500 text-sm">No expenses yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border rounded">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left border">Created</th>
                  <th className="p-2 text-left border">Agreement</th>
                  <th className="p-2 text-left border">Description</th>
                  <th className="p-2 text-right border">Amount</th>
                  <th className="p-2 text-left border">Status</th>
                  <th className="p-2 text-center border">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                    <td className="p-2 border">
                      {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="p-2 border">{r.agreement || "—"}</td>
                    <td className="p-2 border">{r.description}</td>
                    <td className="p-2 border text-right">{moneyFmt(r.amount)}</td>
                    <td className="p-2 border">{statusBadge(r.status)}</td>
                    <td className="p-2 border text-center">
                      {r.receipt_url ? (
                        <a className="text-blue-700 underline" href={r.receipt_url} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
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
      // 1) Create expense (multipart for optional receipt)
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

      // 2) Contractor signs
      await api.post(`/projects/expenses/${created.id}/contractor_sign/`);

      // 3) Send to homeowner
      await api.post(`/projects/expenses/${created.id}/send_to_homeowner/`);

      toast.success("Expense sent to homeowner.");
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
        <button onClick={() => onClose(false)} className="px-3 py-1.5 rounded-lg border">
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
              placeholder="e.g., Dump fee, rental, small materials"
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
            <input type="file" accept="image/*,.pdf" onChange={onFile} className="w-full" />
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-1">Notes to Homeowner (optional)</label>
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
            className={`px-4 py-2 rounded-lg text-white font-semibold ${sub ? "bg-gray-500" : "bg-blue-600 hover:bg-blue-700"}`}
          >
            {sub ? "Sending…" : "Sign & Send to Homeowner"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ========================================================================== */
/* =============================== MAIN VIEW ================================= */
/* ========================================================================== */
export default function ContractorDashboard() {
  const [milestones, setMilestones] = useState([]);
  const [invoices, setInvoices] = useState([]);

  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expensesRefreshKey, setExpensesRefreshKey] = useState(0);

  const navigate = useNavigate();

  /* ----- load data ----- */
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // ✅ Corrected invoices path: /projects/invoices/
        const [mRes, iRes] = await Promise.allSettled([
          api.get("/projects/milestones/"),
          api.get("/projects/invoices/"),
        ]);

        if (!mounted) return;

        if (mRes.status === "fulfilled") {
          const list = Array.isArray(mRes.value.data)
            ? mRes.value.data
            : mRes.value.data?.results || [];
          setMilestones(list);
        } else {
          console.error(mRes.reason);
          toast.error("Failed to load milestones.");
        }

        if (iRes.status === "fulfilled") {
          const list = Array.isArray(iRes.value.data)
            ? iRes.value.data
            : iRes.value.data?.results || [];
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
  }, []);

  /* ----- milestone stats ----- */
  const mStats = useMemo(() => {
    const all = milestones;
    const allAmt = sum(all);
    const incomp = all.filter(isIncomplete);
    const incompAmt = sum(incomp);
    const comp = all.filter(isCompleted);
    const compAmt = sum(comp);

    return {
      totalCount: all.length,
      totalAmount: allAmt,
      incompleteCount: incomp.length,
      incompleteAmount: incompAmt,
      completedCount: comp.length,
      completedAmount: compAmt,
    };
  }, [milestones]);

  /* ----- invoice stats ----- */
  const iStats = useMemo(() => {
    const buckets = { pending: [], approved: [], earned: [] };
    for (const inv of invoices) {
      buckets[invBucket(inv)].push(inv);
    }
    return {
      pendingCount: buckets.pending.length,
      pendingAmount: sum(buckets.pending),
      approvedCount: buckets.approved.length,
      approvedAmount: sum(buckets.approved),
      earnedCount: buckets.earned.length,
      earnedAmount: sum(buckets.earned),
    };
  }, [invoices]);

  /* ----- quick action handlers ----- */
  const goNewAgreement = () => navigate("/agreements");
  const goNewMilestone = () => navigate("/milestones?new=1");
  const goInvoices = () => navigate("/invoices");
  const goCalendar = () => navigate("/calendar");

  const openNewExpense = () => setShowExpenseModal(true);
  const onExpenseModalClose = (didChange) => {
    setShowExpenseModal(false);
    if (didChange) setExpensesRefreshKey((k) => k + 1);
  };

  return (
    <PageShell title="Dashboard" subtitle="Milestones and invoices at a glance." showLogo>
      {/* Row 1 — Milestones */}
      <div className="mhb-kicker">Milestones</div>
      <div className="mhb-grid" style={{ marginBottom: 6 }}>
        <StatCard
          icon={Target}
          title="All Milestones"
          subtitle="Across your active agreements."
          count={mStats.totalCount}
          amount={mStats.totalAmount}
          onClick={() => navigate("/milestones")}
        />
        <StatCard
          icon={ListTodo}
          title="Incomplete"
          subtitle="Not yet completed."
          count={mStats.incompleteCount}
          amount={mStats.incompleteAmount}
          onClick={() => navigate("/milestones?filter=incomplete")}
        />
        <StatCard
          icon={CheckCircle2}
          title="Completed (Not Invoiced)"
          subtitle="May be awaiting invoicing."
          count={mStats.completedCount}
          amount={mStats.completedAmount}
          onClick={() => navigate("/milestones?filter=completed")}
        />
      </div>

      {/* Row 2 — Invoices */}
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
          onClick={() => navigate("/invoices")}
        />
        <StatCard
          icon={BadgeCheck}
          title="Approved"
          subtitle="Approved — ready for payout."
          count={iStats.approvedCount}
          amount={iStats.approvedAmount}
          onClick={() => navigate("/invoices")}
        />
        <StatCard
          icon={WalletMinimal}
          title="Earned"
          subtitle="Paid/released to your account."
          count={iStats.earnedCount}
          amount={iStats.earnedAmount}
          onClick={() => navigate("/invoices")}
        />
      </div>

      {/* Quick Actions */}
      <div className="mhb-kicker" style={{ marginTop: 18 }}>
        Quick Actions
      </div>
      <div className="mhb-glass" style={{ padding: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <ActionButton icon={FilePlus2} label="+ New Agreement" primary onClick={goNewAgreement} />
          <ActionButton icon={ListPlus} label="+ New Milestone" onClick={goNewMilestone} />
          {/* NEW: stand-alone New Expense button */}
          <ActionButton icon={Receipt} label="+ New Expense" onClick={openNewExpense} />
          <ActionButton icon={CalendarDays} label="Calendar" onClick={goCalendar} />
          <ActionButton icon={Receipt} label="Invoices" onClick={goInvoices} />
        </div>
      </div>

      {/* NEW: Expense Requests table (re-mounts when refresh key changes) */}
      <div className="mhb-kicker" style={{ marginTop: 18 }}>
        Expense Requests
      </div>
      <div key={expensesRefreshKey}>
        <ExpenseRequestsPanel />
      </div>

      {/* Modal: create/sign/send expense */}
      <ExpenseRequestModal isOpen={showExpenseModal} onClose={onExpenseModalClose} />
    </PageShell>
  );
}
