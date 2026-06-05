import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  planAssistantAction,
  CONFIDENCE_THRESHOLD,
  scoreIntent,
} from "./startWithAiAssistant.js";

// scoreIntent() is a pure function — spot-check the math
describe("scoreIntent", () => {
  it("returns 1.0 for exact_keyword with no missing fields", () => {
    expect(scoreIntent("exact_keyword")).toBe(1.0);
  });
  it("applies per-field penalty", () => {
    expect(scoreIntent("strong_keyword", ["f1", "f2"])).toBeCloseTo(0.65);
  });
  it("never returns below 0.1", () => {
    expect(scoreIntent("fallback", ["f1", "f2", "f3", "f4", "f5"])).toBe(0.1);
  });
  it("unknown matchType defaults to 0.3 base", () => {
    expect(scoreIntent("unknown_tier")).toBeCloseTo(0.3);
  });
});

describe("planAssistantAction – confidence scores", () => {
  it("high confidence: strong keyword match with no missing fields", () => {
    const plan = planAssistantAction({ input: "start an agreement for John Smith kitchen remodel" });
    expect(plan.intent).toBe("start_agreement");
    expect(plan.confidence_score).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    expect(plan.is_fallback).toBe(false);
  });

  it("low confidence: ambiguous input falls back to navigate_app", () => {
    const plan = planAssistantAction({ input: "I need some help with stuff" });
    expect(plan.intent).toBe("navigate_app");
    expect(plan.is_fallback).toBe(true);
    expect(plan.confidence_score).toBeLessThan(CONFIDENCE_THRESHOLD);
  });

  it("empty input → navigate_app with is_fallback: true", () => {
    const plan = planAssistantAction({ input: "" });
    expect(plan.intent).toBe("navigate_app");
    expect(plan.is_fallback).toBe(true);
    expect(plan.confidence_score).toBeLessThan(CONFIDENCE_THRESHOLD);
  });

  it("preferred intent override → above confidence threshold (missing fields apply penalty but stay >= threshold)", () => {
    const plan = planAssistantAction({ input: "", preferredIntent: "start_agreement" });
    expect(plan.intent).toBe("start_agreement");
    // exact_keyword base 1.0 minus up-to-0.2 field penalty still exceeds 0.7
    expect(plan.confidence_score).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    expect(plan.is_fallback).toBe(false);
  });
});

describe("planAssistantAction – commercial intents", () => {
  it('"assign an electrician" → subcontractor_assignment intent', () => {
    const plan = planAssistantAction({ input: "assign an electrician" });
    expect(plan.intent).toBe("subcontractor_assignment");
    expect(plan.is_fallback).toBe(false);
  });

  it('"get a cost estimate for roofing" → estimate_project intent', () => {
    const plan = planAssistantAction({ input: "get a cost estimate for roofing" });
    expect(plan.intent).toBe("estimate_project");
  });

  it('"check compliance for commercial build" → check_compliance intent', () => {
    const plan = planAssistantAction({ input: "check compliance for commercial build" });
    expect(plan.intent).toBe("check_compliance");
  });

  it('"create a maintenance contract" → maintenance_contract intent', () => {
    const plan = planAssistantAction({ input: "create a maintenance contract" });
    expect(plan.intent).toBe("maintenance_contract");
  });

  it('"set up a recurring service retainer" → maintenance_contract intent', () => {
    const plan = planAssistantAction({ input: "set up a recurring service retainer" });
    expect(plan.intent).toBe("maintenance_contract");
  });

  it("routes broad Step 2 milestone planning requests to milestone planning", () => {
    const plan = planAssistantAction({
      input:
        "Split this project into milestone phases with updated descriptions, realistic pricing and schedules.",
      context: {
        agreement_id: 39,
        current_route: "/app/agreements/39/wizard?step=2",
        agreement_summary: {
          project_summary: "Install flooring in kitchen and hallway.",
          milestone_count: 3,
        },
        milestone_summary: { count: 3 },
      },
    });

    expect(plan.intent).toBe("suggest_milestones");
    expect(plan.is_fallback).toBe(false);
    expect(plan.navigation_target).toBe("/app/agreements/39/wizard?step=2");
  });

  it("uses Warranty as the next wizard action from Step 2 instead of Finalize", () => {
    const plan = planAssistantAction({
      input: "open the next step",
      context: {
        agreement_id: 39,
        current_route: "/app/agreements/39/wizard?step=2",
        agreement_summary: {
          customer_name: "Jordan Demo",
          project_summary: "Install flooring in kitchen and hallway.",
          status: "draft",
          ready_to_finalize: false,
          milestone_count: 4,
        },
        milestone_summary: { count: 4 },
      },
    });

    expect(plan.intent).toBe("resume_agreement");
    expect(plan.wizard_step_target).toBe(3);
    expect(plan.next_action.label).toBe("Open Warranty Step");
    expect(plan.navigation_target).toBe("/app/agreements/39/wizard?step=3");
  });
});

describe("planAssistantAction – candidate_intents", () => {
  it("candidate_intents is empty when confidence >= CONFIDENCE_THRESHOLD", () => {
    const plan = planAssistantAction({ input: "start agreement for Jane roofing" });
    expect(plan.confidence_score).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    expect(plan.candidate_intents).toHaveLength(0);
  });

  it("candidate_intents has max 2 items", () => {
    // Deliberately ambiguous — trigger low confidence
    const plan = planAssistantAction({ input: "what about the cost and compliance" });
    expect(plan.candidate_intents.length).toBeLessThanOrEqual(2);
  });

  it("candidate_intents entries have required shape", () => {
    const plan = planAssistantAction({ input: "estimate and compliance" });
    for (const c of plan.candidate_intents) {
      expect(c).toHaveProperty("intent");
      expect(c).toHaveProperty("label");
      expect(c).toHaveProperty("destination");
      expect(c).toHaveProperty("confidence_score");
    }
  });

  it("candidate_intents never includes the primary intent", () => {
    const plan = planAssistantAction({ input: "how much would this cost" });
    for (const c of plan.candidate_intents) {
      expect(c.intent).not.toBe(plan.intent);
    }
  });
});
