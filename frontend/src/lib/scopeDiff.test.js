import { describe, it, expect } from "vitest";
import { parseScopeLines, diffScope, formatDiff } from "./scopeDiff.js";

describe("parseScopeLines", () => {
  it("handles plain text paragraphs", () => {
    const lines = parseScopeLines("Remove old roof\nInstall new shingles");
    expect(lines).toEqual(["Remove old roof", "Install new shingles"]);
  });

  it("handles bullet points", () => {
    const lines = parseScopeLines("- Remove old roof\n- Install flashing\n- Clean up");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("- Remove old roof");
  });

  it("handles numbered lists", () => {
    const lines = parseScopeLines("1. Remove old roof\n2. Install new shingles\n3. Cleanup");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("1. Remove old roof");
  });

  it("strips blank lines", () => {
    const lines = parseScopeLines("Line one\n\n\nLine two\n");
    expect(lines).toEqual(["Line one", "Line two"]);
  });

  it("returns empty array for empty input", () => {
    expect(parseScopeLines("")).toEqual([]);
    expect(parseScopeLines(null)).toEqual([]);
    expect(parseScopeLines(undefined)).toEqual([]);
  });
});

describe("diffScope", () => {
  it("identifies added lines correctly", () => {
    const diff = diffScope("Line A", "Line A\nLine B");
    const added = diff.filter((l) => l.type === "added");
    expect(added).toHaveLength(1);
    expect(added[0].text).toBe("Line B");
  });

  it("identifies removed lines correctly", () => {
    const diff = diffScope("Line A\nLine B", "Line A");
    const removed = diff.filter((l) => l.type === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].text).toBe("Line B");
  });

  it("preserves unchanged lines", () => {
    const diff = diffScope("Keep this\nRemove this", "Keep this\nAdd this");
    const unchanged = diff.filter((l) => l.type === "unchanged");
    expect(unchanged).toHaveLength(1);
    expect(unchanged[0].text).toBe("Keep this");
  });

  it("empty original + non-empty improved → all lines added", () => {
    const diff = diffScope("", "Line A\nLine B");
    expect(diff.every((l) => l.type === "added")).toBe(true);
    expect(diff).toHaveLength(2);
  });

  it("identical texts → all lines unchanged", () => {
    const text = "Install shingles\nClean up site";
    const diff = diffScope(text, text);
    expect(diff.every((l) => l.type === "unchanged")).toBe(true);
    expect(diff).toHaveLength(2);
  });

  it("both empty → empty diff", () => {
    expect(diffScope("", "")).toEqual([]);
    expect(diffScope(null, null)).toEqual([]);
  });
});

describe("formatDiff", () => {
  it("counts are accurate", () => {
    const original = "Keep A\nRemove B\nKeep C";
    const improved = "Keep A\nKeep C\nAdd D";
    const result = formatDiff(original, improved);
    expect(result.unchangedCount).toBe(2);
    expect(result.removedCount).toBe(1);
    expect(result.addedCount).toBe(1);
    expect(result.lines).toHaveLength(4); // 2 unchanged + 1 removed + 1 added
  });

  it("returns lines array on result", () => {
    const result = formatDiff("A\nB", "A\nC");
    expect(Array.isArray(result.lines)).toBe(true);
  });

  it("handles identical texts: all unchanged, none added/removed", () => {
    const text = "Same line\nAnother line";
    const result = formatDiff(text, text);
    expect(result.addedCount).toBe(0);
    expect(result.removedCount).toBe(0);
    expect(result.unchangedCount).toBe(2);
  });

  it("handles empty original: all added", () => {
    const result = formatDiff("", "Line A\nLine B");
    expect(result.addedCount).toBe(2);
    expect(result.removedCount).toBe(0);
    expect(result.unchangedCount).toBe(0);
  });
});
