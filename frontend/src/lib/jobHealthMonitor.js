// Pure functions — no React, no API calls. Input is data already fetched.

export const HEALTH_FLAG_TYPES = {
  MILESTONE_OVERDUE:      'milestone_overdue',
  NO_ACTIVITY:            'no_activity',
  SIGNATURE_PENDING:      'signature_pending',
  FUNDING_NOT_RELEASED:   'funding_not_released',
  SCOPE_UNSIGNED_CHANGE:  'scope_unsigned_change',
  PAYMENT_DELAYED:        'payment_delayed',
  RELATIONSHIP_RISK:      'relationship_risk',
};

function parseDateAny(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysDiff(dateA, dateB) {
  return (dateB.getTime() - dateA.getTime()) / (1000 * 60 * 60 * 24);
}

function hoursDiff(dateA, dateB) {
  return (dateB.getTime() - dateA.getTime()) / (1000 * 60 * 60);
}

function isMilestoneComplete(milestone) {
  if (!milestone) return false;
  const status = String(milestone.status || milestone.milestone_status || "").toLowerCase();
  return (
    milestone.completed === true ||
    milestone.is_completed === true ||
    Boolean(milestone.completed_at || milestone.completed_on || milestone.completed_date) ||
    ["completed", "complete", "done", "finished", "paid", "approved"].includes(status)
  );
}

function getMilestoneAgreementId(milestone) {
  if (!milestone) return null;
  return milestone.agreement_id || milestone.agreement?.id || milestone.agreement || null;
}

function getMilestoneDueDate(milestone) {
  if (!milestone) return null;
  return parseDateAny(milestone.due_date) ||
    parseDateAny(milestone.completion_date) ||
    parseDateAny(milestone.end_date) ||
    parseDateAny(milestone.scheduled_date) ||
    parseDateAny(milestone.target_date) ||
    null;
}

function getAgreementTitle(agreement) {
  return String(agreement?.title || agreement?.project_title || `Agreement ${agreement?.id || ""}` || "").trim();
}

function isAgreementActive(agreement) {
  const status = String(agreement?.status || "").toLowerCase();
  return ["signed", "active", "in_progress", "funded", "executing"].includes(status);
}

function isAgreementSigned(agreement) {
  return !!(
    agreement?.signature_is_satisfied ||
    agreement?.is_fully_signed ||
    agreement?.signed_by_homeowner
  );
}

// ── health checks ─────────────────────────────────────────────────────────────

function checkMilestoneOverdue(agreements, milestones, now) {
  const flags = [];
  const agreementMap = new Map(agreements.map((a) => [String(a.id), a]));

  for (const milestone of milestones) {
    if (isMilestoneComplete(milestone)) continue;

    const dueDate = getMilestoneDueDate(milestone);
    if (!dueDate) continue;

    const daysOverdue = daysDiff(dueDate, now);
    if (daysOverdue <= 0) continue;

    const agreementId = getMilestoneAgreementId(milestone);
    const agreement = agreementMap.get(String(agreementId)) || null;
    if (!agreement || !isAgreementActive(agreement)) continue;

    const agreementTitle = getAgreementTitle(agreement);
    const severity = daysOverdue > 7 ? "urgent" : "warning";

    flags.push({
      type: HEALTH_FLAG_TYPES.MILESTONE_OVERDUE,
      severity,
      agreementId: String(agreementId),
      agreementTitle,
      milestoneId: String(milestone.id || ""),
      milestoneTitle: String(milestone.title || "Milestone"),
      message: `Milestone "${milestone.title || "Milestone"}" on "${agreementTitle}" is ${Math.round(daysOverdue)} day${Math.round(daysOverdue) !== 1 ? "s" : ""} overdue.`,
      draftedAction: `Send a status update to your customer about the "${milestone.title || "Milestone"}" milestone.`,
      ctaLabel: "Open agreement",
      ctaRoute: `/app/agreements/${agreementId}`,
      daysSince: Math.round(daysOverdue),
    });
  }

  return flags;
}

function checkNoActivity(agreements, now) {
  const flags = [];

  for (const agreement of agreements) {
    if (!isAgreementActive(agreement)) continue;

    const updatedAt = parseDateAny(agreement.updated_at || agreement.last_activity_at);
    if (!updatedAt) continue;

    const daysInactive = daysDiff(updatedAt, now);
    if (daysInactive <= 5) continue;

    flags.push({
      type: HEALTH_FLAG_TYPES.NO_ACTIVITY,
      severity: "warning",
      agreementId: String(agreement.id),
      agreementTitle: getAgreementTitle(agreement),
      message: `No activity on "${getAgreementTitle(agreement)}" for ${Math.round(daysInactive)} days.`,
      draftedAction: `Send a check-in message to your customer about "${getAgreementTitle(agreement)}".`,
      ctaLabel: "Open agreement",
      ctaRoute: `/app/agreements/${agreement.id}`,
      daysSince: Math.round(daysInactive),
    });
  }

  return flags;
}

function checkSignaturePending(agreements, now) {
  const flags = [];

  for (const agreement of agreements) {
    if (isAgreementSigned(agreement)) continue;

    const sentAt = parseDateAny(
      agreement.signature_request_sent_at ||
      agreement.sent_for_signature_at ||
      agreement.homeowner_invite_sent_at
    );
    if (!sentAt) continue;

    const daysSinceSent = daysDiff(sentAt, now);
    if (daysSinceSent <= 3) continue;

    const status = String(agreement.status || "").toLowerCase();
    if (["completed", "cancelled", "archived"].includes(status)) continue;

    flags.push({
      type: HEALTH_FLAG_TYPES.SIGNATURE_PENDING,
      severity: daysSinceSent > 7 ? "urgent" : "warning",
      agreementId: String(agreement.id),
      agreementTitle: getAgreementTitle(agreement),
      message: `"${getAgreementTitle(agreement)}" has been waiting on signature for ${Math.round(daysSinceSent)} days.`,
      draftedAction: `Follow up with your customer about signing "${getAgreementTitle(agreement)}".`,
      ctaLabel: "Send reminder",
      ctaRoute: `/app/agreements/${agreement.id}`,
      daysSince: Math.round(daysSinceSent),
    });
  }

  return flags;
}

function checkFundingNotReleased(agreements, milestones, now) {
  const flags = [];
  const agreementMap = new Map(agreements.map((a) => [String(a.id), a]));

  for (const milestone of milestones) {
    const status = String(milestone.status || "").toLowerCase();
    if (status !== "approved") continue;

    const isPaid = !!(milestone.paid_at || milestone.direct_pay_paid_at || milestone.payment_released_at);
    if (isPaid) continue;

    const approvedAt = parseDateAny(milestone.approved_at || milestone.updated_at);
    if (!approvedAt) continue;

    const hoursWaiting = hoursDiff(approvedAt, now);
    if (hoursWaiting <= 48) continue;

    const agreementId = getMilestoneAgreementId(milestone);
    const agreement = agreementMap.get(String(agreementId)) || null;
    if (!agreement) continue;

    flags.push({
      type: HEALTH_FLAG_TYPES.FUNDING_NOT_RELEASED,
      severity: "warning",
      agreementId: String(agreementId),
      agreementTitle: getAgreementTitle(agreement),
      milestoneId: String(milestone.id || ""),
      milestoneTitle: String(milestone.title || "Milestone"),
      message: `Payment for "${milestone.title || "Milestone"}" on "${getAgreementTitle(agreement)}" has been approved but not released for over ${Math.round(hoursWaiting / 24)} days.`,
      draftedAction: `Release the payment for "${milestone.title || "Milestone"}" to keep the project moving.`,
      ctaLabel: "Release payment",
      ctaRoute: `/app/agreements/${agreementId}?tab=milestones`,
      daysSince: Math.round(hoursWaiting / 24),
    });
  }

  return flags;
}

function checkPaymentDelayed(agreements, milestones, now) {
  // Checks for milestones with submitted status (customer submitted, waiting on contractor approval)
  // that have been waiting more than 48h without action
  const flags = [];
  const agreementMap = new Map(agreements.map((a) => [String(a.id), a]));

  for (const milestone of milestones) {
    const status = String(milestone.status || "").toLowerCase();
    const isSubmitted = ["submitted", "pending_review", "in_review"].includes(status) ||
      Boolean(milestone.submitted_at || milestone.completion_submitted_at);
    if (!isSubmitted) continue;

    const submittedAt = parseDateAny(
      milestone.submitted_at ||
      milestone.completion_submitted_at ||
      milestone.updated_at
    );
    if (!submittedAt) continue;

    const hoursWaiting = hoursDiff(submittedAt, now);
    if (hoursWaiting <= 48) continue;

    const agreementId = getMilestoneAgreementId(milestone);
    const agreement = agreementMap.get(String(agreementId)) || null;
    if (!agreement) continue;

    flags.push({
      type: HEALTH_FLAG_TYPES.PAYMENT_DELAYED,
      severity: "warning",
      agreementId: String(agreementId),
      agreementTitle: getAgreementTitle(agreement),
      milestoneId: String(milestone.id || ""),
      milestoneTitle: String(milestone.title || "Milestone"),
      message: `"${milestone.title || "Milestone"}" on "${getAgreementTitle(agreement)}" has been submitted for review for over ${Math.round(hoursWaiting / 24)} days.`,
      draftedAction: `Review and approve the completed work for "${milestone.title || "Milestone"}".`,
      ctaLabel: "Review work",
      ctaRoute: `/app/agreements/${agreementId}?tab=milestones`,
      daysSince: Math.round(hoursWaiting / 24),
    });
  }

  return flags;
}

function checkRelationshipRisk(agreements, milestones, now) {
  // Fires when: milestone overdue > 7 days OR no agreement activity > 5 days on active job
  const flags = [];
  const agreementMap = new Map(agreements.map((a) => [String(a.id), a]));
  const flaggedAgreements = new Set();

  // Milestone overdue > 7 days
  for (const milestone of milestones) {
    if (isMilestoneComplete(milestone)) continue;

    const dueDate = getMilestoneDueDate(milestone);
    if (!dueDate) continue;

    const daysOverdue = daysDiff(dueDate, now);
    if (daysOverdue <= 7) continue;

    const agreementId = String(getMilestoneAgreementId(milestone) || "");
    if (flaggedAgreements.has(agreementId)) continue;

    const agreement = agreementMap.get(agreementId) || null;
    if (!agreement || !isAgreementActive(agreement)) continue;

    flaggedAgreements.add(agreementId);

    flags.push({
      type: HEALTH_FLAG_TYPES.RELATIONSHIP_RISK,
      severity: "urgent",
      agreementId,
      agreementTitle: getAgreementTitle(agreement),
      milestoneId: String(milestone.id || ""),
      milestoneTitle: String(milestone.title || "Milestone"),
      message: `"${getAgreementTitle(agreement)}" is at risk — a milestone is ${Math.round(daysOverdue)} days overdue with no update.`,
      draftedAction: `Reach out to your customer with a proactive update to prevent a dispute.`,
      ctaLabel: "Send check-in",
      ctaRoute: `/app/agreements/${agreementId}`,
      daysSince: Math.round(daysOverdue),
    });
  }

  // No activity > 5 days on active job
  for (const agreement of agreements) {
    if (!isAgreementActive(agreement)) continue;
    if (flaggedAgreements.has(String(agreement.id))) continue;

    const updatedAt = parseDateAny(agreement.updated_at || agreement.last_activity_at);
    if (!updatedAt) continue;

    const daysInactive = daysDiff(updatedAt, now);
    if (daysInactive <= 5) continue;

    flaggedAgreements.add(String(agreement.id));

    flags.push({
      type: HEALTH_FLAG_TYPES.RELATIONSHIP_RISK,
      severity: "warning",
      agreementId: String(agreement.id),
      agreementTitle: getAgreementTitle(agreement),
      milestoneId: null,
      milestoneTitle: null,
      message: `No activity on "${getAgreementTitle(agreement)}" for ${Math.round(daysInactive)} days — your customer may be wondering about status.`,
      draftedAction: `Send a proactive check-in to keep the relationship strong.`,
      ctaLabel: "Send check-in",
      ctaRoute: `/app/agreements/${agreement.id}`,
      daysSince: Math.round(daysInactive),
    });
  }

  return flags;
}

// ── main export ──────────────────────────────────────────────────────────────

export function checkJobHealth({ agreements = [], milestones = [], now = new Date() } = {}) {
  try {
    const safeAgreements = Array.isArray(agreements) ? agreements : [];
    const safeMilestones = Array.isArray(milestones) ? milestones : [];

    return [
      ...checkMilestoneOverdue(safeAgreements, safeMilestones, now),
      ...checkNoActivity(safeAgreements, now),
      ...checkSignaturePending(safeAgreements, now),
      ...checkFundingNotReleased(safeAgreements, safeMilestones, now),
      ...checkPaymentDelayed(safeAgreements, safeMilestones, now),
      ...checkRelationshipRisk(safeAgreements, safeMilestones, now),
    ];
  } catch {
    return [];
  }
}
