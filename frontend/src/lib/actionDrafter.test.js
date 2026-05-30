import { describe, it, expect } from "vitest";
import {
  draftMilestoneUpdate,
  draftSignatureFollowUp,
  draftCheckIn,
  draftAmendmentReason,
} from "./actionDrafter.js";

describe("draftMilestoneUpdate", () => {
  it("returns { subject, body, tone }", () => {
    const result = draftMilestoneUpdate({ milestoneTitle: "Tear-off", agreementTitle: "Roof Job", customerName: "Jane" });
    expect(result).toHaveProperty("subject");
    expect(result).toHaveProperty("body");
    expect(result).toHaveProperty("tone");
    expect(result.tone).toBe("professional");
  });

  it("includes customer name in body when provided", () => {
    const result = draftMilestoneUpdate({ customerName: "Bob Smith" });
    expect(result.body).toContain("Bob Smith");
  });

  it("includes milestone title in subject and body", () => {
    const result = draftMilestoneUpdate({ milestoneTitle: "Roofing Installation" });
    expect(result.subject).toContain("Roofing Installation");
    expect(result.body).toContain("Roofing Installation");
  });

  it("handles missing optional fields gracefully", () => {
    const result = draftMilestoneUpdate();
    expect(result.subject).toBeTruthy();
    expect(result.body).toBeTruthy();
    expect(result.tone).toBe("professional");
  });
});

describe("draftSignatureFollowUp", () => {
  it("returns { subject, body, tone }", () => {
    const result = draftSignatureFollowUp({ agreementTitle: "Deck Build", customerName: "Alice", daysSinceSent: 4 });
    expect(result).toHaveProperty("subject");
    expect(result).toHaveProperty("body");
    expect(result.tone).toBe("professional");
  });

  it("includes customer name when provided", () => {
    const result = draftSignatureFollowUp({ customerName: "Carlos" });
    expect(result.body).toContain("Carlos");
  });

  it("handles missing optional fields gracefully", () => {
    const result = draftSignatureFollowUp();
    expect(result.subject).toBeTruthy();
    expect(result.body).toBeTruthy();
  });
});

describe("draftCheckIn", () => {
  it("returns { subject, body, tone }", () => {
    const result = draftCheckIn({ agreementTitle: "HVAC Replace", customerName: "Maria", daysSinceActivity: 7 });
    expect(result).toHaveProperty("subject");
    expect(result).toHaveProperty("body");
    expect(result.tone).toBe("professional");
  });

  it("includes customer name when provided", () => {
    const result = draftCheckIn({ customerName: "David" });
    expect(result.body).toContain("David");
  });

  it("handles missing optional fields gracefully", () => {
    const result = draftCheckIn();
    expect(result.subject).toBeTruthy();
    expect(result.body).toBeTruthy();
  });
});

describe("draftAmendmentReason", () => {
  it("returns { subject, body, tone }", () => {
    const result = draftAmendmentReason({
      originalScope: "Install asphalt shingle roof",
      changedItems: ["Added ice barrier", "Replaced 4 damaged decking sections"],
      pricingDelta: 850,
    });
    expect(result).toHaveProperty("subject");
    expect(result).toHaveProperty("body");
    expect(result.tone).toBe("professional");
  });

  it("includes changed items in body", () => {
    const result = draftAmendmentReason({ changedItems: ["Extra insulation", "Upgraded flashing"] });
    expect(result.body).toContain("Extra insulation");
    expect(result.body).toContain("Upgraded flashing");
  });

  it("handles missing optional fields gracefully", () => {
    const result = draftAmendmentReason();
    expect(result.subject).toBeTruthy();
    expect(result.body).toBeTruthy();
  });
});
