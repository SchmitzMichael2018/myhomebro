// frontend/src/components/step1/SaveTemplateModal.jsx
// v2026-03-11-phase1-template-modal — clearer reusable-template messaging, template context preview, future marketplace-ready wording

import React, { useEffect, useMemo, useState } from "react";
import { safeTrim } from "./step1Utils";

function InfoPill({ label, value }) {
  if (!safeTrim(value)) return null;

  return (
    <span className="inline-flex items-center rounded-full border border-sky-300/40 bg-sky-400/10 px-2.5 py-1 text-[11px] font-medium text-sky-50">
      <span className="mr-1 text-sky-200">{label}:</span>
      <span>{value}</span>
    </span>
  );
}

function normalizeScopeLine(text) {
  return safeTrim(text)
    .replace(/\s+/g, " ")
    .replace(/\b(?:on|at|for)\s+\d{1,6}\s+[A-Za-z0-9 .'-]+?\s+(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|court|ct\.?|circle|cir\.?|boulevard|blvd\.?|place|pl\.?|way)\b/gi, "")
    .replace(/\b\d{1,6}\s+[A-Za-z0-9 .'-]+?\s+(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|court|ct\.?|circle|cir\.?|boulevard|blvd\.?|place|pl\.?|way)\b/gi, "the project property")
    .replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}'s\b/g, "the customer's")
    .replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s*\d{4})?\b/gi, "the scheduled project date")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, "the scheduled project date")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "the scheduled project date")
    .replace(/\b\d+(?:\.\d+)?\s*(?:sq\.?\s*ft\.?|square feet|linear feet|lf|ft\.?|feet|in\.?|inches|yards?|yds?)\b/gi, "project-specific quantities")
    .replace(/\b\d+\s*(?:rooms?|windows?|doors?|gates?|fixtures?)\b/gi, "agreed quantities")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function milestoneTitle(row, index) {
  return safeTrim(row?.title) || safeTrim(row?.name) || `Milestone ${index + 1}`;
}

function milestoneDetail(row) {
  return (
    safeTrim(row?.description) ||
    safeTrim(row?.scope_summary) ||
    safeTrim(row?.summary) ||
    safeTrim(row?.details) ||
    safeTrim(row?.plan_details) ||
    safeTrim(row?.work_summary) ||
    safeTrim(row?.scope) ||
    ""
  );
}

function bulletizePlainScope(text) {
  const sanitized = normalizeScopeLine(text);
  if (!sanitized) return "";
  if (/^\s*(?:[-*]|Included Work:|Exclusions:|Customer Responsibilities:)/im.test(sanitized)) {
    return sanitized;
  }

  const parts = sanitized
    .split(/(?<=[.!?])\s+/)
    .map((line) => normalizeScopeLine(line).replace(/[.!?]+$/, ""))
    .filter(Boolean)
    .slice(0, 10);

  if (!parts.length) return sanitized;

  return [
    "Included Work:",
    ...parts.map((line) => `- ${line}`),
    "",
    "Exclusions:",
    "- Work outside the agreed template scope unless added by written change order.",
    "- Permit fees, hidden conditions, and owner-selected upgrades unless specifically included.",
  ].join("\n");
}

export function buildReusableScopeDraft({
  scopeDescription,
  projectTitle,
  projectType,
  projectSubtype,
  milestones,
} = {}) {
  const sourceScope = safeTrim(scopeDescription);
  if (sourceScope) return bulletizePlainScope(sourceScope);

  const reviewedMilestones = (Array.isArray(milestones) ? milestones : [])
    .filter(Boolean)
    .map((row, index) => ({
      title: normalizeScopeLine(milestoneTitle(row, index)),
      detail: normalizeScopeLine(milestoneDetail(row)),
    }))
    .filter((row) => row.title || row.detail);

  const context = [projectSubtype, projectType, projectTitle]
    .map((value) => normalizeScopeLine(value))
    .find(Boolean);
  const opening = context
    ? `- Provide labor, coordination, and standard materials support for reusable ${context.toLowerCase()} work.`
    : "- Provide labor, coordination, and standard materials support for the agreed project scope.";

  const included = reviewedMilestones.slice(0, 10).map((row) => {
    const detail = row.detail || `Complete the ${row.title.toLowerCase()} phase according to the approved template plan`;
    return `- ${row.title}: ${detail.replace(/[.!?]+$/, "")}.`;
  });

  return [
    "Included Work:",
    opening,
    ...(included.length
      ? included
      : ["- Review project conditions, prepare the work area, complete the agreed work, and perform final cleanup."]),
    "",
    "Exclusions:",
    "- Work outside the agreed template scope unless added by written change order.",
    "- Permit fees, hidden conditions, specialty engineering, and owner-selected upgrades unless specifically included.",
    "",
    "Customer Responsibilities:",
    "- Provide access to the work area and timely decisions on selections, approvals, and schedule coordination.",
  ].join("\n");
}

export default function SaveTemplateModal({
  open,
  onClose,
  onSubmit,
  busy,
  defaultName,
  defaultDescription,
  projectTitle,
  projectType,
  projectSubtype,
  milestoneCount,
  scopeDescription,
  milestones,
}) {
  const [name, setName] = useState(defaultName || "");
  const [description, setDescription] = useState(defaultDescription || "");
  const generatedScope = useMemo(
    () =>
      buildReusableScopeDraft({
        scopeDescription,
        projectTitle,
        projectType,
        projectSubtype,
        milestones,
      }),
    [scopeDescription, projectTitle, projectType, projectSubtype, milestones]
  );
  const [scope, setScope] = useState(generatedScope || "");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(defaultName || "");
    setDescription(defaultDescription || "");
    setScope(generatedScope || "");
    setIsActive(true);
  }, [open, defaultName, defaultDescription, generatedScope]);

  const trimmedName = useMemo(() => safeTrim(name), [name]);
  const trimmedDescription = useMemo(() => safeTrim(description), [description]);
  const trimmedScope = useMemo(() => safeTrim(scope), [scope]);
  const reviewedMilestones = useMemo(
    () => (Array.isArray(milestones) ? milestones.filter(Boolean) : []),
    [milestones]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="shrink-0 border-b px-5 py-4">
          <div className="text-base font-semibold text-gray-900">Save Agreement as Template</div>
          <div className="mt-1 text-sm text-gray-600">
            Save this agreement as a reusable contractor template for future jobs. This is the first
            step toward building your template library for MyHomeBro.
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div
            className="rounded-lg border border-sky-400/30 bg-slate-950 p-3 shadow-inner shadow-sky-950/30"
            data-testid="save-template-context-card"
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-sky-100">
              Template context
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <InfoPill label="Type" value={projectType} />
              <InfoPill label="Subtype" value={projectSubtype} />
              {milestoneCount != null ? (
                <span className="inline-flex items-center rounded-full border border-sky-300/40 bg-sky-400/10 px-2.5 py-1 text-[11px] font-medium text-sky-50">
                  <span className="mr-1 text-sky-200">Milestones:</span>
                  <span>{milestoneCount}</span>
                </span>
              ) : null}
            </div>
            <div className="mt-2 text-[11px] leading-5 text-sky-100/85">
              This saves your current project structure as a reusable starting point. You will still
              be able to edit project title, scope, pricing, and milestones on future agreements.
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                Reusable Scope
              </label>
              <button
                type="button"
                onClick={() => setScope(generatedScope)}
                disabled={busy || !generatedScope}
                data-testid="save-template-generate-reusable-scope"
                className="rounded-lg border border-sky-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-50 disabled:opacity-60"
              >
                Generate Reusable Scope
              </button>
            </div>
            <textarea
              data-testid="save-template-scope-input"
              className="mt-2 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm leading-6"
              rows={5}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="Describe the reusable scope in generic terms without job-specific measurements or pricing."
            />
            <div className="mt-1 text-[11px] text-slate-500">
              Keep this generic so it works across similar projects.
            </div>
          </div>

          {trimmedScope ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                Scope Preview
              </div>
              <div
                className="mt-2 text-sm leading-6 text-slate-700"
                data-testid="save-template-scope-preview"
              >
                {trimmedScope}
              </div>
            </div>
          ) : null}

          {reviewedMilestones.length ? (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                  Milestone structure
                </div>
                <div className="text-[11px] text-slate-500">
                  Review the order before saving
                </div>
              </div>
              <div className="mt-3 space-y-2" data-testid="save-template-milestone-preview">
                {reviewedMilestones.map((milestone, index) => {
                  const title =
                    safeTrim(milestone?.title) || safeTrim(milestone?.name) || `Milestone ${index + 1}`;
                  const detail = safeTrim(milestone?.description);
                  return (
                    <div
                      key={milestone?.id || `${title}-${index}`}
                      className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <div className="text-sm font-medium text-slate-800">
                        {index + 1}. {title}
                      </div>
                      {detail ? (
                        <div className="mt-1 text-xs leading-5 text-slate-600">{detail}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-sm font-medium">Template Name</label>
            <input
              data-testid="save-template-name-input"
              className="w-full rounded border px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Bedroom Addition - Standard 6 Milestone"
            />
            <div className="mt-1 text-[11px] text-gray-500">
              Use a reusable name contractors can recognize quickly later.
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Template Note (optional)</label>
            <textarea
              data-testid="save-template-note-input"
              className="w-full rounded border px-3 py-2 text-sm"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Internal note for your future use, such as common assumptions, exclusions, or when this template works best."
            />
            <div className="mt-1 text-[11px] text-gray-500">
              This is an internal template note, not the customer-facing agreement scope.
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Save as active template
          </label>

          <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-[11px] text-gray-600">
            Future-ready: active templates can later appear in your Template Library and Template
            Marketplace workflow.
          </div>
        </div>

        <div className="shrink-0 flex items-center justify-end gap-2 border-t px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            data-testid="save-template-cancel-button"
            className="rounded border px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() =>
              onSubmit?.({
                name: trimmedName,
                description: trimmedDescription,
                scope_description: trimmedScope,
                is_active: !!isActive,
              })
            }
            disabled={busy || !trimmedName}
            data-testid="save-template-confirm-button"
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy ? "Saving..." : "Save Template"}
          </button>
        </div>
      </div>
    </div>
  );
}
