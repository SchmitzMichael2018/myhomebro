import { describe, expect, it } from "vitest";

import { formatGeneratedScopeAsBullets } from "./scopeFormat";

describe("formatGeneratedScopeAsBullets", () => {
  it("converts paragraph-style generated scope into sectioned bullets", () => {
    const result = formatGeneratedScopeAsBullets(
      "Install fence posts and rails. Supply materials. Apply stain. Customer will confirm gate location. Not included unless specified: permits or utility relocation."
    );

    expect(result).toContain("Included Work\n- Install fence posts and rails");
    expect(result).toContain("\nExclusions\n- permits or utility relocation");
    expect(result).toContain("\nCustomer Responsibilities\n- Customer will confirm gate location");
    expect((result.match(/^- /gm) || []).length).toBeGreaterThanOrEqual(5);
    expect((result.match(/^- /gm) || []).length).toBeLessThanOrEqual(12);
    expect(result).not.toMatch(/^\s*\d+[.)]\s+/m);
  });

  it("preserves existing bullet sections", () => {
    const scope = ["Included Work", "- Prep surfaces", "- Install flooring", "", "Exclusions", "- Furniture moving"].join("\n");

    expect(formatGeneratedScopeAsBullets(scope)).toBe(scope);
  });
});
