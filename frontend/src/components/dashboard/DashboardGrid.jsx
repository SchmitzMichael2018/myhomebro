import React from "react";

export default function DashboardGrid({ children, className = "", columns = "default" }) {
  const columnClass =
    columns === "narrow"
      ? "grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      : "grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4";

  return <div className={`grid ${columnClass} ${className}`.trim()}>{children}</div>;
}
