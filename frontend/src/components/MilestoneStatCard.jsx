import React from "react";

/**
 * Props:
 * - label: string
 * - subLabel?: string
 * - data: { count: number, total: number } | number
 * - statusKey?: string  // controls color theme
 * - onClick?: () => void
 * - active?: boolean
 * - icon?: string | ReactNode
 */
export default function MilestoneStatCard({
  label,
  subLabel = "",
  data,
  statusKey = "",
  onClick,
  active = false,
  icon = "📊",
}) {
  let count = 0;
  let total = 0;

  if (typeof data === "number") {
    count = data;
  } else if (data && typeof data === "object") {
    count = typeof data.count === "number" ? data.count : 0;
    total = typeof data.total === "number" ? data.total : 0;
  }

  // Normalize key for colors
  const key = String(statusKey || "").toLowerCase().replace(/\s+/g, "_");
  const colorMap = {
    total: "border-blue-500",
    incomplete: "border-amber-500",
    complete: "border-emerald-500",
    completed_not_invoiced: "border-emerald-500",
    invoiced: "border-purple-500",
    sent: "border-sky-500",
    pending_approval: "border-amber-500",
    disputed: "border-red-500",
    overdue: "border-red-600",
    earned: "border-green-600",
  };
  const color = colorMap[key] || "border-gray-300";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={`
        rounded-xl border-t-4 ${color} bg-white shadow p-5 w-full
        text-center cursor-pointer hover:shadow-lg transition-all duration-200
        ${active ? "ring-2 ring-blue-600" : ""}
      `}
    >
      <div className="text-lg font-bold text-gray-800 mb-1">{label}</div>
      {subLabel && (
        <div className="text-sm text-gray-500 mb-1 leading-tight">{subLabel}</div>
      )}

      <div className="text-base font-medium text-blue-700 mb-1">
        <span aria-hidden="true">{icon}</span>
        <span className="ml-1">({count})</span>
      </div>
      <span className="sr-only">
        {label}: {count} item{count !== 1 ? "s" : ""}
      </span>

      <div className="text-base font-semibold text-gray-700">
        ${Number(total).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </div>
    </div>
  );
}
