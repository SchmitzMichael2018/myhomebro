import React, { useEffect, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Compass,
  HelpCircle,
  RotateCcw,
  Sparkles,
} from "lucide-react";

import {
  ProjectAssistantApprovalNotice,
  ProjectAssistantCard,
  ProjectAssistantPanel,
  ProjectAssistantSection,
} from "../ProjectAssistantExperience.jsx";

export const GUIDED_EXPERIENCE_STORAGE_PREFIX = "mhb-guided-experience:v1";

export const ROLE_WALKTHROUGHS = {
  contractor: {
    label: "Contractor",
    title: "Contractor guided experience",
    summary:
      "Follow the path from business setup through marketing, sales, active work, warranty, and business performance.",
    steps: [
      "Company setup: keep business information, branding, service areas, licenses, insurance, and Stripe readiness current.",
      "Marketing: publish trustworthy public content, collect proof, and turn website, profile, and QR traffic into leads.",
      "Opportunities: review incoming demand and move qualified leads into the estimate-first workflow.",
      "Estimates: build scope, checklist readiness, line items, incidentals reserve, and customer-facing assumptions.",
      "Agreements: convert the estimate into a reviewable agreement without losing customer, address, scope, or pricing context.",
      "Funding: confirm safe funding or direct-pay expectations before operational work begins.",
      "Project: manage milestones, schedules, documents, changes, and customer communication.",
      "Payments: request approvals, track invoices, and keep payment movement human-confirmed.",
      "Warranty: respond to warranty requests with coverage context, evidence, and planned repair work.",
      "Insights: understand revenue, workload, expenses, conversion, and where the business needs attention.",
    ],
  },
  customer: {
    label: "Customer",
    title: "Customer guided experience",
    summary:
      "Understand how a project request becomes an estimate, agreement, funded project, milestone approval, warranty request, or resolution case.",
    steps: [
      "Request project: share the project address, scope, photos, timing, and contact preferences.",
      "Review estimate: compare scope, assumptions, line items, schedule context, and next steps.",
      "Sign agreement: review terms, milestones, warranty, payment structure, and documents before signing.",
      "Fund project: complete safe test-mode funding or direct-pay instructions when the agreement requires it.",
      "Approve milestones: review completed work and approve only when the milestone is ready.",
      "Request warranty: open a warranty request with photos, documents, and a clear description.",
      "Resolution if needed: provide evidence and statements while humans decide any outcome.",
    ],
  },
  property_manager: {
    label: "Property Manager",
    title: "Property manager guided experience",
    summary:
      "Use property records, maintenance requests, assignments, history, and reporting to manage rentals without losing tenant context.",
    steps: [
      "Properties: keep property records, systems, documents, photos, and contacts organized.",
      "Maintenance: capture tenant or owner requests with priority, access notes, and supporting evidence.",
      "Assignments: route work to the right contractor, vendor, or team member when the workflow supports it.",
      "History: review past requests, work orders, documents, warranties, and payments by property.",
      "Reports: use property and maintenance history to understand cost, response time, and recurring issues.",
    ],
  },
  admin: {
    label: "Administrator",
    title: "Administrator guided experience",
    summary:
      "Operate MyHomeBro as a Marketplace Operations Center with human-controlled risk, money, resolution, and platform-health workflows.",
    steps: [
      "Marketplace: monitor supply, demand, coverage, routing, verification, and saved request queues.",
      "Verification: review contractor readiness, identity, license, insurance, profile, and Stripe signals.",
      "Financial Operations: investigate held funds, reimbursements, fees, payouts, refunds, and payment exceptions.",
      "Resolution: oversee evidence completeness, payment holds, human decisions, and escalation status.",
      "Warranty: monitor warranty volume, response health, repeat issues, and escalations.",
      "Platform Health: watch webhooks, notifications, documents, background jobs, errors, and support signals.",
    ],
  },
};

export const SETUP_CHECKLISTS = [
  {
    key: "company",
    title: "Company Setup",
    items: ["Company name and contact details", "Logo and brand basics", "Service areas", "Licenses and insurance", "Stripe/test payment readiness"],
  },
  {
    key: "marketing",
    title: "Marketing",
    items: ["Public profile", "Website basics", "Portfolio photos", "Reviews", "Lead capture and QR code"],
  },
  {
    key: "team",
    title: "Team",
    items: ["Employees", "Capabilities", "Labor costs", "Subcontractors", "Estimate availability"],
  },
];

export const WORKSPACE_HELP = [
  {
    key: "dashboard",
    title: "Dashboard",
    prompt: "What happens here?",
    answer: "Start each day by checking the attention queue, open recommendations, upcoming work, and the next action across the business.",
  },
  {
    key: "marketing",
    title: "Marketing",
    prompt: "How do leads become projects?",
    answer: "Marketing owns public presence and lead generation. Qualified leads move to Opportunities, then Estimates, then Agreements.",
  },
  {
    key: "estimates",
    title: "Estimates",
    prompt: "Why estimate-first?",
    answer: "Estimates let you clarify scope, pricing, assumptions, and readiness before creating a customer agreement.",
  },
  {
    key: "customer_portal",
    title: "Customer Portal",
    prompt: "What should customers do here?",
    answer: "Customers review project status, requests, estimates, agreements, payments, documents, home records, maintenance, notifications, and warranties.",
  },
  {
    key: "admin",
    title: "Admin",
    prompt: "What needs attention?",
    answer: "Admins review marketplace operations, verification, money risk, resolution, warranty, support, and platform health without taking irreversible actions automatically.",
  },
];

export const HELP_CENTER_TOPICS = [
  {
    key: "project-assistant",
    question: "What can Project Assistant do?",
    answer:
      "It summarizes context, highlights missing information, recommends next steps, and prepares drafts. Humans approve sends, signatures, assignments, payments, publishing, and resolutions.",
  },
  {
    key: "estimate-first",
    question: "Why does MyHomeBro use estimates before agreements?",
    answer:
      "The estimate workspace captures scope, pricing, assumptions, readiness, and incidentals before those details become agreement terms.",
  },
  {
    key: "where-to-start",
    question: "Where should I start?",
    answer:
      "Start with the role walkthrough, then use workspace help cards whenever a page feels unfamiliar.",
  },
];

function cleanRole(value) {
  return String(value || "").trim().toLowerCase().replace(/-/g, "_");
}

export function getGuidedExperienceRole(identityOrRole) {
  const raw =
    typeof identityOrRole === "string"
      ? identityOrRole
      : identityOrRole?.account_type || identityOrRole?.type || identityOrRole?.role || identityOrRole?.user_type;
  const role = cleanRole(raw);
  if (["admin", "platform_admin", "staff", "superuser"].includes(role)) return "admin";
  if (["property_manager", "propertymanager", "property_management", "manager"].includes(role)) return "property_manager";
  if (["customer", "homeowner", "property_owner"].includes(role)) return "customer";
  return "contractor";
}

function storageKey(role) {
  return `${GUIDED_EXPERIENCE_STORAGE_PREFIX}:${role}`;
}

export function readGuidedExperienceState(role) {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(storageKey(role));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function writeGuidedExperienceState(role, nextState) {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(storageKey(role), JSON.stringify({ ...nextState, role, updatedAt: new Date().toISOString() }));
}

export function useGuidedExperience(role) {
  const [state, setState] = useState(() => readGuidedExperienceState(role));

  useEffect(() => {
    setState(readGuidedExperienceState(role));
  }, [role]);

  const update = (patch) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      writeGuidedExperienceState(role, next);
      return next;
    });
  };

  return [state, update];
}

export function RoleWalkthrough({ role = "contractor" }) {
  const walkthrough = ROLE_WALKTHROUGHS[role] || ROLE_WALKTHROUGHS.contractor;
  const [state, updateState] = useGuidedExperience(role);
  const activeIndex = Math.min(Number(state.stepIndex || 0), walkthrough.steps.length - 1);
  const status = state.status || "not_started";
  const complete = status === "completed";
  const skipped = status === "skipped";

  const start = () => updateState({ status: "active", stepIndex: activeIndex || 0 });
  const skip = () => updateState({ status: "skipped", stepIndex: activeIndex || 0 });
  const restart = () => updateState({ status: "active", stepIndex: 0 });
  const resumeLater = () => updateState({ status: "paused", stepIndex: activeIndex });
  const next = () => {
    if (activeIndex >= walkthrough.steps.length - 1) {
      updateState({ status: "completed", stepIndex: walkthrough.steps.length - 1 });
      return;
    }
    updateState({ status: "active", stepIndex: activeIndex + 1 });
  };

  return (
    <section data-testid="guided-role-walkthrough" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500">
            <Compass className="h-4 w-4 text-[#18395f]" aria-hidden="true" />
            {walkthrough.label}
          </div>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-[#18395f]">{walkthrough.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{walkthrough.summary}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-700" data-testid="guided-walkthrough-status">
          {complete ? "Completed" : skipped ? "Skipped" : status === "paused" ? "Paused" : status === "active" ? `Step ${activeIndex + 1} of ${walkthrough.steps.length}` : "Ready to start"}
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        {walkthrough.steps.map((step, index) => {
          const isActive = !complete && !skipped && index === activeIndex && status !== "not_started";
          const isDone = complete || index < activeIndex;
          return (
            <div
              key={step}
              data-testid={`guided-walkthrough-step-${index + 1}`}
              className={[
                "rounded-xl border px-4 py-3 text-sm leading-6",
                isActive ? "border-blue-300 bg-blue-50 text-blue-950" : isDone ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-slate-50 text-slate-600",
              ].join(" ")}
            >
              <div className="flex gap-3">
                <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${isDone ? "text-emerald-600" : isActive ? "text-blue-700" : "text-slate-400"}`} aria-hidden="true" />
                <span>{step}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {status === "not_started" || skipped || complete ? (
          <button type="button" onClick={complete || skipped ? restart : start} className="rounded-xl bg-[#18395f] px-4 py-2 text-sm font-black text-white" data-testid="guided-start">
            {complete || skipped ? "Restart walkthrough" : "Start walkthrough"}
          </button>
        ) : (
          <>
            <button type="button" onClick={next} className="rounded-xl bg-[#18395f] px-4 py-2 text-sm font-black text-white" data-testid="guided-next">
              {activeIndex >= walkthrough.steps.length - 1 ? "Complete walkthrough" : "Next step"}
            </button>
            <button type="button" onClick={resumeLater} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700" data-testid="guided-resume-later">
              Resume later
            </button>
          </>
        )}
        <button type="button" onClick={skip} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700" data-testid="guided-skip">
          Skip walkthrough
        </button>
        <button type="button" onClick={restart} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700" data-testid="guided-restart">
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Restart
        </button>
      </div>
    </section>
  );
}

export function ProgressChecklist({ title = "Setup progress", checklists = SETUP_CHECKLISTS }) {
  return (
    <section data-testid="guided-progress-checklists" className="grid gap-4 lg:grid-cols-3">
      {checklists.map((section) => (
        <article key={section.key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black text-slate-950">
            <ClipboardCheck className="h-4 w-4 text-[#18395f]" aria-hidden="true" />
            {section.title || title}
          </div>
          <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
            {section.items.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}

export function WorkspaceWalkthroughCards({ items = WORKSPACE_HELP }) {
  return (
    <section data-testid="guided-workspace-help" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-black text-slate-950">
        <HelpCircle className="h-4 w-4 text-[#18395f]" aria-hidden="true" />
        Workspace walkthroughs
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <article key={item.key} className="rounded-xl border border-slate-200 bg-slate-50 p-4" data-testid={`workspace-help-${item.key}`}>
            <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{item.title}</div>
            <div className="mt-2 text-sm font-black text-slate-950">{item.prompt}</div>
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.answer}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function SmartEmptyState({
  title = "Nothing here yet",
  nextStep = "Start with the recommended next action.",
  assistantTip = "Project Assistant can explain this page and prepare a safe draft when enough information exists.",
  children = null,
  testId = "smart-empty-state",
}) {
  return (
    <div data-testid={testId} className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-600">
      <div className="font-black text-slate-900">{title}</div>
      <p className="mt-1 leading-6">{nextStep}</p>
      <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-blue-950">
        <span className="font-black">Project Assistant tip: </span>
        {assistantTip}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

export function HelpCenterPanel() {
  return (
    <section data-testid="guided-help-center" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-black text-slate-950">
        <BookOpen className="h-4 w-4 text-[#18395f]" aria-hidden="true" />
        Help Center
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {HELP_CENTER_TOPICS.map((topic) => (
          <article key={topic.key} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-black text-slate-950">{topic.question}</div>
            <p className="mt-2 text-sm leading-6 text-slate-600">{topic.answer}</p>
            <button type="button" className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700">
              Learn More
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

export function GuidedAssistantTips({ role = "contractor" }) {
  const walkthrough = ROLE_WALKTHROUGHS[role] || ROLE_WALKTHROUGHS.contractor;
  const firstStep = walkthrough.steps[0] || "Review your current workspace.";

  return (
    <ProjectAssistantPanel
      testId="guided-project-assistant-tips"
      subtitle="Guided next steps"
      summary="Project Assistant explains the workspace, prepares drafts, and keeps irreversible actions under human control."
    >
      <ProjectAssistantSection title="Current role path">
        {firstStep}
      </ProjectAssistantSection>
      <ProjectAssistantCard title="Try asking" tone="info" icon={Sparkles}>
        <ul className="space-y-2 text-sm leading-6">
          <li>What happens on this page?</li>
          <li>What information is missing before I move forward?</li>
          <li>Prepare the next draft for review.</li>
        </ul>
      </ProjectAssistantCard>
      <ProjectAssistantApprovalNotice compact />
    </ProjectAssistantPanel>
  );
}

export function GuidedExperienceSummary({ role = "contractor" }) {
  const walkthrough = ROLE_WALKTHROUGHS[role] || ROLE_WALKTHROUGHS.contractor;
  const [state] = useGuidedExperience(role);
  const activeIndex = Math.min(Number(state.stepIndex || 0), walkthrough.steps.length - 1);
  const label = state.status === "completed" ? "Completed" : state.status === "skipped" ? "Skipped" : state.status === "active" ? `Step ${activeIndex + 1}` : "Available";

  return (
    <div data-testid="guided-experience-summary" className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950">
      <div className="font-black">Guided experience: {label}</div>
      <p className="mt-1 leading-6">{walkthrough.summary}</p>
    </div>
  );
}
