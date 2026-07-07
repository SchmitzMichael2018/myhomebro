// frontend/src/lib/aiResponseParser.js
// Pure parsing utilities for all backend AI endpoint responses.
// Never throws — always returns the provided fallback on any error.

const REFUSAL_PATTERNS = [
  /i'm sorry/i,
  /as an ai/i,
  /i cannot/i,
  /i can't/i,
  /i am unable/i,
  /i'm unable/i,
  /i'm not able/i,
  /i don't feel comfortable/i,
  /i apologize/i,
  /not appropriate/i,
];

/** Returns true when the text looks like a model refusal rather than JSON output. */
export function isModelRefusal(text) {
  if (typeof text !== "string" || !text) return false;
  return REFUSAL_PATTERNS.some((p) => p.test(text));
}

function safeStr(v) {
  return typeof v === "string" ? v.trim() : (v == null ? "" : String(v).trim());
}

function safeNum(v, fallback = null) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * Generic parser — never throws, returns fallback on:
 *   - truncated JSON
 *   - model refusal strings
 *   - schema transform errors
 *   - null/undefined input
 *
 * @param {*} raw         Raw API response (string or object)
 * @param {Function|null} schema  Transform (d) => result, or null for identity
 * @param {*} fallback    Value to return on any failure
 */
export function parseAiResponse(raw, schema, fallback) {
  try {
    let data;
    if (typeof raw === "string") {
      if (isModelRefusal(raw)) return fallback;
      data = JSON.parse(raw);
      if (typeof data !== "object" || data === null || Array.isArray(data)) return fallback;
    } else if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      data = raw;
    } else {
      return fallback;
    }
    if (!schema) return data;
    return schema(data);
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Per-endpoint parsers
// ---------------------------------------------------------------------------

const _descriptionFallback = { description: "", confidence: "low", original_preserved: false };

/** POST /agreements/ai/description/ */
export function parseDescriptionResponse(raw) {
  return parseAiResponse(
    raw,
    (d) => ({
      description: safeStr(d.description),
      confidence: safeStr(d.confidence_label || d.confidence) || "low",
      original_preserved: !!d.original_preserved,
    }),
    _descriptionFallback,
  );
}

const _classifyFallback = {
  project_type: "",
  project_subtype: "",
  project_path: "",
  confidence: "low",
  alternatives: [],
};

/** POST /agreements/ai/classify/ */
export function parseClassifyResponse(raw) {
  return parseAiResponse(
    raw,
    (d) => ({
      project_type: safeStr(d.project_type),
      project_subtype: safeStr(d.project_subtype),
      project_path: safeStr(d.project_path),
      confidence: safeStr(d.confidence) || "low",
      alternatives: safeArr(d.alternatives),
    }),
    _classifyFallback,
  );
}

const _draftFallback = {
  title: "",
  scope: "",
  line_items: [],
  exclusions: "",
  assumptions: "",
  project_type: "",
  project_subtype: "",
  confidence: "low",
};

/** POST /agreements/ai/draft/ */
export function parseDraftResponse(raw) {
  return parseAiResponse(
    raw,
    (d) => ({
      title: safeStr(d.project_title || d.title),
      scope: safeStr(d.scope_of_work || d.scope || d.description),
      line_items: safeArr(d.line_items),
      exclusions: safeStr(d.exclusions),
      assumptions: safeStr(d.assumptions),
      project_type: safeStr(d.project_type),
      project_subtype: safeStr(d.project_subtype),
      confidence: safeStr(d.confidence) || "low",
    }),
    _draftFallback,
  );
}

const _milestonesFallback = { milestones: [], total_estimated_days: 0, confidence: "low" };

/** POST /agreements/{id}/ai/suggest-milestones/ */
export function parseMilestonesResponse(raw) {
  return parseAiResponse(
    raw,
    (d) => ({
      milestones: safeArr(d.milestones),
      total_estimated_days: safeNum(d.total_estimated_days, 0),
      confidence: safeStr(d.confidence) || "low",
    }),
    _milestonesFallback,
  );
}

const _pricingFallback = {
  milestones: [],
  total: { low: 0, mid: 0, high: 0, currency: "USD" },
  confidence: "low",
};

/**
 * POST /agreements/{id}/ai/refresh-pricing-estimate/
 * Validates that high >= mid >= low per milestone; drops invalid rows.
 */
export function parsePricingResponse(raw) {
  return parseAiResponse(
    raw,
    (d) => {
      const rows = safeArr(d.pricing_estimates || d.milestones);
      const milestones = rows
        .map((m) => {
          const low = safeNum(m.suggested_amount_low, 0);
          const high = safeNum(m.suggested_amount_high, 0);
          // derive mid from explicit field or midpoint
          const explicitMid = safeNum(m.suggested_amount_mid, null);
          const mid = explicitMid !== null ? explicitMid : (low + high) / 2;

          // reject invalid ranges
          if (low > 0 && high > 0 && high < low) return null;
          if (low > 0 && mid > 0 && mid < low) return null;

          return { ...m, suggested_amount_low: low, suggested_amount_mid: mid, suggested_amount_high: high };
        })
        .filter(Boolean);

      const totalLow = milestones.reduce((s, m) => s + (m.suggested_amount_low || 0), 0);
      const totalMid = milestones.reduce((s, m) => s + (m.suggested_amount_mid || 0), 0);
      const totalHigh = milestones.reduce((s, m) => s + (m.suggested_amount_high || 0), 0);

      return {
        milestones,
        total: { low: totalLow, mid: totalMid, high: totalHigh, currency: "USD" },
        confidence: safeStr(d.confidence) || "low",
      };
    },
    _pricingFallback,
  );
}

const _templateFallback = {
  name: "",
  project_type: "",
  project_subtype: "",
  milestones: [],
  pricing: null,
  materials: [],
};

/** POST /templates/ai/create-from-scope/ */
export function parseTemplateFromScopeResponse(raw) {
  return parseAiResponse(
    raw,
    (d) => ({
      ...d,
      name: safeStr(d.name),
      project_type: safeStr(d.project_type),
      project_subtype: safeStr(d.project_subtype),
      milestones: safeArr(d.milestones),
      materials: safeArr(d.materials),
      pricing: d.pricing || null,
    }),
    _templateFallback,
  );
}

const _disputeFallback = {
  overview: null,
  options: [],
  courses_of_action: [],
  recommendation: null,
  draft_resolution_agreement: null,
  confidence: 0,
};

/** POST /disputes/{id}/ai/recommendation/ */
export function parseDisputeRecommendationResponse(raw) {
  return parseAiResponse(
    raw,
    (d) => ({
      overview: d.overview || null,
      options: safeArr(d.courses_of_action).length ? safeArr(d.courses_of_action) : safeArr(d.options),
      courses_of_action: safeArr(d.courses_of_action),
      recommendation: d.recommendation || null,
      draft_resolution_agreement: d.draft_resolution_agreement || null,
      confidence: safeNum(d.recommendation?.confidence, 0),
    }),
    _disputeFallback,
  );
}
