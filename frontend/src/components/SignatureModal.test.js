import { describe, expect, it } from "vitest";

import { signatureReviewMessage } from "./SignatureModal";

describe("SignatureModal review state", () => {
  it("confirms when the agreement has already been reviewed", () => {
    expect(signatureReviewMessage(true)).toBe(
      "Agreement reviewed. Complete your signature and consent below."
    );
  });

  it("prompts for review only before the agreement is reviewed", () => {
    expect(signatureReviewMessage(false)).toBe(
      "You must review the agreement before signing."
    );
  });
});
