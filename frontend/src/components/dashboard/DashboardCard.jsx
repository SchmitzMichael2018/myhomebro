import React from "react";

export default function DashboardCard({
  children,
  className = "",
  testId,
  tone = "default",
}) {
  const toneClass =
    tone === "subtle"
      ? "border-slate-200 bg-slate-50"
      : tone === "signal"
      ? "border-amber-200 bg-amber-50"
      : "border-slate-200 bg-white";

  return (
    <div
      data-testid={testId}
      className={`rounded-2xl border p-5 shadow-sm ${toneClass} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
