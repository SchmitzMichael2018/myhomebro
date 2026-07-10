import { describe, expect, it } from "vitest";

import {
  smartCaptureApprovalSummary,
  smartCaptureFieldsForType,
  smartCaptureStatusLabel,
  smartCaptureTypeLabel,
} from "./projectAssistantSmartCapture.js";

describe("projectAssistantSmartCapture", () => {
  it("labels supported capture types and statuses", () => {
    expect(smartCaptureTypeLabel("equipment_label")).toBe("Equipment Label");
    expect(smartCaptureStatusLabel("review_ready")).toBe("Review Ready");
  });

  it("returns receipt review fields", () => {
    expect(smartCaptureFieldsForType("receipt").map(([key]) => key)).toContain("merchant_name");
    expect(smartCaptureFieldsForType("receipt").map(([key]) => key)).toContain("total");
  });

  it("returns label review fields", () => {
    expect(smartCaptureFieldsForType("product_label").map(([key]) => key)).toContain("serial_number");
    expect(smartCaptureFieldsForType("product_label").map(([key]) => key)).toContain("destination");
  });

  it("summarizes approval guardrails", () => {
    expect(smartCaptureApprovalSummary({ capture_type: "receipt", structured_payload: { total: "286.41" } }).join(" ")).toContain("No reimbursement");
    expect(smartCaptureApprovalSummary({ capture_type: "equipment_label", structured_payload: { product_name: "Drill" } }).join(" ")).toContain("No warranty claim");
  });
});
