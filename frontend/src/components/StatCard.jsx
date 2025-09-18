// src/components/StatCard.jsx
import React from "react";

/**
 * StatCard
 * - Shows title, optional subtitle, and TWO metrics: count + amount
 * - Clickable; use onClick to drill down
 */
export default function StatCard({
  icon: Icon,
  title,
  subtitle,
  count = 0,
  amount = 0,
  onClick,
}) {
  const fmtAmount =
    Number.isFinite(Number(amount))
      ? Number(amount).toLocaleString("en-US", { style: "currency", currency: "USD" })
      : String(amount || "$0.00");

  return (
    <div
      className="mhb-glass mhb-stat"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick?.()}
      title="Click to drill down"
      style={{ minHeight: 124 }}
    >
      <div className="mhb-stat-head">
        <div className="mhb-stat-icon">{Icon ? <Icon size={18} /> : null}</div>
        <div style={{ fontSize: 16 }}>{title}</div>
      </div>
      {subtitle ? <div className="mhb-stat-sub">{subtitle}</div> : null}
      <div className="mhb-stat-foot" style={{ alignItems: "center" }}>
        <div className="mhb-stat-count">
          <strong style={{ fontWeight: 900 }}>{count}</strong>
          <span style={{ marginLeft: 6, color: "#94a3b8" }}>items</span>
        </div>
        <div className="mhb-stat-value">{fmtAmount}</div>
      </div>
    </div>
  );
}
