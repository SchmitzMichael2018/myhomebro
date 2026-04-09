import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  ClipboardList,
  Compass,
  FileSignature,
  FolderOpen,
  LayoutTemplate,
  ListChecks,
  LoaderCircle,
  Sparkles,
} from "lucide-react";

import api from "../api.js";
import PageShell from "../components/PageShell.jsx";
import { useAssistantDock } from "../components/AssistantDock.jsx";
import { buildAssistantNavigationState } from "../components/StartWithAIAssistant.jsx";
import { produceStructuredAssistantPlan } from "../lib/assistantReasoning.js";
import { getDashboardNextSteps } from "../lib/workflowHints.js";

const WORKSPACE_CONTEXT = {
  current_route: "/app/assistant",
};

const QUICK_ACTIONS = [
  {
    key: "start_agreement",
    title: "Create Agreement",
    description: "Start a new agreement draft and move directly into the wizard.",
    icon: FileSignature,
  },
  {
    key: "apply_template",
    title: "Use Template",
    description: "Start from a reusable project template instead of building from scratch.",
    icon: ClipboardList,
  },
  {
    key: "suggest_milestones",
    title: "Plan Milestones",
    description: "Jump into structuring scope, pricing, and work phases for the job.",
    icon: ListChecks,
  },
  {
    key: "navigate_app",
    title: "Find My Next Task",
    description: "Open the workflow that best matches what needs attention right now.",
    icon: Compass,
  },
];

function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function formatRelativeUpdate(value) {
  if (!value) return "Recently updated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently updated";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function agreementTitle(agreement) {
  return (
    agreement?.title ||
    agreement?.project_title ||
    agreement?.project_summary ||
    `Agreement #${agreement?.id || ""}`.trim()
  );
}

function agreementSubtitle(agreement) {
  const customer =
    agreement?.customer_name ||
    agreement?.homeowner_name ||
    agreement?.homeowner?.full_name ||
    agreement?.customer?.full_name ||
    "";
  const status = String(agreement?.status || "draft")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
  return [customer, status].filter(Boolean).join(" · ");
}

function templateTitle(template) {
  return template?.name || template?.project_type || "Template";
}

function templateSubtitle(template) {
  return [
    template?.project_type || "",
    template?.project_subtype || "",
    template?.owner_type === "system" || template?.is_system ? "Built-in" : "Custom",
  ]
    .filter(Boolean)
    .join(" · ");
}

function buildSmartSuggestions({ leads, agreements, milestones }) {
  const items = [];
  const nextSteps = getDashboardNextSteps({ leads, agreements, milestones }).slice(0, 3);

  nextSteps.forEach((text, index) => {
    items.push({
      id: `next-step-${index}`,
      title: "Suggested next step",
      body: text,
      target: "/app/dashboard",
      actionLabel: "Open dashboard",
    });
  });

  const draftAgreement = agreements.find((agreement) => {
    const status = String(agreement?.status || "").toLowerCase();
    return ["draft", "pending_signature", "awaiting_signature"].includes(status);
  });
  if (draftAgreement) {
    items.push({
      id: `agreement-${draftAgreement.id}`,
      title: "Continue recent agreement",
      body: `${agreementTitle(draftAgreement)} still looks in progress.`,
      target: draftAgreement?.id
        ? `/app/agreements/${draftAgreement.id}/wizard?step=1`
        : "/app/agreements",
      actionLabel: "Continue draft",
    });
  }

  const awaitingReview = milestones.find((milestone) => {
    const status = String(
      milestone?.status || milestone?.milestone_status || milestone?.state || ""
    ).toLowerCase();
    return ["submitted", "pending_review", "review", "in_review"].includes(status);
  });
  if (awaitingReview) {
    items.push({
      id: `milestone-${awaitingReview.id || "review"}`,
      title: "Review submitted work",
      body: "A milestone is waiting on review before work can move forward.",
      target: "/app/reviewer/queue",
      actionLabel: "Open review queue",
    });
  }

  return items.slice(0, 4);
}

function QuickActionCard({ action, busyKey, onSelect }) {
  const Icon = action.icon;
  const isBusy = busyKey === action.key;

  return (
    <button
      type="button"
      onClick={() => onSelect(action.key)}
      disabled={Boolean(busyKey)}
      className="group flex h-full flex-col rounded-[26px] border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_36px_rgba(15,23,42,0.08)] disabled:cursor-wait disabled:opacity-70"
      data-testid={`ai-workspace-quick-action-${action.key}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
          <Icon className="h-5 w-5" />
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          {isBusy ? "Opening" : "Quick start"}
        </span>
      </div>
      <div className="mt-4 text-lg font-semibold text-slate-900">{action.title}</div>
      <div className="mt-2 text-sm leading-6 text-slate-600">{action.description}</div>
      <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
        {isBusy ? "Preparing..." : "Open flow"}
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}

function SuggestionCard({ item, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item.target)}
      className="rounded-[24px] border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-slate-300 hover:shadow-[0_16px_32px_rgba(15,23,42,0.07)]"
      data-testid={`ai-workspace-suggestion-${item.id}`}
    >
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {item.title}
      </div>
      <div className="mt-3 text-sm leading-6 text-slate-700">{item.body}</div>
      <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
        {item.actionLabel}
        <ArrowRight className="h-4 w-4" />
      </div>
    </button>
  );
}

function RecentWorkCard({ agreement, onOpen }) {
  return (
    <button
      type="button"
      onClick={() =>
        onOpen(
          agreement?.id ? `/app/agreements/${agreement.id}` : "/app/agreements"
        )
      }
      className="rounded-[24px] border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-slate-300 hover:shadow-[0_16px_32px_rgba(15,23,42,0.07)]"
      data-testid={`ai-workspace-recent-agreement-${agreement?.id || "unknown"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-50 text-slate-700">
          <BriefcaseBusiness className="h-4 w-4" />
        </div>
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          {formatRelativeUpdate(agreement?.updated_at || agreement?.modified_at || agreement?.created_at)}
        </div>
      </div>
      <div className="mt-4 text-lg font-semibold text-slate-900">{agreementTitle(agreement)}</div>
      <div className="mt-2 text-sm text-slate-600">{agreementSubtitle(agreement)}</div>
      <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
        Open agreement
        <ArrowRight className="h-4 w-4" />
      </div>
    </button>
  );
}

function TemplateCard({ template, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen("/app/templates")}
      className="rounded-[24px] border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-slate-300 hover:shadow-[0_16px_32px_rgba(15,23,42,0.07)]"
      data-testid={`ai-workspace-template-${template?.id || templateTitle(template)}`}
    >
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-50 text-slate-700">
        <LayoutTemplate className="h-4 w-4" />
      </div>
      <div className="mt-4 text-lg font-semibold text-slate-900">{templateTitle(template)}</div>
      <div className="mt-2 text-sm text-slate-600">{templateSubtitle(template)}</div>
      {template?.description ? (
        <div className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">
          {template.description}
        </div>
      ) : null}
      <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
        Explore templates
        <ArrowRight className="h-4 w-4" />
      </div>
    </button>
  );
}

export default function AIAssistantPage() {
  const navigate = useNavigate();
  const { openAssistant } = useAssistantDock();
  const [prompt, setPrompt] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [recentAgreements, setRecentAgreements] = useState([]);
  const [popularTemplates, setPopularTemplates] = useState([]);
  const [smartSuggestions, setSmartSuggestions] = useState([]);

  const quickActions = useMemo(() => QUICK_ACTIONS, []);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspace() {
      setLoadingWorkspace(true);
      try {
        const [agreementsRes, templatesRes, leadsRes, milestonesRes] = await Promise.all([
          api.get("/projects/agreements/"),
          api.get("/projects/templates/discover/", {
            params: { source: "system", sort: "relevant" },
          }),
          api.get("/projects/contractor/public-leads/"),
          api.get("/projects/milestones/"),
        ]);

        if (cancelled) return;

        const agreements = normalizeList(agreementsRes.data).slice(0, 4);
        const templates = normalizeList(templatesRes.data).slice(0, 3);
        const leads = normalizeList(leadsRes.data);
        const milestones = normalizeList(milestonesRes.data);

        setRecentAgreements(agreements);
        setPopularTemplates(templates);
        setSmartSuggestions(
          buildSmartSuggestions({
            leads,
            agreements,
            milestones,
          })
        );
      } catch {
        if (cancelled) return;
        setRecentAgreements([]);
        setPopularTemplates([]);
        setSmartSuggestions([]);
      } finally {
        if (!cancelled) setLoadingWorkspace(false);
      }
    }

    loadWorkspace();

    return () => {
      cancelled = true;
    };
  }, []);

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

  function handleHeroSubmit(event) {
    event.preventDefault();
    const cleanPrompt = String(prompt || "").trim();
    if (!cleanPrompt) return;
    routeWithAi("", cleanPrompt);
  }

  return (
    <PageShell
      title="AI Workspace"
      subtitle="Start new work, find the right workflow, and jump back into what already needs attention."
      showLogo
    >
      <div className="space-y-6 pb-4">
        <section className="overflow-hidden rounded-[34px] border border-slate-200 bg-[linear-gradient(135deg,#0f172a_0%,#18395f_55%,#1f5fa8_100%)] p-6 text-white shadow-[0_24px_60px_rgba(15,23,42,0.18)] md:p-8">
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)] xl:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-100">
                <Sparkles className="h-3.5 w-3.5" />
                Start With AI
              </div>
              <h2 className="mt-4 max-w-3xl text-3xl font-bold tracking-tight md:text-[2.75rem]">
                Describe the job or task and I’ll route you into the right workflow.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-sky-50/90 md:text-[15px]">
                Use AI Workspace to kick off agreements, templates, milestones, and navigation.
                For quick page-level help, keep using AI Copilot from the sidebar.
              </p>

              <form onSubmit={handleHeroSubmit} className="mt-6">
                <div className="rounded-[28px] border border-white/12 bg-white/10 p-3 backdrop-blur">
                  <div className="flex flex-col gap-3 lg:flex-row">
                    <input
                      type="text"
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder="Describe your job or task..."
                      className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white px-4 py-3 text-base text-slate-900 outline-none placeholder:text-slate-400"
                      data-testid="ai-workspace-hero-input"
                    />
                    <button
                      type="submit"
                      disabled={busyKey === "hero" || !String(prompt || "").trim()}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-wait disabled:opacity-70"
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
                  </div>
                </div>
              </form>
            </div>

            <div className="rounded-[28px] border border-white/12 bg-white/10 p-5 backdrop-blur">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-100">
                Workspace Role
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-white/12 bg-white/8 px-4 py-3">
                  <div className="font-semibold text-white">AI Workspace</div>
                  <div className="mt-1 text-sm text-sky-50/90">
                    Best for starting new work, jumping into setup, and navigating to the right flow.
                  </div>
                </div>
                <div className="rounded-2xl border border-white/12 bg-slate-950/35 px-4 py-3">
                  <div className="font-semibold text-white">AI Copilot</div>
                  <div className="mt-1 text-sm text-sky-50/90">
                    Best for contextual help on the page or step you are already in.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Quick Actions
              </div>
              <h3 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                Open the right starting point fast.
              </h3>
            </div>
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-4">
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

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <section className="rounded-[30px] border border-slate-200 bg-[#f8fafc] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Smart Suggestions
                </div>
                <h3 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                  What looks worth doing next.
                </h3>
              </div>
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm">
                <Bot className="h-5 w-5" />
              </div>
            </div>

            <div className="mt-4 grid gap-4">
              {loadingWorkspace ? (
                <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-5 text-sm text-slate-600">
                  Loading workspace suggestions...
                </div>
              ) : smartSuggestions.length ? (
                smartSuggestions.map((item) => (
                  <SuggestionCard
                    key={item.id}
                    item={item}
                    onOpen={(target) => navigate(target)}
                  />
                ))
              ) : (
                <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-5 text-sm text-slate-600">
                  No priority suggestions are surfaced right now. Use the quick actions above to start something new.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Recent Work
                </div>
                <h3 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                  Jump back into active projects.
                </h3>
              </div>
              <button
                type="button"
                onClick={() => navigate("/app/agreements")}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                <FolderOpen className="h-4 w-4" />
                All agreements
              </button>
            </div>

            <div className="mt-4 grid gap-4">
              {loadingWorkspace ? (
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                  Loading recent work...
                </div>
              ) : recentAgreements.length ? (
                recentAgreements.map((agreement) => (
                  <RecentWorkCard
                    key={agreement?.id || agreementTitle(agreement)}
                    agreement={agreement}
                    onOpen={(target) => navigate(target)}
                  />
                ))
              ) : (
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                  No recent agreements yet. Start with AI above to kick off the first one.
                </div>
              )}
            </div>
          </section>
        </div>

        <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Template Preview
              </div>
              <h3 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                Popular templates you can start from.
              </h3>
            </div>
            <button
              type="button"
              onClick={() => navigate("/app/templates")}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              View all templates
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            {loadingWorkspace ? (
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600 xl:col-span-3">
                Loading templates...
              </div>
            ) : popularTemplates.length ? (
              popularTemplates.map((template) => (
                <TemplateCard
                  key={template?.id || templateTitle(template)}
                  template={template}
                  onOpen={(target) => navigate(target)}
                />
              ))
            ) : (
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600 xl:col-span-3">
                No template previews are available right now. Open the Templates page to explore the full library.
              </div>
            )}
          </div>
        </section>

        <footer className="rounded-[28px] border border-slate-200 bg-[#f8fafc] px-5 py-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Need Help?
              </div>
              <div className="mt-2 text-lg font-semibold text-slate-900">
                Open AI Copilot for contextual help.
              </div>
              <div className="mt-1 text-sm text-slate-600">
                Use the side panel when you want help with the page or step you are already in.
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                openAssistant({
                  title: "Ask AI",
                  context: WORKSPACE_CONTEXT,
                })
              }
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              data-testid="ai-workspace-open-copilot"
            >
              Open AI Copilot
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </footer>
      </div>
    </PageShell>
  );
}
