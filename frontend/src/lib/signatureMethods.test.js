import { describe, expect, it } from "vitest";

import { hasSignatureForMethod, SIGNATURE_METHODS } from "./signatureMethods.js";

describe("signature methods", () => {
  it("accepts a full typed legal name", () => {
    expect(hasSignatureForMethod(SIGNATURE_METHODS.TYPE, { typedName: "Jane Contractor" })).toBe(true);
    expect(hasSignatureForMethod(SIGNATURE_METHODS.TYPE, { typedName: "J" })).toBe(false);
  });

  it("requires strokes for draw and a file for upload", () => {
    expect(hasSignatureForMethod(SIGNATURE_METHODS.DRAW, { hasDrawn: false })).toBe(false);
    expect(hasSignatureForMethod(SIGNATURE_METHODS.DRAW, { hasDrawn: true })).toBe(true);
    expect(hasSignatureForMethod(SIGNATURE_METHODS.UPLOAD, { sigFile: null })).toBe(false);
    expect(hasSignatureForMethod(SIGNATURE_METHODS.UPLOAD, { sigFile: { name: "signature.png" } })).toBe(true);
  });
});
