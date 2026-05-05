import rules from "../../../shared/milestone_shaping_rules.json" with { type: "json" };
import { dedupeMilestoneRows } from "./milestonePlanGuardrails.js";

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

function projectSpecificFallbackRows({ projectType = "", projectSubtype = "", description = "" }) {
  const projectText = normalizeMatchText(`${projectType} ${projectSubtype} ${description}`);
  const hasKitchen = /\bkitchen\b/.test(projectText);
  const hasBathroom = /\bbathroom\b/.test(projectText);
  const hasRoof = /\broof|roofing\b/.test(projectText);
  const hasPainting = /\bpaint|painting\b/.test(projectText);
  const hasTile = /\btile\b/.test(projectText);
  const hasPlumbing = /\bplumb|faucet\b/.test(projectText);
  const hasFence = /\bfence|fencing\b/.test(projectText);
  const hasDrywall = /\bdrywall\b/.test(projectText);
  const hasSiding = /\bsiding\b/.test(projectText);

  if (hasSiding) {
    return [
      {
        title: "Site Preparation and Material Staging",
        description: "Prepare the site, protect nearby surfaces, and stage siding materials for install.",
      },
      {
        title: "Remove Existing Siding",
        description: "Remove or prepare the existing siding and related trim as needed.",
      },
      {
        title: "Install New Siding and Trim",
        description: "Install replacement siding, trim, and finish details for the project area.",
      },
      {
        title: "Final Inspection and Cleanup",
        description: "Complete the final review, punch list items, and cleanup the work area.",
      },
    ];
  }

  if (hasRoof) {
    return [
      {
        title: "Site Setup and Safety Prep",
        description: "Protect the property, stage materials, and prep the work area before roof work begins.",
      },
      {
        title: "Remove Existing Roofing",
        description: "Remove existing roofing materials and prep the roof deck or substrate.",
      },
      {
        title: "Install New Roofing System",
        description: "Install underlayment, flashing, and the new roofing system.",
      },
      {
        title: "Final Inspection and Cleanup",
        description: "Complete the final inspection, magnet sweep, and cleanup.",
      },
    ];
  }

  if (hasPainting) {
    return [
      {
        title: "Prep Surfaces and Protect Areas",
        description: "Mask, protect, and prep the work area and painted surfaces.",
      },
      {
        title: "Prime and Paint",
        description: "Apply primer and paint to the selected areas and surfaces.",
      },
      {
        title: "Touch-Ups and Cleanup",
        description: "Complete touch-ups, detail work, and cleanup for handoff.",
      },
    ];
  }

  if (hasKitchen) {
    return [
      { title: "Demo & Prep", description: "Protect the space and remove existing finishes or fixtures." },
      { title: "Cabinets / Layout Work", description: "Complete cabinet, layout, or rough-in work." },
      { title: "Countertops & Finish Install", description: "Install countertops, backsplash, and finish items." },
      { title: "Cleanup & Handoff", description: "Clean the site and walk through the completed kitchen." },
    ];
  }

  if (hasBathroom) {
    return [
      {
        title: "Demo and Protection",
        description: "Protect surrounding finishes and remove existing materials as needed.",
      },
      {
        title: "Rough Plumbing and Electrical",
        description: "Complete rough work needed for the remodel layout.",
      },
      {
        title: "Tile, Fixtures, and Finishes",
        description: "Install tile, fixtures, and finish selections.",
      },
      {
        title: "Final Cleanup and Walkthrough",
        description: "Finish cleanup and review the remodeled bathroom.",
      },
    ];
  }

  if (hasTile) {
    return [
      {
        title: "Site Prep and Surface Prep",
        description: "Prepare the work area and surfaces for tile installation.",
      },
      {
        title: "Install Tile",
        description: "Install the tile and related setting materials.",
      },
      {
        title: "Grout, Trim, and Cleanup",
        description: "Complete grout, trim details, and cleanup for handoff.",
      },
    ];
  }

  if (hasPlumbing) {
    return [
      {
        title: "Assess and Prep",
        description: "Confirm the affected plumbing area and prep the work.",
      },
      {
        title: "Repair or Replace Fixture",
        description: "Complete the plumbing repair or fixture replacement work.",
      },
      {
        title: "Test and Verify",
        description: "Test the repair, check for leaks, and verify operation.",
      },
      {
        title: "Cleanup and Walkthrough",
        description: "Finish cleanup and review the completed work.",
      },
    ];
  }

  if (hasFence) {
    return [
      {
        title: "Layout and Site Prep",
        description: "Confirm the layout, set the work area, and prep for install.",
      },
      {
        title: "Install Fence Sections",
        description: "Set posts and install the fence sections or panels.",
      },
      {
        title: "Finish Details and Cleanup",
        description: "Complete gates, trim details, and cleanup the area.",
      },
    ];
  }

  if (hasDrywall) {
    return [
      {
        title: "Prep and Protect",
        description: "Protect surrounding areas and prepare the damaged surfaces.",
      },
      {
        title: "Repair or Replace Drywall",
        description: "Complete drywall repair or replacement work.",
      },
      {
        title: "Tape, Mud, and Finish",
        description: "Tape, mud, sand, and finish the repaired areas.",
      },
      {
        title: "Cleanup and Walkthrough",
        description: "Clean the site and review the finished repair.",
      },
    ];
  }

  return [];
}

function familyFallbackRows(projectFamilyKey = "", projectFamilyLabel = "") {
  const familyKey = safeStr(projectFamilyKey).toLowerCase();
  const familyLabel = safeStr(projectFamilyLabel);

  if (familyKey === "roofing") {
    return [
      { title: "Inspection & prep", description: "Inspect the roof, confirm the leak area, and prep the site." },
      { title: "Repair or replacement", description: "Complete the roof repair or replacement work." },
      { title: "Flashing & seal check", description: "Verify flashing, seal details, and weather protection." },
      { title: "Cleanup & walkthrough", description: "Clean the area and review the finished work with the customer." },
    ];
  }

  if (familyKey === "bathroom_remodel") {
    return [
      { title: "Demo & protection", description: "Protect surrounding finishes and remove existing materials." },
      { title: "Rough plumbing / electrical", description: "Complete rough work needed for the remodel layout." },
      { title: "Tile, fixtures & finishes", description: "Install tile, fixtures, and finish selections." },
      { title: "Final cleanup & walkthrough", description: "Finish cleanup and review the remodeled bathroom." },
    ];
  }

  if (familyKey === "kitchen_remodel") {
    return [
      { title: "Demo & prep", description: "Protect the space and remove existing finishes or fixtures." },
      { title: "Cabinets / layout work", description: "Complete cabinet, layout, or rough-in work." },
      { title: "Countertops & finish install", description: "Install countertops, backsplash, and finish items." },
      { title: "Cleanup & handoff", description: "Clean the site and walk through the completed kitchen." },
    ];
  }

  if (familyKey === "flooring") {
    return [
      { title: "Measure & prep", description: "Confirm square footage and prepare the rooms for install." },
      { title: "Removal / subfloor prep", description: "Remove existing flooring and prep the subfloor." },
      { title: "Install flooring", description: "Install the selected flooring material." },
      { title: "Trim, cleanup & walkthrough", description: "Complete trim, cleanup, and final walkthrough." },
    ];
  }

  if (familyKey === "painting") {
    return [
      { title: "Prep & protection", description: "Protect surfaces and complete prep work." },
      { title: "Patch & repairs", description: "Fill holes, patch surfaces, and complete minor repairs." },
      { title: "Paint application", description: "Apply primer and paint to the specified areas." },
      { title: "Cleanup & walkthrough", description: "Clean up and review the finished paint work." },
    ];
  }

  if (familyKey === "electrical" || familyKey === "plumbing") {
    return [
      { title: "Diagnose & prep", description: `Confirm the affected ${familyLabel || "system"} area and prep the work.` },
      { title: "Repair / install", description: `Complete the ${familyLabel || "system"} work.` },
      { title: "Test & verify", description: "Test the system and verify the repair or installation." },
      { title: "Cleanup & walkthrough", description: "Finish cleanup and review the completed work." },
    ];
  }

  if (familyKey === "exterior_siding" || familyKey === "windows_doors") {
    return [
      { title: "Assess & prep", description: "Confirm openings or elevations and prepare the site." },
      { title: "Removal / replacement", description: "Remove existing materials and complete the new install." },
      { title: "Seal, trim & finish", description: "Complete sealing, trim, and finish details." },
      { title: "Cleanup & walkthrough", description: "Clean the site and review the completed exterior work." },
    ];
  }

  if (familyKey === "handyman") {
    return [
      { title: "Task review", description: "Confirm the task list and priorities with the customer." },
      { title: "Core repairs", description: "Complete the main repair tasks and needed adjustments." },
      { title: "Finish details", description: "Complete finish work and small follow-up items." },
      { title: "Cleanup & closeout", description: "Clean the site and review the completed tasks." },
    ];
  }

  return [];
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
  projectFamilyKey = "",
  projectFamilyLabel = "",
  description = "",
  totalBudget = 0,
  clarificationAnswers = {},
  amountMode = "default",
  baseMilestones = [],
}) {
  const subtypeRule = findSubtypeRule({ projectType, projectSubtype });
  const projectRows = projectSpecificFallbackRows({ projectType, projectSubtype, description });
  const familyRows = familyFallbackRows(projectFamilyKey, projectFamilyLabel);
  let rows =
    subtypeRule?.baseRows?.map(cloneRow) ||
    (Array.isArray(projectRows) && projectRows.length ? projectRows : null) ||
    (Array.isArray(familyRows) && familyRows.length ? familyRows : null) ||
    fallbackRows({ description });

  for (const operation of Array.isArray(subtypeRule?.operations) ? subtypeRule.operations : []) {
    if (!conditionMatches(operation?.when, clarificationAnswers)) continue;
    for (const action of Array.isArray(operation?.actions) ? operation.actions : []) {
      rows = applyAction(rows, action, clarificationAnswers);
    }
  }

  rows = dedupeMilestoneRows(rows);

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
