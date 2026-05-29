import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateHandoff, HANDOFF_SAFE_DEFAULTS } from "./assistantHandoff.js";

// Suppress dev-mode console.warn during tests
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const FULL_VALID_PAYLOAD = {
  prefillFields: { customer_name: "Acme Corp" },
  draftPayload: { project_type: "roofing" },
  context: { lead_id: 42 },
  wizardStepTarget: 2,
  suggestedMilestones: [{ title: "Demo" }],
  clarificationQuestions: ["What material?"],
  estimatePreview: { low: 1000, high: 2000 },
  templateRecommendations: [{ id: 1 }],
  topTemplatePreview: { name: "Roof Replace" },
  proactiveRecommendations: ["Add permit step"],
  predictiveInsights: [],
  proposedActions: [{ action: "draft" }],
  confirmationRequiredActions: [],
  guidedFlow: { step: "classify" },
  automationPlan: null,
  intent: "create_agreement",
  projectAddress: { street: "123 Main St", city: "Austin", state: "TX" },
  complianceFlags: [],
};

describe("validateHandoff", () => {
  it("passes a valid complete payload through unchanged", () => {
    const result = validateHandoff(FULL_VALID_PAYLOAD);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.payload.prefillFields).toEqual({ customer_name: "Acme Corp" });
    expect(result.payload.wizardStepTarget).toBe(2);
    expect(result.payload.suggestedMilestones).toEqual([{ title: "Demo" }]);
    expect(result.payload.automationPlan).toBeNull();
    expect(result.payload.intent).toBe("create_agreement");
  });

  it("returns safe defaults and reports errors when required keys are missing", () => {
    const result = validateHandoff({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // All fields should fall back to their safe defaults
    expect(result.payload.prefillFields).toEqual({});
    expect(result.payload.draftPayload).toEqual({});
    expect(result.payload.wizardStepTarget).toBeNull();
    expect(result.payload.suggestedMilestones).toEqual([]);
    expect(result.payload.clarificationQuestions).toEqual([]);
    expect(result.payload.intent).toBe("");
  });

  it("replaces wrong-type values with safe defaults", () => {
    const result = validateHandoff({
      ...FULL_VALID_PAYLOAD,
      prefillFields: "not an object",     // should be object
      suggestedMilestones: "not an array", // should be array
      wizardStepTarget: "two",            // should be number|null
      intent: 999,                         // should be string
    });
    expect(result.valid).toBe(false);
    expect(result.payload.prefillFields).toEqual({});
    expect(result.payload.suggestedMilestones).toEqual([]);
    expect(result.payload.wizardStepTarget).toBeNull();
    expect(result.payload.intent).toBe("");
    // Untouched valid fields should pass through
    expect(result.payload.draftPayload).toEqual({ project_type: "roofing" });
  });

  it("returns full safe defaults for an empty object", () => {
    const result = validateHandoff({});
    expect(result.valid).toBe(false);
    expect(result.payload).toMatchObject({
      prefillFields: {},
      draftPayload: {},
      context: {},
      wizardStepTarget: null,
      suggestedMilestones: [],
      clarificationQuestions: [],
      estimatePreview: {},
      templateRecommendations: [],
      proactiveRecommendations: [],
      proposedActions: [],
      guidedFlow: {},
      automationPlan: {},
      intent: "",
      projectAddress: {},
      complianceFlags: [],
    });
  });

  it("returns full safe defaults for null input", () => {
    const result = validateHandoff(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("payload must be a plain object");
    expect(result.payload).toEqual(HANDOFF_SAFE_DEFAULTS);
  });

  it("returns full safe defaults for undefined input", () => {
    const result = validateHandoff(undefined);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("payload must be a plain object");
    expect(result.payload).toEqual(HANDOFF_SAFE_DEFAULTS);
  });

  it("accepts null for nullable fields (estimatePreview, guidedFlow, automationPlan)", () => {
    const result = validateHandoff({
      ...FULL_VALID_PAYLOAD,
      estimatePreview: null,
      guidedFlow: null,
      automationPlan: null,
    });
    expect(result.valid).toBe(true);
    expect(result.payload.estimatePreview).toBeNull();
    expect(result.payload.guidedFlow).toBeNull();
    expect(result.payload.automationPlan).toBeNull();
  });

  it("accepts null for wizardStepTarget", () => {
    const result = validateHandoff({ ...FULL_VALID_PAYLOAD, wizardStepTarget: null });
    expect(result.valid).toBe(true);
    expect(result.payload.wizardStepTarget).toBeNull();
  });

  it("never throws — even for non-object inputs", () => {
    for (const bad of [42, "string", true, [], () => {}]) {
      expect(() => validateHandoff(bad)).not.toThrow();
      const result = validateHandoff(bad);
      expect(result.valid).toBe(false);
    }
  });

  it("candidate_intents max 2 items — unknown keys are ignored, not copied to output", () => {
    const result = validateHandoff({
      ...FULL_VALID_PAYLOAD,
      candidate_intents: ["a", "b", "c"],  // unknown key
      unexpectedField: true,
    });
    expect("candidate_intents" in result.payload).toBe(false);
    expect("unexpectedField" in result.payload).toBe(false);
  });

  it("logs a warning in dev mode when validation fails", () => {
    validateHandoff(null);
    expect(console.warn).toHaveBeenCalled();
  });
});
