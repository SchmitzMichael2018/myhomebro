import { describe, expect, it } from "vitest";

import { buildClarificationAwareMilestoneDraft } from "./milestoneDraftShaping.js";
import { assessMilestonePlanGuardrails } from "./milestonePlanGuardrails.js";

describe("small-job milestone shaping", () => {
  it("keeps a $225 towel-bar repair to one focused milestone", () => {
    const rows = buildClarificationAwareMilestoneDraft({
      projectType: "Handyman",
      projectSubtype: "General Repair",
      description: "Repair and reinstall the loose towel bar in the bathroom.",
      totalBudget: 225,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Towel Bar Repair and Installation");
    expect(rows[0].amount).toBe(225);
    expect(rows[0].description).toContain("Test fit, alignment, security, and operation");
    expect(rows[0].description.toLowerCase()).not.toContain("rough plumbing");
  });

  it("treats a one-milestone small repair as proportional and complete", () => {
    const rows = buildClarificationAwareMilestoneDraft({
      projectType: "Handyman",
      projectSubtype: "General Repair",
      description: "Adjust an interior door that does not close correctly.",
      totalBudget: 400,
    });
    const analysis = assessMilestonePlanGuardrails(rows, {
      currentTargetTotal: 400,
      projectFamilyKey: "handyman",
      projectTitle: "Interior Door Adjustment",
      projectScope: "Adjust an interior door that does not close correctly.",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Door Adjustment and Repair");
    expect(analysis.smallServiceContext).toBe(true);
    expect(analysis.recommendedMin).toBe(1);
    expect(analysis.recommendedMax).toBe(2);
    expect(analysis.needsConfirmation).toBe(false);
  });

  it("does not collapse an explicitly full remodel even when the budget is low", () => {
    const rows = buildClarificationAwareMilestoneDraft({
      projectType: "Remodel",
      projectSubtype: "Bathroom Remodel",
      description: "Full bathroom remodel with tile and fixture replacement.",
      totalBudget: 1200,
    });

    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.map((row) => row.title)).toContain("Protection & demolition");
  });
});
