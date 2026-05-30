import { describe, it, expect } from "vitest";
import {
  AI_CONTEXT_DEFAULTS,
  buildAiContext,
  validateAiContext,
  serializeAiContext,
} from "./aiContext.js";

describe("buildAiContext", () => {
  it("merges overrides over defaults correctly", () => {
    const ctx = buildAiContext({ page: "agreement_wizard_step1", entityId: "abc123", projectPath: "commercial" });
    expect(ctx.page).toBe("agreement_wizard_step1");
    expect(ctx.entityId).toBe("abc123");
    expect(ctx.projectPath).toBe("commercial");
    expect(ctx.entityType).toBe(null); // default preserved
    expect(ctx.milestoneCount).toBe(0); // default preserved
  });

  it("never throws on empty input", () => {
    expect(() => buildAiContext()).not.toThrow();
    expect(() => buildAiContext({})).not.toThrow();
    expect(() => buildAiContext(null)).not.toThrow();
    expect(() => buildAiContext(undefined)).not.toThrow();
  });

  it("returns all default keys when called with no args", () => {
    const ctx = buildAiContext();
    for (const key of Object.keys(AI_CONTEXT_DEFAULTS)) {
      expect(key in ctx).toBe(true);
    }
  });

  it("preserves false and 0 overrides", () => {
    const ctx = buildAiContext({ templateApplied: false, milestoneCount: 0 });
    expect(ctx.templateApplied).toBe(false);
    expect(ctx.milestoneCount).toBe(0);
  });
});

describe("validateAiContext", () => {
  it("returns valid when all required fields are present", () => {
    const ctx = buildAiContext({ entityId: "x1", entityType: "agreement", projectType: "Roofing" });
    const result = validateAiContext(ctx, ["entityId", "entityType", "projectType"]);
    expect(result.valid).toBe(true);
    expect(result.missingFields).toHaveLength(0);
  });

  it("returns missing fields when fields are absent", () => {
    const ctx = buildAiContext({ entityId: "x1" });
    const result = validateAiContext(ctx, ["entityId", "entityType", "projectType"]);
    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain("entityType");
    expect(result.missingFields).toContain("projectType");
    expect(result.missingFields).not.toContain("entityId");
  });

  it("returns valid with empty required fields list", () => {
    const result = validateAiContext(buildAiContext(), []);
    expect(result.valid).toBe(true);
  });

  it("handles null/invalid context gracefully", () => {
    const result = validateAiContext(null, ["entityId"]);
    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain("entityId");
  });
});

describe("serializeAiContext", () => {
  it("strips null values", () => {
    const ctx = buildAiContext({ entityId: "abc", projectType: null, projectSubtype: null });
    const out = serializeAiContext(ctx);
    expect("projectType" in out).toBe(false);
    expect("projectSubtype" in out).toBe(false);
  });

  it("preserves non-null values including false and 0", () => {
    const ctx = buildAiContext({ templateApplied: false, milestoneCount: 0, entityId: "abc" });
    const out = serializeAiContext(ctx);
    expect(out.templateApplied).toBe(false);
    expect(out.milestoneCount).toBe(0);
    expect(out.entityId).toBe("abc");
  });

  it("returns empty object for null input", () => {
    expect(serializeAiContext(null)).toEqual({});
    expect(serializeAiContext(undefined)).toEqual({});
  });

  it("round-trip: build → serialize → original non-null fields match", () => {
    const input = {
      page: "templates",
      entityId: "t99",
      entityType: "template",
      projectType: "Flooring",
      milestoneCount: 3,
      templateApplied: true,
      contractorTradeProfile: ["flooring", "tile"],
    };
    const ctx = buildAiContext(input);
    const serialized = serializeAiContext(ctx);
    const reparsed = buildAiContext(serialized);
    for (const [key, value] of Object.entries(input)) {
      expect(reparsed[key]).toEqual(value);
    }
  });
});
