import React from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { Button } from "./Button.jsx";
import { Card } from "./surfaces.jsx";
import { cx } from "./designSystemUtils.js";

const alertTones = {
  info: { classes: "border-blue-200 bg-blue-50 text-blue-950", icon: Info },
  success: { classes: "border-green-200 bg-green-50 text-green-950", icon: CheckCircle2 },
  warning: { classes: "border-amber-200 bg-amber-50 text-amber-950", icon: TriangleAlert },
  danger: { classes: "border-red-200 bg-red-50 text-red-950", icon: AlertCircle },
};

export function InlineAlert({ tone = "info", title = "", children, actions = null, className = "", ...props }) {
  const config = alertTones[tone] || alertTones.info;
  const Icon = config.icon;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex gap-3 rounded-xl border p-4", config.classes, className)} {...props}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title ? <div className="font-black">{title}</div> : null}
        <div className={cx("text-sm leading-6", title && "mt-1")}>{children}</div>
        {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description = "",
  icon: Icon,
  primaryAction = null,
  secondaryAction = null,
  tips = [],
  theme = "default",
  className = "",
  ...props
}) {
  return (
    <Card theme={theme} className={cx("flex flex-col items-center border-dashed px-6 py-10 text-center", className)} {...props}>
      {Icon ? <span className={cx("rounded-2xl p-3", theme === "operational" ? "bg-white/10 text-sky-100" : "bg-slate-100 text-slate-600")}><Icon className="h-7 w-7" aria-hidden="true" /></span> : null}
      <h2 className={cx("mt-4 text-lg font-black", theme === "operational" ? "text-white" : "text-slate-950")}>{title}</h2>
      {description ? <p className={cx("mt-2 max-w-xl text-sm leading-6", theme === "operational" ? "text-sky-100/75" : "text-slate-600")}>{description}</p> : null}
      {primaryAction || secondaryAction ? <div className="mt-5 flex flex-wrap justify-center gap-2">{primaryAction}{secondaryAction}</div> : null}
      {tips.length ? (
        <ul className={cx("mt-5 max-w-xl list-disc space-y-1 pl-5 text-left text-sm", theme === "operational" ? "text-sky-100/75" : "text-slate-600")}>
          {tips.map((tip, index) => <li key={`${tip}-${index}`}>{tip}</li>)}
        </ul>
      ) : null}
    </Card>
  );
}

const skeletonPresets = {
  card: ["h-5 w-2/5", "h-8 w-3/5", "h-4 w-full"],
  metric: ["h-4 w-1/2", "h-8 w-2/3", "h-3 w-1/3"],
  form: ["h-4 w-1/4", "h-10 w-full", "h-4 w-1/3", "h-10 w-full"],
  list: ["h-12 w-full", "h-12 w-full", "h-12 w-full"],
  table: ["h-10 w-full", "h-12 w-full", "h-12 w-full", "h-12 w-full"],
  workspace: ["h-8 w-1/3", "h-4 w-1/2", "h-32 w-full", "h-48 w-full"],
};

export function LoadingSkeleton({ variant = "card", rows, label = "Loading content", theme = "default", className = "", ...props }) {
  const preset = skeletonPresets[variant] || skeletonPresets.card;
  const lines = Number.isInteger(rows) && rows > 0 ? Array.from({ length: rows }, () => "h-4 w-full") : preset;
  return (
    <div role="status" aria-label={label} className={cx("animate-pulse space-y-3", className)} {...props}>
      {lines.map((classes, index) => <div key={index} className={cx("rounded-lg", theme === "operational" ? "bg-white/12" : "bg-slate-200", classes)} />)}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function AIUnavailableState({ title = "Project Assistant is unavailable", description = "Continue manually or try again later.", action = null, ...props }) {
  return <InlineAlert tone="warning" title={title} actions={action} {...props}>{description}</InlineAlert>;
}

export function AIErrorState({ title = "Project Assistant could not complete this request", message = "Your work was not changed.", retry = null, ...props }) {
  const actions = retry ? <Button variant="secondary" size="sm" onClick={retry}>Try again</Button> : null;
  return <InlineAlert tone="danger" title={title} actions={actions} {...props}>{message}</InlineAlert>;
}
