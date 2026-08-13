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
    expect(step1).toContain("hasAuthoritativeEstimateProvenance || !shouldAutoApply");
    expect(step1).toContain('data-testid="agreement-ai-accept-classification-button"');
    expect(step1).toContain("Your accepted Estimate classification has not changed");
    expect(step1).toContain("accepted_estimate_basis?.pricing_rows");
    expect(step1).toContain('hasAuthoritativeEstimateProvenance\n                      ? "Suggest Classification"');
  });

  it("removes broad Estimate setup and draft actions while retaining focused optional help", () => {
    expect(step1).not.toContain('data-testid="step1-rerun-ai-setup-button"');
    expect(step1).toContain("allowAiSetupRecommendation && aiSetupResult?.kind === \"template_match\"");
    expect(step1).toContain('hasAuthoritativeEstimateProvenance\n                      ? "Improve Scope"');
    expect(step1).toContain("!hasAuthoritativeEstimateProvenance ? (");
    expect(step1).toContain("Optional — use AI to refine the scope already carried over from the Estimate.");
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
