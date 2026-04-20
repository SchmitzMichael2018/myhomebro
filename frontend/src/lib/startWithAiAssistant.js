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
  };
}

function detectIntent(input, preferredIntent, context) {
  if (preferredIntent && INTENT_CONFIG[preferredIntent]) return preferredIntent;

  const text = clean(input).toLowerCase();
  const hasAgreementContext = !!context?.agreement_id;
  const hasLeadContext = !!context?.lead_id;

  if (!text) {
    if (hasAgreementContext) return "resume_agreement";
    if (hasLeadContext) return "create_lead";
    if (context?.template_id) return "apply_template";
    return "navigate_app";
  }

  if (
    text.includes("finish") ||
    text.includes("resume") ||
    text.includes("fix") ||
    text.includes("unstick") ||
    text.includes("blocked")
  ) {
    if (hasAgreementContext) return "resume_agreement";
    if (hasLeadContext) return "create_lead";
  }

  if (text.includes("clarif")) return "collect_clarifications";
  if (text.includes("milestone")) return "suggest_milestones";
  if (text.includes("template")) return "apply_template";
  if (text.includes("customer")) return "create_customer";
  if (text.includes("lead") || text.includes("intake")) return "create_lead";
  if (text.includes("agreement") || text.includes("contract")) {
    return hasAgreementContext &&
      (text.includes("finish") || text.includes("resume") || text.includes("fix"))
      ? "resume_agreement"
      : "start_agreement";
  }
  if (
    text.includes("go to") ||
    text.includes("open ") ||
    text.includes("take me") ||
    text.includes("navigate")
  ) {
    return "navigate_app";
  }

  if (hasAgreementContext) return "resume_agreement";
  if (hasLeadContext) return "create_lead";
  return "navigate_app";
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
  const match = text.match(/template(?: for)?\s+(.+)/i);
  if (match?.[1]) return clean(match[1]);
  return text.toLowerCase().includes("template") ? text : "";
}

function getLeadScopeSummary(leadSummary = {}) {
  return (
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

  return next;
}

function buildLeadDraftPayload(context, collectedData) {
  const lead = context.lead_summary;
  const projectSummary = clean(collectedData.project_summary || lead.project_scope_summary || lead.project_description);
  return {
    lead_id: context.lead_id || null,
    homeowner_name: clean(collectedData.customer_name || lead.full_name),
    email: clean(collectedData.email || lead.email),
    phone: clean(collectedData.phone || lead.phone),
    project_title: clean(lead.project_type || collectedData.project_summary),
    description: projectSummary,
    project_scope_summary: projectSummary,
    project_family_key: clean(lead.project_family_key),
    project_family_label: clean(lead.project_family_label),
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

function buildClarificationQuestions(projectSummary, context) {
  const questions = [];
  const agreement = context.agreement_summary;
  const existing = Array.isArray(agreement.pending_clarifications)
    ? agreement.pending_clarifications
    : [];
  if (existing.length) {
    return existing.slice(0, 4).map((item) => String(item).trim()).filter(Boolean);
  }
  if (!clean(projectSummary)) {
    questions.push("What work is included in the project scope?");
  }
  questions.push("Who is supplying materials?");
  questions.push("What timeline or completion date matters most?");
  if (clean(projectSummary).toLowerCase().includes("remodel")) {
    questions.push("What fixtures or finish level should pricing assume?");
  }
  return [...new Set(questions)].slice(0, 4);
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
  const intent = detectIntent(input, preferredIntent || fallbackIntent, normalizedContext);
  const config = INTENT_CONFIG[intent];
  const collectedData = mergeCollectedData(intent, input, previousPlan, normalizedContext);
  const planDetails = buildIntentPlan(intent, normalizedContext, collectedData);

  const requiredFieldSource = planDetails.requiredFieldOverrides?.length
    ? planDetails.requiredFieldOverrides
    : config.requiredFields;

  const missingFields = requiredFieldSource.filter((field) => !clean(collectedData[field]));

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
    wizard_step_target: planDetails.wizardStepTarget ?? null,
    suggested_milestones: planDetails.suggestedMilestones || [],
    clarification_questions: planDetails.clarificationQuestions || [],
    blocked_workflow_states: planDetails.blockedWorkflowStates || [],
    context_summary: summarizeContext(normalizedContext),
    summary: config.summary,
    follow_up_prompt: buildFollowUpPrompt(missingFields, planDetails),
  };
}

export function getAssistantQuickActions() {
  return QUICK_ACTIONS;
}

export { planAssistantAction as planAssistantActionRules };
