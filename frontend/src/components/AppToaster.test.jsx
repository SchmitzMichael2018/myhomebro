import { describe, expect, it } from "vitest";
import { TOAST_PRESENTATION } from "./toastPresentation.js";

describe("shared toast presentation", () => {
  it("assigns a distinct semantic class to every supported variant", () => {
    expect(TOAST_PRESENTATION.error.className).toContain("mhb-toast--error");
    expect(TOAST_PRESENTATION.success.className).toContain("mhb-toast--success");
    expect(TOAST_PRESENTATION.loading.className).toContain("mhb-toast--info");
    expect(TOAST_PRESENTATION.blank.className).toContain("mhb-toast--info");
    expect(TOAST_PRESENTATION.custom.className).toContain("mhb-toast--warning");
  });

  it("keeps validation errors visible longer than success confirmations", () => {
    expect(TOAST_PRESENTATION.error.duration).toBeGreaterThan(
      TOAST_PRESENTATION.success.duration
    );
  });
});
