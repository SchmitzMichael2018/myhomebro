import { describe, expect, it } from "vitest";

import {
  approvalActionForQuickCapture,
  canApproveQuickCapture,
  draftRowsFromQuickCapture,
  quickCaptureIntentLabel,
} from "./projectAssistantQuickCapture.js";

describe("projectAssistantQuickCapture", () => {
  it("labels supported intents for users", () => {
    expect(quickCaptureIntentLabel("create_customer_and_opportunity")).toBe("Create Customer And Opportunity");
  });

  it("blocks approval while required fields are missing", () => {
    expect(
      canApproveQuickCapture({
        intent: "create_customer",
        missing_fields: [{ field: "customer.email", label: "Customer email" }],
      })
    ).toBe(false);
  });

  it("returns the explicit approval action when ready", () => {
    expect(
      approvalActionForQuickCapture({
        intent: "create_customer_and_opportunity",
        missing_fields: [],
      })
    ).toEqual({
      action: "create_customer_and_opportunity",
      label: "Create Customer & Opportunity",
    });
  });

  it("renders structured customer and opportunity draft rows", () => {
    const rows = draftRowsFromQuickCapture({
      customer_draft: { display_name: "Sarah Johnson", email: "sarah@example.com" },
      opportunity_draft: {
        title: "Sarah Johnson - Shower",
        project_category: "Bathroom Remodel",
        property_address: "123 Oak Street",
      },
    });

    expect(rows.map((row) => row.title)).toEqual(["Customer Draft", "Opportunity Draft"]);
    expect(rows[0].items).toContainEqual(["Name", "Sarah Johnson"]);
  });
});
