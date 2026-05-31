import { describe, it, expect } from "vitest";
import { getMilestonePattern, MILESTONE_PATTERNS } from "./milestoneTemplates.js";

const REQUIRED_FIELDS = ["title", "description", "start_offset_days", "duration_days", "materials_hint"];

describe("getMilestonePattern", () => {
  it("returns 4 roofing milestones for residential roofing", () => {
    const pattern = getMilestonePattern("roofing", "residential");
    expect(Array.isArray(pattern)).toBe(true);
    expect(pattern.length).toBe(4);
  });

  it("each roofing milestone has all required fields with non-empty values", () => {
    const pattern = getMilestonePattern("roofing", "residential");
    for (const m of pattern) {
      for (const field of REQUIRED_FIELDS) {
        expect(m, `missing field "${field}" in milestone "${m.title}"`).toHaveProperty(field);
        // start_offset_days can legitimately be 0; other string fields must be non-empty
        if (field === "start_offset_days" || field === "duration_days") {
          expect(typeof m[field] === "number", `field "${field}" must be a number in "${m.title}"`).toBe(true);
        } else {
          expect(m[field], `field "${field}" is empty in milestone "${m.title}"`).toBeTruthy();
        }
      }
    }
  });

  it("returns 4 flooring milestones for residential flooring", () => {
    const pattern = getMilestonePattern("flooring", "residential");
    expect(pattern.length).toBe(4);
  });

  it("returns 4 hvac milestones", () => {
    const pattern = getMilestonePattern("hvac", "residential");
    expect(pattern.length).toBe(4);
  });

  it("returns 4 remodel milestones", () => {
    const pattern = getMilestonePattern("remodel", "residential");
    expect(pattern.length).toBe(4);
  });

  it("returns 4 electrical milestones", () => {
    const pattern = getMilestonePattern("electrical", "residential");
    expect(pattern.length).toBe(4);
  });

  it("returns 4 plumbing milestones", () => {
    const pattern = getMilestonePattern("plumbing", "residential");
    expect(pattern.length).toBe(4);
  });

  it("returns 4 painting milestones", () => {
    const pattern = getMilestonePattern("painting", "residential");
    expect(pattern.length).toBe(4);
  });

  it("returns milestones with drawSchedule and holdPoint for commercial_gc", () => {
    const pattern = getMilestonePattern("commercial_gc", "commercial");
    expect(pattern.length).toBeGreaterThanOrEqual(4);
    for (const m of pattern) {
      expect(typeof m.drawSchedule).toBe("boolean");
      expect("holdPoint" in m).toBe(true);
    }
  });

  it("commercial path returns commercial_gc variant when type is commercial_gc", () => {
    const commercial = getMilestonePattern("commercial_gc", "commercial");
    const residential = getMilestonePattern("roofing", "residential");
    // commercial milestones have drawSchedule; residential don't
    expect(commercial.some((m) => m.drawSchedule === true)).toBe(true);
    expect(residential.every((m) => !("drawSchedule" in m))).toBe(true);
  });

  it("returns general fallback for unknown type", () => {
    const pattern = getMilestonePattern("unknown_trade_xyz", "residential");
    expect(Array.isArray(pattern)).toBe(true);
    expect(pattern.length).toBeGreaterThan(0);
  });

  it("returns general fallback for null/undefined input", () => {
    expect(() => getMilestonePattern(null, null)).not.toThrow();
    expect(() => getMilestonePattern(undefined, undefined)).not.toThrow();
    const pattern = getMilestonePattern(null, null);
    expect(Array.isArray(pattern)).toBe(true);
    expect(pattern.length).toBeGreaterThan(0);
  });

  it("all patterns have required fields in every milestone", () => {
    const allKeys = Object.keys(MILESTONE_PATTERNS);
    for (const key of allKeys) {
      const pattern = MILESTONE_PATTERNS[key];
      for (const m of pattern) {
        for (const field of REQUIRED_FIELDS) {
          expect(m, `${key}: missing field "${field}" in milestone "${m.title}"`).toHaveProperty(field);
          if (field === "start_offset_days" || field === "duration_days") {
            expect(typeof m[field] === "number", `${key}: field "${field}" must be a number in "${m.title}"`).toBe(true);
          } else {
            expect(m[field], `${key}: field "${field}" is empty in milestone "${m.title}"`).toBeTruthy();
          }
        }
      }
    }
  });

  it("landscaping returns milestones", () => {
    const pattern = getMilestonePattern("landscaping", "residential");
    expect(pattern.length).toBeGreaterThan(0);
  });

  it("maintenance returns milestones", () => {
    const pattern = getMilestonePattern("maintenance", "residential");
    expect(pattern.length).toBeGreaterThan(0);
  });
});
