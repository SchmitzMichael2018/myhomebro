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
  };
}

function ChecklistTone({ tone = "success" }) {
  if (tone === "warning") {
    return <span className="text-sm font-semibold text-amber-700">!</span>;
  }
  return <span className="text-sm font-semibold text-emerald-700">OK</span>;
}

export function StartWithAIEntry({
  title = "Start with AI",
  description = "Get a guided next step for the workflow you are already in.",
  context = {},
  onAction,
  onOpenChange = null,
  defaultOpen = false,
  className = "",
  testId = "start-with-ai-entry",
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { openAssistant } = useAssistantDock();
  const entryContext = useMemo(() => ({ ...(context || {}) }), [context]);

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
                const next = !value;
                onOpenChange?.(next);
                return next;
              })
            }
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <Wand2 className="h-4 w-4" />
            {open ? "Hide Assistant" : "Start with AI"}
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
            Open Side Panel
          </button>
        </div>
      </div>

      {open ? (
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
  const panelConfig = useMemo(
    () => normalizePanelConfig(normalizedContext),
    [normalizedContext]
  );
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState([]);
  const [showStructuredPayload, setShowStructuredPayload] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [isPlanning, setIsPlanning] = useState(false);
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
    return () => {
      try {
        recognitionRef.current?.stop?.();
      } catch {}
    };
  }, []);

  const quickActions = useMemo(
    () => (panelConfig.quickActions.length ? panelConfig.quickActions : getAssistantQuickActions()),
    [panelConfig.quickActions]
  );
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
    if (!cleanPrompt) return;
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
      state: {
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
      },
    });
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
                AI Assistant
              </div>
              <h2
                data-testid={testId("start-with-ai-title")}
                className="mt-1 text-2xl font-bold tracking-tight text-slate-900"
              >
                {userFacingPanel.headline}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                {userFacingPanel.helperText}
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

        {userFacingPanel.quickActions.length ? (
          <div className="flex flex-wrap gap-2">
            {userFacingPanel.quickActions.map((action) => (
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
              placeholder={userFacingPanel.promptPlaceholder}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
              <div className="text-xs text-slate-500">
                Ask AI what you want to improve in this step.
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
                  disabled={isPlanning}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  {isPlanning ? "Working..." : "Ask AI"}
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

        {userFacingPanel.templateRecommendation?.title ? (
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

        {userFacingPanel.checklistItems.length ? (
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

        <ResultBlock title="Next Action">
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

        {userFacingPanel.nextGuidance ? (
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
