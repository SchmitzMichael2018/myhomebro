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
    expect(draft).toContain("- Install new flooring materials according to approved layout and manufacturer specifications.");
    expect(draft).toContain("- Perform final cleanup, quality review, and customer walkthrough.");
    expect(draft).toContain("Exclusions:");
    expect(draft).toContain("Customer Responsibilities:");
    expect(draft).toContain("Materials:");
    expect(draft).toContain("- Flooring materials.");
    expect(draft).toContain("Assumptions:");
  });

  test("derives and deduplicates reusable scope from milestone descriptions when agreement scope is blank", () => {
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
            "Prepare surfaces as needed. Install luxury vinyl plank flooring through the approved work areas with proper cuts, spacing, and transitions.",
        },
        {
          title: "Trim & cleanup",
          description: "Install finishing trim, clean the work area, and complete a final walkthrough.",
        },
      ],
    });

    expect(draft).toContain("Included Work:");
    expect(draft.indexOf("Prepare substrates")).toBeLessThan(draft.indexOf("Install new flooring materials"));
    expect(draft.indexOf("Install new flooring materials")).toBeLessThan(draft.indexOf("Install trim, transitions"));
    expect(draft.indexOf("Install trim, transitions")).toBeLessThan(draft.indexOf("Perform final cleanup"));
    expect((draft.match(/Prepare substrates/g) || []).length).toBe(1);
    expect(draft).not.toContain("Prep & leveling:");
    expect(draft).not.toContain("Install flooring:");
    expect(draft).not.toContain("10750 Main Street");
    expect(draft).not.toContain("June 12, 2026");
    expect(draft).not.toContain("325 sq ft");
    expect(draft).toContain("Exclusions:");
    expect(draft).toContain("Customer Responsibilities:");
    expect(draft).toContain("Materials:");
    expect(draft).toContain("- Underlayment or substrate preparation materials.");
    expect(draft).toContain("Assumptions:");
  });
});
