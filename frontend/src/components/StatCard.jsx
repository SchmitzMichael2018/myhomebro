// src/components/StatCard.jsx
import React from "react";

/**
 * StatCard
 * - Shows title, optional subtitle, and TWO metrics: count + amount
 * - Clickable; use onClick to drill down
 *
 * UPDATE (2025-12-03):
 *  - Hides "0 items" and "$0.00" when caller passes null instead of a number.
 *  - Allows non-financial cards (like Intro Rate) to suppress the amount line.
 */
export default function StatCard({
  icon: Icon,
  title,
  subtitle,
  count = null,
  amount = null,
  onClick,
}) {
  // SHOW count only if caller passed a real number
  const showCount =
    typeof count === "number" && Number.isFinite(count);

  // SHOW amount only if caller passed a real number
  const showAmount =
    typeof amount === "number" && Number.isFinite(amount);

  const fmtAmount =
    showAmount
      ? Number(amount).toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
        })
      : ""; // hide amount if null/undefined

  return (
    <div
      className="mhb-glass mhb-stat"
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => onClick && e.key === "Enter" && onClick()}
      title={onClick ? "Click to drill down" : undefined}
      style={{ minHeight: 124 }}
    >
      <div className="mhb-stat-head">
        <div className="mhb-stat-icon">
          {Icon ? <Icon size={18} /> : null}
        </div>
        <div style={{ fontSize: 16 }}>{title}</div>
      </div>

      {subtitle ? (
        <div className="mhb-stat-sub">{subtitle}</div>
      ) : null}

      {(showCount || showAmount) && (
        <div
          className="mhb-stat-foot"
          style={{ alignItems: "center" }}
        >
          {/* COUNT block */}
          {showCount ? (
            <div className="mhb-stat-count">
              <strong style={{ fontWeight: 900 }}>{count}</strong>
              <span style={{ marginLeft: 6, color: "#94a3b8" }}>
                items
              </span>
            </div>
          ) : (
            <div /> // placeholder so layout doesn’t shift
          )}

          {/* AMOUNT block */}
          {showAmount ? (
            <div className="mhb-stat-value">{fmtAmount}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
