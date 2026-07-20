import React from "react";

export default function ContractorPageSurface({
  eyebrow,
  title,
  subtitle,
  actions = null,
  children,
  className = "",
  surfaceClassName = "",
  contentClassName = "",
  variant = "default",
}) {
  const operational = variant === "operational";
  const lightConsole = variant === "light-console";
  const shellClass = operational || lightConsole
    ? "mhb-operational-surface min-w-0 w-full max-w-[1440px] px-3 pb-7 pt-3 md:px-5 lg:px-7 xl:px-8"
    : "min-w-0 w-full max-w-[1440px] px-3 pb-7 pt-3 md:px-5 lg:px-7 xl:px-8";
  const surfaceBase = operational || lightConsole
    ? "rounded-none border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
    : "rounded-[30px] border border-slate-200/85 bg-white/90 p-4 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-6 lg:p-7";
  const headerClass = operational
    ? "mb-5 flex flex-col gap-3.5 border-b border-white/10 pb-4 md:flex-row md:items-end md:justify-between"
    : lightConsole
    ? "mb-4 flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-end md:justify-between"
    : "mb-5 flex flex-col gap-3.5 border-b border-slate-200/80 pb-4 md:flex-row md:items-end md:justify-between";
  const eyebrowClass = operational
    ? "text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-100/70"
    : lightConsole
    ? "sr-only"
    : "text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-600";
  const titleClass = operational
    ? "mt-1 text-2xl font-bold tracking-tight text-white md:text-[2rem]"
    : lightConsole
    ? "text-2xl font-bold tracking-tight text-slate-950 md:text-[2rem]"
    : "mt-1 text-2xl font-bold tracking-tight text-slate-950 md:text-[2rem]";
  const subtitleClass = operational
    ? "mt-2 max-w-4xl text-sm leading-6 text-sky-100/80 md:text-[15px]"
    : lightConsole
    ? "mt-2 max-w-4xl text-sm leading-6 text-slate-600 md:text-[15px]"
    : "mt-2 max-w-4xl text-sm leading-6 text-slate-700 md:text-[15px]";

  return (
    <div className={`${shellClass} ${className}`.trim()}>
      <div
        className={`${surfaceBase} ${surfaceClassName}`.trim()}
      >
        {(title || subtitle || eyebrow || actions) ? (
          <div className={headerClass}>
            <div className="min-w-0">
              {eyebrow ? (
                <div className={eyebrowClass}>
                  {eyebrow}
                </div>
              ) : null}
              {title ? <h1 className={titleClass}>{title}</h1> : null}
              {subtitle ? (
                <p className={subtitleClass}>
                  {subtitle}
                </p>
              ) : null}
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        ) : null}
        <div className={`space-y-5 ${contentClassName}`.trim()}>{children}</div>
      </div>
    </div>
  );
}
