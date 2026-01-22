import React from "react";

/**
 * StatCard
 * - Shows title, optional subtitle, and TWO metrics: count + amount
 * - Clickable; use onClick to drill down
 *
 * FIX (2026-01):
 *  - Prevents default + propagation to avoid form submit / page reload
 *  - Keyboard-safe
 */
export default function StatCard({
  icon: Icon,
  title,
  subtitle,
  count = null,
  amount = null,
  onClick,
}) {
  const showCount =
    typeof count === "number" && Number.isFinite(count);

  const showAmount =
    typeof amount === "number" && Number.isFinite(amount);

  const fmtAmount =
    showAmount
      ? Number(amount).toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
        })
      : "";

  const handleClick = (e) => {
    if (!onClick) return;
    e.preventDefault();
    e.stopPropagation();
    onClick();
  };

  const handleKeyDown = (e) => {
    if (!onClick) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    }
  };

  return (
    <div
      className="mhb-glass mhb-stat"
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
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
        <div className="mhb-stat-foot" style={{ alignItems: "center" }}>
          {showCount ? (
            <div className="mhb-stat-count">
              <strong style={{ fontWeight: 900 }}>{count}</strong>
              <span style={{ marginLeft: 6, color: "#94a3b8" }}>
                items
              </span>
            </div>
          ) : (
            <div />
          )}

          {showAmount ? (
            <div className="mhb-stat-value">{fmtAmount}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
