import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  ClipboardList,
  Compass,
  FileSignature,
  ListChecks,
  UserPlus,
} from "lucide-react";

import PageShell from "../components/PageShell.jsx";
import { buildAssistantNavigationState } from "../components/StartWithAIAssistant.jsx";
import { produceStructuredAssistantPlan } from "../lib/assistantReasoning.js";

const WORKSPACE_CONTEXT = {
  current_route: "/app/assistant",
};

const WORKSPACE_ACTIONS = [
  {
    key: "start_agreement",
    title: "Create Agreement",
    description: "Start a new agreement draft and move directly into the wizard.",
    detail: "Best for a new customer job that is ready to turn into scoped work.",
    icon: FileSignature,
  },
  {
    key: "apply_template",
    title: "Use Template",
    description: "Open templates and start from a reusable project structure.",
    detail: "Best when the job is familiar and you want a faster starting point.",
    icon: ClipboardList,
  },
  {
    key: "suggest_milestones",
    title: "Build Milestones",
    description: "Jump into milestone planning and pricing setup for a new draft.",
    detail: "Best when you already know the project and want to structure the work.",
    icon: ListChecks,
  },
  {
    key: "create_lead",
    title: "Capture Lead",
    description: "Open the lead workflow and start a new intake path.",
    detail: "Best for turning a fresh inquiry into something the team can work.",
    icon: UserPlus,
  },
  {
    key: "navigate_app",
    title: "Find the Right Workflow",
    description: "Open the app area most likely to help you continue from here.",
    detail: "Best when you know you need something but not which page owns it.",
    icon: Compass,
  },
];

function WorkspaceActionCard({ action, busyKey, onSelect }) {
  const Icon = action.icon;
  const isBusy = busyKey === action.key;

  return (
    <button
      type="button"
      onClick={() => onSelect(action.key)}
      disabled={Boolean(busyKey)}
      className="group flex h-full flex-col rounded-[28px] border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_40px_rgba(15,23,42,0.08)] disabled:cursor-wait disabled:opacity-70"
      data-testid={`ai-workspace-action-${action.key}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
          <Icon className="h-5 w-5" />
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          {isBusy ? "Opening" : "Start"}
        </span>
      </div>
      <div className="mt-5 text-xl font-semibold tracking-tight text-slate-900">
        {action.title}
      </div>
      <div className="mt-2 text-sm leading-6 text-slate-700">{action.description}</div>
      <div className="mt-4 text-sm leading-6 text-slate-500">{action.detail}</div>
      <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
        {isBusy ? "Preparing next step..." : "Open with AI"}
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}

export default function AIAssistantPage() {
  const navigate = useNavigate();
  const [busyKey, setBusyKey] = useState("");

  const workspaceActions = useMemo(() => WORKSPACE_ACTIONS, []);

  async function handleWorkspaceAction(actionKey) {
    setBusyKey(actionKey);
    try {
      const plan = await produceStructuredAssistantPlan({
        preferredIntent: actionKey,
        context: WORKSPACE_CONTEXT,
      });
      navigate(plan.navigation_target, {
        state: buildAssistantNavigationState(plan, WORKSPACE_CONTEXT),
      });
    } finally {
      setBusyKey("");
    }
  }

  return (
    <PageShell
      title="AI Workspace"
      subtitle="Start new work with AI guidance, then move into the right workflow with the right setup."
      showLogo
    >
      <section className="space-y-6">
        <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                <Bot className="h-3.5 w-3.5" />
                AI Workspace
              </div>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
                Start something new without guessing where to begin.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-700 md:text-[15px]">
                Use this space to begin agreements, templates, milestone plans, and lead work.
                For quick help on the page you are already in, use <span className="font-semibold text-slate-900">Ask AI</span> from the sidebar.
              </p>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 lg:max-w-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Role Split
              </div>
              <div className="mt-3 space-y-3 text-sm text-slate-700">
                <div className="rounded-2xl border border-white bg-white px-4 py-3">
                  <div className="font-semibold text-slate-900">Ask AI</div>
                  <div className="mt-1">Contextual copilot for the page or step you are on now.</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-900 px-4 py-3 text-slate-100">
                  <div className="font-semibold text-white">AI Workspace</div>
                  <div className="mt-1">Starter hub for new work across agreements, templates, milestones, and leads.</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {workspaceActions.map((action) => (
            <WorkspaceActionCard
              key={action.key}
              action={action}
              busyKey={busyKey}
              onSelect={handleWorkspaceAction}
            />
          ))}
        </div>

        <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-5 py-4 text-sm text-slate-600">
          <span className="font-semibold text-slate-900">Why this page is different:</span> it starts work.
          The side panel stays lighter on purpose so it can help with the current step without duplicating this launcher.
        </div>
      </section>
    </PageShell>
  );
}
