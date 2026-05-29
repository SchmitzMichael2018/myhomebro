import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Compass,
  FileSignature,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  Sparkles,
} from "lucide-react";

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
  "Create an agreement",
  "Use a template",
  "Create a template",
  "Continue a project",
  "Plan milestones",
  "Find my next task",
  "Show work needing attention",
];

const QUICK_ACTIONS = [
  {
    key: "start_agreement",
    title: "Create Agreement",
    description: "Start a new agreement draft and move into the wizard with AI-prefilled setup.",
    icon: FileSignature,
  },
  {
    key: "apply_template",
    title: "Use Template",
    description: "Begin from a reusable project template instead of building the structure by hand.",
    icon: ClipboardList,
  },
  {
    key: "suggest_milestones",
    title: "Plan Milestones",
    description: "Shape milestone phases, pricing, and scope before the draft moves forward.",
    icon: ListChecks,
  },
  {
    key: "navigate_app",
    title: "Find My Next Task",
    description: "Open the workflow that best matches what already needs attention.",
    icon: Compass,
  },
];

const CAPABILITY_ROWS = [
  "Launch agreement, template, milestone, and task workflows from one place",
  "Continue active projects without hunting through the sidebar",
  "Find work that needs attention and route to the right next step",
  "Use the global AI Copilot for help with the work you're currently doing",
];

const AI_CAPABILITY_GROUPS = [
  {
    title: "Create",
    items: [
      "Create an agreement draft from a project description",
      "Create a reusable template",
      "Generate a milestone plan",
    ],
  },
  {
    title: "Review",
    items: [
      "Review agreement scope for missing details",
      "Check milestones for gaps",
      "Identify unclear responsibilities or exclusions",
    ],
  },
  {
    title: "Improve",
    items: [
      "Improve descriptions",
      "Refine milestone language",
      "Suggest exclusions, assumptions, and owner responsibilities",
    ],
  },
  {
    title: "Analyze",
    items: [
      "Find work needing attention",
      "Summarize project status",
      "Identify signature, funding, or payment bottlenecks",
    ],
  },
  {
    title: "Organize",
    items: [
      "Prioritize next actions",
      "Route to the right workflow",
      "Help continue active work",
    ],
  },
];

function QuickActionCard({ action, busyKey, onSelect }) {
  const Icon = action.icon;
  const isBusy = busyKey === action.key;

  return (
    <button
      type="button"
      onClick={() => onSelect(action.key)}
      disabled={Boolean(busyKey)}
      className="group flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-md disabled:cursor-wait disabled:opacity-70"
      data-testid={`ai-workspace-quick-action-${action.key}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
          <Icon className="h-5 w-5" />
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          {isBusy ? "Opening" : "Launch"}
        </span>
      </div>
      <div className="mt-5 text-lg font-semibold text-slate-900">{action.title}</div>
      <div className="mt-2 text-sm leading-6 text-slate-600">{action.description}</div>
      <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#18395f]">
        {isBusy ? "Preparing..." : "Open flow"}
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}

function AiCapabilityCard({ group }) {
  return (
    <div
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      data-testid={`ai-workspace-capability-${group.title.toLowerCase()}`}
    >
      <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
        {group.title}
      </div>
      <ul className="mt-5 space-y-3">
        {group.items.map((item) => (
          <li key={item} className="flex gap-3 text-sm leading-6 text-slate-700">
            <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-[#18395f]" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AIAssistantPage() {
  const navigate = useNavigate();
  const { openAssistant } = useAssistantDock();
  const [prompt, setPrompt] = useState("");
  const [busyKey, setBusyKey] = useState("");

  const quickActions = useMemo(() => QUICK_ACTIONS, []);

  async function routeWithAi(preferredIntent = "", input = "") {
    const busyValue = preferredIntent || "hero";
    setBusyKey(busyValue);
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

  function openCopilot() {
    openAssistant({
      context: WORKSPACE_CONTEXT,
    });
  }

  function handleHeroSubmit(event) {
    event.preventDefault();
    const cleanPrompt = String(prompt || "").trim();
    if (!cleanPrompt) return;
    routeWithAi("", cleanPrompt);
  }

  function handleChipClick(value) {
    setPrompt(value);
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
                        key={chip}
                        type="button"
                        onClick={() => handleChipClick(chip)}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                      >
                        {chip}
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
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sky-200" />
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
                onSelect={(actionKey) => routeWithAi(actionKey)}
              />
            ))}
          </div>
        </section>

        <section data-testid="ai-workspace-capabilities">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              AI Capabilities
            </div>
            <h3 className="mt-2 text-2xl font-bold tracking-tight text-[#18395f]">
              What AI can help with
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Use AI Workspace for higher-level creation, review, improvement, analysis, and
              organization. Use Dashboard, Agreements, and Templates for normal browsing and record
              management.
            </p>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-5">
            {AI_CAPABILITY_GROUPS.map((group) => (
              <AiCapabilityCard key={group.title} group={group} />
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
