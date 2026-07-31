import { describe, expect, it } from "vitest";

import { normalizeRequiredOnboarding } from "./contractorOnboardingRoute.js";

describe("normalizeRequiredOnboarding", () => {
  it("honors the backend required completion flag", () => {
    expect(
      normalizeRequiredOnboarding({
        required_onboarding_complete: true,
        step: "stripe",
      }).requiredComplete
    ).toBe(true);
  });

  it("does not let legacy or local completion guesses override an explicit incomplete state", () => {
    expect(
      normalizeRequiredOnboarding({
        required_onboarding_complete: false,
        profile_basics_complete: true,
        business_name: "Saved Business",
        trade_count: 2,
        step: "region",
      }).requiredComplete
    ).toBe(false);
  });

  it("recovers a safe required step from a corrupt saved step", () => {
    expect(
      normalizeRequiredOnboarding({
        required_onboarding_complete: false,
        business_name: "Saved Business",
        trade_count: 1,
        service_region_label: "",
        step: "not-a-real-step",
      }).step
    ).toBe("region");
  });
});
