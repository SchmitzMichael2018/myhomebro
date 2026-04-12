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

export function normalizeProjectClass(value) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "commercial") return "commercial";
  return "residential";
}

export function normalizePaymentStructure(value) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "progress") return "progress";
  return "simple";
}

export function extractAiCredits(meData) {
  const ai = meData?.ai || {};
  return {
    access: ai.access || "included",
    enabled: ai.enabled !== false,
    unlimited: ai.unlimited !== false,
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
