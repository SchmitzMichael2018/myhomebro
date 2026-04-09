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
import { getAssistantQuickActions } from "../lib/startWithAiAssistant.js";
import {
  normalizeStructuredPlanShape,
  produceStructuredAssistantPlan,
} from "../lib/assistantReasoning.js";
import { buildUserFacingAiPanel } from "../lib/agreementWizardAiPanel.js";
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

function buildTemplateDescriptionDraft(context = {}) {
  const templateName = String(context?.template_name || context?.template_summary?.name || "").trim();
  const projectType = String(
    context?.project_type || context?.template_summary?.project_type || ""
  ).trim();
  const projectSubtype = String(
    context?.project_subtype || context?.template_summary?.project_subtype || ""
  ).trim();

  const subtypePhrase = projectSubtype || projectType || "project";
  const typePhrase = projectType && projectType !== projectSubtype ? projectType.toLowerCase() : "";

  const opening = subtypePhrase
    ? `Reusable ${subtypePhrase.toLowerCase()} scope covering the typical planning, preparation, core work, and closeout needed for this type of project.`
    : "Reusable project scope covering the typical planning, preparation, execution, and closeout needed for this type of work.";

  const middle = [
    "Includes the work commonly expected by the customer, coordination between major phases, and the standard finishing steps needed to deliver a complete result.",
    typePhrase
      ? `Built to give teams a clean starting point for repeatable ${typePhrase} jobs while leaving room for project-specific pricing, clarifications, and milestone detail.`
      : "Built to give teams a clean starting point for repeatable jobs while leaving room for project-specific pricing, clarifications, and milestone detail.",
  ];

  return [opening, ...middle].join(" ");
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

export function StartWithAIEntry({
  title = "Ask AI",
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
              AI Assistant
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
            {resolvedOpen ? "Hide Assistant" : "Ask AI"}
          </button>
          <button
            type="button"
            data-testid={`${testId}-dock`}
            onClick={() => {
              onOpenChange?.(true);
              openAssistant({ title, context: entryContext });
            }}
            className="hidden items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 xl:inline-flex"
          >
            <PanelRightOpen className="h-4 w-4" />
            Open Copilot
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
}) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const testId = (base) => (mode === "dock" ? `${base}-dock` : base);
  const contextSignature = useMemo(() => JSON.stringify(context || {}), [context]);
  const normalizedContext = useMemo(() => context || {}, [contextSignature, context]);
  const isContextualMode = mode === "dock" || mode === "panel";
  const isFieldAwareDescriptionMode = useMemo(
    () => isTemplateDescriptionMode(normalizedContext),
    [normalizedContext]
  );
  const isFieldAwareMilestonesMode = useMemo(
    () => isTemplateMilestonesMode(normalizedContext),
    [normalizedContext]
  );
  const isFieldAwareMode = isFieldAwareDescriptionMode || isFieldAwareMilestonesMode;
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
  const showDiagnostics =
    import.meta.env.DEV ||
    (typeof window !== "undefined" && window.MYHOMEBRO_DEBUG_ASSISTANT === true);
  const visibleQuickActions = isContextualMode ? [] : userFacingPanel.quickActions;
  const sectionEyebrow = isFieldAwareMode
    ? "AI Copilot"
    : isContextualMode
    ? "AI Copilot"
    : "AI Assistant";
  const inputHelperText = isFieldAwareDescriptionMode
    ? "Generate reusable template scope text for this description field."
    : isFieldAwareMilestonesMode
    ? "Generate reusable milestone titles for this template."
    : isContextualMode
    ? "Ask AI about the step you're on right now."
    : "Describe the work you want to start or improve.";
  const headline = isFieldAwareDescriptionMode
    ? "Generate description text for this template"
    : isFieldAwareMilestonesMode
    ? "Generate milestone sequence for this template"
    : userFacingPanel.headline;
  const helperText = isFieldAwareDescriptionMode
    ? "Use the current template name, type, and subtype to draft reusable scope language for the Description / Scope field."
    : isFieldAwareMilestonesMode
    ? "Use the current template scope, type, and subtype to draft a reusable milestone sequence for this template."
    : userFacingPanel.helperText;
  const promptPlaceholder = isFieldAwareDescriptionMode
    ? 'Optional: add extra scope guidance like "include prep, finish work, and cleanup."'
    : isFieldAwareMilestonesMode
    ? 'Optional: add sequencing guidance like "include permit review and punch list."'
    : userFacingPanel.promptPlaceholder;
  const submitLabel = isFieldAwareDescriptionMode
    ? "Generate Description"
    : isFieldAwareMilestonesMode
    ? "Generate Milestones"
    : panelConfig.submitButtonLabel || "Ask AI";

  useEffect(() => {
    setFieldDraft("");
    setMilestoneDrafts([]);
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
      const baseDraft = buildTemplateDescriptionDraft(normalizedContext);
      const finalDraft = cleanPrompt
        ? `${baseDraft} ${cleanPrompt}`.trim()
        : baseDraft;
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
      setMilestoneDrafts(
        finalDrafts.map((item, idx) => ({
          title: String(item?.title || "").trim(),
          description: String(item?.description || "").trim(),
          normalized_milestone_type: String(item?.normalized_milestone_type || "").trim(),
          sort_order: idx + 1,
        }))
      );
      setHistory((prev) => [
        ...prev,
        { prompt: cleanPrompt || "Generate milestones", plan: { intent_label: "Template Milestones" } },
      ]);
      return;
    }
    if (!cleanPrompt) return;
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

      <div className="space-y-4 px-5 py-5">
        {!isFieldAwareMode ? (
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
                : "Milestones field assistance"}
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
            {isFieldAwareMilestonesMode && normalizedContext?.description ? (
              <div className="mt-2 text-xs leading-5 text-slate-500">
                Scope signal: {normalizedContext.description}
              </div>
            ) : null}
          </div>
        )}

        {!isFieldAwareMode && (userFacingPanel.coachingTitle || userFacingPanel.coachingMessage) ? (
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

        {userFacingPanel.feedback ? (
          <ResultBlock title="AI Updated" testId={testId("start-with-ai-updated")}>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {userFacingPanel.feedback}
            </div>
          </ResultBlock>
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
                        {item.normalized_milestone_type.replaceAll("_", " ")}
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

        {!isFieldAwareMode && userFacingPanel.templateRecommendation?.title ? (
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

        {!isFieldAwareMode && userFacingPanel.checklistItems.length ? (
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

        {!isFieldAwareDescriptionMode ? (
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

        {!isFieldAwareDescriptionMode && userFacingPanel.nextGuidance ? (
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
