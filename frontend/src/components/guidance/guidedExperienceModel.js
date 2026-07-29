const step = (id, title, purpose, route, workspace, missing) => ({
  id,
  title,
  purpose,
  route,
  workspace,
  missing,
});

export const GUIDED_ROLE_PATHS = {
  contractor: {
    label: "Contractor owner",
    description: "Set up your business, invite your team, and move work from lead to completion.",
    steps: [
      step("business", "Company Setup", "Give customers and documents accurate company details.", "/app/business", "Business profile", "Business identity, service, and contact details"),
      step("marketing", "Marketing", "Make your services and public presence clear to prospective customers.", "/app/marketing", "Marketing", "A reviewed public business presence"),
      step("opportunities", "Opportunities", "Turn qualified requests into active work.", "/app/opportunities", "Opportunities", "A reviewed lead or opportunity"),
      step("estimate", "Estimates", "Define the proposed scope and price before agreement.", "/app/estimates", "Estimates", "A customer-ready estimate"),
      step("agreement", "Agreements", "Create a clear, auditable record of the work.", "/app/agreements", "Agreements", "An agreement ready for review"),
      step("funding", "Funding", "Understand the funding and payment-readiness path before work starts.", "/app/payments", "Payments", "A reviewed funding path"),
      step("projects", "Active Projects", "Track authorized work through clear delivery stages.", "/app/milestones", "Milestones", "Milestones and completion criteria"),
      step("payments", "Payments", "Review approvals, invoices, and payment status.", "/app/payments", "Payments", "A verified payment workflow"),
      step("warranties", "Warranty", "Keep completed-work records easy to find.", "/app/warranties", "Warranties", "Warranty and equipment records"),
      step("insights", "Insights", "Use operating signals to choose the next business action.", "/app/business", "Insights", "A repeatable operating review"),
    ],
  },
  employee: {
    label: "Employee",
    description: "Find assigned work, update milestones, and keep your field activity current.",
    steps: [
      step("dashboard", "Review your dashboard", "See assigned work and items needing attention.", "/app/employee/dashboard", "Employee dashboard", "A reviewed assignment queue"),
      step("profile", "Confirm your profile", "Keep your identity and capabilities accurate.", "/app/employee/profile", "Profile", "Current profile details"),
      step("agreements", "Review assigned agreements", "Understand the authorized scope before work begins.", "/app/employee/agreements", "Agreements", "A reviewed assigned agreement"),
      step("milestones", "Update milestones", "Keep project progress visible to the team.", "/app/employee/milestones", "Milestones", "A current milestone status"),
      step("calendar", "Check the schedule", "Coordinate upcoming work and deadlines.", "/app/employee/calendar", "Calendar", "A reviewed schedule"),
      step("capture", "Record field details", "Preserve photos, notes, and measurements with the project.", "/app/capture", "Smart Capture", "A project-linked field record"),
      step("support", "Know where to get help", "Resolve access or workflow questions quickly.", "/app/support", "Support", "A known support path"),
    ],
  },
  subcontractor: {
    label: "Subcontractor",
    description: "Review assigned work, document progress, and keep handoffs clear.",
    steps: [
      step("assigned", "Review assigned work", "Confirm what is assigned before starting.", "/app/subcontractor/assigned-work", "Assigned work", "A reviewed assignment"),
      step("scope", "Confirm scope and expectations", "Avoid missed requirements and unclear handoffs.", "/app/subcontractor/assigned-work", "Assigned work", "Confirmed scope and timing"),
      step("capture", "Document field progress", "Attach useful evidence to the correct assignment.", "/app/subcontractor/assigned-work", "Assigned work", "A project-linked field record"),
      step("milestones", "Update completion status", "Keep the contractor informed without extra messages.", "/app/subcontractor/assigned-work", "Assigned work", "A current completion status"),
      step("records", "Review submitted records", "Verify that notes and attachments are complete.", "/app/subcontractor/assigned-work", "Assigned work", "Complete submitted records"),
      step("support", "Know where to get help", "Resolve assignment or access questions quickly.", "/app/support", "Support", "A known support path"),
    ],
  },
  customer: {
    label: "Homeowner",
    description: "Follow project progress, review decisions, and keep property records organized.",
    steps: [
      step("portal", "Open your project portal", "See the latest project information in one place.", "/portal", "Project portal", "A reviewed project summary"),
      step("estimate", "Review estimates", "Understand scope and pricing before approving work.", "/portal", "Project portal", "A reviewed estimate"),
      step("agreement", "Review agreements", "Keep the approved scope and terms easy to reference.", "/portal", "Project portal", "A reviewed agreement"),
      step("progress", "Follow project progress", "See milestones and current status without chasing updates.", "/portal", "Project portal", "A reviewed project status"),
      step("messages", "Keep communication together", "Preserve questions and decisions with the project.", "/portal", "Project portal", "A clear communication trail"),
      step("payments", "Review payments", "Understand invoices, approvals, and payment status.", "/portal", "Project portal", "A reviewed payment status"),
      step("records", "Organize property records", "Keep photos, warranties, and completed-work history available.", "/portal", "Property records", "Organized project records"),
    ],
  },
  property_manager: {
    label: "Property manager",
    description: "Coordinate units, requests, vendors, warranties, and property history.",
    steps: [
      step("portfolio", "Review your property workspace", "See active properties and work requiring attention.", "/portal", "Property workspace", "A reviewed portfolio"),
      step("request", "Submit a maintenance request", "Capture the issue clearly for faster triage.", "/maintenance-request", "Maintenance requests", "A complete maintenance request"),
      step("vendors", "Coordinate vendors", "Keep assignments and expectations clear.", "/portal", "Vendor coordination", "A reviewed vendor assignment"),
      step("progress", "Track maintenance progress", "See status changes without separate follow-up threads.", "/portal", "Maintenance tracking", "A reviewed work status"),
      step("records", "Organize unit records", "Keep photos, documents, and history attached to the property.", "/portal", "Property records", "Organized unit records"),
      step("warranties", "Review warranties", "Find coverage information before authorizing new work.", "/portal", "Warranty records", "A reviewed warranty record"),
      step("history", "Review property history", "Use prior work to make better maintenance decisions.", "/portal", "Property history", "A reviewed maintenance history"),
    ],
  },
  tenant: {
    label: "Tenant",
    description: "Report maintenance needs clearly and follow their progress.",
    steps: [
      step("request", "Start a maintenance request", "Describe the issue and location clearly.", "/maintenance-request", "Maintenance requests", "A complete issue description"),
      step("evidence", "Add useful details", "Photos and access notes help the right person prepare.", "/maintenance-request", "Maintenance requests", "Useful supporting details"),
      step("status", "Check request status", "Know what is scheduled and what happens next.", "/portal", "Request status", "A reviewed request status"),
      step("support", "Know where to get help", "Use the property contact path for urgent questions.", "/portal", "Support", "A known support path"),
    ],
  },
  admin: {
    label: "Administrator",
    description: "Review platform operations, exceptions, and support queues.",
    steps: [
      step("dashboard", "Review administration", "See platform-level items requiring attention.", "/app/admin", "Administration", "A reviewed admin queue"),
      step("reviews", "Review pending decisions", "Keep verification and review work moving.", "/app/admin/reviews", "Reviews", "A reviewed decision queue"),
      step("disputes", "Review disputes", "Use the authorized workflow for escalated project issues.", "/app/admin/disputes", "Disputes", "A reviewed dispute queue"),
      step("maintenance", "Check maintenance operations", "Monitor property-service requests and exceptions.", "/app/admin/maintenance", "Maintenance", "A reviewed maintenance queue"),
      step("directory", "Review contractor records", "Keep marketplace and contractor information accurate.", "/app/admin/contractor-directory", "Contractor directory", "A reviewed contractor record"),
      step("support", "Review support pathways", "Know where account and workflow issues are handled.", "/app/support", "Support", "A known support path"),
    ],
  },
};

export const WORKSPACE_GROUPS = [
  {
    title: "Get started",
    roles: ["contractor", "employee", "subcontractor", "customer", "property_manager", "tenant", "admin"],
    stepIds: ["business", "profile", "portal", "portfolio", "dashboard", "assigned", "request"],
  },
  {
    title: "Plan and coordinate work",
    roles: ["contractor", "employee", "subcontractor", "customer", "property_manager", "tenant"],
    stepIds: ["marketing", "team", "opportunities", "estimate", "agreement", "scope", "vendors", "calendar"],
  },
  {
    title: "Track work and records",
    roles: ["contractor", "employee", "subcontractor", "customer", "property_manager", "tenant", "admin"],
    stepIds: ["projects", "milestones", "progress", "capture", "records", "warranties", "history", "status", "evidence", "maintenance"],
  },
  {
    title: "Payments, decisions, and support",
    roles: ["contractor", "employee", "subcontractor", "customer", "property_manager", "tenant", "admin"],
    stepIds: ["funding", "payments", "insights", "reviews", "disputes", "directory", "support"],
  },
];

export function getRolePath(role) {
  return GUIDED_ROLE_PATHS[role] || GUIDED_ROLE_PATHS.contractor;
}

export function deriveGuidedProgress(role, progress = {}) {
  const path = getRolePath(role);
  const total = path.steps.length;
  const rawIndex = Number.isFinite(progress.stepIndex) ? progress.stepIndex : 0;
  const stepIndex = Math.max(0, Math.min(rawIndex, Math.max(total - 1, 0)));
  const completedCount = progress.status === "completed" ? total : stepIndex;
  return {
    ...progress,
    role,
    stepIndex,
    total,
    completedCount,
    percentage: total ? Math.round((completedCount / total) * 100) : 0,
    currentStep: path.steps[stepIndex] || null,
    isComplete: progress.status === "completed",
  };
}

export function getRecommendedStep(role, progress = {}) {
  const derived = deriveGuidedProgress(role, progress);
  if (derived.isComplete) return null;
  return derived.currentStep;
}

export function getWorkspaceGroups(role) {
  const path = getRolePath(role);
  return WORKSPACE_GROUPS
    .filter((group) => group.roles.includes(role))
    .map((group) => ({
      ...group,
      steps: path.steps.filter((item) => group.stepIds.includes(item.id)),
    }))
    .filter((group) => group.steps.length);
}
