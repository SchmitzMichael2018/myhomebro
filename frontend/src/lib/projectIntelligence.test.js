import { describe, expect, it } from "vitest";

import { inferProjectIntelligence } from "./projectIntelligence.js";

describe("inferProjectIntelligence", () => {
  it("keeps authoritative LVP classification ahead of incidental scope language", () => {
    const result = inferProjectIntelligence({
      projectTitle: "DIY Assistance — Water-Resistant LVP Flooring",
      projectType: "Flooring",
      projectSubtype: "LVP / Vinyl Plank",
      description: "Install flooring underlayment, transitions, and water-resistant luxury vinyl plank.",
      projectFamilyKey: "outdoor",
      projectFamilyLabel: "Outdoor",
    });

    expect(result.key).toBe("flooring");
    expect(result.responseStarter).toContain("flooring details");
    expect(result.prepItems.join(" ")).not.toContain("structure");
  });

  it("still recognizes explicitly described roof underlayment", () => {
    const result = inferProjectIntelligence({
      projectTitle: "Roof repair",
      description: "Replace damaged roof underlayment and shingles.",
    });

    expect(result.key).toBe("roofing");
  });
});
