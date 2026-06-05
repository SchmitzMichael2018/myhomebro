import { describe, expect, it } from "vitest";
import {
  buildProjectAssistantActions,
  buildProjectAssistantSummary,
  matchProjectAssistantPromptToAction,
} from "./projectAssistantActions.js";

function step2Context(overrides = {}) {
  return {
    workspace_mode: "agreement_wizard",
    wizard_step: 2,
    current_route: "/app/agreements/39/wizard?step=2",
    agreement_summary: {
      project_title: "Kitchen Flooring Installation",
      project_type: "Flooring",
      project_subtype: "Luxury Vinyl Plank",
      pricing_total: 0,
      milestone_count: 3,
    },
    milestone_summary: {
      count: 3,
      total: 0,
    },
    ...overrides,
  };
}

describe("project assistant action registry", () => {
  it("summarizes the current wizard project context", () => {
    const summary = buildProjectAssistantSummary(
      step2Context({
        template_summary: { name: "Flooring Installation" },
        milestone_summary: { count: 4, total: 12500 },
      })
    );

    expect(summary.title).toBe("Kitchen Flooring Installation");
    expect(summary.step).toBe(2);
    expect(summary.milestoneCount).toBe(4);
    expect(summary.total).toBe(12500);
    expect(summary.templateStatus).toBe("Template: Flooring Installation");
  });

  it("shows real milestone workflow actions when milestones exist", () => {
    const actions = buildProjectAssistantActions(step2Context({ milestone_summary: { count: 4, total: 9000 } }));
    const keys = actions.recommended.map((action) => action.key);

    expect(keys).toContain("step2_improve_descriptions");
    expect(keys).toContain("step2_regenerate_plan");
    expect(keys).toContain("step2_replace_plan");
    expect(keys).toContain("step2_rebalance_pricing");
  });

  it("asks for a project total instead of showing rebalance when total is zero", () => {
    const actions = buildProjectAssistantActions(step2Context());
    const keys = actions.recommended.map((action) => action.key);

    expect(keys).toContain("step2_enter_project_total");
    expect(keys).not.toContain("step2_rebalance_pricing");
  });

  it("shows update source template only when the template can be updated", () => {
    const actions = buildProjectAssistantActions(
      step2Context({
        template_id: 12,
        template_summary: {
          name: "Flooring Installation",
          can_update_source: true,
        },
      })
    );

    expect(actions.additional.map((action) => action.key)).toContain("step2_update_source_template");
  });

  it("routes broad milestone planning chat to a real Step 2 milestone action", () => {
    const action = matchProjectAssistantPromptToAction(
      "Split this project into milestone phases with updated descriptions, realistic pricing and schedules",
      step2Context({ milestone_summary: { count: 4, total: 10000 } })
    );

    expect(action.key).toBe("step2_improve_descriptions");
  });

  it("routes next-step chat from Step 2 to the warranty step", () => {
    const action = matchProjectAssistantPromptToAction("Open the next step", step2Context());

    expect(action.actionKey).toBe("open_wizard_step");
    expect(action.label).toBe("Open Warranty Step");
    expect(action.targetStep).toBe(3);
  });
});
