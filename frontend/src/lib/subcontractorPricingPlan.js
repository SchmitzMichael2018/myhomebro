export function summarizeMilestonePricingPlan(agreementId, milestones = [], agreementPricingStrategy = "fixed") {
  void agreementId;
  const rows = Array.isArray(milestones) ? milestones : [];
  let fixedCount = 0;
  let estimatedCount = 0;
  let pendingQuoteCount = 0;
  const blockers = [];

  rows.forEach((milestone) => {
    const quote = milestone?.subcontractor_quote_request || {};
    const quoteStatus = String(quote?.status || "").toLowerCase();
    const quoteAmount = quote?.quoted_amount || "";

    if (quoteStatus === "sent" || quoteStatus === "responded" || quoteStatus === "revision_requested") {
      pendingQuoteCount += 1;
      blockers.push({
        milestone_id: milestone?.id,
        milestone_title: milestone?.title || "",
        quote_id: quote?.id || null,
        quote_status: quoteStatus,
        quote_amount: quoteAmount,
        reason: "pending_quote",
      });
      return;
    }

    if (quoteStatus === "accepted") {
      fixedCount += 1;
      return;
    }

    if (String(agreementPricingStrategy).toLowerCase() === "estimate") {
      estimatedCount += 1;
      return;
    }

    fixedCount += 1;
  });

  return {
    fixedCount,
    estimatedCount,
    pendingQuoteCount,
    blockers,
  };
}
