import { describe, expect, it } from "vitest";

import { draftIdentity, PWA_DRAFT_LIMITS, validateDraftInput } from "./pwaDrafts.js";

describe("PWA draft safety boundary", () => {
  it("requires both the authenticated user and contractor identity", () => {
    expect(draftIdentity({ id: 7, type: "contractor" })).toEqual({
      userId: "7",
      contractorId: "7",
    });
    expect(draftIdentity({ id: 7 })).toBeNull();
  });

  it("rejects oversized text and unbound drafts", () => {
    expect(() => validateDraftInput({ sourceText: "draft" })).toThrow("draft_identity_required");
    expect(() => validateDraftInput({
      identity: { userId: "1", contractorId: "2" },
      sourceText: "x".repeat(PWA_DRAFT_LIMITS.maxTextLength + 1),
    })).toThrow("draft_text_too_large");
  });

  it("accepts bounded local-only draft values", () => {
    expect(validateDraftInput({
      identity: { userId: "1", contractorId: "2" },
      sourceText: "Measured the west wall",
      values: { unit: "ft" },
    })).toEqual({
      sourceText: "Measured the west wall",
      values: { unit: "ft" },
    });
  });
});

