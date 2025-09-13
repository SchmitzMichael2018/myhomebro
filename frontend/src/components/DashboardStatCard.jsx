// src/components/DashboardStatCard.jsx
import React from "react";

/**
 * DashboardStatCard
 * Props:
 *  - title: string
 *  - description?: string
 *  - count: number
 *  - amount: number
 *  - icon?: string | ReactNode   (defaults to emoji)
 *  - onClick?: () => void
 */
export default function DashboardStatCard({
  title,
  description = "",
  count = 0,
  amount = 0,
  icon = "📊",
  onClick,
}) {
  const fmtUSD = (v) =>
    (Number(v || 0) || 0).toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    });

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={[
        "group relative cursor-pointer",
        "bg-white rounded-2xl shadow-sm border border-slate-200",
        "hover:shadow-md hover:border-slate-300",
        "transition-all duration-150",
      ].join(" ")}
      aria-label={`${title}: ${count} items, ${fmtUSD(amount)}`}
    >
      {/* top-right icon pill */}
      <div className="absolute right-3 top-3 rounded-full bg-blue-50 text-blue-700 px-2 py-1 text-xs font-bold">
        <span aria-hidden="true">{icon}</span>
      </div>

      <div className="p-4">
        <div className="text-[15.5px] font-extrabold text-slate-800">{title}</div>
        {description ? (
          <div className="mt-0.5 text-[12.5px] text-slate-500 leading-snug">
            {description}
          </div>
        ) : null}

        <div className="mt-3 flex items-end justify-between">
          <div className="text-blue-700 font-semibold text-sm">({count})</div>
          <div className="text-slate-900 font-extrabold text-[15.5px]">
            {fmtUSD(amount)}
          </div>
        </div>
      </div>

      {/* subtle focus ring */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-0 ring-blue-400/40 group-active:ring-4 group-focus:ring-4" />
    </div>
  );
}
