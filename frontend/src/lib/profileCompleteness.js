const WEIGHTS = {
  business_info:          20,
  trade_profile:          15,
  project_path:           10,
  service_area:           10,
  stripe_connect:         20,
  first_job_or_template:  10,
  license:                 8,
  logo:                    4,
  team_members:            3,
};

// Total: 100

const VALUE_REASONS = {
  stripe_connect:
    "Connect your bank to start receiving payments — required before any payment is sent.",
  business_info:
    "Your business name and contact info appear on every agreement.",
  trade_profile:
    "Trades drive template matching, compliance guidance, and pricing suggestions.",
  service_area:
    "Your service area shapes which templates and market data are most relevant.",
  first_job_or_template:
    "Your first job or template activates the full AI workflow.",
  license:
    "License info is required for compliance checks on permitted work.",
  logo:
    "Your logo appears on customer-facing agreements and invoices.",
  project_path:
    "Residential vs commercial sets the right rules for every workflow.",
  team_members:
    "Team members can be assigned to milestones for scheduling.",
};

/**
 * Calculate a 0–100 completeness score for a contractor profile.
 *
 * @param {object} profile  - contractor profile from GET /projects/contractors/me/
 * @param {object} extras   - { stripeConnected, templateCount, jobCount }
 * @returns {{ score, highestValueMissing, missingItems }}
 */
export function calculateProfileCompleteness(profile = {}, extras = {}) {
  const {
    stripeConnected = false,
    templateCount = 0,
    jobCount = 0,
  } = extras;

  let score = 0;
  const missing = [];

  function check(key, done) {
    if (done) {
      score += WEIGHTS[key] || 0;
    } else {
      missing.push({
        key,
        points: WEIGHTS[key] || 0,
        valueReason: VALUE_REASONS[key] || "",
      });
    }
  }

  check("business_info",         !!String(profile.business_name || "").trim());
  check("trade_profile",         Array.isArray(profile.skills) && profile.skills.length > 0);
  check("project_path",          !!(profile.preferred_project_path || profile.project_path));
  check("service_area",          !!(profile.city || profile.state));
  check("stripe_connect",        stripeConnected);
  check("first_job_or_template", Number(jobCount) > 0 || Number(templateCount) > 0);
  check("license",               !!(profile.license_number || profile.license));
  check("logo",                  !!(profile.logo || profile.logo_url));
  check("team_members",          Number(profile.team_count || 0) > 0);

  missing.sort((a, b) => b.points - a.points);

  return {
    score:               Math.min(100, score),
    highestValueMissing: missing[0] || null,
    missingItems:        missing,
  };
}
