import React from "react";

export default function DashboardSection({
  title,
  subtitle,
  children,
  actions = null,
  testId,
  className = "",
  eyebrow,
  variant = "default",
}) {
  const premium = variant === "premium";
  return (
    <section data-testid={testId} className={`space-y-3.5 ${className}`.trim()}>
      {(title || subtitle || actions || eyebrow) ? (
        <div className="flex flex-col gap-2.5 md:flex-row md:items-end md:justify-between">
          <div>
            {eyebrow ? (
              <div className={`text-[11px] font-semibold uppercase tracking-[0.2em] ${premium ? "text-sky-200" : "text-[#40618e]"}`}>
                {eyebrow}
              </div>
            ) : null}
            {title ? <div className={`text-[1.4rem] font-bold tracking-[-0.01em] md:text-[1.55rem] ${premium ? "text-white" : "text-[#19395f]"}`}>{title}</div> : null}
            {subtitle ? <div className={`mt-1.5 text-sm font-medium leading-6 ${premium ? "text-sky-100/80" : "text-slate-700"}`}>{subtitle}</div> : null}
          </div>
          {actions ? <div>{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
