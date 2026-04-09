export const TEMPLATE_MILESTONE_TYPE_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "demolition", label: "Demolition" },
  { value: "site_prep", label: "Site Prep" },
  { value: "framing", label: "Framing" },
  { value: "foundation", label: "Foundation" },
  { value: "roofing", label: "Roofing" },
  { value: "siding", label: "Siding" },
  { value: "windows_doors", label: "Windows / Doors" },
  { value: "electrical_rough", label: "Electrical Rough" },
  { value: "plumbing_rough", label: "Plumbing Rough" },
  { value: "hvac_rough", label: "HVAC Rough" },
  { value: "insulation", label: "Insulation" },
  { value: "drywall", label: "Drywall" },
  { value: "paint_finish", label: "Paint / Finish" },
  { value: "flooring", label: "Flooring" },
  { value: "tile_install", label: "Tile Install" },
  { value: "cabinetry", label: "Cabinetry" },
  { value: "fixtures", label: "Fixtures" },
  { value: "trim_finish", label: "Trim / Finish" },
  { value: "cleanup", label: "Cleanup" },
  { value: "inspection", label: "Inspection" },
];

const CANONICAL_VALUES = new Set(
  TEMPLATE_MILESTONE_TYPE_OPTIONS.map((option) => option.value).filter(Boolean)
);

const ALIAS_TO_CANONICAL = {
  demolition: "demolition",
  demo: "demolition",
  site_preparation: "site_prep",
  site_prep: "site_prep",
  site_prepation: "site_prep",
  planning: "site_prep",
  staging: "site_prep",
  foundation: "foundation",
  footing: "foundation",
  footings: "foundation",
  framing: "framing",
  roof_removal: "roofing",
  roof_installation: "roofing",
  roofing: "roofing",
  siding: "siding",
  windows_doors: "windows_doors",
  electrical_rough_in: "electrical_rough",
  electrical_rough: "electrical_rough",
  plumbing_rough_in: "plumbing_rough",
  plumbing_rough: "plumbing_rough",
  hvac_rough_in: "hvac_rough",
  hvac_rough: "hvac_rough",
  insulation: "insulation",
  drywall: "drywall",
  painting: "paint_finish",
  paint_finish: "paint_finish",
  flooring_installation: "flooring",
  flooring: "flooring",
  tile_installation: "tile_install",
  tile_install: "tile_install",
  cabinet_installation: "cabinetry",
  cabinetry: "cabinetry",
  vanity_installation: "fixtures",
  installation: "fixtures",
  fixtures: "fixtures",
  trim_installation: "trim_finish",
  finish: "trim_finish",
  trim_finish: "trim_finish",
  cleanup: "cleanup",
  closeout: "inspection",
  final_walkthrough: "inspection",
  inspection: "inspection",
  general_milestone: "",
  phase_1: "",
  phase_2: "",
};

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\/-]+/g, " ")
    .replace(/\s+/g, "_");
}

export function canonicalizeTemplateMilestoneType(value = "", fallbackText = "") {
  const normalizedValue = normalizeToken(value);
  if (CANONICAL_VALUES.has(normalizedValue)) {
    return normalizedValue;
  }
  const normalizedFallback = normalizeToken(fallbackText);

  const combined = `${normalizedValue} ${normalizedFallback}`.trim();
  if (combined.includes("electrical")) return "electrical_rough";
  if (combined.includes("plumbing")) return "plumbing_rough";
  if (combined.includes("hvac")) return "hvac_rough";
  if (combined.includes("tile")) return "tile_install";
  if (combined.includes("cabinet")) return "cabinetry";
  if (
    combined.includes("walkthrough") ||
    combined.includes("inspection") ||
    combined.includes("closeout") ||
    combined.includes("handoff") ||
    combined.includes("punch_list")
  ) {
    return "inspection";
  }
  if (combined.includes("paint")) return "paint_finish";
  if (combined.includes("trim") || combined.includes("finish")) return "trim_finish";
  if (combined.includes("clean")) return "cleanup";
  if (combined.includes("prep") || combined.includes("planning") || combined.includes("staging")) {
    return "site_prep";
  }

  if (normalizedValue && normalizedValue in ALIAS_TO_CANONICAL) {
    return ALIAS_TO_CANONICAL[normalizedValue];
  }
  if (normalizedFallback && normalizedFallback in ALIAS_TO_CANONICAL) {
    return ALIAS_TO_CANONICAL[normalizedFallback];
  }

  return "";
}

export function labelForTemplateMilestoneType(value = "") {
  const canonical = canonicalizeTemplateMilestoneType(value);
  const match = TEMPLATE_MILESTONE_TYPE_OPTIONS.find((option) => option.value === canonical);
  return match?.label || "";
}
