import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Estimate Workspace lifecycle controls", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "src/pages/ProposalWorkspacePage.jsx"),
    "utf8"
  );

  it("renders lifecycle status as read-only and exposes the linked Agreement action", () => {
    expect(source).not.toContain('data-testid="proposal-status-select"');
    expect(source).not.toContain('data-testid="proposal-save-status"');
    expect(source).toContain('data-testid="proposal-status-detail"');
    expect(source).toContain('data-testid="proposal-open-agreement"');
  });

  it("sends readiness independently from lifecycle status", () => {
    expect(source).toContain("{ recalculate_readiness: true }");
    expect(source).not.toContain("saveProposal({ status:");
  });
});
