import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ClipboardList,
  Compass,
  FileSignature,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  Sparkles,
  X,
} from "lucide-react";

import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import { useAssistantDock } from "../components/AssistantDock.jsx";
import { buildAssistantNavigationState } from "../components/StartWithAIAssistant.jsx";
import { produceStructuredAssistantPlan } from "../lib/assistantReasoning.js";

const WORKSPACE_CONTEXT = {
  current_route: "/app/assistant",
  page: "dashboard",
  workspace_mode: "dashboard",
};

const HERO_CHIPS = [
  { label: "Create an agreement", mode: "route", intent: "start_agreement" },
  { label: "Use a template", mode: "route", intent: "apply_template" },
  { label: "Create a template", mode: "route", intent: "template_guidance" },
  { label: "Continue a project", mode: "analyze", analyzeMode: "continue_project" },
  { label: "Plan milestones", mode: "route", intent: "suggest_milestones" },
  { label: "Find my next task", mode: "analyze", analyzeMode: "next_task" },
  { label: "Show work needing attention", mode: "analyze", analyzeMode: "next_task" },
];

const QUICK_ACTIONS = [
  {
    key: "start_agreement",
    title: "Create Agreement",
    description: "Start a new agreement draft and move into the wizard with AI-prefilled setup.",
    icon: FileSignature,
    mode: "route",
  },
  {
    key: "apply_template",
    title: "Use Template",
    description: "Begin from a reusable project template instead of building the structure by hand.",
    icon: ClipboardList,
    mode: "route",
  },
  {
    key: "suggest_milestones",
    title: "Plan Milestones",
    description: "Shape milestone phases, pricing, and scope before the draft moves forward.",
    icon: ListChecks,
    mode: "route",
  },
  {
    key: "navigate_app",
    title: "Find My Next Task",
    description: "Analyze your active work and surface the best next action across agreements, milestones, and leads.",
    icon: Compass,
    mode: "analyze",
    analyzeMode: "next_task",
  },
];

const CAPABILITY_ROWS = [
  "Launch agreement, template, milestone, and task workflows from one place",
  "Continue active projects without hunting through the sidebar",
  "Find work that needs attention and route to the right next step",
  "Use the global AI Copilot for help with the work you're currently doing",
];

async function fetchWorkspaceSignals() {
  const [agreementsRes, milestonesRes, leadsRes] = await Promise.allSettled([
    api.get("/projects/agreements/"),
    api.get("/projects/milestones/"),
    api.get("/projects/contractor/public-leads/"),
  ]);
  return {
    agreements: agreementsRes.status === "fulfilled"
      ? (agreementsRes.value?.data?.results ?? [])
      : [],
    milestones: milestonesRes.status === "fulfilled"
      ? (milestonesRes.value?.data?.results ?? [])
      : [],
    leads: leadsRes.status === "fulfilled"
      ? (leadsRes.value?.data?.results ?? [])
      : [],
  };
}

function analyzeNextTask({ agreements = [], milestones = [], leads = [] }) {
  const drafts = agreements.filter((a) => a.status === "draft");
  if (drafts.length > 0) {
    const first = drafts[0];
    const label = first.title || "Agreement Draft";
    const customer = first.customer_name ? ` · ${first.customer_name}` : "";
    return {
      title: drafts.length === 1 ? "Complete your agreement draft" : `Complete ${drafts.length} agreement drafts`,
      reason:
        drafts.length === 1
          ? `"${label}"${customer} is still in draft. Completing it unblocks customer signature, funding, and active work.`
          : `You have ${drafts.length} draft agreements waiting. Finishing them unblocks signatures, funding, and active work.`,
      context: drafts.length === 1 ? `${label}${customer}` : `${drafts.length} draft agreements`,
      primaryLabel: drafts.length === 1 ? "Open Agreement" : "Open Agreements",
      primaryRoute: drafts.length === 1 ? `/app/agreements/${first.id}` : "/app/agreements",
      secondaryLabel: "Open Copilot",
    };
  }

  const submitted = milestones.filter((m) => m.status === "submitted");
  if (submitted.length > 0) {
    return {
      title: submitted.length === 1 ? "Review a submitted milestone" : `Review ${submitted.length} submitted milestones`,
      reason: `${submitted.length} milestone${submitted.length > 1 ? "s are" : " is"} awaiting review. Approving them keeps active projects on schedule and unblocks payments.`,
      context: null,
      primaryLabel: "Open Milestones",
      primaryRoute: "/app/milestones",
      secondaryLabel: "Open Copilot",
    };
  }

  const pendingLeads = leads.filter((l) => l.status === "ready_for_review" || l.status === "new");
  if (pendingLeads.length > 0) {
    return {
      title: pendingLeads.length === 1 ? "Review a pending lead" : `Review ${pendingLeads.length} pending leads`,
      reason: `You have ${pendingLeads.length} lead${pendingLeads.length > 1 ? "s" : ""} ready for review. Following up quickly improves conversion.`,
      context: null,
      primaryLabel: "Open Leads",
      primaryRoute: "/app/public-presence",
      secondaryLabel: "Open Copilot",
    };
  }

  const active = agreements.filter((a) => ["signed", "active", "in_progress"].includes(a.status));
  if (active.length > 0) {
    const first = active[0];
    return {
      title: "Continue an active project",
      reason: `"${first.title || "Agreement"}" is signed and ready for active work. Check milestone status, funding, and next steps.`,
      context: first.title || null,
      primaryLabel: "Open Agreement",
      primaryRoute: `/app/agreements/${first.id}`,
      secondaryLabel: "Open Copilot",
    };
  }

  return {
    title: "Your queue looks clear",
    reason: "No urgent tasks found. Start a new agreement, build a template, or plan milestones for upcoming projects.",
    context: null,
    primaryLabel: "Create Agreement",
    primaryRoute: "/app/agreements/new/wizard?step=1",
    secondaryLabel: "Use Template",
    secondaryRoute: "/app/templates",
  };
}

function analyzeContinueProject({ agreements = [] }) {
  const inProgress = agreements.filter((a) =>
    ["signed", "active", "in_progress", "draft"].includes(a.status)
  );
  if (inProgress.length === 0) {
    return {
      title: "No active projects found",
      reason: "You don't have any in-progress or draft agreements yet. Start a new agreement to begin a project.",
      context: null,
      primaryLabel: "Create Agreement",
      primaryRoute: "/app/agreements/new/wizard?step=1",
      secondaryLabel: "Use Template",
      secondaryRoute: "/app/templates",
    };
  }
  const first = inProgress[0];
  const isDraft = first.status === "draft";
  return {
    title: isDraft ? "Complete your draft agreement" : "Continue your active project",
    reason: isDraft
      ? `"${first.title || "Agreement"}" is a draft ready to complete. Finishing it will unlock signatures and active work.`
      : `"${first.title || "Agreement"}" is your most recent active project. Open it to check milestones, funding, and next steps.`,
    context: first.title ? `${first.title}${first.customer_name ? ` · ${first.customer_name}` : ""}` : null,
    primaryLabel: isDraft ? "Open Draft" : "Open Agreement",
    primaryRoute: `/app/agreements/${first.id}`,
    secondaryLabel: "Open Copilot",
  };
}

function WorkspaceResultPanel({ result, onDismiss, onOpenCopilot, onNavigate }) {
  if (!result) return null;
  return (
    <div
      data-testid="ai-workspace-result-panel"
      className="rounded-[28px] border border-indigo-200 bg-indigo-50 p-6 shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-300/50 bg-indigo-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-700">
          <Sparkles className="h-3.5 w-3.5" />
          Recommended Next Action
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg border border-indigo-200 p-1.5 text-indigo-500 hover:bg-indigo-100"
          aria-label="Dismiss recommendation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <h3
        data-testid="ai-workspace-result-title"
        className="mt-4 text-xl font-bold tracking-tight text-indigo-950"
      >
        {result.title}
      </h3>

      <p
        data-testid="ai-workspace-result-reason"
        className="mt-2 text-sm leading-6 text-indigo-800"
      >
        {result.reason}
      </p>

      {result.context ? (
        <div className="mt-2 rounded-xl border border-indigo-200 bg-white/70 px-3 py-1.5 text-xs font-semibold text-indigo-700 inline-block">
          {result.context}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          data-testid="ai-workspace-result-primary-cta"
          onClick={() => onNavigate(result.primaryRoute)}
          className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          {result.primaryLabel}
          <ArrowRight className="h-4 w-4" />
        </button>

        {result.secondaryRoute ? (
          <button
            type="button"
            data-testid="ai-workspace-result-secondary-cta"
            onClick={() => onNavigate(result.secondaryRoute)}
            className="inline-flex items-center gap-2 rounded-2xl border border-indigo-300 bg-white px-5 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
          >
            {result.secondaryLabel}
          </button>
        ) : result.secondaryLabel ? (
          <button
            type="button"
            data-testid="ai-workspace-result-secondary-cta"
            onClick={onOpenCopilot}
            className="inline-flex items-center gap-2 rounded-2xl border border-indigo-300 bg-white px-5 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
          >
            {result.secondaryLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function QuickActionCard({ action, busyKey, onSelect }) {
  const Icon = action.icon;
  const isBusy = busyKey === action.key;

  return (
    <button
      type="button"
      onClick={() => onSelect(action)}
      disabled={Boolean(busyKey)}
      className="group flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-md disabled:cursor-wait disabled:opacity-70"
      data-testid={`ai-workspace-quick-action-${action.key}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
          <Icon className="h-5 w-5" />
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          {isBusy ? "Analyzing" : action.mode === "analyze" ? "Analyze" : "Launch"}
        </span>
      </div>
      <div className="mt-5 text-lg font-semibold text-slate-900">{action.title}</div>
      <div className="mt-2 text-sm leading-6 text-slate-600">{action.description}</div>
      <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#18395f]">
        {isBusy ? (action.mode === "analyze" ? "Analyzing..." : "Preparing...") : (action.mode === "analyze" ? "Find best next step" : "Open flow")}
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}

export default function AIAssistantPage() {
  const navigate = useNavigate();
  const { openAssistant } = useAssistantDock();
  const [prompt, setPrompt] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [result, setResult] = useState(null);

  const quickActions = useMemo(() => QUICK_ACTIONS, []);

  async function routeWithAi(preferredIntent = "", input = "") {
    const busyValue = preferredIntent || "hero";
    setBusyKey(busyValue);
    setResult(null);
    try {
      const plan = await produceStructuredAssistantPlan({
        preferredIntent,
        input,
        context: WORKSPACE_CONTEXT,
      });
      navigate(plan.navigation_target, {
        state: buildAssistantNavigationState(plan, WORKSPACE_CONTEXT),
      });
    } finally {
      setBusyKey("");
    }
  }

  async function runWorkspaceAnalysis(analyzeMode) {
    setBusyKey(analyzeMode);
    setResult(null);
    try {
      const signals = await fetchWorkspaceSignals();
      const rec =
        analyzeMode === "continue_project"
          ? analyzeContinueProject(signals)
          : analyzeNextTask(signals);
      setResult(rec);
    } catch {
      setResult({
        title: "Unable to load workspace data",
        reason: "We couldn't fetch your current work. Check your connection and try again.",
        context: null,
        primaryLabel: "Open Dashboard",
        primaryRoute: "/app/dashboard",
        secondaryLabel: "Open Copilot",
      });
    } finally {
      setBusyKey("");
    }
  }

  function openCopilot() {
    openAssistant({ context: WORKSPACE_CONTEXT });
  }

  function handleResultNavigate(route) {
    if (route) navigate(route);
  }

  function handleHeroSubmit(event) {
    event.preventDefault();
    const cleanPrompt = String(prompt || "").trim();
    if (!cleanPrompt) return;
    setResult(null);
    routeWithAi("", cleanPrompt);
  }

  function handleChipAction(chip) {
    if (chip.mode === "analyze") {
      runWorkspaceAnalysis(chip.analyzeMode);
    } else {
      setPrompt(chip.label);
    }
  }

  function handleQuickActionSelect(action) {
    if (action.mode === "analyze") {
      runWorkspaceAnalysis(action.analyzeMode);
    } else {
      routeWithAi(action.key);
    }
  }

  return (
    <ContractorPageSurface
      eyebrow="AI Workspace"
      title="AI Workspace"
      subtitle="Launch and organize work."
      variant="operational"
      className="mhb-ai-workspace"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.95fr)]">
          <div
            className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm md:p-8"
            data-testid="ai-workspace-hero"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#52749a]">
              AI Workspace
            </div>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#18395f] md:text-[2.6rem]">
              Start or continue work
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 md:text-[15px]">
              Launch work, continue active projects, organize next steps, and route into the right
              MyHomeBro workflow with the right setup already in motion.
            </p>

            {result ? (
              <div className="mt-6">
                <WorkspaceResultPanel
                  result={result}
                  onDismiss={() => setResult(null)}
                  onOpenCopilot={openCopilot}
                  onNavigate={handleResultNavigate}
                />
              </div>
            ) : null}

            <form onSubmit={handleHeroSubmit} className="mt-6">
              <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-3">
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Describe what you'd like to do. Create agreements, use templates, continue projects, plan milestones, or find work that needs attention."
                  rows={5}
                  className="min-h-[148px] w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-4 text-base text-slate-900 outline-none placeholder:text-slate-400"
                  data-testid="ai-workspace-hero-input"
                />
                <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-wrap gap-2">
                    {HERO_CHIPS.map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => handleChipAction(chip)}
                        disabled={Boolean(busyKey)}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="submit"
                      disabled={busyKey === "hero" || !String(prompt || "").trim()}
                      className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-70"
                      data-testid="ai-workspace-hero-submit"
                    >
                      {busyKey === "hero" ? (
                        <>
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                          Starting...
                        </>
                      ) : (
                        <>
                          Start with AI
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={openCopilot}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Open AI Copilot
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div
            className="rounded-[32px] border border-slate-900/10 bg-[linear-gradient(160deg,#0f172a_0%,#163B70_60%,#1f5fa8_100%)] p-6 text-white shadow-sm md:p-8"
            data-testid="ai-workspace-summary"
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-100">
              <Sparkles className="h-3.5 w-3.5" />
              What This Does
            </div>
            <h3 className="mt-4 text-2xl font-bold tracking-tight">
              AI Workspace launches workflows and organizes the work already in motion.
            </h3>
            <p className="mt-3 text-sm leading-6 text-sky-50/90">
              Start or continue work here. Use the global AI Copilot when you want help with the
              page, form, agreement, template, invoice, or task you're currently working on.
            </p>
            <div className="mt-6 space-y-3">
              {CAPABILITY_ROWS.map((row) => (
                <div
                  key={row}
                  className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/10 px-4 py-3"
                >
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-sky-200" />
                  <div className="text-sm leading-6 text-sky-50">{row}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section data-testid="ai-workspace-quick-actions">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Quick Actions
            </div>
            <h3 className="mt-2 text-2xl font-bold tracking-tight text-[#18395f]">
              Launch the right workflow without hunting for it.
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Start from the most common AI-assisted paths for agreements, templates, milestones,
              and task routing.
            </p>
          </div>
          <div className="mt-5 grid gap-4 xl:grid-cols-4">
            {quickActions.map((action) => (
              <QuickActionCard
                key={action.key}
                action={action}
                busyKey={busyKey}
                onSelect={handleQuickActionSelect}
              />
            ))}
          </div>
        </section>

        <section
          className="rounded-3xl border border-slate-200 bg-[#f8fafc] px-6 py-5 shadow-sm"
          data-testid="ai-workspace-footer"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-lg font-semibold text-slate-900">Need help with current work?</div>
              <div className="mt-1 text-sm leading-6 text-slate-600">
                AI Workspace is for starting, routing, and organizing work with AI. AI Copilot is
                for help on the page, form, agreement, template, invoice, or task you're currently
                working on.
              </div>
            </div>
            <button
              type="button"
              onClick={openCopilot}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              data-testid="ai-workspace-open-copilot"
            >
              <MessageSquareText className="h-4 w-4" />
              Open AI Copilot
            </button>
          </div>
        </section>
      </div>
    </ContractorPageSurface>
  );
}
