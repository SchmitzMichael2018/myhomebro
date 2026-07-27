import { describe, expect, it } from "vitest";
import { imageCoordinateToSvg, pointerToImageCoordinate } from "./imageCoordinates.js";

describe("canonical image coordinates", () => {
  it("remains stable across responsive display sizes and DPR", () => {
    const element = { getBoundingClientRect: () => ({ left: 20, top: 10, width: 320, height: 240 }) };
    expect(pointerToImageCoordinate({ clientX: 180, clientY: 130 }, element)).toEqual({ x: .5, y: .5 });
    expect(imageCoordinateToSvg({ x: .5, y: .25 })).toEqual({ x: 500, y: 250 });
  });
  it("rejects malformed and out-of-bounds coordinates", () => {
    expect(() => imageCoordinateToSvg({ x: -1, y: 0 })).toThrow();
    expect(() => pointerToImageCoordinate({ clientX: 0, clientY: 0 }, { getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 100 }) })).toThrow();
  });
});
