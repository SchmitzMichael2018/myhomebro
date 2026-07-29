import { describe, expect, it } from "vitest";

import { getGuidedExperienceRole } from "./GuidedExperience.jsx";
import {
  deriveGuidedProgress,
  getRecommendedStep,
  getRolePath,
  getWorkspaceGroups,
} from "./guidedExperienceModel.js";

describe("guided experience role and progress model", () => {
  it.each([
    [{ type: "contractor", role: "contractor_owner" }, "contractor"],
    [{ type: "subaccount", role: "employee" }, "employee"],
    [{ type: "subcontractor" }, "subcontractor"],
    [{ account_type: "customer", role: "homeowner" }, "customer"],
    [{ type: "property_manager" }, "property_manager"],
    [{ type: "tenant" }, "tenant"],
    [{ type: "staff", role: "reviewer" }, "admin"],
  ])("selects the repository role path for %o", (identity, expected) => {
    expect(getGuidedExperienceRole(identity)).toBe(expected);
  });

  it("derives explicit walkthrough progress without claiming workspace completion", () => {
    const progress = deriveGuidedProgress("contractor", { status: "active", stepIndex: 3 });
    expect(progress.completedCount).toBe(3);
    expect(progress.total).toBe(10);
    expect(progress.percentage).toBe(30);
    expect(progress.currentStep.id).toBe("estimate");
  });

  it("recommends the saved current step and no step after completion", () => {
    expect(getRecommendedStep("employee", { status: "paused", stepIndex: 2 })?.id).toBe("agreements");
    expect(getRecommendedStep("employee", { status: "completed", stepIndex: 6 })).toBeNull();
  });

  it("filters workspace groups and routes to the selected role", () => {
    const tenantGroups = getWorkspaceGroups("tenant");
    const tenantSteps = tenantGroups.flatMap((group) => group.steps);
    expect(tenantSteps.length).toBe(getRolePath("tenant").steps.length);
    expect(tenantSteps.every((item) => ["/maintenance-request", "/portal"].includes(item.route))).toBe(true);
    expect(tenantSteps.some((item) => item.id === "business")).toBe(false);
  });
});
