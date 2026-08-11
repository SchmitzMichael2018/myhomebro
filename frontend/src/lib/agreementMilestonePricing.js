const amount = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function summarizeAcceptedEstimateAllocation(basis, allocatedAmount) {
  if (!basis?.proposal_id) return null;
  const commercialBase = amount(basis.subtotal) + amount(basis.tax) - amount(basis.discounts);
  const allocated = amount(allocatedAmount);
  const difference = Number((commercialBase - allocated).toFixed(2));
  return {
    commercialBase,
    incidentalsReserve: amount(basis.incidentals_reserve),
    fundingTotal: amount(basis.total),
    allocated,
    unallocated: Math.max(0, difference),
    overallocated: Math.max(0, -difference),
    fullyAllocated: Math.abs(difference) < 0.005,
    suppressAutomaticSuggestions: true,
  };
}
