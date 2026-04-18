function safeText(value) {
  return String(value || "").trim();
}

function normalize(value) {
  return safeText(value).toLowerCase().replace(/&/g, " and ").replace(/\s+/g, " ").trim();
}

const PROJECT_TYPE_FAMILIES = [
  {
    key: "roofing",
    label: "Roofing",
    cueLabel: "Roofing-focused review",
    keywords: [
      "roofing",
      "roof",
      "roof leak",
      "roof repair",
      "roof replacement",
      "reroof",
      "re roof",
      "shingle",
      "shingles",
      "underlayment",
      "flashing",
      "drip edge",
      "ridge vent",
      "metal roof",
      "tile roof",
    ],
    prepItems: [
      "Confirm the leak location and affected areas.",
      "Verify whether repair or replacement is expected.",
      "Review roof age, prior repairs, and access conditions.",
      "Check weather exposure and temporary protection needs.",
    ],
    responseStarter:
      "I reviewed the roofing details and can confirm the affected areas, timing, and next steps before pricing.",
    createBidContext:
      "Roofing work often depends on leak location, roof age, and whether a repair or replacement is expected.",
    draftFocusLine:
      "Roofing projects are clearer when the leak location, roof condition, and weather exposure are confirmed before final pricing.",
  },
  {
    key: "bathroom_remodel",
    label: "Bathroom Remodel",
    cueLabel: "Bathroom remodel-focused review",
    keywords: [
      "bathroom",
      "bath remodel",
      "bathroom remodel",
      "shower",
      "tub",
      "vanity",
      "tile",
      "waterproof",
      "toilet",
      "fixtures",
    ],
    prepItems: [
      "Clarify full versus partial remodel scope.",
      "Confirm any layout changes or fixture moves.",
      "Review fixture, tile, and finish selections.",
      "Verify plumbing or electrical changes if relevant.",
    ],
    responseStarter:
      "I reviewed the bathroom remodel details and can confirm the scope, selections, and next steps before pricing.",
    createBidContext:
      "Bathroom remodels are clearer when layout, fixtures, and finish selections are confirmed.",
    draftFocusLine:
      "Bathroom remodels benefit from confirming layout changes, fixture selections, and any plumbing or electrical shifts before final pricing.",
  },
  {
    key: "kitchen_remodel",
    label: "Kitchen Remodel",
    cueLabel: "Kitchen remodel-focused review",
    keywords: [
      "kitchen",
      "kitchen remodel",
      "cabinet",
      "cabinets",
      "countertop",
      "countertops",
      "backsplash",
      "island",
      "appliance",
    ],
    prepItems: [
      "Clarify full versus partial remodel scope.",
      "Confirm cabinets, countertops, and backsplash selections.",
      "Review any layout or appliance changes.",
      "Verify plumbing or electrical changes if relevant.",
    ],
    responseStarter:
      "I reviewed the kitchen remodel details and can confirm the scope, selections, and next steps before pricing.",
    createBidContext:
      "Kitchen remodels are clearer when cabinets, countertops, layout changes, and appliance needs are confirmed.",
    draftFocusLine:
      "Kitchen remodels benefit from confirming cabinets, countertops, layout changes, and any plumbing or electrical shifts before final pricing.",
  },
  {
    key: "flooring",
    label: "Flooring",
    cueLabel: "Flooring-focused review",
    keywords: [
      "flooring",
      "floor",
      "lvp",
      "vinyl plank",
      "laminate",
      "hardwood",
      "tile floor",
      "floor install",
      "floor replacement",
    ],
    prepItems: [
      "Confirm square footage and the rooms included.",
      "Review subfloor condition and any prep work needed.",
      "Confirm the flooring material and finish.",
      "Note removal, demo, or furniture moving needs.",
    ],
    responseStarter:
      "I reviewed the flooring details and can confirm the rooms, material, and next steps before pricing.",
    createBidContext:
      "Flooring work is clearer when square footage, subfloor condition, and removal needs are confirmed.",
    draftFocusLine:
      "Flooring projects benefit from confirming square footage, subfloor condition, and removal or prep needs before final pricing.",
  },
  {
    key: "painting",
    label: "Painting",
    cueLabel: "Painting-focused review",
    keywords: [
      "painting",
      "paint",
      "repaint",
      "stain",
      "refinish",
      "interior paint",
      "exterior paint",
      "cabinet paint",
    ],
    prepItems: [
      "Confirm interior or exterior scope.",
      "Review surface prep, patching, and repairs.",
      "Clarify the rooms or surfaces included.",
      "Note finish level and coating expectations.",
    ],
    responseStarter:
      "I reviewed the painting details and can confirm the surfaces, prep needs, and next steps before pricing.",
    createBidContext:
      "Painting work is clearer when the surfaces, prep needs, and finish expectations are confirmed.",
    draftFocusLine:
      "Painting projects benefit from confirming the surfaces involved, prep needs, and finish expectations before final pricing.",
  },
  {
    key: "electrical",
    label: "Electrical",
    cueLabel: "Electrical-focused review",
    keywords: [
      "electrical",
      "electric",
      "outlet",
      "switch",
      "breaker",
      "panel",
      "wiring",
      "lighting",
      "light fixture",
    ],
    prepItems: [
      "Clarify repair versus new install scope.",
      "Identify the panel, circuits, outlets, or lighting involved.",
      "Confirm any safety concerns or troubleshooting needs.",
      "Verify whether a site visit is needed before quoting.",
    ],
    responseStarter:
      "I reviewed the electrical details and can confirm the affected system, safety points, and next steps before pricing.",
    createBidContext:
      "Electrical work is clearer when the affected circuit, fixture, or panel area is confirmed.",
    draftFocusLine:
      "Electrical work benefits from confirming the affected circuit, fixture, or panel area before final pricing.",
  },
  {
    key: "plumbing",
    label: "Plumbing",
    cueLabel: "Plumbing-focused review",
    keywords: [
      "plumbing",
      "pipe",
      "faucet",
      "leak",
      "toilet",
      "drain",
      "sink",
      "water heater",
      "fixture",
    ],
    prepItems: [
      "Clarify repair versus replacement scope.",
      "Identify the affected fixture, line, or leak area.",
      "Confirm access, shutoff, and troubleshooting needs.",
      "Note any related finish or restoration work.",
    ],
    responseStarter:
      "I reviewed the plumbing details and can confirm the affected area, access, and next steps before pricing.",
    createBidContext:
      "Plumbing work is clearer when the affected fixture or line and any access concerns are confirmed.",
    draftFocusLine:
      "Plumbing work benefits from confirming the affected fixture or line, access, and whether repair or replacement is expected before final pricing.",
  },
  {
    key: "exterior_siding",
    label: "Exterior / Siding",
    cueLabel: "Exterior / siding-focused review",
    keywords: [
      "exterior",
      "siding",
      "fascia",
      "soffit",
      "trim",
      "facade",
      "cladding",
      "outside",
      "exterior paint",
    ],
    prepItems: [
      "Confirm the elevations or exterior areas included.",
      "Review siding, trim, and finish repair needs.",
      "Note weather exposure and temporary protection needs.",
      "Clarify whether painting or related repairs are included.",
    ],
    responseStarter:
      "I reviewed the exterior details and can confirm the affected areas, protection needs, and next steps before pricing.",
    createBidContext:
      "Exterior work is clearer when the affected elevations, siding or trim details, and weather exposure are confirmed.",
    draftFocusLine:
      "Exterior projects benefit from confirming the affected elevations, siding or trim details, and weather exposure before final pricing.",
  },
  {
    key: "windows_doors",
    label: "Windows / Doors",
    cueLabel: "Windows / doors-focused review",
    keywords: [
      "window",
      "windows",
      "door",
      "doors",
      "entry door",
      "patio door",
      "sliding door",
      "replacement window",
      "replace window",
      "replace door",
    ],
    prepItems: [
      "Confirm the number of openings and sizes.",
      "Clarify repair versus replacement scope.",
      "Review trim, finish, and access details.",
      "Note any weatherproofing or lead-time needs.",
    ],
    responseStarter:
      "I reviewed the window and door details and can confirm the openings, scope, and next steps before pricing.",
    createBidContext:
      "Window and door work is clearer when sizes, scope, and trim or weatherproofing needs are confirmed.",
    draftFocusLine:
      "Window and door projects benefit from confirming the openings, sizes, trim details, and weatherproofing needs before final pricing.",
  },
  {
    key: "handyman",
    label: "General Repair / Handyman",
    cueLabel: "General repair-focused review",
    keywords: [
      "handyman",
      "general repair",
      "repair",
      "fix",
      "small repair",
      "misc repair",
      "punch list",
      "odd jobs",
      "home repair",
    ],
    prepItems: [
      "List the individual tasks and priorities.",
      "Confirm which materials the contractor provides.",
      "Review access, timing, and any repeat visit needs.",
      "Call out anything that may need a specialty trade.",
    ],
    responseStarter:
      "I reviewed the repair details and can help confirm the task list, priorities, and next steps before pricing.",
    createBidContext:
      "General repair work is clearer when the task list, materials, and any specialty trade needs are confirmed.",
    draftFocusLine:
      "General repair projects benefit from confirming the task list, materials, and any specialty trade needs before final pricing.",
  },
];

const GENERIC_PROJECT_INTELLIGENCE = {
  key: "general",
  label: "General project review",
  cueLabel: "",
  keywords: [],
  prepItems: ["Confirm the scope, measurements, and timing before you respond."],
  responseStarter: "I’ll review the request and follow up if anything needs clarification.",
  createBidContext: "Review the request details and create your bid when you’re ready.",
  draftFocusLine: "Review the project details and confirm the scope before final pricing.",
};

export function inferProjectIntelligence({
  projectTitle = "",
  projectType = "",
  projectSubtype = "",
  description = "",
} = {}) {
  const text = normalize([projectTitle, projectType, projectSubtype, description].filter(Boolean).join(" "));
  let best = GENERIC_PROJECT_INTELLIGENCE;
  let bestScore = 0;

  for (const family of PROJECT_TYPE_FAMILIES) {
    let score = 0;
    for (const keyword of family.keywords) {
      const needle = normalize(keyword);
      if (needle && text.includes(needle)) {
        score += needle.includes(" ") ? 2 : 1;
      }
    }

    const normalizedType = normalize(projectType);
    const normalizedSubtype = normalize(projectSubtype);
    if (normalizedType.includes(family.key) || normalizedSubtype.includes(family.key)) {
      score += 3;
    }

    if (score > bestScore) {
      best = family;
      bestScore = score;
    }
  }

  if (bestScore <= 0) {
    return { ...GENERIC_PROJECT_INTELLIGENCE, isGeneric: true };
  }

  return { ...best, isGeneric: best.key === "general" };
}

export function buildProjectIntelligenceGuidance(input = {}) {
  const family = inferProjectIntelligence(input);
  return {
    familyKey: family.key,
    familyLabel: family.label,
    familyCueLabel: family.cueLabel || "",
    prepItems: Array.isArray(family.prepItems) ? [...family.prepItems] : [],
    responseStarter: safeText(family.responseStarter),
    createBidContext: safeText(family.createBidContext),
    draftFocusLine: safeText(family.draftFocusLine),
    isGeneric: Boolean(family.isGeneric),
  };
}
