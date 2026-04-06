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
}) {
  return (
    <div className={`mx-auto w-full max-w-[1440px] px-3 pb-7 pt-3 md:px-5 lg:px-7 xl:px-8 ${className}`.trim()}>
      <div
        className={`rounded-[30px] border border-slate-200/85 bg-white/90 p-4 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-6 lg:p-7 ${surfaceClassName}`.trim()}
      >
        {(title || subtitle || eyebrow || actions) ? (
          <div className="mb-5 flex flex-col gap-3.5 border-b border-slate-200/80 pb-4 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              {eyebrow ? (
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-600">
                  {eyebrow}
                </div>
              ) : null}
              {title ? <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 md:text-[2rem]">{title}</h1> : null}
              {subtitle ? (
                <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700 md:text-[15px]">
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
