export function normalizeProjectClass(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "commercial" ? "commercial" : "residential";
}
