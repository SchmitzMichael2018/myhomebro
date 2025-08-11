// src/components/MilestoneStatCard.jsx

import React from "react";

export default function MilestoneStatCard({
  label,
  subLabel = "",
  data,
  icon = "📊",
  onClick,
  active = false,
  statusKey = ""
}) {
  // Safely extract count and total
  const count = (data && typeof data.count === "number") ? data.count : 0;
  const total = (data && typeof data.total === "number") ? data.total : 0.0;

  // Only three main statuses for milestones
  const colorMap = {
    total: "border-blue-500",        // All Milestones
    incomplete: "border-yellow-500", // Not completed
    completed: "border-green-500",   // Completed but not invoiced
    invoiced: "border-purple-500"    // Fully invoiced
  };

  // Fallback to gray if key not found
  const color = colorMap[statusKey] || "border-gray-300";

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
        rounded-xl border-t-4 ${color} bg-white shadow p-5 w-full max-w-[240px]
        min-w-[180px] text-center cursor-pointer hover:shadow-lg transition-all duration-200
        ${active ? "ring-2 ring-blue-600" : ""}
      `}
    >
      {/* Label */}
      <div className="text-lg font-bold text-gray-800 mb-1">
        {label}
      </div>

      {/* Optional subLabel */}
      {subLabel && (
        <div className="text-sm text-gray-500 mb-1 leading-tight">
          {subLabel}
        </div>
      )}

      {/* Icon + Count */}
      <div className="text-base font-medium text-blue-700 mb-1">
        <span aria-hidden="true">{icon}</span> 
        <span className="ml-1">({count})</span>
      </div>
      <span className="sr-only">
        {label}: {count} milestone{count !== 1 ? "s" : ""}
      </span>

      {/* Total Dollar Amount */}
      <div className="text-base font-semibold text-gray-700">
        ${total.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </div>
    </div>
  );
}
