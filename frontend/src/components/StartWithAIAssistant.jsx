import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bot,
  Compass,
  Sparkles,
  ArrowRight,
  Wand2,
  ChevronDown,
  ChevronUp,
  Mic,
  LoaderCircle,
  PanelRightOpen,
} from "lucide-react";

import api from "../api.js";
import {
  getAssistantQuickActions,
} from "../lib/startWithAiAssistant.js";
import {
  normalizeStructuredPlanShape,
  produceStructuredAssistantPlan,
} from "../lib/assistantReasoning.js";
import { useAssistantDock } from "./AssistantDock.jsx";

function getSpeechRecognitionCtor() {
  if (typeof window === "undefined") return null;
  return window.webkitSpeechRecognition || window.SpeechRecognition || null;
}

function voiceStatusLabel(status) {
  if (status === "listening") return "Listening…";
  if (status === "transcribing") return "Transcribing…";
  if (status === "unsupported") return "Voice input is not supported in this browser.";
  if (status === "failed") return "Voice capture failed. Try typing instead.";
  return "Voice input ready";
}

function ResultBlock({ title, children, testId = "" }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4" data-testid={testId || undefined}>
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

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return `$${num.toFixed(2)}`;
}

function displayAssistantItem(item) {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return "";
  return item.title || item.label || item.question || item.key || "";
}

export function StartWithAIEntry({
  title = "Start with AI",
  description = "Get a guided next step for the workflow you are already in.",
  context = {},
  onAction,
  defaultOpen = false,
  className = "",
  testId = "start-with-ai-entry",
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { openAssistant } = useAssistantDock();

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
            onClick={() => setOpen((value) => !value)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <Wand2 className="h-4 w-4" />
            {open ? "Hide Assistant" : "Start with AI"}
          </button>
          <button
            type="button"
            data-testid={`${testId}-dock`}
            onClick={() => openAssistant({ title, context })}
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

  const quickActions = useMemo(() => getAssistantQuickActions(), []);

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

  async function useQuickAction(intent) {
    const nextPlan = await requestOrchestratedPlan("", {
      preferredIntent: intent,
      previousPlan: null,
    });
    setPlan(nextPlan);
    setTimeout(() => inputRef.current?.focus(), 0);
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
                Tell me what you want to do
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                I route you into existing MyHomeBro workflows, ask only for missing details,
                and return a structured next step.
              </p>
              <div
                data-testid={testId("assistant-reasoning-badges")}
                className="mt-3 flex flex-wrap gap-2 text-xs"
              >
                <CompactBadge>
                  Confidence: {plan.planning_confidence || "medium"}
                </CompactBadge>
                <CompactBadge>
                  Reasoning: {plan.reasoning_source || "rules_fallback"}
                </CompactBadge>
                {isPlanning ? <CompactBadge>Planning...</CompactBadge> : null}
              </div>
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

      <div className="px-5 py-5">
        {plan.context_summary ? (
          <div className="mb-4 flex flex-wrap gap-2" data-testid={testId("start-with-ai-context-summary")}>
            <CompactBadge>Context: {plan.context_summary}</CompactBadge>
            {normalizedContext.current_route ? (
              <CompactBadge>Route: {normalizedContext.current_route}</CompactBadge>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {quickActions.map((action) => (
            <button
              key={action.intent}
              type="button"
              onClick={() => useQuickAction(action.intent)}
              className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-900 hover:text-slate-900"
            >
              {action.label}
            </button>
          ))}
        </div>

        <form onSubmit={submitPrompt} className="mt-5">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-3">
            <textarea
              ref={inputRef}
              data-testid={testId("start-with-ai-input")}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="w-full resize-none bg-transparent px-2 py-2 text-base text-slate-900 outline-none"
              placeholder='Examples: "Start agreement for Casey Prospect kitchen remodel" or "Help me finish this agreement".'
            />
            <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
              <div className="text-xs text-slate-500">
                Structured intents: lead, customer, agreement, templates, milestones, clarifications, resume, navigation.
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
                  {isPlanning ? "Planning..." : "Plan Next Step"}
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

        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
          <div className="space-y-4">
            <ResultBlock title="Detected Intent">
              <div className="flex flex-wrap items-center gap-2">
                <div data-testid={testId("start-with-ai-detected-intent")}>
                  <IntentPill label={plan.intent_label} />
                </div>
                <span className="text-sm text-slate-600">{plan.summary}</span>
              </div>
            </ResultBlock>

            <ResultBlock title="Collected Data">
              {Object.keys(plan.collected_data || {}).length ? (
                <div className="flex flex-wrap gap-2" data-testid={testId("start-with-ai-collected-data")}>
                  {Object.entries(plan.collected_data).map(([key, value]) => (
                    <span
                      key={key}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                    >
                      {key}: {String(value)}
                    </span>
                  ))}
                </div>
              ) : (
                <div>No details captured yet.</div>
              )}
            </ResultBlock>

            <ResultBlock title="Missing Required Fields">
              {plan.missing_fields.length ? (
                <div className="space-y-2">
                  {plan.missing_fields.map((field) => (
                    <div key={field.key} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      {field.prompt}
                    </div>
                  ))}
                </div>
              ) : (
                <div>Nothing required is missing.</div>
              )}
            </ResultBlock>

            <ResultBlock title="Next Action">
              <div className="flex flex-wrap items-center gap-3">
                <div
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                  data-testid={testId("start-with-ai-next-action-label")}
                >
                  {plan.next_action.label}
                </div>
                {plan.next_action.type !== "collect_missing_fields" ? (
                  <button
                    type="button"
                    data-testid={testId("start-with-ai-navigate")}
                    onClick={handlePrimaryAction}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    {plan.confirmation_required
                      ? `Continue to Confirm: ${plan.next_action.label}`
                      : plan.next_action.label}
                    <Compass className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              <div className="mt-3 text-sm text-slate-600">{plan.follow_up_prompt}</div>
            </ResultBlock>

            {plan.confidence_reasoning ? (
              <ResultBlock title="Why" testId={testId("start-with-ai-why")}>
                <div>{plan.confidence_reasoning}</div>
              </ResultBlock>
            ) : null}

            {plan.confirmation_required ? (
              <ResultBlock title="Confirmation Required" testId={testId("start-with-ai-confirmation")}>
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  This recommendation leads into a workflow that still requires an explicit confirmation before any higher-impact action is saved.
                </div>
              </ResultBlock>
            ) : null}

            {plan.guided_question ? (
              <ResultBlock title="Guided Creation" testId={testId("start-with-ai-guided-flow")}>
                <div className="space-y-2">
                  <div className="font-semibold text-slate-900">{plan.guided_question}</div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {plan.guided_step ? <CompactBadge>{plan.guided_step}</CompactBadge> : null}
                    {plan.field_key ? <CompactBadge>{plan.field_key}</CompactBadge> : null}
                  </div>
                  {plan.why_this_matters ? (
                    <div className="text-sm text-slate-600">{plan.why_this_matters}</div>
                  ) : null}
                </div>
              </ResultBlock>
            ) : null}

            {(plan.automation_plan?.applyable_preview || plan.applyable_preview) ? (
              <ResultBlock title="Auto-Build Preview" testId={testId("start-with-ai-auto-build-preview")}>
                <div className="space-y-3">
                  {plan.applyable_preview?.template_recommendations?.[0]?.name ? (
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                      <div className="font-semibold text-slate-900">Recommended template</div>
                      <div className="mt-1">{plan.applyable_preview.template_recommendations[0].name}</div>
                    </div>
                  ) : null}
                  {plan.applyable_preview?.estimate_preview?.suggested_total_price ? (
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                      <div className="font-semibold text-slate-900">Estimate bundle</div>
                      <div className="mt-1">
                        {formatMoney(plan.applyable_preview.estimate_preview.suggested_total_price)} suggested total
                      </div>
                    </div>
                  ) : null}
                  {plan.applyable_preview?.suggested_milestones?.length ? (
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                      <div className="font-semibold text-slate-900">Milestone preview</div>
                      <div className="mt-1">
                        {plan.applyable_preview.suggested_milestones.length} suggested milestone
                        {plan.applyable_preview.suggested_milestones.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  ) : null}
                  {plan.applyable_preview?.clarification_questions?.length ? (
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                      <div className="font-semibold text-slate-900">Clarifications needed</div>
                      <div className="mt-1">
                        {plan.applyable_preview.clarification_questions.length} question
                        {plan.applyable_preview.clarification_questions.length === 1 ? "" : "s"} staged for review
                      </div>
                    </div>
                  ) : null}
                </div>
              </ResultBlock>
            ) : null}

            {plan.blocked_workflow_states?.length ? (
              <ResultBlock title="Workflow Blocks" testId={testId("start-with-ai-blocked-states")}>
                <div className="space-y-2">
                  {plan.blocked_workflow_states.map((item) => (
                    <div
                      key={item}
                      className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </ResultBlock>
            ) : null}

            {plan.proactive_recommendations?.length ? (
              <ResultBlock
                title="Proactive Recommendations"
                testId={testId("start-with-ai-proactive-recommendations")}
              >
                <div className="space-y-2">
                  {plan.proactive_recommendations.map((item) => (
                    <div
                      key={`${item.recommendation_type}-${item.title}`}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700"
                    >
                      <div className="font-semibold text-slate-900">{item.title}</div>
                      <div className="mt-1">{item.message}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        {item.severity ? <CompactBadge>{item.severity}</CompactBadge> : null}
                        {item.source ? <CompactBadge>{item.source}</CompactBadge> : null}
                        {item.recommended_action ? <CompactBadge>{item.recommended_action}</CompactBadge> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </ResultBlock>
            ) : null}

            {plan.predictive_insights?.length ? (
              <ResultBlock
                title="Predictive Insights"
                testId={testId("start-with-ai-predictive-insights")}
              >
                <div className="space-y-2">
                  {plan.predictive_insights.map((item) => (
                    <div
                      key={`${item.insight_type}-${item.title}`}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700"
                    >
                      <div className="font-semibold text-slate-900">{item.title}</div>
                      <div className="mt-1">{item.summary}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        {item.confidence ? <CompactBadge>{item.confidence}</CompactBadge> : null}
                        {item.recommended_follow_up ? <CompactBadge>{item.recommended_follow_up}</CompactBadge> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </ResultBlock>
            ) : null}

            {plan.preview_payload?.templates?.length ? (
              <ResultBlock
                title="Suggested Templates"
                testId={testId("start-with-ai-template-recommendations")}
              >
                <div className="space-y-2">
                  {plan.preview_payload.templates.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700"
                    >
                      <div className="font-semibold text-slate-900">{item.name}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {item.project_type || "Project"} {item.project_subtype ? `• ${item.project_subtype}` : ""}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <CompactBadge>{item.source_label || item.visibility}</CompactBadge>
                        {item.region_label ? <CompactBadge>{item.region_label}</CompactBadge> : null}
                        <CompactBadge>Rank {item.rank_score}</CompactBadge>
                        <CompactBadge>Used {item.usage_count}</CompactBadge>
                      </div>
                    </div>
                  ))}
                </div>
              </ResultBlock>
            ) : null}

            {plan.preview_payload?.estimate_preview ? (
              <ResultBlock title="Estimate Preview" testId={testId("start-with-ai-estimate-preview")}>
                <div className="space-y-2">
                  <div className="font-semibold text-slate-900">
                    ${plan.preview_payload.estimate_preview.suggested_total_price} suggested total
                  </div>
                  <div className="text-sm text-slate-600">
                    Range ${plan.preview_payload.estimate_preview.suggested_price_low} to $
                    {plan.preview_payload.estimate_preview.suggested_price_high} • Timeline{" "}
                    {plan.preview_payload.estimate_preview.suggested_duration_days} days
                  </div>
                  <div className="text-sm text-slate-600">
                    Confidence: {plan.preview_payload.estimate_preview.confidence_level}
                  </div>
                </div>
              </ResultBlock>
            ) : null}

            {plan.preview_payload?.maintenance_preview ? (
              <ResultBlock
                title="Maintenance Preview"
                testId={testId("start-with-ai-maintenance-preview")}
              >
                <div className="space-y-2">
                  <div className="font-semibold text-slate-900">
                    {plan.preview_payload.maintenance_preview.recurring_summary_label ||
                      plan.preview_payload.maintenance_preview.recommended_frequency ||
                      "Recurring maintenance preview"}
                  </div>
                  <div className="text-sm text-slate-600">
                    Starts {plan.preview_payload.maintenance_preview.recurrence_start_date || "when you confirm the agreement"}
                    {plan.preview_payload.maintenance_preview.recurrence_interval
                      ? ` • Every ${plan.preview_payload.maintenance_preview.recurrence_interval} ${plan.preview_payload.maintenance_preview.recommended_frequency || "cycle"}`
                      : ""}
                  </div>
                  {Array.isArray(plan.preview_payload.maintenance_preview.suggested_milestones) &&
                  plan.preview_payload.maintenance_preview.suggested_milestones.length ? (
                    <div className="text-sm text-slate-600">
                      {plan.preview_payload.maintenance_preview.suggested_milestones.length} upcoming occurrence preview
                      {plan.preview_payload.maintenance_preview.suggested_milestones.length === 1 ? "" : "s"} ready for review.
                    </div>
                  ) : null}
                </div>
              </ResultBlock>
            ) : null}

            {plan.preview_payload?.onboarding ? (
              <ResultBlock
                title="Onboarding Guidance"
                testId={testId("start-with-ai-onboarding-preview")}
              >
                <div className="space-y-2">
                  <div className="font-semibold text-slate-900">
                    Next setup step: {String(plan.preview_payload.onboarding.step || "welcome").replaceAll("_", " ")}
                  </div>
                  <div className="text-sm text-slate-600">
                    Status: {plan.preview_payload.onboarding.status || "not_started"}
                    {plan.preview_payload.onboarding.service_region_label
                      ? ` • ${plan.preview_payload.onboarding.service_region_label}`
                      : ""}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <CompactBadge>
                      Trades: {Number(plan.preview_payload.onboarding.trade_count || 0)}
                    </CompactBadge>
                    {plan.preview_payload.onboarding.show_soft_stripe_prompt ? (
                      <CompactBadge>Stripe prompt ready</CompactBadge>
                    ) : null}
                  </div>
                </div>
              </ResultBlock>
            ) : null}

            {plan.preview_payload?.compliance || plan.preview_payload?.assignment_compliance ? (
              <ResultBlock title="Compliance Notes" testId={testId("start-with-ai-compliance-notes")}>
                <div className="space-y-2">
                  <div>
                    {plan.preview_payload.assignment_compliance?.warning_message ||
                      plan.preview_payload.compliance?.message ||
                      "Compliance context is available for review."}
                  </div>
                  {(plan.preview_payload.assignment_compliance?.trade_label ||
                    plan.preview_payload.compliance?.trade_key) ? (
                    <div className="flex flex-wrap gap-2 text-xs">
                      {plan.preview_payload.assignment_compliance?.trade_label ? (
                        <CompactBadge>{plan.preview_payload.assignment_compliance.trade_label}</CompactBadge>
                      ) : null}
                      {plan.preview_payload.assignment_compliance?.state_code ||
                      plan.preview_payload.compliance?.state_code ? (
                        <CompactBadge>
                          {plan.preview_payload.assignment_compliance?.state_code ||
                            plan.preview_payload.compliance?.state_code}
                        </CompactBadge>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </ResultBlock>
            ) : null}

            {plan.suggested_milestones?.length ? (
              <ResultBlock title="Suggested Milestones" testId={testId("start-with-ai-suggested-milestones")}>
                <div className="space-y-2">
                  {plan.suggested_milestones.map((item, index) => (
                    <div
                      key={`${displayAssistantItem(item) || index}-${index}`}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                    >
                      {index + 1}. {displayAssistantItem(item)}
                    </div>
                  ))}
                </div>
              </ResultBlock>
            ) : null}

            {plan.clarification_questions?.length ? (
              <ResultBlock title="Clarification Questions" testId={testId("start-with-ai-clarification-questions")}>
                <div className="space-y-2">
                  {plan.clarification_questions.map((item) => (
                    <div
                      key={displayAssistantItem(item)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                    >
                      {displayAssistantItem(item)}
                    </div>
                  ))}
                </div>
              </ResultBlock>
            ) : null}
          </div>

          <div className="space-y-4">
            <ResultBlock title="Suggestions">
              <div className="space-y-2">
                {(plan.suggestions || []).map((item) => (
                  <div key={item} className="flex items-start gap-2">
                    <Sparkles className="mt-0.5 h-4 w-4 text-indigo-500" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </ResultBlock>

            {(plan.available_actions?.length || plan.alternative_actions?.length) ? (
              <ResultBlock title="Available Actions" testId={testId("start-with-ai-available-actions")}>
                <div className="space-y-2">
                  {[...(plan.available_actions || []), ...(plan.alternative_actions || [])]
                    .slice(0, 6)
                    .map((item) => (
                      <div
                        key={`${item.key}-${item.label}`}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      >
                        <div className="font-semibold text-slate-900">{item.label}</div>
                        {item.confirmation_required ? (
                          <div className="mt-1 text-xs text-amber-700">Confirmation required</div>
                        ) : null}
                      </div>
                    ))}
                </div>
              </ResultBlock>
            ) : null}

            {plan.proposed_actions?.length ? (
              <ResultBlock
                title="Applyable Actions"
                testId={testId("start-with-ai-proposed-actions")}
              >
                <div className="space-y-2">
                  {plan.proposed_actions.slice(0, 6).map((item) => (
                    <div
                      key={`${item.action_type}-${item.action_label}`}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                    >
                      <div className="font-semibold text-slate-900">{item.action_label}</div>
                      <div className="mt-1">{item.action_description}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        {item.risk_level ? <CompactBadge>{item.risk_level}</CompactBadge> : null}
                        {item.confirmation_required ? (
                          <CompactBadge>confirmation required</CompactBadge>
                        ) : (
                          <CompactBadge>safe preview</CompactBadge>
                        )}
                      </div>
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
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-800"
              >
                <span>Show handoff payload</span>
                {showStructuredPayload ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
              {showStructuredPayload ? (
                <pre
                  className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-slate-950 p-3 text-xs text-slate-100"
                  data-testid={testId("start-with-ai-structured-json")}
                >
                  {JSON.stringify(
                    {
                      intent: plan.intent,
                      primary_intent: plan.primary_intent,
                      next_action: plan.next_action,
                      navigation_target: plan.navigation_target,
                      wizard_step_target: plan.wizard_step_target,
                      prefill_fields: plan.prefill_fields,
                      draft_payload: plan.draft_payload,
                      automation_plan: plan.automation_plan,
                      proactive_recommendations: plan.proactive_recommendations,
                      predictive_insights: plan.predictive_insights,
                      planning_confidence: plan.planning_confidence,
                      reasoning_source: plan.reasoning_source,
                      selected_routines: plan.selected_routines,
                      confirmation_required: plan.confirmation_required,
                    },
                    null,
                    2
                  )}
                </pre>
              ) : null}
            </ResultBlock>

            <ResultBlock title="Recent Requests">
              {history.length ? (
                <div className="space-y-2">
                  {history
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
              ) : (
                <div>No requests yet.</div>
              )}
            </ResultBlock>
          </div>
        </div>
      </div>
    </section>
  );
}
