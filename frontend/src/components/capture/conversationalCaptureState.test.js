import { describe, expect, it } from "vitest";

import {
  CONVERSATIONAL_CAPTURE_STATES as STATES,
  canTransitionConversationalCapture,
} from "./conversationalCaptureState.js";

describe("conversational Capture state machine", () => {
  it("allows bounded routing and explicit confirmation transitions", () => {
    expect(canTransitionConversationalCapture(STATES.COMPOSING, STATES.ROUTING)).toBe(true);
    expect(canTransitionConversationalCapture(STATES.ROUTING, STATES.NEEDS_INFORMATION)).toBe(true);
    expect(canTransitionConversationalCapture(STATES.SUGGESTION, STATES.CONFIRMING)).toBe(true);
    expect(canTransitionConversationalCapture(STATES.CONFIRMING, STATES.CREATING)).toBe(true);
  });

  it("prevents mutation and handoff from bypassing confirmation", () => {
    expect(canTransitionConversationalCapture(STATES.COMPOSING, STATES.CREATING)).toBe(false);
    expect(canTransitionConversationalCapture(STATES.ROUTING, STATES.HANDING_OFF)).toBe(false);
    expect(canTransitionConversationalCapture(STATES.NEEDS_INFORMATION, STATES.CREATING)).toBe(false);
  });

  it("keeps failures and unsupported intents recoverable", () => {
    expect(canTransitionConversationalCapture(STATES.FAILED, STATES.COMPOSING)).toBe(true);
    expect(canTransitionConversationalCapture(STATES.UNSUPPORTED, STATES.COMPOSING)).toBe(true);
  });
});

