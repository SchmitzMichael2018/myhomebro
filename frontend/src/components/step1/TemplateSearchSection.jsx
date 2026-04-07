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

function OptionBadge({ ownerType }) {
  const text = ownerType === "system" ? "Built-in" : "Custom";

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
        Possible
      </span>
    );
  }

  if (level === "weak") {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
        No strong match
      </span>
    );
  }

  return null;
}

function PreviewSection({ title, children }) {
  return (
    <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
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

          {safeTrim(template?._matchReason) ? (
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
  projectTypeOptions,
  projectSubtypeOptions,

  templatesLoading,
  templatesErr,
  filteredTemplates,
  templateSearch,
  setTemplateSearch,
  selectedTemplateId,
  recommendedTemplateId,
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
  spreadEnabled,
  setSpreadEnabled,
  spreadTotal,
  setSpreadTotal,
  autoSchedule,
  setAutoSchedule,

  appliedTemplateId = null,
  onDeselectAppliedTemplate = null,
  onTemplateApplied = null,
}) {
  const dropdownRef = useRef(null);
  const lastAppliedTemplateIdRef = useRef(null);

  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);
  const [templateHighlightedIndex, setTemplateHighlightedIndex] = useState(0);
  const [selectedPreviewOpen, setSelectedPreviewOpen] = useState(true);
  const [estimatedDaysInput, setEstimatedDaysInput] = useState("");
  const [savingTemplateDays, setSavingTemplateDays] = useState(false);

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

  const showNoStrongMatchPanel = !!noTemplateMatch;
  const showRelatedContext = showNoStrongMatchPanel && hasTemplateMatches;
  const canGenerateFromScope = hasType || hasSubtype || hasTitle || hasDescription;

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

  async function onApplySelectedTemplate() {
    if (!selectedTemplate || !handleApplyTemplate) return;

    const parsedDays = Number(estimatedDaysInput || 0);
    const safeEstimatedDays = parsedDays > 0 ? parsedDays : previewEstimatedDays;

    const payload = await handleApplyTemplate(selectedTemplate, {
      estimated_days: safeEstimatedDays,
      auto_schedule: !!autoSchedule,
      spread_enabled: !!spreadEnabled,
      spread_total: spreadTotal,
    });

    setSelectedTemplateId?.(selectedTemplate.id);

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
  }

  async function handleDeselectClick() {
    if (locked) return;
    if (!onDeselectAppliedTemplate) {
      setSelectedTemplateId?.(null);
      setTemplateSearch("");
      return;
    }
    await onDeselectAppliedTemplate();
  }

  function handleTemplateResultPick(picked) {
    handleTemplatePick?.(picked);
    setTemplateDropdownOpen(false);
  }

  function clearTemplateSearchOnly() {
    setTemplateSearch("");
    setTemplateDropdownOpen(false);
    if (!isTemplateApplied) {
      setSelectedTemplateId?.(null);
    }
  }

  const selectionHeaderTitle = isTemplateApplied
    ? "Template Selected"
    : "Selected Template";
  const selectionHeaderText = isTemplateApplied
    ? "This template is already applied to the agreement. You can preview it below. Until the agreement is signed, you may still deselect it."
    : "Search for a matching template first. If a good match exists, use it as the fastest path into milestones, clarifications, and pricing.";

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-4">
        <div className="text-base font-semibold text-gray-900">Project Basics</div>
        <div className="mt-1 text-sm text-gray-600">
          Start with a template if one already exists for this kind of job.
        </div>
      </div>

      <div className="relative" ref={dropdownRef}>
        <label className="mb-1 block text-sm font-medium">Template Search</label>
        <input
          className="w-full rounded border px-3 py-2 text-sm"
          value={templateSearch}
          onChange={(e) => {
            const v = e.target.value;
            setTemplateSearch(v);
            setTemplateDropdownOpen(true);
            if (!v.trim() && !isTemplateApplied) {
              setSelectedTemplateId(null);
            }
          }}
          onFocus={() => setTemplateDropdownOpen(true)}
          onKeyDown={onSearchKeyDown}
          placeholder='Search templates by keyword, like "bathroom", "deck", or "bedroom addition"...'
          disabled={locked}
        />

        <div className="mt-1 text-[11px] text-gray-500">
          If a matching template exists, choose it first and MyHomeBro will
          populate the project details, milestones, and clarification questions.
        </div>

        {templateDropdownOpen ? (
          <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border bg-white shadow-lg">
            {templatesLoading ? (
              <div className="px-3 py-3 text-sm text-gray-500">
                Loading templates…
              </div>
            ) : templatesErr ? (
              <div className="px-3 py-3 text-sm text-red-600">{templatesErr}</div>
            ) : hasTemplateMatches ? (
              <>
                {!hasTemplateSearch ? (
                  <SearchHintRow
                    onUseScratch={() => setTemplateDropdownOpen(false)}
                  />
                ) : null}

                {filteredTemplates.map((tpl, idx) => {
                  const isRecommended =
                    String(recommendedTemplateId || "") === String(tpl.id);
                  const isPossible =
                    !isRecommended &&
                    (tpl?._matchLevel === "medium" ||
                      recommendationConfidence === "possible");
                  const isApplied =
                    String(effectiveAppliedTemplateId || "") ===
                    String(tpl.id || "");

                  return (
                    <div
                      key={tpl.id}
                      className={idx === templateHighlightedIndex ? "bg-indigo-50" : ""}
                    >
                      <TemplateSearchResult
                        template={tpl}
                        selected={String(selectedTemplateId || "") === String(tpl.id)}
                        applied={isApplied}
                        recommended={
                          isRecommended && recommendationConfidence !== "possible"
                        }
                        possible={isPossible}
                        onPick={handleTemplateResultPick}
                        locked={locked}
                      />
                    </div>
                  );
                })}
              </>
            ) : hasTemplateSearch ? (
              <>
                <div className="px-3 py-3 text-sm text-gray-500">
                  No matching templates found.
                </div>
                <SearchHintRow
                  onUseScratch={() => setTemplateDropdownOpen(false)}
                />
              </>
            ) : (
              <>
                <div className="px-3 py-3 text-sm text-gray-500">
                  Start typing to search your templates and built-in templates.
                </div>
                <SearchHintRow
                  onUseScratch={() => setTemplateDropdownOpen(false)}
                />
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              {selectionHeaderTitle}
            </div>
            <div className="mt-1 text-xs text-gray-600">{selectionHeaderText}</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!agreementId ? (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800">
                Save Draft first to apply
              </span>
            ) : null}

            {agreementId ? (
              <button
                type="button"
                onClick={() => setShowSaveTemplateModal(true)}
                disabled={locked}
                className="rounded border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
              >
                Save Agreement as Template
              </button>
            ) : null}
          </div>
        </div>

        {recommendationLoading ? (
          <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            Finding best template match…
          </div>
        ) : !isTemplateApplied &&
          selectedTemplateIsRecommended &&
          templateRecommendationReason ? (
          <div
            className={`mt-3 rounded border px-3 py-2 text-xs ${
              recommendationConfidence === "possible"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            <span className="font-semibold">
              {recommendationConfidence === "possible"
                ? "Possible"
                : "Recommended"}
            </span>
            {templateRecommendationScore != null
              ? ` (score ${templateRecommendationScore})`
              : ""}
            : {templateRecommendationReason}
            <div className="mt-2 text-[11px]">
              {recommendationConfidence === "possible"
                ? "Review this option first, then compare it with the alternatives below before applying."
                : "Use this template to carry the project into milestones, clarifications, and pricing faster."}
            </div>
          </div>
        ) : null}

        {showNoStrongMatchPanel && !isTemplateApplied ? (
          <div className="mt-3 rounded border border-dashed border-amber-300 bg-white px-3 py-3 text-sm text-amber-800">
            <div className="font-medium">No strong match yet.</div>
            <div className="mt-1 text-xs text-amber-700">
              {noTemplateReason ||
                "You can continue with a blank agreement, review related templates below, or generate milestones from the project scope."}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={runAiMilestonesFromScope}
                disabled={
                  locked ||
                  !agreementId ||
                  !canGenerateFromScope ||
                  aiMilestoneBusy ||
                  blockScopeGeneration
                }
                className="rounded border border-amber-300 bg-white px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-50 disabled:opacity-60"
              >
                {aiMilestoneBusy ? "Working…" : "⚡ Generate Milestones from Scope"}
              </button>

              <button
                type="button"
                onClick={runAiMilestonesFromScope}
                disabled={
                  locked ||
                  !agreementId ||
                  !canGenerateFromScope ||
                  aiMilestoneBusy ||
                  blockScopeGeneration
                }
                className="rounded border border-amber-300 bg-white px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-50 disabled:opacity-60"
              >
                {aiMilestoneBusy
                  ? "Working…"
                  : "⚡ Generate Clarification Questions"}
              </button>
            </div>

            {!agreementId ? (
              <div className="mt-2 text-[11px] text-amber-700">
                Save Draft first so AI can attach milestones and clarification
                questions to this agreement.
              </div>
            ) : null}

            {!canGenerateFromScope ? (
              <div className="mt-2 text-[11px] text-amber-700">
                Add at least a Type, Subtype, Title, or Description so AI has
                enough context.
              </div>
            ) : null}

            {blockScopeGeneration ? (
              <div className="mt-2 text-[11px] text-amber-700">
                A template is already applied. Use the template’s milestones and
                clarification questions instead of generating a new structure from
                scratch.
              </div>
            ) : null}

            {aiMilestoneErr ? (
              <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {aiMilestoneErr}
              </div>
            ) : null}

            {showRelatedContext ? (
              <div className="mt-3 text-[11px] text-amber-700">
                Related templates may still help as inspiration, but they are not
                strong matches for this project.
              </div>
            ) : null}

            {aiMilestonePreview ? (
              <div className="mt-4 rounded-md border border-indigo-200 bg-indigo-50 p-3">
                <div className="text-sm font-semibold text-indigo-900">
                  AI Scope-to-Milestones Preview
                </div>

                {safeTrim(aiMilestonePreview.scope_text) ? (
                  <div className="mt-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-900/80">
                      Scope Summary
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-sm text-indigo-900">
                      {aiMilestonePreview.scope_text}
                    </div>
                  </div>
                ) : null}

                {Array.isArray(aiMilestonePreview.milestones) &&
                aiMilestonePreview.milestones.length ? (
                  <div className="mt-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-900/80">
                      Suggested Milestones
                    </div>

                    <div className="mt-2 space-y-2">
                      {aiMilestonePreview.milestones.map((m, idx) => (
                        <div
                          key={`${m.title || "milestone"}-${idx}`}
                          className="rounded border border-indigo-100 bg-white px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-medium text-gray-900">
                              {idx + 1}. {m.title || `Milestone ${idx + 1}`}
                            </div>
                            <div className="text-xs font-semibold text-indigo-800">
                              ${Number(m.amount || 0).toFixed(2)}
                            </div>
                          </div>

                          {safeTrim(m.description) ? (
                            <div className="mt-1 whitespace-pre-wrap text-xs text-gray-600">
                              {m.description}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {aiMilestoneQuestions.length ? (
                  <div className="mt-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-900/80">
                      Suggested Clarification Questions
                    </div>

                    <div className="mt-2 space-y-2">
                      {aiMilestoneQuestions.map((q, idx) => {
                        const questionText =
                          safeTrim(q?.label) ||
                          safeTrim(q?.question) ||
                          safeTrim(q?.text) ||
                          safeTrim(q?.prompt) ||
                          safeTrim(q?.key) ||
                          `Question ${idx + 1}`;

                        const renderedOptions = Array.isArray(q.options)
                          ? q.options
                              .map((opt) =>
                                typeof opt === "string"
                                  ? opt
                                  : safeTrim(opt?.label) || safeTrim(opt?.value)
                              )
                              .filter(Boolean)
                          : [];

                        return (
                          <div
                            key={`${q.key || "q"}-${idx}`}
                            className="rounded border border-indigo-100 bg-white px-3 py-2"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-medium text-gray-900">
                                {questionText}
                              </div>

                              {q.required ? (
                                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
                                  Recommended
                                </span>
                              ) : null}

                              {safeTrim(q.type || q.inputType) ? (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                                  {q.type || q.inputType}
                                </span>
                              ) : null}
                            </div>

                            {safeTrim(q.help) ? (
                              <div className="mt-1 text-xs text-gray-600">
                                {q.help}
                              </div>
                            ) : null}

                            {renderedOptions.length ? (
                              <div className="mt-1 text-[11px] text-gray-500">
                                Options: {renderedOptions.join(", ")}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                <div className="mt-3 rounded border bg-white p-3">
                  <label className="flex items-center gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={spreadEnabled}
                      onChange={(e) => setSpreadEnabled(e.target.checked)}
                      disabled={locked || aiMilestoneApplying}
                    />
                    Auto-spread total across milestones
                  </label>

                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-gray-600">Total ($)</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      className="w-40 rounded border px-2 py-2 text-sm"
                      placeholder="e.g., 1250.00"
                      value={spreadTotal}
                      onChange={(e) => setSpreadTotal(e.target.value)}
                      disabled={!spreadEnabled || locked || aiMilestoneApplying}
                    />
                  </div>

                  <div className="mt-1 text-[11px] text-gray-500">
                    Leave blank to keep AI amounts as returned.
                  </div>

                  <label className="mt-3 flex items-center gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={autoSchedule}
                      onChange={(e) => setAutoSchedule(e.target.checked)}
                      disabled={locked || aiMilestoneApplying}
                    />
                    Auto-schedule milestones (requires Agreement start/end)
                  </label>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => applyAiMilestonesFromScope("replace")}
                    disabled={locked || aiMilestoneApplying}
                    className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {aiMilestoneApplying
                      ? "Applying…"
                      : "Apply Milestones (Replace Existing)"}
                  </button>

                  <button
                    type="button"
                    onClick={() => applyAiMilestonesFromScope("append")}
                    disabled={locked || aiMilestoneApplying}
                    className="rounded border px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-60"
                  >
                    {aiMilestoneApplying
                      ? "Applying…"
                      : "Apply Milestones (Append)"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setAiMilestonePreview(null)}
                    disabled={aiMilestoneApplying}
                    className="rounded border px-3 py-1.5 text-xs"
                  >
                    Cancel
                  </button>

                  {agreementId ? (
                    <button
                      type="button"
                      onClick={() => setShowSaveTemplateModal(true)}
                      disabled={locked}
                      className="rounded border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                    >
                      Save Agreement as Template
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {selectedTemplate ? (
          <div className="mt-3 rounded-md border bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900">
                    {selectedTemplate.name}
                  </span>

                  <OptionBadge
                    ownerType={
                      selectedTemplate?.owner_type ||
                      (selectedTemplate?.is_system ? "system" : "contractor")
                    }
                  />

                  {isTemplateApplied ? (
                    <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-800">
                      Applied to Agreement
                    </span>
                  ) : selectedTemplateIsRecommended &&
                    recommendationConfidence !== "possible" ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                      Recommended
                    </span>
                  ) : null}

                  {!isTemplateApplied &&
                  (selectedTemplate?._matchLevel === "medium" ||
                    recommendationConfidence === "possible") ? (
                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      Possible
                    </span>
                  ) : null}
                </div>

                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-600">
                  {safeTrim(selectedTemplate.project_type) ? (
                    <span className="rounded bg-slate-100 px-2 py-1">
                      {selectedTemplate.project_type}
                    </span>
                  ) : null}

                  {safeTrim(selectedTemplate.project_subtype) ? (
                    <span className="rounded bg-slate-100 px-2 py-1">
                      {selectedTemplate.project_subtype}
                    </span>
                  ) : null}

                  <span className="rounded bg-slate-100 px-2 py-1">
                    {getMilestoneCount(previewTemplate || selectedTemplate)} milestones
                  </span>

                  <span className="rounded bg-slate-100 px-2 py-1">
                    {getSafeEstimatedDays(previewTemplate || selectedTemplate)} day
                    {getSafeEstimatedDays(previewTemplate || selectedTemplate) === 1
                      ? ""
                      : "s"}
                  </span>
                </div>

                {safeTrim(selectedTemplate?._matchReason) && !isTemplateApplied ? (
                  <div className="mt-2 text-[11px] text-slate-500">
                    {selectedTemplate._matchReason}
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => setSelectedPreviewOpen((prev) => !prev)}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                {selectedPreviewOpen
                  ? "Collapse Preview"
                  : isTemplateApplied
                  ? "Preview Selected Template"
                  : "Expand Preview"}
              </button>
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

            {selectedPreviewOpen ? (
              <>
                {safeTrim(previewTemplate?.description) ? (
                  <PreviewSection title="Description">
                    <div className="whitespace-pre-wrap text-xs text-gray-700">
                      {previewTemplate.description}
                    </div>
                  </PreviewSection>
                ) : null}

                <PreviewSection title="Estimated Project Duration">
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-700">
                        Total Days
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={estimatedDaysInput}
                        onChange={(e) => setEstimatedDaysInput(e.target.value)}
                        disabled={locked}
                        className="w-32 rounded border px-3 py-2 text-sm"
                      />
                    </div>

                    {handleUpdateTemplateDays ? (
                      <button
                        type="button"
                        onClick={onSaveDaysToTemplate}
                        disabled={
                          locked ||
                          savingTemplateDays ||
                          !Number(estimatedDaysInput || 0) ||
                          Number(estimatedDaysInput || 0) < 1
                        }
                        className="rounded border border-indigo-200 bg-white px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                      >
                        {savingTemplateDays ? "Saving..." : "Save Days to Template"}
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-2 text-[11px] text-slate-500">
                    This is a suggested duration for this type of project.
                    Contractors can still update milestone dates after applying the
                    template.
                  </div>
                </PreviewSection>

                {previewMilestones.length ? (
                  <PreviewSection title="Milestone Preview">
                    <div className="space-y-2">
                      {previewMilestones.map((m, idx) => {
                        const suggestedDay = buildSuggestedDayLabel(
                          idx,
                          previewMilestones.length,
                          Number(estimatedDaysInput || 0) || previewEstimatedDays
                        );

                        return (
                          <div
                            key={m.id || `${m.title}-${idx}`}
                            className="rounded border border-slate-200 bg-white px-3 py-2"
                          >
                            <div className="text-xs font-medium text-gray-900">
                              {idx + 1}. {m.title || "Untitled milestone"}
                            </div>

                            {suggestedDay ? (
                              <div className="mt-1 text-[11px] font-medium text-indigo-700">
                                Suggested target: {suggestedDay}
                              </div>
                            ) : null}

                            {safeTrim(m.description) ? (
                              <div className="mt-1 text-[11px] text-gray-600">
                                {m.description}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </PreviewSection>
                ) : null}

                {previewClarifications.length ? (
                  <PreviewSection title="Clarifications">
                    <ul className="list-disc space-y-1 pl-4 text-xs text-gray-700">
                      {previewClarifications.map((item, idx) => (
                        <li key={`${item}-${idx}`}>{item}</li>
                      ))}
                    </ul>
                  </PreviewSection>
                ) : null}
              </>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!isTemplateApplied ? (
                <button
                  type="button"
                  onClick={onApplySelectedTemplate}
                  disabled={
                    locked ||
                    !agreementId ||
                    applyingTemplateId === selectedTemplate.id
                  }
                  className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {applyingTemplateId === selectedTemplate.id
                    ? "Applying…"
                    : "Apply Selected Template"}
                </button>
              ) : null}

              {isTemplateApplied ? (
                <button
                  type="button"
                  onClick={handleDeselectClick}
                  disabled={locked}
                  className="rounded border px-3 py-1.5 text-xs disabled:opacity-60"
                >
                  Deselect Template
                </button>
              ) : (
                <button
                  type="button"
                  onClick={clearTemplateSearchOnly}
                  disabled={locked}
                  className="rounded border px-3 py-1.5 text-xs disabled:opacity-60"
                >
                  Clear
                </button>
              )}

              {!selectedTemplate?.is_system && !isTemplateApplied ? (
                <button
                  type="button"
                  onClick={handleDeleteTemplate}
                  disabled={locked}
                  className="rounded border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  Delete Template
                </button>
              ) : null}
            </div>

            {!agreementId ? (
              <div className="mt-2 text-[11px] text-amber-700">
                Create/save the agreement first, then apply the template so
                milestones can be generated on the backend.
              </div>
            ) : null}
          </div>
        ) : !showNoStrongMatchPanel ? (
          <div className="mt-3 rounded border border-dashed border-gray-300 bg-white px-3 py-3 text-sm text-gray-600">
            No template selected yet. Search for a template above, or continue
            below and build the project from scratch.
          </div>
        ) : null}
      </div>

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
              <option value="">— Select Type —</option>
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
                {hasType ? "— Select Subtype —" : "Select Type first"}
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
              ✨ AI Assist can turn a rough idea into a clearer, stronger, more
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
                <div className="mt-3 rounded-md border bg-indigo-50 p-3">
                  <div className="mb-2 text-xs font-semibold text-indigo-900">
                    AI Suggested Scope Draft
                  </div>

                  <div className="whitespace-pre-wrap text-sm text-indigo-900">
                    {aiPreview}
                  </div>

                  <div className="mt-2 text-[11px] text-indigo-900/80">
                    Review this draft before using it.
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
          </div>
        </details>
      </div>
    </div>
  );
}
