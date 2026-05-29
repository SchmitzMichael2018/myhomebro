const ACTION_LIMIT = 10;
const FALLBACK_ACTIVITY_LIMIT = 5;

function safeText(value) {
  return String(value ?? "").trim();
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDateAny(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function isAre(count) {
  return count === 1 ? "is" : "are";
}

function normalizeStatus(value) {
  return safeText(value).toLowerCase();
}

// Activity feed items that confirm status (not actions) — excluded from the queue
const STATUS_CONFIRMATION_PATTERNS = [
  /onboard(ing)?.*(complet|done|finish|setup)/i,
  /stripe.*(connect|ready|done|complet)/i,
  /profile.*(complet|done|setup|ready)/i,
  /account.*(activat|verif|complet|ready)/i,
  /setup.*(complet|done|ready)/i,
  /payment.*(setup|configur|ready)/i,
];

function isStatusConfirmationItem(item) {
  const title = safeText(item?.title || item?.message);
  return STATUS_CONFIRMATION_PATTERNS.some((p) => p.test(title));
}

function invBucket(inv) {
  const status = normalizeStatus(inv?.status);
  const display = normalizeStatus(inv?.display_status);
  const escrowReleased =
    inv?.escrow_released === true || inv?.escrow_released === 1 || inv?.escrow_released === "true";

  if (escrowReleased || display === "paid" || ["paid", "earned", "released"].includes(status)) {
    return "paid";
  }
  if (["approved", "ready_to_pay"].includes(status)) {
    return "approved";
  }
  if (["pending", "pending_approval", "sent", "awaiting_approval"].includes(status)) {
    return "pending";
  }
  if (status.includes("dispute") || display.includes("dispute")) {
    return "disputed";
  }
  return "pending";
}

function drawWorkflowStatus(draw) {
  return normalizeStatus(draw?.workflow_status || draw?.status || "");
}

function isMilestoneRework(milestone) {
  const title = safeText(milestone?.title || milestone?.name).toLowerCase();
  if (!title) return false;
  if (milestone?.rework_origin_milestone_id) return true;
  return title.startsWith("rework") || (title.includes("rework") && title.includes("dispute"));
}

function isMilestoneSubmitted(milestone) {
  const status = normalizeStatus(milestone?.status || milestone?.milestone_status || milestone?.state);
  return (
    ["submitted", "pending_review", "review", "in_review"].includes(status) ||
    Boolean(milestone?.submitted_at || milestone?.submitted_on || milestone?.completion_submitted_at)
  );
}

function isMilestoneCompleted(milestone) {
  const status = normalizeStatus(milestone?.status || milestone?.milestone_status || milestone?.state);
  return (
    milestone?.completed === true ||
    milestone?.is_completed === true ||
    Boolean(milestone?.completed_at || milestone?.completed_on || milestone?.completed_date) ||
    ["completed", "complete", "done", "finished", "paid"].includes(status)
  );
}

function getMilestoneAgreementId(milestone) {
  return milestone?.agreement_id || milestone?.agreement?.id || milestone?.agreement || null;
}

function getMilestoneQuoteStatus(milestone) {
  return normalizeStatus(milestone?.subcontractor_quote_request?.status);
}

function getMilestonePricingStrategy(milestone) {
  return normalizeStatus(
    milestone?.pricing_strategy ||
      milestone?.agreement_pricing_strategy ||
      milestone?.agreement?.pricing_strategy ||
      milestone?.agreement?.pricingStrategy
  );
}

function buildAction({
  key,
  dedupeKey,
  title,
  description,
  buttonLabel,
  navigationTarget,
  priorityScore,
  category = "workflow",
  source = "",
  dataTestId = "",
}) {
  return {
    key,
    dedupeKey: safeText(dedupeKey),
    title: safeText(title),
    description: safeText(description),
    buttonLabel: safeText(buttonLabel) || "Open",
    navigationTarget: safeText(navigationTarget) || "/app/dashboard",
    priorityScore: safeNumber(priorityScore),
    category,
    source,
    dataTestId,
  };
}

function sortActions(actions) {
  return [...actions].sort((left, right) => {
    const diff = safeNumber(right.priorityScore) - safeNumber(left.priorityScore);
    if (diff !== 0) return diff;
    return safeText(left.title).localeCompare(safeText(right.title));
  });
}

function dedupeActions(actions) {
  const seen = new Set();
  const result = [];
  for (const action of actions) {
    if (!action || !action.key) continue;
    const dedupeKey = safeText(action.dedupeKey || action.navigationTarget || action.key);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(action);
  }
  return result;
}

function latestByDate(rows, datePicker) {
  return [...(Array.isArray(rows) ? rows : [])]
    .map((row) => ({ row, date: parseDateAny(datePicker(row)) }))
    .sort((left, right) => {
      const leftTime = left.date?.getTime() || 0;
      const rightTime = right.date?.getTime() || 0;
      if (rightTime !== leftTime) return rightTime - leftTime;
      return (safeNumber(right.row?.id) || 0) - (safeNumber(left.row?.id) || 0);
    })
    .map((entry) => entry.row)[0] || null;
}

function mapNextBestAction(nextBestAction) {
  if (!nextBestAction?.title) return null;
  return buildAction({
    key: `next-best:${safeText(nextBestAction.action_type) || safeText(nextBestAction.title)}`,
    dedupeKey: safeText(nextBestAction.navigation_target) || safeText(nextBestAction.action_type) || safeText(nextBestAction.title),
    title: nextBestAction.title,
    description: nextBestAction.message,
    buttonLabel: nextBestAction.cta_label || "Open",
    navigationTarget: nextBestAction.navigation_target || "/app/dashboard",
    priorityScore: nextBestAction.priority_score ?? 100,
    category: nextBestAction.blocking_issue ? "attention" : "workflow",
    source: nextBestAction.source_system || "activity",
    dataTestId: "dashboard-next-best-action-primary",
  });
}

export function getContractorNextActions({
  nextBestAction = null,
  agreements = [],
  milestones = [],
  invoices = [],
  drawRequests = [],
  activityFeed = [],
} = {}) {
  const actions = [];

  const mappedNextBestAction = mapNextBestAction(nextBestAction);
  if (mappedNextBestAction) {
    actions.push(mappedNextBestAction);
  }

  const agreementRows = [...(Array.isArray(agreements) ? agreements : [])].sort((left, right) => {
    const leftDate = parseDateAny(left?.updated_at || left?.created_at);
    const rightDate = parseDateAny(right?.updated_at || right?.created_at);
    const diff = (rightDate?.getTime() || 0) - (leftDate?.getTime() || 0);
    if (diff !== 0) return diff;
    return safeNumber(right?.id) - safeNumber(left?.id);
  });

  const latestDraft = agreementRows.find((agreement) => normalizeStatus(agreement?.status) === "draft");
  if (latestDraft?.id) {
    actions.push(
      buildAction({
        key: `agreement-draft:${latestDraft.id}`,
        dedupeKey: `agreement:${latestDraft.id}`,
        title: "Draft agreement ready to send",
        description: "A draft agreement is ready for review and sending.",
        buttonLabel: "Open draft",
        navigationTarget: `/app/agreements/${latestDraft.id}/wizard?step=1`,
        priorityScore: 95,
        category: "workflow",
        source: "agreements",
      })
    );
  }

  const awaitingSignature = agreementRows.filter(
    (agreement) =>
      !agreement?.signature_is_satisfied &&
      !agreement?.is_fully_signed &&
      !["signed", "completed", "cancelled", "archived"].includes(normalizeStatus(agreement?.status))
  );
  if (awaitingSignature.length) {
    actions.push(
      buildAction({
        key: "agreements-awaiting-signature",
        dedupeKey: "agreements-awaiting-signature",
        title: "Review agreement signatures",
        description: `${countLabel(awaitingSignature.length, "agreement")} ${isAre(awaitingSignature.length)} waiting on signature.`,
        buttonLabel: "Open agreements",
        navigationTarget: "/app/agreements?focus=needs_attention&filter=awaiting_signature",
        priorityScore: 90,
        category: "attention",
        source: "agreements",
        dataTestId: "dashboard-needs-attention-item-awaiting_signature",
      })
    );
  }

  const awaitingFunding = agreementRows.filter((agreement) => {
    const status = normalizeStatus(agreement?.status);
    const paymentMode = normalizeStatus(agreement?.payment_mode);
    return (
      paymentMode !== "direct" &&
      (agreement?.signature_is_satisfied || agreement?.is_fully_signed || status === "signed") &&
      !agreement?.escrow_funded
    );
  });
  if (awaitingFunding.length) {
    actions.push(
      buildAction({
        key: "agreements-awaiting-funding",
        dedupeKey: "agreements-awaiting-funding",
        title: "Fund agreement escrow",
        description: `${countLabel(awaitingFunding.length, "agreement")} ${isAre(awaitingFunding.length)} waiting on funding.`,
        buttonLabel: "Open agreements",
        navigationTarget: "/app/agreements?focus=needs_attention&filter=awaiting_funding",
        priorityScore: 88,
        category: "attention",
        source: "payments",
        dataTestId: "dashboard-needs-attention-item-awaiting_funding",
      })
    );
  }

  const invoicePending = [...(Array.isArray(invoices) ? invoices : [])].filter((invoice) => invBucket(invoice) === "pending");
  if (invoicePending.length) {
    actions.push(
      buildAction({
        key: "invoices-pending-approval",
        dedupeKey: "invoices-pending-approval",
        title: "Review payment requests",
        description: `${countLabel(invoicePending.length, "payment request")} ${isAre(invoicePending.length)} waiting on approval.`,
        buttonLabel: "Open invoices",
        navigationTarget: "/app/invoices?money_status=pending_approval",
        priorityScore: 82,
        category: "attention",
        source: "invoices",
        dataTestId: "dashboard-needs-attention-item-pending_approval",
      })
    );
  }

  const invoiceApproved = [...(Array.isArray(invoices) ? invoices : [])].filter((invoice) => invBucket(invoice) === "approved");
  const latestApprovedInvoice = latestByDate(invoiceApproved, (invoice) => invoice?.updated_at || invoice?.created_at);
  if (latestApprovedInvoice?.id) {
    actions.push(
      buildAction({
        key: `invoice-approved:${latestApprovedInvoice.id}`,
        dedupeKey: `invoice:${latestApprovedInvoice.id}`,
        title: "Release approved payment",
        description: "An approved invoice is ready for payout handling.",
        buttonLabel: "Open invoice",
        navigationTarget: `/app/invoices/${latestApprovedInvoice.id}`,
        priorityScore: 78,
        category: "money",
        source: "invoices",
      })
    );
  }

  const invoiceDisputed = [...(Array.isArray(invoices) ? invoices : [])].filter((invoice) => invBucket(invoice) === "disputed");
  if (invoiceDisputed.length) {
    actions.push(
      buildAction({
        key: "invoices-disputed",
        dedupeKey: "invoices-disputed",
        title: "Resolve payment issues",
        description: `${countLabel(invoiceDisputed.length, "invoice")} ${isAre(invoiceDisputed.length)} disputed and need follow-up.`,
        buttonLabel: "Open issues",
        navigationTarget: "/app/invoices?money_status=issues",
        priorityScore: 76,
        category: "attention",
        source: "invoices",
        dataTestId: "dashboard-needs-attention-item-disputed",
      })
    );
  }

  const submittedMilestones = [...(Array.isArray(milestones) ? milestones : [])].filter(
    (milestone) => !isMilestoneRework(milestone) && isMilestoneSubmitted(milestone)
  );
  const latestSubmittedMilestone = latestByDate(
    submittedMilestones,
    (milestone) => milestone?.submitted_at || milestone?.submitted_on || milestone?.completion_submitted_at || milestone?.updated_at || milestone?.created_at
  );
  if (latestSubmittedMilestone?.id) {
    actions.push(
      buildAction({
        key: "milestone-submitted-review",
        dedupeKey: `milestone-review:${latestSubmittedMilestone.id}`,
        title: "Review submitted work",
        description: `${countLabel(submittedMilestones.length, "milestone")} ${isAre(submittedMilestones.length)} waiting for review.`,
        buttonLabel: "Open review queue",
        navigationTarget: "/app/reviewer/queue",
        priorityScore: 74,
        category: "attention",
        source: "milestones",
        dataTestId: "dashboard-needs-attention-item-submitted_work",
      })
    );
  }

  const quoteMilestones = [...(Array.isArray(milestones) ? milestones : [])].filter((milestone) => {
    if (isMilestoneRework(milestone)) return false;
    const quoteStatus = getMilestoneQuoteStatus(milestone);
    return ["sent", "responded", "revision_requested", "accepted"].includes(quoteStatus);
  });
  const latestQuoteMilestone = latestByDate(
    quoteMilestones,
    (milestone) =>
      milestone?.subcontractor_quote_request?.updated_at ||
      milestone?.subcontractor_quote_request?.created_at ||
      milestone?.updated_at ||
      milestone?.created_at
  );
  if (latestQuoteMilestone?.id) {
    const quoteStatus = getMilestoneQuoteStatus(latestQuoteMilestone);
    const title =
      quoteStatus === "accepted" ? "Send subcontractor agreement" : "Review subcontractor quote";
    const description =
      quoteStatus === "accepted"
        ? `A quote was accepted for ${safeText(latestQuoteMilestone?.title) || "this milestone"}.`
        : `${countLabel(quoteMilestones.length, "milestone")} ${isAre(quoteMilestones.length)} waiting on a quote review.`;
    actions.push(
      buildAction({
        key: `milestone-quote:${latestQuoteMilestone.id}`,
        dedupeKey: `milestone:${latestQuoteMilestone.id}`,
        title,
        description,
        buttonLabel: "Open milestone",
        navigationTarget: `/app/milestones/${latestQuoteMilestone.id}`,
        priorityScore: quoteStatus === "accepted" ? 79 : 84,
        category: "attention",
        source: "quotes",
        dataTestId: "dashboard-next-action-quote",
      })
    );
  }

  const quoteRequiredMilestones = [...(Array.isArray(milestones) ? milestones : [])].filter((milestone) => {
    if (isMilestoneRework(milestone)) return false;
    const pricingStrategy = getMilestonePricingStrategy(milestone);
    const quoteStatus = getMilestoneQuoteStatus(milestone);
    return pricingStrategy === "requires_sub_quote" && !quoteStatus;
  });
  const latestQuoteRequiredMilestone = latestByDate(
    quoteRequiredMilestones,
    (milestone) => milestone?.updated_at || milestone?.created_at || milestone?.submitted_at
  );
  if (latestQuoteRequiredMilestone?.id) {
    const agreementId = getMilestoneAgreementId(latestQuoteRequiredMilestone);
    actions.push(
      buildAction({
        key: `milestone-quote-required:${latestQuoteRequiredMilestone.id}`,
        dedupeKey: `milestone:${latestQuoteRequiredMilestone.id}`,
        title: "Request subcontractor quote",
        description: `Pricing for ${safeText(latestQuoteRequiredMilestone?.title) || "this milestone"} still needs subcontractor pricing.`,
        buttonLabel: "Open agreement",
        navigationTarget: agreementId ? `/app/agreements/${agreementId}/wizard?step=2` : `/app/milestones/${latestQuoteRequiredMilestone.id}`,
        priorityScore: 86,
        category: "attention",
        source: "quotes",
        dataTestId: "dashboard-next-action-quote-required",
      })
    );
  }

  const remainingActivitySlots = Math.max(0, FALLBACK_ACTIVITY_LIMIT - actions.length);
  if (remainingActivitySlots > 0) {
    const activityActions = [...(Array.isArray(activityFeed) ? activityFeed : [])]
      .filter((item) => !isStatusConfirmationItem(item))
      .slice(0, remainingActivitySlots)
      .map((item, index) =>
        buildAction({
          key: `activity:${item?.id ?? index}`,
          dedupeKey: `activity:${item?.id ?? index}`,
          title: item?.title || "Open activity item",
          description: item?.summary || "Review the latest activity item.",
          buttonLabel: item?.severity === "warning" || item?.severity === "critical" ? "Review" : "Open",
          navigationTarget: item?.navigation_target || "/app/dashboard",
          priorityScore: 25 - index,
          category: "recent",
          source: "activity",
          dataTestId: `dashboard-activity-action-${item?.id ?? index}`,
        })
      );
    actions.push(...activityActions);
  }

  return sortActions(dedupeActions(actions)).slice(0, ACTION_LIMIT);
}
