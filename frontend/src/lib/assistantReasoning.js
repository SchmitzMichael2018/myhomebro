import { planAssistantActionRules } from "./startWithAiAssistant.js";

const KNOWN_INTENTS = new Set([
  "create_lead",
  "create_customer",
  "start_agreement",
  "apply_template",
  "suggest_milestones",
  "collect_clarifications",
  "resume_agreement",
  "navigate_app",
  "estimate_project",
  "check_compliance",
  "subcontractor_assignment",
  "maintenance_contract",
]);

function clean(value) {
  return String(value || "").trim();
}

function safeObject(value) {
  return value && typeof value === "object" ? value : {};
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeAssistantRequest(request = {}) {
  return {
    input: clean(request.input),
    preferredIntent: clean(request.preferredIntent),
    previousPlan: safeObject(request.previousPlan),
    context: safeObject(request.context),
  };
}

function buildConfidence(plan, request) {
  const text = clean(request.input).toLowerCase();
  if (plan.missing_fields?.length) return "medium";
  if (request.context?.agreement_id && plan.intent === "resume_agreement") return "high";
  if (request.context?.lead_id && ["create_lead", "start_agreement"].includes(plan.intent)) {
    return "high";
  }
  if (
    /finish|resume|continue|unstick|blocked|clarif|template|milestone|lead|customer|agreement|navigate/.test(
      text
    )
  ) {
    return "high";
  }
  if (plan.intent === "navigate_app") return "low";
  return "medium";
}

function chooseHeuristicIntent(request, fallbackPlan) {
  const text = clean(request.input).toLowerCase();
  const context = safeObject(request.context);

  if (context.agreement_id && /(pick up|left off|continue|unstick|blocked|finish)/.test(text)) {
    return "resume_agreement";
  }
  if (context.agreement_id && /(clarif|question|missing detail)/.test(text)) {
    return "collect_clarifications";
  }
  if (context.agreement_id && /(milestone|schedule|pricing break|build phases)/.test(text)) {
    return "suggest_milestones";
  }
  if (context.template_id && /(apply|use|reuse|template)/.test(text)) {
    return "apply_template";
  }
  if (context.lead_id && /(send intake|capture scope|follow up)/.test(text)) {
    return "create_lead";
  }
  return fallbackPlan.intent;
}

function enrichPlan(plan, request, reasoningSource) {
  return {
    ...plan,
    planning_confidence: buildConfidence(plan, request),
    reasoning_source: reasoningSource,
    structured_result_version: 1,
  };
}

function isValidMissingField(field) {
  return field && typeof field === "object" && typeof field.key === "string";
}

export function validateStructuredPlanShape(plan) {
  if (!plan || typeof plan !== "object") return false;
  if (!KNOWN_INTENTS.has(plan.intent)) return false;
  if (typeof plan.intent_label !== "string") return false;
  if (!plan.next_action || typeof plan.next_action !== "object") return false;
  if (typeof plan.next_action.label !== "string") return false;
  if (typeof plan.navigation_target !== "string") return false;
  if (!Array.isArray(plan.missing_fields) || !plan.missing_fields.every(isValidMissingField)) {
    return false;
  }
  if (!Array.isArray(plan.suggestions)) return false;
  if (!Array.isArray(plan.suggested_milestones)) return false;
  if (!Array.isArray(plan.clarification_questions)) return false;
  if (!Array.isArray(plan.blocked_workflow_states)) return false;
  if (typeof safeObject(plan.prefill_fields) !== "object") return false;
  if (typeof safeObject(plan.draft_payload) !== "object") return false;
  return true;
}

export function normalizeStructuredPlanShape(plan, fallbackPlan) {
  const source = validateStructuredPlanShape(plan) ? plan : fallbackPlan;
  const extraSource = safeObject(plan);
  return {
    ...source,
    collected_data: safeObject(source.collected_data),
    missing_fields: safeArray(source.missing_fields),
    suggestions: safeArray(source.suggestions),
    prefill_fields: safeObject(source.prefill_fields),
    draft_payload: safeObject(source.draft_payload),
    suggested_milestones: safeArray(source.suggested_milestones),
    clarification_questions: safeArray(source.clarification_questions),
    blocked_workflow_states: safeArray(source.blocked_workflow_states),
    automation_plan: safeObject(source.automation_plan || extraSource.automation_plan),
    applyable_preview: safeObject(source.applyable_preview || extraSource.applyable_preview),
    guided_flow: safeObject(source.guided_flow || extraSource.guided_flow),
    proactive_recommendations: safeArray(
      source.proactive_recommendations || extraSource.proactive_recommendations
    ),
    predictive_insights: safeArray(
      source.predictive_insights || extraSource.predictive_insights
    ),
    proposed_actions: safeArray(source.proposed_actions || extraSource.proposed_actions),
    confirmation_required_actions: safeArray(
      source.confirmation_required_actions || extraSource.confirmation_required_actions
    ),
    preview_payload: safeObject(source.preview_payload || extraSource.preview_payload),
    guided_step: clean(source.guided_step || extraSource.guided_step),
    guided_question: clean(source.guided_question || extraSource.guided_question),
    field_key: clean(source.field_key || extraSource.field_key),
    current_value: source.current_value ?? extraSource.current_value ?? "",
    suggested_value: source.suggested_value ?? extraSource.suggested_value ?? "",
    why_this_matters: clean(source.why_this_matters || extraSource.why_this_matters),
    wizard_step_target:
      source.wizard_step_target == null ? null : Number(source.wizard_step_target),
    planning_confidence: clean(source.planning_confidence || "medium"),
    reasoning_source: clean(source.reasoning_source || "rules_fallback"),
    structured_result_version: Number(source.structured_result_version || 1),
  };
}

export function produceStructuredAssistantPlan(request = {}) {
  const normalizedRequest = normalizeAssistantRequest(request);
  const fallbackPlan = enrichPlan(
    planAssistantActionRules(normalizedRequest),
    normalizedRequest,
    "rules_fallback"
  );

  try {
    const heuristicIntent = chooseHeuristicIntent(normalizedRequest, fallbackPlan);
    const heuristicPlan =
      heuristicIntent && heuristicIntent !== fallbackPlan.intent
        ? planAssistantActionRules({
            ...normalizedRequest,
            preferredIntent: heuristicIntent,
          })
        : fallbackPlan;

    const candidate = enrichPlan(
      heuristicPlan,
      normalizedRequest,
      heuristicIntent !== fallbackPlan.intent ? "heuristic_adapter" : "rules_fallback"
    );
    return normalizeStructuredPlanShape(candidate, fallbackPlan);
  } catch {
    return normalizeStructuredPlanShape(fallbackPlan, fallbackPlan);
  }
}
