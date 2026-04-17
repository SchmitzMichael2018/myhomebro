function safeObject(value) {
  return value && typeof value === "object" ? value : {};
}

export function isBlankAssistantValue(value) {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function getAssistantHandoff(locationState) {
  const state = safeObject(locationState);
  return {
    prefillFields: safeObject(state.assistantPrefill),
    draftPayload: safeObject(state.assistantDraftPayload),
    context: safeObject(state.assistantContext),
    wizardStepTarget:
      state.assistantWizardStepTarget != null
        ? Number(state.assistantWizardStepTarget)
        : null,
    suggestedMilestones: Array.isArray(state.assistantSuggestedMilestones)
      ? state.assistantSuggestedMilestones
      : [],
    clarificationQuestions: Array.isArray(state.assistantClarificationQuestions)
      ? state.assistantClarificationQuestions
      : [],
    estimatePreview: safeObject(state.assistantEstimatePreview),
    templateRecommendations: Array.isArray(state.assistantTemplateRecommendations)
      ? state.assistantTemplateRecommendations
      : [],
    topTemplatePreview: safeObject(state.assistantTopTemplatePreview),
    proactiveRecommendations: Array.isArray(state.assistantProactiveRecommendations)
      ? state.assistantProactiveRecommendations
      : [],
    predictiveInsights: Array.isArray(state.assistantPredictiveInsights)
      ? state.assistantPredictiveInsights
      : [],
    proposedActions: Array.isArray(state.assistantProposedActions)
      ? state.assistantProposedActions
      : [],
    confirmationRequiredActions: Array.isArray(state.assistantConfirmationRequiredActions)
      ? state.assistantConfirmationRequiredActions
      : [],
    guidedFlow: safeObject(state.assistantGuidedFlow),
    automationPlan: safeObject(state.assistantAutomationPlan),
    intent: typeof state.assistantIntent === "string" ? state.assistantIntent : "",
  };
}

export function buildAssistantHandoffSignature(handoff) {
  return JSON.stringify({
    context: safeObject(handoff?.context),
    prefillFields: safeObject(handoff?.prefillFields),
    draftPayload: safeObject(handoff?.draftPayload),
    wizardStepTarget: handoff?.wizardStepTarget ?? null,
    suggestedMilestones: Array.isArray(handoff?.suggestedMilestones)
      ? handoff.suggestedMilestones
      : [],
    clarificationQuestions: Array.isArray(handoff?.clarificationQuestions)
      ? handoff.clarificationQuestions
      : [],
    estimatePreview: safeObject(handoff?.estimatePreview),
    templateRecommendations: Array.isArray(handoff?.templateRecommendations)
      ? handoff.templateRecommendations
      : [],
    proactiveRecommendations: Array.isArray(handoff?.proactiveRecommendations)
      ? handoff.proactiveRecommendations
      : [],
    predictiveInsights: Array.isArray(handoff?.predictiveInsights)
      ? handoff.predictiveInsights
      : [],
    proposedActions: Array.isArray(handoff?.proposedActions)
      ? handoff.proposedActions
      : [],
    confirmationRequiredActions: Array.isArray(handoff?.confirmationRequiredActions)
      ? handoff.confirmationRequiredActions
      : [],
    guidedFlow: safeObject(handoff?.guidedFlow),
    intent: handoff?.intent || "",
  });
}

export function mergeAssistantFields(currentValues, incomingValues) {
  const current = safeObject(currentValues);
  const incoming = safeObject(incomingValues);
  const next = { ...current };
  const appliedKeys = [];

  Object.entries(incoming).forEach(([key, value]) => {
    if (isBlankAssistantValue(value)) return;
    if (!isBlankAssistantValue(next[key])) return;
    next[key] = value;
    appliedKeys.push(key);
  });

  return { next, appliedKeys };
}

export function normalizeAssistantQuestion(question, index = 0) {
  if (typeof question === "string") {
    const label = question.trim();
    return label
      ? {
          key: `assistant_question_${index + 1}`,
          label,
          help: "",
          required: true,
          type: "text",
        }
      : null;
  }

  const source = safeObject(question);
  const label = String(source.label || source.question || source.key || "").trim();
  if (!label) return null;

  return {
    ...source,
    key: String(source.key || `assistant_question_${index + 1}`),
    label,
    help: String(source.help || source.description || "").trim(),
    required: source.required !== false,
    type: String(source.type || source.inputType || "text").trim(),
    options: Array.isArray(source.options) ? source.options : [],
  };
}

export function normalizeAssistantMilestoneSuggestion(milestone, index = 0) {
  if (typeof milestone === "string") {
    const title = milestone.trim();
    return title
      ? {
          title,
          description: "",
          amount: "",
          start_date: "",
          completion_date: "",
          order: index + 1,
        }
      : null;
  }

  const source = safeObject(milestone);
  const title = String(source.title || source.name || "").trim();
  if (!title) return null;

  return {
    ...source,
    title,
    description: String(source.description || "").trim(),
    amount:
      source.amount != null && String(source.amount).trim() !== ""
        ? String(source.amount).trim()
        : "",
    start_date: String(source.start_date || source.start || "").trim(),
    completion_date: String(source.completion_date || source.end || "").trim(),
    order: source.order != null ? source.order : index + 1,
  };
}
