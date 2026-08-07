import { describe, expect, it } from "vitest";
import {
  computeSequentialOffsets,
  estimateTemplateTimelineDays,
  offsetToProjectDay,
  projectDayToOffset,
} from "./templateScheduling.js";

describe("template scheduling display conversions", () => {
  it("converts stored zero-based offsets to contractor-facing project days", () => {
    expect(offsetToProjectDay(0)).toBe(1);
    expect(offsetToProjectDay(1)).toBe(2);
    expect(offsetToProjectDay(4)).toBe(5);
  });

  it("converts contractor-facing project days back to stored offsets", () => {
    expect(projectDayToOffset(1)).toBe(0);
    expect(projectDayToOffset(2)).toBe(1);
    expect(projectDayToOffset(5)).toBe(4);
  });

  it("rejects blank, negative, fractional, and non-numeric values safely", () => {
    for (const value of [null, "", -1, 1.5, "not-a-day"]) {
      expect(offsetToProjectDay(value)).toBeNull();
    }
    for (const value of [null, "", 0, -1, 1.5, "not-a-day"]) {
      expect(projectDayToOffset(value)).toBeNull();
    }
  });

  it("preserves cumulative offset scheduling and reports the final project day", () => {
    const rows = computeSequentialOffsets([
      { title: "Demolition", duration_days: 1 },
      { title: "Rough-in", duration_days: 1 },
      { title: "Tile", duration_days: 2 },
      { title: "Closeout", duration_days: 1 },
    ]);

    expect(rows.map((row) => row.start_offset)).toEqual([0, 1, 2, 4]);
    expect(rows.map((row) => offsetToProjectDay(row.start_offset))).toEqual([1, 2, 3, 5]);
    expect(estimateTemplateTimelineDays(rows)).toBe(5);
  });
});
