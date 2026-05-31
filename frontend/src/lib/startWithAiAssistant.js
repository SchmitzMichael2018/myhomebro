import {
  getProjectClarificationQuestions,
} from "./subtypeClarifications.js";
import { getMilestonePattern } from "./milestoneTemplates.js";

export const CONFIDENCE_THRESHOLD = 0.7;

const INTENT_SCORE_TIERS = {
  exact_keyword: 1.0,
  context_override: 0.9,
  strong_keyword: 0.85,
  partial_keyword: 0.65,
  fallback: 0.3,
};

export function scoreIntent(matchType, missingFields = []) {
  const base = INTENT_SCORE_TIERS[matchType] ?? 0.3;
  const penalty = Math.min(missingFields.length * 0.1, 0.3);
  return Math.max(base - penalty, 0.1);
}

const QUICK_ACTIONS = [
  { intent: "create_lead", label: "Create lead" },
  { intent: "start_agreement", label: "Start agreement" },
  { intent: "apply_template", label: "Use template" },
  { intent: "suggest_milestones", label: "Build milestones" },
  { intent: "resume_agreement", label: "Help me finish an agreement" },
  { intent: "navigate_app", label: "Navigate the app" },
];

const INTENT_CONFIG = {
  create_lead: {
    label: "Create lead",
    requiredFields: ["full_name", "phone"],
    destination: "/app/public-presence",
    destinationLabel: "Open Lead Inbox",
    summary: "Capture or move a lead forward without leaving the current workflow.",
  },
  create_customer: {
    label: "Create customer",
    requiredFields: ["full_name", "email"],
    destination: "/app/customers/new",
    destinationLabel: "Open New Customer",
    summary: "Create a customer record with the fields that are still missing.",
  },
  start_agreement: {
    label: "Start agreement",
    requiredFields: ["customer_name", "project_summary"],
    destination: "/app/agreements/new/wizard?step=1",
    destinationLabel: "Open Agreement Wizard",
    summary: "Start a draft agreement in the existing wizard.",
  },
  apply_template: {
    label: "Apply template",
    requiredFields: ["template_query"],
    destination: "/app/templates",
    destinationLabel: "Open Templates",
    summary: "Find and apply a template that matches the current job.",
  },
  suggest_milestones: {
    label: "Suggest milestones",
    requiredFields: ["project_summary"],
    destination: "/app/agreements/new/wizard?step=2",
    destinationLabel: "Open Milestone Builder",
    summary: "Guide milestone drafting and pricing in the existing workflow.",
  },
  collect_clarifications: {
    label: "Collect clarifications",
    requiredFields: ["project_summary"],
    destination: "/app/agreements/new/wizard?step=1",
    destinationLabel: "Open Agreement Details",
    summary: "Gather the missing scope details before drafting.",
  },
  resume_agreement: {
    label: "Resume agreement",
    requiredFields: ["agreement_reference"],
    destination: "/app/agreements",
    destinationLabel: "Open Agreements",
    summary: "Find the blocked step and move the agreement forward.",
  },
  navigate_app: {
    label: "Navigate the app",
    requiredFields: ["destination"],
    destination: "/app/dashboard",
    destinationLabel: "Open Dashboard",
    summary: "Route to the right workflow quickly.",
  },
  template_guidance: {
    label: "Template guidance",
    requiredFields: [],
    destination: "/app/templates",
    destinationLabel: "Review Template",
    summary: "Review reusable workflow gaps, template structure, and next refinements.",
  },
  estimate_project: {
    label: "Estimate project cost",
    requiredFields: ["project_summary"],
    destination: "/app/agreements/new/wizard?step=2",
    destinationLabel: "Open Milestone Builder",
    summary: "Help estimate costs and build a milestone-based budget before committing to scope.",
    keywords: ["estimate", "cost", "budget", "price", "quote", "how much"],
    project_path: ["residential", "commercial"],
  },
  check_compliance: {
    label: "Check compliance requirements",
    requiredFields: ["project_summary"],
    destination: "/app/agreements",
    destinationLabel: "Open Agreements",
    summary: "Surface permit, inspection, and licensing requirements for the project location and type.",
    keywords: ["compliance", "permit", "inspection", "code", "regulation", "zoning", "license required"],
    project_path: ["commercial"],
  },
  subcontractor_assignment: {
    label: "Assign subcontractor",
    requiredFields: ["project_summary"],
    destination: "/app/agreements",
    destinationLabel: "Open Agreements",
    summary: "Link a subcontractor or trade partner to the current job or agreement.",
    keywords: ["sub", "subcontractor", "assign", "crew", "trade", "electrician", "plumber", "hvac sub"],
    project_path: ["commercial"],
  },
  maintenance_contract: {
    label: "Create maintenance contract",
    requiredFields: ["customer_name", "project_summary"],
    destination: "/app/agreements/new/wizard?step=1",
    destinationLabel: "Open Agreement Wizard",
    summary: "Start a recurring or ongoing service agreement for regular maintenance work.",
    keywords: ["maintenance", "recurring", "service contract", "annual", "ongoing", "retainer"],
    project_path: ["residential", "commercial"],
  },
};

const FIELD_LABELS = {
  full_name: "homeowner name",
  phone: "phone number",
  email: "email",
  customer_name: "customer name",
  project_summary: "project summary",
  template_query: "template or job type",
  agreement_reference: "agreement number or title",
  destination: "destination",
};

function clean(value) {
  return String(value || "").trim();
}

function safeObject(value) {
  return value && typeof value === "object" ? value : {};
}

function titleCaseWords(value) {
  return clean(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function titleCaseLoose(value) {
  return clean(value)
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeContext(context = {}) {
  const next = safeObject(context);
  return {
    current_route: clean(next.current_route),
    agreement_id: next.agreement_id ?? null,
    agreement_summary: safeObject(next.agreement_summary),
    lead_id: next.lead_id ?? null,
    lead_summary: safeObject(next.lead_summary),
    template_id: next.template_id ?? null,
    template_summary: safeObject(next.template_summary),
    milestone_summary: safeObject(next.milestone_summary),
    page: clean(next.page),
    active_tab: clean(next.active_tab),
    workflow_profile: safeObject(next.workflow_profile),
    missing_sections: Array.isArray(next.missing_sections) ? next.missing_sections : [],
    pricing_guidance_state: clean(next.pricing_guidance_state),
    unsaved_draft: Boolean(next.unsaved_draft),
    generated_ai_draft: Boolean(next.generated_ai_draft),
  };
}

function detectIntent(input, preferredIntent, context) {
  if (preferredIntent && INTENT_CONFIG[preferredIntent]) {
    return { intent: preferredIntent, matchType: "exact_keyword", is_fallback: false };
  }

  const text = clean(input).toLowerCase();
  const hasAgreementContext = !!context?.agreement_id;
  const hasLeadContext = !!context?.lead_id;
  const isTemplatesPage = clean(context?.page).toLowerCase() === "templates";

  if (!text) {
    if (isTemplatesPage) return { intent: "template_guidance", matchType: "context_override", is_fallback: false };
    if (hasAgreementContext) return { intent: "resume_agreement", matchType: "context_override", is_fallback: false };
    if (hasLeadContext) return { intent: "create_lead", matchType: "context_override", is_fallback: false };
    if (context?.template_id) return { intent: "apply_template", matchType: "context_override", is_fallback: false };
    return { intent: "navigate_app", matchType: "fallback", is_fallback: true };
  }

  if (isTemplatesPage && !/(go to|open |take me|navigate)/.test(text)) {
    if (/\b(use|apply|find|pick)\b/.test(text) && /\btemplate\b/.test(text)) {
      return { intent: "apply_template", matchType: "strong_keyword", is_fallback: false };
    }
    return { intent: "template_guidance", matchType: "context_override", is_fallback: false };
  }

  if (
    text.includes("finish") ||
    text.includes("resume") ||
    text.includes("fix") ||
    text.includes("unstick") ||
    text.includes("blocked")
  ) {
    if (hasAgreementContext) return { intent: "resume_agreement", matchType: "strong_keyword", is_fallback: false };
    if (hasLeadContext) return { intent: "create_lead", matchType: "strong_keyword", is_fallback: false };
  }

  if (text.includes("clarif")) return { intent: "collect_clarifications", matchType: "partial_keyword", is_fallback: false };
  if (text.includes("milestone")) return { intent: "suggest_milestones", matchType: "partial_keyword", is_fallback: false };
  if (isTemplateCreationIntent(text)) return { intent: "template_guidance", matchType: "strong_keyword", is_fallback: false };
  if (text.includes("template")) return { intent: "apply_template", matchType: "partial_keyword", is_fallback: false };
  if (text.includes("customer")) return { intent: "create_customer", matchType: "partial_keyword", is_fallback: false };
  if (text.includes("lead") || text.includes("intake")) return { intent: "create_lead", matchType: "partial_keyword", is_fallback: false };

  // Check multi-word commercial phrases before single-word "contract" to avoid mis-routing.
  if (
    text.includes("maintenance") ||
    text.includes("recurring") ||
    text.includes("service contract") ||
    text.includes("retainer") ||
    text.includes("ongoing contract")
  ) {
    return { intent: "maintenance_contract", matchType: "partial_keyword", is_fallback: false };
  }

  if (text.includes("agreement") || text.includes("contract")) {
    const intent =
      hasAgreementContext &&
      (text.includes("finish") || text.includes("resume") || text.includes("fix"))
        ? "resume_agreement"
        : "start_agreement";
    return { intent, matchType: "strong_keyword", is_fallback: false };
  }

  // Commercial intents — keyword-based primary routing.
  if (/\b(estimate|budget|quote|how much)\b/.test(text) || text.includes("cost estimate")) {
    return { intent: "estimate_project", matchType: "partial_keyword", is_fallback: false };
  }
  if (/\b(compliance|regulation|zoning|license required)\b/.test(text) || text.includes("permit requirement")) {
    return { intent: "check_compliance", matchType: "partial_keyword", is_fallback: false };
  }
  if (/\b(subcontractor|electrician|plumber)\b/.test(text) || /\bassign\b.*(sub|crew|trade)/.test(text) || /\bhvac sub\b/.test(text)) {
    return { intent: "subcontractor_assignment", matchType: "partial_keyword", is_fallback: false };
  }

  if (
    text.includes("go to") ||
    text.includes("open ") ||
    text.includes("take me") ||
    text.includes("navigate")
  ) {
    return { intent: "navigate_app", matchType: "strong_keyword", is_fallback: false };
  }

  if (hasAgreementContext) return { intent: "resume_agreement", matchType: "context_override", is_fallback: false };
  if (hasLeadContext) return { intent: "create_lead", matchType: "context_override", is_fallback: false };
  return { intent: "navigate_app", matchType: "fallback", is_fallback: true };
}

function getTopCandidates(input, primaryIntent, confidence_score) {
  if (confidence_score >= CONFIDENCE_THRESHOLD) return [];
  const text = clean(input).toLowerCase();
  if (!text) return [];

  return Object.entries(INTENT_CONFIG)
    .filter(([key]) => key !== primaryIntent && Array.isArray(INTENT_CONFIG[key].keywords))
    .map(([key, config]) => {
      const matches = config.keywords.filter((kw) => text.includes(kw));
      if (!matches.length) return null;
      const matchType = matches.length >= 2 ? "strong_keyword" : "partial_keyword";
      return {
        intent: key,
        label: config.label,
        destination: config.destination,
        confidence_score: scoreIntent(matchType),
      };
    })
    .filter(Boolean)
    .filter((c) => c.confidence_score >= 0.4)
    .sort((a, b) => b.confidence_score - a.confidence_score)
    .slice(0, 2);
}

function extractEmail(input) {
  return clean(input).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
}

function extractPhone(input) {
  const digits = clean(input).replace(/\D/g, "");
  if (digits.length < 10) return "";
  const local = digits.slice(-10);
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

function extractAgreementReference(input) {
  const hashMatch = clean(input).match(/agreement\s+#?(\d+)/i);
  if (hashMatch?.[1]) return `Agreement #${hashMatch[1]}`;
  return "";
}

function extractName(input) {
  const patterns = [
    /\b(?:for|lead for|customer|homeowner)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/,
    /\b(?:for|lead for|customer|homeowner)\s+([a-z]+(?:\s+[a-z]+){0,2})\b/i,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/,
  ];
  for (const pattern of patterns) {
    const match = clean(input).match(pattern);
    if (match?.[1]) return titleCaseWords(match[1]);
  }
  return "";
}

function inferDestination(input) {
  const text = clean(input).toLowerCase();
  if (text.includes("template")) {
    return { label: "Templates", target: "/app/templates" };
  }
  if (text.includes("customer")) {
    return { label: "Customers", target: "/app/customers" };
  }
  if (text.includes("invoice")) {
    return { label: "Invoices", target: "/app/invoices" };
  }
  if (text.includes("calendar")) {
    return { label: "Calendar", target: "/app/calendar" };
  }
  if (text.includes("lead") || text.includes("public presence") || text.includes("intake")) {
    return { label: "Lead Inbox", target: "/app/public-presence" };
  }
  if (text.includes("agreement")) {
    return { label: "Agreements", target: "/app/agreements" };
  }
  return { label: "Dashboard", target: "/app/dashboard" };
}

function extractProjectSummary(input) {
  const text = clean(input);
  if (!text) return "";

  const stripped = text
    .replace(/^(start|create|build|help|resume|use|apply|open|navigate|go to|finish|fix)\s+/i, "")
    .replace(/\b(agreement|lead|customer|template|milestones?|intake)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length >= 8 ? stripped : "";
}

function extractTemplateQuery(input) {
  const text = clean(input);
  const match = text.match(/(?:template|workflow)(?: for)?\s+(.+)/i);
  if (match?.[1]) return clean(match[1]);
  return /(template|workflow|milestones|exclusions|pricing guidance|scope)/i.test(text) ? text : "";
}

function inferTemplateSubject(input = "", context = {}) {
  const template = context.template_summary || {};
  const source =
    clean(input)
      .replace(/\b(create|build|make|help me|generate|draft|template|workflow|for|me|a|an|the|this)\b/gi, " ")
      .replace(/\b(milestones?|exclusions?|assumptions?|pricing|guidance|scope|profile|improve|add|suggest)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim() ||
    clean(template.project_subtype) ||
    clean(template.project_type) ||
    clean(template.name) ||
    "reusable project";
  return titleCaseLoose(source);
}

function inferProjectTypeFromSubject(subject = "", context = {}) {
  const existing = clean(context.template_summary?.project_type || context.project_type);
  if (existing) return existing;
  const lower = clean(subject).toLowerCase();
  if (/(kitchen|bath|remodel|renovation|basement|addition|flooring|paint|drywall)/.test(lower)) {
    return "Remodel";
  }
  if (/(hvac|plumbing|electrical|service|maintenance|repair|inspection)/.test(lower)) {
    return "Service";
  }
  if (/(junk|clean|haul|removal|demo|demolition)/.test(lower)) {
    return "Cleanup";
  }
  if (/(deck|fence|shed|patio|roof|siding|outdoor|landscape)/.test(lower)) {
    return "Outdoor";
  }
  return "General Contracting";
}

function buildGenericTemplateMilestones(subject = "") {
  const name = clean(subject).toLowerCase();
  const noun = titleCaseLoose(subject || "Project");

  if (/(service|hvac|maintenance|repair|inspection)/.test(name)) {
    return [
      {
        title: "Initial assessment and access confirmation",
        description: "Confirm site access, review service scope assumptions, identify any conditions that may affect the work, and complete safety checks.",
        start_offset: 0,
        duration_days: 1,
        materials_hint: "Safety equipment, diagnostic tools, access confirmation checklist",
        pricing_advisory: true,
        pricing_source_note: "Advisory — adjust based on regional service rates.",
        pricing_confidence: "low",
      },
      {
        title: "Service preparation and safety setup",
        description: "Stage tools and materials, protect adjacent surfaces and equipment, and confirm all pre-work conditions are met before proceeding.",
        start_offset: 1,
        duration_days: 1,
        materials_hint: "Protective covers, staging materials, safety barriers",
        pricing_advisory: true,
        pricing_source_note: "Advisory — adjust based on setup complexity.",
        pricing_confidence: "low",
      },
      {
        title: `${noun} work session`,
        description: `Perform the core ${name} work per scope. Document any findings or conditions requiring scope adjustments.`,
        start_offset: 2,
        duration_days: 2,
        materials_hint: `${noun} components and replacement parts as needed`,
        pricing_advisory: true,
        pricing_source_note: "Advisory — this milestone typically carries the largest share of labor cost.",
        pricing_confidence: "low",
      },
      {
        title: "Testing, cleanup, and homeowner review",
        description: "Verify work quality or system operation, clean the worksite, and walk the homeowner through the completed work. Collect sign-off.",
        start_offset: 4,
        duration_days: 1,
        materials_hint: "Cleanup supplies, final punch list documentation",
        pricing_advisory: true,
        pricing_source_note: "Advisory — closeout and review milestone.",
        pricing_confidence: "low",
      },
    ];
  }

  if (/(junk|clean|haul|removal|demo|demolition)/.test(name)) {
    return [
      {
        title: "Site review and item confirmation",
        description: "Walk through the site to confirm removal scope, document items, and identify access limitations or special disposal requirements.",
        start_offset: 0,
        duration_days: 1,
        materials_hint: "Documentation materials, photography for scope record",
        pricing_advisory: true,
        pricing_source_note: "Advisory — adjust for volume and access complexity.",
        pricing_confidence: "low",
      },
      {
        title: "Access protection and staging",
        description: "Protect floors, walls, and adjacent areas. Stage removal equipment and disposal containers.",
        start_offset: 1,
        duration_days: 1,
        materials_hint: "Floor protection, disposal containers, tarps, safety equipment",
        pricing_advisory: true,
        pricing_source_note: "Advisory — staging milestone.",
        pricing_confidence: "low",
      },
      {
        title: "Removal, hauling, and disposal",
        description: "Remove all confirmed items, haul to appropriate disposal locations, and document any special handling or diversion requirements.",
        start_offset: 2,
        duration_days: 2,
        materials_hint: "Hauling equipment, disposal bags, tarps, tie-downs",
        pricing_advisory: true,
        pricing_source_note: "Advisory — primary labor milestone; adjust for volume and disposal fees.",
        pricing_confidence: "low",
      },
      {
        title: "Final sweep and completion review",
        description: "Conduct a final walkthrough to verify all items have been removed, clean up residual debris, and confirm client satisfaction.",
        start_offset: 4,
        duration_days: 1,
        materials_hint: "Brooms, vacuums, cleanup bags, final debris removal",
        pricing_advisory: true,
        pricing_source_note: "Advisory — closeout milestone.",
        pricing_confidence: "low",
      },
    ];
  }

  return [
    {
      title: "Project setup and site preparation",
      description: "Confirm site access, protect nearby surfaces, review scope assumptions, prepare tools and materials, and identify any conditions that may affect the work.",
      start_offset: 0,
      duration_days: 1,
      materials_hint: "Safety equipment, surface protection materials, staging supplies",
      pricing_advisory: true,
      pricing_source_note: "Advisory — setup and mobilization milestone.",
      pricing_confidence: "low",
    },
    {
      title: "Rough work and core installation",
      description: `Complete the core ${name} work. Address any field conditions discovered during rough-in and document any scope adjustments for client review.`,
      start_offset: 1,
      duration_days: 3,
      materials_hint: `Primary ${name} materials and structural components`,
      pricing_advisory: true,
      pricing_source_note: "Advisory — core labor milestone; typically carries the largest share of project cost.",
      pricing_confidence: "low",
    },
    {
      title: "Finish work and quality review",
      description: "Complete all finish work, inspect systems and surfaces for quality, and address any punch list items before the final walkthrough.",
      start_offset: 4,
      duration_days: 2,
      materials_hint: "Finish materials, trim, sealants, touch-up supplies",
      pricing_advisory: true,
      pricing_source_note: "Advisory — finish milestone.",
      pricing_confidence: "low",
    },
    {
      title: "Cleanup, walkthrough, and closeout",
      description: "Remove all debris and materials, clean the work area, walk the client through the completed work, and collect final sign-off.",
      start_offset: 6,
      duration_days: 1,
      materials_hint: "Cleanup supplies, waste bags, final punch list documentation",
      pricing_advisory: true,
      pricing_source_note: "Advisory — closeout milestone.",
      pricing_confidence: "low",
    },
  ];
}

function stripWorkflowTemplateSuffix(name = "") {
  return String(name || "").replace(/\s*workflow\s+template\s*/gi, "").trim();
}

function buildTemplateDraftPreview(input = "", context = {}) {
  const template = context.template_summary || {};
  const hasPrompt = Boolean(clean(input));
  const subject = inferTemplateSubject(input, context);
  const projectType = inferProjectTypeFromSubject(subject, context);
  const projectSubtype =
    (hasPrompt ? subject : "") ||
    clean(template.project_subtype || context.project_subtype) ||
    subject;

  // Concise reusable name — no "Workflow Template" suffix.
  const templateName =
    stripWorkflowTemplateSuffix(
      (hasPrompt ? projectSubtype : "") ||
      clean(template.name || context.template_name) ||
      projectSubtype
    );

  const projectPath = context.projectPath || context.project_path || "";
  const rawMilestones = getMilestonePattern(projectType || projectSubtype, projectPath);
  const milestones = rawMilestones.map((m) => ({
    ...m,
    start_offset: m.start_offset_days,
  }));
  const assistedDiy =
    /diy|homeowner|shared|assist/i.test(input) ||
    (Array.isArray(context.workflow_profile?.participation_structure) &&
      context.workflow_profile.participation_structure.some((item) => /homeowner|shared/i.test(item)));

  const guidedQuestions = [
    "Should this template support assisted DIY, full-service delivery, or both?",
    "Which phases are reusable across most jobs, and which should stay project-specific?",
    "What exclusions or owner responsibilities commonly prevent scope confusion?",
    "Should pricing guidance be milestone-based, hourly/session-based, or advisory only?",
  ];

  return {
    template_name: templateName,
    project_type: projectType,
    project_subtype: projectSubtype,
    description:
      `Reusable ${projectSubtype.toLowerCase()} workflow covering intake, scope confirmation, preparation, core work, review checkpoints, and closeout. Keep project-specific quantities, selections, and site conditions editable when the template is applied.`,
    exclusions: [
      "Hidden conditions, code-required corrections, and unrelated trade work unless added in writing.",
      "Owner-requested upgrades or specialty materials outside the reusable baseline scope.",
      "Permit, engineering, disposal, or third-party fees unless explicitly included for this workflow.",
    ],
    assumptions: [
      "Access, selections, and site readiness are confirmed before work begins.",
      "Milestones remain reusable and can be resized for each project.",
      assistedDiy
        ? "Homeowner prep tasks and contractor-led technical checkpoints are clearly separated."
        : "Contractor-led work is structured with clear review checkpoints.",
    ],
    milestones,
    workflow_structure: {
      assistance_format: assistedDiy ? "Milestone-Based Assistance" : "Full-service / milestone-based",
      scheduling_mode: "Milestone-driven with adjustable date offsets",
      billing_style: "Advisory milestone pricing only",
      participation_structure: assistedDiy
        ? ["Homeowner prep", "Shared tasks", "Contractor-led technical work", "Inspection / review checkpoints"]
        : ["Contractor-led technical work", "Customer review checkpoints", "Closeout approval"],
    },
    workflow_profile: {
      assistance_format: "milestone_based",
      scheduling_mode: "milestone_driven",
      billing_style: "milestone",
      participation_structure: assistedDiy
        ? ["homeowner_prep", "shared_tasks", "contractor_led_technical_work", "inspection_review_checkpoints"]
        : ["contractor_led_technical_work", "inspection_review_checkpoints"],
    },
    pricing_guidance: [
      "Use advisory ranges or percentages rather than enforced fixed prices.",
      "Add confidence and source notes for each milestone if pricing guidance is used.",
      "Keep material allowances and disposal or permit assumptions visible as notes.",
    ],
    pricing: {
      total_range: "Advisory only — adjust based on your regional labor and material rates.",
      milestone_percentages: milestones.map((m) => ({
        milestone: m.title,
        percentage: `${Math.round(100 / milestones.length)}%`,
        notes: "Reusable estimate — adjust per project scope.",
      })),
    },
    materials: [
      {
        category: "Primary Materials",
        options: [],
        notes: `Core ${projectSubtype.toLowerCase()} materials and structural components.`,
      },
      {
        category: "Protective and Staging",
        options: [],
        notes: "Surface protection, safety equipment, and staging supplies.",
      },
      {
        category: "Cleanup and Closeout",
        options: [],
        notes: "Debris removal bags, cleanup supplies, and final documentation materials.",
      },
    ],
    project_materials_hint: `${projectSubtype} — primary components, protective and staging materials, finish materials, and cleanup supplies.`,
    timeline: (() => {
      const last = milestones[milestones.length - 1];
      const totalDays = (Number(last.start_offset) || 0) + (Number(last.duration_days) || 1);
      return `Typical ${projectSubtype.toLowerCase()} workflow: ${totalDays}+ days depending on scope and site conditions.`;
    })(),
    default_clarifications: guidedQuestions,
    guided_questions: guidedQuestions,
  };
}

function getLeadScopeSummary(leadSummary = {}) {
  return (
    clean(leadSummary.recommended_setup?.project_scope_summary) ||
    clean(leadSummary.project_scope_summary) ||
    clean(leadSummary.project_description) ||
    clean(leadSummary.project_type) ||
    clean(leadSummary.project_title)
  );
}

function buildContextCollectedData(context) {
  const data = {};
  const lead = context.lead_summary;
  const agreement = context.agreement_summary;
  const template = context.template_summary;

  if (context.current_route) data.current_route = context.current_route;
  if (context.lead_id) data.lead_id = context.lead_id;
  if (context.agreement_id) {
    data.agreement_id = context.agreement_id;
    data.agreement_reference =
      clean(agreement.title) || clean(agreement.project_title) || `Agreement #${context.agreement_id}`;
  }
  if (context.template_id) {
    data.template_id = context.template_id;
    if (clean(template.name)) data.template_name = clean(template.name);
  }
  if (clean(lead.full_name)) data.full_name = clean(lead.full_name);
  if (clean(lead.email)) data.email = clean(lead.email);
  if (clean(lead.phone)) data.phone = clean(lead.phone);
  if (clean(lead.full_name)) data.customer_name = clean(lead.full_name);
  if (clean(getLeadScopeSummary(lead))) data.project_summary = clean(getLeadScopeSummary(lead));
  if (lead.recommended_setup && typeof lead.recommended_setup === "object") {
    data.recommended_setup = { ...lead.recommended_setup };
    if (clean(lead.recommended_setup.recommended_project_type)) {
      data.project_type = clean(lead.recommended_setup.recommended_project_type);
    }
    if (clean(lead.recommended_setup.recommended_project_subtype)) {
      data.project_subtype = clean(lead.recommended_setup.recommended_project_subtype);
    }
    if (clean(lead.recommended_setup.recommended_template_id)) {
      data.template_id = lead.recommended_setup.recommended_template_id;
    }
    if (clean(lead.recommended_setup.recommended_template_name) && !data.template_query) {
      data.template_query = clean(lead.recommended_setup.recommended_template_name);
    }
  }
  if (clean(agreement.customer_name || agreement.homeowner_name)) {
    data.customer_name = clean(agreement.customer_name || agreement.homeowner_name);
  }
  if (clean(agreement.project_summary || agreement.project_title || agreement.description)) {
    data.project_summary = clean(
      agreement.project_summary || agreement.project_title || agreement.description
    );
  }
  if (clean(template.project_type || template.name) && !data.template_query) {
    data.template_query = clean(template.name || template.project_type);
  }
  return data;
}

function mergeCollectedData(intent, input, previousPlan, context) {
  const prev = previousPlan?.intent === intent ? previousPlan.collected_data || {} : {};
  const next = {
    ...buildContextCollectedData(context),
    ...prev,
  };

  const email = extractEmail(input);
  const phone = extractPhone(input);
  const name = extractName(input);
  const agreementReference = extractAgreementReference(input);
  const destination = inferDestination(input);
  const projectSummary = extractProjectSummary(input);
  const templateQuery = extractTemplateQuery(input);

  if (intent === "create_lead") {
    if (name) next.full_name = name;
    if (phone) next.phone = phone;
    if (email) next.email = email;
  }
  if (intent === "create_customer") {
    if (name) next.full_name = name;
    if (email) next.email = email;
    if (phone) next.phone = phone;
  }
  if (intent === "start_agreement") {
    if (name) next.customer_name = name;
    if (projectSummary) next.project_summary = projectSummary;
    if (next.recommended_setup?.recommended_project_type) {
      next.project_type = clean(next.recommended_setup.recommended_project_type);
    }
    if (next.recommended_setup?.recommended_project_subtype) {
      next.project_subtype = clean(next.recommended_setup.recommended_project_subtype);
    }
    if (next.recommended_setup?.recommended_template_id) {
      next.template_id = next.recommended_setup.recommended_template_id;
    }
  }
  if (intent === "apply_template") {
    if (templateQuery) next.template_query = templateQuery;
    if (projectSummary && !next.template_query) next.template_query = projectSummary;
  }
  if (intent === "suggest_milestones" || intent === "collect_clarifications") {
    if (projectSummary) next.project_summary = projectSummary;
  }
  if (intent === "resume_agreement") {
    if (agreementReference) next.agreement_reference = agreementReference;
    if (!next.agreement_reference && projectSummary) {
      next.agreement_reference = projectSummary;
    }
  }
  if (intent === "navigate_app") {
    next.destination = destination.label;
    next.navigation_target = destination.target;
  }
  if (intent === "template_guidance") {
    if (templateQuery) next.template_query = templateQuery;
    if (projectSummary) next.project_summary = projectSummary;
    if (input) next.template_request = input;
  }

  return next;
}

function buildLeadDraftPayload(context, collectedData) {
  const lead = context.lead_summary;
  const projectSummary = clean(collectedData.project_summary || lead.project_scope_summary || lead.project_description);
  const recommendedSetup = lead.recommended_setup || {};
  const recommendedTemplateId =
    recommendedSetup.recommended_template_id || lead.ai_analysis?.template_id || null;
  return {
    lead_id: context.lead_id || null,
    homeowner_name: clean(collectedData.customer_name || lead.full_name),
    email: clean(collectedData.email || lead.email),
    phone: clean(collectedData.phone || lead.phone),
    project_title: clean(recommendedSetup.recommended_project_type || lead.project_type || collectedData.project_summary),
    description: projectSummary,
    project_scope_summary: projectSummary,
    project_family_key: clean(lead.project_family_key),
    project_family_label: clean(lead.project_family_label),
    recommended_setup: { ...recommendedSetup },
    selected_template_id: recommendedTemplateId,
    selected_template_name_snapshot: clean(
      recommendedSetup.recommended_template_name || lead.ai_analysis?.template_name || ""
    ),
    address_line1: clean(lead.project_address),
    city: clean(lead.city),
    state: clean(lead.state),
    postal_code: clean(lead.zip_code),
  };
}

function buildSuggestedMilestones(projectSummary, milestoneSummary = {}) {
  if (Array.isArray(milestoneSummary.suggested_titles) && milestoneSummary.suggested_titles.length) {
    return milestoneSummary.suggested_titles.slice(0, 4);
  }
  const summary = clean(projectSummary).toLowerCase();
  if (summary.includes("kitchen")) {
    return ["Prep and protection", "Demo and rough-in", "Cabinets and finishes"];
  }
  if (summary.includes("roof")) {
    return ["Prep and tear-off", "Roof install", "Cleanup and punch list"];
  }
  if (summary.includes("bath")) {
    return ["Demo", "Plumbing and tile", "Fixtures and closeout"];
  }
  return ["Preparation", "Core work", "Final walkthrough"];
}

function buildTemplateContextSuggestions(context = {}) {
  const template = context.template_summary || {};
  const tab = clean(context.active_tab || template.active_tab).toLowerCase() || "setup";
  const milestoneCount = Number(
    context.milestone_summary?.count ?? template.milestone_count ?? 0
  );
  const pricingState = clean(context.pricing_guidance_state || template.pricing_guidance_state);
  const workflow = context.workflow_profile || template.workflow_profile || {};
  const missing = Array.isArray(context.missing_sections) ? context.missing_sections : [];
  const suggestions = [];

  if (milestoneCount <= 1) {
    suggestions.push(`This template has ${milestoneCount || 0} milestone${milestoneCount === 1 ? "" : "s"}; consider adding reusable phases before relying on it.`);
  }
  if (pricingState && pricingState !== "configured") {
    suggestions.push("Advisory pricing guidance is still thin for this template.");
  }
  if (missing.length) {
    suggestions.push(`Missing sections to review: ${missing.slice(0, 4).join(", ")}.`);
  }
  if (!Array.isArray(workflow.participation_structure) || !workflow.participation_structure.length) {
    suggestions.push("Consider adding homeowner prep, shared tasks, or contractor-led checkpoints to the workflow profile.");
  }

  if (tab === "milestones") {
    suggestions.push("Use reusable phases that can survive different job sizes, not one-off project tasks.");
  } else if (tab === "pricing") {
    suggestions.push("Pricing guidance should stay advisory: ranges, confidence, and source notes are more reusable than fixed prices.");
  } else if (tab === "schedule") {
    suggestions.push("Workflow timing should describe cadence and dependencies without locking every future project into exact dates.");
  } else if (tab === "materials") {
    suggestions.push("Material guidance works best as reusable categories plus milestone-specific notes.");
  } else {
    suggestions.push("Tighten scope, exclusions, assumptions, and workflow mode before building detailed milestones.");
  }

  return suggestions.slice(0, 5);
}

function buildClarificationQuestions(projectSummary, context) {
  const agreement = context.agreement_summary;
  return getProjectClarificationQuestions({
    projectTitle: clean(agreement?.project_title || agreement?.title || ""),
    jobDescription: clean(projectSummary),
    scopeOfWork: clean(
      agreement?.scope_of_work ||
        agreement?.description ||
        projectSummary ||
        ""
    ),
    projectType: clean(agreement?.project_type),
    projectSubtype: clean(agreement?.project_subtype),
    projectFamilyLabel: clean(agreement?.project_family_label),
    pendingClarifications: Array.isArray(agreement?.pending_clarifications)
      ? agreement.pending_clarifications
      : [],
  });
}

function buildResumeAgreementPlan(context, collectedData) {
  const agreement = context.agreement_summary;
  const milestone = context.milestone_summary;
  const missingFields = [];
  const blocked = [];
  let wizardStepTarget = 4;
  let nextAction = {
    type: "open_wizard_step",
    label: "Open Finalize Step",
    action_key: "open_wizard_step",
  };

  if (!clean(agreement.customer_name || agreement.homeowner_name)) {
    missingFields.push("customer_name");
    blocked.push("Customer is still missing.");
    wizardStepTarget = 1;
    nextAction = {
      type: "open_wizard_step",
      label: "Finish Agreement Details",
      action_key: "open_wizard_step",
    };
  } else if (!clean(agreement.project_summary || agreement.project_title || agreement.description)) {
    missingFields.push("project_summary");
    blocked.push("Project scope still needs a summary.");
    wizardStepTarget = 1;
    nextAction = {
      type: "open_wizard_step",
      label: "Finish Agreement Details",
      action_key: "open_wizard_step",
    };
  } else if (Number(milestone.count || agreement.milestone_count || 0) <= 0) {
    blocked.push("No milestones are saved yet.");
    wizardStepTarget = 2;
    nextAction = {
      type: "open_wizard_step",
      label: "Open Milestone Builder",
      action_key: "open_wizard_step",
    };
  } else if (Array.isArray(agreement.pending_clarifications) && agreement.pending_clarifications.length) {
    blocked.push("Clarifications still need review.");
    wizardStepTarget = 2;
    nextAction = {
      type: "open_wizard_step",
      label: "Review Clarifications",
      action_key: "review_clarifications",
    };
  } else if (!agreement.ready_to_finalize && clean(agreement.status).toLowerCase() === "draft") {
    blocked.push("Finalize and signature review are still pending.");
    wizardStepTarget = 4;
    nextAction = {
      type: "open_wizard_step",
      label: "Open Finalize Step",
      action_key: "open_wizard_step",
    };
  }

  return {
    missingFields,
    blocked,
    wizardStepTarget,
    nextAction,
    clarificationQuestions: buildClarificationQuestions(
      collectedData.project_summary || agreement.project_summary || agreement.project_title,
      context
    ),
  };
}

function buildIntentPlan(intent, context, collectedData) {
  const lead = context.lead_summary;
  const agreement = context.agreement_summary;
  const template = context.template_summary;
  const milestone = context.milestone_summary;

  let navigationTarget = INTENT_CONFIG[intent].destination;
  let nextAction = {
    type: "navigate",
    label: INTENT_CONFIG[intent].destinationLabel,
  };
  let prefillFields = {};
  let draftPayload = {};
  let wizardStepTarget = null;
  let suggestedMilestones = [];
  let clarificationQuestions = [];
  let blockedWorkflowStates = [];

  if (intent === "create_lead" && context.lead_id) {
    prefillFields = {
      full_name: clean(lead.full_name),
      email: clean(lead.email),
      phone: clean(lead.phone),
      notes: clean(lead.internal_notes),
    };
    draftPayload = {
      lead_id: context.lead_id,
      lead_source: clean(lead.source),
    };
    if (
      clean(lead.source).toLowerCase() === "manual" &&
      !clean(lead.project_description) &&
      clean(lead.email) &&
      !lead.source_intake_id
    ) {
      nextAction = {
        type: "invoke_workflow",
        label: "Send Intake Form",
        action_key: "send_intake_form",
      };
      blockedWorkflowStates.push("Lead needs scope details before AI drafting is useful.");
    } else if (lead.source_intake_id && clean(lead.status).toLowerCase() !== "ready_for_review") {
      nextAction = {
        type: "invoke_workflow",
        label: "Review Intake",
        action_key: "review_lead_intake",
      };
    } else if (!lead.ai_analysis && clean(lead.project_description)) {
      nextAction = {
        type: "invoke_workflow",
        label: "Analyze Intake with AI",
        action_key: "analyze_lead",
      };
    } else if (!lead.converted_agreement) {
      nextAction = {
        type: "invoke_workflow",
        label: "Create AI-Assisted Agreement",
        action_key: "create_agreement_from_lead",
      };
      draftPayload = buildLeadDraftPayload(context, collectedData);
    } else {
      nextAction = {
        type: "navigate",
        label: "Open Draft Agreement",
        action_key: "open_existing_agreement",
      };
      navigationTarget = `/app/agreements/${lead.converted_agreement}`;
    }
  }

  if (intent === "create_customer") {
    prefillFields = {
      full_name: clean(collectedData.full_name || lead.full_name),
      email: clean(collectedData.email || lead.email),
      phone_number: clean(collectedData.phone || lead.phone),
    };
    draftPayload = { ...prefillFields };
  }

  if (intent === "start_agreement") {
    wizardStepTarget = 1;
    if (context.agreement_id) {
      navigationTarget = `/app/agreements/${context.agreement_id}/wizard?step=1`;
      nextAction = {
        type: "open_wizard_step",
        label: "Open Agreement Details",
        action_key: "open_wizard_step",
      };
    } else if (context.lead_id && !lead.converted_agreement) {
      nextAction = {
        type: "invoke_workflow",
        label: "Create AI-Assisted Agreement",
        action_key: "create_agreement_from_lead",
      };
      draftPayload = buildLeadDraftPayload(context, collectedData);
      prefillFields = { ...draftPayload };
    } else if (context.lead_id && lead.converted_agreement) {
      navigationTarget = `/app/agreements/${lead.converted_agreement}/wizard?step=1`;
      nextAction = {
        type: "navigate",
        label: "Open Draft Agreement",
        action_key: "open_existing_agreement",
      };
    }

    prefillFields = {
      ...prefillFields,
      customer_name: clean(collectedData.customer_name || lead.full_name),
      project_title: clean(lead.project_type || agreement.project_title),
      project_summary: clean(collectedData.project_summary || lead.project_scope_summary || lead.project_description),
      project_type: clean(lead.project_type || agreement.project_type),
      project_subtype: clean(lead.project_subtype || agreement.project_subtype),
      template_id: context.template_id || lead.ai_analysis?.template_id || null,
    };
    draftPayload = {
      ...draftPayload,
      customer_name: prefillFields.customer_name,
      project_title: prefillFields.project_title,
      description: prefillFields.project_summary,
      project_type: prefillFields.project_type,
      project_subtype: prefillFields.project_subtype,
      template_id: prefillFields.template_id,
    };
  }

  if (intent === "apply_template") {
    navigationTarget = "/app/templates";
    prefillFields = {
      template_query:
        clean(collectedData.template_query || template.name || lead.ai_analysis?.template_name) ||
        clean(agreement.project_type),
    };
    if (context.template_id) {
      nextAction = {
        type: "navigate",
        label: "Review Current Template",
        action_key: "open_current_template",
      };
    }
    if (context.agreement_id) {
      draftPayload = {
        agreement_id: context.agreement_id,
        template_id: context.template_id || lead.ai_analysis?.template_id || null,
      };
    }
  }

  if (intent === "suggest_milestones") {
    wizardStepTarget = 2;
    navigationTarget = context.agreement_id
      ? `/app/agreements/${context.agreement_id}/wizard?step=2`
      : "/app/agreements/new/wizard?step=2";
    nextAction = {
      type: "open_wizard_step",
      label: "Open Milestone Builder",
      action_key: "open_wizard_step",
    };
    prefillFields = {
      project_summary: clean(
        collectedData.project_summary ||
          lead.project_scope_summary ||
          agreement.project_summary ||
          lead.project_description
      ),
    };
    suggestedMilestones = buildSuggestedMilestones(prefillFields.project_summary, milestone);
    clarificationQuestions = buildClarificationQuestions(prefillFields.project_summary, context);
  }

  if (intent === "collect_clarifications") {
    wizardStepTarget = context.agreement_id ? 2 : 1;
    navigationTarget = context.agreement_id
      ? `/app/agreements/${context.agreement_id}/wizard?step=${wizardStepTarget}`
      : `/app/agreements/new/wizard?step=${wizardStepTarget}`;
    nextAction = {
      type: "open_wizard_step",
      label: wizardStepTarget === 2 ? "Review Clarifications" : "Open Agreement Details",
      action_key: wizardStepTarget === 2 ? "review_clarifications" : "open_wizard_step",
    };
    prefillFields = {
      project_summary: clean(
        collectedData.project_summary ||
          lead.project_scope_summary ||
          agreement.project_summary ||
          lead.project_description
      ),
    };
    clarificationQuestions = buildClarificationQuestions(prefillFields.project_summary, context);
  }

  if (intent === "resume_agreement") {
    const resume = buildResumeAgreementPlan(context, collectedData);
    wizardStepTarget = resume.wizardStepTarget;
    blockedWorkflowStates = resume.blocked;
    clarificationQuestions = resume.clarificationQuestions;
    nextAction = resume.nextAction;
    navigationTarget = context.agreement_id
      ? `/app/agreements/${context.agreement_id}/wizard?step=${wizardStepTarget}`
      : "/app/agreements";
    prefillFields = {
      customer_name: clean(agreement.customer_name || agreement.homeowner_name),
      project_summary: clean(
        agreement.project_summary || agreement.project_title || agreement.description
      ),
    };
    draftPayload = {
      agreement_id: context.agreement_id || null,
      selected_template_id: context.template_id || null,
      milestone_count: Number(milestone.count || agreement.milestone_count || 0),
    };
    return {
      navigationTarget,
      nextAction,
      prefillFields,
      draftPayload,
      wizardStepTarget,
      suggestedMilestones,
      clarificationQuestions,
      blockedWorkflowStates,
      requiredFieldOverrides: resume.missingFields,
    };
  }

  if (intent === "navigate_app") {
    navigationTarget = collectedData.navigation_target || INTENT_CONFIG.navigate_app.destination;
    nextAction = {
      type: "navigate",
      label: "Open Requested Workflow",
      action_key: "open_navigation_target",
    };
  }

  if (intent === "template_guidance") {
    const draftPreview = buildTemplateDraftPreview(
      collectedData.template_request || collectedData.template_query || collectedData.project_summary,
      context
    );
    navigationTarget = context.current_route || "/app/templates";
    nextAction = {
      type: "review_current_page",
      label: "Review Template Guidance",
      action_key: "review_template_guidance",
    };
    prefillFields = {
      template_name: clean(template.name),
      active_tab: clean(context.active_tab || template.active_tab),
      milestone_count: Number(milestone.count || template.milestone_count || 0),
      pricing_guidance_state: clean(context.pricing_guidance_state || template.pricing_guidance_state),
    };
    draftPayload = {
      template_id: context.template_id || null,
      unsaved_draft: Boolean(context.unsaved_draft),
      generated_ai_draft: Boolean(context.generated_ai_draft),
      workflow_profile: context.workflow_profile || template.workflow_profile || {},
    };
    blockedWorkflowStates = buildTemplateContextSuggestions(context);
    prefillFields = {
      ...prefillFields,
      template_query: collectedData.template_query || draftPreview.project_subtype,
    };
    draftPayload = {
      ...draftPayload,
      template_draft_ready: true,
    };
    return {
      navigationTarget,
      nextAction,
      prefillFields,
      draftPayload,
      wizardStepTarget,
      suggestedMilestones,
      clarificationQuestions,
      blockedWorkflowStates,
      requiredFieldOverrides: [],
      previewPayload: {
        template_draft: draftPreview,
        guided_questions: draftPreview.guided_questions,
      },
    };
  }

  return {
    navigationTarget,
    nextAction,
    prefillFields,
    draftPayload,
    wizardStepTarget,
    suggestedMilestones,
    clarificationQuestions,
    blockedWorkflowStates,
    requiredFieldOverrides: [],
  };
}

function buildSuggestions(intent, collectedData, missingFields, context, planDetails) {
  if (planDetails.blockedWorkflowStates?.length) {
    return planDetails.blockedWorkflowStates;
  }
  if (intent === "create_lead") {
    return context.lead_id
      ? [
          "Use the lead-specific action instead of switching workflows manually.",
          "Send intake first if the lead still needs scope details.",
        ]
      : [
          "Use Quick Add Lead when you only have a name and phone number.",
          "Send an intake form after capture if the scope still needs detail.",
        ];
  }
  if (intent === "start_agreement") {
    return [
      "Start from the wizard and let templates plus milestone AI refine the draft.",
      context.lead_id
        ? "This lead context can prefill the draft instead of retyping customer info."
        : "Templates and milestone AI are available once the draft is open.",
    ];
  }
  if (intent === "apply_template") {
    return [
      collectedData.template_query
        ? `Search templates for "${collectedData.template_query}".`
        : "Search by job type, room, or service category.",
      "Apply the template that best matches the current scope before editing milestones.",
    ];
  }
  if (intent === "suggest_milestones") {
    return [
      "Review milestone pricing and timing before saving.",
      "Use clarifications first if the scope is still loose.",
    ];
  }
  if (intent === "resume_agreement") {
    return [
      "Jump to the blocked step instead of scanning the whole wizard.",
      "Use the next action below to resume in the right place.",
    ];
  }
  if (intent === "navigate_app") {
    return missingFields.length
      ? ['Try prompts like "open invoices" or "take me to templates".']
      : [];
  }
  if (intent === "template_guidance") {
    return buildTemplateContextSuggestions(context);
  }
  if (intent === "estimate_project") {
    return [
      "Use the milestone builder to break down costs by phase.",
      "Advisory pricing ranges are more useful than fixed prices at estimate time.",
    ];
  }
  if (intent === "check_compliance") {
    return [
      "Check your trade profile to verify you have the right licenses for this scope.",
      "Permits vary by project type and address — confirm requirements before starting.",
    ];
  }
  if (intent === "subcontractor_assignment") {
    return [
      "Link a subcontractor to the agreement after creating it.",
      "Subcontractors can be added to milestones for scheduling coordination.",
    ];
  }
  if (intent === "maintenance_contract") {
    return [
      "Recurring agreements work best with milestone-based payment triggers.",
      "Use a maintenance template to pre-build the repeatable scope.",
    ];
  }
  return ["I can guide you into the right workflow without replacing it."];
}

function buildFollowUpPrompt(missingFields, planDetails) {
  if (missingFields.length) {
    return `I still need ${missingFields.map((field) => FIELD_LABELS[field]).join(" and ")}.`;
  }
  if (planDetails.blockedWorkflowStates?.length) {
    return planDetails.blockedWorkflowStates[0];
  }
  return "I have enough context to move you into the existing workflow.";
}

function summarizeContext(context = {}) {
  if (context.agreement_id) {
    return `Agreement #${context.agreement_id}`;
  }
  if (context.lead_id) {
    return `Lead #${context.lead_id}`;
  }
  if (context.template_id) {
    return `Template #${context.template_id}`;
  }
  if (context.current_route) {
    return context.current_route;
  }
  return "";
}

export function planAssistantAction({
  input = "",
  preferredIntent = "",
  previousPlan = null,
  context = {},
}) {
  const normalizedContext = normalizeContext(context);
  const fallbackIntent = clean(input) ? "" : previousPlan?.intent;
  const { intent, matchType, is_fallback } = detectIntent(
    input,
    preferredIntent || fallbackIntent,
    normalizedContext
  );
  const config = INTENT_CONFIG[intent];
  const collectedData = mergeCollectedData(intent, input, previousPlan, normalizedContext);
  const planDetails = buildIntentPlan(intent, normalizedContext, collectedData);

  const requiredFieldSource = planDetails.requiredFieldOverrides?.length
    ? planDetails.requiredFieldOverrides
    : (config.requiredFields || []);

  const missingFields = requiredFieldSource.filter((field) => !clean(collectedData[field]));
  const confidence_score = scoreIntent(matchType, missingFields);
  const candidate_intents = getTopCandidates(input, intent, confidence_score);

  const nextAction = missingFields.length
    ? {
        type: "collect_missing_fields",
        label: `Add ${FIELD_LABELS[missingFields[0]]}`,
      }
    : planDetails.nextAction;

  return {
    intent,
    intent_label: config.label,
    collected_data: collectedData,
    missing_fields: missingFields.map((field) => ({
      key: field,
      label: FIELD_LABELS[field],
      prompt: `Add ${FIELD_LABELS[field]}.`,
    })),
    suggestions: buildSuggestions(
      intent,
      collectedData,
      missingFields,
      normalizedContext,
      planDetails
    ),
    next_action: nextAction,
    navigation_target: planDetails.navigationTarget,
    prefill_fields: planDetails.prefillFields || {},
    draft_payload: planDetails.draftPayload || {},
    preview_payload: planDetails.previewPayload || {},
    wizard_step_target: planDetails.wizardStepTarget ?? null,
    suggested_milestones: planDetails.suggestedMilestones || [],
    clarification_questions: planDetails.clarificationQuestions || [],
    blocked_workflow_states: planDetails.blockedWorkflowStates || [],
    context_summary: summarizeContext(normalizedContext),
    summary: config.summary,
    follow_up_prompt: buildFollowUpPrompt(missingFields, planDetails),
    confidence_score,
    candidate_intents,
    is_fallback,
  };
}

export { buildTemplateDraftPreview };

export function getAssistantQuickActions() {
  return QUICK_ACTIONS;
}

// Returns true when a prompt is asking to CREATE a new template, not apply an existing one.
// Used to short-circuit the generic orchestrator before it can mis-classify the prompt.
export function isTemplateCreationIntent(text = "") {
  const lower = String(text || "").toLowerCase().trim();
  if (!lower) return false;
  const hasCreationVerb = /\b(create|build|make|draft|design|generate|write|start)\b/.test(lower);
  const hasTemplateNoun = /\b(template|workflow|reusable|checklist)\b/.test(lower);
  return hasCreationVerb && hasTemplateNoun;
}

export { planAssistantAction as planAssistantActionRules };
