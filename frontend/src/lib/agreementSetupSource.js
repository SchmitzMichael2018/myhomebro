export function resolveAgreementSetupSource({ sourceProposalId, savedTemplateId }) {
  if (sourceProposalId) return "estimate_provenance";
  if (savedTemplateId) return "saved_agreement_setup";
  return "ai_recommendation";
}
