import { describe, expect, it } from "vitest";
import { estimateMatchesStage, estimateNextPriority, estimateQueueStage, estimateStageCounts } from "./estimateQueue.js";

describe("estimate queue lifecycle mapping", () => {
  const expected = {
    draft: "needs_estimate", site_visit: "in_progress", in_progress: "in_progress",
    revision_requested: "in_progress", ready: "ready_to_send", sent: "with_customer",
    viewed: "with_customer", accepted: "accepted", declined: "closed", expired: "closed", cancelled: "closed", converted: "converted",
  };

  it.each(Object.entries(expected))("maps %s to %s", (status, stage) => {
    expect(estimateQueueStage({ status })).toBe(stage);
  });

  it("uses the same mapping for counts and list membership", () => {
    const rows = Object.keys(expected).map((status, id) => ({ id, status }));
    const counts = estimateStageCounts(rows);
    for (const stage of new Set(Object.values(expected))) {
      expect(counts[stage]).toBe(rows.filter((row) => estimateMatchesStage(row, stage)).length);
    }
    expect(counts.all_active).toBe(rows.filter((row) => estimateMatchesStage(row, "all_active")).length);
  });

  it("counts each system lifecycle independently and lets Agreement linkage win", () => {
    const rows = [
      { status: "in_progress" }, { status: "ready" }, { status: "sent" },
      { status: "accepted" }, { status: "ready", linked_agreement_id: 42 },
    ];
    expect(estimateStageCounts(rows)).toMatchObject({
      in_progress: 1, ready_to_send: 1, with_customer: 1, accepted: 1, converted: 1,
    });
  });

  it("prioritizes customer changes, acceptance, ready work, and preparation", () => {
    expect(estimateNextPriority([{ status: "sent" }, { status: "accepted" }, { status: "revision_requested" }])).toMatch(/change requests/i);
    expect(estimateNextPriority([{ status: "viewed" }, { status: "accepted" }])).toMatch(/Create an agreement/i);
    expect(estimateNextPriority([{ status: "sent" }])).toMatch(/no contractor action/i);
  });
});
