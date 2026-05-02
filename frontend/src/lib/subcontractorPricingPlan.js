function safeStr(value) {
  return value == null ? "" : String(value).trim();
}

export function normalizeSubcontractorPlan(value) {
  const normalized = safeStr(value).toLowerCase();
  if (normalized === "none" || normalized === "some" || normalized === "unsure") {
    return normalized;
  }
  return "unsure";
}

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

function getAssignedSubcontractorName(milestone) {
  return (
    milestone?.assigned_subcontractor?.display_name ||
    milestone?.assigned_subcontractor?.email ||
    milestone?.assigned_worker?.display_name ||
    milestone?.assigned_worker?.email ||
    milestone?.subcontractor_milestone_agreement?.subcontractor_display_name ||
    milestone?.subcontractor_milestone_agreement?.subcontractor_email ||
    milestone?.subcontractor_quote_request?.linked_subcontractor_milestone_agreement?.subcontractor_display_name ||
    milestone?.subcontractor_quote_request?.linked_subcontractor_milestone_agreement?.subcontractor_email ||
    ""
  ).trim();
}

function getQuoteState(milestone) {
  return milestone?.subcontractor_quote_request || null;
}

function getSubcontractorAgreementState(milestone) {
  return milestone?.subcontractor_milestone_agreement || null;
}

function getPayoutState(milestone) {
  return milestone?.subcontractor_payout_orchestration || null;
}

export function milestoneHasSubcontractorLifecycleState(milestone) {
  const quote = getQuoteState(milestone);
  const quoteStatus = safeStr(quote?.status).toLowerCase();
  const agreement = getSubcontractorAgreementState(milestone);
  const agreementStatus = safeStr(agreement?.agreement_acceptance_status).toLowerCase();
  const assignedName = getAssignedSubcontractorName(milestone);
  return Boolean(
    assignedName ||
      quoteStatus ||
      agreementStatus ||
      safeStr(milestone?.assigned_subcontractor_invitation).length
  );
}

export function getSimpleStateLabel(value) {
  const normalized = safeStr(value).toLowerCase();
  if (normalized === "ready") return "Good to go";
  if (normalized === "blocked") return "Action needed";
  if (normalized === "pending") return "Waiting";
  if (normalized === "approved") return "Approved";
  if (normalized === "accepted") return "Approved";
  if (normalized === "not_due") return "Not yet due";
  if (normalized === "sent") return "Sent";
  if (normalized === "paid") return "Paid";
  if (normalized === "scheduled") return "Payment scheduled";
  if (normalized === "failed") return "Action needed";
  if (normalized === "cancelled") return "Action needed";
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "";
}

export function getPricingReadinessCopy(pricingReadiness = {}) {
  const pendingQuoteCount = Number(pricingReadiness.pendingQuoteCount || 0);
  const estimatedCount = Number(pricingReadiness.estimatedCount || 0);

  if (pendingQuoteCount > 0) {
    const noun = pendingQuoteCount === 1 ? "milestone" : "milestones";
    const verb = pendingQuoteCount === 1 ? "is" : "are";
    return {
      tone: "danger",
      title: "Needs attention",
      body: `${pendingQuoteCount} ${noun} ${verb} still waiting on subcontractor pricing.`,
    };
  }

  if (estimatedCount > 0) {
    const noun = estimatedCount === 1 ? "milestone" : "milestones";
    const verb = estimatedCount === 1 ? "uses" : "use";
    return {
      tone: "warning",
      title: "Good to send",
      body: `${estimatedCount} ${noun} ${verb} estimated pricing.`,
    };
  }

  return {
    tone: "success",
    title: "Good to send",
    body: "All pricing is set and the agreement is ready to send.",
  };
}

export function getMilestoneSubcontractorSummary(
  milestone,
  agreementPricingStrategy = "fixed",
  subcontractorPlan = "unsure"
) {
  const quote = getQuoteState(milestone);
  const quoteStatus = safeStr(quote?.status).toLowerCase();
  const agreement = getSubcontractorAgreementState(milestone);
  const agreementStatus = safeStr(agreement?.agreement_acceptance_status).toLowerCase();
  const assignedName = getAssignedSubcontractorName(milestone);
  const pricingStrategy = safeStr(agreementPricingStrategy).toLowerCase() || "fixed";
  const plan = normalizeSubcontractorPlan(subcontractorPlan);

  if (agreementStatus === "accepted") {
    return assignedName ? `${assignedName} (approved)` : "Approved";
  }

  if (quoteStatus === "accepted") {
    return assignedName || "Quote accepted";
  }

  if (quoteStatus === "responded") {
    const quotedAmount = formatCurrency(quote?.quoted_amount);
    return quotedAmount ? `Quote received — ${quotedAmount}` : "Quote received";
  }

  if (quoteStatus === "sent" || quoteStatus === "revision_requested") {
    return "Waiting on subcontractor";
  }

  if (assignedName) {
    return assignedName;
  }

  if (plan === "none") return "Not planned";
  if (plan === "some") return pricingStrategy === "requires_sub_quote" ? "Waiting for subcontractor pricing" : "Not planned yet";
  return pricingStrategy === "requires_sub_quote" ? "Waiting for subcontractor pricing" : "Not planned yet";
}

export function getNextStepLabel(
  milestone,
  agreement = {},
  quote = null,
  subcontractorAgreement = null,
  payoutState = null,
  subcontractorPlan = "unsure"
) {
  const milestoneQuote = quote || getQuoteState(milestone);
  const milestoneAgreement = subcontractorAgreement || getSubcontractorAgreementState(milestone);
  const milestonePayout = payoutState || getPayoutState(milestone);
  const pricingStrategy = safeStr(agreement?.pricing_strategy || milestone?.pricing_strategy || "fixed").toLowerCase() || "fixed";
  const plan = normalizeSubcontractorPlan(subcontractorPlan);
  const quoteStatus = safeStr(milestoneQuote?.status).toLowerCase();
  const agreementStatus = safeStr(milestoneAgreement?.agreement_acceptance_status).toLowerCase();
  const workStatus = safeStr(milestone?.work_submission_status || milestone?.subcontractor_completion_status).toLowerCase();
  const payoutStatus = safeStr(
    milestonePayout?.payout_state || milestonePayout?.next_status || milestonePayout?.payout_status
  ).toLowerCase();
  const hasAnySubcontractor = milestoneHasSubcontractorLifecycleState(milestone);

  if (payoutStatus === "paid") return "Completed";
  if (payoutStatus === "scheduled") return "Payment scheduled";
  if (payoutStatus === "ready") return "Release payment";
  if (payoutStatus === "failed" || payoutStatus === "blocked" || payoutStatus === "cancelled") return "Action needed";

  if (workStatus === "submitted_for_review") return "Review work";
  if (workStatus === "reviewed" || workStatus === "approved" || workStatus === "completed") {
    return payoutStatus === "scheduled" ? "Payment scheduled" : "Release payment";
  }

  if (agreementStatus === "accepted") {
    return "Track work";
  }

  if (quoteStatus === "accepted") {
    return "Send Subcontractor Agreement";
  }

  if (quoteStatus === "responded") {
    return "Review quote";
  }

  if (quoteStatus === "sent" || quoteStatus === "revision_requested") {
    return "View quote";
  }

  if (quoteStatus === "declined" || quoteStatus === "cancelled") {
    if (pricingStrategy === "requires_sub_quote") return "Request subcontractor quote";
    return plan === "none" ? "Review milestone" : "Decide subcontractor";
  }

  if (pricingStrategy === "requires_sub_quote") {
    return "Request subcontractor quote";
  }

  if (!hasAnySubcontractor) {
    if (plan === "some") return "Decide subcontractor";
    return "Review milestone";
  }

  if (agreementStatus === "pending" || agreementStatus === "not_sent") {
    return "Send Subcontractor Agreement";
  }

  return "View Details";
}

export function getMilestonePrimaryAction(
  milestone,
  agreement = {},
  quote = null,
  subcontractorAgreement = null,
  payoutState = null,
  subcontractorPlan = "unsure"
) {
  const nextStep = getNextStepLabel(milestone, agreement, quote, subcontractorAgreement, payoutState, subcontractorPlan);
  const normalized = safeStr(nextStep).toLowerCase();
  if (normalized === "request subcontractor quote") {
    return { key: "request_quote", label: "Request quote" };
  }
  if (normalized === "review milestone" || normalized === "save and continue") {
    return { key: "review_milestone", label: "Review milestone" };
  }
  if (normalized === "decide subcontractor") {
    return { key: "decide_subcontractor", label: "Decide subcontractor" };
  }
  if (normalized === "view quote") {
    return { key: "view_quote", label: "View Quote" };
  }
  if (normalized === "review quote") {
    return { key: "review_quote", label: "Review Quote" };
  }
  if (normalized === "send subcontractor agreement") {
    return { key: "send_agreement", label: "Send Subcontractor Agreement" };
  }
  if (normalized === "track work") {
    return { key: "track_work", label: "Track Work" };
  }
  if (normalized === "review work") {
    return { key: "review_work", label: "Review Work" };
  }
  if (normalized === "release payment") {
    return { key: "release_payment", label: "Release Payment" };
  }
  if (normalized === "payment scheduled") {
    return { key: "payment_scheduled", label: "Payment Scheduled" };
  }
  if (normalized === "completed") {
    return { key: "view_details", label: "View Details" };
  }
  return { key: "view_details", label: "View Details" };
}

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
