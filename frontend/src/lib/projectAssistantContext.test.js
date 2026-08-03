import { describe, expect, it } from "vitest";

import {
  enforceAssistantRouteScope,
  resolveProjectAssistantIdentity,
} from "./projectAssistantContext.js";
import { buildUserFacingAiPanel } from "./agreementWizardAiPanel.js";

describe("Project Assistant route context", () => {
  it("resolves contractor customer creation without a persisted entity", () => {
    expect(resolveProjectAssistantIdentity("/app/customers/new")).toEqual({
      audience: "contractor",
      workspace: "customer_create",
      entity_type: "customer",
      entity_id: null,
      presentation: "dock",
    });
  });

  it("does not classify contractor customer records as the customer portal", () => {
    expect(resolveProjectAssistantIdentity("/app/customers/42")).toMatchObject({
      audience: "contractor",
      workspace: "customers",
      entity_type: "customer",
      entity_id: "42",
    });
  });

  it("preserves the actual customer portal audience and workspace", () => {
    expect(resolveProjectAssistantIdentity("/customer-portal/projects/42")).toMatchObject({
      audience: "customer",
      workspace: "customer_portal",
      entity_type: null,
    });
  });

  it("clears stale agreement and lead state from customer creation", () => {
    const identity = resolveProjectAssistantIdentity("/app/customers/new");
    expect(enforceAssistantRouteScope({
      agreement_id: 8,
      agreement_summary: { title: "Stale agreement" },
      lead_id: 3,
      current_route: "/app/customers/new",
    }, identity)).toEqual({
      current_route: "/app/customers/new",
      audience: "contractor",
      workspace: "customer_create",
      workspace_mode: "customer_create",
      page: "customer_create",
      entity_type: "customer",
      entity_id: null,
      presentation: "dock",
    });
  });

  it("does not apply agreement coaching to customer creation", () => {
    const panel = buildUserFacingAiPanel({
      context: {
        current_route: "/app/customers/new",
        workspace_mode: "customer_create",
      },
      panelConfig: {
        headline: "Help with customer setup",
        helperText: "Review customer details.",
      },
      plan: {},
    });

    expect(panel.coachingTitle).toBe("");
    expect(panel.coachingMessage).toBe("");
    expect(panel.nextStepMessage).not.toContain("agreement");
  });
});
