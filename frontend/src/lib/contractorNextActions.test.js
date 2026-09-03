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

  it("returns one entity-specific pre-send priority for one unsigned draft", () => {
    const actions = getContractorNextActions({
      nextBestAction: {
        action_type: "send_first_agreement",
        title: "Send your next agreement",
        navigation_target: "/app/agreements/42/wizard?step=1",
        priority_score: 90,
      },
      agreements: [{ id: 42, status: "draft", project_title: "Bathroom Remodel", customer_name: "QA Homeowner", signature_is_satisfied: false }],
    });

    expect(actions.filter((action) => action.entity_type === "agreement")).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      key: "agreement:42:agreement_pre_send",
      snooze_key: "agreement:42:agreement_pre_send",
      title: "Bathroom Remodel agreement ready to send",
      buttonLabel: "Open draft",
      navigationTarget: "/app/agreements/42/wizard?step=1",
    });
    expect(actions.some((action) => action.title === "Review agreement signatures")).toBe(false);
    expect(actions.some((action) => action.title === "Send your next agreement")).toBe(false);
  });

  it("does not present a dashboard self-link as a priority action", () => {
    const actions = getContractorNextActions({
      nextBestAction: {
        action_type: "resume_workflow",
        title: "Open your dashboard workflow",
        navigation_target: "/app/dashboard",
      },
    });

    expect(actions).toEqual([]);
  });

  it("keeps escrow funding confirmations out of the action queue", () => {
    const actions = getContractorNextActions({
      activityFeed: [{
        id: 88,
        title: "Escrow funded",
        summary: "Escrow funds were received for this agreement.",
        navigation_target: "/app/agreements/35/workspace?tab=money",
      }],
    });

    expect(actions).toEqual([]);
  });

  it("deduplicates an agreement-created activity event against its draft priority", () => {
    const actions = getContractorNextActions({
      agreements: [{
        id: 42,
        status: "draft",
        project_title: "Bathroom Remodel",
        customer_name: "QA Homeowner",
      }],
      activityFeed: [{
        id: 900,
        title: "Agreement draft created",
        summary: "A new agreement draft is ready for review and sending.",
        navigation_target: "/app/agreements/42/wizard?step=1",
        created_at: "2026-08-30T10:44:00Z",
      }],
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      key: "agreement:42:agreement_pre_send",
      entity_type: "agreement",
      entity_id: "42",
      title: "Bathroom Remodel agreement ready to send",
    });
  });

  it("returns one signature priority only after signing has started", () => {
    const actions = getContractorNextActions({
      agreements: [{
        id: 43,
        status: "draft",
        project_title: "Kitchen Remodel",
        signed_by_contractor: true,
        signed_by_homeowner: false,
        signature_is_satisfied: false,
      }],
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      key: "agreement:43:agreement_signature",
      action_family: "agreement_signature",
      title: "Kitchen Remodel needs the remaining signature",
      navigationTarget: "/app/agreements/43",
    });
  });

  it("preserves one lifecycle priority for each distinct agreement", () => {
    const actions = getContractorNextActions({
      agreements: [
        { id: 44, status: "draft", project_title: "Bath", signed_by_contractor: false, signed_by_homeowner: false },
        { id: 45, status: "draft", project_title: "Kitchen", signed_by_contractor: true, signed_by_homeowner: false },
      ],
    });

    expect(actions).toHaveLength(2);
    expect(actions.map((action) => action.key).sort()).toEqual([
      "agreement:44:agreement_pre_send",
      "agreement:45:agreement_signature",
    ]);
  });

  it("uses the action family as the snooze identity and changes it with lifecycle state", () => {
    const draft = getContractorNextActions({ agreements: [{ id: 46, status: "draft" }] })[0];
    const signing = getContractorNextActions({ agreements: [{ id: 46, status: "draft", signed_by_contractor: true }] })[0];

    expect(draft.snooze_key).toBe("agreement:46:agreement_pre_send");
    expect(signing.snooze_key).toBe("agreement:46:agreement_signature");
  });

  it("prefers a linked draft agreement over its converted Proposal action", () => {
    const actions = getContractorNextActions({
      prioritySummary: { launch_action: {
        key: "sales:agreement-ready:12", title: "Create agreement for Bathroom",
        action_label: "Create agreement", destination: "/app/proposals/12?section=ready",
        rank: 99, blocking: true, entity_type: "proposal", entity_id: 12,
        source_proposal_id: 12, lifecycle_root_key: "proposal:12",
        action_family: "proposal_create_agreement",
      } },
      agreements: [{
        id: 48, status: "draft", project_title: "Bathroom",
        accepted_estimate_basis: { proposal_id: 12, review_version: 2 },
      }],
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      key: "agreement:48:agreement_pre_send",
      source_proposal_id: "12",
      lifecycle_root_key: "proposal:12",
    });
    expect(actions.some((action) => action.action_family === "proposal_create_agreement")).toBe(false);
  });

  it("keeps independent accepted Proposal and draft Agreement priorities", () => {
    const actions = getContractorNextActions({
      prioritySummary: { launch_action: {
        key: "sales:agreement-ready:13", title: "Create agreement for Kitchen",
        action_label: "Create agreement", destination: "/app/proposals/13?section=ready",
        rank: 84, entity_type: "proposal", entity_id: 13,
        source_proposal_id: 13, lifecycle_root_key: "proposal:13",
        action_family: "proposal_create_agreement",
      } },
      agreements: [{ id: 49, status: "draft", project_title: "Bathroom", accepted_estimate_basis: { proposal_id: 12 } }],
    });

    expect(actions.map((action) => action.key).sort()).toEqual([
      "agreement:49:agreement_pre_send",
      "sales:agreement-ready:13",
    ]);
  });

  it("keeps a blocking planning action instead of a lower-value draft action", () => {
    const actions = getContractorNextActions({
      agreements: [{
        id: 47,
        status: "draft",
        project_title: "Addition",
        planning_validation_status: "hard_conflict",
        planning_validation_summary: { reason: "Crew availability conflicts with the required start." },
      }],
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      key: "planning-validation:47:hard_conflict",
      action_family: "agreement_planning",
      blocking: true,
    });
  });
});
