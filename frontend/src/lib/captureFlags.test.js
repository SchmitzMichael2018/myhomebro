import { describe, expect, it } from "vitest";

import {
  isCaptureApplicationEnabled,
  isCaptureQrEnabled,
  isCaptureReviewEnabled,
  isCaptureFieldFindingsEnabled,
} from "./captureFlags.js";

describe("Capture review feature flag", () => {
  it("requires foundation, Inbox, and review flags", () => {
    expect(isCaptureReviewEnabled({ foundation: true, inbox: true, review: false })).toBe(false);
    expect(isCaptureReviewEnabled({ foundation: true, inbox: false, review: true })).toBe(false);
    expect(isCaptureReviewEnabled({ foundation: true, inbox: true, review: true })).toBe(true);
  });

  it("requires review and the independent field-findings flag", () => {
    expect(isCaptureFieldFindingsEnabled({
      foundation: true, inbox: true, review: true, fieldFindings: false,
    })).toBe(false);
    expect(isCaptureFieldFindingsEnabled({
      foundation: true, inbox: true, review: true, fieldFindings: true,
    })).toBe(true);
    expect(isCaptureFieldFindingsEnabled({
      foundation: true, inbox: false, review: true, fieldFindings: true,
    })).toBe(false);
  });

  it("requires the complete Capture flag chain for application", () => {
    expect(isCaptureApplicationEnabled({
      foundation: true, inbox: true, review: true, application: false,
    })).toBe(false);
    expect(isCaptureApplicationEnabled({
      foundation: true, inbox: true, review: true, application: true,
    })).toBe(true);
  });

  it("requires foundation, inbox, and QR flags for QR management", () => {
    expect(isCaptureQrEnabled({ foundation: true, inbox: true, qr: true })).toBe(true);
    expect(isCaptureQrEnabled({ foundation: true, inbox: false, qr: true })).toBe(false);
    expect(isCaptureQrEnabled({ foundation: true, inbox: true, qr: false })).toBe(false);
  });
});
