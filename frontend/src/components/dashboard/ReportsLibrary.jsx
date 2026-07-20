import React from "react";
import {
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  Download,
  FileBarChart2,
  FolderKanban,
  Heart,
  ListFilter,
  Plus,
  ReceiptText,
  Users,
  WalletCards,
} from "lucide-react";
import { Line, LineChart, ResponsiveContainer } from "recharts";

const categories = [
  { key: "financial", title: "Financial", description: "Revenue, payments, fees, and receivables.", count: 2, icon: WalletCards, tone: "bg-emerald-50 text-emerald-700" },
  { key: "projects", title: "Projects", description: "Pipeline, jobs, and project performance.", count: 1, icon: BriefcaseBusiness, tone: "bg-amber-50 text-amber-700" },
  { key: "customers", title: "Customers", description: "Customer activity and approvals.", count: 0, icon: Users, tone: "bg-blue-50 text-blue-700" },
  { key: "team", title: "Team", description: "Workload and team performance.", count: 0, icon: FolderKanban, tone: "bg-violet-50 text-violet-700" },
  { key: "operations", title: "Operations", description: "Execution and workflow reporting.", count: 1, icon: FileBarChart2, tone: "bg-orange-50 text-orange-700" },
];

const reports = [
  { key: "revenue", title: "Revenue Summary", category: "Financial", description: "Paid invoices and revenue detail.", icon: FileBarChart2, tone: "bg-emerald-50 text-emerald-700" },
  { key: "jobs", title: "Project Pipeline", category: "Projects", description: "Job, category, and completion summary.", icon: ListFilter, tone: "bg-amber-50 text-amber-700" },
  { key: "fees", title: "Platform Fee Report", category: "Financial", description: "Platform fee detail by invoice.", icon: ReceiptText, tone: "bg-blue-50 text-blue-700" },
  { key: "payouts", title: "Payout Report", category: "Operations", description: "Subcontractor payout history.", icon: WalletCards, tone: "bg-violet-50 text-violet-700" },
];

function money(value) {
  return Number(value || 0).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function TrendPreview({ title, value, subtitle, data, dataKey, color, onClick }) {
  return (
    <button type="button" onClick={onClick} className="min-w-[230px] rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-blue-300">
      <div className="text-sm font-bold text-slate-900">{title}</div>
      <div className="mt-2 text-xl font-black tabular-nums text-slate-950">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{subtitle}</div>
      <div className="mt-3 h-12">
        {data.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={data}><Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer> : <div className="flex h-full items-center text-xs text-slate-400">Trend unavailable</div>}
      </div>
    </button>
  );
}

export default function ReportsLibrary({
  onRunReport,
  revenueSeries = [],
  workflowSeries = [],
  snapshot = {},
  businessPerformance = {},
  outstandingValue = 0,
}) {
  const run = (key) => onRunReport?.(key);
  const pipelineValue = businessPerformance?.revenue?.total_pipeline_value || 0;
  const completionTrend = workflowSeries.map((row) => ({ ...row, completed: Number(snapshot.jobs_completed || 0) }));

  return (
    <div data-testid="reports-library" className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-3">
        <section data-testid="reports-categories" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-950">Report Categories</h2>
          <p className="mt-1 text-sm text-slate-500">Explore key areas of your business.</p>
          <div className="mt-4 overflow-x-auto pb-1"><div className="grid min-w-[740px] grid-cols-5 gap-2">
            {categories.map(({ key, title, description, count, icon: Icon, tone }) => <button key={key} type="button" className="rounded-xl border border-slate-200 p-4 text-left hover:border-blue-300"><span className={`flex h-10 w-10 items-center justify-center rounded-lg ${tone}`}><Icon aria-hidden="true" className="h-5 w-5" /></span><div className="mt-3 font-bold text-slate-900">{title}</div><div className="mt-1 min-h-10 text-xs leading-5 text-slate-500">{description}</div><div className="mt-3 flex items-center justify-between text-xs font-semibold text-slate-600"><span>{count} report{count === 1 ? "" : "s"}</span><ChevronRight aria-hidden="true" className="h-4 w-4" /></div></button>)}
          </div></div>
        </section>

        <section data-testid="reports-popular" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-950">Popular Reports</h2><p className="mt-1 text-sm text-slate-500">Available reports for the selected range.</p></div><span className="text-sm font-bold text-blue-700">View all reports</span></div>
          <div className="mt-4 hidden md:block"><table className="w-full text-left text-sm"><thead className="border-y border-slate-200 bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2">Favorite</th><th className="px-3 py-2">Report</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Description</th><th className="px-3 py-2">Last Run</th><th className="px-3 py-2">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{reports.map(({ key, title, category, description, icon: Icon, tone }) => <tr key={key}><td className="px-3 py-3"><Heart aria-hidden="true" className="h-4 w-4 text-slate-400" /></td><td className="px-3 py-3"><div className="flex items-center gap-2"><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}><Icon aria-hidden="true" className="h-4 w-4" /></span><strong className="text-slate-900">{title}</strong></div></td><td className="px-3 py-3 text-slate-600">{category}</td><td className="px-3 py-3 text-slate-600">{description}</td><td className="px-3 py-3 text-slate-500">Not recorded</td><td className="px-3 py-3"><div className="inline-flex"><button type="button" data-testid={`run-report-${key}`} onClick={() => run(key)} className="rounded-l-lg border border-blue-200 px-3 py-1.5 font-bold text-blue-700 hover:bg-blue-50">Run</button><button type="button" aria-label={`${title} actions`} className="rounded-r-lg border border-l-0 border-blue-200 px-2 text-blue-700"><ChevronDown aria-hidden="true" className="h-4 w-4" /></button></div></td></tr>)}</tbody></table></div>
          <div className="mt-3 divide-y divide-slate-100 md:hidden">{reports.map(({ key, title, category, description, icon: Icon, tone }) => <article key={key} className="py-4 first:pt-0"><div className="flex items-start gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}><Icon aria-hidden="true" className="h-4 w-4" /></span><div className="min-w-0 flex-1"><div className="font-bold text-slate-900">{title}</div><div className="mt-0.5 text-xs text-slate-500">{category}</div><p className="mt-2 text-sm text-slate-600">{description}</p></div><button type="button" data-testid={`run-report-mobile-${key}`} onClick={() => run(key)} className="rounded-lg border border-blue-200 px-3 py-1.5 text-sm font-bold text-blue-700">Run</button></div></article>)}</div>
        </section>

        <section data-testid="reports-trend-previews" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold text-slate-950">Quick Trend Previews</h2><p className="mt-1 text-sm text-slate-500">High-level signals that open the associated report.</p><div className="mt-4 overflow-x-auto pb-1"><div className="grid min-w-[900px] grid-cols-4 gap-3"><TrendPreview title="Revenue" value={money(snapshot.total_revenue)} subtitle="Collected in range" data={revenueSeries} dataKey="revenue" color="#2563eb" onClick={() => run("revenue")} /><TrendPreview title="Pipeline Value" value={money(pipelineValue)} subtitle="Active pipeline" data={[]} dataKey="value" color="#f59e0b" onClick={() => run("jobs")} /><TrendPreview title="Outstanding A/R" value={money(outstandingValue)} subtitle="Outstanding receivables" data={[]} dataKey="value" color="#8b5cf6" onClick={() => run("revenue")} /><TrendPreview title="Projects Completed" value={Number(snapshot.jobs_completed || 0).toLocaleString()} subtitle="Completed in range" data={completionTrend} dataKey="completed" color="#16a34a" onClick={() => run("jobs")} /></div></div></section>
      </div>

      <aside className="space-y-3">
        <section data-testid="reports-shortcuts" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-bold text-slate-950">Report Shortcuts</h2><p className="mt-1 text-sm text-slate-500">Frequently used reports.</p><div className="mt-3 divide-y divide-slate-100">{reports.map(({ key, title, icon: Icon, tone }) => <button key={key} type="button" onClick={() => run(key)} className="flex w-full items-center gap-3 py-3 text-left"><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}><Icon aria-hidden="true" className="h-4 w-4" /></span><span className="flex-1 text-sm font-bold text-slate-800">{title}</span><ChevronRight aria-hidden="true" className="h-4 w-4 text-slate-500" /></button>)}<button type="button" className="flex w-full items-center gap-3 py-3 text-left"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-600"><Plus aria-hidden="true" className="h-4 w-4" /></span><span className="flex-1 text-sm font-bold text-slate-800">Custom Report Builder</span><Plus aria-hidden="true" className="h-4 w-4 text-slate-500" /></button></div></section>
        <section data-testid="reports-recent" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-bold text-slate-950">Recent Reports</h2><div className="mt-3 flex items-start gap-3 rounded-lg bg-slate-50 p-3"><Download aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" /><div><div className="text-sm font-bold text-slate-900">No reports have been run yet.</div><div className="mt-1 text-xs leading-5 text-slate-500">Choose a report category to begin.</div></div></div></section>
      </aside>
    </div>
  );
}
