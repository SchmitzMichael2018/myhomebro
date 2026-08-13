import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildProjectAssistantActions, buildProjectAssistantSummary } from "./projectAssistantActions.js";

function step1Context(agreement = {}) {
  return {
    workspace_mode: "agreement_wizard",
    wizard_step: 1,
    agreement_summary: agreement,
  };
}

describe("Agreement Wizard Project Assistant actions", () => {
  const assistantSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/StartWithAIAssistant.jsx"),
    "utf8"
  );
  const dockSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/AssistantDock.jsx"),
    "utf8"
  );
  it("suggests classification only when type or subtype is missing", () => {
    const missing = buildProjectAssistantActions(step1Context({ description: "Replace bathroom tile." }));
    expect(missing.recommended.map((row) => row.label)).toContain("Suggest Classification");

    const complete = buildProjectAssistantActions(step1Context({
      project_type: "Bathroom Remodel",
      project_subtype: "Full Remodel",
      description: "Replace bathroom tile.",
    }));
    expect(complete.recommended.map((row) => row.label)).not.toContain("Suggest Classification");
  });

  it("offers exactly one scope action based on usable scope", () => {
    const existing = buildProjectAssistantActions(step1Context({ description: "Replace bathroom tile." }));
    expect(existing.recommended.map((row) => row.label)).toContain("Improve Scope");
    expect(existing.recommended.map((row) => row.label)).not.toContain("Generate Scope Draft");

    const empty = buildProjectAssistantActions(step1Context({ description: "" }));
    expect(empty.recommended.map((row) => row.label)).toContain("Generate Scope Draft");
    expect(empty.recommended.map((row) => row.label)).not.toContain("Improve Scope");
  });

  it("exposes Continue to Milestones only when Step 1 is ready", () => {
    const ready = buildProjectAssistantActions(step1Context({
      project_type: "Bathroom Remodel",
      project_subtype: "Full Remodel",
      description: "Replace bathroom tile.",
      step1_ready: true,
    }));
    expect(ready.recommended.map((row) => row.label)).toContain("Continue to Milestones");

    const summary = buildProjectAssistantSummary(step1Context({ project_type: "Bathroom Remodel" }));
    expect(summary.projectType).toBe("Bathroom Remodel");
    expect(summary.projectSubtype).toBe("");
    expect(summary.step1Ready).toBe(false);
  });

  it("filters global recommendations inside the Agreement Wizard", () => {
    expect(assistantSource).toContain("if (isAgreementWizardAssistant) return [];");
    expect(assistantSource).toContain("if (isAgreementWizardAssistant) {");
    expect(assistantSource).not.toMatch(/Build review confidence[\s\S]*isAgreementWizardAssistant/);
  });

  it("uses the contextual Agreement Assistant on mobile instead of opening another assistant", () => {
    expect(dockSource).toContain("isAgreementWizard ? <>");
    expect(dockSource).toContain("mobile:agreement-wizard:");
    expect(dockSource).toContain("<StartWithAIAssistant");
  });
});
