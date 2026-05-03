const STORAGE_PREFIX = "milestonesDraft";
const LEGACY_STORAGE_PREFIX = "agreement:milestones";

function safeKeyPart(value) {
  const text = value == null ? "" : String(value).trim();
  return text || "new";
}

export function getStep2MilestoneDraftStorageKeys(agreementKey = "new") {
  const keyPart = safeKeyPart(agreementKey);
  return {
    canonicalKey: `${STORAGE_PREFIX}:${keyPart}`,
    legacyKey: `${LEGACY_STORAGE_PREFIX}:${keyPart}`,
  };
}

export function readStep2MilestoneDraft(agreementKey = "new") {
  if (typeof window === "undefined") {
    return null;
  }

  const { canonicalKey, legacyKey } = getStep2MilestoneDraftStorageKeys(agreementKey);

  const read = (key) => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed?.milestones)) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const canonicalDraft = read(canonicalKey);
  if (canonicalDraft) {
    return canonicalDraft;
  }

  const legacyDraft = read(legacyKey);
  if (!legacyDraft) {
    return null;
  }

  try {
    window.localStorage.setItem(canonicalKey, JSON.stringify(legacyDraft));
    window.localStorage.removeItem(legacyKey);
  } catch {
    // ignore storage errors
  }

  return legacyDraft;
}

export function writeStep2MilestoneDraft(agreementKey = "new", draft = {}) {
  if (typeof window === "undefined") {
    return;
  }

  const { canonicalKey, legacyKey } = getStep2MilestoneDraftStorageKeys(agreementKey);
  const payload = JSON.stringify(draft || {});
  try {
    window.localStorage.setItem(canonicalKey, payload);
    window.localStorage.removeItem(legacyKey);
  } catch {
    // ignore storage errors
  }
}

export function clearStep2MilestoneDraft(agreementKey = "new") {
  if (typeof window === "undefined") {
    return;
  }

  const { canonicalKey, legacyKey } = getStep2MilestoneDraftStorageKeys(agreementKey);
  try {
    window.localStorage.removeItem(canonicalKey);
    window.localStorage.removeItem(legacyKey);
  } catch {
    // ignore storage errors
  }
}
