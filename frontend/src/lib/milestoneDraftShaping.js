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

function bulletDescription(...lines) {
  return lines
    .map((line) => safeStr(line))
    .filter(Boolean)
    .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
    .join("\n");
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
        {
          title: "Prep & materials",
          description: bulletDescription(
            "Confirm scope, measurements, and site readiness.",
            "Stage materials and protect adjacent finishes.",
            "Prepare the work area for installation."
          ),
        },
        {
          title: "Primary installation",
          description: bulletDescription(
            "Complete the core installation or replacement work.",
            "Install the selected system or materials.",
            "Verify basic fit, alignment, and coverage."
          ),
        },
        {
          title: "Adjustments & finish",
          description: bulletDescription(
            "Make adjustments and complete finish details.",
            "Address trim, seal, or touch-up items.",
            "Test where needed before closeout."
          ),
        },
        {
          title: "Cleanup & walkthrough",
          description: bulletDescription(
            "Clean the site and remove debris.",
            "Review the finished work with the customer.",
            "Confirm any final punch-list items."
          ),
        },
      ]
    : [
        {
          title: "Planning & prep",
          description: bulletDescription(
            "Confirm scope, materials, and site readiness.",
            "Review measurements, access, and sequencing.",
            "Protect nearby areas before work begins."
          ),
        },
        {
          title: "Core work phase 1",
          description: bulletDescription(
            "Begin the primary work and complete the first major phase.",
            "Install or build the main project components.",
            "Verify fit, alignment, and progress against scope."
          ),
        },
        {
          title: "Core work phase 2",
          description: bulletDescription(
            "Continue the main work and complete the next major phase.",
            "Finish the remaining structural or system work.",
            "Resolve any adjustments needed before finish work."
          ),
        },
        {
          title: "Finish work",
          description: bulletDescription(
            "Complete finish details and punch-list items.",
            "Seal, trim, paint, or connect final components as required.",
            "Perform final quality checks."
          ),
        },
        {
          title: "Cleanup & handoff",
          description: bulletDescription(
            "Complete cleanup and remove job debris.",
            "Walk the customer through the finished project.",
            "Confirm closeout items and handoff."
          ),
        },
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
        description: bulletDescription(
          "Prepare the site and protect nearby surfaces.",
          "Stage siding, trim, fasteners, and weather barrier materials.",
          "Confirm measurements and install sequencing."
        ),
      },
      {
        title: "Remove Existing Siding",
        description: bulletDescription(
          "Remove or prepare existing siding and related trim as needed.",
          "Expose the substrate for inspection and repairs.",
          "Clear debris and prep the wall assembly for replacement."
        ),
      },
      {
        title: "Install New Siding and Trim",
        description: bulletDescription(
          "Install replacement siding panels and trim components.",
          "Fasten materials for proper alignment and weather protection.",
          "Complete finish details around openings and transitions."
        ),
      },
      {
        title: "Final Inspection and Cleanup",
        description: bulletDescription(
          "Complete the final review and punch-list items.",
          "Check alignment, caulking, and weatherproofing details.",
          "Cleanup the work area and prepare for handoff."
        ),
      },
    ];
  }

  if (hasRoof) {
    return [
      {
        title: "Site Setup and Safety Prep",
        description: bulletDescription(
          "Protect the property, landscaping, and staging area.",
          "Stage materials and prep the roof access path.",
          "Confirm safety setup before roof work begins."
        ),
      },
      {
        title: "Remove Existing Roofing",
        description: bulletDescription(
          "Remove existing roofing materials and underlayment.",
          "Inspect and prep the roof deck or substrate.",
          "Address any visible repair needs before install."
        ),
      },
      {
        title: "Install New Roofing System",
        description: bulletDescription(
          "Install underlayment, flashing, and the new roofing system.",
          "Secure key weatherproofing details at penetrations and edges.",
          "Complete the primary roof assembly."
        ),
      },
      {
        title: "Final Inspection and Cleanup",
        description: bulletDescription(
          "Complete the final inspection and walkthrough.",
          "Perform magnet sweep and cleanup.",
          "Confirm punch-list items are closed out."
        ),
      },
    ];
  }

  if (hasPainting) {
    return [
      {
        title: "Prep Surfaces and Protect Areas",
        description: bulletDescription(
          "Mask and protect floors, fixtures, and adjacent finishes.",
          "Prep surfaces for paint adhesion.",
          "Complete patching and surface cleanup before coating."
        ),
      },
      {
        title: "Prime and Paint",
        description: bulletDescription(
          "Apply primer and paint to the selected areas and surfaces.",
          "Use the selected finish system and color specifications.",
          "Verify coverage and uniform appearance."
        ),
      },
      {
        title: "Touch-Ups and Cleanup",
        description: bulletDescription(
          "Complete touch-ups and detail work.",
          "Address edges, trim, and finish transitions.",
          "Cleanup the space for handoff."
        ),
      },
    ];
  }

  if (hasKitchen) {
    return [
      {
        title: "Demo & Prep",
        description: bulletDescription(
          "Protect the space and remove existing finishes or fixtures.",
          "Stage materials and prepare for rough-in work.",
          "Confirm layout and selection details."
        ),
      },
      {
        title: "Cabinets / Layout Work",
        description: bulletDescription(
          "Complete cabinet, layout, and rough-in work.",
          "Set the main kitchen structure and align utilities.",
          "Verify dimensions and fit before finish install."
        ),
      },
      {
        title: "Countertops & Finish Install",
        description: bulletDescription(
          "Install countertops, backsplash, and finish items.",
          "Complete trim, hardware, and final surface details.",
          "Check fit and finish against the approved scope."
        ),
      },
      {
        title: "Cleanup & Handoff",
        description: bulletDescription(
          "Clean the site and remove debris.",
          "Walk through the completed kitchen with the customer.",
          "Confirm punch-list items and handoff."
        ),
      },
    ];
  }

  if (hasBathroom) {
    return [
      {
        title: "Demo and Protection",
        description: bulletDescription(
          "Protect surrounding finishes and fixtures.",
          "Remove existing materials as needed.",
          "Stage the room for rough-in and waterproofing."
        ),
      },
      {
        title: "Rough Plumbing and Electrical",
        description: bulletDescription(
          "Complete rough work needed for the remodel layout.",
          "Coordinate plumbing and electrical changes as needed.",
          "Prepare for finish installation."
        ),
      },
      {
        title: "Tile, Fixtures, and Finishes",
        description: bulletDescription(
          "Install tile, fixtures, and finish selections.",
          "Complete waterproofing and trim details.",
          "Verify fit, alignment, and appearance."
        ),
      },
      {
        title: "Final Cleanup and Walkthrough",
        description: bulletDescription(
          "Finish cleanup and remove protection materials.",
          "Review the remodeled bathroom with the customer.",
          "Confirm punch-list items are complete."
        ),
      },
    ];
  }

  if (hasTile) {
    return [
      {
        title: "Site Prep and Surface Prep",
        description: bulletDescription(
          "Prepare the work area and surfaces for tile installation.",
          "Confirm subfloor, wall, or substrate readiness.",
          "Stage setting materials and tile layout."
        ),
      },
      {
        title: "Install Tile",
        description: bulletDescription(
          "Install the tile and related setting materials.",
          "Maintain layout, spacing, and alignment.",
          "Complete the core tile field work."
        ),
      },
      {
        title: "Grout, Trim, and Cleanup",
        description: bulletDescription(
          "Complete grout, trim details, and finish edges.",
          "Check transitions, corners, and sealant areas.",
          "Cleanup for handoff."
        ),
      },
    ];
  }

  if (hasPlumbing) {
    return [
      {
        title: "Assess and Prep",
        description: bulletDescription(
          "Confirm the affected plumbing area and prep the work.",
          "Verify access, shutoff, and fixture conditions.",
          "Protect the surrounding area before service begins."
        ),
      },
      {
        title: "Repair or Replace Fixture",
        description: bulletDescription(
          "Complete the plumbing repair or fixture replacement work.",
          "Install required parts, fittings, or fixtures.",
          "Restore the system to working condition."
        ),
      },
      {
        title: "Test and Verify",
        description: bulletDescription(
          "Test the repair, check for leaks, and verify operation.",
          "Confirm water flow and fixture performance.",
          "Address final adjustments if needed."
        ),
      },
      {
        title: "Cleanup and Walkthrough",
        description: bulletDescription(
          "Finish cleanup and remove service debris.",
          "Review the completed work with the customer.",
          "Confirm closeout details."
        ),
      },
    ];
  }

  if (hasFence) {
    return [
      {
        title: "Layout and Site Prep",
        description: bulletDescription(
          "Confirm the layout and set the work area.",
          "Prepare posts, panels, and materials for install.",
          "Mark the fence line and check access points."
        ),
      },
      {
        title: "Install Fence Sections",
        description: bulletDescription(
          "Set posts and install the fence sections or panels.",
          "Secure structural components and gate openings.",
          "Maintain alignment and spacing throughout the run."
        ),
      },
      {
        title: "Finish Details and Cleanup",
        description: bulletDescription(
          "Complete gates, trim details, and finish hardware.",
          "Check gate swing, latches, and final adjustments.",
          "Cleanup the area for handoff."
        ),
      },
    ];
  }

  if (hasDrywall) {
    return [
      {
        title: "Prep and Protect",
        description: bulletDescription(
          "Protect surrounding areas and prepare damaged surfaces.",
          "Stage materials and cover adjacent finishes.",
          "Confirm repair scope before patching begins."
        ),
      },
      {
        title: "Repair or Replace Drywall",
        description: bulletDescription(
          "Complete drywall repair or replacement work.",
          "Install patch or replacement board and secure it properly.",
          "Prepare the repair for finish work."
        ),
      },
      {
        title: "Tape, Mud, and Finish",
        description: bulletDescription(
          "Tape, mud, sand, and finish the repaired areas.",
          "Match the surface texture as needed.",
          "Prepare for final paint or trim touch-up."
        ),
      },
      {
        title: "Cleanup and Walkthrough",
        description: bulletDescription(
          "Clean the site and remove dust/debris.",
          "Review the finished repair with the customer.",
          "Confirm closeout items are complete."
        ),
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
      {
        title: "Site Inspection & Prep",
        description: bulletDescription(
          "Inspect the roof and confirm the work area.",
          "Stage materials and prep the site.",
          "Protect adjacent areas before work begins."
        ),
      },
      {
        title: "Repair or Replacement",
        description: bulletDescription(
          "Complete the roof repair or replacement work.",
          "Remove or correct affected roofing sections.",
          "Prepare the surface for weatherproofing and finish work."
        ),
      },
      {
        title: "Flashing & Seal Check",
        description: bulletDescription(
          "Verify flashing, seal details, and weather protection.",
          "Complete edges, penetrations, and transitions.",
          "Confirm the roof system is sealed and ready."
        ),
      },
      {
        title: "Cleanup & Walkthrough",
        description: bulletDescription(
          "Clean the area and remove debris.",
          "Review the finished work with the customer.",
          "Confirm closeout items and handoff."
        ),
      },
    ];
  }

  if (familyKey === "bathroom_remodel") {
    return [
      {
        title: "Demo & Protection",
        description: bulletDescription(
          "Protect surrounding finishes and remove existing materials.",
          "Stage the room for rough-in and waterproofing.",
          "Confirm layout and finish selections."
        ),
      },
      {
        title: "Rough Plumbing / Electrical",
        description: bulletDescription(
          "Complete rough work needed for the remodel layout.",
          "Coordinate plumbing and electrical changes as needed.",
          "Prepare for finish installation."
        ),
      },
      {
        title: "Tile, Fixtures & Finishes",
        description: bulletDescription(
          "Install tile, fixtures, and finish selections.",
          "Complete waterproofing and trim details.",
          "Verify fit, alignment, and appearance."
        ),
      },
      {
        title: "Final Cleanup & Walkthrough",
        description: bulletDescription(
          "Finish cleanup and remove protection materials.",
          "Review the remodeled bathroom with the customer.",
          "Confirm punch-list items are complete."
        ),
      },
    ];
  }

  if (familyKey === "kitchen_remodel") {
    return [
      {
        title: "Demo & Prep",
        description: bulletDescription(
          "Protect the space and remove existing finishes or fixtures.",
          "Stage materials and prepare for rough-in work.",
          "Confirm layout and selection details."
        ),
      },
      {
        title: "Cabinets / Layout Work",
        description: bulletDescription(
          "Complete cabinet, layout, and rough-in work.",
          "Set the main kitchen structure and align utilities.",
          "Verify dimensions and fit before finish install."
        ),
      },
      {
        title: "Countertops & Finish Install",
        description: bulletDescription(
          "Install countertops, backsplash, and finish items.",
          "Complete trim, hardware, and final surface details.",
          "Check fit and finish against the approved scope."
        ),
      },
      {
        title: "Cleanup & Handoff",
        description: bulletDescription(
          "Clean the site and remove debris.",
          "Walk through the completed kitchen with the customer.",
          "Confirm punch-list items and handoff."
        ),
      },
    ];
  }

  if (familyKey === "flooring") {
    return [
      {
        title: "Measure & Prep",
        description: bulletDescription(
          "Confirm square footage and room layout.",
          "Prepare the rooms for install.",
          "Stage flooring materials and tools."
        ),
      },
      {
        title: "Removal / Subfloor Prep",
        description: bulletDescription(
          "Remove existing flooring and prep the subfloor.",
          "Address leveling, fastening, or substrate repairs as needed.",
          "Prepare the surface for installation."
        ),
      },
      {
        title: "Install Flooring",
        description: bulletDescription(
          "Install the selected flooring material.",
          "Maintain pattern, alignment, and transitions.",
          "Complete the main floor installation."
        ),
      },
      {
        title: "Trim, Cleanup & Walkthrough",
        description: bulletDescription(
          "Complete trim and finish details.",
          "Cleanup the work area and remove debris.",
          "Walk the customer through the completed floor."
        ),
      },
    ];
  }

  if (familyKey === "painting") {
    return [
      {
        title: "Prep & Protection",
        description: bulletDescription(
          "Protect surfaces and complete prep work.",
          "Mask floors, trim, and adjacent finishes.",
          "Prepare the surfaces for coating."
        ),
      },
      {
        title: "Patch & Repairs",
        description: bulletDescription(
          "Fill holes, patch surfaces, and complete minor repairs.",
          "Sand and smooth the repaired areas.",
          "Prepare walls and trim for primer."
        ),
      },
      {
        title: "Paint Application",
        description: bulletDescription(
          "Apply primer and paint to the specified areas.",
          "Complete the selected finish system and coats.",
          "Verify coverage and uniform appearance."
        ),
      },
      {
        title: "Cleanup & Walkthrough",
        description: bulletDescription(
          "Clean up and review the finished paint work.",
          "Remove masking and protection materials.",
          "Confirm touch-ups and handoff."
        ),
      },
    ];
  }

  if (familyKey === "electrical" || familyKey === "plumbing") {
    return [
      {
        title: "Diagnose & Prep",
        description: bulletDescription(
          `Confirm the affected ${familyLabel || "system"} area and prep the work.`,
          "Verify access, shutoff, or safety requirements.",
          "Protect nearby areas before service begins."
        ),
      },
      {
        title: "Repair / Install",
        description: bulletDescription(
          `Complete the ${familyLabel || "system"} work.`,
          "Install or replace the affected components or fixtures.",
          "Restore the system to working condition."
        ),
      },
      {
        title: "Test & Verify",
        description: bulletDescription(
          "Test the system and verify the repair or installation.",
          "Check operation, safety, and finish details.",
          "Make final adjustments as needed."
        ),
      },
      {
        title: "Cleanup & Walkthrough",
        description: bulletDescription(
          "Finish cleanup and review the completed work.",
          "Remove debris and service materials.",
          "Confirm closeout items with the customer."
        ),
      },
    ];
  }

  if (familyKey === "exterior_siding" || familyKey === "windows_doors") {
    return [
      {
        title: "Assess & Prep",
        description: bulletDescription(
          "Confirm openings or elevations and prepare the site.",
          "Protect nearby finishes and stage materials.",
          "Verify measurements and layout before install."
        ),
      },
      {
        title: "Removal / Replacement",
        description: bulletDescription(
          "Remove existing materials and complete the new install.",
          "Address substrate or framing issues as needed.",
          "Install replacement components and maintain alignment."
        ),
      },
      {
        title: "Seal, Trim & Finish",
        description: bulletDescription(
          "Complete sealing, trim, and finish details.",
          "Weatherproof transitions and openings.",
          "Confirm exterior finish quality."
        ),
      },
      {
        title: "Cleanup & Walkthrough",
        description: bulletDescription(
          "Clean the site and review the completed exterior work.",
          "Remove debris and protection materials.",
          "Confirm punch-list items and handoff."
        ),
      },
    ];
  }

  if (familyKey === "handyman") {
    return [
      {
        title: "Task Review",
        description: bulletDescription(
          "Confirm the task list and priorities with the customer.",
          "Review materials, access, and sequencing.",
          "Prepare the work plan for execution."
        ),
      },
      {
        title: "Core Repairs",
        description: bulletDescription(
          "Complete the main repair tasks and needed adjustments.",
          "Address the highest-priority items first.",
          "Verify each repair as it is completed."
        ),
      },
      {
        title: "Finish Details",
        description: bulletDescription(
          "Complete finish work and small follow-up items.",
          "Tighten, seal, or touch up as needed.",
          "Complete the remaining punch-list items."
        ),
      },
      {
        title: "Cleanup & Closeout",
        description: bulletDescription(
          "Clean the site and review the completed tasks.",
          "Remove debris and tools.",
          "Confirm the work is ready for handoff."
        ),
      },
    ];
  }

  if (familyKey === "remodel") {
    return [
      {
        title: "Demo & Protection",
        description: bulletDescription(
          "Protect adjacent finishes and remove existing materials as needed.",
          "Stage the room or area for rough-in work.",
          "Confirm layout, selections, and sequencing."
        ),
      },
      {
        title: "Rough-In Work",
        description: bulletDescription(
          "Complete rough plumbing, electrical, framing, or substrate work.",
          "Prepare the space for the new install.",
          "Verify all rough requirements before closing walls or finishes."
        ),
      },
      {
        title: "Core Installation",
        description: bulletDescription(
          "Install major components, surfaces, or fixtures.",
          "Set the primary scope items in the approved layout.",
          "Maintain alignment and fit throughout the install."
        ),
      },
      {
        title: "Finishing & Closeout",
        description: bulletDescription(
          "Complete finish details, trim, and touch-ups.",
          "Cleanup the area and resolve punch-list items.",
          "Walk through the completed remodel with the customer."
        ),
      },
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
