const STORAGE_PREFIX = "mhb_subcontractor_pricing_plan";

function safeAgreementKey(agreementId) {
  return agreementId != null && String(agreementId).trim() ? String(agreementId).trim() : "new";
}

function storageKey(agreementId) {
  return `${STORAGE_PREFIX}_${safeAgreementKey(agreementId)}`;
}

function safeParse(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function loadSubcontractorPricingPlan(agreementId) {
  if (typeof window === "undefined") return {};
  try {
    return safeParse(window.sessionStorage.getItem(storageKey(agreementId)));
  } catch {
    return {};
  }
}

export function saveSubcontractorPricingPlan(agreementId, plan) {
  if (typeof window === "undefined") return {};
  const next = plan && typeof plan === "object" ? plan : {};
  try {
    window.sessionStorage.setItem(storageKey(agreementId), JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
  return next;
}

export function setMilestonePricingPlan(agreementId, milestoneId, patch = {}) {
  const current = loadSubcontractorPricingPlan(agreementId);
  const next = {
    ...current,
    [String(milestoneId)]: {
      ...(current?.[String(milestoneId)] || {}),
      ...(patch && typeof patch === "object" ? patch : {}),
    },
  };
  return saveSubcontractorPricingPlan(agreementId, next);
}

export function clearMilestonePricingPlan(agreementId, milestoneId) {
  const current = loadSubcontractorPricingPlan(agreementId);
  const next = { ...current };
  delete next[String(milestoneId)];
  return saveSubcontractorPricingPlan(agreementId, next);
}

export function getMilestonePricingPlan(agreementId, milestoneId) {
  const plan = loadSubcontractorPricingPlan(agreementId);
  return plan?.[String(milestoneId)] || null;
}

export function summarizeMilestonePricingPlan(agreementId, milestones = [], agreementPricingStrategy = "fixed") {
  const rows = Array.isArray(milestones) ? milestones : [];
  const plan = loadSubcontractorPricingPlan(agreementId);

  let fixedCount = 0;
  let estimatedCount = 0;
  let pendingQuoteCount = 0;

  rows.forEach((milestone) => {
    const rowPlan = plan?.[String(milestone?.id)] || {};
    const planMode = String(rowPlan?.assignmentMode || "").toLowerCase();
    const quoteStatus = String(rowPlan?.quoteStatus || "").toLowerCase();

    if (quoteStatus === "requested" || quoteStatus === "received") {
      pendingQuoteCount += 1;
      return;
    }

    if (planMode === "fixed") {
      fixedCount += 1;
      return;
    }

    if (planMode === "quote") {
      pendingQuoteCount += quoteStatus === "received" ? 0 : 1;
      return;
    }

    if (planMode === "later") {
      estimatedCount += 1;
      return;
    }

    if (String(agreementPricingStrategy).toLowerCase() === "estimate") {
      estimatedCount += 1;
    }
  });

  return {
    fixedCount,
    estimatedCount,
    pendingQuoteCount,
    plan,
  };
}
