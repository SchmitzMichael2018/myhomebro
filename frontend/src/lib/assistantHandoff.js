const FIRST_PROJECT_HANDOFF_STORAGE_KEY = "mhb_first_project_assist_handoff";

export const HANDOFF_SAFE_DEFAULTS = Object.freeze({
  prefillFields: {},
  draftPayload: {},
  context: {},
  wizardStepTarget: null,
  suggestedMilestones: [],
  clarificationQuestions: [],
  estimatePreview: {},
  templateRecommendations: [],
  topTemplatePreview: {},
  proactiveRecommendations: [],
  predictiveInsights: [],
  proposedActions: [],
  confirmationRequiredActions: [],
  guidedFlow: {},
  automationPlan: {},
  intent: "",
  projectAddress: {},
  complianceFlags: [],
});

// Each entry: [key, validator fn, default value]
const HANDOFF_FIELD_SPECS = [
  ["prefillFields",              (v) => isPlainObject(v),           {}],
  ["draftPayload",               (v) => isPlainObject(v),           {}],
  ["context",                    (v) => isPlainObject(v),           {}],
  ["wizardStepTarget",           (v) => v === null || typeof v === "number", null],
  ["suggestedMilestones",        Array.isArray,                     []],
  ["clarificationQuestions",     Array.isArray,                     []],
  ["estimatePreview",            (v) => v === null || isPlainObject(v), {}],
  ["templateRecommendations",    Array.isArray,                     []],
  ["topTemplatePreview",         (v) => isPlainObject(v),           {}],
  ["proactiveRecommendations",   Array.isArray,                     []],
  ["predictiveInsights",         Array.isArray,                     []],
  ["proposedActions",            Array.isArray,                     []],
  ["confirmationRequiredActions",Array.isArray,                     []],
  ["guidedFlow",                 (v) => v === null || isPlainObject(v), {}],
  ["automationPlan",             (v) => v === null || isPlainObject(v), {}],
  ["intent",                     (v) => typeof v === "string",      ""],
  ["projectAddress",             (v) => v === null || isPlainObject(v), {}],
  ["complianceFlags",            Array.isArray,                     []],
];

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Validates a handoff payload (typically the output of getAssistantHandoff).
 * Always returns a usable payload — never throws.
 *
 * @param {unknown} payload
 * @returns {{ valid: boolean, payload: object, errors: string[] }}
 */
export function validateHandoff(payload) {
  if (payload == null || !isPlainObject(payload)) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[validateHandoff] Expected a plain object — using safe defaults.", payload);
    }
    return {
      valid: false,
      payload: { ...HANDOFF_SAFE_DEFAULTS },
      errors: ["payload must be a plain object"],
    };
  }

  const errors = [];
  const result = {};

  for (const [key, isValid, defaultValue] of HANDOFF_FIELD_SPECS) {
    if (!(key in payload)) {
      errors.push(`missing key: "${key}"`);
      result[key] = Array.isArray(defaultValue) ? [] : defaultValue === null ? null : typeof defaultValue === "object" ? {} : defaultValue;
      continue;
    }
    const value = payload[key];
    if (!isValid(value)) {
      errors.push(`wrong type for "${key}": got ${Array.isArray(value) ? "array" : typeof value}`);
      result[key] = Array.isArray(defaultValue) ? [] : defaultValue === null ? null : typeof defaultValue === "object" ? {} : defaultValue;
      continue;
    }
    result[key] = value;
  }

  if (errors.length > 0 && process.env.NODE_ENV !== "production") {
    console.warn("[validateHandoff] Validation issues:", errors);
  }

  return { valid: errors.length === 0, payload: result, errors };
}

function safeObject(value) {
  return value && typeof value === "object" ? value : {};
}

function readSessionAssistantHandoff() {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return {};
    const raw = window.sessionStorage.getItem(FIRST_PROJECT_HANDOFF_STORAGE_KEY);
    if (!raw) return {};
    return safeObject(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function writeSessionAssistantHandoff(payload = {}) {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    window.sessionStorage.setItem(FIRST_PROJECT_HANDOFF_STORAGE_KEY, JSON.stringify(safeObject(payload)));
  } catch {
    // ignore storage failures
  }
}

export function clearSessionAssistantHandoff() {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    window.sessionStorage.removeItem(FIRST_PROJECT_HANDOFF_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}

export function isBlankAssistantValue(value) {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function getAssistantHandoff(locationState) {
  const storedState = readSessionAssistantHandoff();
  const state = Object.keys(safeObject(locationState)).length
    ? safeObject(locationState)
    : storedState;
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
    projectAddress: safeObject(state.assistantProjectAddress),
    complianceFlags: Array.isArray(state.assistantComplianceFlags)
      ? state.assistantComplianceFlags
      : [],
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
    projectAddress: safeObject(handoff?.projectAddress),
    complianceFlags: Array.isArray(handoff?.complianceFlags) ? handoff.complianceFlags : [],
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
