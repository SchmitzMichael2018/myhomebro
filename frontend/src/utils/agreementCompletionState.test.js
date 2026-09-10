import { describe, expect, it } from "vitest";

import { getAgreementCompletionState } from "./agreementCompletionState.js";

describe("getAgreementCompletionState", () => {
  it("reports fully completed and paid when billable work is paid and zero-dollar rework is complete", () => {
    const result = getAgreementCompletionState(
      [
        { id: 1, completed: true, amount: "400.00", invoice_id: 11 },
        { id: 2, completed: true, amount: "200.00", invoice_id: 12 },
        { id: 3, completed: true, amount: "0.00", rework_origin_milestone_id: 1 },
      ],
      {
        11: { id: 11, status: "paid" },
        12: { id: 12, status: "approved", escrow_released: true },
      }
    );

    expect(result.fullyCompletedAndPaid).toBe(true);
    expect(result.paidBillableCount).toBe(2);
    expect(result.billableCount).toBe(2);
  });

  it("reports work complete without financial closeout while an invoice is pending", () => {
    const result = getAgreementCompletionState(
      [{ id: 1, completed: true, amount: "400.00", invoice_id: 11 }],
      { 11: { id: 11, status: "pending" } }
    );

    expect(result.allWorkComplete).toBe(true);
    expect(result.fullyCompletedAndPaid).toBe(false);
  });
});
