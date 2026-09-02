import { describe, expect, it } from "vitest";

import { preserveMilestoneAmounts } from "./milestoneAmountPreservation.js";

describe("preserveMilestoneAmounts", () => {
  it("preserves each amount by order when AI keeps the same phase count", () => {
    const result = preserveMilestoneAmounts(
      [{ title: "New phase 1" }, { title: "New phase 2" }],
      [{ amount: 650 }, { amount: 1350 }]
    );
    expect(result.map((row) => row.amount)).toEqual([650, 1350]);
  });

  it("preserves the exact allocated total when AI changes the phase count", () => {
    const result = preserveMilestoneAmounts(
      [{ title: "One" }, { title: "Two" }, { title: "Three" }],
      [{ amount: 1000 }, { amount: 1000 }]
    );
    expect(result.map((row) => row.amount)).toEqual([666.67, 666.67, 666.66]);
    expect(result.reduce((sum, row) => sum + row.amount, 0)).toBe(2000);
  });

  it("does not invent pricing when the existing plan has no allocation", () => {
    const result = preserveMilestoneAmounts([{ title: "One" }], [{ amount: 0 }]);
    expect(result[0]).not.toHaveProperty("amount");
  });
});
