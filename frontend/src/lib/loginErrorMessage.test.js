import { describe, expect, it } from "vitest";

import { getLoginErrorMessage } from "./loginErrorMessage.js";

describe("getLoginErrorMessage", () => {
  it("replaces the JWT credential error with customer-friendly copy", () => {
    expect(
      getLoginErrorMessage({
        response: {
          status: 401,
          data: { detail: "No active account found with the given credentials" },
        },
      })
    ).toBe("Email or password is incorrect. Please try again.");
  });

  it("preserves actionable non-credential messages", () => {
    expect(
      getLoginErrorMessage({
        response: {
          status: 403,
          data: { detail: "Email not verified. Please verify your account." },
        },
      })
    ).toBe("Email not verified. Please verify your account.");
  });
});
