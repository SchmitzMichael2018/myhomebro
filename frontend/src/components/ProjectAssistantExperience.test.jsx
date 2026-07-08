import { describe, expect, it } from "vitest";

import {
  normalizeAssistantConfidence,
  saferAssistantActionLabel,
} from "./ProjectAssistantExperience.jsx";

describe("Project Assistant experience helpers", () => {
  it("maps numeric confidence into standard labels", () => {
    expect(normalizeAssistantConfidence(0.85)).toBe("High confidence");
    expect(normalizeAssistantConfidence(0.65)).toBe("Medium confidence");
    expect(normalizeAssistantConfidence(0.25)).toBe("Low confidence");
  });

  it("maps text confidence into standard labels", () => {
    expect(normalizeAssistantConfidence("recommended")).toBe("Medium confidence");
    expect(normalizeAssistantConfidence("no strong match")).toBe("Low confidence");
    expect(normalizeAssistantConfidence("")).toBe("Needs more information");
  });

  it("uses review or prepare wording for high-impact assistant actions", () => {
    expect(saferAssistantActionLabel("Release payment")).toBe("Review payment release");
    expect(saferAssistantActionLabel("Resolve dispute")).toBe("Review resolution options");
    expect(saferAssistantActionLabel("Send message")).toBe("Prepare message");
    expect(saferAssistantActionLabel("Create Agreement")).toBe("Prepare agreement draft");
  });
});
