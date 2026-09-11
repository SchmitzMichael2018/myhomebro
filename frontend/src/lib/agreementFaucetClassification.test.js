import { describe, expect, it } from "vitest";

import {
  buildDeterministicStep1Setup,
  inferStep1ProjectClassificationConsistency,
} from "../components/Step1Details.jsx";
import { buildClarificationAwareMilestoneDraft } from "./milestoneDraftShaping.js";

const faucetRequest =
  "Replace the existing kitchen faucet with a standard single-handle faucet. Check the shutoff valves and supply lines for leaks, install the replacement, test hot and cold water, and clean the work area.";

describe("faucet agreement drafting", () => {
  it("overrides an unrelated explicit Garage Doors suggestion with scope evidence", () => {
    const result = inferStep1ProjectClassificationConsistency({
      sourceText: faucetRequest,
      scopeText: faucetRequest,
      suggestedProjectType: "Garage Doors",
      suggestedProjectSubtype: "Garage Door Replacement",
      suggestedProjectTitle: "Kitchen Faucet Replacement",
    });

    expect(result).toMatchObject({
      project_type: "Plumbing",
      project_subtype: "Fixture Installation",
      project_title: "Kitchen Faucet Replacement",
      confidence: "high",
    });
  });

  it("uses a plumbing fallback for faucet replacement", () => {
    expect(buildDeterministicStep1Setup(faucetRequest)).toMatchObject({
      project_type: "Plumbing",
      project_subtype: "Fixture Installation",
    });
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
