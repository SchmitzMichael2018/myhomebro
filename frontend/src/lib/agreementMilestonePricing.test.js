import { describe, expect, it } from "vitest";
import { summarizeAcceptedEstimateAllocation } from "./agreementMilestonePricing.js";

const basis = { proposal_id: 7, subtotal: "15000.00", tax: "0", discounts: "0", incidentals_reserve: "1500", total: "16500" };

describe("accepted Estimate milestone reconciliation", () => {
  it("reports fully allocated, underallocated, and overallocated states", () => {
    expect(summarizeAcceptedEstimateAllocation(basis, 15000)).toMatchObject({ fullyAllocated: true, unallocated: 0, overallocated: 0 });
    expect(summarizeAcceptedEstimateAllocation(basis, 14350)).toMatchObject({ fullyAllocated: false, unallocated: 650, overallocated: 0 });
    expect(summarizeAcceptedEstimateAllocation(basis, 15100)).toMatchObject({ fullyAllocated: false, unallocated: 0, overallocated: 100 });
  });
  it("keeps Incidentals separate and suppresses automatic suggestions", () => {
    expect(summarizeAcceptedEstimateAllocation(basis, 14350)).toMatchObject({ commercialBase: 15000, incidentalsReserve: 1500, fundingTotal: 16500, suppressAutomaticSuggestions: true });
  });
});
