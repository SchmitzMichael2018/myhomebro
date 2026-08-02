import { describe, expect, it } from "vitest";
import { validateCustomService } from "./TradeMultiSelect.jsx";

describe("validateCustomService", () => {
  it("normalizes whitespace while preserving display capitalization", () => {
    expect(validateCustomService("  Epoxy   Flooring ").value).toBe("Epoxy Flooring");
  });

  it("rejects blank, canonical and case-insensitive custom duplicates", () => {
    expect(validateCustomService(" ").error).toBe("Enter a service name.");
    expect(validateCustomService(" roofing ", ["Roofing"]).error).toBe("This service already exists.");
    expect(validateCustomService("epoxy flooring", [], ["Epoxy Flooring"]).error).toBe("This service already exists.");
  });

  it("rejects markup, contact information and invalid lengths", () => {
    expect(validateCustomService("<script>bad</script>").error).toBe("Enter a service, not contact information.");
    expect(validateCustomService("me@example.com").error).toBe("Enter a service, not contact information.");
    expect(validateCustomService("x".repeat(81)).error).toBe("Use 2–80 characters.");
  });
});
