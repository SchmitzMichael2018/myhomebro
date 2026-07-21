import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Search,
} from "lucide-react";

const money = (value) => Number(value || 0).toLocaleString(undefined, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const statusKey = (row) => String(row?.payout_status || row?.status || "pending").toLowerCase();
const statusLabel = (row) => row?.status_label || statusKey(row).replaceAll("_", " ");
const hasValue = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

function statusTone(status) {
  if (status === "paid" || status === "completed" || status === "released") return "bg-emerald-50 text-emerald-700";
  if (status.includes("ready")) return "bg-blue-50 text-blue-700";
  if (status.includes("fail") || status.includes("block")) return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-700";
}

function compactStatus(status) {
  if (status.includes("ready")) return "Ready";
  if (status.includes("fail")) return "Failed";
  if (status.includes("block")) return "Blocked";
  if (status.includes("pending")) return "Pending";
  return status === "released" || status === "completed" ? "Paid" : status;
}

function Metric({ label, amount, count, description, icon: Icon, tone }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-3">
    <div className="flex items-center gap-2 text-sm font-bold text-slate-800"><span className={`flex h-8 w-8 items-center justify-center rounded-full ${tone}`}><Icon aria-hidden="true" className="h-4 w-4" /></span>{label}</div>
    <div className="mt-2 text-2xl font-black tabular-nums text-slate-950">{money(amount)}</div>
    {count != null ? <div className="mt-1 text-xs font-semibold text-slate-600">{count} payment{count === 1 ? "" : "s"}</div> : null}
    <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500">{description}</div>
  </div>;
}

export default function PayoutsWorkspace({
  rows = [],
  summary = {},
  exporting = false,
  onExport,
  onOpenReports,
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const normalizedRows = useMemo(() => rows.map((row) => ({
    ...row,
    recipient: row.subcontractor_display_name || row.recipient_name || row.destination_name || "Destination unavailable",
    paymentType: row.payment_type || row.record_type_label || (row.subcontractor_display_name ? "Subcontractor" : "Payout"),
    source: row.project_title || row.agreement_title || row.agreement_label || row.source_label || "Source unavailable",
    gross: row.gross_amount ?? row.gross_released_amount,
    fee: row.platform_fee,
    net: row.net_payout ?? row.payout_amount ?? row.amount,
    date: row.payout_date || row.paid_at || row.released_at,
    statusKey: statusKey(row),
    statusLabel: statusLabel(row),
  })), [rows]);
  const counts = useMemo(() => normalizedRows.reduce((result, row) => {
    if (["paid", "completed", "released"].includes(row.statusKey)) result.paid += 1;
    else if (row.statusKey.includes("ready")) result.ready += 1;
    else if (row.statusKey.includes("fail") || row.statusKey.includes("block")) result.failed += 1;
    else result.pending += 1;
    return result;
  }, { paid: 0, ready: 0, pending: 0, failed: 0 }), [normalizedRows]);
  const visibleRows = useMemo(() => normalizedRows.filter((row) => {
    const matchesFilter = filter === "all" || (filter === "failed" ? row.statusKey.includes("fail") || row.statusKey.includes("block") : row.statusKey.includes(filter));
    const haystack = `${row.recipient} ${row.paymentType} ${row.source}`.toLowerCase();
    return matchesFilter && haystack.includes(query.trim().toLowerCase());
  }), [filter, normalizedRows, query]);
  const attentionRows = normalizedRows.filter((row) => !["paid", "completed", "released"].includes(row.statusKey)).slice(0, 4);
  const platformFees = summary.total_platform_fees_retained;
  const supportsRichAmounts = normalizedRows.some((row) => row.gross != null || row.fee != null);
  // `total_paid_out` is already net of retained platform fees in the payout-history API.
  // Fees are displayed separately and are never added back into Paid Out or another total.
  const metrics = [
    { key: "paid", supported: hasValue(summary, "total_paid_out") || hasValue(summary, "total_paid_amount"), label: "Net Paid Out", amount: summary.total_paid_out ?? summary.total_paid_amount, count: hasValue(summary, "total_paid_out") ? (summary.payout_count ?? counts.paid) : counts.paid, description: "Recipient payments after fees", icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
    { key: "ready", supported: hasValue(summary, "total_ready_amount"), label: "Ready to Pay", amount: summary.total_ready_amount, count: counts.ready, description: "Ready for release", icon: Clock3, tone: "bg-blue-50 text-blue-700" },
    { key: "pending", supported: hasValue(summary, "total_pending_amount"), label: "Pending Approval", amount: summary.total_pending_amount, count: counts.pending === 0 && Number(summary.total_pending_amount || 0) > 0 ? null : counts.pending, description: counts.pending === 0 && Number(summary.total_pending_amount || 0) > 0 ? "Period-level pending amount" : "Waiting for approval", icon: Clock3, tone: "bg-amber-50 text-amber-700" },
    { key: "failed", supported: hasValue(summary, "total_failed_amount"), label: "Failed / Blocked", amount: summary.total_failed_amount, count: counts.failed, description: "Action required", icon: AlertTriangle, tone: "bg-red-50 text-red-700" },
  ].filter((metric) => metric.supported);

  const historyHref = (row) => row.payout_id ? `/app/payouts/history/${row.payout_id}` : "/app/payouts/history";

  return <div data-testid="dashboard-view-payouts" className="space-y-3">
    <section data-testid="dashboard-payouts-summary" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-lg font-bold text-slate-950">Outgoing Money Summary</h2><p className="mt-1 text-sm text-slate-500">Outgoing payment status for the selected date range.</p></div><a data-testid="dashboard-payouts-full-history" href="/app/payouts/history" className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">View Payout History <ExternalLink aria-hidden="true" className="h-4 w-4" /></a></div>
      <div className={`mt-3 grid gap-3 sm:grid-cols-2 ${metrics.length >= 4 ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>{metrics.map((metric) => <Metric key={metric.key} {...metric} />)}</div>
    </section>

    <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-3">
        <section data-testid="dashboard-payouts-ledger" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><h2 className="text-lg font-bold text-slate-950">Payment Ledger</h2><p className="mt-1 text-sm text-slate-500">Outgoing payment activity and recorded fees.</p></div><div className="flex flex-col gap-2 sm:flex-row"><label className="relative"><Search aria-hidden="true" className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><span className="sr-only">Search payments</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search payments" className="h-9 rounded-lg border border-slate-300 pl-9 pr-3 text-sm" /></label><select aria-label="Filter payment status" value={filter} onChange={(event) => setFilter(event.target.value)} className="h-9 rounded-lg border border-slate-300 px-3 text-sm"><option value="all">All statuses</option><option value="paid">Paid</option><option value="ready">Ready</option><option value="pending">Pending</option><option value="failed">Failed / Blocked</option></select></div></div>
          {visibleRows.length ? <><div className="mt-3 hidden overflow-x-auto md:block"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-y border-slate-200 bg-slate-50 text-xs text-slate-500"><tr><th className="px-2.5 py-2">Recipient / Destination</th><th className="px-2.5 py-2">Payment Type</th><th className="px-2.5 py-2">Project / Source</th>{supportsRichAmounts ? <><th className="px-2.5 py-2">Gross</th><th className="px-2.5 py-2">Fees</th></> : null}<th className="px-2.5 py-2">Net Amount</th><th className="px-2.5 py-2">Status</th><th className="px-2.5 py-2">Date</th><th className="px-2.5 py-2">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleRows.slice(0, 8).map((row) => <tr key={row.id} className="hover:bg-slate-50"><td className="px-2.5 py-1.5"><div className="font-bold text-slate-900">{row.recipient}</div></td><td className="px-2.5 py-1.5 text-slate-600">{row.paymentType}</td><td className="px-2.5 py-1.5"><div className="font-semibold text-slate-800">{row.source}</div><div className="text-xs text-slate-500">{row.source_label}</div></td>{supportsRichAmounts ? <><td className="px-2.5 py-1.5 tabular-nums">{row.gross != null ? money(row.gross) : "—"}</td><td className="px-2.5 py-1.5 tabular-nums text-slate-600">{row.fee != null ? money(row.fee) : "—"}</td></> : null}<td className="px-2.5 py-1.5 font-bold tabular-nums text-slate-900">{money(row.net)}</td><td className="px-2.5 py-1.5"><span aria-label={row.statusLabel} className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-bold capitalize ${statusTone(row.statusKey)}`}>{compactStatus(row.statusKey)}</span></td><td className="px-2.5 py-1.5 whitespace-nowrap text-slate-600">{row.date ? new Date(row.date).toLocaleDateString() : "—"}</td><td className="px-2.5 py-1.5"><a href={historyHref(row)} className="font-bold text-blue-700">View</a></td></tr>)}</tbody></table></div><div className="mt-3 divide-y divide-slate-100 md:hidden">{visibleRows.slice(0, 8).map((row) => <article key={row.id} className="py-3 first:pt-0"><div className="flex items-start justify-between gap-3"><div><div className="font-bold text-slate-950">{row.recipient}</div><div className="mt-1 text-xs text-slate-500">{row.paymentType} · {row.source}</div></div><div className="text-right"><div className="font-black tabular-nums text-slate-950">{money(row.net)}</div><span aria-label={row.statusLabel} className={`mt-1 inline-block whitespace-nowrap rounded-full px-2 py-1 text-xs font-bold capitalize ${statusTone(row.statusKey)}`}>{compactStatus(row.statusKey)}</span></div></div><a href={historyHref(row)} className="mt-2 inline-flex min-h-9 items-center text-sm font-bold text-blue-700">View payment <ArrowRight aria-hidden="true" className="ml-1 h-4 w-4" /></a></article>)}</div></> : <div className="mt-3 rounded-lg bg-slate-50 p-3"><div className="font-bold text-slate-900">No outgoing payments in this period.</div><p className="mt-1 text-sm text-slate-500">Supported outgoing payments will appear here when recorded.</p></div>}
        </section>

        <section data-testid="dashboard-payouts-upcoming" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-bold text-slate-950">Upcoming &amp; Pending</h2><p className="mt-1 text-sm text-slate-500">Payments that may need attention.</p>{attentionRows.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{attentionRows.map((row) => <a key={row.id} href={historyHref(row)} className="rounded-lg border border-slate-200 p-3 hover:border-blue-300"><div className="flex items-start justify-between gap-2"><div><div className="font-bold text-slate-900">{row.recipient}</div><div className="mt-1 text-xs text-slate-500">{row.paymentType}</div></div><span aria-label={row.statusLabel} className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-bold capitalize ${statusTone(row.statusKey)}`}>{compactStatus(row.statusKey)}</span></div><div className="mt-2 font-black tabular-nums text-slate-950">{money(row.net)}</div></a>)}</div> : <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">No outgoing payments currently require action.</div>}</section>

        <section data-testid="dashboard-payouts-export-center" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-bold text-slate-950">Export Center</h2><p className="mt-1 text-sm text-slate-500">Download payout records using the selected date range.</p></div><button type="button" data-testid="dashboard-payouts-export" onClick={onExport} disabled={exporting} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"><Download aria-hidden="true" className="h-4 w-4" />{exporting ? "Exporting..." : "Download CSV"}</button></div></section>
      </div>

      <aside className="space-y-3">
        <section data-testid="dashboard-payouts-status" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-bold text-slate-950">Payment Status</h2><p className="mt-1 text-sm text-slate-500">By recorded payment count.</p><div className="mt-3 divide-y divide-slate-100">{[{ label: "Paid", value: counts.paid, tone: "bg-emerald-500" }, { label: "Ready", value: counts.ready, tone: "bg-blue-500" }, { label: "Pending Approval", value: counts.pending, tone: "bg-amber-500" }, { label: "Failed / Blocked", value: counts.failed, tone: "bg-red-500" }].map((item) => <div key={item.label} className="flex items-center gap-2 py-2 text-sm"><span className={`h-2.5 w-2.5 rounded-full ${item.tone}`} /><span className="flex-1 font-semibold text-slate-700">{item.label}</span><span className="font-black tabular-nums text-slate-950">{item.value}</span></div>)}</div></section>
        <section data-testid="dashboard-payouts-fees" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-bold text-slate-950">Fees This Period</h2>{platformFees != null ? <><div className="mt-3 flex items-center justify-between"><div><div className="font-bold text-slate-800">Platform Fees</div><div className="mt-1 text-xs text-slate-500">Retained by MyHomeBro</div></div><div className="text-lg font-black tabular-nums text-slate-950">{money(platformFees)}</div></div>{onOpenReports ? <button type="button" data-testid="dashboard-payouts-fee-report" onClick={onOpenReports} className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-blue-700">View Platform Fee Report <ArrowRight aria-hidden="true" className="h-4 w-4" /></button> : null}</> : <p className="mt-3 text-sm text-slate-500">No platform or processing fees were recorded in this period.</p>}</section>
        <section data-testid="dashboard-payouts-actions" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-bold text-slate-950">Quick Actions</h2><div className="mt-3 divide-y divide-slate-100">{counts.ready + counts.pending > 0 ? <a href="/app/payouts/history?status=ready_for_payout" className="flex items-center gap-3 py-3 text-sm font-bold text-slate-800"><Clock3 className="h-4 w-4 text-blue-600" />Review Pending Payments<ArrowRight className="ml-auto h-4 w-4" /></a> : null}{counts.failed > 0 ? <a href="/app/payouts/history?status=failed" className="flex items-center gap-3 py-3 text-sm font-bold text-slate-800"><AlertTriangle className="h-4 w-4 text-red-600" />Review Failed Payments<ArrowRight className="ml-auto h-4 w-4" /></a> : null}<a href="/app/payouts/history" className="flex items-center gap-3 py-3 text-sm font-bold text-slate-800"><FileText className="h-4 w-4 text-slate-600" />View Payout History<ArrowRight className="ml-auto h-4 w-4" /></a></div></section>
      </aside>
    </div>
  </div>;
}
