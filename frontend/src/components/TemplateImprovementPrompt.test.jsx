import React from "react";
import { describe, expect, it } from "vitest";
import TemplateImprovementPrompt from "./TemplateImprovementPrompt.jsx";

describe("TemplateImprovementPrompt", () => {
  it("applies high-contrast dark mode classes to the prompt shell and text", () => {
    const element = TemplateImprovementPrompt({
      message: "These milestone improvements can strengthen future agreements.",
    });

    expect(element.props.className).toContain("dark:bg-slate-950");
    expect(element.props.className).toContain("dark:text-emerald-50");

    const heading = element.props.children[0];
    const body = element.props.children[1];

    expect(heading.props.className).toContain("dark:text-white");
    expect(body.props.className).toContain("dark:text-emerald-100");
  });
});
