import { describe, expect, it } from "vitest";

import { acceptedEstimateBasisSummary } from "./agreementEstimateHandoff.js";

describe("acceptedEstimateBasisSummary", () => {
  it("restores the immutable accepted Estimate basis after refresh", () => {
    expect(
      acceptedEstimateBasisSummary({
        accepted_estimate_basis: {
          proposal_id: 41,
          review_version: 3,
          subtotal: "15000.00",
          tax: "0.00",
          discounts: "0.00",
          incidentals_reserve: "1500.00",
          total: "16500.00",
        },
      })
    ).toMatchObject({
      proposalId: 41,
      reviewVersion: 3,
      subtotal: 15000,
      incidentals: 1500,
      total: 16500,
      reconciles: true,
    });
  });

  it("flags an accepted basis whose components no longer reconcile", () => {
    const summary = acceptedEstimateBasisSummary({
      accepted_estimate_basis: {
        proposal_id: 41,
        subtotal: "15000.00",
        incidentals_reserve: "1500.00",
        total: "15000.00",
      },
    });

    expect(summary.reconciles).toBe(false);
  });
});
