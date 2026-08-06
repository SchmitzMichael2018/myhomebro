import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DateField from "./DateField.jsx";

describe("DateField", () => {
  it("renders a named native picker button and associated validation state", () => {
    const markup = renderToStaticMarkup(
      <DateField
        id="start-date"
        name="project_start_date"
        value="2026-09-10"
        onChange={() => {}}
        pickerLabel="Choose start date"
        describedBy="start-date-error"
        invalid
      />
    );

    expect(markup).toContain('type="date"');
    expect(markup).toContain('aria-label="Choose start date"');
    expect(markup).toContain('aria-describedby="start-date-error"');
    expect(markup).toContain('aria-invalid="true"');
  });

  it("only renders its optional clear control when a date is present", () => {
    const populated = renderToStaticMarkup(
      <DateField
        name="project_completion_date"
        value="2026-09-21"
        onChange={() => {}}
        onClear={() => {}}
        clearLabel="Clear completion date"
      />
    );
    const blank = renderToStaticMarkup(
      <DateField
        name="project_completion_date"
        value=""
        onChange={() => {}}
        onClear={() => {}}
        clearLabel="Clear completion date"
      />
    );

    expect(populated).toContain('aria-label="Clear completion date"');
    expect(blank).not.toContain('aria-label="Clear completion date"');
  });
});
