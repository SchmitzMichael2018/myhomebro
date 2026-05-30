import { describe, it, expect } from "vitest";
import { checkJobHealth, HEALTH_FLAG_TYPES } from "./jobHealthMonitor.js";

const NOW = new Date("2026-05-30T12:00:00Z");

function daysAgo(n) {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function daysFromNow(n) {
  const d = new Date(NOW);
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

function hoursAgo(n) {
  return new Date(NOW.getTime() - n * 60 * 60 * 1000).toISOString();
}

const ACTIVE_AGREEMENT = {
  id: "a1",
  title: "Roof Replacement — Smith",
  status: "active",
  updated_at: daysAgo(1),
};

describe("checkJobHealth — milestone_overdue", () => {
  it("flags an overdue incomplete milestone on an active agreement", () => {
    const milestones = [{
      id: "m1",
      title: "Tear-off",
      status: "in_progress",
      completed: false,
      due_date: daysAgo(3),
      agreement_id: "a1",
    }];
    const flags = checkJobHealth({ agreements: [ACTIVE_AGREEMENT], milestones, now: NOW });
    const flag = flags.find((f) => f.type === HEALTH_FLAG_TYPES.MILESTONE_OVERDUE);
    expect(flag).toBeDefined();
    expect(flag.agreementId).toBe("a1");
    expect(flag.daysSince).toBeGreaterThanOrEqual(3);
  });

  it("does not flag a completed milestone as overdue", () => {
    const milestones = [{
      id: "m2",
      title: "Install",
      status: "completed",
      completed: true,
      due_date: daysAgo(3),
      agreement_id: "a1",
    }];
    const flags = checkJobHealth({ agreements: [ACTIVE_AGREEMENT], milestones, now: NOW });
    const overdue = flags.filter((f) => f.type === HEALTH_FLAG_TYPES.MILESTONE_OVERDUE);
    expect(overdue).toHaveLength(0);
  });

  it("does not flag a future milestone", () => {
    const milestones = [{
      id: "m3",
      title: "Cleanup",
      status: "pending",
      completed: false,
      due_date: daysFromNow(5),
      agreement_id: "a1",
    }];
    const flags = checkJobHealth({ agreements: [ACTIVE_AGREEMENT], milestones, now: NOW });
    const overdue = flags.filter((f) => f.type === HEALTH_FLAG_TYPES.MILESTONE_OVERDUE);
    expect(overdue).toHaveLength(0);
  });
});

describe("checkJobHealth — no_activity", () => {
  it("flags an active agreement with no activity for > 5 days", () => {
    const agreement = { id: "a2", title: "Flooring Project", status: "active", updated_at: daysAgo(6) };
    const flags = checkJobHealth({ agreements: [agreement], milestones: [], now: NOW });
    const flag = flags.find((f) => f.type === HEALTH_FLAG_TYPES.NO_ACTIVITY);
    expect(flag).toBeDefined();
    expect(flag.agreementId).toBe("a2");
    expect(flag.daysSince).toBeGreaterThanOrEqual(6);
  });

  it("does not flag an active agreement updated 3 days ago", () => {
    const agreement = { id: "a3", title: "HVAC", status: "active", updated_at: daysAgo(3) };
    const flags = checkJobHealth({ agreements: [agreement], milestones: [], now: NOW });
    const flag = flags.find((f) => f.type === HEALTH_FLAG_TYPES.NO_ACTIVITY);
    expect(flag).toBeUndefined();
  });

  it("does not flag a draft agreement with no activity", () => {
    const agreement = { id: "a4", title: "Draft job", status: "draft", updated_at: daysAgo(10) };
    const flags = checkJobHealth({ agreements: [agreement], milestones: [], now: NOW });
    const flag = flags.find((f) => f.type === HEALTH_FLAG_TYPES.NO_ACTIVITY);
    expect(flag).toBeUndefined();
  });
});

describe("checkJobHealth — relationship_risk", () => {
  it("fires when a milestone is overdue by more than 7 days", () => {
    const milestones = [{
      id: "m4",
      title: "Framing",
      status: "in_progress",
      completed: false,
      due_date: daysAgo(8),
      agreement_id: "a1",
    }];
    const flags = checkJobHealth({ agreements: [ACTIVE_AGREEMENT], milestones, now: NOW });
    const flag = flags.find((f) => f.type === HEALTH_FLAG_TYPES.RELATIONSHIP_RISK);
    expect(flag).toBeDefined();
    expect(flag.severity).toBe("urgent");
    expect(flag.daysSince).toBeGreaterThanOrEqual(8);
  });

  it("does not fire relationship_risk for 3-day overdue milestone", () => {
    const milestones = [{
      id: "m5",
      title: "Paint",
      status: "in_progress",
      completed: false,
      due_date: daysAgo(3),
      agreement_id: "a1",
    }];
    const flags = checkJobHealth({ agreements: [ACTIVE_AGREEMENT], milestones, now: NOW });
    const risk = flags.filter((f) => f.type === HEALTH_FLAG_TYPES.RELATIONSHIP_RISK);
    expect(risk).toHaveLength(0);
  });
});

describe("checkJobHealth — payment_delayed", () => {
  it("flags a submitted milestone with no action for > 48h", () => {
    const milestones = [{
      id: "m6",
      title: "Deck install",
      status: "submitted",
      completed: false,
      submitted_at: hoursAgo(55),
      agreement_id: "a1",
    }];
    const flags = checkJobHealth({ agreements: [ACTIVE_AGREEMENT], milestones, now: NOW });
    const flag = flags.find((f) => f.type === HEALTH_FLAG_TYPES.PAYMENT_DELAYED);
    expect(flag).toBeDefined();
  });

  it("does not flag a submitted milestone reviewed within 48h", () => {
    const milestones = [{
      id: "m7",
      title: "Deck install",
      status: "submitted",
      submitted_at: hoursAgo(24),
      agreement_id: "a1",
    }];
    const flags = checkJobHealth({ agreements: [ACTIVE_AGREEMENT], milestones, now: NOW });
    const flag = flags.find((f) => f.type === HEALTH_FLAG_TYPES.PAYMENT_DELAYED);
    expect(flag).toBeUndefined();
  });
});

describe("checkJobHealth — healthy agreements", () => {
  it("returns no flags for a healthy, recently-updated active agreement with no overdue milestones", () => {
    const agreements = [{ id: "a5", title: "Healthy job", status: "active", updated_at: daysAgo(1) }];
    const milestones = [{
      id: "m8",
      title: "On-track milestone",
      status: "in_progress",
      completed: false,
      due_date: daysFromNow(3),
      agreement_id: "a5",
    }];
    const flags = checkJobHealth({ agreements, milestones, now: NOW });
    expect(flags).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(checkJobHealth({ agreements: [], milestones: [] })).toEqual([]);
    expect(checkJobHealth()).toEqual([]);
  });
});
