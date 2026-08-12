import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Agreement Wizard Estimate template handoff", () => {
  const step1 = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/Step1Details.jsx"),
    "utf8"
  );

  it("presents an authoritative source Estimate template as carried forward", () => {
    expect(step1).toContain('data-testid="estimate-template-carried-forward"');
    expect(step1).toContain("Carried over from Estimate");
    expect(step1).toContain("hasAuthoritativeEstimateTemplate");
  });

  it("does not present a conflicting recommendation when Estimate provenance exists", () => {
    expect(step1).toContain("recommendedProjectSetup && !hasAuthoritativeEstimateTemplate");
  });
});
