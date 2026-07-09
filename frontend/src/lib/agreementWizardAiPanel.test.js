import { describe, expect, it } from "vitest";
import { getAiPanelConfigForStep } from "./agreementWizardAiPanel.js";

describe("getAiPanelConfigForStep", () => {
  it("uses real Step 2 action keys for Project Assistant milestone planning controls", () => {
    const config = getAiPanelConfigForStep(2, {
      agreement: {
        id: 39,
        project_title: "Flooring Installation",
        project_type: "Flooring",
        project_subtype: "Luxury Vinyl Plank",
      },
      milestones: [
        { id: 1, title: "Prep", amount: "1000.00" },
        { id: 2, title: "Install", amount: "2500.00" },
        { id: 3, title: "Cleanup", amount: "500.00" },
        { id: 4, title: "Walkthrough", amount: "250.00" },
      ],
    });

    expect(config.submitActionKey).toBe("step2_copilot_request");
    expect(config.quickActions.map((action) => action.actionKey)).toEqual([
      "step2_improve_milestones",
      "step2_suggest_pricing",
      "step2_rebalance_pricing",
      "step2_apply_timeline",
    ]);
    expect(config.statusText).toBe("Milestone plan ready to refine");
  });
});
