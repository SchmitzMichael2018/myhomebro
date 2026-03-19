// frontend/src/components/step1/SaveTemplateModal.jsx
// v2026-03-11-phase1-template-modal — clearer reusable-template messaging, template context preview, future marketplace-ready wording

import React, { useEffect, useMemo, useState } from "react";
import { safeTrim } from "./step1Utils";

function InfoPill({ label, value }) {
  if (!safeTrim(value)) return null;

  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
      <span className="mr-1 text-slate-500">{label}:</span>
      <span>{value}</span>
    </span>
  );
}

export default function SaveTemplateModal({
  open,
  onClose,
  onSubmit,
  busy,
  defaultName,
  defaultDescription,
  projectType,
  projectSubtype,
  milestoneCount,
}) {
  const [name, setName] = useState(defaultName || "");
  const [description, setDescription] = useState(defaultDescription || "");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(defaultName || "");
    setDescription(defaultDescription || "");
    setIsActive(true);
  }, [open, defaultName, defaultDescription]);

  const trimmedName = useMemo(() => safeTrim(name), [name]);
  const trimmedDescription = useMemo(() => safeTrim(description), [description]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="border-b px-5 py-4">
          <div className="text-base font-semibold text-gray-900">Save Agreement as Template</div>
          <div className="mt-1 text-sm text-gray-600">
            Save this agreement as a reusable contractor template for future jobs. This is the first
            step toward building your template library for MyHomeBro.
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-indigo-900">
              Template context
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <InfoPill label="Type" value={projectType} />
              <InfoPill label="Subtype" value={projectSubtype} />
              {milestoneCount != null ? (
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                  <span className="mr-1 text-slate-500">Milestones:</span>
                  <span>{milestoneCount}</span>
                </span>
              ) : null}
            </div>
            <div className="mt-2 text-[11px] text-indigo-900/80">
              This saves your current project structure as a reusable starting point. You will still
              be able to edit project title, scope, pricing, and milestones on future agreements.
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Template Name</label>
            <input
              className="w-full rounded border px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Bedroom Addition – Standard 6 Milestone"
            />
            <div className="mt-1 text-[11px] text-gray-500">
              Use a reusable name contractors can recognize quickly later.
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Template Note (optional)</label>
            <textarea
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

        <div className="flex items-center justify-end gap-2 border-t px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
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
                is_active: !!isActive,
              })
            }
            disabled={busy || !trimmedName}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save Template"}
          </button>
        </div>
      </div>
    </div>
  );
}