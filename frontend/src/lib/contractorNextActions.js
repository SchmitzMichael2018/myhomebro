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

function normalizeSource(value) {
  return safeText(value).toLowerCase();
}

function isWebsiteLeadRow(row) {
  const source = normalizeSource(row?.lead_source || row?.source);
  const sourceFilter = normalizeSource(row?.lead_source_filter);
  return Boolean(row?.is_website_lead) ||
    ["website", "website_leads", "public_profile", "qr"].includes(sourceFilter) ||
    ["quote_request", "landing_page", "public_profile", "qr"].includes(source);
}

function isUnhandledLeadStatus(row) {
  const status = normalizeStatus(row?.status);
  const stage = normalizeStatus(row?.workspace_stage);
  return (
    ["new", "submitted", "pending", "follow_up"].includes(status) ||
    ["new_lead", "follow_up"].includes(stage)
  );
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
  category = "operations",
  source = "",
  dataTestId = "",
  actionType = "",
  reason = "",
  estimatedEffort = "2 minutes",
  blocking = false,
}) {
  const recommendedUrl = safeText(navigationTarget) || "/app/dashboard";
  const normalizedPriority = safeNumber(priorityScore);
  const normalizedActionType = safeText(actionType) || safeText(key).split(":")[0] || "open_work_item";
  return {
    key,
    dedupeKey: safeText(dedupeKey),
    title: safeText(title),
    description: safeText(description),
    buttonLabel: safeText(buttonLabel) || "Open",
    navigationTarget: recommendedUrl,
    priorityScore: normalizedPriority,
    category,
    source,
    dataTestId,
    action_type: normalizedActionType,
    priority_score: normalizedPriority,
    reason: safeText(reason) || safeText(description),
    estimated_effort: safeText(estimatedEffort) || "2 minutes",
    recommended_url: recommendedUrl,
    blocking: Boolean(blocking),
  };
}

function sortActions(actions) {
  return [...actions].sort((left, right) => {
    const diff = safeNumber(right.priority_score ?? right.priorityScore) - safeNumber(left.priority_score ?? left.priorityScore);
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
    category: nextBestAction.blocking_issue ? "operations" : "project",
    source: nextBestAction.source_system || "activity",
    dataTestId: "dashboard-next-best-action-primary",
    actionType: nextBestAction.action_type || "next_best_action",
    reason: nextBestAction.reason || nextBestAction.message,
    estimatedEffort: nextBestAction.estimated_effort || "3 minutes",
    blocking: Boolean(nextBestAction.blocking_issue),
  });
}

export function getContractorNextActions({
  nextBestAction = null,
  agreements = [],
  milestones = [],
  invoices = [],
  drawRequests = [],
  publicLeads = [],
  activityFeed = [],
} = {}) {
  const actions = [];

  const mappedNextBestAction = mapNextBestAction(nextBestAction);
  if (mappedNextBestAction) {
    actions.push(mappedNextBestAction);
  }

  const latestWebsiteLead = latestByDate(
    (Array.isArray(publicLeads) ? publicLeads : []).filter((row) => isWebsiteLeadRow(row) && isUnhandledLeadStatus(row)),
    (row) => row?.submitted_at || row?.created_at || row?.updated_at
  );
  if (latestWebsiteLead) {
    const leadId = latestWebsiteLead?.source_id || latestWebsiteLead?.record_id || latestWebsiteLead?.id || latestWebsiteLead?.bid_id || "latest";
    const customerName = safeText(
      latestWebsiteLead?.customer_name ||
      latestWebsiteLead?.full_name ||
      latestWebsiteLead?.name
    ) || "a customer";
    const projectType = safeText(latestWebsiteLead?.project_type || latestWebsiteLead?.request_snapshot?.project_type);
    const sourceFilter = normalizeSource(latestWebsiteLead?.lead_source_filter) || "website";
    actions.push(
      buildAction({
        key: `website-lead:${leadId}`,
        dedupeKey: `website-lead:${leadId}`,
        title: "New Website Lead",
        description: projectType
          ? `${customerName} requested ${projectType}.`
          : `${customerName} submitted a new request.`,
        buttonLabel: "Review Lead",
        navigationTarget: `/app/opportunities?source=${sourceFilter}`,
        priorityScore: 100,
        category: "lead",
        source: "website_leads",
        actionType: "review_website_lead",
        reason: projectType
          ? `${customerName} requested help with ${projectType}. Fast responses improve close rate.`
          : `${customerName} submitted a website lead. Fast responses improve close rate.`,
        estimatedEffort: "2 minutes",
        blocking: true,
      })
    );
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
        priorityScore: 87,
        category: "project",
        source: "agreements",
        actionType: "send_draft_agreement",
        reason: "Sending the draft keeps the customer moving toward signature.",
        estimatedEffort: "5 minutes",
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
        priorityScore: 86,
        category: "project",
        source: "agreements",
        dataTestId: "dashboard-needs-attention-item-awaiting_signature",
        actionType: "follow_up_signature",
        reason: "Signed agreements unlock scheduled work and payment setup.",
        estimatedEffort: "3 minutes",
        blocking: true,
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
        priorityScore: 82,
        category: "money",
        source: "payments",
        dataTestId: "dashboard-needs-attention-item-awaiting_funding",
        actionType: "collect_escrow_funding",
        reason: "Funding protects the work before active milestones begin.",
        estimatedEffort: "4 minutes",
        blocking: true,
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
        navigationTarget: "/app/payments?money_status=pending_approval",
        priorityScore: 78,
        category: "money",
        source: "invoices",
        dataTestId: "dashboard-needs-attention-item-pending_approval",
        actionType: "review_invoice_approval",
        reason: "Payment approvals keep cash moving and prevent project stalls.",
        estimatedEffort: "3 minutes",
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
        priorityScore: 80,
        category: "money",
        source: "invoices",
        actionType: "release_escrow_payment",
        reason: "Approved funds are ready for the next payment step.",
        estimatedEffort: "2 minutes",
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
        navigationTarget: "/app/payments?money_status=issues",
        priorityScore: 84,
        category: "money",
        source: "invoices",
        dataTestId: "dashboard-needs-attention-item-disputed",
        actionType: "resolve_payment_issue",
        reason: "Resolving payment issues protects the customer relationship and payout timing.",
        estimatedEffort: "10 minutes",
        blocking: true,
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
        priorityScore: 72,
        category: "project",
        source: "milestones",
        dataTestId: "dashboard-needs-attention-item-submitted_work",
        actionType: "review_submitted_work",
        reason: "Reviewed work can move to approval, invoicing, or completion.",
        estimatedEffort: "5 minutes",
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
        priorityScore: quoteStatus === "accepted" ? 91 : 92,
        category: "customer",
        source: "quotes",
        dataTestId: "dashboard-next-action-quote",
        actionType: quoteStatus === "accepted" ? "send_subcontractor_agreement" : "review_quote_response",
        reason: quoteStatus === "accepted"
          ? "Turn the accepted quote into an agreement before the schedule slips."
          : "A quote response is waiting and may affect the estimate timeline.",
        estimatedEffort: "4 minutes",
        blocking: true,
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
        priorityScore: 92,
        category: "customer",
        source: "quotes",
        dataTestId: "dashboard-next-action-quote-required",
        actionType: "request_quote_response",
        reason: "The customer estimate cannot move forward cleanly until pricing is confirmed.",
        estimatedEffort: "5 minutes",
        blocking: true,
      })
    );
  }

  const remainingActivitySlots = Math.max(0, FALLBACK_ACTIVITY_LIMIT - actions.length);
  if (remainingActivitySlots > 0) {
    const activityActions = [...(Array.isArray(activityFeed) ? activityFeed : [])]
      .filter((item) => !isStatusConfirmationItem(item))
      .filter((item) => safeText(item?.navigation_target) && safeText(item?.navigation_target) !== "/app/dashboard")
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
          category: normalizeStatus(item?.severity) === "critical" ? "operations" : "customer",
          source: "activity",
          dataTestId: `dashboard-activity-action-${item?.id ?? index}`,
          actionType: "review_customer_activity",
          reason: item?.summary || "Recent activity may need a response.",
          estimatedEffort: "2 minutes",
        })
      );
    actions.push(...activityActions);
  }

  return sortActions(dedupeActions(actions)).slice(0, ACTION_LIMIT);
}
