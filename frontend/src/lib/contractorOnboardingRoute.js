import api from "../api";

const REQUIRED_STEPS = new Set(["welcome", "region", "stripe", "complete"]);

export function normalizeRequiredOnboarding(data = {}) {
  const businessName = String(data.business_name || "").trim();
  const tradeCount = Number(data.trade_count || 0);
  const serviceRegion = String(data.service_region_label || "").trim();
  const explicitComplete =
    typeof data.required_onboarding_complete === "boolean"
      ? data.required_onboarding_complete
      : null;
  const requiredComplete =
    explicitComplete ??
    Boolean(data.profile_basics_complete && businessName && tradeCount > 0);

  let step = String(data.step || "").trim().toLowerCase();
  if (!REQUIRED_STEPS.has(step)) {
    step =
      !businessName || tradeCount < 1
        ? "welcome"
        : !serviceRegion
          ? "region"
          : "stripe";
  }

  return { requiredComplete, step, snapshot: data };
}

export async function loadRequiredOnboarding() {
  const { data } = await api.get("/projects/contractors/onboarding/");
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid contractor onboarding response.");
  }
  return normalizeRequiredOnboarding(data);
}

export async function resolveAuthenticatedEntry(identity) {
  const role = String(
    identity?.identity_type || identity?.type || identity?.role || ""
  ).toLowerCase();

  if (role === "admin") return "/app/admin";
  if (role === "subaccount" || role === "internal_team_member") {
    return "/app/employee/dashboard";
  }
  if (role === "subcontractor") return "/app/subcontractor/assigned-work";
  if (role === "homeowner") return "/portal";
  if (role === "contractor" || role === "contractor_owner") {
    const onboarding = await loadRequiredOnboarding();
    return onboarding.requiredComplete ? "/app/dashboard" : "/onboarding";
  }
  return "";
}
