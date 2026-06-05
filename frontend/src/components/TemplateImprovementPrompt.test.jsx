import React from "react";
import { describe, expect, it } from "vitest";
import TemplateImprovementPrompt from "./TemplateImprovementPrompt.jsx";

describe("TemplateImprovementPrompt", () => {
  it("applies high-contrast classes to the prompt shell and text", () => {
    const element = TemplateImprovementPrompt({
      message: "These milestone improvements can strengthen future agreements.",
    });

    expect(element.props.className).toContain("bg-slate-950");
    expect(element.props.className).toContain("text-emerald-50");

    const heading = element.props.children[0];
    const body = element.props.children[1];

    expect(heading.props.className).toContain("text-white");
    expect(body.props.className).toContain("text-emerald-100");
  });
});
