import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ClipboardList,
  Compass,
  FileSignature,
  ListChecks,
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

const QUICK_ACTIONS = [
  {
    key: "start_agreement",
    title: "Create Agreement",
    description: "Open Agreement Wizard Step 1, where project drafting and AI setup live.",
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
    description: "Open the milestone planning workflow for agreement phase, price, and timing review.",
    icon: ListChecks,
    mode: "route",
  },
  {
    key: "continue_project",
    title: "Continue Existing Project",
    description: "Find a recent draft or active project and jump back into the right workflow.",
    icon: ArrowRight,
    mode: "analyze",
    analyzeMode: "continue_project",
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
  "Use Project Assistant on each page to complete the current task step by step",
];

const OWNERSHIP_CARDS = [
  {
    title: "Workspace launches work",
    body: "Start, resume, and organize the right workflow from one command center.",
  },
  {
    title: "Agreement Wizard drafts projects",
    body: "Use the wizard when you need AI-generated project details, scopes, templates, and milestones.",
  },
  {
    title: "Project Assistant guides pages",
    body: "Open the page-local guide when you want step actions for the work already in front of you.",
  },
];

function listFromResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

async function fetchWorkspaceSignals() {
  const [agreementsRes, milestonesRes, leadsRes] = await Promise.allSettled([
    api.get("/projects/agreements/"),
    api.get("/projects/milestones/"),
    api.get("/projects/contractor/public-leads/"),
  ]);
  return {
    agreements: agreementsRes.status === "fulfilled"
      ? listFromResponse(agreementsRes.value?.data)
      : [],
    milestones: milestonesRes.status === "fulfilled"
      ? listFromResponse(milestonesRes.value?.data)
      : [],
    leads: leadsRes.status === "fulfilled"
      ? listFromResponse(leadsRes.value?.data)
      : [],
  };
}

async function fetchRecentWork() {
  const [agreementsRes, templatesRes] = await Promise.allSettled([
    api.get("/projects/agreements/", { params: { page_size: 8 } }),
    api.get("/projects/templates/discover/", { params: { page_size: 6 } }),
  ]);
  const agreements =
    agreementsRes.status === "fulfilled" ? listFromResponse(agreementsRes.value?.data) : [];
  const templates =
    templatesRes.status === "fulfilled" ? listFromResponse(templatesRes.value?.data) : [];

  const agreementItems = agreements
    .filter((item) =>
      ["draft", "sent", "signed", "active", "in_progress"].includes(String(item?.status || "").toLowerCase())
    )
    .slice(0, 5)
    .map((item) => ({
      key: `agreement-${item.id}`,
      title: item.project_title || item.title || item.name || "Agreement",
      eyebrow: String(item.status || "agreement").replaceAll("_", " "),
      meta: [item.customer_name, item.homeowner_name, item.updated_at ? "Recently updated" : ""]
        .filter(Boolean)
        .join(" · "),
      route: `/app/agreements/${item.id}`,
      actionLabel: String(item.status || "").toLowerCase() === "draft" ? "Continue" : "Open",
    }));

  const templateItems = templates.slice(0, Math.max(0, 5 - agreementItems.length)).map((item) => ({
    key: `template-${item.id}`,
    title: item.name || "Template",
    eyebrow: "template",
    meta: [item.project_type, item.project_subtype].filter(Boolean).join(" · "),
    route: "/app/templates",
    actionLabel: "Open",
  }));

  return [...agreementItems, ...templateItems].slice(0, 5);
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
      secondaryLabel: "Open Assistant",
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
      secondaryLabel: "Open Assistant",
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
      secondaryLabel: "Open Assistant",
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
      secondaryLabel: "Open Assistant",
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
    secondaryLabel: "Open Assistant",
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

function WorkflowLauncherHero() {
  return (
    <div
      data-testid="ai-workspace-hero"
      className="rounded-[32px] border border-slate-900/10 bg-white p-6 shadow-sm md:p-8"
    >
      <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-800">
        <Sparkles className="h-3.5 w-3.5" />
        Command Center
      </div>
      <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#18395f]">
        Launch Work. Continue Work. Find Work.
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
        AI Workspace routes you to the right workflow and surfaces active work. Agreement Wizard
        owns project drafting; Project Assistant helps you finish the page you are already on.
      </p>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {OWNERSHIP_CARDS.map((card) => (
          <div
            key={card.title}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
          >
            <div className="text-sm font-semibold text-slate-950">{card.title}</div>
            <div className="mt-1 text-xs leading-5 text-slate-600">{card.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentWorkSection({ items, loading, onNavigate, onFindNext }) {
  return (
    <section data-testid="ai-workspace-recent-work">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Continue Work
          </div>
          <h3 className="mt-2 text-2xl font-bold tracking-tight text-[#18395f]">
            Recent work
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Jump back into recent drafts, active agreements, or templates without starting over.
          </p>
        </div>
        <button
          type="button"
          onClick={onFindNext}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-900"
          data-testid="ai-workspace-find-next-secondary"
        >
          Find My Next Task
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            Loading recent work...
          </div>
        ) : items.length ? (
          items.map((item) => (
            <div
              key={item.key}
              data-testid={`ai-workspace-recent-work-${item.key}`}
              className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {item.eyebrow}
              </div>
              <div className="mt-2 text-base font-semibold text-slate-950">{item.title}</div>
              {item.meta ? <div className="mt-1 text-sm text-slate-600">{item.meta}</div> : null}
              <button
                type="button"
                onClick={() => onNavigate(item.route)}
                className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                {item.actionLabel}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          ))
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-6 text-slate-600">
            No recent work found yet. Create an agreement, open a template, or use Find My Next
            Task to choose a starting point.
          </div>
        )}
      </div>
    </section>
  );
}

export default function AIAssistantPage() {
  const navigate = useNavigate();
  const { openAssistant } = useAssistantDock();
  const [busyKey, setBusyKey] = useState("");
  const [result, setResult] = useState(null);
  const [recentWork, setRecentWork] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setRecentLoading(true);
    fetchRecentWork()
      .then((items) => {
        if (!cancelled) setRecentWork(items);
      })
      .catch(() => {
        if (!cancelled) setRecentWork([]);
      })
      .finally(() => {
        if (!cancelled) setRecentLoading(false);
      });
    return () => {
      cancelled = true;
    };
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
        secondaryLabel: "Open Assistant",
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
      subtitle="Launch, continue, and organize work."
      variant="operational"
      className="mhb-ai-workspace"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.95fr)]">
          <WorkflowLauncherHero />

          <div
            className="rounded-[32px] border border-slate-900/10 bg-[linear-gradient(160deg,#0f172a_0%,#163B70_60%,#1f5fa8_100%)] p-6 text-white shadow-sm md:p-8"
            data-testid="ai-workspace-summary"
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-100">
            <Sparkles className="h-3.5 w-3.5" />
              How To Use It
            </div>
            <h3 className="mt-4 text-2xl font-bold tracking-tight">
              A launcher, not a second drafting flow.
            </h3>
            <p className="mt-3 text-sm leading-6 text-sky-50/90">
              Start here when you know the kind of work you want to do. The actual drafting,
              template application, milestone planning, and page-specific help happen inside the
              dedicated workflows.
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

        <WorkspaceResultPanel
          result={result}
          onDismiss={() => setResult(null)}
          onOpenCopilot={openCopilot}
          onNavigate={handleResultNavigate}
        />

        <section data-testid="ai-workspace-quick-actions">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Launch Work
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

        <RecentWorkSection
          items={recentWork}
          loading={recentLoading}
          onNavigate={handleResultNavigate}
          onFindNext={() => runWorkspaceAnalysis("next_task")}
        />
      </div>
    </ContractorPageSurface>
  );
}
