import { describe, expect, it } from "vitest";
import { buildMilestoneAllocations, getTemplatePricingState } from "./templatePricingState.js";

describe("template pricing state", () => {
  it("distinguishes selection, basis-needed, and applied pricing", () => {
    const template = { id: 1, name: "Bath", milestones: [{ id: 2, title: "Demo", suggested_amount_percent: "25" }] };
    expect(getTemplatePricingState({ template, proposal: {} }).status).toBe("pricing_basis_needed");
    expect(getTemplatePricingState({ template, proposal: { pricing_template_name: "Bath" } }).status).toBe("pricing_applied");
  });

  it("uses the contractor subtotal without silently normalizing percentages", () => {
    const rows = buildMilestoneAllocations({ milestones: [
      { id: 1, title: "A", suggested_amount_percent: "40" },
      { id: 2, title: "B", suggested_amount_percent: "50" },
    ] }, 20000);
    expect(rows.map((row) => row.amount)).toEqual([8000, 10000]);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(18000);
  });
});
