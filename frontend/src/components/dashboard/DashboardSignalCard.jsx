import React from "react";
import DashboardCard from "./DashboardCard.jsx";

const TONE_CLASS = {
  high: "text-rose-900",
  medium: "text-amber-900",
  low: "text-slate-900",
  info: "text-slate-900",
};

export default function DashboardSignalCard({
  title,
  message,
  severity = "info",
  actionLabel,
  onAction,
  testId,
}) {
  return (
    <DashboardCard testId={testId} tone={severity === "high" || severity === "medium" ? "signal" : "default"}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {severity}
          </div>
          <div className={`mt-2 text-base font-semibold ${TONE_CLASS[severity] || TONE_CLASS.info}`}>
            {title}
          </div>
          <div className="mt-2 text-sm text-slate-600">{message}</div>
        </div>
      </div>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          {actionLabel}
        </button>
      ) : null}
    </DashboardCard>
  );
}
