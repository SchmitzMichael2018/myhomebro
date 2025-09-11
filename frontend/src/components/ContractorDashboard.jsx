// src/components/ContractorDashboard.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, RefreshCw, CheckCircle2, CircleDot, FileCheck2, HandCoins, CircleCheckBig, Layers3 } from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";
import EarningsChart from "./EarningsChart";
import InvoiceModal from "./InvoiceModal";
import MilestoneModal from "./MilestoneModal";

const toList = (res) => (res?.data?.results ? res.data.results : Array.isArray(res?.data) ? res.data : []);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const amtOfMilestone = (m) => num(m.__amount ?? m.amount ?? m.total ?? m.price ?? m.total_amount ?? m.milestone_amount);
const amtOfInvoice  = (i) => num(i.__amount ?? i.amount ?? i.total ?? i.total_amount ?? i.balance ?? i.invoice_amount);
const fmtUSD = (v) => (Number(v || 0) || 0).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const normalizeMilestone = (m) => {
  const raw = (m.status || "").toLowerCase();
  const completed = m.completed || m.is_completed || raw === "completed" || raw === "complete";
  const invoiced  = m.invoiced || m.is_invoiced || raw === "invoiced";

  return {
    ...m,
    __completed: !!completed,
    __invoiced:  !!invoiced,
    __amount:    amtOfMilestone(m),
  };
};

const normalizeInvoice = (inv) => {
  const raw = (inv.status || "").toLowerCase();
  const paid     = inv.paid || inv.is_paid || raw === "paid" || raw === "approved/paid" || raw === "complete/paid";
  const approved = inv.approved || inv.is_approved || raw === "approved";
  const pending  = raw === "pending_approval" || raw === "pending approval" || inv.pending_approval;
  const disputed = inv.disputed || inv.is_disputed || raw === "disputed";
  return { ...inv, __amount: amtOfInvoice(inv), __paid: !!paid, __approved: !!approved, __pending: !!pending, __disputed: !!disputed };
};

function TopBar({ onRefresh }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="text-2xl md:text-3xl font-extrabold text-blue-900 tracking-tight">Contractor Dashboard</div>
      <div className="flex items-center gap-3">
        <button type="button" className="rounded-full p-2 text-blue-700 hover:bg-blue-50" title="Notifications" aria-label="Notifications">
          <Bell size={20} />
        </button>
        <button type="button" className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 font-semibold flex items-center gap-2" onClick={onRefresh} title="Refresh">
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>
    </div>
  );
}

function StatCard({ title, icon: Icon, value, count, onClick }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-700">{title}</div>
          <div className="mt-1 text-xs">
            <button type="button" className={`font-semibold text-blue-700 hover:underline ${onClick ? "" : "cursor-default opacity-60"}`} onClick={onClick || undefined}>
              ({count})
            </button>
          </div>
          <div className="mt-1 text-gray-900 font-bold">{fmtUSD(value)}</div>
        </div>
        <div className="rounded-full bg-blue-50 text-blue-700 p-3">
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

export default function ContractorDashboard() {
  const [milestones, setMilestones] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, type: "", title: "", items: [] });
  const [q, setQ] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [msRes, invRes] = await Promise.all([api.get("/milestones/"), api.get("/invoices/")]);
      setMilestones(toList(msRes).map(normalizeMilestone));
      setInvoices(toList(invRes).map(normalizeInvoice));
    } catch (e) {
      console.error(e);
      toast.error("Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const derived = useMemo(() => {
    const msAll        = milestones;
    const msIncomplete = milestones.filter((m) => !m.__completed);
    const msComplete   = milestones.filter((m) =>  m.__completed);

    const invPending = invoices.filter((i) => i.__pending && !i.__paid);
    const invApproved= invoices.filter((i) => i.__approved && !i.__paid);
    const invPaid    = invoices.filter((i) => i.__paid);

    const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

    return {
      totals: {
        total:      sum(msAll, amtOfMilestone),
        incomplete: sum(msIncomplete, amtOfMilestone),
        complete:   sum(msComplete,   amtOfMilestone),
        pending:    sum(invPending,   amtOfInvoice),
        approved:   sum(invApproved,  amtOfInvoice),
        earned:     sum(invPaid,      amtOfInvoice),
      },
      counts: {
        total:      msAll.length,
        incomplete: msIncomplete.length,
        complete:   msComplete.length,
        pending:    invPending.length,
        approved:   invApproved.length,
        earned:     invPaid.length,
      },
      groups: {
        total:      msAll,
        incomplete: msIncomplete,
        complete:   msComplete,
        pending:    invPending,
        approved:   invApproved,
        earned:     invPaid,
      }
    };
  }, [milestones, invoices]);

  const openDrill = (key, label, type) => setModal({ open: true, type, title: label, items: derived.groups[key] || [] });
  const closeDrill = () => setModal({ open: false, type: "", title: "", items: [] });

  const filteredInvoices = useMemo(() => {
    const s = (q || "").trim().toLowerCase();
    if (!s) return invoices;
    const t = (v) => (v ? String(v).toLowerCase() : "");
    return invoices.filter((inv) => {
      const candidates = [
        inv.title, inv.invoice_title, inv.customer_name, inv.homeowner_name, inv.client_name,
        inv?.agreement?.title, inv?.agreement?.name, inv?.customer?.name, String(inv.invoice_number || inv.id || "")
      ];
      return candidates.some((c) => t(c).includes(s));
    });
  }, [q, invoices]);

  if (loading) return <div className="p-6 text-gray-500">Loading dashboard…</div>;

  return (
    <div className="p-4 md:p-6">
      <TopBar onRefresh={fetchData} />

      {/* top row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
        <StatCard title="Total"            icon={Layers3}       value={derived.totals.total}      count={derived.counts.total}      onClick={() => openDrill("total", "All Milestones", "milestone")} />
        <StatCard title="Incomplete"       icon={CircleDot}     value={derived.totals.incomplete} count={derived.counts.incomplete} onClick={() => openDrill("incomplete", "Incomplete Milestones", "milestone")} />
        <StatCard title="Complete"         icon={CheckCircle2}  value={derived.totals.complete}   count={derived.counts.complete}   onClick={() => openDrill("complete", "Completed Milestones", "milestone")} />
        <StatCard title="Pending Approval" icon={FileCheck2}    value={derived.totals.pending}    count={derived.counts.pending}    onClick={() => openDrill("pending", "Invoices Pending Approval", "invoice")} />
        <StatCard title="Approved"         icon={CircleCheckBig}value={derived.totals.approved}   count={derived.counts.approved}   onClick={() => openDrill("approved", "Approved Invoices", "invoice")} />
        <StatCard title="Earned"           icon={HandCoins}     value={derived.totals.earned}     count={derived.counts.earned}     onClick={() => openDrill("earned", "Paid / Earned Invoices", "invoice")} />
      </div>

      {/* earnings overview */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-6">
        <div className="text-blue-900 font-bold mb-3">Earnings Overview</div>
        <EarningsChart invoices={invoices} />
        <div className="mt-3 text-green-700 font-semibold">Total Earned: {fmtUSD(derived.totals.earned)}</div>
      </div>

      {/* invoice search + table */}
      <div className="mb-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoices or projects..." className="w-full max-w-md rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-gray-600 border-b">
              <th className="py-2 px-4">Invoice</th>
              <th className="py-2 px-4">Customer</th>
              <th className="py-2 px-4">Due</th>
              <th className="py-2 px-4">Status</th>
              <th className="py-2 px-4">Amount</th>
            </tr>
          </thead>
          <tbody>
            {filteredInvoices.length === 0 ? (
              <tr><td className="py-6 px-4 text-gray-500" colSpan={5}>No invoices found.</td></tr>
            ) : filteredInvoices.map((inv) => {
              const title = inv.title || inv.invoice_title || `Invoice #${inv.id}`;
              const customer = inv.customer_name || inv.homeowner_name || inv.client_name || inv?.agreement?.customer_name || inv?.customer?.name || "—";
              const due = inv.due || inv.due_date || inv.invoice_due || null;
              const status = inv.__paid ? "Paid" : inv.__approved ? "Approved" : inv.__pending ? "Pending Approval" : inv.__disputed ? "Disputed" : (inv.status || "Submitted");
              return (
                <tr key={`inv-${inv.id}`} className="border-b last:border-b-0">
                  <td className="py-2 px-4">{title}</td>
                  <td className="py-2 px-4">{customer}</td>
                  <td className="py-2 px-4">{due ? new Date(due).toLocaleDateString() : "—"}</td>
                  <td className="py-2 px-4">{status}</td>
                  <td className="py-2 px-4">{fmtUSD(amtOfInvoice(inv))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* drill-downs */}
      {modal.open && modal.type === "milestone" && (
        <MilestoneModal title={modal.title} items={modal.items} onClose={closeDrill} />
      )}
      {modal.open && modal.type === "invoice" && (
        <InvoiceModal title={modal.title} items={modal.items} onClose={closeDrill} />
      )}
    </div>
  );
}
