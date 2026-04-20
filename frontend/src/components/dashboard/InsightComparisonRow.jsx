import React from "react";

function clampMeter(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 50;
  return Math.max(10, Math.min(n, 90));
}

export default function InsightComparisonRow({
  label,
  comparison,
  meter = 50,
  confidence,
  testId,
}) {
  const meterValue = clampMeter(meter);

  return (
    <div
      data-testid={testId}
      className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">{label}</div>
          <div className="mt-1 text-sm leading-6 text-slate-600">{comparison}</div>
        </div>
        {confidence ? (
          <div className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            {confidence}
          </div>
        ) : null}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-slate-900/80"
          style={{ width: `${meterValue}%` }}
        />
      </div>
    </div>
  );
}
