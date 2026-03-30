// frontend/src/components/BusinessDashboard.jsx
// Contractor Business Dashboard (aggregated endpoint)
// Uses backend route: /api/projects/business/contractor/summary/?range=...
// AI is included in the base experience.

import React, { useEffect, useMemo, useState } from "react";
import api from "../api";
import DashboardGrid from "./dashboard/DashboardGrid.jsx";
import DashboardSection from "./dashboard/DashboardSection.jsx";
import ContractorPageSurface from "./dashboard/ContractorPageSurface.jsx";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
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

function compactMoney(v) {
  const n = Number(v || 0);
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

function axisMoney(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "$0";
  if (Math.abs(n) >= 1000) return compactMoney(n);
  return `$${Math.round(n)}`;
}

function hasSeriesValue(rows, keys) {
  return (rows || []).some((row) =>
    keys.some((key) => Number(row?.[key] || 0) > 0)
  );
}

function ChartEmptyState({ text }) {
  return (
    <div className="flex h-72 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-6 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}

function ChartCard({ title, description, testId, children }) {
  return (
    <div
      data-testid={testId}
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="mb-3">
        <div className="text-base font-bold text-slate-900">{title}</div>
        <div className="mt-1 text-sm text-slate-600">{description}</div>
      </div>
      {children}
    </div>
  );
}

function buildDrilldownHref(chartType, row) {
  if ((chartType === "revenue" || chartType === "fees") && row?.invoice_id) {
    return `/app/invoices/${row.invoice_id}`;
  }
  if (chartType === "workflow" && row?.milestone_id) {
    return `/app/milestones/${row.milestone_id}`;
  }
  if (chartType === "payouts" && (row?.payout_id || row?.id)) {
    return `/app/payouts/history/${row.payout_id || row.id}`;
  }
  if (chartType === "payouts" && row?.milestone_id) {
    return `/app/milestones/${row.milestone_id}`;
  }
  if (row?.agreement_id) {
    return `/app/agreements/${row.agreement_id}`;
  }
  if (chartType === "payouts") {
    return "/app/payouts/history";
  }
  return "";
}

function ClickableBarShape({ x, y, width, height, fill, payload, dataKey, chartType, onBucketClick }) {
  if (!payload?.bucket_start) {
    return <rect x={x} y={y} width={width} height={height} fill={fill} />;
  }

  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={fill}
      rx={3}
      ry={3}
      className="cursor-pointer"
      data-testid={`chart-bar-${chartType}-${dataKey}-${payload.bucket_start}`}
      onClick={() => onBucketClick(chartType, payload)}
    />
  );
}

function ClickableDot({ cx, cy, payload, chartType, onBucketClick, stroke = "#0f172a" }) {
  if (!payload?.bucket_start) {
    return null;
  }

  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill="#fff"
      stroke={stroke}
      strokeWidth={2}
      className="cursor-pointer"
      data-testid={`chart-point-${chartType}-${payload.bucket_start}`}
      onClick={() => onBucketClick(chartType, payload)}
    />
  );
}

function DrilldownModal({ open, selection, loading, error, data, onClose }) {
  if (!open) return null;

  const chartType = selection?.chartType || data?.chart_type || "";
  const bucketLabel = data?.bucket_label || selection?.bucketLabel || "";
  const records = Array.isArray(data?.records) ? data.records : [];

  const renderRows = () => {
    if (loading) {
      return <div className="text-sm text-slate-500">Loading records...</div>;
    }
    if (error) {
      return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;
    }
    if (records.length === 0) {
      return (
        <div
          data-testid="drilldown-empty"
          className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600"
        >
          No records for this period.
        </div>
      );
    }

    if (chartType === "revenue") {
      return (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
                <th className="py-2 pr-3">Agreement</th>
                <th className="py-2 pr-3">Invoice</th>
                <th className="py-2 pr-3">Milestone</th>
                <th className="py-2 pr-3">Paid At</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {records.map((row) => {
                const href = buildDrilldownHref(chartType, row);
                return (
                  <tr key={row.id} data-testid={`drilldown-row-${row.id}`}>
                    <td className="py-3 pr-3 font-semibold text-slate-900">{row.agreement_title}</td>
                    <td className="py-3 pr-3 text-slate-700">{row.invoice_number}</td>
                    <td className="py-3 pr-3 text-slate-700">{row.milestone_title || "—"}</td>
                    <td className="py-3 pr-3 text-slate-700">{formatDateTime(row.paid_at)}</td>
                    <td className="py-3 pr-3 font-semibold text-slate-900">{money(row.gross_amount)}</td>
                    <td className="py-3">
                      {href ? (
                        <a
                          href={href}
                          data-testid={`drilldown-open-${row.id}`}
                          className="inline-flex rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Open
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }

    if (chartType === "fees") {
      return (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
                <th className="py-2 pr-3">Agreement</th>
                <th className="py-2 pr-3">Invoice</th>
                <th className="py-2 pr-3">Platform Fee</th>
                <th className="py-2 pr-3">Estimated Processing</th>
                <th className="py-2 pr-3">Gross Amount</th>
                <th className="py-2">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {records.map((row) => {
                const href = buildDrilldownHref(chartType, row);
                return (
                  <tr key={row.id} data-testid={`drilldown-row-${row.id}`}>
                    <td className="py-3 pr-3 font-semibold text-slate-900">{row.agreement_title}</td>
                    <td className="py-3 pr-3 text-slate-700">{row.invoice_number}</td>
                    <td className="py-3 pr-3 text-slate-700">{money(row.platform_fee)}</td>
                    <td className="py-3 pr-3 text-slate-700">{money(row.estimated_processing_fee)}</td>
                    <td className="py-3 pr-3 font-semibold text-slate-900">{money(row.gross_amount)}</td>
                    <td className="py-3">
                      {href ? (
                        <a
                          href={href}
                          data-testid={`drilldown-open-${row.id}`}
                          className="inline-flex rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Open
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }

    if (chartType === "payouts") {
      return (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
                <th className="py-2 pr-3">Agreement</th>
                <th className="py-2 pr-3">Milestone</th>
                <th className="py-2 pr-3">Subcontractor</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {records.map((row) => {
                const href = buildDrilldownHref(chartType, row);
                return (
                  <tr key={row.id} data-testid={`drilldown-row-${row.id}`}>
                    <td className="py-3 pr-3 font-semibold text-slate-900">{row.agreement_title}</td>
                    <td className="py-3 pr-3 text-slate-700">{row.milestone_title}</td>
                    <td className="py-3 pr-3 text-slate-700">
                      {row.subcontractor_display_name || row.subcontractor_email}
                    </td>
                    <td className="py-3 pr-3 text-slate-700">{String(row.payout_status || "").replaceAll("_", " ")}</td>
                    <td className="py-3 pr-3 font-semibold text-slate-900">{money(row.payout_amount)}</td>
                    <td className="py-3">
                      {href ? (
                        <a
                          href={href}
                          data-testid={`drilldown-open-${row.id}`}
                          className="inline-flex rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Open
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
              <th className="py-2 pr-3">Agreement</th>
              <th className="py-2 pr-3">Milestone</th>
              <th className="py-2 pr-3">Due Date</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Amount</th>
              <th className="py-2">Open</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {records.map((row) => {
              const href = buildDrilldownHref(chartType, row);
              return (
                <tr key={row.id} data-testid={`drilldown-row-${row.id}`}>
                  <td className="py-3 pr-3 font-semibold text-slate-900">{row.agreement_title}</td>
                  <td className="py-3 pr-3 text-slate-700">{row.milestone_title}</td>
                  <td className="py-3 pr-3 text-slate-700">{row.completion_date || "—"}</td>
                  <td className="py-3 pr-3 text-slate-700">
                    {String(row.subcontractor_completion_status || "overdue").replaceAll("_", " ")}
                  </td>
                  <td className="py-3 pr-3 font-semibold text-slate-900">{money(row.amount)}</td>
                  <td className="py-3">
                    {href ? (
                      <a
                        href={href}
                        data-testid={`drilldown-open-${row.id}`}
                        className="inline-flex rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Open
                      </a>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="dashboard-drilldown-modal"
    >
      <div className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-base font-bold text-slate-900">Chart Drilldown</div>
            <div className="mt-1 text-sm text-slate-600">
              {selection?.title || "Detail"} {bucketLabel ? `for ${bucketLabel}` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
        <div className="max-h-[calc(85vh-88px)] overflow-y-auto px-5 py-4">{renderRows()}</div>
      </div>
    </div>
  );
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
  const [drilldownSelection, setDrilldownSelection] = useState(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState("");
  const [drilldownData, setDrilldownData] = useState(null);

  const snapshot = payload?.snapshot || {};
  const byCategory = payload?.by_category || [];
  const insights = payload?.insights || [];
  const priorityInsights = insights.slice(0, 3);
  const revenueSeries = payload?.revenue_series || [];
  const feeSeries = payload?.fee_series || [];
  const payoutSeries = payload?.payout_series || [];
  const workflowSeries = payload?.workflow_series || [];
  const feeSummary = payload?.fee_summary || {};
  const workflowSummary = payload?.workflow_summary || {};
  const progressSummary = payload?.progress_summary || {};
  const payoutQuery = useMemo(() => buildPayoutQuery(range), [range]);
  const recentPayouts = useMemo(() => payoutRows.slice(0, 5), [payoutRows]);
  const pendingExposure = useMemo(
    () =>
      Number(snapshot.escrow_pending || 0) +
      Number(payoutSummary?.total_ready_amount || 0),
    [payoutSummary?.total_ready_amount, snapshot.escrow_pending]
  );
  const latestWorkflowRisk = useMemo(() => {
    if (!workflowSeries.length) return 0;
    return Number(workflowSeries[workflowSeries.length - 1]?.overdue_milestones || 0);
  }, [workflowSeries]);

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

  const revenueChart = useMemo(
    () =>
      revenueSeries.map((row) => ({
        ...row,
        revenue: Number(row.revenue || 0),
      })),
    [revenueSeries]
  );

  const feeChart = useMemo(
    () =>
      feeSeries.map((row) => ({
        ...row,
        platform_fee: Number(row.platform_fee || 0),
        estimated_processing_fee: Number(row.estimated_processing_fee || 0),
        total_fee: Number(row.total_fee || 0),
      })),
    [feeSeries]
  );

  const payoutChart = useMemo(
    () =>
      payoutSeries.map((row) => ({
        ...row,
        paid_amount: Number(row.paid_amount || 0),
        ready_amount: Number(row.ready_amount || 0),
        failed_amount: Number(row.failed_amount || 0),
      })),
    [payoutSeries]
  );

  const workflowChart = useMemo(
    () =>
      workflowSeries.map((row) => ({
        ...row,
        overdue_milestones: Number(row.overdue_milestones || 0),
      })),
    [workflowSeries]
  );

  const chartTitles = {
    revenue: "Revenue Over Time",
    fees: "Fees Over Time",
    payouts: "Subcontractor Payouts",
    workflow: "Overdue Milestones Trend",
  };

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

  const closeDrilldown = () => {
    setDrilldownSelection(null);
    setDrilldownLoading(false);
    setDrilldownError("");
    setDrilldownData(null);
  };

  const openDrilldown = async (chartType, bucketRow) => {
    if (!bucketRow?.bucket_start) return;

    setDrilldownSelection({
      chartType,
      bucketStart: bucketRow.bucket_start,
      bucketLabel: bucketRow.bucket_label,
      title: chartTitles[chartType] || "Chart Detail",
    });
    setDrilldownLoading(true);
    setDrilldownError("");
    setDrilldownData(null);

    try {
      const { data } = await api.get("/projects/business/contractor/drilldown/", {
        params: {
          chart_type: chartType,
          bucket_start: bucketRow.bucket_start,
          range,
        },
      });
      setDrilldownData(data || null);
    } catch (err) {
      console.error("Failed to load chart drilldown:", err);
      setDrilldownError("Failed to load records for this period.");
    } finally {
      setDrilldownLoading(false);
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
    closeDrilldown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useEffect(() => {
    fetchPayoutData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payoutQuery]);

  if (loading) {
    return <div className="p-6 text-center text-slate-700">Loading dashboard...</div>;
  }

  if (error) {
    return <div className="p-6 text-center font-semibold text-red-600">{error}</div>;
  }
  return (
    <ContractorPageSurface
      tier="full"
      eyebrow="Business"
      title="Business Dashboard"
      subtitle="Business health snapshot for jobs, revenue, categories, timing, escrow, and fees."
      actions={
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-700">Range</label>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
          >
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="ytd">Year to date</option>
            <option value="all">All time</option>
          </select>

          <button
            onClick={fetchData}
            className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
          >
            Refresh
          </button>
        </div>
      }
    >

      <DashboardSection
        title="Business Alerts"
        subtitle="High-priority work and payout signals should stand out before deeper reporting."
        className="mb-5"
      >
      <div className="rounded-xl border border-slate-200 bg-slate-50/55 p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Payout Automation</div>
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
        className="mb-6 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-bold text-slate-900">Needs Attention</div>
            <div className="mt-1 text-sm text-slate-600">
              Awaiting review, overdue work, payout blockers, and related contractor risk signals.
            </div>
          </div>
        </div>

        {priorityInsights.length === 0 ? (
          <div
            data-testid="dashboard-ai-insights-empty"
            className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600"
          >
            No business insights need attention right now.
          </div>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {priorityInsights.map((insight, index) => (
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
      </DashboardSection>

      <DashboardSection
        title="Performance Snapshot"
        subtitle="The top contractor business metrics worth scanning first."
        className="mb-5"
      >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Revenue"
          value={money(snapshot.total_revenue)}
          sub="Paid invoices in range"
          tone={Number(snapshot.total_revenue || 0) > 0 ? "good" : "default"}
        />
        <Stat
          label="Active Jobs"
          value={int(snapshot.active_jobs)}
          sub={`${int(snapshot.jobs_completed)} completed in range`}
          tone={Number(snapshot.active_jobs || 0) > 0 ? "warn" : "default"}
        />
        <Stat
          label="Pending Payout / Escrow"
          value={money(pendingExposure)}
          sub={`Subs ready: ${money(payoutSummary?.total_ready_amount)} · Escrow: ${money(snapshot.escrow_pending)}`}
          tone={pendingExposure > 0 ? "warn" : "default"}
        />
        <Stat
          label="Disputes / Risk"
          value={int(snapshot.disputes_open)}
          sub={
            latestWorkflowRisk > 0
              ? `${int(latestWorkflowRisk)} overdue milestones`
              : "No overdue workflow risk"
          }
          tone={
            Number(snapshot.disputes_open || 0) > 0 || latestWorkflowRisk > 0
              ? "bad"
              : "default"
          }
        />
      </div>

      <DashboardGrid className="hidden">
        <Stat
          label="Revenue"
          value={money(snapshot.total_revenue)}
          sub="Paid invoices in range"
          tone={Number(snapshot.total_revenue || 0) > 0 ? "good" : "default"}
        />

        <Stat
          label="Active Jobs"
          value={int(snapshot.active_jobs)}
          sub={`${int(snapshot.jobs_completed)} completed in range`}
          tone={Number(snapshot.active_jobs || 0) > 0 ? "warn" : "default"}
        />

        <Stat
          label="Pending Payout / Escrow"
          value={money(pendingExposure)}
          sub={`Subs ready: ${money(payoutSummary?.total_ready_amount)} · Escrow: ${money(snapshot.escrow_pending)}`}
          tone={pendingExposure > 0 ? "warn" : "default"}
        />

        <Stat
          label="Disputes / Risk"
          value={int(snapshot.disputes_open)}
          sub="Total revenue ÷ completed jobs"
        />

        <Stat
          label="Escrow Pending"
          value={money(snapshot.escrow_pending)}
          sub="Approved but not released"
          tone={Number(snapshot.escrow_pending || 0) > 0 ? "warn" : "default"}
        />

        <Stat
          label="Disputes Open"
          value={int(snapshot.disputes_open)}
          sub="Active disputes"
          tone={Number(snapshot.disputes_open || 0) > 0 ? "bad" : "default"}
        />
      </DashboardGrid>
      </DashboardSection>

      <DashboardSection
        title="Deep Dive"
        subtitle="Supporting reporting stays available here once the top metrics and alerts have been reviewed."
        className="mb-5"
      >
      <section className="rounded-xl border border-slate-200 bg-white/95 p-5 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-base font-bold text-slate-900">Operational Context</div>
            <div className="mt-1 text-sm text-slate-600">
              Supporting metrics that matter, without crowding the first scan of the page.
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Jobs Completed"
            value={int(snapshot.jobs_completed)}
            sub="Completed agreements in range"
            tone={Number(snapshot.jobs_completed || 0) > 0 ? "good" : "default"}
          />
          <Stat
            label="Avg Revenue / Job"
            value={money(snapshot.avg_revenue_per_job)}
            sub="Average paid revenue per completed job"
          />
          <Stat
            label="Avg Completion Days"
            value={num(snapshot.avg_completion_days, 1)}
            sub="Average cycle time"
          />
          <Stat
            label="Platform Fees Paid"
            value={money(snapshot.platform_fees_paid)}
            sub="Fees recorded in range"
          />
        </div>
      </section>

      {Number(progressSummary.project_count || 0) > 0 ? (
        <section className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50/55 p-5 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-base font-bold text-slate-900">Progress Project Financials</div>
              <div className="mt-1 text-sm text-slate-600">
                Contract-value and draw-based visibility for agreements using Progress Payments.
              </div>
            </div>
            <div className="text-xs text-slate-500">
              {int(progressSummary.project_count)} progress projects
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Stat label="Contract Value" value={money(progressSummary.contract_value)} />
            <Stat label="Earned to Date" value={money(progressSummary.earned_to_date)} />
            <Stat label="Approved to Date" value={money(progressSummary.approved_to_date)} />
            <Stat label="Paid to Date" value={money(progressSummary.paid_to_date)} tone="good" />
            <Stat label="Retainage Held" value={money(progressSummary.retainage_held)} tone="warn" />
            <Stat label="Remaining Balance" value={money(progressSummary.remaining_balance)} />
          </div>
        </section>
      ) : null}

      <section
        data-testid="dashboard-charts-section"
        className="mt-5 rounded-xl border border-slate-200 bg-slate-50/55 p-5 shadow-sm"
      >
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-base font-bold text-slate-900">Charts</div>
            <div className="mt-1 text-sm text-slate-700">
              Trend lines for revenue, fees, subcontractor payouts, and overdue work across the selected range.
            </div>
          </div>
          <div className="text-xs text-slate-500">
            Bucketed automatically for the selected date range.
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ChartCard
            title="Revenue Over Time"
            description="Paid invoice revenue grouped by the current dashboard range."
            testId="dashboard-chart-revenue"
          >
            {hasSeriesValue(revenueChart, ["revenue"]) ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket_label" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={axisMoney} width={70} />
                    <Tooltip formatter={(value) => money(value)} />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      name="Revenue"
                      stroke="#0f766e"
                      fill="#99f6e4"
                      strokeWidth={2}
                      dot={(props) => (
                        <ClickableDot
                          {...props}
                          chartType="revenue"
                          onBucketClick={openDrilldown}
                          stroke="#0f766e"
                        />
                      )}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <ChartEmptyState text="No paid invoice revenue in this range yet." />
            )}
          </ChartCard>

          <ChartCard
            title="Subcontractor Payouts"
            description="Paid, ready, and failed subcontractor payout amounts over time."
            testId="dashboard-chart-payouts"
          >
            {hasSeriesValue(payoutChart, ["paid_amount", "ready_amount", "failed_amount"]) ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={payoutChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket_label" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={axisMoney} width={70} />
                    <Tooltip formatter={(value) => money(value)} />
                    <Legend />
                    <Bar
                      dataKey="paid_amount"
                      name="Paid"
                      fill="#16a34a"
                      shape={(props) => (
                        <ClickableBarShape
                          {...props}
                          chartType="payouts"
                          onBucketClick={openDrilldown}
                          dataKey="paid_amount"
                        />
                      )}
                    />
                    <Bar
                      dataKey="ready_amount"
                      name="Ready"
                      fill="#f59e0b"
                      shape={(props) => (
                        <ClickableBarShape
                          {...props}
                          chartType="payouts"
                          onBucketClick={openDrilldown}
                          dataKey="ready_amount"
                        />
                      )}
                    />
                    <Bar
                      dataKey="failed_amount"
                      name="Failed"
                      fill="#dc2626"
                      shape={(props) => (
                        <ClickableBarShape
                          {...props}
                          chartType="payouts"
                          onBucketClick={openDrilldown}
                          dataKey="failed_amount"
                        />
                      )}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <ChartEmptyState text="No subcontractor payout activity in this range yet." />
            )}
          </ChartCard>

          <ChartCard
            title="Fees Over Time"
            description="Platform fees plus any estimated processing fees available from invoice payout fields."
            testId="dashboard-chart-fees"
          >
            {hasSeriesValue(feeChart, ["platform_fee", "estimated_processing_fee", "total_fee"]) ? (
              <>
                <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-600">
                  <span>Platform fees: {money(feeSummary.platform_fee_total)}</span>
                  <span>
                    Estimated processing: {money(feeSummary.estimated_processing_fee_total)}
                  </span>
                </div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={feeChart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="bucket_label" tick={{ fontSize: 12 }} />
                      <YAxis tickFormatter={axisMoney} width={70} />
                      <Tooltip formatter={(value) => money(value)} />
                      <Legend />
                      <Bar
                        dataKey="platform_fee"
                        name="Platform Fees"
                        stackId="fees"
                        fill="#334155"
                        shape={(props) => (
                          <ClickableBarShape
                            {...props}
                            chartType="fees"
                            onBucketClick={openDrilldown}
                            dataKey="platform_fee"
                          />
                        )}
                      />
                      <Bar
                        dataKey="estimated_processing_fee"
                        name="Estimated Processing"
                        stackId="fees"
                        fill="#94a3b8"
                        shape={(props) => (
                          <ClickableBarShape
                            {...props}
                            chartType="fees"
                            onBucketClick={openDrilldown}
                            dataKey="estimated_processing_fee"
                          />
                        )}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : (
              <ChartEmptyState text="No fee activity in this range yet." />
            )}
          </ChartCard>

          <ChartCard
            title="Overdue Milestones Trend"
            description="Overdue milestones by due-date bucket so schedule risk is visible before it compounds."
            testId="dashboard-chart-workflow"
          >
            {hasSeriesValue(workflowChart, ["overdue_milestones"]) ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={workflowChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket_label" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} width={50} />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="overdue_milestones"
                      name={workflowSummary.label || "Overdue Milestones"}
                      stroke="#7c2d12"
                      strokeWidth={3}
                      dot={(props) => (
                        <ClickableDot
                          {...props}
                          chartType="workflow"
                          onBucketClick={openDrilldown}
                          stroke="#7c2d12"
                        />
                      )}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <ChartEmptyState text="No overdue milestones in this range." />
            )}
          </ChartCard>
        </div>
      </section>

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

      </DashboardSection>

      {/* Footer note */}
      <div className="mhb-helper-text rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        Data reflects your completed agreements and paid invoices within the selected range.
      </div>

      <DrilldownModal
        open={!!drilldownSelection}
        selection={drilldownSelection}
        loading={drilldownLoading}
        error={drilldownError}
        data={drilldownData}
        onClose={closeDrilldown}
      />
    </ContractorPageSurface>
  );
}
