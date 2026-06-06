function clean(value) {
  return value == null ? "" : String(value).trim();
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function hasValue(object, key) {
  return object && Object.prototype.hasOwnProperty.call(object, key) && object[key] != null;
}

function firstNumber(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export function readWizardStep(context = {}) {
  const direct = Number(context?.wizard_step);
  if (Number.isFinite(direct) && direct >= 1 && direct <= 4) return Math.floor(direct);
  const route = clean(context?.current_route);
  const match = route.match(/[?&]step=(\d+)/i);
  const parsed = Number(match?.[1]);
  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 4) return Math.floor(parsed);
  return 1;
}

export function formatAssistantCurrency(value) {
  const n = toNumber(value);
  if (!n) return "$0";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  });
}

export function buildProjectAssistantSummary(context = {}) {
  const agreement = context?.agreement_summary || {};
  const milestoneSummary = context?.milestone_summary || {};
  const templateSummary = context?.template_summary || {};
  const total = firstNumber(
    milestoneSummary.total,
    agreement.pricing_total,
    agreement.total_cost,
    agreement.total
  );
  const milestoneCount = hasValue(milestoneSummary, "count")
    ? toNumber(milestoneSummary.count)
    : toNumber(agreement.milestone_count);
  const templateName =
    clean(templateSummary.name) ||
    clean(context?.selected_template_name) ||
    clean(context?.template_name);

  return {
    title:
      clean(agreement.project_title) ||
      clean(agreement.title) ||
      clean(agreement.project_summary) ||
      "Current agreement",
    step: readWizardStep(context),
    milestoneCount,
    total,
    templateStatus: templateName ? `Template: ${templateName}` : "No source template",
    projectType: [agreement.project_type, agreement.project_subtype].map(clean).filter(Boolean).join(" / "),
  };
}

function action(key, label, description, options = {}) {
  return {
    key,
    actionKey: key,
    label,
    description,
    ...options,
  };
}

export function buildProjectAssistantActions(context = {}) {
  const summary = buildProjectAssistantSummary(context);
  const agreement = context?.agreement_summary || {};
  const templateSummary = context?.template_summary || {};
  const pricingGuidance = context?.pricing_guidance || {};
  const timelineGuidance = context?.timeline_guidance || {};
  const hasMilestones = summary.milestoneCount > 0;
  const hasTotal = summary.total > 0 || toNumber(pricingGuidance.target_total) > 0;
  const hasGeneratedPlan = Boolean(context?.milestone_summary?.has_generated_preview);
  const hasTimelineSuggestion = Boolean(timelineGuidance.available || context?.milestone_summary?.has_timeline_suggestion);
  const isTemplateBacked = Boolean(
    context?.template_id ||
      context?.selected_template_id ||
      clean(templateSummary.name)
  );
  const canUpdateSource = Boolean(
    templateSummary.can_update_source ||
      templateSummary.can_update_from_agreement ||
      context?.can_update_source_template
  );

  if (summary.step === 1) {
    return {
      recommended: [
        action(
          "step1_improve_scope",
          "Improve Scope",
          "Use the current project details to improve the scope draft.",
          { prompt: "Improve the scope for this agreement." }
        ),
        action(
          "step1_generate_scope_draft",
          "Generate Scope Draft",
          "Create a contractor-ready scope draft from the project details.",
          { prompt: "Generate a scope draft for this agreement." }
        ),
        action(
          "step1_improve_classification",
          "Improve Classification",
          "Review the project title, type, and subtype from the description.",
          { prompt: "Improve the project title, type, and subtype without changing contractor edits." }
        ),
      ],
      additional: [],
    };
  }

  if (summary.step === 2) {
    const recommended = [];

    if (!hasTotal) {
      recommended.push(
        action(
          "step2_enter_project_total",
          "Enter Project Total",
          "Focus the target total field before rebalancing milestone pricing."
        )
      );
    }

    if (hasMilestones) {
      recommended.push(
        action(
          "step2_improve_descriptions",
          "Improve Milestone Descriptions",
          "Refresh milestone descriptions using the current scope."
        )
      );
      if (!hasGeneratedPlan) {
        recommended.push(
          action(
            "step2_regenerate_plan",
            "Regenerate Milestone Plan",
            "Generate a reviewable milestone plan before replacing anything."
          )
        );
      }
    } else {
      recommended.push(
        action(
          "step2_generate_milestone_plan",
          "Generate Milestone Plan",
          "Create milestone phases from the current scope."
        )
      );
    }

    if (hasGeneratedPlan) {
      recommended.push(
        action(
          "step2_review_generated_plan",
          "Review / Replace Generated Plan",
          "Open the regenerated milestone plan preview."
        )
      );
    }

    if (hasTotal && hasMilestones) {
      recommended.push(
        action(
          "step2_rebalance_pricing",
          "Rebalance Budget",
          "Redistribute the current project total across milestone phases."
        )
      );
    }

    if (hasTimelineSuggestion && hasMilestones) {
      recommended.push(
        action(
          "step2_apply_timeline",
          "Apply Suggested Timeline",
          "Apply the available milestone timeline suggestion."
        )
      );
    }

    const additional = [
      ...(hasMilestones
        ? [
            action(
              "step2_save_plan_template",
              "Save Plan as Template",
              "Create a reusable template from this milestone plan."
            ),
          ]
        : []),
    ];

    if (isTemplateBacked && canUpdateSource) {
      additional.push(
        action(
          "step2_update_source_template",
          "Update Source Template",
          "Update the source template with the improved milestone plan."
        )
      );
    }

    return {
      recommended,
      additional,
      info: pricingGuidance.available === false
        ? ["No pricing guidance available yet. Enter a project total manually, then rebalance milestones."]
        : [],
    };
  }

  if (summary.step === 3) {
    return {
      recommended: [
        action(
          "step3_apply_standard_warranty",
          "Apply Standard Warranty",
          "Save the default workmanship warranty to the agreement."
        ),
      ],
      additional: [],
    };
  }

  return {
    recommended: [
      action(
        "step4_preview_pdf",
        "Preview PDF",
        "Open the current agreement PDF preview."
      ),
    ],
    additional: [],
  };
}

export function matchProjectAssistantPromptToAction(prompt, context = {}) {
  const text = clean(prompt).toLowerCase();
  if (!text) return null;
  const actions = buildProjectAssistantActions(context);
  const all = [...actions.recommended, ...actions.additional];
  const find = (key) => all.find((item) => item.key === key) || null;
  const step = readWizardStep(context);

  if (/\b(next step|open next|continue|warranty)\b/.test(text)) {
    return {
      key: "open_wizard_step",
      actionKey: "open_wizard_step",
      label: step === 1 ? "Open Milestones Step" : step === 2 ? "Open Warranty Step" : "Open Finalize Step",
      targetStep: Math.min(step + 1, 4),
    };
  }

  if (step === 1) {
    if (/\b(classification|classify|type|subtype|title)\b/.test(text)) return find("step1_improve_classification");
    if (/\b(generate|draft|scope)\b/.test(text)) return find("step1_generate_scope_draft") || find("step1_improve_scope");
    return null;
  }

  if (step === 2) {
    if (/\b(milestone|milestones|phase|phases|split|description|descriptions|work plan|improve)\b/.test(text)) {
      if (/\breplace|review\b/.test(text)) return find("step2_review_generated_plan") || find("step2_regenerate_plan");
      if (/\bregenerate|new plan|redo\b/.test(text)) return find("step2_regenerate_plan");
      return find("step2_improve_descriptions") || find("step2_generate_milestone_plan");
    }
    if (/\b(rebalance|spread|allocate)\b/.test(text) && /\b(budget|price|pricing|cost|amount|total)\b/.test(text)) {
      return find("step2_rebalance_pricing") || find("step2_enter_project_total");
    }
    if (/\b(price|pricing|estimate|cost|amount|budget|total)\b/.test(text)) {
      return find("step2_rebalance_pricing") || find("step2_enter_project_total");
    }
    if (/\b(schedule|timeline|date|dates|duration|compress|extend)\b/.test(text)) {
      return find("step2_apply_timeline");
    }
  }

  if (step === 3 && /\b(warranty|standard)\b/.test(text)) return find("step3_apply_standard_warranty");
  if (step === 4 && /\b(pdf|preview|review)\b/.test(text)) return find("step4_preview_pdf");
  return null;
}
