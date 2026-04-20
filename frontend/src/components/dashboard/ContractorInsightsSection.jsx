import React, { useMemo } from "react";
import DashboardSection from "./DashboardSection.jsx";
import DashboardGrid from "./DashboardGrid.jsx";
import DashboardCard from "./DashboardCard.jsx";
import InsightSummaryCard from "./InsightSummaryCard.jsx";
import InsightComparisonRow from "./InsightComparisonRow.jsx";
import InsightRecommendationCard from "./InsightRecommendationCard.jsx";

function safeStr(value) {
  return value == null ? "" : String(value).trim();
}

function confidenceLabel(value) {
  const c = safeStr(value).toLowerCase();
  if (c === "high") return "High confidence";
  if (c === "medium") return "Moderate confidence";
  return "Preliminary view";
}

function formatFamilyOption(option) {
  if (!option || typeof option !== "object") return "All Projects";
  const label = safeStr(option.label) || "All Projects";
  const count = Number(option.count || 0);
  if (option.key === "all") return label;
  return count > 0 ? `${label} (${count})` : label;
}

function formatSourceLabel(sourceType) {
  const source = safeStr(sourceType).toLowerCase();
  if (source === "blended_all") return "Based on similar projects on MyHomeBro, your market, and your past work.";
  if (source === "blended_platform_regional") return "Based on similar projects on MyHomeBro and your market.";
  if (source === "blended_platform_contractor") return "Based on similar projects on MyHomeBro and your past work.";
  if (source === "regional") return "Based on similar projects in your market.";
  if (source === "contractor") return "Based on your past work for similar projects.";
  return "Based on similar projects on MyHomeBro.";
}

function fallbackInsights() {
  return {
    available: false,
    source_type: "platform",
    source_label: "Based on similar projects on MyHomeBro.",
    confidence: "low",
    selected_family_key: "all",
    selected_family_label: "All Projects",
    effective_family_key: "general",
    effective_family_label: "General Project",
    scope_mode: "all_projects",
    scope_label: "All Projects",
    scope_notice: "",
    available_families: [{ key: "all", label: "All Projects", count: 0 }],
    sample_sizes: { platform: 0, regional: 0, contractor: 0 },
    summary_cards: [
      {
        key: "pricing",
        label: "Pricing Position",
        headline: "Complete more jobs to sharpen this view",
        support: "Completed projects will help compare your pricing against similar work.",
        badge: "Benchmark",
        confidence: "Preliminary view",
      },
      {
        key: "pace",
        label: "Project Pace",
        headline: "Complete more jobs to sharpen this view",
        support: "Completed projects will help compare your timelines against similar work.",
        badge: "Timing",
        confidence: "Preliminary view",
      },
      {
        key: "milestones",
        label: "Milestone Style",
        headline: "Complete more jobs to sharpen this view",
        support: "Completed projects will help compare your milestone structure against similar work.",
        badge: "Structure",
        confidence: "Preliminary view",
      },
      {
        key: "reliability",
        label: "Reliability Signals",
        headline: "Complete more jobs to sharpen this view",
        support: "Completed projects will help compare change patterns and amendment trends.",
        badge: "Quality",
        confidence: "Preliminary view",
      },
    ],
    comparison_rows: [
      {
        key: "pricing",
        label: "Pricing vs benchmark",
        comparison: "Completed jobs will sharpen this comparison.",
        meter: 50,
        confidence: "Preliminary view",
      },
      {
        key: "pace",
        label: "Project pace vs benchmark",
        comparison: "Completed jobs will sharpen this comparison.",
        meter: 50,
        confidence: "Preliminary view",
      },
      {
        key: "structure",
        label: "Milestone count vs peers",
        comparison: "Completed jobs will sharpen this comparison.",
        meter: 50,
        confidence: "Preliminary view",
      },
      {
        key: "reliability",
        label: "Reliability signals",
        comparison: "Completed jobs will sharpen this comparison.",
        meter: 50,
        confidence: "Preliminary view",
      },
    ],
    recommendations: [
      "Complete more jobs to unlock contractor-specific insights.",
    ],
    explanations: [],
  };
}

function normalizeInsights(insights) {
  const base = fallbackInsights();
  if (!insights || typeof insights !== "object") return base;

  return {
    ...base,
    ...insights,
    source_label: safeStr(insights.source_label) || formatSourceLabel(insights.source_type),
    confidence: safeStr(insights.confidence) || base.confidence,
    selected_family_key: safeStr(insights.selected_family_key) || base.selected_family_key,
    selected_family_label: safeStr(insights.selected_family_label) || base.selected_family_label,
    effective_family_key: safeStr(insights.effective_family_key) || base.effective_family_key,
    effective_family_label: safeStr(insights.effective_family_label) || base.effective_family_label,
    scope_mode: safeStr(insights.scope_mode) || base.scope_mode,
    scope_label: safeStr(insights.scope_label) || base.scope_label,
    scope_notice: safeStr(insights.scope_notice) || base.scope_notice,
    available_families: Array.isArray(insights.available_families) && insights.available_families.length
      ? insights.available_families
      : base.available_families,
    summary_cards: Array.isArray(insights.summary_cards) && insights.summary_cards.length
      ? insights.summary_cards
      : base.summary_cards,
    comparison_rows: Array.isArray(insights.comparison_rows) && insights.comparison_rows.length
      ? insights.comparison_rows
      : base.comparison_rows,
    recommendations: Array.isArray(insights.recommendations) && insights.recommendations.length
      ? insights.recommendations
      : base.recommendations,
    explanations: Array.isArray(insights.explanations) ? insights.explanations : [],
  };
}

export default function ContractorInsightsSection({
  insights,
  availableFamilies = [],
  selectedFamilyKey = "all",
  onFamilyChange,
}) {
  const data = useMemo(() => normalizeInsights(insights), [insights]);
  const sampleSizes = data.sample_sizes || {};
  const familyOptions = useMemo(() => {
    const options = Array.isArray(availableFamilies) && availableFamilies.length
      ? availableFamilies
      : [{ key: "all", label: "All Projects", count: 0 }];
    if (!options.some((option) => option?.key === "all")) {
      return [{ key: "all", label: "All Projects", count: 0 }, ...options];
    }
    return options;
  }, [availableFamilies]);
  const sampleText = [
    `${sampleSizes.platform || 0} platform projects`,
    sampleSizes.regional ? `${sampleSizes.regional} market projects` : null,
    sampleSizes.contractor ? `${sampleSizes.contractor} of your completed jobs` : null,
  ].filter(Boolean).join(" · ");
  const showSamples = Boolean(sampleText) && data.confidence !== "Preliminary view";
  const selectedFamilyLabel =
    safeStr(data.scope_label) ||
    safeStr(data.selected_family_label) ||
    "All Projects";

  return (
    <DashboardSection
      title="Contractor Insights"
      subtitle="Helpful benchmarks based on similar projects, your market, and your past work."
      testId="dashboard-contractor-insights-section"
      className="mb-5"
      actions={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label
            htmlFor="contractor-insights-family-filter"
            className="text-xs font-semibold text-slate-700"
          >
            Project family
          </label>
          <select
            id="contractor-insights-family-filter"
            data-testid="dashboard-contractor-insights-family-filter"
            value={selectedFamilyKey}
            onChange={(event) => {
              if (typeof onFamilyChange === "function") {
                onFamilyChange(event.target.value);
              }
            }}
            className="min-w-[220px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
          >
            {familyOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {formatFamilyOption(option)}
              </option>
            ))}
          </select>
        </div>
      }
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-bold text-slate-900">Dashboard benchmark view</div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                {data.source_type === "blended_all"
                  ? "Platform + Market + Contractor"
                  : data.source_type === "blended_platform_regional"
                  ? "Platform + Market"
                  : data.source_type === "blended_platform_contractor"
                  ? "Platform + Contractor"
                  : data.source_type === "regional"
                  ? "Market"
                  : data.source_type === "contractor"
                  ? "Contractor"
                  : "Platform"}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                {confidenceLabel(data.confidence)}
              </span>
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-600">{data.source_label}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                {selectedFamilyLabel}
              </span>
              {data.scope_mode === "fallback_all" ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                  Broader view
                </span>
              ) : null}
            </div>
            {safeStr(data.scope_notice) ? (
              <div
                data-testid="dashboard-contractor-insights-scope-notice"
                className="mt-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
              >
                {data.scope_notice}
              </div>
            ) : null}
            {showSamples ? (
              <div className="mt-2 text-xs font-medium text-slate-500">{sampleText}</div>
            ) : null}
            {!data.available ? (
              <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Complete more finished jobs to unlock sharper contractor benchmark comparisons.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <DashboardGrid columns="narrow" className="xl:grid-cols-4">
        {data.summary_cards.map((card) => (
          <InsightSummaryCard
            key={card.key}
            testId={`dashboard-contractor-insights-summary-${card.key}`}
            label={card.label}
            headline={card.headline}
            support={card.support}
            badge={card.badge}
            confidence={card.confidence}
          />
        ))}
      </DashboardGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DashboardCard
            testId="dashboard-contractor-insights-standings"
            className="h-full border-slate-200 bg-white"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Where you stand
                </div>
                <div className="mt-1 text-base font-semibold text-slate-900">
                  A quick read on how this project family compares.
                </div>
              </div>
              <div className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                {confidenceLabel(data.confidence)}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {data.comparison_rows.map((row) => (
                <InsightComparisonRow
                  key={row.key}
                  testId={`dashboard-contractor-insights-row-${row.key}`}
                  label={row.label}
                  comparison={row.comparison}
                  meter={row.meter}
                  confidence={row.confidence}
                />
              ))}
            </div>
          </DashboardCard>
        </div>

        <InsightRecommendationCard
          testId="dashboard-contractor-insights-recommendations"
          title="Recommended adjustments"
          bullets={data.recommendations}
        />
      </div>
    </DashboardSection>
  );
}
