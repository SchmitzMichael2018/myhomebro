import React from "react";
import { CheckCircle2, ClipboardCheck, Sparkles } from "lucide-react";
import { AIActionButton, Button } from "./Button.jsx";
import { Card, StatusBadge } from "./surfaces.jsx";
import { InlineAlert } from "./feedback.jsx";
import { cx } from "./designSystemUtils.js";

export function AISuggestionCard({
  title = "Project Assistant suggestion",
  description = "",
  children,
  confidence = "",
  onReview,
  onDismiss,
  className = "",
  ...props
}) {
  return (
    <Card className={cx("border-indigo-200 bg-indigo-50/60", className)} {...props}>
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-indigo-100 p-2 text-indigo-700"><Sparkles className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-black text-slate-950">{title}</h3>
            {confidence ? <span className="text-xs font-bold text-slate-500">{confidence}</span> : null}
          </div>
          {description ? <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p> : null}
          {children ? <div className="mt-3">{children}</div> : null}
          {onReview || onDismiss ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {onReview ? <AIActionButton size="sm" onClick={onReview}>Review suggestion</AIActionButton> : null}
              {onDismiss ? <Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button> : null}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

const lifecycle = ["prepare", "preview", "validate", "confirm", "apply", "receipt"];

export function AIReviewCard({
  title = "Review Project Assistant changes",
  description = "Review and confirm before anything is applied.",
  stage = "preview",
  preview,
  validation = null,
  onConfirm,
  onCancel,
  confirmLabel = "Confirm and apply",
  loading = false,
  className = "",
  ...props
}) {
  const normalizedStage = lifecycle.includes(stage) ? stage : "preview";
  return (
    <Card className={cx("border-indigo-200", className)} {...props}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-wider text-indigo-700">Project Assistant</div>
          <h3 className="mt-1 text-lg font-black text-slate-950">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
        </div>
        <StatusBadge status={normalizedStage === "receipt" ? "complete" : "pending"} label={normalizedStage} />
      </div>
      <ol aria-label="AI action lifecycle" className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {lifecycle.map((item, index) => {
          const currentIndex = lifecycle.indexOf(normalizedStage);
          const reached = index <= currentIndex;
          return <li key={item} aria-current={item === normalizedStage ? "step" : undefined} className={cx("rounded-lg border px-2 py-2 text-center text-[11px] font-bold capitalize", reached ? "border-indigo-200 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-slate-50 text-slate-400")}>{item}</li>;
        })}
      </ol>
      {preview ? <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">{preview}</div> : null}
      {validation}
      {onConfirm || onCancel ? (
        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
          {onCancel ? <Button variant="secondary" onClick={onCancel}>Cancel</Button> : null}
          {onConfirm ? <AIActionButton loading={loading} loadingLabel="Applying..." onClick={onConfirm}>{confirmLabel}</AIActionButton> : null}
        </div>
      ) : null}
    </Card>
  );
}

export function AIActionReceipt({ title = "Changes applied", description = "", details = [], reference = "", ...props }) {
  return (
    <InlineAlert tone="success" title={title} {...props}>
      {description ? <p>{description}</p> : null}
      {details.length ? <ul className="mt-2 list-disc space-y-1 pl-5">{details.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : null}
      {reference ? <div className="mt-2 text-xs font-bold">Receipt: {reference}</div> : null}
    </InlineAlert>
  );
}

export function AIValidationSummary({ valid = false, children }) {
  return (
    <div className={cx("mt-4 flex gap-2 rounded-xl border p-3 text-sm", valid ? "border-green-200 bg-green-50 text-green-900" : "border-amber-200 bg-amber-50 text-amber-900")}>
      {valid ? <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" /> : <ClipboardCheck className="h-5 w-5 shrink-0" aria-hidden="true" />}
      <div>{children}</div>
    </div>
  );
}
