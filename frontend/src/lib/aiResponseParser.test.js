import { describe, it, expect } from "vitest";
import {
  isModelRefusal,
  parseAiResponse,
  parseDescriptionResponse,
  parseClassifyResponse,
  parseDraftResponse,
  parseMilestonesResponse,
  parsePricingResponse,
  parseTemplateFromScopeResponse,
  parseDisputeRecommendationResponse,
} from "./aiResponseParser.js";

// ---------------------------------------------------------------------------
// isModelRefusal
// ---------------------------------------------------------------------------
describe("isModelRefusal", () => {
  it("detects common refusal phrases", () => {
    expect(isModelRefusal("I'm sorry, I can't help with that.")).toBe(true);
    expect(isModelRefusal("As an AI language model, I cannot...")).toBe(true);
    expect(isModelRefusal("I cannot provide that information.")).toBe(true);
    expect(isModelRefusal("I can't do that.")).toBe(true);
    expect(isModelRefusal("I am unable to assist.")).toBe(true);
    expect(isModelRefusal("I apologize, but I'm not able to.")).toBe(true);
  });

  it("returns false for normal AI responses", () => {
    expect(isModelRefusal('{"description":"Roof replacement scope..."}')).toBe(false);
    expect(isModelRefusal("Install new asphalt shingles on the north slope.")).toBe(false);
    expect(isModelRefusal("")).toBe(false);
  });

  it("handles null/undefined gracefully", () => {
    expect(isModelRefusal(null)).toBe(false);
    expect(isModelRefusal(undefined)).toBe(false);
    expect(isModelRefusal(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseAiResponse (generic)
// ---------------------------------------------------------------------------
describe("parseAiResponse", () => {
  it("parses valid JSON string", () => {
    const result = parseAiResponse('{"foo":"bar"}', null, { foo: "fallback" });
    expect(result.foo).toBe("bar");
  });

  it("accepts already-parsed object", () => {
    const result = parseAiResponse({ foo: "baz" }, null, { foo: "fallback" });
    expect(result.foo).toBe("baz");
  });

  it("returns fallback on truncated JSON", () => {
    const result = parseAiResponse('{"foo":"ba', null, { foo: "fallback" });
    expect(result.foo).toBe("fallback");
  });

  it("returns fallback on model refusal string", () => {
    const result = parseAiResponse("I'm sorry, I cannot do that.", null, { foo: "fallback" });
    expect(result.foo).toBe("fallback");
  });

  it("applies schema transform when provided", () => {
    const schema = (d) => ({ title: d.name?.toUpperCase() });
    const result = parseAiResponse({ name: "roofing" }, schema, { title: "" });
    expect(result.title).toBe("ROOFING");
  });

  it("returns fallback if schema transform throws", () => {
    const schema = () => { throw new Error("boom"); };
    const result = parseAiResponse({ name: "ok" }, schema, { title: "safe" });
    expect(result.title).toBe("safe");
  });

  it("never throws regardless of input", () => {
    expect(() => parseAiResponse(null, null, {})).not.toThrow();
    expect(() => parseAiResponse(undefined, null, {})).not.toThrow();
    expect(() => parseAiResponse([], null, {})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseDescriptionResponse
// ---------------------------------------------------------------------------
describe("parseDescriptionResponse", () => {
  it("extracts description from valid response", () => {
    const result = parseDescriptionResponse({ description: "Replace asphalt shingles on the main roof." });
    expect(result.description).toBe("Replace asphalt shingles on the main roof.");
    expect(result.confidence).toBeTruthy();
  });

  it("returns fallback when description is missing", () => {
    const result = parseDescriptionResponse({});
    expect(result.description).toBe("");
    expect(result.confidence).toBeTruthy();
  });

  it("handles truncated JSON — returns fallback, never throws", () => {
    expect(() => parseDescriptionResponse('{"desc')).not.toThrow();
    const result = parseDescriptionResponse('{"desc');
    expect(result.description).toBe("");
  });

  it("handles null/undefined input gracefully", () => {
    expect(() => parseDescriptionResponse(null)).not.toThrow();
    expect(() => parseDescriptionResponse(undefined)).not.toThrow();
    const result = parseDescriptionResponse(null);
    expect(result.description).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parseClassifyResponse
// ---------------------------------------------------------------------------
describe("parseClassifyResponse", () => {
  it("extracts classification fields from valid response", () => {
    const result = parseClassifyResponse({
      project_type: "Roofing",
      project_subtype: "Asphalt Shingle",
      project_path: "residential",
      confidence: "high",
      alternatives: [{ project_type: "Siding", project_subtype: "" }],
    });
    expect(result.project_type).toBe("Roofing");
    expect(result.project_subtype).toBe("Asphalt Shingle");
    expect(result.project_path).toBe("residential");
    expect(result.confidence).toBe("high");
    expect(result.alternatives).toHaveLength(1);
  });

  it("flags low confidence when confidence field is missing", () => {
    const result = parseClassifyResponse({ project_type: "Roofing" });
    expect(result.confidence).toBe("low");
  });

  it("handles missing required fields — returns fallback, doesn't throw", () => {
    const result = parseClassifyResponse({});
    expect(result.project_type).toBe("");
    expect(result.alternatives).toEqual([]);
  });

  it("handles truncated JSON", () => {
    const result = parseClassifyResponse('{"project_type":"Roof');
    expect(result.project_type).toBe("");
  });

  it("handles null input gracefully", () => {
    expect(() => parseClassifyResponse(null)).not.toThrow();
    const r = parseClassifyResponse(null);
    expect(r.project_type).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parseDraftResponse
// ---------------------------------------------------------------------------
describe("parseDraftResponse", () => {
  it("extracts draft fields from valid response", () => {
    const result = parseDraftResponse({
      project_title: "Roof Replacement",
      scope_of_work: "Remove old shingles and install new.",
      exclusions: "Hidden damage not included.",
      assumptions: "Customer provides site access.",
      project_type: "Roofing",
      project_subtype: "Asphalt Shingle",
      confidence: "medium",
    });
    expect(result.title).toBe("Roof Replacement");
    expect(result.scope).toBe("Remove old shingles and install new.");
    expect(result.exclusions).toBe("Hidden damage not included.");
    expect(result.project_type).toBe("Roofing");
  });

  it("returns fallback when required fields are missing", () => {
    const result = parseDraftResponse({});
    expect(result.title).toBe("");
    expect(result.scope).toBe("");
    expect(result.confidence).toBe("low");
  });

  it("handles truncated JSON — returns fallback", () => {
    const result = parseDraftResponse('{"project_title":"Roof Re');
    expect(result.title).toBe("");
  });

  it("handles null/undefined input gracefully", () => {
    expect(() => parseDraftResponse(null)).not.toThrow();
    expect(() => parseDraftResponse(undefined)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseMilestonesResponse
// ---------------------------------------------------------------------------
describe("parseMilestonesResponse", () => {
  it("extracts milestones from valid response", () => {
    const result = parseMilestonesResponse({
      milestones: [{ title: "Site Prep", amount: 500 }],
      total_estimated_days: 14,
    });
    expect(result.milestones).toHaveLength(1);
    expect(result.total_estimated_days).toBe(14);
  });

  it("returns empty milestones when array is missing", () => {
    const result = parseMilestonesResponse({});
    expect(result.milestones).toEqual([]);
  });

  it("handles truncated JSON — returns fallback", () => {
    const result = parseMilestonesResponse('{"milestones":[{"title"');
    expect(result.milestones).toEqual([]);
  });

  it("handles null/undefined input gracefully", () => {
    expect(() => parseMilestonesResponse(null)).not.toThrow();
    const r = parseMilestonesResponse(undefined);
    expect(r.milestones).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parsePricingResponse
// ---------------------------------------------------------------------------
describe("parsePricingResponse", () => {
  it("extracts pricing estimates from valid response", () => {
    const result = parsePricingResponse({
      pricing_estimates: [
        { order: 1, title: "Demo", suggested_amount_low: 800, suggested_amount_high: 1200 },
        { order: 2, title: "Install", suggested_amount_low: 2400, suggested_amount_high: 3600 },
      ],
    });
    expect(result.milestones).toHaveLength(2);
    expect(result.total.low).toBeGreaterThan(0);
    expect(result.total.high).toBeGreaterThan(result.total.low);
  });

  it("rejects milestone where high < low", () => {
    const result = parsePricingResponse({
      pricing_estimates: [
        { order: 1, title: "Demo", suggested_amount_low: 2000, suggested_amount_high: 500 },
      ],
    });
    expect(result.milestones).toHaveLength(0);
  });

  it("rejects milestone where mid < low", () => {
    const result = parsePricingResponse({
      pricing_estimates: [
        { order: 1, title: "Demo", suggested_amount_low: 1000, suggested_amount_mid: 400, suggested_amount_high: 2000 },
      ],
    });
    expect(result.milestones).toHaveLength(0);
  });

  it("accepts valid range", () => {
    const result = parsePricingResponse({
      pricing_estimates: [
        { order: 1, suggested_amount_low: 1000, suggested_amount_high: 2000 },
      ],
    });
    expect(result.milestones).toHaveLength(1);
  });

  it("handles missing confidence with default", () => {
    const result = parsePricingResponse({ pricing_estimates: [] });
    expect(result.confidence).toBe("low");
  });

  it("returns fallback on truncated JSON", () => {
    const result = parsePricingResponse('{"pricing_estimates":[{');
    expect(result.milestones).toEqual([]);
  });

  it("handles null/undefined input gracefully", () => {
    expect(() => parsePricingResponse(null)).not.toThrow();
    const r = parsePricingResponse(undefined);
    expect(r.milestones).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseTemplateFromScopeResponse
// ---------------------------------------------------------------------------
describe("parseTemplateFromScopeResponse", () => {
  it("extracts template fields from valid response", () => {
    const result = parseTemplateFromScopeResponse({
      name: "Roof Replacement Template",
      project_type: "Roofing",
      milestones: [{ title: "Demo" }],
      materials: [{ category: "Shingles" }],
    });
    expect(result.name).toBe("Roof Replacement Template");
    expect(result.milestones).toHaveLength(1);
    expect(result.materials).toHaveLength(1);
  });

  it("returns empty arrays when fields are missing", () => {
    const result = parseTemplateFromScopeResponse({});
    expect(result.milestones).toEqual([]);
    expect(result.materials).toEqual([]);
  });

  it("handles truncated JSON — returns fallback", () => {
    const result = parseTemplateFromScopeResponse('{"name":"Roof');
    expect(result.name).toBe("");
  });

  it("handles null/undefined input gracefully", () => {
    expect(() => parseTemplateFromScopeResponse(null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseDisputeRecommendationResponse
// ---------------------------------------------------------------------------
describe("parseDisputeRecommendationResponse", () => {
  it("extracts all dispute fields from valid response", () => {
    const result = parseDisputeRecommendationResponse({
      overview: { neutral_summary: "Both parties disagree on scope." },
      recommendation: { recommended_option_id: "opt_a", confidence: 0.82 },
      options: [{ option_id: "opt_a", label: "Full refund" }],
      draft_resolution_agreement: { title: "Resolution", terms: ["Refund $500"] },
    });
    expect(result.overview?.neutral_summary).toBeTruthy();
    expect(result.recommendation?.recommended_option_id).toBe("opt_a");
    expect(result.options).toHaveLength(1);
    expect(result.draft_resolution_agreement?.title).toBe("Resolution");
    expect(result.confidence).toBe(0.82);
  });

  it("returns empty arrays and nulls when fields are missing", () => {
    const result = parseDisputeRecommendationResponse({});
    expect(result.overview).toBeNull();
    expect(result.options).toEqual([]);
    expect(result.recommendation).toBeNull();
    expect(result.draft_resolution_agreement).toBeNull();
  });

  it("handles truncated JSON — returns fallback", () => {
    const result = parseDisputeRecommendationResponse('{"overview":{"neutral_sum');
    expect(result.overview).toBeNull();
  });

  it("handles null/undefined input gracefully", () => {
    expect(() => parseDisputeRecommendationResponse(null)).not.toThrow();
  });
});
