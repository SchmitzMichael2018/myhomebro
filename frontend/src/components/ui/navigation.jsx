import React, { useState } from "react";
import { Check, ChevronRight, MoreHorizontal } from "lucide-react";
import { Button, AIActionButton } from "./Button.jsx";
import { StatusBadge } from "./surfaces.jsx";
import { cx } from "./designSystemUtils.js";

export function WorkspacePageHeader({
  title,
  subtitle = "",
  status = "",
  breadcrumbs = [],
  summary = null,
  primaryAction = null,
  secondaryActions = null,
  onOpenProjectAssistant = null,
  className = "",
  ...props
}) {
  return (
    <header className={cx("space-y-4", className)} {...props}>
      {breadcrumbs.length ? (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-slate-500">
            {breadcrumbs.map((item, index) => (
              <li key={item.label || index} className="flex items-center gap-1">
                {index ? <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                {item.href ? <a href={item.href} className="font-semibold hover:text-blue-700">{item.label}</a> : <span aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}>{item.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{title}</h1>
            {status ? <StatusBadge status={status} /> : null}
          </div>
          {subtitle ? <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{subtitle}</p> : null}
          {summary ? <div className="mt-3 text-sm text-slate-700">{summary}</div> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {secondaryActions}
          {onOpenProjectAssistant ? <AIActionButton onClick={onOpenProjectAssistant}>Project Assistant</AIActionButton> : null}
          {primaryAction}
        </div>
      </div>
    </header>
  );
}

export function FilterToolbar({ label = "Table filters", filters = null, search = null, actions = null, activeFilters = null, className = "", ...props }) {
  return (
    <section aria-label={label} className={cx("rounded-xl border border-slate-200 bg-white p-3", className)} {...props}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">{search}{filters}</div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      {activeFilters ? <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">{activeFilters}</div> : null}
    </section>
  );
}

export function WorkspaceStepNavigation({ steps = [], activeStep, onStepChange, label = "Workspace progress", className = "", ...props }) {
  return (
    <nav aria-label={label} className={cx("overflow-x-auto", className)} {...props}>
      <ol className="flex min-w-max gap-2">
        {steps.map((step, index) => {
          const key = step.id ?? index;
          const active = key === activeStep || step.active;
          const complete = step.complete;
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => onStepChange?.(key)}
                disabled={step.disabled}
                aria-current={active ? "step" : undefined}
                className={cx(
                  "inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50",
                  active ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                )}
              >
                <span className={cx("grid h-5 w-5 place-items-center rounded-full text-xs", complete ? "bg-green-100 text-green-700" : active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600")}>
                  {complete ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : step.number ?? index + 1}
                </span>
                {step.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function ActionMenu({ label = "More actions", items = [], open, onOpenChange, className = "", ...props }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  function setOpen(nextOpen) {
    if (!isControlled) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  return (
    <div className={cx("relative inline-flex", className)} {...props}>
      <Button variant="icon" aria-label={label} aria-haspopup="menu" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)}>
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </Button>
      {isOpen ? (
        <div role="menu" className="absolute right-0 top-full z-20 mt-2 min-w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          {items.map((item, index) => {
            const ItemIcon = item.icon;
            return (
              <button
                key={item.key || item.label || index}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={(event) => {
                  item.onClick?.(event);
                  setOpen(false);
                }}
                className={cx("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-slate-100 disabled:opacity-50", item.danger ? "text-red-700" : "text-slate-700")}
              >
                {ItemIcon ? <ItemIcon className="h-4 w-4" aria-hidden="true" /> : null}
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
