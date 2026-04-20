function safeText(value) {
  return String(value || "").trim();
}

function normalize(value) {
  return safeText(value).toLowerCase().replace(/&/g, " and ").replace(/\s+/g, " ").trim();
}

function containsAny(text, needles = []) {
  const haystack = normalize(text);
  return needles.some((needle) => {
    const normalized = normalize(needle);
    return normalized && haystack.includes(normalized);
  });
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

function inferScopeMode(text, familyKey) {
  const normalized = normalize(text);

  if (familyKey === "roofing") {
    if (containsAny(normalized, ["replacement", "replace", "full replacement", "tear off", "tear-off"])) {
      return "replacement";
    }
    return "repair";
  }

  if (familyKey === "bathroom_remodel") {
    if (containsAny(normalized, ["repair", "update", "refresh", "fix", "small"])) {
      return "repair";
    }
    return "remodel";
  }

  if (familyKey === "kitchen_remodel") {
    if (
      containsAny(normalized, ["cabinet", "cabinetry"]) &&
      containsAny(normalized, ["install", "installation", "remove", "removal", "replace", "replacement"])
    ) {
      return "install_removal";
    }
    if (containsAny(normalized, ["remodel", "layout", "countertop", "backsplash", "appliance", "island"])) {
      return "remodel";
    }
    return "install";
  }

  if (familyKey === "flooring") return "install";
  if (familyKey === "painting") {
    if (normalized.includes("exterior") && normalized.includes("interior")) return "interior_exterior";
    if (normalized.includes("exterior")) return "exterior";
    return "interior";
  }
  if (familyKey === "electrical" || familyKey === "plumbing") {
    if (containsAny(normalized, ["install", "installation", "new"])) return "install";
    return "repair";
  }
  if (familyKey === "exterior_siding") {
    if (containsAny(normalized, ["replacement", "replace", "new"])) return "replacement";
    return "repair";
  }
  if (familyKey === "windows_doors") {
    if (containsAny(normalized, ["repair", "fix", "adjust"])) return "repair";
    return "replacement";
  }
  return "general";
}

export function buildProjectSetupRecommendation({
  projectTitle = "",
  projectType = "",
  projectSubtype = "",
  description = "",
  templateId = null,
  templateName = "",
} = {}) {
  const family = inferProjectIntelligence({
    projectTitle,
    projectType,
    projectSubtype,
    description,
  });
  const scopeText = normalize([projectTitle, projectType, projectSubtype, description].filter(Boolean).join(" "));
  const scopeMode = inferScopeMode(scopeText, family.key);

  let recommendedProjectType = projectType || family.label;
  let recommendedProjectSubtype = projectSubtype || family.label;
  let suggestedWorkflow = family.cueLabel || "General project review";
  let suggestedTemplateLabel = "";
  let recommendationNote = family.draftFocusLine || "Review the project details before you finalize the setup.";

  if (family.key === "roofing") {
    if (scopeMode === "replacement") {
      recommendedProjectType = "Roof Replacement";
      recommendedProjectSubtype = "Roof Replacement";
      suggestedWorkflow = "Replacement workflow";
      suggestedTemplateLabel = "Roof Replacement Template";
      recommendationNote =
        "Roof replacement jobs are clearer when the roof condition, weather exposure, and scope boundary are confirmed.";
    } else {
      recommendedProjectType = "Roof Repair";
      recommendedProjectSubtype = "Roof Repair";
      suggestedWorkflow = "Repair + inspection";
      suggestedTemplateLabel = "Roof Repair Template";
      recommendationNote =
        "Roof repairs are clearer when the leak location, affected areas, and inspection needs are confirmed.";
    }
  } else if (family.key === "bathroom_remodel") {
    if (scopeMode === "repair") {
      recommendedProjectType = "Bathroom Repair";
      recommendedProjectSubtype = "Bathroom Repair";
      suggestedWorkflow = "Repair / refresh workflow";
      suggestedTemplateLabel = "Bathroom Repair Template";
      recommendationNote =
        "Bathroom repair work is clearer when the fixture, finish, and any plumbing or layout changes are confirmed.";
    } else {
      recommendedProjectType = "Bathroom Remodel";
      recommendedProjectSubtype = "Bathroom Remodel";
      suggestedWorkflow = "Remodel workflow";
      suggestedTemplateLabel = "Bathroom Remodel Template";
      recommendationNote =
        "Bathroom remodels benefit from confirming layout changes, fixtures, and finish selections before pricing.";
    }
  } else if (family.key === "kitchen_remodel") {
    if (scopeMode === "install_removal") {
      recommendedProjectType = "Kitchen Cabinet Installation";
      recommendedProjectSubtype = "Kitchen Cabinet Installation";
      suggestedWorkflow = "Install + removal";
      suggestedTemplateLabel = "Kitchen Cabinet Install Template";
      recommendationNote =
        "Kitchen cabinet projects are clearer when cabinet removal, installation, and related finish work are defined up front.";
    } else {
      recommendedProjectType = "Kitchen Remodel";
      recommendedProjectSubtype = "Kitchen Remodel";
      suggestedWorkflow = "Remodel workflow";
      suggestedTemplateLabel = "Kitchen Remodel Template";
      recommendationNote =
        "Kitchen remodels benefit from confirming cabinets, countertops, layout changes, and related work before final pricing.";
    }
  } else if (family.key === "flooring") {
    recommendedProjectType = "Flooring Installation";
    recommendedProjectSubtype = "Flooring Installation";
    suggestedWorkflow = "Install workflow";
    suggestedTemplateLabel = "Flooring Installation Template";
    recommendationNote =
      "Flooring jobs are clearer when square footage, subfloor condition, and any removal or prep needs are confirmed.";
  } else if (family.key === "painting") {
    if (scopeMode === "exterior") {
      recommendedProjectType = "Exterior Painting";
      recommendedProjectSubtype = "Exterior Painting";
      suggestedWorkflow = "Prep + paint workflow";
      suggestedTemplateLabel = "Exterior Painting Template";
      recommendationNote =
        "Exterior painting is clearer when the surfaces, prep work, and weather exposure are confirmed.";
    } else {
      recommendedProjectType = "Interior Painting";
      recommendedProjectSubtype = "Interior Painting";
      suggestedWorkflow = "Prep + paint workflow";
      suggestedTemplateLabel = "Painting Template";
      recommendationNote =
        "Painting jobs benefit from confirming the rooms or surfaces included and any prep or repair needs.";
    }
  } else if (family.key === "electrical") {
    if (scopeMode === "install") {
      recommendedProjectType = "Electrical Installation";
      recommendedProjectSubtype = "Electrical Installation";
      suggestedWorkflow = "Install workflow";
      suggestedTemplateLabel = "Electrical Installation Template";
      recommendationNote =
        "Electrical installs are clearer when the affected circuits, fixtures, and access are confirmed.";
    } else {
      recommendedProjectType = "Electrical Repair";
      recommendedProjectSubtype = "Electrical Repair";
      suggestedWorkflow = "Troubleshooting workflow";
      suggestedTemplateLabel = "Electrical Repair Template";
      recommendationNote =
        "Electrical repair work is clearer when the affected circuit, panel, or fixture is confirmed.";
    }
  } else if (family.key === "plumbing") {
    if (scopeMode === "install") {
      recommendedProjectType = "Plumbing Installation";
      recommendedProjectSubtype = "Plumbing Installation";
      suggestedWorkflow = "Install workflow";
      suggestedTemplateLabel = "Plumbing Installation Template";
      recommendationNote =
        "Plumbing installs are clearer when the fixture, line, and access needs are confirmed.";
    } else {
      recommendedProjectType = "Plumbing Repair";
      recommendedProjectSubtype = "Plumbing Repair";
      suggestedWorkflow = "Troubleshooting workflow";
      suggestedTemplateLabel = "Plumbing Repair Template";
      recommendationNote =
        "Plumbing repairs are clearer when the affected fixture, leak area, and access are confirmed.";
    }
  } else if (family.key === "exterior_siding") {
    if (scopeMode === "replacement") {
      recommendedProjectType = "Exterior / Siding Replacement";
      recommendedProjectSubtype = "Exterior / Siding Replacement";
      suggestedWorkflow = "Replacement workflow";
      suggestedTemplateLabel = "Exterior / Siding Replacement Template";
      recommendationNote =
        "Exterior replacement work is clearer when the affected elevations, trim, and weather exposure are confirmed.";
    } else {
      recommendedProjectType = "Exterior / Siding Repair";
      recommendedProjectSubtype = "Exterior / Siding Repair";
      suggestedWorkflow = "Repair workflow";
      suggestedTemplateLabel = "Exterior / Siding Repair Template";
      recommendationNote =
        "Exterior repair work is clearer when the affected elevations, trim, and protection needs are confirmed.";
    }
  } else if (family.key === "windows_doors") {
    if (scopeMode === "repair") {
      recommendedProjectType = "Window / Door Repair";
      recommendedProjectSubtype = "Window / Door Repair";
      suggestedWorkflow = "Repair workflow";
      suggestedTemplateLabel = "Window / Door Repair Template";
      recommendationNote =
        "Window and door repairs are clearer when the openings, trim, and access details are confirmed.";
    } else {
      recommendedProjectType = "Windows / Doors Installation";
      recommendedProjectSubtype = "Windows / Doors Installation";
      suggestedWorkflow = "Replacement workflow";
      suggestedTemplateLabel = "Windows / Doors Installation Template";
      recommendationNote =
        "Window and door installs are clearer when the openings, sizes, and weatherproofing needs are confirmed.";
    }
  } else if (family.key === "handyman") {
    recommendedProjectType = "General Repair";
    recommendedProjectSubtype = "General Repair";
    suggestedWorkflow = "General repair workflow";
    suggestedTemplateLabel = "General Repair Template";
    recommendationNote =
      "General repair work is clearer when the task list, materials, and specialty trade needs are confirmed.";
  }

  const recommendedTemplateId = templateId == null || templateId === "" ? null : templateId;
  const recommendedTemplateName = safeText(templateName) || suggestedTemplateLabel;

  return {
    projectFamilyKey: family.key,
    projectFamilyLabel: family.label,
    recommendedProjectType,
    recommendedProjectSubtype,
    suggestedWorkflow,
    suggestedTemplateLabel,
    recommendedTemplateId,
    recommendedTemplateName,
    recommendationNote,
    strongTemplateMatch: Boolean(recommendedTemplateId),
  };
}

export function normalizeProjectSetupRecommendation(recommendation = {}) {
  const value = recommendation || {};
  return {
    projectFamilyKey: safeText(value.projectFamilyKey || value.project_family_key || ""),
    projectFamilyLabel: safeText(value.projectFamilyLabel || value.project_family_label || ""),
    recommendedProjectType: safeText(
      value.recommendedProjectType || value.recommended_project_type || ""
    ),
    recommendedProjectSubtype: safeText(
      value.recommendedProjectSubtype || value.recommended_project_subtype || ""
    ),
    suggestedWorkflow: safeText(value.suggestedWorkflow || value.suggested_workflow || ""),
    suggestedTemplateLabel: safeText(
      value.suggestedTemplateLabel || value.suggested_template_label || ""
    ),
    recommendedTemplateId:
      value.recommendedTemplateId ?? value.recommended_template_id ?? null,
    recommendedTemplateName: safeText(
      value.recommendedTemplateName || value.recommended_template_name || ""
    ),
    recommendationNote: safeText(value.recommendationNote || value.recommendation_note || ""),
    strongTemplateMatch: Boolean(value.strongTemplateMatch ?? value.strong_template_match ?? false),
  };
}
