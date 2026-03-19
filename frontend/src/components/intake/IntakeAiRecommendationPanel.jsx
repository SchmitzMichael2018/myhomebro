// frontend/src/components/intake/IntakeAiRecommendationPanel.jsx

import React from "react";

export default function IntakeAiRecommendationPanel({
  result,
  analyzing,
  converting,
  onAnalyze,
  onConvert,
  canAnalyze = true,
  canConvert = false,
}) {
  const milestones = Array.isArray(result?.milestones) ? result.milestones : [];
  const clarifications = Array.isArray(result?.clarification_questions)
    ? result.clarification_questions
    : [];

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">AI Project Analysis</h2>
          <p className="mt-1 text-sm text-gray-600">
            Analyze the intake, recommend a template if one exists, or generate a draft structure.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAnalyze}
            disabled={!canAnalyze || analyzing}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {analyzing ? "Analyzing..." : "Analyze Project"}
          </button>

          <button
            type="button"
            onClick={onConvert}
            disabled={!canConvert || converting}
            className="rounded border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
          >
            {converting ? "Creating..." : "Create Agreement"}
          </button>
        </div>
      </div>

      {!result ? (
        <div className="mt-4 rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-600">
          No analysis yet. Fill out the intake form and click <b>Analyze Project</b>.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="rounded-lg border bg-indigo-50/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-gray-900">
                Suggested Project Title:
              </div>
              <div className="text-sm text-gray-800">{result.project_title || "—"}</div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {result.template_name ? (
                <span className="rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-800">
                  Template: {result.template_name}
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">
                  No exact template found
                </span>
              )}

              {result.confidence ? (
                <span className="rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-800">
                  Confidence: {result.confidence}
                </span>
              ) : null}

              {result.project_type ? (
                <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">
                  Type: {result.project_type}
                </span>
              ) : null}

              {result.project_subtype ? (
                <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">
                  Subtype: {result.project_subtype}
                </span>
              ) : null}
            </div>

            {result.reason ? (
              <div className="mt-3 text-sm text-gray-700">{result.reason}</div>
            ) : null}
          </div>

          <div className="rounded-lg border bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">Suggested Description</div>
            <div className="mt-2 whitespace-pre-wrap text-sm text-gray-700">
              {result.description || "—"}
            </div>
          </div>

          <div className="rounded-lg border bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">
              Suggested Milestones ({milestones.length})
            </div>

            {milestones.length ? (
              <div className="mt-3 space-y-3">
                {milestones.map((m, idx) => (
                  <div key={idx} className="rounded-md border bg-gray-50 p-3">
                    <div className="text-sm font-medium text-gray-900">
                      {m.title || `Milestone ${idx + 1}`}
                    </div>
                    {m.description ? (
                      <div className="mt-1 text-sm text-gray-700">{m.description}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-sm text-gray-500">No milestone suggestions yet.</div>
            )}
          </div>

          <div className="rounded-lg border bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">
              Suggested Clarification Questions ({clarifications.length})
            </div>

            {clarifications.length ? (
              <div className="mt-3 space-y-2">
                {clarifications.map((q, idx) => (
                  <div key={idx} className="rounded-md border bg-gray-50 px-3 py-2">
                    <div className="text-sm font-medium text-gray-900">
                      {q.label || q.key || `Question ${idx + 1}`}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      Type: {q.type || "text"} {q.required ? "• Required" : "• Optional"}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-sm text-gray-500">
                No clarification questions generated yet.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}