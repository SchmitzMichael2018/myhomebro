// frontend/src/components/BusinessDashboard.jsx
// Contractor Business Dashboard (aggregated endpoint)
// Uses backend route: /api/projects/business/contractor/summary/?range=...
// AI is included in the base experience.

import React, { useEffect, useMemo, useState } from "react";
import api from "../api";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

function money(v) {
  const n = Number(v || 0);
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function int(v) {
  return Number(v || 0).toLocaleString();
}

function num(v, digits = 2) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n.toFixed(digits) : "0.00";
}

function Empty({ text }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
      {text}
    </div>
  );
}

function Stat({ label, value, sub, tone = "default" }) {
  const toneClass =
    tone === "good"
      ? "border-green-200 bg-green-50"
      : tone === "warn"
      ? "border-yellow-200 bg-yellow-50"
      : tone === "bad"
      ? "border-red-200 bg-red-50"
      : "border-gray-200 bg-white";

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${toneClass}`}>
      <div className="text-sm font-semibold text-gray-600">{label}</div>
      <div className="mt-2 text-2xl font-extrabold text-gray-900">{value}</div>
      {sub ? <div className="mt-1 text-xs text-gray-600">{sub}</div> : null}
    </div>
  );
}

function planLabel() {
  return "Included";
}

function directPayRateLabel() {
  return "1% + $1";
}

function insightTone(severity) {
  if (severity === "high") {
    return "border-rose-200 bg-rose-50 text-rose-900";
  }
  if (severity === "medium") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  return "border-slate-200 bg-white text-slate-900";
}

function formatDateTime(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function buildPayoutQuery(range) {
  const params = new URLSearchParams();
  if (range === "all") {
    return "";
  }

  const now = new Date();
  const from = new Date(now);
  if (range === "ytd") {
    from.setMonth(0, 1);
    from.setHours(0, 0, 0, 0);
  } else {
    const days = Number(range || 0);
    if (Number.isFinite(days) && days > 0) {
      from.setDate(now.getDate() - days);
      from.setHours(0, 0, 0, 0);
    }
  }

  if (!Number.isNaN(from.getTime())) {
    params.set("date_from", from.toISOString().slice(0, 10));
  }
  return params.toString();
}

export default function BusinessDashboard() {
  const [range, setRange] = useState("90"); // backend supports: 30 | 90 | ytd | all
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [payload, setPayload] = useState(null);

  // Included AI + pricing summary
  const [meData, setMeData] = useState(null);
  const [meLoading, setMeLoading] = useState(true);
  const [autoPayoutBusy, setAutoPayoutBusy] = useState(false);
  const [payoutLoading, setPayoutLoading] = useState(true);
  const [payoutError, setPayoutError] = useState("");
  const [payoutRows, setPayoutRows] = useState([]);
  const [payoutSummary, setPayoutSummary] = useState(null);
  const [payoutExporting, setPayoutExporting] = useState(false);

  const snapshot = payload?.snapshot || {};
  const byCategory = payload?.by_category || [];
  const insights = payload?.insights || [];
  const payoutQuery = useMemo(() => buildPayoutQuery(range), [range]);
  const recentPayouts = useMemo(() => payoutRows.slice(0, 5), [payoutRows]);

  const categoryChart = useMemo(() => {
    // Recharts expects numbers; backend returns strings for money fields
    return (byCategory || []).map((r) => ({
      category: r.category,
      jobs: Number(r.jobs || 0),
      avg_completion_days: Number(r.avg_completion_days || 0),
      avg_revenue: Number(r.avg_revenue || 0),
      total_revenue: Number(r.total_revenue || 0),
    }));
  }, [byCategory]);

  const fetchMe = async () => {
    setMeLoading(true);
    try {
      const res = await api.get(`/projects/contractors/me/`, {
        params: { _ts: Date.now() },
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });
      setMeData(res?.data || null);
    } catch (e) {
      // non-fatal: dashboard can still load
      setMeData(null);
    } finally {
      setMeLoading(false);
    }
  };

  const toggleAutoPayouts = async (enabled) => {
    try {
      setAutoPayoutBusy(true);
      await api.patch("/projects/contractors/me/", {
        auto_subcontractor_payouts_enabled: enabled,
      });
      setMeData((prev) => ({
        ...(prev || {}),
        auto_subcontractor_payouts_enabled: enabled,
      }));
    } catch (err) {
      console.error("Failed to update auto payout setting:", err);
      setError("Failed to update auto payout setting.");
    } finally {
      setAutoPayoutBusy(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get(
        `/projects/business/contractor/summary/?range=${encodeURIComponent(range)}`
      );
      setPayload(res.data);
    } catch (err) {
      console.error("Error loading contractor business dashboard:", err);
      setError("Failed to load dashboard data. Please try refreshing the page.");
    } finally {
      setLoading(false);
    }
  };

  const fetchPayoutData = async () => {
    setPayoutLoading(true);
    setPayoutError("");
    try {
      const { data } = await api.get(
        `/projects/payouts/history/${payoutQuery ? `?${payoutQuery}` : ""}`
      );
      setPayoutRows(Array.isArray(data?.results) ? data.results : []);
      setPayoutSummary(data?.summary || null);
    } catch (err) {
      console.error("Error loading payout reporting:", err);
      setPayoutRows([]);
      setPayoutSummary(null);
      setPayoutError("Failed to load subcontractor payout reporting.");
    } finally {
      setPayoutLoading(false);
    }
  };

  const exportPayoutCsv = async () => {
    try {
      setPayoutExporting(true);
      const response = await api.get(
        `/projects/payouts/history/export/${payoutQuery ? `?${payoutQuery}` : ""}`,
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
      console.error("Failed to export payout history:", err);
      setPayoutError("Failed to export payout history.");
    } finally {
      setPayoutExporting(false);
    }
  };

  const exportDashboardReport = async (kind) => {
    try {
      setError("");
      const response = await api.get(
        `/projects/business-dashboard/export/${kind}/${range ? `?range=${encodeURIComponent(range)}` : ""}`,
        { responseType: "blob" }
      );
      const blob = new Blob([response.data], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `business-dashboard-${kind}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(`Failed to export ${kind} report:`, err);
      setError("Failed to export report.");
    }
  };

  useEffect(() => {
    fetchMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useEffect(() => {
    fetchPayoutData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payoutQuery]);

  if (loading) {
    return <div className="p-6 text-center text-gray-500">Loading dashboard...</div>;
  }

  if (error) {
    return <div className="p-6 text-center text-red-600 font-semibold">{error}</div>;
  }

  const plan = planLabel(meData);
  const dpRate = directPayRateLabel(meData);
  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-extrabold text-gray-900">Business Dashboard</h2>
          <p className="mhb-helper-text mt-4">
            Business health snapshot: jobs, revenue, categories, timing, escrow, fees.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-600">Range</label>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm"
          >
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="ytd">Year to date</option>
            <option value="all">All time</option>
          </select>

          <button
            onClick={fetchData}
            className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-gray-800"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* AI availability */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-extrabold text-slate-900">AI & Pricing</div>

            <div className="mt-2 text-sm text-slate-700">
              <b>AI Access:</b>{" "}
              {meLoading ? "Loading…" : plan}
              <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                INCLUDED
              </span>
            </div>

            <div className="mt-2 text-sm text-slate-700">
              <b>Direct Pay Rate:</b> {meLoading ? "—" : dpRate}
            </div>

            <div className="mt-2 text-xs text-slate-600">
              AI tools are included in the base experience. Direct Pay uses <b>1% + $1</b>.
              Escrow pricing remains tiered.
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={fetchMe}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Subcontractor Payout Automation</div>
            <div className="mt-2 text-sm text-slate-700">
              Automatically pay subcontractors when payouts are ready.
            </div>
            <div className="mt-2 text-xs text-slate-600">
              Failed payouts are not retried automatically and can still be reviewed manually.
            </div>
          </div>

          <label className="flex items-center gap-3 text-sm font-semibold text-slate-800">
            <span data-testid="auto-payout-setting-label">
              {meData?.auto_subcontractor_payouts_enabled ? "On" : "Off"}
            </span>
            <input
              data-testid="auto-payout-setting-toggle"
              type="checkbox"
              checked={!!meData?.auto_subcontractor_payouts_enabled}
              disabled={meLoading || autoPayoutBusy}
              onChange={(e) => toggleAutoPayouts(e.target.checked)}
            />
          </label>
        </div>
      </div>

      <section
        data-testid="dashboard-ai-insights-section"
        className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-bold text-slate-900">AI Business Insights</div>
            <div className="mt-1 text-sm text-slate-600">
              Short operational signals based on your current dashboard, review, payout, and project data.
            </div>
          </div>
        </div>

        {insights.length === 0 ? (
          <div
            data-testid="dashboard-ai-insights-empty"
            className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600"
          >
            No business insights need attention right now.
          </div>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {insights.map((insight, index) => (
              <div
                key={`${insight.category || "insight"}-${index}`}
                data-testid={`dashboard-ai-insight-${index}`}
                className={`rounded-xl border p-4 shadow-sm ${insightTone(insight.severity)}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-bold">{insight.title}</div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide opacity-75">
                    {insight.severity || "info"}
                  </div>
                </div>
                <div className="mt-2 text-sm leading-6">{insight.explanation}</div>
                {insight.action_href ? (
                  <a
                    href={insight.action_href}
                    className="mt-3 inline-flex rounded-lg border border-current px-3 py-2 text-xs font-semibold hover:bg-white/60"
                  >
                    {insight.action_label || "Review"}
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* KPI grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Jobs Completed"
          value={int(snapshot.jobs_completed)}
          sub="Agreements completed in range"
          tone={Number(snapshot.jobs_completed || 0) > 0 ? "good" : "default"}
        />

        <Stat
          label="Active Jobs"
          value={int(snapshot.active_jobs)}
          sub="Agreements still active"
          tone={Number(snapshot.active_jobs || 0) > 0 ? "warn" : "default"}
        />

        <Stat
          label="Total Revenue"
          value={money(snapshot.total_revenue)}
          sub="Paid invoices in range"
          tone={Number(snapshot.total_revenue || 0) > 0 ? "good" : "default"}
        />

        <Stat
          label="Avg Revenue / Job"
          value={money(snapshot.avg_revenue_per_job)}
          sub="Total revenue ÷ completed jobs"
        />

        <Stat
          label="Avg Completion Time"
          value={`${num(snapshot.avg_completion_days, 2)} days`}
          sub="Completed jobs only"
        />

        <Stat
          label="Escrow Pending"
          value={money(snapshot.escrow_pending)}
          sub="Approved but not released"
          tone={Number(snapshot.escrow_pending || 0) > 0 ? "warn" : "default"}
        />

        <Stat
          label="Platform Fees Paid"
          value={money(snapshot.platform_fees_paid)}
          sub="Fees deducted on paid invoices"
        />

        <Stat
          label="Disputes Open"
          value={int(snapshot.disputes_open)}
          sub="Active disputes"
          tone={Number(snapshot.disputes_open || 0) > 0 ? "bad" : "default"}
        />
      </div>

      <div
        data-testid="dashboard-payouts-section"
        className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-base font-bold text-slate-900">Subcontractor Payouts</div>
            <div className="mt-1 text-sm text-slate-600">
              Track paid, ready, failed, and pending subcontractor payouts alongside your business reporting.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="dashboard-payouts-export"
              onClick={exportPayoutCsv}
              disabled={payoutExporting}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {payoutExporting ? "Exporting..." : "Export CSV"}
            </button>
            <a
              data-testid="dashboard-payouts-full-history"
              href="/app/payouts/history"
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              View Full Payout History
            </a>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Paid to Subs"
            value={money(payoutSummary?.total_paid_amount)}
            sub="Completed subcontractor payouts"
            tone="good"
          />
          <Stat
            label="Ready for Payout"
            value={money(payoutSummary?.total_ready_amount)}
            sub="Can be paid now"
            tone="warn"
          />
          <Stat
            label="Failed Payouts"
            value={money(payoutSummary?.total_failed_amount)}
            sub="Needs contractor follow-up"
            tone="bad"
          />
          <Stat
            label="Pending Payouts"
            value={money(payoutSummary?.total_pending_amount)}
            sub="Not ready yet"
          />
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-bold text-slate-900">Recent Payout Activity</div>
            <div className="text-xs text-slate-500">
              {payoutSummary?.record_count ?? payoutRows.length} payout records in range
            </div>
          </div>

          {payoutLoading ? (
            <div className="text-sm text-slate-500">Loading payout reporting...</div>
          ) : payoutError ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {payoutError}
            </div>
          ) : recentPayouts.length === 0 ? (
            <Empty text="No subcontractor payouts in this range yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
                    <th className="py-2 pr-3">Agreement / Milestone</th>
                    <th className="py-2 pr-3">Subcontractor</th>
                    <th className="py-2 pr-3">Amount</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Activity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentPayouts.map((row) => (
                    <tr key={row.id} data-testid={`dashboard-payout-row-${row.id}`}>
                      <td className="py-3 pr-3">
                        <div className="font-semibold text-slate-900">{row.agreement_title}</div>
                        <div className="mt-1 text-slate-600">{row.milestone_title}</div>
                      </td>
                      <td className="py-3 pr-3 text-slate-700">
                        {row.subcontractor_display_name || row.subcontractor_email}
                      </td>
                      <td className="py-3 pr-3 font-semibold text-slate-900">
                        {money(row.payout_amount)}
                      </td>
                      <td className="py-3 pr-3">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                          {String(row.payout_status || "").replaceAll("_", " ")}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-slate-600">
                        {row.paid_at ? <div>Paid {formatDateTime(row.paid_at)}</div> : null}
                        {!row.paid_at && row.ready_for_payout_at ? (
                          <div>Ready {formatDateTime(row.ready_for_payout_at)}</div>
                        ) : null}
                        {row.failed_at ? <div>Failed {formatDateTime(row.failed_at)}</div> : null}
                        {row.execution_mode ? (
                          <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                            {row.execution_mode}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <section
        data-testid="dashboard-reports-exports-section"
        className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-base font-bold text-slate-900">Reports & Exports</div>
            <div className="mt-1 text-sm text-slate-600">
              Export for bookkeeping or tax prep using the current dashboard date range.
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <button
            type="button"
            data-testid="export-revenue-report"
            onClick={() => exportDashboardReport("revenue")}
            className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:bg-slate-50"
          >
            <div className="text-sm font-bold text-slate-900">Revenue Report</div>
            <div className="mt-1 text-xs text-slate-600">Gross revenue and paid invoice rows.</div>
          </button>
          <button
            type="button"
            data-testid="export-fee-report"
            onClick={() => exportDashboardReport("fees")}
            className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:bg-slate-50"
          >
            <div className="text-sm font-bold text-slate-900">Fee Report</div>
            <div className="mt-1 text-xs text-slate-600">Platform fee rows for bookkeeping review.</div>
          </button>
          <button
            type="button"
            data-testid="export-payout-report"
            onClick={() => exportDashboardReport("payouts")}
            className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:bg-slate-50"
          >
            <div className="text-sm font-bold text-slate-900">Subcontractor Payout Report</div>
            <div className="mt-1 text-xs text-slate-600">Payout status, failures, and payout audit rows.</div>
          </button>
          <button
            type="button"
            data-testid="export-jobs-report"
            onClick={() => exportDashboardReport("jobs")}
            className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:bg-slate-50"
          >
            <div className="text-sm font-bold text-slate-900">Completed Jobs Report</div>
            <div className="mt-1 text-xs text-slate-600">Completed agreement rows for operations review.</div>
          </button>
        </div>
      </section>

      {/* Jobs by Category */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-base font-bold text-gray-900">Jobs by Category</div>
            <div className="text-xs text-gray-500">Completed jobs in range</div>
          </div>

          {categoryChart.length === 0 ? (
            <Empty text="No completed jobs in this range yet." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryChart}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="category" interval={0} tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip
                    formatter={(v, name) => {
                      if (name === "jobs") return int(v);
                      return v;
                    }}
                  />
                  <Bar dataKey="jobs" name="Jobs" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-base font-bold text-gray-900">Category Performance</div>
            <div className="text-xs text-gray-500">Revenue + speed</div>
          </div>

          {byCategory.length === 0 ? (
            <Empty text="No category breakdown available for this range yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs font-semibold text-gray-600">
                    <th className="py-2 pr-3">Category</th>
                    <th className="py-2 pr-3">Jobs</th>
                    <th className="py-2 pr-3">Avg Revenue</th>
                    <th className="py-2 pr-3">Avg Days</th>
                    <th className="py-2 pr-3">Total Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {byCategory.map((r) => (
                    <tr key={r.category}>
                      <td className="py-2 pr-3 font-semibold text-gray-900">
                        {r.category}
                      </td>
                      <td className="py-2 pr-3 text-gray-700">{int(r.jobs)}</td>
                      <td className="py-2 pr-3 text-gray-700">{money(r.avg_revenue)}</td>
                      <td className="py-2 pr-3 text-gray-700">
                        {num(r.avg_completion_days, 2)}
                      </td>
                      <td className="py-2 pr-3 text-gray-700">{money(r.total_revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-2 text-xs text-gray-500">
                Tip: This will get even better once we add regional benchmarks + AI insights.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer note */}
      <div className="mhb-helper-text mt-4">
        Data reflects your completed agreements and paid invoices within the selected range.
      </div>
    </div>
  );
}
