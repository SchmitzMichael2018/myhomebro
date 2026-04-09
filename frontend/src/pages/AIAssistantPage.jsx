import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardList,
  Compass,
  FileSignature,
  LayoutTemplate,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
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

const HERO_CHIPS = [
  "Kitchen remodel",
  "Roof replacement",
  "Use a template",
  "What needs attention?",
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
  "Turn a plain-language job description into the right workflow",
  "Jump into agreements, templates, milestones, and next-step routing",
  "Bring recent work back into focus without hunting through the sidebar",
  "Keep AI Copilot reserved for contextual help on the page you're in",
];

function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function toTitleCase(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function agreementTitle(agreement) {
  return (
    agreement?.title ||
    agreement?.project_title ||
    agreement?.project_summary ||
    `Agreement #${agreement?.id || ""}`.trim()
  );
}

function agreementCustomer(agreement) {
  return (
    agreement?.customer_name ||
    agreement?.homeowner_name ||
    agreement?.homeowner?.full_name ||
    agreement?.customer?.full_name ||
    "Customer not set"
  );
}

function agreementStatus(agreement) {
  return toTitleCase(agreement?.status || "draft") || "Draft";
}

function agreementCurrentStep(agreement) {
  const status = String(agreement?.status || "").toLowerCase();
  if (["draft", "pending_signature", "awaiting_signature"].includes(status)) {
    return "Agreement setup";
  }
  if (status === "signed" || agreement?.is_fully_signed) {
    return "Signed and active";
  }
  if (agreement?.escrow_funded === false) {
    return "Waiting for funding";
  }
  return "Review details";
}

function templateTitle(template) {
  return template?.name || template?.project_type || "Template";
}

function templateType(template) {
  return template?.project_type || "General";
}

function templateSubtype(template) {
  return template?.project_subtype || "Not specified";
}

function templateMilestoneCount(template) {
  if (Array.isArray(template?.milestones)) return template.milestones.length;
  const count = Number(template?.milestone_count || template?.milestones_count || 0);
  return Number.isFinite(count) ? count : 0;
}

function templateSummary(template) {
  return (
    template?.description ||
    template?.default_scope ||
    "Reusable project structure with milestone guidance and setup details."
  );
}

function buildSmartSuggestions({ leads, agreements, milestones }) {
  const items = [];
  const nextSteps = getDashboardNextSteps({ leads, agreements, milestones }).slice(0, 2);

  nextSteps.forEach((text, index) => {
    items.push({
      id: `dashboard-${index}`,
      eyebrow: "Suggested For You",
      title: index === 0 ? "Open your priority queue" : "Review what needs attention",
      description: text,
      priority: index === 0 ? "High" : "Medium",
      primaryLabel: "Open dashboard",
      primaryTarget: "/app/dashboard",
      secondaryLabel: "Ask AI",
      secondaryAction: "copilot",
    });
  });

  const draftAgreement = agreements.find((agreement) => {
    const status = String(agreement?.status || "").toLowerCase();
    return ["draft", "pending_signature", "awaiting_signature"].includes(status);
  });
  if (draftAgreement) {
    items.push({
      id: `agreement-${draftAgreement.id}`,
      eyebrow: "Continue Project",
      title: agreementTitle(draftAgreement),
      description: `${agreementCustomer(draftAgreement)} · ${agreementStatus(draftAgreement)}`,
      priority: "High",
      primaryLabel: "Continue draft",
      primaryTarget: draftAgreement?.id
        ? `/app/agreements/${draftAgreement.id}/wizard?step=1`
        : "/app/agreements",
      secondaryLabel: "Open agreement",
      secondaryTarget: draftAgreement?.id
        ? `/app/agreements/${draftAgreement.id}`
        : "/app/agreements",
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
      id: `review-${awaitingReview.id || "queue"}`,
      eyebrow: "Review Work",
      title: "Submitted work is waiting",
      description: "A milestone is ready for review before the next step can move forward.",
      priority: "Medium",
      primaryLabel: "Open review queue",
      primaryTarget: "/app/reviewer/queue",
      secondaryLabel: "Ask AI",
      secondaryAction: "copilot",
    });
  }

  return items.slice(0, 4);
}

function priorityClasses(priority) {
  if (priority === "High") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (priority === "Medium") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

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

function SuggestionCard({ item, onPrimary, onSecondary }) {
  return (
    <div
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      data-testid={`ai-workspace-suggestion-${item.id}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {item.eyebrow}
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${priorityClasses(item.priority)}`}
        >
          {item.priority} Priority
        </span>
      </div>
      <div className="mt-4 text-xl font-semibold tracking-tight text-slate-900">{item.title}</div>
      <div className="mt-2 text-sm leading-6 text-slate-600">{item.description}</div>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onPrimary}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
        >
          {item.primaryLabel}
          <ArrowRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onSecondary}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          {item.secondaryLabel}
        </button>
      </div>
    </div>
  );
}

function TemplatePreviewCard({ template, onOpenTemplates }) {
  return (
    <div
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      data-testid={`ai-workspace-template-${template?.id || templateTitle(template)}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-50 text-slate-700">
          <LayoutTemplate className="h-5 w-5" />
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
          {templateMilestoneCount(template)} milestones
        </span>
      </div>
      <div className="mt-5 text-lg font-semibold text-slate-900">{templateTitle(template)}</div>
      <div className="mt-2 text-sm text-slate-600">
        {templateType(template)} · {templateSubtype(template)}
      </div>
      <div className="mt-4 line-clamp-4 text-sm leading-6 text-slate-600">{templateSummary(template)}</div>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onOpenTemplates}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
        >
          View template
          <ArrowRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onOpenTemplates}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          See all templates
        </button>
      </div>
    </div>
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

        const agreements = normalizeList(agreementsRes.data).slice(0, 5);
        const templates = normalizeList(templatesRes.data).slice(0, 3);
        const leads = normalizeList(leadsRes.data);
        const milestones = normalizeList(milestonesRes.data);

        setRecentAgreements(agreements);
        setPopularTemplates(templates);
        setSmartSuggestions(buildSmartSuggestions({ leads, agreements, milestones }));
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

  function openCopilot() {
    openAssistant({
      title: "Ask AI",
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
    <PageShell
      title="AI Workspace"
      subtitle="Start work, launch the right flow, and keep the next move clear."
      showLogo
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 pb-10 pt-6 sm:px-6 lg:px-8">
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.95fr)]">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#52749a]">
              AI Workspace
            </div>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#18395f] md:text-[2.6rem]">
              Start something new with AI
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 md:text-[15px]">
              Describe the job, project, or task in plain language and AI Workspace will route you
              into the right MyHomeBro flow with the right setup already in motion.
            </p>

            <form onSubmit={handleHeroSubmit} className="mt-6">
              <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-3">
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Describe your job or task..."
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

          <div className="rounded-[32px] border border-slate-900/10 bg-[linear-gradient(160deg,#0f172a_0%,#163B70_60%,#1f5fa8_100%)] p-6 text-white shadow-sm md:p-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-100">
              <Sparkles className="h-3.5 w-3.5" />
              What This Does
            </div>
            <h3 className="mt-4 text-2xl font-bold tracking-tight">
              AI Workspace is your launch hub, onboarding surface, and control center.
            </h3>
            <p className="mt-3 text-sm leading-6 text-sky-50/90">
              Start new work here, jump into the right area faster, and keep AI Copilot focused on
              contextual help inside the page you're already using.
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

        <section>
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

        <section>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Suggested For You
            </div>
            <h3 className="mt-2 text-2xl font-bold tracking-tight text-[#18395f]">
              Recommended next moves based on your current work.
            </h3>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {loadingWorkspace ? (
              <div className="rounded-3xl border border-slate-200 bg-white px-6 py-8 text-sm text-slate-600 shadow-sm lg:col-span-2">
                Loading suggestions...
              </div>
            ) : smartSuggestions.length ? (
              smartSuggestions.map((item) => (
                <SuggestionCard
                  key={item.id}
                  item={item}
                  onPrimary={() => navigate(item.primaryTarget)}
                  onSecondary={() => {
                    if (item.secondaryAction === "copilot") {
                      openCopilot();
                      return;
                    }
                    if (item.secondaryTarget) {
                      navigate(item.secondaryTarget);
                    }
                  }}
                />
              ))
            ) : (
              <div className="rounded-3xl border border-slate-200 bg-white px-6 py-8 text-sm text-slate-600 shadow-sm lg:col-span-2">
                Nothing urgent is surfaced right now. Use Quick Actions to start something new.
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Recent Work
              </div>
              <h3 className="mt-2 text-2xl font-bold tracking-tight text-[#18395f]">
                Continue where your recent projects left off.
              </h3>
            </div>
            <button
              type="button"
              onClick={() => navigate("/app/agreements")}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              View all agreements
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-5 space-y-3">
            {loadingWorkspace ? (
              <div className="rounded-3xl border border-slate-200 bg-white px-6 py-8 text-sm text-slate-600 shadow-sm">
                Loading recent work...
              </div>
            ) : recentAgreements.length ? (
              recentAgreements.map((agreement) => (
                <button
                  key={agreement?.id || agreementTitle(agreement)}
                  type="button"
                  onClick={() =>
                    navigate(
                      agreement?.id ? `/app/agreements/${agreement.id}` : "/app/agreements"
                    )
                  }
                  className="flex w-full flex-col gap-4 rounded-3xl border border-slate-200 bg-white px-6 py-5 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md md:flex-row md:items-center md:justify-between"
                  data-testid={`ai-workspace-recent-work-${agreement?.id || "unknown"}`}
                >
                  <div className="flex min-w-0 items-start gap-4">
                    <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-slate-700">
                      <BriefcaseBusiness className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-lg font-semibold text-slate-900">
                        {agreementTitle(agreement)}
                      </div>
                      <div className="mt-1 text-sm text-slate-600">
                        {agreementCustomer(agreement)}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700">
                          Status: {agreementStatus(agreement)}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700">
                          Current step: {agreementCurrentStep(agreement)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <span className="inline-flex items-center gap-2 rounded-full bg-[#18395f] px-4 py-2 text-sm font-semibold text-white">
                      Continue
                      <ArrowRight className="h-4 w-4" />
                    </span>
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-3xl border border-slate-200 bg-white px-6 py-8 text-sm text-slate-600 shadow-sm">
                No recent agreements yet. Start with AI above to kick off the first project.
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Popular Templates
              </div>
              <h3 className="mt-2 text-2xl font-bold tracking-tight text-[#18395f]">
                Explore reusable project structures before you draft.
              </h3>
            </div>
            <button
              type="button"
              onClick={() => navigate("/app/templates")}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Open Templates
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-5 grid gap-4 xl:grid-cols-3">
            {loadingWorkspace ? (
              <div className="rounded-3xl border border-slate-200 bg-white px-6 py-8 text-sm text-slate-600 shadow-sm xl:col-span-3">
                Loading templates...
              </div>
            ) : popularTemplates.length ? (
              popularTemplates.map((template) => (
                <TemplatePreviewCard
                  key={template?.id || templateTitle(template)}
                  template={template}
                  onOpenTemplates={() => navigate("/app/templates")}
                />
              ))
            ) : (
              <div className="rounded-3xl border border-slate-200 bg-white px-6 py-8 text-sm text-slate-600 shadow-sm xl:col-span-3">
                No template previews are available right now. Open Templates to browse the full
                library.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-[#f8fafc] px-6 py-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-lg font-semibold text-slate-900">
                Need help with your current page?
              </div>
              <div className="mt-1 text-sm leading-6 text-slate-600">
                AI Copilot is for contextual guidance inside the page or workflow step you're
                already using. Open it when you want help without leaving where you are.
              </div>
            </div>
            <button
              type="button"
              onClick={openCopilot}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              data-testid="ai-workspace-open-copilot"
            >
              <MessageSquareText className="h-4 w-4" />
              Ask AI
            </button>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
