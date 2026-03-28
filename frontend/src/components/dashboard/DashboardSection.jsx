import React from "react";

export default function DashboardSection({
  title,
  subtitle,
  children,
  actions = null,
  testId,
  className = "",
  eyebrow,
}) {
  return (
    <section data-testid={testId} className={`space-y-4 ${className}`.trim()}>
      {(title || subtitle || actions || eyebrow) ? (
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            {eyebrow ? (
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                {eyebrow}
              </div>
            ) : null}
            {title ? <div className="text-xl font-bold text-slate-900">{title}</div> : null}
            {subtitle ? <div className="mt-1 text-sm text-slate-600">{subtitle}</div> : null}
          </div>
          {actions ? <div>{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
