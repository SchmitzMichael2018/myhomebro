// frontend/src/components/step1/step1Utils.jsx

export function safeTrim(s) {
  return (s || "").toString().trim();
}

export function isBlank(v) {
  return v == null || String(v).trim() === "";
}

export function computeCustomerAddressMissing(customer) {
  const missing = [];
  if (!customer || isBlank(customer.street_address)) missing.push("street_address");
  if (!customer || isBlank(customer.city)) missing.push("city");
  if (!customer || isBlank(customer.state)) missing.push("state");
  if (!customer || isBlank(customer.zip_code)) missing.push("zip_code");
  return missing;
}

export function niceCustomerFieldLabel(f) {
  const map = {
    street_address: "Street Address",
    city: "City",
    state: "State",
    zip_code: "ZIP Code",
  };
  return map[f] || f;
}

export function customerDisplayName(cust) {
  if (!cust) return "Customer";
  const company = safeTrim(cust.company_name);
  const contact = safeTrim(cust.full_name) || safeTrim(cust.name);
  if (company && contact) return `${company} (${contact})`;
  if (company) return company;
  if (contact) return contact;
  return "Customer";
}

export function normalizePaymentMode(value) {
  const s = String(value || "").trim().toLowerCase();
  if (!s) return "escrow";
  if (s.includes("direct")) return "direct";
  return "escrow";
}

export function extractAiCredits(meData) {
  if (!meData) {
    return { remaining: null, total: null, used: null, enabled: false };
  }

  const aw =
    meData?.ai?.agreement_writer ||
    meData?.ai_agreement_writer ||
    meData?.aiAgreementWriter ||
    null;

  const remaining =
    meData?.ai?.credits_remaining ??
    meData?.ai?.creditsRemaining ??
    aw?.free_remaining ??
    aw?.freeRemaining ??
    null;

  const total =
    meData?.ai?.credits_total ??
    meData?.ai?.creditsTotal ??
    aw?.free_total ??
    aw?.freeTotal ??
    null;

  const used =
    aw?.free_used ??
    aw?.freeUsed ??
    (total != null && remaining != null
      ? Math.max(0, Number(total) - Number(remaining))
      : null);

  const enabled =
    aw?.enabled === true ||
    meData?.ai?.enabled === true ||
    (remaining != null && Number(remaining) > 0);

  return {
    remaining: remaining == null ? null : Number(remaining),
    total: total == null ? null : Number(total),
    used: used == null ? null : Number(used),
    enabled: !!enabled,
  };
}

export function isAgreementLocked(agreement) {
  if (!agreement) return false;
  if (agreement.is_locked === true) return true;
  if (agreement.signature_is_satisfied === true) return true;
  if (agreement.is_fully_signed === true) return true;
  if (agreement.signed_by_contractor === true || agreement.signed_by_homeowner === true) return true;
  return false;
}

export function sortTemplates(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const aSystem = a?.is_system ? 1 : 0;
    const bSystem = b?.is_system ? 1 : 0;
    if (aSystem !== bSystem) return bSystem - aSystem;
    return String(a?.name || "").localeCompare(String(b?.name || ""));
  });
}