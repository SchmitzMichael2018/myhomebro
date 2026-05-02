function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s/&-]+/g, " ")
    .replace(/\s+/g, " ");
}

const MEASUREMENT_HELP =
  "Measurements help with planning, but the contractor should verify final measurements before pricing or work begins.";

const SHEET_STYLE_MEASUREMENT_KEYWORDS = ["shed", "outbuilding"];
const FLOOR_MEASUREMENT_KEYWORDS = ["flooring", "floor", "carpet", "laminate", "hardwood", "vinyl", "tile"];
const ROOF_MEASUREMENT_KEYWORDS = ["roof", "roofing"];
const WALL_MEASUREMENT_KEYWORDS = ["siding", "paint", "painting", "drywall"];
const AREA_MEASUREMENT_KEYWORDS = ["concrete", "patio", "driveway", "deck", "decking"];
const REMODEL_MEASUREMENT_KEYWORDS = ["remodel", "addition", "room"];
const GENERIC_MEASUREMENT_KEYWORDS = ["area", "space", "dimensions"];

function buildClarificationHaystack(...texts) {
  return normalizeText(texts.filter(Boolean).join(" "));
}

function hasAnyKeyword(haystack, keywords) {
  return Boolean(haystack) && keywords.some((keyword) => haystack.includes(normalizeText(keyword)));
}

function buildMeasurementQuestionFromContext(context = {}) {
  const haystack = buildClarificationHaystack(
    context.projectTitle,
    context.jobDescription,
    context.scopeOfWork,
    context.projectType,
    context.projectSubtype,
    context.projectFamilyLabel,
    context.scopeText
  );
  if (!haystack) return null;

  if (hasAnyKeyword(haystack, SHEET_STYLE_MEASUREMENT_KEYWORDS)) {
    return {
      key: "measurements",
      label: "What size shed are you planning?",
      kind: "short_text",
      placeholder: "Example: 8x10, 10x12, 12x16, or not sure yet",
      help: MEASUREMENT_HELP,
    };
  }

  if (hasAnyKeyword(haystack, ROOF_MEASUREMENT_KEYWORDS)) {
    return {
      key: "measurements",
      label: "Do you already have roof measurements, or should the contractor verify them?",
      kind: "short_text",
      placeholder: "Example: contractor should verify them",
      help: MEASUREMENT_HELP,
    };
  }

  if (hasAnyKeyword(haystack, WALL_MEASUREMENT_KEYWORDS)) {
    return {
      key: "measurements",
      label: "Do you know the approximate wall or room dimensions?",
      kind: "short_text",
      placeholder: "Example: 14x20 room, 40 linear feet of wall, or not sure yet",
      help: MEASUREMENT_HELP,
    };
  }

  if (hasAnyKeyword(haystack, AREA_MEASUREMENT_KEYWORDS)) {
    return {
      key: "measurements",
      label: "Do you know the approximate length and width of the area?",
      kind: "short_text",
      placeholder: "Example: 12x20 patio, 20x30 driveway, or not sure yet",
      help: MEASUREMENT_HELP,
    };
  }

  if (hasAnyKeyword(haystack, FLOOR_MEASUREMENT_KEYWORDS)) {
    return {
      key: "measurements",
      label: "Do you know the approximate square footage or room dimensions?",
      kind: "short_text",
      placeholder: "Example: about 1,200 sq ft or a 12x18 room",
      help: MEASUREMENT_HELP,
    };
  }

  if (hasAnyKeyword(haystack, REMODEL_MEASUREMENT_KEYWORDS)) {
    return {
      key: "measurements",
      label: "Which room or area is being remodeled, and do you know its approximate size?",
      kind: "short_text",
      placeholder: "Example: kitchen, primary bath, or 14x18 living room",
      help: MEASUREMENT_HELP,
    };
  }

  if (hasAnyKeyword(haystack, GENERIC_MEASUREMENT_KEYWORDS)) {
    return {
      key: "measurements",
      label: "Do you know the approximate square footage or dimensions of the work area?",
      kind: "short_text",
      placeholder: "Example: about 1,200 sq ft or 12x18 room",
      help: MEASUREMENT_HELP,
    };
  }

  return null;
}

export function buildMeasurementClarificationQuestion(context = {}) {
  return buildMeasurementQuestionFromContext(context);
}

export function shouldAskMeasurementClarification(...texts) {
  const haystack = buildClarificationHaystack(...texts);
  if (!haystack) return false;
  return (
    hasAnyKeyword(haystack, SHEET_STYLE_MEASUREMENT_KEYWORDS) ||
    hasAnyKeyword(haystack, FLOOR_MEASUREMENT_KEYWORDS) ||
    hasAnyKeyword(haystack, ROOF_MEASUREMENT_KEYWORDS) ||
    hasAnyKeyword(haystack, WALL_MEASUREMENT_KEYWORDS) ||
    hasAnyKeyword(haystack, AREA_MEASUREMENT_KEYWORDS) ||
    hasAnyKeyword(haystack, REMODEL_MEASUREMENT_KEYWORDS) ||
    hasAnyKeyword(haystack, GENERIC_MEASUREMENT_KEYWORDS)
  );
}

const QUESTION_SETS = [
  {
    matchers: ["bathroom remodel"],
    questions: [
      {
        key: "layout_changes",
        label: "Are you moving the shower, tub, or vanity layout?",
        kind: "yes_no",
      },
      {
        key: "wet_area_tile",
        label: "Does the scope include tile or waterproofing in wet areas?",
        kind: "yes_no",
      },
      {
        key: "fixture_upgrade_notes",
        label: "Any fixture or finish upgrades to note?",
        kind: "short_text",
        placeholder: "Example: freestanding tub, custom vanity, matte black fixtures",
      },
    ],
  },
  {
    matchers: ["kitchen remodel"],
    questions: [
      {
        key: "layout_changes",
        label: "Does the kitchen layout or appliance placement change?",
        kind: "yes_no",
      },
      {
        key: "cabinet_scope",
        label: "Are cabinets included in the project scope?",
        kind: "yes_no",
      },
      {
        key: "finish_scope_notes",
        label: "Which major finishes are included?",
        kind: "short_text",
        placeholder: "Example: cabinets, countertops, backsplash, lighting",
      },
    ],
  },
  {
    matchers: ["cabinet installation", "cabinet install"],
    questions: [
      {
        key: "demo_required",
        label: "Does this include removing existing cabinets first?",
        kind: "yes_no",
      },
      {
        key: "hardware_included",
        label: "Are hardware, fillers, and trim part of the install?",
        kind: "yes_no",
      },
      {
        key: "cabinet_style_notes",
        label: "Any cabinet style or layout notes to keep in scope?",
        kind: "short_text",
        placeholder: "Example: shaker uppers, island base cabinets, pantry wall",
      },
    ],
  },
  {
    matchers: ["appliance installation", "appliance install"],
    questions: [
      {
        key: "connection_ready",
        label: "Are utilities and hookups expected to be ready on arrival?",
        kind: "yes_no",
      },
      {
        key: "haul_away_existing",
        label: "Should the old appliance be disconnected or hauled away?",
        kind: "yes_no",
      },
      {
        key: "appliance_scope_notes",
        label: "Which appliances or connection details matter most here?",
        kind: "short_text",
        placeholder: "Example: gas range, stacked washer/dryer, built-in microwave",
      },
    ],
  },
  {
    matchers: ["roof replacement"],
    questions: [
      {
        key: "tear_off_scope",
        label: "Is a full tear-off included?",
        kind: "yes_no",
      },
      {
        key: "decking_allowance",
        label: "Should minor decking repair be assumed if needed?",
        kind: "yes_no",
      },
      {
        key: "roofing_notes",
        label: "Any material, pitch, or ventilation notes to include?",
        kind: "short_text",
        placeholder: "Example: architectural shingles, steep pitch, ridge vent",
      },
    ],
  },
  {
    matchers: ["flooring installation", "flooring replacement", "flooring"],
    questions: [
      {
        key: "subfloor_prep",
        label: "Does the job include subfloor prep or leveling?",
        kind: "yes_no",
      },
      {
        key: "demo_required",
        label: "Is removal of existing flooring part of the scope?",
        kind: "yes_no",
      },
      {
        key: "flooring_notes",
        label: "Any material or area notes to keep in mind?",
        kind: "short_text",
        placeholder: "Example: LVP throughout first floor, tile in laundry room",
      },
    ],
  },
];

function normalizeQuestionEntry(question, index = 0) {
  if (!question) return null;
  if (typeof question === "string") {
    const label = String(question || "").trim();
    return label
      ? {
          key: `clarification_${index + 1}`,
          label,
          kind: "short_text",
        }
      : null;
  }
  const next = { ...question };
  if (!next.key) next.key = `clarification_${index + 1}`;
  if (!next.label) next.label = String(next.question || next.key || "").trim();
  if (!next.label) return null;
  next.kind = next.kind || next.type || "short_text";
  return next;
}

function findClarificationSet(haystack) {
  return QUESTION_SETS.find((set) =>
    set.matchers.some((matcher) => haystack.includes(normalizeText(matcher)))
  );
}

export function getProjectClarificationQuestions(context = {}) {
  const pending = Array.isArray(context.pendingClarifications) ? context.pendingClarifications : [];
  if (pending.length) {
    return pending
      .map((question, index) => normalizeQuestionEntry(question, index))
      .filter(Boolean)
      .slice(0, 4);
  }

  const haystack = buildClarificationHaystack(
    context.projectTitle,
    context.jobDescription,
    context.scopeOfWork,
    context.projectType,
    context.projectSubtype,
    context.projectFamilyLabel,
    context.scopeText
  );

  const match = findClarificationSet(haystack);
  const questions = Array.isArray(match?.questions) ? [...match.questions] : [];
  const measurementQuestion = buildMeasurementClarificationQuestion(context);
  if (measurementQuestion) {
    questions.push(measurementQuestion);
  }

  const uniqueQuestions = [];
  const seen = new Set();
  for (const question of questions) {
    const normalized = normalizeQuestionEntry(question, uniqueQuestions.length);
    if (!normalized) continue;
    const key = normalized.key || normalized.label;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueQuestions.push(normalized);
  }
  return uniqueQuestions.slice(0, 4);
}

export function getSubtypeClarificationQuestions(projectSubtype, scopeText = "") {
  return getProjectClarificationQuestions({
    projectSubtype,
    scopeText,
  });
}

export function pickClarificationAnswers(questions = [], answers = {}) {
  const next = {};
  for (const question of Array.isArray(questions) ? questions : []) {
    const key = question?.key;
    if (!key) continue;
    const value = answers?.[key];
    if (value == null) continue;
    const normalized = typeof value === "string" ? value.trim() : String(value);
    if (!normalized) continue;
    next[key] = normalized;
  }
  return next;
}

export function buildClarificationNotes(questions = [], answers = {}) {
  const lines = [];
  for (const question of Array.isArray(questions) ? questions : []) {
    const key = question?.key;
    if (!key) continue;
    const value = String(answers?.[key] || "").trim();
    if (!value) continue;
    if (question.kind === "yes_no") {
      lines.push(`${question.label} ${value === "yes" ? "Yes." : "No."}`);
    } else {
      lines.push(`${question.label} ${value}`);
    }
  }
  return lines;
}
