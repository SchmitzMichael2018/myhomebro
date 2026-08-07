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

  it("maps the backend launch recommendation to one exact deep link", () => {
    const actions = getContractorNextActions({
      prioritySummary: {
        launch_action: {
          key: "launch:first-customer",
          category: "launch",
          rank: 50,
          title: "Add your first customer",
          description: "Create a customer record.",
          reason: "Customers connect the workflow.",
          action_label: "Add customer",
          destination: "/app/customers/new",
          optional: false,
        },
      },
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      key: "launch:first-customer",
      navigationTarget: "/app/customers/new",
      buttonLabel: "Add customer",
      category: "launch",
      dismissible: false,
    });
  });

  it("ranks overdue operational work above optional launch setup", () => {
    const actions = getContractorNextActions({
      prioritySummary: {
        launch_action: {
          key: "launch:first-template",
          category: "launch",
          rank: 50,
          title: "Create your first reusable template",
          action_label: "Create template",
          destination: "/app/templates",
          optional: true,
        },
      },
      milestones: [{ id: 42, title: "Rough-in", due_date: "2020-01-01", status: "pending" }],
    });

    expect(actions[0]).toMatchObject({
      key: "execution:milestone-overdue:42",
      navigationTarget: "/app/milestones/42",
      category: "execution",
    });
    expect(actions.find((action) => action.key === "launch:first-template")).toMatchObject({
      optional: true,
      dismissible: true,
    });
  });

  it("recommends Stripe only when signed work is actually waiting for funding", () => {
    const agreement = {
      id: 9,
      status: "signed",
      payment_mode: "escrow",
      signature_is_satisfied: true,
      escrow_funded: false,
    };

    const contextual = getContractorNextActions({ agreements: [agreement], stripeReady: false });
    expect(contextual[0]).toMatchObject({
      key: "finance:payment-setup",
      navigationTarget: "/app/onboarding/stripe",
      category: "finance",
    });

    const nonContextual = getContractorNextActions({ stripeReady: false });
    expect(nonContextual.some((action) => action.key === "finance:payment-setup")).toBe(false);
  });
});
