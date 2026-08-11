import { describe, expect, it } from "vitest";
import { buildAiScopePatch, mergeAiScopeFields } from "./agreementScopeMutation.js";

describe("Agreement AI scope mutation boundary", () => {
  it("preserves accepted Estimate financial and milestone state", () => {
    const current = { description: "Old", total_cost: "15000.00", incidentals_reserve_amount: "1500.00", milestones: [{ id: 1, amount: "15000.00" }], selected_template_id: 9 };
    expect(mergeAiScopeFields(current, { description: "New", scope_of_work: "New", total_cost: "0", incidentals_reserve_amount: "0", milestones: [], selected_template_id: null })).toEqual({ ...current, description: "New", scope_of_work: "New" });
  });
  it("builds a scope-only PATCH from a broad response", () => {
    expect(buildAiScopePatch({ description: "Scope", assumptions: "Access available", tax: 0, payment_structure: "simple" })).toEqual({ description: "Scope", assumptions: "Access available" });
  });
});
