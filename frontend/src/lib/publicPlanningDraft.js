// Short-lived, tab-scoped handoff. The server validates the signed preview again
// when the customer explicitly confirms saving it; this is never authority.
export const PUBLIC_PLANNING_DRAFT_KEY = 'mhb-public-planning-draft-v1';
export const PUBLIC_PLANNING_DRAFT_VERSION = 1;
export const PUBLIC_PLANNING_CONTINUATION =
  '/portal?workspace=diy-planner&action=create&planning_draft=1';
export const PUBLIC_PLANNING_DRAFT_MAX_BYTES = 512 * 1024;
export const PUBLIC_PLANNING_INPUT_LIMITS = Object.freeze({
  title: 200,
  desired_outcome: 2000,
  existing_conditions: 2000,
  additional_context: 2000,
  confidence_notes: 1000,
});

const record = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max, required = false) =>
  typeof value === 'string' &&
  value.length <= max &&
  (!required || Boolean(value.trim()));
const list = (value, max, predicate) =>
  Array.isArray(value) && value.length <= max && value.every(predicate);
const onlyKeys = (value, keys) =>
  Object.keys(value).every((key) => keys.includes(key));
const participation = new Set([
  'DO_IT_MYSELF',
  'NEED_GUIDANCE',
  'NEED_HELP',
  'NEED_PROFESSIONAL',
  'UNDECIDED',
]);

function validProposal(proposal) {
  if (!record(proposal)) return false;
  if (
    !onlyKeys(proposal, [
      'summary',
      'limitations',
      'source',
      'questions',
      'warnings',
      'assumptions',
      'phases',
    ]) ||
    !text(proposal.summary, 1200) ||
    !text(proposal.limitations, 2000) ||
    !text(proposal.source, 80) ||
    !list(
      proposal.questions,
      10,
      (row) =>
        record(row) &&
        onlyKeys(row, ['id', 'question']) &&
        text(row.id, 60, true) &&
        text(row.question, 300, true)
    ) ||
    !list(
      proposal.warnings,
      10,
      (row) =>
        record(row) &&
        onlyKeys(row, ['level', 'message']) &&
        text(row.level, 80) &&
        text(row.message, 500, true)
    ) ||
    !list(proposal.assumptions, 10, (row) => text(row, 400))
  )
    return false;
  return (
    proposal.phases?.length > 0 &&
    list(
      proposal.phases,
      20,
      (phase) =>
        record(phase) &&
        onlyKeys(phase, ['client_id', 'title', 'description', 'tasks']) &&
        text(phase.client_id, 80, true) &&
        text(phase.title, 200, true) &&
        text(phase.description, 2000) &&
        phase.tasks?.length > 0 &&
        list(
          phase.tasks,
          40,
          (task) =>
            record(task) &&
            onlyKeys(task, [
              'client_id',
              'title',
              'description',
              'participation_type',
              'professional_review_recommended',
              'reason',
              'estimated_duration',
              'estimated_cost',
              'prerequisite_notes',
            ]) &&
            text(task.client_id, 80, true) &&
            text(task.title, 200, true) &&
            text(task.description, 2000) &&
            participation.has(task.participation_type) &&
            typeof task.professional_review_recommended === 'boolean' &&
            text(task.reason, 500) &&
            text(task.estimated_duration, 120) &&
            (task.estimated_cost === null ||
              (text(task.estimated_cost, 80) &&
                /^\d+(\.\d+)?$/.test(task.estimated_cost))) &&
            text(task.prerequisite_notes, 1000)
        )
    )
  );
}

export function validatePublicPlanningDraft(draft) {
  try {
    if (
      !record(draft) ||
      !onlyKeys(draft, [
        'version',
        'preview_token',
        'expires_at',
        'source_template_id',
        'inputs',
        'proposal',
        'guide_path',
      ])
    )
      return false;
    if (
      draft.version !== PUBLIC_PLANNING_DRAFT_VERSION ||
      !text(draft.preview_token, 256 * 1024, true) ||
      !text(draft.expires_at, 80, true) ||
      !Number.isFinite(Date.parse(draft.expires_at)) ||
      Date.parse(draft.expires_at) <= Date.now() ||
      !Number.isSafeInteger(draft.source_template_id) ||
      draft.source_template_id <= 0 ||
      !text(draft.guide_path, 500, true) ||
      !/^\/improvements\/[a-z0-9-]+\/[a-z0-9-]+\/$/.test(draft.guide_path) ||
      !record(draft.inputs) ||
      !onlyKeys(draft.inputs, Object.keys(PUBLIC_PLANNING_INPUT_LIMITS)) ||
      !Object.entries(PUBLIC_PLANNING_INPUT_LIMITS).every(([key, max]) =>
        text(
          draft.inputs[key],
          max,
          key === 'title' || key === 'desired_outcome'
        )
      ) ||
      !validProposal(draft.proposal)
    )
      return false;
    return (
      new TextEncoder().encode(JSON.stringify(draft)).length <=
      PUBLIC_PLANNING_DRAFT_MAX_BYTES
    );
  } catch {
    return false;
  }
}

export function writePublicPlanningDraft(draft) {
  try {
    if (!validatePublicPlanningDraft(draft)) return false;
    const encoded = JSON.stringify(draft);
    window.sessionStorage.setItem(PUBLIC_PLANNING_DRAFT_KEY, encoded);
    return window.sessionStorage.getItem(PUBLIC_PLANNING_DRAFT_KEY) === encoded;
  } catch {
    return false;
  }
}

export function readPublicPlanningDraft() {
  try {
    const encoded = window.sessionStorage.getItem(PUBLIC_PLANNING_DRAFT_KEY);
    if (!encoded) return null;
    if (encoded.length > PUBLIC_PLANNING_DRAFT_MAX_BYTES) {
      clearPublicPlanningDraft();
      return null;
    }
    const draft = JSON.parse(encoded);
    if (!validatePublicPlanningDraft(draft)) {
      clearPublicPlanningDraft();
      return null;
    }
    return draft;
  } catch {
    clearPublicPlanningDraft();
    return null;
  }
}

export function clearPublicPlanningDraft() {
  try {
    window.sessionStorage.removeItem(PUBLIC_PLANNING_DRAFT_KEY);
    return window.sessionStorage.getItem(PUBLIC_PLANNING_DRAFT_KEY) === null;
  } catch {
    return false;
  }
}
