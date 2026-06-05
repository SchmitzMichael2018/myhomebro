import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bot,
  Compass,
  Sparkles,
  ArrowRight,
  Wand2,
  Mic,
  LoaderCircle,
  PanelRightOpen,
} from "lucide-react";

import api from "../api.js";
import {
  getAssistantQuickActions,
  isTemplateCreationIntent,
  CONFIDENCE_THRESHOLD,
} from "../lib/startWithAiAssistant.js";
import {
  normalizeStructuredPlanShape,
  produceStructuredAssistantPlan,
} from "../lib/assistantReasoning.js";
import { buildUserFacingAiPanel } from "../lib/agreementWizardAiPanel.js";
import {
  buildProjectAssistantActions,
  buildProjectAssistantSummary,
  formatAssistantCurrency,
  matchProjectAssistantPromptToAction,
} from "../lib/projectAssistantActions.js";
import {
  canonicalizeTemplateMilestoneType,
  labelForTemplateMilestoneType,
} from "../lib/milestoneTypes.js";
import { useAssistantDock } from "./AssistantDock.jsx";

function getSpeechRecognitionCtor() {
  if (typeof window === "undefined") return null;
  return window.webkitSpeechRecognition || window.SpeechRecognition || null;
}

function voiceStatusLabel(status) {
  if (status === "listening") return "Listening...";
  if (status === "transcribing") return "Transcribing...";
  if (status === "unsupported") return "Voice input is not supported in this browser.";
  if (status === "failed") return "Voice capture failed. Try typing instead.";
  return "Voice input ready";
}

function ResultBlock({ title, children, testId = "" }) {
  return (
    <div
      className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
      data-testid={testId || undefined}
    >
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
        {title}
      </div>
      <div className="mt-2 text-sm text-slate-700">{children}</div>
    </div>
  );
}

function IntentPill({ label }) {
  return (
    <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
      {label}
    </span>
  );
}

function CompactBadge({ children }) {
  return (
    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
      {children}
    </span>
  );
}

function ProjectAssistantActionButton({ action, onSelect }) {
  return (
    <button
      type="button"
      data-testid={`project-assistant-action-${action.key}`}
      onClick={() => onSelect(action)}
      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-slate-900 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-900/20"
    >
      <div className="text-sm font-semibold text-slate-950">{action.label}</div>
      {action.description ? (
        <div className="mt-1 text-xs leading-5 text-slate-600">{action.description}</div>
      ) : null}
    </button>
  );
}

function ProjectAssistantPanel({ summary, actions, notice = "", onAction }) {
  const recommended = Array.isArray(actions?.recommended) ? actions.recommended : [];
  const additional = Array.isArray(actions?.additional) ? actions.additional : [];

  return (
    <div className="space-y-4" data-testid="project-assistant-panel">
      <div
        className="rounded-2xl border border-slate-200 bg-slate-950 px-4 py-4 text-white"
        data-testid="project-assistant-summary"
      >
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
          Current Project
        </div>
        <div className="mt-2 text-base font-semibold text-white">{summary.title}</div>
        {summary.projectType ? (
          <div className="mt-1 text-xs text-slate-300">{summary.projectType}</div>
        ) : null}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2">
            <div className="text-slate-300">Step</div>
            <div className="mt-1 font-semibold text-white">{summary.step} of 4</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2">
            <div className="text-slate-300">Milestones</div>
            <div className="mt-1 font-semibold text-white">{summary.milestoneCount}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2">
            <div className="text-slate-300">Total</div>
            <div className="mt-1 font-semibold text-white">{formatAssistantCurrency(summary.total)}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2">
            <div className="text-slate-300">Template</div>
            <div className="mt-1 truncate font-semibold text-white" title={summary.templateStatus}>
              {summary.templateStatus}
            </div>
          </div>
        </div>
      </div>

      {notice ? (
        <div
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          data-testid="project-assistant-notice"
        >
          {notice}
        </div>
      ) : null}

      {recommended.length ? (
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Recommended Actions
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2">
            {recommended.map((action) => (
              <ProjectAssistantActionButton
                key={action.key}
                action={action}
                onSelect={onAction}
              />
            ))}
          </div>
        </div>
      ) : null}

      {additional.length ? (
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Additional Actions
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2">
            {additional.map((action) => (
              <ProjectAssistantActionButton
                key={action.key}
                action={action}
                onSelect={onAction}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TemplateDraftPreview({ draft, questions = [], onAction = null, testId = "" }) {
  if (!draft) return null;
  const milestones = Array.isArray(draft.milestones) ? draft.milestones : [];
  const exclusions = Array.isArray(draft.exclusions) ? draft.exclusions : [];
  const assumptions = Array.isArray(draft.assumptions) ? draft.assumptions : [];
  const pricingGuidance = Array.isArray(draft.pricing_guidance) ? draft.pricing_guidance : [];
  const guidedQuestions = Array.isArray(questions) && questions.length
    ? questions
    : Array.isArray(draft.guided_questions)
    ? draft.guided_questions
    : [];
  const workflow = draft.workflow_structure || {};

  return (
    <ResultBlock title="Workflow Draft" testId={testId}>
      <div className="space-y-4">
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700">
            Template Name
          </div>
          <div className="text-base font-semibold text-indigo-950">
            {draft.template_name || "Reusable Workflow Template"}
          </div>
          <div className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700">
            Project Type / Project Subtype
          </div>
          <div className="mt-1 text-sm font-semibold text-indigo-950">
            {[draft.project_type, draft.project_subtype].filter(Boolean).join(" · ") || "Template workflow"}
          </div>
          <div className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700">
            Description / Scope
          </div>
          {draft.description ? (
            <p className="mt-1 text-sm leading-6 text-indigo-950/90">{draft.description}</p>
          ) : null}
        </div>

        {milestones.length ? (
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Suggested milestones
            </div>
            <div className="mt-2 space-y-2">
              {milestones.map((item, idx) => {
                const title = typeof item === "object" ? (item.title || "") : item;
                const desc = typeof item === "object" ? (item.description || "") : "";
                return (
                  <div
                    key={`${title}-${idx}`}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                  >
                    <div><span className="font-semibold text-slate-900">{idx + 1}.</span> {title}</div>
                    {desc ? <div className="mt-1 text-xs text-slate-500">{desc}</div> : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3">
          {exclusions.length ? (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Exclusions
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
                {exclusions.map((item, idx) => <li key={`exclusion-${idx}`}>{item}</li>)}
              </ul>
            </div>
          ) : null}

          {assumptions.length ? (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Assumptions
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
                {assumptions.map((item, idx) => <li key={`assumption-${idx}`}>{item}</li>)}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Workflow structure
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-slate-700">
            <div><span className="font-semibold text-slate-900">Assistance:</span> {workflow.assistance_format || "Milestone-based assistance"}</div>
            <div><span className="font-semibold text-slate-900">Scheduling:</span> {workflow.scheduling_mode || "Milestone-driven"}</div>
            <div><span className="font-semibold text-slate-900">Billing:</span> {workflow.billing_style || "Advisory milestone pricing"}</div>
          </div>
        </div>

        {pricingGuidance.length ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">
              Pricing guidance notes
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-amber-950">
              {pricingGuidance.map((item, idx) => <li key={`pricing-${idx}`}>{item}</li>)}
            </ul>
          </div>
        ) : null}

        {guidedQuestions.length ? (
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
              Questions to decide next
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-sky-950">
              {guidedQuestions.map((item, idx) => <li key={`question-${idx}`}>{item}</li>)}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid={testId ? `${testId}-use-draft` : "template-draft-use-button"}
            onClick={() => typeof onAction === "function" && onAction({ action_key: "use_template_draft", draft })}
            disabled={typeof onAction !== "function"}
            className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
              typeof onAction === "function"
                ? "border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700"
                : "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
            }`}
          >
            Use this draft
          </button>
        </div>
      </div>
    </ResultBlock>
  );
}

function coachingToneClasses(tone = "neutral") {
  if (tone === "positive") {
    return {
      wrapper: "border-emerald-200 bg-emerald-50",
      badge: "bg-emerald-100 text-emerald-800",
      title: "text-emerald-950",
      body: "text-emerald-900/90",
    };
  }
  if (tone === "attention") {
    return {
      wrapper: "border-amber-200 bg-amber-50",
      badge: "bg-amber-100 text-amber-800",
      title: "text-amber-950",
      body: "text-amber-900/90",
    };
  }
  return {
    wrapper: "border-sky-200 bg-sky-50",
    badge: "bg-sky-100 text-sky-800",
    title: "text-sky-950",
    body: "text-sky-900/90",
  };
}

function normalizePanelConfig(context = {}) {
  const config =
    context && typeof context === "object" && context.ai_panel && typeof context.ai_panel === "object"
      ? context.ai_panel
      : {};

  return {
    headline:
      typeof config.headline === "string" && config.headline.trim()
        ? config.headline.trim()
        : "Tell me what you want to do",
    helperText:
      typeof config.helperText === "string" && config.helperText.trim()
        ? config.helperText.trim()
        : "Use AI to guide the next step in your workflow.",
    promptPlaceholder:
      typeof config.promptPlaceholder === "string" && config.promptPlaceholder.trim()
        ? config.promptPlaceholder.trim()
        : 'Examples: "Start agreement for Casey Prospect kitchen remodel" or "Help me finish this agreement".',
    quickActions: Array.isArray(config.quickActions) ? config.quickActions : [],
    statusText:
      typeof config.statusText === "string" && config.statusText.trim()
        ? config.statusText.trim()
        : "",
    feedback:
      typeof config.feedback === "string" && config.feedback.trim() ? config.feedback.trim() : "",
    checklistItems: Array.isArray(config.checklistItems) ? config.checklistItems : [],
    templateRecommendation:
      config.templateRecommendation && typeof config.templateRecommendation === "object"
        ? config.templateRecommendation
        : null,
    nextActionText:
      typeof config.nextActionText === "string" && config.nextActionText.trim()
        ? config.nextActionText.trim()
        : "",
    nextGuidanceTitle:
      typeof config.nextGuidanceTitle === "string" && config.nextGuidanceTitle.trim()
        ? config.nextGuidanceTitle.trim()
        : "",
    nextGuidance:
      typeof config.nextGuidance === "string" && config.nextGuidance.trim()
        ? config.nextGuidance.trim()
        : "",
    submitButtonLabel:
      typeof config.submitButtonLabel === "string" && config.submitButtonLabel.trim()
        ? config.submitButtonLabel.trim()
        : "",
    submitActionKey:
      typeof config.submitActionKey === "string" && config.submitActionKey.trim()
        ? config.submitActionKey.trim()
        : "",
  };
}

function ChecklistTone({ tone = "success" }) {
  if (tone === "warning") {
    return <span className="text-sm font-semibold text-amber-700">!</span>;
  }
  return <span className="text-sm font-semibold text-emerald-700">OK</span>;
}

function isTemplateDescriptionMode(context = {}) {
  return (
    String(context?.page || "").trim().toLowerCase() === "templates" &&
    String(context?.field || "").trim().toLowerCase() === "description"
  );
}

function isTemplateMilestonesMode(context = {}) {
  return (
    String(context?.page || "").trim().toLowerCase() === "templates" &&
    String(context?.field || "").trim().toLowerCase() === "milestones"
  );
}

function isTemplateExclusionsMode(context = {}) {
  return (
    String(context?.page || "").trim().toLowerCase() === "templates" &&
    String(context?.field || "").trim().toLowerCase() === "exclusions"
  );
}

function collectTemplateScopeHints(promptText = "", context = {}) {
  const text = String(promptText || "").toLowerCase();
  const subtype = String(
    context?.project_subtype || context?.template_summary?.project_subtype || ""
  ).toLowerCase();
  const type = String(context?.project_type || context?.template_summary?.project_type || "").toLowerCase();
  const seed = `${subtype} ${type} ${text}`;

  if (seed.includes("shed")) {
    return {
      opening:
        "Work includes a reusable shed build scope covering site prep, layout, framing, roof assembly, exterior finishing, and closeout.",
      included:
        "Included work phases: site preparation, layout, foundation or pad preparation, framing, wall assembly, roof installation, trim, and final cleanup.",
    };
  }

  if (seed.includes("deck")) {
    return {
      opening:
        "Work includes a reusable deck build scope covering site prep, framing, decking, guardrail installation, finishing, and closeout.",
      included:
        "Included work phases: site preparation, layout, footing or support work, framing, decking installation, railing or stair installation, and cleanup.",
    };
  }

  if (seed.includes("bath")) {
    return {
      opening:
        "Work includes a reusable bathroom remodel scope covering demo, rough work, finish installation, final adjustments, and closeout.",
      included:
        "Included work phases: site protection, demolition, rough plumbing or electrical coordination, waterproofing, tile or finish installation, and walkthrough.",
    };
  }

  if (seed.includes("kitchen")) {
    return {
      opening:
        "Work includes a reusable kitchen remodel scope covering site prep, demo, rough coordination, finish installation, and closeout.",
      included:
        "Included work phases: site protection, demolition, rough-in coordination, cabinet installation, finish work, and final walkthrough.",
    };
  }

  return {
    opening:
      "Work includes a reusable project scope covering site prep, core installation, finish work, and closeout for similar jobs.",
    included:
      "Included work phases: site preparation, layout, installation, finish work, final adjustments, and cleanup.",
  };
}

function buildTemplateDescriptionDraft(context = {}, promptText = "") {
  const scopeHints = collectTemplateScopeHints(promptText, context);
  const lowerPrompt = String(promptText || "").toLowerCase();
  const optionalItems = lowerPrompt.includes("window")
    ? ["windows", "trim", "hardware"]
    : lowerPrompt.includes("door")
    ? ["doors", "hardware", "trim"]
    : ["doors", "windows", "trim", "shelving", "finishes"];

  const customerItems = ["material selections", "design approvals", "scope changes"];
  const contractorItems = ["measurements", "site conditions", "access"];
  const exclusionItems = [
    "Electrical",
    "Plumbing",
    "Landscaping",
    "Permits",
    "Custom upgrades",
  ];

  const description_scope = [
    "Scope of Work",
    scopeHints.opening,
    "",
    "Included Work Phases",
    `- ${scopeHints.included.replace(/^Included work phases:\s*/i, "")}`,
    "- Site preparation",
    "- Framing",
    "- Roofing",
    "- Exterior finishing",
    "- Final cleanup",
    "",
    "Optional Components",
    `- May include ${optionalItems.join(", ")} when specified.`,
  ]
    .map((line) => String(line).trimEnd())
    .join("\n");

  const assumptions = [
    "Customer Responsibilities",
    `- Customer will confirm ${customerItems.join(", ")} prior to work.`,
    "",
    "Contractor Responsibilities",
    `- Contractor will verify ${contractorItems.join(", ")} before starting work.`,
  ]
    .map((line) => String(line).trimEnd())
    .join("\n");

  const exclusions = [
    "Exclusions",
    "- The following are not included unless explicitly added:",
    ...exclusionItems.map((item) => `- ${item}`),
  ]
    .map((line) => String(line).trimEnd())
    .join("\n");

  return { description_scope, assumptions, exclusions };
}

function formatTemplateDescriptionDraft(draft = {}) {
  return [draft.description_scope, draft.assumptions, draft.exclusions].filter(Boolean).join("\n\n");
}

function buildTemplateMilestoneDrafts(context = {}) {
  const projectType = String(
    context?.project_type || context?.template_summary?.project_type || ""
  ).trim();
  const projectSubtype = String(
    context?.project_subtype || context?.template_summary?.project_subtype || ""
  ).trim();
  const scope = String(
    context?.description ||
      context?.default_scope ||
      context?.template_summary?.description ||
      context?.template_summary?.default_scope ||
      ""
  ).trim();

  const subtype = projectSubtype.toLowerCase();
  const type = projectType.toLowerCase();

  if (subtype.includes("kitchen")) {
    return [
      {
        title: "Planning & site protection",
        description:
          "Confirm the reusable kitchen scope, protect adjacent areas, stage materials, and align the crew on the sequence before physical work begins.",
        normalized_milestone_type: "planning",
      },
      {
        title: "Demolition & rough prep",
        description:
          "Remove existing finishes and prep the space for the next phase while keeping disposal, protection, and access needs generic for similar remodels.",
        normalized_milestone_type: "demolition",
      },
      {
        title: "Electrical, plumbing & layout readiness",
        description:
          "Complete the typical rough-in coordination, backing, and layout checks needed before cabinets, fixtures, and finish work move forward.",
        normalized_milestone_type: "rough_in",
      },
      {
        title: "Cabinets, trim & built-ins",
        description:
          "Install and align the core built-in components, including the standard fitting, fastening, and adjustment work expected in this type of kitchen project.",
        normalized_milestone_type: "installation",
      },
      {
        title: "Countertops, fixtures & appliances",
        description:
          "Handle the normal countertop placement, fixture setting, reconnect work, and coordination steps that turn the cabinet package into a usable kitchen.",
        normalized_milestone_type: "fixtures",
      },
      {
        title: "Finishes, punch list & final walkthrough",
        description:
          "Wrap up finish details, complete quality checks, and prepare the project for customer review with a reusable closeout phase.",
        normalized_milestone_type: "closeout",
      },
    ];
  }

  if (subtype.includes("bathroom")) {
    return [
      {
        title: "Planning & protection",
        description:
          "Confirm the bathroom scope, protect adjacent finishes, and stage the job so repeatable remodel work starts with a clean plan and protected site.",
        normalized_milestone_type: "planning",
      },
      {
        title: "Demolition & substrate prep",
        description:
          "Remove existing materials and prep underlying surfaces for the waterproofing and finish phases that typically follow in bathroom projects.",
        normalized_milestone_type: "demolition",
      },
      {
        title: "Plumbing, electrical & framing updates",
        description:
          "Complete the common in-wall adjustments, backing, and rough positioning needed before wet-area finishes and fixture installation.",
        normalized_milestone_type: "rough_in",
      },
      {
        title: "Waterproofing & tile work",
        description:
          "Handle the usual prep, waterproofing, tile setting, and curing steps that define the main finish phase of a bathroom remodel.",
        normalized_milestone_type: "tile",
      },
      {
        title: "Fixtures, trim & accessories",
        description:
          "Install standard bathroom fixtures, trim pieces, and accessories while keeping the scope reusable across similar projects.",
        normalized_milestone_type: "fixtures",
      },
      {
        title: "Punch list & final walkthrough",
        description:
          "Close out the work with final touchups, quality review, and customer-facing completion steps.",
        normalized_milestone_type: "closeout",
      },
    ];
  }

  if (subtype.includes("deck")) {
    return [
      {
        title: "Layout, permits & material staging",
        description:
          "Review layout assumptions, coordinate approvals as needed, and stage the materials and site access required for a repeatable deck build.",
        normalized_milestone_type: "planning",
      },
      {
        title: "Demo & site prep",
        description:
          "Clear the work area, remove any affected existing elements, and prepare the site for the structural build phase.",
        normalized_milestone_type: "demolition",
      },
      {
        title: "Footings, framing & structural build",
        description:
          "Complete the standard structural work, including the support, framing, and alignment tasks needed to establish the main deck platform.",
        normalized_milestone_type: "framing",
      },
      {
        title: "Decking, rails & stairs",
        description:
          "Install the walking surface and the common access and guard components that make the deck usable and code-ready.",
        normalized_milestone_type: "installation",
      },
      {
        title: "Finish details & cleanup",
        description:
          "Handle finishing details, hardware adjustments, cleanup, and handoff preparation as a reusable closeout phase.",
        normalized_milestone_type: "closeout",
      },
    ];
  }

  if (subtype.includes("cabinet")) {
    return [
      {
        title: "Field measure & layout confirmation",
        description:
          "Verify field conditions, confirm layout assumptions, and prepare the job for a clean installation sequence across similar cabinet projects.",
        normalized_milestone_type: "planning",
      },
      {
        title: "Delivery review & site prep",
        description:
          "Check delivered materials, stage components, and prep the work area for efficient installation without overfitting to a single room layout.",
        normalized_milestone_type: "staging",
      },
      {
        title: "Cabinet install & alignment",
        description:
          "Install, level, secure, and align the cabinet package with the common fitting and fastening steps expected in this type of work.",
        normalized_milestone_type: "installation",
      },
      {
        title: "Trim, hardware & adjustments",
        description:
          "Complete trim pieces, hardware, reveals, and standard adjustments that refine the finished cabinet install.",
        normalized_milestone_type: "finish",
      },
      {
        title: "Punch list & final walkthrough",
        description:
          "Review the completed installation, address touchups, and close out the project with a reusable final handoff phase.",
        normalized_milestone_type: "closeout",
      },
    ];
  }

  if (type.includes("remodel") || scope.toLowerCase().includes("remodel")) {
    return [
      {
        title: "Planning & site protection",
        description:
          "Confirm the reusable scope, protect the site, and align scheduling, staging, and handoff expectations before physical work starts.",
        normalized_milestone_type: "planning",
      },
      {
        title: "Demolition & prep",
        description:
          "Remove affected materials and prepare the space for the core build phases that follow in a typical remodel.",
        normalized_milestone_type: "demolition",
      },
      {
        title: "Core rough-in work",
        description:
          "Complete the common behind-the-wall, layout, and coordination tasks needed before finish installations can proceed.",
        normalized_milestone_type: "rough_in",
      },
      {
        title: "Install major finishes",
        description:
          "Install the main finished components that define the visible transformation of the project while keeping the scope broadly reusable.",
        normalized_milestone_type: "installation",
      },
      {
        title: "Fixtures, trim & final adjustments",
        description:
          "Set standard fixtures, complete trim work, and make the adjustments typically required to bring the project to completion.",
        normalized_milestone_type: "finish",
      },
      {
        title: "Punch list & walkthrough",
        description:
          "Wrap up remaining details, verify quality, and prepare the project for customer review and closeout.",
        normalized_milestone_type: "closeout",
      },
    ];
  }

  return [
    {
      title: "Planning & site prep",
      description:
        "Confirm the reusable scope, prepare the site, and stage materials and access needs before the work begins.",
      normalized_milestone_type: "planning",
    },
    {
      title: "Core work phase one",
      description:
        "Complete the first major block of work in a way that remains generic enough for repeatable use across similar projects.",
      normalized_milestone_type: "phase_1",
    },
    {
      title: "Core work phase two",
      description:
        "Handle the follow-on build or installation steps needed to move the project from preparation into completion.",
      normalized_milestone_type: "phase_2",
    },
    {
      title: "Finish work & quality check",
      description:
        "Complete finish details, adjustments, and the quality review tasks that typically happen near the end of the job.",
      normalized_milestone_type: "finish",
    },
    {
      title: "Closeout & walkthrough",
      description:
        "Finalize the project with cleanup, handoff preparation, and customer-facing completion steps.",
      normalized_milestone_type: "closeout",
    },
  ];
}

function buildTemplateExclusionsDraft(context = {}) {
  const projectType = String(
    context?.project_type || context?.template_summary?.project_type || ""
  ).trim();
  const projectSubtype = String(
    context?.project_subtype || context?.template_summary?.project_subtype || ""
  ).trim();
  const scope = String(
    context?.description ||
      context?.default_scope ||
      context?.template_summary?.description ||
      context?.template_summary?.default_scope ||
      ""
  ).trim();

  const subtype = projectSubtype.toLowerCase();
  const type = projectType.toLowerCase();

  if (subtype.includes("kitchen")) {
    return {
      exclusions: [
        "Owner selections, change orders, and scope upgrades beyond the standard kitchen template are excluded unless added in writing.",
        "Structural redesign, major layout relocation, or hidden-condition repair is excluded from the baseline scope unless specifically priced.",
        "Permit fees, specialty inspections, and utility-company charges are excluded unless the final agreement states otherwise.",
      ],
      assumptions: [
        "The existing kitchen is accessible during normal working hours with utilities available for standard installation and testing.",
        "Template pricing assumes standard cabinet, countertop, fixture, and appliance coordination without custom fabrication beyond the selected scope.",
      ],
    };
  }

  if (subtype.includes("bathroom")) {
    return {
      exclusions: [
        "Hidden water damage, mold remediation, structural repair, or code-driven redesign is excluded unless identified and approved separately.",
        "Owner-supplied specialty fixtures, custom glass, and premium finish upgrades are excluded from the baseline template unless listed in scope.",
        "Permit fees, engineering, and jurisdiction-required specialty inspections are excluded unless specifically included in the final agreement.",
      ],
      assumptions: [
        "The work area can be isolated with normal access to water, power, and standard demolition/disposal pathways.",
        "Template scope assumes standard waterproofing, tile, and fixture installation conditions without major substrate reconstruction.",
      ],
    };
  }

  if (subtype.includes("deck")) {
    return {
      exclusions: [
        "Surveying, engineering, soil correction, and unforeseen footing redesign are excluded unless added to the project scope.",
        "Landscape restoration, irrigation repair, or utility relocation outside the immediate deck area is excluded unless specifically included.",
        "Permit fees, HOA approvals, and jurisdictional review costs are excluded unless identified in writing.",
      ],
      assumptions: [
        "The site has standard access for materials, staging, and crew movement during normal working hours.",
        "Template scope assumes typical framing, decking, and guardrail conditions without major hidden structural correction.",
      ],
    };
  }

  if (subtype.includes("cabinet")) {
    return {
      exclusions: [
        "Wall repair, repainting, countertop fabrication, and major utility relocation are excluded unless specifically included with the cabinet scope.",
        "Owner-supplied specialty hardware, organizational accessories, or custom finish modifications are excluded unless listed in the agreement.",
        "Permit fees, engineering, and unrelated trade work outside normal cabinet installation are excluded from the baseline template.",
      ],
      assumptions: [
        "Existing field dimensions, surfaces, and access conditions support a standard cabinet install without major substrate correction.",
        "Template scope assumes materials, approvals, and selections are ready in time for a normal installation sequence.",
      ],
    };
  }

  if (type.includes("remodel") || scope.toLowerCase().includes("remodel")) {
    return {
      exclusions: [
        "Hidden conditions, code-driven redesign, and scope changes discovered after demolition are excluded unless approved through change order.",
        "Permit fees, specialty engineering, and third-party inspection costs are excluded unless the final agreement includes them.",
        "Owner upgrades, specialty materials, and work outside the defined remodel area are excluded from the baseline template scope.",
      ],
      assumptions: [
        "The project area is reasonably accessible with normal utilities, staging space, and standard working-hour access.",
        "Selections, approvals, and customer decisions will be provided in time to support a normal project sequence.",
      ],
    };
  }

  return {
    exclusions: [
      "Hidden conditions, unforeseen code requirements, and scope changes outside the written template are excluded unless approved separately.",
      "Permit fees, specialty inspections, and third-party costs are excluded unless specifically included in the agreement.",
      "Owner-requested upgrades, premium finishes, and work outside the defined scope are excluded from the standard template baseline.",
    ],
    assumptions: [
      "The site is accessible during normal working hours with standard utility access and staging conditions.",
      "Selections, approvals, and customer decisions will be available in time to support the planned work sequence.",
    ],
  };
}

function normalizeTemplateMilestoneDrafts(items = []) {
  return items.map((item, idx) => {
    const title = String(item?.title || "").trim();
    const description = String(item?.description || "").trim();
    const normalized_milestone_type = canonicalizeTemplateMilestoneType(
      item?.normalized_milestone_type,
      `${title} ${description}`
    );

    return {
      title,
      description,
      normalized_milestone_type,
      sort_order: idx + 1,
    };
  });
}

export function StartWithAIEntry({
  title = "Project Assistant",
  description = "Get contextual help for the workflow you are already in.",
  context = {},
  onAction,
  onOpenChange = null,
  defaultOpen = false,
  open: controlledOpen = undefined,
  className = "",
  testId = "start-with-ai-entry",
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { openAssistant } = useAssistantDock();
  const entryContext = useMemo(() => ({ ...(context || {}) }), [context]);
  const isControlled = typeof controlledOpen === "boolean";
  const resolvedOpen = isControlled ? controlledOpen : open;

  useEffect(() => {
    if (isControlled) {
      setOpen(controlledOpen);
    }
  }, [controlledOpen, isControlled]);

  return (
    <div className={className} data-testid={testId}>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Project Assistant
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{title}</div>
            <div className="mt-1 text-sm text-slate-600">{description}</div>
          </div>
          <button
            type="button"
            data-testid={`${testId}-toggle`}
            onClick={() =>
              setOpen((value) => {
                const current = isControlled ? resolvedOpen : value;
                const next = !current;
                onOpenChange?.(next);
                return next;
              })
            }
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <Wand2 className="h-4 w-4" />
            {resolvedOpen ? "Hide Assistant" : "Open Assistant"}
          </button>
          <button
            type="button"
            data-testid={`${testId}-dock`}
            onClick={() => {
              onOpenChange?.(true);
              openAssistant({ context: entryContext });
            }}
            className="hidden items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 xl:inline-flex"
          >
            <PanelRightOpen className="h-4 w-4" />
            Open Assistant
          </button>
        </div>
      </div>

      {resolvedOpen ? (
        <div className="mt-4">
          <StartWithAIAssistant
            mode="panel"
            context={context}
            onAction={onAction}
            onClose={() => setOpen(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

export function buildAssistantNavigationState(plan, normalizedContext) {
  return {
    assistantPrefill: plan.prefill_fields || {},
    assistantDraftPayload: plan.draft_payload || {},
    assistantWizardStepTarget: plan.wizard_step_target || null,
    assistantSuggestedMilestones: plan.suggested_milestones || [],
    assistantClarificationQuestions: plan.clarification_questions || [],
    assistantEstimatePreview:
      plan.applyable_preview?.estimate_preview || plan.preview_payload?.estimate_preview || {},
    assistantTemplateRecommendations:
      plan.applyable_preview?.template_recommendations || plan.preview_payload?.templates || [],
    assistantTopTemplatePreview:
      plan.applyable_preview?.top_template_preview || plan.preview_payload?.top_template_preview || {},
    assistantProactiveRecommendations: plan.proactive_recommendations || [],
    assistantPredictiveInsights: plan.predictive_insights || [],
    assistantProposedActions: plan.proposed_actions || [],
    assistantConfirmationRequiredActions: plan.confirmation_required_actions || [],
    assistantGuidedFlow: plan.automation_plan?.guided_flow || plan.guided_flow || {},
    assistantAutomationPlan: plan.automation_plan || {},
    assistantOnboarding: plan.preview_payload?.onboarding || {},
    assistantIntent: plan.intent || "",
    assistantContext: normalizedContext,
  };
}

export default function StartWithAIAssistant({
  mode = "page",
  context = null,
  onAction = null,
  onClose = null,
  hideContextHeader = false,
}) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const testId = (base) => (mode === "dock" ? `${base}-dock` : base);
  const contextSignature = useMemo(() => JSON.stringify(context || {}), [context]);
  const normalizedContext = useMemo(() => context || {}, [contextSignature, context]);
  const workspaceMode = String(
    normalizedContext?.workspace_mode || normalizedContext?.page || "general"
  )
    .trim()
    .toLowerCase();
  const workspaceRouteSignature = `${workspaceMode}:${normalizedContext?.current_route || ""}`;
  const isContextualMode = mode === "dock" || mode === "panel";
  const isFieldAwareDescriptionMode = useMemo(
    () => isTemplateDescriptionMode(normalizedContext),
    [normalizedContext]
  );
  const isFieldAwareMilestonesMode = useMemo(
    () => isTemplateMilestonesMode(normalizedContext),
    [normalizedContext]
  );
  const isFieldAwareExclusionsMode = useMemo(
    () => isTemplateExclusionsMode(normalizedContext),
    [normalizedContext]
  );
  const isFieldAwareMode =
    isFieldAwareDescriptionMode || isFieldAwareMilestonesMode || isFieldAwareExclusionsMode;
  const isTemplatesPage = workspaceMode === "templates";
  const isAgreementWizardAssistant = workspaceMode === "agreement_wizard" && !isFieldAwareMode;
  const isTemplatesContextualMode =
    isTemplatesPage && isContextualMode && !isFieldAwareMode;
  const panelConfig = useMemo(
    () => normalizePanelConfig(normalizedContext),
    [normalizedContext]
  );
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState([]);
  const [showStructuredPayload, setShowStructuredPayload] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [isPlanning, setIsPlanning] = useState(false);
  const [fieldDraft, setFieldDraft] = useState("");
  const [milestoneDrafts, setMilestoneDrafts] = useState([]);
  const [exclusionsDraft, setExclusionsDraft] = useState({ exclusions: [], assumptions: [] });
  const [projectAssistantNotice, setProjectAssistantNotice] = useState("");
  const [plan, setPlan] = useState(() =>
    produceStructuredAssistantPlan({
      preferredIntent: "navigate_app",
      input: "",
      context: normalizedContext,
    })
  );

  useEffect(() => {
    setPlan(
      produceStructuredAssistantPlan({
        preferredIntent: "navigate_app",
        input: "",
        context: normalizedContext,
      })
    );
  }, [contextSignature, normalizedContext]);

  useEffect(() => {
    setPrompt("");
    setHistory([]);
    setShowStructuredPayload(false);
    setVoiceStatus("idle");
    setFieldDraft("");
    setMilestoneDrafts([]);
    setExclusionsDraft({ exclusions: [], assumptions: [] });
    setProjectAssistantNotice("");
  }, [workspaceRouteSignature]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [mode, contextSignature]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop?.();
      } catch {}
    };
  }, []);

  const quickActions = useMemo(() => {
    const sourceActions = panelConfig.quickActions.length
      ? panelConfig.quickActions
      : getAssistantQuickActions();
    if (!panelConfig.submitActionKey) {
      return sourceActions;
    }
    return sourceActions.filter((action) => {
      const actionKey = safeActionKey(action?.actionKey || action?.action_key);
      const actionLabel = String(action?.label || "").trim();
      const submitLabel = String(panelConfig.submitButtonLabel || "").trim();
      const duplicatesSubmitAction =
        actionKey && actionKey === panelConfig.submitActionKey;
      const duplicatesSubmitLabel =
        submitLabel && actionLabel && actionLabel === submitLabel;
      return !duplicatesSubmitAction && !duplicatesSubmitLabel;
    });
  }, [panelConfig.quickActions, panelConfig.submitActionKey, panelConfig.submitButtonLabel]);
  const userFacingPanel = useMemo(
    () =>
      buildUserFacingAiPanel({
        context: normalizedContext,
        panelConfig: { ...panelConfig, quickActions },
        plan,
        isPlanning,
        history,
      }),
    [history, isPlanning, normalizedContext, panelConfig, plan, quickActions]
  );
  const projectAssistantSummary = useMemo(
    () => buildProjectAssistantSummary(normalizedContext),
    [normalizedContext]
  );
  const projectAssistantActions = useMemo(
    () => buildProjectAssistantActions(normalizedContext),
    [normalizedContext]
  );
  const showDiagnostics =
    import.meta.env.DEV ||
    (typeof window !== "undefined" && window.MYHOMEBRO_DEBUG_ASSISTANT === true);
  const visibleQuickActions = isContextualMode ? [] : userFacingPanel.quickActions;
  const sectionEyebrow = isAgreementWizardAssistant
    ? "Project Assistant"
    : isFieldAwareMode
    ? "Project Assistant"
    : isContextualMode
    ? "Project Assistant"
    : "AI Workspace";
  const inputHelperText = isFieldAwareDescriptionMode
    ? "Generate a contractor-grade Scope of Work with sections, responsibilities, and exclusions."
    : isFieldAwareMilestonesMode
    ? "Generate reusable milestone titles for this template."
    : isFieldAwareExclusionsMode
    ? "Generate reusable exclusions and assumptions for this template."
    : isTemplatesContextualMode
    ? "Ask for reusable workflow structure, milestones, exclusions, assumptions, or advisory pricing guidance."
    : isAgreementWizardAssistant
    ? "Optional chat is secondary. Workflow buttons above are the primary actions."
    : isContextualMode
    ? "Get contextual help for the step you're on right now."
    : "Describe the work you want to start, plan, or organize.";
  const headline = isFieldAwareDescriptionMode
    ? "Generate description text for this template"
    : isFieldAwareMilestonesMode
    ? "Generate milestone sequence for this template"
    : isFieldAwareExclusionsMode
    ? "Generate exclusions and assumptions for this template"
    : isAgreementWizardAssistant
    ? "Project Assistant"
    : userFacingPanel.headline;
  const helperText = isFieldAwareDescriptionMode
    ? "Use the current template name, type, and subtype to draft a reusable Scope of Work with the exact section structure."
    : isFieldAwareMilestonesMode
    ? "Use the current template scope, type, and subtype to draft a reusable milestone sequence for this template."
    : isFieldAwareExclusionsMode
    ? "Use the current template scope, type, and subtype to draft reusable exclusions and assumptions that define clear project boundaries."
    : isAgreementWizardAssistant
    ? "Use project-aware actions that call the same workflows available in this wizard step."
    : userFacingPanel.helperText;
  const promptPlaceholder = isFieldAwareDescriptionMode
    ? 'Optional: add scope guidance like "include site prep, framing, roofing, finishing, and cleanup."'
    : isFieldAwareMilestonesMode
    ? 'Optional: add sequencing guidance like "include permit review and punch list."'
    : isFieldAwareExclusionsMode
    ? 'Optional: add boundary guidance like "exclude owner-supplied fixtures and permit fees."'
    : isAgreementWizardAssistant
    ? "Optional: ask for one of the available actions, such as improving milestones or opening the next step."
    : userFacingPanel.promptPlaceholder;
  const submitLabel = isFieldAwareDescriptionMode
    ? "Generate Description"
    : isFieldAwareMilestonesMode
    ? "Generate Milestones"
    : isFieldAwareExclusionsMode
    ? "Generate Exclusions"
    : panelConfig.submitButtonLabel || (isAgreementWizardAssistant ? "Ask Project Assistant" : isContextualMode ? "Ask Assistant" : "Start with AI");

  useEffect(() => {
    setFieldDraft("");
    setMilestoneDrafts([]);
    setExclusionsDraft({ exclusions: [], assumptions: [] });
  }, [contextSignature, isFieldAwareMode]);

  function applyPlan(nextPlan, submittedPrompt = "", options = {}) {
    setPlan(nextPlan);
    if (submittedPrompt) {
      setHistory((prev) => [...prev, { prompt: submittedPrompt, plan: nextPlan }]);
    }
    setPrompt(options.keepPrompt ? submittedPrompt : "");
  }

  function runPlanner(promptText, overrides = {}) {
    return produceStructuredAssistantPlan({
      input: promptText,
      previousPlan: plan,
      context: normalizedContext,
      ...overrides,
    });
  }

  async function requestOrchestratedPlan(promptText, overrides = {}) {
    const requestPayload = {
      input: promptText,
      previousPlan: plan,
      context: normalizedContext,
      ...overrides,
    };
    const fallbackPlan = runPlanner(promptText, overrides);
    if (isTemplatesContextualMode || (isTemplatesPage && isTemplateCreationIntent(promptText))) {
      return fallbackPlan;
    }
    try {
      setIsPlanning(true);
      const { data } = await api.post("/projects/assistant/orchestrate/", requestPayload);
      if (!data || data.fallback_to_planner) {
        return fallbackPlan;
      }
      return normalizeStructuredPlanShape(data, fallbackPlan);
    } catch {
      return fallbackPlan;
    } finally {
      setIsPlanning(false);
    }
  }

  async function submitPrompt(event) {
    event?.preventDefault();
    const cleanPrompt = String(prompt || "").trim();
    if (isFieldAwareDescriptionMode) {
      const baseDraft = buildTemplateDescriptionDraft(normalizedContext, cleanPrompt);
      const finalDraft = formatTemplateDescriptionDraft(baseDraft);
      setFieldDraft(finalDraft);
      setHistory((prev) => [
        ...prev,
        { prompt: cleanPrompt || "Generate description", plan: { intent_label: "Template Description" } },
      ]);
      return;
    }
    if (isFieldAwareMilestonesMode) {
      const baseDrafts = buildTemplateMilestoneDrafts(normalizedContext).slice(0, 7);
      const finalDrafts = cleanPrompt
        ? baseDrafts.map((item, idx) =>
            idx === baseDrafts.length - 1
              ? {
                  ...item,
                  description: `${item.description} ${cleanPrompt}`.trim(),
                }
              : item
          )
        : baseDrafts;
      setMilestoneDrafts(normalizeTemplateMilestoneDrafts(finalDrafts));
      setHistory((prev) => [
        ...prev,
        { prompt: cleanPrompt || "Generate milestones", plan: { intent_label: "Template Milestones" } },
      ]);
      return;
    }
    if (isFieldAwareExclusionsMode) {
      const baseDraft = buildTemplateExclusionsDraft(normalizedContext);
      const cleanNote = String(cleanPrompt || "").trim();
      const nextDraft = cleanNote
        ? {
            exclusions: [...baseDraft.exclusions, cleanNote],
            assumptions: baseDraft.assumptions,
          }
        : baseDraft;
      setExclusionsDraft(nextDraft);
      setHistory((prev) => [
        ...prev,
        { prompt: cleanPrompt || "Generate exclusions", plan: { intent_label: "Template Exclusions" } },
      ]);
      return;
    }
    if (!cleanPrompt) return;
    if (isAgreementWizardAssistant) {
      const matchedAction = matchProjectAssistantPromptToAction(cleanPrompt, normalizedContext);
      if (matchedAction && typeof onAction === "function") {
        const handled = await onAction({
          assistant_action_key: matchedAction.actionKey || matchedAction.key,
          action_key: matchedAction.actionKey || matchedAction.key,
          wizard_step_target: matchedAction.targetStep,
          prompt: cleanPrompt,
          source: "project_assistant_chat",
        });
        if (handled === true) {
          setProjectAssistantNotice("");
          setHistory((prev) => [
            ...prev,
            { prompt: cleanPrompt, plan: { intent_label: matchedAction.label || "Project Assistant Action" } },
          ]);
          setPrompt("");
          return;
        }
      }
      setProjectAssistantNotice("Use one of the available workflow actions for this step. Each visible action is wired to a real wizard workflow.");
      setHistory((prev) => [
        ...prev,
        { prompt: cleanPrompt, plan: { intent_label: "Project Assistant" } },
      ]);
      setPrompt("");
      return;
    }
    if (panelConfig.submitActionKey && typeof onAction === "function") {
      const handled = await onAction({
        assistant_action_key: panelConfig.submitActionKey,
        action_key: panelConfig.submitActionKey,
        prompt: cleanPrompt,
        source: "prompt_submit",
      });
      if (handled === true) {
        setHistory((prev) => [...prev, { prompt: cleanPrompt, plan }]);
        setPrompt("");
        return;
      }
    }
    const nextPlan = await requestOrchestratedPlan(cleanPrompt);
    applyPlan(nextPlan, cleanPrompt);
  }

  async function useQuickAction(action) {
    const actionKey = safeActionKey(action?.actionKey || action?.action_key);
    if (actionKey && typeof onAction === "function") {
      const handled = await onAction({
        assistant_action_key: actionKey,
        action_key: actionKey,
        source: "quick_action",
      });
      if (handled === true) return;
    }

    if (action?.prompt) {
      const quickPrompt = String(action.prompt || "").trim();
      if (!quickPrompt) return;
      setPrompt(quickPrompt);
      const nextPlan = await requestOrchestratedPlan(quickPrompt, { previousPlan: null });
      applyPlan(nextPlan, quickPrompt, { keepPrompt: true });
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }

    const intent = typeof action === "string" ? action : action?.intent;
    if (!intent) return;
    const nextPlan = await requestOrchestratedPlan("", {
      preferredIntent: intent,
      previousPlan: null,
    });
    setPlan(nextPlan);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function useProjectAssistantAction(action) {
    const actionKey = safeActionKey(action?.actionKey || action?.action_key || action?.key);
    if (!actionKey || typeof onAction !== "function") return;
    const handled = await onAction({
      assistant_action_key: actionKey,
      action_key: actionKey,
      prompt: action?.prompt || action?.label || "",
      source: "project_assistant_action",
    });
    if (handled === true) {
      setProjectAssistantNotice("");
      return;
    }
    setProjectAssistantNotice("That action is not available for the current wizard state.");
  }

  function safeActionKey(value) {
    return value == null ? "" : String(value).trim();
  }

  function handleChecklistAction(item) {
    if (item?.targetStep == null) return;
    if (typeof onAction === "function") {
      onAction({ wizard_step_target: item.targetStep });
    }
  }

  function handleVoiceInput() {
    const SpeechRecognitionCtor = getSpeechRecognitionCtor();
    if (!SpeechRecognitionCtor) {
      setVoiceStatus("unsupported");
      return;
    }

    if (voiceStatus === "listening") {
      try {
        recognitionRef.current?.stop?.();
      } catch {}
      setVoiceStatus("transcribing");
      return;
    }

    try {
      const recognition = new SpeechRecognitionCtor();
      recognitionRef.current = recognition;
      recognition.lang = "en-US";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => setVoiceStatus("listening");
      recognition.onerror = () => setVoiceStatus("failed");
      recognition.onresult = async (event) => {
        const transcript = String(
          event?.results?.[0]?.[0]?.transcript || ""
        ).trim();
        if (!transcript) {
          setVoiceStatus("failed");
          return;
        }
        setVoiceStatus("transcribing");
        setPrompt(transcript);
        const nextPlan = await requestOrchestratedPlan(transcript);
        applyPlan(nextPlan, transcript, { keepPrompt: true });
      };
      recognition.onend = () => {
        setVoiceStatus((current) =>
          current === "listening" || current === "transcribing" ? "idle" : current
        );
      };
      recognition.start();
    } catch {
      setVoiceStatus("failed");
    }
  }

  const isInClarifyingMode =
    !isAgreementWizardAssistant &&
    history.length > 0 &&
    (plan.is_fallback === true ||
      (typeof plan.confidence_score === "number" && plan.confidence_score < CONFIDENCE_THRESHOLD));

  function handlePrimaryAction() {
    if (typeof onAction === "function") {
      const handled = onAction(plan);
      if (handled === true) return;
    }
    if (!plan?.navigation_target) return;
    navigate(plan.navigation_target, {
      state: buildAssistantNavigationState(plan, normalizedContext),
    });
  }

  async function navigateWithCandidateIntent(candidate) {
    const target = candidate.destination || plan.navigation_target;
    if (!target) return;
    const candidatePlan = {
      ...plan,
      intent: candidate.intent,
      navigation_target: target,
    };
    if (typeof onAction === "function") {
      const handled = await onAction(candidatePlan);
      if (handled === true) return;
    }
    navigate(target, {
      state: buildAssistantNavigationState(candidatePlan, normalizedContext),
    });
  }

  function handleSomethingElse() {
    setPrompt("");
    setHistory([]);
    setPlan(
      produceStructuredAssistantPlan({
        preferredIntent: "navigate_app",
        input: "",
        context: normalizedContext,
      })
    );
  }

  async function handleApplyFieldDraft() {
    if (!fieldDraft || typeof onAction !== "function") return;
    const handled = await onAction({
      assistant_action_key: "apply_template_description",
      action_key: "apply_template_description",
      source: "field_generation",
      field: "description",
      value: fieldDraft,
    });
    if (handled === true) {
      setPrompt("");
    }
  }

  async function handleApplyMilestoneDrafts() {
    if (!milestoneDrafts.length || typeof onAction !== "function") return;
    const handled = await onAction({
      assistant_action_key: "apply_template_milestones",
      action_key: "apply_template_milestones",
      source: "field_generation",
      field: "milestones",
      value: milestoneDrafts,
    });
    if (handled === true) {
      setPrompt("");
    }
  }

  async function handleApplyExclusionsDraft() {
    if (
      (!Array.isArray(exclusionsDraft?.exclusions) || !exclusionsDraft.exclusions.length) &&
      (!Array.isArray(exclusionsDraft?.assumptions) || !exclusionsDraft.assumptions.length)
    ) {
      return;
    }
    if (typeof onAction !== "function") return;
    const handled = await onAction({
      assistant_action_key: "apply_template_exclusions",
      action_key: "apply_template_exclusions",
      source: "field_generation",
      field: "exclusions",
      exclusions: Array.isArray(exclusionsDraft.exclusions) ? exclusionsDraft.exclusions : [],
      assumptions: Array.isArray(exclusionsDraft.assumptions) ? exclusionsDraft.assumptions : [],
    });
    if (handled === true) {
      setPrompt("");
    }
  }

  async function handleTemplateRecommendationAction() {
    const actionKey = safeActionKey(
      userFacingPanel?.templateRecommendation?.actionKey || "save_as_template"
    );
    if (typeof onAction === "function") {
      const handled = await onAction({
        assistant_action_key: actionKey,
        action_key: actionKey,
        source: "template_recommendation",
      });
      if (handled === true) return;
    }
  }

  const containerClass =
    mode === "dock"
      ? "h-full rounded-[28px] border border-slate-200 bg-white shadow-none"
      : mode === "panel"
      ? "rounded-[28px] border border-slate-200 bg-white shadow-xl"
      : "rounded-[28px] border border-slate-200 bg-white shadow-sm";

  return (
    <section className={containerClass} data-testid={testId("start-with-ai-assistant")}>
      {!hideContextHeader ? (
        <div className="border-b border-slate-200 px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {sectionEyebrow}
                </div>
                <h2
                  data-testid={testId("start-with-ai-title")}
                  className="mt-1 text-2xl font-bold tracking-tight text-slate-900"
                >
                  {headline}
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-slate-600">
                  {helperText}
                </p>
              </div>
            </div>
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="space-y-4 px-5 py-5">
        {isAgreementWizardAssistant ? (
          <ProjectAssistantPanel
            summary={projectAssistantSummary}
            actions={projectAssistantActions}
            notice={projectAssistantNotice}
            onAction={useProjectAssistantAction}
          />
        ) : hideContextHeader ? null : !isFieldAwareMode ? (
          <div
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
            data-testid={testId("start-with-ai-status")}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">{userFacingPanel.status}</div>
                {userFacingPanel.statusDetail ? (
                  <div
                    className="mt-1 text-sm text-slate-600"
                    data-testid={testId("start-with-ai-status-summary")}
                  >
                    {userFacingPanel.statusDetail}
                  </div>
                ) : null}
              </div>
              {isPlanning ? <CompactBadge>Working...</CompactBadge> : null}
            </div>
          </div>
        ) : (
          <div
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
            data-testid={testId("start-with-ai-field-context")}
          >
            <div className="text-sm font-semibold text-slate-900">
              {isFieldAwareDescriptionMode
                ? "Description / Scope field assistance"
                : isFieldAwareMilestonesMode
                ? "Milestones field assistance"
                : "Exclusions / Assumptions field assistance"}
            </div>
            <div className="mt-1 text-sm text-slate-600">
              {[
                normalizedContext?.template_name || normalizedContext?.template_summary?.name,
                normalizedContext?.project_type || normalizedContext?.template_summary?.project_type,
                normalizedContext?.project_subtype || normalizedContext?.template_summary?.project_subtype,
              ]
                .filter(Boolean)
                .join(" · ") || "Using the current template context"}
            </div>
            {(isFieldAwareMilestonesMode || isFieldAwareExclusionsMode) && normalizedContext?.description ? (
              <div className="mt-2 text-xs leading-5 text-slate-500">
                Scope signal: {normalizedContext.description}
              </div>
            ) : null}
          </div>
        )}

        {!isAgreementWizardAssistant && !isFieldAwareMode && (userFacingPanel.coachingTitle || userFacingPanel.coachingMessage) ? (
          <div
            className={`rounded-2xl border px-4 py-4 ${coachingToneClasses(
              userFacingPanel.coachingTone
            ).wrapper}`}
            data-testid={testId("start-with-ai-coaching")}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                      coachingToneClasses(userFacingPanel.coachingTone).badge
                    }`}
                  >
                    {userFacingPanel.coachingTone === "positive"
                      ? "On track"
                      : userFacingPanel.coachingTone === "attention"
                      ? "Needs attention"
                      : "Guidance"}
                  </span>
                </div>
                {userFacingPanel.coachingTitle ? (
                  <div
                    className={`mt-3 text-sm font-semibold ${
                      coachingToneClasses(userFacingPanel.coachingTone).title
                    }`}
                    data-testid={testId("start-with-ai-coaching-title")}
                  >
                    {userFacingPanel.coachingTitle}
                  </div>
                ) : null}
                {userFacingPanel.coachingMessage ? (
                  <div
                    className={`mt-1 text-sm ${
                      coachingToneClasses(userFacingPanel.coachingTone).body
                    }`}
                    data-testid={testId("start-with-ai-coaching-message")}
                  >
                    {userFacingPanel.coachingMessage}
                  </div>
                ) : null}
              </div>
            </div>
            {userFacingPanel.nextStepMessage ? (
              <div
                className="mt-3 rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm font-medium text-slate-800"
                data-testid={testId("start-with-ai-coaching-next-step")}
              >
                {userFacingPanel.nextStepMessage}
              </div>
            ) : null}
          </div>
        ) : null}

        {visibleQuickActions.length ? (
          <div className="flex flex-wrap gap-2">
            {visibleQuickActions.map((action) => (
              <button
                key={action.intent || action.label}
                type="button"
                onClick={() => useQuickAction(action)}
                className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-900 hover:text-slate-900"
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}

        <form onSubmit={submitPrompt}>
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-3">
            <textarea
              ref={inputRef}
              data-testid={testId("start-with-ai-input")}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="w-full resize-none bg-transparent px-2 py-2 text-base text-slate-900 outline-none"
              placeholder={promptPlaceholder}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
              <div className="text-xs text-slate-500">
                {inputHelperText}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid={testId("assistant-voice-button")}
                  onClick={handleVoiceInput}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  {voiceStatus === "listening" || voiceStatus === "transcribing" ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                  {voiceStatus === "listening" ? "Listening" : "Voice"}
                </button>
                <button
                  type="submit"
                  data-testid={testId("start-with-ai-submit")}
                  disabled={isPlanning}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  {isPlanning
                    ? "Working..."
                    : submitLabel}
                  {isPlanning ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            <div
              data-testid={testId("assistant-voice-status")}
              className={`mt-2 px-2 text-xs ${
                voiceStatus === "failed" || voiceStatus === "unsupported"
                  ? "text-rose-600"
                  : voiceStatus === "listening" || voiceStatus === "transcribing"
                  ? "text-indigo-600"
                  : "text-slate-500"
              }`}
            >
              {voiceStatusLabel(voiceStatus)}
            </div>
          </div>
        </form>

        {!isAgreementWizardAssistant && userFacingPanel.feedback ? (
          <ResultBlock title="AI Updated" testId={testId("start-with-ai-updated")}>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {userFacingPanel.feedback}
            </div>
          </ResultBlock>
        ) : null}

        {!isAgreementWizardAssistant && !isFieldAwareMode && isTemplatesPage && userFacingPanel.templateDraft ? (
          <TemplateDraftPreview
            draft={userFacingPanel.templateDraft}
            questions={userFacingPanel.guidedQuestions}
            onAction={onAction}
            testId={testId("start-with-ai-template-draft")}
          />
        ) : null}

        {isFieldAwareDescriptionMode && fieldDraft ? (
          <ResultBlock
            title="Description Draft"
            testId={testId("start-with-ai-description-draft")}
          >
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-slate-800">
              {fieldDraft}
            </div>
            <button
              type="button"
              onClick={handleApplyFieldDraft}
              data-testid={testId("start-with-ai-apply-description")}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Apply to Description
              <ArrowRight className="h-4 w-4" />
            </button>
          </ResultBlock>
        ) : null}

        {isFieldAwareMilestonesMode && milestoneDrafts.length ? (
          <ResultBlock
            title="Milestone Drafts"
            testId={testId("start-with-ai-milestone-drafts")}
          >
            <div className="space-y-2">
              {milestoneDrafts.map((item, idx) => (
                <div
                  key={`${item.title}-${idx}`}
                  className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-slate-800"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-slate-900">
                      {idx + 1}. {item.title}
                    </div>
                    {item.normalized_milestone_type ? (
                      <span className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                        {labelForTemplateMilestoneType(item.normalized_milestone_type) ||
                          item.normalized_milestone_type.replaceAll("_", " ")}
                      </span>
                    ) : null}
                  </div>
                  {item.description ? (
                    <div className="mt-2 leading-6 text-slate-700">{item.description}</div>
                  ) : null}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={handleApplyMilestoneDrafts}
              data-testid={testId("start-with-ai-apply-milestones")}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Apply Milestones
              <ArrowRight className="h-4 w-4" />
            </button>
          </ResultBlock>
        ) : null}

        {isFieldAwareExclusionsMode &&
        (exclusionsDraft.exclusions.length || exclusionsDraft.assumptions.length) ? (
          <ResultBlock
            title="Exclusions Draft"
            testId={testId("start-with-ai-exclusions-draft")}
          >
            {exclusionsDraft.exclusions.length ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Exclusions
                </div>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-800">
                  {exclusionsDraft.exclusions.map((item, idx) => (
                    <li key={`exclusion-${idx}`}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {exclusionsDraft.assumptions.length ? (
              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Assumptions
                </div>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-800">
                  {exclusionsDraft.assumptions.map((item, idx) => (
                    <li key={`assumption-${idx}`}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <button
              type="button"
              onClick={handleApplyExclusionsDraft}
              data-testid={testId("start-with-ai-apply-exclusions")}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Apply Exclusions
              <ArrowRight className="h-4 w-4" />
            </button>
          </ResultBlock>
        ) : null}

        {!isAgreementWizardAssistant && !isFieldAwareMode && userFacingPanel.templateRecommendation?.title ? (
          <ResultBlock
            title="AI Recommendation"
            testId={testId("start-with-ai-template-recommendation")}
          >
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-3 text-sm text-indigo-950">
              <div className="font-semibold">
                {userFacingPanel.templateRecommendation.title}
              </div>
              {userFacingPanel.templateRecommendation.body ? (
                <div className="mt-1 text-sm text-indigo-900/90">
                  {userFacingPanel.templateRecommendation.body}
                </div>
              ) : null}
              <button
                type="button"
                data-testid={testId("start-with-ai-template-action")}
                onClick={handleTemplateRecommendationAction}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                {userFacingPanel.templateRecommendation.actionLabel || "Save as Template"}
                <Compass className="h-4 w-4" />
              </button>
            </div>
          </ResultBlock>
        ) : null}

        {!isAgreementWizardAssistant && !isFieldAwareMode && userFacingPanel.checklistItems.length ? (
          <ResultBlock title="Pre-send Checklist" testId={testId("start-with-ai-checklist")}>
            <div className="space-y-2">
              {userFacingPanel.checklistItems.map((item) => {
                const interactive = item?.targetStep != null;
                const content = (
                  <>
                    <ChecklistTone tone={item?.tone} />
                    <span className="flex-1">{item?.label}</span>
                  </>
                );
                return interactive ? (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleChecklistAction(item)}
                    className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    key={item.key}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    {content}
                  </div>
                );
              })}
            </div>
          </ResultBlock>
        ) : null}

        {!isAgreementWizardAssistant && !isFieldAwareDescriptionMode && isInClarifyingMode ? (
          <ResultBlock
            title="Choose a workflow"
            testId={testId("start-with-ai-clarifying")}
          >
            <div className="mb-3 text-sm text-slate-700">
              I want to make sure I send you to the right place — did you mean:
            </div>
            <div className="flex flex-wrap gap-2">
              {(plan.candidate_intents || []).map((candidate) => (
                <button
                  key={candidate.intent}
                  type="button"
                  data-testid={testId(`start-with-ai-candidate-${candidate.intent}`)}
                  onClick={() => navigateWithCandidateIntent(candidate)}
                  className="rounded-full border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-800 transition hover:border-indigo-600 hover:bg-indigo-100"
                >
                  {candidate.label}
                </button>
              ))}
              {plan.intent_label && plan.navigation_target ? (
                <button
                  type="button"
                  data-testid={testId("start-with-ai-clarify-primary")}
                  onClick={handlePrimaryAction}
                  className="rounded-full border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition hover:border-slate-900"
                >
                  {plan.intent_label}
                </button>
              ) : null}
            </div>
          </ResultBlock>
        ) : !isAgreementWizardAssistant && !isFieldAwareDescriptionMode ? (
          <ResultBlock title={userFacingPanel.nextActionTitle || "Next Action"}>
            <div
              className="text-sm font-medium text-slate-800"
              data-testid={testId("start-with-ai-next-action-label")}
            >
              {userFacingPanel.nextActionText}
            </div>
            {userFacingPanel.showPrimaryAction ? (
              <button
                type="button"
                data-testid={testId("start-with-ai-navigate")}
                onClick={handlePrimaryAction}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                {userFacingPanel.primaryActionLabel}
                <Compass className="h-4 w-4" />
              </button>
            ) : null}
          </ResultBlock>
        ) : null}

        {!isAgreementWizardAssistant && !isFieldAwareDescriptionMode && userFacingPanel.nextGuidance ? (
          <ResultBlock
            title={userFacingPanel.nextGuidanceTitle || "What happens next"}
            testId={testId("start-with-ai-next-guidance")}
          >
            <div>{userFacingPanel.nextGuidance}</div>
          </ResultBlock>
        ) : null}

        {showDiagnostics ? (
          <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">
              Assistant diagnostics
            </summary>
            <div className="mt-4 space-y-4">
              {userFacingPanel.diagnostics.intentLabel ? (
                <ResultBlock title="Detected Intent">
                  <div className="flex flex-wrap items-center gap-2">
                    <div data-testid={testId("start-with-ai-detected-intent")}>
                      <IntentPill label={userFacingPanel.diagnostics.intentLabel} />
                    </div>
                    {userFacingPanel.diagnostics.summary ? (
                      <span className="text-sm text-slate-600">{userFacingPanel.diagnostics.summary}</span>
                    ) : null}
                  </div>
                </ResultBlock>
              ) : null}

              {Object.keys(userFacingPanel.diagnostics.collectedData || {}).length ? (
                <ResultBlock title="Collected Data">
                  <div className="flex flex-wrap gap-2" data-testid={testId("start-with-ai-collected-data")}>
                    {Object.entries(userFacingPanel.diagnostics.collectedData).map(([key, value]) => (
                      <span
                        key={key}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                      >
                        {key}: {String(value)}
                      </span>
                    ))}
                  </div>
                </ResultBlock>
              ) : null}

              {userFacingPanel.diagnostics.missingFields.length ? (
                <ResultBlock title="Missing Required Fields">
                  <div className="space-y-2">
                    {userFacingPanel.diagnostics.missingFields.map((field) => (
                      <div
                        key={field.key}
                        className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
                      >
                        {field.prompt}
                      </div>
                    ))}
                  </div>
                </ResultBlock>
              ) : null}

              {userFacingPanel.diagnostics.suggestions.length ? (
                <ResultBlock title="Suggestions">
                  <div className="space-y-2">
                    {userFacingPanel.diagnostics.suggestions.map((item) => (
                      <div key={item} className="flex items-start gap-2">
                        <Sparkles className="mt-0.5 h-4 w-4 text-indigo-500" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </ResultBlock>
              ) : null}

              <ResultBlock title="Structured Handoff" testId={testId("start-with-ai-structured-handoff")}>
                <button
                  type="button"
                  data-testid={testId("start-with-ai-structured-toggle")}
                  onClick={() => setShowStructuredPayload((value) => !value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                >
                  {showStructuredPayload ? "Hide handoff payload" : "Show handoff payload"}
                </button>
                {showStructuredPayload ? (
                  <pre
                    className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-slate-950 p-3 text-xs text-slate-100"
                    data-testid={testId("start-with-ai-structured-json")}
                  >
                    {JSON.stringify(userFacingPanel.diagnostics.raw, null, 2)}
                  </pre>
                ) : null}
              </ResultBlock>

              {userFacingPanel.diagnostics.history.length ? (
                <ResultBlock title="Recent Requests">
                  <div className="space-y-2">
                    {userFacingPanel.diagnostics.history
                      .slice(-4)
                      .reverse()
                      .map((entry, index) => (
                        <button
                          key={`${entry.prompt}-${index}`}
                          type="button"
                          onClick={() => setPlan(entry.plan)}
                          className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:border-slate-900"
                        >
                          <div className="font-semibold text-slate-900">{entry.prompt}</div>
                          <div className="mt-1 text-xs text-slate-500">{entry.plan.intent_label}</div>
                        </button>
                      ))}
                  </div>
                </ResultBlock>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}
