export const ONBOARDING_STEPS = {
  BUSINESS_INFO:    "business_info",
  TRADE_PROFILE:    "trade_profile",
  PROJECT_PATH:     "project_path",
  SERVICE_AREA:     "service_area",
  STRIPE_CONNECT:   "stripe_connect",
  FIRST_TEMPLATE:   "first_template",
  LOGO:             "logo",
  LICENSE:          "license",
  TEAM_MEMBERS:     "team_members",
  SUBCONTRACTORS:   "subcontractors",
};

// Core steps required in session 1
export const CORE_STEPS = [
  ONBOARDING_STEPS.BUSINESS_INFO,
  ONBOARDING_STEPS.TRADE_PROFILE,
  ONBOARDING_STEPS.PROJECT_PATH,
  ONBOARDING_STEPS.SERVICE_AREA,
];

// Progressive steps surfaced over time
export const PROGRESSIVE_STEPS = [
  ONBOARDING_STEPS.LICENSE,
  ONBOARDING_STEPS.TEAM_MEMBERS,
  ONBOARDING_STEPS.SUBCONTRACTORS,
  ONBOARDING_STEPS.LOGO,
];

export const LAST_LOGIN_KEY = "mhb_last_login_ts";

export function recordLoginTimestamp() {
  try {
    localStorage.setItem(LAST_LOGIN_KEY, String(Date.now()));
  } catch {
    // ignore storage failures
  }
}

export function getDaysSinceLastLogin() {
  try {
    const ts = Number(localStorage.getItem(LAST_LOGIN_KEY) || 0);
    if (!ts) return 0;
    return Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
}

/**
 * Determines what experience to show a contractor on login / app load.
 * contractor_onboarding_status !== "complete" and jobCount=0 → first login
 * contractor_onboarding_status !== "complete" (has some jobs) → resume
 * daysSinceLastLogin >= 7 → welcome back
 * otherwise → daily briefing
 *
 * Uses contractor_onboarding_status from GET /projects/contractors/me/ which returns
 * "not_started" | "in_progress" | "complete" (no boolean onboarding_complete field exists).
 */
export function detectLoginExperience(contractorProfile, jobCount, daysSinceLastLogin) {
  const hasProfile = contractorProfile && typeof contractorProfile === "object";
  const complete = hasProfile ? contractorProfile.contractor_onboarding_status === "complete" : false;
  const count = Number(jobCount) || 0;
  if (!complete && count === 0) return "first_login";
  if (!complete) return "resume_onboarding";
  if (Number(daysSinceLastLogin) >= 7) return "welcome_back";
  return "daily_briefing";
}

/**
 * Returns the first CORE_STEP that is not yet satisfied by the profile,
 * or null if all core steps are done.
 */
export function getFirstIncompleteStep(profile = {}, stripeConnected = false) {
  if (!String(profile.business_name || "").trim()) return ONBOARDING_STEPS.BUSINESS_INFO;
  if (!Array.isArray(profile.skills) || !profile.skills.length) return ONBOARDING_STEPS.TRADE_PROFILE;
  if (!profile.city && !profile.state) return ONBOARDING_STEPS.SERVICE_AREA;
  if (!stripeConnected) return ONBOARDING_STEPS.STRIPE_CONNECT;
  return null;
}
