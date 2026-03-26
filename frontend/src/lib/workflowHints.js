function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function hasAnalysis(lead) {
  return Boolean(lead?.ai_analysis && Object.keys(lead.ai_analysis).length);
}

function hasConvertedCustomer(lead) {
  return Boolean(lead?.converted_homeowner_id || lead?.converted_homeowner_name);
}

function hasConvertedAgreement(lead) {
  return Boolean(lead?.converted_agreement);
}

function milestoneIsStarted(milestone) {
  const status = normalizeStatus(milestone?.status || milestone?.state);
  return (
    Boolean(
      milestone?.started_at ||
        milestone?.completed_at ||
        milestone?.submitted_at ||
        milestone?.completion_submitted_at
    ) ||
    [
      "in_progress",
      "submitted",
      "pending_review",
      "review",
      "complete",
      "completed",
      "paid",
      "approved",
    ].includes(status)
  );
}

export function getPublicLeadHint(lead) {
  if (!lead) return null;

  const status = normalizeStatus(lead.status);
  const source = normalizeStatus(lead.source);
  const isContractorSent = source === "contractor_sent_form";

  if (isContractorSent && status === "pending_customer_response") {
    return {
      title: "Next step",
      body: "Wait for the customer to complete the intake form before reviewing the project details.",
      tone: "muted",
    };
  }

  if (isContractorSent && status === "ready_for_review" && hasAnalysis(lead) && !hasConvertedAgreement(lead)) {
    return {
      title: "Next step",
      body: "Review the completed intake and create a draft agreement when the scope looks right.",
      tone: "info",
    };
  }

  if (isContractorSent && status === "ready_for_review") {
    return {
      title: "Next step",
      body: "Analyze the intake and confirm project details before drafting the agreement.",
      tone: "info",
    };
  }

  if (status === "rejected") {
    return {
      title: "Next step",
      body: "This lead is closed unless you decide to reopen it.",
      tone: "muted",
    };
  }

  if ((status === "accepted" || status === "contacted" || status === "qualified") && hasAnalysis(lead) && !hasConvertedAgreement(lead)) {
    return {
      title: "Next step",
      body: "Review the AI suggestions and create a draft agreement when the scope looks right.",
      tone: "info",
    };
  }

  if (hasConvertedCustomer(lead) && !hasConvertedAgreement(lead)) {
    return {
      title: "Next step",
      body: "Create a draft agreement from this lead when you're ready to move into scope and pricing.",
      tone: "info",
    };
  }

  if (status === "accepted" || status === "contacted" || status === "qualified") {
    return {
      title: "Next step",
      body: "Follow up with the customer and review the lead details before drafting the project scope.",
      tone: "info",
    };
  }

  if (status === "new") {
    return {
      title: "Next step",
      body: "Review the lead details and decide whether to accept or reject it.",
      tone: "info",
    };
  }

  return null;
}

export function getAgreementWizardHint({ step, agreement }) {
  const selectedTemplate =
    agreement?.selected_template?.name ||
    agreement?.selected_template_name_snapshot ||
    "";

  if (Number(step) === 1 && selectedTemplate) {
    return {
      title: "Next step",
      body: `Review the suggested template and scope from ${selectedTemplate} before continuing.`,
      tone: "info",
    };
  }

  if (Number(step) === 1) {
    return {
      title: "Next step",
      body: "Confirm the customer, address, and project details before moving on.",
      tone: "info",
    };
  }

  if (Number(step) === 2) {
    return {
      title: "Next step",
      body: "Confirm milestones, schedule, and pricing so the draft matches the work plan.",
      tone: "info",
    };
  }

  if (Number(step) === 3) {
    return {
      title: "Next step",
      body: "Review warranty terms and attachments before preparing the final draft.",
      tone: "info",
    };
  }

  if (Number(step) === 4) {
    return {
      title: "Next step",
      body: "Preview the agreement, confirm the final details, and send it for signature.",
      tone: "info",
    };
  }

  return null;
}

export function getAgreementDetailHint({ agreement, norm, milestones = [] }) {
  const status = normalizeStatus(agreement?.status || norm?.status);
  const isSigned = Boolean(norm?.isSigned);
  const isDirectPay = Boolean(norm?.isDirectPay);
  const escrowFunded = Boolean(norm?.escrowFunded);
  const hasMilestones = Array.isArray(milestones) && milestones.length > 0;
  const startedMilestones = (milestones || []).some(milestoneIsStarted);

  if (status === "draft" || !isSigned) {
    return {
      title: "Next step",
      body: "Complete the agreement and send it for signature when the scope is ready.",
      tone: "info",
    };
  }

  if (!isDirectPay && isSigned && !escrowFunded) {
    return {
      title: "Next step",
      body: "Fund escrow before work begins so milestone billing and payouts can move forward.",
      tone: "warning",
    };
  }

  if (!isDirectPay && escrowFunded && hasMilestones && !startedMilestones) {
    return {
      title: "Next step",
      body: "Begin work and track milestone progress as the project starts.",
      tone: "success",
    };
  }

  if (isDirectPay && isSigned) {
    return {
      title: "Next step",
      body: "Begin work or issue the first invoice when the project is ready to move forward.",
      tone: "success",
    };
  }

  return null;
}

export function getPublicPresenceHint({ profile, galleryRows = [], reviewsRows = [], qrData }) {
  if (!profile?.is_public) {
    return {
      title: "Next step",
      body: "Turn on public visibility to start receiving leads from your profile page.",
      tone: "warning",
    };
  }

  if (!galleryRows.length) {
    return {
      title: "Next step",
      body: "Add project photos to strengthen your public profile before you share it.",
      tone: "info",
    };
  }

  const publicReviews = reviewsRows.filter((review) => review?.is_public);
  if (profile?.allow_public_reviews && publicReviews.length === 0) {
    return {
      title: "Next step",
      body: "Encourage customers to leave reviews so future leads see recent trust signals.",
      tone: "info",
    };
  }

  if (qrData?.public_url || profile?.public_url) {
    return {
      title: "Next step",
      body: "Share your QR code or public profile link anywhere you want to attract new leads.",
      tone: "success",
    };
  }

  return null;
}

export function getSubcontractorHubHint({
  invitationRows = [],
  assignmentRows = [],
  submissionRows = [],
}) {
  const pendingInviteCount = invitationRows.filter(
    (row) => normalizeStatus(row?.status) === "pending"
  ).length;
  if (pendingInviteCount > 0) {
    return {
      title: "Next step",
      body:
        pendingInviteCount === 1
          ? "Wait for the subcontractor to accept the invitation before assigning work."
          : "Wait for pending invitations to be accepted before assigning work.",
      tone: "info",
    };
  }

  const hasAcceptedWithoutWork = invitationRows.some(
    (row) =>
      normalizeStatus(row?.status) === "accepted" &&
      !assignmentRows.some(
        (assignment) => String(assignment?.invitation_id || assignment?.id) === String(row?.id)
      )
  );
  if (hasAcceptedWithoutWork) {
    return {
      title: "Next step",
      body: "Assign milestones or work items so your accepted subcontractors can get started.",
      tone: "info",
    };
  }

  const submittedForReviewCount = submissionRows.filter(
    (row) => normalizeStatus(row?.review_status) === "submitted_for_review"
  ).length;
  if (submittedForReviewCount > 0) {
    return {
      title: "Next step",
      body:
        submittedForReviewCount === 1
          ? "Review the submitted work and either mark it reviewed or request changes."
          : "Review submitted work items and either mark them reviewed or request changes.",
      tone: "warning",
    };
  }

  return null;
}

export function getDashboardNextSteps({
  leads = [],
  agreements = [],
  milestones = [],
}) {
  const items = [];

  const leadsNeedingFollowUp = leads.filter((lead) => {
    const status = normalizeStatus(lead?.status);
    return (
      status === "new" ||
      status === "ready_for_review" ||
      ((status === "accepted" || status === "contacted" || status === "qualified") &&
        !hasConvertedAgreement(lead))
    );
  }).length;
  if (leadsNeedingFollowUp > 0) {
    items.push(
      `${leadsNeedingFollowUp} public lead${leadsNeedingFollowUp === 1 ? " needs" : "s need"} follow-up.`
    );
  }

  const agreementsWaitingForSignature = agreements.filter(
    (agreement) =>
      !agreement?.signature_is_satisfied &&
      !agreement?.is_fully_signed &&
      normalizeStatus(agreement?.status) !== "signed"
  ).length;
  if (agreementsWaitingForSignature > 0) {
    items.push(
      `${agreementsWaitingForSignature} agreement${agreementsWaitingForSignature === 1 ? " is" : "s are"} waiting for signature.`
    );
  }

  const projectsWaitingForFunding = agreements.filter((agreement) => {
    const status = normalizeStatus(agreement?.status);
    const paymentMode = normalizeStatus(agreement?.payment_mode);
    return (
      paymentMode !== "direct" &&
      (agreement?.signature_is_satisfied || agreement?.is_fully_signed || status === "signed") &&
      !agreement?.escrow_funded
    );
  }).length;
  if (projectsWaitingForFunding > 0) {
    items.push(
      `${projectsWaitingForFunding} project${projectsWaitingForFunding === 1 ? " is" : "s are"} waiting for funding.`
    );
  }

  const milestonesAwaitingReview = milestones.filter((milestone) => {
    const status = normalizeStatus(
      milestone?.status || milestone?.milestone_status || milestone?.state
    );
    return ["submitted", "pending_review", "review", "in_review"].includes(status);
  }).length;
  if (milestonesAwaitingReview > 0) {
    items.push(
      `${milestonesAwaitingReview} milestone${milestonesAwaitingReview === 1 ? " is" : "s are"} awaiting review.`
    );
  }

  return items;
}
