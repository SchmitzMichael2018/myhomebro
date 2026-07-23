import React from "react";
import { Card } from "../ui/index.js";

export default function DashboardCard({
  children,
  className = "",
  testId,
  tone = "default",
}) {
  const toneClass =
    tone === "subtle"
      ? "border-slate-200 bg-slate-50"
      : tone === "signal" || tone === "warning"
      ? "border-amber-200 bg-amber-50"
      : tone === "action"
      ? "border-sky-200 bg-gradient-to-br from-[#0f3c66] via-[#1b4d85] to-[#2f6fb3] text-white"
      : tone === "premium"
      ? "border-white/10 bg-[#061d42]/95 text-white"
      : "border-slate-200 bg-white";

  return (
    <Card
      as="div"
      padding="none"
      theme={tone === "premium" || tone === "action" ? "operational" : "default"}
      data-testid={testId}
      className={`mhb-dashboard-card rounded-2xl border p-5 shadow-sm ${toneClass} ${className}`.trim()}
    >
      {children}
    </Card>
  );
}
