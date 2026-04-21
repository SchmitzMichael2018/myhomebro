function safeString(value) {
  return value == null ? "" : String(value).trim().toLowerCase();
}

export function normalizeStripeOnboardingStatus(value) {
  const status = safeString(value).replace(/\s+/g, "_");
  if (["not_started", "in_progress", "complete", "restricted"].includes(status)) {
    return status;
  }
  if (["completed", "connected", "ready"].includes(status)) {
    return "complete";
  }
  if (["incomplete", "pending", "unknown"].includes(status)) {
    return "in_progress";
  }
  return "not_started";
}

export function getStripeOnboardingState(payload) {
  const next = payload && typeof payload === "object" ? payload : {};
  const status = normalizeStripeOnboardingStatus(
    next.stripe_onboarding_status || next.onboarding_status || next.status
  );
  const connected = Boolean(next.connected) || status === "complete";
  const accountId = safeString(next.account_id || next.stripe_account_id);
  const resumeUrl = safeString(next.resume_url) || "/app/onboarding/stripe";

  return {
    status,
    connected,
    account_id: accountId || "",
    resume_url: resumeUrl,
    requirements_due_count: Number(next?.stripe_status?.requirements_due_count || next.requirements_due_count || 0) || 0,
    charges_enabled: Boolean(next?.stripe_status?.charges_enabled ?? next.charges_enabled),
    payouts_enabled: Boolean(next?.stripe_status?.payouts_enabled ?? next.payouts_enabled),
    details_submitted: Boolean(next?.stripe_status?.details_submitted ?? next.details_submitted),
    restricted: status === "restricted",
    inProgress:
      status === "in_progress" ||
      status === "incomplete" ||
      (Boolean(accountId) && !connected && status !== "restricted"),
    complete: connected,
    notStarted: !accountId && status === "not_started",
  };
}

export function buildStripeOnboardingGuidance(state) {
  const stripeState = getStripeOnboardingState(state);
  if (stripeState.complete) {
    return {
      tone: "success",
      complete: true,
      label: "Stripe payments are connected.",
      message: "Direct Pay invoices can be created and managed normally.",
      actionLabel: "",
      actionHref: "",
    };
  }
  if (stripeState.restricted) {
    return {
      tone: "warn",
      complete: false,
      label: "Stripe setup needs attention.",
      message: "A payment restriction is on file. Update Stripe before using pay-link workflows.",
      actionLabel: "Update payment setup",
      actionHref: stripeState.resume_url,
    };
  }
  if (stripeState.inProgress) {
    return {
      tone: "warn",
      complete: false,
      label: "Stripe onboarding is still in progress.",
      message: "You can keep working, but new pay links should wait until Stripe setup is finished.",
      actionLabel: "Resume payment setup",
      actionHref: stripeState.resume_url,
    };
  }
  return {
    tone: "warn",
    complete: false,
    label: "Payments are not set up yet.",
    message: "Complete Stripe setup before creating Direct Pay links or starting payment workflows.",
    actionLabel: "Start Stripe setup",
    actionHref: stripeState.resume_url,
  };
}
