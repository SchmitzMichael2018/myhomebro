import React, { useMemo } from "react";
import {
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  FileBarChart2,
  Lightbulb,
  Target,
} from "lucide-react";

function safeStr(value) {
  return value == null ? "" : String(value).trim();
}

function formatFamilyOption(option) {
  const label = safeStr(option?.label) || "All Projects";
  const count = Number(option?.count || 0);
  return option?.key !== "all" && count > 0 ? `${label} (${count})` : label;
}

function fallbackInsights() {
  return {
    available: false,
    confidence: "low",
    scope_label: "All Projects",
    available_families: [{ key: "all", label: "All Projects", count: 0 }],
    sample_sizes: {},
    summary_cards: [],
    comparison_rows: [],
    recommendations: [],
  };
}

function normalizeInsights(insights) {
  const base = fallbackInsights();
  if (!insights || typeof insights !== "object") return base;
  return {
    ...base,
    ...insights,
    available_families: Array.isArray(insights.available_families) && insights.available_families.length
      ? insights.available_families
      : base.available_families,
    summary_cards: Array.isArray(insights.summary_cards) ? insights.summary_cards : [],
    comparison_rows: Array.isArray(insights.comparison_rows) ? insights.comparison_rows : [],
    recommendations: Array.isArray(insights.recommendations) ? insights.recommendations : [],
  };
}

function statusForRow(row) {
  const text = `${safeStr(row?.label)} ${safeStr(row?.comparison)}`.toLowerCase();
  if (/below|longer|worse|slower|behind/.test(text)) return "below";
  if (/above|better|faster|competitive/.test(text)) return "above";
  return "average";
}

function hasNumericDetails(row) {
  return ["contractor_value", "industry_average", "top_performer_value", "percentile"]
    .every((key) => row?.[key] !== null && row?.[key] !== undefined && row?.[key] !== "");
}

function displayValue(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function statusLabel(status) {
  if (status === "above") return "Above similar projects";
  if (status === "below") return "Needs improvement";
  return "Near benchmark";
}

function recommendationTitle(text) {
  const value = safeStr(text).toLowerCase();
  if (/pric|competitiv/.test(value)) return "Review project pricing";
  if (/timeline|faster|pace|schedul/.test(value)) return "Improve project pacing";
  if (/milestone/.test(value)) return "Simplify milestone plans";
  if (/change|amend|dispute/.test(value)) return "Strengthen change management";
  if (/complete more|history|benchmark/.test(value)) return "Build more benchmark history";
  return "Review this benchmark signal";
}

function metricLabel(row) {
  return safeStr(row?.label).replace(/\s+vs\s+(benchmark|peers)$/i, "") || "Benchmark metric";
}

function MetricIcon({ status }) {
  const styles = status === "above"
    ? "border-emerald-200 bg-emerald-50 text-emerald-600"
    : status === "below"
    ? "border-red-200 bg-red-50 text-red-500"
    : "border-amber-200 bg-amber-50 text-amber-500";
  return <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${styles}`}><Target aria-hidden="true" className="h-4 w-4" /></span>;
}

export default function ContractorInsightsSection({
  insights,
  availableFamilies = [],
  selectedFamilyKey = "all",
  onFamilyChange,
  onOpenReports,
}) {
  const data = useMemo(() => normalizeInsights(insights), [insights]);
  const families = availableFamilies.length ? availableFamilies : data.available_families;
  const rows = data.comparison_rows;
  const numericMode = rows.length > 0 && rows.every(hasNumericDetails);
  const statuses = rows.map(statusForRow);
  const aboveCount = statuses.filter((status) => status === "above").length;
  const averageCount = statuses.filter((status) => status === "average").length;
  const belowCount = statuses.filter((status) => status === "below").length;
  const overall = !data.available || !rows.length
    ? "Unavailable"
    : aboveCount > belowCount
    ? "Above Average"
    : belowCount > aboveCount
    ? "Needs Improvement"
    : "Near Benchmark";
  const preliminary = !data.available || safeStr(data.confidence).toLowerCase() === "low";
  const statusExplanation = rows.length
    ? `Based on ${rows.length} supported benchmark signals: ${aboveCount} above average, ${averageCount} near benchmark, and ${belowCount} needing improvement.`
    : "No supported benchmark signals are available yet.";

  return (
    <div data-testid="dashboard-contractor-insights-section" className="space-y-3">
      <section data-testid="insights-benchmarks-overview" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-lg font-bold text-slate-950">Benchmark Overview</h2><p className="mt-1 text-sm text-slate-600">How your business compares with similar contractors.</p></div>
          <div className="flex items-center gap-2">
            <label htmlFor="contractor-insights-family-filter" className="text-xs font-semibold text-slate-600">Project family</label>
            <select id="contractor-insights-family-filter" data-testid="dashboard-contractor-insights-family-filter" value={selectedFamilyKey} onChange={(event) => onFamilyChange?.(event.target.value)} className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 sm:min-w-[190px]">
              {families.map((option) => <option key={option.key} value={option.key}>{formatFamilyOption(option)}</option>)}
            </select>
          </div>
        </div>
        {safeStr(data.scope_notice) ? <p data-testid="dashboard-contractor-insights-scope-notice" className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">{data.scope_notice}</p> : null}
        <div className="grid gap-6 pt-5 lg:grid-cols-[1fr_1fr_1.35fr] lg:items-center">
          <div className="text-center lg:border-r lg:border-slate-200 lg:pr-6">
            <div className="mx-auto flex h-24 w-48 items-end justify-center rounded-t-full border-[10px] border-b-0 border-emerald-500/80 pb-2"><span className="text-xl font-bold text-emerald-700">{overall}</span></div>
            <p className="mt-2 text-sm font-bold text-slate-900">Overall performance</p>
            <p className="text-xs text-slate-500">{safeStr(data.scope_label) || "All Projects"}</p>
            <p data-testid="insights-benchmarks-status-explanation" className="mx-auto mt-3 max-w-xs text-xs leading-5 text-slate-600">{statusExplanation} {preliminary ? "Preliminary result based on available signals." : ""}</p>
          </div>
          <div className="space-y-3 text-sm">
            {rows.length ? <><div className="flex items-center gap-3"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /><strong className="w-5 text-emerald-700">{aboveCount}</strong><span className="text-slate-600">Above average</span></div><div className="flex items-center gap-3"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /><strong className="w-5 text-amber-700">{averageCount}</strong><span className="text-slate-600">Near benchmark</span></div><div className="flex items-center gap-3"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /><strong className="w-5 text-red-600">{belowCount}</strong><span className="text-slate-600">Needs improvement</span></div></> : <p className="text-slate-500">Comparison counts are unavailable.</p>}
          </div>
          <div className="flex gap-4 rounded-xl bg-blue-50/70 p-5"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700"><Lightbulb aria-hidden="true" className="h-5 w-5" /></span><div><h3 className="font-bold text-slate-950">About Benchmarks</h3><p className="mt-1 text-sm leading-6 text-slate-600">Benchmarks compare your business with similar contractors using aggregated platform data.</p><button type="button" className="mt-2 inline-flex items-center gap-2 text-sm font-bold text-blue-700">Learn more about benchmarks <ArrowRight aria-hidden="true" className="h-4 w-4" /></button></div></div>
        </div>
      </section>

      {!data.available || preliminary ? <section data-testid="insights-benchmarks-low-data" className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4"><h2 className="text-sm font-bold text-amber-950">More completed projects are needed for detailed peer values.</h2><p className="mt-1 text-sm leading-6 text-amber-800">Current qualitative signals use the benchmark data available for this project family. Completing more projects will strengthen future comparisons.</p></section> : null}

      <section data-testid="insights-benchmarks-table" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="px-5 py-4 md:px-6"><h2 className="text-lg font-bold text-slate-950">Key Benchmark Metrics</h2><p className="mt-1 text-sm text-slate-500">{numericMode ? "Detailed numeric peer comparison." : "Qualitative comparison based on currently supported benchmark signals."}</p></div>
        <div className="hidden md:block"><table className="w-full text-left"><thead className="border-y border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-500"><tr><th className="px-6 py-3">Metric</th>{numericMode ? <><th className="px-4 py-3">Your Business</th><th className="px-4 py-3">Industry Average</th><th className="px-4 py-3">Top Performers</th><th className="px-4 py-3">Your Percentile</th><th className="px-4 py-3">Difference</th></> : <><th className="px-4 py-3">Confidence</th><th className="px-4 py-3">Qualitative Comparison</th><th className="px-4 py-3">Interpretation</th></>}</tr></thead><tbody className="divide-y divide-slate-100">
          {rows.length ? rows.map((row) => { const status = statusForRow(row); return <tr key={row.key || row.label} data-testid={`dashboard-contractor-insights-row-${row.key}`}><td className="px-6 py-4"><div className="flex items-center gap-3"><MetricIcon status={status} /><span className="text-sm font-bold text-slate-900">{metricLabel(row)}</span></div></td>{numericMode ? <><td className="px-4 py-4 text-sm font-semibold text-slate-800">{displayValue(row.contractor_value)}</td><td className="px-4 py-4 text-sm text-slate-700">{displayValue(row.industry_average)}</td><td className="px-4 py-4 text-sm text-slate-700">{displayValue(row.top_performer_value)}</td><td className="px-4 py-4 text-sm text-slate-700">{displayValue(row.percentile)}</td><td className="px-4 py-4 text-sm font-semibold text-slate-700">{safeStr(row.comparison) || "—"}</td></> : <><td className="px-4 py-4 text-sm text-slate-600">{safeStr(row.confidence) || "Preliminary signal"}</td><td className={`px-4 py-4 text-sm font-semibold ${status === "above" ? "text-emerald-700" : status === "below" ? "text-red-600" : "text-amber-700"}`}>{statusLabel(status)}</td><td className="px-4 py-4 text-sm text-slate-700">{safeStr(row.comparison) || "No interpretation available."}</td></>}</tr>; }) : <tr><td colSpan={numericMode ? 6 : 4} className="px-6 py-8 text-center text-sm text-slate-500">No supported benchmark signals are available for this project family.</td></tr>}
        </tbody></table></div>
        <div data-testid="insights-benchmarks-mobile-rows" className="divide-y divide-slate-100 md:hidden">{rows.length ? rows.map((row) => { const status = statusForRow(row); return <article key={row.key || row.label} className="p-5"><div className="flex items-start gap-3"><MetricIcon status={status} /><div className="min-w-0"><h3 className="font-bold text-slate-900">{metricLabel(row)}</h3><p className="mt-0.5 text-xs text-slate-500">{safeStr(row.confidence) || "Preliminary signal"}</p></div></div>{numericMode ? <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-slate-500">Your result</dt><dd className="mt-1 font-semibold">{displayValue(row.contractor_value)}</dd></div><div><dt className="text-xs text-slate-500">Industry average</dt><dd className="mt-1 font-semibold">{displayValue(row.industry_average)}</dd></div><div><dt className="text-xs text-slate-500">Top performers</dt><dd className="mt-1 font-semibold">{displayValue(row.top_performer_value)}</dd></div><div><dt className="text-xs text-slate-500">Percentile</dt><dd className="mt-1 font-semibold">{displayValue(row.percentile)}</dd></div></dl> : null}<div className="mt-4 rounded-lg bg-slate-50 p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{statusLabel(status)}</p><p className="mt-1 text-sm leading-6 text-slate-700">{safeStr(row.comparison) || "No interpretation available."}</p></div></article>; }) : <p className="p-6 text-center text-sm text-slate-500">No supported benchmark signals are available for this project family.</p>}</div>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <section data-testid="dashboard-contractor-insights-standings" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6"><h2 className="text-lg font-bold text-slate-950">Performance vs. Peers</h2><p className="mt-1 text-sm text-slate-500">Relative positioning only; exact peer values are not available.</p><div data-testid="insights-benchmarks-chart" className="mt-6 space-y-5">{rows.length ? rows.map((row) => { const status = statusForRow(row); const position = status === "above" ? "75%" : status === "below" ? "25%" : "50%"; return <div key={row.key}><div className="mb-2 flex justify-between gap-3 text-xs"><span className="font-semibold text-slate-700">{metricLabel(row)}</span><span className={status === "above" ? "text-emerald-700" : status === "below" ? "text-red-600" : "text-amber-700"}>{statusLabel(status)}</span></div><div className="relative h-5"><div className="absolute left-0 right-0 top-2 h-1 rounded-full bg-slate-100" /><div className="absolute left-1/2 top-0 h-5 border-l border-dashed border-blue-500" /><span className="absolute top-0 h-5 w-5 -translate-x-1/2 rounded-full border-4 border-white bg-slate-700 shadow" style={{ left: position }} /><span className="absolute left-1/2 top-5 -translate-x-1/2 text-[10px] text-slate-500">Benchmark</span></div></div>; }) : <div className="py-12 text-center text-sm text-slate-500">Peer comparison data is unavailable.</div>}</div></section>
        <section data-testid="dashboard-contractor-insights-recommendations" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6"><h2 className="text-lg font-bold text-slate-950">Focus Opportunities</h2><p className="mt-1 text-sm text-slate-500">Areas with the biggest potential for improvement.</p><div className="mt-5 divide-y divide-slate-100">{data.recommendations.length ? data.recommendations.map((item, index) => <div key={`${item}-${index}`} className="flex items-center gap-3 py-4 first:pt-0"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-600">{index === 0 ? <ArrowDown aria-hidden="true" className="h-4 w-4" /> : <CheckCircle2 aria-hidden="true" className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><h3 className="text-sm font-bold text-slate-900">{recommendationTitle(item)}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{item}</p></div><ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" /></div>) : <p className="py-8 text-center text-sm text-slate-500">No focus opportunities are supported by the current benchmark data.</p>}</div></section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><FileBarChart2 aria-hidden="true" className="h-5 w-5" /></span><div><h2 className="font-bold text-slate-950">Explore deeper insights</h2><p className="mt-0.5 text-sm text-slate-500">Dive into detailed reports, charts, performance by category, exports, and more.</p></div></div><button type="button" onClick={onOpenReports} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-blue-500 px-4 text-sm font-bold text-blue-700 hover:bg-blue-50">Go to Reports & Trends <ArrowRight aria-hidden="true" className="h-4 w-4" /></button></div></section>
    </div>
  );
}
