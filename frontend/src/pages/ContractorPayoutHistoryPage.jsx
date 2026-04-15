import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";

function formatMoney(value) {
  const number = Number(value || 0);
  return `$${number.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function buildQuery(filters) {
  const params = new URLSearchParams();
  if (filters.projectClass && filters.projectClass !== "all") {
    params.set("project_class", filters.projectClass);
  }
  return params.toString();
}

function SummaryCard({ label, value, tone = "slate", testId = null }) {
  const toneMap = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    blue: "border-sky-200 bg-sky-50 text-sky-900",
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

export default function ContractorPayoutHistoryPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({
    projectClass: "all",
  });
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);

  const queryString = useMemo(() => buildQuery(filters), [filters]);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        const { data } = await api.get(
          `/projects/contractor/payout-history/${queryString ? `?${queryString}` : ""}`
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

  const countsLabel = `${summary?.payout_count ?? rows.length} payout${(summary?.payout_count ?? rows.length) === 1 ? "" : "s"}`;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 data-testid="contractor-payout-history-title" className="text-2xl font-bold text-slate-900">
            Payout History
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Completed payouts from paid invoices and released draw requests, with platform fees kept separate from your net payout.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/app/invoices")}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Payment Records
        </button>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-4">
          <SummaryCard
            label="Total Paid Out"
            value={formatMoney(summary?.total_paid_out)}
            tone="emerald"
            testId="payout-history-summary-paid-out"
          />
          <SummaryCard
            label="Platform Fees Retained"
            value={formatMoney(summary?.total_platform_fees_retained)}
            tone="amber"
            testId="payout-history-summary-fees"
          />
          <SummaryCard
            label="Total Gross Released"
            value={formatMoney(summary?.total_gross_released)}
            tone="blue"
            testId="payout-history-summary-gross"
          />
          <SummaryCard
            label="Number of Payouts"
            value={String(summary?.payout_count ?? rows.length ?? 0)}
            testId="payout-history-summary-count"
          />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Completed Payouts</h2>
            <div className="mt-1 text-sm text-slate-500">{loading ? "Loading payout history..." : countsLabel}</div>
          </div>
          <label className="text-sm font-medium text-slate-700">
            Project Class
            <select
              data-testid="payout-history-filter-project-class"
              value={filters.projectClass}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, projectClass: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 sm:w-48"
            >
              <option value="all">All</option>
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
            </select>
          </label>
        </div>

        {loading ? (
          <div className="mt-4 text-sm text-slate-500">Loading payout history...</div>
        ) : rows.length === 0 ? (
          <div
            data-testid="payout-history-empty"
            className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600"
          >
            No completed payouts match these filters.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Project / Agreement</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Project Class</th>
                  <th className="px-3 py-2">Gross</th>
                  <th className="px-3 py-2">Platform Fee</th>
                  <th className="px-3 py-2">Net Payout</th>
                  <th className="px-3 py-2">Transfer Ref</th>
                  <th className="px-3 py-2">Status / Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    data-testid={`payout-history-row-${row.record_id || row.id}`}
                    className="border-b border-slate-100 align-top"
                  >
                    <td className="px-3 py-3 text-slate-700">{formatDateTime(row.payout_date)}</td>
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-900">{row.agreement_label}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {row.project_title || row.agreement_reference || "-"}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">{row.source_label}</div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {row.record_type_label}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800">
                        {row.project_class_label || "Residential"}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-semibold tabular-nums text-slate-900">
                      {formatMoney(row.gross_amount)}
                    </td>
                    <td className="px-3 py-3 font-semibold tabular-nums text-slate-900">
                      {formatMoney(row.platform_fee)}
                    </td>
                    <td className="px-3 py-3 font-semibold tabular-nums text-slate-900">
                      {formatMoney(row.net_payout)}
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      <div className="break-all text-xs">{row.transfer_ref || "-"}</div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      <div className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                        {row.status_label || "Paid"}
                      </div>
                      {row.notes ? <div className="mt-1 text-xs text-slate-500">{row.notes}</div> : null}
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
