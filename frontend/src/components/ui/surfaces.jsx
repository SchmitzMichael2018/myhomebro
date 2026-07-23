import React from "react";
import { cx, humanizeStatus } from "./designSystemUtils.js";

const cardPadding = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

export function Card({
  as: Component = "section",
  padding = "md",
  interactive = false,
  className = "",
  children,
  ...props
}) {
  return (
    <Component
      className={cx(
        "rounded-2xl border border-slate-200 bg-white shadow-sm",
        cardPadding[padding] ?? cardPadding.md,
        interactive && "transition hover:-translate-y-px hover:border-slate-300 hover:shadow-md",
        className
      )}
      {...props}
    >
      {children}
    </Component>
  );
}

export function MetricCard({
  label,
  value,
  description = "",
  trend = "",
  icon: Icon,
  status,
  className = "",
  ...props
}) {
  return (
    <Card className={cx("min-w-0", className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-600">{label}</div>
          <div className="mt-2 break-words text-2xl font-black tabular-nums text-slate-950">{value}</div>
        </div>
        {Icon ? <span className="rounded-xl bg-blue-50 p-2 text-blue-700"><Icon className="h-5 w-5" aria-hidden="true" /></span> : null}
      </div>
      {description || trend || status ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {description ? <span>{description}</span> : null}
          {trend ? <span className="font-bold">{trend}</span> : null}
          {status ? <StatusBadge status={status} /> : null}
        </div>
      ) : null}
    </Card>
  );
}

const statusClasses = {
  complete: "border-green-200 bg-green-100 text-green-800",
  recommended: "border-blue-200 bg-blue-100 text-blue-800",
  required: "border-orange-200 bg-orange-100 text-orange-800",
  blocked: "border-red-200 bg-red-100 text-red-800",
  pending: "border-amber-200 bg-amber-100 text-amber-800",
  draft: "border-slate-200 bg-slate-100 text-slate-700",
  published: "border-teal-200 bg-teal-100 text-teal-800",
};

export function StatusBadge({ status = "draft", label = "", className = "", ...props }) {
  const normalized = String(status || "draft").trim().toLowerCase();
  return (
    <span
      className={cx(
        "inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-bold",
        statusClasses[normalized] || statusClasses.draft,
        className
      )}
      {...props}
    >
      {label || humanizeStatus(normalized)}
    </span>
  );
}

export function SettingsSection({ title, description = "", actions = null, children, className = "", ...props }) {
  return (
    <Card className={className} {...props}>
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-950">{title}</h2>
          {description ? <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="mt-5 space-y-5">{children}</div>
    </Card>
  );
}
