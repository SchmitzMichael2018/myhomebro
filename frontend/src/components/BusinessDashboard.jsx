// frontend/src/components/BusinessDashboard.jsx
// Contractor Insights workspace (aggregated endpoint)
// Uses backend route: /api/projects/business/contractor/summary/?range=...
// AI is included in the base experience.

import React, { useEffect, useMemo, useState } from "react";
import api from "../api";
import DashboardGrid from "./dashboard/DashboardGrid.jsx";
import DashboardSection from "./dashboard/DashboardSection.jsx";
import ContractorPageSurface from "./dashboard/ContractorPageSurface.jsx";
import ContractorInsightsSection from "./dashboard/ContractorInsightsSection.jsx";
import ReportsLibrary from "./dashboard/ReportsLibrary.jsx";
import PayoutsWorkspace from "./dashboard/PayoutsWorkspace.jsx";
import { useWorkspaceProjectFamilyContext } from "../lib/projectFamilyContext.js";
import {
  ArrowRight,
  BarChart3,
  Bell,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Download,
  ExternalLink,
  FileBarChart2,
  FileText,
  Grid2X2,
  Info,
  MoreVertical,
  RefreshCw,
  Settings,
  Star,
  Target,
  TriangleAlert,
  Users,
  WalletCards,
} from "lucide-react";
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
    <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
      <Info aria-hidden="true" className="h-5 w-5 shrink-0 text-slate-400" />
      <span>{text}</span>
    </div>
  );
}

function Stat({ label, value, sub, tone = "default" }) {
  const toneClass =
    tone === "good"
      ? "border-emerald-100 bg-emerald-50/60"
      : tone === "warn"
      ? "border-amber-100 bg-amber-50/60"
      : tone === "bad"
      ? "border-rose-100 bg-rose-50/60"
      : "border-slate-100 bg-white";

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${toneClass}`}>
      <div className="text-sm font-semibold text-slate-600">{label}</div>
      <div className="mt-2 text-2xl font-extrabold text-slate-950">{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

function LightMetric({ label, value, sub, tone = "default", icon: Icon }) {
  const toneClass =
    tone === "good"
      ? "text-emerald-700 bg-emerald-50 border-emerald-100"
      : tone === "warn"
      ? "text-amber-700 bg-amber-50 border-amber-100"
      : tone === "bad"
      ? "text-red-700 bg-red-50 border-red-100"
      : "text-blue-700 bg-blue-50 border-blue-100";

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900">{label}</div>
          <div className="mt-3 text-2xl font-black leading-none text-slate-950">{value}</div>
        </div>
        {Icon ? (
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${toneClass}`}>
            <Icon aria-hidden="true" className="h-4 w-4" />
          </div>
        ) : null}
      </div>
      {sub ? <div className="mt-3 text-sm leading-5 text-slate-500">{sub}</div> : null}
    </div>
  );
}

function dashboardToneClass(tone) {
  if (tone === "good") return "border-emerald-100 bg-emerald-50/50";
  if (tone === "warn") return "border-amber-100 bg-amber-50/50";
  if (tone === "bad") return "border-rose-100 bg-rose-50/50";
  if (tone === "info") return "border-blue-100 bg-blue-50/50";
  return "border-slate-100 bg-white";
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

function commandStateTone(status) {
  if (status === "At Risk") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "Needs Attention") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function severityTone(severity) {
  if (severity === "high") return "border-rose-300/35 bg-rose-400/15 text-rose-100";
  if (severity === "medium") return "border-amber-300/35 bg-amber-400/15 text-amber-100";
  return "border-sky-300/35 bg-sky-400/15 text-sky-100";
}

function CanonicalMetricCard({ metric }) {
  if (!metric) return null;
  const value = metric.kind === "money" ? money(metric.value) : int(metric.value);
  const Wrapper = metric.href ? "a" : "div";
  return (
    <Wrapper
      href={metric.href || undefined}
      data-testid={`insights-canonical-metric-${metric.key}`}
      className="group border-l border-slate-200 px-5 py-2 first:border-l-0 transition hover:bg-slate-50"
    >
      <div className="text-sm font-semibold text-slate-600">{metric.label}</div>
      <div className="mt-2 text-2xl font-black text-slate-950">{value}</div>
      <div className="mt-2 text-xs leading-5 text-slate-500">{metric.detail}</div>
      {metric.href ? <div className="mt-3 text-xs font-bold text-blue-700">Open source records</div> : null}
    </Wrapper>
  );
}

function ActionCard({ label, count, amount, description, href, tone = "default", testId }) {
  const Wrapper = href ? "a" : "div";
  return (
    <Wrapper
      data-testid={testId}
      href={href || undefined}
      className={`group border-b border-slate-200 px-1 py-5 transition last:border-b-0 hover:bg-slate-50 ${dashboardToneClass(
        tone
      )} ${href ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-600">{label}</div>
          <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
            <span className="text-3xl font-bold leading-none text-slate-950">{int(count)}</span>
            <span className="pb-0.5 text-sm font-medium text-slate-500">items</span>
            {amount ? (
              <span className="ml-auto text-2xl font-semibold leading-none text-slate-950">{amount}</span>
            ) : null}
          </div>
          <div className="mt-3 text-sm leading-5 text-slate-500">{description}</div>
        </div>
        {href ? (
          <ArrowRight aria-hidden="true" className="mt-1 h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-blue-600" />
        ) : null}
      </div>
    </Wrapper>
  );
}

function ViewSelectorCard({ title, icon: Icon, selected, onClick, testId }) {
  const workspaceTitle = title === "Executive Overview"
    ? "Executive"
    : title === "Financial Performance"
      ? "Financial"
      : title === "Reports & Trends"
        ? "Reports"
        : title === "Payouts & Exports"
          ? "Payouts"
          : title;
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={selected}
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={`inline-flex min-h-11 min-w-[140px] flex-1 shrink-0 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
        selected
          ? "border-blue-400 bg-blue-50 text-blue-700 shadow-sm"
          : "border-slate-200 bg-white text-slate-800 hover:border-blue-200 hover:bg-slate-50"
      }`}
    >
      {Icon ? <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2} /> : null}
      {workspaceTitle}
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
                --------
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

function operationsActionLabel(item) {
  const href = String(item?.open_url || "").toLowerCase();
  const source = String(item?.source_workspace || "").toLowerCase();
  if (href.includes("milestone") || source.includes("milestone")) return "Review Milestones";
  if (href.includes("payment") || source.includes("payment")) return "Review Approvals";
  if (href.includes("agreement") || source.includes("agreement")) return "Open Agreements";
  if (href.includes("warranty") || source.includes("warranty")) return "Review Warranty";
  if (href.includes("resolution") || source.includes("resolution")) return "Open Resolution";
  if (href.includes("team") || source.includes("team")) return "Open Assignments";
  return item?.action_label && item.action_label !== "Open" ? item.action_label : "Open Details";
}

function operationsFocusTitle(item) {
  const title = String(item?.title || "Priority item").trim();
  if (/^overdue milestones$/i.test(title)) return "Review overdue milestones";
  if (/approval/i.test(title)) return "Review pending approvals";
  if (/warranty/i.test(title)) return "Review warranty request";
  if (/resolution/i.test(title)) return "Review resolution case";
  return title;
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

function ChartEmptyState({ text, tone = "dark" }) {
  const light = tone === "light";
  return (
    <div className={`flex h-72 items-center justify-center rounded-xl border border-dashed px-6 text-center text-sm ${
      light
        ? "border-slate-200 bg-slate-50 text-slate-500"
        : "border-white/14 bg-slate-950/35 text-sky-100/70"
    }`}>
      {text}
    </div>
  );
}

function ChartCard({ title, description, testId, children }) {
  return (
    <div
      data-testid={testId}
      className="bg-white p-2"
    >
      <div className="mb-3">
        <div className="text-lg font-bold text-slate-950">{title}</div>
        <div className="mt-1 text-sm text-slate-500">{description}</div>
      </div>
      {children}
    </div>
  );
}

const DEFAULT_INSIGHTS_WIDGETS = [
  "business_snapshot",
  "goal_progress",
  "primary_trend",
  "needs_attention",
  "reports_handoff",
];

const INSIGHTS_VIEWS = [
  { key: "scorecard", title: "Scorecard", subtitle: "How is my business doing right now?", defaultPeriod: "30", icon: Grid2X2 },
  { key: "executive", title: "Executive Overview", subtitle: "Overall health and leadership signals.", defaultPeriod: "30", icon: ChartNoAxesCombined },
  { key: "benchmarks", title: "Benchmarks", subtitle: "Compare project types, periods, and peers.", defaultPeriod: "90", icon: BarChart3 },
  { key: "financial", title: "Financial Performance", subtitle: "How money is moving through the business.", defaultPeriod: "30", icon: FileText },
  { key: "operations", title: "Operations", subtitle: "How work execution is performing.", defaultPeriod: "30", icon: Users },
  { key: "reports-trends", title: "Reports & Trends", subtitle: "Detailed analytics, charts, and tables.", defaultPeriod: "90", icon: FileBarChart2 },
  { key: "payouts", title: "Payouts & Exports", subtitle: "Money that has gone out and export actions.", defaultPeriod: "30", icon: WalletCards },
];

const VIEW_BY_ID = Object.fromEntries(INSIGHTS_VIEWS.map((view) => [view.key, view]));

const VIEW_WIDGET_DEFAULTS = {
  scorecard: DEFAULT_INSIGHTS_WIDGETS,
  executive: ["business_health", "executive_scorecard", "morning_brief", "business_alerts"],
  benchmarks: ["contractor_insights", "peer_comparisons", "category_performance", "recommendation_summary"],
  financial: ["financial_snapshot", "financial_trend", "payment_performance", "platform_fee_tracker"],
  operations: ["operations_health", "milestone_completion", "warranty_activity", "resolution_cases"],
  "reports-trends": ["report_controls", "charts", "metric_definitions", "category_reports"],
  payouts: ["payout_snapshot", "payout_activity", "export_center"],
};

const WIDGET_CATALOG_BY_VIEW = {
  scorecard: [
    { id: "business_snapshot", label: "Business Snapshot" },
    { id: "goal_progress", label: "Goal Progress" },
    { id: "primary_trend", label: "Primary Performance Trend" },
    { id: "needs_attention", label: "Needs Attention" },
    { id: "reports_handoff", label: "Detailed Reports Link" },
    { id: "estimate_conversion", label: "Estimate Conversion" },
    { id: "payment_performance", label: "Payment Performance" },
    { id: "project_completion", label: "Project Completion" },
    { id: "warranty_trends", label: "Warranty Trends" },
    { id: "resolution_trends", label: "Resolution Trends" },
  ],
  executive: [
    { id: "business_health", label: "Business Health" },
    { id: "executive_scorecard", label: "Executive Scorecard" },
    { id: "morning_brief", label: "Morning Brief" },
    { id: "business_alerts", label: "Business Alerts" },
    { id: "strategic_risks", label: "Strategic Risks" },
    { id: "biggest_win", label: "Biggest Win" },
  ],
  benchmarks: [
    { id: "contractor_insights", label: "Contractor Insights" },
    { id: "peer_comparisons", label: "Peer Comparisons" },
    { id: "category_performance", label: "Category Performance" },
    { id: "recommendation_summary", label: "Recommendation Summary" },
    { id: "completion_benchmark", label: "Completion Benchmark" },
    { id: "estimate_benchmark", label: "Estimate Benchmark" },
    { id: "review_benchmark", label: "Review Benchmark" },
  ],
  financial: [
    { id: "financial_snapshot", label: "Financial Snapshot" },
    { id: "financial_trend", label: "Financial Trend" },
    { id: "payment_performance", label: "Payment Performance" },
    { id: "platform_fee_tracker", label: "Platform Fee Tracker" },
    { id: "outstanding_invoices", label: "Outstanding Invoices" },
    { id: "payment_pipeline", label: "Payment Pipeline" },
    { id: "payout_summary", label: "Payout Summary" },
  ],
  operations: [
    { id: "operations_health", label: "Operations Health" },
    { id: "milestone_completion", label: "Milestone Completion" },
    { id: "warranty_activity", label: "Warranty Activity" },
    { id: "resolution_cases", label: "Resolution Cases" },
    { id: "schedule_performance", label: "Schedule Performance" },
    { id: "awaiting_review", label: "Awaiting Review" },
    { id: "project_health_by_category", label: "Project Health by Category" },
  ],
  "reports-trends": [
    { id: "report_controls", label: "Report Controls" },
    { id: "charts", label: "Charts" },
    { id: "metric_definitions", label: "Metric Definitions" },
    { id: "category_reports", label: "Category Reports" },
    { id: "business_performance", label: "Business Performance" },
    { id: "fee_drilldown", label: "Fee Drilldown" },
    { id: "progress_financials", label: "Progress Financials" },
  ],
  payouts: [
    { id: "payout_snapshot", label: "Payout Snapshot" },
    { id: "payout_activity", label: "Payout Activity" },
    { id: "export_center", label: "Export Center" },
    { id: "failed_payouts", label: "Failed Payouts" },
    { id: "pending_payouts", label: "Pending Payouts" },
  ],
};

function widgetLabel(id, viewId = "scorecard") {
  return WIDGET_CATALOG_BY_VIEW[viewId]?.find((item) => item.id === id)?.label || id;
}

function ScorecardMetric({ label, value, sub, comparison }) {
  const pending = String(sub || "").toLowerCase() === "pending";
  return (
    <div className="border-l border-slate-200 px-5 py-1 first:border-l-0">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
        <span>{label}</span>
        <Info aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />
      </div>
      <div className="mt-3 text-2xl font-black leading-none tracking-tight text-slate-950">{value}</div>
      <div className="mt-3 flex items-center gap-1.5 text-xs">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${pending ? "bg-orange-500" : "bg-blue-500"}`} />
        <span className={pending ? "font-semibold text-slate-600" : "font-bold text-blue-700"}>{sub}</span>
        <span className="truncate text-slate-500">{comparison}</span>
      </div>
    </div>
  );
}

function GoalProgressCard({ goal, currentValue }) {
  const target = Number(goal.target_value || 0);
  const current = Number(currentValue || 0);
  const progress = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const gap = Math.max(target - current, 0);
  const days = goal.deadline
    ? Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const achieved = progress >= 100;
  const moneyGoal = goal.metric_type.includes("revenue") || goal.metric_type === "average_project_value";
  const formatValue = moneyGoal ? money : (value) => int(value);

  return (
    <div className="rounded-lg border border-slate-100 bg-white p-1">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-bold text-slate-950">{goal.name || goal.metric_label}</div>
          <div className="mt-1 text-xs font-semibold text-slate-500">
            {achieved ? "Achieved" : days === null ? "Active goal" : `${Math.max(days, 0)} days remaining`}
          </div>
        </div>
        <div className="text-right text-sm font-bold text-slate-700">{formatValue(current)} of {formatValue(target)}</div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.max(4, progress)}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="font-bold text-emerald-600">{Math.round(progress)}%</span>
        <span className="text-slate-500">{!achieved ? `${formatValue(gap)} remaining` : "Goal reached"}</span>
      </div>
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
                    <td className="py-3 pr-3 text-slate-700">{row.milestone_title || "---"}</td>
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
                        <span className="text-xs text-slate-400">---</span>
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
                        <span className="text-xs text-slate-400">---</span>
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
                        <span className="text-xs text-slate-400">---</span>
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
                  <td className="py-3 pr-3 text-slate-700">{row.completion_date || "---"}</td>
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
                      <span className="text-xs text-slate-400">---</span>
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
  const [range, setRange] = useState("30"); // backend supports: 30 | 90 | ytd | all
  const [activeBusinessView, setActiveBusinessView] = useState("scorecard");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [goals, setGoals] = useState([]);
  const [goalsLoading, setGoalsLoading] = useState(true);
  const [visibleWidgetsByView, setVisibleWidgetsByView] = useState(VIEW_WIDGET_DEFAULTS);
  const [periodByView, setPeriodByView] = useState(() =>
    Object.fromEntries(INSIGHTS_VIEWS.map((view) => [view.key, view.defaultPeriod]))
  );
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [goalEditorOpen, setGoalEditorOpen] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState(null);
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalForm, setGoalForm] = useState({
    metric_type: "monthly_revenue",
    name: "",
    target_value: "",
    deadline: "",
  });
  const [reportChartMetric, setReportChartMetric] = useState("revenue");
  const [reportChartType, setReportChartType] = useState("area");

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
  const recentFinancialEvents = payload?.recent_financial_events || [];
  const activeWorkAvailable = Array.isArray(payload?.active_work);
  const activeWork = activeWorkAvailable ? payload.active_work : [];
  const payoutSeries = payload?.payout_series || [];
  const workflowSeries = payload?.workflow_series || [];
  const feeSummary = payload?.fee_summary || {};
  const workflowSummary = payload?.workflow_summary || {};
  const progressSummary = payload?.progress_summary || {};
  const businessPerformance = payload?.business_performance || {};
  const commandCenter = payload?.command_center || {};
  const businessHealth = commandCenter?.business_health || {};
  const healthDimensions = Array.isArray(businessHealth?.dimensions) ? businessHealth.dimensions : [];
  const needsAttention = Array.isArray(commandCenter?.needs_attention) ? commandCenter.needs_attention : [];
  const canonicalMetrics = commandCenter?.metrics || {};
  const unhealthyDimensions = healthDimensions.filter((dimension) => dimension.status && dimension.status !== "Healthy");
  const displayedHealthDimensions = (unhealthyDimensions.length ? unhealthyDimensions : healthDimensions).slice(0, 3);
  const topNeedsAttention = needsAttention.slice(0, 3);
  const executivePriority = topNeedsAttention[0] || null;
  const executivePositiveSignals = [
    Number(snapshot.total_revenue || financialSummary.gross_revenue_total || 0) > 0
      ? { key: "revenue", title: "Revenue is moving", detail: "Collected revenue is recorded in the selected period." }
      : null,
    Number(financialSummary.paid_events_count || 0) > 0
      ? { key: "payments", title: "Payments are settling", detail: `${int(financialSummary.paid_events_count)} paid event${Number(financialSummary.paid_events_count) === 1 ? "" : "s"} recorded.` }
      : null,
    Number(snapshot.jobs_completed || 0) > 0
      ? { key: "projects", title: "Projects are progressing", detail: `${int(snapshot.jobs_completed)} completed project${Number(snapshot.jobs_completed) === 1 ? "" : "s"} in this period.` }
      : null,
    Number(canonicalMetrics.resolution_cases?.value || 0) === 0
      ? { key: "resolution", title: "No open resolution cases", detail: "No active resolution pressure is recorded." }
      : null,
    Number(canonicalMetrics.warranty_requests?.value || 0) === 0
      ? { key: "warranty", title: "No urgent warranty pressure", detail: "No warranty requests currently need review." }
      : null,
  ].filter(Boolean).slice(0, 3);
  const activeViewConfig = VIEW_BY_ID[activeBusinessView] || VIEW_BY_ID.scorecard;
  const activeVisibleWidgetIds = visibleWidgetsByView[activeBusinessView] || VIEW_WIDGET_DEFAULTS[activeBusinessView] || DEFAULT_INSIGHTS_WIDGETS;
  const activeWidgetCatalog = WIDGET_CATALOG_BY_VIEW[activeBusinessView] || WIDGET_CATALOG_BY_VIEW.scorecard;
  const viewHas = (widgetId) => activeVisibleWidgetIds.includes(widgetId);
  const activeGoals = goals.filter((goal) => goal.is_active);
  const goalCurrentValues = useMemo(() => ({
    monthly_revenue: Number(snapshot.total_revenue || financialSummary.gross_revenue_total || canonicalMetrics.revenue?.value || 0),
    annual_revenue: Number(snapshot.total_revenue || financialSummary.gross_revenue_total || canonicalMetrics.revenue?.value || 0),
    projects_completed: Number(snapshot.jobs_completed || 0),
    average_project_value: Number(businessPerformance?.revenue?.average_project_value || snapshot.avg_revenue_per_job || 0),
    estimate_acceptance_rate: Number(businessPerformance?.conversion_rates?.bid_to_award_rate || 0),
  }), [businessPerformance, canonicalMetrics.revenue?.value, financialSummary.gross_revenue_total, snapshot]);
  const goalsByMetric = useMemo(() => {
    const map = {};
    activeGoals.forEach((goal) => {
      if (!map[goal.metric_type]) map[goal.metric_type] = goal;
    });
    return map;
  }, [activeGoals]);
  const snapshotCards = useMemo(() => [
    {
      key: "revenue",
      label: "Revenue",
      value: money(snapshot.total_revenue || financialSummary.gross_revenue_total || canonicalMetrics.revenue?.value || 0),
      sub: "Current",
      comparison: "selected period",
      trend: "neutral",
      goal: goalsByMetric.monthly_revenue ? money(goalsByMetric.monthly_revenue.target_value) : null,
      currentValue: snapshot.total_revenue || financialSummary.gross_revenue_total || canonicalMetrics.revenue?.value || 0,
      goalValue: goalsByMetric.monthly_revenue?.target_value,
    },
    {
      key: "net_paid",
      label: "Contractor Earnings",
      value: money(financialSummary.net_paid_total || canonicalMetrics.net_paid?.value || 0),
      sub: "Current",
      comparison: "selected period",
      trend: "neutral",
      currentValue: financialSummary.net_paid_total || canonicalMetrics.net_paid?.value || 0,
      goalValue: goalsByMetric.monthly_revenue?.target_value,
    },
    {
      key: "completed",
      label: "Projects Completed",
      value: int(snapshot.jobs_completed || 0),
      sub: "Current",
      comparison: "selected period",
      trend: "neutral",
      goal: goalsByMetric.projects_completed ? int(goalsByMetric.projects_completed.target_value) : null,
      currentValue: snapshot.jobs_completed || 0,
      goalValue: goalsByMetric.projects_completed?.target_value,
    },
    {
      key: "average_value",
      label: "Average Project Value",
      value: money(businessPerformance?.revenue?.average_project_value || snapshot.avg_revenue_per_job || 0),
      sub: "Current",
      comparison: "selected period",
      trend: "neutral",
      goal: goalsByMetric.average_project_value ? money(goalsByMetric.average_project_value.target_value) : null,
      currentValue: businessPerformance?.revenue?.average_project_value || snapshot.avg_revenue_per_job || 0,
      goalValue: goalsByMetric.average_project_value?.target_value,
    },
    {
      key: "estimate_acceptance",
      label: "Estimate Acceptance",
      value: pct(businessPerformance?.conversion_rates?.bid_to_award_rate || 0),
      sub: "Funnel",
      comparison: "selected period",
      trend: "neutral",
      goal: goalsByMetric.estimate_acceptance_rate ? pct(goalsByMetric.estimate_acceptance_rate.target_value) : null,
      currentValue: businessPerformance?.conversion_rates?.bid_to_award_rate || 0,
      goalValue: goalsByMetric.estimate_acceptance_rate?.target_value,
    },
    {
      key: "review_rating",
      label: "Review Rating",
      value: (
        <span className="inline-flex items-center gap-1">
          <span>-</span>
          <Star aria-hidden="true" className="h-6 w-6 fill-amber-400 text-amber-400" />
        </span>
      ),
      sub: "Pending",
      comparison: "review data pending",
      trend: "neutral",
      goal: null,
      currentValue: 0,
      goalValue: null,
    },
  ], [businessPerformance, canonicalMetrics, financialSummary, goalsByMetric, snapshot]);
  const funnel = businessPerformance?.funnel || {};
  const conversionRates = businessPerformance?.conversion_rates || {};
  const revenueMetrics = businessPerformance?.revenue || {};
  const rangeLabel =
    range === "30"
      ? "This month"
      : range === "90"
        ? "This quarter"
        : range === "all"
          ? "All time"
          : range === "ytd"
            ? "Year to date"
            : `Last ${range} days`;
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
        description: "Resolution cases or holds that need a closer look.",
        href: "/app/resolution",
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
        href: "/app/payments?money_status=payment_pending",
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
        href: "/app/opportunities",
        tone: quoteFollowUpCount > 0 ? "info" : "default",
      },
      {
        key: "open-resolution-cases",
        label: "Open resolution cases",
        count: openDisputesCount,
        description: "Cases that need review before they affect trust or cash.",
        href: "/app/resolution",
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
        label: "Money Waiting On Customer Approval",
        value: money(financialSummary.pending_release_total),
        sub: "Approved or ready but not yet released",
        tone: Number(financialSummary.pending_release_total || 0) > 0 ? "warn" : "default",
      },
      {
        key: "on-hold-total",
        label: "Money On Hold",
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
    () =>
      INSIGHTS_VIEWS.map((view) => {
        const previews = {
          scorecard: `${(visibleWidgetsByView.scorecard || DEFAULT_INSIGHTS_WIDGETS).length} visible insights | ${activeGoals.length} goals`,
          executive: `${topAlertCards.length} alerts | ${kpiCards.length} KPIs`,
          benchmarks: `${availableInsightFamilies.length || 0} insight families`,
          financial: `${Object.keys(chartTitles).length} charts | cash flow`,
          operations: `${operationalHealthCards.filter((card) => Number(card.count || 0) > 0).length} action items`,
          "reports-trends": `${Object.keys(chartTitles).length} charts | exports`,
          payouts: `${payoutSummary?.record_count ?? payoutRows.length} payout records`,
        };
        return {
          ...view,
          preview: previews[view.key] || "",
        };
      }),
    [
      availableInsightFamilies.length,
      activeGoals.length,
      chartTitles,
      kpiCards.length,
      operationalHealthCards,
      payoutRows.length,
      payoutSummary?.record_count,
      topAlertCards.length,
      visibleWidgetsByView.scorecard,
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

  const fetchInsightsPreferences = async () => {
    try {
      const { data } = await api.get("/projects/business/contractor/insights-preferences/");
      const nextVisibleByView = { ...VIEW_WIDGET_DEFAULTS };
      const nextPeriodByView = Object.fromEntries(INSIGHTS_VIEWS.map((view) => [view.key, view.defaultPeriod]));
      Object.entries(data?.view_preferences || {}).forEach(([viewId, pref]) => {
        if (!VIEW_WIDGET_DEFAULTS[viewId]) return;
        if (Array.isArray(pref?.visible_widget_ids) && pref.visible_widget_ids.length) {
          nextVisibleByView[viewId] = pref.visible_widget_ids;
        }
        if (pref?.default_reporting_period) {
          nextPeriodByView[viewId] = pref.default_reporting_period;
        }
      });
      if (Array.isArray(data?.visible_widget_ids) && data.visible_widget_ids.length) {
        nextVisibleByView.scorecard = data.visible_widget_ids;
      }
      if (data?.default_reporting_period) {
        nextPeriodByView.scorecard = data.default_reporting_period;
      }
      setVisibleWidgetsByView(nextVisibleByView);
      setPeriodByView(nextPeriodByView);
      const nextPeriod = nextPeriodByView[activeBusinessView] || activeViewConfig.defaultPeriod || "30";
      if (nextPeriod !== range) setRange(nextPeriod);
    } catch (err) {
      setVisibleWidgetsByView(VIEW_WIDGET_DEFAULTS);
    }
  };

  const fetchInsightsGoals = async () => {
    setGoalsLoading(true);
    try {
      const { data } = await api.get("/projects/business/contractor/insights-goals/");
      setGoals(Array.isArray(data?.results) ? data.results : []);
    } catch (err) {
      setGoals([]);
    } finally {
      setGoalsLoading(false);
    }
  };

  const saveInsightsPreferences = async (nextVisible = activeVisibleWidgetIds, nextPeriod = range, viewId = activeBusinessView) => {
    setVisibleWidgetsByView((prev) => ({ ...prev, [viewId]: nextVisible }));
    setPeriodByView((prev) => ({ ...prev, [viewId]: nextPeriod }));
    try {
      const { data } = await api.patch("/projects/business/contractor/insights-preferences/", {
        view_id: viewId,
        visible_widget_ids: nextVisible,
        default_reporting_period: nextPeriod,
      });
      const savedView = data?.view_preferences?.[viewId];
      if (Array.isArray(savedView?.visible_widget_ids)) {
        setVisibleWidgetsByView((prev) => ({ ...prev, [viewId]: savedView.visible_widget_ids }));
      }
    } catch (err) {
      console.error("Failed to save Insights preferences:", err);
    }
  };

  const openGoalEditor = (goal = null) => {
    setEditingGoalId(goal?.id || null);
    setGoalForm({
      metric_type: goal?.metric_type || "monthly_revenue",
      name: goal?.name || "",
      target_value: goal?.target_value || "",
      deadline: goal?.deadline || "",
    });
    setGoalEditorOpen(true);
  };

  const saveGoal = async (event) => {
    event.preventDefault();
    setGoalSaving(true);
    try {
      const payload = {
        metric_type: goalForm.metric_type,
        name: goalForm.name,
        target_value: goalForm.target_value,
        deadline: goalForm.deadline || null,
        is_active: true,
      };
      if (editingGoalId) {
        const { data } = await api.patch(`/projects/business/contractor/insights-goals/${editingGoalId}/`, payload);
        setGoals((rows) => rows.map((row) => (row.id === editingGoalId ? data : row)));
      } else {
        const { data } = await api.post("/projects/business/contractor/insights-goals/", payload);
        setGoals((rows) => [data, ...rows]);
      }
      setGoalEditorOpen(false);
    } catch (err) {
      setError("Failed to save Insights goal.");
    } finally {
      setGoalSaving(false);
    }
  };

  const deactivateGoal = async (goal) => {
    try {
      const { data } = await api.patch(`/projects/business/contractor/insights-goals/${goal.id}/`, { is_active: false });
      setGoals((rows) => rows.map((row) => (row.id === goal.id ? data : row)));
    } catch (err) {
      setError("Failed to update Insights goal.");
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
    fetchInsightsPreferences();
    fetchInsightsGoals();
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
      eyebrow="Insights"
      title="Insights"
      subtitle="Track revenue, payouts, project health, and risks."
      variant="operational"
      className="mhb-insights-workspace"
      contentClassName="space-y-4"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm font-semibold text-slate-700">Date Range</label>
          <div className="relative">
            <CalendarDays aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
          <select
            value={range}
            onChange={(e) => {
              setRange(e.target.value);
              saveInsightsPreferences(activeVisibleWidgetIds, e.target.value, activeBusinessView);
            }}
              className="h-9 appearance-none rounded-md border border-slate-200 bg-white py-1.5 pl-10 pr-9 text-sm font-semibold text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          >
            <option value="30">This Month</option>
            <option value="90">This Quarter</option>
            <option value="ytd">This Year</option>
            <option value="all">All Time</option>
          </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            />
          </div>
          <button
            type="button"
            onClick={() => openGoalEditor()}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            data-testid="insights-set-goal"
          >
            <Target aria-hidden="true" className="h-4 w-4 text-blue-600" />
            Set Goal
          </button>
          <button
            type="button"
            onClick={() => setCustomizeOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700"
            data-testid="insights-customize-open"
            aria-label={`Customize ${activeViewConfig.title}`}
          >
            <Settings aria-hidden="true" className="h-4 w-4" />
            Customize
          </button>

          <button
            onClick={fetchData}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4 text-blue-600" />
            Refresh
          </button>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            aria-label="Notifications"
          >
            <Bell aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      }
    >

      <section
        data-testid="dashboard-view-selector-row"
        className="mb-5 -mx-1 overflow-x-auto px-1 pb-1"
        role="tablist"
        aria-label="Insights dashboard views"
      >
        <div className="flex min-w-max gap-2">
          {businessViewCards.map((card) => (
            <ViewSelectorCard
              key={card.key}
              testId={`dashboard-view-selector-${card.key}`}
              title={card.title}
              icon={card.icon}
              subtitle={card.subtitle}
              preview={card.preview}
              selected={activeBusinessView === card.key}
              onClick={() => {
                setActiveBusinessView(card.key);
                const nextPeriod = periodByView[card.key] || VIEW_BY_ID[card.key]?.defaultPeriod || "30";
                if (nextPeriod !== range) setRange(nextPeriod);
              }}
            />
          ))}
        </div>
      </section>

      <section className="sr-only">
        <div>
          <h2 data-testid="insights-active-view-heading">
            {activeViewConfig.title}
          </h2>
          <p data-testid="insights-active-view-purpose">
            {activeViewConfig.subtitle}
          </p>
        </div>
      </section>

      {activeBusinessView === "scorecard" ? (
        <div data-testid="insights-scorecard" className="space-y-3 rounded-2xl border border-slate-200/90 bg-slate-50/60 p-3 shadow-sm md:p-4">
          {activeVisibleWidgetIds.map((widgetId) => {
            if (widgetId === "business_snapshot") {
              return (
                <section key={widgetId} data-testid="insights-business-snapshot" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-slate-950">Business Snapshot</h2>
                      <p className="sr-only">
                        Paid revenue, project value, and funnel metrics from the selected reporting period.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveBusinessView("reports-trends");
                        const nextPeriod = periodByView["reports-trends"] || VIEW_BY_ID["reports-trends"].defaultPeriod;
                        if (nextPeriod !== range) setRange(nextPeriod);
                      }}
                      className="inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-800"
                    >
                      View all metrics
                      <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-5 grid gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                    {snapshotCards.map((card) => (
                      <ScorecardMetric key={card.key} {...card} />
                    ))}
                  </div>
                </section>
              );
            }
            if (widgetId === "goal_progress") {
              return (
                <section key={widgetId} data-testid="insights-goal-progress" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-slate-950">Goal Progress</h2>
                    </div>
                    <button type="button" onClick={() => openGoalEditor()} className="inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-800">
                      Manage Goals
                      <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                  {goalsLoading ? (
                    <div className="mt-4 text-sm text-slate-500">Loading goals...</div>
                  ) : activeGoals.length === 0 ? (
                    <div data-testid="insights-goal-empty" className="mt-4 flex flex-col gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <Target aria-hidden="true" className="h-5 w-5 shrink-0 text-blue-600" />
                        <div><div className="font-bold text-slate-950">Goal tracking starts with your first goal</div><div className="mt-0.5">Set a target to measure progress against current business results.</div></div>
                      </div>
                      <button
                        type="button"
                        onClick={() => openGoalEditor()}
                        className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-blue-500 bg-white px-4 text-sm font-bold text-blue-700 hover:bg-blue-50"
                      >
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-blue-600 text-lg leading-none">+</span>
                        Set Your First Goal
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-5 lg:grid-cols-2">
                      {activeGoals.map((goal) => (
                        <div key={goal.id} className="space-y-2">
                          <GoalProgressCard goal={goal} currentValue={goalCurrentValues[goal.metric_type]} />
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => openGoalEditor(goal)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                              Edit Goal
                            </button>
                            <button type="button" onClick={() => deactivateGoal(goal)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                              Deactivate
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            }
            if (widgetId === "primary_trend") {
              return (
                <section key={widgetId} data-testid="insights-primary-trend" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-slate-950">Performance Trend</h2>
                      <select
                        value="revenue"
                        onChange={() => {}}
                        className="mt-4 h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 shadow-sm outline-none"
                        aria-label="Primary trend metric"
                      >
                        <option value="revenue">Revenue</option>
                      </select>
                    </div>
                    <MoreVertical aria-hidden="true" className="h-5 w-5 text-slate-500" />
                  </div>
                  <div className="mt-4">
                    <div className="text-3xl font-black leading-none text-slate-950">
                      {money(snapshot.total_revenue || financialSummary.gross_revenue_total || canonicalMetrics.revenue?.value || 0)}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-sm">
                      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-blue-500" />
                      <span className="font-bold text-blue-700">Current</span>
                      <span className="text-slate-500">selected period</span>
                    </div>
                  </div>
                  <div className="mt-3">
                    {revenueChart.length >= 2 && hasSeriesValue(revenueChart, ["revenue"]) ? (
                      <div className={revenueChart.length >= 5 ? "h-72" : "h-44"} data-testid={revenueChart.length >= 5 ? "insights-trend-full-chart" : "insights-trend-mini-chart"}>
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={revenueChart}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--mhb-chart-grid)" />
                            <XAxis dataKey="bucket_label" stroke="var(--mhb-chart-text)" />
                            <YAxis tickFormatter={axisMoney} stroke="var(--mhb-chart-text)" />
                            <Tooltip formatter={(value) => money(value)} />
                            <Area type="monotone" dataKey="revenue" stroke="var(--mhb-chart-neutral)" fill="var(--mhb-chart-neutral)" fillOpacity={0.18} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div data-testid="insights-trend-education" className="mt-5 grid items-center gap-5 rounded-xl bg-gradient-to-r from-blue-50/80 to-slate-50 px-5 py-5 md:grid-cols-[minmax(180px,0.65fr)_1fr]">
                        <div className="flex justify-center"><div className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-100/70"><BarChart3 aria-hidden="true" className="h-9 w-9 text-blue-600" /></div></div>
                        <div><div className="font-bold text-slate-950">{revenueChart.length === 0 ? "Revenue history will appear here" : "Your revenue trend is taking shape"}</div><div className="mt-1 text-sm leading-6 text-slate-600">{revenueChart.length === 0 ? "Paid invoices populate revenue history for the selected period." : "Revenue trends appear after paid invoices are recorded across multiple periods."}</div></div>
                      </div>
                    )}
                  </div>
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveBusinessView("reports-trends");
                        const nextPeriod = periodByView["reports-trends"] || VIEW_BY_ID["reports-trends"].defaultPeriod;
                        if (nextPeriod !== range) setRange(nextPeriod);
                      }}
                      className="inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-800"
                    >
                      View in Reports & Trends
                      <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                </section>
              );
            }
            if (widgetId === "needs_attention") {
              return (
                <section key={widgetId} data-testid="insights-needs-attention" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-slate-950">Needs Attention</h2>
                      <p className="sr-only">Limited to the most actionable records from source workspaces.</p>
                    </div>
                    <button type="button" className="inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-800">
                      View all
                      <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                  {topNeedsAttention.length === 0 ? (
                    <div className="mt-3 flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      <Info aria-hidden="true" className="h-5 w-5 text-emerald-600" />
                      <div><span className="font-bold text-slate-950">Nothing needs immediate attention.</span> New approval, milestone, warranty, and payment issues will appear here.</div>
                    </div>
                  ) : (
                    <ul className="mt-4 divide-y divide-slate-200" aria-label="Needs attention items">
                      {topNeedsAttention.map((item) => (
                        <li key={item.key} data-testid={`insights-attention-row-${item.key}`}>
                        <a href={item.open_url} className="grid gap-3 py-4 text-slate-900 transition hover:bg-slate-50 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                          <div className={`flex h-9 w-9 items-center justify-center rounded-full border ${
                            item.severity === "high"
                              ? "border-red-500 text-red-600"
                              : item.severity === "medium"
                                ? "border-orange-500 text-orange-600"
                                : "border-blue-500 text-blue-600"
                          }`}>
                            {item.severity === "high" ? (
                              <CircleDollarSign aria-hidden="true" className="h-5 w-5" />
                            ) : item.severity === "medium" ? (
                              <Clock3 aria-hidden="true" className="h-5 w-5" />
                            ) : (
                              <TriangleAlert aria-hidden="true" className="h-5 w-5" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-bold text-slate-950">{item.title}</span>
                            </div>
                            <div className="mt-1 line-clamp-2 text-sm text-slate-500">{item.why}</div>
                          </div>
                          <ChevronRight aria-hidden="true" className="h-5 w-5 text-slate-500" />
                        </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            }
            if (widgetId === "reports_handoff") {
              return (
                <section key={widgetId} data-testid="insights-reports-handoff" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:px-6 md:py-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                        <BarChart3 aria-hidden="true" className="h-6 w-6" />
                      </div>
                      <div>
                        <h2 className="text-base font-bold text-slate-950">Explore deeper insights</h2>
                        <p className="mt-0.5 text-sm text-slate-600">Dive into detailed reports, charts, performance by category, exports, and more.</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveBusinessView("reports-trends");
                        const nextPeriod = periodByView["reports-trends"] || VIEW_BY_ID["reports-trends"].defaultPeriod;
                        if (nextPeriod !== range) setRange(nextPeriod);
                      }}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-900 hover:bg-slate-50"
                      data-testid="insights-open-reports"
                    >
                      Go to Reports & Trends
                      <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                </section>
              );
            }
            return (
              <section key={widgetId} data-testid={`insights-optional-${widgetId}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-4">
                <h2 className="text-lg font-bold text-slate-950">{widgetLabel(widgetId)}</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">Optional scorecard signal backed by existing Insights data. Open Reports & Trends for the detailed breakdown.</p>
              </section>
            );
          })}
        </div>
      ) : null}

      {activeBusinessView === "executive" ? (
        <div data-testid="insights-executive-workspace" className="space-y-3 rounded-2xl border border-slate-200/90 bg-slate-50/60 p-3 shadow-sm md:p-4">
          <section className="grid rounded-xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[280px_1fr]">
            {viewHas("business_health") ? (
              <div data-testid="insights-business-health" className="p-6 lg:border-r lg:border-slate-200">
                <h2 className="text-xl font-bold text-slate-950">Business Health</h2>
                <div className="relative mx-auto mt-5 h-28 w-52 overflow-hidden">
                  <svg viewBox="0 0 200 110" className="h-full w-full" aria-hidden="true">
                    <path d="M20 96 A80 80 0 0 1 180 96" fill="none" stroke="var(--mhb-chart-grid)" strokeWidth="11" strokeLinecap="round" />
                    <path d="M20 96 A80 80 0 0 1 180 96" fill="none" stroke={businessHealth.overall === "At Risk" ? "#dc2626" : businessHealth.overall === "Needs Attention" ? "#d97706" : "#16a34a"} strokeWidth="11" strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-x-0 bottom-0 text-center text-3xl font-black text-slate-950">{businessHealth.overall || "Insufficient data"}</div>
                </div>
                <p className="mt-4 text-center text-sm font-semibold text-slate-800">{businessHealth.recommended_focus || businessHealth.summary || "Business health is still being established."}</p>
                <div className="mt-5 space-y-2">
                  {displayedHealthDimensions.slice(0, 3).map((dimension) => (
                    <div key={dimension.key} className="flex items-center gap-2 text-sm text-slate-600"><span className={dimension.status === "At Risk" ? "text-red-600" : dimension.status === "Needs Attention" ? "text-amber-600" : "text-emerald-600"}>●</span><span>{dimension.label}: {dimension.status}</span></div>
                  ))}
                </div>
              </div>
            ) : null}

            {viewHas("executive_scorecard") ? (
              <div data-testid="insights-canonical-metrics" className="p-6">
                <h2 className="text-xl font-bold text-slate-950">Executive Scorecard</h2>
                <div className="mt-7 grid sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ["Revenue", money(snapshot.total_revenue || financialSummary.gross_revenue_total || canonicalMetrics.revenue?.value || 0), "Current selected period"],
                    ["Contractor Earnings", money(financialSummary.net_paid_total || canonicalMetrics.net_paid?.value || 0), "Current selected period"],
                    ["Projects Completed", int(snapshot.jobs_completed || 0), "Current selected period"],
                    ["Review Rating", "Pending", "Review data unavailable"],
                  ].map(([label, value, detail]) => (
                    <div key={label} data-testid={`insights-executive-metric-${label.toLowerCase().replaceAll(" ", "-")}`} className="border-l border-slate-200 px-5 py-2 first:border-l-0">
                      <div className="text-sm font-semibold text-slate-600">{label}</div>
                      <div className="mt-3 text-2xl font-black text-slate-950">{value}</div>
                      <div className="mt-2 text-xs text-slate-500">{detail}</div>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setActiveBusinessView("scorecard")} className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-800">View full scorecard <ArrowRight aria-hidden="true" className="h-4 w-4" /></button>
              </div>
            ) : null}
          </section>

          {viewHas("morning_brief") || viewHas("business_alerts") ? (
            <div className="grid gap-3 lg:grid-cols-2">
              <section data-testid="insights-morning-brief" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-bold text-slate-950">Morning Brief</h2>
                <p className="mt-1 text-sm text-slate-500">Your top priorities this morning.</p>
                {topNeedsAttention.length ? (
                  <ul className="mt-5 divide-y divide-slate-200">
                    {topNeedsAttention.map((item) => (
                      <li key={item.key} data-testid={`insights-executive-brief-${item.key}`}><a href={item.open_url} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-4 hover:bg-slate-50"><span className={`flex h-8 w-8 items-center justify-center rounded-full border ${item.severity === "high" ? "border-red-200 text-red-600" : "border-amber-200 text-amber-600"}`}><TriangleAlert aria-hidden="true" className="h-4 w-4" /></span><span><span className="block text-sm font-bold text-slate-950">{item.title}</span><span className="mt-1 block text-sm text-slate-500">{item.why}</span></span><ChevronRight aria-hidden="true" className="h-5 w-5 text-slate-400" /></a></li>
                    ))}
                  </ul>
                ) : <div className="mt-5 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">No urgent priorities this morning.</div>}
              </section>

              <section data-testid="insights-whats-working" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-bold text-slate-950">What&apos;s Working</h2>
                <p className="mt-1 text-sm text-slate-500">Recent positive momentum.</p>
                {executivePositiveSignals.length ? <ul className="mt-5 space-y-1">{executivePositiveSignals.map((signal) => <li key={signal.key} data-testid={`insights-positive-${signal.key}`} className="flex gap-3 py-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 font-bold text-emerald-600">✓</span><span><span className="block text-sm font-bold text-slate-950">{signal.title}</span><span className="mt-1 block text-sm text-slate-500">{signal.detail}</span></span></li>)}</ul> : <div className="mt-5 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">More completed activity will reveal positive business trends.</div>}
              </section>
            </div>
          ) : null}

          <section data-testid="insights-top-priority" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-950">Top Priority</h2>
            <p className="mt-1 text-sm text-slate-500">Focus on the action that will have the greatest impact.</p>
            {executivePriority ? <div className="mt-5 flex flex-col gap-5 md:flex-row md:items-center"><div className="flex min-w-0 flex-1 items-start gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700"><BarChart3 aria-hidden="true" className="h-5 w-5" /></span><div><h3 className="font-bold text-slate-950">{executivePriority.title}</h3><p className="mt-1 text-sm text-slate-600">{executivePriority.why}</p></div></div><div className="border-l border-slate-200 pl-5"><div className="text-xs font-semibold text-slate-500">Impact</div><div className="mt-1 font-bold text-slate-950">High operational impact</div></div><a href={executivePriority.open_url} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-blue-500 px-4 text-sm font-bold text-blue-700 hover:bg-blue-50">{executivePriority.source_workspace ? `Open ${executivePriority.source_workspace}` : executivePriority.action_label || "Open source records"}<ArrowRight aria-hidden="true" className="h-4 w-4" /></a></div> : <div className="mt-5 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">No urgent priority is supported by current records.</div>}
          </section>

          <section data-testid="insights-executive-reports-handoff" className="rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><FileBarChart2 aria-hidden="true" className="h-5 w-5" /></span><div><h2 className="font-bold text-slate-950">Explore deeper insights</h2><p className="mt-0.5 text-sm text-slate-500">Dive into detailed reports, charts, performance by category, exports, and more.</p></div></div><button type="button" onClick={() => setActiveBusinessView("reports-trends")} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-900 hover:bg-slate-50">Go to Reports & Trends <ArrowRight aria-hidden="true" className="h-4 w-4" /></button></div></section>
        </div>
      ) : null}

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
              href="/app/payments?money_status=payment_pending"
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

          <ContractorInsightsSection
            insights={contractorInsights}
            availableFamilies={availableInsightFamilies}
            selectedFamilyKey={insightFamilyKey}
            onFamilyChange={handleFamilyChange}
          />
        </div>
      ) : null}

      {activeBusinessView === "financial" ? (
        <div data-testid="dashboard-view-financial" className="space-y-3">
          <section data-testid="dashboard-financial-section" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-lg font-bold text-slate-950">Financial Snapshot</h2><p className="mt-1 text-sm text-slate-500">{rangeLabel}</p></div><button type="button" onClick={() => setActiveBusinessView("reports-trends")} className="inline-flex items-center gap-2 text-sm font-bold text-blue-700">View Financial Report <ArrowRight aria-hidden="true" className="h-4 w-4" /></button></div>
            <div className="mt-5 grid divide-y divide-slate-200 border-y border-slate-200 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-5">
              {[
                ["Revenue Collected", money(financialSummary.gross_revenue_total || snapshot.total_revenue), "Paid invoices", "text-slate-950"],
                ["Contractor Earnings", money(financialSummary.net_paid_total || canonicalMetrics.net_paid?.value), "After platform fees; not profit", "text-slate-950"],
                ["Outstanding Invoices", money(canonicalMetrics.outstanding_receivables?.value), "Awaiting customer payment", "text-slate-950"],
                ["Pending Payments", money(financialSummary.pending_release_total || pendingReleaseTotal), `${int(financialSummary.pending_release_count)} pending`, "text-amber-700"],
                ["Money On Hold", money(financialSummary.on_hold_total || canonicalMetrics.held_funds?.value), `${int(financialSummary.on_hold_count)} under review`, "text-red-600"],
              ].map(([label, value, detail, tone]) => <div key={label} className="flex flex-col justify-center px-1 py-3 first:pl-0 sm:px-4 xl:min-h-[108px] last:pr-0"><div className="text-xs font-semibold text-slate-600">{label}</div><div className={`mt-2 text-2xl font-black tabular-nums ${tone}`}>{value}</div><div className="mt-2 text-xs text-slate-500">{detail}</div></div>)}
            </div>
          </section>

          <div className="grid gap-3 xl:grid-cols-[1.45fr_0.75fr]">
            <section data-testid="dashboard-financial-hero" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold text-slate-950">Revenue Overview</h2><p className="mt-1 text-sm text-slate-500">Collected revenue for {rangeLabel.toLowerCase()}.</p>
              {financialTrendChart.length === 0 ? <div data-testid="dashboard-financial-empty" className="mt-4 flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-3"><BarChart3 aria-hidden="true" className="h-6 w-6 shrink-0 text-slate-400" /><div><div className="text-sm font-bold text-slate-900">No completed payments yet</div><div className="mt-0.5 text-sm text-slate-500">Reporting expands as invoices and escrow releases occur.</div></div></div> : financialTrendChart.length === 1 ? <div data-testid="dashboard-financial-current-summary" className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-emerald-50 px-4 py-3"><div className="text-xs font-semibold text-emerald-800">Current Revenue</div><div className="mt-1 text-xl font-black text-emerald-900">{money(financialSummary.gross_revenue_total || snapshot.total_revenue)}</div></div><div className="rounded-lg bg-blue-50 px-4 py-3"><div className="text-xs font-semibold text-blue-800">Current Outstanding</div><div className="mt-1 text-xl font-black text-blue-950">{money(canonicalMetrics.outstanding_receivables?.value)}</div></div><div className="rounded-lg bg-red-50 px-4 py-3"><div className="text-xs font-semibold text-red-700">Current Held</div><div className="mt-1 text-xl font-black text-red-800">{money(financialSummary.on_hold_total || canonicalMetrics.held_funds?.value)}</div></div><p className="sm:col-span-3 text-sm text-slate-500">One reporting period available. More periods will add a trend.</p></div> : <div className={`mt-4 ${financialTrendChart.length < 5 ? "h-40" : "h-64"}`} data-testid={financialTrendChart.length < 5 ? "dashboard-financial-mini-trend" : "dashboard-financial-trend-chart"}><ResponsiveContainer width="100%" height="100%"><BarChart data={financialTrendChart}><CartesianGrid stroke="var(--mhb-chart-grid)" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="bucket_label" stroke="var(--mhb-chart-text)" tick={{ fontSize: 12 }} /><YAxis stroke="var(--mhb-chart-text)" tickFormatter={axisMoney} width={70} hide={financialTrendChart.length < 5} /><Tooltip formatter={(value) => money(value)} /><Bar dataKey="gross_revenue" name="Revenue Collected" fill="var(--mhb-chart-neutral)" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div>}
              <button type="button" onClick={() => setActiveBusinessView("reports-trends")} className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-blue-700">View trend analysis <ArrowRight aria-hidden="true" className="h-4 w-4" /></button>
            </section>

            <section data-testid="dashboard-payment-pipeline" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold text-slate-950">Payment Pipeline</h2><p className="mt-1 text-sm text-slate-500">Settled, waiting, and held.</p><div className="mt-4 divide-y divide-slate-100/70">
              {[
                ["Collected", financialSummary.gross_revenue_total || snapshot.total_revenue, financialSummary.paid_events_count, "bg-emerald-500"],
                ["Waiting Approval", financialSummary.pending_release_total || pendingReleaseTotal, financialSummary.pending_release_count, "bg-amber-400"],
                ["Held", financialSummary.on_hold_total || canonicalMetrics.held_funds?.value, financialSummary.on_hold_count, "bg-red-500"],
              ].map(([label, value, count, color]) => <div key={label} className="flex items-center gap-3 py-3.5 first:pt-0"><span className={`h-2.5 w-2.5 rounded-full ${color}`} /><div className="flex-1 text-sm font-bold text-slate-900">{label}</div><div className="min-w-[110px] text-right"><div className="text-lg font-black tabular-nums text-slate-950">{money(value)}</div><div className="mt-0.5 text-xs text-slate-500">{int(count)} payment{Number(count) === 1 ? "" : "s"}</div></div></div>)}
            </div></section>
          </div>

          <section data-testid="dashboard-accounts-receivable" className="rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-base font-bold text-slate-950">Outstanding Receivables</h2><p className="mt-0.5 text-xs text-slate-500">Waiting on customer payment</p></div><div className="text-left sm:text-right"><div className="text-2xl font-black tabular-nums text-slate-950">{money(canonicalMetrics.outstanding_receivables?.value)}</div><div className="text-xs text-slate-500">Invoices and submitted draws</div></div></div></section>

          <div className="grid gap-3 xl:grid-cols-2">
            <section data-testid="dashboard-recent-financial-activity" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-bold text-slate-950">Recent Financial Activity</h2>{recentFinancialEvents.length ? <div className="mt-3 overflow-x-auto"><table className="min-w-[560px] w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Description</th><th className="py-2 pr-3">Amount</th><th className="py-2">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{recentFinancialEvents.slice(0, 5).map((event) => <tr key={event.id}><td className="py-2 pr-3 text-slate-500">{formatDateTime(event.activity_at)}</td><td className="py-2 pr-3"><div className="font-semibold text-slate-900">{event.agreement_title}</div><div className="text-xs text-slate-500">{event.record_type}</div></td><td className="py-2 pr-3 font-semibold tabular-nums text-slate-900">{money(event.gross_amount)}</td><td className="py-2 capitalize text-slate-600">{event.status}</td></tr>)}</tbody></table></div> : <div className="mt-3 flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-3"><WalletCards aria-hidden="true" className="h-7 w-7 shrink-0 text-slate-400" /><div><div className="text-sm font-bold text-slate-900">No completed payments yet</div><div className="mt-0.5 text-xs text-slate-500">Activity appears as invoices and escrow releases settle.</div></div></div>}<a href="/app/payments" className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-blue-700">View all transactions <ArrowRight aria-hidden="true" className="h-4 w-4" /></a></section>

            <section data-testid="dashboard-financial-insights-section" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-bold text-slate-950">Financial Insights</h2><div className="mt-3 divide-y divide-slate-100">{(financialInsights.length ? financialInsights : [
              { title: "Payments recorded", explanation: `${int(financialSummary.paid_events_count)} settled payment event${Number(financialSummary.paid_events_count) === 1 ? "" : "s"} in this period.`, severity: "low" },
              { title: "Funds waiting", explanation: `${money(financialSummary.pending_release_total)} is waiting for release.`, severity: "medium" },
              { title: "Platform fees", explanation: `${money(financialSummary.platform_fees_total || snapshot.platform_fees_paid)} in platform fees was recorded.`, severity: "low" },
            ]).slice(0, 3).map((insight, index) => <div key={`${insight.title}-${index}`} data-testid={`dashboard-financial-insight-${index}`} className="flex items-center gap-3 py-3 first:pt-0"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${insight.severity === "high" ? "bg-red-50 text-red-600" : insight.severity === "medium" ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"}`}><CircleDollarSign aria-hidden="true" className="h-4 w-4" /></span><div className="min-w-0 flex-1"><div className="text-sm font-bold text-slate-900">{insight.title}</div><div className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500">{insight.explanation}</div></div><ChevronRight aria-hidden="true" className="h-4 w-4 text-slate-400" /></div>)}</div></section>
          </div>

          <section data-testid="dashboard-financial-reports-handoff" className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><FileBarChart2 aria-hidden="true" className="h-5 w-5" /></span><div><h2 className="font-bold text-slate-950">Explore deeper insights</h2><p className="mt-0.5 text-sm text-slate-500">Detailed reports, cash flow, fees, and exports.</p></div></div><button type="button" onClick={() => setActiveBusinessView("reports-trends")} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-blue-500 px-4 text-sm font-bold text-blue-700 hover:bg-blue-50">Go to Reports & Trends <ArrowRight aria-hidden="true" className="h-4 w-4" /></button></div></section>
        </div>
      ) : null}

      {activeBusinessView === "operations" ? (
        <div data-testid="dashboard-view-operations" className="space-y-3">
          <section data-testid="insights-operations-waiting-queue" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-950">Waiting Queue</h2><p className="mt-1 text-sm text-slate-500">Items that need attention.</p></div><a href="/app/business" className="inline-flex shrink-0 items-center gap-2 text-sm font-bold text-blue-700">View all queues <ArrowRight aria-hidden="true" className="h-4 w-4" /></a></div><div className="mt-3 overflow-x-auto pb-1"><div className="grid min-w-[850px] grid-cols-5 gap-2">
            {[
              ["customer-approval", "Customer Approval", pendingReleaseCount, "/app/payments?money_status=payment_pending", CircleDollarSign, "bg-emerald-50 text-emerald-700"],
              ["signatures", "Signatures", unsignedAgreementCount, "/app/agreements?status=awaiting_signature", FileText, "bg-amber-50 text-amber-700"],
              ["reviews", "Awaiting Review", overdueMilestoneCount, "/app/reviewer/queue", Star, "bg-blue-50 text-blue-700"],
              ["warranty", "Warranty", Number(canonicalMetrics.warranty_requests?.value || 0), "/app/warranty", Info, "bg-violet-50 text-violet-700"],
              ["resolution", "Resolution", Number(canonicalMetrics.resolution_cases?.value || openDisputesCount), "/app/resolution", TriangleAlert, "bg-red-50 text-red-600"],
            ].map(([key, label, count, href, Icon, tone]) => <a key={key} href={href} data-testid={`insights-operations-queue-${key}`} className="flex min-h-[70px] items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 hover:bg-slate-100"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone}`}><Icon aria-hidden="true" className="h-5 w-5" /></span><span className="min-w-0 flex-1"><strong className="block text-xl font-black leading-none text-slate-950">{int(count)}</strong><span className="mt-1 block whitespace-nowrap text-sm font-bold text-slate-800">{label}</span></span><ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" /></a>)}
          </div></div></section>

          <div className="grid items-start gap-3 xl:grid-cols-[1.55fr_0.75fr]">
            <section data-testid="insights-operations-active-work" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-950">Active Work</h2><p className="mt-1 text-sm text-slate-500">Projects in progress.</p></div><a href="/app/agreements" className="inline-flex shrink-0 items-center gap-2 text-sm font-bold text-blue-700">View all projects <ArrowRight aria-hidden="true" className="h-4 w-4" /></a></div>
              {activeWork.length ? <><div className="mt-4 hidden md:block"><table className="w-full text-left text-sm"><thead className="border-y border-slate-200 bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2">Project</th><th className="px-3 py-2">Stage</th><th className="px-3 py-2">Today&apos;s Task</th><th className="px-3 py-2">Due</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Open</th></tr></thead><tbody className="divide-y divide-slate-100">{activeWork.slice(0, 6).map((row, index) => <tr key={row.id || index}><td className="px-3 py-3 font-bold text-slate-900">{row.project_title || row.title || "Project"}</td><td className="px-3 py-3 text-slate-600">{row.stage || "—"}</td><td className="px-3 py-3 text-slate-700">{row.today_task || "—"}</td><td className="px-3 py-3 text-slate-600">{row.due_date || "—"}</td><td className="px-3 py-3 text-slate-600">{row.status || "Active"}</td><td className="px-3 py-3"><a href={row.open_href || "/app/agreements"} aria-label={`Open ${row.project_title || row.title || "project"}`}><ChevronRight aria-hidden="true" className="h-4 w-4 text-slate-600" /></a></td></tr>)}</tbody></table></div><div className="mt-4 divide-y divide-slate-100 md:hidden">{activeWork.slice(0, 6).map((row, index) => <a key={row.id || index} href={row.open_href || "/app/agreements"} className="block py-4 first:pt-0"><div className="flex items-center justify-between gap-3"><strong className="text-sm text-slate-900">{row.project_title || row.title || "Project"}</strong><ChevronRight aria-hidden="true" className="h-4 w-4 text-slate-500" /></div><div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500"><span>{row.stage || "Stage unavailable"}</span><span className="text-right">{row.due_date || "Due date unavailable"}</span><span className="col-span-2 text-slate-700">{row.today_task || "Today’s task unavailable"}</span></div></a>)}</div></> : <div data-testid={activeWorkAvailable ? "insights-operations-active-no-match" : "insights-operations-active-unavailable"} className="mt-4 rounded-lg bg-slate-50 px-4 py-4"><div className="flex items-start gap-3"><Target aria-hidden="true" className="mt-0.5 h-7 w-7 shrink-0 text-blue-500" /><div><div className="text-sm font-bold text-slate-900">{activeWorkAvailable ? "No active project work matches this date range." : "Project-level active work details are not available yet."}</div><div className="mt-1 text-sm text-slate-500">{activeWorkAvailable ? "Review all projects to find work outside the selected period." : "Use Milestones, Assignments, or Schedule to review current execution."}</div></div></div>{!activeWorkAvailable ? <div className="mt-3 flex flex-wrap gap-3 pl-10"><a href="/app/milestones" className="text-sm font-bold text-blue-700">Review Milestones</a><a href="/app/team" className="text-sm font-bold text-blue-700">Open Assignments</a></div> : null}</div>}
            </section>

            <section data-testid="insights-operations-schedule-health" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-bold text-slate-950">Schedule Health</h2><div className="mt-3 flex items-center gap-3 rounded-lg bg-amber-50 px-3 py-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700"><Clock3 aria-hidden="true" className="h-5 w-5" /></span><div className="min-w-0 flex-1"><div className="text-sm font-bold text-slate-900">Behind</div><div className="mt-0.5 text-xs text-slate-500">Overdue milestones</div></div><div className="text-2xl font-black text-slate-950">{int(overdueMilestoneCount)}</div></div><div data-testid="insights-operations-schedule-unavailable" className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5"><div className="text-xs font-bold text-slate-700">Additional schedule detail unavailable</div><div className="mt-1 text-xs leading-5 text-slate-500">Project-level On Schedule and Ahead status is not included in current Insights data.</div></div><a href="/app/milestones" className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-blue-700">View Schedule Report <ArrowRight aria-hidden="true" className="h-4 w-4" /></a></section>
          </div>

          <section data-testid="insights-operations-daily-focus" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold text-slate-950">Daily Focus</h2><p className="mt-1 text-sm text-slate-500">Your top priority today.</p>{topNeedsAttention.length ? <div className="mt-4 flex flex-col gap-4 rounded-xl bg-emerald-50/70 p-5 sm:flex-row sm:items-center"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Target aria-hidden="true" className="h-6 w-6" /></span><div className="min-w-0 flex-1"><h3 className="text-lg font-black text-emerald-800">{operationsFocusTitle(topNeedsAttention[0])}</h3><p className="mt-1 text-sm text-slate-600">{topNeedsAttention[0].why}</p><div className="mt-3 flex flex-wrap gap-2"><span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${topNeedsAttention[0].severity === "high" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{topNeedsAttention[0].severity === "high" ? "Urgent" : "Needs attention"}</span>{topNeedsAttention[0].source_workspace ? <span className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">{topNeedsAttention[0].source_workspace}</span> : null}</div></div><a href={topNeedsAttention[0].open_url || "/app/agreements"} className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-blue-600 px-6 text-sm font-bold text-white hover:bg-blue-700 sm:w-auto">{operationsActionLabel(topNeedsAttention[0])}</a></div> : <div className="mt-4 flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-4"><Target aria-hidden="true" className="h-8 w-8 text-emerald-600" /><div><div className="font-bold text-emerald-900">No active work requires attention.</div><div className="mt-1 text-sm text-emerald-800">All supported operational signals are clear.</div></div></div>}</section>
        </div>
      ) : null}

      {activeBusinessView === "reports-legacy-disabled" ? (
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
          sub={`Subs ready: ${money(payoutSummary?.total_ready_amount)} -- Escrow: ${money(snapshot.escrow_pending)}`}
          tone={pendingExposure > 0 ? "warn" : "default"}
        />
        <Stat
          label="Resolution / Risk"
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
          sub={`Subs ready: ${money(payoutSummary?.total_ready_amount)} -- Escrow: ${money(snapshot.escrow_pending)}`}
          tone={pendingExposure > 0 ? "warn" : "default"}
        />

        <Stat
          label="Resolution / Risk"
          value={int(snapshot.disputes_open)}
          sub="Active resolution cases and workflow risk"
        />

        <Stat
          label="Escrow Pending"
          value={money(snapshot.escrow_pending)}
          sub="Approved but not released"
          tone={Number(snapshot.escrow_pending || 0) > 0 ? "warn" : "default"}
        />

        <Stat
          label="Open Resolution Cases"
          value={int(snapshot.disputes_open)}
          sub="Cases needing review"
          tone={Number(snapshot.disputes_open || 0) > 0 ? "bad" : "default"}
        />
      </DashboardGrid>
          </DashboardSection>

          <DashboardSection
            title="Full Metric Definitions"
            subtitle="Detailed plain-English metric set used across Insights."
            className="mb-5"
          >
            <section data-testid="insights-canonical-metrics-full" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  "revenue",
                  "net_paid",
                  "pending_release",
                  "held_funds",
                  "outstanding_receivables",
                  "open_projects",
                  "open_opportunities",
                  "estimate_pipeline",
                  "warranty_requests",
                  "resolution_cases",
                  "team_capacity",
                  "customer_requests",
                ].map((key) => (
                  <CanonicalMetricCard key={key} metric={canonicalMetrics[key]} />
                ))}
              </div>
            </section>
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

      {activeBusinessView === "benchmarks" ? (
        <div data-testid="dashboard-view-contractor-insights" className="space-y-5">
          {viewHas("contractor_insights") ? (
          <ContractorInsightsSection
            insights={contractorInsights}
            availableFamilies={availableInsightFamilies}
            selectedFamilyKey={insightFamilyKey}
            onFamilyChange={handleFamilyChange}
            onOpenReports={() => setActiveBusinessView("reports-trends")}
          />
          ) : null}
        </div>
      ) : null}

      {activeBusinessView === "reports-trends" ? (
        <div data-testid="dashboard-view-reports-trends"><ReportsLibrary
            onRunReport={exportDashboardReport}
            revenueSeries={revenueChart}
            workflowSeries={workflowChart}
            snapshot={snapshot}
            businessPerformance={businessPerformance}
            outstandingValue={canonicalMetrics.outstanding_receivables?.value}
          /></div>
      ) : null}

      {activeBusinessView === "reports-library-legacy-disabled" ? (
        <div data-testid="dashboard-view-reports-trends">
          <DashboardSection
            title="Reports & Trends"
            subtitle="Detailed analytics, charts, category tables, and exports."
            className="mb-5 flex flex-col"
          >
      <section data-testid="dashboard-report-controls" className="order-1 mb-5 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-base font-bold text-slate-900">Chart Configuration</div>
            <div className="mt-1 text-sm text-slate-600">
              Choose a supported report chart without changing the underlying calculations.
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Metric</span>
              <select
                data-testid="insights-report-chart-metric"
                value={reportChartMetric}
                onChange={(event) => setReportChartMetric(event.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="revenue">Revenue over time</option>
                <option value="payouts">Payout composition</option>
                <option value="fees">Fee activity</option>
                <option value="workflow">Overdue milestones</option>
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-700">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Chart type</span>
              <select
                data-testid="insights-report-chart-type"
                value={reportChartType}
                onChange={(event) => setReportChartType(event.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="area">Area</option>
                <option value="line">Line</option>
                <option value="bar">Bar</option>
                <option value="stacked_bar">Stacked bar</option>
              </select>
            </label>
          </div>
        </div>
      </section>
      <section className="order-3 mt-5 rounded-xl border border-slate-200 bg-white/95 p-5 shadow-sm">
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
        className="order-4 mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
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
                      <td className="py-3 pr-3 text-slate-700">{row.payment_status || "---"}</td>
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
                          <span className="text-xs text-slate-400">---</span>
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
        className="order-2 border-b border-slate-200 bg-white pb-8"
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
          <div className="xl:col-span-2">
          <ChartCard
            title="Revenue Over Time"
            description="Paid invoice revenue grouped by the current dashboard range."
            testId="dashboard-chart-revenue"
          >
            {hasSeriesValue(revenueChart, ["revenue"]) ? (
              <div className="h-96">
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
          </div>

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
        <PayoutsWorkspace
          rows={payoutRows}
          summary={payoutSummary || {}}
          exporting={payoutExporting}
          onExport={exportPayoutCsv}
          onOpenReports={() => setActiveBusinessView("reports-trends")}
        />
      ) : null}

      {customizeOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60" data-testid="insights-customize-panel">
          <div className="flex h-full w-full max-w-md flex-col border-l border-white/12 bg-slate-950 shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-white/10 bg-slate-950/95 p-4 backdrop-blur">
              <div>
                <h2 className="text-xl font-black text-white">Customize {activeViewConfig.title}</h2>
                <p className="mt-1 text-sm leading-6 text-sky-100/70">Choose which sections appear in this view and in what order. Changes save immediately.</p>
              </div>
              <button type="button" onClick={() => setCustomizeOpen(false)} className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-bold text-sky-50">
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <section>
              <h3 className="text-sm font-black text-white">Visible Insights</h3>
              <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
                {activeVisibleWidgetIds.map((widgetId, index) => (
                  <div key={widgetId} className="flex items-center gap-2 border-b border-white/10 bg-white/[0.045] p-2 last:border-b-0">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="text-sky-100/35" aria-hidden="true">::</span>
                      <span className="truncate text-sm font-bold text-sky-50">{widgetLabel(widgetId, activeBusinessView)}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => {
                          const next = [...activeVisibleWidgetIds];
                          [next[index - 1], next[index]] = [next[index], next[index - 1]];
                          saveInsightsPreferences(next);
                        }}
                        aria-label={`Move ${widgetLabel(widgetId, activeBusinessView)} up`}
                        className="rounded-md border border-white/12 bg-white/6 px-2 py-1 text-xs font-black text-sky-50 disabled:opacity-35"
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        disabled={index === activeVisibleWidgetIds.length - 1}
                        onClick={() => {
                          const next = [...activeVisibleWidgetIds];
                          [next[index], next[index + 1]] = [next[index + 1], next[index]];
                          saveInsightsPreferences(next);
                        }}
                        aria-label={`Move ${widgetLabel(widgetId, activeBusinessView)} down`}
                        className="rounded-md border border-white/12 bg-white/6 px-2 py-1 text-xs font-black text-sky-50 disabled:opacity-35"
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        onClick={() => saveInsightsPreferences(activeVisibleWidgetIds.filter((id) => id !== widgetId))}
                        className="rounded-md border border-white/12 bg-white/6 px-2 py-1 text-xs font-bold text-sky-50"
                      >
                        Hide
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-6">
              <h3 className="text-sm font-black text-white">Available Insights</h3>
              <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
                {activeWidgetCatalog.filter((widget) => !activeVisibleWidgetIds.includes(widget.id)).map((widget) => (
                  <button
                    key={widget.id}
                    type="button"
                    onClick={() => saveInsightsPreferences([...activeVisibleWidgetIds, widget.id])}
                    className="flex w-full items-center justify-between border-b border-white/10 bg-white/[0.045] p-2.5 text-left text-sm font-bold text-sky-50 last:border-b-0 hover:bg-white/10"
                  >
                    <span>{widget.label}</span>
                    <span>Add</span>
                  </button>
                ))}
              </div>
            </section>
            </div>

            <div className="sticky bottom-0 border-t border-white/10 bg-slate-950/95 p-4 backdrop-blur">
              <button
                type="button"
                onClick={() => saveInsightsPreferences(VIEW_WIDGET_DEFAULTS[activeBusinessView] || DEFAULT_INSIGHTS_WIDGETS)}
                className="w-full rounded-xl border border-white/15 bg-white/8 px-4 py-2 text-sm font-black text-sky-50 hover:bg-white/12"
                data-testid="insights-restore-default"
              >
                Restore Recommended Default
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {goalEditorOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4" data-testid="insights-goal-editor">
          <form onSubmit={saveGoal} className="w-full max-w-lg rounded-2xl border border-white/12 bg-slate-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-white">{editingGoalId ? "Edit Goal" : "Set Goal"}</h2>
                <p className="mt-1 text-sm leading-6 text-sky-100/70">Goals belong to the contractor organization. Layout preferences are saved for your user account.</p>
              </div>
              <button type="button" onClick={() => setGoalEditorOpen(false)} className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-bold text-sky-50">
                Close
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              <label className="block">
                <span className="text-sm font-bold text-sky-100">Metric</span>
                <select
                  value={goalForm.metric_type}
                  onChange={(event) => setGoalForm((current) => ({ ...current, metric_type: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-sm font-semibold text-sky-50"
                >
                  <option value="monthly_revenue">Monthly Revenue</option>
                  <option value="annual_revenue">Annual Revenue</option>
                  <option value="projects_completed">Projects Completed</option>
                  <option value="average_project_value">Average Project Value</option>
                  <option value="estimate_acceptance_rate">Estimate Acceptance Rate</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-bold text-sky-100">Goal name</span>
                <input value={goalForm.name} onChange={(event) => setGoalForm((current) => ({ ...current, name: event.target.value }))} className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-sm font-semibold text-sky-50" placeholder="Monthly Revenue" />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-sky-100">Target value</span>
                <input required type="number" min="0.01" step="0.01" value={goalForm.target_value} onChange={(event) => setGoalForm((current) => ({ ...current, target_value: event.target.value }))} className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-sm font-semibold text-sky-50" placeholder="50000" />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-sky-100">Deadline</span>
                <input type="date" value={goalForm.deadline || ""} onChange={(event) => setGoalForm((current) => ({ ...current, deadline: event.target.value }))} className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-sm font-semibold text-sky-50" />
              </label>
            </div>
            <button disabled={goalSaving} className="mt-5 w-full rounded-xl border border-amber-300/70 bg-amber-300 px-4 py-2 text-sm font-black text-slate-950 hover:bg-amber-200 disabled:opacity-60" type="submit">
              {goalSaving ? "Saving..." : "Save Goal"}
            </button>
          </form>
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
