import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ClipboardList,
  Compass,
  FileSignature,
  ListChecks,
  LoaderCircle,
  Sparkles,
  X,
} from "lucide-react";

import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import { useAssistantDock } from "../components/AssistantDock.jsx";
import { buildAssistantNavigationState } from "../components/StartWithAIAssistant.jsx";
import { produceStructuredAssistantPlan } from "../lib/assistantReasoning.js";
import WorkspaceConversation from "../components/WorkspaceConversation.jsx";

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
    return {
      title: "Review and send draft agreements",
      reason: `You have ${drafts.length} draft agreement${drafts.length === 1 ? "" : "s"} waiting. Completing ${drafts.length === 1 ? "it" : "them"} can unlock signatures, funding, and active work.`,
      context: `${drafts.length} draft agreement${drafts.length === 1 ? "" : "s"}`,
      primaryLabel: "Open Agreements",
      primaryRoute: "/app/agreements",
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
      className="overflow-hidden rounded-[28px] border border-sky-200/20 bg-[linear-gradient(145deg,#020b1f_0%,#0e2d5b_54%,#155ea8_100%)] p-6 text-white shadow-[0_24px_70px_rgba(2,11,31,0.28)]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-sky-100/25 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-100">
          <Sparkles className="h-3.5 w-3.5" />
          Recommended Next Action
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg border border-white/15 p-1.5 text-sky-100 hover:bg-white/10"
          aria-label="Dismiss recommendation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <h3
        data-testid="ai-workspace-result-title"
        className="mt-4 text-xl font-bold tracking-tight text-white"
      >
        {result.title}
      </h3>

      <p
        data-testid="ai-workspace-result-reason"
        className="mt-2 text-sm leading-6 text-sky-50/90"
      >
        {result.reason}
      </p>

      {result.context ? (
        <div className="mt-3 inline-block rounded-xl border border-sky-100/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-sky-50">
          {result.context}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          data-testid="ai-workspace-result-primary-cta"
          onClick={() => onNavigate(result.primaryRoute)}
          className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-2.5 text-sm font-semibold text-[#12345c] shadow-sm hover:bg-sky-50"
        >
          {result.primaryLabel}
          <ArrowRight className="h-4 w-4" />
        </button>

        {result.secondaryRoute ? (
          <button
            type="button"
            data-testid="ai-workspace-result-secondary-cta"
            onClick={() => onNavigate(result.secondaryRoute)}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/20"
          >
            {result.secondaryLabel}
          </button>
        ) : result.secondaryLabel ? (
          <button
            type="button"
            data-testid="ai-workspace-result-secondary-cta"
            onClick={onOpenCopilot}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/20"
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

  const [contractorProfile, setContractorProfile] = useState(null);

  useEffect(() => {
    api.get("/projects/contractors/me/")
      .then((res) => setContractorProfile(res.data || {}))
      .catch(() => setContractorProfile({}));
  }, []);

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
          {/* WorkspaceConversation replaces the old textarea hero */}
          <div data-testid="ai-workspace-hero">
            <WorkspaceConversation contractorProfile={contractorProfile} />
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

      </div>
    </ContractorPageSurface>
  );
}
