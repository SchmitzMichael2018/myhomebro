import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAgreementSetupSource } from "./agreementSetupSource.js";

describe("Agreement Wizard Estimate template handoff", () => {
  const step1 = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/Step1Details.jsx"),
    "utf8"
  );
  const wizard = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/AgreementWizard.jsx"),
    "utf8"
  );
  const estimateWorkspace = fs.readFileSync(
    path.resolve(process.cwd(), "src/pages/ProposalWorkspacePage.jsx"),
    "utf8"
  );

  it("keeps the accepted Estimate summary as the single handoff overview", () => {
    expect(wizard).toContain('data-testid="agreement-proposal-prefill-summary"');
    expect(wizard).toContain("Based on accepted Estimate");
    expect(step1).not.toContain('data-testid="estimate-prefill-applied"');
    expect(step1).not.toContain('data-testid="estimate-template-carried-forward"');
  });

  it("does not present a conflicting recommendation when Estimate provenance exists", () => {
    expect(step1).toContain("recommendedProjectSetup && allowAiSetupRecommendation");
    expect(step1).toContain("allowAiSetupRecommendation &&\n    startMode");
    expect(step1).toContain("disableRecommendations: !allowAiSetupRecommendation");
  });

  it("resolves exactly one primary setup source", () => {
    expect(resolveAgreementSetupSource({ sourceProposalId: 7, estimateTemplateId: 11, savedTemplateId: 12 })).toBe("estimate_provenance");
    expect(resolveAgreementSetupSource({ sourceProposalId: 7, estimateTemplateId: null, savedTemplateId: null })).toBe("estimate_provenance");
    expect(resolveAgreementSetupSource({ sourceProposalId: null, estimateTemplateId: null, savedTemplateId: 12 })).toBe("saved_agreement_setup");
    expect(resolveAgreementSetupSource({ sourceProposalId: null, estimateTemplateId: null, savedTemplateId: null })).toBe("ai_recommendation");
  });

  it("keeps Estimate provenance above a conflicting saved or AI setup after reload", () => {
    const firstLoad = resolveAgreementSetupSource({ sourceProposalId: 7, estimateTemplateId: 11, savedTemplateId: 11 });
    const reloaded = resolveAgreementSetupSource({ sourceProposalId: 7, estimateTemplateId: 11, savedTemplateId: 99 });
    expect(firstLoad).toBe("estimate_provenance");
    expect(reloaded).toBe("estimate_provenance");
  });

  it("recognizes persisted Agreement provenance without transient new-route handoff state", () => {
    expect(step1).toContain("Boolean(agreement?.source_proposal_id || agreement?.accepted_estimate_basis?.proposal_id)");
  });

  it("keeps AI classification advisory until an explicit replacement action", () => {
    expect(step1).toContain("Classification is always advisory");
    expect(step1).toContain('data-testid="agreement-ai-accept-classification-button"');
    expect(step1).toContain("Nothing changes until you apply this suggestion.");
    expect(step1).toContain("accepted_estimate_basis?.pricing_rows");
  });

  it("presents exact classification field changes without alternate-trade chips", () => {
    expect(step1).toContain('data-testid="agreement-classification-type-comparison"');
    expect(step1).toContain('data-testid="agreement-classification-subtype-comparison"');
    expect(step1).toContain("Current:");
    expect(step1).toContain("Suggested:");
    expect(step1).toContain("Apply Suggestion");
    expect(step1).toContain("Keep Current Classification");
    expect(step1).toContain("No matching subtype — select manually");
    expect(step1).not.toContain("classificationResult.alternatives.map");
    expect(step1).not.toContain("Recommended custom subtype:");
    expect(step1).not.toContain("Replace with suggested classification");
  });

  it("removes inline AI actions so Project Assistant is the single entry point", () => {
    expect(step1).not.toContain('data-testid="step1-rerun-ai-setup-button"');
    expect(step1).not.toContain('data-testid="agreement-ai-improve-classification-button"');
    expect(step1).not.toContain('data-testid="agreement-ai-improve-scope-button"');
    expect(step1).not.toContain('data-testid="agreement-ai-generate-scope-button"');
    expect(wizard).toContain('data-testid="agreement-step1-assistant-banner"');
    expect(wizard).toContain('data-testid="agreement-step1-open-assistant"');
    expect(wizard).toContain("Need help with this agreement?");
  });

  it("keeps readiness manual and independent of AI usage", () => {
    const saveValidation = step1.slice(
      step1.indexOf("function validateStep1ForSave()"),
      step1.indexOf("function validateStep1ForAi")
    );
    expect(saveValidation).toContain('errors.project_type = "Project type is required."');
    expect(saveValidation).toContain('hasAuthoritativeEstimateProvenance && !safeTrim(dLocal?.project_subtype)');
    expect(saveValidation).not.toMatch(/classificationResult|aiSetupResult|aiBusy|aiPreview/);
  });

  it("labels Estimate scheduling context clearly and prefers persisted contractual scope", () => {
    expect(estimateWorkspace).toContain('sectionBlock("Requested Timing", proposalScheduleSummary(proposal))');
    expect(estimateWorkspace).not.toContain('sectionBlock("Scheduling Expectations"');
    expect(wizard.indexOf("agreement?.scope_of_work")).toBeLessThan(wizard.indexOf("draft.description"));
  });
});
