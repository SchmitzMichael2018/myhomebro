import { describe, expect, it } from "vitest";

import { buildMilestoneScheduleConflictReview } from "./Step4Finalize.jsx";

describe("buildMilestoneScheduleConflictReview", () => {
  it("ignores stale planning assumptions and accepts milestones in date order", () => {
    const review = buildMilestoneScheduleConflictReview([
      { title: "Demolition", start_date: "2026-09-07", due_date: "2026-09-07" },
      { title: "Prep", start_date: "2026-09-08", due_date: "2026-09-08" },
      { title: "Tile", start_date: "2026-09-09", due_date: "2026-09-09" },
      { title: "Fixtures", start_date: "2026-09-10", due_date: "2026-09-10" },
      { title: "Cleanup", start_date: "2026-09-11", due_date: "2026-09-11" },
    ]);

    expect(review).toEqual({ issues: [], needsAttention: false, summary: "" });
  });

  it("reports only concrete milestone date conflicts", () => {
    const review = buildMilestoneScheduleConflictReview([
      { title: "Demolition", start_date: "2026-09-08", due_date: "2026-09-07" },
      { title: "Prep", start_date: "2026-09-06", due_date: "2026-09-09" },
      { title: "Cleanup" },
    ]);

    expect(review.needsAttention).toBe(true);
    expect(review.issues).toEqual([
      "Demolition ends before it starts",
      "Prep is scheduled before the preceding milestone",
      "Cleanup does not have a scheduled date",
    ]);
  });
});
