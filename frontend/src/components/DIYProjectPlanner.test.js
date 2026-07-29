import { describe, expect, it } from "vitest";
import { participation, safetyCopy } from "./DIYProjectPlanner.jsx";

describe("DIY Project Planner product contracts", () => {
  it("uses supported participation language without inventing a labor marketplace", () => {
    expect(participation).toEqual([
      ["DO_IT_MYSELF", "Doing Myself"],
      ["NEED_GUIDANCE", "Need Expert Guidance"],
      ["NEED_HELP", "Need Hands-On Help"],
      ["NEED_PROFESSIONAL", "Need a Professional"],
      ["UNDECIDED", "Undecided"],
    ]);
    expect(participation.flat().join(" ")).not.toMatch(/general labor/i);
  });

  it("keeps Project Assistant guidance advisory", () => {
    expect(safetyCopy).toMatch(/planning guidance/i);
    expect(safetyCopy).toMatch(/not a code, permit, engineering, or safety determination/i);
    expect(safetyCopy).toMatch(/verify locally/i);
  });
});
