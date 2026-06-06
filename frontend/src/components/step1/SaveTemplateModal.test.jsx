import { describe, expect, test } from "vitest";
import { buildReusableScopeDraft } from "./SaveTemplateModal.jsx";

describe("buildReusableScopeDraft", () => {
  test("uses existing agreement scope and converts paragraph text into reusable bullets", () => {
    const draft = buildReusableScopeDraft({
      scopeDescription:
        "Install luxury vinyl plank flooring in kitchen and hallway. Complete trim and cleanup.",
      projectType: "Flooring",
      projectSubtype: "Luxury Vinyl Plank Installation",
      milestones: [],
    });

    expect(draft).toContain("Included Work:");
    expect(draft).toContain("- Install luxury vinyl plank flooring");
    expect(draft).toContain("- Complete trim and cleanup");
    expect(draft).toContain("Exclusions:");
  });

  test("derives reusable scope from milestone descriptions when agreement scope is blank", () => {
    const draft = buildReusableScopeDraft({
      scopeDescription: "",
      projectTitle: "Kitchen and Hallway LVP Installation",
      projectType: "Flooring",
      projectSubtype: "Luxury Vinyl Plank Installation",
      milestones: [
        {
          title: "Prep & leveling",
          description:
            "Remove existing transition strips at 10750 Main Street on June 12, 2026 and prepare 325 sq ft for flooring installation.",
        },
        {
          title: "Install flooring",
          description:
            "Install luxury vinyl plank flooring through the approved work areas with proper cuts, spacing, and transitions.",
        },
        {
          title: "Trim & cleanup",
          description: "Install finishing trim, clean the work area, and complete a final walkthrough.",
        },
      ],
    });

    expect(draft).toContain("Included Work:");
    expect(draft.indexOf("Prep & leveling")).toBeLessThan(draft.indexOf("Install flooring"));
    expect(draft.indexOf("Install flooring")).toBeLessThan(draft.indexOf("Trim & cleanup"));
    expect(draft.toLowerCase()).toContain("luxury vinyl plank installation");
    expect(draft).toContain("project-specific quantities");
    expect(draft).not.toContain("10750 Main Street");
    expect(draft).not.toContain("June 12, 2026");
    expect(draft).toContain("Exclusions:");
    expect(draft).toContain("Customer Responsibilities:");
  });
});
