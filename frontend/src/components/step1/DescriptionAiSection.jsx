// frontend/src/components/step1/DescriptionAiSection.jsx
// v2026-03-11-phase1-scope-clarity — clearer distinction between title vs scope; improved AI wording and scope-first guidance

import React from "react";
import { safeTrim } from "./step1Utils";

export default function DescriptionAiSection({
  locked,
  dLocal,
  onLocalChange,
  isNewAgreement,
  writeCache,
  schedulePatch,
  patchAgreement,
  aiCredits,
  aiBlockedByCredits,
  aiBusy,
  aiErr,
  aiPreview,
  setAiPreview,
  refreshAiCredits,
  runAiDescription,
  applyAiDescription,
  hasSomeContext,
}) {
  const aiCreditText = aiCredits.loading
    ? "AI Credits: —"
    : aiCredits.remaining == null
    ? "AI Credits: —"
    : `AI Credits: ${aiCredits.remaining} remaining`;

  return (
    <div className="md:col-span-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="block text-sm font-medium">Description / Scope of Work</label>
      </div>

      <div className="mb-2 text-xs leading-5 text-gray-600">
        This is the actual project scope for the agreement. Describe the work clearly enough that
        the customer understands what is included, and both sides can avoid disputes later.
        Project Title is just the label — this Description is the real scope.
      </div>

      <textarea
        className="w-full rounded border px-3 py-2 text-sm"
        rows={6}
        name="description"
        value={dLocal.description}
        onChange={
          locked
            ? undefined
            : (e) => {
                onLocalChange(e);
                if (!isNewAgreement) {
                  writeCache({ description: e.target.value });
                  schedulePatch({ description: e.target.value });
                }
              }
        }
        onBlur={() => {
          if (!locked && !isNewAgreement) {
            patchAgreement({ description: safeTrim(dLocal.description) }, { silent: true });
          }
        }}
        placeholder="Example: Remove existing materials, prepare surfaces, install new materials, complete finish work, and clean the job site..."
        disabled={locked}
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-gray-600">
          ✨ AI Assist can turn a rough idea into a clearer, stronger, more dispute-resistant scope.
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
              aiCredits.loading
                ? "bg-slate-100 text-slate-700"
                : aiBlockedByCredits
                ? "bg-rose-100 text-rose-800"
                : "bg-emerald-100 text-emerald-800"
            }`}
            title="1 credit = 1 AI-written agreement scope action"
          >
            {aiCreditText}
          </span>

          <button
            type="button"
            onClick={refreshAiCredits}
            className="rounded border px-2 py-1 text-[11px] hover:bg-gray-50 disabled:opacity-60"
            title="Refresh AI credits"
            disabled={locked}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-2 flex w-full flex-wrap gap-2">
        <button
          type="button"
          onClick={() => runAiDescription("improve")}
          disabled={locked || aiBusy || !safeTrim(dLocal.description) || aiBlockedByCredits}
          className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
          title="Improve the existing scope wording"
        >
          {aiBusy ? "Working…" : "✨ Improve Existing Scope"}
        </button>

        <button
          type="button"
          onClick={() => runAiDescription("generate")}
          disabled={locked || aiBusy || !hasSomeContext || aiBlockedByCredits}
          className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
          title="Generate a first scope draft from type, subtype, title, and current context"
        >
          {aiBusy ? "Working…" : "✨ Generate Scope Draft"}
        </button>
      </div>

      <div className="mt-2 text-[11px] text-gray-500">
        Use AI as a starting point. Review and edit the final scope so it accurately reflects the
        work you are agreeing to perform.
      </div>

      {aiErr ? <div className="mt-2 text-xs text-red-600">{aiErr}</div> : null}

      {aiPreview ? (
        <div className="mt-3 rounded-md border bg-indigo-50 p-3">
          <div className="mb-2 text-xs font-semibold text-indigo-900">
            AI Suggested Scope Draft
          </div>

          <div className="text-sm whitespace-pre-wrap text-indigo-900">{aiPreview}</div>

          <div className="mt-2 text-[11px] text-indigo-900/80">
            Review this draft before using it. Make sure it matches the actual work, assumptions,
            exclusions, and expectations for this agreement.
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => applyAiDescription("replace")}
              disabled={locked}
              className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              Replace Description
            </button>

            <button
              type="button"
              onClick={() => applyAiDescription("append")}
              disabled={locked}
              className="rounded border px-3 py-1.5 text-xs disabled:opacity-60"
            >
              Append to Description
            </button>

            <button
              type="button"
              onClick={() => setAiPreview("")}
              className="rounded border px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}