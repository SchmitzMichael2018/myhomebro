function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s/&-]+/g, " ")
    .replace(/\s+/g, " ");
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

export function getSubtypeClarificationQuestions(projectSubtype) {
  const normalizedSubtype = normalizeText(projectSubtype);
  if (!normalizedSubtype) return [];

  const match = QUESTION_SETS.find((set) =>
    set.matchers.some((matcher) => normalizedSubtype.includes(normalizeText(matcher)))
  );
  return Array.isArray(match?.questions) ? match.questions.slice(0, 4) : [];
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
