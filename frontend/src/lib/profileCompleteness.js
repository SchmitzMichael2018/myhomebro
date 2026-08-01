const REQUIRED_PROFILE_ITEMS = [
  { key: "contact_name", label: "Contact name", complete: (profile) => hasText(profile.full_name) || hasText(profile.first_name) },
  { key: "business_name", label: "Business name", complete: (profile) => hasText(profile.business_name) },
  { key: "email", label: "Email", complete: (profile) => hasText(profile.email || profile.user?.email) },
  { key: "phone", label: "Phone", complete: (profile) => hasText(profile.phone) },
  {
    key: "business_address",
    label: "Business address",
    complete: (profile) => [profile.address || profile.address_line1, profile.city, profile.state, profile.zip || profile.zip_code].every(hasText),
  },
  { key: "service_area", label: "Service area", complete: (profile) => Number(profile.service_radius_miles) > 0 },
  { key: "trade_profile", label: "Trade profile", complete: (profile) => Array.isArray(profile.skills) && profile.skills.length > 0 },
];

const PROFILE_VALUE_REASONS = {
  contact_name: "Add the name customers should use when contacting you.",
  business_name: "Your business name appears on customer-facing work.",
  email: "Customers and account notices need a reliable email address.",
  phone: "A business phone number helps customers reach you.",
  business_address: "A complete address supports documents and local matching.",
  service_area: "Your service range helps MyHomeBro match relevant work.",
  trade_profile: "Trades explain the services your business provides.",
};

function hasText(value) {
  return Boolean(String(value || "").trim());
}

function licenseIsRequired(profile) {
  const requirements = Array.isArray(profile.compliance_trade_requirements)
    ? profile.compliance_trade_requirements
    : [];
  return requirements.some((item) =>
    item?.license_required === true || item?.requires_license === true || item?.requirement_type === "license"
  );
}

export function calculateProfileCompleteness(profile = {}) {
  const canonical = profile.profile_completeness;
  if (canonical && Number.isFinite(Number(canonical.score)) && Array.isArray(canonical.items)) {
    const items = canonical.items.map((item) => ({ ...item }));
    const missingItems = items.filter((item) => item.state === "incomplete");
    return {
      score: Number(canonical.score),
      items,
      requiredCount: Number(canonical.required_count || items.filter((item) => item.required).length),
      completedRequired: Number(canonical.completed_required || items.filter((item) => item.required && item.state === "complete").length),
      highestValueMissing: missingItems[0] || null,
      missingItems,
    };
  }
  const items = REQUIRED_PROFILE_ITEMS.map((definition) => {
    const complete = definition.complete(profile);
    return {
      key: definition.key,
      label: definition.label,
      required: true,
      state: complete ? "complete" : "incomplete",
      valueReason: PROFILE_VALUE_REASONS[definition.key],
    };
  });

  const requiredLicense = licenseIsRequired(profile);
  const hasLicense = hasText(profile.license_number);
  items.push({
    key: "license",
    label: "License information",
    required: requiredLicense,
    state: hasLicense ? "complete" : requiredLicense ? "incomplete" : "optional",
    valueReason: requiredLicense ? "Licensing is required for the selected trade and jurisdiction." : "Add if applicable to your trade.",
  });
  items.push({
    key: "logo",
    label: "Company logo",
    required: false,
    state: profile.logo || profile.logo_url ? "complete" : "recommended",
    valueReason: "Recommended for customer-facing documents and your public profile.",
  });
  items.push({
    key: "business_description",
    label: "Business description",
    required: false,
    state: hasText(profile.public_profile?.bio || profile.business_description) ? "complete" : "recommended",
    valueReason: "Recommended to help customers understand your business.",
  });

  const requiredItems = items.filter((item) => item.required);
  const completedRequired = requiredItems.filter((item) => item.state === "complete").length;
  const score = requiredItems.length ? Math.round((completedRequired / requiredItems.length) * 100) : 100;
  const missingItems = items.filter((item) => item.state === "incomplete");

  return {
    score,
    items,
    requiredCount: requiredItems.length,
    completedRequired,
    highestValueMissing: missingItems[0] || null,
    missingItems,
  };
}

export function buildBusinessLaunchChecklist(profile = {}, activity = {}) {
  profile = profile || {};
  const paymentReady = Boolean(
    profile.details_submitted &&
    profile.charges_enabled &&
    profile.payouts_enabled &&
    Number(profile.requirements_due_count || 0) === 0
  );
  const publicProfilePublished = Boolean(profile.public_profile?.is_public || profile.public_profile?.published_at);

  return [
    { key: "first_estimate", label: "Create your first estimate", complete: Number(activity.estimateCount) > 0, optional: false, route: "/app/estimates?create=estimate" },
    { key: "template", label: "Choose a reusable template", complete: Number(activity.templateCount) > 0, optional: false, route: "/app/templates" },
    { key: "customer", label: "Add your first customer", complete: Number(activity.customerCount) > 0, optional: false, route: "/app/customers" },
    { key: "team", label: "Invite a team member", complete: Number(activity.teamCount) > 0, optional: true, route: "/app/team" },
    { key: "public_profile", label: "Publish your public profile", complete: publicProfilePublished, optional: true, route: "/app/marketing" },
    { key: "payments", label: "Connect payments", complete: paymentReady, optional: true, route: "/app/onboarding/stripe" },
  ];
}
