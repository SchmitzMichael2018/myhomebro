export function resolveAgreementSetupSource({ sourceProposalId, estimateTemplateId, savedTemplateId }) {
  if (sourceProposalId && estimateTemplateId) return "estimate_provenance";
  if (savedTemplateId) return "saved_agreement_setup";
  return "ai_recommendation";
}
