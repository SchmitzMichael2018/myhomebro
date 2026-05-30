// Pure functions — no React, no side effects.

export const AI_CONTEXT_DEFAULTS = {
  page: null,
  entityId: null,
  entityType: null,
  status: null,
  projectType: null,
  projectSubtype: null,
  projectPath: null,           // "residential" | "commercial"
  projectAddress: null,        // { street, city, state, zip } from agreement
  customerHomeAddress: null,   // { street, city, state, zip } from customer profile
  milestoneCount: 0,
  existingScope: null,
  templateApplied: false,
  customerName: null,
  missingFields: [],
  contractorTradeProfile: [],
};

export function buildAiContext(overrides = {}) {
  try {
    const safe = overrides && typeof overrides === "object" ? overrides : {};
    return { ...AI_CONTEXT_DEFAULTS, ...safe };
  } catch {
    return { ...AI_CONTEXT_DEFAULTS };
  }
}

// Returns { valid: boolean, missingFields: string[] }
export function validateAiContext(context, requiredFields = []) {
  if (!context || typeof context !== "object") {
    return { valid: false, missingFields: Array.isArray(requiredFields) ? [...requiredFields] : [] };
  }
  const fields = Array.isArray(requiredFields) ? requiredFields : [];
  const missingFields = fields.filter(
    (f) => context[f] === null || context[f] === undefined || context[f] === ""
  );
  return { valid: missingFields.length === 0, missingFields };
}

// Strips null/undefined values to keep payloads clean. Preserves false and 0.
export function serializeAiContext(context) {
  if (!context || typeof context !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(context)) {
    if (value !== null && value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}
