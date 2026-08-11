const amount = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function acceptedEstimateBasisSummary(agreement) {
  const basis = agreement?.accepted_estimate_basis;
  if (!basis?.proposal_id) return null;

  const subtotal = amount(basis.subtotal);
  const tax = amount(basis.tax);
  const discounts = amount(basis.discounts);
  const incidentals = amount(basis.incidentals_reserve);
  const total = amount(basis.total);

  return {
    proposalId: basis.proposal_id,
    reviewVersion: basis.review_version,
    subtotal,
    tax,
    discounts,
    incidentals,
    total,
    reconciles: Math.abs(subtotal + tax + incidentals - discounts - total) < 0.005,
  };
}
