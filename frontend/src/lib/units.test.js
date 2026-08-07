import { describe, expect, it } from "vitest";
import { customUnitError, normalizeCustomUnit, recognizeUnit, unitDisplay } from "./units.js";

describe("proposal units", () => {
  it.each([["sq ft", "sf"], ["sqft", "sf"], ["SF", "sf"], ["square feet", "sf"], ["linear ft", "lf"], ["LF", "lf"], ["each", "ea"], ["hours", "hr"]])("recognizes %s", (raw, code) => expect(recognizeUnit(raw)).toBe(code));
  it("preserves unknown units for presentation", () => expect(unitDisplay("crew shift")).toBe("crew shift"));
  it("normalizes and validates custom units", () => {
    expect(normalizeCustomUnit("  crew   shift ")).toBe("crew shift");
    expect(customUnitError("https://example.com")).toMatch(/URL/);
    expect(customUnitError("<b>bag</b>")).toMatch(/markup/);
    expect(customUnitError(" ")).toMatch(/custom unit/);
  });
});
