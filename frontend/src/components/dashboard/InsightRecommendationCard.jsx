import React from "react";
import DashboardCard from "./DashboardCard.jsx";

export default function InsightRecommendationCard({
  title,
  bullets = [],
  testId,
  emptyText = "Complete more completed jobs to unlock sharper recommendations.",
}) {
  const safeBullets = Array.isArray(bullets) ? bullets.filter(Boolean).slice(0, 4) : [];

  return (
    <DashboardCard testId={testId} className="h-full border-slate-200 bg-slate-50/70">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {title}
      </div>
      {safeBullets.length ? (
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          {safeBullets.map((bullet, index) => (
            <li key={`${bullet}-${index}`} className="flex gap-2">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400"
                aria-hidden="true"
              />
              <span className="leading-6">{bullet}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-600">
          {emptyText}
        </div>
      )}
    </DashboardCard>
  );
}
