import React, { useId } from "react";
import { Card } from "./surfaces.jsx";
import { cx } from "./designSystemUtils.js";

export function FormSection({ title, description = "", actions = null, children, className = "", ...props }) {
  return (
    <Card className={className} {...props}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-950">{title}</h2>
          {description ? <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="mt-5 grid gap-4">{children}</div>
    </Card>
  );
}

export function FormField({
  label,
  htmlFor = "",
  required = false,
  helperText = "",
  error = "",
  children,
  className = "",
  ...props
}) {
  const generatedId = useId();
  const controlId = htmlFor || `mhb-field-${generatedId.replace(/:/g, "")}`;
  const helpId = `${controlId}-help`;
  const errorId = `${controlId}-error`;

  return (
    <div className={cx("grid gap-2", className)} {...props}>
      <label htmlFor={controlId} className="text-sm font-bold text-slate-900">
        {label}
        {required ? <span className="ml-1 text-red-600" aria-hidden="true">*</span> : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>
      {typeof children === "function"
        ? children({
            id: controlId,
            "aria-invalid": error ? true : undefined,
            "aria-describedby": error ? errorId : helperText ? helpId : undefined,
            required,
          })
        : children}
      {helperText && !error ? <p id={helpId} className="text-xs leading-5 text-slate-500">{helperText}</p> : null}
      {error ? <p id={errorId} role="alert" className="text-xs font-semibold leading-5 text-red-700">{error}</p> : null}
    </div>
  );
}
