import rules from "../../../shared/milestone_shaping_rules.json" with { type: "json" };

function safeStr(value) {
  return value == null ? "" : String(value).trim();
}

function normalizeMatchText(value) {
  return safeStr(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s/&-]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeYesNoAnswer(value) {
  const normalized = safeStr(value).toLowerCase();
  if (normalized === "yes" || normalized === "true") return "yes";
  if (normalized === "no" || normalized === "false") return "no";
  return "";
}

function appendMilestoneDetail(baseText, detail) {
  const base = safeStr(baseText);
  const extra = safeStr(detail);
  if (!extra) return base;
  if (!base) return extra;
  return `${base.replace(/[.]+$/, "")}. ${extra}`;
}

function insertMilestoneRow(rows, index, row) {
  const next = Array.isArray(rows) ? [...rows] : [];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, row);
  return next;
}

function cloneRow(row) {
  return {
    title: safeStr(row?.title),
    description: safeStr(row?.description),
  };
}

function findRowIndexByTitle(rows, title) {
  const target = safeStr(title);
  return (Array.isArray(rows) ? rows : []).findIndex((row) => safeStr(row?.title) === target);
}

function resolveActionIndex(rows, title, fallbackTitle) {
  const directIndex = findRowIndexByTitle(rows, title);
  if (directIndex >= 0) return directIndex;
  if (fallbackTitle) return findRowIndexByTitle(rows, fallbackTitle);
  return -1;
}

function resolveTemplate(template, answers) {
  return safeStr(template).replace(/\{answer:([^}]+)\}/g, (_, key) => safeStr(answers?.[key]));
}

function conditionMatches(condition, answers) {
  if (!condition || typeof condition !== "object") return true;
  const rawValue = answers?.[condition.answer];
  if (condition.present) return safeStr(rawValue).length > 0;
  if (condition.equals === "yes" || condition.equals === "no") {
    return normalizeYesNoAnswer(rawValue) === condition.equals;
  }
  return safeStr(rawValue) === safeStr(condition.equals);
}

function ruleMatches(rule, { projectType, projectSubtype }) {
  const match = rule?.match || {};
  const normalizedSubtype = normalizeMatchText(projectSubtype);
  const normalizedType = normalizeMatchText(projectType);

  const subtypeMatches =
    !Array.isArray(match.subtypeIncludes) ||
    match.subtypeIncludes.some((token) => normalizedSubtype.includes(normalizeMatchText(token)));
  const typeMatches =
    !Array.isArray(match.typeIncludes) ||
    match.typeIncludes.some((token) => normalizedType.includes(normalizeMatchText(token)));

  return subtypeMatches && typeMatches;
}

function buildDefaultMilestoneAmounts(count, totalBudget) {
  const safeCount = Math.max(1, Number(count || 0));
  const normalizedTotal = Number(totalBudget);
  const fallbackTotal = normalizedTotal > 0 ? normalizedTotal : safeCount <= 4 ? 4000 : 6000;
  const configuredWeights = rules?.defaultAmountWeights?.[String(safeCount)];
  const weights =
    Array.isArray(configuredWeights) && configuredWeights.length === safeCount
      ? configuredWeights
      : Array.from({ length: safeCount }, () => 1 / safeCount);

  let allocated = 0;
  return weights.map((weight, idx) => {
    if (idx === weights.length - 1) {
      return Number((fallbackTotal - allocated).toFixed(2));
    }
    const next = Number((fallbackTotal * Number(weight || 0)).toFixed(2));
    allocated += next;
    return next;
  });
}

function applyAction(rows, action, answers) {
  const nextRows = Array.isArray(rows) ? [...rows] : [];
  if (!action || typeof action !== "object") return nextRows;

  if (action.type === "insert_at") {
    return insertMilestoneRow(nextRows, Number(action.index || 0), cloneRow(action.row));
  }

  if (action.type === "insert_after_title") {
    const index = resolveActionIndex(nextRows, action.title, action.fallbackTitle);
    if (index < 0) return nextRows;
    return insertMilestoneRow(nextRows, index + 1, cloneRow(action.row));
  }

  if (action.type === "replace_title") {
    const index = findRowIndexByTitle(nextRows, action.title);
    if (index < 0) return nextRows;
    nextRows[index] = cloneRow(action.row);
    return nextRows;
  }

  if (action.type === "remove_title") {
    const index = findRowIndexByTitle(nextRows, action.title);
    if (index < 0) return nextRows;
    nextRows.splice(index, 1);
    return nextRows;
  }

  if (action.type === "append_detail") {
    const index = resolveActionIndex(nextRows, action.title, action.fallbackTitle);
    if (index < 0) return nextRows;
    nextRows[index] = {
      ...nextRows[index],
      description: appendMilestoneDetail(
        nextRows[index]?.description,
        resolveTemplate(action.template, answers)
      ),
    };
    return nextRows;
  }

  return nextRows;
}

function findSubtypeRule({ projectType, projectSubtype }) {
  return (Array.isArray(rules?.subtypeRules) ? rules.subtypeRules : []).find((rule) =>
    ruleMatches(rule, { projectType, projectSubtype })
  );
}

function fallbackRows({ description }) {
  const normalized = normalizeMatchText(description);
  const limitedScope =
    /\binstall(ation)?\b/.test(normalized) && !/\b(remodel|renovation|addition)\b/.test(normalized);

  return limitedScope
    ? [
        { title: "Prep & materials", description: "Confirm scope, stage materials, and prep the work area." },
        { title: "Primary installation", description: "Complete the core installation or replacement work." },
        { title: "Adjustments & finish", description: "Make adjustments, complete finish details, and test where needed." },
        { title: "Cleanup & walkthrough", description: "Clean the site and review the finished work with the customer." },
      ]
    : [
        { title: "Planning & prep", description: "Confirm scope, materials, and site readiness for the project." },
        { title: "Core work phase 1", description: "Begin the main work and complete the first major phase." },
        { title: "Core work phase 2", description: "Continue the main work and complete the next major phase." },
        { title: "Finish work", description: "Complete finish details, punch items, and final quality checks." },
        { title: "Cleanup & handoff", description: "Complete cleanup and customer walkthrough before closeout." },
      ];
}

export function buildClarificationAwareMilestoneNotes(answers = {}) {
  const lines = [];
  const booleanMappings = Array.isArray(rules?.clarificationNoteMappings?.boolean)
    ? rules.clarificationNoteMappings.boolean
    : [];
  const textMappings = Array.isArray(rules?.clarificationNoteMappings?.text)
    ? rules.clarificationNoteMappings.text
    : [];

  for (const [key, label] of booleanMappings) {
    const normalized = normalizeYesNoAnswer(answers?.[key]);
    if (!normalized) continue;
    lines.push(`${label}: ${normalized === "yes" ? "Yes" : "No"}.`);
  }

  for (const [key, label] of textMappings) {
    const value = safeStr(answers?.[key]);
    if (!value) continue;
    lines.push(`${label}: ${value}.`);
  }

  return lines;
}

export function buildClarificationAwareMilestoneDraft({
  projectType = "",
  projectSubtype = "",
  description = "",
  totalBudget = 0,
  clarificationAnswers = {},
  amountMode = "default",
  baseMilestones = [],
}) {
  const subtypeRule = findSubtypeRule({ projectType, projectSubtype });
  let rows = subtypeRule?.baseRows?.map(cloneRow) || fallbackRows({ description });

  for (const operation of Array.isArray(subtypeRule?.operations) ? subtypeRule.operations : []) {
    if (!conditionMatches(operation?.when, clarificationAnswers)) continue;
    for (const action of Array.isArray(operation?.actions) ? operation.actions : []) {
      rows = applyAction(rows, action, clarificationAnswers);
    }
  }

  const defaultAmounts = buildDefaultMilestoneAmounts(rows.length, totalBudget);
  return rows.map((row, idx) => {
    const baseAmount = baseMilestones?.[idx]?.amount;
    const amount = amountMode === "preserve_base" ? baseAmount ?? 0 : defaultAmounts[idx];
    return {
      ...row,
      amount,
    };
  });
}
