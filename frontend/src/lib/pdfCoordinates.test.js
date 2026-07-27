import { describe, expect, it } from "vitest";
import { canonicalToDisplay, displayToCanonical, pointerToCanonical } from "./pdfCoordinates.js";

describe("PDF canonical coordinates", () => {
  for (const rotation of [0, 90, 180, 270]) {
    it(`round trips ${rotation} degree rotation`, () => {
      const canonical = displayToCanonical(canonicalToDisplay({ x: 0.2, y: 0.7 }, rotation), rotation);
      expect(canonical.x).toBeCloseTo(0.2);
      expect(canonical.y).toBeCloseTo(0.7);
    });
  }

  it("is stable across CSS size and device pixel ratio", () => {
    const event = { clientX: 150, clientY: 100 };
    const element = { getBoundingClientRect: () => ({ left: 50, top: 50, width: 400, height: 200 }) };
    expect(pointerToCanonical(event, element)).toEqual({ x: 0.25, y: 0.25 });
  });

  it("rejects out-of-bounds and malformed coordinates", () => {
    expect(() => displayToCanonical({ x: -0.1, y: 0.5 })).toThrow();
    expect(() => displayToCanonical({ x: Number.NaN, y: 0.5 })).toThrow();
  });
});
