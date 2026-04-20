import React from "react";
import DashboardCard from "./DashboardCard.jsx";

export default function InsightSummaryCard({
  label,
  headline,
  support,
  badge,
  confidence,
  testId,
}) {
  return (
    <DashboardCard testId={testId} className="h-full border-slate-200 bg-white">
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {label}
          </div>
          {badge ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
              {badge}
            </span>
          ) : null}
        </div>
        <div className="mt-3 text-base font-semibold leading-6 text-slate-900">
          {headline}
        </div>
        <div className="mt-2 text-sm leading-6 text-slate-600">
          {support}
        </div>
        {confidence ? (
          <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {confidence}
          </div>
        ) : null}
      </div>
    </DashboardCard>
  );
}
