function present(value) {
  return Boolean(String(value || "").trim());
}

export function buildCustomerFormStatus(form = {}, { isSaving = false, hasSaveError = false } = {}) {
  const emailPresent = present(form.email);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(form.email || "").trim());
  const phoneDigits = String(form.phone_number || "").replace(/\D/g, "");
  const phoneValid = phoneDigits.length === 10 || (phoneDigits.length === 11 && phoneDigits.startsWith("1"));
  const zip = String(form.zip_code || "").trim();
  const zipValid = !zip || /^\d{5}(-\d{4})?$/.test(zip);
  const addressParts = [form.street_address, form.city, form.state];
  const addressPresentCount = addressParts.filter(present).length;
  const address = addressPresentCount === 0
    ? "missing"
    : addressPresentCount < addressParts.length
      ? "incomplete"
      : !zipValid
        ? "invalid"
        : "complete";

  return {
    company_name: present(form.company_name) ? "complete" : "optional_empty",
    full_name: present(form.full_name) ? "complete" : "missing",
    email: !emailPresent ? "missing" : emailValid ? "complete" : "invalid",
    phone: !present(form.phone_number) ? "missing" : phoneValid ? "complete" : "invalid",
    address,
    address_line_2: present(form.address_line_2) ? "complete" : "optional_empty",
    status: present(form.status) ? "complete" : "missing",
    status_label: form.status === "active" ? "Active" : form.status === "prospect" ? "Prospect" : "Archived",
    lifecycle: isSaving ? "creating" : hasSaveError ? "error" : "unsaved",
  };
}

export function resolveCustomerNextAction(formStatus = {}) {
  if (formStatus.lifecycle === "creating") return { label: "Creating customer...", disabled: true };
  if (formStatus.full_name !== "complete") return { label: "Add the customer’s name", actionKey: "focus_customer_full_name" };
  if (formStatus.email !== "complete") return { label: formStatus.email === "invalid" ? "Add a valid email address" : "Add the customer’s email", actionKey: "focus_customer_email" };
  if (formStatus.phone !== "complete") return { label: formStatus.phone === "invalid" ? "Add a valid phone number" : "Add the customer’s phone", actionKey: "focus_customer_phone" };
  if (formStatus.address !== "complete") return { label: "Complete the service address", actionKey: "focus_customer_address" };
  return { label: "Review and create customer", actionKey: "review_customer_form" };
}

