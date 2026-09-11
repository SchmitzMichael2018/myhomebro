import { describe, expect, it } from "vitest";

import { classifyLimitedFixtureScope } from "./agreementDraftClassification.js";
import { buildClarificationAwareMilestoneDraft } from "./milestoneDraftShaping.js";

const faucetRequest =
  "Replace the existing kitchen faucet with a standard single-handle faucet. Check the shutoff valves and supply lines for leaks, install the replacement, test hot and cold water, and clean the work area.";

describe("faucet agreement drafting", () => {
  it("classifies a faucet request from its scope evidence", () => {
    const result = classifyLimitedFixtureScope(faucetRequest);

    expect(result).toMatchObject({
      project_type: "Plumbing",
      project_subtype: "Fixture Installation",
      project_title: "Kitchen Faucet Replacement",
      confidence: "high",
    });
  });

  it("does not classify an unrelated project as a plumbing fixture", () => {
    expect(classifyLimitedFixtureScope("Replace a damaged garage door")).toBeNull();
  });

  it("builds faucet milestones instead of a kitchen remodel plan", () => {
    const rows = buildClarificationAwareMilestoneDraft({
      projectType: "Plumbing",
      projectSubtype: "Fixture Installation",
      description: faucetRequest,
      totalBudget: 425,
    });

    expect(rows.map((row) => row.title)).toEqual([
      "Inspection & Removal",
      "Faucet Installation",
      "Leak Test, Cleanup & Walkthrough",
    ]);
    expect(rows.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(425);
  });
});
