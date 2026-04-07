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

  const sharedConfig = {
    feedback: safeText(aiUpdateFeedback),
  };

  if (Number(step) === 1) {
    return {
      ...sharedConfig,
      entryTitle: "Describe the job and I’ll help set it up",
      entryDescription:
        "Use AI to shape the first draft faster with scope, template, type, and setup guidance.",
      headline: "Describe the job and I’ll help set it up",
      helperText:
        "I’m focused on getting the agreement started quickly with the right project context and setup fields.",
      quickActions: [
        { label: "Generate Scope", prompt: "Generate a clear project scope from this job description." },
        { label: "Suggest Template", intent: "apply_template" },
        { label: "Prefill Setup", prompt: "Help me prefill the project title, customer, and address details." },
        { label: "Suggest Type", prompt: "Suggest the best project type and subtype for this job." },
      ],
      promptPlaceholder:
        'Example: "Set this up for a roof replacement with permit coordination and cleanup."',
    };
  }

  if (Number(step) === 2) {
    return {
      ...sharedConfig,
      entryTitle:
        milestoneCount > 0
          ? "I can refine milestones, pricing, and timing from here"
          : "I’ve prepared milestone suggestions for this project",
      entryDescription:
        "Use AI to shape milestone structure, pricing guidance, and timeline decisions without leaving the wizard.",
      headline: "I’ve prepared milestone suggestions for this project",
      helperText:
        "I’m focused on planning the work clearly, pricing it confidently, and showing what changed when I update milestone data.",
      quickActions: [
        { label: "Suggest Milestones", intent: "suggest_milestones" },
        { label: "Suggest Pricing", prompt: "Review this project and suggest milestone pricing." },
        { label: "Suggest Timeline", prompt: "Suggest a milestone timeline for this agreement." },
        { label: "Refine Structure", prompt: "Refine the milestone structure to make it easier to invoice and manage." },
      ],
      promptPlaceholder:
        'Example: "Split this project into milestone phases with realistic pricing and dates."',
    };
  }

  if (Number(step) === 3) {
    return {
      ...sharedConfig,
      entryTitle: "Here’s what you may want to document",
      entryDescription:
        "Use AI to pressure-test warranty, attachments, and clarification details before you finalize the agreement.",
      headline: "Here’s what you may want to document",
      helperText:
        "I’m focused on reducing disputes by strengthening warranty language, documentation, and project clarifications.",
      quickActions: [
        { label: "Suggest Warranty", prompt: "Suggest warranty language for this project." },
        { label: "Suggest Attachments", prompt: "What attachments or photos should be included for this agreement?" },
        { label: "Reduce Disputes", prompt: "What clarifications would reduce disputes on this agreement?" },
      ],
      promptPlaceholder:
        'Example: "Review this agreement and suggest documentation that protects both sides."',
    };
  }

  return {
    ...sharedConfig,
    entryTitle: "Let me check everything before you send",
    entryDescription:
      "Use AI as a final reviewer before contractor signing, customer signing, and funding.",
    headline: "Let me check everything before you send",
    helperText:
      "I’m focused on readiness, missing details, and the final steps needed before the agreement goes out for signature.",
    quickActions: [
      { label: "Run Checklist", prompt: "Run a final pre-send checklist for this agreement." },
      { label: "Review Risks", prompt: "Flag anything risky or missing before I send this agreement." },
      { label: "Check PDF", prompt: "Should I preview the PDF before sending this agreement?" },
      { label: "Confirm Readiness", prompt: "Confirm whether this agreement is ready to sign and send." },
    ],
    promptPlaceholder:
      'Example: "Check this agreement for anything missing before I send it to the customer."',
    checklistItems,
    nextGuidanceTitle: "What happens next",
    nextGuidance:
      "After you sign, the customer gets a review and signature link. Once both sides sign, funding can move forward and you’ll be notified when the customer completes their step.",
  };
}
