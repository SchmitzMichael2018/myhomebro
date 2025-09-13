// src/components/StatCard.jsx
import React from "react";

export default function StatCard({ icon, title, subtitle, amount, count, onClick }) {
  const Icon = icon;
  return (
    <div
      className="mhb-glass mhb-stat"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick?.()}
      title="Click to drill down"
    >
      <div className="mhb-stat-head">
        <div className="mhb-stat-icon">{Icon ? <Icon size={18} /> : null}</div>
        <div style={{ fontSize: 16 }}>{title}</div>
      </div>
      {subtitle ? <div className="mhb-stat-sub">{subtitle}</div> : null}
      <div className="mhb-stat-foot">
        <div className="mhb-stat-count">({count || 0})</div>
        <div className="mhb-stat-value">{amount}</div>
      </div>
    </div>
  );
}
