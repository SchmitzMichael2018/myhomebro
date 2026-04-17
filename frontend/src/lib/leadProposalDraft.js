function safeText(value) {
  return String(value || "").trim();
}

function sentenceList(items) {
  return items.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function bullets(items) {
  return items.filter(Boolean).map((item) => `- ${item}`);
}

function formatMeasurementLine(value) {
  const text = safeText(value).toLowerCase();
  if (!text) return "Measurements may still need to be verified before pricing is finalized.";
  if (text.includes("site visit")) return "Measurements may need a site visit before final pricing.";
  if (text.includes("provided")) return "Measurements were provided, but I would still confirm them against the final scope.";
  if (text.includes("not sure")) return "Measurements are still uncertain, so a quick verification step may help before pricing.";
  return `Measurement note: ${value}.`;
}

function leadSummaryFromRow(row = {}) {
  const snapshot = row?.request_snapshot || row?.ai_analysis?.request_snapshot || {};
  const title = safeText(snapshot.project_title || row.project_title || row.project_type || "Project Request");
  const projectType = safeText(snapshot.project_type || row.project_type || "");
  const area = safeText(snapshot.project_subtype || row.project_subtype || "");
  const description = safeText(snapshot.refined_description || row.notes || row.project_description || "");
  const location = safeText(snapshot.location || row.location || row.project_address || "");
  const signals = Array.isArray(snapshot.request_signals)
    ? snapshot.request_signals
    : Array.isArray(row.request_signals)
    ? row.request_signals
    : [];

  return {
    source: safeText(row.source_kind || row.source_kind_label || "lead"),
    full_name: safeText(row.customer_name || row.full_name || ""),
    email: safeText(row.customer_email || row.email || ""),
    phone: safeText(row.customer_phone || row.phone || ""),
    project_title: title,
    project_type: projectType,
    project_subtype: area,
    project_description: description,
    project_address: location,
    city: safeText(row.city || snapshot.city || ""),
    state: safeText(row.state || snapshot.state || ""),
    zip_code: safeText(row.zip_code || snapshot.zip_code || ""),
    status: safeText(row.status || ""),
    source_intake_id: row.source_intake_id || null,
    converted_agreement: row.linked_agreement_id || row.converted_agreement || null,
    ai_analysis: row.ai_analysis || null,
    internal_notes: safeText(row.internal_notes || ""),
    request_snapshot: snapshot,
    request_signals: signals,
  };
}

export { leadSummaryFromRow };

export function buildLeadProposalDraft({ leadSummary = {}, requestSnapshot = {} } = {}) {
  const summary = leadSummary || {};
  const snapshot = requestSnapshot || summary.request_snapshot || {};

  const projectTitle = safeText(snapshot.project_title || summary.project_title || "Project Proposal");
  const projectType = safeText(snapshot.project_type || summary.project_type || "");
  const projectSubtype = safeText(snapshot.project_subtype || summary.project_subtype || "");
  const refinedDescription = safeText(snapshot.refined_description || summary.project_description || "");
  const location = safeText(snapshot.location || summary.project_address || "");
  const budget = safeText(snapshot.budget || summary.budget_text || "");
  const timeline = safeText(snapshot.timeline || summary.preferred_timeline || "");
  const measurementHandling = safeText(snapshot.measurement_handling || summary.measurement_handling || "");
  const requestPath = safeText(snapshot.request_path_label || "");
  const clarificationSummary = Array.isArray(snapshot.clarification_summary) ? snapshot.clarification_summary : [];
  const milestones = Array.isArray(snapshot.milestones) ? snapshot.milestones : [];
  const photoCount = Number(snapshot.photo_count || 0);
  const requestSignals = Array.isArray(snapshot.request_signals) ? snapshot.request_signals : [];
  const materialsStatus = safeText(snapshot.materials_status || "");

  const introParts = [
    `Thanks for sharing the details for ${projectTitle}.`,
    "I reviewed the request and put together a starting proposal draft you can edit before sending.",
  ];

  const scopeBullets = [];
  if (projectType || projectSubtype) {
    scopeBullets.push(
      `Scope focus: ${sentenceList([projectType, projectSubtype].filter(Boolean))}.`
    );
  }
  if (refinedDescription) {
    scopeBullets.push(`Project summary: ${refinedDescription}`);
  }
  if (location) {
    scopeBullets.push(`Location: ${location}.`);
  }
  if (photoCount > 0) {
    scopeBullets.push(
      `${photoCount} photo${photoCount === 1 ? "" : "s"} attached, which helps confirm the scope.`
    );
  }
  if (clarificationSummary.length) {
    scopeBullets.push(
      `Clarifications already captured: ${clarificationSummary
        .slice(0, 3)
        .map((item) => safeText(item.label || item.key))
        .filter(Boolean)
        .join(", ")}.`
    );
  }
  if (requestPath) {
    scopeBullets.push(`Request type: ${requestPath}.`);
  }
  if (requestSignals.length) {
    const visibleSignals = requestSignals.slice(0, 3).join(", ");
    scopeBullets.push(`Helpful signals: ${visibleSignals}.`);
  }

  const confirmationBullets = [];
  confirmationBullets.push(formatMeasurementLine(measurementHandling));
  if (materialsStatus) {
    confirmationBullets.push(`Materials note: ${materialsStatus}.`);
  } else {
    confirmationBullets.push("Materials responsibility should be confirmed before the bid is finalized.");
  }
  if (timeline) {
    confirmationBullets.push(`Timing guidance: ${timeline}.`);
  } else {
    confirmationBullets.push("The timeline can be reviewed and adjusted with the customer if needed.");
  }
  if (budget) {
    confirmationBullets.push(`Budget guidance was shared: ${budget}.`);
  }
  if (milestones.length) {
    confirmationBullets.push(`Project phases to review: ${milestones.slice(0, 3).join(" • ")}.`);
  }

  const close =
    "If this looks right, I’m happy to review the next steps and refine the bid with you.";

  const text = [
    "Opening",
    sentenceList(introParts),
    "",
    "Scope understanding",
    ...bullets(scopeBullets.length ? scopeBullets : ["Review the project details and confirm the scope before sending."]),
    "",
    "Important confirmation points",
    ...bullets(confirmationBullets),
    "",
    "Close",
    close,
  ].join("\n");

  return {
    title: projectTitle,
    text,
    summary: {
      projectTitle,
      projectType,
      projectSubtype,
      refinedDescription,
      location,
      budget,
      timeline,
      measurementHandling,
      photoCount,
      requestPath,
      requestSignals: requestSignals.slice(0, 4),
      milestones: milestones.slice(0, 4),
      materialsStatus,
      clarificationCount: clarificationSummary.length,
    },
  };
}

export function buildLeadAgreementAssistantState(row = {}, { currentRoute = "/app/bids" } = {}) {
  const summary = leadSummaryFromRow(row);
  const snapshot = summary.request_snapshot || {};
  const proposalDraft = buildLeadProposalDraft({ leadSummary: summary, requestSnapshot: snapshot });

  const projectTitle = safeText(proposalDraft.title || summary.project_title || row.project_title || "");
  const requestPath = safeText(snapshot.request_path_label || "");

  const addressCity = safeText(summary.city || "");
  const addressState = safeText(summary.state || "");
  const addressPostal = safeText(summary.zip_code || "");

  return {
    assistantIntent: "start_agreement",
    assistantWizardStepTarget: 1,
    assistantContext: {
      current_route: currentRoute,
      lead_id: row?.source_id || row?.id || null,
      lead_summary: summary,
      request_snapshot: snapshot,
    },
    assistantPrefill: {
      full_name: safeText(row.customer_name || row.full_name || ""),
      customer_name: safeText(row.customer_name || row.full_name || ""),
      email: safeText(row.customer_email || row.email || ""),
      phone: safeText(row.customer_phone || row.phone || ""),
      address_line1: safeText(row.project_address || ""),
      address_line2: "",
      city: addressCity,
      state: addressState,
      postal_code: addressPostal,
      project_title: projectTitle,
      project_summary: proposalDraft.text,
      project_type: safeText(summary.project_type || ""),
      project_subtype: safeText(summary.project_subtype || ""),
      request_path_label: requestPath,
    },
    assistantDraftPayload: {
      lead_id: row?.source_id || row?.id || null,
      lead_source: safeText(row.source_kind || "lead"),
      customer_name: safeText(row.customer_name || row.full_name || ""),
      email: safeText(row.customer_email || row.email || ""),
      phone: safeText(row.customer_phone || row.phone || ""),
      project_title: projectTitle,
      description: proposalDraft.text,
      project_summary: proposalDraft.text,
      project_type: safeText(summary.project_type || ""),
      project_subtype: safeText(summary.project_subtype || ""),
      measurement_handling: safeText(snapshot.measurement_handling || ""),
      budget: safeText(snapshot.budget || row.budget_text || ""),
      timeline: safeText(snapshot.timeline || row.preferred_timeline || ""),
      request_path_label: requestPath,
      photo_count: Number(snapshot.photo_count || 0),
      clarification_count: Number(snapshot.clarification_count || 0),
      request_signals: Array.isArray(snapshot.request_signals) ? snapshot.request_signals : [],
      request_snapshot: snapshot,
    },
  };
}
