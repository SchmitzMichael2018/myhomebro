import React from "react";

const TONE_STYLES = {
  info: "border-blue-200 bg-blue-50 text-blue-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  muted: "border-slate-200 bg-slate-50 text-slate-800",
};

export function WorkflowHint({ hint, className = "", testId }) {
  if (!hint?.body) return null;

  return (
    <div
      data-testid={testId}
      className={`rounded-2xl border px-4 py-3 shadow-sm ${TONE_STYLES[hint.tone || "info"]} ${className}`.trim()}
    >
      <div className="text-xs font-semibold uppercase tracking-wide opacity-80">
        {hint.title || "Next step"}
      </div>
      <div className="mt-1 text-sm">{hint.body}</div>
    </div>
  );
}

export function WorkflowHintList({ items = [], className = "", testId }) {
  if (!items.length) return null;

  return (
    <div
      data-testid={testId}
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`.trim()}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Next Steps
      </div>
      <div className="mt-3 space-y-2">
        {items.map((item, index) => (
          <div
            key={`${item}-${index}`}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
