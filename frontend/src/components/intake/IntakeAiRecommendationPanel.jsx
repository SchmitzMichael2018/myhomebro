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
  selectedTemplateMode = "none",
  selectedTemplateId = null,
  onChooseRecommendedTemplate,
  onChooseAlternativeTemplate,
  onContinueWithoutTemplate,
  onCreateTemplateFromIntake,
}) {
  const milestones = Array.isArray(result?.milestones) ? result.milestones : [];
  const clarifications = Array.isArray(result?.clarification_questions)
    ? result.clarification_questions
    : [];
  const templateMatches = Array.isArray(result?.template_matches) ? result.template_matches : [];
  const hasStrongMatch = result?.has_strong_template_match === true;
  const matchQuality = String(result?.match_quality || "").trim().toLowerCase();

  function confidenceLabel(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "recommended") return "Strong match";
    if (normalized === "possible") return "Possible match";
    return "No strong match";
  }

  function recommendationLead() {
    if (hasStrongMatch && result?.template_name) {
      return "Best match based on project type, scope, and milestones.";
    }
    if (result?.template_name) {
      return "This is a close match, but you may want to review it.";
    }
    return "No strong template match was found. You can continue without a template or create a new one from this intake.";
  }

  function nextStepText() {
    if (hasStrongMatch && result?.template_name) {
      return "Recommended next step: use this template and continue to agreement creation.";
    }
    if (result?.template_name) {
      return "Recommended next step: review the suggested template, or continue without one if this job is different.";
    }
    return "Recommended next step: continue without a template or create a reusable draft from this intake.";
  }

  function isSelectedTemplate(templateId) {
    return selectedTemplateMode !== "none" && String(selectedTemplateId || "") === String(templateId || "");
  }

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">AI Project Analysis</h2>
          <p className="mt-1 text-sm text-gray-600">
            Review the project analysis, choose the best template path, and continue into the agreement workflow.
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
            <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
              Intake Summary
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-gray-900">Suggested Project Title:</div>
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
                  {confidenceLabel(result.confidence)}
                </span>
              ) : null}

              {matchQuality ? (
                <span className="rounded-full bg-white px-2 py-1 font-semibold text-slate-700">
                  Match quality: {matchQuality}
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

            <div className="mt-3 rounded-md border border-indigo-100 bg-white/80 p-3">
              <div className="text-sm font-medium text-gray-900">{recommendationLead()}</div>
              {result.reason ? (
                <div className="mt-1 text-xs text-gray-600">{result.reason}</div>
              ) : null}
              <div className="mt-2 text-xs font-medium text-indigo-800">{nextStepText()}</div>
            </div>

            <div className="mt-4 space-y-3 rounded-md border bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-gray-900">Template Recommendation</div>
                {selectedTemplateMode === "none" ? (
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
                    Continuing without template
                  </span>
                ) : null}
              </div>

              {result.template_name ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{result.template_name}</div>
                      <div className="mt-1 text-xs text-gray-600">
                        {hasStrongMatch
                          ? "Best match based on project type, scope, and milestones."
                          : "Close match based on the intake, but worth reviewing before you proceed."}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onChooseRecommendedTemplate}
                      className={`rounded px-3 py-1.5 text-xs font-medium ${
                        selectedTemplateMode !== "none" && String(selectedTemplateId || "") === String(result.template_id || "")
                          ? "bg-emerald-600 text-white"
                          : "border border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-100"
                      }`}
                    >
                      {selectedTemplateMode !== "none" && String(selectedTemplateId || "") === String(result.template_id || "")
                        ? "Template Selected"
                        : hasStrongMatch
                        ? "Use Recommended Template"
                        : "Use This Template"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  No strong template was found for this intake.
                </div>
              )}

              {templateMatches.length > 1 ? (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Other templates worth reviewing
                  </div>
                  <div className="mt-2 space-y-2">
                    {templateMatches
                      .filter((tpl) => String(tpl?.id || "") !== String(result?.template_id || ""))
                      .map((tpl) => (
                        <div key={tpl.id} className="rounded-md border bg-gray-50 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="text-sm font-medium text-gray-900">{tpl.name}</div>
                              <div className="mt-1 text-xs text-gray-600">
                                {tpl.project_type || "Type not set"}
                                {tpl.project_subtype ? ` • ${tpl.project_subtype}` : ""}
                                {tpl.match_quality ? ` • ${tpl.match_quality} match` : ""}
                              </div>
                              {tpl.reason ? (
                                <div className="mt-1 text-xs text-gray-500">{tpl.reason}</div>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => onChooseAlternativeTemplate?.(tpl)}
                              className={`rounded px-3 py-1.5 text-xs font-medium ${
                                isSelectedTemplate(tpl.id)
                                  ? "bg-indigo-600 text-white"
                                  : "border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50"
                              }`}
                            >
                              {isSelectedTemplate(tpl.id) ? "Selected" : "Choose"}
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-3">
                <div className="text-sm font-medium text-gray-900">No-template fallback</div>
                <div className="mt-1 text-xs text-gray-600">
                  Continue without a template and use the generated project structure. You can save a new template from Step 2 later if needed.
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onContinueWithoutTemplate}
                    className={`rounded px-3 py-1.5 text-xs font-medium ${
                      selectedTemplateMode === "none"
                        ? "bg-slate-700 text-white"
                        : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {selectedTemplateMode === "none" ? "Continuing Without Template" : "Continue Without Template"}
                  </button>
                  <button
                    type="button"
                    onClick={onCreateTemplateFromIntake}
                    className="rounded border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                  >
                    Create Template From Intake
                  </button>
                </div>
              </div>
            </div>
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
