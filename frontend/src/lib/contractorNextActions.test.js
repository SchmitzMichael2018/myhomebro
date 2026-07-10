import { describe, expect, it } from "vitest";

import { getContractorNextActions } from "./contractorNextActions.js";

describe("getContractorNextActions", () => {
  it("surfaces new website leads with Review Lead navigation", () => {
    const actions = getContractorNextActions({
      publicLeads: [
        {
          bid_id: "lead-77",
          source_kind: "lead",
          lead_source: "quote_request",
          lead_source_filter: "website",
          is_website_lead: true,
          workspace_stage: "new_lead",
          source_id: 77,
          customer_name: "Taylor Lead",
          project_type: "Kitchen Remodel",
          status: "submitted",
          submitted_at: "2026-06-24T15:30:00Z",
        },
      ],
    });

    expect(actions[0]).toMatchObject({
      key: "website-lead:77",
      title: "New Website Lead",
      buttonLabel: "Review Lead",
      navigationTarget: "/app/opportunities?source=website",
      category: "lead",
      source: "website_leads",
    });
    expect(actions[0].description).toContain("Kitchen Remodel");
  });
});
