function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

const RESTRICTED_PATTERNS = [
  ["electrical panel/service work", ["electrical panel", "service panel", "breaker panel", "main panel", "panel upgrade", "service upgrade", "breaker box", "subpanel", "rewire", "rewiring", "live wire", "live wiring", "hot wire"]],
  ["gas line work", ["gas line", "gas pipe", "gas fitting", "natural gas", "propane line"]],
  ["hvac refrigerant handling", ["refrigerant", "freon", "evacuate", "charge ac", "charge refrigerant", "mini split charge"]],
  ["hvac electrical integration", ["hvac electrical", "thermostat wiring", "heat pump wiring", "furnace wiring", "air handler wiring"]],
  ["sewer main work", ["sewer main", "sewer lateral", "main sewer", "sewer replacement", "sewer line"]],
  ["structural / load-bearing work", ["load-bearing", "load bearing", "structural", "structural beam", "bearing wall", "support wall", "foundation modification", "foundation repair", "footing", "joist sister"]],
  ["steep / high-risk roofing", ["steep roof", "high roof", "roof pitch", "roofing heights", "roof access", "roof replacement", "roof tear off"]],
  ["fire suppression systems", ["sprinkler", "fire suppression", "fire sprinkler"]],
  ["major code-critical system modifications", ["service change", "system modification", "major code", "code-critical", "code critical", "rough in"]],
];

export function detectRestrictedWork(...parts) {
  const text = normalizeText(parts.filter(Boolean).join(" "));
  if (!text) {
    return { detected: false, categories: [], message: "" };
  }

  const categories = RESTRICTED_PATTERNS.filter(([, needles]) => includesAny(text, needles)).map(([label]) => label);
  const detected = categories.length > 0;
  return {
    detected,
    categories,
    message: detected
      ? "Certain portions of this project are typically handled by licensed professionals."
      : "",
  };
}

export function buildAssistedDiySafetyWarning(...parts) {
  const result = detectRestrictedWork(...parts);
  if (!result.detected) return null;
  return {
    ...result,
    banner:
      "Certain portions of this project are typically handled by licensed professionals. Permits and inspections are still allowed; this notice only keeps high-risk trade phases contractor-led.",
  };
}
