import React from "react";

export default function TemplateImprovementPrompt({
  message,
  canUpdateSource = false,
  updating = false,
  onSaveAsNew,
  onUpdateSource,
  onDismiss,
  testId = "template-improvement-prompt",
}) {
  return (
    <div
      className="mt-3 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 shadow-sm dark:border-emerald-400/60 dark:bg-slate-950 dark:text-emerald-50"
      data-testid={testId}
    >
      <div className="font-semibold text-emerald-950 dark:text-white">{message}</div>
      <div className="mt-1 text-emerald-900/85 dark:text-emerald-100">
        You improved this agreement. Want future agreements to start this strong?
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSaveAsNew}
          className="rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
        >
          Save as New Template
        </button>
        {canUpdateSource ? (
          <button
            type="button"
            onClick={onUpdateSource}
            disabled={updating}
            className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            data-testid={`${testId}-update-source`}
          >
            {updating ? "Updating..." : "Update Source Template"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-xl border border-emerald-200 bg-emerald-100/70 px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
