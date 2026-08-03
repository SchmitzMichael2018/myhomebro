const ENTITY_CONTEXT_KEYS = [
  "agreement_id",
  "agreement_summary",
  "lead_id",
  "lead_summary",
  "template_id",
  "template_summary",
  "milestone_id",
  "milestone_summary",
  "proposal_id",
  "proposal_summary",
  "dispute_id",
  "dispute_summary",
  "subcontractor_invitation_id",
  "invitation_id",
];

export function workspaceForAssistantRoute(route = "") {
  const path = String(route || "").split("?")[0].toLowerCase();
  if (path === "/app/customers/new") return "customer_create";
  if (path.startsWith("/app/customers")) return "customers";
  if (path.includes("/admin")) return "admin";
  if (path.includes("/disputes")) return "disputes";
  if (path.includes("/warrant")) return "warranty";
  if (path.includes("/team") || path.includes("/assignments") || path.includes("/schedule")) return "team";
  if (path.includes("/estimates") || path.includes("/proposals")) return "estimates";
  if (path.includes("/customer-portal")) return "customer_portal";
  if (path.includes("/properties") || path.includes("/property") || path.includes("/maintenance")) return "property_management";
  if (path.includes("/marketing") || path.includes("/public-presence")) return "marketing";
  if (path.includes("/insights") || path.includes("/business")) return "insights";
  if (path.includes("/documents") || path.includes("/photos")) return "documents";
  if (path.includes("/templates")) return "templates";
  if (path.includes("/agreements") && path.includes("/wizard")) return "agreement_wizard";
  if (path.includes("/agreements")) return "agreements";
  if (path.includes("/milestones")) return "milestones";
  if (path.includes("/invoices") || path.includes("/payments")) return "invoices";
  if (path.includes("/dashboard")) return "dashboard";
  if (path.includes("/opportunities") || path.includes("/bids")) return "leads";
  return "general";
}

export function resolveProjectAssistantIdentity(route = "") {
  const currentRoute = String(route || "");
  const path = currentRoute.split("?")[0].toLowerCase();
  const workspace = workspaceForAssistantRoute(currentRoute);
  const customerMatch = path.match(/^\/app\/customers\/([^/]+)$/);

  return {
    audience: path.includes("/admin")
      ? "admin"
      : path.includes("/customer-portal")
        ? "customer"
        : "contractor",
    workspace,
    entity_type: workspace === "customer_create" || workspace === "customers" ? "customer" : null,
    entity_id:
      customerMatch && customerMatch[1] !== "new" ? customerMatch[1] : null,
    presentation: "dock",
  };
}

export function enforceAssistantRouteScope(context = {}, routeIdentity = {}) {
  const clean = context && typeof context === "object" ? { ...context } : {};
  if (routeIdentity.workspace === "customer_create") {
    ENTITY_CONTEXT_KEYS.forEach((key) => delete clean[key]);
    clean.audience = "contractor";
    clean.workspace = "customer_create";
    clean.workspace_mode = "customer_create";
    clean.page = "customer_create";
    clean.entity_type = "customer";
    clean.entity_id = null;
    clean.presentation = "dock";
  }
  return clean;
}

