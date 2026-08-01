import { describe, expect, it } from "vitest";
import { buildBusinessLaunchChecklist, calculateProfileCompleteness } from "./profileCompleteness.js";

const completeProfile = {
  full_name: "Solo Contractor",
  business_name: "Solo Builds",
  email: "solo@example.test",
  phone: "555-0100",
  address: "1 Main Street",
  city: "Austin",
  state: "TX",
  zip: "78701",
  service_radius_miles: 25,
  skills: ["Carpentry"],
};

describe("profile completeness", () => {
  it("counts only required profile fields", () => {
    const result = calculateProfileCompleteness(completeProfile, {
      stripeConnected: false,
      jobCount: 0,
      templateCount: 0,
    });
    expect(result.score).toBe(100);
    expect(result.requiredCount).toBe(7);
    expect(result.items.find((item) => item.key === "logo")?.state).toBe("recommended");
    expect(result.items.find((item) => item.key === "license")?.state).toBe("optional");
  });

  it.each([
    ["job activity", { jobCount: 4 }],
    ["template activity", { templateCount: 3 }],
    ["team size", { team_count: 8 }],
    ["Stripe state", { stripe_connected: true, charges_enabled: true }],
  ])("does not change for %s", (_label, change) => {
    const baseline = calculateProfileCompleteness(completeProfile).score;
    expect(calculateProfileCompleteness({ ...completeProfile, ...change }, change).score).toBe(baseline);
  });

  it.each([
    ["business_name"], ["phone"], ["address"], ["city"], ["state"], ["zip"], ["service_radius_miles"], ["skills"],
  ])("required field %s affects the score", (key) => {
    const value = key === "skills" ? [] : key === "service_radius_miles" ? 0 : "";
    expect(calculateProfileCompleteness({ ...completeProfile, [key]: value }).score).toBeLessThan(100);
  });

  it("counts a license only when existing compliance rules require it", () => {
    const required = calculateProfileCompleteness({
      ...completeProfile,
      compliance_trade_requirements: [{ requires_license: true }],
    });
    expect(required.score).toBe(88);
    expect(required.items.find((item) => item.key === "license")?.state).toBe("incomplete");
  });
});

describe("business launch checklist", () => {
  it("keeps adoption and payment actions separate from profile scoring", () => {
    const profileScore = calculateProfileCompleteness(completeProfile).score;
    const checklist = buildBusinessLaunchChecklist(completeProfile, {
      estimateCount: 1,
      templateCount: 1,
      customerCount: 1,
      teamCount: 0,
    });
    expect(checklist.find((item) => item.key === "first_estimate")?.complete).toBe(true);
    expect(checklist.find((item) => item.key === "template")?.complete).toBe(true);
    expect(checklist.find((item) => item.key === "team")?.optional).toBe(true);
    expect(checklist.find((item) => item.key === "payments")?.complete).toBe(false);
    expect(profileScore).toBe(100);
  });

  it("requires actual payment readiness rather than an account ID", () => {
    const accountOnly = buildBusinessLaunchChecklist({ stripe_account_id: "acct_test" }, {});
    expect(accountOnly.find((item) => item.key === "payments")?.complete).toBe(false);
    const ready = buildBusinessLaunchChecklist({ details_submitted: true, charges_enabled: true, payouts_enabled: true, requirements_due_count: 0 }, {});
    expect(ready.find((item) => item.key === "payments")?.complete).toBe(true);
  });
});
