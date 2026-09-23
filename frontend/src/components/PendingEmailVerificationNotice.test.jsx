import { describe, expect, it } from "vitest";

import {
  initialResendState,
  RESEND_SUCCESS_MESSAGE,
  resendStateReducer,
} from "../lib/verificationResendState.js";

describe("pending email verification resend states", () => {
  it("tracks loading, success, and cooldown completion", () => {
    const loading = resendStateReducer(initialResendState, { type: "start" });
    expect(loading).toMatchObject({ status: "loading", message: "" });

    const success = resendStateReducer(loading, {
      type: "success",
      cooldownSeconds: 2,
    });
    expect(success).toEqual({
      status: "success",
      message: RESEND_SUCCESS_MESSAGE,
      cooldownSeconds: 2,
    });

    expect(
      resendStateReducer(
        resendStateReducer(success, { type: "tick" }),
        { type: "tick" }
      ).cooldownSeconds
    ).toBe(0);
  });

  it("tracks a retryable failure without exposing account status", () => {
    expect(
      resendStateReducer(initialResendState, {
        type: "failure",
        message: "Please wait before trying again.",
        cooldownSeconds: 30,
      })
    ).toEqual({
      status: "failure",
      message: "Please wait before trying again.",
      cooldownSeconds: 30,
    });
  });
});
