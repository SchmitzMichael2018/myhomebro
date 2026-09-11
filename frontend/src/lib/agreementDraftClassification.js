export function classifyLimitedFixtureScope(sourceText = "") {
  const evidence = String(sourceText || "").trim();
  const faucetInstallIntent =
    /\b(faucet|tap)\b/i.test(evidence) &&
    /\b(install|installation|replace|replacement)\b/i.test(evidence);

  if (!faucetInstallIntent) return null;

  return {
    project_type: "Plumbing",
    project_subtype: "Fixture Installation",
    project_title: /\bkitchen\b/i.test(evidence)
      ? "Kitchen Faucet Replacement"
      : "Faucet Replacement",
    description:
      "Remove the existing faucet, inspect accessible shutoffs and supply connections, install the replacement faucet, test operation and accessible connections for leaks, and clean the work area.",
    reason:
      "The requested work is a limited plumbing-fixture replacement, not a room remodel.",
    confidence: "high",
    confidence_label: "High confidence",
  };
}
