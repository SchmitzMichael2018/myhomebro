import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAgreementSetupSource } from "./agreementSetupSource.js";

describe("Agreement Wizard Estimate template handoff", () => {
  const step1 = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/Step1Details.jsx"),
    "utf8"
  );

  it("presents an authoritative source Estimate template as carried forward", () => {
    expect(step1).toContain('data-testid="estimate-template-carried-forward"');
    expect(step1).toContain("Estimate Setup Carried Forward");
    expect(step1).toContain("hasAuthoritativeEstimateTemplate");
  });

  it("does not present a conflicting recommendation when Estimate provenance exists", () => {
    expect(step1).toContain("recommendedProjectSetup && allowAiSetupRecommendation");
    expect(step1).toContain("allowAiSetupRecommendation &&\n    startMode");
    expect(step1).toContain("disableRecommendations: !allowAiSetupRecommendation");
  });

  it("resolves exactly one primary setup source", () => {
    expect(resolveAgreementSetupSource({ sourceProposalId: 7, estimateTemplateId: 11, savedTemplateId: 12 })).toBe("estimate_provenance");
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
});
