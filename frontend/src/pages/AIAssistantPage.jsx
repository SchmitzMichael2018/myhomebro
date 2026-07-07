import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  Clock3,
  History,
  Layers3,
  MessageSquareText,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import { useAssistantDock } from "../components/AssistantDock.jsx";

const ASSISTANT_CONTEXT = {
  current_route: "/app/assistant",
  page: "assistant_home",
  workspace_mode: "dashboard",
  role: "contractor",
  lifecycle_stage: "cross_workspace_review",
};

const ROLE_SKILLS = [
  "Find my next task",
  "Draft or review estimates",
  "Create agreement from estimate",
  "Review milestones and planning validation",
  "Recommend labor",
  "Draft customer reminders",
  "Summarize projects and disputes",
  "Analyze business performance",
];

const HISTORY_ITEMS = [
  {
    key: "estimate-review",
    title: "Estimate review",
    detail: "Project Assistant can review scope, line items, incidentals, and readiness inside Estimate Workspace.",
  },
  {
    key: "agreement-handoff",
    title: "Agreement handoff",
    detail: "Estimate context carries into Agreement Wizard so customer, address, scope, pricing, and assumptions are not re-entered.",
  },
  {
    key: "safe-actions",
    title: "Confirmation required",
    detail: "Assistant actions never sign, fund, assign, schedule, release payment, resolve disputes, or send customer messages without confirmation.",
  },
];

function listFromResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

async function fetchAssistantHomeSignals() {
  const [agreementsRes, milestonesRes, leadsRes, templatesRes] = await Promise.allSettled([
    api.get("/projects/agreements/", { params: { page_size: 8 } }),
    api.get("/projects/milestones/", { params: { page_size: 8 } }),
    api.get("/projects/contractor/public-leads/", { params: { page_size: 8 } }),
    api.get("/projects/templates/discover/", { params: { page_size: 6 } }),
  ]);

  return {
    agreements: agreementsRes.status === "fulfilled" ? listFromResponse(agreementsRes.value?.data) : [],
    milestones: milestonesRes.status === "fulfilled" ? listFromResponse(milestonesRes.value?.data) : [],
    leads: leadsRes.status === "fulfilled" ? listFromResponse(leadsRes.value?.data) : [],
    templates: templatesRes.status === "fulfilled" ? listFromResponse(templatesRes.value?.data) : [],
  };
}

function statusLabel(value) {
  return String(value || "recent").replaceAll("_", " ");
}

function buildRecentContext({ agreements = [], leads = [], templates = [] }) {
  const agreementItems = agreements.slice(0, 4).map((item) => ({
    key: `agreement-${item.id}`,
    type: "Agreement",
    title: item.project_title || item.title || item.name || "Agreement",
    meta: [statusLabel(item.status), item.customer_name || item.homeowner_name].filter(Boolean).join(" | "),
    route: item.id ? `/app/agreements/${item.id}` : "/app/agreements",
  }));

  const leadItems = leads.slice(0, 3).map((item) => ({
    key: `lead-${item.id || item.source_id}`,
    type: "Opportunity",
    title: item.project_title || item.project_type || item.customer_name || "Opportunity",
    meta: [statusLabel(item.status), item.customer_name || item.full_name].filter(Boolean).join(" | "),
    route: "/app/opportunities",
  }));

  const templateItems = templates.slice(0, 2).map((item) => ({
    key: `template-${item.id}`,
    type: "Template",
    title: item.name || "Template",
    meta: [item.project_type, item.project_subtype].filter(Boolean).join(" | "),
    route: "/app/templates",
  }));

  return [...agreementItems, ...leadItems, ...templateItems].slice(0, 6);
}

function buildPendingRecommendations({ agreements = [], milestones = [], leads = [] }) {
  const rows = [];
  const drafts = agreements.filter((item) => String(item.status || "").toLowerCase() === "draft");
  if (drafts.length) {
    rows.push({
      key: "draft-agreements",
      priority: "Today",
      title: "Draft agreements need review",
      project: drafts[0]?.project_title || drafts[0]?.title || "Agreement pipeline",
      why: `${drafts.length} draft agreement${drafts.length === 1 ? "" : "s"} can move toward signature once reviewed.`,
      action: "Open agreements",
      route: "/app/agreements",
    });
  }

  const submittedMilestones = milestones.filter((item) =>
    ["submitted", "pending_review", "review", "in_review"].includes(String(item.status || item.state || "").toLowerCase())
  );
  if (submittedMilestones.length) {
    rows.push({
      key: "submitted-milestones",
      priority: "Today",
      title: "Milestones are awaiting review",
      project: submittedMilestones[0]?.project_title || submittedMilestones[0]?.agreement_title || "Active projects",
      why: "Reviewing submitted work keeps approvals, invoices, and customer communication moving.",
      action: "Open review queue",
      route: "/app/reviewer/queue",
    });
  }

  const pendingLeads = leads.filter((item) =>
    ["new", "submitted", "pending", "ready_for_review"].includes(String(item.status || "").toLowerCase())
  );
  if (pendingLeads.length) {
    rows.push({
      key: "pending-leads",
      priority: "High",
      title: "Customers are waiting for estimate follow-up",
      project: pendingLeads[0]?.project_title || pendingLeads[0]?.project_type || "Opportunity pipeline",
      why: "Fast lead review improves conversion and keeps the estimate-first workflow moving.",
      action: "Open opportunities",
      route: "/app/opportunities",
    });
  }

  if (!rows.length) {
    rows.push({
      key: "caught-up",
      priority: "Normal",
      title: "No urgent assistant recommendations",
      project: "All workspaces",
      why: "Project Assistant will keep watching active work from the dashboard and each workspace.",
      action: "Open dashboard",
      route: "/app/dashboard",
    });
  }

  return rows.slice(0, 4);
}

function AssistantHomeCard({ icon: Icon, eyebrow, title, children, testId }) {
  return (
    <section
      data-testid={testId}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
        <Icon className="h-4 w-4 text-[#18395f]" />
        {eyebrow}
      </div>
      <h3 className="mt-3 text-xl font-black tracking-tight text-[#18395f]">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function AIAssistantPage() {
  const navigate = useNavigate();
  const { openAssistant } = useAssistantDock();
  const [signals, setSignals] = useState({ agreements: [], milestones: [], leads: [], templates: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAssistantHomeSignals()
      .then((data) => {
        if (!cancelled) setSignals(data);
      })
      .catch(() => {
        if (!cancelled) setSignals({ agreements: [], milestones: [], leads: [], templates: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const recentContext = useMemo(() => buildRecentContext(signals), [signals]);
  const pendingRecommendations = useMemo(() => buildPendingRecommendations(signals), [signals]);

  function openProjectAssistant() {
    openAssistant({ context: ASSISTANT_CONTEXT });
  }

  return (
    <ContractorPageSurface
      eyebrow="Project Assistant"
      title="Assistant Home"
      subtitle="A compatibility home for assistant history, context, recommendations, and settings."
      variant="operational"
      className="mhb-assistant-home"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section
          data-testid="assistant-home-hero"
          className="rounded-2xl border border-slate-900/10 bg-[linear-gradient(160deg,#0f172a_0%,#163B70_62%,#1f5fa8_100%)] p-6 text-white shadow-sm md:p-8"
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-sky-100">
                <Sparkles className="h-3.5 w-3.5" />
                Single AI Identity
              </div>
              <h2 className="mt-4 text-3xl font-black tracking-tight">Project Assistant</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-sky-50/90">
                Work in the correct workspace. Project Assistant inherits the current role,
                workspace, project, customer, property, estimate, agreement, opportunity, and
                lifecycle stage when opened in context.
              </p>
            </div>
            <button
              type="button"
              onClick={openProjectAssistant}
              data-testid="assistant-home-open-assistant"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-black text-[#12345c] shadow-sm hover:bg-sky-50"
            >
              <Bot className="h-4 w-4" />
              Open Project Assistant
            </button>
          </div>

          <dl data-testid="assistant-home-context" className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[
              ["Role", "Contractor"],
              ["Workspace", "Assistant Home"],
              ["Project", "Current workspace"],
              ["Customer", "Inherited in context"],
              ["Agreement", "Inherited in context"],
              ["Lifecycle", "Cross-workspace"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-white/12 bg-white/10 px-3 py-3">
                <dt className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-100/60">{label}</dt>
                <dd className="mt-1 text-sm font-bold text-white">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
          <AssistantHomeCard
            icon={ShieldCheck}
            eyebrow="Pending Recommendations"
            title="Review assistant recommendations"
            testId="assistant-home-pending-recommendations"
          >
            <div className="space-y-3">
              {loading ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  Loading recommendations...
                </div>
              ) : (
                pendingRecommendations.map((item) => (
                  <article key={item.key} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-black uppercase text-slate-600">
                        Priority: {item.priority}
                      </span>
                      <span className="text-xs font-bold text-slate-500">{item.project}</span>
                    </div>
                    <div className="mt-2 text-base font-black text-slate-950">{item.title}</div>
                    <div className="mt-1 text-sm leading-6 text-slate-600">
                      <strong className="text-slate-800">Why this matters:</strong> {item.why}
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(item.route)}
                      className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-800"
                    >
                      {item.action}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </article>
                ))
              )}
            </div>
          </AssistantHomeCard>

          <AssistantHomeCard
            icon={Layers3}
            eyebrow="Role-Based Skills"
            title="Contractor skills"
            testId="assistant-home-role-skills"
          >
            <div className="grid gap-2">
              {ROLE_SKILLS.map((skill) => (
                <div key={skill} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                  {skill}
                </div>
              ))}
            </div>
          </AssistantHomeCard>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <AssistantHomeCard
            icon={Clock3}
            eyebrow="Recent Context"
            title="Recent work Project Assistant can inherit"
            testId="assistant-home-recent-context"
          >
            <div className="space-y-3">
              {loading ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  Loading recent context...
                </div>
              ) : recentContext.length ? (
                recentContext.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => navigate(item.route)}
                    className="block w-full rounded-xl border border-slate-200 bg-slate-50 p-4 text-left hover:border-slate-400"
                    data-testid={`assistant-home-context-${item.key}`}
                  >
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{item.type}</div>
                    <div className="mt-1 text-sm font-black text-slate-950">{item.title}</div>
                    {item.meta ? <div className="mt-1 text-xs font-semibold text-slate-500">{item.meta}</div> : null}
                  </button>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                  No recent context yet. Project Assistant will inherit context from active workspaces as you use the platform.
                </div>
              )}
            </div>
          </AssistantHomeCard>

          <AssistantHomeCard
            icon={History}
            eyebrow="History"
            title="Assistant history and recent drafts"
            testId="assistant-home-history"
          >
            <div className="space-y-3">
              {HISTORY_ITEMS.map((item) => (
                <div key={item.key} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-black text-slate-950">{item.title}</div>
                  <div className="mt-1 text-sm leading-6 text-slate-600">{item.detail}</div>
                </div>
              ))}
            </div>
          </AssistantHomeCard>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <AssistantHomeCard
            icon={MessageSquareText}
            eyebrow="Saved Conversations"
            title="Saved conversations"
            testId="assistant-home-saved-conversations"
          >
            <p className="text-sm leading-6 text-slate-600">
              Saved assistant conversations will appear here as workspace-level assistant history is centralized.
            </p>
          </AssistantHomeCard>

          <AssistantHomeCard
            icon={Settings}
            eyebrow="Settings"
            title="Assistant settings"
            testId="assistant-home-settings"
          >
            <p className="text-sm leading-6 text-slate-600">
              Assistant preferences, governance, and future voice-ready action settings belong here. Irreversible actions still require explicit confirmation.
            </p>
          </AssistantHomeCard>
        </div>
      </div>
    </ContractorPageSurface>
  );
}
