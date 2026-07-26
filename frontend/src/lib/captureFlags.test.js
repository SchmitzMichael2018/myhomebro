import { describe, expect, it } from "vitest";

import { isCaptureReviewEnabled } from "./captureFlags.js";

describe("Capture review feature flag", () => {
  it("requires foundation, Inbox, and review flags", () => {
    expect(isCaptureReviewEnabled({ foundation: true, inbox: true, review: false })).toBe(false);
    expect(isCaptureReviewEnabled({ foundation: true, inbox: false, review: true })).toBe(false);
    expect(isCaptureReviewEnabled({ foundation: true, inbox: true, review: true })).toBe(true);
  });
});
