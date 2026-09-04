import { describe, expect, it } from "vitest";

import { isInvoiceFinalized } from "./SendInvoiceButton";

describe("isInvoiceFinalized", () => {
  it("hides send actions for paid and escrow-released invoices", () => {
    expect(isInvoiceFinalized({ status: "paid" })).toBe(true);
    expect(isInvoiceFinalized({ status: "pending", escrow_released: true })).toBe(true);
  });

  it("keeps send actions available for pending invoices", () => {
    expect(isInvoiceFinalized({ status: "pending", escrow_released: false })).toBe(false);
  });
});
