// frontend/src/components/step1/TemplateSearchSection.jsx
// v2026-03-17-template-search-apply-sync
//
// Updates:
// - consumes template apply responses more safely
// - supports optional onTemplateApplied callback with returned agreement payload
// - prevents scope-regeneration style AI actions when a template is already applied
// - keeps existing UX/layout intact
// - preserves selected/applied template preview behavior

import React, { useEffect, useMemo, useRef, useState } from "react";
import { safeTrim } from "./step1Utils";
import {
  buildTemplateInsightLines,
  deriveTemplateInsights,
} from "../../lib/templateInsights.js";
import ScopeDiffView from "../ScopeDiffView.jsx";

function OptionBadge({ ownerType }) {
  const text = ownerType === "system" ? "System Template" : "My Template";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        ownerType === "system"
          ? "bg-slate-100 text-slate-700"
          : "bg-emerald-100 text-emerald-800"
      }`}
    >
      {text}
    </span>
  );
}

function MatchBadge({ template, recommended, possible }) {
  const level = template?._matchLevel || "weak";

  if (recommended) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
        Recommended
      </span>
    );
  }

  if (possible || level === "medium") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
        Optional match
      </span>
    );
  }

  return null;
}

// Safety filter: internal backend scoring strings must never surface in the UI.
// They contain semicolons (reason joiner), "shared keywords:", or "penalized".
function isSafeReasonText(text) {
  if (!text || typeof text !== "string") return false;
  const lower = text.toLowerCase();
  if (text.includes(";")) return false;
  if (/shared\s+keywords\s*:/.test(lower)) return false;
  if (/family\s+mismatch\s*:/.test(lower)) return false;
  if (/\b(blocked|debug|keyword|keywords|loose similarity|mismatch|penalized|penalty|rank|rank_score|score|scoring|token|weighted)\b/.test(lower)) {
    return false;
  }
  if (/\b(type|category|family)\s+does\s+not\s+match\b/.test(lower)) return false;
  return true;
}

function PreviewSection({ title, children, testId }) {
  return (
    <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3" data-testid={testId}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
        {title}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function normalizeClarificationText(item) {
  if (!item) return "";

  if (typeof item === "string") return safeTrim(item);

  if (typeof item === "object") {
    return (
      safeTrim(item.question) ||
      safeTrim(item.label) ||
      safeTrim(item.text) ||
      safeTrim(item.prompt) ||
      safeTrim(item.help) ||
      safeTrim(item.key) ||
      ""
    );
  }

  return "";
}

function normalizeClarifications(items) {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeClarificationText).filter(Boolean);
}

function getMilestoneCount(template) {
  return (
    template?.milestone_count ??
    (Array.isArray(template?.milestones) ? template.milestones.length : 0)
  );
}

function getSafeEstimatedDays(template) {
  const raw = Number(template?.estimated_days || 0);
  return raw > 0 ? raw : 1;
}

function getRecommendationInsightLines(template) {
  const estimatedDays = getSafeEstimatedDays(template);
  const insights = deriveTemplateInsights({
    ...template,
    milestones: Array.isArray(template?.milestones) ? template.milestones : [],
    estimated_days: estimatedDays,
  });
  return buildTemplateInsightLines(insights, { context: "template" }).slice(0, 3);
}

function buildSuggestedDayLabel(index, totalCount, estimatedDays) {
  if (!totalCount || totalCount <= 0) return null;
  if (!estimatedDays || estimatedDays <= 0) return null;
  if (totalCount === 1) return `Day ${estimatedDays}`;

  const steps = totalCount - 1;
  const safeDays = Math.max(estimatedDays, totalCount);
  const offset = Math.round((index / steps) * (safeDays - 1));
  return `Day ${offset + 1}`;
}

function TemplateSearchResult({
  template,
  selected,
  applied,
  recommended,
  possible,
  onPick,
  locked,
}) {
  const milestoneCount =
    template?.milestone_count ??
    (Array.isArray(template?.milestones) ? template.milestones.length : 0);

  const ownerType =
    template?.owner_type || (template?.is_system ? "system" : "contractor");

  return (
    <button
      type="button"
      onClick={() => !locked && onPick?.(template)}
      disabled={locked}
      data-testid={`template-search-result-${template?.id || "unknown"}`}
      className={`w-full border-b last:border-b-0 px-3 py-2 text-left hover:bg-indigo-50 ${
        selected || applied ? "bg-indigo-50" : "bg-white"
      } ${locked ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-medium text-gray-900">
              {template?.name || "Template"}
            </div>

            <OptionBadge ownerType={ownerType} />
            <MatchBadge
              template={template}
              recommended={recommended}
              possible={possible}
            />

            {applied ? (
              <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-800">
                Applied
              </span>
            ) : null}
          </div>

          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-gray-500">
            {safeTrim(template?.project_type) ? (
              <span>{template.project_type}</span>
            ) : null}
            {safeTrim(template?.project_subtype) ? (
              <span>• {template.project_subtype}</span>
            ) : null}
            <span>
              • {milestoneCount} milestone{milestoneCount === 1 ? "" : "s"}
            </span>
          </div>

          {isSafeReasonText(template?._matchReason) ? (
            <div className="mt-1 text-[11px] text-slate-500">
              {template._matchReason}
            </div>
          ) : null}

          {safeTrim(template?.description) ? (
            <div className="mt-1 line-clamp-2 text-[11px] text-gray-500">
              {template.description}
            </div>
          ) : null}
        </div>

        {applied ? (
          <div className="shrink-0 text-[11px] font-semibold text-indigo-700">
            Applied
          </div>
        ) : selected ? (
          <div className="shrink-0 text-[11px] font-semibold text-indigo-700">
            Selected
          </div>
        ) : null}
      </div>
    </button>
  );
}

function SearchHintRow({ onUseScratch }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-slate-600">
      <div>Type a keyword like “bathroom”, “deck”, or “bedroom addition”.</div>
      <button
        type="button"
        onClick={onUseScratch}
        className="rounded border border-slate-200 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-50"
      >
        Start Custom
      </button>
    </div>
  );
}

export default function TemplateSearchSection({
  locked,
  agreementId,
  dLocal,
  onLocalChange,
  entryMode = "manual",
  showProjectFields = true,
  projectTypeOptions,
  projectSubtypeOptions,
  manualBrowseOpenSignal = 0,

  templatesLoading,
  templatesErr,
  filteredTemplates,
  templateSearch,
  setTemplateSearch,
  selectedTemplateId,
  recommendedTemplateId,
  recommendedCandidates = [],
  recommendationConfidence,
  recommendationLoading,
  templateRecommendationReason,
  templateRecommendationScore,
  selectedTemplate,
  applyingTemplateId,
  handleTemplatePick,
  handleApplyTemplate,
  handleDeleteTemplate,
  handleUpdateTemplateDays,
  setSelectedTemplateId,
  setShowSaveTemplateModal,
  noTemplateMatch,
  noTemplateReason,
  templateDetail,
  templateDetailLoading,
  templateDetailErr,
  suppressNoMatchPanel = false,

  aiCredits,
  aiBusy,
  aiErr,
  aiPreview,
  setAiPreview,
  refreshAiCredits,
  runAiDescription,
  applyAiDescription,
  hasSomeContext,

  onAddProjectType,
  onAddProjectSubtype,
  onManageProjectTypes,
  onManageProjectSubtypes,

  aiMilestoneBusy,
  aiMilestoneApplying,
  aiMilestoneErr,
  aiMilestonePreview,
  setAiMilestonePreview,
  runAiMilestonesFromScope,
  applyAiMilestonesFromScope,
  startMode = "manual",
  startingPointBusy = false,
  onStartModeChange = null,
  onGenerateAiDraft = null,
  onContinueWithAiDraft = null,
  onContinueToStep2 = null,
  onStartFromScratch = null,
  onReviewProjectDetails = null,
  onResetStep1 = null,
  jobPrompt = "",
  spreadEnabled,
  setSpreadEnabled,
  spreadTotal,
  setSpreadTotal,
  autoSchedule,
  setAutoSchedule,

  appliedTemplateId = null,
  onTemplateApplied = null,
}) {
  const dropdownRef = useRef(null);
  const lastAppliedTemplateIdRef = useRef(null);

  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);
  const [templateHighlightedIndex, setTemplateHighlightedIndex] = useState(0);
  const [selectedPreviewOpen, setSelectedPreviewOpen] = useState(true);
  const [estimatedDaysInput, setEstimatedDaysInput] = useState("");
  const [savingTemplateDays, setSavingTemplateDays] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [manualBrowseOpen, setManualBrowseOpen] = useState(false);

  const typeOptions = useMemo(
    () => (Array.isArray(projectTypeOptions) ? projectTypeOptions : []),
    [projectTypeOptions]
  );

  const subtypeOptions = useMemo(
    () => (Array.isArray(projectSubtypeOptions) ? projectSubtypeOptions : []),
    [projectSubtypeOptions]
  );

  const hasType = !!safeTrim(dLocal?.project_type);
  const hasSubtype = !!safeTrim(dLocal?.project_subtype);
  const hasTitle = !!safeTrim(dLocal?.project_title);
  const hasDescription = !!safeTrim(dLocal?.description);
  const isAiMode = entryMode === "ai";
  const isTemplateMode = entryMode === "template";
  const hasAiPreview = !!safeTrim(aiPreview);
  const hasTemplateSearch = !!safeTrim(templateSearch);
  const hasTemplateMatches =
    Array.isArray(filteredTemplates) && filteredTemplates.length > 0;
  const topRecommendedTemplates = useMemo(
    () => (Array.isArray(recommendedCandidates) ? recommendedCandidates.slice(0, 3) : []),
    [recommendedCandidates]
  );

  const [manualDetailsExpanded, setManualDetailsExpanded] = useState(
    () => !isAiMode || hasTitle || hasDescription || hasAiPreview
  );

  void aiCredits;
  const aiCreditText = "AI Included";

  const selectedTypeMeta = useMemo(() => {
    return (
      typeOptions.find(
        (t) => String(t?.value) === String(dLocal?.project_type || "")
      ) || null
    );
  }, [typeOptions, dLocal?.project_type]);

  const selectedSubtypeMeta = useMemo(() => {
    return (
      subtypeOptions.find(
        (st) => String(st?.value) === String(dLocal?.project_subtype || "")
      ) || null
    );
  }, [subtypeOptions, dLocal?.project_subtype]);

  useEffect(() => {
    setTemplateHighlightedIndex(0);
  }, [templateSearch, filteredTemplates.length]);

  useEffect(() => {
    if (!isAiMode && !manualDetailsExpanded) {
      setManualDetailsExpanded(true);
    }
  }, [isAiMode, manualDetailsExpanded]);

  useEffect(() => {
    if ((hasTitle || hasDescription || hasAiPreview) && !manualDetailsExpanded) {
      setManualDetailsExpanded(true);
    }
  }, [hasAiPreview, hasDescription, hasTitle, manualDetailsExpanded]);

  useEffect(() => {
    if (manualBrowseOpenSignal) {
      setManualBrowseOpen(true);
    }
  }, [manualBrowseOpenSignal]);

  useEffect(() => {
    function handleOutsideClick(e) {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(e.target)) {
        setTemplateDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  function onSearchKeyDown(e) {
    if (!templateDropdownOpen && (e.key === "ArrowDown" || e.key === "Enter")) {
      setTemplateDropdownOpen(true);
      return;
    }

    if (!filteredTemplates.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setTemplateHighlightedIndex((prev) =>
        Math.min(prev + 1, filteredTemplates.length - 1)
      );
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setTemplateHighlightedIndex((prev) => Math.max(prev - 1, 0));
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const pick =
        filteredTemplates[templateHighlightedIndex] || filteredTemplates[0];
      if (pick) {
        handleTemplatePick(pick);
        setTemplateDropdownOpen(false);
      }
    }

    if (e.key === "Escape") {
      setTemplateDropdownOpen(false);
    }
  }

  const effectiveAppliedTemplateId =
    appliedTemplateId ??
    dLocal?.project_template_id ??
    dLocal?.template_id ??
    dLocal?.selected_template_id ??
    null;

  const isTemplateApplied = !!String(effectiveAppliedTemplateId || "");
  const blockScopeGeneration = isTemplateApplied;

  const selectedTemplateIsRecommended =
    String(recommendedTemplateId || "") === String(selectedTemplate?.id || "");

  const previewTemplate =
    templateDetail &&
    String(templateDetail?.id || "") === String(selectedTemplate?.id || "")
      ? templateDetail
      : selectedTemplate;

  const detailTemplate = previewTemplate || selectedTemplate || null;

  const templateSections = useMemo(() => {
    const list = Array.isArray(filteredTemplates) ? filteredTemplates : [];
    const system = [];
    const mine = [];

    list.forEach((template) => {
      const isSystem =
        !!template?.is_system_template ||
        !!template?.is_system ||
        safeTrim(template?.owner_type).toLowerCase() === "system";
      if (isSystem) system.push(template);
      else mine.push(template);
    });

    return {
      system,
      mine,
    };
  }, [filteredTemplates]);

  const previewMilestones = Array.isArray(previewTemplate?.milestones)
    ? previewTemplate.milestones
    : [];

  const previewClarifications = useMemo(() => {
    const defaultClarifications = Array.isArray(
      previewTemplate?.default_clarifications
    )
      ? previewTemplate.default_clarifications
      : [];

    const clarifications = Array.isArray(previewTemplate?.clarifications)
      ? previewTemplate.clarifications
      : [];

    return normalizeClarifications(
      defaultClarifications.length ? defaultClarifications : clarifications
    );
  }, [previewTemplate]);

  const previewEstimatedDays = useMemo(() => {
    const value = Number(previewTemplate?.estimated_days || 0);
    return value > 0 ? value : 1;
  }, [previewTemplate]);

  const templateInsights = useMemo(
    () =>
      deriveTemplateInsights({
        ...previewTemplate,
        milestones: previewMilestones,
        estimated_days: previewEstimatedDays,
      }),
    [previewEstimatedDays, previewTemplate, previewMilestones]
  );

  const templateInsightLines = useMemo(
    () => buildTemplateInsightLines(templateInsights, { context: "template" }),
    [templateInsights]
  );

  useEffect(() => {
    setEstimatedDaysInput(String(previewEstimatedDays || 1));
  }, [previewTemplate?.id, previewEstimatedDays]);

  useEffect(() => {
    const currentAppliedId = String(effectiveAppliedTemplateId || "");
    const lastAppliedId = String(lastAppliedTemplateIdRef.current || "");

    if (!currentAppliedId) {
      lastAppliedTemplateIdRef.current = null;
      return;
    }

    if (currentAppliedId !== lastAppliedId) {
      setSelectedPreviewOpen(false);
      lastAppliedTemplateIdRef.current = currentAppliedId;
    }
  }, [effectiveAppliedTemplateId]);

  const showNoStrongMatchPanel = !!noTemplateMatch && !suppressNoMatchPanel;
  const showRelatedContext = showNoStrongMatchPanel && hasTemplateMatches;
  const canGenerateFromScope = hasType || hasSubtype || hasTitle || hasDescription;
  const canUseGeneratedPrompt = !!safeTrim(aiPrompt);

  const aiMilestoneQuestions = Array.isArray(aiMilestonePreview?.questions)
    ? aiMilestonePreview.questions
    : [];

  async function onSaveDaysToTemplate() {
    if (!selectedTemplate?.id || !handleUpdateTemplateDays) return;

    const parsed = Number(estimatedDaysInput || 0);
    if (!parsed || parsed < 1) return;

    try {
      setSavingTemplateDays(true);
      await handleUpdateTemplateDays(selectedTemplate.id, {
        estimated_days: parsed,
      });
    } finally {
      setSavingTemplateDays(false);
    }
  }

  async function onApplySelectedTemplate(templateOverride = null) {
    const templateToApply = templateOverride || selectedTemplate;
    if (!templateToApply || !handleApplyTemplate) return;

    const parsedDays = Number(estimatedDaysInput || 0);
    const safeEstimatedDays = parsedDays > 0 ? parsedDays : previewEstimatedDays;

    const payload = await handleApplyTemplate(templateToApply, {
      estimated_days: safeEstimatedDays,
      auto_schedule: !!autoSchedule,
      spread_enabled: !!spreadEnabled,
      spread_total: spreadTotal,
    });

    setSelectedTemplateId?.(templateToApply.id);

    const returnedAgreement =
      payload?.agreement ||
      payload?.data?.agreement ||
      payload?.result?.agreement ||
      null;

    if (returnedAgreement && onTemplateApplied) {
      await onTemplateApplied(returnedAgreement, payload);
    }

    setTemplateDropdownOpen(false);
    setSelectedPreviewOpen(false);
    return payload;
  }

  async function handleContinueToStep2() {
    if (!detailTemplate || locked) return;

    if (!isTemplateApplied && selectedTemplate?.id) {
      const applied = await onApplySelectedTemplate();
      if (!applied) return;
    }

    onContinueToStep2?.();
  }

  async function handleUseThisTemplate(template) {
    if (!template?.id || locked) return;
    handleTemplateResultPick(template);
    const applied = await onApplySelectedTemplate(template);
    if (!applied) return;
    onStartModeChange?.("template");
  }

  function handleBuildWithoutTemplate() {
    if (locked || startingPointBusy) return;
    setSelectedTemplateId?.(null);
    setTemplateDropdownOpen(false);
    if (noTemplateMatch && onContinueWithAiDraft) {
      onStartModeChange?.("ai");
      onContinueWithAiDraft();
      return;
    }
    const prompt =
      safeTrim(jobPrompt) ||
      safeTrim(aiPrompt) ||
      safeTrim(templateSearch) ||
      safeTrim(dLocal?.project_title) ||
      safeTrim(dLocal?.description);

    if (prompt && onGenerateAiDraft) {
      onStartModeChange?.("ai");
      onGenerateAiDraft(prompt);
      return;
    }

    if (noTemplateMatch) {
      onStartFromScratch?.();
      return;
    }

    onStartFromScratch?.();
  }

  function handleTemplateResultPick(picked) {
    handleTemplatePick?.(picked);
    setTemplateDropdownOpen(false);
  }

  function clearStartState() {
    setSelectedTemplateId?.(null);
    setAiPreview("");
    setAiMilestonePreview(null);
    setTemplateDropdownOpen(false);
    setSelectedPreviewOpen(true);
  }

  function handleStartFromScratch() {
    if (locked || startingPointBusy) return;
    clearStartState();
    onStartModeChange?.("manual");
    onStartFromScratch?.();
  }

  function handleFindBestStartingPoint() {
    if (locked || startingPointBusy) return;
    const prompt = safeTrim(jobPrompt) || safeTrim(aiPrompt) || safeTrim(templateSearch);
    clearStartState();
    onStartModeChange?.("template");
    onGenerateAiDraft?.(prompt);
  }

  function clearTemplateSearchOnly() {
    setTemplateSearch("");
    setTemplateDropdownOpen(false);
    if (!isTemplateApplied) {
      setSelectedTemplateId?.(null);
    }
  }

  const selectionHeaderTitle = isTemplateApplied
    ? "Starting point in use"
    : "Selected starting point";
  const selectionHeaderText = isTemplateApplied
    ? "This starting point shaped the current agreement draft. Review it below, or use Reset form if you want to start over."
    : "Search for a matching template first. If a good match exists, use it as the fastest path into milestones, clarifications, and pricing.";

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      {noTemplateMatch ? null : (
        <div className="mb-4">
          <div className="text-base font-semibold text-gray-900">Starting points</div>
          <div className="mt-1 text-sm text-gray-600">
            Choose the best agreement starting point for this job.
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <details
              className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-3"
              open={manualBrowseOpen}
              onToggle={(event) => setManualBrowseOpen(event.currentTarget.open)}
            >
              <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Browse templates manually
              </summary>

              <div className="mt-3 space-y-3">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <label className="mb-1 block text-sm font-medium">Search templates</label>
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={templateSearch}
                    onChange={(e) => {
                      const v = e.target.value;
                      setTemplateSearch(v);
                      if (!v.trim() && !isTemplateApplied) {
                        setSelectedTemplateId(null);
                      }
                    }}
                    placeholder='Search templates by keyword, like "bathroom", "deck", or "bedroom addition"...'
                    disabled={locked}
                  />
                  <div className="mt-1 text-[11px] text-gray-500">
                    Search system templates or your saved templates.
                  </div>
                </div>

                <div data-testid="step1-system-templates-list" className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    System Templates
                  </div>
                  <div className="mt-2 space-y-2">
                    {templateSections.system.length ? (
                      templateSections.system.map((tpl) => {
                        const isApplied =
                          String(effectiveAppliedTemplateId || "") === String(tpl.id || "");

                        return (
                          <TemplateSearchResult
                            key={tpl.id}
                            template={tpl}
                            selected={String(selectedTemplateId || "") === String(tpl.id)}
                            applied={isApplied}
                            recommended={String(recommendedTemplateId || "") === String(tpl.id)}
                            possible={recommendationConfidence === "medium"}
                            onPick={(picked) => {
                              handleTemplateResultPick(picked);
                              onStartModeChange?.("template");
                            }}
                            locked={locked}
                          />
                        );
                      })
                    ) : (
                      <div className="rounded border border-dashed border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
                        No system templates match your search yet.
                      </div>
                    )}
                  </div>
                </div>

                <div data-testid="step1-my-templates-list" className="rounded-lg border border-slate-100 bg-white p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    My Templates
                  </div>
                  <div className="mt-2 space-y-2">
                    {templateSections.mine.length ? (
                      templateSections.mine.map((tpl) => {
                        const isApplied =
                          String(effectiveAppliedTemplateId || "") === String(tpl.id || "");

                        return (
                          <TemplateSearchResult
                            key={tpl.id}
                            template={tpl}
                            selected={String(selectedTemplateId || "") === String(tpl.id)}
                            applied={isApplied}
                            recommended={String(recommendedTemplateId || "") === String(tpl.id)}
                            possible={recommendationConfidence === "medium"}
                            onPick={(picked) => {
                              handleTemplateResultPick(picked);
                              onStartModeChange?.("template");
                            }}
                            locked={locked}
                          />
                        );
                      })
                    ) : (
                      <div className="rounded border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                        Your saved templates will appear here after you create or save one.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </details>
          </div>
        </aside>

        <section className="space-y-4">
          <div
            data-testid="step1-template-detail-panel"
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            {!detailTemplate ? (
              <div className="space-y-4">
                {showNoStrongMatchPanel ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                  <div
                    data-testid="step1-no-template-card"
                    className={noTemplateMatch ? "" : "space-y-3"}
                  >
                    <div className="text-base font-semibold text-slate-900">
                      {noTemplateMatch
                        ? "No template found — let's build this together"
                        : "Recommended starting point"}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {noTemplateMatch
                        ? "We couldn't find a saved template for this job. MyHomeBro can build editable project details from your description."
                        : "Select a template to preview it, or build the agreement directly from your description."}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        data-testid="step1-review-project-details-jump"
                        onClick={() => onReviewProjectDetails?.()}
                        disabled={locked || startingPointBusy}
                        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                      >
                        Review Project Details
                      </button>
                      <button
                        type="button"
                        onClick={handleBuildWithoutTemplate}
                        disabled={locked || startingPointBusy}
                        data-testid="step1-build-agreement-ai-button"
                        className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {startingPointBusy
                          ? "Building agreement draft..."
                          : noTemplateMatch
                          ? "Continue with AI Draft"
                          : "Build with AI"}
                      </button>
                      {noTemplateMatch ? (
                        <button
                          type="button"
                          onClick={() => onResetStep1?.()}
                          disabled={locked || startingPointBusy}
                          data-testid="step1-start-over-button"
                          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Start over
                        </button>
                      ) : null}
                      {noTemplateMatch ? (
                        <button
                          type="button"
                          onClick={() => onStartModeChange?.("manual")}
                          disabled={locked}
                          className="rounded-lg border border-transparent px-2 py-2 text-sm font-semibold text-slate-600 hover:underline"
                        >
                          Change description
                        </button>
                      ) : null}
                      {noTemplateMatch ? (
                        <button
                          type="button"
                          data-testid="step1-browse-templates-manually-button"
                          onClick={() => onStartModeChange?.("template")}
                          disabled={locked}
                          className="rounded-lg border border-transparent px-2 py-2 text-sm font-semibold text-slate-600 hover:underline"
                        >
                          Browse templates manually
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
                ) : null}

                {!noTemplateMatch && topRecommendedTemplates.length ? (
                  <div className="space-y-3">
                    <div className="text-sm font-semibold text-slate-900">
                      {recommendationConfidence === "medium" ? "Closest template match" : "Recommended starting point"}
                    </div>
                    {recommendationConfidence === "medium" && templateRecommendationReason ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        {templateRecommendationReason}
                      </div>
                    ) : null}
                    {topRecommendedTemplates.map((template) => {
                      const insightLines = getRecommendationInsightLines(template);
                      const reasons = Array.from(
                        new Set(
                          [
                            isSafeReasonText(template?._matchReason) ? safeTrim(template._matchReason) : "",
                            ...insightLines,
                          ].filter(Boolean)
                        )
                      ).slice(0, 3);

                      return (
                        <div
                          key={template.id}
                          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                          data-testid={`step1-recommendation-card-${template.id}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-base font-semibold text-slate-900">
                                  {template.name}
                                </div>
                                <OptionBadge
                                  ownerType={
                                    template?.owner_type ||
                                    (template?.is_system_template || template?.is_system
                                      ? "system"
                                      : "contractor")
                                  }
                                />
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
                                <span className="rounded bg-slate-100 px-2 py-1">
                                  {getMilestoneCount(template)} milestone
                                  {getMilestoneCount(template) === 1 ? "" : "s"}
                                </span>
                                <span className="rounded bg-slate-100 px-2 py-1">
                                  {getSafeEstimatedDays(template)} day
                                  {getSafeEstimatedDays(template) === 1 ? "" : "s"}
                                </span>
                              </div>
                            </div>
                            <div className="shrink-0 text-[11px] font-semibold text-slate-500">
                              Recommended
                            </div>
                          </div>

                          {reasons.length ? (
                            <div className="mt-3">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                Why it fits
                              </div>
                              <ul className="mt-2 space-y-1 text-xs text-slate-700">
                                {reasons.map((reason, idx) => (
                                  <li key={`${template.id}-reason-${idx}`} className="flex gap-2">
                                    <span
                                      className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400"
                                      aria-hidden="true"
                                    />
                                    <span>{reason}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          <PreviewSection
                            title="Starting point insights"
                            testId={`step1-recommendation-insights-${template.id}`}
                          >
                            <ul className="space-y-1 text-xs text-slate-700">
                              {insightLines.map((line, idx) => (
                                <li key={`${template.id}-${line}-${idx}`} className="flex gap-2">
                                  <span
                                    className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400"
                                    aria-hidden="true"
                                  />
                                  <span>{line}</span>
                                </li>
                              ))}
                            </ul>
                          </PreviewSection>

                          <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => handleUseThisTemplate(template)}
                                disabled={locked || startingPointBusy}
                                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                              >
                                Use This Template
                              </button>
                              <button
                                type="button"
                                onClick={handleBuildWithoutTemplate}
                                disabled={locked || startingPointBusy}
                                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                              >
                              {startingPointBusy && startMode === "ai"
                                ? "Building agreement draft..."
                                : noTemplateMatch
                                ? "Continue with AI Draft"
                                : "Build with AI"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                ) : null}

              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Selected starting point
                      </span>
                      <OptionBadge
                        ownerType={
                          detailTemplate?.owner_type ||
                          (detailTemplate?.is_system_template || detailTemplate?.is_system
                            ? "system"
                            : "contractor")
                        }
                      />
                    </div>
                    <h3
                      data-testid="step1-template-detail-name"
                      className="mt-1 text-xl font-semibold text-slate-900"
                    >
                      {detailTemplate.name}
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
                      {safeTrim(detailTemplate.project_type) ? (
                        <span className="rounded bg-slate-100 px-2 py-1">
                          {detailTemplate.project_type}
                        </span>
                      ) : null}
                      {safeTrim(detailTemplate.project_subtype) ? (
                        <span className="rounded bg-slate-100 px-2 py-1">
                          {detailTemplate.project_subtype}
                        </span>
                      ) : null}
                      <span className="rounded bg-slate-100 px-2 py-1">
                        {getMilestoneCount(detailTemplate)} milestone
                        {getMilestoneCount(detailTemplate) === 1 ? "" : "s"}
                      </span>
                      <span className="rounded bg-slate-100 px-2 py-1">
                        {getSafeEstimatedDays(detailTemplate)} day
                        {getSafeEstimatedDays(detailTemplate) === 1 ? "" : "s"}
                      </span>
                    </div>
                    {isSafeReasonText(detailTemplate?._matchReason) ? (
                      <div className="mt-2 text-xs text-slate-500">
                        {detailTemplate._matchReason}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleContinueToStep2}
                      disabled={locked || (!selectedTemplate && !detailTemplate)}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                      data-testid="step1-continue-to-step2-button"
                    >
                      Continue → Step 2
                    </button>
                  </div>
                </div>

                {templateDetailLoading ? (
                  <div className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Loading template preview…
                  </div>
                ) : null}

                {templateDetailErr ? (
                  <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {templateDetailErr}
                  </div>
                ) : null}

                <PreviewSection title="Starting point insights" testId="step1-template-insights-card">
                  <ul className="space-y-1 text-xs text-slate-700">
                    {templateInsightLines.map((line, idx) => (
                      <li key={`${line}-${idx}`} className="flex gap-2">
                        <span
                          className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400"
                          aria-hidden="true"
                        />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </PreviewSection>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="space-y-4">
                    {safeTrim(detailTemplate?.description) ? (
                      <PreviewSection title="Description">
                        <div className="whitespace-pre-wrap text-xs text-gray-700">
                          {detailTemplate.description}
                        </div>
                      </PreviewSection>
                    ) : null}

                    <PreviewSection title="Mini Preview">
                      <div className="space-y-2">
                        {previewMilestones.length ? (
                          <div className="space-y-2">
                            {previewMilestones.slice(0, 4).map((m, idx) => (
                              <div
                                key={m.id || `${m.title}-${idx}`}
                                className="rounded border border-slate-200 bg-white px-3 py-2"
                              >
                                <div className="text-xs font-medium text-gray-900">
                                  {idx + 1}. {m.title || "Untitled milestone"}
                                </div>
                                {safeTrim(m.description) ? (
                                  <div className="mt-1 text-[11px] text-gray-600">
                                    {m.description}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-slate-500">
                            No milestones yet. Use AI or continue to Step 2 to shape them.
                          </div>
                        )}

                        {safeTrim(detailTemplate?.project_materials_hint) ? (
                          <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                            <div className="font-semibold text-slate-900">Materials Summary</div>
                            <div className="mt-1">{detailTemplate.project_materials_hint}</div>
                          </div>
                        ) : null}
                      </div>
                    </PreviewSection>
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-sm font-semibold text-slate-900">Smart actions</div>
                      <div className="mt-1 text-xs text-slate-600">
                        Keep these optional. You can ignore suggestions and continue manually.
                      </div>
                      <div className="mt-3 flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={runAiMilestonesFromScope}
                          disabled={locked || !agreementId || !canGenerateFromScope || aiMilestoneBusy || blockScopeGeneration}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                        >
                          {aiMilestoneBusy ? "Working…" : "Generate Suggested Milestones"}
                        </button>

                        <button
                          type="button"
                          onClick={onApplySelectedTemplate}
                          disabled={locked || !agreementId || applyingTemplateId === selectedTemplate?.id}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                        >
                          {applyingTemplateId === selectedTemplate?.id ? "Applying…" : "Apply Pricing Guidance"}
                        </button>
                      </div>

                      {aiMilestoneErr ? (
                        <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                          {aiMilestoneErr}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {!agreementId ? (
                    <div className="text-[11px] text-amber-700">
                      Save Draft first so template milestones can be attached to this agreement.
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {showProjectFields ? (
      <div className="mt-5 border-t border-slate-200 pt-5">
        <div className="mb-3">
          <div className="text-sm font-semibold text-gray-900">
            Project Basics
          </div>
          <div className="mt-1 text-xs text-gray-600">
            If no template exists, complete the fields below and MyHomeBro will
            still suggest matches.
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="block text-sm font-medium">Type</label>

              {!locked && (onAddProjectType || onManageProjectTypes) ? (
                <div className="flex items-center gap-2">
                  {onAddProjectType ? (
                    <button
                      type="button"
                      onClick={onAddProjectType}
                      className="text-[11px] font-medium text-indigo-700 hover:underline"
                    >
                      Add Type
                    </button>
                  ) : null}
                  {onManageProjectTypes ? (
                    <button
                      type="button"
                      onClick={onManageProjectTypes}
                      className="text-[11px] font-medium text-slate-600 hover:underline"
                    >
                      Manage
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <select
              className="w-full rounded border px-3 py-2 text-sm"
              name="project_type"
              value={dLocal.project_type || ""}
              onChange={
                locked
                  ? undefined
                  : (e) => {
                      if (e.target.value === "__new_type__") {
                        onAddProjectType?.();
                        return;
                      }
                      onLocalChange?.(e);
                    }
              }
              disabled={locked}
            >
              <option value="">Select Type</option>
              {typeOptions.map((t) => (
                <option key={String(t.id ?? t.value)} value={String(t.value)}>
                  {String(t.label)}
                </option>
              ))}
              {!locked ? <option value="__new_type__">+ New Type</option> : null}
            </select>

            {selectedTypeMeta?.owner_type ? (
              <div className="mt-1 text-[11px] text-gray-500">
                Source:{" "}
                {selectedTypeMeta.owner_type === "system"
                  ? "Built-in taxonomy"
                  : "Custom taxonomy"}
              </div>
            ) : (
              <div className="mt-1 text-[11px] text-gray-500">
                Type is the main project category.
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="block text-sm font-medium">Subtype</label>

              {!locked && (onAddProjectSubtype || onManageProjectSubtypes) ? (
                <div className="flex items-center gap-2">
                  {onAddProjectSubtype ? (
                    <button
                      type="button"
                      onClick={onAddProjectSubtype}
                      className="text-[11px] font-medium text-indigo-700 hover:underline"
                    >
                      Add Subtype
                    </button>
                  ) : null}
                  {onManageProjectSubtypes ? (
                    <button
                      type="button"
                      onClick={onManageProjectSubtypes}
                      className="text-[11px] font-medium text-slate-600 hover:underline"
                    >
                      Manage
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <select
              className="w-full rounded border px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
              name="project_subtype"
              value={dLocal.project_subtype || ""}
              onChange={
                locked
                  ? undefined
                  : (e) => {
                      if (e.target.value === "__new_subtype__") {
                        onAddProjectSubtype?.();
                        return;
                      }
                      onLocalChange?.(e);
                    }
              }
              disabled={locked || !hasType}
            >
              <option value="">
                {hasType ? "Select Subtype" : "Select Type first"}
              </option>
              {subtypeOptions.map((st) => (
                <option key={String(st.id ?? st.value)} value={String(st.value)}>
                  {String(st.label)}
                </option>
              ))}
              {!locked && hasType ? (
                <option value="__new_subtype__">+ New Subtype</option>
              ) : null}
            </select>

            {selectedSubtypeMeta?.owner_type ? (
              <div className="mt-1 text-[11px] text-gray-500">
                Source:{" "}
                {selectedSubtypeMeta.owner_type === "system"
                  ? "Built-in taxonomy"
                  : "Custom taxonomy"}
              </div>
            ) : (
              <div className="mt-1 text-[11px] text-gray-500">
                {hasType
                  ? "Subtype narrows the job so MyHomeBro can recommend better templates."
                  : "Choose a Type first to unlock Subtype options."}
              </div>
            )}
          </div>
        </div>

        <details
          open={manualDetailsExpanded}
          onToggle={(event) => setManualDetailsExpanded(event.currentTarget.open)}
          className={`mt-4 rounded-xl border ${
            isAiMode
              ? "border-slate-200 bg-slate-50/70"
              : isTemplateMode
              ? "border-sky-200 bg-sky-50/40"
              : "border-slate-200 bg-white"
          }`}
          data-testid="step1-manual-details"
        >
          <summary className="cursor-pointer list-none px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  {isAiMode ? "Review project title and scope" : "Project title and scope"}
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  {isAiMode
                    ? "AI can prefill these details first. Open this section anytime to review or edit them."
                    : isTemplateMode
                    ? "Template details can be reviewed and adjusted here before you continue."
                    : "Add the core project title and scope details for this agreement."}
                </div>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                {manualDetailsExpanded ? "Editable" : "Collapsed"}
              </span>
            </div>
          </summary>

          <div className="border-t border-slate-200 px-4 pb-4 pt-4">
            {isAiMode ? (
              <div
                data-testid="step1-ai-prefill-note"
                className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-3 text-sm text-indigo-900"
              >
                <div className="font-semibold">AI will help prefill these details</div>
                <div className="mt-1 text-xs text-indigo-800">
                  Start with the AI assistant first, then review and edit the title and scope here.
                </div>
              </div>
            ) : null}

            <div className="mt-1">
              <label className="mb-1 block text-sm font-medium">Project Title</label>
              <input
                data-testid="agreement-project-title-input"
                className="w-full rounded border px-3 py-2 text-sm"
                name="project_title"
                value={dLocal.project_title}
                onChange={locked ? undefined : onLocalChange}
                placeholder="e.g., Master Bedroom Addition"
                disabled={locked}
              />
              <div className="mt-1 text-[11px] text-gray-500">
                A few words here help MyHomeBro suggest the best template.
              </div>
            </div>

            <div className="mt-5 border-t border-slate-200 pt-5">
          <div className="mb-3">
            <div className="text-sm font-semibold text-gray-900">
              Scope of Work
            </div>
            <div className="mt-1 text-xs text-gray-600">
              Describe what is included so the customer understands the job and
              milestone planning stays accurate.
            </div>
          </div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="block text-sm font-medium">
              Description / Scope of Work
            </label>
          </div>

          <div className="mb-2 text-xs leading-5 text-gray-600">
            This is the actual project scope for the agreement. Describe the work
            clearly enough that the customer understands what is included, and both
            sides can avoid disputes later.
          </div>

          <textarea
            className="w-full rounded border px-3 py-2 text-sm"
            rows={6}
            name="description"
            value={dLocal.description || ""}
            onChange={locked ? undefined : onLocalChange}
            placeholder="Example: Remove existing materials, prepare surfaces, install new materials, complete finish work, and clean the job site..."
            disabled={locked}
          />

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-gray-600">
              Project Assistant can turn a rough idea into a clearer, stronger, more
              dispute-resistant scope.
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  aiCredits?.loading
                    ? "bg-slate-100 text-slate-700"
                    : "bg-emerald-100 text-emerald-800"
                }`}
                title="AI tools are included with your account"
              >
                {aiCreditText}
              </span>

              <button
                type="button"
                onClick={refreshAiCredits}
                className="rounded border px-2 py-1 text-[11px] hover:bg-gray-50 disabled:opacity-60"
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
              disabled={
                locked ||
                aiBusy ||
                !safeTrim(dLocal.description) ||
                blockScopeGeneration
              }
              className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
              data-testid="agreement-ai-improve-scope-button"
            >
              {aiBusy ? "Working…" : "✨ Improve Existing Scope"}
            </button>

            <button
              type="button"
              onClick={() => runAiDescription("generate")}
              disabled={
                locked ||
                aiBusy ||
                !hasSomeContext ||
                blockScopeGeneration
              }
              className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
              data-testid="agreement-ai-generate-scope-button"
            >
              {aiBusy ? "Working…" : "✨ Generate Scope Draft"}
            </button>
          </div>

              <div className="mt-2 text-[11px] text-gray-500">
                {blockScopeGeneration
                  ? "A template is applied. Use the template-driven scope, milestones, and clarification flow instead of generating a new AI structure here."
                  : "Use AI as a starting point. Review and edit the final scope so it accurately reflects the work you are agreeing to perform."}
              </div>

              {aiErr ? <div className="mt-2 text-xs text-red-600">{aiErr}</div> : null}

              {aiPreview ? (
                <ScopeDiffView
                  original={safeTrim(dLocal.description)}
                  improved={aiPreview}
                  locked={locked}
                  onAccept={(text) => applyAiDescription("replace", text)}
                  onReject={() => setAiPreview("")}
                />
              ) : null}
            </div>
          </div>
        </details>
      </div>
      ) : null}
    </div>
  );
}
