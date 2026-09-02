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
  const wizardSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/AgreementWizard.jsx"),
    "utf8"
  );
  const step1Source = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/Step1Details.jsx"),
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

  it("describes the Step 2 bulk improvement as a reviewable milestone plan", () => {
    const actions = buildProjectAssistantActions({
      workspace_mode: "agreement_wizard",
      wizard_step: 2,
      agreement_summary: {
        milestone_count: 2,
        total: 1000,
      },
    });
    const improvement = actions.recommended.find(
      (row) => row.key === "step2_improve_descriptions"
    );

    expect(improvement?.label).toBe("Improve Milestone Plan");
    expect(improvement?.description).toBe(
      "Review suggested milestone titles, completion criteria, and timing based on the current scope. Nothing changes until you apply the plan."
    );
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

  it("shows synchronized classification request feedback and prevents repeat clicks", () => {
    expect(assistantSource).toContain("project-assistant-classification-status");
    expect(assistantSource).toContain('classificationAssistance.status === "pending"');
    expect(assistantSource).toContain("disabled={disabled}");
  });

  it("uses the shared assistant action-state pattern for advisory scope improvement", () => {
    expect(wizardSource).toContain('actionKey === "step1_improve_scope"');
    expect(wizardSource).toContain('"Improving scope..."');
    expect(assistantSource).toContain("project-assistant-scope-status");
    expect(assistantSource).toContain('scopeAssistance.status === "pending"');
    expect(step1Source).toContain('runAiDescription("improve")');
    expect(step1Source).toContain("Improved scope ready. Review the suggested Scope of Work in Project Details.");
    expect(step1Source).toContain('acceptLabel="Apply Improved Scope"');
    expect(step1Source).toContain('rejectLabel="Keep Current Scope"');
  });
});
