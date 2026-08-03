import { describe, expect, it } from "vitest";

import { buildCustomerFormStatus, resolveCustomerNextAction } from "./customerCreateAssistant.js";

const emptyForm = { company_name: "", full_name: "", email: "", phone_number: "", street_address: "", address_line_2: "", city: "", state: "", zip_code: "", status: "active" };

describe("customer create assistant form state", () => {
  it("summarizes only field state and treats company name as optional", () => {
    const status = buildCustomerFormStatus(emptyForm);
    expect(status).toMatchObject({ company_name: "optional_empty", full_name: "missing", email: "missing", phone: "missing", address: "missing", status_label: "Active", lifecycle: "unsaved" });
    expect(status).not.toHaveProperty("email_value");
  });

  it("distinguishes invalid, partial, and complete fields", () => {
    expect(buildCustomerFormStatus({ ...emptyForm, email: "bad", street_address: "1 Main" })).toMatchObject({ email: "invalid", address: "incomplete" });
    expect(buildCustomerFormStatus({ ...emptyForm, full_name: "QA Homeowner", email: "qa@example.com", phone_number: "5555551212", street_address: "1 Main", city: "Austin", state: "TX", zip_code: "78701" })).toMatchObject({ full_name: "complete", email: "complete", phone: "complete", address: "complete" });
  });

  it("resolves a specific local action without customer navigation", () => {
    expect(resolveCustomerNextAction(buildCustomerFormStatus(emptyForm))).toMatchObject({ actionKey: "focus_customer_full_name" });
    const ready = buildCustomerFormStatus({ ...emptyForm, full_name: "QA Homeowner", email: "qa@example.com", phone_number: "5555551212", street_address: "1 Main", city: "Austin", state: "TX" });
    expect(resolveCustomerNextAction(ready)).toEqual({ label: "Review and create customer", actionKey: "review_customer_form" });
  });
});
