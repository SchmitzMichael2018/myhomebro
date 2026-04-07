function safeText(value) {
  return value == null ? "" : String(value).trim();
}

function money(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function formatMoney(value) {
  return `$${money(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getCustomerEmail(agreement = {}) {
  return (
    safeText(agreement?.homeowner_email) ||
    safeText(agreement?.customer_email) ||
    safeText(agreement?.homeowner?.email) ||
    safeText(agreement?.customer?.email)
  );
}

function getSignatureState(agreement = {}) {
  const contractorRequired =
    agreement?.require_contractor_signature !== false &&
    agreement?.waive_contractor_signature !== true;
  const customerRequired =
    agreement?.require_customer_signature !== false &&
    agreement?.waive_customer_signature !== true;

  const contractorSigned = Boolean(
    agreement?.contractor_signed ||
      agreement?.signed_by_contractor ||
      agreement?.contractor_signed_at
  );
  const customerSigned = Boolean(
    agreement?.homeowner_signed ||
      agreement?.customer_signed ||
      agreement?.signed_by_homeowner ||
      agreement?.customer_signed_at ||
      agreement?.homeowner_signed_at
  );

  return {
    contractorRequired,
    customerRequired,
    contractorSigned,
    customerSigned,
  };
}

function getAgreementTitle(agreement = {}, dLocal = {}) {
  return (
    safeText(dLocal?.project_title) ||
    safeText(agreement?.project_title) ||
    safeText(agreement?.title)
  );
}

function getAgreementScope(agreement = {}, dLocal = {}) {
  return (
    safeText(dLocal?.description) ||
    safeText(agreement?.description) ||
    safeText(agreement?.project_summary)
  );
}

function getAgreementTotal(agreement = {}, milestones = []) {
  const list = Array.isArray(milestones) ? milestones : [];
  return (
    money(
      agreement?.display_total ??
        agreement?.total ??
        agreement?.amount ??
        agreement?.total_cost
    ) || list.reduce((sum, item) => sum + money(item?.amount), 0)
  );
}

function hasSelectedTemplate(agreement = {}, context = {}) {
  return Boolean(
    agreement?.selected_template?.id ||
      agreement?.selected_template_id ||
      context?.template_id
  );
}

export function isTemplateCandidate({
  agreement = {},
  dLocal = {},
  milestones = [],
  context = {},
} = {}) {
  const list = Array.isArray(milestones) ? milestones : [];
  const title = getAgreementTitle(agreement, dLocal);
  const scope = getAgreementScope(agreement, dLocal);
  const total = getAgreementTotal(agreement, list);
  const hasReusableMilestones =
    list.length >= 3 && list.every((row) => safeText(row?.title));

  if (hasSelectedTemplate(agreement, context)) return false;

  return Boolean(hasReusableMilestones && total > 0 && title && scope);
}

function buildTemplateRecommendation({
  agreement = {},
  dLocal = {},
  milestones = [],
  context = {},
} = {}) {
  if (!isTemplateCandidate({ agreement, dLocal, milestones, context })) return null;

  const list = Array.isArray(milestones) ? milestones : [];
  const title = getAgreementTitle(agreement, dLocal);
  const total = getAgreementTotal(agreement, list);

  return {
    title: "This agreement looks reusable",
    body: `${title || "This project"} has ${pluralize(
      list.length,
      "milestone"
    )} and ${formatMoney(total)} in structured work. Save it as a template if you expect to reuse this setup.`,
    actionLabel: "Save as Template",
    actionKey: "save_as_template",
  };
}

export function buildStep4Checklist({
  agreement = {},
  dLocal = {},
  milestones = [],
  sessionState = {},
} = {}) {
  const list = Array.isArray(milestones) ? milestones : [];
  const total =
    money(
      agreement?.display_total ??
        agreement?.total ??
        agreement?.amount ??
        agreement?.total_cost
    ) || list.reduce((sum, item) => sum + money(item?.amount), 0);
  const paymentMode = safeText(dLocal?.payment_mode || agreement?.payment_mode);
  const email = getCustomerEmail(agreement);
  const previewed =
    sessionState?.hasPreviewedPdf === true ||
    agreement?.has_previewed === true ||
    agreement?.previewed === true ||
    agreement?.pdf_previewed === true ||
    agreement?.contractor_previewed === true;

  const signatures = getSignatureState(agreement);

  return [
    list.length
      ? {
          key: "milestones",
          tone: "success",
          label: `${list.length} milestone${list.length === 1 ? "" : "s"} configured · ${formatMoney(total)} total`,
          targetStep: 2,
        }
      : {
          key: "milestones",
          tone: "warning",
          label: "Add milestones and pricing before you send",
          targetStep: 2,
        },
    email
      ? {
          key: "customer_email",
          tone: "success",
          label: "Customer email confirmed",
          targetStep: 1,
        }
      : {
          key: "customer_email",
          tone: "warning",
          label: "Customer email is still missing",
          targetStep: 1,
        },
    paymentMode
      ? {
          key: "payment_mode",
          tone: "success",
          label: `Payment mode selected · ${paymentMode === "direct" ? "Direct pay" : "Escrow"}`,
          targetStep: 1,
        }
      : {
          key: "payment_mode",
          tone: "warning",
          label: "Choose a payment mode before sending",
          targetStep: 1,
        },
    previewed
      ? {
          key: "pdf_preview",
          tone: "success",
          label: "Agreement PDF previewed",
          targetStep: 4,
        }
      : {
          key: "pdf_preview",
          tone: "warning",
          label: "Preview the agreement PDF before sending",
          targetStep: 4,
        },
    signatures.customerSigned
      ? {
          key: "customer_signatures",
          tone: "success",
          label: "Customer signature already completed",
          targetStep: 4,
        }
      : signatures.contractorSigned
      ? {
          key: "customer_signatures",
          tone: "warning",
          label: "Customer signature is the next step after you send",
          targetStep: 4,
        }
      : {
          key: "customer_signatures",
          tone: "warning",
          label: "Contractor signature still needs to start the customer signing flow",
          targetStep: 4,
        },
  ];
}

export function getAiPanelConfigForStep(step, context = {}) {
  const {
    agreement = {},
    dLocal = {},
    milestones = [],
    sessionState = {},
    aiUpdateFeedback = "",
  } = context;

  const milestoneCount = Array.isArray(milestones) ? milestones.length : 0;
  const checklistItems =
    Number(step) === 4
      ? buildStep4Checklist({ agreement, dLocal, milestones, sessionState })
      : [];
  const templateRecommendation =
    Number(step) === 2 || Number(step) === 4
      ? buildTemplateRecommendation({ agreement, dLocal, milestones, context })
      : null;

  const sharedConfig = {
    feedback: safeText(aiUpdateFeedback),
    templateRecommendation,
  };

  if (Number(step) === 1) {
    return {
      ...sharedConfig,
      entryTitle: "Describe the job and I'll help set it up",
      entryDescription:
        "Use AI to shape the first draft faster with scope, template, type, and setup guidance.",
      statusText: "Ready to set up this agreement",
      headline: "Describe the job and I'll help set it up",
      helperText:
        "Use AI to get the agreement started faster with the right scope, setup details, and template fit.",
      quickActions: [
        { label: "Generate Scope", prompt: "Generate a clear project scope from this job description." },
        { label: "Suggest Template", intent: "apply_template" },
        { label: "Prefill Setup", prompt: "Help me prefill the project title, customer, and address details." },
        { label: "Suggest Type", prompt: "Suggest the best project type and subtype for this job." },
      ],
      promptPlaceholder:
        'Example: "Set this up for a roof replacement with permit coordination and cleanup."',
      nextActionText:
        "Next: Confirm the project details you want in the first draft.",
    };
  }

  if (Number(step) === 2) {
    return {
      ...sharedConfig,
      entryTitle:
        milestoneCount > 0
          ? "I can refine milestones, pricing, and timing from here"
          : "I've prepared milestone suggestions for this project",
      entryDescription:
        "Use AI to shape milestone structure, pricing guidance, and timeline decisions without leaving the wizard.",
      statusText:
        milestoneCount > 0 ? "Milestone plan ready to refine" : "Ready to build the milestone plan",
      headline: "I've prepared milestone suggestions for this project",
      helperText:
        "Use AI to shape milestones, pricing, and timing without leaving the wizard.",
      quickActions: [
        { label: "Suggest Milestones", intent: "suggest_milestones" },
        { label: "Suggest Pricing", prompt: "Review this project and suggest milestone pricing." },
        { label: "Adjust Timeline", prompt: "Suggest a milestone timeline for this agreement." },
        { label: "Refine Scope", prompt: "Refine the milestone structure to make it easier to invoice and manage." },
      ],
      promptPlaceholder:
        'Example: "Split this project into milestone phases with realistic pricing and dates."',
      nextActionText:
        "Next: Review the milestones below and click Save & Next when the plan looks right.",
    };
  }

  if (Number(step) === 3) {
    return {
      ...sharedConfig,
      entryTitle: "Here's what you may want to document",
      entryDescription:
        "Use AI to pressure-test warranty, attachments, and clarification details before you finalize the agreement.",
      statusText: "Protection details are ready to review",
      headline: "Here's what you may want to document",
      helperText:
        "Use AI to strengthen warranty language, documentation, and clarifications before you finalize the agreement.",
      quickActions: [
        { label: "Suggest Warranty", prompt: "Suggest warranty language for this project." },
        { label: "Suggest Attachments", prompt: "What attachments or photos should be included for this agreement?" },
        { label: "Reduce Disputes", prompt: "What clarifications would reduce disputes on this agreement?" },
      ],
      promptPlaceholder:
        'Example: "Review this agreement and suggest documentation that protects both sides."',
      nextActionText:
        "Next: Add any warranty details or supporting documents you want included.",
    };
  }

  return {
    ...sharedConfig,
    entryTitle: "Let me check everything before you send",
    entryDescription:
      "Use AI as a final reviewer before contractor signing, customer signing, and funding.",
    statusText: "Agreement ready to review",
    headline: "Let me check everything before you send",
    helperText:
      "Use AI to catch missing details and confirm the agreement is ready before it goes out for signature.",
    quickActions: [
      { label: "Run Checklist", prompt: "Run a final pre-send checklist for this agreement." },
      { label: "Review Risks", prompt: "Flag anything risky or missing before I send this agreement." },
      { label: "Check PDF", prompt: "Should I preview the PDF before sending this agreement?" },
      { label: "Confirm Readiness", prompt: "Confirm whether this agreement is ready to sign and send." },
    ],
    promptPlaceholder:
      'Example: "Check this agreement for anything missing before I send it to the customer."',
    checklistItems,
    nextActionText:
      "Next: Review the PDF, then sign and send when everything looks right.",
    nextGuidanceTitle: "What happens next",
    nextGuidance:
      "After you sign, the customer gets a review and signature link. Once both sides sign, funding can move forward and you'll be notified when the customer completes their step.",
  };
}

function readWizardStep(context = {}) {
  const route = safeText(context?.current_route);
  const match = route.match(/[?&]step=(\d+)/);
  return match ? Number(match[1]) : null;
}

function deriveSummaryLine(context = {}, plan = {}) {
  const agreementSummary = context?.agreement_summary || {};
  const milestoneSummary = context?.milestone_summary || {};
  const title = safeText(
    agreementSummary?.project_title || agreementSummary?.title || agreementSummary?.project_summary
  );
  const customer = safeText(agreementSummary?.customer_name);
  const subtype = safeText(agreementSummary?.project_subtype || agreementSummary?.project_type);
  const milestoneCount = Number(
    agreementSummary?.milestone_count ?? milestoneSummary?.count ?? 0
  );
  const estimateTotal =
    plan?.applyable_preview?.estimate_preview?.suggested_total_price ??
    plan?.preview_payload?.estimate_preview?.suggested_total_price ??
    null;

  const parts = [];
  if (milestoneCount > 0) parts.push(pluralize(milestoneCount, "milestone"));
  if (Number.isFinite(Number(estimateTotal)) && Number(estimateTotal) > 0) {
    parts.push(formatMoney(estimateTotal));
  }
  if (subtype) {
    parts.push(subtype);
  } else if (title) {
    parts.push(title);
  }
  if (!parts.length && customer) parts.push(customer);
  return parts.slice(0, 3).join(" · ");
}

function fallbackStatusForStep(step, panelConfig = {}) {
  if (safeText(panelConfig.statusText)) return safeText(panelConfig.statusText);
  if (step === 1) return "Ready to set up this agreement";
  if (step === 2) return "Milestone plan ready";
  if (step === 3) return "Protection details are ready to review";
  if (step === 4) return "Agreement ready to review";
  return "How can I help?";
}

function sanitizeActionLabel(label) {
  const clean = safeText(label);
  if (!clean) return "";
  if (clean === "Open Requested Workflow") return "Open the next step";
  return clean;
}

export function buildUserFacingAiPanel({
  context = {},
  panelConfig = {},
  plan = {},
  isPlanning = false,
  history = [],
} = {}) {
  const step = readWizardStep(context);
  const status = isPlanning
    ? "Working on your request"
    : fallbackStatusForStep(step, panelConfig);
  const summaryLine = deriveSummaryLine(context, plan);
  const statusDetail =
    summaryLine || safeText(plan?.summary) || safeText(panelConfig.helperText);
  const navigationTarget = safeText(plan?.navigation_target);
  const currentRoute = safeText(context?.current_route);
  const primaryActionLabel = sanitizeActionLabel(plan?.next_action?.label);
  const showPrimaryAction =
    !!navigationTarget &&
    navigationTarget !== currentRoute &&
    plan?.next_action?.type !== "collect_missing_fields";
  const nextActionText = showPrimaryAction
    ? `Next: ${primaryActionLabel || "Open the next step"}.`
    : safeText(panelConfig.nextActionText) ||
      safeText(plan?.follow_up_prompt) ||
      "Next: Review the suggested update and continue when you're ready.";

  return {
    headline: safeText(panelConfig.headline) || "Tell me what you want to do",
    helperText: safeText(panelConfig.helperText),
    status,
    statusDetail,
    quickActions: Array.isArray(panelConfig.quickActions) ? panelConfig.quickActions : [],
    promptPlaceholder:
      safeText(panelConfig.promptPlaceholder) || "Ask AI what you want to improve.",
    feedback: safeText(panelConfig.feedback),
    checklistItems: Array.isArray(panelConfig.checklistItems) ? panelConfig.checklistItems : [],
    templateRecommendation:
      panelConfig?.templateRecommendation &&
      typeof panelConfig.templateRecommendation === "object"
        ? {
            title: safeText(panelConfig.templateRecommendation.title),
            body: safeText(panelConfig.templateRecommendation.body),
            actionLabel:
              safeText(panelConfig.templateRecommendation.actionLabel) ||
              "Save as Template",
            actionKey: safeText(panelConfig.templateRecommendation.actionKey),
          }
        : null,
    nextActionText,
    nextGuidanceTitle:
      safeText(panelConfig.nextGuidanceTitle) || "What happens next",
    nextGuidance: safeText(panelConfig.nextGuidance),
    showPrimaryAction,
    primaryActionLabel: primaryActionLabel || "Open the next step",
    diagnostics: {
      step,
      intentLabel: safeText(plan?.intent_label),
      summary: safeText(plan?.summary),
      collectedData:
        plan?.collected_data && typeof plan.collected_data === "object" ? plan.collected_data : {},
      missingFields: Array.isArray(plan?.missing_fields) ? plan.missing_fields : [],
      suggestions: Array.isArray(plan?.suggestions) ? plan.suggestions : [],
      history: Array.isArray(history) ? history : [],
      raw: {
        intent: plan?.intent,
        primary_intent: plan?.primary_intent,
        next_action: plan?.next_action,
        navigation_target: plan?.navigation_target,
        wizard_step_target: plan?.wizard_step_target,
        prefill_fields: plan?.prefill_fields,
        draft_payload: plan?.draft_payload,
        automation_plan: plan?.automation_plan,
        proactive_recommendations: plan?.proactive_recommendations,
        predictive_insights: plan?.predictive_insights,
        planning_confidence: plan?.planning_confidence,
        reasoning_source: plan?.reasoning_source,
        selected_routines: plan?.selected_routines,
        confirmation_required: plan?.confirmation_required,
      },
    },
  };
}
