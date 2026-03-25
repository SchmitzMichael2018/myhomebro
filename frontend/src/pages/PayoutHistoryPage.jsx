import React, { useEffect, useMemo, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";

function formatMoney(value) {
  const number = Number(value || 0);
  return `$${number.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function buildQuery(filters) {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  if (filters.status) params.set("status", filters.status);
  if (filters.subcontractor) params.set("subcontractor_user", filters.subcontractor);
  return params.toString();
}

function SummaryCard({ label, value, tone = "slate", testId = null }) {
  const toneMap = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    rose: "border-rose-200 bg-rose-50 text-rose-900",
    slate: "border-slate-200 bg-white text-slate-900",
  };

  return (
    <div
      data-testid={testId || undefined}
      className={`rounded-xl border p-4 shadow-sm ${toneMap[tone] || toneMap.slate}`}
    >
      <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

export default function PayoutHistoryPage() {
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    status: "",
    subcontractor: "",
  });
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [exporting, setExporting] = useState(false);

  const queryString = useMemo(() => buildQuery(filters), [filters]);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        const { data } = await api.get(
          `/projects/payouts/history/${queryString ? `?${queryString}` : ""}`
        );
        if (!active) return;
        setRows(Array.isArray(data?.results) ? data.results : []);
        setSummary(data?.summary || null);
      } catch (err) {
        if (!active) return;
        console.error(err);
        toast.error(err?.response?.data?.detail || "Failed to load payout history.");
        setRows([]);
        setSummary(null);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [queryString]);

  async function exportCsv() {
    try {
      setExporting(true);
      const response = await api.get(
        `/projects/payouts/history/export/${queryString ? `?${queryString}` : ""}`,
        { responseType: "blob" }
      );
      const blob = new Blob([response.data], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "payout-history.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Failed to export payout history.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 data-testid="payout-history-title" className="text-2xl font-bold text-slate-900">
            Payout History
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Drill into subcontractor payout status, failures, and paid history for bookkeeping and operations.
          </p>
        </div>
        <button
          type="button"
          data-testid="payout-history-export"
          onClick={exportCsv}
          disabled={exporting}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {exporting ? "Exporting..." : "Export CSV"}
        </button>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-4">
          <label className="text-sm font-medium text-slate-700">
            Date From
            <input
              data-testid="payout-filter-date-from"
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Date To
            <input
              data-testid="payout-filter-date-to"
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Status
            <select
              data-testid="payout-filter-status"
              value={filters.status}
              onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">All statuses</option>
              <option value="paid">Paid</option>
              <option value="ready_for_payout">Ready</option>
              <option value="failed">Failed</option>
              <option value="eligible">Eligible</option>
              <option value="not_eligible">Pending</option>
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Subcontractor
            <input
              data-testid="payout-filter-subcontractor"
              type="text"
              value={filters.subcontractor}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, subcontractor: e.target.value }))
              }
              placeholder="Email or user id"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard
          label="Paid"
          value={formatMoney(summary?.total_paid_amount)}
          tone="emerald"
          testId="payout-summary-paid"
        />
        <SummaryCard
          label="Ready"
          value={formatMoney(summary?.total_ready_amount)}
          tone="amber"
          testId="payout-summary-ready"
        />
        <SummaryCard
          label="Failed"
          value={formatMoney(summary?.total_failed_amount)}
          tone="rose"
          testId="payout-summary-failed"
        />
        <SummaryCard
          label="Pending"
          value={formatMoney(summary?.total_pending_amount)}
          testId="payout-summary-pending"
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Payout Records</h2>
          <div className="text-sm text-slate-500">
            {summary?.record_count ?? rows.length} records
          </div>
        </div>

        {loading ? (
          <div className="mt-4 text-sm text-slate-500">Loading payout history...</div>
        ) : rows.length === 0 ? (
          <div
            data-testid="payout-history-empty"
            className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600"
          >
            No payout records match these filters.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2">Agreement / Milestone</th>
                  <th className="px-3 py-2">Subcontractor</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2">Timeline</th>
                  <th className="px-3 py-2">Audit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    data-testid={`payout-history-row-${row.id}`}
                    className="border-b border-slate-100 align-top"
                  >
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-900">{row.agreement_title}</div>
                      <div className="mt-1 text-slate-600">{row.milestone_title}</div>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs">
                        <a className="text-blue-700 hover:underline" href={`/app/payouts/history/${row.payout_id || row.id}`}>
                          View Payout
                        </a>
                        <a className="text-blue-700 hover:underline" href={`/app/agreements/${row.agreement_id}`}>
                          Open Agreement
                        </a>
                        <a className="text-blue-700 hover:underline" href={`/app/milestones/${row.milestone_id}`}>
                          View Milestone
                        </a>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      <div>{row.subcontractor_display_name || row.subcontractor_email}</div>
                      <div className="mt-1 text-xs text-slate-500">{row.subcontractor_email}</div>
                    </td>
                    <td className="px-3 py-3 font-semibold tabular-nums text-slate-900">
                      {formatMoney(row.payout_amount)}
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                        {String(row.payout_status || "").replaceAll("_", " ")}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {row.execution_mode ? String(row.execution_mode) : "—"}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {row.paid_at ? <div>Paid: {formatDateTime(row.paid_at)}</div> : null}
                      {row.ready_for_payout_at ? (
                        <div>Ready: {formatDateTime(row.ready_for_payout_at)}</div>
                      ) : null}
                      {row.failed_at ? <div>Failed: {formatDateTime(row.failed_at)}</div> : null}
                      {!row.paid_at && !row.ready_for_payout_at && !row.failed_at ? (
                        <div>Updated: {formatDateTime(row.updated_at)}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {row.stripe_transfer_id ? (
                        <div>Transfer: {row.stripe_transfer_id}</div>
                      ) : (
                        <div>Transfer: —</div>
                      )}
                      {row.failure_reason ? (
                        <div className="mt-1 whitespace-pre-wrap text-rose-700">
                          {row.failure_reason}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
