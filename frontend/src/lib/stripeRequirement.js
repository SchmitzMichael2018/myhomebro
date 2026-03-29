export function isStripeRequirementPayload(payload) {
  return (
    payload &&
    typeof payload === "object" &&
    payload.code === "STRIPE_ONBOARDING_REQUIRED" &&
    payload.requirement_type === "stripe_connect"
  );
}

export function dispatchStripeRequirement(payload) {
  if (!isStripeRequirementPayload(payload) || typeof window === "undefined") {
    return false;
  }
  window.dispatchEvent(
    new CustomEvent("mhb:stripe_requirement", {
      detail: payload,
    })
  );
  return true;
}

export function handleStripeRequirementError(error, fallbackMessage = "") {
  const payload = error?.response?.data;
  if (error?.response?.status === 409 && dispatchStripeRequirement(payload)) {
    return {
      handled: true,
      message: payload?.message || payload?.detail || fallbackMessage || "",
      payload,
    };
  }
  return {
    handled: false,
    message:
      payload?.detail ||
      payload?.error ||
      payload?.message ||
      fallbackMessage ||
      "Unable to complete this payment action right now.",
    payload,
  };
}
