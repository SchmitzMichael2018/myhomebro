// frontend/src/components/BusinessDashboard.jsx
// Contractor Business Dashboard (aggregated endpoint)
// Uses backend route: /api/projects/business/contractor/summary/?range=...
// AI is included in the base experience.

import React, { useEffect, useMemo, useState } from "react";
import api from "../api";
import DashboardGrid from "./dashboard/DashboardGrid.jsx";
import DashboardSection from "./dashboard/DashboardSection.jsx";
import ContractorPageSurface from "./dashboard/ContractorPageSurface.jsx";
import ContractorInsightsSection from "./dashboard/ContractorInsightsSection.jsx";
import { useWorkspaceProjectFamilyContext } from "../lib/projectFamilyContext.js";
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

function pct(v, digits = 1) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "0.0%";
}

function Empty({ text }) {
  return (
    <div className="rounded-xl border border-dashed border-white/14 bg-slate-950/35 p-6 text-center text-sm text-sky-100/70">
      {text}
    </div>
  );
}

function Stat({ label, value, sub, tone = "default" }) {
  const toneClass =
    tone === "good"
      ? "border-emerald-300/35 bg-emerald-400/15"
      : tone === "warn"
      ? "border-amber-300/35 bg-amber-400/15"
      : tone === "bad"
      ? "border-rose-300/35 bg-rose-400/15"
      : "border-white/12 bg-slate-950/40";

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${toneClass}`}>
      <div className="text-sm font-semibold text-sky-100/70">{label}</div>
      <div className="mt-2 text-2xl font-extrabold text-white">{value}</div>
      {sub ? <div className="mt-1 text-xs text-sky-100/60">{sub}</div> : null}
    </div>
  );
}

function dashboardToneClass(tone) {
  if (tone === "good") return "border-emerald-300/35 bg-emerald-400/15";
  if (tone === "warn") return "border-amber-300/35 bg-amber-400/15";
  if (tone === "bad") return "border-rose-300/35 bg-rose-400/15";
  if (tone === "info") return "border-sky-300/35 bg-sky-400/15";
  return "border-white/12 bg-slate-950/40";
}

function KpiCard({ label, value, sub, tone = "default", testId }) {
  return (
    <div
      data-testid={testId}
      className={`rounded-2xl border p-5 shadow-sm ${dashboardToneClass(tone)}`}
    >
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-100/60">{label}</div>
      <div className="mt-2 text-3xl font-bold leading-none text-white">{value}</div>
      {sub ? <div className="mt-2 text-sm leading-5 text-sky-100/70">{sub}</div> : null}
    </div>
  );
}

function ActionCard({ label, count, amount, description, href, tone = "default", testId }) {
  const Wrapper = href ? "a" : "div";
  return (
    <Wrapper
      data-testid={testId}
      href={href || undefined}
      className={`group rounded-2xl border p-5 shadow-sm transition hover:-translate-y-px hover:border-sky-300/35 hover:bg-sky-500/10 hover:shadow-sm ${dashboardToneClass(
        tone
      )} ${href ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-100/60">{label}</div>
          <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
            <span className="text-3xl font-bold leading-none text-white">{int(count)}</span>
            <span className="pb-0.5 text-sm font-medium text-sky-100/60">items</span>
            {amount ? (
              <span className="ml-auto text-2xl font-semibold leading-none text-white">{amount}</span>
            ) : null}
          </div>
          <div className="mt-3 text-sm leading-5 text-sky-100/70">{description}</div>
        </div>
        {href ? (
          <span
            aria-hidden="true"
            className="mt-1 text-lg font-semibold leading-none text-sky-100/55 transition group-hover:translate-x-0.5 group-hover:text-white"
          >
            →
          </span>
        ) : null}
      </div>
    </Wrapper>
  );
}

function ViewSelectorCard({ title, subtitle, preview, selected, onClick, testId }) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={selected}
      onClick={onClick}
      className={`group min-h-[126px] rounded-2xl border p-4 text-left shadow-sm transition ${
        selected
          ? "border-sky-300/45 bg-sky-500/20 text-white shadow-md"
          : "border-white/12 bg-slate-950/45 text-sky-100 hover:border-sky-300/35 hover:bg-sky-500/10 hover:shadow-sm"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className={`text-sm font-semibold ${
              selected ? "text-white/75" : "text-sky-100/60"
            }`}
          >
            {title}
          </div>
          <div
            className={`mt-1 text-lg font-bold leading-tight ${
              selected ? "text-white" : "text-white"
            }`}
          >
            {subtitle}
          </div>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
            selected
              ? "border-white/20 bg-white/10 text-white"
              : "border-white/12 bg-slate-900/60 text-sky-100/70"
          }`}
        >
          {selected ? "Selected" : "View"}
        </span>
      </div>
      <div className={`mt-3 text-sm leading-5 ${selected ? "text-sky-100/85" : "text-sky-100/70"}`}>
        {preview}
      </div>
    </button>
  );
}

function SummaryActionCard({
  title,
  subtitle,
  headline,
  headlineLabel,
  metrics = [],
  href,
  actionLabel = "View Details",
  tone = "default",
  testId,
}) {
  const Wrapper = href ? "a" : "div";
  return (
    <Wrapper
      data-testid={testId}
      href={href || undefined}
      className={`group rounded-2xl border p-5 shadow-sm transition hover:-translate-y-px hover:border-sky-300/35 hover:bg-sky-500/10 hover:shadow-sm ${dashboardToneClass(
        tone
      )} ${href ? "cursor-pointer" : ""}`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-100/60">{title}</div>
            <div className="mt-1 text-sm leading-5 text-sky-100/70">{subtitle}</div>
          </div>
          {href ? (
            <span className="rounded-full border border-white/12 bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-100/75 transition group-hover:border-sky-300/35 group-hover:text-white">
              View Details
            </span>
          ) : null}
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-950/35 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-100/60">
            {headlineLabel || "Total"}
          </div>
          <div className="mt-2 text-3xl font-bold leading-none text-white">{headline}</div>
        </div>

        {metrics.length > 0 ? (
          <div className={`grid grid-cols-1 gap-3 ${metrics.length > 1 ? "sm:grid-cols-2" : ""}`}>
            {metrics.map((metric) => (
              <div key={`${title}-${metric.label}`} className="rounded-xl border border-white/10 bg-slate-950/35 p-3">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-100/60">
                  {metric.label}
                </div>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <div>
                    <div className="text-2xl font-bold leading-none text-white">
                      {int(metric.count)}
                    </div>
                    <div className="mt-1 text-xs text-sky-100/55">items</div>
                  </div>
                  {metric.amount ? (
                    <div className="text-lg font-semibold text-white">{metric.amount}</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {href ? (
          <div className="pt-1">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-sky-100">
              <span>{actionLabel}</span>
              <span aria-hidden="true" className="transition group-hover:translate-x-0.5">
                â†’
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </Wrapper>
  );
}

function insightTone(severity) {
  if (severity === "high") {
    return "border-rose-300/35 bg-rose-400/15 text-rose-100";
  }
  if (severity === "medium") {
    return "border-amber-300/35 bg-amber-400/15 text-amber-100";
  }
  return "border-white/12 bg-slate-950/40 text-sky-100";
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
    <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-white/14 bg-slate-950/35 px-6 text-center text-sm text-sky-100/70">
      {text}
    </div>
  );
}

function ChartCard({ title, description, testId, children }) {
  return (
    <div
      data-testid={testId}
      className="rounded-xl border border-white/12 bg-slate-950/40 p-4 shadow-sm"
    >
      <div className="mb-3">
        <div className="text-base font-bold text-white">{title}</div>
        <div className="mt-1 text-sm text-sky-100/70">{description}</div>
      </div>
      {children}
    </div>
  );
}

function FunnelStep({ label, value, sub, fillPct, testId }) {
  return (
    <div data-testid={testId} className="rounded-xl border border-white/12 bg-slate-950/40 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-sky-100/70">{label}</div>
          <div className="mt-1 text-2xl font-extrabold text-white">{int(value)}</div>
        </div>
        <div className="text-right text-xs font-semibold text-sky-100/55">{sub}</div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-900/70">
        <div
          className="h-full rounded-full bg-sky-300"
          style={{ width: `${Math.max(6, Math.min(Number(fillPct || 0), 100))}%` }}
        />
      </div>
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
  const [activeBusinessView, setActiveBusinessView] = useState("at-a-glance");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [payload, setPayload] = useState(null);
  const {
    projectFamilyContext: workspaceProjectFamilyContext,
    setProjectFamilyContext: setWorkspaceProjectFamilyContext,
  } = useWorkspaceProjectFamilyContext();

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
  const contractorInsights = payload?.contractor_insights || null;
  const availableInsightFamilies = contractorInsights?.available_families || [];
  const insightFamilyOptionsByKey = useMemo(() => {
    return new Map((availableInsightFamilies || []).map((option) => [option.key, option]));
  }, [availableInsightFamilies]);
  const revenueSeries = payload?.revenue_series || [];
  const feeSeries = payload?.fee_series || [];
  const feeProjects = payload?.fee_projects || [];
  const financialSummary = payload?.financial_summary || {};
  const financialSeries = payload?.financial_series || [];
  const financialInsights = payload?.financial_insights || [];
  const payoutSeries = payload?.payout_series || [];
  const workflowSeries = payload?.workflow_series || [];
  const feeSummary = payload?.fee_summary || {};
  const workflowSummary = payload?.workflow_summary || {};
  const progressSummary = payload?.progress_summary || {};
  const businessPerformance = payload?.business_performance || {};
  const funnel = businessPerformance?.funnel || {};
  const conversionRates = businessPerformance?.conversion_rates || {};
  const revenueMetrics = businessPerformance?.revenue || {};
  const rangeLabel =
    range === "all" ? "All time" : range === "ytd" ? "Year to date" : `Last ${range} days`;
  const payoutQuery = useMemo(() => buildPayoutQuery(range), [range]);
  const payoutStatusCounts = useMemo(
    () => ({
      paid: payoutRows.filter((row) => String(row?.payout_status || "").toLowerCase() === "paid").length,
      ready: payoutRows.filter((row) =>
        String(row?.payout_status || "").toLowerCase().includes("ready")
      ).length,
      failed: payoutRows.filter((row) =>
        String(row?.payout_status || "").toLowerCase().includes("failed")
      ).length,
      pending: payoutRows.filter((row) =>
        String(row?.payout_status || "").toLowerCase().includes("pending")
      ).length,
    }),
    [payoutRows]
  );
  const insightFamilyKey = workspaceProjectFamilyContext.project_family_key || "all";
  const pendingExposure = useMemo(
    () =>
      Number(snapshot.escrow_pending || 0) +
      Number(payoutSummary?.total_ready_amount || 0),
    [payoutSummary?.total_ready_amount, snapshot.escrow_pending]
  );
  const overdueMilestoneCount = useMemo(() => {
    return workflowSeries.reduce((sum, row) => sum + Number(row?.overdue_milestones || 0), 0);
  }, [workflowSeries]);
  const latestWorkflowRisk = useMemo(() => {
    if (!workflowSeries.length) return 0;
    return Number(workflowSeries[workflowSeries.length - 1]?.overdue_milestones || 0);
  }, [workflowSeries]);
  const unsignedAgreementCount = useMemo(
    () =>
      Math.max(
        Number(funnel.agreements_created || 0) - Number(funnel.paid_projects || 0),
        0
      ),
    [funnel.agreements_created, funnel.paid_projects]
  );
  const quoteFollowUpCount = useMemo(
    () =>
      Math.max(
        Number(funnel.requests_received || 0) - Number(funnel.bids_submitted || 0),
        0
      ),
    [funnel.bids_submitted, funnel.requests_received]
  );
  const awaitingApprovalCount = useMemo(
    () =>
      Math.max(
        Number(funnel.agreements_created || 0) - Number(funnel.paid_projects || 0),
        0
      ),
    [funnel.agreements_created, funnel.paid_projects]
  );
  const activeProjectsCount = Number(snapshot.active_jobs || 0);
  const openDisputesCount = Number(snapshot.disputes_open || 0);
  const onHoldCount = Number(financialSummary.on_hold_count || 0);
  const onHoldTotal = Number(financialSummary.on_hold_total || 0);
  const pendingReleaseTotal = Number(financialSummary.pending_release_total || 0);
  const pendingReleaseCount = Number(financialSummary.pending_release_count || 0);
  const topAlertCards = useMemo(() => {
    const cards = [
      {
        key: "overdue-milestones",
        label: "Overdue milestones",
        count: overdueMilestoneCount,
        amount: "",
        description: "Milestones that need a decision or follow-up.",
        href: "/app/reviewer/queue",
        tone: overdueMilestoneCount > 0 ? "bad" : "default",
      },
      {
        key: "pending-release",
        label: "Pending release",
        count: pendingReleaseCount,
        amount: money(pendingReleaseTotal),
        description: "Approved work waiting to move into paid revenue.",
        href: "/app/payouts/history?status=ready_for_payout",
        tone: pendingReleaseCount > 0 ? "warn" : "default",
      },
      {
        key: "projects-at-risk",
        label: "Projects at risk",
        count: Math.max(onHoldCount, openDisputesCount),
        amount: money(onHoldTotal),
        description: "Disputes or holds that need a closer look.",
        href: "/app/disputes",
        tone: onHoldTotal > 0 || openDisputesCount > 0 ? "bad" : "default",
      },
    ];

    return cards.filter((card) => Number(card.count || 0) > 0);
  }, [onHoldCount, onHoldTotal, openDisputesCount, overdueMilestoneCount, pendingReleaseCount, pendingReleaseTotal]);

  const operationalHealthCards = useMemo(
    () => [
      {
        key: "awaiting-approval",
        label: "Awaiting approval",
        count: awaitingApprovalCount,
        description: "Invoices or draw requests waiting on customer approval.",
        href: "/app/invoices?money_status=payment_pending",
        tone: awaitingApprovalCount > 0 ? "warn" : "default",
      },
      {
        key: "active-projects",
        label: "Active projects",
        count: activeProjectsCount,
        description: "Projects currently moving forward.",
        href: "/app/agreements",
        tone: activeProjectsCount > 0 ? "info" : "default",
      },
      {
        key: "unsigned-agreements",
        label: "Agreements out for signature",
        count: unsignedAgreementCount,
        description: "Draft agreements waiting on customer signature.",
        href: "/app/agreements?status=awaiting_signature",
        tone: unsignedAgreementCount > 0 ? "info" : "default",
      },
      {
        key: "quote-requests",
        label: "Quote requests / new leads",
        count: quoteFollowUpCount,
        description: "New project requests that need follow-up.",
        href: "/app/bids",
        tone: quoteFollowUpCount > 0 ? "info" : "default",
      },
      {
        key: "open-disputes",
        label: "Open disputes",
        count: openDisputesCount,
        description: "Items that need a closer look or resolution.",
        href: "/app/disputes",
        tone: openDisputesCount > 0 ? "bad" : "default",
      },
    ],
    [activeProjectsCount, awaitingApprovalCount, openDisputesCount, quoteFollowUpCount, unsignedAgreementCount]
  );
  const kpiCards = useMemo(
    () => [
      {
        key: "gross-revenue",
        label: "Gross Revenue",
        value: money(financialSummary.gross_revenue_total),
        sub: "Paid work in the selected range",
        tone: Number(financialSummary.gross_revenue_total || 0) > 0 ? "good" : "default",
      },
      {
        key: "net-paid",
        label: "Net Paid to You",
        value: money(financialSummary.net_paid_total),
        sub: "Funds paid after platform fees",
        tone: Number(financialSummary.net_paid_total || 0) > 0 ? "good" : "default",
      },
      {
        key: "pending-release-total",
        label: "Pending Release",
        value: money(financialSummary.pending_release_total),
        sub: "Approved but not yet released",
        tone: Number(financialSummary.pending_release_total || 0) > 0 ? "warn" : "default",
      },
      {
        key: "on-hold-total",
        label: "On Hold / At Risk",
        value: money(financialSummary.on_hold_total),
        sub: "Disputed or paused for review",
        tone: Number(financialSummary.on_hold_total || 0) > 0 ? "bad" : "default",
      },
      {
        key: "active-projects",
        label: "Active Projects",
        value: int(snapshot.active_jobs),
        sub: "Projects currently moving",
        tone: Number(snapshot.active_jobs || 0) > 0 ? "info" : "default",
      },
    ],
    [
      financialSummary.gross_revenue_total,
      financialSummary.net_paid_total,
      financialSummary.on_hold_total,
      financialSummary.pending_release_total,
      snapshot.active_jobs,
    ]
  );

  const funnelEntries = useMemo(() => {
    const steps = [
      {
        key: "requests_received",
        label: "Requests received",
        value: Number(funnel.requests_received || 0),
        sub: "Start of funnel",
      },
      {
        key: "bids_submitted",
        label: "Bids submitted",
        value: Number(funnel.bids_submitted || 0),
        sub: `Request to bid ${pct(conversionRates.request_to_bid_rate || 0)}`,
      },
      {
        key: "bids_awarded",
        label: "Bids awarded",
        value: Number(funnel.bids_awarded || 0),
        sub: `Bid to award ${pct(conversionRates.bid_to_award_rate || 0)}`,
      },
      {
        key: "agreements_created",
        label: "Agreements created",
        value: Number(funnel.agreements_created || 0),
        sub: "Agreement stage",
      },
      {
        key: "paid_projects",
        label: "Paid projects",
        value: Number(funnel.paid_projects || 0),
        sub: `Award to paid ${pct(conversionRates.award_to_paid_rate || 0)}`,
      },
    ];

    const top = Math.max(...steps.map((step) => step.value), 0);
    return steps.map((step) => ({
      ...step,
      fillPct: top > 0 ? (step.value / top) * 100 : 0,
    }));
  }, [conversionRates.award_to_paid_rate, conversionRates.bid_to_award_rate, conversionRates.request_to_bid_rate, funnel.agreements_created, funnel.bids_awarded, funnel.bids_submitted, funnel.paid_projects, funnel.requests_received]);

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

  const financialTrendChart = useMemo(
    () =>
      financialSeries.map((row) => ({
        ...row,
        gross_revenue: Number(row.gross_revenue || 0),
        platform_fees: Number(row.platform_fees || 0),
        net_paid: Number(row.net_paid || 0),
      })),
    [financialSeries]
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

  const businessViewCards = useMemo(
    () => [
      {
        key: "at-a-glance",
        title: "At a Glance",
        subtitle: "Core business health",
        preview: `${topAlertCards.length} alerts · ${kpiCards.length} KPIs`,
      },
      {
        key: "contractor-insights",
        title: "Contractor Insights",
        subtitle: "Benchmarks and recommendations",
        preview: `${availableInsightFamilies.length || 0} insight families`,
      },
      {
        key: "reports-trends",
        title: "Reports & Trends",
        subtitle: "Charts and exports",
        preview: `${Object.keys(chartTitles).length} charts · exports`,
      },
      {
        key: "payouts",
        title: "Payouts",
        subtitle: "Subcontractor payout status",
        preview: `${payoutSummary?.record_count ?? payoutRows.length} payout records`,
      },
      {
        key: "operations",
        title: "Operations",
        subtitle: "Approvals, disputes, active jobs",
        preview: `${operationalHealthCards.filter((card) => Number(card.count || 0) > 0).length} action items`,
      },
    ],
    [
      availableInsightFamilies.length,
      chartTitles,
      kpiCards.length,
      operationalHealthCards,
      payoutRows.length,
      payoutSummary?.record_count,
      topAlertCards.length,
    ]
  );

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
      const params = { range };
      if (insightFamilyKey && insightFamilyKey !== "all") {
        params.project_family_key = insightFamilyKey;
      }
      const res = await api.get("/projects/business/contractor/summary/", {
        params,
      });
      setPayload(res.data);
    } catch (err) {
      console.error("Error loading contractor business dashboard:", err);
      setError("Failed to load dashboard data. Please try refreshing the page.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!insightFamilyKey || insightFamilyKey === "all") return;
    if (!availableInsightFamilies.length) return;
    if (insightFamilyOptionsByKey.has(insightFamilyKey)) return;

    setWorkspaceProjectFamilyContext({});
  }, [
    availableInsightFamilies.length,
    insightFamilyKey,
    insightFamilyOptionsByKey,
    setWorkspaceProjectFamilyContext,
  ]);

  const handleFamilyChange = (nextKey) => {
    if (nextKey === "all") {
      setWorkspaceProjectFamilyContext({});
      return;
    }

    const selectedOption = insightFamilyOptionsByKey.get(nextKey);
    setWorkspaceProjectFamilyContext({
      project_family_key: nextKey,
      project_family_label: selectedOption?.label || "",
    });
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
  }, [range, insightFamilyKey]);

  useEffect(() => {
    closeDrilldown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useEffect(() => {
    fetchPayoutData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payoutQuery]);

  if (loading) {
    return <div className="p-6 text-center text-sky-100/70">Loading dashboard...</div>;
  }

  if (error) {
    return <div className="p-6 text-center font-semibold text-rose-200">{error}</div>;
  }
  return (
    <ContractorPageSurface
      eyebrow="Business"
      title="Business Dashboard"
      subtitle="Track revenue, payouts, project health, and risks."
      variant="operational"
      className="mhb-business-dashboard"
      actions={
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-sky-100/75">Range</label>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="rounded-xl border border-white/15 bg-slate-950/55 px-3 py-2 text-sm font-semibold text-sky-50 shadow-sm outline-none focus:border-sky-300/60"
          >
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="ytd">Year to date</option>
            <option value="all">All time</option>
          </select>

          <button
            onClick={fetchData}
            className="rounded-xl border border-white/70 bg-white px-3 py-2 text-sm font-bold text-slate-950 shadow-sm hover:bg-sky-50"
          >
            Refresh
          </button>
        </div>
      }
    >

      <section
        data-testid="dashboard-view-selector-row"
        className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5"
      >
        {businessViewCards.map((card) => (
          <ViewSelectorCard
            key={card.key}
            testId={`dashboard-view-selector-${card.key}`}
            title={card.title}
            subtitle={card.subtitle}
            preview={card.preview}
            selected={activeBusinessView === card.key}
            onClick={() => setActiveBusinessView(card.key)}
          />
        ))}
      </section>

      {activeBusinessView === "at-a-glance" ? (
        <div data-testid="dashboard-view-at-a-glance">
          <DashboardSection
            title="Business Alerts"
            subtitle="Review the items that need a decision first."
            className="mb-5"
          >
            <section
              data-testid="dashboard-business-alerts-section"
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
          {topAlertCards.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
              No urgent alerts right now. Review the sections below for the full business picture.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {topAlertCards.map((card) => (
                <ActionCard
                  key={card.key}
                  testId={`dashboard-business-alert-${card.key}`}
                  label={card.label}
                  count={card.count}
                  amount={card.amount}
                  description={card.description}
                  href={card.href}
                  tone={card.tone}
                />
              ))}
            </div>
          )}

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Payout Automation</div>
                <div className="mt-1 text-sm text-slate-600">
                  Automatically pay subcontractors when payouts are ready.
                </div>
                <div className="mt-1 text-xs text-slate-500">
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
            </section>
          </DashboardSection>

          <DashboardSection
            title="At a Glance"
            subtitle="The handful of numbers that should shape your next decision."
            className="mb-5"
          >
            <div data-testid="dashboard-kpi-strip" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {kpiCards.map((card) => (
                <KpiCard
                  key={card.key}
                  label={card.label}
                  value={card.value}
                  sub={card.sub}
                  tone={card.tone}
                  testId={`dashboard-kpi-${card.key}`}
                />
              ))}
            </div>
          </DashboardSection>

          <DashboardSection
            title="Money in Motion"
            subtitle="Track revenue, platform fees, and what is still waiting to move."
            className="mb-5"
          >
            <section
              data-testid="dashboard-financial-section"
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-base font-bold text-slate-900">Revenue / Cash Flow</div>
              <div className="mt-1 text-sm text-slate-600">
                Selected range: {rangeLabel}. Platform fees are applied as payments are processed and stop once the project cap is reached.
              </div>
            </div>
            <div className="text-xs text-slate-500">Selected range summary</div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 xl:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-slate-900">Revenue / Fees / Net</div>
                  <div className="mt-1 text-sm text-slate-600">
                    Trend view for gross revenue, platform fees, and net payouts.
                  </div>
                </div>
                <div className="text-xs text-slate-500">{financialSeries.length} buckets</div>
              </div>
              <div className="mt-4">
                {hasSeriesValue(financialTrendChart, ["gross_revenue", "platform_fees", "net_paid"]) ? (
                  <div className="h-80" data-testid="dashboard-financial-trend-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={financialTrendChart}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="bucket_label" tick={{ fontSize: 12 }} />
                        <YAxis tickFormatter={axisMoney} width={70} />
                        <Tooltip formatter={(value) => money(value)} />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="gross_revenue"
                          name="Gross Revenue"
                          stroke="#0f172a"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="platform_fees"
                          name="Platform Fees"
                          stroke="#b45309"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="net_paid"
                          name="Net Paid"
                          stroke="#0f766e"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <ChartEmptyState text="No financial trend data in this range yet." />
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-sm font-bold text-slate-900">Cash Flow Status</div>
              <div className="mt-1 text-sm text-slate-600">
                At-a-glance view of what is already paid, what is waiting to release, and what is on hold.
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3">
                <Stat
                  label="Paid Events"
                  value={int(financialSummary.paid_events_count)}
                  sub="Payments that have settled"
                />
                <Stat
                  label="Pending Releases"
                  value={int(financialSummary.pending_release_count)}
                  sub="Work approved, funds not yet released"
                  tone={Number(financialSummary.pending_release_count || 0) > 0 ? "warn" : "default"}
                />
                <Stat
                  label="On Hold Events"
                  value={int(financialSummary.on_hold_count)}
                  sub="Needs review or resolution"
                  tone={Number(financialSummary.on_hold_count || 0) > 0 ? "bad" : "default"}
                />
              </div>
            </div>
          </div>

          <div data-testid="dashboard-financial-insights-section" className="mt-5">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="text-sm font-bold text-slate-900">Financial Insights</div>
                <div className="mt-1 text-sm text-slate-600">
                  Short reads that help you understand the money picture without digging through reports.
                </div>
              </div>
            </div>

            {financialInsights.length === 0 ? (
              <div className="mt-3">
                <Empty text="No financial insights to show yet." />
              </div>
            ) : (
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {financialInsights.map((insight, index) => (
                  <div
                    key={`${insight.title || "financial-insight"}-${index}`}
                    data-testid={`dashboard-financial-insight-${index}`}
                    className={`rounded-xl border p-4 shadow-sm ${insightTone(insight.severity)}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-bold">{insight.title}</div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-75">
                        {insight.severity || "info"}
                      </div>
                    </div>
                    <div className="mt-2 text-sm leading-6">{insight.explanation}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div data-testid="dashboard-summary-actions" className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <SummaryActionCard
              testId="dashboard-summary-projects"
              title="Projects"
              subtitle="Work underway and the revenue tied to it."
              headline={money(snapshot.total_revenue)}
              headlineLabel="Revenue in range"
              metrics={[
                { label: "Active", count: activeProjectsCount, amount: money(revenueMetrics.total_pipeline_value) },
                { label: "Paid", count: Number(funnel.paid_projects || 0), amount: money(financialSummary.net_paid_total) },
                { label: "At Risk", count: openDisputesCount, amount: money(onHoldTotal) },
              ]}
              href="/app/agreements"
              actionLabel="View Agreements"
              tone={activeProjectsCount > 0 ? "info" : "default"}
            />

            <SummaryActionCard
              testId="dashboard-summary-approvals"
              title="Approvals"
              subtitle="Things waiting on a customer decision."
              headline={money(pendingReleaseTotal)}
              headlineLabel="Pending release"
              metrics={[
                { label: "Awaiting approval", count: awaitingApprovalCount, amount: money(pendingReleaseTotal) },
                { label: "Unsigned", count: unsignedAgreementCount, amount: money(revenueMetrics.total_pipeline_value) },
                { label: "Quote follow-up", count: quoteFollowUpCount, amount: money(snapshot.total_revenue) },
              ]}
              href="/app/invoices?money_status=payment_pending"
              actionLabel="View Approvals"
              tone={awaitingApprovalCount > 0 ? "warn" : "default"}
            />

            <SummaryActionCard
              testId="dashboard-summary-payouts"
              title="Payouts"
              subtitle="What is ready, pending, or stuck."
              headline={money(payoutSummary?.total_ready_amount)}
              headlineLabel="Ready to pay"
              metrics={[
                { label: "Ready", count: payoutStatusCounts.ready, amount: money(payoutSummary?.total_ready_amount) },
                { label: "Pending", count: payoutStatusCounts.pending, amount: money(payoutSummary?.total_pending_amount) },
                { label: "Failed", count: payoutStatusCounts.failed, amount: money(payoutSummary?.total_failed_amount) },
              ]}
              href="/app/payouts/history"
              actionLabel="View Payouts"
              tone={payoutStatusCounts.ready > 0 ? "warn" : "default"}
            />
          </div>
            </section>
          </DashboardSection>
          <DashboardSection
            title="Operational Health"
            subtitle="The work and money signals that help you understand what needs action."
            className="mb-5"
          >
            <div
              data-testid="dashboard-operational-health-section"
              className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
            >
              {operationalHealthCards.map((card) => (
                <ActionCard
                  key={card.key}
                  testId={`dashboard-operational-health-${card.key}`}
                  label={card.label}
                  count={card.count}
                  description={card.description}
                  href={card.href}
                  tone={card.tone}
                />
              ))}
            </div>
          </DashboardSection>
        </div>
      ) : null}

      {activeBusinessView === "operations" ? (
        <div data-testid="dashboard-view-operations">
          <DashboardSection
            title="Operations"
            subtitle="Approvals, signatures, leads, and risk signals that need attention."
            className="mb-5"
          >
            <div
              data-testid="dashboard-operational-health-section"
              className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
            >
              {operationalHealthCards.map((card) => (
                <ActionCard
                  key={card.key}
                  testId={`dashboard-operational-health-${card.key}`}
                  label={card.label}
                  count={card.count}
                  description={card.description}
                  href={card.href}
                  tone={card.tone}
                />
              ))}
            </div>
          </DashboardSection>
        </div>
      ) : null}

      {activeBusinessView === "reports-trends" ? (
        <div data-testid="dashboard-view-reports-summary">
          <DashboardSection
            title="Business Snapshot"
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
        title="Business Performance"
        subtitle="A quick contractor funnel showing how requests turn into revenue."
        className="mb-5"
      >
        <section
          data-testid="dashboard-business-performance-section"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-base font-bold text-slate-900">Business Performance</div>
              <div className="mt-1 text-sm text-slate-600">
                Funnel counts, conversion rates, and contract value at a glance.
              </div>
            </div>
            <div className="text-xs text-slate-500">Range: {rangeLabel}</div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-5">
            {funnelEntries.map((step) => (
              <FunnelStep
                key={step.key}
                testId={`dashboard-business-performance-step-${step.key}`}
                label={step.label}
                value={step.value}
                sub={step.sub}
                fillPct={step.fillPct}
              />
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Stat
              label="Request to Bid"
              value={pct(conversionRates.request_to_bid_rate || 0)}
              sub="Requests that became bids"
              tone={Number(conversionRates.request_to_bid_rate || 0) > 0 ? "good" : "default"}
            />
            <Stat
              label="Bid to Award"
              value={pct(conversionRates.bid_to_award_rate || 0)}
              sub="Bids that won"
              tone={Number(conversionRates.bid_to_award_rate || 0) > 0 ? "warn" : "default"}
            />
            <Stat
              label="Award to Paid"
              value={pct(conversionRates.award_to_paid_rate || 0)}
              sub="Awards that turned into paid work"
              tone={Number(conversionRates.award_to_paid_rate || 0) > 0 ? "good" : "default"}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Stat
              label="Total Paid"
              value={money(revenueMetrics.total_paid)}
              sub="Paid invoices and draw requests"
              tone={Number(revenueMetrics.total_paid || 0) > 0 ? "good" : "default"}
            />
            <Stat
              label="Pipeline Value"
              value={money(revenueMetrics.total_pipeline_value)}
              sub="Agreements created in range"
              tone={Number(revenueMetrics.total_pipeline_value || 0) > 0 ? "warn" : "default"}
            />
            <Stat
              label="Avg Project Value"
              value={money(revenueMetrics.average_project_value)}
              sub="Average created agreement value"
            />
          </div>

          {Number(funnel.requests_received || 0) === 0 &&
          Number(funnel.bids_submitted || 0) === 0 &&
          Number(funnel.bids_awarded || 0) === 0 &&
          Number(funnel.agreements_created || 0) === 0 &&
          Number(funnel.paid_projects || 0) === 0 ? (
            <div
              data-testid="dashboard-business-performance-empty"
              className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600"
            >
              No funnel activity in this range yet.
            </div>
          ) : null}
        </section>
      </DashboardSection>

        </div>
      ) : null}

      {activeBusinessView === "contractor-insights" ? (
        <div data-testid="dashboard-view-contractor-insights">
          <ContractorInsightsSection
            insights={contractorInsights}
            availableFamilies={availableInsightFamilies}
            selectedFamilyKey={insightFamilyKey}
            onFamilyChange={handleFamilyChange}
          />
        </div>
      ) : null}

      {activeBusinessView === "reports-trends" ? (
        <div data-testid="dashboard-view-reports-trends">
          <DashboardSection
            title="Reports & Trends"
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
            label="Platform Fees Collected"
            value={money(snapshot.platform_fees_paid)}
            sub="Fees recorded in range"
          />
        </div>
      </section>

      <section
        data-testid="dashboard-fee-tracker-section"
        className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-base font-bold text-slate-900">Platform Fee Tracker</div>
            <div className="mt-1 text-sm text-slate-600">
              See how much MyHomeBro fee has been collected in the selected range and which projects contributed.
            </div>
          </div>
          <div className="text-xs text-slate-500">{rangeLabel}</div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Platform Fees Collected"
            value={money(snapshot.platform_fees_paid)}
            sub={`Fees collected in ${rangeLabel.toLowerCase()}`}
            tone="good"
          />
          <Stat
            label="Projects With Fees"
            value={int(feeProjects.length)}
            sub="Projects that recorded platform fees"
          />
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-bold text-slate-900">Fee Drilldown</div>
            <div className="text-xs text-slate-500">
              {feeProjects.length} project{feeProjects.length === 1 ? "" : "s"} with fee activity
            </div>
          </div>

          {feeProjects.length === 0 ? (
            <Empty text="No project fee activity in this range yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
                    <th className="py-2 pr-3">Project / Agreement</th>
                    <th className="py-2 pr-3">Contract Value</th>
                    <th className="py-2 pr-3">Fees Collected So Far</th>
                    <th className="py-2 pr-3">Fee Cap</th>
                    <th className="py-2 pr-3">Remaining Cap</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Open</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {feeProjects.map((row) => (
                    <tr key={row.id} data-testid={`dashboard-fee-project-row-${row.id}`}>
                      <td className="py-3 pr-3">
                        <div className="font-semibold text-slate-900">{row.agreement_title}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.fees_collected_in_range ? `Collected ${money(row.fees_collected_in_range)} in range` : "No recent fee activity"}
                        </div>
                      </td>
                      <td className="py-3 pr-3 text-slate-700">{money(row.contract_value)}</td>
                      <td className="py-3 pr-3 font-semibold text-slate-900">
                        {money(row.fees_collected_so_far)}
                      </td>
                      <td className="py-3 pr-3 text-slate-700">{money(row.fee_cap)}</td>
                      <td className="py-3 pr-3 text-slate-700">{money(row.remaining_cap)}</td>
                      <td className="py-3 pr-3 text-slate-700">{row.payment_status || "—"}</td>
                      <td className="py-3">
                        {row.agreement_id ? (
                          <a
                            href={`/app/agreements/${row.agreement_id}`}
                            className="inline-flex rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            data-testid={`dashboard-fee-project-open-${row.id}`}
                          >
                            Open
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
            <Stat label="Payment Pending to Date" value={money(progressSummary.approved_to_date)} />
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
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:border-slate-300 hover:shadow-sm"
          >
            <div className="text-sm font-semibold text-slate-900">Revenue Report</div>
            <div className="mt-1 text-xs text-slate-500">Paid invoices and revenue detail.</div>
          </button>
          <button
            type="button"
            data-testid="export-fee-report"
            onClick={() => exportDashboardReport("fees")}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:border-slate-300 hover:shadow-sm"
          >
            <div className="text-sm font-semibold text-slate-900">Fee Report</div>
            <div className="mt-1 text-xs text-slate-500">Platform fee detail by invoice.</div>
          </button>
          <button
            type="button"
            data-testid="export-payout-report"
            onClick={() => exportDashboardReport("payouts")}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:border-slate-300 hover:shadow-sm"
          >
            <div className="text-sm font-semibold text-slate-900">Payout Report</div>
            <div className="mt-1 text-xs text-slate-500">Subcontractor payout history.</div>
          </button>
          <button
            type="button"
            data-testid="export-jobs-report"
            onClick={() => exportDashboardReport("jobs")}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:border-slate-300 hover:shadow-sm"
          >
            <div className="text-sm font-semibold text-slate-900">Jobs Report</div>
            <div className="mt-1 text-xs text-slate-500">Job, category, and completion summary.</div>
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
        </div>
      ) : null}

      {activeBusinessView === "payouts" ? (
        <div data-testid="dashboard-view-payouts">
          <div
            data-testid="dashboard-payouts-section"
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-base font-bold text-slate-900">Payout Snapshot</div>
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
              <SummaryActionCard
                testId="dashboard-summary-payout-activity"
                title="Payout Activity"
                subtitle="Recent payout mix without the long list."
                headline={money(payoutSummary?.total_paid_amount)}
                headlineLabel="Paid out"
                metrics={[
                  { label: "Ready", count: payoutStatusCounts.ready, amount: money(payoutSummary?.total_ready_amount) },
                  { label: "Pending", count: payoutStatusCounts.pending, amount: money(payoutSummary?.total_pending_amount) },
                  { label: "Failed", count: payoutStatusCounts.failed, amount: money(payoutSummary?.total_failed_amount) },
                ]}
                href="/app/payouts/history"
                actionLabel="View Payout Details"
                tone={payoutStatusCounts.ready > 0 ? "warn" : "default"}
              />
            </div>
          </div>
        </div>
      ) : null}
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
