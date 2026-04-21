const STORAGE_KEY = "mhb_project_family_context";

function safeText(value) {
  return value == null ? "" : String(value).trim();
}

function titleCaseWords(value) {
  return safeText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function formatProjectFamilyLabel(projectFamilyKey = "") {
  const key = safeText(projectFamilyKey);
  if (!key) return "";
  return titleCaseWords(key.replaceAll("_", " "));
}

export function normalizeProjectFamilyContext(value = {}) {
  const next = value && typeof value === "object" ? value : {};
  const projectFamilyKey = safeText(
    next.project_family_key || next.projectFamilyKey || next.key
  );
  const projectFamilyLabel = safeText(
    next.project_family_label || next.projectFamilyLabel || next.label
  ) || formatProjectFamilyLabel(projectFamilyKey);

  return {
    project_family_key: projectFamilyKey,
    project_family_label: projectFamilyLabel,
  };
}

export function readStoredProjectFamilyContext() {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return normalizeProjectFamilyContext();
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeProjectFamilyContext();
    return normalizeProjectFamilyContext(JSON.parse(raw));
  } catch {
    return normalizeProjectFamilyContext();
  }
}

export function writeStoredProjectFamilyContext(value = {}) {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const normalized = normalizeProjectFamilyContext(value);
    if (!normalized.project_family_key) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // ignore storage failures
  }
}

