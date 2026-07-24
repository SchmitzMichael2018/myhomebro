import React from "react";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  FileText,
  Flag,
  Handshake,
  Receipt,
  ShieldCheck,
  User,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
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
  theme = "default",
  interactive = false,
  className = "",
  children,
  ...props
}) {
  return (
    <Component
      className={cx(
        "rounded-2xl border",
        theme === "operational"
          ? "border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] text-[var(--mhb-text-primary)] shadow-[var(--mhb-shadow-card)]"
          : "border-slate-200 bg-white shadow-sm",
        cardPadding[padding] ?? cardPadding.md,
        interactive && (theme === "operational"
          ? "bg-[var(--mhb-surface-interactive)] transition hover:-translate-y-px hover:border-[var(--mhb-border-strong)] hover:bg-[var(--mhb-surface-interactive-hover)] hover:shadow-[var(--mhb-shadow-interactive)]"
          : "transition hover:-translate-y-px hover:border-slate-300 hover:shadow-md"),
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
  theme = "default",
  className = "",
  ...props
}) {
  const visual = metricVisualFor(label);
  const MetricIcon = Icon || visual.icon;

  return (
    <Card theme={theme} className={cx("min-w-0", className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={cx("text-sm font-semibold", theme === "operational" ? "text-[var(--mhb-text-secondary)]" : "text-slate-600")}>{label}</div>
          <div className={cx("mt-2 break-words text-2xl font-black tabular-nums", theme === "operational" ? "text-[var(--mhb-text-primary)]" : "text-slate-950")}>{value}</div>
        </div>
        {MetricIcon ? (
          <span
            className={cx(
              "rounded-xl border p-2",
              theme === "operational"
                ? "border-[var(--mhb-border-default)] bg-[var(--mhb-surface-subtle)]"
                : "border-current/10 bg-blue-50",
              metricToneClasses[visual.tone]
            )}
            data-metric-icon-tone={visual.tone}
          >
            <MetricIcon className="h-5 w-5" aria-hidden="true" />
          </span>
        ) : null}
      </div>
      {description || trend || status ? (
        <div className={cx("mt-3 flex flex-wrap items-center gap-2 text-xs", theme === "operational" ? "text-[var(--mhb-text-muted)]" : "text-slate-500")}>
          {description ? <span>{description}</span> : null}
          {trend ? <span className="font-bold">{trend}</span> : null}
          {status ? <StatusBadge status={status} theme={theme} /> : null}
        </div>
      ) : null}
    </Card>
  );
}

const metricToneClasses = {
  blue: "text-blue-500",
  green: "text-emerald-500",
  amber: "text-amber-500",
  orange: "text-orange-500",
  purple: "text-violet-500",
  red: "text-rose-500",
  gray: "text-slate-500",
};

export function metricVisualFor(label = "") {
  const normalized = String(label).trim().toLowerCase();

  if (/subcontract|vendor|partner/.test(normalized)) return { icon: Handshake, tone: "orange" };
  if (/pending invitation|invite/.test(normalized)) return { icon: UserPlus, tone: "amber" };
  if (/incomplete profile|profile issue/.test(normalized)) return { icon: AlertTriangle, tone: "purple" };
  if (/inactive|disabled/.test(normalized)) return { icon: UserMinus, tone: "gray" };
  if (/active account|verified|complete|paid/.test(normalized)) return { icon: CheckCircle2, tone: "green" };
  if (/employee|team|workforce|member/.test(normalized)) return { icon: Users, tone: "orange" };
  if (/payment|payout|revenue|earn|amount|escrow|fund/.test(normalized)) return { icon: CircleDollarSign, tone: "green" };
  if (/invoice|receipt|expense/.test(normalized)) return { icon: Receipt, tone: "amber" };
  if (/project|job|work/.test(normalized)) return { icon: BriefcaseBusiness, tone: "blue" };
  if (/customer|homeowner|client|profile|identity/.test(normalized)) return { icon: User, tone: "purple" };
  if (/milestone|stage|review/.test(normalized)) return { icon: Flag, tone: "blue" };
  if (/template|checklist/.test(normalized)) return { icon: ClipboardList, tone: "blue" };
  if (/warrant|coverage|protection/.test(normalized)) return { icon: ShieldCheck, tone: "green" };
  if (/dispute|resolution|issue|blocked|overdue|rejected|suspended/.test(normalized)) return { icon: AlertTriangle, tone: "red" };
  if (/agreement|document|draft|record/.test(normalized)) return { icon: FileText, tone: "blue" };
  if (/contractor|user|account|listing/.test(normalized)) return { icon: Users, tone: "purple" };

  return { icon: ClipboardList, tone: "blue" };
}

const statusClasses = {
  complete: "border-[var(--mhb-status-complete-border)] bg-[var(--mhb-status-complete-bg)] text-[var(--mhb-status-complete-text)]",
  recommended: "border-[var(--mhb-status-recommended-border)] bg-[var(--mhb-status-recommended-bg)] text-[var(--mhb-status-recommended-text)]",
  required: "border-[var(--mhb-status-required-border)] bg-[var(--mhb-status-required-bg)] text-[var(--mhb-status-required-text)]",
  blocked: "border-[var(--mhb-status-blocked-border)] bg-[var(--mhb-status-blocked-bg)] text-[var(--mhb-status-blocked-text)]",
  pending: "border-[var(--mhb-status-pending-border)] bg-[var(--mhb-status-pending-bg)] text-[var(--mhb-status-pending-text)]",
  draft: "border-[var(--mhb-status-draft-border)] bg-[var(--mhb-status-draft-bg)] text-[var(--mhb-status-draft-text)]",
  published: "border-[var(--mhb-status-published-border)] bg-[var(--mhb-status-published-bg)] text-[var(--mhb-status-published-text)]",
};

export function StatusBadge({ status = "draft", label = "", theme = "default", className = "", ...props }) {
  const normalized = String(status || "draft").trim().toLowerCase();
  return (
    <span
      className={cx(
        "inline-flex w-fit items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold shadow-[inset_0_1px_0_rgb(255_255_255_/_0.06)]",
        statusClasses[normalized] || statusClasses.draft,
        className
      )}
      {...props}
    >
      {label || humanizeStatus(normalized)}
    </span>
  );
}

export function SettingsSection({ title, description = "", actions = null, children, theme = "default", className = "", ...props }) {
  return (
    <Card theme={theme} className={className} {...props}>
      <div className={cx(
        "flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between",
        theme === "operational" ? "border-[var(--mhb-border-divider)]" : "border-slate-200"
      )}>
        <div>
          <h2 className={cx("text-lg font-black", theme === "operational" ? "text-[var(--mhb-text-primary)]" : "text-slate-950")}>{title}</h2>
          {description ? <p className={cx("mt-1 text-sm leading-6", theme === "operational" ? "text-[var(--mhb-text-muted)]" : "text-slate-600")}>{description}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="mt-5 space-y-5">{children}</div>
    </Card>
  );
}
